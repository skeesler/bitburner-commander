/**
 * dnet-constraints.test.mjs — Node spec for the pure constraint model.
 *
 * Not a Bitburner script (.mjs, so the game's file-sync ignores it). Runs under Node:
 *   node dnet-constraints.test.mjs
 *
 * Proves generate() produces the known answer as an early candidate for every archetype in
 * darknet-design.md, and that looted "contains X and Y" intel narrows the search — the flywheel.
 */
import { constraintsFor, decodeEntities, generate, harvestCandidates, parseText, satisfies, wordsFromLit } from "./dnet-constraints.js";
import { distanceFromAltitude, parseAltitude, parseLabCoords, parseSpice, parseSurroundings, solveKing, solveSpice, walkLabyrinth } from "./dnet-strategies.js";

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

// Candidates for a node, given its details + any looted text + optional wordlist pool.
const cands = (details, texts = [], pool = []) => generate(constraintsFor({ details, texts, pool }));
const has = (arr, v) => arr.includes(v);

console.log("\nArchetypes (design-doc table) — answer must appear as a candidate:");

// FreshInstall — default password. Numeric → 0000/1234; alphabetic → admin.
{
	const num = cands({ hint: "I never changed the password", length: 4, format: "numeric" });
	ok("FreshInstall numeric → 0000 in, 'admin' out", has(num, "0000") && has(num, "1234") && !has(num, "admin"), JSON.stringify(num.slice(0, 4)));
	const alpha = cands({ hint: "I never changed the password", length: 5, format: "alphabetic" });
	ok("FreshInstall alphabetic → admin", has(alpha, "admin"), JSON.stringify(alpha.slice(0, 4)));
}

// DeskMemo — literal leak in the hint. Answer should be first (highest confidence).
{
	const c = cands({ hint: "The PIN is 77", length: 2, format: "numeric" });
	ok("DeskMemo literal → 77 first", c[0] === "77", JSON.stringify(c.slice(0, 4)));
}

// Literal password lying around in a looted .data.txt (login.data.txt: "Remember this password: 428").
{
	const c = cands({ length: 3, format: "numeric" }, ["Remember this password: 428"]);
	ok("looted literal → 428 in", has(c, "428"), JSON.stringify(c.slice(0, 4)));
}

// CloudBlare — captcha in `data`, scattered non-format chars stripped: 3(8~6 → 386.
{
	const c = cands({ data: "3(8~6", length: 3, format: "numeric" });
	ok("CloudBlare captcha → 386 in", has(c, "386"), JSON.stringify(c.slice(0, 4)));
}

// PHP 5.4 — "sorted the password: 346" → some permutation of those digits.
{
	const c = cands({ hint: "I accidentally sorted the password: 346", length: 3, format: "numeric" });
	const allPerms = ["346", "364", "436", "463", "634", "643"].every((p) => has(c, p));
	ok("PHP 5.4 anagram → all 6 perms of 346", allPerms, JSON.stringify(c.slice(0, 6)));
}

// PHP 5.4 variant — "The PIN uses 035" (different phrasing, + bare-digit `data`) → perms of 035.
{
	const c = cands({ hint: "The PIN uses 035", data: "035", length: 3, format: "numeric" });
	const allPerms = ["035", "053", "305", "350", "503", "530"].every((p) => has(c, p));
	ok("PHP 5.4 'uses' → all 6 perms of 035", allPerms, JSON.stringify(c.slice(0, 6)));
	ok("PHP 5.4 'uses' → every candidate is a permutation of 035", c.length > 0 && c.every((v) => [...v].sort().join("") === "035"), JSON.stringify(c));
}

// PHP 5.4 variant — "The key is made from 589" (field FAILED, h4cker;cit4de1, 2026-07-09) → perms of 589.
// New phrasing ("made from", non-"password/pin" noun "key"); must map to the same anagram model.
{
	const c = cands({ hint: "The key is made from 589", length: 3, format: "numeric" });
	const allPerms = ["589", "598", "859", "895", "958", "985"].every((p) => has(c, p));
	ok("PHP 5.4 'made from' → all 6 perms of 589", allPerms, JSON.stringify(c.slice(0, 6)));
	ok("PHP 5.4 'made from' → every candidate is a permutation of 589", c.length > 0 && c.every((v) => [...v].sort().join("") === "589"), JSON.stringify(c));
}

// PHP 5.4 variant — "The password is shuffled 446" (field FAILED, 2026-07-09). Repeated digit ⇒ 3 distinct
// perms (446/464/644), and the dedupe must not emit "446"×multiple.
{
	const c = cands({ hint: "The password is shuffled 446", length: 3, format: "numeric" });
	const allPerms = ["446", "464", "644"].every((p) => has(c, p));
	ok("PHP 5.4 'shuffled' → all 3 perms of 446", allPerms, JSON.stringify(c));
	ok("PHP 5.4 'shuffled' → every candidate is a permutation of 446 (deduped)", c.length > 0 && c.every((v) => [...v].sort().join("") === "446") && new Set(c).size === c.length, JSON.stringify(c));
}

// Factori-Os — "divisible by 7" → only multiples of 7 (of the right length).
{
	const c = cands({ hint: "The password is divisible by 7", length: 3, format: "numeric" });
	ok("Factori-Os → every candidate ÷7", c.length > 0 && c.every((v) => Number(v) % 7 === 0), `${c.length} cands`);
	ok("Factori-Os → 994 (a multiple) in", has(c, "994"));
}

// BellaCuore — Roman numeral resolves to its integer value: 'XL' → 40.
{
	const c = cands({ hint: "the value of the number 'XL'", length: 2, format: "numeric" });
	ok("BellaCuore → 40 in", has(c, "40"), JSON.stringify(c.slice(0, 4)));
}

// BellaCuore long-numeral (field FAILED, 2026-07-09): 'CCCLXXXIII' = 383, 10 chars — blew the old
// {1,8} quoted-roman cap so no literal was produced and the crawler guessed randomly for 17 tries.
{
	const c = cands({ hint: "The password is the value of the number 'CCCLXXXIII'", data: "CCCLXXXIII", length: 3, format: "numeric" });
	ok("BellaCuore long numeral 'CCCLXXXIII' → 383 in", has(c, "383"), JSON.stringify(c.slice(0, 4)));
}

// OctantVoxel — base conversion: "the base 9 number 548 in base 10" → 449 (5·81 + 4·9 + 8).
{
	const c = cands({ hint: "the password is the base 9 number 548 in base 10", length: 3, format: "numeric" });
	ok("OctantVoxel base9→10 → 449 in", has(c, "449"), JSON.stringify(c.slice(0, 4)));
	const d = cands({ data: "9,548", length: 3, format: "numeric" });
	ok("OctantVoxel structured data '9,548' → 449 in", has(d, "449"), JSON.stringify(d.slice(0, 4)));
	// A digit >= base is invalid → the guard must reject it, not push parseInt's partial parse.
	// "base 8 number 519": '9' is invalid in base 8; unguarded parseInt("519",8) would stop at 9 → 41.
	ok("invalid base digit → no partial base-conversion literal (not 41)", !parseText("base 8 number 519").literals.includes("41"));
}

// Range hint — "between 10 and 20" enumerates just that band.
{
	const c = cands({ hint: "a number between 10 and 20", length: 2, format: "numeric" });
	ok("range → 15 in, all within 10–20", has(c, "15") && c.every((v) => Number(v) >= 10 && Number(v) <= 20), JSON.stringify(c));
}

// Laika4 — trivia, answer only comes from a looted .lit wordlist, filtered to the right length.
{
	const pool = wordsFromLit("dog name ideas: fido, spot, rover, max");
	const c = cands({ hint: "It's the dog's name", length: 4, format: "alphabetic" }, [], pool);
	ok("Laika4 trivia → fido/spot in (len4), rover/max out", has(c, "fido") && has(c, "spot") && !has(c, "rover") && !has(c, "max"), JSON.stringify(c.slice(0, 6)));
}

console.log("\nThe flywheel — looted 'contains X and Y' narrows an otherwise-wide crack:");

// Factori-Os divisible-by-7 alone vs. with a looted "contains 3 and 1" partial constraint.
{
	const wide = cands({ hint: "The password is divisible by 7", length: 3, format: "numeric" });
	const narrow = cands({ hint: "The password is divisible by 7", length: 3, format: "numeric" }, ["the password for this node contains 3 and 1"]);
	ok("mustContain shrinks the candidate set", narrow.length > 0 && narrow.length < wide.length, `${wide.length} → ${narrow.length}`);
	ok("every narrowed candidate ÷7 AND has 3 and 1", narrow.every((v) => Number(v) % 7 === 0 && v.includes("3") && v.includes("1")), JSON.stringify(narrow));
	ok("contains-parse pulled [3,1]", JSON.stringify(constraintsFor({ details: {}, texts: ["contains 3 and 1"] }).mustContain) === JSON.stringify(["3", "1"]));
}

console.log("\nharvestCandidates() — looted wordlists + loose creds → pool (the real haul from the field):");
{
	const dog = harvestCandidates("What should I name my dog? Maybe fido, spot, rover, max?");
	ok("dog-name-ideas.lit → fido/spot/rover/max", ["fido", "spot", "rover", "max"].every((w) => dog.includes(w)), JSON.stringify(dog));
	const common = harvestCandidates("Some common passwords include superman, 1qaz2wsx, 7777777, 121212, 0, qazwsx");
	ok("common-passwords list harvested", common.includes("superman") && common.includes("7777777"), JSON.stringify(common.slice(0, 4)));
	const factory = harvestCandidates("The factory default is usually one of admin, password, 0000, 12345.");
	ok("factory-default.lit → admin/0000", factory.includes("admin") && factory.includes("0000"), JSON.stringify(factory));
	ok("loose 'Remember this password: 428' → 428", harvestCandidates("Remember this password: 428").includes("428"));
	ok("prose without a list yields nothing", harvestCandidates("The truth can no longer hide from your gaze.").length === 0);

	// End-to-end: harvested dog names become the pool that cracks Laika4 (len4 alpha trivia).
	const c = cands({ hint: "It's the dog's name", length: 4, format: "alphabetic" }, [], dog);
	ok("Laika4 cracks from harvested pool (fido/spot in, rover/max out by length)", has(c, "fido") && has(c, "spot") && !has(c, "rover") && !has(c, "max"), JSON.stringify(c.slice(0, 6)));

	// Pool is capped so a big numeric list can't spend us into a 503.
	const bigPool = Array.from({ length: 200 }, (_, i) => String(1000 + i));
	const capped = generate(constraintsFor({ details: { length: 4, format: "numeric" }, pool: bigPool }), { poolLimit: 40 });
	ok("pool contribution capped (≤ ~40 + defaults)", capped.length <= 45, `${capped.length} candidates`);
}

console.log("\ndecodeEntities() — strip MUI markup + decode entities (readability + hostname correctness):");
{
	ok("&#x27; (hex) → apostrophe", decodeEntities("they say there&#x27;s") === "they say there's");
	ok("&#39; (decimal) → apostrophe", decodeEntities("I&#39;ll") === "I'll");
	ok("&amp; → &", decodeEntities("a&amp;b") === "a&b");
	ok("strips <p …> tags", decodeEntities('<p class="MuiTypography-root css-9l3uo3">hi</p>') === "hi");
	ok("<br/> → space, no tag residue", !/<br/i.test(decodeEntities("go deep<br/><br/>find it")));
	// The correctness bird: an HTML-escaped node name must decode so the Server-line parser matches it.
	const dec = decodeEntities('Server: 5e7aico55a_&amp;_namhcab Password: "42"');
	const m = /Server:\s*(\S+)\s+Password:\s*"([^"]*)"/i.exec(dec);
	ok("escaped '&' hostname decodes so the cred parses", !!m && m[1] === "5e7aico55a_&_namhcab" && m[2] === "42", dec);
}

console.log("\nsatisfies() unit checks:");
{
	ok("permutationOf rejects non-anagram", !satisfies(constraintsFor({ details: {}, texts: ["sorted the password: 346"] }), "347"));
	ok("mustContain rejects missing char", !satisfies({ ...constraintsFor({}), mustContain: ["9"] }, "123"));
	ok("between rejects out-of-range", !satisfies(constraintsFor({ details: { length: 2, format: "numeric" }, texts: ["between 10 and 20"] }), "21"));
	ok("'between' does not leak into mustContain", parseText("a number between 10 and 20").mustContain.length === 0);
}


// ── BN15 models, solved end to end against a simulated server ────────────────────────────────────
// The fakes reproduce v3.0.1's own formulas (DarkNet/effects/authentication.ts, ServerGenerator.ts):
// the oracle builds the exact `data` string the game would put in the heartbleed log, and the
// strategy has to parse it, so this covers grammar + algorithm together.

// Same generator as the game: random digits, leading zeros stripped by Number().
const gamePassword = (len) => {
	let s = "";
	for (let i = 0; i < Math.ceil(len); i++) s += Math.floor(Math.random() * 10);
	return Number(s).toString();
};

console.log("\nRateMyPix.Auth (bulls-only Mastermind):");
{
	ok("parseSpice '🌶️🌶️/5' → 2", parseSpice("🌶️🌶️/5") === 2);
	ok("parseSpice '0/5' → 0", parseSpice("0/5") === 0);
	ok("parseSpice ignores other grammars", parseSpice("yes,yesn't") === null && parseSpice("1234.5") === null);

	// Game: data = one "🌶️" per exact-place match, or "0", then "/" + password length.
	const spiceOracle = (pw) => async (g) => {
		if (g === pw) return "win";
		const pep = pw.split("").map((ch, i) => (ch === g[i] ? "🌶️" : "")).join("") || "0";
		return parseSpice(`${pep}/${pw.length}`);
	};
	const alpha = "0123456789".split("");
	for (const len of [1, 2, 3, 4, 5, 6]) {
		let worst = 0, total = 0, wrong = 0;
		const N = len <= 2 ? 60 : 150;
		for (let t = 0; t < N; t++) {
			let pw = gamePassword(len);
			while (pw.length !== len) pw = gamePassword(len); // the node reports its real length
			const r = await solveSpice({ length: len, alphabet: alpha }, spiceOracle(pw));
			if (r.pw !== pw) wrong++;
			worst = Math.max(worst, r.guesses);
			total += r.guesses;
		}
		ok(`len ${len}: ${N}/${N} cracked (avg ${(total / N).toFixed(1)}, worst ${worst} guesses)`, wrong === 0, `${wrong} wrong`);
	}
	// A password that changes mid-solve must end in a clean give-up, not a wrong answer.
	{
		let calls = 0;
		const flip = async (g) => spiceOracle(calls++ < 4 ? "4821" : "1739")(g);
		const r = await solveSpice({ length: 4, alphabet: alpha }, flip);
		ok("password changed mid-solve → gives up, no false crack", r.pw === null || r.pw === "1739", JSON.stringify(r));
	}
}

console.log("\nKingOfTheHill (find the peak):");
{
	ok("parseAltitude reads plain + exponent numbers", parseAltitude("9999.5") === 9999.5 && parseAltitude("3.2e-12") === 3.2e-12);
	ok("parseAltitude rejects prose", parseAltitude("current altitude: 12 m") === null);
	ok("distanceFromAltitude inverts the hill (len 2, d=7)", Math.abs(distanceFromAltitude(10000 * Math.exp(-((7 / 2) ** 2)), 2) - 7) < 1e-9);

	// The game's Wichmann–Hill RNG (Casino/RNG.ts), seeded by the password.
	class WHRNG {
		constructor(seed) {
			const v = (seed / 1000) % 30000;
			this.s1 = this.s2 = this.s3 = v;
		}
		random() {
			this.s1 = (171 * this.s1) % 30269;
			this.s2 = (172 * this.s2) % 30307;
			this.s3 = (170 * this.s3) % 30323;
			return (this.s1 / 30269 + this.s2 / 30307 + this.s3 / 30323) % 1;
		}
	}
	// getKingOfTheHillAltitude, transcribed.
	const altitude = (pwStr, difficulty, guess) => {
		const password = Number(pwStr);
		const x = Number(guess);
		const rng = new WHRNG(password);
		const hillCount = Math.min(Math.floor(difficulty / 8), 4) * 2 + 1;
		const passwordHillIndex = Math.floor(rng.random() * (hillCount - 2)) + 1;
		const width = 10 ** Math.max(pwStr.length - 2, 0) + 1;
		const hill = (loc, h) => h * Math.exp(-((x - loc) ** 2) / width ** 2);
		if (Math.abs((x - password) / password) < 0.03) return hill(password, 10000);
		let alt = 0;
		for (let i = 0; i < hillCount; i++) {
			const locationOffset = (i - passwordHillIndex) * width * 3 * (rng.random() * 0.2 + 0.9);
			const heightOffset = Math.abs((i - passwordHillIndex) * 2600) * (rng.random() * 0.1 + 0.95);
			alt += hill(password + locationOffset, 10000 - heightOffset);
		}
		return alt;
	};
	const kingOracle = (pw, difficulty) => async (g) => (g === pw ? "win" : parseAltitude(`${altitude(pw, difficulty, g)}`));

	// Password length is min(1 + difficulty/6, 10) digits, before leading zeros are stripped.
	for (const difficulty of [0, 3, 6, 7, 8, 12, 16]) {
		let worst = 0, total = 0, wrong = 0;
		const N = 120;
		for (let t = 0; t < N; t++) {
			const pw = gamePassword(Math.min(1 + difficulty / 6, 10));
			const r = await solveKing({ length: pw.length }, kingOracle(pw, difficulty));
			if (r.pw !== pw) wrong++;
			worst = Math.max(worst, r.guesses);
			total += r.guesses;
		}
		// One hill (below 8) must always crack. With decoy hills a rare miss is accepted (~1 in 1000 at
		// difficulty 16–24 in a 1000-per-tier stress run): the solver gives up cleanly and the next pass retries.
		const floor = difficulty < 8 ? N : Math.ceil(N * 0.97);
		ok(`difficulty ${difficulty}: ${N - wrong}/${N} cracked (avg ${(total / N).toFixed(1)}, worst ${worst} guesses)${difficulty < 8 ? "" : " — needs ≥97%"}`, N - wrong >= floor, `${wrong} missed`);
	}
}


console.log("\nThe Labyrinth (maze walk against the game's own generator):");
{
	// generateMaze / mazeMaker / getSurroundingsVisualized / handleLabyrinthPassword, transcribed from
	// v3.0.1 DarkNet/effects/labyrinth.ts.
	const WALL = "█", PATH = " ";
	const mazeMaker = (setWidth, setHeight) => {
		const width = setWidth % 2 === 0 ? setWidth + 1 : setWidth;
		const height = setHeight % 2 === 0 ? setHeight + 1 : setHeight;
		const maze = Array.from({ length: height }, () => Array(width).fill(WALL));
		const stack = [[1, 1]];
		const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
		while (stack.length) {
			const [x, y] = stack.pop();
			const nb = dirs.map(([dx, dy]) => [x + dx * 2, y + dy * 2]).filter(([nx, ny]) => nx > 0 && nx < width && ny > 0 && ny < height && maze[ny][nx] === WALL);
			if (nb.length) {
				stack.push([x, y]);
				const [nx, ny] = nb[Math.floor(Math.random() * nb.length)];
				maze[(y + ny) / 2][(x + nx) / 2] = PATH;
				maze[ny][nx] = PATH;
				stack.push([nx, ny]);
			}
		}
		return maze;
	};
	const generateMaze = (width, height) => {
		const hw = Math.ceil(width / 2), hh = Math.ceil(height / 2);
		const m1 = mazeMaker(hw, hh), m2 = mazeMaker(hw, hh), m3 = mazeMaker(hw, hh), m4 = mazeMaker(hw, hh);
		const top = m1.map((row, y) => row.slice(0, -1).concat(m2[y]));
		const bottom = m3.map((row, y) => row.slice(0, -1).concat(m4[y]));
		const maze = top.slice(0, -1).concat(bottom);
		const sw = m1[0].length - 1, sh = m1.length - 1;
		maze[Math.floor((Math.random() * hw) / 4) * 2 + 1][sw] = PATH;
		maze[sh][Math.floor((Math.random() * hh) / 4) * 2 + 1] = PATH;
		maze[height - (Math.floor((Math.random() * hw) / 4) + 1) * 2 - 1][sw] = PATH;
		maze[sh][width - (Math.floor((Math.random() * hh) / 4) + 1) * 2 - 1] = PATH;
		return maze.map((r) => r.join(""));
	};
	const around = (maze, x, y) => {
		const out = [];
		for (let i = y - 1; i <= y + 1; i++) {
			let row = "";
			for (let j = x - 1; j <= x + 1; j++) row += i === y && j === x ? "@" : (maze[i]?.[j] ?? PATH);
			out.push(row);
		}
		return out.join("\n");
	};
	const DIR = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
	// One lab: returns what our walker sees, through the same parse helpers dnet-lab.js uses.
	const lab = (w, h, offset) => {
		const maze = generateMaze(w, h);
		const off = () => (offset ? Math.floor(Math.random() * 3) * 2 : 0);
		const [ex, ey] = [maze[0].length - 2 - off(), maze.length - 2 - off()];
		let [x, y] = [1 + off(), 1 + off()];
		const reply = (dir) => {
			const [dx, dy] = DIR[dir];
			if (maze[y + dy]?.[x + dx] !== PATH) return { code: 401, message: `You cannot go that way. You are still at ${x},${y}.`, data: around(maze, x, y) };
			x += dx * 2;
			y += dy * 2;
			if (x === ex && y === ey) return { code: 200, message: "You have successfully navigated the labyrinth! Congratulations" };
			return { code: 401, message: `You have moved to ${x},${y}.`, data: around(maze, x, y) };
		};
		const start = { pos: [x, y], open: parseSurroundings(around(maze, x, y)) };
		// The step adapter dnet-lab.js uses, minus the network.
		const step = async (dir) => {
			const r = reply(dir);
			if (r.code === 200) return { win: true };
			if (/cannot go/i.test(r.message)) return { wall: true };
			const open = parseSurroundings(r.data);
			return open ? { moved: true, open, pos: parseLabCoords(r.message) } : null;
		};
		return { start, step, cells: Math.ceil(maze[0].length / 2) * Math.ceil(maze.length / 2) };
	};

	ok("parseSurroundings reads the 3×3", JSON.stringify(parseSurroundings("█ █\n█@ \n███")) === JSON.stringify({ north: true, east: true, south: false, west: false }));
	ok("parseLabCoords reads 'moved to 3,5'", JSON.stringify(parseLabCoords("You have moved to 3,5.")) === "[3,5]");

	const labs = [["lab 1", 20, 14, false], ["lab 2", 30, 20, false], ["lab 3", 40, 26, false], ["lab 4–5", 60, 40, true]];
	for (const [name, w, h, offset] of labs) {
		let wrong = 0, total = 0, worst = 0, cells = 0;
		const N = 100;
		for (let t = 0; t < N; t++) {
			const L = lab(w, h, offset);
			const r = await walkLabyrinth(L.start, L.step);
			if (!r.done) wrong++;
			total += r.moves;
			worst = Math.max(worst, r.moves);
			cells = L.cells;
		}
		ok(`${name} (${w}×${h}, ~${cells} cells): ${N - wrong}/${N} solved (avg ${(total / N).toFixed(0)}, worst ${worst} moves)`, wrong === 0, `${wrong} unsolved`);
	}
}

console.log(`\n${fail ? "✗" : "✓"} ${pass}/${pass + fail} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
