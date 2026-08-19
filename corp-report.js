/** @param {NS} ns
 *
 *  CORP REPORT — the whole corporation, in one block you can paste to an assistant. ~3.7GB.
 *
 *      run corp-report.js                # scan everything, print the report, write corp-report.txt
 *      run corp-report.js --json         # ...as raw merged JSON instead (when a field is missing)
 *      run corp-report.js --render       # re-render the last scan without re-reading the game
 *      run corp-report.js --only city    # run just one scanner (corp | city | cost)
 *
 *  WHAT IT'S FOR. "Here is everything about my corporation, what should I do next?" — funds,
 *  shares, the investment offer, every unlock and upgrade, and then per division per city: the
 *  office, the warehouse, every material that's moving, every product, and what the next
 *  warehouse level / office seat / AdVert would cost. It reads and never spends, so it is
 *  always safe to run.
 *
 *  WHY IT'S A CONDUCTOR AND NOT A SCRIPT. The getters this report wants come to roughly 180GB
 *  if one file mentions them all — every ns.corporation.* function is charged 10GB (info) or
 *  20GB (action) for being MENTIONED, and the runtime bills the same budget again on first
 *  call, so there is no dodge (corp-design.md -> The RAM wall). Instead this file mentions ONLY
 *  free corporation calls and launches three scanners one at a time:
 *
 *      corp-scan-corp.js  71.6GB   corporation, offer, unlocks, upgrades, divisions
 *      corp-scan-city.js  61.6GB   offices, warehouses, materials, products, industry factors
 *      corp-scan-cost.js  51.6GB   warehouse/office/AdVert prices, research state
 *
 *  Peak is conductor + largest scanner, about 75GB, not 180. Each writes a JSON fragment
 *  (corp-rep-1/2/3.txt) and this file merges them — ns.read and ns.write are 0GB, so all the
 *  rendering below is free. If a scanner won't fit in free home RAM it says so and the report
 *  is printed WITHOUT that section rather than silently missing it.
 *
 *  RFA sync is one-way (disk -> game), so the output can't come back on its own: it is printed
 *  to the terminal AND written to corp-report.txt. Paste the terminal block, or
 *  `cat corp-report.txt` if the tail scrolled away.
 *
 *  RAM: ns.run (1.0) + ns.kill (0.5) + ns.ps (0.2) + ns.getScriptRam (0.1) + ns.fileExists (0.1)
 *       + getServerMaxRam/UsedRam (0.05 each) + getServerMoneyAvailable (0.1) + 1.6 base
 *       ~= 3.7GB. hasCorporation / getConstants / getBonusTime are 0GB.
 */

// ---- Tuning ----------------------------------------------------------------
const PARTS = [
  { key: "corp", script: "corp-scan-corp.js", file: "corp-rep-1.txt" },
  { key: "city", script: "corp-scan-city.js", file: "corp-rep-2.txt" },
  { key: "cost", script: "corp-scan-cost.js", file: "corp-rep-3.txt" },
];
const OUT_FILE = "corp-report.txt";
const PART_TIMEOUT_MS = 60e3;   // a scanner that hasn't finished by now is wedged
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["only", ""], ["render", false], ["json", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  // hasCorporation is 0GB and works with no corporation — the right top guard.
  if (!ns.corporation.hasCorporation()) {
    ns.tprint("\ncorp-report: no corporation yet. Create one at City Hall in Sector-12 " +
      "(\"Use seed money\" — free in BN3), then run corp-division.js.\n");
    return;
  }

  const runId = Date.now();
  const notes = [];

  if (!opts.render) {
    const wanted = opts.only
      ? PARTS.filter((p) => p.key === String(opts.only).toLowerCase())
      : PARTS;
    if (!wanted.length) {
      ns.tprint(`\ncorp-report: --only takes one of ${PARTS.map((p) => p.key).join(", ")}.`);
      return;
    }
    for (const part of wanted) {
      ns.print(`running ${part.script}...`);
      const problem = await runPart(ns, part.script, ["--id", runId]);
      if (problem) notes.push(problem);
    }
  }

  // ---- merge (all free: ns.read is 0GB) ----------------------------------
  const data = { runId, ts: Date.now(), notes };
  for (const part of PARTS) {
    const frag = readJson(ns, part.file);
    if (!frag) { notes.push(`MISSING ${part.file} — ${part.script} did not produce a fragment`); continue; }
    if (!opts.render && frag.runId !== runId) {
      notes.push(`STALE ${part.file} — from an earlier run, not this one; its numbers may be old`);
    }
    data[part.key] = frag;
    for (const e of frag.errors || []) notes.push(`${part.key}: ${e}`);
  }

  // Free context that helps decide what can actually be run next.
  data.host = {
    maxRam: ns.getServerMaxRam("home"),
    usedRam: ns.getServerUsedRam("home"),
    wallet: ns.getServerMoneyAvailable("home"),
    running: ns.ps("home").map((p) => p.filename).sort(),
  };

  const body = opts.json
    ? `===== CORP REPORT (JSON) =====\n${JSON.stringify(data, null, 1)}\n===== END =====`
    : render(ns, data);

  try { ns.write(OUT_FILE, body, "w"); } catch (e) { notes.push(`could not write ${OUT_FILE}: ${e}`); }
  ns.tprint(`\n${body}\n\n(also written to ${OUT_FILE} — \`cat ${OUT_FILE}\` if this scrolled away)`);
}

/** Launch one scanner and wait for it to exit, reporting a shortfall instead of thrashing. */
async function runPart(ns, script, args) {
  if (!ns.fileExists(script, "home")) return `SKIPPED ${script} — not on home`;
  const cost = ns.getScriptRam(script, "home");
  const free = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
  if (cost > free) {
    return `SKIPPED ${script} — needs ${cost}GB, only ${free.toFixed(1)}GB free on home ` +
      `(free some up, or run it alone later with: run ${script})`;
  }
  const pid = ns.run(script, 1, ...args);
  if (!pid) return `FAILED ${script} — run refused (needs ${cost}GB)`;
  const until = Date.now() + PART_TIMEOUT_MS;
  while (ns.ps("home").some((p) => p.pid === pid)) {
    if (Date.now() > until) { ns.kill(pid); return `TIMEOUT ${script} — killed after ${PART_TIMEOUT_MS / 1000}s`; }
    await ns.sleep(150);
  }
  return null;
}

// =============================== rendering ==================================
// Everything below runs on the merged fragments. No ns.corporation calls, so it is all free.

function render(ns, data) {
  const L = [];
  const corp = data.corp || {};
  const city = data.city || {};
  const cost = data.cost || {};
  const info = corp.corp;

  L.push(`===== CORP REPORT · Bitburner 3.0.1 · paste this whole block back =====`);
  L.push(`generated ${new Date(data.ts).toISOString()} · cycle ${corp.cycleSeconds || "?"}s` +
    (corp.bonusTimeMs ? ` · bonus time ${duration(corp.bonusTimeMs)}` : " · no bonus time") +
    (info ? ` · state ${info.prevState} -> ${info.nextState}` : ""));
  if (data.host) {
    L.push(`home ${data.host.maxRam}GB (${data.host.usedRam.toFixed(1)} used, ` +
      `${(data.host.maxRam - data.host.usedRam).toFixed(1)} free) · wallet $${fmt(ns, data.host.wallet)}`);
    L.push(`running: ${data.host.running.length ? data.host.running.join(" ") : "(nothing)"}`);
  }

  // ---- corporation --------------------------------------------------------
  if (info) {
    const profit = (info.revenue || 0) - (info.expenses || 0);
    L.push("");
    L.push(`CORP "${info.name}"`);
    L.push(`  funds     $${fmt(ns, info.funds)}       valuation $${fmt(ns, info.valuation)}`);
    L.push(`  revenue   $${fmt(ns, info.revenue)}/s   expenses $${fmt(ns, info.expenses)}/s   ` +
      `profit ${profit < 0 ? "-" : "+"}$${fmt(ns, Math.abs(profit))}/s`);
    L.push(`  shares    ours ${fmt(ns, info.numShares)} of ${fmt(ns, info.totalShares)} ` +
      `(${pct(info.numShares / info.totalShares)}) · investors ${fmt(ns, info.investorShares)} · ` +
      `issued ${fmt(ns, info.issuedShares)}`);
    L.push(`  public    ${info.isPublic ? "YES" : "no"} · dividend rate ${info.dividendRate || 0} · ` +
      `your dividend $${fmt(ns, info.dividendEarnings || 0)}/s · tribute x${info.tributeModifier}`);
    if (info.shareSaleCooldown || info.issueNewSharesCooldown) {
      L.push(`  cooldowns sellShares ${info.shareSaleCooldown} · issueNewShares ${info.issueNewSharesCooldown} (cycles)`);
    }
  } else {
    L.push("");
    L.push("CORP  (corp-scan-corp.js produced nothing — section missing)");
  }

  // ---- investment offer ---------------------------------------------------
  if (corp.offer) {
    if (corp.offer.error) {
      L.push(`  offer     unavailable (${corp.offer.error})`);
    } else {
      const o = corp.offer;
      const frac = info && info.totalShares ? o.shares / info.totalShares : 0;
      L.push(`  OFFER     round ${o.round}/4 — $${fmt(ns, o.funds)} for ${fmt(ns, o.shares)} shares ` +
        `(${pct(frac)} of total). Accept BY HAND in the Investors tab, and only when you're done growing.`);
    }
  }

  // ---- unlocks and upgrades ----------------------------------------------
  if (corp.unlocksList) {
    const owned = corp.unlocksList.filter((u) => u.owned).map((u) => u.name);
    const missing = corp.unlocksList.filter((u) => !u.owned)
      .map((u) => `${u.name} $${fmt(ns, u.cost)}`);
    L.push("");
    L.push(`UNLOCKS owned: ${owned.length ? owned.join(", ") : "(none)"}`);
    L.push(`        missing: ${missing.length ? missing.join(" · ") : "(none)"}`);
  }
  if (corp.upgradesList) {
    L.push(`UPGRADES ${corp.upgradesList
      .map((u) => `${u.name} lvl ${u.level}${u.nextCost != null ? ` (+1 $${fmt(ns, u.nextCost)})` : ""}`)
      .join(" · ")}`);
  }

  // ---- divisions ----------------------------------------------------------
  const cityByName = indexBy((city.divisions || []), "name");
  const costByName = indexBy((cost.divisions || []), "name");

  for (const d of corp.divisions || []) {
    L.push("");
    if (d.error) { L.push(`DIVISION ${d.name} — could not read (${d.error})`); continue; }
    const cityDiv = cityByName[d.name] || {};
    const costDiv = costByName[d.name] || {};
    const ind = (city.industries || {})[d.industry];

    L.push(`DIVISION ${d.name} [${d.industry}] · ${d.cities.length}/6 cities`);
    L.push(`  RP ${fmt(ns, d.researchPoints)} · production mult x${round(d.productionMult, 3)} · ` +
      `awareness ${round(d.awareness, 2)} · popularity ${round(d.popularity, 2)} · ` +
      `AdVerts ${d.numAdVerts}${costDiv.adVertCost != null ? ` (next $${fmt(ns, costDiv.adVertCost)})` : ""}`);
    L.push(`  this cycle rev $${fmt(ns, d.thisCycleRevenue)} exp $${fmt(ns, d.thisCycleExpenses)} · ` +
      `last cycle rev $${fmt(ns, d.lastCycleRevenue)} exp $${fmt(ns, d.lastCycleExpenses)}`);

    if (ind) {
      L.push(`  factors  realEstate ${ind.realEstateFactor} · hardware ${ind.hardwareFactor} · ` +
        `robots ${ind.robotFactor} · aiCores ${ind.aiCoreFactor} · science ${ind.scienceFactor} · ` +
        `advertising ${ind.advertisingFactor}`);
      const recipe = Object.entries(ind.requiredMaterials || {}).map(([m, n]) => `${n} ${m}`).join(" + ");
      L.push(`  recipe   ${recipe || "(none)"} -> ${(ind.producedMaterials || []).join(", ") || "(no materials)"}` +
        (ind.makesProducts ? ` · products ${d.products.length}/${d.maxProducts}` : " · no products"));
    }

    if (costDiv.researchOwned && costDiv.researchOwned.length) {
      const owned = costDiv.researchOwned.filter((r) => r.owned).map((r) => r.name);
      const next = costDiv.researchOwned.filter((r) => !r.owned && r.cost != null)
        .sort((a, b) => a.cost - b.cost).slice(0, 6)
        .map((r) => `${r.name} ${fmt(ns, r.cost)}RP`);
      L.push(`  research owned: ${owned.length ? owned.join(", ") : "(none)"}`);
      L.push(`  research next:  ${next.length ? next.join(" · ") : "(none)"}`);
    }

    // ---- per city -------------------------------------------------------
    const costCity = indexBy(costDiv.cities || [], "city");
    for (const c of cityDiv.cities || []) {
      L.push(cityLine(ns, c, costCity[c.city]));
      for (const line of materialLines(ns, c, city)) L.push(line);
      for (const line of productLines(ns, c)) L.push(line);
    }
    if (!cityDiv.cities) L.push(`  (no per-city data — corp-scan-city.js did not run)`);
  }

  // ---- flags --------------------------------------------------------------
  const flags = findFlags(ns, data);
  // One honest footnote beats 200 silent omissions: if getMaterial/getProduct don't carry the
  // Market-TA flags, say so, because otherwise a reader assumes the report would have mentioned it.
  if (!isTaKnown(data)) {
    flags.push("Market-TA state is NOT exposed by getMaterial()/getProduct() in this build — " +
      "a sell price alone cannot tell you whether TA.II is overriding it. Check `tail corp-ta.js`, " +
      "or the sell dialog in the corporation UI.");
  }
  L.push("");
  L.push(`FLAGS (computed from the above, not a diagnosis)`);
  if (flags.length) for (const f of flags) L.push(`  - ${f}`);
  else L.push("  - nothing obviously wrong");

  if (data.notes && data.notes.length) {
    L.push("");
    L.push("SCAN NOTES");
    for (const n of data.notes) L.push(`  - ${n}`);
  }

  L.push("===== END CORP REPORT =====");
  return L.join("\n");
}

/** One line per city: office on the left, warehouse and next prices on the right. */
function cityLine(ns, c, prices) {
  const bits = [`  ${String(c.city).padEnd(11)}`];
  if (c.office) {
    const o = c.office;
    const jobs = Object.entries(o.jobs || {})
      .filter(([, n]) => n > 0)
      .map(([role, n]) => `${abbrevJob(role)}${n}`).join(" ");
    bits.push(`office ${o.numEmployees}/${o.size} [${jobs || "nobody assigned"}] ` +
      `mor ${round(o.avgMorale, 0)} ene ${round(o.avgEnergy, 0)}`);
  } else {
    bits.push(`office —`);
  }
  if (c.warehouse) {
    const w = c.warehouse;
    const full = w.size > 0 ? w.sizeUsed / w.size : 0;
    bits.push(`| wh L${w.level} ${round(w.sizeUsed, 1)}/${round(w.size, 0)} (${pct(full)} full)` +
      (w.smartSupplyEnabled ? " smartSupply ON" : ""));
  } else {
    bits.push(`| wh —`);
  }
  if (prices) {
    const p = [];
    if (prices.warehousePlus1 != null) p.push(`wh+1 $${fmt(ns, prices.warehousePlus1)}`);
    if (prices.officePlus1 != null) p.push(`office+1 $${fmt(ns, prices.officePlus1)}`);
    if (p.length) bits.push(`| ${p.join(" ")}`);
  }
  return bits.join(" ");
}

/** Material lines, plus a boost-material line expressed as a share of the warehouse. */
function materialLines(ns, c, cityFrag) {
  const out = [];
  for (const m of c.materials || []) {
    const bits = [`      ${String(m.name).padEnd(12)} stored ${round(m.stored, 1)} q${round(m.quality, 2)}`];
    if (m.buyRate) bits.push(`buy ${round(m.buyRate, 2)}/s`);
    if (m.importAmount) bits.push(`imported ${round(m.importAmount, 2)}`);
    if (m.productionAmount) bits.push(`${m.productionAmount > 0 ? "produced" : "consumed"} ${round(Math.abs(m.productionAmount), 2)}`);
    bits.push(isZero(m.sellAmount) ? `SELL ORDER: none` : `sell ${m.sellAmount}@${m.sellPrice} (sold ${round(m.actualSellAmount, 2)})`);
    const ta = taState(m);
    if (ta) bits.push(ta);
    bits.push(`mp $${fmt(ns, m.marketPrice)}`);
    if (m.demand !== undefined) bits.push(`dmd ${round(m.demand, 1)}`);
    if (m.competition !== undefined) bits.push(`cmp ${round(m.competition, 1)}`);
    if (m.productionLimit != null) bits.push(`limit ${m.productionLimit}`);
    for (const x of m.exports || []) bits.push(`EXPORT -> ${x.division}/${x.city} ${x.amount}`);
    out.push(bits.join(" · "));
  }

  // Boost materials as a fraction of the warehouse — the only unit that stays meaningful when
  // you upgrade a warehouse or add a city (corp-boost.js). Always shown: zero is a finding.
  const w = c.warehouse;
  const sizes = cityFrag.unitSizes || {};
  const boost = cityFrag.boostNames || [];
  if (w && w.size > 0 && boost.length) {
    const stored = {};
    for (const m of c.materials || []) stored[m.name] = m.stored;
    const parts = boost.map((name) => {
      const units = stored[name] || 0;
      const frac = (units * (sizes[name] || 0)) / w.size;
      return `${abbrevMat(name)} ${round(units, 0)} (${pct(frac)})`;
    });
    out.push(`      boost stock: ${parts.join(" · ")}`);
  }
  return out;
}

function productLines(ns, c) {
  return (c.products || []).map((p) => {
    const bits = [`      PRODUCT ${p.name}`];
    if (p.developmentProgress < 100) bits.push(`developing ${round(p.developmentProgress, 1)}%`);
    else bits.push(`rating ${round(p.rating, 1)} (effective ${round(p.effectiveRating, 1)})`);
    bits.push(`stored ${round(p.stored, 1)}`);
    if (p.productionAmount) bits.push(`produced ${round(p.productionAmount, 2)}`);
    bits.push(isZero(p.sellAmount) ? "SELL ORDER: none" : `sell ${p.sellAmount}@${p.sellPrice} (sold ${round(p.actualSellAmount, 2)})`);
    const ta = taState(p);
    if (ta) bits.push(ta);
    bits.push(`cost $${fmt(ns, p.productionCost)}`);
    bits.push(`invested design $${fmt(ns, p.designInvestment)} / ads $${fmt(ns, p.advertisingInvestment)}`);
    return bits.join(" · ");
  });
}

/** Market-TA state for one material or product.
 *
 *  This exists because a sell price alone does not tell you whether it is being USED. Market-TA
 *  is a research AND a per-item flag, the flag defaults to off, and every new product arrives with
 *  it off — so "MAX@MP" and "MAX@MP*9450000" look equally plausible whether TA.II is running the
 *  pricing or your own controller is. When TA.II is on, the game ignores the price string entirely.
 *
 *  Returns "" when the API doesn't expose the flags at all, so the line is unchanged rather than
 *  claiming "off" for something we simply cannot see. isTaKnown() below turns that into one honest
 *  footnote instead of 200 silent omissions. */
function taState(item) {
  if (item.marketTa2 === true) return "TA.II ON";
  if (item.marketTa1 === true) return "TA.I on";
  if (item.marketTa1 === false || item.marketTa2 === false) return "TA off";
  return "";
}

/** Did anything in the scan carry a readable TA flag? */
function isTaKnown(data) {
  for (const c of Object.values((data.city || {}).cities || {})) {
    for (const m of c.materials || []) if (m.marketTa1 !== undefined || m.marketTa2 !== undefined) return true;
    for (const p of c.products || []) if (p.marketTa1 !== undefined || p.marketTa2 !== undefined) return true;
  }
  return false;
}

/** Cheap, mechanical checks. Deliberately factual — the judgement call stays with the reader. */
function findFlags(ns, data) {
  const out = [];
  const info = (data.corp || {}).corp;
  const cityFrag = data.city || {};

  if (info && info.funds < 0) out.push(`corp funds are NEGATIVE ($${fmt(ns, info.funds)}) — you cannot upgrade your way out of this`);
  if (info && info.revenue === 0) out.push(`revenue is exactly $0/s — that is always a missing sell order`);
  if (info && !info.isPublic && info.dividendRate === 0) {
    out.push(`not public and paying no dividends — corporation funds are NOT your wallet ` +
      `(wallet $${fmt(ns, (data.host || {}).wallet || 0)})`);
  }

  for (const d of cityFrag.divisions || []) {
    // What this industry must have to produce anything at all. A missing input is invisible in
    // the per-city listing — a material with no stock, no buy order and no import simply isn't
    // printed — so absence has to be checked for explicitly rather than read off the page.
    const ind = (cityFrag.industries || {})[d.industry] || null;
    const required = ind ? Object.keys(ind.requiredMaterials || {}) : [];

    for (const c of d.cities || []) {
      const where = `${d.name}/${c.city}`;

      if (c.warehouse) {
        for (const need of required) {
          const m = (c.materials || []).find((x) => x.name === need);
          const arriving = m && (m.stored > 0 || m.buyRate > 0 || m.importAmount > 0);
          if (!arriving) {
            out.push(`${where}: needs ${need} but has NONE stored, none on order and none ` +
              `arriving by export — production here is 0 until that changes ` +
              `(a buy rate of 0 is a standing order; something has to recompute it)`);
          }
        }
      }
      const w = c.warehouse;
      const freeFrac = w && w.size > 0 ? 1 - w.sizeUsed / w.size : null;

      for (const m of c.materials || []) {
        // A material with a standing EXPORT order already has somewhere to go — that is the
        // whole shape of a support division, whose output feeds a sister division rather than
        // the market. Same rule corp-supply.js uses; without it every Chemical city screams
        // "earning $0" while the export loop is working perfectly.
        if (m.productionAmount > 0 && isZero(m.sellAmount) && !(m.exports || []).length) {
          out.push(`${where}: producing ${m.name} with NO SELL ORDER — earning $0 on it`);
        }
      }
      if (freeFrac !== null && freeFrac <= 0.03) out.push(`${where}: warehouse ${pct(1 - freeFrac)} full — production halts silently when there's no room for output`);
      if (freeFrac !== null && freeFrac >= 0.9 && w.size > 100) out.push(`${where}: warehouse is ${pct(freeFrac)} EMPTY — that space does nothing until boost materials fill it`);

      // BOOST MATERIALS DILUTE WHEN THE WAREHOUSE GROWS. Every Smart Storage level multiplies
      // warehouse size, and the boost stock does NOT follow — so a corporation that buys upgrades
      // automatically silently halves its own boost fraction every time. Production multiplier is
      // the thing that stops improving, and nothing else in the report points at it.
      const sizes2 = cityFrag.unitSizes || {};
      const boostNames = cityFrag.boostNames || [];
      if (w && w.size > 100 && boostNames.length) {
        let frac = 0;
        for (const m of c.materials || []) {
          if (boostNames.includes(m.name)) frac += (m.stored * (sizes2[m.name] || 0)) / w.size;
        }
        if (frac < 0.2) {
          out.push(`${where}: boost materials are only ${pct(frac)} of the warehouse — ` +
            `production multiplier is capped well below what this warehouse could support ` +
            `(run corp-boost.js --loop; every Smart Storage level dilutes this again)`);
        }
      }

      const o = c.office;
      if (o) {
        const unassigned = (o.jobs && o.jobs["Unassigned"]) || 0;
        if (unassigned > 0) out.push(`${where}: ${unassigned} employee(s) UNASSIGNED — they produce nothing`);
        if (o.numEmployees < o.size) out.push(`${where}: office has ${o.size - o.numEmployees} empty seat(s) — hiring costs nothing up front`);
        if (o.avgMorale < 95 || o.avgEnergy < 95) out.push(`${where}: morale ${round(o.avgMorale, 0)} / energy ${round(o.avgEnergy, 0)} — below par, tea and parties fix it`);
      }

      // No boost materials at all, in a warehouse big enough to hold some.
      if (w && w.size >= 200) {
        const sizes = cityFrag.unitSizes || {};
        let boostFrac = 0;
        for (const m of c.materials || []) {
          if ((cityFrag.boostNames || []).includes(m.name)) boostFrac += (m.stored * (sizes[m.name] || 0)) / w.size;
        }
        if (boostFrac < 0.05) out.push(`${where}: almost no boost materials (${pct(boostFrac)} of warehouse) — this is the production multiplier`);
      }
    }
  }

  const offer = (data.corp || {}).offer;
  if (offer && !offer.error) out.push(`investment offer round ${offer.round} is on the table — accepting is one-way, and there are only 4`);

  return out;
}

// ---- small helpers ---------------------------------------------------------

function indexBy(list, key) {
  const out = {};
  for (const item of list || []) out[item[key]] = item;
  return out;
}

function isZero(v) {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v === "number") return v <= 0;
  const s = String(v).trim().toUpperCase();
  return s === "0" || s === "0.0";
}

function abbrevJob(role) {
  const map = {
    "Operations": "Ops", "Engineer": "Eng", "Business": "Bus", "Management": "Mgmt",
    "Research & Development": "R&D", "Intern": "Int", "Unassigned": "UNASSIGNED",
  };
  return map[role] || role;
}

function abbrevMat(name) {
  const map = { "Real Estate": "RealEstate", "AI Cores": "AICores" };
  return map[name] || name;
}

function duration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${m}m` : `${m}m${s % 60}s`;
}

function round(n, dp) {
  if (!Number.isFinite(n)) return "?";
  const f = Math.pow(10, dp);
  return String(Math.round(n * f) / f);
}

function pct(f) { return Number.isFinite(f) ? `${(100 * f).toFixed(1)}%` : "?"; }

// ns.formatNumber was REMOVED in 3.0.0 and survives only as a tombstone that throws when
// called, so a typeof guard proves nothing. ns.format.number is the real name (0GB).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "?";
  try { return ns.format.number(n, 3); } catch (e) { return String(Math.round(n)); }
}

function readJson(ns, file) {
  try {
    const raw = ns.read(file);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-report.js — the whole corporation in one paste-back block (~3.7GB).\n" +
    "  run corp-report.js              scan everything, print it, write corp-report.txt\n" +
    "  run corp-report.js --json       raw merged JSON instead of the rendered report\n" +
    "  run corp-report.js --render     re-render the last scan, read nothing from the game\n" +
    "  run corp-report.js --only city  run one scanner only (corp | city | cost)\n" +
    "  It reads and never spends. Launches three scanners one at a time so peak RAM is\n" +
    "  ~75GB instead of the ~180GB one file mentioning every getter would cost.\n"
  );
}
