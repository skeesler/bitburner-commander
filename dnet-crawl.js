/**
 * dnet-crawl.js — crack the darknet and walk it on its own.
 *
 * INCREMENT 2: self-replicating. On the node it runs on it probes, cracks each reachable
 * neighbor via solve(), then scp+execs ITSELF onto every cracked neighbor to recurse — so
 * from darkweb it spiders the whole reachable darknet, reporting each neighborhood home.
 *
 *   run dnet-step.js darkweb dnet-crawl.js
 *   (recursion args, set automatically: <parent> <depth> <maxDepth> <runId>)
 *
 * Loop/churn guards: never crawls back to its parent; a per-RUN marker (`dnet-seen-<runId>`)
 * makes each node handled once per run (across branches) but re-crawled on a fresh run; skips
 * nodes already running a crawler; caps at maxDepth. Skips offline / not-directly-connected
 * neighbors (they'd only 351). INCREMENT 3 (next): open caches for loot.
 */
import { solve } from "dnet-solve.js";
import * as db from "dnet-db.js";

const CRAWLER = "dnet-crawl.js";

/** dnet-*.js + the password/frontier book — what a child needs to keep spidering and cracking. */
function payload(ns) {
	return ns.ls(ns.getHostname(), "dnet-").filter((f) => f.endsWith(".js") || f === "dnet-db.json");
}

export async function main(ns) {
	ns.disableLog("ALL");
	const d = ns.dnet;
	const here = ns.getHostname();
	const crawlerRam = ns.getScriptRam(CRAWLER, here); // our own size — the real reason an exec won't fit
	const quiet = ns.args.includes("--suppress-info"); // only surface failed/FAILED (and errors)
	const info = quiet ? () => {} : (m) => ns.tprint(m);
	const pos = ns.args.filter((a) => typeof a !== "string" || !a.startsWith("--")); // positional args, flags stripped
	const from = pos[0] || ""; // parent — don't crawl back into it
	const depth = Number(pos[1] ?? 0);
	const maxDepth = Number(pos[2] ?? 4);
	const runId = pos[3] || String(Date.now()); // root mints it; children inherit it
	const seen = `dnet-seen-${runId}.txt`; // per-run marker → fresh runs re-crawl
	const store = db.loadDB(ns); // shipped book: passwords already held + looted frontier hints

	ns.write(seen, "1", "w"); // mark this node handled for this run

	let neighbors = [];
	try {
		neighbors = await d.probe();
	} catch (e) {
		ns.tprint(`[${here}] probe err: ${e}`);
	}

	const rep = { from: here, neighbors, servers: [], passwords: {}, hints: [], spawnFails: [] };
	let cracked = 0;
	let spawned = 0;

	// Trickle reporting: ship findings home as they happen — a check-in on arrival, then each crack
	// the instant it lands — so the commander updates node-by-node, not in end-of-neighborhood bursts.
	// Every trickled field is idempotent on merge; the one that isn't (spawnFails) ships once, at the end.
	const trickle = async (partial) => {
		db.report(ns, { from: here, ...partial });
		await db.flush(ns);
	};
	await trickle({ neighbors }); // "reached <here> — here's its neighbor layer"

	for (const host of neighbors) {
		if (host === from) continue; // don't crawl back to parent
		if (ns.fileExists(seen, host)) continue; // already handled this run by another crawler

		let det;
		try {
			det = await d.getServerDetails(host);
		} catch (e) {
			continue;
		}
		const srv = {
			host,
			depth: det.depth,
			charismaReq: det.requiredCharismaSkill,
			model: det.modelId,
			stationary: det.isStationary,
			blockedRam: det.blockedRam,
		};
		rep.servers.push(srv);
		if (det.passwordHint) rep.hints.push({ host, hint: det.passwordHint });

		// Get a session (crack it) unless we already hold one.
		if (!det.hasSession) {
			if (!det.isOnline || det.isConnectedToCurrentServer === false) continue; // can't reach from here
			// Reuse a known password (prior run or a looted leak) before spending guesses; else solve
			// with any looted frontier hints for this host ("contains X,Y", partial leaks) folded in.
			const known = store.passwords[host];
			const hints = store.frontier?.[host]?.hints || [];
			let pw = null;
			if (known && (await d.authenticate(host, String(known)))?.code === 200) pw = known;
			else pw = await solve(ns, host, { hints, pool: store.wordlist || [], quiet });
			if (pw == null) continue; // solve() already logged why
			rep.passwords[host] = pw;
			await trickle({ passwords: { [host]: pw }, servers: [srv], hints: det.passwordHint ? [{ host, hint: det.passwordHint }] : [] });
		}
		cracked++;
		// Mark handled even if exec fails below (low-RAM nodes) so siblings don't re-crack it.
		try {
			await ns.scp(seen, host);
		} catch (e) {
			/* ignore */
		}

		// Recurse onto the cracked neighbor. NOTE: we just scp'd our own seen-marker onto `host`
		// above — that marker is how SIBLING crawlers skip it (at their loop top, line ~52). We must
		// NOT re-check fileExists(seen, host) here, or every crawler trips on its OWN marker and never
		// recurses (that was the "spawned 0 deeper, reach fails 0" bug). Double-exec doesn't need a
		// ps() guard (dropped, to save its ~0.2GB): two ~14GB crawlers can't co-host a 16GB node, so
		// the second exec just fails on RAM, and the per-run seen-markers dedupe the work anyway.
		if (depth >= maxDepth) continue;
		let ok = false;
		try {
			ok = await ns.scp(payload(ns), host);
		} catch (e) {
			ns.tprint(`[${here}] scp -> ${host} err: ${e}`);
		}
		if (!ok) {
			rep.spawnFails.push({ host, reason: "scp-failed", blockedRam: det.blockedRam });
			continue;
		}
		const childArgs = [here, depth + 1, maxDepth, runId];
		if (quiet) childArgs.push("--suppress-info"); // propagate the flag down the recursion
		const pid = ns.exec(CRAWLER, host, 1, ...childArgs);
		if (pid) spawned++;
		else {
			rep.spawnFails.push({ host, reason: "exec-failed", blockedRam: det.blockedRam });
			ns.tprint(`[${here}] exec on ${host} (${det.modelId}) failed — crawler needs ~${crawlerRam.toFixed(1)}GB, node blocked=${det.blockedRam}GB (won't fit)`);
		}
	}

	db.report(ns, rep);
	await db.flush(ns);
	const unhostable = rep.spawnFails.length; // cracked but couldn't host a child crawler (RAM)
	info(`[${here}] d${depth}: cracked ${cracked}/${neighbors.length}, spawned ${spawned} deeper crawler(s)${unhostable ? `, ${unhostable} unhostable` : ""}`);
}
