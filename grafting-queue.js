/** @param {NS} ns
 *
 *  GRAFTING QUEUE — grafts augmentations at VitaLife (New Tokyo), in order.
 *  Grafting buys an aug's effect with money + time and skips the faction-rep
 *  grind — but each graft stacks Entropy (~-2% to ALL your multipliers,
 *  cumulative), so graft deliberately.
 *
 *      run grafting-queue.js --list                 # what's graftable, price + time
 *      run grafting-queue.js "Aug One" "Aug Two"    # graft these, in order
 *      run grafting-queue.js --auto 3               # graft the 3 cheapest graftable
 *
 *    --reserve N   keep $N in the bank; wait for money above price+reserve. Default 0.
 *    --max N       graft at most N augs this run (entropy budget). Default no cap.
 *    --no-focus    graft without taking character focus (progresses slower unless
 *                  you have the no-focus-penalty aug). Default: focus on.
 *
 *  Needs Source-File 10 (grafting) and — for auto-travel — Source-File 4
 *  (Singularity). Without SF4, stand in New Tokyo yourself before running.
 */

// ---- Tuning ----------------------------------------------------------------
const RESERVE = 0;     // default cash to keep in the bank while waiting to afford a graft
const TICK    = 5000;  // ms between "waiting for money" polls
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const gr = ns.grafting;

  const opts = ns.flags([
    ["list", false],
    ["auto", 0],
    ["reserve", RESERVE],
    ["max", Infinity],
    ["no-focus", false],
    ["help", false],
  ]);

  if (opts.help) { printHelp(ns); return; }

  let graftable;
  try { graftable = gr.getGraftableAugmentations(); }
  catch (e) { ns.tprint("ERROR grafting-queue: grafting API unavailable — needs Source-File 10."); return; }

  if (opts.list) { listAugs(ns, gr, graftable); return; }

  // Build the queue: explicit names, or the N cheapest with --auto.
  let queue = opts._.slice();
  if (opts.auto > 0) {
    queue = graftable
      .map(a => ({ name: a, cost: gr.getAugmentationGraftPrice(a) }))
      .sort((x, y) => x.cost - y.cost)
      .slice(0, opts.auto)
      .map(x => x.name);
  }

  if (queue.length === 0) {
    ns.tprint("Nothing queued. Pass aug names, or --auto N, or --list to see options.");
    return;
  }

  // Drop anything not actually graftable (already owned / unknown / prereq missing).
  const set = new Set(graftable);
  queue = queue.filter(a => {
    if (set.has(a)) return true;
    ns.tprint(`WARN: "${a}" isn't graftable right now (owned, unknown, or prereq missing) — skipping.`);
    return false;
  });
  if (queue.length === 0) { ns.tprint("Queue empty after filtering. Nothing to do."); return; }

  const cap = Math.min(queue.length, opts.max);
  ns.ui.openTail();
  ns.print(`Grafting queue: ${cap} aug(s). Reserve $${fmt(opts.reserve)}. Focus: ${!opts["no-focus"]}.`);

  for (let k = 0; k < cap; k++) {
    const aug = queue[k];

    if (!ensureNewTokyo(ns)) {
      ns.tprint("ERROR: not in New Tokyo and couldn't auto-travel (need SF4). Travel there and re-run.");
      return;
    }

    const price = gr.getAugmentationGraftPrice(aug);
    while (ns.getServerMoneyAvailable("home") - price < opts.reserve) {
      ns.print(`Waiting for $${fmt(price + opts.reserve)} to graft "${aug}" ` +
               `(have $${fmt(ns.getServerMoneyAvailable("home"))})...`);
      await ns.sleep(TICK);
    }

    if (!ensureNewTokyo(ns)) continue; // a passive event may have moved us while waiting

    ns.print(`Grafting "${aug}" — $${fmt(price)}, ~${fmtTime(gr.getAugmentationGraftTime(aug))} (${k + 1}/${cap}).`);
    if (!gr.graftAugmentation(aug, !opts["no-focus"])) {
      ns.tprint(`ERROR: failed to start grafting "${aug}" — skipping.`);
      continue;
    }
    await gr.waitForOngoingGrafting();
    ns.print(`Done: "${aug}" grafted. Entropy +1 stack.`);
  }

  ns.print(`Queue complete — grafted up to ${cap} aug(s). Mind the entropy stack.`);
}

/** Make sure the player is in New Tokyo (VitaLife), travelling if Singularity allows. */
function ensureNewTokyo(ns) {
  if (ns.getPlayer().city === "New Tokyo") return true;
  try { return ns.singularity.travelToCity("New Tokyo"); }
  catch (e) { return false; }
}

function listAugs(ns, gr, graftable) {
  const rows = graftable
    .map(a => ({ name: a, cost: gr.getAugmentationGraftPrice(a), time: gr.getAugmentationGraftTime(a) }))
    .sort((x, y) => x.cost - y.cost);

  ns.tprint(`\nGraftable augmentations (${rows.length}), cheapest first:`);
  for (const r of rows) {
    ns.tprint(`  $${fmt(r.cost).padStart(9)}  ~${fmtTime(r.time).padStart(8)}  ${r.name}`);
  }
  ns.tprint(`\nEach graft adds 1 Entropy stack (~-2% to all multipliers, cumulative). ` +
            `Times shown assume no Intelligence bonus.`);
}

function printHelp(ns) {
  ns.tprint(
    "\ngrafting-queue.js — graft augs at VitaLife (New Tokyo).\n" +
    "  run grafting-queue.js --list              # graftable augs, price + time\n" +
    "  run grafting-queue.js \"Aug A\" \"Aug B\"    # graft these in order\n" +
    "  run grafting-queue.js --auto 3            # graft the 3 cheapest\n" +
    "  --reserve N   keep $N banked while waiting. Default 0.\n" +
    "  --max N       cap grafts this run (entropy budget).\n" +
    "  --no-focus    graft without taking focus.\n"
  );
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h${m}m`;
  if (m) return `${m}m${sec}s`;
  return `${sec}s`;
}

function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  for (const [v, s] of [[1e12, "t"], [1e9, "b"], [1e6, "m"], [1e3, "k"]]) {
    if (a >= v) return sign + (a / v).toFixed(2) + s;
  }
  return n.toFixed(0);
}
