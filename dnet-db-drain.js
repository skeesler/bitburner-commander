/**
 * dnet-db-drain.js — COMMANDER-ONLY inbox drain.
 *
 * Split out of dnet-db.js on purpose: drainInbox uses ns.rm (~1GB) and ns.ls, and a script pays RAM
 * for every ns.* function in the modules it imports — even uncalled ones. Keeping the drain here means
 * the crawler/looter (which import dnet-db.js for report/flush/loadDB) don't carry that GB, so the
 * heavy crawler fits a 16GB node with a heartbeat script already on it. See darknet-design.md.
 *
 * Only the commander imports this.
 */
import { INBOX_PREFIX, applyReport } from "dnet-db.js";

/**
 * Fold every inbox report on home into `db`, deleting the files as they're merged.
 * Mutates and returns { merged, files }; the caller does the saveDB() after.
 */
export function drainInbox(ns, db) {
	const files = ns.ls("home", INBOX_PREFIX).filter((f) => f.startsWith(INBOX_PREFIX));
	let merged = 0;
	for (const f of files) {
		const raw = ns.read(f);
		if (raw) {
			try {
				applyReport(db, JSON.parse(raw));
				merged++;
			} catch (e) {
				ns.tprint(`WARN dnet-db-drain: bad report ${f} (${e}); dropping`);
			}
		}
		ns.rm(f);
	}
	return { merged, files: files.length };
}
