/**
 * int-delta.js — the PLAYER-action intelligence lab: measure real int-XP deltas, one experiment
 * at a time. hacknet-spend.js's discipline applied to intelligence: never trust a table (not even
 * bn5-design.md's) — measure the before/after and solve the multiplier from what actually happened.
 *
 *   run int-delta.js                     # dry: show the plan + expected numbers, do nothing
 *   run int-delta.js --travel --go       # round trip to Aevum and back ($400k)
 *                                        #   expect +0.00006 int XP exactly [SRC: 1.5/50000 x2]
 *   run int-delta.js --class --go        # 60s of Computer Science at this city's university
 *   run int-delta.js --class --seconds 120 --go
 *                                        #   expect 0.01/s x expMult (Rothman x2, Summit x3, ZB x4)
 *                                        #   x hash Improve-Studying mult, possibly x0.8 unfocused
 *                                        #   — the SOLVED factor tells us which story is true
 *   run int-delta.js --crime --go        # one "Rob Store" (60s); int pays ONLY on success
 *   run int-delta.js --crime --crime-name "Kidnap" --go
 *
 * CONTAMINATION WARNING: the measurement is getPlayer().exp.intelligence before/after, so ANYTHING
 * else granting int XP during the window (ascend.js buying an aug! a sleeve mirroring class XP!)
 * poisons the delta. The script lists what's running on home and refuses --go if ascend.js is up.
 *
 * Experiments change what your character is DOING (travel, study, crime) — they end with
 * stopAction, but whatever you were doing before is not resumed. Run between activities.
 *
 * RAM (~12.3 GB expected): base 1.6 + getPlayer 0.5 + travelToCity 2 + universityCourse 2 +
 * stopAction 1 + commitCrime 5 + ps 0.2. int-api.js §6 quotes the real prices — check them first,
 * and measure THIS file with ram-costs.js before trusting the number above (the bare-name trap
 * caught hacknet-spend.js in exactly this way; locals here are chosen not to collide).
 *
 * Results append to int-delta-dump.txt (flushed per experiment) — paste back.
 */

const DUMP_FILE = "int-delta-dump.txt";
// [SRC: LocationsMetadata.ts] city -> [LocationName enum KEY, expMult]. Values resolved from
// ns.enums at runtime so a renamed string shows up as a loud skip, not a wrong call.
const UNIVERSITIES = {
	"Sector-12": ["Sector12RothmanUniversity", 2],
	"Aevum": ["AevumSummitUniversity", 3],
	"Volhaven": ["VolhavenZBInstituteOfTechnology", 4],
};
// [SRC: Crimes.ts] intelligence_exp x IntelligenceCrimeBaseExpGain(0.05), success only.
const CRIME_INT = { "Rob Store": 0.375, "Larceny": 0.75, "Grand Theft Auto": 0.8, "Kidnap": 1.3,
	"Bond Forgery": 3.0, "Assassination": 3.25, "Heist": 6.5 };

export async function main(ns) {
	ns.disableLog("ALL");
	const opts = ns.flags([
		["travel", false], ["class", false], ["crime", false],
		["seconds", 60], ["crime-name", "Rob Store"],
		["go", false], ["help", false],
	]);
	if (opts.help || (!opts.travel && !opts.class && !opts.crime)) {
		ns.tprint("\nrun int-delta.js [--travel] [--class [--seconds N]] [--crime [--crime-name NAME]] --go\n" +
			"\n  Measures real int-XP deltas for player actions. Without --go it only narrates the plan." +
			"\n  One experiment type per run keeps the deltas attributable.\n");
		return;
	}

	const out = [];
	const p = (s) => { out.push(s); ns.print(s); };
	const flush = () => { try { ns.write(DUMP_FILE, out.join("\n") + "\n", "a"); } catch (e) { /* log has it */ } };
	const readInt = () => { const pl = ns.getPlayer(); return { exp: pl.exp.intelligence, lvl: pl.skills.intelligence, money: pl.money, city: pl.city }; };

	// Contamination check: anything on home that could grant int XP mid-window.
	const runningHere = ns.ps("home").map((proc) => proc.filename);
	const dirty = runningHere.filter((f) => /ascend|sleeve/.test(f));
	p(`\n===== int-delta ${new Date().toISOString()} ${opts.go ? "" : "(DRY)"} =====`);
	if (dirty.length) {
		p(`!! ${dirty.join(", ")} running on home — these grant int XP and will poison the delta.`);
		if (opts.go) { p("Refusing --go. Kill them (or wait), then re-run."); flush(); ns.tprint(out.join("\n")); return; }
	}

	const before = readInt();
	p(`baseline: int ${before.lvl}, exp ${before.exp} — ${before.city}, ${fmt(ns, before.money)}`);

	// ---- travel: the cleanest possible unit test (flat 0.00003 per hop, no mults anywhere) ----
	if (opts.travel) {
		const dest = before.city === "Aevum" ? "Sector-12" : "Aevum";
		p(`\n[travel] round trip ${before.city} -> ${dest} -> ${before.city}, $400k. Expected: +0.00006 int XP exactly.`);
		if (opts.go) {
			if (before.money < 400e3) { p("not enough money — need $400k."); }
			else {
				const ok1 = call(p, "travelToCity(dest)", () => ns.singularity.travelToCity(dest));
				const ok2 = call(p, "travelToCity(back)", () => ns.singularity.travelToCity(before.city));
				const after = readInt();
				report(p, "travel", after.exp - before.exp, (ok1 + ok2) * 0.00003,
					"flat 1.5/50000 per hop, no multipliers [SRC]");
			}
		}
		flush();
	}

	// ---- class: solves the study multiplier the way hacknet-scan solves the hash multiplier ----
	if (opts.class) {
		const uni = UNIVERSITIES[before.city];
		if (!uni) {
			p(`\n[class] ${before.city} has no university (only Sector-12 / Aevum / Volhaven). Travel first.`);
		} else {
			const [enumKey, expMult] = uni;
			const uniName = ns.enums?.LocationName?.[enumKey];
			const courses = ns.enums?.UniversityClassType ?? {};
			const csName = Object.values(courses).find((v) => /computer\s*science/i.test(String(v)))
				?? "Computer Science";
			const secs = Math.max(10, Number(opts.seconds) || 60);
			p(`\n[class] "${csName}" at "${uniName}" (expMult x${expMult} [SRC]) for ${secs}s, unfocused.` +
				`\n  base 0.01 int XP/s -> candidates: x${expMult} (plain), x${(expMult * 0.8).toFixed(1)} ` +
				`(0.8 unfocused penalty), higher if hash Improve-Studying was ever bought this node.` +
				`\n  The SOLVED factor picks the story; hacking exp is also measured (mult-contaminated).`);
			if (opts.go && uniName) {
				const hackBefore = ns.getPlayer().exp.hacking;
				if (call(p, "universityCourse", () => ns.singularity.universityCourse(uniName, csName, false))) {
					await ns.sleep(secs * 1000);
					call(p, "stopAction", () => ns.singularity.stopAction());
					const after = readInt();
					const gained = after.exp - before.exp;
					report(p, "class", gained, 0.01 * secs * expMult, "0.01/s x expMult, no focus penalty");
					p(`  solved factor: x${(gained / (0.01 * secs)).toFixed(3)} against candidates ` +
						`${expMult} / ${(expMult * 0.8).toFixed(1)}`);
					p(`  hacking exp delta (for reference): +${(ns.getPlayer().exp.hacking - hackBefore).toFixed(2)}`);
				}
			} else if (opts.go) p(`!! enums.LocationName.${enumKey} is absent — run int-api.js §5 and fix the map.`);
		}
		flush();
	}

	// ---- crime: int pays on success ONLY [SRC: CrimeWork.ts success branch] ----
	if (opts.crime) {
		const crimeName = String(opts["crime-name"]);
		const perSuccess = CRIME_INT[crimeName];
		p(`\n[crime] one "${crimeName}", unfocused. Expected on SUCCESS: +${perSuccess ?? "?? (not in table — 0 for " +
			"shoplift/mug/drugs/arms/homicide)"} int XP (x0.8 if the focus penalty applies); on failure: exactly 0.` +
			`\n  A zero delta is EVIDENCE (failure or no-int crime), not a broken script.`);
		if (opts.go) {
			const t = call(p, "commitCrime", () => ns.singularity.commitCrime(crimeName, false));
			const waitMs = (typeof t === "number" && t > 0 ? t : 60e3) + 2000;
			p(`  crime time reported: ${typeof t === "number" ? (t / 1000).toFixed(1) + "s" : String(t)} — waiting ${(waitMs / 1000).toFixed(0)}s`);
			await ns.sleep(waitMs);
			call(p, "stopAction", () => ns.singularity.stopAction());
			const after = readInt();
			report(p, "crime", after.exp - before.exp, perSuccess ?? 0, "per-crime intelligence_exp x 0.05, success only");
			p(`  money delta: ${fmt(ns, after.money - before.money)} (crime pays 0.5x here [SRC: CrimeMoney])`);
		}
		flush();
	}

	p(`\n(appended to ${DUMP_FILE})`);
	ns.tprint(out.join("\n"));
}

/** Run one API call, narrating success/failure — a thrown "removed in version X" IS the evidence. */
function call(p, label, fn) {
	try { const v = fn(); p(`  ${label}: ok${v !== undefined && typeof v !== "boolean" ? ` -> ${v}` : v === false ? " -> FALSE" : ""}`); return v === undefined ? true : v; }
	catch (e) { p(`  ${label}: THREW ${e}`); return false; }
}

function report(p, tag, observed, expected, basis) {
	const match = expected > 0 && Math.abs(observed - expected) / expected < 0.02;
	p(`  [${tag}] int XP observed: +${observed} | expected: +${expected} (${basis})` +
		`\n  ${match ? "MATCH — promote to [LIVE]" : observed === 0 ? "ZERO — failed action, wrong gate, or the claim is dead"
			: "DIFFERENT — solve for the missing factor and update bn5-design.md"}`);
}

function fmt(ns, n) {
	const sign = n < 0 ? "-$" : "$";
	try { return sign + ns.format.number(Math.abs(n), 2); } catch (e) { return sign + Math.abs(n).toFixed(0); }
}
