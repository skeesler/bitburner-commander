/**
 * hacknet-api.js — THROWAWAY: dump the REAL hacknet + hash surface in THIS game (3.0.1, BN9).
 *
 * Same discipline as dnet-api.js, gang-api.js and corp-api.js: design against the running game.
 * The v3.0.1 release tag has already answered a lot (see hacknet-design.md, everything tagged
 * [SRC]) — this script's job is to promote those answers to [LIVE] or shoot them down. The tag has
 * been right before and wrong before; `ns.dnet.freezeServer` was in the docs and not in the game.
 *
 * WHAT THIS RUN NEEDS TO SETTLE, in priority order:
 *
 *   1. **The exact upgrade name strings.** The source gives metadata keys (`SellForMoney`);
 *      getHashUpgrades() returns display strings, and spendHashes wants whatever IT returns. Every
 *      later script hardcodes these, so getting them wrong poisons everything downstream. §6.
 *   2. **Is "Sell for Money" really flat-cost?** The source says a `cost` field overrides
 *      `costPerLevel` and never escalates — 4 hashes for $1e6, forever, which is the numeraire the
 *      whole plan is priced in. If hashCost(name, 5) comes back 20 it's flat; 60 means escalating
 *      and the economics change shape. §6.
 *   3. **Is CloudServerLimit really 0?** BN9 sets it to 0 [SRC], which would mean `commander.js`
 *      has been trying to buy servers against a wall. §3 asks ns.cloud directly.
 *   4. **Is anything already squatting on the hacknet servers?** Hash gain scales with FREE ram, and
 *      commander.js roots and deploys to every host it can see. ns.ps() on each hacknet server names
 *      the offenders. This is silent in every log the rig prints. §3.
 *
 * READ-ONLY. Never purchases a node, never upgrades anything, never spends a hash.
 *
 *   run hacknet-api.js            # everything
 *   run hacknet-api.js --brief    # skip the per-upgrade cost-curve table
 *
 * RAM: ~3.2 GB, paid honestly. Almost all of ns.hacknet.* is free, so this calls by name and lets
 * the static walker charge what it likes. Deliberately ABSENT: ns.getBitNodeMultipliers (4 GB *and*
 * needs SF5, which we don't have — ownedSF is 1/2/3/4). Rather than pay 4 GB for a guaranteed throw,
 * §3 measures the multipliers that matter through their observable effects, which is better evidence
 * anyway: ns.cloud.getServerLimit() is CloudServerLimit after the game has applied it.
 *
 * Naming note (the repo-wide trap): the RAM walker resolves identifiers against the WHOLE cost tree
 * BY BARE NAME, namespace ignored — a local called `research` bills 20 GB for ns.corporation.research
 * in a file that never mentions corporations. Locals here are `hn`, `upgNames`, `nodeStat`, `flush`.
 *
 * Printed to the terminal AND written to hacknet-api-dump.txt on home, FLUSHED AFTER EVERY SECTION —
 * so if an unexpected charged call trips the runtime's dynamic-RAM killer, the file still holds
 * everything up to the death. `cat hacknet-api-dump.txt` after any crash.
 *
 * RFA sync is one-way (disk -> game), so paste the terminal output back. Delete once we've built.
 */

const DUMP_FILE = "hacknet-api-dump.txt";

const NODE_API = [
	"numNodes", "maxNumNodes", "purchaseNode", "getPurchaseNodeCost", "getNodeStats",
	"upgradeLevel", "upgradeRam", "upgradeCore", "upgradeCache",
	"getLevelUpgradeCost", "getRamUpgradeCost", "getCoreUpgradeCost", "getCacheUpgradeCost",
];

const HASH_API = [
	"numHashes", "hashCapacity", "hashCost", "spendHashes",
	"getHashUpgrades", "getHashUpgradeLevel", "getStudyMult", "getTrainingMult",
];

// No evidence either way — a free typeof probe rules them in or out. This is how gang-api.js turned
// up getOtherGangInformation, a real method the dev docs never listed.
const SPECULATIVE = [
	"nextUpdate", "getHashRate", "hashGainRate", "getHashUpgradeTarget", "sellHashes",
	"getCacheLevel", "getServerNames", "getHostname",
];

// The 11 upgrades in src/Hacknet/data/HashUpgradesMetadata.tsx at v3.0.1, as METADATA KEYS. The
// live API returns display strings; §6 diffs the two lists so a rename can't silently break us.
const SRC_UPGRADES = [
	"SellForMoney", "SellForCorporationFunds", "ReduceMinimumSecurity", "IncreaseMaximumMoney",
	"ImproveStudying", "ImproveGymTraining", "ExchangeForCorporationResearch",
	"ExchangeForBladeburnerRank", "ExchangeForBladeburnerSP", "GenerateCodingContract",
	"CompanyFavor",
];

export async function main(ns) {
	const opts = ns.flags([["brief", false], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun hacknet-api.js [--brief]\n  --brief  skip the per-upgrade cost-curve table\n" +
			"\nRead-only. Never buys a node, never spends a hash.\n");
		return;
	}

	const hn = ns.hacknet;
	const out = [];
	const p = (s) => out.push(s);
	// ns.write is 0 GB, so flushing after every section is free insurance against a mid-run death.
	const flush = () => { try { ns.write(DUMP_FILE, render(out), "w"); } catch (e) { /* terminal has it */ } };

	const safe = (label, fn) => {
		try {
			const v = fn();
			p(`\n${label}:\n${show(v)}`);
			return v;
		} catch (e) {
			p(`\n${label}: ERROR ${e}`);
			return undefined;
		}
	};

	// ---- 0. What did this script cost, and what are we running on? ----
	safe("this script", () => ({
		name: ns.getScriptName(),
		staticRamGB: ns.getScriptRam(ns.getScriptName(), "home"),
		homeRamGB: ns.getServerMaxRam("home"),
		homeUsedGB: ns.getServerUsedRam("home"),
	}));
	flush();

	// ---- 1. Top-level ns namespaces — would a v3 rename be hiding here? ----
	const nsNames = walk(ns);
	p(`\nALL top-level ns properties (${nsNames.length}):\n` +
		nsNames.map((k) => `  ${k}: ${typeName(ns, k)}`).join("\n"));
	p(`\nns.hacknet present: ${typeof hn} ` +
		(typeof hn === "object" && hn ? "(good — no rename)" : "(!! LOOK AT THE LIST ABOVE, it moved)"));
	flush();

	// ---- 2. Every own + inherited ns.hacknet property, then the expected surface ----
	const hnNames = walk(hn);
	p(`\nALL ns.hacknet properties (${hnNames.length}):\n` +
		hnNames.map((k) => `  ${k}: ${typeName(hn, k)}`).join("\n"));

	// typeof is a property READ, not a call — free, and the only cheap way to survey a surface. It
	// proves PRESENCE, not callability: Bitburner keeps tombstones that pass typeof and then throw
	// "removed in version X" when called. §4–§6 do the calling.
	const group = (title, names) => {
		const missing = names.filter((k) => typeof hn[k] !== "function");
		p(`\n${title} (${names.length} expected, ${missing.length} MISSING):\n` +
			names.map((k) => `  ${k}: ${typeof hn[k]}`).join("\n"));
		return missing;
	};
	const missing = [...group("hacknet hardware API", NODE_API), ...group("hash economy API", HASH_API)];
	p(`\nSPECULATIVE names (pure guesses — "undefined" just means we guessed wrong):\n` +
		SPECULATIVE.map((k) => `  ${k}: ${typeof hn[k]}`).join("\n"));

	const expected = new Set([...NODE_API, ...HASH_API, ...SPECULATIVE]);
	const extra = hnNames.filter((k) => !expected.has(k) && typeName(hn, k) === "function");
	p(`\nUNDOCUMENTED methods present in this build (${extra.length}):\n` +
		(extra.length ? extra.map((k) => `  ${k}`).join("\n") : "  (none)"));
	flush();

	// ---- 3. BN9 constraints, measured rather than read ----
	// getBitNodeMultipliers needs SF5 and we don't have it, so instead we ask the game for the
	// POST-multiplier values. ns.cloud.getServerLimit() IS CloudServerLimit once applied — better
	// evidence than the constant, because it's what the game will actually enforce.
	safe("getResetInfo()", () => {
		const reset = ns.getResetInfo();
		const sf = reset.ownedSF instanceof Map ? Object.fromEntries(reset.ownedSF) : reset.ownedSF;
		return {
			currentNode: reset.currentNode,
			ownedSF: sf,
			expected: "currentNode should be 9. In BN9 the hacknet is SERVERS natively — no SF9 needed.",
		};
	});
	safe("ns.cloud — expect a limit of 0 in BN9 [SRC: CloudServerLimit 0]", () => ({
		serverLimit: ns.cloud.getServerLimit(),
		ramLimit: ns.cloud.getRamLimit(),
		owned: ns.cloud.getServerNames(),
		verdict: ns.cloud.getServerLimit() === 0
			? "CONFIRMED — no purchased servers in this node. commander.js's buying loop is a no-op here."
			: "!! NOT zero. hacknet-design.md's whole RAM story needs revisiting.",
	}));
	flush();

	// ---- 4. Hardware state ----
	const numNodes = safe("numNodes()", () => hn.numNodes());
	safe("maxNumNodes()  // [SRC] MaxServers 20", () => hn.maxNumNodes());
	safe("getPurchaseNodeCost()  // [SRC] BaseCost 50e3 x PurchaseMult 3.2^n", () => hn.getPurchaseNodeCost());
	flush();

	// ---- 5. The stat shape, the fleet, and who is squatting on it ----
	if (typeof numNodes === "number" && numNodes > 0) {
		const nodeStat = safe("getNodeStats(0)  // field names decide SERVER vs NODE", () => hn.getNodeStats(0));
		if (nodeStat && typeof nodeStat === "object") {
			const isServer = "hashCapacity" in nodeStat || "cache" in nodeStat || "hostname" in nodeStat;
			p(`\nVERDICT from field names: ${isServer ? "SERVERS (hash economy live, as BN9 promises)" : "!! NODES — unexpected in BN9"}`);
			p(`  fields seen: ${Object.keys(nodeStat).join(", ")}`);
		}
		// Upgrade prices at node 0's current level. n=1 is the next step, n=10 the bulk price — the
		// pair tells us whether the curve matches [SRC] UpgradeLevelMult 1.1 / RamMult 1.4 / CoreMult 1.55.
		safe("getLevelUpgradeCost(0, 1) / (0, 10)", () => [hn.getLevelUpgradeCost(0, 1), hn.getLevelUpgradeCost(0, 10)]);
		safe("getRamUpgradeCost(0, 1) / (0, 10)", () => [hn.getRamUpgradeCost(0, 1), hn.getRamUpgradeCost(0, 10)]);
		safe("getCoreUpgradeCost(0, 1) / (0, 10)", () => [hn.getCoreUpgradeCost(0, 1), hn.getCoreUpgradeCost(0, 10)]);
		safe("getCacheUpgradeCost(0, 1)  // raises the hash BANK ceiling, not the rate", () => hn.getCacheUpgradeCost(0, 1));

		// The squatter check. Hash gain scales with FREE ram [SRC: the ramRatio term], and
		// commander.js deploys to every rooted host it can find. Hacknet servers qualify. Nothing in
		// the commander's log would ever mention it, so we look directly.
		safe("fleet + who is using its RAM", () => {
			let production = 0, ramTotal = 0, ramBusy = 0;
			const rows = [];
			for (let i = 0; i < numNodes; i++) {
				const s = hn.getNodeStats(i);
				production += s.production || 0;
				ramTotal += s.ram || 0;
				ramBusy += s.ramUsed || 0;
				const host = s.hostname ?? s.name;
				let squatters = [];
				try {
					squatters = ns.ps(host).map((proc) => `${proc.filename} x${proc.threads}`);
				} catch (e) { squatters = [`(ps failed: ${e})`]; }
				rows.push({ i, host, level: s.level, ram: s.ram, ramUsed: s.ramUsed, cores: s.cores,
					cache: s.cache, production: s.production, running: squatters });
			}
			return {
				count: numNodes, sumProduction: production, ramTotal, ramBusy,
				verdict: ramBusy > 0
					? "!! SCRIPTS ARE RUNNING ON HACKNET SERVERS — you are paying for that RAM in hashes."
					: "clean — all hacknet RAM is free and generating.",
				nodes: rows,
			};
		});
	} else {
		p("\n(no hacknet hardware owned — buy ONE server in-game and re-run to capture getNodeStats() " +
			"and the upgrade-cost shapes. Everything below still works.)");
	}
	flush();

	// ---- 6. The shop — the exact strings, and the flat-vs-escalating question ----
	const upgNames = safe("getHashUpgrades()  // THE authoritative name list — later scripts hardcode these", () => hn.getHashUpgrades());
	safe("numHashes() / hashCapacity()", () => ({ numHashes: hn.numHashes(), hashCapacity: hn.hashCapacity() }));
	safe("getStudyMult() / getTrainingMult()", () => ({ study: hn.getStudyMult(), training: hn.getTrainingMult() }));

	// Diff the live list against the 11 metadata keys from the release tag. A name present in one and
	// not the other is exactly the kind of drift that silently breaks a spender written from source.
	if (Array.isArray(upgNames)) {
		const norm = (s) => String(s).replace(/[^a-z]/gi, "").toLowerCase();
		const liveNorm = new Set(upgNames.map(norm));
		const srcNorm = new Set(SRC_UPGRADES.map(norm));
		p(`\nSHOP vs v3.0.1 source (${upgNames.length} live, ${SRC_UPGRADES.length} in metadata):`);
		p(`  in source but NOT live: ${SRC_UPGRADES.filter((k) => !liveNorm.has(norm(k))).join(", ") || "(none)"}`);
		p(`  live but NOT in source: ${upgNames.filter((k) => !srcNorm.has(norm(k))).join(", ") || "(none)"}`);
		p(`  (matched loosely on letters only — the live strings are the ones to pass to spendHashes)`);
	}
	flush();

	if (Array.isArray(upgNames) && upgNames.length && !opts.brief) {
		// [SRC] getCost: a flat `cost` field overrides costPerLevel; otherwise the n-th purchase
		// costs costPerLevel * n. So for an ESCALATING upgrade at level L, hashCost(name,5) should be
		// costPerLevel * 0.5*5*(5+2L+1); for a FLAT one it should be exactly 5x hashCost(name,1).
		// Printing all three lets the numbers settle it without trusting either of us.
		const rows = [];
		for (const name of upgNames) {
			const row = { upgrade: name };
			try { row.level = hn.getHashUpgradeLevel(name); } catch (e) { row.level = `ERR ${e}`; }
			try { row.cost_noArg = hn.hashCost(name); } catch (e) { row.cost_noArg = `ERR ${e}`; }
			try { row.cost_n1 = hn.hashCost(name, 1); } catch (e) { row.cost_n1 = `ERR ${e}`; }
			try { row.cost_n5 = hn.hashCost(name, 5); } catch (e) { row.cost_n5 = `ERR ${e}`; }
			if (typeof row.cost_n1 === "number" && typeof row.cost_n5 === "number") {
				row.flat = row.cost_n5 === row.cost_n1 * 5 ? "FLAT" : "escalating";
			}
			rows.push(row);
		}
		p(`\nHASH SHOP — level, price curve, and flat-vs-escalating:\n${show(rows)}`);
		p(`\n(Target requirements are already known from the release tag: Reduce Minimum Security and\n` +
			` Increase Maximum Money take a SERVER, Company Favor takes a COMPANY, the other eight take\n` +
			` nothing. hacknet-spend.js --discover confirms that live. This probe does not spend.)`);
		flush();
	} else if (Array.isArray(upgNames) && upgNames.length) {
		p(`\nHASH SHOP (${upgNames.length} upgrades, --brief so no cost curve):\n  ${upgNames.join("\n  ")}`);
		flush();
	}

	// ---- 7. Formulas — the planning math, if we own the program ----
	// ns.formulas.* is 0 GB but throws without Formulas.exe. constants() is the prize: the whole
	// cost/gain model in one object, to check against the [SRC] table in hacknet-design.md.
	safe("formulas.hacknetServers.constants()  // needs Formulas.exe", () => ns.formulas.hacknetServers.constants());
	safe("formulas.hacknetServers.hashGainRate(1, 0, 1, 1, 1)  // fresh server, mult=1", () =>
		ns.formulas.hacknetServers.hashGainRate(1, 0, 1, 1, 1));
	// The BN9 multiplier check, done twice over: full RAM free vs all RAM consumed. The ratio is the
	// ramRatio term, i.e. exactly what running scripts on a hacknet server costs you.
	safe("hashGainRate with ram FREE vs ram FULL (the ramRatio penalty, live)", () => ({
		free: ns.formulas.hacknetServers.hashGainRate(100, 0, 64, 4, 1),
		full: ns.formulas.hacknetServers.hashGainRate(100, 64, 64, 4, 1),
	}));
	safe("formulas.hacknetServers.hacknetServerCost(1, 1) / (10, 1)", () =>
		[ns.formulas.hacknetServers.hacknetServerCost(1, 1), ns.formulas.hacknetServers.hacknetServerCost(10, 1)]);
	if (Array.isArray(upgNames) && upgNames.length) {
		safe(`formulas.hacknetServers.hashUpgradeCost(${JSON.stringify(upgNames[0])}, 1)`, () =>
			ns.formulas.hacknetServers.hashUpgradeCost(upgNames[0], 1));
	}
	flush();

	// ---- Report ----
	const banner = missing.length
		? `!! ${missing.length} EXPECTED METHOD(S) MISSING FROM THIS BUILD: ${missing.join(", ")}`
		: `all ${NODE_API.length + HASH_API.length} expected hacknet/hash methods present.`;
	out.unshift(banner, "");
	flush();
	ns.tprint(`${render(out)}\n\n(also written to ${DUMP_FILE} on home — \`cat ${DUMP_FILE}\` if this scrolled away)`);
}

/** Own + inherited property names, sorted. Namespaces are often class instances, so walk the chain. */
function walk(obj) {
	const seen = new Set();
	try {
		for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
			for (const k of Object.getOwnPropertyNames(o)) if (k !== "constructor") seen.add(k);
		}
	} catch (e) { /* a throwing prototype shouldn't cost us the whole dump */ }
	return [...seen].sort();
}

/** typeof a property without letting a throwing getter kill the walk. */
function typeName(obj, key) {
	try { return typeof obj[key]; } catch (e) { return "?(throws)"; }
}

/** JSON that survives undefined, Maps, Infinity and the odd circular reference. */
function show(v) {
	if (v === undefined) return "undefined";
	try {
		return JSON.stringify(v, (_k, val) => {
			if (val instanceof Map) return Object.fromEntries(val);
			if (typeof val === "number" && !Number.isFinite(val)) return String(val);
			return val;
		}, 2);
	} catch (e) {
		return String(v);
	}
}

function render(lines) {
	return `\n===== hacknet + hash API (3.0.1, BN9) — paste back =====\n${lines.join("\n")}\n===== END =====`;
}
