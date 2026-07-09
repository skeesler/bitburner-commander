/** @param {NS} ns
 *  Reset the COMMANDER rig only. Bitburner 3.0's "Kill all active scripts"
 *  button already nukes everything indiscriminately — this is the surgical
 *  version: it kills the commander and everything it deploys, across home +
 *  cloud + world, but leaves anything else running.
 *
 *  In particular stock-trader.js (separate income stream) SURVIVES a reset.
 *
 *      run reset-scripts.js            # clean slate for the rig, then:
 *      run commander.js
 *
 *  To reset a script that isn't the commander's, just add its filename to
 *  OWNED below. Anything not listed here is left strictly alone.
 */

// The commander's runtime family: the controllers it launches + the worker
// scripts it deploys to every server. Edit this list to change what a reset
// touches. (This file kills itself last, regardless of the list.)
const OWNED = new Set([
  "commander.js",            // the brain
  "fleet-batcher.js",        // per-fleet controller
  "batcher.js",              // single-target batcher
  "batcher-pipe.js",         // pipelined batcher
  "contract-finder.js",      // coding-contract solver (commander launches it)
  "hack.js", "grow.js", "weaken.js",   // HGW workers
  "early-hacking-template.js",         // early-game reactive worker
  "xp-farm.js",                        // early-game XP farmer (weaken-for-XP)
]);

export async function main(ns) {
  // Breadth-first walk of every reachable server.
  const seen = new Set(["home"]);
  const queue = ["home"];
  while (queue.length) {
    for (const n of ns.scan(queue.shift())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }

  const self = ns.getScriptName();
  const counts = {};   // filename -> how many instances killed
  let spared = 0;
  for (const host of seen) {
    for (const p of ns.ps(host)) {
      if (host === "home" && p.filename === self) continue;   // don't kill ourselves
      if (!OWNED.has(p.filename)) { spared++; continue; }     // not ours — leave it running
      ns.kill(p.pid);
      counts[p.filename] = (counts[p.filename] || 0) + 1;
    }
  }

  const killed = Object.values(counts).reduce((a, b) => a + b, 0);
  const breakdown = Object.keys(counts).sort().map(f => `${f}×${counts[f]}`).join(", ") || "nothing";
  ns.tprint(`Reset commander rig: killed ${killed} script(s) [${breakdown}] across ${seen.size} servers.`);
  if (spared) ns.tprint(`Left ${spared} non-commander script(s) running (e.g. stock-trader.js). Now: run commander.js`);
}
