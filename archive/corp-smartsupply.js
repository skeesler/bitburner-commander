/** @param {NS} ns
 *
 *  CORP SMART SUPPLY — switch on the Smart Supply you already paid for. 51.6GB.
 *
 *      run corp-smartsupply.js                 # enable on every warehouse, option "imports"
 *      run corp-smartsupply.js --off           # hand the buying back to corp-supply.js
 *      run corp-smartsupply.js --option leftovers
 *      run corp-smartsupply.js --dry           # show what it would change
 *
 *  OWNING THE UNLOCK DOES NOTHING. "Smart Supply" is a $25b corporation unlock, but buying it
 *  only grants the ABILITY — every warehouse still has it switched off until setSmartSupply is
 *  called for that division and city. It is entirely possible (and was true here) to have paid
 *  the $25b and be running fully manual purchasing in all twelve warehouses.
 *
 *  WHY IT BEATS corp-supply.js NOW THAT YOU OWN IT. buyMaterial sets a STANDING per-second rate
 *  that persists forever until something rewrites it. That is the failure mode that keeps
 *  stranding cities: production jams, the controller correctly drops the rate to 0, the jam is
 *  later cleared — and the rate stays 0 for eternity unless a controller is alive to recompute
 *  it. Smart Supply is computed by the GAME every PURCHASE state (Division.ts:497-503):
 *
 *      mat.buyAmount = reqMat * warehouse.smartSupplyStore     // exactly one cycle of inputs
 *      buyAmt = min(buyAmt, freeWarehouseSpace / unitSize)     // and it cannot overfill
 *
 *  so there is no standing rate to go stale and nothing to keep resident. corp-supply.js was
 *  written precisely because corp-design.md skipped this unlock to save round-1 budget; that
 *  trade is over the moment you own it.
 *
 *  THE OPTION MATTERS WHEN YOU HAVE EXPORTS (Division.ts:553-565):
 *      "imports"    buy one cycle of inputs MINUS what arrives by export. Correct for any
 *                   division fed by a sister division — without it you buy what you are already
 *                   being sent, at quality 1, diluting the very material you built the support
 *                   division to make properly. This is the default here.
 *      "leftovers"  buy one cycle of inputs MINUS what is already in the warehouse. Better when
 *                   nothing is exported to you and stock tends to accumulate.
 *      "none"       buy the full cycle regardless.
 *
 *  The game applies exactly one of these per material, so pick by whether that material is
 *  imported. Materials the industry doesn't use are skipped (the call throws; we catch it),
 *  which is why this needs no getIndustryData and stays at three charged functions.
 *
 *  RAM: setSmartSupply (20) + setSmartSupplyOption (20) + getWarehouse (10) + 1.6 = 51.6GB.
 */

const STATE_FILE = "corp-state.txt";
// FIELD-CORRECTED DEFAULT. "imports" subtracts only the FLOW of arriving exports, so whenever
// that flow dips to zero Smart Supply buys the full requirement at quality 1 — which keeps the
// destination's inventory high, which drives the export formula negative (it ships what the far
// end BURNS, minus a tenth of its stock), which keeps the flow at zero. A self-sustaining
// deadlock that quietly replaces high-quality imported material with quality-1 purchases: seen
// live in Chemical/Ishima and Chemical/Volhaven, whose Chemicals fell to quality 411 and 290
// while cities with a working import held 777.
//   "leftovers" subtracts the STOCK instead, so any imported material already in the warehouse
// suppresses the purchase, and the export is free to resume. Right for an export-fed division,
// and no worse anywhere else.
const OPTION = "leftovers";
const OPTIONS = ["leftovers", "imports", "none"];

export async function main(ns) {
  const opts = ns.flags([
    ["divisions", ""], ["option", OPTION], ["off", false], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const option = String(opts.option).toLowerCase();
  if (!OPTIONS.includes(option)) {
    ns.tprint(`\nUnknown option "${opts.option}". Use one of: ${OPTIONS.join(", ")}`);
    return;
  }

  const divisions = resolveDivisions(ns, opts.divisions);
  if (!divisions.length) {
    ns.tprint("\ncorp-smartsupply: no divisions known.\n" +
      "  run corp-status.js            # records them in corp-state.txt\n" +
      "  ...or pass --divisions \"Agriculture,Chemical\"\n");
    return;
  }

  // getConstants is 0GB and is the honest source of material names — never hardcode them.
  let materialNames = [];
  try { materialNames = ns.corporation.getConstants().materialNames || []; } catch (e) { /* none */ }

  const want = !opts.off;
  const changed = [], already = [], missing = [], failed = [];
  let optionsSet = 0;

  for (const division of divisions) {
    for (const city of Object.values(ns.enums.CityName)) {
      let wh;
      try { wh = ns.corporation.getWarehouse(division, city); }
      catch (e) {
        if (/no division named/i.test(String(e))) {
          ns.tprint(`\nABORT: no division named "${division}".\n  run corp-status.js\n`);
          return;
        }
        missing.push(`${division}/${city}`);
        continue;
      }

      const where = `${division}/${city}`;
      if (wh.smartSupplyEnabled === want) { already.push(where); }
      else if (opts.dry) { changed.push(`[dry] ${where} -> ${want ? "ON" : "OFF"}`); }
      else {
        try {
          ns.corporation.setSmartSupply(division, city, want);
          // setSmartSupply is not documented as silent-failing, but verifying costs nothing
          // extra here — getWarehouse is already paid for — and a "done" that isn't is worse
          // than an error (the corp-warehouses.js lesson).
          const after = ns.corporation.getWarehouse(division, city);
          if (after.smartSupplyEnabled === want) changed.push(`${where} -> ${want ? "ON" : "OFF"}`);
          else failed.push(`${where} (no change — is the Smart Supply unlock owned?)`);
        } catch (e) {
          failed.push(`${where} (${short(e)})`);
          continue;
        }
      }

      // Per-material option only matters while Smart Supply is on.
      if (!want || opts.dry) continue;
      for (const mat of materialNames) {
        try { ns.corporation.setSmartSupplyOption(division, city, mat, option); optionsSet++; }
        catch (e) { /* not an input of this industry — expected for most of the 12 */ }
      }
    }
  }

  ns.tprint(
    `\n===== corp-smartsupply ${opts.dry ? "(DRY RUN)" : ""}=====\n` +
    `  target:   Smart Supply ${want ? "ON" : "OFF"}` +
    (want ? `, option "${option}"` : "") + `\n` +
    `  changed:  ${changed.length ? "\n    " + changed.join("\n    ") : "(none)"}\n` +
    `  already:  ${already.length ? already.length + " warehouse(s)" : "(none)"}\n` +
    `  no warehouse: ${missing.length ? missing.join(", ") : "(none)"}\n` +
    `  failed:   ${failed.length ? "\n    " + failed.join("\n    ") : "(none)"}\n` +
    (want && !opts.dry ? `  material options set: ${optionsSet}\n` : "") +
    (opts.dry ? "  [dry] nothing changed.\n" :
      want
        ? `\n  The game now sizes every input purchase itself, every cycle, and clamps it to free\n` +
          `  warehouse space — so a buy rate can no longer go stale and strand a city at zero.\n` +
          `  You can stop the custom controller once you've confirmed it's working:\n` +
          `      run corp-report.js                      # look for "smartSupply ON" per city\n` +
          `      run corp-conductor.js --no-supply       # ...then drop the 51.6GB resident\n`
        : `\n  Buying is manual again — something must recompute the rates or they go stale:\n` +
          `      run corp-conductor.js\n`) +
    `=====`
  );
}

/** Explicit flag > corp-state.txt. ns.read is 0GB, so this is free. */
function resolveDivisions(ns, flagValue) {
  if (flagValue) return String(flagValue).split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (Array.isArray(st.divisions) && st.divisions.length) return st.divisions;
    }
  } catch (e) { /* fall through */ }
  return [];
}

function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 140); }

function printHelp(ns) {
  ns.tprint(
    "\ncorp-smartsupply.js — switch on the Smart Supply unlock, per warehouse (51.6GB).\n" +
    "  run corp-smartsupply.js                enable everywhere, option \"imports\"\n" +
    "  run corp-smartsupply.js --option leftovers    subtract stock instead of imports\n" +
    "  run corp-smartsupply.js --off          back to manual rates (corp-supply.js)\n" +
    "  run corp-smartsupply.js --dry          preview, change nothing\n" +
    "  Owning the $25b unlock does NOTHING until it is enabled on each warehouse. Once on,\n" +
    "  the game sizes every purchase itself each cycle, so rates can't go stale.\n"
  );
}
