/**
 * dnet-constraints.js — a per-host password constraint model for the DarkNet solver.
 *
 * PURE (no ns.*): costs zero script RAM in-game, and is unit-testable under Node
 * (see dnet-constraints.test.mjs). Named dnet-* so it rides the crawler/looter payload glob.
 *
 * The idea (see darknet-design.md → "The shape I'd reach for instead"): every scrap we learn
 * about a node's password — from getServerDetails (length/format/model/hint) OR from looted
 * intel (.data.txt / .lit / heartbleed) — becomes a PREDICATE. Producers propose candidates;
 * satisfies() disposes. So a single looted "contains 3 and 1" narrows EVERY strategy at once
 * (defaults, multiples, permutations, brute), not just its own — that's the whole point, and
 * it means FEWER authenticate calls, which matters because nodes 503-rate-limit brute-force.
 *
 * Two jobs:
 *   parseText()/constraintsFor()  — text → predicates  (the collectors)
 *   satisfies()/generate()        — predicates → ordered candidates  (the consumer)
 */

const DEFAULTS = ["admin", "password", "root", "1234", "0000", "guest", "12345", "letmein", "toor"];

/** An empty constraint set — the shape every producer fills in. */
export function emptyConstraints() {
	return {
		length: null, // exact length, or null if unknown
		format: "", // "numeric" | "alphabetic" | "alphanumeric" | ""
		literals: [], // exact candidate answers — tried first (highest confidence)
		mustContain: [], // chars the password must include (looted "contains 3 and 1")
		permutationOf: null, // answer is some permutation of these chars ("sorted the password: 346")
		divisibleBy: null, // numeric answer is a multiple of this ("divisible by 7")
		between: null, // [lo, hi] inclusive numeric range ("a number between 10 and 20")
		pool: [], // wordlist candidates (.lit trivia answer keys)
	};
}

const uniq = (a) => [...new Set(a)];

/** Fold partial `b` into `a` (scalars: first-set wins; arrays: union). Returns a new set. */
export function merge(a, b) {
	const out = emptyConstraints();
	out.length = a.length ?? b.length;
	out.format = a.format || b.format;
	out.permutationOf = a.permutationOf ?? b.permutationOf;
	out.divisibleBy = a.divisibleBy ?? b.divisibleBy;
	out.between = a.between ?? b.between;
	out.literals = uniq([...a.literals, ...b.literals]);
	out.mustContain = uniq([...a.mustContain, ...b.mustContain]);
	out.pool = uniq([...a.pool, ...b.pool]);
	return out;
}

function romanToInt(s) {
	const val = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
	let total = 0;
	for (let i = 0; i < s.length; i++) {
		if (val[s[i]] == null) return 0;
		total += val[s[i]] < (val[s[i + 1]] || 0) ? -val[s[i]] : val[s[i]];
	}
	return total;
}

const sortChars = (s) => String(s).split("").sort().join("");

function permutations(str) {
	const s = String(str);
	if (!s || s.length > 5) return []; // >120 perms is more than the rate limit would ever allow
	const out = new Set();
	const go = (pre, rest) => {
		if (!rest.length) return void out.add(pre);
		for (let i = 0; i < rest.length; i++) go(pre + rest[i], rest.slice(0, i) + rest.slice(i + 1));
	};
	go("", s);
	return [...out];
}

/**
 * Parse one line of text (a hint, a data leak, a looted file) into whatever predicates it
 * yields. `ctx` carries the known {length, format} so numeric extraction knows what to grab.
 * Conservative on purpose: a stray word should NOT become a guess (guesses are rate-limited).
 */
export function parseText(text, ctx = {}) {
	const c = emptyConstraints();
	if (text == null) return c;
	const s = String(text);
	const numeric = String(ctx.format ?? "").includes("numeric");
	const len = ctx.length ?? null;
	let m;

	// "contains 3 and 1" / "contains 4, 5 and 6" → required chars (single tokens only).
	if ((m = /contains\s+([^.!?]*)/i.exec(s))) {
		for (const t of m[1].split(/[\s,]+|\band\b/i)) if (/^[0-9a-z]$/i.test(t.trim())) c.mustContain.push(t.trim());
	}
	// "a number between 10 and 20" → inclusive range. (Runs before nothing else touches "and".)
	if ((m = /between\s+(\d+)\s+and\s+(\d+)/i.exec(s))) c.between = [Number(m[1]), Number(m[2])].sort((a, b) => a - b);
	// "the password is divisible by 7" → multiples.
	if ((m = /divisible by\s+(\d+)/i.exec(s))) c.divisibleBy = Number(m[1]);
	// "I accidentally sorted the password: 346" / "an anagram of 346" → permutation (numeric only, so far).
	if ((m = /(?:sorted|anagram of|rearranged)\D*(\d+)/i.exec(s))) c.permutationOf = m[1];
	// "the value of the number 'XL'" → resolved integer literal.
	if ((m = /'([ivxlcdm]{1,8})'/i.exec(s)) || (m = /\b(?:roman numeral|value of(?: the number)?)\s+([ivxlcdm]+)\b/i.exec(s))) {
		const v = romanToInt(m[1].toUpperCase());
		if (v > 0) {
			c.literals.push(String(v));
			if (len) c.literals.push(String(v).padStart(len, "0"));
		}
	}
	// "the base 9 number 548 in base 10" → convert 548 FROM base 9 → 449 (OctantVoxel). Base varies per
	// node; read it from the hint, or from the `data` field's structured "base,number" form (e.g. "9,548").
	if ((m = /base\s+(\d{1,2})\s+number\s+([0-9a-z]+)/i.exec(s)) || (m = /^\s*(\d{1,2})\s*,\s*([0-9a-z]+)\s*$/i.exec(s))) {
		const base = Number(m[1]);
		const digits = m[2].toLowerCase();
		if (base >= 2 && base <= 36 && [...digits].every((ch) => parseInt(ch, 36) < base)) {
			const v = parseInt(digits, base);
			if (Number.isFinite(v)) {
				c.literals.push(String(v));
				if (len) c.literals.push(String(v).padStart(len, "0"));
			}
		}
	}
	// Explicit leak: "The PIN is 77", "Remember this password: 428", "the code = 1234".
	if ((m = /(?:password|pin|code|answer|secret)\b\D*?(\d{1,8})/i.exec(s)) && numeric) c.literals.push(m[1]);
	if (!numeric && (m = /(?:password|pin|code|answer|name|secret)\b(?:\s+is|\s*[:=])\s*"?([a-z0-9]{2,})"?/i.exec(s))) c.literals.push(m[1]);
	// Numeric leaks of the right length: contiguous run, or scattered digits (captcha "3(8~6" → 386).
	if (numeric && len) {
		const runs = s.match(new RegExp(`\\d{${len}}`, "g")) || [];
		for (const r of runs) c.literals.push(r);
		const digits = s.replace(/\D/g, "");
		if (digits.length === len) c.literals.push(digits);
	}
	c.literals = uniq(c.literals);
	c.mustContain = uniq(c.mustContain);
	return c;
}

/**
 * Strip HTML tags and decode the common entities that leak into looted .lit/.data.txt flavor text
 * (the game stores MUI-rendered markup verbatim, so you see `<p class="Mui…">` and `&#x27;`).
 * Cosmetic for logs — but also CORRECTNESS: darknet node names contain '&' (e.g.
 * `5e7aico55a_&_namhcab`), so an HTML-escaped `…&amp;…` hostname wouldn't match the loot parser's
 * regex and a free cred would silently fail to land. Decode before parsing AND before display.
 */
export function decodeEntities(text) {
	if (text == null) return "";
	let s = String(text)
		.replace(/<br\s*\/?>/gi, " ") // line breaks → space, so one-line logs stay readable
		.replace(/<[^>]+>/g, ""); // drop remaining tags
	s = s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
	const named = { lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
	s = s.replace(/&(lt|gt|quot|apos|nbsp);/g, (_, n) => named[n]).replace(/&amp;/g, "&"); // &amp; last
	return s.trim();
}

/** Extract candidate words from a looted .lit wordlist (the trivia answer keys). */
export function wordsFromLit(text) {
	if (text == null) return [];
	return uniq((String(text).match(/[a-z]{2,}/gi) || []).map((w) => w.toLowerCase()));
}

/**
 * Harvest reusable password candidates from looted text for the solver's pool:
 *   · comma-lists of ≥3 tokens — "Maybe fido, spot, rover, max?", "common passwords include a, b, c",
 *     "factory default is one of admin, password, 0000" (prose rarely has ≥3 comma-separated tokens);
 *   · loose single creds — "Remember this password: 428".
 * Pooled candidates are still filtered per-node by satisfies(), so length/format/contains prune them.
 */
export function harvestCandidates(text) {
	if (text == null) return [];
	const s = String(text);
	const out = [];
	const list = /[A-Za-z0-9]+(?:\s*,\s*[A-Za-z0-9]+){2,}/g;
	let m;
	while ((m = list.exec(s))) for (const t of m[0].split(/\s*,\s*/)) out.push(t.trim());
	if ((m = /Remember this password:\s*([A-Za-z0-9]+)/i.exec(s))) out.push(m[1]);
	return uniq(out.filter(Boolean));
}

/** Build a constraint set from server details + any looted text lines + an optional wordlist pool. */
export function constraintsFor({ details = {}, texts = [], pool = [] } = {}) {
	let c = emptyConstraints();
	const rawLen = Number(details.length);
	c.length = Number.isFinite(rawLen) && details.length != null && details.length !== "" ? rawLen : null;
	c.format = String(details.format ?? "").toLowerCase();
	const ctx = { length: c.length, format: c.format };
	for (const line of [details.hint, details.data, ...texts]) if (line != null) c = merge(c, parseText(line, ctx));
	if (pool.length) c = merge(c, { ...emptyConstraints(), pool: uniq(pool) });
	return c;
}

/** Does candidate `v` violate any known predicate? The universal filter every producer runs through. */
export function satisfies(c, v) {
	v = String(v);
	if (c.length != null && v.length !== c.length) return false;
	if (c.format.includes("numeric") && !/^\d*$/.test(v)) return false;
	if (c.format.includes("alphabetic") && !/^[a-z]*$/i.test(v)) return false;
	if (c.mustContain.length && !c.mustContain.every((ch) => v.includes(String(ch)))) return false;
	if (c.divisibleBy != null && (!/^\d+$/.test(v) || Number(v) % c.divisibleBy !== 0)) return false;
	if (c.between != null && (!/^\d+$/.test(v) || Number(v) < c.between[0] || Number(v) > c.between[1])) return false;
	if (c.permutationOf != null && sortChars(v) !== sortChars(c.permutationOf)) return false;
	return true;
}

/**
 * Turn a constraint set into an ordered, deduped candidate list — cheapest/highest-confidence
 * first, every candidate pre-filtered through satisfies(). Adaptive strategies (Mastermind
 * positional broadcast) are NOT here; they need per-guess feedback and live in the solver.
 */
export function generate(c, { limit = 1000, poolLimit = 40 } = {}) {
	const out = [];
	const seen = new Set();
	const push = (v) => {
		if (v == null || out.length >= limit) return;
		v = String(v);
		if (!seen.has(v) && satisfies(c, v)) {
			seen.add(v);
			out.push(v);
		}
	};

	if (c.length === 0) push(""); // ZeroLogon empty password
	for (const l of c.literals) push(l); // literal leaks / captcha / resolved roman
	// Wordlist/loose-cred pool — capped so a big numeric list can't spend us into a 503.
	let pooled = 0;
	for (const w of c.pool) {
		if (pooled >= poolLimit) break;
		const n = out.length;
		push(w);
		if (out.length > n) pooled++;
	}
	if (c.permutationOf != null) for (const p of permutations(c.permutationOf)) push(p);

	const smallNumeric = c.format.includes("numeric") && c.length != null && c.length > 0 && c.length <= 4;
	if (c.divisibleBy != null && smallNumeric) {
		for (let n = 0; n < 10 ** c.length && out.length < limit; n += c.divisibleBy) push(String(n).padStart(c.length, "0"));
	}
	if (c.between != null && c.length != null && c.length > 0) {
		const hi = Math.min(c.between[1], 10 ** c.length - 1);
		for (let n = c.between[0]; n <= hi && out.length < limit; n++) push(String(n).padStart(c.length, "0"));
	}
	for (const d of DEFAULTS) push(d); // FreshInstall etc. — filtered to plausible ones by satisfies()
	return out;
}

/** Short one-line description of a constraint set, for solver logs. */
export function describe(c) {
	const p = [];
	if (c.length != null) p.push(`len=${c.length}`);
	if (c.format) p.push(c.format);
	if (c.mustContain.length) p.push(`has[${c.mustContain.join("")}]`);
	if (c.divisibleBy != null) p.push(`÷${c.divisibleBy}`);
	if (c.between) p.push(`${c.between[0]}-${c.between[1]}`);
	if (c.permutationOf) p.push(`perm(${c.permutationOf})`);
	if (c.literals.length) p.push(`lit[${c.literals.length}]`);
	if (c.pool.length) p.push(`pool[${c.pool.length}]`);
	return p.join(" ") || "no constraints";
}

export { DEFAULTS };
