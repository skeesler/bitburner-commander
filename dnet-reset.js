/**
 * dnet-reset.js — start the darknet DB over for a new darknet, keeping the looted wordlist.
 *
 *   run dnet-reset.js
 *
 * Run it after every augmentation install and on entering a new BitNode. Both rebuild the darknet
 * from scratch (prestigeDarknetState), so every stored password, server and edge describes a net that
 * no longer exists. `prune` can't clear them: it never drops a password, or any server we hold one for.
 * Hostnames repeat across nets, so stale passwords cost real guesses: the crawler tries a known
 * password before solving.
 *
 * Also clears lab anchors (dnet-anchor-*.txt): their stasis links died with the old net.
 * Kept: the wordlist (dog names, common-password lists and the like look the same in every net).
 * Saved first: the old DB, to dnet-db-old.json, in case anything in it turns out to matter.
 *
 * Lives outside dnet-db.js on purpose: the crawler imports that module and pays RAM for every ns.*
 * it mentions, and this needs ns.scriptRunning.
 */
import { DB_FILE, emptyDB, loadDB, saveDB, summarize } from "dnet-db.js";

export async function main(ns) {
	// The commander keeps the DB in memory and would write the old one straight back.
	if (ns.scriptRunning("dnet-commander.js", "home")) {
		ns.tprint("dnet-commander.js is running. `kill dnet-commander.js` first, then run this again.");
		return;
	}
	const old = loadDB(ns);
	ns.write("dnet-db-old.json", ns.read(DB_FILE), "w");

	// Lab anchors name servers in the old net; their stasis links are gone with it.
	const anchors = ns.ls("home", "dnet-anchor-");
	for (const f of anchors) ns.rm(f, "home");

	const fresh = emptyDB();
	fresh.wordlist = [...(old.wordlist ?? [])];
	saveDB(ns, fresh);

	const n = (o) => Object.keys(o ?? {}).length;
	ns.tprint(
		`\nReset the darknet DB. Dropped ${n(old.passwords)} passwords, ${n(old.servers)} servers, ${n(old.edges)} edges.` +
			`\nKept ${fresh.wordlist.length} wordlist candidates. Old DB saved to dnet-db-old.json.` +
			(anchors.length ? ` Cleared ${anchors.length} lab anchor(s).` : "") +
			"\n\n" +
			summarize(fresh),
	);
}
