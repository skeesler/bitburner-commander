/**
 * bladeburner-scan.js — stage-2 probe: the FULL Bladeburner status snapshot, paid honestly.
 *
 * bladeburner-api.js (stage 1) proved the surface and the prices for free; this one pays the
 * 4 GB tolls for actual numbers: rank, stamina, per-city population/chaos, per-action success
 * intervals and rank rates, skill levels and costs. READ-ONLY: starts nothing, buys nothing,
 * switches nothing. Feeds bn6-design.md §7 and the conductor's design.
 *
 * RAM (~69.3 GB expected — measure with ram-costs.js): base 1.6 + getPlayer 0.5 +
 * getScriptRam 0.1 + getHostname 0.05 + getCurrentAction 1 + getNextBlackOp 2 + 16 four-GB getters (getRank, getSkillPoints,
 * getStamina, getCity, getCityChaos, getCityEstimatedPopulation, getCityCommunities,
 * getTeamSize, getActionEstimatedSuccessChance, getActionTime, getActionCountRemaining,
 * getActionCurrentLevel, getActionMaxLevel, getActionRankGain, getSkillLevel,
 * getSkillUpgradeCost) = 64. Repeat calls in loops are free — dynamic RAM bills each function
 * once. Home is 512 GB as of 2026-09-17, so plain `run bladeburner-scan.js` works; it runs
 * fine from a cloud box too if home is ever tight again. Output goes to YOUR terminal
 * wherever it runs; the dump file lands on the host it ran on. Paste the output back.
 *
 * ALSO SETTLES (for free): whether live ns.formulas.bladeburner has more than the one method
 * the v3.0.1 markdown admits to (skillMaxUpgradeCount) — bn6-design.md open question #1.
 *
 * Bare-name trap check: locals are p/flush/safe/show/render/walkNames/actionTable/mid/pen —
 * no collisions with any ns name.
 */

const DUMP_FILE = "bladeburner-scan-dump.txt";

export async function main(ns) {
	const opts = ns.flags([["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun bladeburner-scan.js\n\nRead-only Bladeburner status snapshot (~69 GB — run on a cloud box). Starts nothing.\n");
		return;
	}

	const out = [];
	const p = (s) => out.push(s);
	const flush = () => { try { ns.write(DUMP_FILE, render(out), "w"); } catch (e) { /* terminal has it */ } };
	const safe = (label, fn) => {
		try { const v = fn(); p(`\n${label}:\n${show(v)}`); return v; }
		catch (e) { p(`\n${label}: ERROR ${e}`); return undefined; }
	};
	const bb = ns.bladeburner;
	const types = ns.enums.BladeburnerActionType; // {General, Contract:"Contracts", Operation:"Operations", BlackOp:"Black Operations"}

	// ---- 0. Where and what this cost ----
	safe("this script", () => ({
		host: ns.getHostname(),
		staticRamGB: ns.getScriptRam(ns.getScriptName(), ns.getHostname()),
	}));
	flush();

	// ---- 1. formulas.bladeburner: does the live namespace beat the docs? (0 GB) ----
	safe("ns.formulas.bladeburner — docs admit only skillMaxUpgradeCount; the truth:", () => {
		const names = walkNames(ns.formulas?.bladeburner);
		return {
			names,
			verdict: names.filter((n) => typeof ns.formulas.bladeburner[n] === "function").length > 1
				? "MORE than documented — investigate each before the conductor is designed"
				: "docs told the truth: skill math only",
		};
	});
	flush();

	// ---- 2. The division right now ----
	safe("status", () => {
		const [stamCur, stamMax] = bb.getStamina();
		const pen = Math.min(1, stamCur / (0.5 * stamMax));
		return {
			rank: bb.getRank(),
			skillPointsUnspent: bb.getSkillPoints(),
			city: bb.getCity(),
			teamSize: bb.getTeamSize(),
			stamina: `${stamCur.toFixed(1)} / ${stamMax.toFixed(1)}`,
			staminaPenalty: `x${pen.toFixed(3)} on all success chances (the 50% cliff [SRC])`,
			currentAction: bb.getCurrentAction(),
			nextBlackOp: bb.getNextBlackOp(),
			bonusTimeMs: bb.getBonusTime(),
			playerHp: ns.getPlayer().hp,
			// v2 scoping: Recruitment and Diplomacy both run on charisma [SRC] — getPlayer is already paid for.
			playerSkills: ns.getPlayer().skills,
		};
	});
	flush();

	// ---- 3. Per-city: where should we be working? ----
	safe("cities — popEst drives the DISPLAYED chance, real pop drives the roll [SRC]", () => {
		const rows = {};
		for (const city of Object.values(ns.enums.CityName)) {
			rows[city] = {
				popEst: ns.format.number(bb.getCityEstimatedPopulation(city)),
				communities: bb.getCityCommunities(city),
				chaos: bb.getCityChaos(city),
			};
		}
		rows["--note"] = "competence x (pop/1e9)^0.7 — high pop = easier; chaos>50 multiplies difficulty by sqrt(1+chaos-50)";
		return rows;
	});
	flush();

	// ---- 4. Per-action: success intervals, times, rank rates ----
	// levelable=false for General and Black Operations: getActionCurrentLevel/getActionMaxLevel
	// THROW on those types ("not levelable") rather than returning anything [LIVE 2026-09-17].
	const actionTable = (typeLabel, names, levelable) => {
		const rows = {};
		for (const name of names) {
			try {
				const [lo, hi] = bb.getActionEstimatedSuccessChance(typeLabel, name);
				const timeMs = bb.getActionTime(typeLabel, name);
				const gain = bb.getActionRankGain(typeLabel, name);
				const mid = (lo + hi) / 2;
				rows[name] = {
					chance: `${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}%`,
					timeS: (timeMs / 1e3).toFixed(1),
					rankGain: gain.toFixed(2),
					rankPerMin: ((gain * mid) / (timeMs / 60e3)).toFixed(2),
				};
				if (levelable) {
					rows[name].level = `${bb.getActionCurrentLevel(typeLabel, name)}/${bb.getActionMaxLevel(typeLabel, name)}`;
					rows[name].remaining = bb.getActionCountRemaining(typeLabel, name);
				}
			} catch (e) { rows[name] = `ERROR ${e}`; }
		}
		return rows;
	};
	safe("contracts (money + rank)", () => actionTable(types.Contract, bb.getContractNames(), true));
	safe("operations (the rank engine)", () => actionTable(types.Operation, bb.getOperationNames(), true));
	safe("general actions", () => actionTable(types.General, bb.getGeneralActionNames(), false));
	safe("next black op (pop/chaos-immune, 1.5x time, min 1 team death [SRC])", () => {
		const nxt = bb.getNextBlackOp();
		return nxt ? { ...nxt, ...actionTable(types.BlackOp, [nxt.name], false) } : "(ladder complete?!)";
	});
	flush();

	// ---- 5. Skills: levels + next-level costs ----
	safe("skills — cost scales by costInc^level [SRC]; BladeburnerSkillCost 1.0 in BN6", () => {
		const rows = {};
		for (const name of bb.getSkillNames()) {
			rows[name] = { level: bb.getSkillLevel(name), nextCostSP: bb.getSkillUpgradeCost(name, 1) };
		}
		return rows;
	});
	flush();

	ns.tprint(`${render(out)}\n\n(also written to ${DUMP_FILE} on ${ns.getHostname()})`);
}

/** Own + inherited property names, sorted. */
function walkNames(obj) {
	const seen = new Set();
	try {
		for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
			for (const k of Object.getOwnPropertyNames(o)) if (k !== "constructor") seen.add(k);
		}
	} catch (e) { /* a throwing prototype shouldn't cost the whole dump */ }
	return [...seen].sort();
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
	return `\n===== Bladeburner status scan (3.0.1, BN6) — paste back =====\n${lines.join("\n")}\n===== END =====`;
}
