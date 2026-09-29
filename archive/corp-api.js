/**
 * corp-api.js — THROWAWAY: dump the REAL ns.corporation surface + live shapes in THIS game (3.0.1).
 *
 * Same discipline as gang-api.js and dnet-api.js: we design against the running game, not against
 * docs. The v3.0.1 release tag and the dev branch agree on a 63-method Corporation API (27 core +
 * 23 WarehouseAPI + 13 OfficeAPI), so this one is EXPECTED to come back clean — but "expected" is
 * exactly what ns.dnet.freezeServer taught us not to trust. Confirm, then build.
 *
 * SCOPE — this file probes only what is FREE to call. Read the RAM note before extending it.
 *
 * Every ns.corporation.* function is charged 10GB (info) or 20GB (action) just for being MENTIONED.
 * This probe uses bracket access (`c[name](...)`), which the STATIC RAM walker can't see — but that
 * is NOT a loophole. The runtime enforces a second budget: updateDynamicRam
 * (NetscriptHelpers.tsx:434-458) adds each function's real cost the first time it is actually
 * CALLED, and kills the script with "Dynamic RAM usage calculated to be greater than RAM
 * allocation" as soon as the total passes what was statically allocated.
 *
 * So dynamic dispatch buys us exactly one thing: the ability to call the 0-cost functions
 * (hasCorporation, canCreateCorporation, getConstants, getBonusTime, nextUpdate) and to TYPEOF-probe
 * every other name without paying for it. typeof is a property read, not a call, so it is free —
 * which is what makes the 63-method surface check possible in 2.6GB.
 *
 * Anything that actually CALLS a charged getter (getCorporation, getDivision, getIndustryData,
 * getOffice, …) must live in a separate script that honestly pays for it. See corp-api-live.js.
 *
 * Related trap, worth knowing repo-wide: the RAM walker resolves every identifier it collects
 * against the WHOLE RamCosts tree BY BARE NAME, namespace ignored. So a local helper or property
 * named `probe` bills you ns.dnet.probe, and one named `research` bills you 20GB for
 * ns.corporation.research — even though you never touched either namespace. This file originally
 * had a helper called `probe`; it's `grab` now for exactly that reason. Name locals accordingly,
 * especially in the darknet crawler, which is already on a knife-edge against 16GB nodes.
 *
 *   run corp-api.js            # everything: surface, context, constants, data tables, live shapes
 *   run corp-api.js --brief    # skip the bulky industry/material constant tables
 *
 * Sections 1-4 work with NO corporation. Sections 5-6 need one — nearly every getter (including
 * getIndustryData/getMaterialData) calls an internal checkAccess that throws "Must own a
 * corporation." getConstants() is the exception: free, no corp needed.
 *
 * RFA sync is one-way (disk -> game), so the dump can't come back on its own. It's printed to the
 * terminal AND written to corp-api-dump.txt on home — paste the terminal output back, or
 * `cat corp-api-dump.txt` if the tail scrolled away. Delete this file once we've built against it.
 */

const DUMP_FILE = "corp-api-dump.txt";

// The 63 methods v3.0.1 claims, grouped by interface. "undefined" in the probe = not in this build.
const CORE = [
	"acceptInvestmentOffer", "bribe", "buyBackShares", "canCreateCorporation", "createCorporation",
	"expandCity", "expandIndustry", "getBonusTime", "getConstants", "getCorporation",
	"getDivision", "getIndustryData", "getInvestmentOffer", "getMaterialData", "getUnlockCost",
	"getUpgradeLevel", "getUpgradeLevelCost", "goPublic", "hasCorporation", "hasUnlock",
	"issueDividends", "issueNewShares", "levelUpgrade", "nextUpdate", "purchaseUnlock",
	"sellDivision", "sellShares",
];
const WAREHOUSE = [
	"bulkPurchase", "buyMaterial", "cancelExportMaterial", "discontinueProduct", "exportMaterial",
	"getMaterial", "getProduct", "getUpgradeWarehouseCost", "getWarehouse", "hasWarehouse",
	"limitMaterialProduction", "limitProductProduction", "makeProduct", "purchaseWarehouse",
	"sellMaterial", "sellProduct", "setMaterialMarketTA1", "setMaterialMarketTA2",
	"setProductMarketTA1", "setProductMarketTA2", "setSmartSupply", "setSmartSupplyOption",
	"upgradeWarehouse",
];
const OFFICE = [
	"buyTea", "getHireAdVertCost", "getHireAdVertCount", "getOffice", "getOfficeSizeUpgradeCost",
	"getResearchCost", "hasResearched", "hireAdVert", "hireEmployee", "research",
	"setJobAssignment", "throwParty", "upgradeOfficeSize",
];

// Industries worth pinning down: the Agriculture -> Chemical -> Tobacco chain we plan to run,
// plus Restaurant (the cheap dummy-division industry) and Pharmaceutical (the runner-up product
// industry) for comparison. The published factor tables are slightly stale — e.g. the docs give
// Tobacco robotFactor 0.25 while v3.0.1 source says 0.2 — so we read them from the game.
const INDUSTRIES = ["Agriculture", "Chemical", "Tobacco", "Restaurant", "Pharmaceutical"];

export async function main(ns) {
	const opts = ns.flags([["brief", false], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun corp-api.js [--brief]\n  --brief  skip the industry/material constant tables\n");
		return;
	}

	const c = ns.corporation; // bare namespace reference — costs nothing, see RAM WARNING above
	const out = [];
	const p = (s) => out.push(s);

	/** Call a corp function BY NAME (never statically) and pretty-print whatever comes back. */
	const grab = (label, name, ...args) => {
		try {
			const fn = c[name];
			if (typeof fn !== "function") { p(`\n${label}: NOT A FUNCTION (typeof ${typeof fn})`); return undefined; }
			const v = fn.call(c, ...args);
			p(`\n${label}:\n${show(v)}`);
			return v;
		} catch (e) {
			p(`\n${label}: ERROR ${e}`);
			return undefined;
		}
	};

	// ---- 1. Every own + inherited property (ns.corporation may be a class instance) ----
	const seen = new Set();
	try {
		for (let o = c; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
			for (const k of Object.getOwnPropertyNames(o)) if (k !== "constructor") seen.add(k);
		}
	} catch (e) { p(`property walk failed: ${e}`); }
	const all = [...seen].sort().map((k) => {
		let t;
		try { t = typeof c[k]; } catch (e) { t = "?"; }
		return `  ${k}: ${t}`;
	});
	p(`ALL ns.corporation properties (${seen.size}):\n${all.join("\n")}`);

	// ---- 2. Explicit typeof probe of the 63 methods v3.0.1 documents ----
	const group = (title, names) => {
		const missing = names.filter((k) => typeof c[k] !== "function");
		p(`\n${title} (${names.length} expected, ${missing.length} MISSING):\n` +
			names.map((k) => `  ${k}: ${typeof c[k]}`).join("\n"));
		return missing;
	};
	const missing = [
		...group("Corporation (core)", CORE),
		...group("WarehouseAPI", WAREHOUSE),
		...group("OfficeAPI", OFFICE),
	];
	// Anything the game exposes that the docs never mentioned — this is how we found gang's
	// getOtherGangInformation, a method the dev docs didn't list.
	const documented = new Set([...CORE, ...WAREHOUSE, ...OFFICE]);
	const extra = [...seen].filter((k) => !documented.has(k) && typeof safeType(c, k) === "function");
	p(`\nUNDOCUMENTED methods present in this build (${extra.length}):\n` +
		(extra.length ? extra.map((k) => `  ${k}`).join("\n") : "  (none)"));

	// ---- 3. BitNode context — are we actually in BN3, and what does SF3 say? ----
	try {
		const reset = ns.getResetInfo();
		const sf = reset.ownedSF instanceof Map ? Object.fromEntries(reset.ownedSF) : reset.ownedSF;
		p(`\nBitNode context:\n  currentNode: ${reset.currentNode}\n  ownedSF: ${show(sf)}`);
	} catch (e) { p(`\nBitNode context: ERROR ${e}`); }

	// hasCorporation / canCreateCorporation cost 0 RAM and need no corporation.
	// canCreateCorporation returns a reason string, not a boolean: Success | NoSf3OrDisabled |
	// CorporationExists | UseSeedMoneyOutsideBN3 | DisabledBySoftCap.
	const has = grab("hasCorporation()", "hasCorporation");
	grab("canCreateCorporation(selfFund=true)", "canCreateCorporation", true);
	grab("canCreateCorporation(selfFund=false)  // seed money, BN3 only", "canCreateCorporation", false);

	// ---- 4. getConstants() — free, no corp required. Source of every valid name string. ----
	const K = grab("getConstants()", "getConstants");

	// ---- Sections 5 & 6 deliberately REMOVED ----
	// They used to call getIndustryData / getCorporation / getOffice / getMaterial etc. through the
	// same bracket-access trick. That was a bug: bracket access only hides a call from the STATIC RAM
	// walker. The runtime's updateDynamicRam still bills each function on first CALL and kills the
	// script the moment the running total exceeds this script's 2.6GB allocation. With no corporation
	// the code never got that far, which is the only reason the first run looked clean.
	//
	// Live shapes therefore live in corp-api-live.js, which pays honest static RAM for its getters.
	p(has
		? "\n(corporation detected — live shapes are NOT dumped here. Calling a charged getter from this " +
		  "2.6GB script would trip the runtime dynamic-RAM check and kill it mid-run. Run corp-api-live.js.)"
		: "\n(no corporation yet. Everything above is free to call; the charged getters — getCorporation, " +
		  "getIndustryData, getOffice, … — need both a corporation AND a script that pays for them. " +
		  "Create the corp, then run corp-api-live.js.)");

	// ---- Report ----
	const banner = missing.length
		? `!! ${missing.length} DOCUMENTED METHOD(S) MISSING FROM THIS BUILD: ${missing.join(", ")}`
		: `all 63 documented methods present.`;
	const body = `\n===== ns.corporation API + live shapes (3.0.1) — paste back =====\n` +
		`${banner}\n\n${out.join("\n")}\n===== END =====`;

	try {
		ns.write(DUMP_FILE, body, "w");
		ns.tprint(`${body}\n\n(also written to ${DUMP_FILE} on home — \`cat ${DUMP_FILE}\` if this scrolled away)`);
	} catch (e) {
		ns.tprint(`${body}\n\n(could not write ${DUMP_FILE}: ${e})`);
	}
}

/** typeof a property without letting a throwing getter kill the walk. */
function safeType(obj, key) {
	try { return obj[key]; } catch (e) { return undefined; }
}

/** Call by name, swallowing failures — used where we want a value, not a printed section. */
function tryCall(obj, name, ...args) {
	try {
		const fn = obj[name];
		return typeof fn === "function" ? fn.call(obj, ...args) : undefined;
	} catch (e) { return undefined; }
}

/** JSON that survives undefined, Maps, and the odd circular reference. */
function show(v) {
	if (v === undefined) return "undefined";
	try {
		return JSON.stringify(v, (_k, val) => (val instanceof Map ? Object.fromEntries(val) : val), 2);
	} catch (e) {
		return String(v);
	}
}
