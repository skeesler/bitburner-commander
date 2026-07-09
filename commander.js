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
const TRICKLE = 0.10;          // while banking for the next tool, still invest this share of cash into servers

export async function main(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags([["no-auto-solves", false], ["reactive", false]]);
  // buyRam: AUTO by default (auto-size from cash each tick, climbing out of a post-reset trough
  // on its own). An explicit number pins the size (e.g. commander.js 16 to spam cheap servers).
  const sizeArg = flags._[0];
  const autoSize = sizeArg === undefined || String(sizeArg).toLowerCase() === "auto";
  const fixedRam = autoSize ? 0 : ceilPow2(Number(sizeArg) || DEFAULT_RAM);
  const hackFraction = flags._[1] !== undefined ? Number(flags._[1]) : 0.10;
  const autoSolve = !flags["no-auto-solves"];

  // Formulas.exe makes the batch math exact, but the fleet-batcher runs WITHOUT it
  // too — it preps the target to min-sec/max-money, then reads the live prepped-state
  // API. So batching is the default with or without Formulas; --reactive forces the
  // older reactive deploy-all (money workers + XP soak) as a safety net.
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const forceReactive = flags["reactive"];

  ns.ui.openTail();
  const sizeLabel = autoSize ? "auto-sized" : fmtRam(fixedRam);
  const mode = forceReactive ? "REACTIVE (forced)"
             : hasFormulas   ? "BATCHING (Formulas: exact math)"
             :                 "BATCHING (Formulas-free: prep-then-batch)";
  ns.print(`Commander online — ${mode}. Servers: ${sizeLabel}, ${Math.round(hackFraction * 100)}%/batch.`);
  ns.print(`Coding-contract auto-solve: ${autoSolve ? "ON" : "OFF (--no-auto-solves)"}`);

  // Self-reload: snapshot our own source. If the on-disk file later diverges (a fresh edit synced
  // onto home), we're running stale code — relaunch into the new version, same args. No kill+rerun.
  const self = ns.getScriptName();
  const baseline = ns.read(self);

  let tick = 0, lastRooted = -1, lastReserve = -1;
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

    // Cash-awareness: hold back enough to afford the next dark-web tool you don't
    // own yet (TOR → crackers → Formulas). Server-buying spends only the surplus
    // ABOVE that reserve — so it never drains you below your next unlock. While
    // you're still banking toward it, keep TRICKLE-ing a little into servers so
    // RAM creeps up instead of everything sitting idle (you asked for movement).
    const tool = nextTool(ns);
    const reserve = tool ? tool.price : 0;
    const cash = ns.getServerMoneyAvailable("home");
    const spendable = Math.max(0, cash >= reserve ? cash - reserve : cash * TRICKLE);
    if (reserve !== lastReserve) {
      ns.print(tool
        ? `cash-reserve: banking $${fmt(ns, reserve)} for ${tool.name}; trickling ${Math.round(TRICKLE * 100)}% into servers meanwhile.`
        : `cash-reserve: all dark-web tools owned — investing freely.`);
      lastReserve = reserve;
    }

    let buyRam = fixedRam;
    if (autoSize) {
      const target = autoBuyRam(ns, spendable);
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
    maybeBuyServer(ns, buyRam, spendable);
    // Batch whenever there's a viable target (Formulas or not), and XP-farm every
    // host no fleet claimed. --reactive forces the old reactive deploy-all instead.
    const batching = !forceReactive;
    if (batching) {
      const claimed = ensureFleets(ns, all, hackFraction, hasFormulas);
      farmIdleRam(ns, all, claimed);
    } else {
      deployReactive(ns, all);
    }
    if (autoSolve && tick % CONTRACT_EVERY === 0) solveContracts(ns);

    // Report how many world servers we've rooted, whenever that count changes.
    const pservs = new Set(ns.cloud.getServerNames());
    const rooted = all.filter(s => !pservs.has(s) && ns.hasRootAccess(s)).length;
    const total = all.filter(s => !pservs.has(s)).length;
    if (rooted !== lastRooted) { ns.print(`hacked ${rooted}/${total} servers`); lastRooted = rooted; }

    // Earnings summary (batching mode): total hacked $, rate, best/worst fleet.
    if (batching) {
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
function maybeBuyServer(ns, buyRam, spendable) {
  const names = ns.cloud.getServerNames();
  const limit = ns.cloud.getServerLimit();
  const cost = ns.cloud.getServerCost(buyRam);
  if (spendable < cost) return;

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
function ensureFleets(ns, all, hackFraction, hasFormulas) {
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
    return claimed;
  }
  freePool.sort((a, b) => usable(ns, b) - usable(ns, a));    // biggest hosts first
  const totalFree = freePool.reduce((sum, x) => sum + usable(ns, x), 0);

  const ranked = rankTargets(ns, all, batchedTargets, pservSet, hasFormulas);   // skip already-batched targets
  let pi = 0;
  const launched = [];
  for (const target of ranked) {
    if (pi >= freePool.length) break;
    // Cap each fleet's RAM so no single target eats the pool — keeps several good
    // targets served, and diversifies against any one target desyncing at once.
    const need = Math.min(saturationRam(ns, target, hackFraction, hasFormulas), totalFree * MAX_FLEET_SHARE);
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
      ns.scriptKill(XP_WORKER, h);              // and any leftover XP farmer — batching reclaims that RAM
      if (h !== "home") ns.scp(FILES, h);       // stage fleet-batcher + workers
      claimed.add(h);                           // this host now belongs to a fleet — off-limits to XP soak
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
  return claimed;
}

function usable(ns, x) { return Math.max(0, ns.getServerMaxRam(x.h) - x.r); }

/** XP-farm every rooted host NOT claimed by a fleet — turns capacity that batching
 *  can't use (thin target pool / low level) into hacking levels, since weaken()
 *  needs only root. This is the batching-mode twin of the reactive path's XP soak.
 *  Skips hosts already running any of our scripts (a fleet controller/worker, or an
 *  XP farmer from a previous tick), so it never fights a batch for RAM. */
function farmIdleRam(ns, all, claimed) {
  const ours = new Set([FLEET, HACK, GROW, WEAKEN, WORKER, XP_WORKER]);
  const pool = [...new Set([...all, ...ns.cloud.getServerNames(), "home"])];

  // XP target avoids the servers currently being batched (read from live fleet configs).
  const batched = new Set();
  for (const host of pool)
    for (const p of ns.ps(host))
      if (p.filename === FLEET && p.args.length) {
        try { batched.add(JSON.parse(p.args[0]).target); } catch { /* ignore */ }
      }

  const xpTarget = pickXpTarget(ns, pool, batched);
  if (!xpTarget) return;
  const xpRam = ns.getScriptRam(XP_WORKER);

  let threads = 0, hosts = 0;
  for (const host of pool) {
    if (claimed.has(host)) continue;                                  // belongs to a fleet
    if (!ns.hasRootAccess(host)) continue;
    if (ns.getServerMaxRam(host) === 0) continue;
    if (ns.ps(host).some(p => ours.has(p.filename))) continue;        // already busy with our stuff
    const reserve = host === "home" ? HOME_RESERVE_GB : 0;
    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve;
    const t = Math.floor(free / xpRam);
    if (t < 1) continue;
    ns.scp(XP_WORKER, host);
    if (ns.exec(XP_WORKER, host, t, xpTarget)) { threads += t; hosts++; }
  }
  if (threads > 0) ns.print(`xp-soak: ${threads} XP threads across ${hosts} idle host(s) → ${xpTarget}`);
}

/** Roughly how much fleet RAM a target can put to work: one batch's RAM times how
 *  many batches fit in a weaken-time pipe. Sizes fleets; approximate is fine
 *  because each fleet-batcher also self-limits on RAM. Without Formulas we read the
 *  target's live state instead of a hypothetical prepped one — rougher (an unprepped
 *  target under-reports), but this is only a sizing hint and MAX_FLEET_SHARE usually
 *  binds first early on anyway. */
function saturationRam(ns, target, hackFraction, hasFormulas) {
  let perThread, hackThreads, growThreads, weakenTime;

  if (hasFormulas) {
    const f = ns.formulas.hacking;
    const s = ns.getServer(target);
    const p = ns.getPlayer();
    s.hackDifficulty = s.minDifficulty;
    s.moneyAvailable = s.moneyMax;
    perThread = f.hackPercent(s, p);
    if (perThread <= 0) return Infinity;
    hackThreads = Math.max(1, Math.floor(hackFraction / perThread));
    const stolen = Math.min(0.99, perThread * hackThreads);
    s.moneyAvailable = s.moneyMax * (1 - stolen);
    growThreads = Math.max(1, Math.ceil(f.growThreads(s, p, s.moneyMax, 1) * 1.05));
    s.moneyAvailable = s.moneyMax;
    weakenTime = f.weakenTime(s, p);
  } else {
    perThread = ns.hackAnalyze(target);
    if (perThread <= 0) return Infinity;
    hackThreads = Math.max(1, Math.floor(hackFraction / perThread));
    const stolen = Math.min(0.99, perThread * hackThreads);
    const mult = 1 / Math.max(1 - stolen, 0.01);
    growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, mult) * 1.05));
    weakenTime = ns.getWeakenTime(target);
  }

  const w1 = Math.ceil(hackThreads * SEC_HACK / SEC_WEAKEN);
  const w2 = Math.ceil(growThreads * SEC_GROW / SEC_WEAKEN);
  const batchRam = hackThreads * ns.getScriptRam(HACK) + growThreads * ns.getScriptRam(GROW)
                 + (w1 + w2) * ns.getScriptRam(WEAKEN);
  const concurrent = Math.max(1, Math.ceil(weakenTime / BATCH_GAP));
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
  const earning = entries.filter(x => !x.prepping);   // posting real earnings
  const prepping = entries.filter(x => x.prepping);    // still warming up (money/sec progress)

  // All-time hacking income (real). Fall back to summed fleet estimates if the
  // API isn't available in this version (and say so once).
  let allTime;
  try {
    allTime = ns.getMoneySources().sinceInstall.hacking;
  } catch (e) {
    allTime = earning.reduce((sum, x) => sum + (x.estEarned || 0), 0);
    if (!_incomeWarned) { ns.print(`note: getMoneySources unavailable (${e}) — totals are estimates`); _incomeWarned = true; }
  }

  const nowT = Date.now();
  if (_startIncome === null) { _startIncome = allTime; _startT = nowT; }   // baseline at commander start
  const run = allTime - _startIncome;
  const rate = run / Math.max(1, (nowT - _startT) / 1000);   // run AVERAGE $/s — robust, never stuck at 0

  const head = `hacked: $${fmt(ns, run)} run (~$${fmt(ns, rate)}/s), $${fmt(ns, allTime)} all-time`;

  if (!earning.length) {
    ns.print(`${head} | ${prepping.length ? `${prepping.length} fleet(s) prepping` : "fleets warming up"}`);
  } else {
    // Per-fleet "this run" = estEarned minus its value when first seen this run, so a
    // fleet that outlived a commander restart doesn't report its entire lifetime.
    let top = null, low = null;
    for (const x of earning) {
      let base = _fleetBase.get(x.target);
      if (base === undefined || x.estEarned < base) { base = x.estEarned; _fleetBase.set(x.target, base); }  // (re)baseline on first sight / fleet restart
      const earned = x.estEarned - base;
      if (!top || earned > top.earned) top = { target: x.target, earned };
      if (!low || earned < low.earned) low = { target: x.target, earned };
    }
    ns.print(`${head} | ${earning.length} fleets | top ${top.target} ~$${fmt(ns, top.earned)} | low ${low.target} ~$${fmt(ns, low.earned)}`);
  }

  // Prep progress, so "warming up" isn't a black box: money% toward max, security over min.
  if (prepping.length) {
    const parts = prepping
      .map(x => `${x.target} ${Math.round((x.moneyPct || 0) * 100)}% money +${(x.secOver || 0).toFixed(1)} sec`)
      .sort();
    ns.print(`  prepping: ${parts.join(", ")}`);
  }
}

/** Rank rooted, in-level, reliable targets by a $/sec proxy. With Formulas we score
 *  at the fully-PREPPED state (min-sec/max-money) — exactly what the batcher holds
 *  the target in. Without it we use the live hackAnalyzeChance/getWeakenTime, which
 *  read current state; the ranking's still sound (relative order barely shifts), it
 *  just isn't the idealized prepped number. */
function rankTargets(ns, all, taken, pservSet, hasFormulas) {
  const p = ns.getPlayer();
  const f = hasFormulas ? ns.formulas.hacking : null;
  const level = ns.getHackingLevel();
  const scored = [];
  for (const name of all) {
    if (pservSet.has(name)) continue;                       // don't hack our own boxes
    if (!ns.hasRootAccess(name)) continue;
    if (taken.has(name)) continue;
    const maxMoney = ns.getServerMaxMoney(name);
    if (!maxMoney || maxMoney <= 0) continue;
    if (ns.getServerRequiredHackingLevel(name) > level) continue;

    let chance, weakenSec;
    if (hasFormulas) {
      const s = ns.getServer(name);
      s.hackDifficulty = s.minDifficulty;                   // score as if fully prepped
      s.moneyAvailable = s.moneyMax;
      chance = f.hackChance(s, p);
      weakenSec = f.weakenTime(s, p) / 1000;
    } else {
      chance = ns.hackAnalyzeChance(name);                  // live (current-state) estimate
      weakenSec = ns.getWeakenTime(name) / 1000;
    }
    if (chance < MIN_CHANCE) continue;
    const score = (maxMoney * chance) / weakenSec;          // money-per-second proxy
    scored.push({ name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.name);
}

// ---- Fallback: reactive deploy-all (used when Formulas.exe is missing) ----

const WORKER = "early-hacking-template.js";
const XP_WORKER = "xp-farm.js";       // soaks leftover RAM into hacking XP (weaken-farm)
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
  const hasMoney = targets.length > 0;
  if (!hasMoney) ns.print("fallback: no reliable, in-level money target yet — routing all RAM to XP farm.");

  // Cap instances per target so their combined steal stays under ~90%. Without
  // this, a huge home stacks many instances onto the single best target and
  // drains it to zero (the over-hack spiral) while starving everything else.
  // Derived from the hack fraction so it stays consistent if you tune it.
  const perTargetCap = Math.max(1, Math.floor(0.9 / FALLBACK_HACK_FRACTION));

  const workerRam = ns.getScriptRam(WORKER);
  const xpWorkerRam = ns.getScriptRam(XP_WORKER);
  // The single best box to weaken-farm for hacking XP (or null if none rooted).
  // This is what soaks up RAM the money side can't use — see below.
  const xpTarget = pickXpTarget(ns, all, targets);

  let uid = 0, deployed = 0, idle = 0, xpThreads = 0;
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
    // Already staffed with EITHER a money worker or an XP farmer → leave it alone
    // (idempotent: don't re-stack across ticks or on a commander re-run).
    if (ns.ps(host).some(p => p.filename === WORKER || p.filename === XP_WORKER)) continue;

    if (hasMoney) ns.scp(WORKER, host);
    // On home, hold back a reserve for commander + your own tools.
    const reserve = host === "home" ? HOME_RESERVE_GB : 0;
    let free = maxRam - ns.getServerUsedRam(host) - reserve;

    // 1) Pack right-sized money workers until every target is at its cap.
    while (hasMoney && free >= workerRam) {
      const target = targets.find(t => assigned.get(t) < perTargetCap);
      if (!target) break;                             // money targets saturated → fall through to XP
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

    // 2) Leftover RAM → hacking XP. weaken() needs only ROOT (not a matching
    //    hacking level), so this turns capacity the thin early-game target pool
    //    can't use into LEVELS — and level is what unlocks more targets. The RAM
    //    pays to unstick itself. One farmer per host, all remaining threads.
    if (xpTarget && free >= xpWorkerRam) {
      ns.scp(XP_WORKER, host);
      const t = Math.floor(free / xpWorkerRam);
      if (ns.exec(XP_WORKER, host, t, xpTarget)) { xpThreads += t; free -= t * xpWorkerRam; }
    }
    idle += Math.max(0, free);
  }

  const parts = [];
  if (deployed > 0) {
    const used = [...assigned.values()].filter(v => v > 0).length;
    parts.push(`${deployed} money workers across ${used} target(s) (<=${perTargetCap}/target)`);
  }
  if (xpThreads > 0) parts.push(`${xpThreads} XP threads → ${xpTarget}`);
  if (parts.length) {
    let msg = `fallback: deployed ${parts.join(", ")}.`;
    if (idle > workerRam * 4) msg += ` ~${(idle / 1024).toFixed(1)}TB still idle.`;
    ns.print(msg);
  }
}

/** Best server to weaken-farm for hacking XP: highest XP-per-second proxy among
 *  ROOTED servers we're NOT money-hacking (skip those to avoid state contention).
 *  XP per weaken scales with a server's BASE security; dividing by weaken time
 *  approximates XP/sec/thread, which naturally avoids boxes whose cycles are
 *  punishingly slow at a low hacking level. Returns null if nothing's rooted yet.
 *
 *  Excludes servers you OWN (purchased cloud boxes + home): they're rooted, so
 *  they'd otherwise pass the filter, but weaken()/grow()/hack() refuse a server
 *  that's yours ("Cannot weaken … because it is your server") — the farmer would
 *  crash on its first tick. XP-farming only makes sense on WORLD servers anyway. */
function pickXpTarget(ns, all, moneyTargets) {
  const taken = new Set(moneyTargets);
  const owned = new Set([...ns.cloud.getServerNames(), "home"]);
  let best = null, bestScore = -1;
  for (const name of all) {
    if (owned.has(name)) continue;                            // can't weaken your own server
    if (!ns.hasRootAccess(name)) continue;
    if (taken.has(name)) continue;
    const wt = ns.getWeakenTime(name);
    if (!wt) continue;
    const score = ns.getServerBaseSecurityLevel(name) / wt;   // ~ XP per second per thread
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best;
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

/** Best-guess "right" purchased-server size from the SPENDABLE budget (cash minus
 *  the cash-awareness reserve): the largest power of two whose FULL fleet (every
 *  slot) costs at most FLEET_BUDGET of it. Climbs the power-of-two ladder on its
 *  own as your spendable grows. When you're too broke for even a min-size fleet
 *  (e.g. fresh post-reset, or banking for a tool), it falls back to the biggest
 *  SINGLE server the budget affords, so it still buys something and climbs out.
 *  Clamped to the game's max purchasable RAM (getRamLimit). */
function autoBuyRam(ns, money) {
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

// ---- Cash-awareness: the dark-web "shopping list" reserve ----

/** The dark-web tool ladder, cheapest first. The commander reserves the price of
 *  the FIRST rung you don't own yet, so server-buying can't leave you unable to
 *  afford your next unlock. Each rung rises automatically as you buy the one below
 *  it; once you own them all, the reserve drops to zero and it invests freely.
 *  (The $1b rung Sara floated was dropped — every entry here is a real purchase.) */
const TOOL_LADDER = [
  { price: 200e3, name: "TOR router",    owned: ns => hasTor(ns) },
  { price: 500e3, name: "BruteSSH.exe",  owned: ns => ns.fileExists("BruteSSH.exe", "home") },
  { price: 1.5e6, name: "FTPCrack.exe",  owned: ns => ns.fileExists("FTPCrack.exe", "home") },
  { price: 5e6,   name: "relaySMTP.exe", owned: ns => ns.fileExists("relaySMTP.exe", "home") },
  { price: 30e6,  name: "HTTPWorm.exe",  owned: ns => ns.fileExists("HTTPWorm.exe", "home") },
  { price: 250e6, name: "SQLInject.exe", owned: ns => ns.fileExists("SQLInject.exe", "home") },
  { price: 5e9,   name: "Formulas.exe",  owned: ns => ns.fileExists("Formulas.exe", "home") },
];

/** The next tool you don't own yet ({price, name}), or null if you own them all.
 *  A rung whose ownership check throws (unknown API on this version) is treated as
 *  OWNED — we skip it rather than crash or over-reserve. */
function nextTool(ns) {
  for (const rung of TOOL_LADDER) {
    let owned;
    try { owned = rung.owned(ns); } catch { owned = true; }
    if (!owned) return rung;
  }
  return null;
}

/** TOR ownership. hasTorRouter() is the documented call, but VERIFY it live per
 *  AGENTS.md; if this version lacks it, fall back to "assume present" (owning any
 *  cracker already implies TOR, and the cracker rungs reserve on their own). */
function hasTor(ns) {
  try { return ns.hasTorRouter(); }
  catch { return true; }
}

/** RAM in human units (GB/TB/PB) so you never have to read a raw power of two. */
function fmtRam(gb) {
  if (gb >= 1048576) return (gb / 1048576) + "PB";
  if (gb >= 1024) return (gb / 1024) + "TB";
  return gb + "GB";
}
