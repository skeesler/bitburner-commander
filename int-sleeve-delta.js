/**
 * int-sleeve-delta.js — the SLEEVE-MIRROR intelligence lab (bn5-design.md open question #3).
 *
 * The claim to test [SRC: Sleeve/Work/Work.ts applySleeveGains]: a working sleeve's int XP is
 * mirrored to the player at x(sync/100) and to every OTHER sleeve at x(sync/100 x theirShock).
 * If true, eight sleeves in a classroom are the steady-state int farm (~1,300 XP/hr at full sync)
 * and sleeve-manager.js grows a university mode. If false, that plan dies here, cheaply.
 *
 *   run int-sleeve-delta.js                          # dry: sleeve roster + the plan, change nothing
 *   run int-sleeve-delta.js --go                     # sleeve 0 studies CS for 60s, deltas measured
 *   run int-sleeve-delta.js --sleeve-n 2 --seconds 120 --go
 *
 * The sleeve is LEFT STUDYING afterward, on purpose — if the mirror is real, stopping it would be
 * turning off the very farm we just proved. Reassign it in the Sleeves UI (or sleeve-manager.js)
 * if you want it back on crime/work. The PLAYER's action is never touched.
 *
 * CONTAMINATION: the player-side delta is poisoned by any other int source in the window — don't
 * run while ascend.js is buying augs, while you're in class, or while int-delta.js is mid-run.
 * (Other sleeves keep doing what they were doing; if one is on crime/class already, its mirror
 * contaminates too — the roster printout shows what each is doing so you can judge.)
 *
 * RAM (~10.3 GB expected): base 1.6 + getPlayer 0.5 + sleeve.getSleeve 4 + setToUniversityCourse 4
 * + ps 0.2. No sleeve.travel and no setToIdle — each is 4 GB of mention for a job the UI does free.
 * If the chosen sleeve is in a city without a university, move it in the UI and re-run.
 * Measure with ram-costs.js before trusting this header (the bare-name trap).
 *
 * Results append to int-sleeve-dump.txt — paste back.
 */

const DUMP_FILE = "int-sleeve-dump.txt";
// [SRC: LocationsMetadata.ts] — same map as int-delta.js.
const UNIVERSITIES = {
	"Sector-12": ["Sector12RothmanUniversity", 2],
	"Aevum": ["AevumSummitUniversity", 3],
	"Volhaven": ["VolhavenZBInstituteOfTechnology", 4],
};

export async function main(ns) {
	ns.disableLog("ALL");
	const opts = ns.flags([["sleeve-n", 0], ["seconds", 60], ["go", false], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun int-sleeve-delta.js [--sleeve-n N] [--seconds S] --go\n" +
			"\n  Puts one sleeve in a Computer Science class and measures whether its int XP mirrors\n" +
			"  to the player (x sync/100) and to the other sleeves. Dry without --go.\n");
		return;
	}

	const out = [];
	const p = (s) => { out.push(s); ns.print(s); };
	const flush = () => { try { ns.write(DUMP_FILE, out.join("\n") + "\n", "a"); } catch (e) { /* log has it */ } };

	p(`\n===== int-sleeve-delta ${new Date().toISOString()} ${opts.go ? "" : "(DRY)"} =====`);

	// Roster via getSleeve(i) until it throws — saves mentioning getNumSleeves (4 GB for a count).
	const roster = [];
	for (let i = 0; i < 8; i++) {
		try { roster.push(ns.sleeve.getSleeve(i)); } catch (e) { break; }
	}
	if (!roster.length) { p("no sleeves — this lab needs at least one (SF10 or BN10)."); flush(); ns.tprint(out.join("\n")); return; }

	p(`sleeves: ${roster.length}`);
	roster.forEach((s, i) => p(`  #${i} ${s.city} shock ${num(s.shock)} sync ${num(s.sync)} ` +
		`int ${s.skills?.intelligence} (exp ${num(s.exp?.intelligence)})`));

	const n = Number(opts["sleeve-n"]) || 0;
	const target = roster[n];
	if (!target) { p(`no sleeve #${n}.`); flush(); ns.tprint(out.join("\n")); return; }

	const uni = UNIVERSITIES[target.city];
	if (!uni) {
		p(`sleeve #${n} is in ${target.city} — no university there. Move it (Sleeves UI) to ` +
			`Sector-12 / Aevum / Volhaven and re-run.`);
		flush(); ns.tprint(out.join("\n")); return;
	}
	const [enumKey, expMult] = uni;
	const uniName = ns.enums?.LocationName?.[enumKey];
	const courses = ns.enums?.UniversityClassType ?? {};
	const csName = Object.values(courses).find((v) => /computer\s*science/i.test(String(v))) ?? "Computer Science";
	const secs = Math.max(10, Number(opts.seconds) || 60);
	const other = roster.length > 1 ? (n === 0 ? 1 : 0) : -1;

	p(`\nplan: sleeve #${n} takes "${csName}" at "${uniName}" (x${expMult} [SRC]) for ${secs}s.` +
		`\n  expected sleeve gain  ~ 0.01/s x ${expMult} x shockBonus(${((100 - target.shock) / 100).toFixed(2)})` +
		`\n  expected player gain  = sleeve gain x sync/100 (${(target.sync / 100).toFixed(2)}) — THE claim under test` +
		(other >= 0 ? `\n  expected sleeve #${other} gain = sleeve gain x sync/100 x itsShockBonus` : "") +
		`\n  A player/sleeve ratio near ${(target.sync / 100).toFixed(2)} = MATCH; near zero = the mirror is a myth.`);

	if (!opts.go) { p("\n(dry — pass --go to run it)"); flush(); ns.tprint(out.join("\n")); return; }
	if (!uniName) { p(`!! enums.LocationName.${enumKey} absent — run int-api.js §5 and fix the map.`); flush(); ns.tprint(out.join("\n")); return; }

	const pB = ns.getPlayer().exp.intelligence;
	const sB = target.exp?.intelligence ?? 0;
	const oB = other >= 0 ? roster[other].exp?.intelligence ?? 0 : 0;
	try {
		ns.sleeve.setToUniversityCourse(n, uniName, csName);
		p(`\nsetToUniversityCourse: ok — measuring for ${secs}s...`);
	} catch (e) { p(`\nsetToUniversityCourse THREW ${e} — that error is the finding; paste it back.`); flush(); ns.tprint(out.join("\n")); return; }
	await ns.sleep(secs * 1000);

	const pA = ns.getPlayer().exp.intelligence;
	let sA = sB, oA = oB;
	try { sA = ns.sleeve.getSleeve(n).exp?.intelligence ?? sB; } catch (e) { p(`re-read sleeve #${n} THREW ${e}`); }
	if (other >= 0) { try { oA = ns.sleeve.getSleeve(other).exp?.intelligence ?? oB; } catch (e) { /* reported above if it throws */ } }

	const sleeveGain = sA - sB, playerGain = pA - pB, otherGain = other >= 0 ? oA - oB : 0;
	p(`\nresults over ${secs}s:` +
		`\n  sleeve #${n}: +${num(sleeveGain)} (expected ~${num(0.01 * secs * expMult * (100 - target.shock) / 100)})` +
		`\n  player:     +${num(playerGain)}  -> ratio ${sleeveGain > 0 ? num(playerGain / sleeveGain) : "n/a"} vs sync/100 = ${(target.sync / 100).toFixed(3)}` +
		(other >= 0 ? `\n  sleeve #${other}: +${num(otherGain)}  -> ratio ${sleeveGain > 0 ? num(otherGain / sleeveGain) : "n/a"}` : ""));
	p(sleeveGain <= 0
		? "!! the working sleeve itself gained nothing — wrong course/uni strings, or sleeve int doesn't gain; paste back."
		: playerGain > 0 && Math.abs(playerGain / sleeveGain - target.sync / 100) < 0.1
			? "MIRROR CONFIRMED — promote to [LIVE]; the sleeve university farm is real. Sleeve left studying."
			: "mirror ratio off-model — record the numbers in bn5-design.md and rethink. Sleeve left studying.");

	flush();
	ns.tprint(out.join("\n") + `\n\n(appended to ${DUMP_FILE})`);
}

function num(v) { return Number.isFinite(v) ? +v.toFixed(6) : String(v); }
