/**
 * bladeburner-api.js — THROWAWAY: dump the REAL Bladeburner + BN6 surface in THIS game (3.0.1, BN6).
 *
 * Same discipline as int-api.js / hacknet-api.js / gang-api.js / dnet-api.js: design against the
 * running game. Everything tagged [SRC] below was read from the v3.0.1 tag on 2026-09-17; this run
 * promotes it to [LIVE] or shoots it down. READ-ONLY: no action started, no skill bought, no city
 * switched, and it does NOT call joinBladeburnerDivision (join from the UI; this only observes).
 *
 * WHAT THIS RUN NEEDS TO SETTLE, in priority order:
 *
 *   1. **Is the API really unlocked by BN6 alone?** [SRC: NetscriptFunctions/Bladeburner.ts,
 *      getBladeburner: `canAccessBitNodeFeature(7) || canAccessBitNodeFeature(6)`] — the v2-era
 *      folklore said BN7/SF7 only, and we hold NO SF6/SF7. If the free name-getters in §4 return
 *      data instead of "You have not unlocked the Bladeburner API", the folklore is dead. Note
 *      the SECOND gate: they also throw unless you've JOINED the division (only inBladeburner and
 *      joinBladeburnerDivision are exempt [SRC]) — so §4's results also confirm membership.
 *   2. **Do the [SRC] RAM prices hold?** The shape is brutal and corp-like: name-list getters are
 *      0 GB, but nearly every real state getter is a flat 4 GB [SRC: BladeburnerApiBase 4;
 *      getCurrentAction 1, getNextBlackOp/getBlackOpRank/stopBladeburnerAction 2]. §5 prices all
 *      41 names as strings (free). If 4 GB holds, the BB rig must be corp-style micro-scripts.
 *   3. **The BN6 multiplier table** [SRC: BitNode.tsx case 6] — §3 diffs all 20 expected keys.
 *      Headline: HackingLevelMultiplier 0.35 and HackExpGain 0.25 (hacking is kneecapped; the
 *      commander still earns — ScriptHackMoney 0.75 — but levels crawl), gang softcapped 0.7 with
 *      GangUniqueAugs 0.2, corp valuation 0.2. BladeburnerRank / BladeburnerSkillCost are ABSENT
 *      (= 1.0): BN6 plays Bladeburner at face value. Daedalus wants 35 augs here.
 *   4. **The exact action/skill name strings + enums** a future bb rig would hardcode. §4 dumps
 *      the live name lists; §6 dumps whatever Bladeburner* enums exist, and walks ns.formulas
 *      for a bladeburner sub-namespace (none existed in v2 — is there one now?).
 *
 * RAM (~7.3 GB expected): base 1.6 + getBitNodeMultipliers 4 + getResetInfo 1 + getPlayer 0.5 +
 * script/home introspection 0.2 — everything ns.bladeburner.* this file CALLS is 0 GB [SRC], and
 * getFunctionRamCost takes strings for free. A fresh-node home is 8 GB, so this JUST fits; if it
 * won't launch, kill something or trim §3. Bare-name trap check: locals are p/flush/safe/walk/
 * typeName/show/render/diffMults — none collide with a bladeburner (or any other) ns name.
 *
 * Printed to the terminal AND written to bladeburner-api-dump.txt, FLUSHED AFTER EVERY SECTION,
 * so a dynamic-RAM death still leaves evidence. Paste the output back. Delete once settled.
 */

const DUMP_FILE = "bladeburner-api-dump.txt";

// [SRC: BitNode.tsx case 6, "Like Tears in Rain"] — the 20 keys present. Absent keys = 1.0
// (DaedalusAugsRequirement and StaneksGiftExtraSize excepted, and both are set here anyway).
const BN6_EXPECTED = {
	HackingLevelMultiplier: 0.35, ServerMaxMoney: 0.2, ServerStartingMoney: 0.5,
	ServerStartingSecurity: 1.5, CloudServerSoftcap: 2, CompanyWorkMoney: 0.5,
	CrimeMoney: 0.75, HacknetNodeMoney: 0.2, ScriptHackMoney: 0.75, HackExpGain: 0.25,
	InfiltrationMoney: 0.75, CorporationValuation: 0.2, CorporationSoftcap: 0.9,
	CorporationDivisions: 0.8, GangSoftcap: 0.7, GangUniqueAugs: 0.2,
	DaedalusAugsRequirement: 35, StaneksGiftPowerMultiplier: 0.5, StaneksGiftExtraSize: 2,
	WorldDaemonDifficulty: 2,
	// [SRC] famously-ABSENT, must come back 1.0: BladeburnerRank, BladeburnerSkillCost,
	// HomeComputerRamCost, DarknetMoneyMultiplier — checked via the diff's absent-key list below.
	BladeburnerRank: 1, BladeburnerSkillCost: 1, HomeComputerRamCost: 1, DarknetMoneyMultiplier: 1,
};

// [SRC: NetscriptFunctions/Bladeburner.ts] — all 41 names the file defines. typeof proves
// PRESENCE only (tombstones pass typeof — the ns.formatNumber lesson); §4 calls the free ones.
const BB_API = [
	"inBladeburner", "getContractNames", "getOperationNames", "getBlackOpNames", "getNextBlackOp",
	"getBlackOpRank", "getGeneralActionNames", "getSkillNames", "startAction",
	"stopBladeburnerAction", "getCurrentAction", "getActionTime", "getActionCurrentTime",
	"getActionEstimatedSuccessChance", "getActionRepGain", "getActionRankGain", "getActionRankLoss",
	"getActionCountRemaining", "getActionMaxLevel", "getActionCurrentLevel", "getActionAutolevel",
	"getActionSuccesses", "setActionAutolevel", "setActionLevel", "getRank", "getSkillPoints",
	"getSkillLevel", "getSkillUpgradeCost", "upgradeSkill", "getTeamSize", "setTeamSize",
	"getCityEstimatedPopulation", "getCityCommunities", "getCityChaos", "getCity", "switchCity",
	"getStamina", "joinBladeburnerFaction", "joinBladeburnerDivision", "getBonusTime", "nextUpdate",
];

// [SRC: RamCostGenerator.ts] expected GB per function (BladeburnerApiBase = 4). nextUpdate is
// CycleTiming, whose value we did NOT pull — null here means "report, don't judge".
const BB_RAM_EXPECTED = (() => {
	const t = {};
	for (const k of BB_API) t[k] = 4;
	for (const k of ["inBladeburner", "getContractNames", "getOperationNames", "getBlackOpNames",
		"getGeneralActionNames", "getSkillNames", "getBonusTime"]) t[k] = 0;
	for (const k of ["getNextBlackOp", "getBlackOpRank", "stopBladeburnerAction"]) t[k] = 2;
	// Bracket-string form on purpose: `t.getCurrentAction` would be a MemberExpression the static
	// RAM walker resolves by bare name and BILLS (the hacknet-spend.js `attempt` lesson).
	t["getCurrentAction"] = 1;
	t["nextUpdate"] = null;
	return t;
})();

export async function main(ns) {
	const opts = ns.flags([["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun bladeburner-api.js\n\nRead-only probe for Bladeburner + BN6. Starts nothing, buys nothing, joins nothing.\n");
		return;
	}

	const out = [];
	const p = (s) => out.push(s);
	const flush = () => { try { ns.write(DUMP_FILE, render(out), "w"); } catch (e) { /* terminal has it */ } };
	const safe = (label, fn) => {
		try { const v = fn(); p(`\n${label}:\n${show(v)}`); return v; }
		catch (e) { p(`\n${label}: ERROR ${e}`); return undefined; }
	};

	// ---- 0. What did this script cost, and what are we running on? ----
	safe("this script", () => ({
		name: ns.getScriptName(),
		staticRamGB: ns.getScriptRam(ns.getScriptName(), "home"),
		homeRamGB: ns.getServerMaxRam("home"),
		homeUsedGB: ns.getServerUsedRam("home"),
	}));
	flush();

	// ---- 1. Context: node, source files, the player ----
	safe("getResetInfo()  // expect currentNode 6; ownedSF 1/2/3/4/5/9 — NO 6 or 7, which is the point", () => {
		const reset = ns.getResetInfo();
		const sf = reset.ownedSF instanceof Map ? Object.fromEntries(reset.ownedSF) : reset.ownedSF;
		return { currentNode: reset.currentNode, ownedSF: sf };
	});
	safe("getPlayer() — combat stats gate the division (all four >= 100 to join [SRC]) and drive success", () => {
		const pl = ns.getPlayer();
		return {
			city: pl.city, money: pl.money, skills: pl.skills, exp: pl.exp,
			note: "int weight on bb success is 0.75 per bn5-design.md — int " + pl.skills?.intelligence + " helps here",
		};
	});
	flush();

	// ---- 2. Membership + API access: the two gates, tested with 0 GB calls ----
	safe("inBladeburner()  // exempt from BOTH gates [SRC] — false means join from the UI first", () =>
		ns.bladeburner.inBladeburner());
	safe("getBonusTime()  // 0 GB; behind the gates — a number here proves BN6 unlocks the API with no SF7", () =>
		ns.bladeburner.getBonusTime());
	flush();

	// ---- 3. BN6 multipliers vs the tag ----
	safe("getBitNodeMultipliers() vs [SRC] BN6 table (absent-key checks folded in as 1.0)", () =>
		diffMults(ns.getBitNodeMultipliers(), BN6_EXPECTED));
	flush();

	// ---- 4. The name lists — every one 0 GB [SRC], and each is also an access-gate test ----
	safe("getContractNames()", () => ns.bladeburner.getContractNames());
	safe("getOperationNames()", () => ns.bladeburner.getOperationNames());
	safe("getBlackOpNames()  // the ordered ladder; the LAST one ends the BitNode", () =>
		ns.bladeburner.getBlackOpNames());
	safe("getGeneralActionNames()", () => ns.bladeburner.getGeneralActionNames());
	safe("getSkillNames()", () => ns.bladeburner.getSkillNames());
	flush();

	// ---- 5. Surface sweep + full RAM price list ----
	{
		const names = walk(ns.bladeburner);
		p(`\nALL ns.bladeburner properties (${names.length}):\n` +
			names.map((k) => `  ${k}: ${typeName(ns.bladeburner, k)}`).join("\n"));
		const missing = BB_API.filter((k) => typeof ns.bladeburner?.[k] !== "function");
		const extra = names.filter((k) => !BB_API.includes(k) && typeName(ns.bladeburner, k) === "function");
		p(missing.length ? `!! MISSING vs [SRC] 41: ${missing.join(", ")}` : "all 41 [SRC] names present (presence only)");
		p(extra.length ? `EXTRA beyond [SRC] (undocumented bonus? tombstone? check before trusting): ${extra.join(", ")}`
			: "no extras beyond the [SRC] 41");
	}
	safe("getFunctionRamCost('bladeburner.*') vs [SRC] prices — strings, costs nothing to ask", () => {
		const rows = {};
		let mismatches = 0;
		for (const name of BB_API) {
			let got;
			try { got = ns.getFunctionRamCost(`bladeburner.${name}`); } catch (e) { got = `ERROR ${e}`; }
			const want = BB_RAM_EXPECTED[name];
			const ok = want === null || got === want;
			if (!ok) mismatches++;
			rows[name] = ok ? got : `!! ${got} (expected ${want})`;
		}
		rows["--verdict"] = mismatches === 0 ? "all match [SRC] — promote to [LIVE]" : `${mismatches} MISMATCH(ES)`;
		return rows;
	});
	flush();

	// ---- 6. Enums + formulas: the strings a bb rig would hardcode, and any free math ----
	safe("ns.enums keys (looking for Bladeburner*)", () => Object.keys(ns.enums ?? {}));
	for (const key of Object.keys(ns.enums ?? {}).filter((k) => /blade/i.test(k))) {
		safe(`ns.enums.${key}`, () => ns.enums[key]);
	}
	safe("ns.formulas keys  // v2 had NO formulas.bladeburner — does v3?", () => walk(ns.formulas));
	flush();

	ns.tprint(`${render(out)}\n\n(also written to ${DUMP_FILE} on home — \`cat ${DUMP_FILE}\` if this scrolled away)`);
}

/** Diff a live multiplier object against an expected subset; report mismatches loudly. */
function diffMults(live, expected) {
	if (!live || typeof live !== "object") return { verdict: `!! not an object: ${String(live)}` };
	const mismatches = {}, matches = [];
	for (const [k, want] of Object.entries(expected)) {
		const got = live[k];
		if (got === want) matches.push(k);
		else mismatches[k] = { expected: want, live: got };
	}
	return {
		verdict: Object.keys(mismatches).length === 0
			? `ALL ${matches.length} expected keys MATCH the tag — promote to [LIVE]`
			: `!! ${Object.keys(mismatches).length} MISMATCH(ES) — the tag lied somewhere, update the design docs`,
		mismatches,
		matchedCount: matches.length,
	};
}

/** Own + inherited property names, sorted (namespaces are often class instances). */
function walk(obj) {
	const seen = new Set();
	try {
		for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
			for (const k of Object.getOwnPropertyNames(o)) if (k !== "constructor") seen.add(k);
		}
	} catch (e) { /* a throwing prototype shouldn't cost the whole dump */ }
	return [...seen].sort();
}

function typeName(obj, key) {
	try { return typeof obj?.[key]; } catch (e) { return "?(throws)"; }
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
	} catch (e) { return String(v); }
}

function render(lines) {
	return `\n===== Bladeburner + BN6 API (3.0.1) — paste back =====\n${lines.join("\n")}\n===== END =====`;
}
