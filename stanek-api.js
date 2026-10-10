/**
 * stanek-api.js — THROWAWAY: dump the REAL ns.stanek surface and Stanek's Gift in THIS game (3.0.1, BN13).
 *
 * Same discipline as gang-api.js, corp-api.js and hacknet-api.js: design against the running game.
 * The v3.0.1 tag has already said a lot (CotMG/*.ts, NetscriptFunctions/Stanek.ts); this run's job is
 * to promote those [SRC] claims to [LIVE] or shoot them down.
 *
 * WHAT THIS RUN NEEDS TO SETTLE, in priority order:
 *
 *   1. **Can you still accept the gift?** canAcceptStaneksGift() refuses if you own OR have queued
 *      any augmentation other than NeuroFlux Governor (CotMG/Helper.tsx:63-72). That door is one-way
 *      for the whole node, so §2 checks it before anything else and says so in capitals.
 *   2. **Grid size.** baseSize = 9 + StaneksGiftExtraSize (BN13: +1) + SF13 level, width =
 *      floor(base/2 + 1), height = floor(base/2 + 0.6) (StaneksGift.ts:24-33). In BN13.1 that
 *      predicts 6 x 5. §3 compares.
 *   3. **The fragment table.** Shapes, types, powers and limits, live — the placer is built on it. §3.
 *   4. **What a thread of charge is worth.** effect = 1 + ln(highest+1)/60 x ((numCharge+1)/5)^0.07
 *      x power x boost x StaneksGiftPowerMultiplier (BN13: 2) (CotMG/formulas/effect.ts); charge
 *      threads are multiplied by home's core bonus. §4 prints the curve for your RAM.
 *
 * READ-ONLY. Never accepts the gift, never places, removes or charges a fragment.
 *
 *   run stanek-api.js
 *
 * RAM: ~15 GB — getOwnedAugmentations (5, SF4.3) + activeFragments (5) + getServer (2) +
 * getResetInfo (1) + getPlayer (0.5) + giftWidth/Height (0.8) + small change.
 * fragmentDefinitions is free. Check with `mem stanek-api.js`.
 *
 * Printed to the terminal AND written to stanek-api-dump.txt, flushed after every section, so a crash
 * still leaves evidence. RFA sync is one-way (disk -> game), so paste the terminal output back.
 */

const DUMP_FILE = "stanek-api-dump.txt";

// The 11 methods v3.0.1 documents (RamCostGenerator.ts:422-434). Anything else on the namespace is
// either an undocumented bonus or a removed-function tombstone — a typeof probe can't tell which.
const STANEK_API = [
	"giftWidth", "giftHeight", "chargeFragment", "fragmentDefinitions", "activeFragments",
	"clearGift", "canPlaceFragment", "placeFragment", "getFragment", "removeFragment", "acceptGift",
];

const COTMG = "Church of the Machine God";
const NFG = "NeuroFlux Governor";

export async function main(ns) {
	ns.disableLog("ALL");
	const lines = [];
	const say = (s = "") => lines.push(s);
	const flush = () => { try { ns.write(DUMP_FILE, lines.join("\n"), "w"); } catch (e) { /* terminal copy still prints */ } };
	const sk = ns.stanek;

	// ---- §1 surface -------------------------------------------------------------
	say("===== stanek-api.js — Stanek's Gift, live (3.0.1) =====");
	say("");
	say("§1 SURFACE");
	const seen = new Set();
	for (let o = sk; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
		for (const k of Object.getOwnPropertyNames(o)) if (k !== "constructor") seen.add(k);
	}
	const missing = STANEK_API.filter((k) => typeof sk[k] !== "function");
	const extra = [...seen].filter((k) => !STANEK_API.includes(k));
	say(`  ns.stanek has ${seen.size} properties; documented ${STANEK_API.length}, missing ${missing.length}` +
		(missing.length ? `: ${missing.join(", ")}` : ""));
	say(`  not in the v3.0.1 docs: ${extra.length ? extra.join(", ") + "  (bonus OR tombstone — only a call tells)" : "(none)"}`);
	flush();

	// ---- §2 context and the one-way door ----------------------------------------
	say("");
	say("§2 CONTEXT — and can you still accept the gift?");
	const reset = safe(() => ns.getResetInfo(), null);
	const sf = reset ? (reset.ownedSF instanceof Map ? Object.fromEntries(reset.ownedSF) : reset.ownedSF) : {};
	say(`  node ${reset ? reset.currentNode : "?"} · ownedSF ${JSON.stringify(sf)}`);
	const player = safe(() => ns.getPlayer(), {});
	say(`  city ${player.city || "?"} · member of ${COTMG}: ${(player.factions || []).includes(COTMG) ? "YES" : "no"}`);
	const owned = safe(() => ns.singularity.getOwnedAugmentations(true), null);   // true = include queued
	if (owned === null) {
		say("  could not read augmentations (singularity unavailable?) — check by hand before buying ANY aug");
	} else {
		const blocking = owned.filter((a) => a !== NFG && !a.startsWith("Stanek's Gift"));
		const hasGift = owned.some((a) => a.startsWith("Stanek's Gift"));
		if (hasGift) say(`  gift: ACCEPTED (${owned.filter((a) => a.startsWith("Stanek's Gift")).join(", ")})`);
		else if (blocking.length) {
			say(`  !! CANNOT ACCEPT THE GIFT: you own or have queued ${blocking.length} non-NeuroFlux aug(s): ${blocking.slice(0, 8).join(", ")}` +
				`${blocking.length > 8 ? ", ..." : ""}`);
			say("     (CotMG/Helper.tsx:63-72 — counts installed AND queued; there is no undo short of leaving the node)");
		} else {
			say("  gift: NOT YET ACCEPTED — and you still CAN. Buy no augmentation (NeuroFlux excepted) until you do.");
			say(`     accept at the ${COTMG} in Chongqing, or ns.stanek.acceptGift() (2 GB). This probe won't.`);
		}
	}
	flush();

	// ---- §3 the gift itself ------------------------------------------------------
	say("");
	say("§3 THE GIFT");
	const width = safe(() => sk.giftWidth(), null);
	if (width === null) {
		say("  not installed — giftWidth() refused (\"Stanek's Gift is not installed\"). Accept it, then re-run.");
		// The fragment table needs the gift too (checkStanekAPIAccess), so stop here.
	} else {
		const height = sk.giftHeight();
		const sf13 = Number(sf[13] || 0);
		const base = 9 + 1 + sf13;   // BaseSize 9 + BN13 StaneksGiftExtraSize 1 + SF13 level [SRC]
		const predW = Math.max(2, Math.min(Math.floor(base / 2 + 1), 25));
		const predH = Math.max(3, Math.min(Math.floor(base / 2 + 0.6), 25));
		say(`  grid ${width} x ${height}  (source predicts ${predW} x ${predH} for SF13 level ${sf13} in BN13: ` +
			`${width === predW && height === predH ? "MATCHES" : "DIFFERS — note it"})`);

		const defs = safe(() => sk.fragmentDefinitions(), []);
		say(`  fragmentDefinitions: ${defs.length}`);
		for (const f of defs) {
			say(`    id ${String(f.id).padStart(3)} · ${String(f.type).padEnd(14)} · power ${f.power} · limit ${f.limit} · ` +
				`${f.shape[0].length}x${f.shape.length}${f.effect ? ` · ${f.effect}` : ""}`);
			for (const row of f.shape) say(`        ${row.map((c) => (c ? "#" : ".")).join("")}`);
		}
		flush();

		const active = safe(() => sk.activeFragments(), []);
		say(`  activeFragments: ${active.length}`);
		for (const a of active) {
			say(`    id ${a.id} at (${a.x},${a.y}) rot ${a.rotation} · ${a.type} · highestCharge ${round(a.highestCharge)} · ` +
				`numCharge ${round(a.numCharge)} · chargedEffect x${round(a.chargedEffect, 4)}`);
		}
		// The grid, as the game sees it: which fragment id covers each cell.
		const grid = [...Array(height)].map(() => Array(width).fill("."));
		for (const a of active) {
			const f = defs.find((d) => d.id === a.id);
			if (!f) continue;
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				if (covers(f.shape, a.rotation, x - a.x, y - a.y)) grid[y][x] = String(a.id % 36 < 10 ? a.id % 36 : String.fromCharCode(55 + (a.id % 36)));
			}
		}
		say("  grid (fragment id mod 36 per cell; . = empty):");
		for (const row of grid) say(`    ${row.join(" ")}`);
	}
	flush();

	// ---- §4 what charge is worth ------------------------------------------------
	say("");
	say("§4 CHARGE ECONOMICS (from the v3.0.1 formula, BN13 power x2 — not measured)");
	const homeRam = ns.getServerMaxRam("home");
	const cores = safe(() => ns.getServer("home").cpuCores, 1);
	const coreBonus = 1 + (cores - 1) / 16;   // getCoreBonus [SRC: Server/ServerHelpers]
	say(`  home ${homeRam} GB, ${cores} core(s) -> core bonus x${round(coreBonus, 3)} on every charge thread`);
	say("  a charge call takes 1s (0.2s in bonus time) and counts threads x coreBonus; effect for a power-1 fragment,");
	say("  no boosters, after many charges at the same thread count:");
	for (const t of [10, 100, 1e3, 1e4, 1e5, 1e6]) {
		const eff = 1 + (Math.log(t * coreBonus + 1) / 60) * Math.pow((1000 + 1) / 5, 0.07) * 1 * 1 * 2;
		say(`    ${String(t).padStart(8)} threads -> x${round(eff, 4)}`);
	}
	say("  boosters (power 1.1, limit 99) multiply every non-booster fragment they TOUCH; charging also pays");
	say(`  ${COTMG} reputation: faction_rep x threads^0.95 x (favor+100) / 1000 per charge.`);
	say("  charges reset on every augmentation install; placement does not (StaneksGift.prestigeAugmentation).");
	say("");
	say("===== END =====");
	flush();

	ns.tprint("\n" + lines.join("\n") + `\n\n(also written to ${DUMP_FILE} — \`cat ${DUMP_FILE}\` if this scrolled away)`);
}

/** Does a fragment shape, rotated, cover cell (x, y) relative to its root? A line-for-line port of
 *  Fragment.fullAt(x, y, rotation) [SRC: CotMG/Fragment.ts:24-41]. */
function covers(shape, rotation, x, y) {
	const w0 = shape[0].length, h0 = shape.length;
	const width = rotation % 2 === 0 ? w0 : h0, height = rotation % 2 === 0 ? h0 : w0;
	if (y < 0 || y >= height || x < 0 || x >= width) return false;
	let [sx, sy, mx, my] = [0, 0, 1, 1];
	if (rotation === 1) [sx, sy, mx, my] = [width - 1, 0, -1, 1];
	else if (rotation === 2) [sx, sy, mx, my] = [width - 1, height - 1, -1, -1];
	else if (rotation === 3) [sx, sy, mx, my] = [0, height - 1, 1, -1];
	let [qx, qy] = [sx + mx * x, sy + my * y];
	if (rotation % 2 === 1) [qx, qy] = [qy, qx];
	return !!shape[qy][qx];
}

function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
function round(n, dp = 2) { return Number.isFinite(n) ? String(Math.round(n * 10 ** dp) / 10 ** dp) : "?"; }
