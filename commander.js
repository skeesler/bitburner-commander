/** @param {NS} ns
 *
 *  COMMANDER — the self-running orchestrator that ties the whole rig together.
 *
 *      run commander.js [buyRam|auto] [hackFraction] [--no-auto-solves]
 *
 *  buyRam defaults to AUTO: each tick it picks the "right" server size from your
 *  cash (largest power of two whose full fleet fits your budget) and climbs the
 *  ladder on its own as you get richer — so you never have to name a power of two.
 *  Pass an explicit number to pin a size instead (e.g. commander.js 16).
 *
 *  Every TICK it:
 *    1. Roots every server it can with your owned port crackers.
 *    2. Buys ONE more purchased server (>= buyRam, power of two) if affordable,
 *       up to the server limit, and stages the batcher + workers onto it.
 *    3. Ranks all rooted, in-level targets by profitability (via Formulas).
 *    4. Groups home + cloud servers into FLEETS (one per top target) and runs a
 *       distributed fleet-batcher for each — pooling many servers onto one target.
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

const FLEET = "fleet-batcher.js";
const FILES = [FLEET, "hack.js", "grow.js", "weaken.js"];
const CONTRACT_FINDER = "contract-finder.js";
const HACK = "hack.js", GROW = "grow.js", WEAKEN = "weaken.js";
const SEC_HACK = 0.002, SEC_GROW = 0.004, SEC_WEAKEN = 0.05;
const BATCH_GAP = 800;         // must match fleet-batcher.js (used for saturation sizing)
const STATS_PORT = 1;          // fleet-batchers post earnings snapshots here
const MAX_FLEET_SHARE = 1 / 3; // no single target's fleet may exceed this share of the pool
const DEFAULT_RAM = 512;       // only used if an explicit non-numeric size is passed
const AUTO_MIN_RAM = 8;        // smallest size auto-mode will consider (climbing out of a trough)
const FLEET_BUDGET = 0.5;      // auto-mode targets a size whose FULL fleet costs <= this share of cash
const HOME_RESERVE_GB = 64;    // keep this free on home for commander + contract-solver
const TICK = 10000;            // control-loop interval, ms
const CONTRACT_EVERY = 6;      // run the contract solver every N ticks (~once a minute)
const SUMMARY_EVERY = 3;       // print the earnings summary every N ticks (~30s)
const MIN_CHANCE = 0.5;        // skip targets whose prepped hack chance is below this

export async function main(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags([["no-auto-solves", false]]);
  // buyRam: AUTO by default (auto-size from cash each tick, climbing out of a post-reset trough
  // on its own). An explicit number pins the size (e.g. commander.js 16 to spam cheap servers).
  const sizeArg = flags._[0];
  const autoSize = sizeArg === undefined || String(sizeArg).toLowerCase() === "auto";
  const fixedRam = autoSize ? 0 : ceilPow2(Number(sizeArg) || DEFAULT_RAM);
  const hackFraction = flags._[1] !== undefined ? Number(flags._[1]) : 0.10;
  const autoSolve = !flags["no-auto-solves"];

  // Without Formulas.exe (e.g. fresh off an augmentation install) we can't
  // batch, so fall back to the reactive deploy-all until it's re-bought.
  // Re-run the commander after buying Formulas to switch into batching mode.
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  ns.ui.openTail();
  const sizeLabel = autoSize ? "auto-sized" : fmtRam(fixedRam);
  ns.print(hasFormulas
    ? `Commander online — BATCHING. Servers: ${sizeLabel}, ${Math.round(hackFraction * 100)}%/batch.`
    : `Commander online — FALLBACK (no Formulas.exe): reactive deploy-all. Re-run me once you re-buy Formulas.`);
  ns.print(`Coding-contract auto-solve: ${autoSolve ? "ON" : "OFF (--no-auto-solves)"}`);

  // Self-reload: snapshot our own source. If the on-disk file later diverges (a fresh edit synced
  // onto home), we're running stale code — relaunch into the new version, same args. No kill+rerun.
  const self = ns.getScriptName();
  const baseline = ns.read(self);

  let tick = 0, lastRooted = -1;
  // Auto-size is RATCHETED so money thrashing (stock sales, income spikes) doesn't churn it:
  //   - committedRam only ever grows — never proposes a smaller size, so no downsize churn;
  //   - a bigger size must stay affordable for RAMP_TICKS before we adopt it (ignore blips), and
  //     we adopt the sustained FLOOR of that window, not whatever spike happened on the last tick.
  const RAMP_TICKS = 6; // ~60s sustained (at TICK=10s) before the target grows
  let committedRam = 0, rampTicks = 0, rampMin = 0;
  const fleetStats = new Map();   // target -> latest earnings snapshot from its fleet-batcher
  while (true) {
    if (ns.read(self) !== baseline && ns.read(self)) {
      ns.print(`↻ ${self} changed on disk — reloading into the new version.`);
      return ns.spawn(self, { threads: 1, spawnDelay: 500 }, ...ns.args);
    }
    const all = scanAll(ns);
    rootAll(ns, all);
    let buyRam = fixedRam;
    if (autoSize) {
      const target = autoBuyRam(ns);
      const prev = committedRam;
      if (committedRam === 0) {
        committedRam = target;                                   // seed once (post-reset money is low → seeds low)
      } else if (target > committedRam) {
        rampMin = rampTicks === 0 ? target : Math.min(rampMin, target);
        if (++rampTicks >= RAMP_TICKS) { committedRam = rampMin; rampTicks = 0; }
      } else {
        rampTicks = 0;                                           // dipped: reset the ramp, but never shrink the target
      }
      buyRam = committedRam;
      if (committedRam !== prev) {
        const each = ns.cloud.getServerCost(buyRam);
        ns.print(`auto-size → ${fmtRam(buyRam)}/server (~$${fmt(ns, each)} each, ~$${fmt(ns, each * ns.cloud.getServerLimit())} full fleet)`);
      }
    }
    maybeBuyServer(ns, buyRam);
    if (hasFormulas) ensureFleets(ns, all, hackFraction);
    else deployReactive(ns, all);
    if (autoSolve && tick % CONTRACT_EVERY === 0) solveContracts(ns);

    // Report how many world servers we've rooted, whenever that count changes.
    const pservs = new Set(ns.cloud.getServerNames());
    const rooted = all.filter(s => !pservs.has(s) && ns.hasRootAccess(s)).length;
    const total = all.filter(s => !pservs.has(s)).length;
    if (rooted !== lastRooted) { ns.print(`hacked ${rooted}/${total} servers`); lastRooted = rooted; }

    // Earnings summary (batching mode): total hacked $, rate, best/worst fleet.
    if (hasFormulas) {
      drainStats(ns, fleetStats);
      if (tick % SUMMARY_EVERY === 0) printSummary(ns, fleetStats);
    }

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

/** Assign the whole host pool (home + cloud) into FLEETS — one per top target,
 *  best target first, each capped at a share of the pool so several good targets
 *  get served — and launch a distributed fleet-batcher for any target not already
 *  being batched. Idempotent: reads the JSON config of running fleet-batchers to
 *  see which targets/hosts are claimed, and fills only the gaps. */
function ensureFleets(ns, all, hackFraction) {
  const pservs = ns.cloud.getServerNames();
  const pservSet = new Set(pservs);
  // Work pool = home + cloud servers + every rooted WORLD server with usable RAM.
  // Rooted world servers (CSEC, foodnstuff, ...) can run our workers too — free
  // capacity we'd otherwise waste. (A server can be a work host for one fleet and
  // a hack target of another at the same time; the two roles don't interfere.)
  const worldHosts = all.filter(h => !pservSet.has(h) && ns.hasRootAccess(h) && ns.getServerMaxRam(h) > 0);
  const pool = [
    { h: "home", r: HOME_RESERVE_GB },
    ...pservs.map(h => ({ h, r: 0 })),
    ...worldHosts.map(h => ({ h, r: 0 })),
  ];

  // Discover running fleets: which targets are batched, which hosts are claimed.
  const batchedTargets = new Set();
  const claimed = new Set();
  for (const host of [...all, ...pservs, "home"]) {
    for (const p of ns.ps(host)) {
      if (p.filename !== FLEET || !p.args.length) continue;
      try {
        const cfg = JSON.parse(p.args[0]);
        batchedTargets.add(cfg.target);
        for (const { h } of cfg.hosts) claimed.add(h);
      } catch { /* ignore malformed config */ }
    }
  }

  const freePool = pool.filter(x => !claimed.has(x.h));
  if (!freePool.length) {
    ns.print(`fleets ${batchedTargets.size} running | all ${pool.length} hosts assigned`);
    return;
  }
  freePool.sort((a, b) => usable(ns, b) - usable(ns, a));    // biggest hosts first
  const totalFree = freePool.reduce((sum, x) => sum + usable(ns, x), 0);

  const ranked = rankTargets(ns, all, batchedTargets, pservSet);   // skip already-batched targets
  let pi = 0;
  const launched = [];
  for (const target of ranked) {
    if (pi >= freePool.length) break;
    // Cap each fleet's RAM so no single target eats the pool — keeps several good
    // targets served, and diversifies against any one target desyncing at once.
    const need = Math.min(saturationRam(ns, target, hackFraction), totalFree * MAX_FLEET_SHARE);
    const fleet = [];
    let got = 0;
    while (pi < freePool.length && got < need) {
      const host = freePool[pi++];
      fleet.push(host);
      got += usable(ns, host);
    }
    if (!fleet.length) break;

    for (const { h } of fleet) {
      ns.scriptKill(WORKER, h);                 // clear any leftover fallback worker (no collisions)
      if (h !== "home") ns.scp(FILES, h);       // stage fleet-batcher + workers
    }
    // Run the controller on the fleet's BIGGEST host (fleet is built biggest-first,
    // so fleet[0]) — guarantees room for the controller's own ~20GB, even for a
    // fleet made entirely of small world servers.
    const ctrl = fleet[0].h;
    const cfg = JSON.stringify({ target, hosts: fleet, hf: hackFraction });
    if (ns.exec(FLEET, ctrl, 1, cfg)) launched.push(`${target}x${fleet.length}h`);
  }

  ns.print(`fleets ${batchedTargets.size + launched.length} | hosts ${pool.length} (home + ${pservs.length} cloud + ${worldHosts.length} world)` +
           (launched.length ? ` | +${launched.length}: ${launched.join(", ")}` : ""));
}

function usable(ns, x) { return Math.max(0, ns.getServerMaxRam(x.h) - x.r); }

/** Roughly how much fleet RAM a target can put to work: one batch's RAM times how
 *  many batches fit in a weaken-time pipe. Sizes fleets; approximate is fine
 *  because each fleet-batcher also self-limits on RAM. */
function saturationRam(ns, target, hackFraction) {
  const f = ns.formulas.hacking;
  const s = ns.getServer(target);
  const p = ns.getPlayer();
  s.hackDifficulty = s.minDifficulty;
  s.moneyAvailable = s.moneyMax;

  const perThread = f.hackPercent(s, p);
  if (perThread <= 0) return Infinity;
  const hackThreads = Math.max(1, Math.floor(hackFraction / perThread));
  const stolen = Math.min(0.99, perThread * hackThreads);
  s.moneyAvailable = s.moneyMax * (1 - stolen);
  const growThreads = Math.max(1, Math.ceil(f.growThreads(s, p, s.moneyMax, 1) * 1.05));
  const w1 = Math.ceil(hackThreads * SEC_HACK / SEC_WEAKEN);
  const w2 = Math.ceil(growThreads * SEC_GROW / SEC_WEAKEN);
  const batchRam = hackThreads * ns.getScriptRam(HACK) + growThreads * ns.getScriptRam(GROW)
                 + (w1 + w2) * ns.getScriptRam(WEAKEN);
  s.moneyAvailable = s.moneyMax;
  const concurrent = Math.max(1, Math.ceil(f.weakenTime(s, p) / BATCH_GAP));
  return batchRam * concurrent;
}

/** Drain the stats port into the fleetStats map (latest snapshot per target). */
function drainStats(ns, fleetStats) {
  try {
    for (;;) {
      const raw = ns.readPort(STATS_PORT);
      if (raw === "NULL PORT DATA") break;
      const s = JSON.parse(raw);
      fleetStats.set(s.target, s);
    }
  } catch { /* ignore malformed stats */ }
}

let _startIncome = null, _startT = 0, _incomeWarned = false;
const _fleetBase = new Map();   // target -> estEarned when first seen THIS run (for this-run per-fleet totals)

/** Short currency-ish formatting, robust to ns.formatNumber being absent. */
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "0";
  if (typeof ns.formatNumber === "function") { try { return ns.formatNumber(n); } catch { /* fall through */ } }
  const a = Math.abs(n);
  for (const [v, s] of [[1e12, "t"], [1e9, "b"], [1e6, "m"], [1e3, "k"]]) if (a >= v) return (n / v).toFixed(2) + s;
  return n.toFixed(0);
}

/** Earnings summary: this-run total + average rate, all-time total, and the
 *  best/worst fleet (scoped to this run). Written so it can NEVER throw. */
function printSummary(ns, fleetStats) {
  const entries = [...fleetStats.values()];

  // All-time hacking income (real). Fall back to summed fleet estimates if the
  // API isn't available in this version (and say so once).
  let allTime;
  try {
    allTime = ns.getMoneySources().sinceInstall.hacking;
  } catch (e) {
    allTime = entries.reduce((sum, x) => sum + (x.estEarned || 0), 0);
    if (!_incomeWarned) { ns.print(`note: getMoneySources unavailable (${e}) — totals are estimates`); _incomeWarned = true; }
  }

  const nowT = Date.now();
  if (_startIncome === null) { _startIncome = allTime; _startT = nowT; }   // baseline at commander start
  const run = allTime - _startIncome;
  const rate = run / Math.max(1, (nowT - _startT) / 1000);   // run AVERAGE $/s — robust, never stuck at 0

  const head = `hacked: $${fmt(ns, run)} run (~$${fmt(ns, rate)}/s), $${fmt(ns, allTime)} all-time`;
  if (!entries.length) { ns.print(`${head} | fleets warming up`); return; }

  // Per-fleet "this run" = estEarned minus its value when first seen this run, so a
  // fleet that outlived a commander restart doesn't report its entire lifetime.
  let top = null, low = null;
  for (const x of entries) {
    let base = _fleetBase.get(x.target);
    if (base === undefined || x.estEarned < base) { base = x.estEarned; _fleetBase.set(x.target, base); }  // (re)baseline on first sight / fleet restart
    const earned = x.estEarned - base;
    if (!top || earned > top.earned) top = { target: x.target, earned };
    if (!low || earned < low.earned) low = { target: x.target, earned };
  }
  ns.print(`${head} | ${entries.length} fleets | top ${top.target} ~$${fmt(ns, top.earned)} | low ${low.target} ~$${fmt(ns, low.earned)}`);
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
const FALLBACK_MIN_CHANCE = 0.5;      // skip targets we can't reliably hit yet (mirrors MIN_CHANCE)

/** Spread reactive workers across the top targets, each RIGHT-SIZED so a single
 *  hack steals only ~FALLBACK_HACK_FRACTION of its server. This avoids the
 *  over-hack death spiral, where one giant instance drains a server to zero,
 *  spikes its security, and then burns an hour weakening/growing back — earning
 *  nothing. Packs each host with several instances on DIFFERENT targets so big
 *  machines (like a multi-TB home) actually get used instead of coma-ing one
 *  server. Idempotent: skips any host already staffed. */
function deployReactive(ns, all) {
  const targets = pickTopTargets(ns, all, 20);
  if (!targets.length) { ns.print("fallback: no reliable, in-level target yet."); return; }

  // Cap instances per target so their combined steal stays under ~90%. Without
  // this, a huge home stacks many instances onto the single best target and
  // drains it to zero (the over-hack spiral) while starving everything else.
  // Derived from the hack fraction so it stays consistent if you tune it.
  const perTargetCap = Math.max(1, Math.floor(0.9 / FALLBACK_HACK_FRACTION));

  const workerRam = ns.getScriptRam(WORKER);
  let uid = 0, deployed = 0, idle = 0;
  // Biggest hosts first, so home (most RAM, and its cores boost grow/weaken) gets
  // first pick of the best targets instead of whatever budget is left over.
  const hosts = [...new Set([...all, ...ns.cloud.getServerNames(), "home"])]
    .sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a));

  // Seed the per-target counts from workers ALREADY running anywhere, so the cap
  // is a GLOBAL, idempotent limit. Filling across ticks (home this tick, the rest
  // next tick) or re-running the commander then never stacks past perTargetCap.
  const assigned = new Map(targets.map(t => [t, 0]));
  for (const host of hosts) {
    for (const p of ns.ps(host)) {
      if (p.filename === WORKER && assigned.has(p.args[0])) assigned.set(p.args[0], assigned.get(p.args[0]) + 1);
    }
  }

  for (const host of hosts) {
    if (!ns.hasRootAccess(host)) continue;
    const maxRam = ns.getServerMaxRam(host);
    if (maxRam === 0) continue;
    if (ns.ps(host).some(p => p.filename === WORKER)) continue;  // already staffed

    ns.scp(WORKER, host);
    // On home, hold back a reserve for commander + your own tools.
    const reserve = host === "home" ? HOME_RESERVE_GB : 0;
    let free = maxRam - ns.getServerUsedRam(host) - reserve;

    while (free >= workerRam) {
      // Best-scored target that still has budget. Once every target is capped
      // we're saturated — bank the leftover RAM rather than pile on and over-hack.
      const target = targets.find(t => assigned.get(t) < perTargetCap);
      if (!target) { idle += free; break; }
      const capacity = Math.floor(free / workerRam);
      const perThread = ns.hackAnalyze(target);       // % stolen per thread (no Formulas needed)
      let threads = perThread > 0 ? Math.ceil(FALLBACK_HACK_FRACTION / perThread) : capacity;
      threads = Math.max(1, Math.min(threads, capacity));
      const pid = ns.exec(WORKER, host, threads, target, uid++);  // uid keeps each instance's args unique
      if (!pid) break;
      assigned.set(target, assigned.get(target) + 1);
      free -= threads * workerRam;
      deployed++;
    }
  }

  if (deployed > 0) {
    const used = [...assigned.values()].filter(v => v > 0).length;
    let msg = `fallback: deployed ${deployed} workers across ${used} reliable target(s) (<=${perTargetCap}/target).`;
    if (idle > workerRam * 4) msg += ` ~${(idle / 1024).toFixed(1)}TB idle — fallback is saturated; Formulas.exe ($5b) unlocks the rest via real batching.`;
    ns.print(msg);
  }
}

/** Top N rooted, in-level, RELIABLE targets ranked by a capturable-$/sec proxy.
 *  Uses hackAnalyzeChance/getHackTime (no Formulas needed), so unlike a raw
 *  max-money sort it won't chase rich servers it can't actually hit — the trap
 *  that stalls income the moment crackers unlock the big boxes. */
function pickTopTargets(ns, all, n) {
  const level = ns.getHackingLevel();
  const scored = [];
  for (const name of all) {
    if (!ns.hasRootAccess(name)) continue;
    const maxMoney = ns.getServerMaxMoney(name);
    if (maxMoney <= 0) continue;
    if (ns.getServerRequiredHackingLevel(name) > level) continue;
    const chance = ns.hackAnalyzeChance(name);
    if (chance < FALLBACK_MIN_CHANCE) continue;              // can't reliably hit it yet — skip
    const hackTime = ns.getHackTime(name) / 1000;            // seconds
    const score = (maxMoney * chance) / Math.max(1, hackTime);   // capturable $/sec proxy
    scored.push({ name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map(x => x.name);
}

/** Smallest power of two >= n. */
function ceilPow2(n) {
  let pw = 1;
  while (pw < n) pw *= 2;
  return pw;
}

/** Best-guess "right" purchased-server size from current cash: the largest power of two whose
 *  FULL fleet (every slot) costs at most FLEET_BUDGET of your money. Climbs the power-of-two
 *  ladder on its own as you get richer. When you're too broke for even a min-size fleet (e.g.
 *  fresh post-reset), it falls back to the biggest SINGLE server you can afford, so it still
 *  buys something and climbs out. Clamped to the game's max purchasable RAM (getRamLimit). */
function autoBuyRam(ns) {
  const money = ns.getServerMoneyAvailable("home");
  const limit = ns.cloud.getServerLimit();
  const maxRam = ns.cloud.getRamLimit();
  let fleetSize = 0;    // largest pow2 whose FULL fleet fits the budget
  let singleSize = 0;   // largest pow2 whose ONE server is affordable (trough fallback)
  for (let ram = AUTO_MIN_RAM; ram <= maxRam; ram *= 2) {
    const cost = ns.cloud.getServerCost(ram);
    if (cost <= money) singleSize = ram;
    if (cost * limit <= money * FLEET_BUDGET) fleetSize = ram;
  }
  return fleetSize || singleSize || AUTO_MIN_RAM;
}

/** RAM in human units (GB/TB/PB) so you never have to read a raw power of two. */
function fmtRam(gb) {
  if (gb >= 1048576) return (gb / 1048576) + "PB";
  if (gb >= 1024) return (gb / 1024) + "TB";
  return gb + "GB";
}
