/**
 * dnet-pin.js — put a stasis link on THIS server and record it as the anchor for a lab. Launched by
 * dnet-crawl.js when it's next to a labyrinth and a link is free.
 *
 *   args: <lab hostname>
 *
 * A stasis link stops the server moving or going offline, and counts as a backdoor, so home can exec onto
 * it from anywhere [SRC v3.0.1 DarkNet/effects/effects.ts setStasisLink]. Next to a lab, that's a permanent
 * foothold: the walker can't lose its connection, and dnet-lab-arm.js can send it straight from home.
 * Linking takes ~20–30 s. The limit is 1, +1 each for The W1ngs of Icarus, The Hammer and The Staff.
 * ~13.6 GB.
 */
export async function main(ns) {
	const lab = String(ns.args[0] ?? "");
	const here = ns.getHostname();
	const anchor = `dnet-anchor-${lab}.txt`;
	if (!lab) return ns.tprint("usage: dnet-pin.js <lab hostname>  (normally launched by dnet-crawl.js)");
	if (ns.fileExists(anchor, "home")) return; // another crawler already pinned one for this lab

	const r = await ns.dnet.setStasisLink(true);
	if (!r?.success) return ns.tprint(`PIN ${here}: couldn't place a stasis link (${r?.code} ${r?.message}).`);

	ns.write(anchor, JSON.stringify({ host: here, lab, time: Date.now() }), "w");
	await ns.scp(anchor, "home", here);
	ns.tprint(`PIN ${here}: stasis link placed — a permanent foothold next to ${lab}. \`run dnet-lab-arm.js\` sends the walker here.`);
}
