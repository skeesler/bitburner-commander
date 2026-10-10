/**
 * dnet-bleeder.js — one charisma worker: heartbleed a darknet server forever. Launched by dnet-bleed.js.
 *
 *   args: <target = darkweb> <index>   (index only makes each copy's args unique)
 *
 * Every heartbleed pays 50 × (500 + cha)/500 charisma XP, whatever the target [SRC v3.0.1,
 * NetscriptFunctions/Darknet.ts]. `peek` leaves the target's logs alone for the solvers. 2.2 GB.
 */
export async function main(ns) {
	ns.disableLog("ALL");
	const target = String(ns.args[0] ?? "darkweb");
	for (;;) {
		const r = await ns.dnet.heartbleed(target, { peek: true });
		if (!r?.success) await ns.sleep(5000); // target offline, or not enough charisma for it
	}
}
