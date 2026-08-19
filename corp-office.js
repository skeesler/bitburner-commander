/** @param {NS} ns
 *
 *  CORP OFFICE — grow every office of a division to a target size. 31.6GB.
 *
 *      run corp-office.js [--size 4] [--division NAME] [--dry]
 *
 *  Offices start at size 3 (corpConstants.officeInitialSize) and hold no employees at all
 *  until you hire. Round 1 wants size 4 in all six cities — small, because the budget is
 *  better spent on Smart Storage and warehouse levels at this stage. Round 2 wants 8.
 *
 *  upgradeOfficeSize takes an INCREMENT, not a target, so this reads the current size and
 *  asks only for the difference — which is also what makes it safe to re-run. Doing this by
 *  API rather than through the UI is the whole reason the official advice says to script it:
 *  the UI only offers fixed jumps, the API gives exact sizes.
 *
 *  RAM: upgradeOfficeSize (20) + getOffice (10) + 1.6 base = 31.6GB.
 *  Deliberately NOT bundled with hiring or job assignment — one more charged function would
 *  push this past what a 64GB home can load alongside the hacking rig. See corp-design.md.
 */

const DIVISION = "Agriculture";
const STATE_FILE = "corp-state.txt";
const SIZE = 4;   // round-1 target; round 2 wants 8

export async function main(ns) {
  const opts = ns.flags([
    ["size", SIZE], ["division", ""], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const division = resolveDivision(ns, opts.division);
  const target = opts.size;
  const cities = Object.values(ns.enums.CityName);
  const grown = [], already = [], failed = [], missing = [];

  for (const city of cities) {
    let office;
    try {
      office = ns.corporation.getOffice(division, city);
    } catch (e) {
      if (/no division named/i.test(String(e))) { abortNoDivision(ns, division); return; }
      missing.push(city);   // no office in this city yet
      continue;
    }

    const need = target - office.size;
    if (need <= 0) { already.push(`${city}(${office.size})`); continue; }
    if (opts.dry) { grown.push(`${city} ${office.size}->${target}`); continue; }

    try {
      ns.corporation.upgradeOfficeSize(division, city, need);
      grown.push(`${city} ${office.size}->${target}`);
    } catch (e) {
      const msg = String(e);
      failed.push(`${city} (${short(msg)})`);
      // Funds are corporation-wide, so if one city can't afford it none of the rest can.
      if (/fund|money|afford/i.test(msg)) break;
    }
  }

  ns.tprint(
    `\n===== corp-office: ${division} -> size ${target} ${opts.dry ? "(DRY RUN)" : ""}=====\n` +
    `  grown:     ${grown.length ? grown.join(", ") : "(none)"}\n` +
    `  already:   ${already.length ? already.join(", ") : "(none)"}\n` +
    `  no office: ${missing.length ? missing.join(", ") + " — run corp-cities.js" : "(none)"}\n` +
    `  failed:    ${failed.length ? failed.join("; ") : "(none)"}\n` +
    (opts.dry ? "  [dry] nothing spent.\n" :
      `\n  Next: run corp-hire.js   # fill the offices (hires straight into R&D)\n`) +
    `=====`
  );
}

function abortNoDivision(ns, division) {
  ns.tprint(`\nABORT: no division named "${division}".\n` +
    `  run corp-status.js    # list real names and record them\n` +
    `  run corp-division.js  # if you have no divisions at all yet\n`);
}

function short(msg) { return msg.replace(/\s+/g, " ").slice(0, 110); }

/** Explicit flag > corp-state.txt > built-in guess. ns.read is 0GB, so this is free. */
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
    "\ncorp-office.js — grow a division's offices to a target size (31.6GB).\n" +
    "  run corp-office.js                 grow every office to " + SIZE + " (round 1)\n" +
    "  run corp-office.js --size 8        round 2 target\n" +
    "  run corp-office.js --division X    override the division name\n" +
    "  run corp-office.js --dry           preview, spend nothing\n" +
    "  Safe to re-run; offices already at or above the target are left alone.\n"
  );
}
