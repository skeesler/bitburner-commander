/** @param {NS} ns
 *
 *  CORP DIVISION — expand into an industry. 21.6GB.
 *
 *      run corp-division.js [--industry Agriculture] [--name Agriculture] [--dry]
 *
 *  The step between "you have a corporation" and "you have something to put in cities".
 *  Creating the corporation and expanding into an industry are SEPARATE actions — a fresh
 *  corporation has zero divisions, and corp-cities.js / corp-warehouses.js have nothing to
 *  act on until this has run.
 *
 *  Agriculture is the default for good reason: the highest realEstateFactor of any industry
 *  (0.72) combined with Real Estate's tiny unit size (0.005) means boost materials go further
 *  here than anywhere else, which is what dominates the early rounds. Costs $40b of the
 *  corporation's $150b, and includes a FREE Sector-12 office and warehouse.
 *
 *  The division NAME is yours to choose and is independent of the industry — but every other
 *  script has to refer to the division by it, so plain is kinder than clever. Whatever you
 *  pick, run corp-status.js afterwards to record it in corp-state.txt; the other modules read
 *  that file (free, ns.read is 0GB) instead of guessing.
 *
 *  RAM: expandIndustry (20) + 1.6 base = 21.6GB. One charged function, the floor for an action.
 */

const INDUSTRY = "Agriculture";
const NAME     = "Agriculture";   // division name; deliberately boring, see above

export async function main(ns) {
  const opts = ns.flags([
    ["industry", INDUSTRY],
    ["name", NAME],
    ["dry", false],
    ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const industry = opts.industry, name = opts.name;

  if (opts.dry) {
    ns.tprint(`\n[dry] would expand into ${industry} as division "${name}" (~$40b for Agriculture).\n` +
      `      Includes a free Sector-12 office + warehouse. Nothing spent.`);
    return;
  }

  try {
    ns.corporation.expandIndustry(industry, name);
  } catch (e) {
    const msg = String(e);
    let hint = "";
    if (/already in use/i.test(msg)) {
      hint = `\n  A division called "${name}" already exists — you may simply be done.\n` +
             `  Run corp-status.js to see what you have, then corp-cities.js.`;
    } else if (/not enough money/i.test(msg)) {
      hint = `\n  The CORPORATION's funds are short (this spends corp funds, not your wallet).\n` +
             `  Check them with corp-status.js.`;
    } else if (/invalid industry/i.test(msg)) {
      hint = `\n  Industry names are exact. Valid ones include: Agriculture, Chemical, Tobacco,\n` +
             `  Restaurant, Pharmaceutical, Software, Healthcare, Real Estate, Mining, Fishing,\n` +
             `  Refinery, Water Utilities, Computer Hardware, Robotics.`;
    } else if (/too many divisions/i.test(msg)) {
      hint = `\n  You're at the division cap (20 in BN3).`;
    } else if (/forbidden division name/i.test(msg)) {
      hint = `\n  "Overview" is reserved by the game's UI. Pick anything else.`;
    }
    ns.tprint(`\nFAILED to expand into ${industry}: ${msg}${hint}`);
    return;
  }

  ns.tprint(
    `\n===== corp-division =====\n` +
    `  Expanded into ${industry} as division "${name}".\n` +
    `  Sector-12 got a free office and warehouse; the other 5 cities are next.\n\n` +
    `  Next:\n` +
    `    run corp-status.js      # record the name so other scripts stop guessing\n` +
    `    run corp-cities.js      # open the other 5 offices  ($4b each)\n` +
    `    run corp-warehouses.js  # buy the 5 warehouses      ($5b each)\n` +
    `=====`
  );
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-division.js — expand the corporation into an industry (21.6GB).\n" +
    "  run corp-division.js                     " + INDUSTRY + " as \"" + NAME + "\" (~$40b)\n" +
    "  run corp-division.js --industry Chemical --name Chem\n" +
    "  run corp-division.js --dry               preview, spend nothing\n" +
    "  Names with spaces need quotes: --name \"My Division\"\n" +
    "  Afterwards run corp-status.js so the other scripts learn the name.\n"
  );
}
