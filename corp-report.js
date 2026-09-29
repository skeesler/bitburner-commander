/** @param {NS} ns
 *
 *  CORP REPORT — the whole corporation in one block you can paste to an assistant. Reads, never spends.
 *
 *      run corp-report.js             # read everything, print the report, write corp-report.txt
 *      run corp-report.js --json      # ...as raw JSON instead (when a field is missing)
 *      run corp-report.js --render    # re-render the last read without touching the game
 *
 *  Funds, shares, the investment offer, every unlock and upgrade, then per division per city: the
 *  office, the warehouse, every material that is doing anything, every product, what the next
 *  warehouse level / office seat / AdVert costs, and a FLAGS section of mechanical checks.
 *
 *  It used to be a 3.7GB conductor launching three scanners one at a time, because the getters it
 *  wants come to ~200GB in one file. With the RAM wall gone (corp-design.md, "The 2026-09
 *  rewrite") it reads everything itself. The data keeps the old three-part shape — corp / city /
 *  cost — so the renderer below is the field-tested one, unchanged where it could be.
 *
 *  RAM: 192GB while it runs (a few seconds) — measured with `mem`, 2026-09-27.
 *
 *  RFA sync is one-way (disk -> game), so the output is printed AND written to corp-report.txt;
 *  the raw read goes to corp-report.json for --render.
 */
import { fmt, short, round, pct, isZero, readConfig } from "corp-lib.js";

const OUT_FILE = "corp-report.txt";
const RAW_FILE = "corp-report.json";

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([["render", false], ["json", false], ["help", false]]);
  if (opts.help) { printHelp(ns); return; }
  if (!ns.corporation.hasCorporation()) {
    ns.tprint("\ncorp-report: no corporation yet.  run corp-do.js create\n");
    return;
  }

  let data;
  if (opts.render) {
    data = readJson(ns, RAW_FILE);
    if (!data) { ns.tprint(`corp-report: no ${RAW_FILE} yet — run without --render first.`); return; }
  } else {
    data = gather(ns);
    try { ns.write(RAW_FILE, JSON.stringify(data), "w"); } catch (e) { data.notes.push(`could not write ${RAW_FILE}: ${e}`); }
  }

  const body = opts.json
    ? `===== CORP REPORT (JSON) =====\n${JSON.stringify(data, null, 1)}\n===== END =====`
    : render(ns, data);
  try { ns.write(OUT_FILE, body, "w"); } catch (e) { /* the terminal copy still exists */ }
  ns.tprint(`\n${body}\n\n(also written to ${OUT_FILE} — \`cat ${OUT_FILE}\` if this scrolled away)`);
}

// =============================== reading ====================================

/** Everything, in the three-part shape the renderer expects: {corp, city, cost}. */
function gather(ns) {
  const c = ns.corporation;
  const K = c.getConstants();
  const notes = [];
  const errs = (part) => (e) => notes.push(`${part}: ${short(e, 160)}`);
  const cities = Object.values(ns.enums.CityName);
  // Valuation FILLER divisions (corp-do.js filler) are deliberately unmanaged: no inputs, no sell
  // orders. Reporting them city by city would flag all of that as broken (it did, 2026-09-29).
  const data = { ts: Date.now(), notes, corp: {}, city: {}, cost: {}, fillers: readConfig(ns).filler || [] };

  data.host = {
    maxRam: ns.getServerMaxRam("home"), usedRam: ns.getServerUsedRam("home"),
    wallet: ns.getServerMoneyAvailable("home"),
    running: ns.ps("home").map((p) => p.filename).sort(),
  };

  // ---- corp level ----
  const corp = data.corp;
  corp.cycleSeconds = K.secondsPerMarketCycle || 10;
  try { corp.bonusTimeMs = c.getBonusTime(); } catch (e) { corp.bonusTimeMs = 0; }
  const info = c.getCorporation();
  corp.corp = {
    name: info.name, funds: info.funds, revenue: info.revenue, expenses: info.expenses,
    valuation: info.valuation, numShares: info.numShares, totalShares: info.totalShares,
    investorShares: info.investorShares, issuedShares: info.issuedShares, sharePrice: info.sharePrice,
    isPublic: info.public, dividendRate: info.dividendRate, dividendEarnings: info.dividendEarnings,
    tributeModifier: info.tributeModifier, shareSaleCooldown: info.shareSaleCooldown,
    issueNewSharesCooldown: info.issueNewSharesCooldown, prevState: info.prevState,
    nextState: info.nextState, divisions: info.divisions,
  };
  try {
    const o = c.getInvestmentOffer();
    corp.offer = o.funds > 0 ? { round: o.round, funds: o.funds, shares: o.shares } : { error: info.public ? "public" : "none left" };
  } catch (e) { corp.offer = { error: short(e) }; }
  corp.unlocksList = (K.unlockNames || []).map((name) => {
    const owned = safe(() => c.hasUnlock(name), false);
    return { name, owned, cost: owned ? null : safe(() => c.getUnlockCost(name), null) };
  });
  corp.upgradesList = (K.upgradeNames || []).map((name) => ({
    name, level: safe(() => c.getUpgradeLevel(name), null), nextCost: safe(() => c.getUpgradeLevelCost(name), null),
  }));

  // ---- per division ----
  data.city = { unitSizes: {}, boostNames: K.boostMaterials || [], industries: {}, divisions: [] };
  data.cost = { divisions: [] };
  for (const mat of K.materialNames) data.city.unitSizes[mat] = safe(() => c.getMaterialData(mat).size, 0);
  corp.divisions = [];
  for (const name of info.divisions) {
    let d;
    try { d = c.getDivision(name); } catch (e) { corp.divisions.push({ name, error: short(e) }); continue; }
    corp.divisions.push({
      name: d.name, industry: d.industry, awareness: d.awareness, popularity: d.popularity,
      productionMult: d.productionMult, researchPoints: d.researchPoints, numAdVerts: d.numAdVerts,
      cities: d.cities, products: d.products, makesProducts: d.makesProducts, maxProducts: d.maxProducts,
      lastCycleRevenue: d.lastCycleRevenue, lastCycleExpenses: d.lastCycleExpenses,
      thisCycleRevenue: d.thisCycleRevenue, thisCycleExpenses: d.thisCycleExpenses,
    });
    if (!data.city.industries[d.industry]) {
      try {
        const x = c.getIndustryData(d.industry);
        data.city.industries[d.industry] = {
          startingCost: x.startingCost, makesMaterials: x.makesMaterials, makesProducts: x.makesProducts,
          requiredMaterials: x.requiredMaterials, producedMaterials: x.producedMaterials || [],
          realEstateFactor: x.realEstateFactor, hardwareFactor: x.hardwareFactor, robotFactor: x.robotFactor,
          aiCoreFactor: x.aiCoreFactor, scienceFactor: x.scienceFactor, advertisingFactor: x.advertisingFactor,
        };
      } catch (e) { errs(`getIndustryData(${d.industry})`)(e); }
    }

    const cityDiv = { name, industry: d.industry, cities: [] };
    const costDiv = { name, cities: [], researchOwned: [], adVertCost: safe(() => c.getHireAdVertCost(name), null) };
    for (const city of d.cities.filter((x) => cities.includes(x))) {
      const row = { city, materials: [], products: [] };
      try {
        const o = c.getOffice(name, city);
        row.office = {
          size: o.size, numEmployees: o.numEmployees, avgMorale: o.avgMorale, avgEnergy: o.avgEnergy,
          maxMorale: o.maxMorale, maxEnergy: o.maxEnergy, totalExperience: o.totalExperience,
          jobs: o.employeeJobs, productionByJob: o.employeeProductionByJob,
        };
      } catch (e) { row.officeError = short(e); }
      const hasWh = safe(() => c.hasWarehouse(name, city), false);
      if (hasWh) {
        const w = c.getWarehouse(name, city);
        row.warehouse = { level: w.level, size: w.size, sizeUsed: w.sizeUsed, smartSupplyEnabled: w.smartSupplyEnabled };
        for (const mat of K.materialNames) {
          const m = safe(() => c.getMaterial(name, city, mat), null);
          if (!m) continue;
          const busy = m.stored > 0 || m.productionAmount !== 0 || m.buyAmount > 0 ||
            m.importAmount > 0 || (m.exports && m.exports.length) || !isZero(m.desiredSellAmount);
          if (!busy) continue;
          row.materials.push({
            name: mat, stored: m.stored, quality: m.quality, productionAmount: m.productionAmount,
            actualSellAmount: m.actualSellAmount, buyRate: m.buyAmount, importAmount: m.importAmount,
            sellAmount: m.desiredSellAmount, sellPrice: m.desiredSellPrice, marketPrice: m.marketPrice,
            demand: m.demand, competition: m.competition, productionLimit: m.productionLimit,
            exports: (m.exports || []).map((x) => ({ division: x.division, city: x.city, amount: x.amount })),
          });
        }
        for (const pname of d.products) {
          const p = safe(() => c.getProduct(name, city, pname), null);
          if (!p) continue;
          row.products.push({
            name: p.name, developmentProgress: p.developmentProgress, rating: p.rating,
            effectiveRating: p.effectiveRating, stored: p.stored, productionAmount: p.productionAmount,
            actualSellAmount: p.actualSellAmount, sellAmount: p.desiredSellAmount, sellPrice: p.desiredSellPrice,
            productionCost: p.productionCost, size: p.size, designInvestment: p.designInvestment,
            advertisingInvestment: p.advertisingInvestment, demand: p.demand, competition: p.competition, stats: p.stats,
          });
        }
      }
      cityDiv.cities.push(row);
      costDiv.cities.push({
        city,
        warehousePlus1: hasWh ? safe(() => c.getUpgradeWarehouseCost(name, city, 1), null) : null,
        officePlus1: safe(() => c.getOfficeSizeUpgradeCost(name, city, 1), null),
      });
    }
    for (const r of K.researchNames || []) {
      let owned;
      try { owned = c.hasResearched(name, r); } catch (e) { continue; }   // not applicable to this industry
      costDiv.researchOwned.push({ name: r, owned, cost: owned ? null : safe(() => c.getResearchCost(name, r), null) });
    }
    data.city.divisions.push(cityDiv);
    data.cost.divisions.push(costDiv);
  }
  return data;
}

function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

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
    L.push("CORP  (could not read the corporation)");
  }

  // ---- investment offer ---------------------------------------------------
  if (corp.offer) {
    if (corp.offer.error) {
      L.push(`  offer     unavailable (${corp.offer.error})`);
    } else {
      const o = corp.offer;
      const frac = info && info.totalShares ? o.shares / info.totalShares : 0;
      L.push(`  OFFER     round ${o.round}/4 — $${fmt(ns, o.funds)} for ${fmt(ns, o.shares)} shares ` +
        `(${pct(frac)} of total). One-way: run corp-do.js offer, then accept --yes when you're done growing.`);
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

  const fillers = new Set(data.fillers || []);
  for (const d of corp.divisions || []) {
    L.push("");
    if (d.error) { L.push(`DIVISION ${d.name} — could not read (${d.error})`); continue; }
    if (fillers.has(d.name)) {
      const cityDivF = (city.divisions || []).find((x) => x.name === d.name) || {};
      const whs = (cityDivF.cities || []).filter((c) => c.warehouse).length;
      L.push(`DIVISION ${d.name} [${d.industry}] · VALUATION FILLER (not managed) · ${d.cities.length} offices + ` +
        `${whs} warehouses = x${round(Math.pow(1.1, (d.cities.length + whs) / 12), 3)} valuation`);   // 1.1 per 12 [Corporation.ts:211]
      continue;
    }
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
    if (!cityDiv.cities) L.push(`  (no per-city data)`);
  }

  // ---- flags --------------------------------------------------------------
  const flags = findFlags(ns, data);
  // One honest footnote beats 200 silent omissions: if getMaterial/getProduct don't carry the
  // Market-TA flags, say so, because otherwise a reader assumes the report would have mentioned it.
  for (const d of (data.cost || {}).divisions || []) {
    const ta2 = (d.researchOwned || []).find((r) => r.name === "Market-TA.II");
    if (ta2 && ta2.owned) flags.push(`${d.name}: Market-TA.II researched — corp.js keeps the per-item flag ON ` +
      `(getMaterial/getProduct don't expose it, so the sell prices above may be overridden by it)`);
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
    bits.push(`mp $${fmt(ns, m.marketPrice)}`);
    if (m.demand !== undefined) bits.push(`dmd ${round(m.demand, 1)}`);
    if (m.competition !== undefined) bits.push(`cmp ${round(m.competition, 1)}`);
    if (m.productionLimit != null) bits.push(`limit ${m.productionLimit}`);
    for (const x of m.exports || []) bits.push(`EXPORT -> ${x.division}/${x.city} ${x.amount}`);
    out.push(bits.join(" · "));
  }

  // Boost materials as a fraction of the warehouse — the only unit that stays meaningful when
  // you upgrade a warehouse or add a city (corp.js --auto-boost). Always shown: zero is a finding.
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
    bits.push(`cost $${fmt(ns, p.productionCost)}`);
    bits.push(`invested design $${fmt(ns, p.designInvestment)} / ads $${fmt(ns, p.advertisingInvestment)}`);
    return bits.join(" · ");
  });
}

/** Cheap, mechanical checks. Deliberately factual — the judgement call stays with the reader. */
function findFlags(ns, data) {
  const out = [];
  const fillerSet = new Set(data.fillers || []);   // valuation filler: unmanaged on purpose
  const info = (data.corp || {}).corp;
  const cityFrag = data.city || {};

  if (info && info.funds < 0) out.push(`corp funds are NEGATIVE ($${fmt(ns, info.funds)}) — you cannot upgrade your way out of this`);
  if (info && info.revenue === 0) {
    out.push(`revenue is exactly $0/s — a missing sell order, OR a stock-out: sell orders on ` +
      `empty shelves earn $0 too (congestion halts production, the stored output sells out, ` +
      `revenue hits zero with every order in place — seen live 2026-09-12)`);
  }
  for (const d of (data.corp || {}).divisions || []) {
    if (fillerSet.has(d.name)) continue;
    if (!d.error && !(d.awareness > 0)) {
      out.push(`${d.name}: awareness is 0 — the game multiplies every sale by 0.02 until it isn't ` +
        `(Division.ts:1035). One AdVert fixes it: run corp-do.js advert ${d.name} 2`);
    }
  }
  if (info && !info.isPublic && info.dividendRate === 0) {
    out.push(`not public and paying no dividends — corporation funds are NOT your wallet ` +
      `(wallet $${fmt(ns, (data.host || {}).wallet || 0)})`);
  }

  for (const d of cityFrag.divisions || []) {
    if (fillerSet.has(d.name)) continue;   // unmanaged on purpose — nothing here is a fault
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
        // the market. Without this rule every Chemical city screams
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
            `(run corp.js with --auto-boost; it re-solves the share every cycle as warehouses grow)`);
        }
      }

      const o = c.office;
      if (o) {
        const unassigned = (o.jobs && o.jobs["Unassigned"]) || 0;
        if (unassigned > 0) out.push(`${where}: ${unassigned} employee(s) UNASSIGNED — they produce nothing`);
        if (o.numEmployees < o.size) out.push(`${where}: office has ${o.size - o.numEmployees} empty seat(s) — hiring costs nothing up front`);
        if (o.avgMorale < 95 || o.avgEnergy < 95) out.push(`${where}: morale ${round(o.avgMorale, 0)} / energy ${round(o.avgEnergy, 0)} — below par, tea and parties fix it`);
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

function readJson(ns, file) {
  try {
    const raw = ns.read(file);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-report.js — the whole corporation in one paste-back block. Reads, never spends.\n" +
    "  run corp-report.js           read everything, print it, write corp-report.txt\n" +
    "  run corp-report.js --json    raw JSON instead of the rendered report\n" +
    "  run corp-report.js --render  re-render the last read (corp-report.json)\n"
  );
}
