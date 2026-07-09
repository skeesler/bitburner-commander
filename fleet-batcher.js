/** @param {NS} ns
 *
 *  FLEET-BATCHER — distributed HWGW batcher. One controller drives ONE target
 *  using a FLEET of hosts, bin-packing each batch's threads across the fleet's
 *  free RAM (all timed to land together). This is what lets many small servers
 *  gang up on a single juicy target, instead of wasting a whole server on a
 *  scrap. There is exactly ONE fleet-batcher per target, so nothing collides.
 *
 *  Launched by commander.js with a single JSON config arg:
 *    { "target": "catalyst",
 *      "hosts": [ {"h":"home","r":64}, {"h":"cloud-server-3","r":0}, ... ],
 *      "hf": 0.1 }
 *  where each host is {h: hostname, r: GB to keep free on it}.
 *
 *  All the batching math (planBatch, timing, prep, health) is identical to
 *  batcher-pipe.js — only the RAM/exec layer changed from one host to a fleet.
 *  Posts an earnings snapshot to STATS_PORT for the commander to display.
 */

const HACK = "hack.js", GROW = "grow.js", WEAKEN = "weaken.js";
const WORKERS = [HACK, GROW, WEAKEN];
const SPACER = 200;       // ms between the 4 landings WITHIN a batch
const BATCH_GAP = 800;    // ms between successive batch launches
const SEC_HACK = 0.002, SEC_GROW = 0.004, SEC_WEAKEN = 0.05;
const STATS_PORT = 1;     // earnings snapshots for the commander

export async function main(ns) {
  ns.disableLog("ALL");
  let cfg;
  try { cfg = JSON.parse(ns.args[0]); }
  catch { ns.tprint("ERROR: fleet-batcher needs a JSON config arg"); return; }

  const target = cfg.target;
  const hackFraction = cfg.hf ?? 0.1;
  const fleet = cfg.hosts;                     // [{h, r}]
  // Formulas.exe makes the batch math EXACT at any hypothetical state. Without it
  // we lean on a truth the reactive worker already relies on: once prep() has the
  // target pinned at min-security/max-money, the live API (hackAnalyze, growthAnalyze,
  // getWeakenTime, …) reports precisely the prepped-state numbers — because the
  // server IS in that state. So we can plan and time a real HWGW batch either way.
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  if (!ns.hasRootAccess(target)) { ns.tprint(`ERROR: no root on ${target}`); return; }

  // Make sure the workers exist on every fleet host.
  for (const { h } of fleet)
    for (const w of WORKERS)
      if (!ns.fileExists(w, h)) ns.scp(w, h, "home");

  // Grow sizing uses the MINIMUM cores in the fleet. Conservative on purpose:
  // if we sized for home's high cores but grow threads landed on 1-core cloud
  // servers, we'd under-grow and the target would slowly drift. Over-growing is
  // harmless (money caps at max; the matching weaken still cancels the security).
  const cores = Math.min(...fleet.map(({ h }) => ns.getServer(h).cpuCores));
  const maxMoney = ns.getServerMaxMoney(target);

  await prep(ns, target, fleet, cores, hasFormulas);

  let id = 0, estEarned = 0, lastReport = 0;
  while (true) {
    if (!isHealthy(ns, target, hackFraction)) {
      await drain(ns, fleet);
      await prep(ns, target, fleet, cores, hasFormulas);
    }

    const b = planBatch(ns, target, cores, hackFraction, hasFormulas);
    // Only launch a batch if the WHOLE thing fits in the fleet's free RAM —
    // a partial batch would be unbalanced (hack without enough grow = drain).
    // The 5% headroom absorbs per-host fragmentation (free RAM scattered in
    // sub-thread slivers) so allocate() can always place every op fully.
    if (totalBatchRam(ns, b) <= fleetFree(ns, fleet) * 0.95) {
      id++;
      allocate(ns, fleet, HACK,   b.hackThreads,    target, b.hackDelay,    id);
      allocate(ns, fleet, WEAKEN, b.weaken1Threads, target, b.weaken1Delay, id);
      allocate(ns, fleet, GROW,   b.growThreads,    target, b.growDelay,    id);
      allocate(ns, fleet, WEAKEN, b.weaken2Threads, target, b.weaken2Delay, id);
      estEarned += b.stolenFrac * maxMoney;
    }

    // Best-effort earnings snapshot (never let stats break batching).
    const now = tick(lastReport);
    if (now) {
      try { ns.tryWritePort(STATS_PORT, JSON.stringify({ target, estEarned, hosts: fleet.length })); } catch {}
      lastReport = now;
    }
    await ns.sleep(BATCH_GAP);
  }
}

/** Bin-pack `threads` of `script` across the fleet's free RAM, all with the same
 *  target/delay/id so they land together. A single op may span several hosts;
 *  effects sum, so splitting is fine. */
function allocate(ns, fleet, script, threads, target, delay, id) {
  const ram = ns.getScriptRam(script);
  let remaining = threads;
  for (const { h, r } of fleet) {
    if (remaining <= 0) break;
    const free = Math.max(0, ns.getServerMaxRam(h) - ns.getServerUsedRam(h) - r);
    const canFit = Math.floor(free / ram);
    if (canFit <= 0) continue;
    const put = Math.min(canFit, remaining);
    if (ns.exec(script, h, put, target, Math.round(delay), id)) remaining -= put;
  }
  return threads - remaining;   // how many we actually placed
}

function fleetFree(ns, fleet) {
  let free = 0;
  for (const { h, r } of fleet) free += Math.max(0, ns.getServerMaxRam(h) - ns.getServerUsedRam(h) - r);
  return free;
}

function totalBatchRam(ns, b) {
  return b.hackThreads * ns.getScriptRam(HACK)
       + b.growThreads * ns.getScriptRam(GROW)
       + (b.weaken1Threads + b.weaken2Threads) * ns.getScriptRam(WEAKEN);
}

function fleetInFlight(ns, fleet) {
  let n = 0;
  for (const { h } of fleet)
    n += ns.ps(h).filter(p => p.filename === HACK || p.filename === GROW || p.filename === WEAKEN).length;
  return n;
}

async function drain(ns, fleet) {
  while (fleetInFlight(ns, fleet) > 0) await ns.sleep(500);
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
  return money >= maxMoney * (1 - hackFraction) * 0.5 && sec <= minSec + 5;
}

function planBatch(ns, target, cores, hackFraction, hasFormulas) {
  let perThread, hackThreads, stolenFrac, growThreads, wTime, gTime, hTime;

  if (hasFormulas) {
    const f = ns.formulas.hacking;
    const s = ns.getServer(target);
    const p = ns.getPlayer();
    s.hackDifficulty = s.minDifficulty;
    s.moneyAvailable = s.moneyMax;

    perThread = f.hackPercent(s, p);
    hackThreads = Math.max(1, Math.floor(hackFraction / perThread));
    stolenFrac = Math.min(0.99, perThread * hackThreads);

    s.moneyAvailable = s.moneyMax * (1 - stolenFrac);
    growThreads = Math.max(1, Math.ceil(f.growThreads(s, p, s.moneyMax, cores) * 1.05));

    s.moneyAvailable = s.moneyMax;
    wTime = f.weakenTime(s, p);
    gTime = f.growTime(s, p);
    hTime = f.hackTime(s, p);
  } else {
    // Formulas-free: read the LIVE (prepped) server. Valid because the caller keeps
    // the target at min-sec/max-money, so current-state analysis == prepped-state.
    perThread = ns.hackAnalyze(target);                          // fraction stolen per thread
    hackThreads = Math.max(1, Math.floor(hackFraction / Math.max(perThread, 1e-9)));
    stolenFrac = Math.min(0.99, perThread * hackThreads);

    const mult = 1 / Math.max(1 - stolenFrac, 0.01);            // grow back exactly what hack takes
    growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, mult, cores) * 1.05));

    wTime = ns.getWeakenTime(target);
    gTime = ns.getGrowTime(target);
    hTime = ns.getHackTime(target);
  }

  const weaken1Threads = Math.max(1, Math.ceil(hackThreads * SEC_HACK / SEC_WEAKEN));
  const weaken2Threads = Math.max(1, Math.ceil(growThreads * SEC_GROW / SEC_WEAKEN));

  return {
    hackThreads, growThreads, weaken1Threads, weaken2Threads, stolenFrac,
    hackDelay:    Math.max(0, wTime - SPACER - hTime),
    weaken1Delay: 0,
    growDelay:    Math.max(0, wTime + SPACER - gTime),
    weaken2Delay: 2 * SPACER,
    duration:     wTime + 2 * SPACER,
  };
}

/** Bring the target to min security + max money, spreading grow/weaken across the fleet. */
async function prep(ns, target, fleet, cores, hasFormulas) {
  const maxMoney = ns.getServerMaxMoney(target);
  const minSec = ns.getServerMinSecurityLevel(target);

  while (!isPrepped(ns, target)) {
    const curSec = ns.getServerSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    // Post prep progress so the commander's summary can show it. This fleet-batcher
    // runs headless (its own tail is closed), so STATS_PORT is the only channel the
    // commander is watching — same one the earnings snapshots use once we're batching.
    try {
      ns.tryWritePort(STATS_PORT, JSON.stringify({
        target, prepping: true,
        moneyPct: maxMoney > 0 ? curMoney / maxMoney : 1,
        secOver: curSec - minSec,
      }));
    } catch { /* never let stats break prep */ }

    // Threads to refill money and the times, computed with or without Formulas.
    // The Formulas-free grow uses the live money ratio (maxMoney / currentMoney)
    // and live grow/weaken times — accurate at whatever state the target is in.
    let growThreads = 0, wTime, gTime;
    if (hasFormulas) {
      const f = ns.formulas.hacking;
      const s = ns.getServer(target);
      const p = ns.getPlayer();
      s.hackDifficulty = minSec;
      growThreads = curMoney < maxMoney ? Math.ceil(f.growThreads(s, p, maxMoney, cores)) : 0;
      s.hackDifficulty = curSec;
      wTime = f.weakenTime(s, p);
      gTime = f.growTime(s, p);
    } else {
      if (curMoney < maxMoney) {
        const mult = maxMoney / Math.max(curMoney, 1);          // guard a fully-drained server
        growThreads = Math.ceil(ns.growthAnalyze(target, Math.max(mult, 1.001), cores));
      }
      wTime = ns.getWeakenTime(target);
      gTime = ns.getGrowTime(target);
    }

    let weakenThreads = Math.max(1, Math.ceil(((curSec - minSec) + growThreads * SEC_GROW) / SEC_WEAKEN));

    // Scale this prep pass down to the fleet's free RAM (weaken keeps priority).
    const need = growThreads * ns.getScriptRam(GROW) + weakenThreads * ns.getScriptRam(WEAKEN);
    const ratio = need > 0 ? Math.min(1, fleetFree(ns, fleet) / need) : 1;
    growThreads = Math.floor(growThreads * ratio);
    weakenThreads = Math.max(1, Math.floor(weakenThreads * ratio));

    const growDelay = Math.max(0, wTime - SPACER - gTime);

    if (growThreads > 0) allocate(ns, fleet, GROW, growThreads, target, growDelay, 0);
    allocate(ns, fleet, WEAKEN, weakenThreads, target, 0, 0);
    await ns.sleep(wTime + SPACER * 2);
  }
}

/** crude wall-clock tick: returns a truthy timestamp ~every 5s, else 0. */
function tick(last) {
  const t = Date.now();
  return (t - last) >= 5000 ? t : 0;
}
