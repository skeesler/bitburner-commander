/** @param {NS} ns
 *  Usage: run traceroute.js <target-hostname>
 *  Crawls the whole network from "home" via scan(), then prints the path to
 *  <target-hostname> if it's reachable — plus the connect commands to walk it.
 *
 *  Case-insensitive: the in-game messages SHOUT hostnames (e.g. "THE-CAVE") but the
 *  real server is "The-Cave", and `connect` is case-sensitive — so we resolve the
 *  typed name to the real casing before pathfinding, and emit the real casing.
 *  Note: server links reshuffle on every aug install, so re-run after each reset.
 */
export async function main(ns) {
  const target = ns.args[0];
  if (!target) {
    ns.tprint("Usage: run traceroute.js <target>");
    return;
  }

  const visited = new Set(["home"]);
  const parent = new Map();
  const queue = ["home"];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of ns.scan(current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  // Resolve the typed name to the REAL hostname: exact match first, then case-insensitive.
  const host =
    (visited.has(target) && target) ||
    [...visited].find((h) => h.toLowerCase() === String(target).toLowerCase());

  if (!host) {
    // Helpful "did you mean" (substring) instead of a bare not-found.
    const near = [...visited].filter((h) => h.toLowerCase().includes(String(target).toLowerCase()));
    ns.tprint(`ERROR: "${target}" was not found anywhere in the scannable network from home.`);
    ns.tprint(`(${visited.size} servers total were reachable.)`);
    if (near.length) ns.tprint(`Did you mean: ${near.slice(0, 8).join(", ")}?`);
    return;
  }

  // Backtrace from the resolved host to home.
  const path = [host];
  let node = host;
  while (node !== "home") {
    node = parent.get(node);
    path.unshift(node);
  }

  if (host !== target) ns.tprint(`(resolved "${target}" -> "${host}")`);
  ns.tprint(`Path to ${host} (${path.length - 1} hops):`);
  ns.tprint(path.join(" -> "));
  ns.tprint("");
  ns.tprint("Connect commands (run in terminal, in order):");
  for (const hop of path.slice(1)) {
    ns.tprint(`connect ${hop}`);
  }
}

// Tab-complete the target against known servers.
export function autocomplete(data) {
  return [...data.servers];
}
