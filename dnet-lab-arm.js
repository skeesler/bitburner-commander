/**
 * dnet-lab-arm.js — opt in to the maze walker. Crawlers never send dnet-lab.js into a labyrinth unless
 * this flag is set.
 *
 *   run dnet-lab-arm.js        arm: the walker goes into the next lab (with charisma ≥ its gate)
 *   run dnet-lab-arm.js off    disarm
 *
 * If a lab already has an anchor (a stasis-linked server beside it, placed by dnet-pin.js), arming also
 * sends the walker there straight from home. Otherwise the next crawler beside the lab does it.
 * One lab per arming: dnet-lab-open.js clears the flag after it opens a lab's prize, so lab 2 waits for
 * you to arm again.
 */
import { loadDB } from "dnet-db.js";

export const LAB_FLAG = "dnet-lab-armed.txt";
const WALKER = "dnet-lab.js";
const WALKER_FILES = [WALKER, "dnet-lab-open.js", "dnet-strategies.js"];

export async function main(ns) {
	if (ns.args.includes("off")) {
		ns.rm(LAB_FLAG, "home");
		ns.tprint("Maze walker disarmed. Crawlers will leave labyrinths alone.");
		return;
	}
	ns.write(LAB_FLAG, new Date().toISOString(), "w");
	ns.tprint("Maze walker armed. The next crawler beside a labyrinth (with enough charisma) sends a walker in.");

	// Anchors: send the walker now, from home.
	const linked = ns.dnet.getStasisLinkedServers();
	const passwords = loadDB(ns).passwords ?? {};
	for (const file of ns.ls("home", "dnet-anchor-")) {
		let anchor;
		try {
			anchor = JSON.parse(ns.read(file));
		} catch (e) {
			continue;
		}
		const { host, lab } = anchor;
		if (!linked.includes(host)) {
			ns.tprint(`Anchor ${host} (for ${lab}) has lost its stasis link; leaving it to the crawlers.`);
			continue;
		}
		if (!ns.dnet.connectToSession(host, String(passwords[host] ?? ""))?.success) {
			ns.tprint(`Anchor ${host}: no working password in the DB; leaving it to the crawlers.`);
			continue;
		}
		if (!(await ns.scp(WALKER_FILES, host, "home"))) {
			ns.tprint(`Anchor ${host}: couldn't copy the walker there.`);
			continue;
		}
		const per = ns.getScriptRam(WALKER, host);
		const threads = per ? Math.floor((ns.getServerMaxRam(host) - ns.getServerUsedRam(host)) / per) : 0;
		const pid = threads > 0 ? ns.exec(WALKER, host, { threads, preventDuplicates: true }, lab) : 0;
		ns.tprint(pid ? `Walker sent to anchor ${host} for ${lab} (${threads} threads).` : `Anchor ${host}: couldn't start the walker (${threads} threads fit, or one is already walking).`);
	}
}
