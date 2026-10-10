/** @param {NS} ns
 *
 *  STANEK-CHARGE — the charging worker. Launched by `stanek.js charge`; you rarely run it by hand.
 *
 *      run stanek-charge.js -t THREADS ROUNDS x1 y1 x2 y2 ...
 *
 *  Charges each listed fragment ROUNDS times (0 = forever), in turn. Every call takes 1s (0.2s in
 *  bonus time) and counts THIS SCRIPT'S thread count x the host's core bonus [SRC: Stanek.ts].
 *
 *  WHY IT'S THIS SMALL. A fragment's effect grows with ln(highest single charge + 1), so the only
 *  number that matters is threads per call, and every GB this script costs is threads it can't run.
 *  It mentions nothing but chargeFragment (0.4 GB) — 2.0 GB a thread. Even activeFragments (5 GB)
 *  would cost 70% of the threads, which is why stanek.js passes the coordinates in as arguments.
 */
export async function main(ns) {
  const rounds = Number(ns.args[0]) || 0;
  const coords = ns.args.slice(1).map(Number);
  if (coords.length < 2 || coords.length % 2) {
    ns.tprint("stanek-charge: usage — run stanek-charge.js -t N ROUNDS x1 y1 [x2 y2 ...] (stanek.js charge does this)");
    return;
  }
  for (let r = 0; rounds === 0 || r < rounds; r++) {
    for (let i = 0; i < coords.length; i += 2) {
      try { await ns.stanek.chargeFragment(coords[i], coords[i + 1]); }
      catch (e) { ns.print(`skip (${coords[i]},${coords[i + 1]}): ${String(e).slice(0, 120)}`); }
    }
  }
}
