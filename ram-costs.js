/**
 * ram-costs.js — what every ns function actually costs, straight from the game.
 *
 * Written because hacknet-api.js came back at **11.65 GB on a 32 GB home** — 36% of the machine for
 * a read-only probe — and no amount of reasoning from the outside could say which mention was
 * responsible. It turns out `ns.getFunctionRamCost` exists (it showed up in the 153-property
 * top-level dump), which makes the whole question a lookup rather than an argument.
 *
 * This matters more in BN9 than anywhere else in the game:
 *   - `CloudServerLimit` is **0** — you cannot buy a single server. There is no "just add more RAM".
 *   - `HomeComputerRamCost` is **5x** — the one upgrade path that remains costs five times normal.
 *   - Hacknet servers are the only purchasable compute, and running scripts on them suppresses hash
 *     gain via the `ramRatio` term. RAM is literally the currency of this BitNode.
 *
 * So: measure before writing, and keep the probes lean.
 *
 *   run ram-costs.js                       # the whole table + this repo's hacknet scripts
 *   run ram-costs.js --scripts a.js,b.js   # also price specific scripts on home
 *   run ram-costs.js --brief               # just the totals, skip the per-function table
 *
 * A reminder about what these numbers really mean, learned the hard way in this repo: RAM is charged
 * for every ns function a script *mentions*, called or not — AND the walker resolves identifiers by
 * BARE NAME against the whole cost tree with the namespace ignored. A local variable named `research`
 * bills you 20 GB for ns.corporation.research in a file that never touches corporations. If a script's
 * measured getScriptRam exceeds the sum of what it honestly uses, look for a local whose name collides
 * with an API function — that gap is the whole diagnostic, and it's why this script prints both.
 */

// Dotted names as ns.getFunctionRamCost wants them. Grouped so the output reads as a story.
const GROUPS = {
	"hacknet (the whole namespace)": [
		"hacknet.numNodes", "hacknet.maxNumNodes", "hacknet.purchaseNode", "hacknet.getPurchaseNodeCost",
		"hacknet.getNodeStats", "hacknet.upgradeLevel", "hacknet.upgradeRam", "hacknet.upgradeCore",
		"hacknet.upgradeCache", "hacknet.getLevelUpgradeCost", "hacknet.getRamUpgradeCost",
		"hacknet.getCoreUpgradeCost", "hacknet.getCacheUpgradeCost", "hacknet.numHashes",
		"hacknet.hashCapacity", "hacknet.hashCost", "hacknet.spendHashes", "hacknet.getHashUpgrades",
		"hacknet.getHashUpgradeLevel", "hacknet.getStudyMult", "hacknet.getTrainingMult",
	],
	"formulas (free, but needs Formulas.exe)": [
		"formulas.hacknetServers.hashGainRate", "formulas.hacknetServers.constants",
		"formulas.hacknetServers.hacknetServerCost", "formulas.hacknetServers.hashUpgradeCost",
		"formulas.hacknetNodes.moneyGainRate", "formulas.hacking.hackPercent",
	],
	"what the hacknet probes mention": [
		"getResetInfo", "getScriptRam", "getScriptName", "getServerMaxRam", "getServerUsedRam",
		"getServerMoneyAvailable", "ps", "write", "read", "flags", "tprint", "sleep",
		"cloud.getServerLimit", "cloud.getRamLimit", "cloud.getServerNames",
		"format.number", "format.ram",
	],
	"common heavyweights, for calibration": [
		"getServer", "getPlayer", "scan", "exec", "nuke", "hack", "grow", "weaken", "share",
		"corporation.getCorporation", "corporation.research", "gang.getGangInformation",
		"singularity.getOwnedAugmentations", "dnet.probe", "getBitNodeMultipliers",
		"stock.getPrice", "sleeve.getTask",
	],
	// Contracts are one of only two multipliers BN9 leaves at full value, which makes
	// contract-finder.js worth its weight here — so price the whole namespace, not just attempt().
	"codingcontract (full price in BN9)": [
		"codingcontract.attempt", "codingcontract.getContractType", "codingcontract.getData",
		"codingcontract.getNumTriesRemaining", "codingcontract.getDescription", "ls",
	],
};

// The repo's own scripts, priced with getScriptRam — the number that actually gates whether a
// script will run on a 32 GB home alongside everything else.
const OUR_SCRIPTS = ["hacknet-api.js", "hacknet-scan.js", "hacknet-spend.js",
	"money-sources.js", "ram-costs.js", "contract-finder.js",
	"int-api.js", "int-delta.js", "int-sleeve-delta.js", "int-farm.js"];

export async function main(ns) {
	const opts = ns.flags([["scripts", ""], ["brief", false], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun ram-costs.js [--scripts a.js,b.js] [--brief]\n" +
			"  --scripts  comma-separated extra scripts on home to price\n" +
			"  --brief    totals only, skip the per-function table\n" +
			"\nRead-only.\n");
		return;
	}

	const out = [];
	const p = (s) => out.push(s);

	const homeMax = safeCall(() => ns.getServerMaxRam("home"), NaN);
	const homeUsed = safeCall(() => ns.getServerUsedRam("home"), NaN);
	p(`=== ns function RAM costs (3.0.1) ===`);
	p(`  home: ${fmt(homeUsed)} / ${fmt(homeMax)} GB used` +
		(Number.isFinite(homeMax) ? `   (${fmt(homeMax - homeUsed)} GB free)` : ""));
	p(`  base cost of any script: ${fmt(safeCall(() => ns.getFunctionRamCost("sleep"), NaN))} GB is what a`);
	p(`  zero-API call costs; the script baseline itself is charged on top by the game.`);

	const all = [];
	for (const [title, names] of Object.entries(GROUPS)) {
		const rows = names.map((n) => ({ name: n, cost: safeCall(() => ns.getFunctionRamCost(n), null) }));
		all.push(...rows);
		if (opts.brief) continue;
		const known = rows.filter((r) => typeof r.cost === "number");
		const total = known.reduce((a, r) => a + r.cost, 0);
		p(`\n--- ${title} ---   (${known.length} priced, sum ${fmt(total)} GB)`);
		for (const r of [...rows].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))) {
			p(`  ${pad(r.name, 44)} ${r.cost === null ? "(no such function)" : fmt(r.cost) + " GB"}`);
		}
	}

	// The headline: which single functions are worth restructuring a script to avoid.
	const priced = all.filter((r) => typeof r.cost === "number" && r.cost > 0);
	priced.sort((a, b) => b.cost - a.cost);
	p(`\n--- most expensive of everything probed ---`);
	for (const r of priced.slice(0, 12)) p(`  ${pad(r.name, 44)} ${fmt(r.cost)} GB`);
	const free = all.filter((r) => r.cost === 0).length;
	p(`  (${free} of the ${all.length} probed cost nothing at all)`);

	// What our own scripts actually weigh.
	const extra = String(opts.scripts).split(",").map((s) => s.trim()).filter(Boolean);
	const scripts = [...new Set([...OUR_SCRIPTS, ...extra])];
	p(`\n--- this repo's hacknet scripts, measured ---`);
	p(`  ${pad("script", 26)}${pad("RAM", 12)}fits alongside?`);
	for (const f of scripts) {
		if (!safeCall(() => ns.fileExists(f, "home"), false)) {
			p(`  ${pad(f, 26)}(not on home)`);
			continue;
		}
		const cost = safeCall(() => ns.getScriptRam(f, "home"), NaN);
		const room = Number.isFinite(homeMax) && Number.isFinite(cost)
			? (cost <= homeMax - homeUsed ? "yes" : `NO — needs ${fmt(cost - (homeMax - homeUsed))} GB more free`)
			: "?";
		p(`  ${pad(f, 26)}${pad(fmt(cost) + " GB", 12)}${room}`);
	}

	p(`\n  If a script's measured RAM is well above the sum of the functions it honestly uses, suspect a`);
	p(`  local variable or object key whose BARE NAME collides with an API function — the walker`);
	p(`  ignores namespaces entirely when it resolves them.`);

	ns.tprint("\n" + out.join("\n") + "\n");
}

function safeCall(fn, fallback) {
	try {
		const v = fn();
		return v === undefined ? fallback : v;
	} catch (e) { return fallback; }
}

function fmt(v) {
	if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
	return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function pad(s, n) {
	s = String(s);
	return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}
