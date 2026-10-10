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
const LAB_WALKER = "dnet-lab.js";
const LAB_MODEL = "(The Labyrinth)";
const LAB_FLAG = "dnet-lab-armed.txt"; // set by dnet-lab-arm.js: the walker is opt-in
const PINNER = "dnet-pin.js"; // stasis-links a server next to a lab (bn15-design.md)

// Frontier watch. The deep rows are sparse and the net mutates every ~4 s, so a link to the next row down
// opens and closes faster than one pass notices. A crawler on row LINGER_MIN_ROW or deeper that couldn't
// send anyone deeper than itself stays, re-probing every mutation, and handles any new neighbor as if it
// had just arrived (crack, spawn, or hand a lab to the walker). It leaves after LINGER_MS, or as soon as
// it sends a child deeper, since that child is now the frontier.
const LINGER_MIN_ROW = 3;
const LINGER_MS = 3 * 60_000;
const LINGER_EVERY_MS = 4_000;

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
	const maxDepth = Number(pos[2] ?? 12); // hops; BN15 lab 1 needs a foothold on row 6, and paths wander
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

	const startRow = d.getServerDetails().depth; // this server's row (darkweb is -1)
	let wentDeeper = false; // sent a child to a deeper row than ours
	const won = new Set(); // neighbors we hold a session on (cracked, or already ours)

	// Everything we do with one neighbor. Used on arrival, and again by the frontier watch.
	const visit = async (host) => {
		if (host === from) return; // don't crawl back to parent
		if (ns.fileExists(seen, host)) return; // already handled this run by another crawler

		let det;
		try {
			det = await d.getServerDetails(host);
		} catch (e) {
			return;
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

		// A BN15 labyrinth: not a password puzzle (each "guess" is a move). Hand it to the maze walker, on
		// THIS server (we're on the last row, directly connected), once charisma clears the lab's gate AND
		// Sara has armed it (dnet-lab-arm.js).
		if (det.modelId === LAB_MODEL) {
			// First crawler beside this lab with a stasis link free pins its own server as the lab's anchor.
			if (!ns.fileExists(`dnet-anchor-${host}.txt`, "home") && d.getStasisLinkedServers().length < d.getStasisLinkLimit()) {
				const pinPid = ns.exec(PINNER, here, { threads: 1, preventDuplicates: true }, host);
				ns.tprint(pinPid ? `LAB ${host}: pinning ${here} with a stasis link (~30 s).` : `LAB ${host}: a stasis link is free, but ${PINNER} (13.6 GB) doesn't fit on ${here}.`);
			}
			const cha = ns.getPlayer().skills.charisma;
			if (cha < det.requiredCharismaSkill) {
				ns.tprint(`LAB ${host} found next to ${here} — needs charisma ${det.requiredCharismaSkill}, you have ${cha}.`);
				return;
			}
			if (!ns.fileExists(LAB_FLAG, "home")) {
				ns.tprint(`LAB ${host} found next to ${here}, and you have the charisma. \`run dnet-lab-arm.js\` to send a walker.`);
				return;
			}
			const per = ns.getScriptRam(LAB_WALKER, here);
			const threads = per ? Math.floor((ns.getServerMaxRam(here) - ns.getServerUsedRam(here)) / per) : 0;
			const pid = threads > 0 ? ns.exec(LAB_WALKER, here, { threads, preventDuplicates: true }, host) : 0;
			ns.tprint(pid ? `LAB ${host}: launched the maze walker on ${here} (${threads} threads).` : `LAB ${host}: found next to ${here}, but couldn't start ${LAB_WALKER} (${threads} threads fit, or one is already walking).`);
			return;
		}

		// Get a session (crack it) unless we already hold one.
		if (!det.hasSession) {
			if (!det.isOnline || det.isConnectedToCurrentServer === false) return; // can't reach from here
			// Reuse a known password (prior run or a looted leak) before spending guesses; else solve
			// with any looted frontier hints for this host ("contains X,Y", partial leaks) folded in.
			const known = store.passwords[host];
			const hints = store.frontier?.[host]?.hints || [];
			let pw = null;
			if (known && (await d.authenticate(host, String(known)))?.code === 200) pw = known;
			else pw = await solve(ns, host, { hints, pool: store.wordlist || [], quiet });
			if (pw == null) return; // solve() already logged why
			rep.passwords[host] = pw;
			await trickle({ passwords: { [host]: pw }, servers: [srv], hints: det.passwordHint ? [{ host, hint: det.passwordHint }] : [] });
		}
		cracked++;
		won.add(host);
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
		if (depth >= maxDepth) return;
		let ok = false;
		try {
			ok = await ns.scp(payload(ns), host);
		} catch (e) {
			ns.tprint(`[${here}] scp -> ${host} err: ${e}`);
		}
		if (!ok) {
			rep.spawnFails.push({ host, reason: "scp-failed", blockedRam: det.blockedRam });
			return;
		}
		const childArgs = [here, depth + 1, maxDepth, runId];
		if (quiet) childArgs.push("--suppress-info"); // propagate the flag down the recursion
		const pid = ns.exec(CRAWLER, host, 1, ...childArgs);
		if (pid) {
			spawned++;
			if (det.depth > startRow) wentDeeper = true;
		}
		else {
			rep.spawnFails.push({ host, reason: "exec-failed", blockedRam: det.blockedRam });
			info(`[${here}] exec on ${host} (${det.modelId}) failed — crawler needs ~${crawlerRam.toFixed(1)}GB, node blocked=${det.blockedRam}GB (won't fit)`);
		}
	};

	const handled = new Set([from]);
	for (const host of neighbors) {
		handled.add(host);
		await visit(host);
	}

	db.report(ns, rep);
	await db.flush(ns);
	const unhostable = rep.spawnFails.length; // cracked but couldn't host a child crawler (RAM)
	info(`[${here}] hop ${depth}, row ${startRow >= 0 ? startRow : "–"}: cracked ${cracked}/${neighbors.length}, spawned ${spawned} deeper crawler(s)${unhostable ? `, ${unhostable} unhostable` : ""}`);

	// Frontier watch (see LINGER_* above).
	if (startRow < LINGER_MIN_ROW || wentDeeper) return;
	info(`[${here}] row ${startRow} is a frontier — watching for deeper neighbors for ${LINGER_MS / 60_000} min.`);
	// Fresh report for this phase: what was already sent shouldn't be sent twice (spawnFails isn't idempotent).
	rep.servers = [];
	rep.passwords = {};
	rep.hints = [];
	rep.spawnFails = [];
	const crackedBefore = cracked;
	const until = Date.now() + LINGER_MS;
	while (Date.now() < until && !wentDeeper) {
		await ns.sleep(LINGER_EVERY_MS);
		let now = [];
		try {
			now = await d.probe();
		} catch (e) {
			break; // our own server went away
		}
		// A neighbor we failed on (it moved away mid-solve, usually) gets another try if it LEAVES and comes
		// back. Not while it stays: retrying a failing solve every 4 s would just repeat the failure.
		for (const host of handled) if (host !== from && !won.has(host) && !now.includes(host)) handled.delete(host);
		for (const host of now) {
			if (handled.has(host)) continue;
			handled.add(host);
			await visit(host);
		}
	}
	rep.neighbors = [...handled].filter((h) => h !== from);
	db.report(ns, rep);
	await db.flush(ns);
	info(`[${here}] frontier watch over: ${cracked - crackedBefore} more cracked${wentDeeper ? ", and a crawler went deeper" : ""}.`);
}
