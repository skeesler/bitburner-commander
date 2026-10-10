/**
 * dnet-lab-open.js — runs ON a solved labyrinth and opens its cache(s): the lab's reward goes into your
 * augmentation queue. Launched by dnet-lab.js at the exit. ~3.8 GB.
 */
export async function main(ns) {
	const here = ns.getHostname();
	const caches = ns.ls(here, ".cache");
	if (!caches.length) return ns.tprint(`LAB ${here}: no .cache here (already opened?). Check your augmentation queue.`);
	for (const f of caches) {
		try {
			const r = ns.dnet.openCache(f);
			ns.tprint(`LAB ${here}: opened ${f} — ${r?.message ?? JSON.stringify(r)}`);
		} catch (e) {
			ns.tprint(`LAB ${here}: couldn't open ${f}: ${e}`);
		}
	}
	ns.rm("dnet-lab-armed.txt", "home"); // one lab per arming (dnet-lab-arm.js)
	ns.tprint(`LAB ${here}: done, and the walker is disarmed. Install augmentations when you're ready; the next lab appears after that.`);
}
