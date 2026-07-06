/**
 * dnet-commander.js — home-side owner of the darknet DB.
 *
 * Crawlers ship neighborhood reports into home's inbox (dnet-in-*.json). This drains them
 * into the canonical dnet-db.json — the consolidated map + password book — and prints it.
 * It's the single writer of the DB (see darknet-design.md), and the source of truth the
 * upcoming light loot pass reads passwords from.
 *
 *   run dnet-commander.js           drain once and show the map
 *   run dnet-commander.js loop      keep draining every few seconds while a crawl runs
 *   run dnet-commander.js loop auto self-drive: re-launch crawl → loot → scout each time the net
 *                                   goes quiet, so the book stays fresh against constant mutation
 *
 * In loop mode it SELF-RELOADS: if you edit this file (a new version syncs onto home), the running
 * loop notices its own source changed and ns.spawn's a fresh copy of itself — no kill+rerun needed.
 */
import * as db from "dnet-db.js";
import { drainInbox } from "dnet-db-drain.js";
import { decodeEntities } from "dnet-constraints.js";

export async function main(ns) {
	ns.disableLog("ALL");
	const auto = ns.args.includes("auto"); // self-drive the crawl → loot → scout pipeline
	const loop = auto || ns.args.includes("loop");
	ns.ui.openTail();
	if (auto) ns.print("Auto-pipeline ON: cycling crawl → loot → scout, re-launching each time the net goes quiet.");
	const PIPELINE = ["dnet-crawl.js", "dnet-loot.js", "dnet-scout.js"]; // auto-pipeline stage order

	// Self-reload: snapshot our own source now. If the on-disk file later diverges (a fresh edit
	// synced onto home), we're running stale code — relaunch into the new version, same args.
	const self = ns.getScriptName();
	const baseline = ns.read(self);

	// Mutation watcher: the darknet exposes no "current mutation" getter, so we keep our own `epoch`
	// and bump it whenever nextMutation() fires — turning every stored edge/password into a fact WITH
	// AN AGE (edgeAge = db.epoch − stamp). nextMutation() BLOCKS, so we don't await it in the loop; we
	// arm it as a background promise that flips a flag, then re-arm. Non-blocking: the drain keeps going.
	let mutated = false;
	const armMutation = () => {
		try {
			ns.dnet.nextMutation().then(() => { mutated = true; }, () => {});
		} catch (e) {
			/* darknet not reachable from home right now */
		}
	};
	armMutation();

	let printed = false, quiet = 0, announcedIdle = false, stageIdx = 0, lastMutT = 0;
	const IDLE_TICKS = 15; // ~60s with no new REPORTS before a pass is "settled" (deep looters can
	                       // leave long gaps mid-run — a short threshold false-fires "finished")
	do {
		if (loop) {
			const current = ns.read(self);
			if (current && current !== baseline) {
				ns.tprint(`↻ ${self} changed on disk — reloading into the new version.`);
				return ns.spawn(self, { threads: 1, spawnDelay: 500 }, ...ns.args);
			}
		}

		const d = db.loadDB(ns);
		const { merged } = drainInbox(ns, d);
		let bumped = false;
		if (mutated) {
			d.epoch = (d.epoch || 0) + 1;
			mutated = false;
			armMutation(); // re-arm for the next mutation
			bumped = true;
			const now = Date.now();
			const gap = lastMutT ? `Δ${((now - lastMutT) / 1000).toFixed(1)}s` : "first";
			lastMutT = now;
			// Mutations are frequent (~seconds) and minor — log to the TAIL only, and (below) don't let
			// them reset the idle counter: a mutation isn't pipeline activity, and at a 12s cadence it
			// would otherwise keep the "pass finished" signal from ever firing.
			ns.print(`⟳ mutation → epoch ${d.epoch} (${gap} since last)`);
		}
		if (merged || bumped) db.saveDB(ns, d);

		// Idle detection keys off REPORTS ONLY. quiet resets on a merge; mutations are ignored here.
		if (merged) { quiet = 0; announcedIdle = false; } else quiet++;

		// Full map block renders only when real data changed (a report) or on the first tick — never on
		// a bare mutation, or it'd re-spam the same block every ~12s for one epoch tick.
		if (merged || !printed) {
			printed = true;
			const servers = Object.entries(d.servers);
			ns.print(`\n=== darknet map: ${servers.length} nodes, ${Object.keys(d.passwords).length} passwords held (epoch ${d.epoch}) ===`);
			for (const [host, s] of servers.slice(0, 40)) {
				const pw = host in d.passwords ? `"${d.passwords[host]}"` : "—";
				ns.print(`  ${host.padEnd(28)} ${String(s.model ?? "?").padEnd(16)} d${s.depth ?? "?"}  pw=${pw}`);
			}
			if (servers.length > 40) ns.print(`  … and ${servers.length - 40} more`);

			if (d.harvest?.length) {
				ns.print(`\n=== looted intel (last 20) ===`);
				for (const h of d.harvest.slice(-20)) {
					for (const item of h.loot ?? []) {
						const body = item.text ?? (item.cache != null ? `[cache] ${JSON.stringify(item.cache)}` : "");
						const clean = decodeEntities(body);
						if (clean) ns.print(`  ${h.from}/${item.file}: ${clean.slice(0, 140)}`);
					}
				}
			}

			if (d.spawnFails?.length) {
				ns.print(`\n=== reach: couldn't host a crawler (RAM/blocked?) — last 10 ===`);
				for (const sf of d.spawnFails.slice(-10)) ns.print(`  ${sf.from} ↛ ${sf.host}: ${sf.reason}  blocked=${sf.blockedRam ?? "?"}GB`);
			}

			try {
				const linked = ns.dnet.getStasisLinkedServers();
				ns.print(`\n=== stasis links: ${linked.length}/${ns.dnet.getStasisLinkLimit()} used${linked.length ? " — " + linked.join(", ") : ""} ===`);
			} catch (e) {
				/* darknet not reachable from home right now */
			}

			ns.tprint(db.summarize(d) + `  (+${merged} report${merged === 1 ? "" : "s"})`);
		}

		// A pass is settled when reports have been quiet for IDLE_TICKS. In auto mode, launch the next
		// pipeline stage and re-arm (so it advances even if a stage was silent); else announce "done" once.
		if (loop && quiet >= IDLE_TICKS && !announcedIdle) {
			if (auto) {
				const stage = PIPELINE[stageIdx];
				stageIdx = (stageIdx + 1) % PIPELINE.length;
				const pid = ns.exec("dnet-step.js", "home", 1, "darkweb", stage);
				ns.tprint(pid ? `▶ auto-pipeline: launched ${stage} onto darkweb (epoch ${d.epoch})` : `auto-pipeline: exec dnet-step failed for ${stage} — RAM on home?`);
				quiet = 0; // fresh idle window for the stage we just launched
			} else {
				announcedIdle = true;
				ns.tprint(`✔ quiet for ~${IDLE_TICKS * 4}s — pass finished.\n` + db.summarize(d));
			}
		}

		if (loop) await ns.sleep(4000);
	} while (loop);
}
