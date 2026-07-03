/** @param {NS} ns
 *
 *  Early Hacking Template (hardened worker).
 *
 *  Designed to be launched by deploy.js, which passes the target hostname
 *  as the first argument and has ALREADY rooted both this host and the
 *  target. So this script does no cracking/nuking of its own — that keeps
 *  its static RAM cost minimal, which lets deploy.js pack more threads
 *  onto every server.
 *
 *  Usage (standalone):  run early-hacking-template.js [target]
 *  Usually launched by: deploy.js  (which supplies [target])
 */
export async function main(ns) {
  // Target comes from the deploy script's exec() argument.
  // Falls back to joesguns so a bare `run` still does something sane.
  const target = ns.args[0] || "joesguns";

  // Bail out clearly if we somehow don't have root on the target
  // (e.g. run by hand before deploy.js prepped it).
  if (!ns.hasRootAccess(target)) {
    ns.tprint(`ERROR: no root on ${target}. Run deploy.js first, or nuke it.`);
    return;
  }

  // These are constant for a given server, so read them once.
  const maxMoney = ns.getServerMaxMoney(target);
  const minSec = ns.getServerMinSecurityLevel(target);

  // Tunables:
  //  - hack once money is within 75% of max (skip the slow last stretch of grow)
  //  - allow a small security cushion so the fleet doesn't over-weaken
  const moneyThresh = maxMoney * 0.75;
  const secThresh = minSec + 5;

  // Continuously weaken -> grow -> hack, keeping the target prepped.
  while (true) {
    if (ns.getServerSecurityLevel(target) > secThresh) {
      await ns.weaken(target);
    } else if (ns.getServerMoneyAvailable(target) < moneyThresh) {
      await ns.grow(target);
    } else {
      await ns.hack(target);
    }
  }
}
