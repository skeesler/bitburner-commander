/**
 * contract-finder.test.mjs — Node spec for the coding-contract solvers.
 *
 * Not a Bitburner script (.mjs, so the game's file-sync ignores it). Runs under Node:
 *   node contract-finder.test.mjs
 *
 * WHY this exists: a wrong answer BURNS one of a contract's limited tries. contract-finder.js is
 * built never to guess blind, so every solver added to it has to be right the first time — "it looks
 * correct" is not a standard we can afford. These cases are hand-traced against the v3.0.1 contract
 * sources (src/CodingContract/contracts/), and the dispatch keys are the exact strings a live
 * `getContractType()` returned on 2026-09-02, not names copied out of the source enum.
 *
 * Currently covers the four solvers added after a BN9 run showed 4 of 11 contracts being skipped.
 */
import {
	lzDecompress, hammingDecode, squareRootNearest, findMathExpressions,
	lzCompress, hammingEncode, largestRectangle, totalPrimesInRange,
	solvers,
} from "./contract-finder.js";

/** Deterministic PRNG so a failure is reproducible — never Math.random in a spec. */
let _seed = 20260903;
const rnd = (n) => ((_seed = (_seed * 1103515245 + 12345) & 0x7fffffff) % n);

/**
 * Independent brute-force optimum for LZ compression, used to prove lzCompress is OPTIMAL and not
 * merely valid — the contract accepts `answer.length <= encoded.length` against the game's own DP,
 * so a correct-but-longer encoding still fails.
 *
 * Deliberately written a different way from the solver (recursive with an explicit "just emitted a
 * zero-length chunk" flag, versus the solver's four iterative tables) so a flaw in the solver's
 * reasoning cannot reproduce itself here.
 */
function bruteOptimalLzLength(plain) {
	const n = plain.length;
	const memo = new Map();
	const go = (pos, literal, justZero) => {
		if (pos === n) return 0;
		const key = `${pos}|${literal ? 1 : 0}|${justZero ? 1 : 0}`;
		if (memo.has(key)) return memo.get(key);
		let best = Infinity;
		if (!justZero) best = Math.min(best, 1 + go(pos, !literal, true));   // zero-length: switch type
		if (literal) {
			for (let L = 1; L <= 9 && pos + L <= n; L++) best = Math.min(best, 1 + L + go(pos + L, false, false));
		} else {
			for (let X = 1; X <= 9 && X <= pos; X++) {
				for (let L = 1; L <= 9 && pos + L <= n; L++) {
					let matches = true;
					for (let k = 0; k < L; k++) if (plain[pos + k] !== plain[pos - X + k]) { matches = false; break; }
					if (!matches) break;
					best = Math.min(best, 2 + go(pos + L, true, false));
				}
			}
		}
		memo.set(key, best);
		return best;
	};
	return go(0, true, false);
}

/** Independent max all-zero rectangle AREA, by checking every rectangle. Grids are tiny (4-15/side). */
function bruteMaxZeroArea(grid) {
	const rows = grid.length, cols = grid[0].length;
	let best = 0;
	for (let r1 = 0; r1 < rows; r1++) for (let r2 = r1; r2 < rows; r2++)
		for (let c1 = 0; c1 < cols; c1++) for (let c2 = c1; c2 < cols; c2++) {
			let clean = true;
			for (let r = r1; r <= r2 && clean; r++) for (let c = c1; c <= c2; c++) if (grid[r][c] === 1) { clean = false; break; }
			if (clean) best = Math.max(best, (r2 - r1 + 1) * (c2 - c1 + 1));
		}
	return best;
}

/** Mirror of the game's validator: in bounds, contains no 1s, and area equals the true maximum. */
function rectangleAccepted(grid, answer) {
	const rows = grid.length, cols = grid[0].length;
	const [[a, b], [c, d]] = answer;
	if ([a, c].some((r) => r < 0 || r > rows - 1)) return false;
	if ([b, d].some((x) => x < 0 || x > cols - 1)) return false;
	const minR = Math.min(a, c), maxR = Math.max(a, c);
	const minC = Math.min(b, d), maxC = Math.max(b, d);
	for (let r = minR; r <= maxR; r++) if (grid[r].slice(minC, maxC + 1).includes(1)) return false;
	return (maxR - minR + 1) * (maxC - minC + 1) === bruteMaxZeroArea(grid);
}

/** Independent prime count by trial division, to cross-check the sieve. */
function bruteCountPrimes(low, high) {
	let count = 0;
	for (let x = Math.max(2, low); x <= high; x++) {
		let prime = true;
		for (let f = 2; f * f <= x; f++) if (x % f === 0) { prime = false; break; }
		if (prime) count++;
	}
	return count;
}

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
	if (cond) {
		pass++;
		console.log(`  ✓ ${name}`);
	} else {
		fail++;
		console.log(`  ✗ ${name}${extra ? "  — " + extra : ""}`);
	}
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);
const sameSet = (name, got, want) => {
	const a = [...got].sort().join("|");
	const b = [...want].sort().join("|");
	ok(name, a === b, `got [${a}], want [${b}]`);
};

console.log("\nCompression II: LZ Decompression");
// The worked example from the contract description. Traced by hand:
//   "5aaabb"  literal 5           -> "aaabb"
//   "45"      backref L=4 X=5     -> +"aaab"            (reads from a window that moves as it writes)
//   "0"       literal 0           -> nothing, chunk ends, NO characters consumed
//   "72"      backref L=7 X=2     -> +"abababa"         (offset < length, so it repeats itself)
//   "3abb"    literal 3           -> +"abb"
eq("worked example from the description", lzDecompress("5aaabb450723abb"), "aaabbaaababababaabb");
eq("a lone literal chunk", lzDecompress("3abc"), "abc");
// Offset 1 repeats the final character — the format's run-length encoding.
eq("backref with offset 1 repeats the last char", lzDecompress("3abc21"), "abccc");
eq("empty input", lzDecompress(""), "");
// A zero-length BACKREF chunk must not eat an offset digit. If it did, the stream would desync here
// and the trailing literal would be misread — this is the single easiest way to get LZ wrong.
eq("zero-length backref consumes no offset digit", lzDecompress("3abc03def"), "abcdef");

console.log("\nHammingCodes: Encoded Binary to Integer");
// Built by hand for the value 8 (data bits 1000):
//   idx0 overall parity | idx1,2,4 section parity | idx3,5,6,7 data
//   p1 covers 3,5,7 = 1 -> 1 ; p2 covers 3,6,7 = 1 -> 1 ; p4 covers 5,6,7 = 0 -> 0
//   bits 1..7 sum to 3 (odd) so the overall parity bit is 1  =>  "11110000"
eq("clean codeword decodes to 8", hammingDecode("11110000"), 8);
// Same codeword with index 5 flipped. XOR of set indices 1^2^3^5 = 5, which IS the error position.
eq("single-bit error at index 5 is corrected", hammingDecode("11110100"), 8);
eq("smallest codeword decodes to 1", hammingDecode("1111"), 1);
// 4 flipped instead: XOR of set indices 1^2^3^4 = 4 -> corrected back to the same value.
eq("single-bit error at a parity index is corrected", hammingDecode("11111000"), 8);

console.log("\nSquare Root");
eq("0", squareRootNearest(0n), 0n);
eq("1", squareRootNearest(1n), 1n);
// 8 sits closer to 9 than to 4, so the answer rounds UP — a floor-only implementation returns 2 here
// and fails the contract. This is the case that makes "nearest" worth spelling out.
eq("8 rounds up to 3", squareRootNearest(8n), 3n);
eq("10 rounds down to 3", squareRootNearest(10n), 3n);
eq("15 rounds up to 4", squareRootNearest(15n), 4n);
eq("16 is exact", squareRootNearest(16n), 4n);
const r = 10n ** 100n + 12345678901234567890n;   // ~200 digits once squared, as the contract generates
eq("exact root of a ~200-digit square", squareRootNearest(r * r), r);
eq("one above a perfect square still rounds to it", squareRootNearest(r * r + 1n), r);
eq("one below a perfect square still rounds to it", squareRootNearest(r * r - 1n), r);
ok("returns a bigint, which is what the contract validates", typeof squareRootNearest(144n) === "bigint");
eq("accepts a string too, defensively", squareRootNearest("144"), 12n);

console.log("\nFind All Valid Math Expressions");
sameSet("123 -> 6", findMathExpressions(["123", 6]), ["1+2+3", "1*2*3"]);
// Precedence: "1*0+5" only equals 5 if * binds tighter than the running total. Evaluated strictly
// left to right it would be 5 too, but "2+3*2" below distinguishes them properly.
sameSet("105 -> 5 (no leading-zero '05')", findMathExpressions(["105", 5]), ["1*0+5", "10-5"]);
sameSet("232 -> 8 needs real precedence", findMathExpressions(["232", 8]), ["2*3+2", "2+3*2"]);
// "00" as a single operand is illegal; "0" alone is fine. Three results, not four.
sameSet("00 -> 0 rejects the '00' operand", findMathExpressions(["00", 0]), ["0+0", "0-0", "0*0"]);
sameSet("no solution returns empty", findMathExpressions(["1", 9]), []);
sameSet("single digit that matches", findMathExpressions(["9", 9]), ["9"]);

console.log("\nDispatch keys (the exact strings a live getContractType() returned)");
for (const key of [
	"Compression II: LZ Decompression",
	"HammingCodes: Encoded Binary to Integer",
	"Square Root",
	"Find All Valid Math Expressions",
]) {
	ok(`"${key}" is registered`, typeof solvers[key] === "function");
}
// Route through the dispatch table too, not just the raw functions — a solver that works but is
// registered under a typo'd key is exactly as useless as no solver at all, and that is the failure
// this repo has hit before with API names.
eq("dispatch routes LZ", solvers["Compression II: LZ Decompression"]("3abc"), "abc");
eq("dispatch routes Hamming", solvers["HammingCodes: Encoded Binary to Integer"]("1111"), 1);
eq("dispatch routes Square Root", solvers["Square Root"](16n), 4n);
sameSet("dispatch routes Math Expressions", solvers["Find All Valid Math Expressions"](["123", 6]), ["1+2+3", "1*2*3"]);

console.log("\nCompression III: LZ Compression");
// Correctness first: whatever we emit must decode back to the input, checked with the already-proven
// decoder above rather than a second hand-trace.
for (const sample of ["a", "ab", "aaaaaaaaaaaa", "abababababab", "aaabbaaababababaabb", "mississippi"]) {
	eq(`round-trips "${sample}"`, lzDecompress(lzCompress(sample)), sample);
}
// Then optimality, which is the part the contract actually grades.
for (const sample of ["a", "ab", "aaaaaaaaaaaa", "abababababab", "aaabbaaababababaabb", "mississippi"]) {
	eq(`optimal length for "${sample}"`, lzCompress(sample).length, bruteOptimalLzLength(sample));
}
// A fuzz sweep over small alphabets, where backreferences are dense and the DP has the most chances
// to pick wrong. Both properties are asserted on every sample.
let fuzzRoundTrip = 0, fuzzOptimal = 0, fuzzTotal = 0;
for (const alphabet of ["ab", "abc"]) {
	for (let len = 1; len <= 14; len++) {
		for (let trial = 0; trial < 12; trial++) {
			let str = "";
			for (let i = 0; i < len; i++) str += alphabet[rnd(alphabet.length)];
			const enc = lzCompress(str);
			fuzzTotal++;
			if (lzDecompress(enc) === str) fuzzRoundTrip++;
			if (enc.length === bruteOptimalLzLength(str)) fuzzOptimal++;
		}
	}
}
ok(`fuzz: all ${fuzzTotal} random strings round-trip`, fuzzRoundTrip === fuzzTotal, `${fuzzRoundTrip}/${fuzzTotal}`);
ok(`fuzz: all ${fuzzTotal} match the brute-force optimum`, fuzzOptimal === fuzzTotal, `${fuzzOptimal}/${fuzzTotal}`);
eq("empty input", lzCompress(""), "");

console.log("\nHammingCodes: Integer to Encoded Binary");
// The two codewords derived by hand earlier, now as the encoder's problem.
eq("8 encodes to the hand-derived codeword", hammingEncode(8), "11110000");
eq("1 encodes to the smallest codeword", hammingEncode(1), "1111");
// The strongest available check: encode then decode with the separately-tested decoder.
let rt = 0, rtTotal = 0;
for (const v of [1, 2, 3, 4, 7, 8, 15, 16, 31, 42, 100, 255, 256, 1000, 65535, 1048576, 123456789]) {
	rtTotal++;
	if (hammingDecode(hammingEncode(v)) === v) rt++;
}
for (let v = 1; v <= 200; v++) { rtTotal++; if (hammingDecode(hammingEncode(v)) === v) rt++; }
ok(`encode -> decode round-trips for all ${rtTotal} values`, rt === rtTotal, `${rt}/${rtTotal}`);
// And the codeword must genuinely be error-correcting: flip any single bit, still decodes.
let corrected = 0, flips = 0;
for (const v of [8, 42, 255, 1000]) {
	const code = hammingEncode(v);
	for (let i = 0; i < code.length; i++) {
		const bad = code.slice(0, i) + (code[i] === "0" ? "1" : "0") + code.slice(i + 1);
		flips++;
		if (hammingDecode(bad) === v) corrected++;
	}
}
ok(`every one of ${flips} single-bit flips is corrected`, corrected === flips, `${corrected}/${flips}`);

console.log("\nLargest Rectangle in a Matrix");
// NOTE: zeros, not ones — and the answer is [[r1,c1],[r2,c2]] with the far corner INCLUSIVE.
const grid1 = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0]];
ok("accepts the 2x4 zero block", rectangleAccepted(grid1, largestRectangle(grid1)));
const grid2 = [[1, 1, 1], [1, 0, 1], [1, 1, 1]];
ok("single zero cell", rectangleAccepted(grid2, largestRectangle(grid2)));
const grid3 = [[0, 0], [0, 0]];
ok("all zeros takes the whole grid", rectangleAccepted(grid3, largestRectangle(grid3)));
const grid4 = [[0, 1, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 0, 0, 0], [1, 1, 0, 0, 0]];
ok("column-split grid", rectangleAccepted(grid4, largestRectangle(grid4)));
ok("returns [row,col] pairs of numbers", (() => {
	const a = largestRectangle(grid1);
	return Array.isArray(a) && a.length === 2 && a.every((x) => Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === "number"));
})());
// Fuzz across the size range the game generates (4-15 per side).
let rectOk = 0, rectTotal = 0;
for (let trial = 0; trial < 60; trial++) {
	const rows = 4 + rnd(12), cols = 4 + rnd(12);
	const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rnd(100) < 30 ? 1 : 0)));
	if (bruteMaxZeroArea(grid) === 0) continue;              // all-1s grid has no valid answer at all
	rectTotal++;
	if (rectangleAccepted(grid, largestRectangle(grid))) rectOk++;
}
ok(`fuzz: all ${rectTotal} random grids find a maximal rectangle`, rectOk === rectTotal, `${rectOk}/${rectTotal}`);

console.log("\nTotal Number of Primes");
eq("[0,20] inclusive", totalPrimesInRange([0, 20]), 8);          // 2 3 5 7 11 13 17 19
eq("[1,1] has none", totalPrimesInRange([1, 1]), 0);
eq("[2,2] is prime", totalPrimesInRange([2, 2]), 1);
eq("[0,1] has none", totalPrimesInRange([0, 1]), 0);
eq("both ends inclusive: [7,11]", totalPrimesInRange([7, 11]), 2);   // 7 and 11 — both endpoints count
eq("pi(1000)", totalPrimesInRange([1, 1000]), 168);
eq("pi(10000)", totalPrimesInRange([1, 10000]), 1229);
// Cross-check the sieve against trial division rather than against remembered pi() values.
eq("agrees with trial division on [1,2000]", totalPrimesInRange([1, 2000]), bruteCountPrimes(1, 2000));
eq("agrees with trial division on [4990,5200]", totalPrimesInRange([4990, 5200]), bruteCountPrimes(4990, 5200));
ok("returns a number", typeof totalPrimesInRange([1, 10]) === "number");

console.log("\nDispatch keys for the second batch");
for (const key of [
	"Compression III: LZ Compression",
	"HammingCodes: Integer to Encoded Binary",
	"Largest Rectangle in a Matrix",
	"Total Number of Primes",
]) {
	ok(`"${key}" is registered`, typeof solvers[key] === "function");
}
eq("dispatch routes LZ Compression", lzDecompress(solvers["Compression III: LZ Compression"]("mississippi")), "mississippi");
eq("dispatch routes Hamming encode", solvers["HammingCodes: Integer to Encoded Binary"](8), "11110000");
eq("dispatch routes Total Primes", solvers["Total Number of Primes"]([0, 20]), 8);
ok("dispatch routes Largest Rectangle", rectangleAccepted(grid1, solvers["Largest Rectangle in a Matrix"](grid1)));

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass}/${pass + fail} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
