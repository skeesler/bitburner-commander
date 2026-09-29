/** @param {NS} ns
 *
 *  CORP SCAN (corp level) — one third of corp-report.js. 71.6GB. Reads, never spends.
 *
 *      run corp-scan-corp.js [--id RUNID]      # normally launched by corp-report.js
 *
 *  Writes corp-rep-1.txt: the corporation itself, the investment offer, every unlock and
 *  every corporation-wide upgrade with its next-level price, and one record per division.
 *  Prints nothing to the terminal — corp-report.js does all the rendering.
 *
 *  WHY IT'S A SEPARATE FILE. Every ns.corporation.* function costs 10GB (info) or 20GB
 *  (action) just for being MENTIONED, and the runtime charges the same budget a second time
 *  at call time, so there is no way to dodge it — only to mention fewer functions per file
 *  (corp-design.md -> The RAM wall). A single script holding every getter this report wants
 *  would be ~180GB. Three scanners that run one at a time peak at ~75GB instead.
 *
 *  NAMING WARNING: the RAM walker resolves identifiers by BARE NAME against the whole cost
 *  tree, namespace ignored. A local or object key called `research` bills 20GB for
 *  ns.corporation.research; `buy`, `sell`, `scan` and `share` are the same trap. Hence
 *  `researchOwned`, `buyRate`, `sellAmount` throughout this rig.
 *
 *  RAM: getCorporation (10) + getDivision (10) + getInvestmentOffer (10) + getUpgradeLevel (10)
 *       + getUpgradeLevelCost (10) + hasUnlock (10) + getUnlockCost (10) + 1.6 base = 71.6GB.
 *       getConstants is free.
 */

const OUT_FILE = "corp-rep-1.txt";

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([["id", 0], ["help", false]]);
  if (opts.help) {
    ns.tprint("\ncorp-scan-corp.js — corporation-level half of the report (71.6GB).\n" +
      "  Normally launched by corp-report.js. Writes " + OUT_FILE + ", prints nothing.\n");
    return;
  }

  const frag = { runId: Number(opts.id) || 0, part: "corp", ts: Date.now(), errors: [] };

  // getConstants is 0GB and is the only honest source of the name lists. Never hardcode them.
  let K = null;
  try { K = ns.corporation.getConstants(); } catch (e) { frag.errors.push(`getConstants: ${e}`); }
  frag.cycleSeconds = (K && K.secondsPerMarketCycle) || 10;
  try { frag.bonusTimeMs = ns.corporation.getBonusTime(); } catch (e) { frag.bonusTimeMs = 0; }

  let info;
  try {
    info = ns.corporation.getCorporation();
  } catch (e) {
    frag.errors.push(`getCorporation: ${e}`);
    write(ns, frag);
    return;
  }

  frag.corp = {
    name: info.name,
    funds: info.funds,
    revenue: info.revenue,
    expenses: info.expenses,
    valuation: info.valuation,
    numShares: info.numShares,
    totalShares: info.totalShares,
    investorShares: info.investorShares,
    issuedShares: info.issuedShares,
    sharePrice: info.sharePrice,
    isPublic: info.public,
    dividendRate: info.dividendRate,
    dividendEarnings: info.dividendEarnings,
    tributeModifier: info.tributeModifier,
    shareSaleCooldown: info.shareSaleCooldown,
    issueNewSharesCooldown: info.issueNewSharesCooldown,
    prevState: info.prevState,
    nextState: info.nextState,
    divisions: info.divisions,
  };

  // Four offers exist in the life of a corporation and accepting early permanently sells more
  // shares for less money, so this is READ ONLY — the decision stays Sara's (corp-design.md).
  // A public corporation can't take one, and the call throws rather than returning null.
  try {
    const o = ns.corporation.getInvestmentOffer();
    frag.offer = { round: o.round, funds: o.funds, shares: o.shares };
  } catch (e) {
    frag.offer = { error: short(String(e)) };
  }

  // ---- unlocks (8) and corporation-wide upgrades (9) ----------------------
  frag.unlocksList = [];
  for (const name of (K && K.unlockNames) || []) {
    const row = { name, owned: false, cost: null };
    try { row.owned = ns.corporation.hasUnlock(name); } catch (e) { row.error = short(String(e)); }
    if (!row.owned) {
      try { row.cost = ns.corporation.getUnlockCost(name); } catch (e) { /* price is a nicety */ }
    }
    frag.unlocksList.push(row);
  }

  frag.upgradesList = [];
  for (const name of (K && K.upgradeNames) || []) {
    const row = { name, level: null, nextCost: null };
    try { row.level = ns.corporation.getUpgradeLevel(name); } catch (e) { row.error = short(String(e)); }
    try { row.nextCost = ns.corporation.getUpgradeLevelCost(name); } catch (e) { /* nicety */ }
    frag.upgradesList.push(row);
  }

  // ---- one record per division -------------------------------------------
  frag.divisions = [];
  for (const name of info.divisions) {
    try {
      const d = ns.corporation.getDivision(name);
      frag.divisions.push({
        name: d.name,
        industry: d.industry,
        awareness: d.awareness,
        popularity: d.popularity,
        productionMult: d.productionMult,
        researchPoints: d.researchPoints,
        numAdVerts: d.numAdVerts,
        cities: d.cities,
        products: d.products,
        makesProducts: d.makesProducts,
        maxProducts: d.maxProducts,
        lastCycleRevenue: d.lastCycleRevenue,
        lastCycleExpenses: d.lastCycleExpenses,
        thisCycleRevenue: d.thisCycleRevenue,
        thisCycleExpenses: d.thisCycleExpenses,
      });
    } catch (e) {
      frag.divisions.push({ name, error: short(String(e)) });
    }
  }

  write(ns, frag);
}

function write(ns, frag) {
  try { ns.write(OUT_FILE, JSON.stringify(frag), "w"); }
  catch (e) { ns.tprint(`corp-scan-corp: could not write ${OUT_FILE}: ${e}`); }
  ns.print(`wrote ${OUT_FILE} (${frag.errors.length} error(s)).`);
}

function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 160); }
