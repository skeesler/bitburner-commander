/** @param {NS} ns
 *
 *  CORP CITIES — open a division's office in all six cities. 21.6GB.
 *
 *      run corp-cities.js [--division Agriculture] [--dry]
 *
 *  One of the two low-RAM pieces of the round-1 bootstrap, for when corp-boot.js (121.6GB)
 *  won't fit. Pair it with corp-warehouses.js (31.6GB). Between them they cover the tedious
 *  part — 6 cities x 2 operations — while corporation creation and the initial industry
 *  expansion are each a single click in the City Hall / division UI and cost no script RAM
 *  at all. Do those two by hand, run these two, done.
 *
 *  WHY SO CHEAP: RAM is charged per DISTINCT ns.corporation function a script mentions
 *  (10GB info / 20GB action), and the runtime enforces the same budget again on first call,
 *  so there is no way to dodge it — only to mention fewer functions per script. This file
 *  mentions exactly one charged function: expandCity. That is the floor.
 *
 *  It leans on expandCity being SELF-REPORTING: it throws both when the office already
 *  exists ("You have already expanded into X") and when funds are short ("You don't have
 *  enough company funds"), so we need no getter alongside it to stay idempotent. Contrast
 *  purchaseWarehouse, which fails SILENTLY — see corp-warehouses.js.
 *
 *  Safe to re-run. Cities already open are reported and skipped.
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

  // ns.enums is excluded from the RAM cost table — free, and authoritative for city names.
  const cities = Object.values(ns.enums.CityName);
  const opened = [], already = [], failed = [];

  for (const city of cities) {
    if (opts.dry) { ns.tprint(`[dry] would try to open an office in ${city}.`); continue; }
    try {
      ns.corporation.expandCity(division, city);
      opened.push(city);
    } catch (e) {
      const msg = String(e);
      if (/already expanded/i.test(msg)) already.push(city);
      else if (/no division named/i.test(msg)) {
        // Wrong division name — retrying 5 more times just prints the same error 5 more times.
        ns.tprint(
          `\nABORT: this corporation has no division named "${division}".\n\n` +
          `  Two different causes — corp-status.js tells you which:\n\n` +
          `  1. NO DIVISIONS AT ALL. A new corporation starts empty; creating it and expanding\n` +
          `     into an industry are separate steps. If corp-status.js prints "(none)", that's\n` +
          `     this, and no --division value can help:\n` +
          `         run corp-division.js                   # Agriculture, ~$40b (21.6GB)\n\n` +
          `  2. DIFFERENT NAME. Division names are whatever you typed when expanding, and need\n` +
          `     not match the industry, so the "${DIVISION}" default is only a guess:\n` +
          `         run corp-status.js                     # lists real names + records them\n` +
          `         run corp-cities.js --division "NAME"   # quote anything with spaces\n`
        );
        return;
      }
      else if (/enough/i.test(msg)) {
        // Out of funds — every remaining city will fail the same way, so stop cleanly.
        failed.push(`${city} (insufficient funds — stopping)`);
        break;
      } else failed.push(`${city} (${short(msg)})`);
    }
  }

  if (opts.dry) { ns.tprint("\n[dry] nothing spent."); return; }

  ns.tprint(
    `\n===== corp-cities: ${division} =====\n` +
    `  opened:  ${opened.length ? opened.join(", ") : "(none)"}\n` +
    `  already: ${already.length ? already.join(", ") : "(none)"}\n` +
    `  failed:  ${failed.length ? failed.join("; ") : "(none)"}\n` +
    `  ${opened.length + already.length}/6 cities have an office.\n` +
    (opened.length + already.length === 6
      ? `  Next: run corp-warehouses.js --division ${division}\n`
      : `  Re-run once funds recover — finished cities are skipped.\n`) +
    `=====`
  );
}

/** Trim a thrown Netscript error to something that fits one line. */
function short(msg) {
  return msg.replace(/\s+/g, " ").slice(0, 110);
}

/** Which division? Explicit flag > corp-state.txt (written by corp-status.js) > built-in guess.
 *  ns.read costs 0GB, so consulting the state file keeps this script at its 21.6GB floor. */
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
    "\ncorp-cities.js — open a division's office in all 6 cities (21.6GB).\n" +
    "  run corp-cities.js                      use division \"" + DIVISION + "\"\n" +
    "  run corp-cities.js --division X         a different division\n" +
    "  run corp-cities.js --dry                preview, spend nothing\n" +
    "  Costs $4b per city. Safe to re-run. Then: corp-warehouses.js\n"
  );
}
