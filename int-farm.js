/**
 * int-farm.js — the intelligence farm: create b1t_flum3.exe, delete it, create it again, forever.
 *
 * WHY THIS WORKS [LIVE 2026-09-08, Sara's discovery]: program creation pays 0.1 int XP per second
 * WORKED, on completion [SRC: CreateProgramWork, IntelligenceProgramBaseExpGain 0.1] — and
 * deleting + recreating b1t_flum3.exe grants it again. b1t_flum3 is the one program that's pure
 * junk as a FILE (create.level 1, base time 15s [SRC: Programs.ts]), so rm-ing it costs nothing.
 * ~360 XP/hr, the best steady-state int source available without sleeves (no SF10 this run).
 *
 *   run int-farm.js                          # farm unfocused (recommended), report as it goes
 *   run int-farm.js --program DeepscanV1.exe # farm a longer program (better rate — see below)
 *   run int-farm.js --focus                  # focused: faster cycles, same XP/hr, steals screen
 *
 * CALIBRATION [LIVE 2026-09-08]: b1t_flum3 at hacking ~300 measured 304 XP/hr — each creation is
 * exactly 2 game cycles (0.04 XP / 400ms worked), and the gap to 360 was pure loop overhead (the
 * old 250ms completion poll). The poll is now 50ms, but the real lever is --program: a program
 * with a LONGER base time amortizes the overhead away (DeepscanV1.exe, base 15 min, cycles in
 * ~15-20s at hacking 300 → ~358 XP/hr). b1t_flum3's cycles also SHRINK as hacking grows (speed
 * scales with hacking/create.level, and its level is 1), so its rate degrades over the run —
 * when the s/cycle readout approaches the poll floor, switch to a bigger program. The trade: the
 * farm rm's its program every cycle, so farm one you can live without while it runs (DeepscanV1
 * is $500k to re-buy; b1t_flum3 is free junk and stays the safe default).
 *
 * UNFOCUSED IS NOT A SACRIFICE HERE: the focus penalty slows creation SPEED [SRC:
 * CreateProgramWork.process, skillMult *= focusBonus], but int pays per second worked — a slower
 * program pays proportionally more on completion. Same hourly rate, fewer loop iterations, less
 * per-completion overhead. Unfocused is mildly BETTER, and you keep your screen.
 *
 * WHAT IT COSTS YOU: your player ACTION. Creating a program is what "you" are doing, exactly like
 * a university class — faction work, company work and crime are paused while this runs. Kill the
 * script any time; a kill mid-creation is harmless (the in-progress work just continues — and if
 * YOU then stop it in the UI, partial progress saves as a -INC file [SRC]). ascend.js's --work
 * loop will fight this for the action slot — run one or the other, not both.
 *
 * NEVER `run b1t_flum3.exe`. Creating and deleting it is safe; RUNNING it flumes you out of the
 * BitNode. This script only ever calls rm on it.
 *
 * RAM (~8.2 GB expected): base 1.6 + singularity.createProgram 5 + rm 1 + getPlayer 0.5 +
 * fileExists 0.1. Completion is detected by the .exe APPEARING on home (fileExists, 0.1 GB) —
 * cheaper than any work-status API by an order of magnitude. Measure with ram-costs.js anyway.
 */

const DEFAULT_PROGRAM = "b1t_flum3.exe";
const POLL_MS = 50;           // completion poll; dead time between completion and the next create
const STUCK_MS = 300e3;       // no .exe after 5 min: cancelled from the UI, or the program's too big
const REPORT_EVERY_MS = 60e3; // one status line per minute

export async function main(ns) {
	ns.disableLog("ALL");
	const opts = ns.flags([["program", DEFAULT_PROGRAM], ["focus", false], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun int-farm.js [--program NAME.exe] [--focus]\n\n  Farms intelligence by creating " +
			"and deleting a program in a loop (~0.1 XP/s).\n  Default program is " + DEFAULT_PROGRAM +
			" (free junk); a longer one (DeepscanV1.exe) pays slightly\n  better but is rm'd every cycle. " +
			"Owns your player action — kill it to do faction work.\n  NEVER run the b1t_flum3.exe it " +
			"makes; running it flumes you out of the node.\n");
		return;
	}
	const progName = String(opts.program);

	const startExp = ns.getPlayer().exp.intelligence;
	const startLvl = ns.getPlayer().skills.intelligence;
	const t0 = Date.now();
	let completions = 0, lastReport = 0;
	ns.tprint(`int-farm: up, ${opts.focus ? "focused" : "unfocused"}. int ${startLvl} ` +
		`(exp ${startExp.toFixed(2)}). ~360 XP/hr expected. Watch with: tail int-farm.js`);

	for (;;) {
		// A leftover copy (bought, or from a previous cycle) blocks re-creation — clear it first.
		if (ns.fileExists(progName, "home")) ns.rm(progName, "home");

		if (!ns.singularity.createProgram(progName, opts.focus)) {
			// The one known reason this fails is something else owning the player action (a class,
			// ascend.js --work, a crime). Say so and stop rather than spin — spinning would fight
			// whatever the player chose to do, and this farm is the lowest-priority use of them.
			ns.tprint(`int-farm: createProgram("${progName}") returned false — something else owns your ` +
				`action (class? ascend.js --work? crime?). Stopping. Re-run when you're idle.`);
			return;
		}

		const cycleStart = Date.now();
		while (!ns.fileExists(progName, "home")) {
			await ns.sleep(POLL_MS);
			if (Date.now() - cycleStart > STUCK_MS) {
				ns.tprint(`int-farm: ${progName} hasn't appeared in ${STUCK_MS / 1e3}s — either the creation ` +
					`was cancelled from the UI, or this program is genuinely slower than ${STUCK_MS / 60e3} min ` +
					`at your hacking level (fine! but pass a smaller --program, or raise STUCK_MS). Stopping ` +
					`so we don't fight you for the action; any in-progress creation continues and still pays.`);
				return;
			}
		}
		completions++;

		const now = Date.now();
		if (now - lastReport >= REPORT_EVERY_MS) {
			lastReport = now;
			const pl = ns.getPlayer();
			const gained = pl.exp.intelligence - startExp;
			const hours = (now - t0) / 3600e3;
			ns.print(`int ${pl.skills.intelligence} (+${pl.skills.intelligence - startLvl}) | ` +
				`+${gained.toFixed(2)} XP in ${(hours * 60).toFixed(0)}m = ${(gained / hours).toFixed(0)} XP/hr | ` +
				`${completions} creations (${((now - t0) / completions / 1000).toFixed(1)}s/cycle)`);
		}
	}
}
