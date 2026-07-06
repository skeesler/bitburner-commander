/**
 * dnet-api.js — THROWAWAY: dump the REAL ns.dnet surface in THIS game (3.0.1).
 *
 * The dev-branch markdown lists methods that aren't in the released game — `freezeServer` turned out
 * not to exist (`d.freezeServer is not a function`), so `setStasisLink` and friends are suspect too.
 * Run this on `home` (ns.dnet exists everywhere), paste the output back, and we'll rebuild the reach
 * plan against what's actually callable. Delete after.
 *
 *   run dnet-api.js
 */
export async function main(ns) {
	const d = ns.dnet;

	// Every own + inherited property name (ns.dnet may be a class instance).
	const seen = new Set();
	for (let o = d; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
		for (const k of Object.getOwnPropertyNames(o)) if (k !== "constructor") seen.add(k);
	}
	const all = [...seen].sort().map((k) => {
		let t;
		try {
			t = typeof d[k];
		} catch (e) {
			t = "?";
		}
		return `  ${k}: ${t}`;
	});

	// Explicitly probe the methods our reach/pin plan assumed (typeof, so missing ones read "undefined").
	const want = [
		"freezeServer", "setStasisLink", "getStasisLinkedServers", "getStasisLinkLimit",
		"induceServerMigration", "getDarknetInstability", "heartbleed", "authenticate",
		"connectToSession", "probe", "getServerDetails", "openCache", "memoryReallocation",
		"nextMutation", "getDepth", "getServerRequiredCharismaLevel", "isDarknetServer",
		"labradar", "labreport", "phishingAttack", "promoteStock", "unleashStormSeed", "getBlockedRam",
	];
	const probe = want.map((k) => `  ${k}: ${typeof d[k]}`);

	ns.tprint(
		`\n===== ns.dnet API (3.0.1) — paste back =====\n` +
			`ALL properties (${seen.size}):\n${all.join("\n")}\n\n` +
			`EXPECTED (typeof; "undefined" = not in this version):\n${probe.join("\n")}\n` +
			`===== END =====`,
	);
}
