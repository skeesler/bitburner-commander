/** @param {NS} ns
 *
 *  Buy purchased servers (never smaller than MIN_RAM) and stage the pipe
 *  batcher + its workers onto each, so every server is ready to run as its
 *  own batching host.
 *
 *  Usage: run purchase-servers.js [ram]
 *
 *  RAM is floored at MIN_RAM and snapped UP to a power of two (a purchased-
 *  server requirement). It does NOT auto-run a worker: a 512GB+ server wants
 *  to host a batcher, not run the reactive template. After buying, launch a
 *  pipe on each server against its own target, e.g.:
 *
 *      run batcher-pipe.js phantasy      (on cloud-server-0)
 *      run batcher-pipe.js omega-net     (on cloud-server-1)
 *
 *  Keep the targets DISTINCT so the batchers don't fight over one server.
 */

const MIN_RAM = 512;
const FILES = ["batcher-pipe.js", "hack.js", "grow.js", "weaken.js"];

export async function main(ns) {
  // Requested RAM, floored at MIN_RAM and snapped up to a power of two.
  let ram = Number(ns.args[0]) || MIN_RAM;
  if (ram < MIN_RAM) {
    ns.tprint(`WARN: ${ram}GB is below the ${MIN_RAM}GB floor — bumping to ${MIN_RAM}GB.`);
    ram = MIN_RAM;
  }
  ram = ceilPow2(ram);

  const limit = ns.cloud.getServerLimit();
  let owned = ns.cloud.getServerNames().length;

  ns.tprint(`Buying ${ram}GB servers up to the ${limit}-server limit (${owned} owned).`);

  while (owned < limit) {
    const cost = ns.cloud.getServerCost(ram);
    if (ns.getServerMoneyAvailable("home") >= cost) {
      const hostname = ns.cloud.purchaseServer("cloud-server-" + owned, ram);
      if (hostname) {
        ns.scp(FILES, hostname);
        owned++;
        ns.tprint(`Bought ${hostname} (${ram}GB) [${owned}/${limit}] — batcher staged. ` +
                  `Launch:  run batcher-pipe.js <target>  on ${hostname}`);
      }
    } else {
      // Not enough cash yet — show progress and wait rather than spin.
      ns.print(`Waiting: need ~$${cost.toExponential(2)} for a ${ram}GB server ` +
               `(${owned}/${limit} owned).`);
    }
    await ns.sleep(5000);
  }

  ns.tprint(`Done — ${owned}/${limit} servers owned, all staged with the batcher.`);
}

/** Smallest power of two >= n. */
function ceilPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}
