/**
 * dnet-hbprobe.js — THROWAWAY probe: where does NIL/Mastermind feedback live?
 *
 * The solver assumed positional "yes/yesn't" feedback rides the authenticate() return .data.
 * Field trace on `echo:ap3x&sanctuary` (NIL, len5) showed NO data on the 401 — the broadcast
 * solve never got a signal. Prime suspect: the feedback is in `heartbleed(host)` (the log bleed),
 * not the auth return. This probe settles it: guess, then dump BOTH the full auth response AND the
 * heartbleed, so we can see which one carries the grammar — and whether it re-keys to our last guess.
 *
 *   run dnet-step.js darkweb dnet-hbprobe.js                 auto-pick a NIL neighbor of darkweb
 *   run dnet-step.js darkweb dnet-hbprobe.js <host>          probe a specific direct neighbor
 *   run dnet-step.js darkweb dnet-hbprobe.js <host> 00000 11111   ...with explicit guesses
 *
 * We don't need the ORIGINAL failing node — the grammar is per-MODEL (NIL), so any reachable NIL
 * node teaches us the same format. Must run ON a node directly wired to the target (else 351).
 * Guesses are kept to two (rate limits punish hammering); heartbleed is free, so we bleed a
 * baseline first and twice per guess (immediately + after a short sleep, in case the node writes
 * its log on a traffic tick — note logTrafficInterval). Nothing here is load-bearing; delete after.
 */
import { decodeEntities } from "dnet-constraints.js";

/** Call fn(), tolerate promises/throws; return {ok:val} | {err}. */
async function tolerant(fn) {
	try {
		return { ok: await fn() };
	} catch (e) {
		return { err: String(e) };
	}
}

/** Bleed the node and show BOTH raw and entity-decoded (grammar-parsing needs the raw). */
async function bleed(ns, d, host, label) {
	const r = await tolerant(() => d.heartbleed(host));
	const raw = r.ok ?? r.err;
	const clean = typeof raw === "string" ? decodeEntities(raw) : raw;
	ns.tprint(`  heartbleed[${label}] raw: ${JSON.stringify(raw)}`);
	if (typeof raw === "string" && clean !== raw) ns.tprint(`  heartbleed[${label}] decoded: ${clean}`);
	return raw;
}

export async function main(ns) {
	ns.disableLog("ALL");
	const d = ns.dnet;
	const here = ns.getHostname();
	let target = ns.args[0];
	const guesses = ns.args.slice(1).map(String);
	if (!guesses.length) guesses.push("00000", "11111"); // two distinct broadcasts → read positions + confirm re-keying

	// Auto-pick a NIL (Mastermind) direct neighbor if no target was named.
	const nb = (await tolerant(() => d.probe())).ok || [];
	if (!target) {
		const models = {};
		for (const h of nb) {
			const det = (await tolerant(() => d.getServerDetails(h))).ok;
			if (det) models[h] = { model: det.modelId, session: det.hasSession, len: det.passwordLength, fmt: det.passwordFormat };
		}
		const nilHost = Object.keys(models).find((h) => models[h].model === "NIL" && !models[h].session) || Object.keys(models).find((h) => models[h].model === "NIL");
		if (!nilHost) {
			ns.tprint(`\n[${here}] no NIL neighbor here. neighbor models:\n${JSON.stringify(models, null, 2)}\nPick a NIL host from a deeper node, or pass one explicitly.`);
			return;
		}
		target = nilHost;
		ns.tprint(`[${here}] auto-picked NIL neighbor: ${target}`);
	}

	const details = (await tolerant(() => d.getServerDetails(target))).ok;
	ns.tprint(`\n===== DNET HBPROBE  (paste this back) =====\nfrom ${here} -> ${target}`);
	ns.tprint(`details: ${JSON.stringify(details, null, 2)}`);

	// Baseline: what's already in the log before we guess anything?
	await bleed(ns, d, target, "baseline");

	for (const g of guesses) {
		ns.tprint(`\n--- guess "${g}" ---`);
		const resp = await tolerant(() => d.authenticate(target, g));
		// FULL response object — feedback might ride a key the solver never traced (message/feedback/clues/…).
		ns.tprint(`  authenticate FULL resp: ${JSON.stringify(resp.ok ?? { err: resp.err })}`);
		await bleed(ns, d, target, "post-guess");
		await ns.sleep(1500); // in case the node writes its log on a traffic tick, not synchronously
		await bleed(ns, d, target, "post-guess+1.5s");
	}

	ns.tprint("\n===== END HBPROBE =====");
}
