/** @param {NS} ns
 *
 *  SHARE-MANAGER — pour spare fleet RAM into ns.share() to boost faction
 *  reputation gain, without starving your money rig.
 *
 *  Why this exists (the mechanic is skimpy on purpose):
 *    - One share() call blocks ~10s and contributes ONE thread's worth of power.
 *      The game sums *every* sharing thread across your whole network into a
 *      single reputation-gain multiplier. Total thread count is the only knob.
 *    - The boost only helps while you're actively WORKING for a faction. Sharing
 *      when you're idle (or hacking, or in class) is pure wasted RAM — so by
 *      default this only spins up while getCurrentWork() reports faction work.
 *    - The bonus scales with the LOG of total threads: front-loaded, then flat.
 *      Doubling threads does not double the boost. The live "share power" line
 *      below is there so you can *see* the knee and stop feeding it past the
 *      point where the RAM would earn more as money.
 *    - Host CORES multiply share power, so home threads punch above their weight
 *      — but we still reserve home so the commander/batcher never starves.
 *
 *  It's a "soak the leftovers" tool: it top-ups spare RAM without killing live
 *  workers (no share-power gaps), and adapts as hosts come online. Note it will
 *  compete with commander.js's xp-soak for idle RAM — run this when you'd rather
 *  the leftovers become reputation than hacking XP.
 *
 *  Usage:
 *    run share-manager.js                 gate on faction work (recommended)
 *    run share-manager.js --always        share 24/7, ignore what you're doing
 *    run share-manager.js --company       also share during company work
 *    run share-manager.js --home-reserve 128
 */

const WORKER = "share-worker.js";

export async function main(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags([
    ["always", false],        // ignore the work-gate; share continuously
    ["company", false],       // also share during company work, not just faction
    ["home-reserve", 64],     // GB kept free on home for commander/contract-solver
    ["tick", 10],             // seconds between top-up passes (~one share cycle)
    ["quiet", false],
  ]);
  ns.ui.openTail();

  const workerRam = ns.getScriptRam(WORKER, "home");
  if (workerRam === 0) {
    ns.tprint(`ERROR: can't find ${WORKER} on home — copy it there first.`);
    return;
  }

  let lastState = null;
  while (true) {
    const gate = shouldShare(ns, flags);
    const pool = walkAll(ns);

    if (!gate.on) {
      const killed = killWorkers(ns, pool);
      if (killed && !flags.quiet) ns.print(`stood down (${killed} host(s)) — ${gate.reason}`);
      report(ns, `idle`, gate.reason, 0, 0);
    } else {
      let threads = 0, hosts = 0;
      for (const host of pool) {
        if (ns.getServerMaxRam(host) === 0) continue;
        if (!ns.hasRootAccess(host)) continue;

        // Already sharing here? Leave it running (no gap) and just tally it.
        const mine = ns.ps(host).filter(p => p.filename === WORKER);
        if (mine.length) { for (const p of mine) threads += p.threads; hosts++; continue; }

        const reserve = host === "home" ? flags["home-reserve"] : 0;
        const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve;
        const t = Math.floor(free / workerRam);
        if (t < 1) continue;

        if (host !== "home" && !ns.fileExists(WORKER, host)) ns.scp(WORKER, host, "home");
        if (ns.exec(WORKER, host, t)) { threads += t; hosts++; }
      }
      report(ns, `sharing`, gate.reason, threads, hosts);
    }

    lastState = gate.on;
    await ns.sleep(flags.tick * 1000);
  }
}

/** Decide whether sharing pays right now. Faction work → yes. Company work →
 *  only with --company. Anything else (idle, hacking, class, crime) → no, unless
 *  --always. If the Singularity API isn't available to you, we can't tell what
 *  you're doing, so we fall back to always-on and say so. */
function shouldShare(ns, flags) {
  if (flags.always) return { on: true, reason: "always-on (--always)" };
  let work;
  try { work = ns.singularity.getCurrentWork(); }
  catch { return { on: true, reason: "Singularity unavailable — always-on fallback" }; }

  if (!work) return { on: false, reason: "not working (nothing to boost)" };
  if (work.type === "FACTION") return { on: true, reason: `faction: ${work.factionName ?? "?"}` };
  if (work.type === "COMPANY" && flags.company) return { on: true, reason: `company: ${work.companyName ?? "?"}` };
  return { on: false, reason: `busy with ${String(work.type).toLowerCase()} — no faction rep to boost` };
}

/** Kill every share-worker we've deployed across the pool. Returns host count. */
function killWorkers(ns, pool) {
  let hosts = 0;
  for (const host of pool) {
    const mine = ns.ps(host).filter(p => p.filename === WORKER);
    if (!mine.length) continue;
    for (const p of mine) ns.kill(p.pid);
    hosts++;
  }
  return hosts;
}

/** BFS the whole server graph from home (+ cloud servers are reachable via scan). */
function walkAll(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  while (queue.length) {
    for (const n of ns.scan(queue.shift())) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return [...seen];
}

/** Live readout: state + the share-power multiplier, so N stops being a vibe. */
function report(ns, state, reason, threads, hosts) {
  let power = 1;
  try { power = ns.getSharePower(); } catch { /* namespace/availability — degrade to 1 */ }
  const pct = (power - 1) * 100;
  ns.clearLog();
  ns.print(`SHARE-MANAGER  [${state}]`);
  ns.print(`  ${reason}`);
  ns.print(`  ${threads} threads across ${hosts} host(s)`);
  ns.print(`  share power ${power.toFixed(3)}x  (+${pct.toFixed(1)}% faction rep gain)`);
  if (threads > 0) ns.print(`  (log-scaled: the next 10x threads adds only ~+9%. Watch the knee.)`);
}
