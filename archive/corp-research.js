/** @param {NS} ns
 *
 *  CORP RESEARCH — spend a division's research points. 61.6GB.
 *
 *      run corp-research.js                                   # what's owned, what's next, what it costs
 *      run corp-research.js --buy "uPgrade: Capacity.I" --go   # buy one, by name
 *      run corp-research.js --auto --go                        # cheapest-first, down to the RP reserve
 *
 *  RP IS THE ONE RESOURCE YOU CAN SPEND BADLY AND NOT NOTICE. Unlike money, it is also an input
 *  to product quality: sciMult = 1 + researchPoints^researchFactor / 800, and that value is
 *  BANKED INTO A PRODUCT AT COMPLETION (corp-product.js header, Product.ts:147-150). So draining
 *  the pool the cycle before a product finishes permanently makes that product worse, for the
 *  whole of its life. Check `run corp-product.js --status` before an --auto pass.
 *
 *  That is why --auto keeps half the pool by default (--reserve-frac 0.5) while --buy NAME
 *  spends exactly what you asked for. The conservative default is for the unattended path; the
 *  deliberate purchase is for when you have looked.
 *
 *  WHAT'S ACTUALLY WORTH BUYING, and why these are the --priority defaults:
 *    Market-TA.I / Market-TA.II   optimal pricing every cycle, per city. The single biggest
 *                                 revenue research in the game. Remember it does NOTHING until
 *                                 the per-item flag is set — that's corp-ta.js.
 *    uPgrade: Capacity.I / .II    +1 product slot each. A division is capped at maxProducts (3),
 *                                 an in-development product counts toward the cap, and the only
 *                                 other way to free a slot is discontinueProduct — permanent,
 *                                 and it takes that product's revenue with it. Capacity is the
 *                                 non-destructive way out of a stalled product pipeline.
 *    Hi-Tech R&D Laboratory       the prerequisite for essentially everything else.
 *
 *  RESEARCH IS PERMANENT AND THERE IS NO REFUND, so this reports by default and needs --go.
 *  Prerequisites are enforced by the game, not here: asking for Market-TA.II without Market-TA.I
 *  throws, and the error is passed through to you rather than swallowed.
 *
 *  Names come from getConstants().researchNames (0GB) and a --buy / --priority name that isn't
 *  on that list is reported as a typo rather than quietly skipped.
 *
 *  RAM: research (20) + getResearchCost (10) + hasResearched (10) + getDivision (10)
 *       + 1.6 base = 61.6GB. getConstants is free.
 */

const STATE_FILE = "corp-state.txt";
const RESERVE_FRAC = 0.5;   // --auto never spends the pool below this share of its current value
// Ordered by what actually moves the needle, not by price. See the header.
const PRIORITY = "Hi-Tech R&D Laboratory,Market-TA.I,Market-TA.II,uPgrade: Capacity.I,uPgrade: Capacity.II";

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["divisions", ""], ["buy", ""], ["auto", false], ["go", false],
    ["reserve-frac", RESERVE_FRAC], ["reserve", 0],
    ["priority", PRIORITY], ["quiet", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const say = opts.quiet ? (msg) => ns.print(msg) : (msg) => ns.tprint(msg);

  let known = [];
  try { known = ns.corporation.getConstants().researchNames || []; }
  catch (e) { ns.tprint(`\ncorp-research: no corporation (${short(e)}).\n`); return; }

  const names = divisionNames(ns, opts.divisions);
  if (!names.length) {
    say("\ncorp-research: no divisions found. Run corp-status.js first, or pass --divisions NAME.\n");
    return;
  }

  // A name the game has never heard of is a typo, and silently doing nothing about it is how you
  // spend an evening wondering why --buy had no effect.
  const wanted = listOf(opts.buy);
  const typos = wanted.filter((w) => !known.some((k) => eq(k, w)));
  if (typos.length) {
    say(`\ncorp-research: no such research: ${typos.join(", ")}\n` +
        `  known names: ${known.join(", ")}\n`);
    return;
  }
  const priority = listOf(opts.priority).filter((p) => known.some((k) => eq(k, p)));

  const out = [];
  for (const division of names) out.push(divisionPass(ns, division, known, wanted, priority, opts));
  say(`\n===== corp-research ${opts.go ? "" : "(REPORT ONLY — pass --go to buy) "}=====\n` +
      out.join("\n") + "\n" +
      (opts.go ? "" : "  [report] nothing changed.\n") +
      `=====`);
}

function divisionPass(ns, division, known, wanted, priority, opts) {
  let d;
  try { d = ns.corporation.getDivision(division); }
  catch (e) { return `  ${division}: could not read (${short(e)})`; }

  let pool = Number(d.researchPoints) || 0;
  const startPool = pool;
  const floor = Math.max(Number(opts.reserve) || 0, startPool * clamp01(opts["reserve-frac"]));

  // Split the catalogue into owned / available, pricing only what isn't owned.
  const owned = [], avail = [];
  for (const name of known) {
    let has = false;
    try { has = ns.corporation.hasResearched(division, name); } catch (e) { continue; }
    if (has) { owned.push(name); continue; }
    let cost = NaN;
    try { cost = ns.corporation.getResearchCost(division, name); } catch (e) { continue; }
    if (Number.isFinite(cost)) avail.push({ name, cost });
  }
  avail.sort((a, b) => a.cost - b.cost);

  // What to attempt, in order: explicit --buy first, then --priority, then cheapest-first if --auto.
  const queue = [];
  for (const w of wanted) { const r = avail.find((a) => eq(a.name, w)); if (r) queue.push(r); }
  if (opts.auto) {
    for (const p of priority) {
      const r = avail.find((a) => eq(a.name, p));
      if (r && !queue.includes(r)) queue.push(r);
    }
    for (const r of avail) if (!queue.includes(r)) queue.push(r);
  }

  const bought = [], refused = [];
  for (const r of queue) {
    // --buy is exact and ignores the reserve; --auto respects it. That distinction is the whole
    // safety model here, so it is enforced per item rather than per pass.
    const explicit = wanted.some((w) => eq(w, r.name));
    if (r.cost > pool) { refused.push(`${r.name} needs ${fmt(ns, r.cost)} RP (short ${fmt(ns, r.cost - pool)})`); continue; }
    if (!explicit && pool - r.cost < floor) {
      refused.push(`${r.name} (${fmt(ns, r.cost)} RP) would take the pool below the ${fmt(ns, floor)} reserve`);
      continue;
    }
    if (!opts.go) { bought.push(`${r.name} (${fmt(ns, r.cost)} RP)`); pool -= r.cost; continue; }
    try {
      ns.corporation.research(division, r.name);
      bought.push(`${r.name} (${fmt(ns, r.cost)} RP)`);
      pool -= r.cost;
    } catch (e) {
      // Overwhelmingly a missing prerequisite. Pass the game's own words through.
      refused.push(`${r.name} — ${short(e)}`);
    }
  }

  const upcoming = avail.filter((a) => !bought.some((b) => b.startsWith(a.name))).slice(0, 6)
    .map((a) => `${a.name} ${fmt(ns, a.cost)}RP`);

  return `  ${division} — RP ${fmt(ns, startPool)}` +
    (opts.go ? ` -> ${fmt(ns, pool)}` : ``) +
    `, reserve ${fmt(ns, floor)}, ${owned.length} owned\n` +
    (bought.length ? `    ${opts.go ? "BOUGHT" : "would buy"}: ${bought.join(", ")}\n` : `    nothing bought\n`) +
    (refused.length ? `    blocked: ${refused.join("; ")}\n` : "") +
    (upcoming.length ? `    next up: ${upcoming.join(" · ")}` : `    everything is researched`);
}

/** Explicit flag > corp-state.txt. ns.read is 0GB. */
function divisionNames(ns, flagValue) {
  if (flagValue) return listOf(flagValue);
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (Array.isArray(st.divisions)) return st.divisions;
    }
  } catch (e) { /* fall through */ }
  return [];
}

function listOf(v) { return String(v || "").split(",").map((s) => s.trim()).filter(Boolean); }
function eq(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function clamp01(n) { const v = Number(n); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 110); }

// ns.formatNumber was removed in 3.0.0; ns.format.number is the current name (0GB).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "?";
  try { return ns.format.number(n, 3); } catch (e) { return String(Math.round(n)); }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-research.js — spend research points (61.6GB).\n" +
    "  run corp-research.js                                  report every division\n" +
    "  run corp-research.js --divisions Tobacco              just one\n" +
    "  run corp-research.js --buy \"uPgrade: Capacity.I\" --go  buy one by name (ignores the reserve)\n" +
    "  run corp-research.js --auto --go                      cheapest-first, keeping half the pool\n" +
    "  run corp-research.js --auto --go --reserve-frac 0     ...spend it all (see the warning)\n" +
    "  RP feeds product quality and is banked at completion, so check corp-product.js --status\n" +
    "  before a big spend. Research is permanent and there is no refund.\n"
  );
}
