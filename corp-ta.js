/** @param {NS} ns
 *
 *  CORP TA — switch on Market-TA.II everywhere it is researched. 61.6GB.
 *
 *      run corp-ta.js                 # turn it on for every material and product, all divisions
 *      run corp-ta.js --dry           # say what it would switch on, change nothing
 *      run corp-ta.js --off           # turn it back off (hands pricing back to your sell orders)
 *
 *  RESEARCHING MARKET-TA.II DOES NOTHING ON ITS OWN. It is a per-division research AND a
 *  per-material / per-product FLAG, and the flag defaults to off. This corporation owned
 *  Market-TA.I and Market-TA.II in all three divisions while every material still sold at plain
 *  "MP" and every product sold at a multiplier hand-hunted by corp-product.js's controller. That
 *  is the same shape of mistake as paying $25b for the Smart Supply unlock and never calling
 *  setSmartSupply — see corp-smartsupply.js, which exists for exactly that reason.
 *
 *  WHAT IT REPLACES. Selling at "MP" means market price for a MATERIAL (fine, if unambitious)
 *  and productionCost for a PRODUCT (i.e. at cost, for no margin — see corp-product.js's PRICE
 *  note). TA.II recomputes the profit-maximising price every cycle, per city, from that item's
 *  own demand and competition. It is strictly better than any standing price string and it is
 *  strictly better than a controller hunting the ceiling by experiment, because it never has to
 *  overshoot to find the edge.
 *
 *  IT SUPERSEDES corp-product.js'S PRICE CONTROLLER. Once TA.II is on for a product, the k it
 *  hunts is ignored by the game. Leave corp-product.js running — developing and selling products
 *  is still its job — but stop reading its multipliers as meaningful. --off puts you back.
 *
 *  TA.I IS DELIBERATELY NOT TOUCHED. TA.II supersedes it wherever both are researched, so
 *  setting only the II flag is enough and saves 40GB of two more charged functions. If a
 *  division has TA.I but not TA.II this script will tell you it could not set that division
 *  rather than quietly setting the weaker one.
 *
 *  ONLY MATERIALS THE DIVISION ACTUALLY MAKES get a flag — producedMaterials from
 *  getIndustryData, not a hardcoded list, because the published industry tables are stale in
 *  places (corp-design.md, gotcha 7). Inputs and boost materials are never sold, so a flag on
 *  them would be noise. Products are per-DIVISION, not per-city: setProductMarketTA2 takes no
 *  city argument, unlike sellProduct.
 *
 *  RE-RUNNING IS FREE AND IS THE POINT. The flag is per item, so every NEW product created by
 *  corp-product.js starts with TA.II off and silently reverts to selling at cost. Either re-run
 *  this after a product finishes, or let corp-conductor.js do it for you — it re-asserts on a
 *  timer by default (--no-ta to stop it).
 *
 *  RAM: setMaterialMarketTA2 (20) + setProductMarketTA2 (20) + getDivision (10)
 *       + getIndustryData (10) + 1.6 base = 61.6GB. The division LIST comes from corp-state.txt
 *       via ns.read (0GB) rather than getCorporation (10GB) — which means a division created
 *       since the last corp-status.js refresh is invisible here. Pass --divisions to force it.
 */

const STATE_FILE = "corp-state.txt";

export async function main(ns) {
  const opts = ns.flags([
    ["divisions", ""],   // comma-separated; default is every division in corp-state.txt
    ["off", false],
    ["dry", false], ["quiet", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const say = opts.quiet ? (msg) => ns.print(msg) : (msg) => ns.tprint(msg);
  const names = divisionNames(ns, opts.divisions);
  if (!names.length) {
    say("\ncorp-ta: no divisions found. Run corp-status.js first, or pass --divisions NAME.\n");
    return;
  }

  const on = !opts.off;
  const lines = [];
  let set = 0, skipped = 0;

  for (const name of names) {
    let d = null;
    try { d = ns.corporation.getDivision(name); }
    catch (e) { lines.push(`  ${name}: could not read (${short(e)})`); continue; }

    // producedMaterials is the only correct answer here. A division's warehouse is also full of
    // inputs and boost materials, and none of those are ever sold.
    let mats = [];
    try {
      const data = ns.corporation.getIndustryData(d.industry) || {};
      mats = data.producedMaterials || [];
    } catch (e) { /* an industry that makes no materials is normal — Tobacco is one */ }

    const products = d.products || [];
    const cities = d.cities || [];
    let ok = 0, bad = "";

    for (const city of cities) {
      for (const mat of mats) {
        if (opts.dry) { ok++; continue; }
        try { ns.corporation.setMaterialMarketTA2(name, city, mat, on); ok++; }
        catch (e) { bad = bad || short(e); }
      }
    }
    // Products are per-division: setProductMarketTA2 has no city parameter.
    for (const prod of products) {
      if (opts.dry) { ok++; continue; }
      try { ns.corporation.setProductMarketTA2(name, prod, on); ok++; }
      catch (e) { bad = bad || short(e); }
    }

    const what = `${mats.length} material(s) x ${cities.length} cities, ${products.length} product(s)`;
    if (bad) {
      skipped++;
      // Overwhelmingly this is "you have not researched Market-TA.II" — worth saying plainly
      // rather than making the reader decode a raw API error. Every item is still attempted:
      // the research is per DIVISION, so if one call fails they all will, but a partial failure
      // (a product mid-development, say) shouldn't cost the rest of the division its flags.
      const why = /research/i.test(bad) ? "Market-TA.II is NOT researched in this division" : bad;
      lines.push(`  ${name}: ${ok} flag(s) set, some refused — ${why}`);
    } else {
      set += ok;
      lines.push(`  ${name}: ${on ? "ON" : "off"} for ${what} — ${ok} flag(s)`);
    }
  }

  say(
    `\n===== corp-ta ${opts.dry ? "(DRY RUN) " : ""}=====\n` +
    `  Market-TA.II ${on ? "ENABLED" : "disabled"} across ${names.length} division(s)\n` +
    lines.join("\n") + "\n" +
    (opts.dry ? "  [dry] nothing changed.\n"
      : `  ${set} flag(s) written${skipped ? `, ${skipped} division(s) incomplete` : ""}.\n`) +
    (on && !opts.dry
      ? `\n  Pricing changes at the next SALE state (~10s). Sell prices you set by hand, and the\n` +
        `  multipliers corp-product.js hunts, are now ignored by the game for these items.\n` +
        `  New products start with the flag OFF — re-run after one finishes, or let the\n` +
        `  conductor re-assert it.\n`
      : "") +
    `=====`
  );
}

/** Explicit flag > corp-state.txt. ns.read is 0GB, so the division list is free. */
function divisionNames(ns, flagValue) {
  if (flagValue) return String(flagValue).split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (Array.isArray(st.divisions)) return st.divisions;
    }
  } catch (e) { /* fall through to empty */ }
  return [];
}

function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 110); }

function printHelp(ns) {
  ns.tprint(
    "\ncorp-ta.js — turn Market-TA.II on for every material and product (61.6GB).\n" +
    "  run corp-ta.js                     enable everywhere it is researched\n" +
    "  run corp-ta.js --dry               show what it would touch\n" +
    "  run corp-ta.js --divisions Tobacco just one division\n" +
    "  run corp-ta.js --off               hand pricing back to your own sell orders\n" +
    "  Researching Market-TA.II does nothing until this flag is set, per item.\n" +
    "  New products start with it OFF, so re-run after one finishes (the conductor does).\n"
  );
}
