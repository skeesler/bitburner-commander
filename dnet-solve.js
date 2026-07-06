/**
 * dnet-solve.js — cracks a DarkNet node's password automatically.
 *
 * Two halves (see darknet-design.md):
 *   STATIC candidates — built by the constraint model (dnet-constraints.js) from getServerDetails
 *     AND any looted intel passed in via opts.hints, then generated cheapest-first. This is where
 *     literal leaks, captchas, anagrams, divisibility, Roman numerals, ranges, wordlists, defaults,
 *     and looted "contains X and Y" narrowing all live — one predicate set, one candidate list.
 *   ADAPTIVE strategies — need per-guess feedback, so they can't be pre-generated:
 *     · positional "broadcast" solve (NIL / Mastermind)
 *     · small numeric brute-force fallback (now filtered through the constraints too)
 *
 * We make as FEW authenticate calls as possible — nodes 503-rate-limit you if you hammer them,
 * so brute-force is actively harmful. Stops immediately on non-password responses:
 *   200 = success · 401 = wrong · 351 = Direct Connection Required (can't crack from here)
 *   503 = Service Unavailable (rate-limited) · authenticate throw = node offline/migrated
 *
 * Usage:  run dnet-solve.js <host>   |   import { solve } from "dnet-solve.js"
 *         solve(ns, host, { hints: ["contains 3 and 1", ...], pool: [...wordlist] })
 */
import { constraintsFor, generate, satisfies, describe } from "dnet-constraints.js";

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
	if (d == null) return null;
	if (typeof d === "string") d = d.split(",").map((s) => s.trim());
	return Array.isArray(d) ? d : null;
}
const isYes = (t) => /^yes$/i.test(String(t).trim());

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
	const trace = []; // per-attempt {guess, code, message, data, ms} — dumped on FAILED so a new/odd
	                  // model is self-diagnosing (esp. TIMING models: watch `ms` track correctness).
	const attempt = async (guess) => {
		if (guess == null || tries >= max || stop) return null;
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
	for (const g of generate(c)) {
		if (okr(await attempt(g))) return win(g);
		if (stop) break;
	}

	// Adaptive phase: positional broadcast (Mastermind), else small numeric brute — both
	// constrained by what we know (alphabet from format, and satisfies() prunes the brute).
	if (!stop && det.length > 0) {
		const alpha = alphabet(det.format);
		const first = alpha[0].repeat(det.length);
		const probe = await attempt(first);
		if (okr(probe)) return win(first);
		let fb0 = !stop ? feedback(probe) : null;

		// DIAGNOSTIC (temporary): NIL gave NO positional feedback on the auth return live (data absent),
		// so the broadcast never engaged. Suspicion: the yes/yesn't grammar rides heartbleed (the log
		// bleed), not the authenticate() reply. When the probe yields no usable feedback, bleed the node
		// right after our guess and dump it — heartbleed reads recent logs, where feedback for THIS guess
		// (`first`) should sit. Rides home via the FAILED trace. Revert once we've seen the grammar.
		if (!stop && (!fb0 || fb0.length !== det.length)) {
			try {
				const bled = await d.heartbleed(host);
				trace.push({ after: first, heartbleed: bled });
				ns.print(`  heartbleed(${host}) after "${first}": ${JSON.stringify(bled).slice(0, 400)}`);
				// If the bled log parses as per-position feedback of the right length, adopt it so the
				// broadcast can actually proceed (and we confirm the channel in one shot).
				const hb = feedback({ data: bled });
				if (hb && hb.length === det.length) fb0 = hb;
			} catch (e) {
				trace.push({ heartbleedErr: String(e) });
				ns.print(`  heartbleed(${host}) err: ${e}`);
			}
		}

		if (fb0 && fb0.length === det.length) {
			const solved = new Array(det.length).fill(null);
			const apply = (g, fb) => {
				for (let i = 0; i < det.length; i++) if (solved[i] == null && fb[i] != null && isYes(fb[i])) solved[i] = g[i];
			};
			apply(first, fb0);
			for (let s = 1; s < alpha.length && solved.includes(null) && !stop; s++) {
				const g = alpha[s].repeat(det.length);
				const r = await attempt(g);
				if (okr(r)) return win(g);
				const fb = feedback(r);
				if (fb) apply(g, fb);
			}
			if (!stop && !solved.includes(null)) {
				const answer = solved.join("");
				if (okr(await attempt(answer))) return win(answer);
			}
		} else if (!stop && det.format.includes("numeric") && det.length <= 4) {
			for (let i = 0; i < 10 ** det.length && tries < max && !stop; i++) {
				const g = String(i).padStart(det.length, "0");
				if (!satisfies(c, g)) continue; // looted constraints prune the brute space too
				if (okr(await attempt(g))) return win(g);
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
