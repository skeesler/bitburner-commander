/** @param {NS} ns
 *
 *  CORP BOOST — stock boost materials to a target FRACTION OF WAREHOUSE SPACE, then stop. 62.6GB.
 *
 *      run corp-boost.js                   # report: where you are vs target, and what it'd cost
 *      run corp-boost.js --loop            # drive to target, then clear the rates and EXIT
 *      run corp-boost.js --loop --trim     # ...and sell DOWN if you're over target
 *      run corp-boost.js --clear           # panic button: zero every boost buy rate, now
 *
 *  WHY THIS EXISTS. Boost materials (Real Estate, Hardware, Robots, AI Cores) multiply
 *  production, and Real Estate is the standout for Agriculture — factor 0.72 at 0.005 space per
 *  unit. That tiny unit size is a trap: a warehouse looks like it has loads of room right up
 *  until you've spent $165b filling 900 units of space with 1.08 million units of Real Estate,
 *  jammed every warehouse to 100%, halted all production, and put the corporation $100b into
 *  debt. That is a real thing that happened here, and it happened because buyMaterial sets a
 *  PER-SECOND rate that runs forever until something sets it back to zero.
 *
 *  THE FIX IS THE UNIT OF MEASUREMENT. Targets here are a fraction of the warehouse, never a
 *  number of units. "40% of the warehouse" stays sane when you upgrade a warehouse, add a city,
 *  or switch industries; "90,000 units" does not, and nothing about a unit count tells you
 *  whether it fits.
 *
 *  WHY IT ONLY BUYS IN --loop MODE. A one-shot script cannot be safe here. It would set a
 *  per-second rate and exit, and the rate is precisely the thing that runs away — there would
 *  be nobody left to turn it off. So buying happens only while this script is alive, and the
 *  moment every city reaches its target it zeroes every rate and exits on its own. Run without
 *  --loop and it reports the plan and spends nothing.
 *
 *  IT ALSO WON'T BANKRUPT YOU. Every pass prices the plan against corp funds (minus --reserve)
 *  and scales the buy down to what you can actually afford, so an ambitious target becomes slow
 *  progress rather than debt. If funds are negative it buys nothing at all and says so.
 *
 *  TRIMMING. --trim handles the over-target case by driving corp-sell.js (which is why this
 *  costs 1GB for ns.run instead of 20GB for sellMaterial), always at market price, never at
 *  price 0 — dumping boost material at 0 hands it away for nothing, and if you are over target
 *  you are usually also short of cash. Each material is trimmed INDEPENDENTLY, and each sell
 *  order clears as soon as that material's LEAST-stocked city reaches target, so no city is
 *  ever trimmed below it. (One shared gate across all materials was the original design, and
 *  it deadlocked live in BN5: Real Estate arriving within tolerance of target vetoed the trim
 *  while Hardware and AI Cores sat 25-30% of the warehouse over.)
 *
 *  RAM: buyMaterial (20) + getMaterial (10) + getWarehouse (10) + getMaterialData (10)
 *       + getCorporation (10) + ns.run (1.0) + 1.6 base = 62.6GB.
 *       getConstants and nextUpdate are free.
 */

// ---- Defaults (all overridable by flag) ------------------------------------
const DIVISION = "Agriculture";
const STATE_FILE = "corp-state.txt";

// Raw fallback mix, used only when the industry is unknown and you haven't said what to do.
// PREFER --preset: this line is a single material and is wrong for most industries (see below).
const MIX = "Real Estate=0.40";

// The four materials that multiply production. Nothing else does.
const BOOST_MATERIALS = ["Real Estate", "Hardware", "Robots", "AI Cores"];
const TOTAL = 0.40;     // default share of each warehouse to hand to boost materials

// ---- WHY PRESETS COMPUTE RATHER THAN REMEMBER -------------------------------
// Production scales as
//
//     cityMult       = product over materials of (0.002 * qty + 1) ^ industryFactor
//     productionMult = Ncities * cityMult ^ 0.73
//
// which was checked against a live 3.0.1 corporation with three divisions and reproduced the
// game's own numbers to 0.00%, 0.00% and 0.50% at x18.365, x13.069 and x438.694 respectively.
//
// That formula is why "Real Estate=0.40" — the old default here, and the reason three materials
// sat at zero for an entire playthrough — is a bad plan almost everywhere. Real Estate is 0.005
// space per unit against 0.5 for Robots, so it LOOKS free, and for Agriculture (realEstate 0.72
// vs 0.2-0.3) it nearly is. But Chemical weights all four at 0.20-0.25 and Tobacco at 0.15-0.20:
// stacking one material with a flat exponent buys deep diminishing returns while three untouched
// terms sit at 1.0. Fixing that measured 2.72x production in Chemical for $1.39b.
//
// So a preset stores the INDUSTRY FACTORS and solves for the split, rather than storing a split.
// The optimum depends on warehouse size, so a remembered mix would go stale on every upgrade.
//
// Factors below are transcribed from a live corp-report.js run, not from published tables —
// those are stale in places. Add your own by pasting a division's "factors" line.
const INDUSTRY_FACTORS = {
  Agriculture: { "Real Estate": 0.72, "Hardware": 0.20, "Robots": 0.30, "AI Cores": 0.30 },
  Chemical:    { "Real Estate": 0.25, "Hardware": 0.20, "Robots": 0.25, "AI Cores": 0.20 },
  Tobacco:     { "Real Estate": 0.15, "Hardware": 0.15, "Robots": 0.20, "AI Cores": 0.15 },
};

const MAX_TOTAL   = 0.60;  // refuse a plan that would hand this much of the warehouse to boosts
const CYCLES      = 6;     // spread a purchase over this many cycles rather than one big hit
const RESERVE     = 0;     // corp funds to keep untouched
const TOLERANCE   = 0.02;  // ignore being within this fraction of the warehouse of target
const STALL_LIMIT = 30;    // give up after this many cycles of affording nothing
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["mix", ""], ["preset", ""], ["factors", ""], ["total", TOTAL],
    ["division", ""], ["cycles", CYCLES], ["reserve", RESERVE],
    ["max-total", MAX_TOTAL], ["loop", false], ["trim", false],
    ["clear", false], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const division = resolveDivision(ns, opts.division);
  const cities = Object.values(ns.enums.CityName);

  // Unit sizes never change. This is the whole reason the script can talk in warehouse space,
  // and the optimiser needs all four whether or not the final plan uses all four.
  const unitSize = {};
  for (const mat of BOOST_MATERIALS) {
    try { unitSize[mat] = ns.corporation.getMaterialData(mat).size || 0; } catch (e) { /* skip */ }
  }

  const chosen = resolveTargets(ns, division, cities, unitSize, opts);
  if (!chosen) return;
  const targets = chosen.targets;
  const names = Object.keys(targets);
  for (const mat of names) {
    if (!unitSize[mat]) { ns.tprint(`\nABORT: could not read a unit size for "${mat}".`); return; }
  }

  const total = Object.values(targets).reduce((a, b) => a + b, 0);
  if (total > opts["max-total"]) {
    ns.tprint(`\nABORT: that plan gives ${(100 * total).toFixed(0)}% of every warehouse to boost ` +
      `materials, over the ${(100 * opts["max-total"]).toFixed(0)}% guard rail.\n` +
      `  Boost materials sit there forever; inputs and outputs need the rest of the space or\n` +
      `  production halts. Lower the mix, or raise --max-total if you're sure.\n`);
    return;
  }

  let cycleSeconds = 10;
  try { cycleSeconds = ns.corporation.getConstants().secondsPerMarketCycle || 10; } catch (e) { /* default */ }

  if (!opts.clear) ns.tprint(`corp-boost: ${division} — ${chosen.how}`);

  // ---- panic button --------------------------------------------------------
  if (opts.clear) {
    let n = 0;
    for (const city of cities) for (const mat of names) {
      try { ns.corporation.buyMaterial(division, city, mat, 0); n++; } catch (e) { /* skip */ }
    }
    ns.tprint(`\ncorp-boost: cleared ${n} boost purchase order(s) for ${names.join(", ")}.\n` +
      `  Nothing is being bought now. Check with:  run corp-boost.js\n`);
    return;
  }

  // ---- report-only ---------------------------------------------------------
  if (!opts.loop) {
    const plan = survey(ns, division, cities, targets, unitSize, opts, cycleSeconds);
    printPlan(ns, plan, opts, cycleSeconds);
    return;
  }

  // ---- the driver ----------------------------------------------------------
  ns.tprint(`corp-boost: driving ${division} to ${describe(targets)}${opts.trim ? " (trim on)" : ""}` +
    `${opts.dry ? " [DRY RUN]" : ""}. It exits by itself when done — tail corp-boost.js to watch.`);

  let stalled = 0;
  const trimSet = new Set();   // materials with an active MAX@MP sell order right now

  // The same principle as the buy side: this script only ACTS while it is alive. A trim leaves a
  // standing MAX@MP sell order behind, and if you kill this mid-trim that order keeps going and
  // will happily sell every last unit of your boost material. So tear it down on the way out —
  // normal exit, stall exit, or a manual kill.
  if (!opts.dry) {
    ns.atExit(() => {
      if (trimSet.size) launch(ns, "corp-sell.js", ["--materials", [...trimSet].join(","), "--clear", "--division", division]);
    });
  }

  for (;;) {
    const plan = survey(ns, division, cities, targets, unitSize, opts, cycleSeconds);

    if (!plan.cities.length) {
      ns.tprint(`\ncorp-boost: no warehouses found in "${division}". Run corp-warehouses.js first.`);
      return;
    }

    // ---- over target: hand the selling to corp-sell.js --------------------
    // Gate PER MATERIAL on its least-stocked city, so trimming can never take a city below
    // target. It used to gate all materials on one shared minimum, and a single near-target
    // material vetoed the rest: Real Estate 3% over blocked the trim while Hardware and
    // AI Cores sat 25-30% of the warehouse over and production stalled at 100% full.
    if (opts.trim) {
      const overMats = names.filter((m) => (plan.matSurplus[m] ?? -Infinity) > TOLERANCE);
      const stopMats = [...trimSet].filter((m) => !overMats.includes(m));
      const startMats = overMats.filter((m) => !trimSet.has(m));
      if (stopMats.length) {
        ns.print(`at target: ${stopMats.join(", ")} — clearing sell order(s).`);
        if (!opts.dry && launch(ns, "corp-sell.js",
          ["--materials", stopMats.join(","), "--clear", "--division", division])) {
          for (const m of stopMats) trimSet.delete(m);
        }
      }
      if (startMats.length) {
        ns.print(`over target: ${startMats.join(", ")} — trimming at market price.`);
        if (!opts.dry && launch(ns, "corp-sell.js",
          ["--materials", startMats.join(","), "--amount", "MAX", "--price", "MP", "--division", division])) {
          for (const m of startMats) trimSet.add(m);
        }
      }
    }

    // ---- under target: buy, within what we can afford ---------------------
    if (!opts.dry) applyRates(ns, division, plan);

    if (plan.affordable === 0 && plan.toBuyCost > 0) stalled++; else stalled = 0;

    ns.print(statusLine(ns, plan, trimSet));

    // ---- are we done? -----------------------------------------------------
    if (plan.maxDeficitFrac <= TOLERANCE && trimSet.size === 0) {
      if (!opts.dry) clearRates(ns, division, cities, names);
      // "Done" must not claim "at target" when a material is still over it — which happens
      // whenever --trim is off, and briefly if a corp-sell launch failed for RAM.
      const still = names.filter((m) => (plan.matSurplus[m] ?? 0) > TOLERANCE);
      ns.tprint(still.length
        ? `\ncorp-boost: DONE buying — nothing is under target and every purchase order is back to ` +
          `zero. But ${still.join(", ")} ${still.length === 1 ? "is" : "are"} still OVER target.\n` +
          `  Sell the excess back at market price:  run corp-boost.js --loop --trim\n`
        : `\ncorp-boost: DONE. ${division} is at ${describe(targets)} in every city, ` +
          `and every boost purchase order is back to zero.\n` +
          `  Check:  run corp-boost.js\n`);
      return;
    }
    if (stalled >= STALL_LIMIT) {
      if (!opts.dry) clearRates(ns, division, cities, names);
      ns.tprint(`\ncorp-boost: STOPPING — ${STALL_LIMIT} cycles with nothing affordable ` +
        `(funds $${fmt(ns, plan.funds)}, reserve $${fmt(ns, opts.reserve)}).\n` +
        `  Purchase orders cleared so nothing runs away. Come back when the corporation has cash.\n`);
      return;
    }

    try { await ns.corporation.nextUpdate(); }
    catch (e) { await ns.sleep(cycleSeconds * 1000); }
  }
}

/** Measure every city against the target and price the shortfall. Buys nothing. */
function survey(ns, division, cities, targets, unitSize, opts, cycleSeconds) {
  const names = Object.keys(targets);
  const plan = {
    division, cities: [], missing: [], overCities: [],
    toBuyCost: 0, affordable: 0, funds: 0, spendable: 0,
    maxDeficitFrac: 0,
    // Per material: the surplus of its least-stocked city — the safe gate for trimming it.
    matSurplus: {},
  };

  try { plan.funds = ns.corporation.getCorporation().funds; } catch (e) { plan.funds = 0; }
  plan.spendable = Math.max(0, plan.funds - Number(opts.reserve));

  for (const city of cities) {
    let wh;
    try { wh = ns.corporation.getWarehouse(division, city); }
    catch (e) { plan.missing.push(city); continue; }
    if (!wh.size) { plan.missing.push(city); continue; }

    const freeSpace = Math.max(0, wh.size - wh.sizeUsed);
    const row = { city, size: wh.size, freeSpace, items: [] };
    let citySurplusFrac = Infinity;

    for (const mat of names) {
      let m;
      try { m = ns.corporation.getMaterial(division, city, mat); } catch (e) { continue; }

      const unit = unitSize[mat];
      const haveFrac = (m.stored * unit) / wh.size;
      const wantFrac = targets[mat];
      const gapFrac = wantFrac - haveFrac;            // >0 short, <0 over

      // Shortfall in units, never more than the free space can physically hold.
      const gapSpace = Math.max(0, gapFrac * wh.size);
      const buyable = Math.max(0, Math.min(gapSpace, freeSpace)) / unit;
      const cost = buyable * (m.marketPrice || 0);

      const item = {
        mat, stored: m.stored, haveFrac, wantFrac, gapFrac,
        units: buyable, cost, marketPrice: m.marketPrice || 0,
        excessUnits: gapFrac < 0 ? (-gapFrac * wh.size) / unit : 0,
      };
      row.items.push(item);

      plan.toBuyCost += cost;
      if (gapFrac > plan.maxDeficitFrac) plan.maxDeficitFrac = gapFrac;
      const surplus = -gapFrac;                        // how far OVER target this material is
      if (surplus < citySurplusFrac) citySurplusFrac = surplus;
      if (!(mat in plan.matSurplus) || surplus < plan.matSurplus[mat]) plan.matSurplus[mat] = surplus;
    }

    if (citySurplusFrac !== Infinity && citySurplusFrac > TOLERANCE) plan.overCities.push(city);
    plan.cities.push(row);
  }

  // Scale the whole plan to what the corporation can actually pay for. An ambitious target
  // becomes slow progress instead of the debt spiral that motivated this script.
  plan.scale = plan.toBuyCost > 0 ? Math.min(1, plan.spendable / plan.toBuyCost) : 1;
  plan.affordable = plan.toBuyCost * plan.scale;
  plan.cycleSeconds = cycleSeconds;
  plan.spreadCycles = Math.max(1, Number(opts.cycles));
  return plan;
}

/** Turn the surveyed plan into per-second buy rates. */
function applyRates(ns, division, plan) {
  const per = plan.cycleSeconds * plan.spreadCycles;
  for (const row of plan.cities) {
    for (const it of row.items) {
      const units = it.units * plan.scale;
      const rate = units > 0 ? round4(units / per) : 0;
      try { ns.corporation.buyMaterial(division, row.city, it.mat, rate); } catch (e) { /* skip city */ }
    }
  }
}

function clearRates(ns, division, cities, names) {
  for (const city of cities) for (const mat of names) {
    try { ns.corporation.buyMaterial(division, city, mat, 0); } catch (e) { /* skip */ }
  }
}

function statusLine(ns, plan, trimSet) {
  const worst = (100 * plan.maxDeficitFrac).toFixed(1);
  const over = plan.overCities.length;
  return `funds $${fmt(ns, plan.funds)} · worst shortfall ${worst}% of warehouse · ` +
    `spending $${fmt(ns, plan.affordable)}${plan.scale < 1 ? ` (capped from $${fmt(ns, plan.toBuyCost)})` : ""}` +
    (over ? ` · ${over} cities OVER target` : "") +
    (trimSet && trimSet.size ? ` · trimming ${[...trimSet].join(", ")}` : "");
}

function printPlan(ns, plan, opts, cycleSeconds) {
  const rows = plan.cities.map((row) => {
    const bits = row.items.map((it) => {
      const have = (100 * it.haveFrac).toFixed(1), want = (100 * it.wantFrac).toFixed(0);
      const verdict = it.gapFrac > TOLERANCE
        ? `SHORT ${fmt(ns, it.units)} units (~$${fmt(ns, it.cost)})`
        : it.gapFrac < -TOLERANCE
          ? `OVER by ${fmt(ns, it.excessUnits)} units`
          : "at target";
      return `    ${it.mat}: ${have}% of warehouse (target ${want}%) — ${verdict}`;
    });
    return `  ${row.city} — size ${row.size}, ${fmt(ns, row.freeSpace)} space free\n${bits.join("\n")}`;
  });

  const over = plan.overCities.length;
  ns.tprint(
    `\n===== corp-boost: ${plan.division} (report only — nothing bought) =====\n` +
    (rows.length ? rows.join("\n") : "  (no warehouses found)") +
    (plan.missing.length ? `\n  no warehouse: ${plan.missing.join(", ")}` : "") +
    `\n\n  corp funds:      $${fmt(ns, plan.funds)}` +
    `\n  cost to target:  $${fmt(ns, plan.toBuyCost)}` +
    (plan.toBuyCost > 0
      ? `\n  affordable now:  $${fmt(ns, plan.affordable)}` +
        (plan.scale < 1 ? `  (${(100 * plan.scale).toFixed(0)}% of the plan)` : "")
      : "") +
    `\n\n` +
    (over
      ? `  ${over} cit${over === 1 ? "y is" : "ies are"} OVER target — that space is why production stalls.\n` +
        `  Sell the excess back at MARKET PRICE (never --price 0; you'd hand it away for nothing):\n` +
        `      run corp-boost.js --loop --trim\n` +
        `  ...which trims each material independently and stops it at target. Or by hand:\n` +
        `      run corp-sell.js --materials "${Object.keys(plan.matSurplus).filter((m) => plan.matSurplus[m] > TOLERANCE).join(",")}" --amount "MAX" --price "MP"\n` +
        `      run corp-sell.js --materials "..." --clear      # when you get there\n`
      : plan.maxDeficitFrac > TOLERANCE
        ? `  Under target. To stock up safely:\n      run corp-boost.js --loop\n` +
          `  It spreads the purchase over ${opts.cycles} cycles, never spends past your funds, clears\n` +
          `  every rate when it's done, and then exits.\n`
        : `  Everything is at target. Nothing to do.\n`) +
    `=====`
  );
}

/** Run a helper script on home. 1GB for ns.run beats 20GB for mentioning sellMaterial here. */
function launch(ns, script, args) {
  if (!ns.fileExists(script, "home")) { ns.print(`skip ${script} — not on home.`); return 0; }
  const pid = ns.run(script, 1, ...args);
  if (!pid) ns.print(`FAILED ${script} — not enough free home RAM.`);
  return pid;
}

/** Parse "Real Estate=0.4,Hardware=0.05" into fractions of warehouse space. */
function parseMix(ns, text) {
  const out = {};
  for (const part of String(text).split(",")) {
    const bit = part.trim();
    if (!bit) continue;
    const at = bit.lastIndexOf("=");
    if (at < 1) { ns.tprint(`\nBad entry "${bit}" — expected "Name=fraction", e.g. "Real Estate=0.4".`); return null; }
    const name = bit.slice(0, at).trim();
    const n = Number(bit.slice(at + 1));
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      ns.tprint(`\nBad fraction "${bit.slice(at + 1)}" for "${name}" — it's a share of the warehouse, so 0 to 1.`);
      return null;
    }
    out[name] = n;
  }
  if (!Object.keys(out).length) { ns.tprint("\nEmpty mix."); return null; }
  return out;
}

function describe(t) {
  return Object.entries(t).map(([m, f]) => `${m} ${(100 * f).toFixed(0)}%`).join(", ");
}

function round4(n) { return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : 0; }

// ns.formatNumber was removed in 3.0.0 (tombstone: typeof passes, the call throws).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "0";
  try { return ns.format.number(n, 2); } catch (e) { return String(Math.round(n)); }
}

/** Explicit flag > corp-state.txt > built-in guess. ns.read is 0GB, so this is free. */
/** Names people actually type, mapped to the material names the API wants. */
const FACTOR_ALIAS = {
  realestate: "Real Estate", "real estate": "Real Estate", re: "Real Estate",
  hardware: "Hardware", hw: "Hardware",
  robots: "Robots", robot: "Robots", rob: "Robots",
  aicores: "AI Cores", "ai cores": "AI Cores", "ai": "AI Cores", cores: "AI Cores",
};

/** Decide what mix to drive to, in priority order, and report which route was taken. */
function resolveTargets(ns, division, cities, unitSize, opts) {
  const totalFrac = Number(opts.total);
  if (!Number.isFinite(totalFrac) || totalFrac <= 0 || totalFrac >= 1) {
    ns.tprint(`\nABORT: --total must be a fraction between 0 and 1 (got "${opts.total}").`);
    return null;
  }

  // 1. An explicit --mix always wins — the escape hatch for anything the solver can't express.
  if (opts.mix) {
    const targets = parseMix(ns, opts.mix);
    return targets ? { targets, how: "mix given by hand" } : null;
  }

  // 2. Otherwise work from industry factors, pasted or looked up.
  let factors = null, source = "";
  if (opts.factors) {
    factors = parseFactors(ns, opts.factors);
    if (!factors) return null;
    source = "factors given by hand";
  } else {
    const key = opts.preset ? String(opts.preset) : industryOf(ns, division);
    const match = key ? findIndustry(key) : null;
    if (opts.preset && !match) {
      ns.tprint(`\nUnknown preset "${opts.preset}". Known: ${Object.keys(INDUSTRY_FACTORS).join(", ")}\n` +
        `  Every other industry works too — paste its factors line out of corp-report.js:\n` +
        `      --factors "realEstate=0.25,hardware=0.2,robots=0.25,aiCores=0.2"\n`);
      return null;
    }
    if (match) { factors = INDUSTRY_FACTORS[match]; source = `${match} factors`; }
  }

  if (factors) {
    const whSize = warehouseSize(ns, division, cities);
    if (!whSize) {
      ns.tprint(`\nABORT: no warehouse found in "${division}".\n  run corp-warehouses.js first.\n`);
      return null;
    }
    const targets = optimalMix(factors, unitSize, whSize, totalFrac);
    if (!targets) { ns.tprint(`\nABORT: could not solve a mix from those factors.\n`); return null; }
    return { targets, how: `optimal split of ${(100 * totalFrac).toFixed(0)}% of a ` +
      `${Math.round(whSize).toLocaleString()}-unit warehouse, from ${source}` };
  }

  // 3. Nothing to go on. Say so loudly rather than quietly doing the wrong thing.
  const targets = parseMix(ns, MIX);
  if (!targets) return null;
  return { targets, how: `FALLBACK "${MIX}" — industry unknown, and a single material is the ` +
    `wrong plan for most industries.\n  Fix it with:  run corp-status.js   ` +
    `(records the industry)  ...or pass --preset ${Object.keys(INDUSTRY_FACTORS).join("|")}` };
}

/** The best split of `whSize * totalFrac` warehouse space across the boost materials.
 *
 *  Maximise  cityMult = prod (0.002*q_i + 1)^f_i   subject to  sum q_i*size_i = S.
 *  Taking logs makes it concave, so a Lagrange multiplier gives the exact answer in closed form:
 *
 *      d/dq_i [ f_i * ln(0.002 q_i + 1) ] = L * size_i
 *      =>  q_i = f_i / (L * size_i) - 500
 *      and substituting into the constraint,  L = (sum f_i) / (S + 500 * sum size_i)
 *
 *  A material whose q_i comes out negative wants no space at all; drop it and re-solve on the
 *  rest, which is why this loops. It converges in at most one pass per material.
 *
 *  Note the answer depends on S, so it must be recomputed when a warehouse grows — which is
 *  exactly why presets here store factors and not a remembered split.
 */
function optimalMix(factors, unitSize, whSize, totalFrac) {
  const S = whSize * totalFrac;
  let active = Object.keys(factors).filter((m) => factors[m] > 0 && unitSize[m] > 0);
  for (let guard = 0; guard <= BOOST_MATERIALS.length; guard++) {
    if (!active.length) return null;
    const sumF = active.reduce((a, m) => a + factors[m], 0);
    const sumS = active.reduce((a, m) => a + unitSize[m], 0);
    if (sumF <= 0) return null;
    const lambda = sumF / (S + 500 * sumS);
    const qty = {}, drop = [];
    for (const m of active) {
      const q = factors[m] / (lambda * unitSize[m]) - 500;
      if (q <= 0) drop.push(m); else qty[m] = q;
    }
    if (!drop.length) {
      const mix = {};
      for (const m of active) mix[m] = (qty[m] * unitSize[m]) / whSize;
      return mix;
    }
    active = active.filter((m) => !drop.includes(m));
  }
  return null;
}

/** "realEstate=0.72,hardware=0.2,robots=0.3,aiCores=0.3" -> factors by material name. */
function parseFactors(ns, text) {
  const out = {};
  for (const part of String(text).split(",")) {
    if (!part.trim()) continue;
    const [rawKey, rawVal] = part.split("=");
    const key = String(rawKey || "").trim().toLowerCase();
    const mat = FACTOR_ALIAS[key];
    const val = Number(rawVal);
    if (!mat) {
      ns.tprint(`\nABORT: "${rawKey}" isn't a boost material. Use: ` +
        `realEstate, hardware, robots, aiCores.\n`);
      return null;
    }
    if (!Number.isFinite(val) || val < 0) {
      ns.tprint(`\nABORT: "${rawVal}" isn't a valid factor for ${mat}.\n`);
      return null;
    }
    out[mat] = val;
  }
  if (!Object.keys(out).length) { ns.tprint("\nABORT: --factors was empty.\n"); return null; }
  return out;
}

/** Case- and space-insensitive lookup, so "tobacco" and "Tobacco" both land. */
function findIndustry(key) {
  const want = String(key).trim().toLowerCase().replace(/\s+/g, "");
  return Object.keys(INDUSTRY_FACTORS)
    .find((k) => k.toLowerCase().replace(/\s+/g, "") === want) || null;
}

/** The division's industry, from corp-state.txt. Free — ns.read is 0GB. */
function industryOf(ns, division) {
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (st.industries && st.industries[division]) return st.industries[division];
    }
  } catch (e) { /* fall through */ }
  return null;
}

/** First readable warehouse size in the division — the scale the optimiser solves against. */
function warehouseSize(ns, division, cities) {
  for (const city of cities) {
    try {
      const wh = ns.corporation.getWarehouse(division, city);
      if (wh && wh.size > 0) return wh.size;
    } catch (e) { /* no warehouse in this city */ }
  }
  return 0;
}

function resolveDivision(ns, flagValue) {
  if (flagValue) return flagValue;
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (st.roles && st.roles.material) return st.roles.material;
      if (Array.isArray(st.divisions) && st.divisions.length === 1) return st.divisions[0];
    }
  } catch (e) { /* fall through */ }
  return DIVISION;
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-boost.js — stock boost materials to a target share of the warehouse, then stop (62.6GB).\n" +
    "  run corp-boost.js                     report where you are vs target; spends nothing\n" +
    "  run corp-boost.js --loop              buy to target, clear the rates, exit\n" +
    "  MIX IS WORKED OUT FOR YOU. With the industry known (run corp-status.js once) it solves the\n" +
    "  optimal split of --total space across all four boost materials. No mix string to remember.\n" +
    `  run corp-boost.js --preset Tobacco    force an industry: ${Object.keys(INDUSTRY_FACTORS).join(", ")}\n` +
    "  run corp-boost.js --factors \"realEstate=0.25,hardware=0.2,robots=0.25,aiCores=0.2\"\n" +
    "                                        any other industry — paste its corp-report factors line\n" +
    "  run corp-boost.js --total 0.5         hand 50% of each warehouse to boosts (default 0.40)\n" +
    "  run corp-boost.js --loop --trim       also SELL DOWN if you're over target (at market price)\n" +
    "  run corp-boost.js --clear             panic button: zero every boost buy rate now\n" +
    "  run corp-boost.js --mix \"Real Estate=0.4,Hardware=0.05\"   fractions of warehouse space\n" +
    "  run corp-boost.js --reserve 20e9      keep this much corp cash untouched\n" +
    "  run corp-boost.js --cycles 12         spread the purchase over more cycles\n" +
    "  Targets are a SHARE OF THE WAREHOUSE, never a unit count — that's what keeps it safe when\n" +
    "  you upgrade warehouses. It never spends past your funds, and it only buys while running.\n"
  );
}
