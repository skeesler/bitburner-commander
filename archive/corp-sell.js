/** @param {NS} ns
 *
 *  CORP SELL — put standing sell orders on a division's output materials. 21.6GB.
 *
 *      run corp-sell.js [--materials "Plants,Food"] [--price MP] [--amount MAX]
 *                       [--division NAME] [--clear] [--dry]
 *
 *  WITHOUT THIS YOU EARN NOTHING. A material's sell amount defaults to 0, so a division can be
 *  fully staffed, stocked and producing while revenue sits at exactly $0.00/s and output piles
 *  up until the warehouse jams. Sell orders are not automatic and there is no default.
 *
 *  Run this BEFORE corp-buy.js. Ordering matters: if inputs arrive while outputs have nowhere
 *  to go, the warehouse fills with product, production halts, and you get to diagnose a
 *  congestion stall instead of watching money arrive.
 *
 *  amt and price are STRINGS and accept the game's little expression language:
 *    amount  "MAX"  sell everything produced   |  "PROD/2"  half of production   |  "100"
 *    price   "MP"   market price               |  "MP*1.1"  10% over market      |  "0" DUMP
 *  "MP" is the right answer until Market-TA2 exists; it always clears at a fair price. Setting
 *  price to "0" forces a ~1e12 markup multiplier, which sells everything instantly — that's the
 *  documented way to dump a congested warehouse, not a pricing strategy.
 *
 *  Agriculture produces Plants AND Food; both are worth selling in round 1. From round 3 you
 *  will want to keep Plants for export to Tobacco instead — that's a --materials change, not a
 *  code change.
 *
 *  RAM: sellMaterial (20) + 1.6 base = 21.6GB. Materials come from a flag rather than
 *  getIndustryData precisely so this stays at the one-charged-function floor.
 */

const DIVISION = "Agriculture";
const STATE_FILE = "corp-state.txt";
const MATERIALS = "Plants,Food";   // Agriculture's producedMaterials
const PRICE = "MP";
const AMOUNT = "MAX";

export async function main(ns) {
  const opts = ns.flags([
    ["materials", MATERIALS], ["price", PRICE], ["amount", AMOUNT],
    ["division", ""], ["clear", false], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const division = resolveDivision(ns, opts.division);
  const mats = String(opts.materials).split(",").map((s) => s.trim()).filter(Boolean);
  if (!mats.length) { ns.tprint("\nNo materials given."); return; }

  // --clear stops selling: amount 0. (Price is irrelevant once amount is 0, but must be a string.)
  const amount = opts.clear ? "0" : String(opts.amount);
  const price = opts.clear ? "MP" : String(opts.price);

  const cities = Object.values(ns.enums.CityName);
  const done = [], failed = [];

  for (const city of cities) {
    for (const mat of mats) {
      if (opts.dry) { done.push(`${city}/${mat} -> ${amount} @ ${price}`); continue; }
      try {
        ns.corporation.sellMaterial(division, city, mat, amount, price);
        done.push(`${city}/${mat}`);
      } catch (e) {
        const msg = String(e);
        if (/no division named/i.test(msg)) { abortNoDivision(ns, division); return; }
        failed.push(`${city}/${mat} (${short(msg)})`);
      }
    }
  }

  ns.tprint(
    `\n===== corp-sell: ${division} ${opts.dry ? "(DRY RUN)" : ""}=====\n` +
    (opts.clear
      ? `  CLEARED sell orders on: ${mats.join(", ")}\n`
      : `  selling ${mats.join(", ")} at amount "${amount}", price "${price}"\n`) +
    `  set:    ${done.length} order(s) across ${cities.length} cities\n` +
    `  failed: ${failed.length ? failed.join("; ") : "(none)"}\n` +
    (opts.dry ? "  [dry] nothing changed.\n" :
      `\n  Sales happen in the SALE state, so revenue appears within a cycle (~10s).\n` +
      `  Next: run corp-buy.js — nothing is produced until inputs are being bought.\n`) +
    `=====`
  );
}

function abortNoDivision(ns, division) {
  ns.tprint(`\nABORT: no division named "${division}".\n  run corp-status.js\n`);
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
    "\ncorp-sell.js — standing sell orders on output materials (21.6GB).\n" +
    "  run corp-sell.js                          sell Plants + Food at market price, all cities\n" +
    "  run corp-sell.js --materials \"Plants\"     just one\n" +
    "  run corp-sell.js --price \"MP*1.1\"         10% over market\n" +
    "  run corp-sell.js --clear                  stop selling (amount 0)\n" +
    "  run corp-sell.js --materials \"Plants\" --price 0    DUMP stock to unjam a warehouse\n" +
    "  Without a sell order, revenue is $0 no matter how much you produce.\n"
  );
}
