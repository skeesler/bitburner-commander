/**
 * dnet-lab.js — walk a BN15 labyrinth and claim its prize. Runs on a darknet server directly connected
 * to the lab (the net's LAST row). The crawler launches it, with every thread its host can spare.
 *
 *   args: <lab hostname>
 *
 * How it works [SRC v3.0.1 DarkNet/effects/labyrinth.ts; see bn15-design.md §3]:
 *  - labreport() gives the start: coordinates and which ways are open.
 *  - Each move is authenticate(lab, "south") etc. The reply itself says what happened ("moved to x,y" +
 *    the 3×3 around you, "cannot go that way", or 200 at the exit), so walking needs no extra calls.
 *    walkLabyrinth (dnet-strategies.js, specced on the game's own maze generator) picks the moves.
 *  - Each move costs one auth delay; threads shorten it (1/(1 + 0.2·(threads−1))).
 *  - Our position is tied to this script's PID: if it dies, the next walker starts from the beginning.
 *  - At the exit the lab holds `the_great_work.cache`. This script now has a session on the lab, so it
 *    copies dnet-lab-open.js there and runs it, which opens the cache: the reward goes in your install
 *    queue (lab 1 = The Broken Wings). Install when you're ready.
 * ~3.9 GB per thread.
 */
import { parseLabCoords, parseSurroundings, walkLabyrinth } from "dnet-strategies.js";

const OPENER = "dnet-lab-open.js";
const LOW_CHARISMA = /charisma|charismatic|moxie|charming/i; // the game's four "not enough charisma" lines

export async function main(ns) {
	ns.disableLog("ALL");
	const lab = String(ns.args[0] ?? "");
	const here = ns.getHostname();
	const threads = ns.getRunningScript()?.threads ?? 1;
	if (!lab) return ns.tprint("usage: dnet-lab.js <lab hostname>  (normally launched by dnet-crawl.js)");

	const where = await ns.dnet.labreport();
	if (!where?.success) return ns.tprint(`LAB ${lab}: can't see it from ${here} (${where?.message ?? "no reply"}).`);
	const start = { pos: where.coords, open: { north: where.north, east: where.east, south: where.south, west: where.west } };
	ns.tprint(`LAB ${lab}: walker on ${here} with ${threads} thread(s), starting at ${start.pos.join(",")}.`);

	let why = "";
	const halt = (reason) => {
		why = reason;
		return null; // tells walkLabyrinth to stop
	};
	const step = async (dir) => {
		let r = await ns.dnet.authenticate(lab, dir);
		for (let i = 0; i < 3 && r?.code === 408; i++) r = await ns.dnet.authenticate(lab, dir); // instability timeout
		if (r?.code === 200 || r?.success) return { win: true };
		const msg = String(r?.message ?? "");
		if (LOW_CHARISMA.test(msg)) return halt(`not enough charisma: "${msg}"`);
		if (r?.code === 351 || r?.code === 503) return halt(`lost the connection (${r.code}): ${here} moved or the lab vanished`);
		if (/cannot go/i.test(msg)) return { wall: true };
		const open = parseSurroundings(r?.data);
		if (!open) return halt(`unexpected reply: ${JSON.stringify(r)}`);
		return { moved: true, open, pos: parseLabCoords(msg) };
	};

	const t0 = Date.now();
	const res = await walkLabyrinth(start, step, {
		onMove: ({ moves, pos, explored }) => {
			ns.print(`move ${moves}: at ${pos.join(",")}, ${explored} cells explored`);
			if (moves % 25 === 0) ns.tprint(`LAB ${lab}: ${moves} moves, ${explored} cells explored, at ${pos.join(",")}.`);
		},
	});
	const took = ns.format.time(Date.now() - t0);
	if (!res.done) return ns.tprint(`LAB ${lab}: stopped after ${res.moves} moves (${took}) — ${why || res.why}.`);

	ns.tprint(`LAB ${lab}: SOLVED in ${res.moves} moves (${took}). Opening the prize…`);
	if (!(await ns.scp(OPENER, lab, here))) return ns.tprint(`LAB ${lab}: couldn't copy ${OPENER} onto the lab. Open its .cache by hand in the darknet window.`);
	if (!ns.exec(OPENER, lab, 1)) ns.tprint(`LAB ${lab}: couldn't start ${OPENER} on the lab. Open its .cache by hand in the darknet window.`);
}
