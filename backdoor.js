/** @param {NS} ns
 *
 *  BACKDOOR — grab the four hacking-faction invites by backdooring their servers.
 *
 *      run backdoor.js
 *
 *  CSEC → CyberSec, avmnite-02h → NiteSec, I.I.I.I → The Black Hand, run4theh111z → BitRunners.
 *  Backdooring each server triggers its faction's invite. For each target this figures out what
 *  you've got and does what it can:
 *    1. Locates it on the network and maps the connect-path from home.
 *    2. Roots it with your owned port crackers if it isn't already.
 *    3. Checks your hacking level against the server's requirement.
 *    4. If rooted + in-level: chain-connects home → … → target, installs the backdoor, returns home.
 *
 *  Idempotent and safe to re-run as you level up — it skips anything already backdoored, still
 *  out of reach (reports the level you need), or un-rootable (reports how many crackers short).
 *  Needs the Singularity API (you're in BitNode 4, or own Source-File 4). installBackdoor() takes
 *  real time — proportional to the server's hack time — so a high target can sit "backdooring…"
 *  for a while; that's expected.
 */

const TARGETS = ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z"]; // ascending hacking requirement
const FACTIONS = { "CSEC": "CyberSec", "avmnite-02h": "NiteSec", "I.I.I.I": "The Black Hand", "run4theh111z": "BitRunners" };

export async function main(ns) {
  const s = ns.singularity;
  const parents = bfs(ns);   // host -> previous hop toward home (also the adjacency for chaining)

  let done = 0, waiting = 0, blocked = 0;
  for (const target of TARGETS) {
    const faction = FACTIONS[target];

    if (!(target in parents)) { ns.tprint(`✗ ${target} (${faction}): not found on the network.`); blocked++; continue; }

    // Already backdoored? Skip — re-running is free.
    let srv = null;
    try { srv = ns.getServer(target); } catch { /* getServer unavailable — fall through and try */ }
    if (srv && srv.backdoorInstalled) { ns.tprint(`✓ ${target} (${faction}): already backdoored.`); done++; continue; }

    // Root it if needed.
    if (!ns.hasRootAccess(target)) {
      root(ns, target);
      if (!ns.hasRootAccess(target)) {
        const need = ns.getServerNumPortsRequired(target);
        ns.tprint(`✗ ${target} (${faction}): can't root — needs ${need} open port(s); buy more crackers.`);
        blocked++; continue;
      }
    }

    // Hacking-level gate.
    const req = ns.getServerRequiredHackingLevel(target), lvl = ns.getHackingLevel();
    if (lvl < req) { ns.tprint(`… ${target} (${faction}): need hack ${req}, have ${lvl} — come back after leveling.`); waiting++; continue; }

    // Chain-connect home → … → target (each BFS hop is an adjacency), backdoor, return home.
    const path = pathTo(target, parents);   // [home, hop, …, target]
    s.connect("home");
    let reached = true;
    for (const hop of path.slice(1)) {
      if (!s.connect(hop)) { reached = false; ns.tprint(`✗ ${target} (${faction}): couldn't connect to ${hop}.`); break; }
    }
    if (!reached) { s.connect("home"); blocked++; continue; }

    ns.tprint(`▶ backdooring ${target} (${faction})… (takes a bit)`);
    await s.installBackdoor();
    s.connect("home");
    ns.tprint(`✓ ${target} (${faction}): backdoor installed — the invite should land shortly.`);
    done++;
  }

  s.connect("home"); // leave us where we started
  ns.tprint(`— backdoor sweep: ${done} done, ${waiting} waiting on level, ${blocked} blocked. ` +
            `${waiting ? "Re-run as you level up." : done === TARGETS.length ? "All four in the bag." : ""}`);
}

/** BFS from home: map every reachable host to its previous hop (parent). The parent chain both
 *  proves reachability and gives the connect-path, and each parent link IS a direct adjacency. */
function bfs(ns) {
  const parents = { home: "" };   // "" = root of the walk (home has no parent)
  const queue = ["home"];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of ns.scan(cur)) if (!(n in parents)) { parents[n] = cur; queue.push(n); }
  }
  return parents;
}

/** Walk parents back to home, producing [home, …, target]. */
function pathTo(target, parents) {
  const path = [];
  for (let n = target; n !== ""; n = parents[n]) path.unshift(n);
  return path;
}

/** Open ports with every owned cracker, then nuke — same idiom as commander.js. */
function root(ns, host) {
  let ports = 0;
  if (ns.fileExists("BruteSSH.exe", "home"))  { ns.brutessh(host);  ports++; }
  if (ns.fileExists("FTPCrack.exe", "home"))  { ns.ftpcrack(host);  ports++; }
  if (ns.fileExists("relaySMTP.exe", "home")) { ns.relaysmtp(host); ports++; }
  if (ns.fileExists("HTTPWorm.exe", "home"))  { ns.httpworm(host);  ports++; }
  if (ns.fileExists("SQLInject.exe", "home")) { ns.sqlinject(host); ports++; }
  if (ports >= ns.getServerNumPortsRequired(host)) { try { ns.nuke(host); } catch { /* level too low — caller reports */ } }
}
