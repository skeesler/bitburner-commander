/**
 * dnet-strategies.js — pure, feedback-driven crack strategies for the BN15 darknet models.
 *
 * Each strategy is a function of the password's shape plus an `ask(guess)` oracle, so the whole
 * strategy runs under Node against a simulated server (dnet-constraints.test.mjs). The solver supplies
 * the real oracle: authenticate, then heartbleed for that guess's `data`. No ns.* in here, so importing
 * it costs the crawler no RAM. Mind the bare-name trap anyway: no local may share a name with any ns
 * function (`attempt`, `probe`, `getData`…), or the game bills it.
 *
 * ask(guess) resolves to:
 *   "win"             the guess authenticated
 *   null              no usable feedback: stop (node gone, 351, or a grammar we don't recognise)
 *   otherwise         the model-specific feedback parsed by this module's parse* helpers
 *
 * Mechanics are from the v3.0.1 source (`DarkNet/effects/authentication.ts`); see bn15-design.md.
 */

// ── RateMyPix.Auth: bulls-only Mastermind ─────────────────────────────────────────────────────────
// A wrong guess's data is one 🌶️ per digit right AND in place, then "/<length>"; "0/<length>" when none.

/** "🌶️🌶️/5" → 2, "0/5" → 0, anything else → null. */
export function parseSpice(data) {
	const m = /^(.*)\/(\d+)$/su.exec(String(data ?? "").trim());
	if (!m) return null;
	if (m[1] === "0") return 0;
	const peppers = (m[1].match(/🌶/gu) || []).length;
	return peppers > 0 && m[1].replace(/🌶️?/gu, "") === "" ? peppers : null;
}

/** Positions where guess and candidate agree. */
export function exactMatches(guess, cand) {
	let n = 0;
	for (let i = 0; i < cand.length; i++) if (guess[i] === cand[i]) n++;
	return n;
}

/** Every distinct arrangement of a symbol multiset ({symbol: count}) — at most len! (720 for len 6). */
function arrangements(counts, len) {
	const out = [];
	const cur = [];
	const rest = { ...counts };
	const step = () => {
		if (cur.length === len) return void out.push(cur.join(""));
		for (const s of Object.keys(rest)) {
			if (!rest[s]) continue;
			rest[s]--;
			cur.push(s);
			step();
			cur.pop();
			rest[s]++;
		}
	};
	step();
	return out;
}

/** The candidate whose worst-case surviving set is smallest (minimax on exact-match counts). */
function pickSpiceGuess(cands) {
	if (cands.length <= 2) return cands[0];
	let best = cands[0];
	let bestWorst = Infinity;
	for (const g of cands) {
		const buckets = new Map();
		let worst = 0;
		for (const c of cands) {
			const k = exactMatches(g, c);
			const v = (buckets.get(k) ?? 0) + 1;
			buckets.set(k, v);
			if (v > worst) worst = v;
		}
		if (worst < bestWorst) {
			bestWorst = worst;
			best = g;
		}
	}
	return best;
}

/**
 * Crack a RateMyPix.Auth node. Two phases:
 *   1. Count: guess each symbol repeated ("000…", "111…") — the pepper count is how many positions hold
 *      it. Stop once the counts add up to the length. ≤ alphabet−1 guesses.
 *   2. Place: the answer is an arrangement of that multiset (≤ len! of them). Guess the minimax pick,
 *      keep the arrangements that score the same, repeat.
 * Numeric passwords never start with 0 (the generator strips leading zeros), so those are dropped.
 * Returns { pw, guesses } or { pw: null, guesses, why }.
 */
export async function solveSpice({ length, alphabet, numeric = true }, ask) {
	let guesses = 0;
	const send = async (g) => {
		guesses++;
		return ask(g);
	};
	const counts = {};
	let found = 0;
	for (let i = 0; i < alphabet.length && found < length; i++) {
		const s = alphabet[i];
		// The last symbol needs no guess when it's the only one left to account for the rest.
		if (i === alphabet.length - 1) {
			counts[s] = length - found;
			found = length;
			break;
		}
		const g = s.repeat(length);
		const r = await send(g);
		if (r === "win") return { pw: g, guesses };
		if (r == null) return { pw: null, guesses, why: "no feedback" };
		if (r > 0) {
			counts[s] = r;
			found += r;
		}
	}
	if (found !== length) return { pw: null, guesses, why: "counts never reached the length (password changed?)" };

	let cands = arrangements(counts, length);
	if (numeric && length > 1) cands = cands.filter((c) => c[0] !== "0");
	while (cands.length) {
		const g = pickSpiceGuess(cands);
		const r = await send(g);
		if (r === "win") return { pw: g, guesses };
		if (r == null) return { pw: null, guesses, why: "no feedback" };
		cands = cands.filter((c) => c !== g && exactMatches(g, c) === r);
	}
	return { pw: null, guesses, why: "no arrangement fits (password changed?)" };
}

// ── KingOfTheHill: find the peak ──────────────────────────────────────────────────────────────────
// A wrong guess's data is the altitude: 10000·exp(-((guess − pw)/w)²), w = 10^max(len−2, 0) + 1,
// plus side hills from difficulty 8 up. Within 3% of the password only the main hill counts.

export const PEAK = 10000;

/** "1234.5" → 1234.5; anything non-numeric → null. */
export function parseAltitude(data) {
	const s = String(data ?? "").trim();
	if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

/** Hill width for a password of this many digits. */
export const hillWidth = (len) => 10 ** Math.max(len - 2, 0) + 1;

/** Distance from the main peak implied by an altitude, or null when it's too low to read. */
export function distanceFromAltitude(alt, len) {
	if (!(alt > 0) || alt > PEAK) return null;
	return hillWidth(len) * Math.sqrt(Math.log(PEAK / alt));
}

/** Whole numbers that are a valid `len`-digit password (no leading zero unless len 1). */
const fits = (n, len) => Number.isInteger(n) && n >= 0 && String(n).length === len;

/**
 * Centre of a bell-shaped hill of known width from two altitudes on it. Every hill is
 * H·exp(-((x − c)/w)²), so ln a1 − ln a2 is linear in c: c = (x2² − x1² − w²·ln(a1/a2)) / (2(x2 − x1)).
 */
export function hillCenter(x1, a1, x2, a2, w) {
	if (!(a1 > 0) || !(a2 > 0) || x1 === x2) return null;
	const c = (x2 * x2 - x1 * x1 - w * w * Math.log(a1 / a2)) / (2 * (x2 - x1));
	return Number.isFinite(c) ? c : null;
}

/**
 * Crack a KingOfTheHill node.
 *   1. Find ground: guess the middle of the range (and points ~27 widths in from each end if that reads 0;
 *      a hill's tail underflows to 0 about 27 widths out).
 *   2. Fit: a second guess half a width away pins the centre of the hill we're on (hillCenter). Move there
 *      and refit until it stops moving. That is a local peak; its altitude is the hill's height.
 *   3. Main hill (~10000 m) ⇒ its centre is the password. A decoy ⇒ it is k ≈ (10000 − height)/2600 hills
 *      from the main one, ~3 widths per hill, on a side no reading reliably reveals. Jump k hills each
 *      way, fit again, keep the higher peak.
 * Below difficulty 8 there is one hill and this takes ~3 guesses. The old halving climb stays as the
 * fallback if a fit ever goes nowhere.
 * Returns { pw, guesses } or { pw: null, guesses, why }.
 */
export async function solveKing({ length }, ask, { maxGuesses = 80 } = {}) {
	let guesses = 0;
	let winner = null;
	let dead = false; // the oracle stopped answering
	const tried = new Map(); // guess → altitude
	const send = async (n) => {
		if (winner || dead || guesses >= maxGuesses) return null;
		if (tried.has(n)) return tried.get(n);
		guesses++;
		const r = await ask(String(n));
		if (r === "win") winner = String(n);
		else if (r == null) dead = true;
		else tried.set(n, r);
		return tried.get(n) ?? null;
	};
	const over = () => winner || dead || guesses >= maxGuesses;
	const done = (why) => (winner ? { pw: winner, guesses } : { pw: null, guesses, why: dead ? "no feedback" : why });
	const lo = length === 1 ? 0 : 10 ** (length - 1);
	const hi = 10 ** length - 1;
	const w = hillWidth(length);
	const clamp = (n) => Math.min(hi, Math.max(lo, Math.round(n)));
	const half = Math.max(1, Math.round(w / 2));

	// Fit-and-move until the centre stops moving; returns [peak x, its altitude] or null.
	const findPeak = async (x0) => {
		let x = clamp(x0);
		for (let i = 0; i < 8 && !over(); i++) {
			const a = await send(x);
			if (a == null) return null;
			const x2 = x + half <= hi ? x + half : x - half;
			const a2 = await send(x2);
			if (a2 == null) return null;
			const c = hillCenter(x, a, x2, a2, w);
			if (c == null) return [x, a];
			const next = clamp(c);
			if (next === x) {
				// At the peak: the password is an integer, so also try the neighbours the rounding could hide.
				for (const n of [x - 1, x + 1]) if (n >= lo && n <= hi) await send(n);
				return [x, a];
			}
			x = next;
		}
		return tried.has(x) ? [x, tried.get(x)] : null;
	};

	// 1. Find ground.
	const seeds = [Math.round((lo + hi) / 2), clamp(lo + 27 * w), clamp(hi - 27 * w), lo, hi];
	let start = null;
	for (const x of seeds) {
		const a = await send(x);
		if (over()) return done("no ground found");
		if (a > 0) {
			start = x;
			break;
		}
	}
	if (start == null) return done("every probe read 0 m");

	// 2–3. Peak, then hop toward the main hill. Decoys sit about k·3 widths away on BOTH sides, and no reading
	// reliably says which side the main hill is on (inside 3% of the password only the main hill counts, so
	// valleys mislead). So jump k hills each way and keep whichever lands on higher ground.
	let best = await findPeak(start);
	for (let hop = 0; hop < 12 && best && !over(); hop++) { // each hop must gain height, so this ends
		const [x, h] = best;
		const k = Math.max(1, Math.round((PEAK - h) / 2600));
		let higher = null;
		for (const dir of [1, -1]) {
			const to = clamp(x + dir * k * 3 * w);
			if (to === x || over()) continue;
			const p = await findPeak(to);
			if (p && p[1] > h + 100) {
				higher = p;
				break;
			}
		}
		if (!higher) break;
		best = higher;
	}
	if (over()) return done("never reached the peak");

	// Fallback: climb from the highest point so far with halving strides.
	const highest = () => [...tried.entries()].reduce((a, b) => (b[1] > a[1] ? b : a), [null, -1]);
	let stride = Math.max(1, Math.floor((hi - lo) / 4));
	for (let rounds = 0; rounds < 60 && !over(); rounds++) {
		const [x, alt] = highest();
		for (const n of [x - stride, x + stride]) if (fits(n, length) && !tried.has(n)) await send(n);
		if (highest()[1] <= alt) {
			if (stride === 1) break;
			stride = Math.max(1, Math.floor(stride / 2));
		}
	}
	return done("never reached the peak");
}

// ── The Labyrinth: walk a maze ────────────────────────────────────────────────────────────────────
// [SRC v3.0.1 DarkNet/effects/labyrinth.ts] authenticate(lab, "north"|"east"|"south"|"west") moves 2 cells.
// Unlike every other model, the reply itself carries the feedback: 401 + "You have moved to x,y." + the 3×3
// around you as `data` ("█" wall, " " open, "@" you), or 401 "You cannot go that way…", or 200 at the exit.
// The maze is four stitched recursive-backtracker mazes (near-perfect, few loops); labs 1–2 start at (1,1)
// and end near the bottom-right corner, so south/east go first.

export const LAB_DIRS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };
const PREFER = ["south", "east", "north", "west"];

/** 3×3 surroundings text → which of the four directions are open. null if it isn't a 3×3 picture. */
export function parseSurroundings(data) {
	const rows = String(data ?? "").split("\n");
	if (rows.length !== 3 || rows.some((r) => [...r].length !== 3)) return null;
	const cell = (r, c) => [...rows[r]][c];
	const open = (ch) => ch !== "█";
	return { north: open(cell(0, 1)), east: open(cell(1, 2)), south: open(cell(2, 1)), west: open(cell(1, 0)) };
}

/** "You have moved to 3,5." / "You are still at 3,5." → [3, 5], else null. */
export function parseLabCoords(message) {
	const m = /(-?\d+)\s*,\s*(-?\d+)/.exec(String(message ?? ""));
	return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Depth-first walk with a remembered map. `step(dir)` performs one move and resolves to:
 *   { win: true }                          reached the exit
 *   { moved: true, open, pos? }            moved; `open` = parseSurroundings of the new cell
 *   { wall: true }                         that way is blocked (we stay put)
 *   null                                   stop (lost connection, not enough charisma, …)
 * `start` = { pos: [x, y], open }. Each cell is entered at most twice (in, and back out), so a perfect
 * maze of N cells takes ≤ 2N moves. `onMove(info)` lets the caller report progress.
 * Returns { done: true, moves } | { done: false, moves, why }.
 */
export async function walkLabyrinth(start, step, { maxMoves = 5000, onMove = () => {} } = {}) {
	const key = ([x, y]) => `${x},${y}`;
	let pos = start.pos;
	let open = { ...start.open };
	const seen = new Set([key(pos)]);
	const trail = []; // directions taken from the start to here
	let moves = 0;
	const next = (p, d) => [p[0] + LAB_DIRS[d][0] * 2, p[1] + LAB_DIRS[d][1] * 2];

	while (moves < maxMoves) {
		const fresh = PREFER.find((d) => open[d] && !seen.has(key(next(pos, d))));
		const dir = fresh ?? (trail.length ? OPPOSITE[trail[trail.length - 1]] : null);
		if (!dir) return { done: false, moves, why: "explored everything, no exit found" };
		moves++;
		const r = await step(dir);
		if (r == null) return { done: false, moves, why: "stopped" };
		if (r.win) return { done: true, moves };
		if (r.wall) {
			open[dir] = false; // our picture was wrong; don't try it again from here
			continue;
		}
		pos = r.pos ?? next(pos, dir);
		open = { ...r.open };
		if (fresh) {
			seen.add(key(pos));
			trail.push(dir);
		} else {
			trail.pop();
		}
		onMove({ moves, pos, explored: seen.size, backtracking: !fresh });
	}
	return { done: false, moves, why: `gave up after ${maxMoves} moves` };
}
