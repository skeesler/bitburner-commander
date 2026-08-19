/**
 * gang-api.js — THROWAWAY: dump the REAL ns.gang surface in THIS game (3.0.x).
 *
 * Same discipline as dnet-api.js: the dev-branch markdown lists a 26-method Gang API, but that
 * doc runs AHEAD of the released game (freezeServer taught us that lesson). Before we design
 * gang-manager.js we confirm what's actually callable AND what the live data shapes are.
 *
 * Run this on `home` with a gang already created (your Tetrads). It prints:
 *   1. every ns.gang.* property + its typeof
 *   2. a typeof-probe of the 26 methods we expect ("undefined" = not in this version)
 *   3. live shapes — task names, equipment names, getGangInformation(), one full member,
 *      and a sample getTaskStats/getEquipmentStats so we see field names, not guesses.
 * Paste the output back and we'll build against reality. Delete after.
 *
 *   run gang-api.js
 */
export async function main(ns) {
	const g = ns.gang;
	const out = [];
	const p = (s) => out.push(s);

	// ---- 1. Every own + inherited property name (ns.gang may be a class instance) ----
	const seen = new Set();
	for (let o = g; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
		for (const k of Object.getOwnPropertyNames(o)) if (k !== "constructor") seen.add(k);
	}
	const all = [...seen].sort().map((k) => {
		let t;
		try {
			t = typeof g[k];
		} catch (e) {
			t = "?";
		}
		return `  ${k}: ${t}`;
	});
	p(`ALL ns.gang properties (${seen.size}):\n${all.join("\n")}`);

	// ---- 2. Explicitly probe the 26 methods the dev docs claim (typeof; missing → "undefined") ----
	const want = [
		"ascendMember", "canRecruitMember", "createGang", "getAllGangInformation",
		"getAscensionResult", "getBonusTime", "getChanceToWinClash", "getEquipmentCost",
		"getEquipmentNames", "getEquipmentStats", "getEquipmentType", "getGangInformation",
		"getInstallResult", "getMemberInformation", "getMemberNames", "getRecruitsAvailable",
		"getTaskNames", "getTaskStats", "inGang", "nextUpdate", "purchaseEquipment",
		"recruitMember", "renameMember", "respectForNextRecruit", "setMemberTask",
		"setTerritoryWarfare",
	];
	p(`\nEXPECTED methods (typeof; "undefined" = not in this version):\n` +
		want.map((k) => `  ${k}: ${typeof g[k]}`).join("\n"));

	// ---- 3. Live shapes — everything below is best-effort, guarded so one failure doesn't abort ----
	const safe = (label, fn) => {
		try {
			const v = fn();
			p(`\n${label}:\n${JSON.stringify(v, null, 2)}`);
			return v;
		} catch (e) {
			p(`\n${label}: ERROR ${e}`);
			return undefined;
		}
	};

	// inGang() works WITHOUT API access — the guard for everything else.
	const inGang = safe("inGang()", () => g.inGang());
	if (inGang) {
		const tasks = safe("getTaskNames()", () => g.getTaskNames());
		const equip = safe("getEquipmentNames()", () => g.getEquipmentNames());
		safe("getGangInformation()", () => g.getGangInformation());
		safe("getRecruitsAvailable()", () => g.getRecruitsAvailable());
		safe("respectForNextRecruit()", () => g.respectForNextRecruit());
		safe("getBonusTime()", () => g.getBonusTime());

		const names = safe("getMemberNames()", () => g.getMemberNames());
		if (Array.isArray(names) && names.length) {
			safe(`getMemberInformation(${JSON.stringify(names[0])})`, () => g.getMemberInformation(names[0]));
			safe(`getAscensionResult(${JSON.stringify(names[0])})`, () => g.getAscensionResult(names[0]));
		} else {
			p("\n(no members yet — recruit one in-game to capture getMemberInformation shape)");
		}

		// Sample one task + one equipment stat block so we learn the field names.
		if (Array.isArray(tasks) && tasks.length) {
			const sample = tasks[tasks.length - 1]; // last is usually a "real" crime, not "Unassigned"
			safe(`getTaskStats(${JSON.stringify(sample)})`, () => g.getTaskStats(sample));
		}
		if (Array.isArray(equip) && equip.length) {
			safe(`getEquipmentStats(${JSON.stringify(equip[0])})`, () => g.getEquipmentStats(equip[0]));
			safe(`getEquipmentType(${JSON.stringify(equip[0])})`, () => g.getEquipmentType(equip[0]));
			safe(`getEquipmentCost(${JSON.stringify(equip[0])})`, () => g.getEquipmentCost(equip[0]));
		}
	}

	ns.tprint(`\n===== ns.gang API + live shapes (3.0.x) — paste back =====\n${out.join("\n")}\n===== END =====`);
}
