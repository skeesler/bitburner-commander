/** @param {NS} ns
 *
 *  CORP SCAN (per city) — one third of corp-report.js. 61.6GB. Reads, never spends.
 *
 *      run corp-scan-city.js [--id RUNID] [--divisions "Agriculture,Chem"]
 *
 *  Writes corp-rep-2.txt: for every division, in every city — the office (headcount, job mix,
 *  morale, energy), the warehouse (level, space used), every material that is doing anything
 *  at all, and every product. Plus each industry's live factor table and each material's unit
 *  size, which is what lets the report express boost stock as a SHARE OF THE WAREHOUSE rather
 *  than a meaningless unit count (corp-boost.js's whole lesson).
 *
 *  It learns which divisions and cities exist by reading corp-rep-1.txt (ns.read is 0GB), so it
 *  never has to pay 10GB for getCorporation. Pass --divisions to run it standalone.
 *
 *  A material is reported when it is stored, produced, consumed, bought, imported, exported or
 *  has a sell order — reading all 12 names costs no extra RAM (same function), and this is how
 *  a stray purchase order in the wrong division gets caught instead of hiding.
 *
 *  RAM: getOffice (10) + getWarehouse (10) + getMaterial (10) + getProduct (10)
 *       + getIndustryData (10) + getMaterialData (10) + 1.6 base = 61.6GB.
 */

const IN_FILE  = "corp-rep-1.txt";
const OUT_FILE = "corp-rep-2.txt";

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([["id", 0], ["divisions", ""], ["help", false]]);
  if (opts.help) {
    ns.tprint("\ncorp-scan-city.js — per-city half of the report (61.6GB).\n" +
      "  Normally launched by corp-report.js. Writes " + OUT_FILE + ", prints nothing.\n" +
      "  run corp-scan-city.js --divisions \"Agriculture\"    standalone, without corp-rep-1.txt\n");
    return;
  }

  const frag = { runId: Number(opts.id) || 0, part: "city", ts: Date.now(), errors: [] };

  let K = null;
  try { K = ns.corporation.getConstants(); } catch (e) { frag.errors.push(`getConstants: ${e}`); }
  const materialNames = (K && K.materialNames) || [];
  const boostNames = (K && K.boostMaterials) || [];
  const allCities = Object.values(ns.enums.CityName);

  // Which divisions, and which cities is each in? Free, from the first scanner's fragment.
  let plan = readPlan(ns, opts.divisions, allCities);
  if (!plan.length) {
    frag.errors.push(`no divisions to inspect — run corp-scan-corp.js first, or pass --divisions`);
    write(ns, frag);
    return;
  }

  // Unit sizes never change; one read each is enough for the whole report.
  frag.unitSizes = {};
  for (const mat of materialNames) {
    try { frag.unitSizes[mat] = ns.corporation.getMaterialData(mat).size; } catch (e) { /* skip */ }
  }
  frag.boostNames = boostNames;

  // Industry factor tables, read LIVE — the published ones are stale in places (docs give
  // Tobacco robotFactor 0.25; v3.0.1 source says 0.2), so we never quote them from memory.
  frag.industries = {};
  frag.divisions = [];

  for (const entry of plan) {
    const divRow = { name: entry.name, industry: entry.industry || null, cities: [] };

    if (entry.industry && !frag.industries[entry.industry]) {
      try {
        const d = ns.corporation.getIndustryData(entry.industry);
        frag.industries[entry.industry] = {
          startingCost: d.startingCost,
          makesMaterials: d.makesMaterials,
          makesProducts: d.makesProducts,
          requiredMaterials: d.requiredMaterials,
          producedMaterials: d.producedMaterials || [],
          realEstateFactor: d.realEstateFactor,
          hardwareFactor: d.hardwareFactor,
          robotFactor: d.robotFactor,
          aiCoreFactor: d.aiCoreFactor,
          scienceFactor: d.scienceFactor,
          advertisingFactor: d.advertisingFactor,
        };
      } catch (e) { frag.errors.push(`getIndustryData(${entry.industry}): ${short(e)}`); }
    }

    for (const city of entry.cities) {
      const row = { city };

      try {
        const o = ns.corporation.getOffice(entry.name, city);
        row.office = {
          size: o.size, numEmployees: o.numEmployees,
          avgMorale: o.avgMorale, avgEnergy: o.avgEnergy,
          maxMorale: o.maxMorale, maxEnergy: o.maxEnergy,
          totalExperience: o.totalExperience,
          jobs: o.employeeJobs,
          productionByJob: o.employeeProductionByJob,
        };
      } catch (e) { row.officeError = short(e); }

      try {
        const w = ns.corporation.getWarehouse(entry.name, city);
        row.warehouse = {
          level: w.level, size: w.size, sizeUsed: w.sizeUsed,
          smartSupplyEnabled: w.smartSupplyEnabled,
        };
      } catch (e) { row.warehouseError = short(e); }

      // Materials: read them all, keep the ones that are doing something.
      row.materials = [];
      for (const mat of materialNames) {
        let m;
        try { m = ns.corporation.getMaterial(entry.name, city, mat); } catch (e) { continue; }
        const sellAmount = m.desiredSellAmount;
        const busy = m.stored > 0 || m.productionAmount !== 0 || m.buyAmount > 0 ||
          m.importAmount > 0 || (m.exports && m.exports.length) || !isZero(sellAmount);
        if (!busy) continue;
        row.materials.push({
          name: mat,
          stored: m.stored,
          quality: m.quality,
          productionAmount: m.productionAmount,
          actualSellAmount: m.actualSellAmount,
          buyRate: m.buyAmount,
          importAmount: m.importAmount,
          sellAmount,
          sellPrice: m.desiredSellPrice,
          // MARKET-TA STATE. Owning the research is not the same as the flag being set, and the
          // flag is per item — so a report that shows only the sell price cannot tell you whether
          // that price is even being used. These field names are NOT confirmed against a live
          // 3.0.1 Material; if the API doesn't expose them both come back undefined and
          // corp-report.js says "TA state not exposed by getMaterial()" rather than guessing.
          marketTa1: m.marketTa1,
          marketTa2: m.marketTa2,
          marketPrice: m.marketPrice,
          demand: m.demand,
          competition: m.competition,
          productionLimit: m.productionLimit,
          exports: (m.exports || []).map((x) => ({ division: x.division, city: x.city, amount: x.amount })),
        });
      }

      // Products live on the division but are priced and rated per city.
      row.products = [];
      for (const name of entry.products || []) {
        try {
          const p = ns.corporation.getProduct(entry.name, city, name);
          row.products.push({
            name: p.name,
            developmentProgress: p.developmentProgress,
            rating: p.rating,
            effectiveRating: p.effectiveRating,
            stored: p.stored,
            productionAmount: p.productionAmount,
            actualSellAmount: p.actualSellAmount,
            sellAmount: p.desiredSellAmount,
            sellPrice: p.desiredSellPrice,
            marketTa1: p.marketTa1,      // see the note on the material fields above
            marketTa2: p.marketTa2,
            productionCost: p.productionCost,
            size: p.size,
            designInvestment: p.designInvestment,
            advertisingInvestment: p.advertisingInvestment,
            demand: p.demand,
            competition: p.competition,
            stats: p.stats,
          });
        } catch (e) { /* product not available in this city yet */ }
      }

      divRow.cities.push(row);
    }

    frag.divisions.push(divRow);
  }

  write(ns, frag);
}

/** Divisions + their cities, from corp-rep-1.txt (0GB) or an explicit flag. */
function readPlan(ns, flagValue, allCities) {
  if (flagValue) {
    return String(flagValue).split(",").map((s) => s.trim()).filter(Boolean)
      .map((name) => ({ name, industry: null, cities: allCities, products: [] }));
  }
  try {
    const raw = ns.read(IN_FILE);
    if (raw) {
      const prev = JSON.parse(raw) || {};
      if (Array.isArray(prev.divisions)) {
        return prev.divisions.filter((d) => !d.error).map((d) => ({
          name: d.name,
          industry: d.industry,
          cities: Array.isArray(d.cities) && d.cities.length ? d.cities : allCities,
          products: d.products || [],
        }));
      }
    }
  } catch (e) { /* fall through */ }
  return [];
}

/** The game's default sell amount is 0 — the $0.00/s failure mode. Treat "" and "0" as zero. */
function isZero(v) {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v === "number") return v <= 0;
  const s = String(v).trim().toUpperCase();
  return s === "0" || s === "0.0";
}

function write(ns, frag) {
  try { ns.write(OUT_FILE, JSON.stringify(frag), "w"); }
  catch (e) { ns.tprint(`corp-scan-city: could not write ${OUT_FILE}: ${e}`); }
  ns.print(`wrote ${OUT_FILE} (${frag.errors.length} error(s)).`);
}

function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 160); }
