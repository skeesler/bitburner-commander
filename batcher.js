/** @param {NS} ns
 *
 *  Formulas-powered HWGW batcher (single-host, sequential batches).
 *
 *  Run this ON the beefiest server you have rooted (home, or a big
 *  purchased server), because every batch's threads must fit in that
 *  one host's RAM:
 *
 *      run batcher.js <target> [hackFraction]
 *
 *  e.g.  run batcher.js phantasy 0.25     (steal 25% of max money per batch)
 *
 *  Requires:
 *    - Formulas.exe on home
 *    - hack.js / grow.js / weaken.js present on THIS host (scp them over)
 *
 *  What it does:
 *    1. Preps the target to min security + max money.
 *    2. Repeatedly fires a Hack/Weaken/Grow/Weaken batch whose thread
 *       counts are computed exactly from the Formulas API, timed so the
 *       four operations land ~SPACER ms apart in H,W,G,W order.
 *    3. Each batch leaves the server exactly prepped again.
 *
 *  This is the SAFE version: one batch at a time (it waits for a batch to
 *  fully land before starting the next). Correct and easy to reason about.
 *  The next upgrade — overlapping/pipelined batches — is a big throughput
 *  win and a natural follow-up once you've watched this run clean.
 */

const HACK = "hack.js", GROW = "grow.js", WEAKEN = "weaken.js";
const SPACER = 200;                                   // ms between the four landings
const SEC_HACK = 0.002, SEC_GROW = 0.004, SEC_WEAKEN = 0.05;  // per-thread security deltas

export async function main(ns) {
  ns.disableLog("ALL");
  const target = ns.args[0];
  const hackFraction = ns.args[1] ?? 0.25;
  if (!target) { ns.tprint("Usage: run batcher.js <target> [hackFraction]"); return; }
  if (!ns.fileExists("Formulas.exe", "home")) { ns.tprint("ERROR: need Formulas.exe on home"); return; }

  const host = ns.getHostname();
  const cores = ns.getServer(host).cpuCores;
  for (const w of [HACK, GROW, WEAKEN])
    if (!ns.fileExists(w, host)) { ns.tprint(`ERROR: ${w} not on ${host} — scp it here first.`); return; }
  if (!ns.hasRootAccess(target)) { ns.tprint(`ERROR: no root on ${target}`); return; }

  ns.ui.openTail();
  ns.print(`Batching ${target} from ${host} (${cores} cores), ${Math.round(hackFraction * 100)}%/batch`);

  await prep(ns, target, host, cores);
  ns.print("Prepped. Batching...");

  while (true) {
    if (!isPrepped(ns, target)) { await prep(ns, target, host, cores); continue; }

    const b = planBatch(ns, target, cores, hackFraction);

    // Scale the whole batch down proportionally if it doesn't fit in RAM.
    // Scaling all four legs by the same ratio keeps the money/security
    // bookkeeping balanced (you just steal a smaller slice this batch).
    const ratio = scaleToRam(ns, host, [
      { script: HACK,   threads: b.hackThreads },
      { script: GROW,   threads: b.growThreads },
      { script: WEAKEN, threads: b.weaken1Threads + b.weaken2Threads },
    ]);
    const hT = Math.floor(b.hackThreads * ratio);
    const w1 = Math.floor(b.weaken1Threads * ratio);
    const gT = Math.floor(b.growThreads * ratio);
    const w2 = Math.floor(b.weaken2Threads * ratio);

    if (hT < 1 || w1 < 1 || gT < 1 || w2 < 1) {
      ns.print("WARN: host RAM too small for even one batch — waiting.");
      await ns.sleep(1000);
      continue;
    }

    exec(ns, HACK,   host, hT, target, b.hackDelay);
    exec(ns, WEAKEN, host, w1, target, b.weaken1Delay);
    exec(ns, GROW,   host, gT, target, b.growDelay);
    exec(ns, WEAKEN, host, w2, target, b.weaken2Delay);

    ns.print(`batch  H${hT} W${w1} G${gT} W${w2}  ~${(b.duration / 1000).toFixed(1)}s`);
    await ns.sleep(b.duration + SPACER * 2);
  }
}

function isPrepped(ns, target) {
  return ns.getServerSecurityLevel(target) <= ns.getServerMinSecurityLevel(target) + 0.01 &&
         ns.getServerMoneyAvailable(target) >= ns.getServerMaxMoney(target) * 0.999;
}

/** Compute exact thread counts + landing delays for one HWGW batch. */
function planBatch(ns, target, cores, hackFraction) {
  const f = ns.formulas.hacking;
  const s = ns.getServer(target);
  const p = ns.getPlayer();

  // Model the server as fully prepped — that's the state each op assumes.
  s.hackDifficulty = s.minDifficulty;
  s.moneyAvailable = s.moneyMax;

  const perThread = f.hackPercent(s, p);                  // fraction stolen per hack thread
  const hackThreads = Math.max(1, Math.floor(hackFraction / perThread));
  const stolenFrac = Math.min(0.99, perThread * hackThreads);

  // Grow must refill from (1 - stolen) back to full. 5% headroom for safety.
  s.moneyAvailable = s.moneyMax * (1 - stolenFrac);
  const growThreads = Math.max(1, Math.ceil(f.growThreads(s, p, s.moneyMax, cores) * 1.05));

  // Weakens cancel the security each op adds.
  const weaken1Threads = Math.max(1, Math.ceil(hackThreads * SEC_HACK / SEC_WEAKEN));
  const weaken2Threads = Math.max(1, Math.ceil(growThreads * SEC_GROW / SEC_WEAKEN));

  // Times are computed at min security (prepped) — that's when the ops run.
  s.moneyAvailable = s.moneyMax;
  const wTime = f.weakenTime(s, p);
  const gTime = f.growTime(s, p);
  const hTime = f.hackTime(s, p);

  // Land order: hack, weaken1, grow, weaken2 — each SPACER apart.
  return {
    hackThreads, growThreads, weaken1Threads, weaken2Threads,
    hackDelay:    Math.max(0, wTime - SPACER - hTime),   // finishes SPACER before weaken1
    weaken1Delay: 0,                                     // finishes at wTime
    growDelay:    Math.max(0, wTime + SPACER - gTime),   // finishes SPACER after weaken1
    weaken2Delay: 2 * SPACER,                            // finishes SPACER after grow
    duration:     wTime + 2 * SPACER,
  };
}

/** Bring the target to min security + max money before batching. */
async function prep(ns, target, host, cores) {
  const f = ns.formulas.hacking;
  const maxMoney = ns.getServerMaxMoney(target);
  const minSec = ns.getServerMinSecurityLevel(target);

  while (!isPrepped(ns, target)) {
    const curSec = ns.getServerSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const s = ns.getServer(target);
    const p = ns.getPlayer();

    // Threads to refill money (modeled at min security).
    s.hackDifficulty = minSec;
    let growThreads = curMoney < maxMoney ? Math.ceil(f.growThreads(s, p, maxMoney, cores)) : 0;

    // Weaken enough to clear current excess security AND the security grow will add.
    const excessSec = curSec - minSec;
    let weakenThreads = Math.max(1, Math.ceil((excessSec + growThreads * SEC_GROW) / SEC_WEAKEN));

    const ratio = scaleToRam(ns, host, [
      { script: GROW,   threads: growThreads },
      { script: WEAKEN, threads: weakenThreads },
    ]);
    growThreads = Math.floor(growThreads * ratio);
    weakenThreads = Math.max(1, Math.floor(weakenThreads * ratio));

    // Time at CURRENT security — that's how long these ops actually take right now.
    s.hackDifficulty = curSec;
    const wTime = f.weakenTime(s, p);
    const gTime = f.growTime(s, p);
    const growDelay = Math.max(0, wTime - SPACER - gTime);   // grow lands just before weaken

    const gPid = growThreads > 0 ? exec(ns, GROW, host, growThreads, target, growDelay) : 1;
    const wPid = exec(ns, WEAKEN, host, weakenThreads, target, 0);
    if (gPid === 0 || wPid === 0)
      ns.print("WARN: exec failed — host is out of RAM. Prep will stall; use a bigger host or a lighter target.");

    const moneyPct = (curMoney / maxMoney * 100).toFixed(1);
    ns.print(`prep   $${moneyPct}%  sec+${(curSec - minSec).toFixed(2)}  ` +
             `grow ${growThreads} / weaken ${weakenThreads}  ~${(wTime / 1000).toFixed(1)}s`);
    await ns.sleep(wTime + SPACER * 2);
  }
}

/** Ratio (<=1) to scale a set of jobs down so they fit in this host's free RAM. */
function scaleToRam(ns, host, jobs) {
  let need = 0;
  for (const j of jobs) need += ns.getScriptRam(j.script) * j.threads;
  if (need === 0) return 1;
  const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
  return Math.min(1, free / need);
}

function exec(ns, script, host, threads, target, delay) {
  return threads > 0 ? ns.exec(script, host, threads, target, Math.round(delay)) : 0;
}
