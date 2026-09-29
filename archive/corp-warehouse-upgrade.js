/** @param {NS} ns
 *
 *  CORP WAREHOUSE UPGRADE — raise warehouse levels across a division's cities. 31.6GB.
 *
 *      run corp-warehouse-upgrade.js [--level N | --add N] [--division NAME] [--dry]
 *
 *  WHY THIS ISN'T ON THE CORPORATION "UPGRADES" PANEL: Warehouse, Office and Advert are the
 *  three SPECIAL upgrades. Everything on that panel (Smart Storage, Smart Factories, Wilson,
 *  …) is corporation-wide and uses the shared BasePrice * PriceMult^level formula. These three
 *  apply to a single division — Warehouse to a single CITY — and have their own formulas, so
 *  they live in the division's city view instead. Nothing is missing; it's a different screen.
 *
 *  Warehouse cost is also the odd one out: the exponent is level+1, not level.
 *      cost = 1e9 * 1.07^(level+1)
 *  So level 1->2 is ~$1.14b and it climbs about 7% per level. Size is
 *      size = level * 100 * SmartStorageMultiplier * ResearchMultiplier
 *  which is why Smart Storage and warehouse levels are the round-1 priority pair: Smart Storage
 *  multiplies every warehouse at once, warehouse levels raise the thing being multiplied.
 *
 *  ORDER MATTERS: do this BEFORE buying boost materials. A level-1 warehouse holds ~100-120
 *  units, and boost materials are what you want to fill that space with — buying them first
 *  just means buying again after every upgrade.
 *
 *  RAM: upgradeWarehouse (20) + getWarehouse (10) + 1.6 base = 31.6GB.
 */

const DIVISION = "Agriculture";
const STATE_FILE = "corp-state.txt";
const ADD = 1;

export async function main(ns) {
  const opts = ns.flags([
    ["level", 0],       // grow every warehouse UP TO this level
    ["add", 0],         // or add this many levels to each
    ["division", ""], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  if (opts.level && opts.add) {
    ns.tprint("\nPass either --level (target) or --add (increment), not both.");
    return;
  }
  const add = opts.level ? 0 : (opts.add || ADD);

  const division = resolveDivision(ns, opts.division);
  const cities = Object.values(ns.enums.CityName);
  const done = [], already = [], failed = [], missing = [];

  for (const city of cities) {
    let wh;
    try {
      wh = ns.corporation.getWarehouse(division, city);
    } catch (e) {
      if (/no division named/i.test(String(e))) { abortNoDivision(ns, division); return; }
      missing.push(city);
      continue;
    }

    const want = opts.level ? opts.level - wh.level : add;
    if (want <= 0) { already.push(`${city}(lvl ${wh.level})`); continue; }
    if (opts.dry) { done.push(`${city} lvl ${wh.level}->${wh.level + want}`); continue; }

    try {
      ns.corporation.upgradeWarehouse(division, city, want);
      const after = ns.corporation.getWarehouse(division, city);
      if (after.level > wh.level) {
        done.push(`${city} lvl ${wh.level}->${after.level} (size ${fmtNum(after.size)})`);
      } else {
        // upgradeWarehouse can decline quietly when funds are short — verify, don't assume.
        failed.push(`${city} (no change — corp funds likely short; stopping)`);
        break;
      }
    } catch (e) {
      const msg = String(e);
      failed.push(`${city} (${short(msg)})`);
      if (/fund|money|afford/i.test(msg)) break;   // funds are corp-wide; the rest will fail too
    }
  }

  ns.tprint(
    `\n===== corp-warehouse-upgrade: ${division} ${opts.dry ? "(DRY RUN)" : ""}=====\n` +
    `  upgraded:  ${done.length ? "\n    " + done.join("\n    ") : "(none)"}\n` +
    `  at target: ${already.length ? already.join(", ") : "(none)"}\n` +
    `  no warehouse: ${missing.length ? missing.join(", ") + " — run corp-warehouses.js" : "(none)"}\n` +
    `  failed:    ${failed.length ? failed.join("; ") : "(none)"}\n` +
    (opts.dry ? "  [dry] nothing spent.\n" : "") +
    `=====`
  );
}

function abortNoDivision(ns, division) {
  ns.tprint(`\nABORT: no division named "${division}".\n` +
    `  run corp-status.js    # list real names and record them\n`);
}

function short(msg) { return msg.replace(/\s+/g, " ").slice(0, 110); }
function fmtNum(n) { return Number.isFinite(n) ? n.toFixed(0) : "?"; }

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
    "\ncorp-warehouse-upgrade.js — raise warehouse levels in every city (31.6GB).\n" +
    "  run corp-warehouse-upgrade.js              add 1 level to each of the 6 warehouses\n" +
    "  run corp-warehouse-upgrade.js --add 5      add 5 levels to each\n" +
    "  run corp-warehouse-upgrade.js --level 10   grow each UP TO level 10\n" +
    "  run corp-warehouse-upgrade.js --dry        preview, spend nothing\n" +
    "  Warehouse is a per-CITY upgrade, which is why it isn't on the corporation Upgrades panel.\n" +
    "  Do this before buying boost materials — they need the space.\n"
  );
}
