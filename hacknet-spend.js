/**
 * hacknet-spend.js — spend hashes deliberately, and MEASURE what happened.
 *
 * hacknet-api.js and hacknet-scan.js can tell you what the shop sells and what it costs. Neither
 * can tell you two things that matter more:
 *
 *   1. **Which upgrades need a target argument.** `spendHashes(name)` vs `spendHashes(name, target)`.
 *      That requirement is exposed by no getter. The v3.0.1 source settles it on paper — Reduce
 *      Minimum Security and Increase Maximum Money take a SERVER (`hasTargetServer`), Company Favor
 *      takes a COMPANY, the other eight take nothing [SRC: HashUpgradesMetadata.tsx] — so `--discover`
 *      is now a CONFIRMATION run rather than a fishing expedition. Still worth one pass: the release
 *      tag has been wrong before, and the display strings the API accepts are not guaranteed to match
 *      the metadata keys the source uses.
 *   2. **What a purchase is actually worth.** The source says "Sell for Money" pays $1,000,000 for
 *      a flat 4 hashes. In BN9 — where HacknetNodeMoney is 0.1 and ServerMaxMoney is 0.01 — that is
 *      a claim to verify, not repeat. So this script snapshots your money, hashes, study/gym multipliers and
 *      the upgrade's level, spends, and prints the DELTAS. The number it reports is measured in your
 *      game, not remembered from someone else's.
 *
 * It is dry by default and does nothing without --go. That is the same contract every corp-*.js
 * script in this repo honors, and for the same reason: spending is yours to authorize.
 *
 *   run hacknet-spend.js                              # dry: the shop, what's affordable, nothing spent
 *   run hacknet-spend.js "Sell for Money" --go        # spend once, print measured deltas
 *   run hacknet-spend.js "Increase Maximum Money" --target n00dles --go
 *   run hacknet-spend.js "Sell for Money" --count 5 --go
 *   run hacknet-spend.js --discover --go              # the target-requirement survey (see below)
 *
 * --discover is the one-time experiment that confirms question 1 against the live game. For each
 * upgrade you can currently afford, it calls spendHashes with NO target and records exactly what
 * comes back — a `true`, a `false`, or a thrown message naming the argument it wanted. That is a
 * real spend on every upgrade that doesn't need a target, so it costs hashes and it is opt-in
 * twice over (--discover AND --go). Hashes regrow; run it once, write the answers into
 * hacknet-design.md, and never run it again.
 *
 * A caveat on the measurement: hashes accrue continuously, so the hash delta across a spend is
 * "cost minus whatever was produced during the call". The script reports the production rate
 * alongside it so you can tell the two apart. Money and multiplier deltas are clean.
 *
 * RAM: ~6.7 GB. Every ns.hacknet.* function costs 0.50 GB [LIVE, via ns.getFunctionRamCost], and this
 * file mentions ten of them; the rest is ns.getServerMoneyAvailable (0.1 GB), which reads your wallet
 * when pointed at "home" and is far cheaper than ns.getPlayer() for the same number.
 *
 * This file measured 16.70 GB until 2026-09-02. The extra 10 GB was a local helper named `attempt`,
 * which the RAM walker resolved BY BARE NAME to ns.codingcontract.attempt — in a script that has
 * nothing to do with coding contracts. It's called `invoke` now. ram-costs.js is what caught it.
 */

export async function main(ns) {
	const opts = ns.flags([
		["target", ""],
		["count", 1],
		["go", false],
		["discover", false],
		["help", false],
	]);
	const name = String(opts._[0] ?? "");

	if (opts.help) {
		ns.tprint("\nrun hacknet-spend.js [\"Upgrade Name\"] [--target X] [--count N] [--go]\n" +
			"run hacknet-spend.js --discover --go     # survey which upgrades need a target\n\n" +
			"  (no args)   dry report: the shop, costs, what's affordable. Spends nothing.\n" +
			"  --target    server hostname or company name, for the upgrades that need one\n" +
			"  --count     how many to buy at once (default 1)\n" +
			"  --go        actually spend. Without it nothing is purchased.\n" +
			"  --discover  one-time survey: spend once on each affordable upgrade with NO target,\n" +
			"              and record what the API says. Needs --go too.\n");
		return;
	}

	const hn = ns.hacknet;
	const upgNames = invoke(() => hn.getHashUpgrades()).value;
	if (!Array.isArray(upgNames) || !upgNames.length) {
		ns.tprint("\nNo hash upgrades available. Either this hacknet is running NODES rather than\n" +
			"SERVERS (no Source-File 9 → no hash economy), or getHashUpgrades() isn't in this build.\n" +
			"Run `run hacknet-api.js` — it settles which.\n");
		return;
	}

	// ---- Dry report (always printed; it's the context for whatever follows) ----
	const held = invoke(() => hn.numHashes()).value ?? 0;
	const cap = invoke(() => hn.hashCapacity()).value ?? 0;
	const lines = [`=== hash shop === ${fixed(held)} / ${fixed(cap)} hashes banked`];
	for (const u of upgNames) {
		const cost = invoke(() => hn.hashCost(u, Number(opts.count) || 1)).value;
		const lvl = invoke(() => hn.getHashUpgradeLevel(u)).value;
		lines.push(`  ${pad(u, 34)} lvl ${pad(String(lvl ?? "?"), 5)} ` +
			`costs ${pad(fixed(cost), 12)} ${Number.isFinite(cost) && cost <= held ? "AFFORDABLE" : ""}`);
	}
	ns.tprint("\n" + lines.join("\n") + "\n");

	// ---- --discover: the target-requirement survey ----
	if (opts.discover) {
		if (!opts.go) {
			ns.tprint("\n--discover is a REAL SPEND on every upgrade you can currently afford that doesn't\n" +
				"need a target. It is how we learn which ones do. Re-run with --go to authorize it.\n");
			return;
		}
		const findings = [];
		for (const u of upgNames) {
			const cost = invoke(() => hn.hashCost(u, 1)).value;
			if (!Number.isFinite(cost) || cost > (invoke(() => hn.numHashes()).value ?? 0)) {
				findings.push(`  ${pad(u, 34)} SKIPPED — can't afford ${fixed(cost)} hashes right now`);
				continue;
			}
			const before = snapshot(ns, hn, u);
			const r = invoke(() => hn.spendHashes(u));
			await ns.sleep(250);
			const after = snapshot(ns, hn, u);
			const worked = after.level > before.level || r.value === true;
			findings.push(`  ${pad(u, 34)} ${worked ? "NO TARGET NEEDED" : "NEEDS A TARGET (or refused)"} — ` +
				`returned ${JSON.stringify(r.value)}${r.error ? ` / threw: ${r.error}` : ""}` +
				`${worked ? `; ${describe(before, after)}` : ""}`);
		}
		ns.tprint("\n=== target-requirement survey ===\n" + findings.join("\n") +
			"\n\nWrite these into hacknet-design.md and delete the need to ever run this again.\n");
		return;
	}

	// ---- A single, named purchase ----
	if (!name) {
		ns.tprint("Dry run — nothing spent. Name an upgrade to buy it, e.g.\n" +
			`  run hacknet-spend.js "${upgNames[0]}" --go\n`);
		return;
	}
	// Match case-insensitively and suggest, rather than failing on a capital letter. The shop names
	// are long English phrases; typing one exactly is a needless trap.
	const match = upgNames.find((u) => u.toLowerCase() === name.toLowerCase());
	if (!match) {
		const near = upgNames.filter((u) => u.toLowerCase().includes(name.toLowerCase()));
		ns.tprint(`\nNo upgrade named "${name}".` +
			(near.length ? ` Did you mean:\n  ${near.join("\n  ")}\n` : ` Run with no args to list them.\n`));
		return;
	}

	const n = Math.max(1, Math.floor(Number(opts.count) || 1));
	const cost = invoke(() => hn.hashCost(match, n)).value;
	if (!opts.go) {
		ns.tprint(`\nWOULD SPEND ${fixed(cost)} hashes on "${match}" x${n}` +
			(opts.target ? ` targeting "${opts.target}"` : " (no target given)") +
			`\nYou have ${fixed(invoke(() => hn.numHashes()).value)}. Re-run with --go to do it.\n`);
		return;
	}

	const before = snapshot(ns, hn, match);
	// Pass the target only when one was given: some upgrades reject a stray argument, and passing
	// undefined is not always the same as passing nothing.
	const r = opts.target
		? invoke(() => hn.spendHashes(match, String(opts.target), n))
		: invoke(() => hn.spendHashes(match, undefined, n));
	await ns.sleep(250);
	const after = snapshot(ns, hn, match);

	ns.tprint(`\n=== spent: "${match}" x${n}${opts.target ? ` → ${opts.target}` : ""} ===\n` +
		`  returned      ${JSON.stringify(r.value)}${r.error ? `\n  THREW         ${r.error}` : ""}\n` +
		`  ${describe(before, after)}\n` +
		`  production    ${fixed(before.rate)} hashes/sec (so the hash delta includes regrowth)\n` +
		(after.level > before.level
			? `  → the upgrade level moved, so this landed.\n`
			: `  → the upgrade level did NOT move. It either needs a --target, or you couldn't afford it.\n`));
}

/** Everything worth diffing across a spend, in one cheap read. */
function snapshot(ns, hn, upgName) {
	return {
		hashes: invoke(() => hn.numHashes()).value ?? 0,
		capacity: invoke(() => hn.hashCapacity()).value ?? 0,
		// Pointed at "home", this returns the player's own money — 0.1 GB instead of getPlayer's 0.5.
		money: invoke(() => ns.getServerMoneyAvailable("home")).value ?? 0,
		level: invoke(() => hn.getHashUpgradeLevel(upgName)).value ?? 0,
		study: invoke(() => hn.getStudyMult()).value ?? 0,
		training: invoke(() => hn.getTrainingMult()).value ?? 0,
		rate: fleetRate(hn),
	};
}

function fleetRate(hn) {
	const count = invoke(() => hn.numNodes()).value ?? 0;
	let r = 0;
	for (let i = 0; i < count; i++) r += invoke(() => hn.getNodeStats(i)).value?.production ?? 0;
	return r;
}

/** The measured effect, as a one-liner of deltas. This is the whole point of the script. */
function describe(before, after) {
	const d = [];
	d.push(`hashes ${fixed(before.hashes)}→${fixed(after.hashes)} (${signed(after.hashes - before.hashes)})`);
	if (after.money !== before.money) d.push(`money +$${fixed(after.money - before.money)}`);
	if (after.capacity !== before.capacity) d.push(`capacity ${fixed(before.capacity)}→${fixed(after.capacity)}`);
	if (after.level !== before.level) d.push(`level ${before.level}→${after.level}`);
	if (after.study !== before.study) d.push(`studyMult ${before.study}→${after.study}`);
	if (after.training !== before.training) d.push(`trainingMult ${before.training}→${after.training}`);
	return d.join(", ");
}

/**
 * Run something and capture BOTH the return value and any throw. The distinction matters here more
 * than usual: a `false` return and a thrown "you must specify a target" are different answers to the
 * question this script exists to ask, and a plain try/catch that swallows one would lose it.
 */
function invoke(fn) {
	try { return { value: fn(), error: null }; } catch (e) { return { value: undefined, error: String(e) }; }
}

function fixed(v) {
	if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
	return Math.abs(v) >= 1e6 ? v.toExponential(3) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function signed(v) {
	return (v >= 0 ? "+" : "") + fixed(v);
}

function pad(s, n) {
	s = String(s);
	return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}
