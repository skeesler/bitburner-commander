/** @param {NS} ns
 *
 *  Formulas-powered HWGW batcher — PIPELINED (single-host).
 *
 *      run batcher-pipe.js <target> [hackFraction] [quiet] [reserveGB]
 *
 *  quiet:     pass the string "quiet" to suppress the auto tail window.
 *  reserveGB: hold this many GB free on the host (e.g. on home, so the
 *             commander and contract-solver keep their room). Default 0.
 *
 *  Same math as batcher.js, but instead of waiting for each batch to land,
 *  it launches a fresh batch every BATCH_GAP ms. Dozens are in flight at
 *  once, landing in a continuous H,W,G,W,H,W,G,W... stream. The host's RAM
 *  is the only limit on how many batches fit in the pipe.
 *
 *  Requires:
 *    - Formulas.exe on home
 *    - hack.js / grow.js / weaken.js on THIS host
 *
 *  Notes / honest caveats:
 *    - Each op carries a per-batch id so late/early landings are visible in
 *      the log, but this version does NOT hard-correct desync — if the
 *      server drifts off "prepped" (level-up mid-run, a stray script), it
 *      pauses the pipe, re-preps, and resumes. That's the safe behavior.
 *    - SPACER and BATCH_GAP are the knobs. Tighter = more throughput but
 *      less margin for timing jitter. 200 / 800 ms is a calm default.
 */

const HACK = "hack.js", GROW = "grow.js", WEAKEN = "weaken.js";
const SPACER = 200;      // ms between the 4 landings WITHIN a batch
const BATCH_GAP = 800;   // ms between successive batch launches (>= 4*SPACER)
const SEC_HACK = 0.002, SEC_GROW = 0.004, SEC_WEAKEN = 0.05;

export async function main(ns) {
  ns.disableLog("ALL");
  const target = ns.args[0];
  const hackFraction = ns.args[1] ?? 0.25;
  const reserve = Number(ns.args[3]) || 0;   // GB to hold free on this host (e.g. home)
  if (!target) { ns.tprint("Usage: run batcher-pipe.js <target> [hackFraction] [quiet] [reserveGB]"); return; }
  if (!ns.fileExists("Formulas.exe", "home")) { ns.tprint("ERROR: need Formulas.exe on home"); return; }

  const host = ns.getHostname();
  const cores = ns.getServer(host).cpuCores;
  for (const w of [HACK, GROW, WEAKEN])
    if (!ns.fileExists(w, host)) { ns.tprint(`ERROR: ${w} not on ${host} — scp it here first.`); return; }
  if (!ns.hasRootAccess(target)) { ns.tprint(`ERROR: no root on ${target}`); return; }

  // Auto-open a tail window ONLY for manual runs. The commander launches us
  // with a "quiet" 3rd arg so a 25-server fleet doesn't spawn 25 windows —
  // tail a specific server by hand (`tail cloud-server-N`) if you want to watch.
  if (ns.args[2] !== "quiet") ns.ui.openTail();
  ns.print(`Pipelining ${target} from ${host} (${cores} cores), ${Math.round(hackFraction * 100)}%/batch`);

  await prep(ns, target, host, cores, reserve);
  ns.print("Prepped. Filling the pipe...");

  let id = 0;
  let launched = 0, skipped = 0;
  let lastReport = 0;

  while (true) {
    // Only re-prep on GROSS desync. A healthy pipeline oscillates — money dips
    // toward (1-hackFraction)*max between each batch's hack and grow, and
    // security ticks up before its weakens land. That is NOT drift. We only
    // intervene if the server has genuinely run away (e.g. a mid-run level-up
    // shifted all the op times and the pipe fell out of order).
    if (!isHealthy(ns, target, hackFraction)) {
      ns.print(`WARN: ${target} genuinely desynced — draining and re-prepping.`);
      await drain(ns, target, host);
      await prep(ns, target, host, cores, reserve);
      ns.print("Re-prepped. Refilling the pipe...");
    }

    const b = planBatch(ns, target, cores, hackFraction);
    const ratio = scaleForOneBatch(ns, host, b, reserve);

    const hT = Math.floor(b.hackThreads * ratio);
    const w1 = Math.floor(b.weaken1Threads * ratio);
    const gT = Math.floor(b.growThreads * ratio);
    const w2 = Math.floor(b.weaken2Threads * ratio);

    if (hT >= 1 && w1 >= 1 && gT >= 1 && w2 >= 1 && fits(ns, host, b, ratio, reserve)) {
      id++;
      exec(ns, HACK,   host, hT, target, b.hackDelay,    id);
      exec(ns, WEAKEN, host, w1, target, b.weaken1Delay, id);
      exec(ns, GROW,   host, gT, target, b.growDelay,    id);
      exec(ns, WEAKEN, host, w2, target, b.weaken2Delay, id);
      launched++;
    } else {
      // Pipe is full (no RAM for another batch right now). That's the
      // steady state at capacity — just wait for room to free up.
      skipped++;
    }

    // Periodic one-line status so the log doesn't scroll forever.
    const now = tick(lastReport);
    if (now) {
      const inFlight = countInFlight(ns, host);
      ns.print(`pipe   in-flight ~${inFlight}  launched ${launched}  waits ${skipped}  ` +
               `H${hT} W${w1} G${gT} W${w2}`);
      lastReport = now;
      launched = 0; skipped = 0;
    }

    await ns.sleep(BATCH_GAP);
  }
}

// Strict: only true at a batch boundary. Used by prep() to know it's finished.
function isPrepped(ns, target) {
  return ns.getServerSecurityLevel(target) <= ns.getServerMinSecurityLevel(target) + 0.01 &&
         ns.getServerMoneyAvailable(target) >= ns.getServerMaxMoney(target) * 0.999;
}

// Tolerant: true throughout normal batch oscillation, false only on real desync.
function isHealthy(ns, target, hackFraction) {
  const maxMoney = ns.getServerMaxMoney(target);
  const minSec = ns.getServerMinSecurityLevel(target);
  const money = ns.getServerMoneyAvailable(target);
  const sec = ns.getServerSecurityLevel(target);
  const moneyFloor = maxMoney * (1 - hackFraction) * 0.5;  // well under one batch's bite
  const secCeiling = minSec + 5;                           // generous vs a batch's small spike
  return money >= moneyFloor && sec <= secCeiling;
}

function planBatch(ns, target, cores, hackFraction) {
  const f = ns.formulas.hacking;
  const s = ns.getServer(target);
  const p = ns.getPlayer();
  s.hackDifficulty = s.minDifficulty;
  s.moneyAvailable = s.moneyMax;

  const perThread = f.hackPercent(s, p);
  const hackThreads = Math.max(1, Math.floor(hackFraction / perThread));
  const stolenFrac = Math.min(0.99, perThread * hackThreads);

  s.moneyAvailable = s.moneyMax * (1 - stolenFrac);
  const growThreads = Math.max(1, Math.ceil(f.growThreads(s, p, s.moneyMax, cores) * 1.05));

  const weaken1Threads = Math.max(1, Math.ceil(hackThreads * SEC_HACK / SEC_WEAKEN));
  const weaken2Threads = Math.max(1, Math.ceil(growThreads * SEC_GROW / SEC_WEAKEN));

  s.moneyAvailable = s.moneyMax;
  const wTime = f.weakenTime(s, p);
  const gTime = f.growTime(s, p);
  const hTime = f.hackTime(s, p);

  return {
    hackThreads, growThreads, weaken1Threads, weaken2Threads,
    hackDelay:    Math.max(0, wTime - SPACER - hTime),
    weaken1Delay: 0,
    growDelay:    Math.max(0, wTime + SPACER - gTime),
    weaken2Delay: 2 * SPACER,
    duration:     wTime + 2 * SPACER,
  };
}

/** RAM for a whole batch, scaled by ratio. */
function batchRam(ns, b, ratio) {
  return ns.getScriptRam(HACK)   * Math.floor(b.hackThreads    * ratio)
       + ns.getScriptRam(GROW)   * Math.floor(b.growThreads    * ratio)
       + ns.getScriptRam(WEAKEN) * (Math.floor(b.weaken1Threads * ratio)
                                  + Math.floor(b.weaken2Threads * ratio));
}

/** Does one more full-size batch fit in the RAM free right now (minus reserve)? */
function fits(ns, host, b, ratio, reserve = 0) {
  const free = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve);
  return batchRam(ns, b, ratio) <= free;
}

/** Scale a single batch down only if one batch can't fit the host (minus reserve). */
function scaleForOneBatch(ns, host, b, reserve = 0) {
  const maxRam = Math.max(0, ns.getServerMaxRam(host) - reserve);
  const full = batchRam(ns, b, 1);
  if (full <= maxRam) return 1;              // fits — pipeline many at ratio 1
  return Math.min(1, maxRam / full) * 0.98;  // single batch too big; shrink it
}

async function drain(ns, target, host) {
  // Wait for all in-flight workers on this host to finish before re-prepping.
  while (countInFlight(ns, host) > 0) await ns.sleep(500);
}

function countInFlight(ns, host) {
  // Count live processes of our three worker scripts on this host.
  return ns.ps(host).filter(p => p.filename === HACK || p.filename === GROW || p.filename === WEAKEN).length;
}

async function prep(ns, target, host, cores, reserve = 0) {
  const f = ns.formulas.hacking;
  const maxMoney = ns.getServerMaxMoney(target);
  const minSec = ns.getServerMinSecurityLevel(target);

  while (!isPrepped(ns, target)) {
    const curSec = ns.getServerSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const s = ns.getServer(target);
    const p = ns.getPlayer();
    s.hackDifficulty = minSec;

    let growThreads = curMoney < maxMoney ? Math.ceil(f.growThreads(s, p, maxMoney, cores)) : 0;
    const excessSec = curSec - minSec;
    let weakenThreads = Math.max(1, Math.ceil((excessSec + growThreads * SEC_GROW) / SEC_WEAKEN));

    const ratio = prepRatio(ns, host, growThreads, weakenThreads, reserve);
    growThreads = Math.floor(growThreads * ratio);
    weakenThreads = Math.max(1, Math.floor(weakenThreads * ratio));

    s.hackDifficulty = curSec;
    const wTime = f.weakenTime(s, p);
    const gTime = f.growTime(s, p);
    const growDelay = Math.max(0, wTime - SPACER - gTime);

    const gPid = growThreads > 0 ? exec(ns, GROW, host, growThreads, target, growDelay, 0) : 1;
    const wPid = exec(ns, WEAKEN, host, weakenThreads, target, 0, 0);
    if (gPid === 0 || wPid === 0)
      ns.print("WARN: exec failed during prep — host out of RAM.");

    ns.print(`prep   $${(curMoney / maxMoney * 100).toFixed(1)}%  sec+${(curSec - minSec).toFixed(2)}  ` +
             `grow ${growThreads} / weaken ${weakenThreads}  ~${(wTime / 1000).toFixed(1)}s`);
    await ns.sleep(wTime + SPACER * 2);
  }
}

function prepRatio(ns, host, growThreads, weakenThreads, reserve = 0) {
  const need = ns.getScriptRam(GROW) * growThreads + ns.getScriptRam(WEAKEN) * weakenThreads;
  if (need === 0) return 1;
  const free = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve);
  return Math.min(1, free / need);
}

/** exec a worker; 5th script arg is a batch id (unique arg keeps procs distinct). */
function exec(ns, script, host, threads, target, delay, id) {
  return threads > 0 ? ns.exec(script, host, threads, target, Math.round(delay), id) : 0;
}

/** crude wall-clock tick: returns a truthy timestamp ~every 5s, else 0. */
function tick(last) {
  const t = Date.now();
  return (t - last) >= 5000 ? t : 0;
}
