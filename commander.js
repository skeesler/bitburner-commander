/** @param {NS} ns
 *
 *  COMMANDER — the self-running orchestrator that ties the whole rig together.
 *
 *      run commander.js [buyRam] [hackFraction] [--no-auto-solves]
 *
 *  Every TICK it:
 *    1. Roots every server it can with your owned port crackers.
 *    2. Buys ONE more purchased server (>= buyRam, power of two) if affordable,
 *       up to the server limit, and stages the batcher + workers onto it.
 *    3. Ranks all rooted, in-level targets by profitability (via Formulas).
 *    4. Ensures home and each purchased server is running a pipe batcher against
 *       its own DISTINCT top target — launching only where one isn't already running.
 *    5. Finds and auto-solves coding contracts (money + faction rep) network-wide,
 *       unless you pass --no-auto-solves.
 *
 *  It is idempotent: it discovers current assignments by reading the args of
 *  running batchers, so re-running it (or a game reload) just refills gaps.
 *
 *  Uses Formulas.exe for high-performance batching; without it, falls back to a
 *  reactive deploy-all automatically. Runs on home by default; if home is too
 *  small to host it, run it on one of your purchased servers instead.
 */

const BATCHER = "batcher-pipe.js";
const FILES = [BATCHER, "hack.js", "grow.js", "weaken.js"];
const CONTRACT_FINDER = "contract-finder.js";
const DEFAULT_RAM = 512;     // used when no size arg is given; NOT a hard floor
const HOME_RESERVE_GB = 64;  // keep this much free on home for commander itself + your own scripts
const TICK = 10000;          // control-loop interval, ms
const CONTRACT_EVERY = 6;    // run the contract solver every N ticks (~once a minute)
const MIN_CHANCE = 0.5;      // skip targets whose prepped hack chance is below this

export async function main(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags([["no-auto-solves", false]]);
  // buyRam: 512 is the DEFAULT, not a floor — an explicit smaller arg is honored,
  // so you can spam cheap servers to climb out of a post-reset trough, then re-run
  // with a bigger size later to let the auto-upgrade roll them up.
  const buyRam = ceilPow2(Number(flags._[0]) || DEFAULT_RAM);
  const hackFraction = flags._[1] !== undefined ? Number(flags._[1]) : 0.10;
  const autoSolve = !flags["no-auto-solves"];

  // Without Formulas.exe (e.g. fresh off an augmentation install) we can't
  // batch, so fall back to the reactive deploy-all until it's re-bought.
  // Re-run the commander after buying Formulas to switch into batching mode.
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  ns.ui.openTail();
  ns.print(hasFormulas
    ? `Commander online — BATCHING. Buying ${buyRam}GB servers, ${Math.round(hackFraction * 100)}%/batch.`
    : `Commander online — FALLBACK (no Formulas.exe): reactive deploy-all. Re-run me once you re-buy Formulas.`);
  ns.print(`Coding-contract auto-solve: ${autoSolve ? "ON" : "OFF (--no-auto-solves)"}`);

  let tick = 0, lastRooted = -1;
  while (true) {
    const all = scanAll(ns);
    rootAll(ns, all);
    maybeBuyServer(ns, buyRam);
    if (hasFormulas) ensureBatchers(ns, all, hackFraction);
    else deployReactive(ns, all);
    if (autoSolve && tick % CONTRACT_EVERY === 0) solveContracts(ns);

    // Report how many world servers we've rooted, whenever that count changes.
    const pservs = new Set(ns.cloud.getServerNames());
    const rooted = all.filter(s => !pservs.has(s) && ns.hasRootAccess(s)).length;
    const total = all.filter(s => !pservs.has(s)).length;
    if (rooted !== lastRooted) { ns.print(`hacked ${rooted}/${total} servers`); lastRooted = rooted; }

    tick++;
    await ns.sleep(TICK);
  }
}

/** Run the contract finder/solver on home if present and not already running.
 *  Its coding-contract API calls are RAM-heavy, so it runs as a short-lived
 *  separate process (keeping that RAM out of commander). With --quiet it prints
 *  only actual solves. Turn the whole thing off with commander's --no-auto-solves. */
function solveContracts(ns) {
  if (!ns.fileExists(CONTRACT_FINDER, "home")) return;
  if (ns.ps("home").some(p => p.filename === CONTRACT_FINDER)) return;   // already running
  ns.exec(CONTRACT_FINDER, "home", 1, "--auto-solve", "--quiet");
}

/** Breadth-first walk of the whole network from home. */
function scanAll(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  while (queue.length) {
    for (const n of ns.scan(queue.shift())) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  seen.delete("home");
  return [...seen];
}

/** Open ports with every owned cracker, then nuke anything we now can. */
function rootAll(ns, all) {
  for (const name of all) {
    if (ns.hasRootAccess(name)) continue;
    let ports = 0;
    if (ns.fileExists("BruteSSH.exe", "home"))  { ns.brutessh(name);  ports++; }
    if (ns.fileExists("FTPCrack.exe", "home"))  { ns.ftpcrack(name);  ports++; }
    if (ns.fileExists("relaySMTP.exe", "home")) { ns.relaysmtp(name); ports++; }
    if (ns.fileExists("HTTPWorm.exe", "home"))  { ns.httpworm(name);  ports++; }
    if (ns.fileExists("SQLInject.exe", "home")) { ns.sqlinject(name); ports++; }
    if (ports >= ns.getServerNumPortsRequired(name)) {
      try { ns.nuke(name); } catch { /* hacking level too low yet — try again next tick */ }
    }
  }
}

/** Buy at most one server per tick, so income can catch up between purchases.
 *  If the server limit is already full of UNDERSIZED servers, upgrade the
 *  smallest one instead (delete + rebuy at buyRam) — one per tick, so the
 *  fleet rolls over to full size gracefully. Note: deleting a purchased
 *  server is not refunded, and briefly kills the batcher running on it. */
function maybeBuyServer(ns, buyRam) {
  const names = ns.cloud.getServerNames();
  const limit = ns.cloud.getServerLimit();
  const cost = ns.cloud.getServerCost(buyRam);
  if (ns.getServerMoneyAvailable("home") < cost) return;

  // Free slot available: just buy.
  if (names.length < limit) {
    const host = ns.cloud.purchaseServer("cloud-server-" + names.length, buyRam);
    if (host) {
      ns.scp(FILES, host);
      ns.print(`Bought ${host} (${buyRam}GB) [${names.length + 1}/${limit}].`);
    }
    return;
  }

  // At the limit: find the smallest server below target size and upgrade it.
  let smallest = null, smallestRam = Infinity;
  for (const s of names) {
    const r = ns.getServerMaxRam(s);
    if (r < buyRam && r < smallestRam) { smallest = s; smallestRam = r; }
  }
  if (!smallest) return;                 // everything is already full-size

  ns.killall(smallest);                  // deleteServer requires no running scripts
  if (ns.cloud.deleteServer(smallest)) {
    const host = ns.cloud.purchaseServer(smallest, buyRam);   // reuse the freed name
    if (host) {
      ns.scp(FILES, host);
      ns.print(`Upgraded ${smallest}: ${smallestRam}GB -> ${buyRam}GB.`);
    }
  }
}

/** Launch a batcher on home + every idle purchased server, each against a distinct top target. */
function ensureBatchers(ns, all, hackFraction) {
  const pservs = ns.cloud.getServerNames();
  const pservSet = new Set(pservs);

  // Discover what's already running and which targets are already claimed
  // (scan the whole network so manual batchers on home are respected too).
  const busyHosts = new Set();
  const taken = new Set();
  for (const h of [...all, ...pservs, "home"]) {
    for (const p of ns.ps(h)) {
      if (p.filename === BATCHER) {
        busyHosts.add(h);
        if (p.args && p.args.length) taken.add(String(p.args[0]));
      }
    }
  }

  const ranked = rankTargets(ns, all, taken, pservSet);
  let idx = 0;
  const launched = [];
  // Home first: it's the biggest, best-cored host, so it earns the #1 target.
  const hosts = ["home", ...pservs];
  for (const host of hosts) {
    if (busyHosts.has(host)) continue;
    if (idx >= ranked.length) break;              // no unclaimed targets left right now
    const target = ranked[idx++];
    ns.scriptKill(WORKER, host);                  // clear any leftover fallback worker so it can't collide
    if (host !== "home") ns.scp(FILES, host);     // home already has the files (commander runs there)
    const reserve = host === "home" ? HOME_RESERVE_GB : 0;   // leave room for commander + contract-solver on home
    if (ns.exec(BATCHER, host, 1, target, hackFraction, "quiet", reserve)) {
      taken.add(target);
      launched.push(`${host}->${target}`);
    }
  }

  const idle = hosts.filter(h => !busyHosts.has(h)).length - launched.length;
  ns.print(`hosts ${hosts.length} (home + ${pservs.length} cloud) | ` +
           `batchers ${busyHosts.size + launched.length} running` +
           (launched.length ? `, +${launched.length} new (${launched.join(", ")})` : "") +
           (idle > 0 ? ` | ${idle} idle, no free targets` : ""));
}

/** Rank rooted, in-level, reliable targets by a $/sec proxy at prepped state. */
function rankTargets(ns, all, taken, pservSet) {
  const p = ns.getPlayer();
  const f = ns.formulas.hacking;
  const scored = [];
  for (const name of all) {
    if (pservSet.has(name)) continue;                       // don't hack our own boxes
    if (!ns.hasRootAccess(name)) continue;
    if (taken.has(name)) continue;
    const s = ns.getServer(name);
    if (!s.moneyMax || s.moneyMax <= 0) continue;
    if (s.requiredHackingSkill > p.skills.hacking) continue;

    // Score as if fully prepped — that's the state the batcher holds it in.
    s.hackDifficulty = s.minDifficulty;
    s.moneyAvailable = s.moneyMax;
    const chance = f.hackChance(s, p);
    if (chance < MIN_CHANCE) continue;
    const weakenSec = f.weakenTime(s, p) / 1000;
    const score = (s.moneyMax * chance) / weakenSec;        // money-per-second proxy
    scored.push({ name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.name);
}

// ---- Fallback: reactive deploy-all (used when Formulas.exe is missing) ----

const WORKER = "early-hacking-template.js";
const FALLBACK_HACK_FRACTION = 0.4;   // size each worker so one hack takes ~this much, not 100%

/** Spread reactive workers across the top targets, each RIGHT-SIZED so a single
 *  hack steals only ~FALLBACK_HACK_FRACTION of its server. This avoids the
 *  over-hack death spiral, where one giant instance drains a server to zero,
 *  spikes its security, and then burns an hour weakening/growing back — earning
 *  nothing. Packs each host with several instances on DIFFERENT targets so big
 *  machines (like a multi-TB home) actually get used instead of coma-ing one
 *  server. Idempotent: skips any host already staffed. */
function deployReactive(ns, all) {
  const targets = pickTopTargets(ns, all, 20);
  if (!targets.length) { ns.print("fallback: no rooted, in-level target yet."); return; }

  const workerRam = ns.getScriptRam(WORKER);
  let ti = 0, uid = 0, deployed = 0;
  const hosts = new Set([...all, ...ns.cloud.getServerNames(), "home"]);

  for (const host of hosts) {
    if (!ns.hasRootAccess(host)) continue;
    const maxRam = ns.getServerMaxRam(host);
    if (maxRam === 0) continue;
    if (ns.ps(host).some(p => p.filename === WORKER)) continue;  // already staffed

    ns.scp(WORKER, host);
    // On home, hold back a reserve for commander + your own tools.
    const reserve = host === "home" ? HOME_RESERVE_GB : 0;
    let free = maxRam - ns.getServerUsedRam(host) - reserve;

    // Fill the host with right-sized instances, rotating through the targets.
    while (free >= workerRam) {
      const target = targets[ti++ % targets.length];
      const capacity = Math.floor(free / workerRam);
      const perThread = ns.hackAnalyze(target);       // % stolen per thread (no Formulas needed)
      let threads = perThread > 0 ? Math.ceil(FALLBACK_HACK_FRACTION / perThread) : capacity;
      threads = Math.max(1, Math.min(threads, capacity));
      const pid = ns.exec(WORKER, host, threads, target, uid++);  // uid keeps each instance's args unique
      if (!pid) break;
      free -= threads * workerRam;
      deployed++;
    }
  }
  if (deployed > 0)
    ns.print(`fallback: deployed ${deployed} right-sized workers across up to ${targets.length} targets.`);
}

/** Top N rooted, in-level, money-bearing targets, biggest money pool first. */
function pickTopTargets(ns, all, n) {
  const level = ns.getHackingLevel();
  const scored = [];
  for (const name of all) {
    if (!ns.hasRootAccess(name)) continue;
    const maxMoney = ns.getServerMaxMoney(name);
    if (maxMoney <= 0) continue;
    if (ns.getServerRequiredHackingLevel(name) > level) continue;
    scored.push({ name, maxMoney });
  }
  scored.sort((a, b) => b.maxMoney - a.maxMoney);
  return scored.slice(0, n).map(x => x.name);
}

/** Smallest power of two >= n. */
function ceilPow2(n) {
  let pw = 1;
  while (pw < n) pw *= 2;
  return pw;
}
