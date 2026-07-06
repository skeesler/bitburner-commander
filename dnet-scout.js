/**
 * dnet-scout.js — the LIGHT reach + map pass.
 *
 * The heavy crawler (dnet-crawl.js, ~14.5GB) can't fit a 16GB node that's running a heartbeat +
 * some blocked RAM (free ~13-14GB), because its crack primitives — getServerDetails + authenticate
 * — cost ~7GB together and can't be shed while it still solves. The scout drops ALL of that: it only
 * probe()s, relays, and reuses passwords we ALREADY hold (connectToSession — no solving). So it fits
 * the nodes the crawler bounces off, and its job is:
 *   - MAP the deep region the crawler can't reach (report topology + node list home)
 *   - CONFIRM/crack every node whose password is already in the book (the loot flywheel)
 *   - RELAY itself onward through those nodes
 * It CANNOT solve a new node — that needs the heavy primitives, which can't ride a small node. Nodes
 * it can't crack are still reported (seen, uncracked) for a later heavy pass or a looted cred.
 *
 *   run dnet-step.js darkweb dnet-scout.js
 *   (recursion args, set automatically: <parent> <depth> <maxDepth> <runId>)
 *
 * Complements, doesn't replace: dnet-crawl.js (solves), dnet-loot.js (harvests), dnet-recon.js (debug).
 */
import * as db from "dnet-db.js";

const SCOUT = "dnet-scout.js";

/** Ship the scout + deps + the password book to keep spidering. */
function payload(ns) {
	return ns.ls(ns.getHostname()).filter((f) => (f.startsWith("dnet-") && f.endsWith(".js")) || f === "dnet-db.json");
}

export async function main(ns) {
	ns.disableLog("ALL");
	const d = ns.dnet;
	const here = ns.getHostname();
	const quiet = ns.args.includes("--suppress-info");
	const info = quiet ? () => {} : (m) => ns.tprint(m);
	const pos = ns.args.filter((a) => typeof a !== "string" || !a.startsWith("--")); // positional args, flags stripped
	const from = pos[0] || ""; // parent — don't relay back into it
	const depth = Number(pos[1] ?? 0);
	const maxDepth = Number(pos[2] ?? 8);
	const runId = pos[3] || String(Date.now());
	const seen = `dnet-sseen-${runId}.txt`; // scout's own per-run marker (distinct from crawl/loot)
	const passwords = db.loadDB(ns).passwords; // the shipped book — what we can crack without solving

	ns.write(seen, "1", "w");

	// Trickle: ship findings as they happen so the commander lights up node-by-node.
	const trickle = async (partial) => {
		db.report(ns, { from: here, ...partial });
		await db.flush(ns);
	};

	let neighbors = [];
	try {
		neighbors = await d.probe();
	} catch (e) {
		ns.tprint(`[${here}] probe err: ${e}`);
	}
	await trickle({ neighbors }); // "scout reached <here> — here's its neighbor layer"

	const cataloged = []; // every neighbor we saw, so the map shows the deep region even when uncracked
	let reached = 0;
	let spawned = 0;

	for (const host of neighbors) {
		if (host === from) continue;
		if (ns.fileExists(seen, host)) continue;
		cataloged.push({ host }); // no getServerDetails here (too heavy) — hostname/edge only

		const pw = passwords[host];
		if (pw == null) continue; // unknown password — the scout can't solve; leave it for crawl/loot

		// Confirm a session with the known password (cheap, no solving). connectToSession works at any
		// distance, and exec below is legal because `host` is a DIRECT neighbor.
		try {
			await d.connectToSession(host, String(pw));
		} catch (e) {
			continue; // stale/offline — a heavy pass or re-loot will sort it
		}
		reached++;
		await trickle({ passwords: { [host]: pw }, servers: [{ host }] }); // live: reached this node

		// Relay onward through it.
		if (depth >= maxDepth) continue;
		try {
			await ns.scp(seen, host);
		} catch (e) {
			/* ignore */
		}
		let ok = false;
		try {
			ok = await ns.scp(payload(ns), host);
		} catch (e) {
			/* ignore */
		}
		if (!ok) continue;
		const childArgs = [here, depth + 1, maxDepth, runId];
		if (quiet) childArgs.push("--suppress-info"); // propagate down the recursion
		const pid = ns.exec(SCOUT, host, 1, ...childArgs);
		if (pid) spawned++;
	}

	db.report(ns, { from: here, servers: cataloged }); // catalog the whole layer (incl. uncracked)
	await db.flush(ns);
	info(`[${here}] d${depth}: mapped ${neighbors.length} neighbor(s), reached ${reached}, spawned ${spawned} scout(s)`);
}
