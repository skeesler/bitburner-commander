/**
 * int-api.js — THROWAWAY: dump the REAL intelligence + BN5 surface in THIS game (3.0.1, BN5).
 *
 * Same discipline as hacknet-api.js / gang-api.js / dnet-api.js: design against the running game.
 * The v3.0.1 tag has already answered a lot (bn5-design.md, everything [SRC]) — this run promotes
 * those answers to [LIVE] or shoots them down. READ-ONLY: no money spent, no action started.
 *
 * WHAT THIS RUN NEEDS TO SETTLE, in priority order:
 *
 *   1. **Does getBitNodeMultipliers work here, and does it match the tag?** We're standing in BN5,
 *      so canAccessBitNodeFeature(5) should hold without SF5. §3 diffs the live BN5 object against
 *      the [SRC] table, AND calls getBitNodeMultipliers(9) to diff against hacknet-design.md's BN9
 *      table — if both match, future nodes get priced with one 4 GB call instead of a research
 *      session (bn5-design.md open question #5).
 *   2. **The exact enum strings** for cities, university courses and crimes — int-delta.js and
 *      int-sleeve-delta.js hardcode these, so getting them wrong poisons the experiments. §5.
 *   3. **Does the int level match the [SRC] curve?** floor(32·ln(exp+534.6)−200) via
 *      ns.formulas.skills (0 GB; Formulas.exe is free in BN5). §2.
 *   4. **What do the delta experiments cost in RAM?** ns.getFunctionRamCost is free and takes
 *      strings — §6 prices every singularity/sleeve function the labs plan to mention, so their
 *      headers' RAM math is honest before they're ever written to disk in anger.
 *
 * RAM: ~7.4 GB paid honestly — getBitNodeMultipliers 4.0 + getResetInfo 1.0 + getPlayer 0.5 +
 * script/home introspection ~0.3 + base 1.6. All of ns.formulas and ns.enums is 0 GB.
 * Bare-name trap check: locals here are p/flush/safe/walk/typeName/show/render/diffMults/intBonus —
 * none collide with any ns function name.
 *
 * Printed to the terminal AND written to int-api-dump.txt, FLUSHED AFTER EVERY SECTION, so a
 * dynamic-RAM death still leaves evidence. RFA sync is one-way — paste the terminal output back.
 * Delete once bn5-design.md's [OPEN]s are settled.
 */

const DUMP_FILE = "int-api-dump.txt";

// [SRC: BitNode.tsx case 5] — the 17 keys present in BN5's object. Absent keys default to 1.0
// (except DaedalusAugsRequirement 30, StaneksGiftExtraSize 0).
const BN5_EXPECTED = {
	ServerStartingSecurity: 2, ServerStartingMoney: 0.5, CloudServerSoftcap: 1.2,
	CrimeMoney: 0.5, HacknetNodeMoney: 0.2, ScriptHackMoney: 0.15, HackExpGain: 0.5,
	AugmentationMoneyCost: 2, InfiltrationMoney: 1.5, InfiltrationRep: 1.5,
	CorporationValuation: 0.75, CorporationDivisions: 0.75, GangUniqueAugs: 0.5,
	StaneksGiftPowerMultiplier: 1.3, StaneksGiftExtraSize: 0,
	DarknetMoneyMultiplier: 0.7, WorldDaemonDifficulty: 1.5,
};

// [SRC: BitNode.tsx case 9], as recorded in hacknet-design.md — including the two famously-ABSENT
// keys (HacknetNodeMoney, CodingContractMoney) that must come back 1.0.
const BN9_EXPECTED = {
	CloudServerLimit: 0, ServerMaxMoney: 0.01, ScriptHackMoney: 0.1, HackExpGain: 0.05,
	HackingLevelMultiplier: 0.5, HomeComputerRamCost: 5, ServerStartingMoney: 0.1,
	ServerStartingSecurity: 2.5, DarknetMoneyMultiplier: 0.05, CrimeMoney: 0.5,
	CorporationValuation: 0.5, CorporationSoftcap: 0.75, CorporationDivisions: 0.8,
	GangSoftcap: 0.8, GangUniqueAugs: 0.25, FourSigmaMarketDataCost: 5,
	FourSigmaMarketDataApiCost: 4, WorldDaemonDifficulty: 2,
	HacknetNodeMoney: 1, CodingContractMoney: 1,
};

// The int-relevant singularity surface [SRC names]. typeof proves PRESENCE only — tombstones pass
// typeof and throw when called (the ns.formatNumber lesson). The delta labs do the calling.
const SING_API = [
	"universityCourse", "stopAction", "travelToCity", "goToLocation", "commitCrime",
	"joinFaction", "checkFactionInvitations", "purchaseAugmentation", "installAugmentations",
	"upgradeHomeRam", "upgradeHomeCores", "manualHack", "workForFaction", "createProgram",
	"getCrimeStats", "getCurrentWork",
];
const SLEEVE_API = ["getSleeve", "setToUniversityCourse", "setToCommitCrime", "setToIdle", "travel"];

// What the labs will mention, priced sight-unseen (strings — getFunctionRamCost is 0 GB).
const RAM_QUOTES = [
	"getPlayer", "getBitNodeMultipliers", "getResetInfo",
	"singularity.universityCourse", "singularity.stopAction", "singularity.travelToCity",
	"singularity.commitCrime", "singularity.joinFaction", "singularity.checkFactionInvitations",
	"singularity.purchaseAugmentation", "singularity.installAugmentations", "singularity.manualHack",
	"singularity.createProgram", "singularity.goToLocation", "singularity.getCrimeStats",
	"sleeve.getSleeve", "sleeve.setToUniversityCourse", "sleeve.setToCommitCrime",
	"sleeve.setToIdle", "sleeve.travel", "grafting.graftAugmentation", "share",
];

export async function main(ns) {
	const opts = ns.flags([["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun int-api.js\n\nRead-only probe for intelligence + BN5. Spends nothing, starts no action.\n");
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

	// ---- 1. Context: node, source files, and the player's intelligence right now ----
	safe("getResetInfo()  // expect currentNode 5; ownedSF should show 1/2/3/4/9 (+ -1 exploits?)", () => {
		const reset = ns.getResetInfo();
		const sf = reset.ownedSF instanceof Map ? Object.fromEntries(reset.ownedSF) : reset.ownedSF;
		return { currentNode: reset.currentNode, ownedSF: sf };
	});
	const player = safe("getPlayer() — the intelligence baseline every delta lab diffs against", () => {
		const pl = ns.getPlayer();
		return {
			city: pl.city, money: pl.money,
			intelligence: pl.skills?.intelligence, intelligenceExp: pl.exp?.intelligence,
			skills: pl.skills, exp: pl.exp,
			note: "In BN5 int gains with NO SF5 [SRC: bitNodeN===5 branch]. If intelligence is 0 and stays 0, that claim is dead.",
		};
	});
	flush();

	// ---- 2. The curve, checked against the game's own formulas ----
	// ns.formulas.* is 0 GB and Formulas.exe is free in BN5 [SRC: canAccessBitNodeFeature(5)].
	if (player && typeof player.intelligenceExp === "number") {
		safe("curve check — formulas.skills.calculateSkill(exp, 1) should equal the displayed level", () => {
			const fromExp = ns.formulas.skills.calculateSkill(player.intelligenceExp, 1);
			return {
				exp: player.intelligenceExp, displayedLevel: player.intelligence, calculatedLevel: fromExp,
				verdict: fromExp === player.intelligence ? "MATCH — curve is calculateSkill(exp, 1), as [SRC] says"
					: "!! MISMATCH — int uses a different mult/curve; bn5-design.md §curve is wrong",
			};
		});
		safe("XP still needed for milestones (calculateExp(level, 1) − current)", () => {
			const rows = {};
			for (const lvl of [25, 50, 75, 100, 150, 200, 250, 300]) {
				const need = ns.formulas.skills.calculateExp(lvl, 1) - player.intelligenceExp;
				if (need > 0) rows[`int ${lvl}`] = Math.ceil(need);
			}
			return rows;
		});
		safe("current bonus at each weight — local 1 + w·int^0.8/600 (no formulas fn exists for this)", () => {
			const rows = {};
			for (const [what, w] of [["darknet auth (SLOWS it)", 0.25], ["bladeburner", 0.75],
				["hack/rep/crime", 1], ["share()", 2], ["program creation", 3]]) {
				rows[`w=${w} ${what}`] = `x${intBonus(player.intelligence, w).toFixed(4)}`;
			}
			return rows;
		});
	}
	flush();

	// ---- 3. getBitNodeMultipliers — callable here, and does the tag tell the truth? ----
	safe("getBitNodeMultipliers() vs [SRC] BN5 table", () => diffMults(ns.getBitNodeMultipliers(), BN5_EXPECTED));
	safe("getBitNodeMultipliers(9) vs hacknet-design.md's BN9 table  // open question #5", () =>
		diffMults(ns.getBitNodeMultipliers(9), BN9_EXPECTED));
	flush();

	// ---- 4. Surface sweep: presence only (tombstones lie; the labs call) ----
	for (const [label, obj, expectedNames] of [
		["ns.singularity", ns.singularity, SING_API],
		["ns.sleeve", ns.sleeve, SLEEVE_API],
		["ns.grafting", ns.grafting, null],
		["ns.formulas.work", ns.formulas?.work, null],
		["ns.formulas.skills", ns.formulas?.skills, null],
		["ns.formulas.dnet", ns.formulas?.dnet, null],
	]) {
		const names = walk(obj);
		p(`\nALL ${label} properties (${names.length}):\n` +
			names.map((k) => `  ${k}: ${typeName(obj, k)}`).join("\n"));
		if (expectedNames) {
			const missing = expectedNames.filter((k) => !obj || typeof obj[k] !== "function");
			p(missing.length ? `!! MISSING from ${label}: ${missing.join(", ")}` :
				`all ${expectedNames.length} expected ${label} names present (presence only — tombstones pass typeof)`);
		}
	}
	flush();

	// ---- 5. The exact strings the labs will hardcode ----
	safe("ns.enums keys", () => Object.keys(ns.enums ?? {}));
	for (const key of ["CityName", "UniversityClassType", "CrimeType", "LocationName", "FactionWorkType"]) {
		safe(`ns.enums.${key}`, () => {
			const e = ns.enums?.[key];
			if (!e) return "(absent)";
			// LocationName is huge; only the university entries matter to the labs.
			if (key === "LocationName") {
				return Object.fromEntries(Object.entries(e).filter(([, v]) => /univ|institute/i.test(String(v))));
			}
			return e;
		});
	}
	flush();

	// ---- 6. RAM price list for the delta labs (strings — costs nothing to ask) ----
	safe("getFunctionRamCost for everything the labs plan to mention", () => {
		const rows = {};
		for (const name of RAM_QUOTES) {
			try { rows[name] = ns.getFunctionRamCost(name); } catch (e) { rows[name] = `ERROR ${e}`; }
		}
		return rows;
	});
	flush();

	ns.tprint(`${render(out)}\n\n(also written to ${DUMP_FILE} on home — \`cat ${DUMP_FILE}\` if this scrolled away)`);
}

/** [SRC: formulas/intelligence.ts] — replicated locally; the game exposes no formulas fn for it. */
function intBonus(intel, weight) { return 1 + (weight * Math.pow(intel || 0, 0.8)) / 600; }

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
	return `\n===== intelligence + BN5 API (3.0.1) — paste back =====\n${lines.join("\n")}\n===== END =====`;
}
