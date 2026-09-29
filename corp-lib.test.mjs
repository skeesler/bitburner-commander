/**
 * corp-lib.test.mjs — Node spec for the corporation rig's pure logic.
 *
 * Not a Bitburner script (.mjs, so the game's file-sync ignores it). Runs under Node:
 *   node corp-lib.test.mjs
 *
 * Pins down the three pieces of maths that have cost real money in the field: the boost-material
 * split (the $165b Real Estate overbuy, the three-materials-at-zero playthrough), the job
 * allocation (seats that don't add up, a 9+ office with no interns), and the product price hunt
 * (the controller that discounted below cost).
 */
import {
  boostTargets, mixForJobs, jobsMatch, autoJobPolicy, parseJobMix, validJobPolicy,
  supplyPlan, priceStep, PRICE, nextProductName, parseMoney, parseRoutes, isZero, boostFactors,
} from "./corp-lib.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? "  — " + extra : ""}`); }
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// Unit sizes from getMaterialData (v3.0.1).
const SIZE = { "Real Estate": 0.005, "Hardware": 0.06, "Robots": 0.5, "AI Cores": 0.1 };
const AGRI = { "Real Estate": 0.72, "Hardware": 0.20, "Robots": 0.30, "AI Cores": 0.30 };
const CHEM = { "Real Estate": 0.25, "Hardware": 0.20, "Robots": 0.25, "AI Cores": 0.20 };

console.log("\nboostTargets — the Lagrange split:");
{
  const mix = boostTargets(AGRI, SIZE, 3000, 0.4);
  ok("sums to the requested share of the warehouse", mix && near(sum(mix), 0.4, 1e-9), JSON.stringify(mix));
  ok("Agriculture leans on Real Estate", mix && mix["Real Estate"] > 0.2);
  ok("...but not ONLY Real Estate at a decent warehouse size", mix && Object.keys(mix).length > 1);
  const chem = boostTargets(CHEM, SIZE, 3000, 0.4);
  ok("Chemical uses all four materials at 3000 space", chem && Object.keys(chem).length === 4, JSON.stringify(chem));
  const tiny = boostTargets(CHEM, SIZE, 100, 0.4);
  ok("tiny warehouse drops materials that want negative space, still sums", tiny && near(sum(tiny), 0.4, 1e-9) &&
    Object.keys(tiny).length < 4, JSON.stringify(tiny));
  ok("every fraction is positive", Object.values(tiny).every((f) => f > 0));
  // Optimality spot-check: moving a sliver of space between two active materials never helps.
  const cityMult = (m, wh) => Object.entries(m).reduce((p, [k, f]) =>
    p * Math.pow(0.002 * (f * wh / SIZE[k]) + 1, CHEM[k]), 1);
  const base = cityMult(chem, 3000);
  const nudged = { ...chem, "Robots": chem["Robots"] + 0.01, "Hardware": chem["Hardware"] - 0.01 };
  ok("a nudge away from the optimum is worse", cityMult(nudged, 3000) < base);
  ok("zero total -> null", boostTargets(AGRI, SIZE, 3000, 0) === null);
  ok("boostFactors maps getIndustryData field names",
    boostFactors({ realEstateFactor: 0.72, hardwareFactor: 0.2, robotFactor: 0.3, aiCoreFactor: 0.3 })["Real Estate"] === 0.72);
}

console.log("\nmixForJobs — seats always add up:");
for (const policy of ["spread", "product", "material"]) {
  let allExact = true, badAt = -1;
  for (let n = 1; n <= 300; n++) {
    const m = mixForJobs(policy, n);
    if (!m || sum(m) !== n) { allExact = false; badAt = n; break; }
  }
  ok(`${policy}: every size 1..300 sums exactly`, allExact, `n=${badAt}`);
}
ok("spread at 4 is the round-1 1/1/1/1", JSON.stringify(mixForJobs("spread", 4)) ===
  JSON.stringify({ Operations: 1, Engineer: 1, Business: 1, Management: 1 }));
ok("no interns under 9", !mixForJobs("spread", 8).Intern);
{
  const m = mixForJobs("spread", 9);
  ok("9+ office gets >= 2/9 interns (stops the 0.998 decay)", m.Intern / 9 >= 2 / 9 - 1e-9, JSON.stringify(m));
}
ok("material mix has no Business", !mixForJobs("material", 30).Business);
{
  const p = mixForJobs("product", 60);
  ok("product mix: Operations > Management", p.Operations > p.Management, JSON.stringify(p));
}
ok("rnd puts everyone on R&D", mixForJobs("rnd", 6)["Research & Development"] === 6);
ok("round1 refuses an office under 4", mixForJobs("round1", 3) === null);
ok("a custom mix too big for the office -> null", mixForJobs("ops=5,eng=5", 6) === null);
ok("a custom mix that fits is returned as-is", mixForJobs("ops=2,eng=1", 6).Operations === 2);
ok("hold -> null (leave the office alone)", mixForJobs("hold", 9) === null);
ok("parseJobMix rejects junk", !!parseJobMix("ops=2,wizard=1").error);
ok("validJobPolicy accepts presets and mixes", validJobPolicy("product") && validJobPolicy("ops=1,rnd=2") && !validJobPolicy("nonsense"));
ok("jobsMatch: equal", jobsMatch({ Operations: 1, Engineer: 1, Intern: 0 }, { Operations: 1, Engineer: 1 }));
ok("jobsMatch: anyone Unassigned is a mismatch", !jobsMatch({ Operations: 1, Unassigned: 1 }, { Operations: 1 }));
ok("autoJobPolicy: product division", autoJobPolicy({ makesProducts: true }) === "product");
ok("autoJobPolicy: export-only materials", autoJobPolicy({ makesProducts: false, exportsAllOutput: true }) === "material");

console.log("\nsupplyPlan — the feedback controller:");
{
  const base = {
    size: 1000, used: 100, stored: { Water: 0, Chemicals: 0 }, imported: {},
    ratios: { Water: 0.5, Chemicals: 0.2 }, unitSize: { Water: 0.05, Chemicals: 0.05 }, cycleSeconds: 10,
  };
  const cold = supplyPlan({ ...base, prod: 0 });
  ok("cold start buys a seed amount", cold.rates.Water > 0 && cold.rates.Chemicals > 0);
  const hot = supplyPlan({ ...base, prod: 100 });
  ok("keeps the 5:2 input ratio", near(hot.rates.Water / hot.rates.Chemicals, 2.5, 1e-3));
  ok("aims above observed production", hot.target > 100);
  const stocked = supplyPlan({ ...base, prod: 100, stored: { Water: 1e6, Chemicals: 1e6 } });
  ok("plenty stored -> buys nothing", stocked.rates.Water === 0 && stocked.rates.Chemicals === 0);
  // An imported input is bought LEAN so the export formula's -IINV/10 term can't throttle it.
  const plain = supplyPlan({ ...base, prod: 100 });
  const lean = supplyPlan({ ...base, prod: 100, imported: { Chemicals: 16 } });
  ok("imported input: bought lean (one cycle + 5%), not 1.8 cycles", near(lean.rates.Chemicals, 0.2 * 105, 1e-6) &&
    lean.rates.Chemicals < plain.rates.Chemicals, `${lean.rates.Chemicals} vs ${plain.rates.Chemicals}`);
  const fed = supplyPlan({ ...base, prod: 100, imported: { Chemicals: 20 }, stored: { Water: 0, Chemicals: 200 } });
  ok("imported input already covered by stock -> only the 5% top-up", fed.rates.Chemicals <= 0.2 * 5 + 1e-6, `${fed.rates.Chemicals}`);
  ok("...and a non-imported input next to it keeps its normal buffer", fed.rates.Water === plain.rates.Water);
  const jammed = supplyPlan({ ...base, prod: 100, used: 990 });
  ok("<3% free -> buys nothing, flags congestion", jammed.rates.Water === 0 && jammed.congested);
  const big = supplyPlan({ ...base, prod: 1e6, used: 500 });
  const vol = (big.rates.Water + big.rates.Chemicals) * 10 * 0.05;
  ok("a cycle's purchase never exceeds 80% of free space", vol <= 500 * 0.8 + 1e-6, `vol ${vol}`);
}

console.log("\npriceStep — the clearing-price hunt:");
{
  let s = priceStep({}, { stored: 0, made: 10, sold: 10 });
  ok("clears -> raises, coarse", near(s.k, PRICE.COARSE) && s.coarse);
  s = priceStep(s, { stored: 50, made: 10, sold: 2 });
  ok("the raise cost sales -> cuts and switches to fine steps", s.k < PRICE.COARSE && s.coarse === false && s.dir === "down");
  const k1 = s.k;
  s = priceStep(s, { stored: 50, made: 10, sold: 10 });
  ok("fine step after the first rejection", near(s.k, k1 * PRICE.FINE));
  // The live Tobacco case: capacity-limited, backlog at every price in the free band.
  let cap = { k: 1, coarse: false, dir: "down", sold: 5, stored: 100 };
  for (let i = 0; i < 5; i++) cap = priceStep(cap, { stored: 110 + i * 10, made: 16, sold: 5 });
  ok("backlog but sales unchanged -> keeps RAISING (price is free inside the band)", cap.k > 1.2, `k ${cap.k}`);
  const edge = priceStep({ ...cap }, { stored: 170, made: 16, sold: 3 });
  ok("...until a raise costs sales -> steps back down", edge.k < cap.k && edge.dir === "down");
  let floor = { k: 1, coarse: false, dir: "up", sold: 100 };
  for (let i = 0; i < 20; i++) floor = priceStep(floor, { stored: 100 + i * 10, made: 10, sold: floor.dir === "up" ? 0 : 0 });
  ok("never prices below cost (k >= 1)", floor.k >= 1);
  const opened = priceStep({ k: 3 }, { stored: 999, made: 10, sold: 0, unpriced: true });
  ok("an unpriced city opens at the believed price, no cut", near(opened.k, 3));
  ok("price string format", /^MP\*\d+\.\d{3}$/.test(opened.str));
}

console.log("\nsmall parsers:");
ok("nextProductName skips taken indices", nextProductName(["Prod-1", "Prod-7", "Other"]) === "Prod-8");
ok("parseMoney 5t", parseMoney("5t") === 5e12);
ok("parseMoney all -> whole", parseMoney("all", 42) === 42);
ok("parseMoney 2.5e12", parseMoney("2.5e12") === 2.5e12);
{
  const r = parseRoutes("Agriculture/Plants > Chemical, Chemical/Chemicals > Agriculture/Aevum");
  ok("parseRoutes: two routes", r.routes && r.routes.length === 2);
  ok("parseRoutes: explicit destination city", r.routes[1].toCity === "Aevum" && r.routes[0].toCity === null);
  ok("parseRoutes: junk is an error", !!parseRoutes("nonsense").error);
}
ok("isZero on the game's default sell amount", isZero("") && isZero("0") && isZero(0) && !isZero("MAX"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
