/**
 * dnet-map.js — print the darknet map, row by row, from the DB. Read-only, quiet, ~1.6 GB.
 *
 *   run dnet-map.js            servers seen in the last 10 minutes
 *   run dnet-map.js --mins 3   …in the last 3 minutes
 *   run dnet-map.js --all      every server the DB still holds, ghosts included
 *   run dnet-map.js --models   add each server's model and charisma gate
 *
 * Rows are the game's own `depth` (darkweb's neighbours are row 0). In BN15 lab 1 hangs off the LAST
 * row, row 6 (bn15-design.md §2), so that's the number to watch.
 *   ✓ host   we hold its password
 *   · host   seen, not cracked
 *   (4m)     last seen 4 minutes ago (shown once it's over a minute; servers move every few seconds,
 *            so an old sighting means "was there", not "is there")
 * The window is in minutes, not mutations: mutations come every ~5 s, so the DB's 20-epoch "live" window
 * is only ~90 s and the map kept emptying between passes.
 * The DB is only as fresh as the commander's last drain; with no commander running, it's a snapshot.
 */
import { loadDB } from "dnet-db.js";

const LAB_ROW = { 1: 6, 2: 11, 3: 18, 4: 22, 5: 28 }; // the row each BN15 lab connects to
const LABS = ["th3_l4byr1nth", "cru3l_l4byr1nth", "m3rc1l3ss_l4byr1nth", "ub3r_l4byr1nth", "et3rn4l_l4byr1nth"];
const WIDTH = 110;

export async function main(ns) {
	const db = loadDB(ns);
	const all = ns.args.includes("--all");
	const models = ns.args.includes("--models");
	const epoch = db.epoch ?? 0;
	const i = ns.args.indexOf("--mins");
	const mins = i >= 0 ? Number(ns.args[i + 1]) || 10 : 10;
	const now = Date.now();
	const ageMin = (s) => (now - (s.lastSeenTime ?? 0)) / 60_000;

	const rows = new Map(); // row → [{host, cracked, model, cha}]
	let shown = 0;
	for (const [host, s] of Object.entries(db.servers ?? {})) {
		if (!all && ageMin(s) > mins) continue;
		const row = Number.isInteger(s.depth) && s.depth >= 0 ? s.depth : "?";
		if (!rows.has(row)) rows.set(row, []);
		rows.get(row).push({ host, cracked: host in (db.passwords ?? {}), model: s.model, cha: s.charismaReq, age: ageMin(s) });
		shown++;
	}

	const order = [...rows.keys()].sort((a, b) => (a === "?" ? 1 : b === "?" ? -1 : a - b));
	const lines = [];
	let deepest = -1;
	for (const row of order) {
		const list = rows.get(row).sort((a, b) => b.cracked - a.cracked || a.host.localeCompare(b.host));
		const cracked = list.filter((x) => x.cracked).length;
		if (row !== "?" && cracked) deepest = Math.max(deepest, row);
		const label = row === "?" ? "row ?" : `row ${String(row).padStart(2)}`;
		const head = `${label}  ${String(cracked).padStart(2)}/${String(list.length).padEnd(2)} cracked │ `;
		const items = list.map((x) => {
			const lab = LABS.includes(x.host) ? " ★LAB" : "";
			const extra = models && x.model ? ` [${x.model}${x.cha ? ` cha ${x.cha}` : ""}]` : "";
			const age = x.age >= 1 ? ` (${x.age < 60 ? `${Math.floor(x.age)}m` : `${Math.floor(x.age / 60)}h`})` : "";
			return `${x.cracked ? "✓" : "·"}${x.host}${extra}${lab}${age}`;
		});
		// Wrap the server list under its row header.
		let line = head;
		for (const item of items) {
			if (line.length + item.length + 2 > WIDTH && line.length > head.length) {
				lines.push(line);
				line = " ".repeat(head.length - 2) + "│ ";
			}
			line += item + "  ";
		}
		lines.push(line.trimEnd());
	}

	const when = db.updated ? new Date(db.updated).toLocaleTimeString() : "never";
	const scope = all ? "all servers in the DB" : `seen in the last ${mins} min`;
	ns.tprint(
		`\nDarknet map — ${shown} servers, ${scope} (DB saved ${when}, epoch ${epoch})\n` +
			(lines.length ? lines.join("\n") : "  (nothing yet — is dnet-commander.js running?)") +
			`\n\nDeepest cracked row: ${deepest >= 0 ? deepest : "none"}.  Lab 1 connects to row ${LAB_ROW[1]}.` +
			(rows.has("?") ? `  (row ? = seen only by a scout, or offline when cataloged)` : ""),
	);
}
