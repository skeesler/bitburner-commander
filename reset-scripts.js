/** @param {NS} ns
 *  Emergency stop / clean slate. Kills EVERY script on EVERY reachable server
 *  (home + cloud + world), except itself. Use it to cleanly hand off between
 *  major versions of the rig, or to halt everything fast.
 *
 *      run reset-scripts.js
 *
 *  Then start fresh with:  run commander.js
 */
export async function main(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  while (queue.length) {
    for (const n of ns.scan(queue.shift())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }

  const self = ns.getScriptName();
  let killed = 0;
  for (const host of seen) {
    for (const p of ns.ps(host)) {
      if (host === "home" && p.filename === self) continue;   // don't kill ourselves
      ns.kill(p.pid);
      killed++;
    }
  }
  ns.tprint(`Killed ${killed} script(s) across ${seen.size} servers. Clean slate — now: run commander.js`);
}
