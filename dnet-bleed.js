/**
 * dnet-bleed.js — charisma grinder. Fills spare home RAM with 1-thread heartbleed workers, then shows
 * charisma climbing toward a target level.
 *
 *   run dnet-bleed.js               fill free home RAM (keeping 16 GB spare), watch toward cha 300
 *   run dnet-bleed.js 20            exactly 20 workers
 *   run dnet-bleed.js --reserve 64  keep 64 GB of home free instead
 *   run dnet-bleed.js --to 600      watch toward charisma 600 (lab 2)
 *   run dnet-bleed.js off           stop every worker
 *
 * Why this shape [SRC v3.0.1, see bn15-design.md]:
 *  - Each heartbleed pays 50 × (500 + cha)/500 cha XP, against ~3–5 for a crack attempt.
 *  - XP is per CALL. Threads only shorten the call (1/(1 + 0.2·(t−1))), so for a fixed amount of RAM,
 *    many 1-thread copies earn more than one big one.
 *  - darkweb is the ideal target: difficulty 0, charisma 0, stationary, and directly connected to home,
 *    so this runs on home with no darknet deployment at all. A call takes 1.5 × auth time:
 *    ~0.6 s at cha 54, ~0.3 s at cha 300.
 *
 * Restarting re-launches the workers: it stops the old ones first. Killing this script leaves the workers
 * running; `run dnet-bleed.js off` stops them.
 */
const WORKER = "dnet-bleeder.js";
const TARGET = "darkweb";

/** Charisma XP needed for a level, given the effective multiplier (inverse of calculateSkill). */
const xpForLevel = (level, mult) => Math.exp((level / mult + 200) / 32) - 534.6;

export async function main(ns) {
	ns.disableLog("ALL");
	const flag = (name, dflt) => {
		const i = ns.args.indexOf(name);
		return i >= 0 && ns.args[i + 1] != null ? Number(ns.args[i + 1]) : dflt;
	};
	const reserveGb = flag("--reserve", 16);
	const goal = flag("--to", 300);
	const wanted = ns.args.find((a, i) => typeof a === "number" && !String(ns.args[i - 1] ?? "").startsWith("--"));

	// Stop any workers already running (a restart re-launches them fresh).
	const workers = ns.ps("home").filter((p) => p.filename === WORKER);
	for (const p of workers) ns.kill(p.pid);
	if (ns.args.includes("off")) {
		ns.tprint(`dnet-bleed: stopped ${workers.length} worker(s).`);
		return;
	}

	const each = ns.getScriptRam(WORKER, "home");
	if (!each) {
		ns.tprint(`dnet-bleed: ${WORKER} isn't on home.`);
		return;
	}
	const free = ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - reserveGb;
	const n = Math.max(0, Math.min(wanted ?? Infinity, Math.floor(free / each)));
	let started = 0;
	for (let i = 0; i < n; i++) if (ns.exec(WORKER, "home", 1, TARGET, i)) started++;
	ns.tprint(`dnet-bleed: ${started} worker(s) bleeding ${TARGET} (${(started * each).toFixed(1)} GB, ${reserveGb} GB kept free).`);
	if (!started) return;

	// Watch: level, XP rate over the last minute, and a rough ETA to the goal.
	ns.ui.openTail();
	const samples = [];
	for (;;) {
		const pl = ns.getPlayer();
		const lvl = pl.skills.charisma;
		const xp = pl.exp.charisma;
		const now = Date.now();
		samples.push([now, xp]);
		while (samples.length > 1 && now - samples[0][0] > 60_000) samples.shift();
		const [t0, x0] = samples[0];
		const rate = now > t0 ? ((xp - x0) / (now - t0)) * 1000 : 0; // XP per second

		// Effective multiplier from where we are now (charisma mult × the node's level multiplier).
		const mult = lvl / Math.max(1e-9, 32 * Math.log(xp + 534.6) - 200);
		const need = xpForLevel(goal, mult) - xp;
		const eta = need <= 0 ? "reached" : rate > 0 ? `~${ns.format.time((need / rate) * 1000)}` : "measuring…";

		ns.clearLog();
		ns.print(`charisma ${lvl}   (goal ${goal}: ${eta})`);
		ns.print(`xp ${ns.format.number(xp)}   +${ns.format.number(rate * 60)}/min`);
		ns.print(`${started} workers on home → ${TARGET}`);
		await ns.sleep(5000);
	}
}
