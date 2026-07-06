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

console.log(`\n${fail ? "✗" : "✓"} ${pass}/${pass + fail} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
