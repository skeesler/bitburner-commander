/** @param {NS} ns
 *
 *  CORP UPGRADE — spend corporation funds on the nine corporation-wide upgrade levels. 51.6GB.
 *
 *      run corp-upgrade.js                  # report levels, next-level prices, and the plan
 *      run corp-upgrade.js --go             # actually buy it
 *      run corp-upgrade.js --loop --go      # keep buying, forever, against a budget
 *
 *  THIS IS THE SCRIPT THAT WAS MISSING. Nothing in the rig has ever called levelUpgrade, so
 *  corporation funds accumulate with nowhere to go: this corp sat on $18.5t while its upgrades
 *  were at levels 40-50 and the next level of most of them cost about $20b. Money in the
 *  corporation is not money in your wallet (see bn3-runbook.md, Loop 3) and it is not doing
 *  anything useful either. Upgrades are where it turns back into revenue.
 *
 *  WHY CHEAPEST-FIRST, MOSTLY. Every upgrade costs base * multiplier^level, and the multipliers
 *  differ enormously: Smart Factories is 1.06 per level, Wilson Analytics is 2.0. Buying the
 *  cheapest available level repeatedly is a decent greedy proxy for value-per-dollar and it
 *  self-balances — a track only gets expensive relative to the others once you have pushed it
 *  a long way up.
 *
 *  ...EXCEPT WILSON, WHICH CHEAPEST-FIRST WOULD NEVER BUY. At x2 per level, Wilson Analytics is
 *  permanently the most expensive thing on the list and a pure greedy pass ignores it forever.
 *  That is the wrong answer: Wilson multiplies the effectiveness of AdVert, which is the product
 *  division's main lever, and because it doubles, every level you postpone costs strictly more
 *  than it does today. So --priority names get first refusal, capped at --priority-frac of the
 *  budget so they cannot eat the whole pass.
 *
 *  ...BUT THAT CAP HAS A FLOOR OF ONE LEVEL, or it recreates the exact problem it was added to
 *  solve. A slice smaller than the next level doesn't ration a doubling track, it excludes it:
 *  Wilson sat at level 10 costing $4.096t against a $1.99t slice and could never have been bought,
 *  no matter how long the loop ran. The first level of each priority name is therefore charged
 *  against the whole budget; the slice governs everything after it.
 *
 *  IT SPENDS REAL MONEY, SO IT DOESN'T BY DEFAULT. Without --go this reports and changes
 *  nothing, the same way corp-boost.js only buys in --loop. Unlike accepting an investment offer
 *  or discontinuing a product, though, this is NOT a one-way lever — a level you bought is a
 *  level you keep. The caution here is about pacing, not regret.
 *
 *  BUDGET, NOT BALANCE. --budget-frac (default 0.5) spends at most half of current funds per
 *  pass, so a --loop run tapers instead of flooring the account, and products, AdVert, boost
 *  material and bribery all still have something to draw on.
 *
 *  UPGRADE NAMES COME FROM getConstants(), which is 0GB and is the only correct source — see
 *  corp-design.md. Do not hardcode the list; it is a name-string API and a typo throws.
 *
 *  RAM: levelUpgrade (20) + getUpgradeLevel (10) + getUpgradeLevelCost (10)
 *       + getCorporation (10) + 1.6 base = 51.6GB. getConstants and nextUpdate are free.
 */

// ---- Tuning (all overridable by flag) --------------------------------------
const BUDGET_FRAC = 0.5;      // share of current funds a single pass may spend
const RESERVE = 0;            // absolute funds floor, never spent below
// Wilson doubles every level, so it is never the cheapest thing available and a greedy pass
// would skip it permanently. It gets first refusal instead.
const PRIORITY = "Wilson Analytics";
const PRIORITY_FRAC = 0.34;   // ...but no more than this share of the budget, so it can't
                              // swallow a whole pass on one $8t level.
const EVERY = 10;             // --loop: cycles between passes (10 cycles = ~100s)
const MAX_STEPS = 400;        // safety stop on one pass, so a cheap upgrade can't spin forever
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["go", false], ["loop", false],
    ["budget-frac", BUDGET_FRAC], ["budget", 0], ["reserve", RESERVE],
    ["priority", PRIORITY], ["priority-frac", PRIORITY_FRAC],
    ["only", ""], ["skip", ""], ["max-level", 0],
    ["every", EVERY], ["quiet", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const say = opts.quiet ? (msg) => ns.print(msg) : (msg) => ns.tprint(msg);

  let names = [];
  try { names = ns.corporation.getConstants().upgradeNames || []; }
  catch (e) { ns.tprint(`\ncorp-upgrade: no corporation (${short(e)}).\n`); return; }

  const only = listOf(opts.only), skip = listOf(opts.skip);
  const wanted = names.filter((n) =>
    (!only.length || only.some((s) => eq(s, n))) && !skip.some((s) => eq(s, n)));
  if (!wanted.length) { say("\ncorp-upgrade: --only / --skip left nothing to buy.\n"); return; }

  const priority = listOf(opts.priority).filter((p) => wanted.some((n) => eq(p, n)));

  do {
    const report = onePass(ns, wanted, priority, opts);
    say(report);
    if (!opts.loop) break;
    for (let i = 0; i < Math.max(1, opts.every); i++) await ns.corporation.nextUpdate();
  } while (opts.loop);
}

/** One buying pass. Returns the text to print. Buys nothing unless opts.go. */
function onePass(ns, wanted, priority, opts) {
  let info;
  try { info = ns.corporation.getCorporation(); }
  catch (e) { return `corp-upgrade: could not read the corporation (${short(e)}).`; }

  const spendable = Math.max(0, info.funds - opts.reserve);
  const budget = opts.budget > 0 ? Math.min(opts.budget, spendable)
                                 : spendable * clamp01(opts["budget-frac"]);
  const cap = Number(opts["max-level"]) || 0;

  // Read every level and price once up front; both getters are already paid for, and a single
  // snapshot keeps the report and the plan describing the same corporation.
  const rows = [];
  for (const name of wanted) {
    try {
      rows.push({ name, level: ns.corporation.getUpgradeLevel(name),
                  cost: ns.corporation.getUpgradeLevelCost(name), bought: 0, spent: 0 });
    } catch (e) { /* an upgrade name we can't read is one we can't buy either */ }
  }
  if (!rows.length) return "corp-upgrade: could not read any upgrade levels.";

  // ---- report mode -------------------------------------------------------
  // It deliberately does NOT simulate a spending spree. Cost is base*mult^level and neither
  // base nor mult is exposed by the API, so the price of the level AFTER next is not knowable
  // without buying this one — the multipliers in play range from 1.06 to 2.0, so a guessed
  // curve would be off by orders of magnitude over a long pass. Reporting one honest line per
  // upgrade beats printing a confident plan that is fiction.
  if (!opts.go) {
    const table = rows.slice().sort((a, b) => a.cost - b.cost).map((r) => {
      // Priority names are measured against the WHOLE budget, matching the one-level floor in
      // the buying path — otherwise the report would call Wilson unaffordable and then buy it.
      const mark = cap > 0 && r.level >= cap ? "[at --max-level]"
                 : r.cost <= budget ? "affordable now"
                 : r.cost <= spendable ? "over this pass's budget" : "unaffordable";
      const isPri = priority.some((p) => eq(p, r.name));
      return `    ${r.name}  lvl ${r.level}  next $${fmt(ns, r.cost)}  — ${mark}${isPri ? "  [priority]" : ""}`;
    });
    const n = rows.filter((r) => r.cost <= budget && !(cap > 0 && r.level >= cap)).length;
    return `\n===== corp-upgrade (REPORT ONLY — pass --go to buy) =====\n` +
      `  funds $${fmt(ns, info.funds)} · reserve $${fmt(ns, opts.reserve)} · budget this pass $${fmt(ns, budget)}\n` +
      `${table.join("\n")}\n` +
      `  ${n} of ${rows.length} upgrade(s) have an affordable next level.\n` +
      `  Level counts above are exact; how MANY levels the budget buys is not shown, because\n` +
      `  the price of the level after next is not readable without buying this one.\n` +
      `  [report] nothing changed. Add --go, or --loop --go to keep at it.\n` +
      `=====`;
  }

  // ---- buying mode -------------------------------------------------------
  let left = budget, spent = 0, steps = 0;
  const atCap = (r) => cap > 0 && r.level >= cap;

  // Phase 1 — priority names.
  //
  // THE ALLOWANCE HAS A FLOOR OF ONE LEVEL, and that floor is the whole point. The fraction is
  // there so a doubling track can't eat an entire pass — but a cap SMALLER than the next level
  // doesn't slow that track down, it stops it being bought at all, forever, however long the loop
  // runs. That is exactly what happened to Wilson Analytics here: level 10 cost $4.096t against a
  // 34%-of-$5.86t slice of $1.99t, so the one upgrade the priority list exists to protect was the
  // one upgrade it made unbuyable. So the FIRST level of each priority name is charged against the
  // whole budget; only the second and later ones respect the slice.
  let priorityLeft = budget * clamp01(opts["priority-frac"]);
  for (const want of priority) {
    const r = rows.find((x) => eq(x.name, want));
    if (!r) continue;
    let allowance = Math.max(priorityLeft, r.cost);
    while (!atCap(r) && r.cost <= allowance && r.cost <= left && steps < MAX_STEPS) {
      const paid = takeLevel(ns, r);
      if (paid <= 0) break;
      left -= paid; spent += paid; steps++;
      priorityLeft = Math.max(0, priorityLeft - paid);
      allowance = priorityLeft;     // the free pass is for the first level only
    }
  }

  // Phase 2 — cheapest available level, repeatedly, with whatever is left.
  while (steps < MAX_STEPS) {
    const affordable = rows.filter((r) => !atCap(r) && r.cost <= left);
    if (!affordable.length) break;
    affordable.sort((a, b) => a.cost - b.cost);
    const paid = takeLevel(ns, affordable[0]);
    if (paid <= 0) break;
    left -= paid; spent += paid; steps++;
  }

  const moved = rows.filter((r) => r.bought > 0)
    .sort((a, b) => b.spent - a.spent)
    .map((r) => `    ${r.name}  +${r.bought} -> lvl ${r.level}  ($${fmt(ns, r.spent)}, next $${fmt(ns, r.cost)})`);
  const idle = rows.filter((r) => r.bought === 0)
    .sort((a, b) => a.cost - b.cost)
    .map((r) => `    ${r.name}  lvl ${r.level}  next $${fmt(ns, r.cost)}` + (atCap(r) ? "  [at --max-level]" : ""));

  return `\n===== corp-upgrade =====\n` +
    `  funds $${fmt(ns, info.funds)} · reserve $${fmt(ns, opts.reserve)} · budget this pass $${fmt(ns, budget)}\n` +
    (moved.length ? `  bought ${steps} level(s) for $${fmt(ns, spent)}:\n${moved.join("\n")}\n`
                  : `  nothing affordable within the budget.\n`) +
    (idle.length ? `  untouched:\n${idle.join("\n")}\n` : "") +
    (steps >= MAX_STEPS ? `  stopped at the ${MAX_STEPS}-level safety cap; run again to continue.\n` : "") +
    `=====`;
}

/** Buy exactly one level. Returns what it cost, or 0 if the game refused. */
function takeLevel(ns, r) {
  const price = r.cost;
  try { ns.corporation.levelUpgrade(r.name); }
  catch (e) { return 0; }         // insufficient funds mid-pass, or a name the game rejected
  // Re-read rather than model the curve: this is the only place the next price is knowable.
  try { r.cost = ns.corporation.getUpgradeLevelCost(r.name); } catch (e) { /* keep the old one */ }
  r.level++; r.bought++; r.spent += price;
  return price;
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
    "\ncorp-upgrade.js — buy corporation-wide upgrade levels (51.6GB).\n" +
    "  run corp-upgrade.js                     report levels and prices, spend nothing\n" +
    "  run corp-upgrade.js --go                buy, up to half of current funds\n" +
    "  run corp-upgrade.js --go --budget 2t    ...or a fixed budget\n" +
    "  run corp-upgrade.js --loop --go         keep buying every 10 cycles\n" +
    "  run corp-upgrade.js --go --skip \"Wilson Analytics\"   leave a track alone\n" +
    "  run corp-upgrade.js --go --only \"Smart Storage,Smart Factories\"\n" +
    "  Cheapest-first, except --priority names (default Wilson Analytics) which get first\n" +
    "  refusal because they double each level and greedy would never reach them.\n" +
    "  Levels are permanent — this is pacing, not a one-way lever.\n"
  );
}
