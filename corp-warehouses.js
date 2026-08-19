/** @param {NS} ns
 *
 *  CORP WAREHOUSES — buy a warehouse in every city a division has an office in. 31.6GB.
 *
 *      run corp-warehouses.js [--division Agriculture] [--dry]
 *
 *  The second low-RAM piece of the round-1 bootstrap; run corp-cities.js first. Together
 *  they replace corp-boot.js (121.6GB) on a small home — see corp-cities.js for the why.
 *
 *  WHY THIS ONE COSTS 10GB MORE THAN ITS SIBLING: purchaseWarehouse FAILS SILENTLY. From
 *  Actions.ts:425-427 it simply returns — no throw, no return value — when funds are short
 *  OR when the warehouse already exists:
 *
 *      if (corp.funds < corpConstants.warehouseInitialCost) return;
 *      if (division.warehouses[city]) return;
 *
 *  So a try/catch tells us nothing and a "success" message would be a lie. We pay 10GB for
 *  hasWarehouse and check BEFORE (to skip and stay idempotent) and AFTER (to prove the buy
 *  actually landed). That check is the whole point of this script — without it a silent
 *  no-op looks identical to a purchase, and you'd discover the missing warehouses much
 *  later, as a division mysteriously producing nothing.
 *
 *  Safe to re-run. $5b per warehouse. Sector-12's came free with the division.
 *
 *  NOTE: does not write corp-state.txt (that needs getCorporation, +10GB). Run corp-boot.js
 *  once home RAM allows, or we'll add a small corp-status.js.
 */

const DIVISION = "Agriculture";   // last-resort default if nothing else identifies the division
const STATE_FILE = "corp-state.txt";

export async function main(ns) {
  const opts = ns.flags([["division", ""], ["dry", false], ["help", false]]);
  if (opts.help) { printHelp(ns); return; }
  const division = resolveDivision(ns, opts.division);

  const cities = Object.values(ns.enums.CityName);
  const bought = [], already = [], failed = [], noOffice = [];

  for (const city of cities) {
    // hasWarehouse throws if the division has no office in this city at all — that's a
    // "run corp-cities.js first" situation, not a failure worth alarming about.
    let has;
    try {
      has = ns.corporation.hasWarehouse(division, city);
    } catch (e) {
      if (/no division named/i.test(String(e))) {
        ns.tprint(
          `\nABORT: this corporation has no division named "${division}".\n\n` +
          `  Two different causes — corp-status.js tells you which:\n\n` +
          `  1. NO DIVISIONS AT ALL. Creating the corporation and expanding into an industry are\n` +
          `     separate steps. If corp-status.js prints "(none)", no --division value can help:\n` +
          `         run corp-division.js                       # Agriculture, ~$40b (21.6GB)\n\n` +
          `  2. DIFFERENT NAME. Names are whatever you typed when expanding:\n` +
          `         run corp-status.js                         # lists real names + records them\n` +
          `         run corp-warehouses.js --division "NAME"   # quote anything with spaces\n`
        );
        return;
      }
      noOffice.push(city);
      continue;
    }
    if (has) { already.push(city); continue; }
    if (opts.dry) { ns.tprint(`[dry] would buy a warehouse in ${city} ($5b).`); continue; }

    try { ns.corporation.purchaseWarehouse(division, city); }
    catch (e) { failed.push(`${city} (${short(String(e))})`); continue; }

    // The silent-failure guard: it only counts if it's actually there now.
    let landed = false;
    try { landed = ns.corporation.hasWarehouse(division, city); } catch (e) { landed = false; }
    if (landed) bought.push(city);
    else {
      // Almost always insufficient funds. Every later city would fail identically, so stop.
      failed.push(`${city} (no-op — almost certainly under $5b of corp funds; stopping)`);
      break;
    }
  }

  if (opts.dry) { ns.tprint("\n[dry] nothing spent."); return; }

  const have = bought.length + already.length;
  ns.tprint(
    `\n===== corp-warehouses: ${division} =====\n` +
    `  bought:    ${bought.length ? bought.join(", ") : "(none)"}\n` +
    `  already:   ${already.length ? already.join(", ") : "(none)"}\n` +
    `  no office: ${noOffice.length ? noOffice.join(", ") + " — run corp-cities.js first" : "(none)"}\n` +
    `  failed:    ${failed.length ? failed.join("; ") : "(none)"}\n` +
    `  ${have}/6 cities have a warehouse.\n` +
    (have === 6 && noOffice.length === 0
      ? `  Round-1 skeleton is COMPLETE. Next: staff the offices (corp-office.js),\n` +
        `  and restart the hacking rig with: run boot.js\n`
      : `  Not finished — re-run once funds recover; finished cities are skipped.\n`) +
    `=====`
  );
}

/** Trim a thrown Netscript error to something that fits one line. */
function short(msg) {
  return msg.replace(/\s+/g, " ").slice(0, 110);
}

/** Which division? Explicit flag > corp-state.txt (written by corp-status.js) > built-in guess.
 *  ns.read costs 0GB, so consulting the state file keeps this script at its 31.6GB floor. */
function resolveDivision(ns, flagValue) {
  if (flagValue) return flagValue;
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (st.roles && st.roles.material) return st.roles.material;
      if (Array.isArray(st.divisions) && st.divisions.length === 1) return st.divisions[0];
    }
  } catch (e) { /* missing or malformed — fall through to the default */ }
  return DIVISION;
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-warehouses.js — buy a warehouse in each of a division's cities (31.6GB).\n" +
    "  run corp-warehouses.js                  use division \"" + DIVISION + "\"\n" +
    "  run corp-warehouses.js --division X     a different division\n" +
    "  run corp-warehouses.js --dry            preview, spend nothing\n" +
    "  Costs $5b each. Run corp-cities.js first. Safe to re-run.\n"
  );
}
