/** @param {NS} ns
 *
 *  CORP — the resident corporation manager. Start it and leave it.
 *
 *      run corp.js                 # keep everything running; spends nothing discretionary
 *      run corp.js --auto          # ...and spend: upgrades, AdVert, research, boost materials
 *      run corp.js --once --dry    # one pass, print every action it WOULD take, change nothing
 *      tail corp.js                # watch it
 *
 *  ONE LOOP, ONE MOMENT PER CYCLE. It sleeps on ns.corporation.nextUpdate(), which resolves with
 *  the name of the state that was JUST processed [SRC v3.0.1: Corporation.ts:181]. Everything
 *  happens right after SALE — i.e. before the next START and PURCHASE — so job changes land at
 *  START, buy rates are in place for PURCHASE, and last cycle's production/sales numbers are
 *  complete when we read them. (The old conductor couldn't know this and acted every tick.)
 *
 *  WHAT IT KEEPS TRUE, every cycle, in every division (each has a --no-X switch):
 *    staff    every seat filled; job mix per corp-config.txt (set it with corp-do.js jobs),
 *             "auto" = product mix / export-only mix / even spread with 2/9 interns in 9+ offices
 *    morale   tea and parties only where an office is below 99.5 (the 10/10 floor is 1% output)
 *    sell     a sell order on every produced material (the default is none: $0.00/s)
 *    supply   the game's Smart Supply switched ON wherever the unlock is owned; otherwise the
 *             custom feedback controller sizes input purchases so warehouses never jam
 *    product  one product always in development; finished ones priced (Market-TA.II if
 *             researched, otherwise the clearing-price hunt); retiring one needs --rotate
 *    ta       the Market-TA.II flag on every produced material and product — researching it
 *             does nothing until the per-item flag is set, and new products arrive with it OFF
 *    advert   at least 2 AdVerts in every division (~$2b). Not optional: at awareness 0 the game
 *             multiplies all sales by 0.02, and that is the one spend it makes without --auto
 *
 *  WHAT IT SPENDS ONLY WHEN TOLD (--auto turns on the first four):
 *    --auto-upgrade   corporation upgrades (Smart Factories/Storage favoured; Wilson only once AdVert
 *                     pays somewhere) and, with --auto-boost, warehouse levels — half the funds a pass
 *    --auto-advert    AdVert where the industry's advertisingFactor >= 0.1, 20% of funds a pass
 *    --auto-research  research, keeping half of each RP pool (and none right before a product
 *                     finishes — its quality banks the RP at completion)
 *    --auto-boost     boost materials held at --boost-total of each warehouse, re-solved per
 *                     city every cycle (so Smart Storage can't quietly dilute them), capped by funds
 *    --auto-bribe F   funds -> faction F's reputation once valuation clears the bribe threshold
 *
 *  WHAT IT NEVER DOES: accept an investment offer, go public, sell shares, discontinue a product
 *  without --rotate. Those are one-way and live in corp-do.js behind --yes.
 *
 *  RAM: ~495GB (32 charged corporation functions, counted from the v3.0.1 cost table; check with
 *  `mem corp.js`). The whole corporation API would be 961.6GB, under the 1024GB per-script cap.
 *  That is the deliberate trade of the 2026-09 rewrite — see corp-design.md. On a small home
 *  (a fresh BitNode) use the archived low-RAM rig in archive/ instead.
 *
 *  Stopping it zeroes the boost buy rates and trim sell orders it set, so nothing runs away.
 *  Input buy rates from the custom supply controller DO stay standing — switch Smart Supply on.
 */
import {
  STATE_NAMES, BOOST_MATERIALS, fmt, short, round, isZero, clamp01, sameName, readConfig, parseMoney,
  mixForJobs, jobsMatch, autoJobPolicy, assignJobs, fillOffice, boostFactors, boostTargets,
  supplyPlan, priceStep, nextProductName,
} from "corp-lib.js";

// ---- Tuning (flags where it matters) ---------------------------------------
const MORALE_TARGET = 99.5;
const PARTY = [[20, 5e6], [5, 1e6], [0, 200e3]];  // [morale gap above, $/employee]; mult = 1 + cost/10e6
const TA_EVERY = 10;                 // cycles between Market-TA.II re-asserts (plus on any new product)
const SPEND_EVERY = 10;              // cycles between spend passes...
const SPEND_FLOOR_MS = 60e3;         // ...and never more often than this (bonus time makes a cycle 1s)
const BANNER_FLOOR_MS = 300e3;       // terminal banner at most every 5 minutes
const BOOST_TOTAL = 0.40;            // share of each warehouse held in boost materials
const BOOST_MAX = 0.60;              // refuse to run above this — inputs and outputs need room
const BOOST_TOL = 0.02;              // TRIM only above this share over target (selling back costs money)...
const BOOST_BUY_TOL = 0.005;         // ...but BUY below this. Per-material 2% let four materials each sit
                                     // "within tolerance" and the total run 5% short (live, 2026-09-28).
const BOOST_SPREAD = 3;              // buy a shortfall over this many cycles, not in one hit
const UPGRADE_FRAC = 0.5, UPGRADE_PRIORITY = ["Wilson Analytics"], UPGRADE_PRIORITY_FRAC = 0.34;
// Upgrades are bought cheapest-first by PRICE x WEIGHT. Plain cheapest-first was wrong in the
// field (2026-09-27, round 1): the four $1b employee-stat upgrades soaked up the whole pass and
// Smart Factories / Smart Storage ($2b base) — the two that matter most early — got nothing.
// A weight of 0.4 means "worth buying at up to 2.5x the price of a weight-1 upgrade".
const UPGRADE_WEIGHT = { "Smart Factories": 0.4, "Smart Storage": 0.4, "DreamSense": 3 };
const ADVERT_FRAC = 0.2, ADVERT_MIN_FACTOR = 0.1;
// EVERY division needs a couple of AdVerts, whatever its advertisingFactor. With awareness 0 the
// sales multiplier is (0.01)^0.85 = 0.02 [SRC: Division.ts:1035] — a 50x penalty on everything it
// sells. Found live 2026-09-27: Agriculture producing 20+/s per city and selling 5, warehouses
// filling with unsold Food and Plants. The factor filter below is for BUYING MORE, not this floor.
const ADVERT_FLOOR = 2;
// The RP POOL IS QUALITY, in every kind of division, so research spends it sparingly:
//   materials: tempQlt = Engineer/90 + researchPoints^researchFactor + ... [SRC: Division.ts:679]
//              (live 2026-09-28: Chemical spent 17.5k -> 1.3k RP, Chemicals quality ~1100 -> 234)
//   products:  rating x (1 + researchPoints^researchFactor / 800), banked AT COMPLETION
//              (live 2026-09-29: Capacity.I took Tobacco 20k -> ~1k RP and the next product
//              finished at rating 2520 against its predecessors' 3700 and 4443)
// With --rotate a product is ALWAYS in development, so a big spend always lands on one.
const RESEARCH_KEEP = 0.8;           // ordinary research never takes the pool below 80%
const RESEARCH_KEEP_MUST = 0.5;      // the RESEARCH_MUST list may dip to 50%, never further
const RESEARCH_HOLD_AT = 90;         // ...and not at all while a product is past this % developed
const RESEARCH_PRIORITY = ["Hi-Tech R&D Laboratory", "Market-TA.I", "Market-TA.II",
  "uPgrade: Capacity.I", "uPgrade: Capacity.II", "AutoBrew", "AutoPartyManager"];
// These may spend the pool down to RESEARCH_KEEP_MUST (still never inside the product-completion
// hold): pricing and product slots are worth more than the quality the RP would otherwise add —
// but not worth zeroing it. TA.II at 50k therefore waits for a ~100k pool. The two
// Market-TA researches only count — and are only bought at all — in a division that SELLS on the
// market: an export-only support division has nothing for them to price (that is exactly how
// Chemical burned 20k RP on TA.I).
const RESEARCH_MUST = ["Hi-Tech R&D Laboratory", "Market-TA.I", "Market-TA.II", "uPgrade: Capacity.I"];
const MARKET_TA = ["Market-TA.I", "Market-TA.II"];
const BRIBE_FRAC = 0.5;
const DESIGN_FRAC = 0.01, MIN_INVEST = 1e9, MAX_INVEST = 1e12;   // product investment (^0.1 — barely matters)
const PRICE_FILE = "corp-product-price.txt";
const TA2 = "Market-TA.II";
// TA.I prices at exactly cost + markupLimit — the top of the sale formula's free band, i.e. the
// best price when sales CAPACITY is the limit. TA.II does that and more (it prices above the band
// when capacity exceeds production), so TA.I flags are only set where TA.II isn't researched.
const TA1 = "Market-TA.I";
const SS_OPTION = "leftovers";       // field-corrected: "imports" deadlocks export-fed divisions
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["dry", false], ["once", false], ["quiet", false], ["help", false],
    ["no-staff", false], ["no-morale", false], ["no-sell", false], ["no-supply", false],
    ["no-product", false], ["no-ta", false], ["rotate", false],
    ["auto", false], ["auto-upgrade", false], ["auto-advert", false], ["auto-research", false],
    ["auto-boost", false], ["auto-bribe", ""], ["trim", false],
    ["boost-total", BOOST_TOTAL], ["reserve", "0"], ["spend-every", SPEND_EVERY],
  ]);
  if (opts.help) { printHelp(ns); return; }
  // "80b", "5t", "2.5e12". A NUMBER default made ns.flags turn "80b" into NaN, and NaN spendable
  // fed a NaN buy rate to buyMaterial (live, 2026-09-28). Parse it ourselves and refuse junk.
  opts.reserve = parseMoney(String(opts.reserve), 0);
  if (!(opts.reserve >= 0)) { ns.tprint(`corp: --reserve must be an amount like 80b or 5t.`); return; }
  if (opts.auto) for (const k of ["auto-upgrade", "auto-advert", "auto-research", "auto-boost"]) opts[k] = true;
  if (!(opts["boost-total"] > 0 && opts["boost-total"] <= BOOST_MAX)) {
    ns.tprint(`corp: --boost-total must be in (0, ${BOOST_MAX}].`); return;
  }

  if (!ns.corporation.hasCorporation()) {
    ns.tprint("\ncorp: no corporation yet.  run corp-do.js create   (then corp-do.js expand Agriculture)\n");
    return;
  }
  if (!opts.once && ns.ps("home").some((p) => p.filename === ns.getScriptName() && p.pid !== ns.pid)) {
    ns.tprint("corp: already running."); return;
  }

  const K = ns.corporation.getConstants();
  const unitSize = {};
  for (const mat of K.materialNames) {
    try { unitSize[mat] = ns.corporation.getMaterialData(mat).size; } catch (e) { unitSize[mat] = 0; }
  }
  const mem = {
    K, unitSize, cities: Object.values(ns.enums.CityName),
    cycleSeconds: K.secondsPerMarketCycle || 10,
    ind: {},                               // industry -> getIndustryData, cached
    price: loadJson(ns, PRICE_FILE),       // product pricing state, survives restarts
    boostRates: new Set(),                 // "div|city|mat" with a nonzero boost buy rate we set
    trimming: new Set(),                   // "div|city|mat" with a trim sell order we set
    taSeen: {},                            // division -> finished-product list at last TA pass
    said: new Set(),                       // standing conditions already reported once
    cycle: 0, lastSpendCycle: -Infinity, lastSpendMs: 0, lastBanner: 0, lastWarn: "",
  };

  if (!opts.dry) {
    ns.atExit(() => {
      for (const key of mem.boostRates) {
        const [d, c, m] = key.split("|");
        try { ns.corporation.buyMaterial(d, c, m, 0); } catch (e) { /* division gone */ }
      }
      for (const key of mem.trimming) {
        const [d, c, m] = key.split("|");
        try { ns.corporation.sellMaterial(d, c, m, "0", "MP"); } catch (e) { /* division gone */ }
      }
      saveJson(ns, PRICE_FILE, mem.price);
    });
  }

  const spending = ["auto-upgrade", "auto-advert", "auto-research", "auto-boost"].filter((k) => opts[k])
    .map((k) => k.slice(5)).concat(opts["auto-bribe"] ? [`bribe:${opts["auto-bribe"]}`] : []);
  ns.tprint(`corp: up${opts.dry ? " (DRY RUN)" : ""}. Spending: ${spending.join(", ") || "OFF (add --auto)"}.` +
    `${opts.rotate ? " Product rotation ON." : ""}  tail corp.js to watch.`);

  const lastState = (K.stateNames && K.stateNames[K.stateNames.length - 1]) || STATE_NAMES[4];
  if (opts.once) { tick(ns, opts, mem); return; }
  for (;;) {
    let state;
    try { state = await ns.corporation.nextUpdate(); }
    catch (e) { await ns.sleep(1000); continue; }
    if (state !== lastState) continue;
    try { tick(ns, opts, mem); }
    catch (e) { ns.print(`TICK FAILED: ${short(e, 300)}`); }
  }
}

// =============================== the tick ===================================

function tick(ns, opts, mem) {
  mem.cycle++;
  const corp = ns.corporation.getCorporation();
  const ctx = {
    ns, opts, mem, corp, cfg: readConfig(ns),
    spendable: Math.max(0, corp.funds - Number(opts.reserve)),
    hasSmartSupply: safe(() => ns.corporation.hasUnlock("Smart Supply"), false),
    counts: {}, notes: [], warns: [], divs: [],
  };

  const fillers = new Set((ctx.cfg.filler || []).map(String));
  for (const name of corp.divisions) {
    // VALUATION FILLER (corp-do.js filler DIV): the division exists only for its offices and
    // warehouses — valuation x1.008 each [Corporation.ts:208-217] — so manage NOTHING in it. Left
    // in the loop, the first filler (Restaurant, 2026-09-29) got boost stock, warehouse levels and
    // 12 AdVerts, none of which moves that count. It also isn't in ctx.divs, so no spend step sees it.
    if (fillers.has(name)) { quiesce(ctx, name); continue; }
    let div;
    try { div = snapshot(ctx, name); }
    catch (e) { ctx.warns.push(`${name}: could not read (${short(e)})`); continue; }
    ctx.divs.push(div);
    for (const step of [staff, morale, advertFloor, sellOrders, products, marketTa, supply, boost]) {
      try { step(ctx, div); }
      catch (e) { ctx.notes.push(`${step.name} ${name}: ${short(e)}`); }
    }
    congestion(ctx, div);
  }

  const due = mem.cycle - mem.lastSpendCycle >= Math.max(1, opts["spend-every"]) &&
    Date.now() - mem.lastSpendMs >= SPEND_FLOOR_MS;
  if (due && (opts["auto-research"] || opts["auto-upgrade"] || opts["auto-advert"] || opts["auto-bribe"])) {
    mem.lastSpendCycle = mem.cycle; mem.lastSpendMs = Date.now();
    for (const step of [spendResearch, spendUpgrades, spendAdvert, spendBribe]) {
      try { step(ctx); } catch (e) { ctx.notes.push(`${step.name}: ${short(e)}`); }
    }
  }

  if (!opts.dry) saveJson(ns, PRICE_FILE, mem.price);
  report(ctx);
}

/** Read one division into a plain object: offices, warehouses, the materials it makes and
 *  needs, and its products. Everything the steps below decide on comes from here. */
function snapshot(ctx, name) {
  const { ns, mem } = ctx;
  const d = ns.corporation.getDivision(name);
  if (!mem.ind[d.industry]) mem.ind[d.industry] = ns.corporation.getIndustryData(d.industry);
  const ind = mem.ind[d.industry];
  const required = ind.requiredMaterials || {};
  const produced = ind.producedMaterials || [];
  const div = {
    name, d, ind, required, produced, cities: d.cities,
    office: {}, wh: {}, mats: {}, products: [],
    ta2: safe(() => ns.corporation.hasResearched(name, TA2), false),
    ta1: safe(() => ns.corporation.hasResearched(name, TA1), false),
  };
  for (const city of d.cities) {
    div.office[city] = safe(() => ns.corporation.getOffice(name, city), null);
    div.wh[city] = safe(() => ns.corporation.hasWarehouse(name, city), false)
      ? ns.corporation.getWarehouse(name, city) : null;
    div.mats[city] = {};
    if (!div.wh[city]) continue;
    for (const mat of new Set([...Object.keys(required), ...produced])) {
      div.mats[city][mat] = safe(() => ns.corporation.getMaterial(name, city, mat), null);
    }
  }
  // Does anything leave this division by SALE? Products do; a material does unless it is exported
  // in every city (a pure support division like Chemical). Decides whether Market-TA is worth RP.
  div.sellsToMarket = d.makesProducts || div.produced.some((m) =>
    d.cities.some((c) => div.wh[c] && !((div.mats[c][m]?.exports || []).length)));
  for (const pname of d.products) {
    const p = { name: pname, byCity: {}, progress: 0, rating: 0 };
    for (const city of d.cities) {
      if (!div.wh[city]) continue;
      const x = safe(() => ns.corporation.getProduct(name, city, pname), null);
      if (!x) continue;
      p.progress = x.developmentProgress; p.rating = x.rating;
      p.byCity[city] = {
        stored: x.stored, made: x.productionAmount, sold: x.actualSellAmount,
        unpriced: isZero(x.desiredSellAmount),
      };
    }
    p.finished = p.progress >= 100;
    div.products.push(p);
  }
  return div;
}

/** Stop everything corp.js may have left running in a division it no longer manages: buy rates
 *  are per-SECOND standing orders, so walking away from them would buy forever. Once per run. */
function quiesce(ctx, name) {
  const { ns, mem } = ctx;
  mem.quiesced = mem.quiesced || new Set();
  if (mem.quiesced.has(name)) return;
  mem.quiesced.add(name);
  const d = safe(() => ns.corporation.getDivision(name), null);
  if (!d) return;
  const ind = safe(() => ns.corporation.getIndustryData(d.industry), {});
  const mats = new Set([...Object.keys(ind.requiredMaterials || {}), ...BOOST_MATERIALS]);
  let n = 0;
  if (!ctx.opts.dry) {
    for (const city of d.cities) {
      if (!safe(() => ns.corporation.hasWarehouse(name, city), false)) continue;
      for (const mat of mats) {
        if (safe(() => ns.corporation.getMaterial(name, city, mat).buyAmount, 0) > 0) {
          try { ns.corporation.buyMaterial(name, city, mat, 0); n++; } catch (e) { /* skip */ }
        }
      }
    }
  }
  for (const key of [...mem.boostRates]) if (key.startsWith(`${name}|`)) mem.boostRates.delete(key);
  ctx.notes.push(`${name} is valuation FILLER — not managed${n ? `; zeroed ${n} standing buy order(s)` : ""}`);
}

/** Every action goes through here: counted, noted, skipped under --dry, never fatal.
 *  `landed` re-reads the game for actions that fail SILENTLY on short funds (hireAdVert and
 *  friends just `return` — Actions.ts:398/426/446/454), so a no-op is never reported as done. */
function act(ctx, kind, desc, fn, loud = true, landed = null) {
  ctx.counts[kind] = (ctx.counts[kind] || 0) + 1;
  if (ctx.opts.dry) { if (loud) ctx.notes.push(`[dry] ${desc}`); return true; }
  try {
    const r = fn();
    if (landed && !landed()) { ctx.counts[kind]--; ctx.notes.push(`DID NOT HAPPEN (funds short): ${desc}`); return false; }
    if (loud) ctx.notes.push(desc);
    return r === undefined ? true : r;
  } catch (e) {
    ctx.notes.push(`FAILED ${desc}: ${short(e)}`);
    return false;
  }
}

/** Report a standing condition once, not every cycle. */
function sayOnce(ctx, key, text) {
  if (ctx.mem.said.has(key)) return;
  ctx.mem.said.add(key);
  ctx.notes.push(text);
}

// =============================== keep-true steps ============================

/** Fill every seat, then hold the job mix corp-config.txt asks for. */
function staff(ctx, div) {
  if (ctx.opts["no-staff"]) return;
  const { ns } = ctx;
  const policyRaw = String(ctx.cfg.jobs[div.name] || "auto").toLowerCase();
  for (const city of div.cities) {
    const o = div.office[city];
    if (!o) continue;
    let n = o.numEmployees, hired = 0;
    if (n < o.size) {
      hired = ctx.opts.dry ? o.size - n : fillOffice(ns, div.name, city, o);
      ctx.counts.hire = (ctx.counts.hire || 0) + hired;
      if (hired) ctx.notes.push(`${ctx.opts.dry ? "[dry] would hire" : "hired"} ${hired} in ${div.name}/${city}`);
      n += hired;
    }
    const policy = policyRaw === "auto" ? autoJobPolicy({
      makesProducts: div.d.makesProducts,
      exportsAllOutput: div.produced.length > 0 &&
        div.produced.every((m) => (div.mats[city][m]?.exports || []).length > 0),
    }) : policyRaw;
    if (policy === "hold") continue;
    const target = mixForJobs(policy, n);
    if (!target) { sayOnce(ctx, `jobs|${div.name}|${city}|${policy}|${n}`, `jobs "${policy}" doesn't fit ${div.name}/${city} (${n} staff) — left alone`); continue; }
    if (!hired && jobsMatch(o.employeeJobs, target)) continue;
    act(ctx, "jobs", `jobs ${div.name}/${city} -> ${describeMix(target)}`, () => {
      const err = assignJobs(ns, div.name, city, target);
      if (err) throw new Error(err);
    });
  }
}

/** Tea and parties, only where an office is below target. Output is morale*energy*1e-4. */
function morale(ctx, div) {
  if (ctx.opts["no-morale"]) return;
  const { ns } = ctx;
  for (const city of div.cities) {
    const o = div.office[city];
    if (!o || !o.numEmployees) continue;
    if (o.avgEnergy < Math.min(MORALE_TARGET, o.maxEnergy || 100)) {
      act(ctx, "tea", `tea ${div.name}/${city}`, () => ns.corporation.buyTea(div.name, city), false);
    }
    const gap = Math.min(MORALE_TARGET, o.maxMorale || 100) - o.avgMorale;
    if (gap > 0) {
      const per = PARTY.find(([above]) => gap > above)[1];
      act(ctx, "party", `party ${div.name}/${city}`, () => ns.corporation.throwParty(div.name, city, per), false);
    }
    // Only after it has PERSISTED: job changes land at the next START, so the cycle that grows an
    // office (hire + assign interns) still reads the old mix here — a false alarm the first time
    // it fired live (Chemical/Volhaven, 2026-09-28). Three cycles running is a real shortage.
    const key = `intern|${div.name}|${city}`;
    const lacking = o.numEmployees >= 9 && ((o.employeeJobs || {}).Intern || 0) / o.numEmployees <= 1 / 9;
    ctx.mem.internStrikes = ctx.mem.internStrikes || {};
    ctx.mem.internStrikes[key] = lacking ? (ctx.mem.internStrikes[key] || 0) + 1 : 0;
    if (ctx.mem.internStrikes[key] >= 3) {
      sayOnce(ctx, key, `${div.name}/${city}: 9+ staff and too few interns for 3 cycles — morale will keep ` +
        `decaying. Check its jobs policy in corp-config.txt ("hold" or a custom mix skips the interns).`);
    }
  }
}

/** The awareness-0 sales penalty is 50x; one or two AdVerts end it. Bought whenever affordable. */
function advertFloor(ctx, div) {
  const { ns } = ctx;
  for (let n = div.d.numAdVerts; n < ADVERT_FLOOR; n++) {
    const cost = safe(() => ns.corporation.getHireAdVertCost(div.name), Infinity);
    if (cost > ctx.corp.funds) {
      sayOnce(ctx, `advfloor|${div.name}|${n}`, `${div.name}: needs AdVert #${n + 1} ($${fmt(ns, cost)}) — ` +
        `sales run at ~2% of capacity until awareness is above 0; waiting for funds`);
      return;
    }
    if (!act(ctx, "advert", `AdVert #${n + 1} for ${div.name} (awareness 0 = sales x0.02)`,
      () => ns.corporation.hireAdVert(div.name), true,
      () => ns.corporation.getHireAdVertCount(div.name) > n)) return;
    ctx.spendable = Math.max(0, ctx.spendable - cost);
  }
}

/** A sell order on every produced material that has none. The game's default sell amount is
 *  ZERO — a fully working division earns exactly $0.00/s without this. Exported materials get
 *  one too: EXPORT runs before SALE, so "MAX" only sells what the export left behind — and
 *  without it that leftover piles up until the warehouse jams. */
function sellOrders(ctx, div) {
  if (ctx.opts["no-sell"]) return;
  for (const city of div.cities) {
    for (const mat of div.produced) {
      const m = div.mats[city][mat];
      if (!m || !isZero(m.desiredSellAmount)) continue;
      act(ctx, "sell", `sell order ${div.name}/${city} ${mat} MAX@MP`,
        () => ctx.ns.corporation.sellMaterial(div.name, city, mat, "MAX", "MP"));
    }
  }
}

/** Keep one product in development, price the finished ones, rotate only with --rotate. */
function products(ctx, div) {
  if (ctx.opts["no-product"] || !div.d.makesProducts) return;
  const { ns, mem } = ctx;
  const finished = div.products.filter((p) => p.finished);
  const developing = div.products.filter((p) => !p.finished);

  // ---- price what's finished ----
  const stuck = new Set();
  for (const p of finished) {
    for (const [city, c] of Object.entries(p.byCity)) {
      if (div.ta2) {
        // TA.II sets the price itself; we only need the order to exist. (TA.I is deliberately NOT
        // used for products: it prices at exactly cost + markupLimit, the top of the free band, and
        // stops there. When a product sells out — demand above production, live 2026-09-28 — the
        // right price is ABOVE the band, which TA.II and the hunt below both find and TA.I can't.)
        if (c.unpriced) act(ctx, "sell", `sell order ${div.name}/${city} ${p.name} MAX@MP (TA.II prices it)`,
          () => ns.corporation.sellProduct(div.name, city, p.name, "MAX", "MP", false));
        continue;
      }
      const id = `${div.name}|${p.name}|${city}`;
      const prev = mem.price[id] || {};
      const next = priceStep(prev, c);
      if (next.stuck >= 8) stuck.add(p.name);
      mem.price[id] = { ...next, str: prev.str };
      if (next.str === prev.str && !c.unpriced) continue;
      if (act(ctx, "price", `${id} -> ${next.str}`,
        () => ns.corporation.sellProduct(div.name, city, p.name, "MAX", next.str, false), false)) {
        mem.price[id].str = next.str;
      }
    }
  }
  for (const name of stuck) {
    sayOnce(ctx, `stuck|${div.name}|${name}`, `${div.name}/${name} won't clear even at cost — obsolete. ` +
      `${ctx.opts.rotate ? "It will be rotated out when the cap is hit." : "Retire it with --rotate."}`);
  }

  // ---- keep something in development ----
  if (developing.length) return;
  const atCap = div.products.length >= div.d.maxProducts;
  if (atCap) {
    const worst = finished.slice().sort((a, b) => a.rating - b.rating)[0];
    if (!ctx.opts.rotate || !worst) {
      sayOnce(ctx, `cap|${div.name}|${div.products.length}`, `${div.name}: at the ${div.d.maxProducts}-product cap, ` +
        `nothing developing. Restart with --rotate to retire the weakest (${worst ? worst.name : "?"}), ` +
        `or: run corp-do.js research ${div.name} "uPgrade: Capacity.I"`);
      return;
    }
    act(ctx, "rotate", `DISCONTINUED ${div.name}/${worst.name} (rating ${round(worst.rating)})`,
      () => ns.corporation.discontinueProduct(div.name, worst.name));
    return;   // the replacement starts next cycle, from a fresh read
  }
  const invest = Math.max(MIN_INVEST, Math.min(MAX_INVEST, ctx.corp.funds * DESIGN_FRAC));
  if (ctx.corp.funds < 2 * invest) {
    sayOnce(ctx, `nofunds|${div.name}`, `${div.name}: can't start a product — funds $${fmt(ns, ctx.corp.funds)}`);
    return;
  }
  const city = div.cities.includes("Sector-12") ? "Sector-12" : div.cities[0];
  const name = nextProductName(div.products.map((p) => p.name));
  if (act(ctx, "product", `STARTED ${div.name}/${name} (design + marketing $${fmt(ns, invest)} each)`,
    () => ns.corporation.makeProduct(div.name, city, name, invest, invest))) {
    ctx.spendable = Math.max(0, ctx.spendable - 2 * invest);
    mem.said.delete(`nofunds|${div.name}`);
  }
}

/** Market-TA.II (or TA.I, until II is researched) is a research AND a per-item flag that
 *  defaults to off. */
function marketTa(ctx, div) {
  if (ctx.opts["no-ta"] || !(div.ta2 || div.ta1)) return;
  const two = div.ta2;
  const { ns, mem } = ctx;
  const finished = div.products.filter((p) => p.finished).map((p) => p.name);
  const key = `v2:${two ? 2 : 1}:${finished.join(",")}`;   // TA.I -> TA.II counts as a change too
  if (mem.taSeen[div.name] === key && mem.cycle % TA_EVERY !== 1) return;
  let n = 0;
  act(ctx, "ta", two ? `Market-TA.II on for ${div.name}` :
    `Market-TA.I on for ${div.name}'s materials${finished.length ? " (off for products — the price hunt beats it)" : ""}`, () => {
    for (const city of div.cities) {
      if (!div.wh[city]) continue;
      for (const mat of div.produced) {
        if (two) ns.corporation.setMaterialMarketTA2(div.name, city, mat, true);
        else ns.corporation.setMaterialMarketTA1(div.name, city, mat, true);
        n++;
      }
    }
    for (const p of finished) {
      // TA.I OFF for products (see products()): the price hunt beats it once demand exceeds supply.
      if (two) ns.corporation.setProductMarketTA2(div.name, p, true);
      else ns.corporation.setProductMarketTA1(div.name, p, false);
      n++;
    }
  }, mem.taSeen[div.name] !== key);   // loud only when something new got a flag
  mem.taSeen[div.name] = key;
}

/** Inputs: the game's Smart Supply if the unlock is owned, else the custom controller. */
function supply(ctx, div) {
  if (ctx.opts["no-supply"]) return;
  const { ns, mem } = ctx;
  const inputs = Object.keys(div.required);
  if (!inputs.length) return;
  for (const city of div.cities) {
    const wh = div.wh[city];
    if (!wh) continue;
    if (ctx.hasSmartSupply) {
      // The unlock does nothing until it is switched on per warehouse. Smart Supply overwrites
      // the manual buy rate of every input it manages [SRC: Division.ts:497-499], so there is
      // nothing to clean up when switching over.
      if (!wh.smartSupplyEnabled) {
        act(ctx, "smartsupply", `Smart Supply ON ${div.name}/${city} (${SS_OPTION})`, () => {
          ns.corporation.setSmartSupply(div.name, city, true);
          for (const mat of inputs) ns.corporation.setSmartSupplyOption(div.name, city, mat, SS_OPTION);
        });
      }
      continue;
    }
    if (wh.smartSupplyEnabled) continue;
    const m = div.mats[city];
    let prod = 0;
    for (const out of div.produced) prod = Math.max(prod, m[out]?.productionAmount || 0);
    for (const p of div.products) prod += p.byCity[city]?.made || 0;
    const plan = supplyPlan({
      prod, size: wh.size, used: wh.sizeUsed,
      stored: Object.fromEntries(inputs.map((x) => [x, m[x]?.stored || 0])),
      imported: Object.fromEntries(inputs.map((x) => [x, m[x]?.importAmount || 0])),
      ratios: div.required, unitSize: mem.unitSize, cycleSeconds: mem.cycleSeconds,
    });
    for (const mat of inputs) {
      const rate = plan.rates[mat] || 0;
      if (Math.abs((m[mat]?.buyAmount || 0) - rate) < 1e-4) continue;
      act(ctx, "buy", `buy ${div.name}/${city} ${mat} ${rate}/s`,
        () => ns.corporation.buyMaterial(div.name, city, mat, rate), false);
    }
  }
}

/** Boost materials held at a share of each warehouse, re-solved per city every cycle. Only
 *  buys while this script is alive (rates are per-second and would otherwise run forever),
 *  and only within the funds this cycle has left. */
function boost(ctx, div) {
  const { ns, mem, opts } = ctx;
  // RECONCILE AGAINST THE GAME, NOT OUR MEMORY. A buy rate is a standing per-second order stored in
  // the SAVE; mem.boostRates is only this process's memory of it. atExit cleans up on a kill, but a
  // game close/reload restarts corp.js with an empty memory while the old orders keep buying — which
  // is exactly how Chemical/Sector-12, Aevum and Chongqing filled to 100% with Real Estate and Robots
  // (live 2026-09-29), halted, and dragged Agriculture's and Tobacco's quality down with them. So
  // every boost order the game holds that we are not deliberately placing THIS cycle is zeroed, and
  // any sell order on a boost material that isn't a live trim is cleared. Even without --auto-boost.
  if (!opts["auto-boost"]) {
    for (const city of div.cities) {
      if (!div.wh[city]) continue;
      for (const mat of BOOST_MATERIALS) {
        if (mat in div.required || div.produced.includes(mat)) continue;
        const m = safe(() => ns.corporation.getMaterial(div.name, city, mat), null);
        if (m && (m.buyAmount || 0) > 0) {
          act(ctx, "boost", `STALE boost order ${div.name}/${city} ${mat} ${round(m.buyAmount)}/s -> 0`,
            () => ns.corporation.buyMaterial(div.name, city, mat, 0));
        }
      }
    }
    return;
  }
  const total = Number(opts["boost-total"]);
  // A boost material the industry also consumes or makes (Real Estate industry, Robotics...)
  // belongs to supply and sales, not here — two controllers on one rate would fight.
  const factors = boostFactors(div.ind);
  for (const mat of BOOST_MATERIALS) {
    if (mat in div.required || div.produced.includes(mat)) delete factors[mat];
  }
  const buys = [], trims = new Set(), stale = [];
  let cost = 0;
  for (const city of div.cities) {
    const wh = div.wh[city];
    if (!wh || !wh.size) continue;
    const targets = boostTargets(factors, mem.unitSize, wh.size, total) || {};
    let free = Math.max(0, wh.size - wh.sizeUsed) * 0.9;
    for (const mat of Object.keys(factors)) {
      const m = safe(() => ns.corporation.getMaterial(div.name, city, mat), null);
      if (!m) continue;
      const unit = mem.unitSize[mat];
      const gap = (targets[mat] || 0) - (m.stored * unit) / wh.size;
      const key = `${div.name}|${city}|${mat}`;
      // A nearly-full warehouse halts production, so over-target boost stock there is trimmed
      // whether or not --trim is on (at market price — never a price-0 dump).
      const jammed = wh.sizeUsed / wh.size >= 0.9;
      if (gap > BOOST_BUY_TOL) {
        const units = Math.min(gap * wh.size, free) / unit;
        free -= units * unit;
        buys.push({ city, mat, key, units, had: m.buyAmount || 0 });
        cost += units * (m.marketPrice || 0);
      } else if ((m.buyAmount || 0) > 0) {
        stale.push({ city, mat, key, rate: m.buyAmount });   // an order we are NOT placing now
      }
      if (!(gap < -BOOST_TOL && (opts.trim || jammed)) && !isZero(m.desiredSellAmount) && !mem.trimming.has(key)) {
        act(ctx, "trim", `STALE sell order ${key} cleared`,
          () => ns.corporation.sellMaterial(div.name, city, mat, "0", "MP"));
      }
      if (gap < -BOOST_TOL && (opts.trim || jammed)) {
        const excess = (-gap * wh.size) / unit;
        trims.add(key);
        act(ctx, "trim", `trim ${key} ${round(excess, 0)} units @MP`,
          () => ns.corporation.sellMaterial(div.name, city, mat, String(round(excess / mem.cycleSeconds, 3)), "MP"), false);
        mem.trimming.add(key);
      }
    }
  }
  // Stop trims that reached target (a standing MAX-ish sell order would eat the whole stock).
  for (const key of [...mem.trimming]) {
    if (!key.startsWith(`${div.name}|`) || trims.has(key)) continue;
    const [, city, mat] = key.split("|");
    act(ctx, "trim", `trim done ${key}`, () => ns.corporation.sellMaterial(div.name, city, mat, "0", "MP"), false);
    mem.trimming.delete(key);
  }

  const scale = cost > 0 ? Math.min(1, ctx.spendable / cost) : 1;
  ctx.spendable = Math.max(0, ctx.spendable - cost * scale);
  if (cost > 0 && scale < 1) {
    const heldBack = Number(opts.reserve) > 0 && ctx.corp.funds < Number(opts.reserve) + cost;
    sayOnce(ctx, `boostcap|${div.name}|${mem.cycle >> 6}`,
      `${div.name}: boost shortfall $${fmt(ns, cost)}, funds cover ${round(100 * scale, 0)}% this cycle` +
      (heldBack ? ` — held back by --reserve $${fmt(ns, Number(opts.reserve))}; resumes when funds pass ` +
        `$${fmt(ns, Number(opts.reserve) + cost)}` : ""));
  }
  for (const s of stale) {
    // Ours from last cycle, now at target: close it quietly. Anything else is inherited: say so.
    const ours = mem.boostRates.has(s.key);
    act(ctx, "boost", ours ? `boost ${s.key} at target` : `STALE boost order ${s.key} ${round(s.rate)}/s -> 0`,
      () => ns.corporation.buyMaterial(div.name, s.city, s.mat, 0), !ours);
    mem.boostRates.delete(s.key);
  }
  const wanted = new Set();
  for (const b of buys) {
    const rate = Math.round((b.units * scale / (mem.cycleSeconds * BOOST_SPREAD)) * 1e4) / 1e4;
    if (!(rate > 0)) {           // also catches NaN — never hand buyMaterial a non-number...
      // ...and a shortfall we can't afford (or have no room for) this cycle must not leave an
      // inherited order running either.
      if (b.had > 0) act(ctx, "boost", `boost ${b.key} paused (no funds/room) -> 0`,
        () => ns.corporation.buyMaterial(div.name, b.city, b.mat, 0), false);
      mem.boostRates.delete(b.key);
      continue;
    }
    wanted.add(b.key);
    act(ctx, "boost", `boost ${b.key} ${rate}/s`, () => ns.corporation.buyMaterial(div.name, b.city, b.mat, rate), false);
    mem.boostRates.add(b.key);
  }
  for (const key of [...mem.boostRates]) {
    if (!key.startsWith(`${div.name}|`) || wanted.has(key)) continue;
    const [, city, mat] = key.split("|");
    act(ctx, "boost", `boost ${key} at target`, () => ns.corporation.buyMaterial(div.name, city, mat, 0), false);
    mem.boostRates.delete(key);
  }
}

/** Warehouse full and making nothing: the silent production halt. Reported, never auto-dumped
 *  (dumping boost material by mistake is expensive — see the $100b story in corp-design.md). */
function congestion(ctx, div) {
  for (const city of div.cities) {
    const wh = div.wh[city];
    if (!wh || !wh.size || wh.sizeUsed / wh.size < 0.97) continue;
    const making = div.produced.some((m) => (div.mats[city][m]?.productionAmount || 0) > 0) ||
      div.products.some((p) => (p.byCity[city]?.made || 0) > 0);
    if (!making) ctx.warns.push(`CONGESTED ${div.name}/${city} — warehouse ${round(100 * wh.sizeUsed / wh.size, 0)}% full, producing nothing`);
  }
}

// =============================== spend steps ================================

function spendResearch(ctx) {
  if (!ctx.opts["auto-research"]) return;
  const { ns, mem } = ctx;
  const names = mem.K.researchNames || [];
  for (const div of ctx.divs) {
    // sciMult is BANKED into a product at completion — draining RP just before is permanent.
    if (div.products.some((p) => !p.finished && p.progress >= RESEARCH_HOLD_AT)) continue;
    let pool = Number(div.d.researchPoints) || 0;
    const floor = pool * RESEARCH_KEEP, mustFloor = pool * RESEARCH_KEEP_MUST;
    const avail = [];
    for (const r of names) {
      if (safe(() => ns.corporation.hasResearched(div.name, r), true)) continue;
      const c = safe(() => ns.corporation.getResearchCost(div.name, r), NaN);
      if (Number.isFinite(c)) avail.push({ r, c });
    }
    avail.sort((a, b) => a.c - b.c);
    const queue = [...RESEARCH_PRIORITY.map((p) => avail.find((a) => sameName(a.r, p))).filter(Boolean), ...avail];
    const done = new Set();
    for (const { r, c } of queue) {
      const isTa = MARKET_TA.some((m) => sameName(m, r));
      if (isTa && !div.sellsToMarket) continue;       // nothing here for it to price
      const must = RESEARCH_MUST.some((m) => sameName(m, r));
      if (done.has(r) || pool - c < (must ? mustFloor : floor)) continue;
      done.add(r);
      ctx.counts.research = (ctx.counts.research || 0) + 1;
      if (ctx.opts.dry) { ctx.notes.push(`[dry] research ${div.name}: ${r} (${fmt(ns, c)} RP)`); pool -= c; continue; }
      // Not act(): a missing prerequisite throws, and would otherwise log FAILED every pass.
      try { ns.corporation.research(div.name, r); pool -= c; ctx.notes.push(`research ${div.name}: ${r} (${fmt(ns, c)} RP)`); }
      catch (e) { ctx.counts.research--; }
    }
  }
}

function spendUpgrades(ctx) {
  if (!ctx.opts["auto-upgrade"]) return;
  const { ns, mem } = ctx;
  let left = ctx.spendable * UPGRADE_FRAC;
  const rows = [];
  for (const name of mem.K.upgradeNames || []) {
    const cost = safe(() => ns.corporation.getUpgradeLevelCost(name), NaN);
    if (Number.isFinite(cost)) rows.push({ name, cost, n: 0 });
  }
  // WAREHOUSE LEVELS compete here too, because they and Smart Storage buy the same thing: room for
  // boost materials (and so production). Found live 2026-09-27: --auto never bought a warehouse
  // level, every warehouse sat at L1 (110 space) and boost capped at 42 units of space per city.
  // Ranked by space bought per dollar, scaled so Smart Storage keeps its 0.4 weight:
  //   Smart Storage adds 0.1/(1 + 0.1*level) to EVERY warehouse [size = level*100*(1+0.1*SS)]
  //   a warehouse level adds 1/level to ONE warehouse, i.e. (1/level)/N of the total
  // At L1 a level doubles that city for ~$1.1b, so early on it wins easily; by L4-5 they trade off.
  // Only with --auto-boost: without boost material to put in it, extra space earns nothing.
  if (ctx.opts["auto-boost"]) {
    const gSS = 0.1 / (1 + 0.1 * safe(() => ns.corporation.getUpgradeLevel("Smart Storage"), 0));
    const whs = [];
    for (const d of ctx.divs) for (const city of d.cities) if (d.wh[city]) whs.push({ div: d.name, city, level: d.wh[city].level });
    for (const w of whs) {
      rows.push({
        name: `warehouse ${w.div}/${w.city}`, wh: w, n: 0,
        cost: safe(() => ns.corporation.getUpgradeWarehouseCost(w.div, w.city, 1), Infinity),
        scale: () => (0.4 * gSS) / ((1 / w.level) / whs.length),
      });
    }
  }
  let spent = 0;
  const take = (r) => {
    const price = r.cost;
    if (r.wh) {
      const { div, city } = r.wh, was = r.wh.level;
      if (!act(ctx, "upgrade", `warehouse ${div}/${city} L${was + 1}`,
        () => ns.corporation.upgradeWarehouse(div, city, 1), false,
        () => ns.corporation.getWarehouse(div, city).level > was)) return 0;   // silent on short funds
      r.wh.level++;
      r.cost = ctx.opts.dry ? Infinity : safe(() => ns.corporation.getUpgradeWarehouseCost(div, city, 1), Infinity);
    } else {
      if (!act(ctx, "upgrade", `upgrade ${r.name}`, () => ns.corporation.levelUpgrade(r.name), false)) return 0;
      r.cost = ctx.opts.dry ? Infinity : safe(() => ns.corporation.getUpgradeLevelCost(r.name), Infinity);
    }
    r.n++; spent += price; left -= price;
    return price;
  };
  // Wilson only multiplies AdVert, so it is worth nothing until some division would buy AdVert
  // (advertisingFactor >= ADVERT_MIN_FACTOR — Tobacco yes, Agriculture's 0.04 no). Round 1 paid
  // $4b for it with no such division. Until then it is off the list entirely.
  const advertWorthy = ctx.divs.some((d) => (Number(d.ind.advertisingFactor) || 0) >= ADVERT_MIN_FACTOR);
  if (!advertWorthy) {
    for (let i = rows.length - 1; i >= 0; i--) if (UPGRADE_PRIORITY.some((p) => sameName(p, rows[i].name))) rows.splice(i, 1);
  }
  // Wilson doubles per level, so cheapest-first would never buy it. First refusal, capped at a
  // slice of the budget — but the FIRST level ignores the cap, or the cap becomes a ban
  // (Wilson at $4.1t vs a $2t slice sat unbought forever; corp-design.md).
  let slice = left * UPGRADE_PRIORITY_FRAC;
  for (const want of advertWorthy ? UPGRADE_PRIORITY : []) {
    const r = rows.find((x) => sameName(x.name, want));
    let allowance = r ? Math.max(slice, r.cost) : 0;
    while (r && r.cost <= allowance && r.cost <= left) {
      const paid = take(r);
      if (!paid) break;
      slice = Math.max(0, slice - paid); allowance = slice;
    }
  }
  for (let steps = 0; steps < 400; steps++) {
    const w = (x) => x.cost * (x.scale ? x.scale() : (UPGRADE_WEIGHT[x.name] ?? 1));
    const r = rows.filter((x) => x.cost <= left).sort((a, b) => w(a) - w(b))[0];
    if (!r || !take(r)) break;
  }
  ctx.spendable = Math.max(0, ctx.spendable - spent);
  const whLevels = rows.filter((r) => r.wh && r.n).reduce((a, r) => a + r.n, 0);
  const bought = rows.filter((r) => r.n && !r.wh).map((r) => `${r.name} +${r.n}`)
    .concat(whLevels ? [`warehouse levels +${whLevels}`] : []);
  if (bought.length) ctx.notes.push(`upgrades $${fmt(ns, spent)}: ${bought.join(", ")}`);
}

function spendAdvert(ctx) {
  if (!ctx.opts["auto-advert"]) return;
  const { ns } = ctx;
  let left = ctx.spendable * ADVERT_FRAC, spent = 0;
  const rows = ctx.divs.filter((d) => (Number(d.ind.advertisingFactor) || 0) >= ADVERT_MIN_FACTOR)
    .map((d) => ({ name: d.name, cost: safe(() => ns.corporation.getHireAdVertCost(d.name), Infinity), n: 0 }));
  for (let steps = 0; steps < 200; steps++) {
    const r = rows.filter((x) => x.cost <= left).sort((a, b) => a.cost - b.cost)[0];
    if (!r) break;
    const price = r.cost;
    const had = safe(() => ns.corporation.getHireAdVertCount(r.name), -1);
    if (!act(ctx, "advert", `AdVert ${r.name}`, () => ns.corporation.hireAdVert(r.name), false,
      () => ns.corporation.getHireAdVertCount(r.name) > had)) break;
    r.cost = ctx.opts.dry ? Infinity : safe(() => ns.corporation.getHireAdVertCost(r.name), Infinity);
    r.n++; left -= price; spent += price;
  }
  ctx.spendable = Math.max(0, ctx.spendable - spent);
  const bought = rows.filter((r) => r.n).map((r) => `${r.name} +${r.n}`);
  if (bought.length) ctx.notes.push(`AdVert $${fmt(ns, spent)}: ${bought.join(", ")}`);
}

function spendBribe(ctx) {
  const faction = String(ctx.opts["auto-bribe"] || "").trim();
  if (!faction) return;
  const { ns, mem } = ctx;
  if (ctx.corp.valuation < mem.K.bribeThreshold) {
    sayOnce(ctx, "bribe-threshold", `bribe waits for valuation $${fmt(ns, mem.K.bribeThreshold)} ` +
      `(now $${fmt(ns, ctx.corp.valuation)})`);
    return;
  }
  const joined = safe(() => ns.getPlayer().factions, []);
  if (!joined.some((f) => sameName(f, faction))) {
    sayOnce(ctx, `bribe-join|${faction}`, `bribe: you haven't joined "${faction}" — not sending money`);
    return;
  }
  const amount = ctx.spendable * clamp01(BRIBE_FRAC);
  if (amount <= 0) return;
  if (act(ctx, "bribe", `bribe ${faction} $${fmt(ns, amount)} = ${fmt(ns, amount / mem.K.bribeAmountPerReputation)} rep`,
    () => ns.corporation.bribe(faction, amount))) ctx.spendable -= amount;
}

// =============================== output =====================================

function report(ctx) {
  const { ns, opts, mem, corp } = ctx;
  const profit = corp.revenue - corp.expenses;
  const counts = Object.entries(ctx.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(" ");
  const bonus = safe(() => ns.corporation.getBonusTime(), 0);
  const line = `${corp.name} · funds $${fmt(ns, corp.funds)} · ${profit >= 0 ? "+" : "-"}$${fmt(ns, Math.abs(profit))}/s ` +
    `· val $${fmt(ns, corp.valuation)}${bonus > 1000 ? ` · bonus ${Math.round(bonus / 1000)}s` : ""}` +
    `${counts ? ` · did: ${counts}` : ""}${ctx.warns.length ? ` · !! ${ctx.warns.length} warning(s)` : ""}`;

  const out = opts.once ? (s) => ns.tprint(s) : (s) => ns.print(s);
  if (!opts.quiet || opts.once) {
    out(line);
    for (const n of ctx.notes) out(`  ${n}`);
  }

  const warnKey = ctx.warns.join(" | ");
  if (warnKey && warnKey !== mem.lastWarn) {
    ns.tprint(`\ncorp WARNING:\n  ${ctx.warns.join("\n  ")}\n` +
      `  First check what's filling it:  run corp-report.js\n` +
      `  Unsold OUTPUT -> dump one cycle, then restore:  run corp-do.js sell DIV MAT --price 0\n` +
      `  Boost OVER target -> restart with --auto-boost --trim (sells the excess at market price)\n` +
      `  Either way, more room:  run corp-do.js warehouse DIV --add 5`);
  }
  mem.lastWarn = warnKey;

  if (!opts.once && Date.now() - mem.lastBanner >= BANNER_FLOOR_MS) {
    mem.lastBanner = Date.now();
    let offer = "";
    if (!corp.public) {
      const o = safe(() => ns.corporation.getInvestmentOffer(), null);
      if (o && o.funds > 0) offer = `\n       offer round ${o.round}: $${fmt(ns, o.funds)} for ${fmt(ns, o.shares)} shares ` +
        `— yours to take (run corp-do.js offer)`;
    }
    ns.tprint(`[corp] ${line}${offer}`);
  }
}

function describeMix(mix) {
  const ab = { "Operations": "Ops", "Engineer": "Eng", "Business": "Bus", "Management": "Mgmt",
    "Research & Development": "R&D", "Intern": "Int" };
  return Object.entries(mix).filter(([, n]) => n > 0).map(([r, n]) => `${ab[r] || r}${n}`).join(" ");
}

function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

function loadJson(ns, file) {
  try { const raw = ns.read(file); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === "object" ? v : {}; }
  catch (e) { return {}; }
}
function saveJson(ns, file, obj) { try { ns.write(file, JSON.stringify(obj), "w"); } catch (e) { /* nicety */ } }

function printHelp(ns) {
  ns.tprint(
    "\ncorp.js — resident corporation manager (tail it to watch).\n" +
    "  run corp.js                    keep staff/morale/sales/supply/products/TA.II right; no discretionary spend\n" +
    "  run corp.js --auto             ...plus upgrades, AdVert, research and boost materials\n" +
    "  run corp.js --once --dry       one pass, print what it would do, change nothing\n" +
    "  --auto-upgrade --auto-advert --auto-research --auto-boost    pick spenders individually\n" +
    "  --auto-bribe \"Daedalus\"        funds -> that faction's rep, past the valuation threshold\n" +
    "  --boost-total 0.4  --trim      boost share of each warehouse; --trim sells excess at MP\n" +
    "  --reserve 1t                   never spend corp funds below this\n" +
    "  --rotate                       retire the weakest product at the cap (PERMANENT)\n" +
    "  --no-staff --no-morale --no-sell --no-supply --no-product --no-ta   switch a job off\n" +
    "  Job mixes per division: run corp-do.js jobs DIV PRESET   (stored in corp-config.txt)\n" +
    "  Never takes offers, goes public or sells shares — those are corp-do.js, behind --yes.\n"
  );
}
