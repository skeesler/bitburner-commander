/**
 * dnet-db.js — the DarkNet's durable memory.
 *
 * The DarkNet mutates and kills scripts, so nothing can live in a running
 * process. This module is the shared, on-disk brain that survives both:
 * one canonical JSON file on `home` (`dnet-db.json`), plus an "inbox" of small
 * report files that crawlers drop and the commander drains.
 *
 * SINGLE-WRITER RULE. Many crawlers cannot safely co-write one JSON file — they
 * clobber each other. So:
 *   - crawlers ONLY call report(ns, ...)     -> writes dnet-in-<id>.json
 *   - the commander ONLY calls drainInbox()  -> merges + deletes them, saves DB
 * No locks, no races. See darknet-design.md.
 *
 * Rides ns.read/write/ls/rm, which did NOT move in the v3 API reorg — so this
 * file is fully usable before we've touched a single live `ns.dnet` call.
 *
 * Import it:  import * as db from "dnet-db.js";
 * Inspect it: run dnet-db.js        (prints a summary of the current DB)
 */

import { decodeEntities, harvestCandidates } from "dnet-constraints.js";

export const DB_FILE = "dnet-db.json";
export const INBOX_PREFIX = "dnet-in-"; // crawler report files: dnet-in-*.json
const WORDLIST_CAP = 300; // bound the looted candidate pool (rate limits punish over-guessing)

// Per-process sequence so one crawler's rapid-fire reports don't collide.
let SEQ = 0;
// Report files already shipped home this process. Lets flush() skip ns.rm (a 1GB call) — see flush().
const SENT = new Set();

/** A brand-new, empty database. */
export function emptyDB() {
	return {
		epoch: 0, // our own mutation counter (docs expose no getter; commander bumps it)
		updated: 0,
		passwords: {}, // host -> password (the crown jewels; reused across resets)
		servers: {}, // host -> { depth, charismaReq, hasCache, stasisLinked, frozen, lastSeenEpoch, lastSeenTime }
		edges: {}, // host -> { neighbors: [host...], epoch, time }
		frontier: {}, // host -> { hints: [...], attempts, lastTry }
		harvest: [], // { from, time, loot: [{file, got|err}] } — cache-opening haul
		wordlist: [], // looted candidate pool (trivia answers, common-password lists, loose creds)
		spawnFails: [], // { from, host, reason, blockedRam, time } — nodes a crawler couldn't replicate onto
	};
}

/** Load the canonical DB from home (returns an empty DB if none / corrupt). */
export function loadDB(ns) {
	const raw = ns.read(DB_FILE);
	if (!raw) return emptyDB();
	try {
		// Merge over emptyDB() so older files missing a field still work.
		return { ...emptyDB(), ...JSON.parse(raw) };
	} catch (e) {
		ns.tprint(`WARN dnet-db: ${DB_FILE} unparseable (${e}); starting fresh`);
		return emptyDB();
	}
}

/** Persist the DB. COMMANDER ONLY — crawlers must use report(). */
export function saveDB(ns, db) {
	db.updated = Date.now();
	ns.write(DB_FILE, JSON.stringify(db, null, 2), "w");
}

/**
 * Crawler-side: drop a report into the inbox for the commander to merge.
 * `report` is a partial shape — include only what you learned:
 *   { from, epoch, neighbors:[...], servers:[{host,...}], passwords:{host:pw},
 *     hints:[{host, hint}] }
 */
export function report(ns, partial) {
	const stamp = { time: Date.now(), pid: ns.pid, ...partial };
	const name = `${INBOX_PREFIX}${ns.pid}-${SEQ++}.json`;
	ns.write(name, JSON.stringify(stamp), "w");
	return name;
}

/**
 * Crawler-side: ship this node's inbox reports back to home. report() writes files on
 * whatever darknet node the crawler stands on; the commander drains the inbox on `home`,
 * so the files have to be scp'd there. Returns how many were shipped.
 */
export async function flush(ns) {
	const host = ns.getHostname();
	if (host === "home") return 0; // already home; commander will drain
	// Ship only files we haven't sent yet, and deliberately DON'T ns.rm them: that 1GB call is the
	// difference between the crawler fitting a 16GB node or not. Tracking sent files in memory is
	// enough — the commander deletes them on home after merging, and report() mints a fresh name each
	// time, so a lingering local copy is never re-shipped or re-merged.
	const files = ns.ls(host, INBOX_PREFIX).filter((f) => f.startsWith(INBOX_PREFIX) && !SENT.has(f));
	if (files.length) {
		await ns.scp(files, "home");
		for (const f of files) SENT.add(f);
	}
	return files.length;
}

// drainInbox() lives in dnet-db-drain.js (commander-only): it uses ns.rm/ns.ls, and keeping it out
// of this shared module means crawlers/looters don't pay that RAM just by importing the DB.

/** Fold one report's contents into the DB. Newer epoch/time wins per record. */
export function applyReport(db, r) {
	const epoch = r.epoch ?? db.epoch;
	const time = r.time ?? Date.now();

	if (r.from && Array.isArray(r.neighbors)) {
		recordEdge(db, r.from, r.neighbors, epoch, time);
	}
	for (const s of r.servers ?? []) recordServer(db, s, epoch, time);
	for (const [host, pw] of Object.entries(r.passwords ?? {})) recordPassword(db, host, pw);
	for (const h of r.hints ?? []) recordHint(db, h.host, h.hint, time);
	// Mine looted text for cross-node intel: full creds go straight into the book;
	// partial "contains X and Y" clues become frontier hints for that node.
	for (const item of r.loot ?? []) {
		const t = decodeEntities(typeof item.text === "string" ? item.text : ""); // robust regardless of source
		let m;
		if ((m = /Server:\s*(\S+)\s+Password:\s*"([^"]*)"/i.exec(t))) recordPassword(db, m[1], m[2]);
		else if ((m = /password for (\S+) contains (\w) and (\w)/i.exec(t))) recordHint(db, m[1], `contains ${m[2]},${m[3]}`);
		for (const cand of harvestCandidates(t)) recordWord(db, cand); // wordlists + loose creds → pool
	}
	if (Array.isArray(r.loot) && r.loot.length) db.harvest.push({ from: r.from, time, loot: r.loot });
	// Durable reach diagnostics: which nodes a crawler couldn't replicate onto (no more scroll-hunting).
	for (const sf of r.spawnFails ?? []) db.spawnFails.push({ ...sf, from: r.from, time });
	if (db.spawnFails.length > 40) db.spawnFails = db.spawnFails.slice(-40);
	return db;
}

// ---- record helpers (safe to call from either side, but crawlers should go
//      through report()/applyReport so the commander stays the only DB writer) ----

export function recordEdge(db, host, neighbors, epoch, time = Date.now()) {
	db.edges[host] = { neighbors: [...new Set(neighbors)], epoch, time };
}

export function recordServer(db, s, epoch, time = Date.now()) {
	const prev = db.servers[s.host] ?? {};
	db.servers[s.host] = { ...prev, ...s, lastSeenEpoch: epoch, lastSeenTime: time };
}

export function recordPassword(db, host, password) {
	db.passwords[host] = password;
	// A cracked host is no longer frontier.
	delete db.frontier[host];
}

/** Add a looted candidate to the shared pool (deduped, capped). Filtered per-node by the solver. */
export function recordWord(db, word) {
	if (word == null || word === "") return;
	if (!db.wordlist.includes(word)) db.wordlist.push(word);
	if (db.wordlist.length > WORDLIST_CAP) db.wordlist = db.wordlist.slice(-WORDLIST_CAP);
}

export function recordHint(db, host, hint, time = Date.now()) {
	if (db.passwords[host] != null) return; // already cracked — not a frontier node
	const f = (db.frontier[host] ??= { hints: [], attempts: 0, lastTry: 0 });
	if (hint != null && !f.hints.includes(hint)) f.hints.push(hint);
	f.lastTry = time;
}

// ---- read helpers ----

/** Stored password for a host, or null. Treat as a hypothesis — verify on use. */
export function knownPassword(db, host) {
	return db.passwords[host] ?? null;
}

/**
 * How stale our edge knowledge for `host` is, in mutation epochs.
 * Infinity if we've never seen it. Big delta => re-probe before trusting.
 */
export function edgeAge(db, host) {
	const e = db.edges[host];
	return e ? db.epoch - e.epoch : Infinity;
}

/** One-line-per-section summary, for `run dnet-db.js`. */
export function summarize(db) {
	const n = (o) => Object.keys(o).length;
	return [
		`DarkNet DB  (epoch ${db.epoch}, saved ${db.updated ? new Date(db.updated).toLocaleString() : "never"})`,
		`  servers cataloged : ${n(db.servers)}`,
		`  passwords held    : ${n(db.passwords)}`,
		`  edges mapped      : ${n(db.edges)}`,
		`  frontier (open)   : ${n(db.frontier)}`,
		`  pool candidates   : ${db.wordlist?.length ?? 0}`,
		`  reach fails       : ${db.spawnFails?.length ?? 0}`,
	].join("\n");
}

/** Run directly to inspect the current DB. */
export async function main(ns) {
	ns.tprint("\n" + summarize(loadDB(ns)));
}
