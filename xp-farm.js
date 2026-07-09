/** @param {NS} ns
 *
 *  XP-FARM worker — loops weaken() on a target purely to farm HACKING XP.
 *
 *  The trick that makes this worth it in the early game: weaken() (and grow())
 *  need only ROOT access, NOT a hacking level that matches the server. So you
 *  can weaken a big, high-level box you've nuked but can't yet *hack*, and it
 *  grants hacking XP on every completion — even once the server is already at
 *  minimum security (XP is paid on the operation finishing, not on it having an
 *  effect). So a server you can't profitably hack becomes a steady XP tap.
 *
 *  commander.js fallback mode launches this to soak up RAM that reactive
 *  money-hacking can't use — when your target pool is too thin for your RAM
 *  (few crackers / low level), the leftover becomes levels instead of idle GB.
 *  Raising your hacking level is what opens more targets, so this is the RAM
 *  paying to unstick itself.
 *
 *  Usage (standalone):  run xp-farm.js [target]
 */
export async function main(ns) {
  const target = ns.args[0];
  if (!target || !ns.hasRootAccess(target)) {
    ns.tprint(`ERROR: xp-farm needs a rooted target as arg 0 (got ${target}).`);
    return;
  }
  while (true) await ns.weaken(target);
}
