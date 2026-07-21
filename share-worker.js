/** @param {NS} ns
 *
 *  SHARE worker — loops ns.share() to donate this thread's RAM toward faction
 *  reputation gain while you're working for a faction.
 *
 *  Deliberately imports NOTHING and calls only ns.share(), so its per-thread RAM
 *  cost stays as small as possible (AGENTS.md: RAM is charged for every ns.* a
 *  script so much as *mentions*). Keep it that way — anything else you need
 *  belongs in the manager, not here.
 *
 *  Deployed in bulk by share-manager.js. Standalone:  run share-worker.js -t N
 */
export async function main(ns) {
  while (true) await ns.share();
}
