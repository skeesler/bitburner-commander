/** @param {NS} ns
 *
 *  CORP ADVERT — buy AdVert levels, but only in divisions where advertising actually pays. 61.6GB.
 *
 *      run corp-advert.js               # report levels, prices, and which divisions qualify
 *      run corp-advert.js --go          # buy, up to 20% of corporation funds
 *      run corp-advert.js --loop --go   # keep at it every 10 cycles
 *
 *  AdVert raises a division's awareness and popularity, which raise how much of its output the
 *  market will absorb and at what price. The runbook's round-3+ rule is "put at least 20% of
 *  funds into Advert", and that is the default budget here.
 *
 *  IT IS NOT WORTH BUYING EVERYWHERE, WHICH IS THE WHOLE POINT OF THIS SCRIPT. The benefit is
 *  scaled by the industry's advertisingFactor, and those differ by 5x: Tobacco is 0.20, Chemical
 *  0.07, Agriculture 0.04. Spending on Agriculture's AdVert is close to setting money on fire
 *  while the product division is the thing that converts awareness into revenue. So divisions
 *  below --min-factor (default 0.1) are skipped and told to you, rather than silently included.
 *
 *  The factor is read from getIndustryData at runtime, never from a table — the published
 *  industry figures are stale in places (corp-design.md, gotcha 7: docs give Tobacco robotFactor
 *  0.25, the v3.0.1 source says 0.2).
 *
 *  BUY WILSON ANALYTICS TOO. Wilson multiplies the effect of every AdVert level you own, so the
 *  two compound and buying AdVert while Wilson sits at level 9 leaves most of the value on the
 *  table. That is corp-upgrade.js's --priority default, for exactly this reason.
 *
 *  Like corp-upgrade.js: it spends real money so it reports by default and needs --go, but an
 *  AdVert level is permanent and there is nothing to regret — the caution is about pacing.
 *
 *  RAM: hireAdVert (20) + getHireAdVertCost (10) + getHireAdVertCount (10)
 *       + getIndustryData (10) + getCorporation (10) + 1.6 base = 61.6GB.
 *       The division list and its industries come from corp-state.txt via ns.read (0GB), so a
 *       division created since the last corp-status.js refresh is invisible — pass --divisions.
 */

const STATE_FILE = "corp-state.txt";
const BUDGET_FRAC = 0.2;    // the runbook's round-3+ rule: >=20% of funds into Advert
const MIN_FACTOR = 0.1;     // skip industries whose advertisingFactor is below this
const RESERVE = 0;
const EVERY = 10;           // --loop: cycles between passes
const MAX_STEPS = 200;

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["go", false], ["loop", false],
    ["divisions", ""], ["min-factor", MIN_FACTOR],
    ["budget-frac", BUDGET_FRAC], ["budget", 0], ["reserve", RESERVE],
    ["every", EVERY], ["quiet", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const say = opts.quiet ? (msg) => ns.print(msg) : (msg) => ns.tprint(msg);
  const targets = divisionList(ns, opts.divisions);
  if (!targets.length) {
    say("\ncorp-advert: no divisions found. Run corp-status.js first, or pass --divisions NAME.\n");
    return;
  }

  do {
    say(onePass(ns, targets, opts));
    if (!opts.loop) break;
    for (let i = 0; i < Math.max(1, opts.every); i++) await ns.corporation.nextUpdate();
  } while (opts.loop);
}

function onePass(ns, targets, opts) {
  let info;
  try { info = ns.corporation.getCorporation(); }
  catch (e) { return `corp-advert: could not read the corporation (${short(e)}).`; }

  const spendable = Math.max(0, info.funds - opts.reserve);
  const budget = opts.budget > 0 ? Math.min(opts.budget, spendable)
                                 : spendable * clamp01(opts["budget-frac"]);
  const minFactor = Number(opts["min-factor"]) || 0;

  const rows = [], skipped = [];
  for (const t of targets) {
    let factor = null;
    try {
      const data = ns.corporation.getIndustryData(t.industry) || {};
      factor = Number(data.advertisingFactor);
    } catch (e) { /* unknown industry — treated as "can't judge", below */ }

    if (!Number.isFinite(factor)) { skipped.push(`${t.name} — could not read advertisingFactor`); continue; }
    if (factor < minFactor) {
      skipped.push(`${t.name} (${t.industry}) — advertisingFactor ${factor} < ${minFactor}`);
      continue;
    }
    try {
      rows.push({ name: t.name, industry: t.industry, factor,
                  level: ns.corporation.getHireAdVertCount(t.name),
                  cost: ns.corporation.getHireAdVertCost(t.name), bought: 0, spent: 0 });
    } catch (e) { skipped.push(`${t.name} — could not read AdVert (${short(e)})`); }
  }

  const skipText = skipped.length ? `  skipped:\n${skipped.map((s) => `    ${s}`).join("\n")}\n` : "";
  if (!rows.length) {
    return `\n===== corp-advert =====\n  funds $${fmt(ns, info.funds)}\n` +
      `  no division qualifies for AdVert.\n${skipText}` +
      `  Lower --min-factor to include one anyway.\n=====`;
  }

  // ---- report mode: no simulated spree ------------------------------------
  // AdVert cost is base*mult^level and the API exposes neither, so the price of the level after
  // next cannot be known without buying this one. Reporting one honest line beats a fiction.
  if (!opts.go) {
    const table = rows.sort((a, b) => b.factor - a.factor).map((r) =>
      `    ${r.name} (${r.industry}, factor ${r.factor})  AdVert ${r.level}  ` +
      `next $${fmt(ns, r.cost)}  — ${r.cost <= budget ? "affordable now" : "over budget"}`);
    return `\n===== corp-advert (REPORT ONLY — pass --go to buy) =====\n` +
      `  funds $${fmt(ns, info.funds)} · budget this pass $${fmt(ns, budget)} (${pct(opts["budget-frac"])} of funds)\n` +
      `${table.join("\n")}\n${skipText}` +
      `  [report] nothing changed. Add --go, or --loop --go to keep at it.\n=====`;
  }

  // ---- buying mode: cheapest next level across qualifying divisions -------
  let left = budget, spent = 0, steps = 0;
  while (steps < MAX_STEPS) {
    const affordable = rows.filter((r) => r.cost <= left);
    if (!affordable.length) break;
    affordable.sort((a, b) => a.cost - b.cost);
    const r = affordable[0];
    const price = r.cost;
    try { ns.corporation.hireAdVert(r.name); }
    catch (e) { break; }
    try { r.cost = ns.corporation.getHireAdVertCost(r.name); } catch (e) { /* keep the old one */ }
    r.level++; r.bought++; r.spent += price;
    left -= price; spent += price; steps++;
  }

  const moved = rows.filter((r) => r.bought > 0).map((r) =>
    `    ${r.name}  +${r.bought} -> AdVert ${r.level}  ($${fmt(ns, r.spent)}, next $${fmt(ns, r.cost)})`);
  const idle = rows.filter((r) => r.bought === 0).map((r) =>
    `    ${r.name}  AdVert ${r.level}  next $${fmt(ns, r.cost)} — unaffordable this pass`);

  return `\n===== corp-advert =====\n` +
    `  funds $${fmt(ns, info.funds)} · budget this pass $${fmt(ns, budget)}\n` +
    (moved.length ? `  bought ${steps} level(s) for $${fmt(ns, spent)}:\n${moved.join("\n")}\n`
                  : `  nothing affordable within the budget.\n`) +
    (idle.length ? `${idle.join("\n")}\n` : "") + skipText +
    `  Awareness and popularity move at the next cycle; revenue follows them.\n=====`;
}

/** [{name, industry}] from an explicit flag, else corp-state.txt (ns.read is 0GB). */
function divisionList(ns, flagValue) {
  let industries = {};
  let names = [];
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      industries = st.industries || {};
      if (Array.isArray(st.divisions)) names = st.divisions;
    }
  } catch (e) { /* fall through */ }
  if (flagValue) names = String(flagValue).split(",").map((s) => s.trim()).filter(Boolean);
  return names.map((n) => ({ name: n, industry: industries[n] || n }));
}

function clamp01(n) { const v = Number(n); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
function pct(n) { return `${(clamp01(n) * 100).toFixed(0)}%`; }
function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 110); }

// ns.formatNumber was removed in 3.0.0; ns.format.number is the current name (0GB).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "?";
  try { return ns.format.number(n, 3); } catch (e) { return String(Math.round(n)); }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-advert.js — buy AdVert where advertising actually pays (61.6GB).\n" +
    "  run corp-advert.js                    report, spend nothing\n" +
    "  run corp-advert.js --go               buy, up to 20% of funds\n" +
    "  run corp-advert.js --loop --go        keep buying every 10 cycles\n" +
    "  run corp-advert.js --min-factor 0     include Agriculture too (usually a waste)\n" +
    "  run corp-advert.js --go --budget 500b fixed budget instead of a fraction\n" +
    "  Divisions below --min-factor (0.1) are skipped: Tobacco 0.20 pays, Agriculture 0.04\n" +
    "  does not. Buy Wilson Analytics alongside — it multiplies every AdVert level you own.\n"
  );
}
