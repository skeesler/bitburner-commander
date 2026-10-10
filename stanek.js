/** @param {NS} ns
 *
 *  STANEK — lay out and charge Stanek's Gift.
 *
 *      run stanek.js show                       # the gift as it is now, with each fragment's effect
 *      run stanek.js plan  [--plan bb]          # best layout for a plan — changes nothing
 *      run stanek.js place [--plan bb] --yes    # clear the gift and place that layout
 *      run stanek.js charge [--rounds 100]      # charge every fragment with all the free RAM on home
 *
 *  PLANS (stanek-lib.js PLANS — weighted fragment wish lists): bb (combat stats + the Bladeburner
 *  fragment), combat, hack, money. Or --weights "10=1,14=1,30=2" for your own (fragment id=weight).
 *
 *  HOW THE LAYOUT IS CHOSEN. Every legal packing of the plan's fragments plus boosters is searched
 *  (branch and bound, checked against an exhaustive search — stanek-lib.test.mjs), scoring
 *  sum(weight x ln(effect)). Effect = 1 + K x power x boost, boost = 1.1 per DISTINCT booster
 *  touching the fragment (4-neighbour), and K comes from the charge your RAM can give. So the result
 *  is "where to put boosters so they touch the fragments that matter most".
 *
 *  CHARGING. The effect grows with ln(the BIGGEST single charge), so stanek-charge.js runs as ONE
 *  script with every thread home can spare, not many small ones. numCharge adds a slow
 *  ((n+1)/5)^0.07 on top: 100 rounds gets most of it. Charges reset on every augmentation install
 *  (placement doesn't), so re-run `charge` after each install. Charging also pays Church of the
 *  Machine God reputation.
 *
 *  RAM: ~14 GB (placeFragment 5 + activeFragments 5 + exec and friends). The worker is 2 GB a thread.
 */
import { PLANS, BOOSTER_TYPE, bestLayout, chargeK, shapeCells, drawLayout } from "stanek-lib.js";

const WORKER = "stanek-charge.js";
const RESERVE_GB = 0;          // home RAM the charger leaves free
const ROUNDS = 100;            // charges per fragment; 0 = forever
const NODE_MULT = 2;           // BN13 StaneksGiftPowerMultiplier [SRC: BitNode.tsx case 13] — 1 elsewhere

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["plan", "bb"], ["weights", ""], ["threads", 0], ["rounds", ROUNDS], ["reserve", RESERVE_GB],
    ["host", "home"], ["node-mult", NODE_MULT], ["yes", false], ["help", false],
  ]);
  const [cmd] = opts._.map(String);
  if (opts.help || !cmd) { printHelp(ns); return; }

  let width;
  try { width = ns.stanek.giftWidth(); }
  catch (e) { ns.tprint("stanek: the gift isn't installed — accept it first (Church of the Machine God, Chongqing)."); return; }
  const height = ns.stanek.giftHeight();
  const defs = ns.stanek.fragmentDefinitions();
  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));

  if (cmd === "show") return show(ns, width, height, defs, byId);
  if (cmd === "charge") return charge(ns, opts, byId);
  if (cmd === "plan" || cmd === "place") {
    const weights = opts.weights ? parseWeights(opts.weights) : PLANS[opts.plan];
    if (!weights) { ns.tprint(`stanek: unknown plan "${opts.plan}" — ${Object.keys(PLANS).join(", ")}, or --weights "id=w,..."`); return; }
    const threads = opts.threads || chargerThreads(ns, opts);
    const K = chargeK({ threads: Math.max(1, threads), numCharge: Math.max(1, Number(opts.rounds) || 100), nodeMult: Number(opts["node-mult"]) });
    const t0 = Date.now();
    const r = bestLayout({ width, height, defs, weights, K });
    const out = [`stanek ${cmd}: plan ${opts.weights ? "custom" : opts.plan} on a ${width}x${height} grid, ` +
      `sized for ${threads} charge threads (K ${K.toFixed(4)}) · ${r.nodes} layouts in ${Date.now() - t0} ms` +
      (r.complete ? "" : " — SEARCH CAPPED, best found so far")];
    for (const row of drawLayout(r.placed, defs, width, height)) out.push(`    ${row}`);
    out.push(`  (letters are fragment ids in base 36, + is a booster)`);
    for (const d of r.detail) {
      out.push(`  #${String(d.id).padStart(3)} ${describe(byId[d.id]).padEnd(46)} boost x${d.boost.toFixed(3)} ` +
        `-> projected x${d.effect.toFixed(4)}`);
    }
    const missing = Object.keys(weights).map(Number).filter((id) => !r.placed.some((p) => p.id === id));
    if (missing.length) out.push(`  not placed (traded for boosters or didn't fit): ${missing.map((id) => `#${id}`).join(", ")}`);

    if (cmd === "plan") {
      out.push(`  nothing changed. To use it: run stanek.js place --plan ${opts.plan} --yes   (clears the gift: charges are lost)`);
      ns.tprint("\n" + out.join("\n"));
      return;
    }
    if (!opts.yes) {
      out.push(`  NOT placed — clearing the gift throws away every charge so far. Add --yes.`);
      ns.tprint("\n" + out.join("\n"));
      return;
    }
    ns.stanek.clearGift();
    let ok = 0;
    for (const p of r.placed) {
      if (ns.stanek.placeFragment(p.x, p.y, p.rotation, p.id)) ok++;
      else out.push(`  !! placeFragment refused #${p.id} at (${p.x},${p.y}) rot ${p.rotation} — the game disagrees with stanek-lib's geometry; please paste this`);
    }
    out.push(`  placed ${ok}/${r.placed.length}. Next: run stanek.js charge`);
    ns.tprint("\n" + out.join("\n"));
    return;
  }
  printHelp(ns);
}

/** The gift as the game has it, with each fragment's live effect. */
function show(ns, width, height, defs, byId) {
  const active = ns.stanek.activeFragments();
  const placed = active.map((a) => {
    const { cells } = shapeCells(byId[a.id].shape, a.rotation);
    return { id: a.id, cells: cells.map(([x, y]) => [x + a.x, y + a.y]) };
  });
  const out = [`stanek show: ${width}x${height}, ${active.length} fragment(s)`];
  for (const row of drawLayout(placed, defs, width, height)) out.push(`    ${row}`);
  for (const a of active) {
    if (byId[a.id].type === BOOSTER_TYPE) continue;
    out.push(`  #${String(a.id).padStart(3)} ${describe(byId[a.id]).padEnd(46)} at (${a.x},${a.y}) · ` +
      `highest charge ${Math.round(a.highestCharge)} threads · ${Math.round(a.numCharge)} charges · effect x${a.chargedEffect.toFixed(4)}`);
  }
  if (!active.length) out.push("  empty. run stanek.js plan --plan bb, then place --yes");
  ns.tprint("\n" + out.join("\n"));
}

/** Launch the worker with every thread the host can spare, aimed at every non-booster fragment. */
function charge(ns, opts, byId) {
  const targets = ns.stanek.activeFragments().filter((a) => byId[a.id].type !== BOOSTER_TYPE);
  if (!targets.length) { ns.tprint("stanek charge: nothing to charge — place a layout first."); return; }
  if (ns.ps(opts.host).some((p) => p.filename === WORKER)) {
    ns.tprint(`stanek charge: ${WORKER} is already running on ${opts.host}. kill it first to restart with new settings.`);
    return;
  }
  const threads = opts.threads || chargerThreads(ns, opts);
  if (threads < 1) { ns.tprint(`stanek charge: no free RAM on ${opts.host} for even one thread (${ns.getScriptRam(WORKER, opts.host)} GB).`); return; }
  if (opts.host !== "home") ns.scp(WORKER, opts.host, "home");
  const args = [Number(opts.rounds), ...targets.flatMap((a) => [a.x, a.y])];
  const pid = ns.exec(WORKER, opts.host, threads, ...args);
  const secs = targets.length * (Number(opts.rounds) || 0);
  ns.tprint(pid
    ? `stanek charge: ${threads} threads on ${opts.host}, ${targets.length} fragment(s), ` +
      (Number(opts.rounds) ? `${opts.rounds} rounds (~${Math.ceil(secs / 60)} min, less in bonus time).` : "forever.") +
      `  Watch: run stanek.js show`
    : `stanek charge: exec refused on ${opts.host} (${threads} threads).`);
}

/** Threads of the worker that fit in the host's free RAM, minus the reserve. */
function chargerThreads(ns, opts) {
  const per = ns.getScriptRam(WORKER, "home") || 2.0;
  const free = ns.getServerMaxRam(opts.host) - ns.getServerUsedRam(opts.host) - Number(opts.reserve);
  return Math.max(0, Math.floor(free / per));
}

function describe(def) {
  const e = String(def.effect || "").replace(/\s+/g, " ");
  return e.length > 44 ? e.slice(0, 43) + "…" : e;
}

function parseWeights(text) {
  const out = {};
  for (const bit of String(text).split(",")) {
    const [id, w] = bit.split("=").map((s) => s.trim());
    if (id !== "" && Number.isFinite(Number(id)) && Number.isFinite(Number(w))) out[Number(id)] = Number(w);
  }
  return Object.keys(out).length ? out : null;
}

function printHelp(ns) {
  ns.tprint(
    "\nstanek.js — lay out and charge Stanek's Gift.\n" +
    "  run stanek.js show                        the gift now, with live effects\n" +
    "  run stanek.js plan  [--plan bb]           best layout (bb, combat, hack, money) — changes nothing\n" +
    "  run stanek.js plan  --weights \"10=1,30=2\" your own wish list: fragment id = weight\n" +
    "  run stanek.js place [--plan bb] --yes     clear the gift and place it (charges are lost)\n" +
    "  run stanek.js charge [--rounds 100] [--threads N] [--host home] [--reserve 8]\n" +
    "  Charge with ONE big script: effect grows with ln(the biggest single charge).\n"
  );
}
