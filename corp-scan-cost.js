/** @param {NS} ns
 *
 *  CORP SCAN (prices + research) — one third of corp-report.js. 51.6GB. Reads, never spends.
 *
 *      run corp-scan-cost.js [--id RUNID] [--divisions "Agriculture,Chem"]
 *
 *  Writes corp-rep-3.txt: the forward-looking half of the report — what the next warehouse
 *  level, the next office seat and the next AdVert would cost in each city, and which of the
 *  20 researches each division owns (with the RP price of the ones it doesn't).
 *
 *  These are the three SPECIAL upgrades — Warehouse (per city), Office (per city) and AdVert
 *  (per division). They aren't on the corporation Upgrades panel because they don't use the
 *  shared BasePrice * PriceMult^level formula, which is exactly why quoting them from a table
 *  is unreliable and reading them from the game isn't.
 *
 *  Research matters more than it looks: Hi-Tech R&D Lab -> Market-TA.I -> Market-TA.II is the
 *  chain corp-design.md plans to reimplement, and "do I own it yet" decides the whole round-3
 *  pricing question. The RP pool should never be drained, especially just before a product
 *  finishes — so the report shows what's owned AND what the rest would cost.
 *
 *  RAM: getUpgradeWarehouseCost (10) + getOfficeSizeUpgradeCost (10) + getHireAdVertCost (10)
 *       + hasResearched (10) + getResearchCost (10) + 1.6 base = 51.6GB.
 */

const IN_FILE  = "corp-rep-1.txt";
const OUT_FILE = "corp-rep-3.txt";

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([["id", 0], ["divisions", ""], ["help", false]]);
  if (opts.help) {
    ns.tprint("\ncorp-scan-cost.js — upgrade prices + research state (51.6GB).\n" +
      "  Normally launched by corp-report.js. Writes " + OUT_FILE + ", prints nothing.\n");
    return;
  }

  const frag = { runId: Number(opts.id) || 0, part: "cost", ts: Date.now(), errors: [] };

  let K = null;
  try { K = ns.corporation.getConstants(); } catch (e) { frag.errors.push(`getConstants: ${e}`); }
  const researchNames = (K && K.researchNames) || [];
  const allCities = Object.values(ns.enums.CityName);

  const plan = readPlan(ns, opts.divisions, allCities);
  if (!plan.length) {
    frag.errors.push("no divisions to inspect — run corp-scan-corp.js first, or pass --divisions");
    write(ns, frag);
    return;
  }

  frag.divisions = [];
  for (const entry of plan) {
    const divRow = { name: entry.name, cities: [], researchOwned: [] };

    try { divRow.adVertCost = ns.corporation.getHireAdVertCost(entry.name); }
    catch (e) { divRow.adVertError = short(e); }

    for (const city of entry.cities) {
      const row = { city };
      try { row.warehousePlus1 = ns.corporation.getUpgradeWarehouseCost(entry.name, city, 1); } catch (e) { /* no warehouse */ }
      try { row.warehousePlus5 = ns.corporation.getUpgradeWarehouseCost(entry.name, city, 5); } catch (e) { /* no warehouse */ }
      try { row.officePlus1 = ns.corporation.getOfficeSizeUpgradeCost(entry.name, city, 1); } catch (e) { /* no office */ }
      try { row.officePlus5 = ns.corporation.getOfficeSizeUpgradeCost(entry.name, city, 5); } catch (e) { /* no office */ }
      divRow.cities.push(row);
    }

    for (const name of researchNames) {
      const row = { name, owned: false, cost: null };
      try { row.owned = ns.corporation.hasResearched(entry.name, name); }
      catch (e) { continue; }   // not applicable to this industry
      if (!row.owned) {
        try { row.cost = ns.corporation.getResearchCost(entry.name, name); } catch (e) { /* nicety */ }
      }
      divRow.researchOwned.push(row);
    }

    frag.divisions.push(divRow);
  }

  write(ns, frag);
}

/** Divisions + their cities, from corp-rep-1.txt (0GB) or an explicit flag. */
function readPlan(ns, flagValue, allCities) {
  if (flagValue) {
    return String(flagValue).split(",").map((s) => s.trim()).filter(Boolean)
      .map((name) => ({ name, cities: allCities }));
  }
  try {
    const raw = ns.read(IN_FILE);
    if (raw) {
      const prev = JSON.parse(raw) || {};
      if (Array.isArray(prev.divisions)) {
        return prev.divisions.filter((d) => !d.error).map((d) => ({
          name: d.name,
          cities: Array.isArray(d.cities) && d.cities.length ? d.cities : allCities,
        }));
      }
    }
  } catch (e) { /* fall through */ }
  return [];
}

function write(ns, frag) {
  try { ns.write(OUT_FILE, JSON.stringify(frag), "w"); }
  catch (e) { ns.tprint(`corp-scan-cost: could not write ${OUT_FILE}: ${e}`); }
  ns.print(`wrote ${OUT_FILE} (${frag.errors.length} error(s)).`);
}

function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 160); }
