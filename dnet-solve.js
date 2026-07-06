/**
 * dnet-solve.js — cracks a DarkNet node's password automatically.
 *
 * Two halves (see darknet-design.md):
 *   STATIC candidates — built by the constraint model (dnet-constraints.js) from getServerDetails
 *     AND any looted intel passed in via opts.hints, then generated cheapest-first. This is where
 *     literal leaks, captchas, anagrams, divisibility, Roman numerals, ranges, wordlists, defaults,
 *     and looted "contains X and Y" narrowing all live — one predicate set, one candidate list.
 *   ADAPTIVE strategies — need PER-GUESS feedback, which rides heartbleed() NOT the authenticate
 *     reply (confirmed 2026-07-05): guess -> heartbleed(host) -> parse the log entry for that guess
 *     -> its `data` string carries the hint. Two grammars seen through that one channel:
 *       · positional "yes/yesn't" (NIL / Mastermind) -> broadcast each symbol across all positions
 *       · fuzzy digit-leak prose (OpenWebAccessPoint) -> fold into `mustContain`, re-generate
 *     Mobile nodes are freezeServer()'d first: a broadcast is ~alphabet guesses at ~10s each, but the
 *     net mutates every ~12s, so an unpinned node migrates out mid-solve. Freeze sacrifices the node's
 *     RAM/loot — accepted for these crack-for-the-flywheel nodes.
 *
 * We make as FEW authenticate calls as possible — nodes 503-rate-limit you if you hammer them,
 * so brute-force is actively harmful. Stops immediately on non-password responses:
 *   200 = success · 401 = wrong · 351 = Direct Connection Required (can't crack from here)
 *   503 = Service Unavailable (rate-limited) · authenticate throw = node offline/migrated
 *
 * Usage:  run dnet-solve.js <host>   |   import { solve } from "dnet-solve.js"
 *         solve(ns, host, { hints: ["contains 3 and 1", ...], pool: [...wordlist] })
 */
import { constraintsFor, generate, satisfies, describe, decodeEntities, harvestCandidates } from "dnet-constraints.js";

/** Bucket an authenticate response: ok | wrong | unreachable | ratelimited. */
function classify(resp) {
	if (!resp) return "wrong";
	if (resp.code === 200 || resp.success === true || /success/i.test(resp.message ?? "")) return "ok";
	if (resp.code === 351) return "unreachable"; // Direct Connection Required
	if (resp.code === 503) return "ratelimited"; // Service Unavailable
	return "wrong";
}

/** Normalize getServerDetails() — confirmed key names from the field (2026-07-04). */
function readDetails(raw) {
	raw = raw || {};
	const pick = (...keys) => {
		for (const k of keys) if (raw[k] != null) return raw[k];
		return undefined;
	};
	return {
		hint: pick("passwordHint", "hint"),
		length: Number(pick("passwordLength", "length", "len")),
		format: String(pick("passwordFormat", "format") ?? "").toLowerCase(),
		model: pick("modelId", "model"),
		data: pick("data"),
		raw,
	};
}

/** Split per-position feedback ("yes,yesn't,..." or array) into tokens. */
function feedback(resp) {
	let d = resp && resp.data;
	if (d == null || d === "") return null;
	if (typeof d === "string") d = d.split(",").map((s) => s.trim());
	return Array.isArray(d) ? d : null;
}
const isYes = (t) => /^yes$/i.test(String(t).trim());
// Does this feedback look like Mastermind positional tokens (one yes/yesn't per position)?
const POS_TOKEN = /^(?:yes|yesn'?t|no)$/i;
const isPositional = (fb, len) => Array.isArray(fb) && fb.length === len && fb.every((t) => POS_TOKEN.test(String(t).trim()));

/**
 * Per-guess feedback rides heartbleed(), not the authenticate reply (confirmed 2026-07-05).
 * Bleed the node, find the recent-log entry for THIS guess, and return its decoded `data` string
 * (positional tokens for Mastermind, or noisy fuzzy-leak prose for others), else null. Each log
 * entry is a JSON string: {code, message, data, passwordAttempted}.
 */
async function bleedData(ns, host, guess) {
	let res;
	try {
		res = await ns.dnet.heartbleed(host);
	} catch (e) {
		ns.print(`  heartbleed(${host}) err: ${e}`);
		return null;
	}
	const logs = res && Array.isArray(res.logs) ? res.logs : [];
	let match = null;
	for (const line of logs) {
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue; // not our JSON — heartbeat/flavor noise
		}
		if (entry && String(entry.passwordAttempted) === String(guess)) match = entry; // newest match wins
	}
	if (!match && logs.length) {
		try {
			match = JSON.parse(logs[logs.length - 1]);
		} catch {
			/* noise-only bleed */
		}
	}
	const data = match && typeof match.data === "string" ? decodeEntities(match.data) : null;
	if (data) ns.print(`  ↩ heartbleed[${guess}]: ${data.slice(0, 120)}`);
	return data || null;
}

function alphabet(format) {
	if (format.includes("numeric")) return "0123456789".split("");
	return "0123456789abcdefghijklmnopqrstuvwxyz".split("");
}

/**
 * Crack `host`. Returns the password string, or null. Must run on a node that can reach it.
 * opts.hints / opts.pool feed looted intel (stored frontier hints, .lit wordlists) into the
 * constraint model, so a soft node's leaked clue helps crack a hard node — the flywheel.
 */
export async function solve(ns, host, { max = 1000, hints = [], pool = [] } = {}) {
	const d = ns.dnet;
	const det = readDetails(await d.getServerDetails(host));
	ns.print(`target ${host}  model=${det.model}  len=${det.length}  fmt=${det.format}`);
	ns.print(`hint: ${det.hint}`);

	// Bail on nodes we structurally can't crack from here.
	if (det.raw.isOnline === false || det.length < 0) {
		ns.tprint(`SKIP ${host}: offline/invalid`);
		return null;
	}
	if (det.raw.isConnectedToCurrentServer === false) {
		ns.tprint(`SKIP ${host}: not directly connected (would 351)`);
		return null;
	}

	// One predicate set from live details + looted intel; one ordered candidate list.
	const c = constraintsFor({ details: det, texts: hints, pool });
	ns.print(`constraints: ${describe(c)}`);

	let tries = 0;
	let stop = null; // "unreachable" | "ratelimited" | "error"
	const tried = new Set(); // never spend a rate-limited guess on a duplicate (static + adaptive overlap)
	const trace = []; // per-attempt {guess, code, message, data, ms} — dumped on FAILED so a new/odd
	                  // model is self-diagnosing (esp. TIMING models: watch `ms` track correctness).
	const attempt = async (guess) => {
		if (guess == null || tries >= max || stop) return null;
		guess = String(guess);
		if (tried.has(guess)) return null;
		tried.add(guess);
		tries++;
		let resp;
		const t0 = Date.now();
		try {
			resp = await d.authenticate(host, String(guess));
		} catch (e) {
			ns.print(`  [${tries}] "${guess}" -> ERR ${e}`);
			trace.push({ guess: String(guess), err: String(e) });
			stop = "error";
			return null;
		}
		const ms = Date.now() - t0;
		trace.push({ guess: String(guess), code: resp && resp.code, message: resp && resp.message, data: resp && resp.data, ms });
		ns.print(`  [${tries}] "${guess}" -> ${resp && resp.code} ${resp && resp.message}  data=${JSON.stringify(resp && resp.data)} ${ms}ms`);
		const cls = classify(resp);
		if (cls === "unreachable" || cls === "ratelimited") stop = cls;
		return resp;
	};
	const okr = (resp) => classify(resp) === "ok";
	const win = (pw) => {
		ns.tprint(`CRACKED ${host} in ${tries} tries — password = "${pw}"`);
		return pw;
	};

	// Static phase: everything the constraints can enumerate, cheapest/highest-confidence first.
	// Skipped for known-Mastermind (NIL): defaults/pool won't hit a random broadcast password, and
	// each ~10s guess is mutation exposure before we can freeze — go straight to the broadcast.
	if (det.model !== "NIL") {
		for (const g of generate(c)) {
			if (okr(await attempt(g))) return win(g);
			if (stop) break;
		}
	}

	// Adaptive phase — per-guess feedback rides heartbleed(), not the auth reply. PIN mobile nodes
	// first (freezeServer): a broadcast is ~alphabet guesses × ~10s ≈ 100s, but the net mutates every
	// ~12s, so an unpinned node migrates out mid-solve. Freeze sacrifices the node's RAM/loot (accepted).
	if (!stop && det.length > 0) {
		if (det.raw.isStationary === false) {
			try {
				const fr = await d.freezeServer(host);
				ns.print(`  ❄ froze ${host} to hold it for the solve (${(fr && fr.message) || "ok"})`);
			} catch (e) {
				ns.print(`  freezeServer(${host}) failed: ${e} — solving unpinned, may lose it to mutation`);
			}
		}

		const alpha = alphabet(det.format);
		const first = alpha[0].repeat(det.length);
		const probe = await attempt(first);
		if (okr(probe)) return win(first);
		const data0 = !stop ? await bleedData(ns, host, first) : null;
		const fb0 = feedback({ data: data0 });

		if (isPositional(fb0, det.length)) {
			// NIL / Mastermind: broadcast each symbol across all positions, reading the positional
			// yes/yesn't from heartbleed after each guess. Resolves every position whose symbol matches,
			// so ≤ (alphabet size) guesses cracks any length — no brute of the space.
			const solved = new Array(det.length).fill(null);
			const apply = (g, fb) => {
				for (let i = 0; i < det.length; i++) if (solved[i] == null && isYes(fb[i])) solved[i] = g[i];
			};
			apply(first, fb0);
			for (let s = 1; s < alpha.length && solved.includes(null) && !stop; s++) {
				const g = alpha[s].repeat(det.length);
				const r = await attempt(g);
				if (okr(r)) return win(g);
				const fb = feedback({ data: await bleedData(ns, host, g) });
				if (isPositional(fb, det.length)) apply(g, fb);
			}
			if (!stop && !solved.includes(null)) {
				const answer = solved.join("");
				if (okr(await attempt(answer))) return win(answer);
			}
		} else if (!stop) {
			// Fuzzy-leak model (e.g. OpenWebAccessPoint): the bled `data` is noisy prose carrying a
			// "contains these digits" hint. Fold it into the constraint set and re-generate a narrowed
			// list; also mine the noise for cross-node candidates (leaked creds/wordlists) into the pool.
			let cc = c;
			if (data0) {
				cc = constraintsFor({ details: det, texts: [...hints, data0], pool: [...pool, ...harvestCandidates(data0)] });
				ns.print(`  heartbleed hint → ${describe(cc)}`);
			}
			for (const g of generate(cc)) {
				if (okr(await attempt(g))) return win(g);
				if (stop) break;
			}
			// Last resort: small constrained numeric brute (short passwords only).
			if (!stop && det.format.includes("numeric") && det.length <= 4) {
				for (let i = 0; i < 10 ** det.length && tries < max && !stop; i++) {
					const g = String(i).padStart(det.length, "0");
					if (!satisfies(cc, g)) continue; // looted constraints prune the brute space too
					if (okr(await attempt(g))) return win(g);
				}
			}
		}
	}

	if (stop === "unreachable") ns.tprint(`SKIP ${host}: direct connection required (351)`);
	else if (stop === "ratelimited") ns.tprint(`BACKOFF ${host}: rate-limited (503) — stopped after ${tries}`);
	else if (stop === "error") ns.tprint(`SKIP ${host}: authenticate error (offline/migrated?)`);
	else ns.tprint(`FAILED ${host} (${det.model}) in ${tries} tries — possible NEW model:\n${JSON.stringify(det.raw, null, 2)}\nattempts (watch data + ms):\n${JSON.stringify(trace.slice(-8), null, 2)}`);
	return null;
}

export async function main(ns) {
	ns.disableLog("ALL");
	const host = ns.args[0];
	if (!host) return ns.tprint("usage: run dnet-solve.js <host>");
	ns.ui.openTail();
	await solve(ns, host);
}
