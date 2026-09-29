/** @param {NS} ns
 *
 *  CORP BOOT — the one-shot structural bootstrap for the BN3 corporation.
 *
 *      run corp-boot.js [--name NAME] [--self-fund] [--industry Agriculture]
 *                       [--division Agriculture] [--dry]
 *
 *  Builds the round-1 skeleton and nothing else:
 *    1. Creates the corporation (SEED MONEY by default — see the trap below).
 *    2. Expands into Agriculture.
 *    3. Expands to the five cities that aren't Sector-12.
 *    4. Buys a warehouse in each of those five.
 *  Then writes corp-state.txt for the rest of the rig and prints what's left to do.
 *
 *  It does NOT staff the offices — hiring, office size, and job assignment belong to
 *  corp-office.js. See corp-design.md for why the rig is split into small modules
 *  (short version: the corporation API is charged 10GB per info call and 20GB per
 *  action call just for being MENTIONED, so one module at a time keeps peak RAM at
 *  ~145GB instead of ~700GB).
 *
 *  WON'T FIT? 121.6GB is more than a small home has. Do the same job in pieces instead:
 *    1. Create the corporation by hand — City Hall, Sector-12, "Use seed money" (BN3 only).
 *       Free, one dialog, and it saves this script's most expensive call.
 *    2. run corp-division.js     (21.6GB) — expands into Agriculture (~$40b)
 *    3. run corp-status.js       (21.6GB) — records the division name for the rest
 *    4. run corp-cities.js       (21.6GB) — opens the other 5 offices
 *    5. run corp-warehouses.js   (31.6GB) — buys the 5 warehouses, and VERIFIES them
 *  Pausing the rig with reset-scripts.js frees the RAM, then `run boot.js` restores it.
 *
 *  NB: creating the corporation and expanding into an industry are SEPARATE steps. A brand
 *  new corporation has zero divisions, and everything downstream needs one to act on.
 *
 *  RAM: ~121.6GB. Every ns.corporation.* name below is a deliberate purchase —
 *  createCorporation/expandIndustry/expandCity/purchaseWarehouse at 20GB each, and
 *  getCorporation/getDivision/getIndustryData/hasWarehouse at 10GB each. hasCorporation,
 *  canCreateCorporation, getConstants and ns.enums are all free. Don't add calls casually.
 *
 *  SAFE TO RE-RUN. Every step checks whether it's already done and skips it, and every
 *  purchase is budget-guarded — so if funds run out partway (or you interrupt it), just
 *  run it again and it picks up where it stopped.
 *
 *  Budget, if all goes to plan (costs read live from getConstants/getIndustryData):
 *    corp starts with     $150b
 *    Agriculture division  -$40b
 *    5 x expandCity        -$20b   (Sector-12's office is free with the division)
 *    5 x warehouse         -$25b   (Sector-12's warehouse is free too)
 *    left for round 1       $65b
 */

// ---- Defaults (all overridable by flag) ------------------------------------
const CORP_NAME = "Astarte Industries";
const INDUSTRY  = "Agriculture"; // best starting industry: realEstateFactor 0.72, and Real Estate is tiny (size 0.005)
const DIVISION  = "Agriculture"; // division name. "Overview" is forbidden by the game.
const STATE_FILE = "corp-state.txt";
const STATE_VERSION = 1;
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["name", CORP_NAME],
    ["self-fund", false],   // default OFF = seed money. See the trap in step 1.
    ["industry", INDUSTRY],
    ["division", DIVISION],
    ["dry", false],
    ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const c = ns.corporation;
  const industry = opts.industry;
  const division = opts.division;
  const selfFund = opts["self-fund"];
  const dry = opts.dry;
  const log = [];
  const say = (s) => { log.push(s); ns.print(s); };

  // ---- 1. The corporation itself ------------------------------------------
  // TRAP: ns.corporation.createCorporation(name, selfFund) defaults selfFund to TRUE.
  // Omitting the argument quietly spends $150b of YOUR money. We pass it explicitly,
  // always. Seed money is the locked default (corp-design.md): it costs nothing and the
  // corp still starts with $150b of funds — the government just keeps 500m shares, so we
  // own 1b of 1.5b. That trade is obvious in a node where hacking earns ~0.8% of normal.
  if (!c.hasCorporation()) {
    // canCreateCorporation returns a REASON STRING, not a boolean:
    // Success | NoSf3OrDisabled | CorporationExists | UseSeedMoneyOutsideBN3 | DisabledBySoftCap
    const check = c.canCreateCorporation(selfFund);
    if (check !== "Success") {
      ns.tprint(`ABORT: cannot create a corporation (${check}).` +
        (check === "UseSeedMoneyOutsideBN3" ? " Seed money is BN3-only — pass --self-fund." : ""));
      return;
    }
    if (dry) {
      say(`[dry] would create "${opts.name}" (${selfFund ? "SELF-FUND, costs you $150b" : "seed money, free"}).`);
    } else {
      // Returns false and logs the reason rather than throwing.
      if (!c.createCorporation(opts.name, selfFund)) {
        ns.tprint(`ABORT: createCorporation("${opts.name}", ${selfFund}) refused. Check the script log.`);
        return;
      }
      say(`created "${opts.name}" — ${selfFund ? "self-funded" : "seed money"}.`);
    }
  } else {
    say(`corporation already exists — skipping creation.`);
  }

  if (dry && !c.hasCorporation()) {
    // Nothing downstream can be inspected without a real corporation, so stop here
    // rather than print a fictional plan built on guesses.
    ns.tprint("\n[dry] no corporation yet, so the remaining steps can't be checked against the " +
      "live game (every getter past this point requires one). Re-run --dry after creation.");
    return;
  }

  const K = c.getConstants();
  const cityCost = K.officeInitialCost;
  const whCost = K.warehouseInitialCost;
  // ns.enums is excluded from the RAM cost table — free, and authoritative for city names.
  const cities = Object.values(ns.enums.CityName);

  let info = c.getCorporation();
  const fundsAtStart = info.funds;
  // totalShares tells us how it was funded even on a re-run: 1.5b = seed, 1b = self.
  const seeded = info.totalShares > K.initialShares;
  say(`funds $${fmt(ns, info.funds)} · ${info.totalShares / 1e9}b shares total, ` +
    `${info.numShares / 1e9}b ours (${seeded ? "seed-funded" : "self-funded"}).`);

  // ---- 2. The division ----------------------------------------------------
  // expandIndustry includes a FREE Sector-12 office AND warehouse (Division.ts:93-101),
  // so we only ever pay for the other five of each. Worth $9b.
  const indData = c.getIndustryData(industry);
  if (!info.divisions.includes(division)) {
    if (!afford(ns, c, indData.startingCost, `${industry} division`, say, dry)) return finish(ns, c, log, division, fundsAtStart, dry);
    if (dry) say(`[dry] would expand into ${industry} as "${division}" ($${fmt(ns, indData.startingCost)}).`);
    else {
      c.expandIndustry(industry, division);
      say(`expanded into ${industry} as "${division}" (-$${fmt(ns, indData.startingCost)}) ` +
        `— Sector-12 office + warehouse included free.`);
    }
  } else {
    say(`division "${division}" already exists — skipping.`);
  }
  if (dry && !c.getCorporation().divisions.includes(division)) {
    ns.tprint(`\n[dry] "${division}" doesn't exist yet, so city/warehouse state can't be read. ` +
      `Re-run --dry once it does.`);
    return;
  }

  // A useful sanity print: the published factor tables are stale in places (docs say Tobacco
  // robotFactor 0.25; v3.0.1 source says 0.2), so we read them from the game and show our work.
  say(`${industry} factors — realEstate ${indData.realEstateFactor}, science ${indData.scienceFactor}, ` +
    `advertising ${indData.advertisingFactor}, aiCore ${indData.aiCoreFactor}, ` +
    `hardware ${indData.hardwareFactor}, robot ${indData.robotFactor}.`);

  // ---- 3. Offices in the other five cities --------------------------------
  // All 6 cities is roughly a 36x production swing: productionMult sums each warehouse's
  // cityMult, so more cities multiply both the per-city output and the shared multiplier.
  let expanded = 0, skipped = 0;
  for (const city of cities) {
    if (c.getDivision(division).cities.includes(city)) { skipped++; continue; }
    if (!afford(ns, c, cityCost, `office in ${city}`, say, dry)) break;
    if (dry) { say(`[dry] would expand to ${city} ($${fmt(ns, cityCost)}).`); expanded++; continue; }
    c.expandCity(division, city);
    expanded++;
  }
  say(`offices: ${expanded} opened, ${skipped} already present.`);

  // ---- 4. Warehouses ------------------------------------------------------
  let bought = 0, had = 0;
  for (const city of c.getDivision(division).cities) {
    if (c.hasWarehouse(division, city)) { had++; continue; }
    if (!afford(ns, c, whCost, `warehouse in ${city}`, say, dry)) break;
    if (dry) { say(`[dry] would buy a warehouse in ${city} ($${fmt(ns, whCost)}).`); bought++; continue; }
    c.purchaseWarehouse(division, city);
    bought++;
  }
  say(`warehouses: ${bought} bought, ${had} already present.`);

  finish(ns, c, log, division, fundsAtStart, dry);
}

/** Write the state file the rest of the rig reads, then report. */
function finish(ns, c, log, division, fundsAtStart, dry) {
  const info = c.getCorporation();
  const div = info.divisions.includes(division) ? c.getDivision(division) : null;
  const cityCount = div ? div.cities.length : 0;
  const complete = cityCount === 6;

  if (!dry) {
    // Shape must match corp-status.js — the cheap modules read this file (ns.read is 0GB) to
    // learn the real division name instead of guessing "Agriculture".
    const state = {
      version: STATE_VERSION,
      round: 1,
      corp: info.name,
      seedFunded: info.totalShares > 1e9,
      divisions: info.divisions,          // every division name
      roles: { material: division },      // role -> name, so modules don't hardcode one
      bootComplete: complete,
    };
    try { ns.write(STATE_FILE, JSON.stringify(state, null, 2), "w"); }
    catch (e) { ns.tprint(`WARN: could not write ${STATE_FILE}: ${e}`); }
  }

  const spent = fundsAtStart - info.funds;
  ns.tprint(
    `\n===== corp-boot ${dry ? "(DRY RUN — nothing spent)" : ""} =====\n` +
    log.map((l) => `  ${l}`).join("\n") +
    `\n\n  spent this run: $${fmt(ns, spent)}` +
    `\n  funds now:      $${fmt(ns, info.funds)}` +
    `\n  cities:         ${cityCount}/6` +
    (complete
      ? `\n\n  Skeleton complete. Next: staff the offices with corp-office.js — upgrade to size 4,` +
        `\n  put all 4 employees on R&D until RP >= 55, then go 1/1/1/1 Ops/Eng/Bus/Mgmt.` +
        `\n  Then re-run corp-api.js to capture the live office/warehouse/material shapes.`
      : `\n\n  NOT finished — ${6 - cityCount} cit${6 - cityCount === 1 ? "y" : "ies"} still to open.` +
        `\n  Re-run corp-boot.js once funds recover; it resumes where it stopped.`) +
    `\n=====`
  );
}

/** Budget guard: is there room for this purchase? Reports the shortfall instead of throwing. */
function afford(ns, c, cost, what, say, dry) {
  if (dry) return true; // in a dry run funds never actually drop, so don't fake a shortfall
  const funds = c.getCorporation().funds;
  if (funds >= cost) return true;
  say(`STOP: need $${fmt(ns, cost)} for ${what}, only $${fmt(ns, funds)} left.`);
  return false;
}

// ns.formatNumber was REMOVED in 3.0.0 — it survives only as a tombstone that throws when
// called, so `typeof ns.formatNumber === "function"` passes and tells you nothing. The real
// name is ns.format.number() (free, 0GB). Same story for formatRam/formatPercent/tFormat/nFormat.
function fmt(ns, n) { return ns.format.number(n, 3); }

function printHelp(ns) {
  ns.tprint(
    "\ncorp-boot.js — one-shot structural bootstrap for the BN3 corporation.\n" +
    "  run corp-boot.js                 create with SEED MONEY, expand to 6 cities, buy 6 warehouses\n" +
    "  run corp-boot.js --self-fund     pay $150b of your own cash instead (keeps all 1b shares)\n" +
    "  run corp-boot.js --name \"X\"      corporation name (default \"" + CORP_NAME + "\")\n" +
    "  run corp-boot.js --industry X    starting industry (default " + INDUSTRY + ")\n" +
    "  run corp-boot.js --division X    division name (default " + DIVISION + ")\n" +
    "  run corp-boot.js --dry           preview, spend nothing\n" +
    "  Safe to re-run — it skips finished steps and resumes after a funds shortfall.\n" +
    "  Staffing is corp-office.js's job, not this script's. See corp-design.md.\n"
  );
}
