/** @param {NS} ns
 *
 *  COMMANDER — the self-running orchestrator that ties the whole rig together.
 *
 *      run commander.js [buyRam] [hackFraction]
 *
 *  Every TICK it:
 *    1. Roots every server it can with your owned port crackers.
 *    2. Buys ONE more purchased server (>= buyRam, power of two) if affordable,
 *       up to the server limit, and stages the batcher + workers onto it.
 *    3. Ranks all rooted, in-level targets by profitability (via Formulas).
 *    4. Ensures each purchased server is running a pipe batcher against its own
 *       DISTINCT top target — launching only where one isn't already running.
 *
 *  It is idempotent: it discovers current assignments by reading the args of
 *  running batchers, so re-running it (or a game reload) just refills gaps.
 *
 *  Requires Formulas.exe on home. Runs on home by default; if home is too
 *  small to host it, run it on one of your purchased servers instead.
 */

const BATCHER = "batcher-pipe.js";
const FILES = [BATCHER, "hack.js", "grow.js", "weaken.js"];
const DEFAULT_RAM = 512;     // used when no size arg is given; NOT a hard floor
const HOME_RESERVE_GB = 64;  // keep this much free on home for commander itself + your own scripts
const TICK = 10000;          // control-loop interval, ms
const MIN_CHANCE = 0.5;      // skip targets whose prepped hack chance is below this

export async function main(ns) {
  ns.disableLog("ALL");
  // 512 is the DEFAULT, not a floor — an explicit smaller arg is honored, so you
  // can spam cheap servers to climb out of a post-reset trough, then re-run with
  // a bigger size later to let the auto-upgrade roll them up.
  const buyRam = ceilPow2(Number(ns.args[0]) || DEFAULT_RAM);
  const hackFraction = ns.args[1] ?? 0.10;   // conservative default: small batches pipe well

  // Without Formulas.exe (e.g. fresh off an augmentation install) we can't
  // batch, so fall back to the reactive deploy-all until it's re-bought.
  // Re-run the commander after buying Formulas to switch into batching mode.
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  ns.ui.openTail();
  ns.print(hasFormulas
    ? `Commander online — BATCHING. Buying ${buyRam}GB servers, ${Math.round(hackFraction * 100)}%/batch.`
    : `Commander online — FALLBACK (no Formulas.exe): reactive deploy-all. Re-run me once you re-buy Formulas.`);

  while (true) {
    const all = scanAll(ns);
    rootAll(ns, all);
    maybeBuyServer(ns, buyRam);
    if (hasFormulas) ensureBatchers(ns, all, hackFraction);
    else deployReactive(ns, all);
    await ns.sleep(TICK);
  }
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

/** Launch a batcher on every idle purchased server against a distinct top target. */
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
  for (const host of pservs) {
    if (busyHosts.has(host)) continue;
    if (idx >= ranked.length) break;              // no unclaimed targets left right now
    const target = ranked[idx++];
    ns.scp(FILES, host);                          // ensure files present (cheap if already there)
    if (ns.exec(BATCHER, host, 1, target, hackFraction, "quiet")) {   // "quiet" = no auto tail window
      taken.add(target);
      launched.push(`${host}->${target}`);
    }
  }

  const idle = pservs.filter(h => !busyHosts.has(h)).length - launched.length;
  ns.print(`pservs ${pservs.length}/${ns.cloud.getServerLimit()} | ` +
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

/** Deploy the reactive worker to every rooted host (except home), all aimed
 *  at the single best target we can pick without Formulas. Idempotent: skips
 *  any host already running the worker. */
function deployReactive(ns, all) {
  const target = pickTargetSimple(ns, all);
  if (!target) { ns.print("fallback: no rooted, in-level target yet."); return; }

  let deployed = 0;
  const hosts = new Set([...all, ...ns.cloud.getServerNames(), "home"]);
  for (const host of hosts) {
    if (!ns.hasRootAccess(host)) continue;
    const maxRam = ns.getServerMaxRam(host);
    if (maxRam === 0) continue;
    if (ns.ps(host).some(p => p.filename === WORKER)) continue;  // already working

    ns.scp(WORKER, host);
    // On home, hold back a reserve so commander (which runs here) and your own
    // tools always have room. Everywhere else, use all free RAM.
    const reserve = host === "home" ? HOME_RESERVE_GB : 0;
    const free = maxRam - ns.getServerUsedRam(host) - reserve;
    const threads = Math.floor(free / ns.getScriptRam(WORKER, host));
    if (threads > 0) { ns.exec(WORKER, host, threads, target); deployed++; }
  }
  ns.print(`fallback deploy-all -> ${target}: deployed on ${deployed} new host(s).`);
}

/** Best target without Formulas: highest money-per-security among rooted,
 *  in-level servers. A simple, robust early-game heuristic. */
function pickTargetSimple(ns, all) {
  const level = ns.getHackingLevel();
  let best = null, bestScore = 0;
  for (const name of all) {
    if (!ns.hasRootAccess(name)) continue;
    const maxMoney = ns.getServerMaxMoney(name);
    if (maxMoney <= 0) continue;
    if (ns.getServerRequiredHackingLevel(name) > level) continue;
    const score = maxMoney / ns.getServerMinSecurityLevel(name);
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best;
}

/** Smallest power of two >= n. */
function ceilPow2(n) {
  let pw = 1;
  while (pw < n) pw *= 2;
  return pw;
}
