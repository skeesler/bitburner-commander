/**
 * dnet-loot.js — the LIGHT loot pass (Pass 2).
 *
 * No solver, so it's much smaller than the cracker and fits 16 GB (and smaller) nodes the
 * heavy crawler can't stand on. It reads the password book (dnet-db.json, shipped with it),
 * uses connectToSession (cheap; works once a node has been authenticated by Pass 1) to get a
 * session onto each already-cracked neighbor, opens that node's caches, and recurses.
 *
 * Prereq: crack the net first (dnet-crawl.js) and consolidate it (dnet-commander.js) so
 * dnet-db.json holds the passwords.
 *
 *   run dnet-step.js darkweb dnet-loot.js
 *   (recursion args, set automatically: <parent> <depth> <maxDepth> <runId>)
 *
 * Reach model mirrors the crawler: connectToSession grants the session for scp; exec onto a
 * DIRECT neighbor is what lets us hop. Only loots CRACKED nodes — uncracked ones are Pass 1's job.
 */
import * as db from "dnet-db.js";
import { decodeEntities } from "dnet-constraints.js";

const LOOT = "dnet-loot.js";

/** Ship the looter + deps + the password book to keep spidering. */
function payload(ns) {
	return ns.ls(ns.getHostname()).filter((f) => (f.startsWith("dnet-") && f.endsWith(".js")) || f === "dnet-db.json");
}

/**
 * Harvest THIS node. Owner-blocked RAM HIDES cache files, so first reclaim it with repeated
 * memoryReallocation calls (that's what uncovers `.cache`). Then `.cache` → openCache
 * (money/programs), and `.data.txt`/`.lit` → ns.read (intel — RAM-free).
 */
async function openAll(ns, info) {
	const here = ns.getHostname();
	const d = ns.dnet;
	let blocked0 = 0;
	try {
		blocked0 = (await d.getBlockedRam(here)) || 0;
		for (let i = 0; i < 25 && (await d.getBlockedRam(here)) > 0; i++) await d.memoryReallocation(here);
	} catch (e) {
		/* best-effort */
	}
	const files = ns.ls(here).filter((f) => !f.startsWith("dnet-") && !f.endsWith(".js"));
	const loot = [];
	for (const f of files) {
		try {
			if (f.endsWith(".cache")) loot.push({ file: f, cache: await d.openCache(f) });
			else loot.push({ file: f, text: decodeEntities(ns.read(f)) }); // clean at source: logs, storage, parsing
		} catch (e) {
			loot.push({ file: f, err: String(e) });
		}
	}
	const caches = files.filter((f) => f.endsWith(".cache")).length;
	info(`[${here}] blocked=${blocked0}GB files=${files.length} caches=${caches}${loot.length ? " " + JSON.stringify(loot).slice(0, 700) : ""}`);
	return loot;
}

export async function main(ns) {
	ns.disableLog("ALL");
	const d = ns.dnet;
	const here = ns.getHostname();
	const quiet = ns.args.includes("--suppress-info");
	const info = quiet ? () => {} : (m) => ns.tprint(m);
	const pos = ns.args.filter((a) => typeof a !== "string" || !a.startsWith("--")); // positional args, flags stripped
	const from = pos[0] || "";
	const depth = Number(pos[1] ?? 0);
	const maxDepth = Number(pos[2] ?? 6);
	const runId = pos[3] || String(Date.now());
	const seen = `dnet-lseen-${runId}.txt`; // looter's own per-run marker
	const passwords = db.loadDB(ns).passwords; // read the shipped password book

	ns.write(seen, "1", "w");

	// Harvest this node (openAll prints its own per-node summary).
	const loot = await openAll(ns, info);
	const got = loot.filter((l) => !l.err).length;
	db.report(ns, { from: here, loot });
	await db.flush(ns);

	let neighbors = [];
	try {
		neighbors = await d.probe();
	} catch (e) {
		ns.tprint(`[${here}] probe err: ${e}`);
	}

	let spawned = 0;
	for (const host of neighbors) {
		if (host === from) continue;
		if (ns.fileExists(seen, host)) continue;
		if (!(host in passwords)) continue; // uncracked — Pass 1 has to get it first
		if (depth >= maxDepth) continue;
		if (ns.ps(host).some((p) => p.filename === LOOT)) continue;

		// Cheap session (no brute) using the known password, then hop.
		try {
			await d.connectToSession(host, String(passwords[host]));
		} catch (e) {
			info(`[${here}] connectToSession ${host} err: ${e}`);
			continue;
		}
		let ok = false;
		try {
			ok = await ns.scp(payload(ns), host);
		} catch (e) {
			/* ignore */
		}
		if (!ok) continue;
		try {
			await ns.scp(seen, host);
		} catch (e) {
			/* ignore */
		}
		const childArgs = [here, depth + 1, maxDepth, runId];
		if (quiet) childArgs.push("--suppress-info"); // propagate down the recursion
		const pid = ns.exec(LOOT, host, 1, ...childArgs);
		if (pid) spawned++;
		else ns.tprint(`[${here}] exec loot on ${host} failed (RAM?)`);
	}

	info(`[${here}] d${depth}: harvested ${got} file(s), spawned ${spawned} deeper looter(s)`);
}
