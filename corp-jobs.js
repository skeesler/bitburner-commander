/** @param {NS} ns
 *
 *  CORP JOBS — set an office's job mix, safely. 31.6GB.
 *
 *      run corp-jobs.js [--preset round1|rnd] [--mix "ops=1,eng=1,bus=1,mgmt=1"]
 *                       [--division NAME] [--dry]
 *
 *  THE TRAP THIS SCRIPT EXISTS TO AVOID: setJobAssignment is RELATIVE, not absolute. Asking
 *  for 5 Operations when 7 are assigned demotes 2 to Unassigned; asking for 5 when 2 are
 *  assigned pulls 3 out of Unassigned and THROWS if there aren't 3 spare. So the only correct
 *  way to set a mix is: zero every job first, then set each target.
 *
 *  And a second trap on top of it: you cannot zero by assigning "Unassigned" — the API logs a
 *  warning and returns false without doing anything (corpns.ts:515-520). Zeroing the five real
 *  jobs is what pushes people into Unassigned. That's why the code below loops over ROLES to
 *  clear, never over every position.
 *
 *  Assignments take effect at the NEXT START state, not immediately, so the numbers this
 *  prints are what you asked for; re-run corp-status.js a cycle later to see them applied.
 *
 *  Presets:
 *    rnd     — everyone on Research & Development. Round 1 opening: build RP to ~55.
 *    round1  — 1 Operations / 1 Engineer / 1 Business / 1 Management, the size-4 production mix.
 *    intern  — 2/9 of any 9+ office on Intern, the rest spread evenly over the five production
 *              roles. Use this on every office of 9 or more: without it, morale and energy decay
 *              0.2% per cycle to the 10/10 floor, where output is 1% of normal. See ROLES below.
 *
 *  RAM: setJobAssignment (20) + getOffice (10) + 1.6 base = 31.6GB.
 */

const DIVISION = "Agriculture";
const STATE_FILE = "corp-state.txt";

// The five assignable production roles, plus Intern. "Unassigned" is deliberately absent —
// see above; zeroing these five is what pushes people INTO Unassigned.
//
// INTERNS ARE NOT OPTIONAL IN AN OFFICE OF 9+. This file used to say interns weren't worth the
// headcount because a tea/party script was cheaper. That was wrong, and it cost this
// corporation a 100x production multiplier. From OfficeSpace.ts:77-85 (v3.0.1), the per-cycle
// multiplier on morale AND energy is:
//
//     perfMult = 1.002                                                  if numEmployees < 9
//     perfMult = (1 + 0.002 * min(1/9, Intern/numEmployees - 1/9) * 9)  if numEmployees >= 9
//
// With no interns that second form is 0.998 — a compounding slide that ends at the floor of 10,
// where output is morale*energy*1e-4 = 1% of normal. You need Intern/numEmployees > 1/9 to stop
// the decay, and >= 2/9 to earn the full 1.002 back. Tea and parties only outrun it; interns
// end it. (AutoBrew 12k RP and AutoPartyManager 15k RP end it permanently and free the seats.)
const ROLES = ["Operations", "Engineer", "Business", "Management", "Research & Development", "Intern"];

// Share of each office to put on Intern in the "intern" preset — 2/9 is where perfMult maxes out.
const INTERN_SHARE = 2 / 9;
// Roles the remaining staff are spread evenly across, in leftover-priority order.
const SPREAD = ["Operations", "Engineer", "Business", "Management", "Research & Development"];

// The "product" preset weights staff by the coefficients the game actually uses to score a
// product's quality (Product.ts:148, v3.0.1):
//
//     balanceMult = 1.2*engineer + 0.9*management + 1.3*rnd + 1.5*operations + business
//
// where each term is that job's SHARE of total employee production. Operations is worth the
// most and Management the least, so staff are allocated in proportion to these weights rather
// than evenly. Note this maximises the quality of products DEVELOPED while the mix is in place —
// it is the right mix for a division that is building something, not for a materials farm.
const PRODUCT_WEIGHTS = {
  "Operations": 1.5,
  "Research & Development": 1.3,
  "Engineer": 1.2,
  "Business": 1.0,
  "Management": 0.9,
};

// The "material" preset, for a division that makes materials rather than products.
//
// BUSINESS IS OMITTED, and that part is not a judgement call. Business affects how much you
// SELL and at what price. A division whose entire output leaves by export has no sales at all
// for it to act on — an export is a transfer, and the amount is set by the export expression,
// which reads production and inventory and never touches Business. Chemical is exactly this
// shape here: every city reads "Chemicals ... SELL ORDER: none · EXPORT -> Agriculture/...",
// so its Business seats were doing nothing whatsoever. Agriculture is NOT this shape — it sells
// Food and Plants at MAX in all six cities — so leave that division on the "intern" preset.
//
// The Operations > Engineer > Management ordering is a considered guess, not something I have
// confirmed against v3.0.1's material production formula the way PRODUCT_WEIGHTS above is
// confirmed against Product.ts:148. Treat the exact ratio as provisional; the part that is
// solid is that these three plus R&D are where the seats belong and Business is not.
const MATERIAL_WEIGHTS = {
  "Operations": 1.5,
  "Engineer": 1.2,
  "Management": 0.9,
  "Research & Development": 0.6,   // no sciMult on materials, but researches still cost RP
};

const ALIAS = {
  ops: "Operations", operations: "Operations",
  eng: "Engineer", engineer: "Engineer",
  bus: "Business", business: "Business",
  mgmt: "Management", management: "Management",
  rnd: "Research & Development", "r&d": "Research & Development",
  research: "Research & Development",
  intern: "Intern",
};

// A string value is a preset that has to be COMPUTED from the office's headcount (see autoMix);
// an object is a fixed mix that applies as-is.
const PRESETS = {
  round1: { Operations: 1, Engineer: 1, Business: 1, Management: 1 },
  rnd: "ALL_RND",           // everyone onto R&D, whatever the headcount
  intern: "AUTO_INTERN",    // 2/9 on Intern (9+ offices), the rest spread evenly
  product: "AUTO_PRODUCT",  // ...but weighted by what actually scores a product (see above)
  material: "AUTO_MATERIAL", // ...for an export-only materials division: no Business at all
};

export async function main(ns) {
  const opts = ns.flags([
    ["preset", ""], ["mix", ""], ["division", ""], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  if (!opts.preset && !opts.mix) {
    ns.tprint("\nNothing to do — pass --preset round1, --preset rnd, or --mix \"ops=1,eng=1\".\n" +
      "Run with --help for details.");
    return;
  }

  let mix = null;              // an object (fixed mix) or a string tag (computed per office)
  if (opts.mix) {
    mix = parseMix(ns, opts.mix);
    if (!mix) return;
  } else if (opts.preset) {
    if (!(opts.preset in PRESETS)) {
      ns.tprint(`\nUnknown preset "${opts.preset}". Known: ${Object.keys(PRESETS).join(", ")}`);
      return;
    }
    mix = PRESETS[opts.preset];
  }

  const division = resolveDivision(ns, opts.division);
  const cities = Object.values(ns.enums.CityName);
  const done = [], missing = [], failed = [];

  for (const city of cities) {
    let office;
    try {
      office = ns.corporation.getOffice(division, city);
    } catch (e) {
      if (/no division named/i.test(String(e))) { abortNoDivision(ns, division); return; }
      missing.push(city);
      continue;
    }

    // The computed presets scale to whatever this office actually has.
    const target = typeof mix === "string" ? autoMix(mix, office.numEmployees) : mix;
    const want = Object.values(target).reduce((a, b) => a + b, 0);

    if (office.numEmployees === 0) { failed.push(`${city} (no employees — run corp-hire.js)`); continue; }
    if (want > office.numEmployees) {
      failed.push(`${city} (mix wants ${want}, office has ${office.numEmployees})`);
      continue;
    }
    if (opts.dry) {
      done.push(`${city}: ${describe(target)}${want < office.numEmployees ? ` (+${office.numEmployees - want} unassigned)` : ""}`);
      continue;
    }

    try {
      // Step 1: zero every real role. This is what frees everyone into Unassigned.
      for (const role of ROLES) ns.corporation.setJobAssignment(division, city, role, 0);
      // Step 2: now every requested count is a pull from a full Unassigned pool, so it can't throw.
      for (const [role, n] of Object.entries(target)) {
        if (n > 0) ns.corporation.setJobAssignment(division, city, role, n);
      }
      done.push(`${city}: ${describe(target)}${want < office.numEmployees ? ` (+${office.numEmployees - want} unassigned)` : ""}`);
    } catch (e) {
      failed.push(`${city} (${short(String(e))})`);
    }
  }

  ns.tprint(
    `\n===== corp-jobs: ${division} ${opts.dry ? "(DRY RUN)" : ""}=====\n` +
    `  set:       ${done.length ? "\n    " + done.join("\n    ") : "(none)"}\n` +
    `  no office: ${missing.length ? missing.join(", ") + " — run corp-cities.js" : "(none)"}\n` +
    `  failed:    ${failed.length ? failed.join("; ") : "(none)"}\n` +
    (opts.dry ? "  [dry] nothing changed.\n" :
      `\n  Takes effect at the next START state (~10s). Confirm with corp-status.js.\n`) +
    `=====`
  );
}

/** Build a mix that depends on how many employees this particular office has.
 *
 *  AUTO_INTERN puts 2/9 of a 9+ office on Intern — the ratio at which perfMult stops eating
 *  morale and energy (see the note on ROLES) — and spreads everyone else evenly across the five
 *  production roles, leftovers going to Operations first. An office under 9 already gets
 *  perfMult 1.002 for free, so it gets no interns.
 */
function autoMix(kind, n) {
  if (kind === "ALL_RND") return { "Research & Development": n };

  const interns = n >= 9 ? Math.ceil(n * INTERN_SHARE) : 0;
  const rest = Math.max(0, n - interns);
  const out = {};
  if (interns > 0) out["Intern"] = interns;

  if (kind === "AUTO_PRODUCT" || kind === "AUTO_MATERIAL") {
    // Largest-remainder allocation, so the seats always add up to exactly `rest` however the
    // weights divide. Every role keeps at least one seat where headcount allows: a zero in any
    // of them is a term missing from balanceMult, and Business also has to sell the thing.
    const weights = kind === "AUTO_PRODUCT" ? PRODUCT_WEIGHTS : MATERIAL_WEIGHTS;
    const roles = Object.keys(weights);
    const total = roles.reduce((a, r) => a + weights[r], 0);
    const exact = roles.map((r) => ({ role: r, want: (rest * weights[r]) / total }));
    let given = 0;
    for (const e of exact) { e.count = Math.floor(e.want); given += e.count; }
    exact.sort((a, b) => (b.want - b.count) - (a.want - a.count));
    for (let i = 0; given < rest; i++, given++) exact[i % exact.length].count++;
    for (const e of exact) if (e.count > 0) out[e.role] = e.count;
    return out;
  }

  const base = Math.floor(rest / SPREAD.length);
  let extra = rest - base * SPREAD.length;
  for (const role of SPREAD) {
    const count = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    if (count > 0) out[role] = count;
  }
  return out;
}

/** Parse "ops=1,eng=1,rnd=2" into exact API job names. Returns null (after printing) on error. */
function parseMix(ns, text) {
  const out = {};
  for (const part of String(text).split(",")) {
    const bit = part.trim();
    if (!bit) continue;
    const m = bit.split(/[=:]/);
    if (m.length !== 2) { ns.tprint(`\nBad mix entry "${bit}" — expected name=count.`); return null; }
    const role = ALIAS[m[0].trim().toLowerCase()];
    const n = Number(m[1]);
    if (!role) { ns.tprint(`\nUnknown job "${m[0].trim()}". Known: ${Object.keys(ALIAS).join(", ")}`); return null; }
    if (!Number.isInteger(n) || n < 0) { ns.tprint(`\nBad count "${m[1]}" for ${role}.`); return null; }
    out[role] = (out[role] || 0) + n;
  }
  if (!Object.keys(out).length) { ns.tprint("\nEmpty mix."); return null; }
  return out;
}

function describe(mix) {
  return Object.entries(mix).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r}`).join(", ");
}

function abortNoDivision(ns, division) {
  ns.tprint(`\nABORT: no division named "${division}".\n` +
    `  run corp-status.js    # list real names and record them\n` +
    `  run corp-division.js  # if you have no divisions at all yet\n`);
}

function short(msg) { return msg.replace(/\s+/g, " ").slice(0, 110); }

/** Explicit flag > corp-state.txt > built-in guess. ns.read is 0GB, so this is free. */
function resolveDivision(ns, flagValue) {
  if (flagValue) return flagValue;
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (st.roles && st.roles.material) return st.roles.material;
      if (Array.isArray(st.divisions) && st.divisions.length === 1) return st.divisions[0];
    }
  } catch (e) { /* fall through */ }
  return DIVISION;
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-jobs.js — set a division's job mix in every city (31.6GB).\n" +
    "  run corp-jobs.js --preset rnd                 everyone on R&D (round-1 opening)\n" +
    "  run corp-jobs.js --preset round1              1 Ops / 1 Eng / 1 Bus / 1 Mgmt\n" +
    "  run corp-jobs.js --preset intern              2/9 on Intern (9+ offices), rest spread evenly\n" +
    "  run corp-jobs.js --preset material            export-only materials division: NO Business\n" +
    "  run corp-jobs.js --preset product             weighted by what actually scores a product\n" +
    "                                                — without interns a 9+ office decays to 1% output\n" +
    "  run corp-jobs.js --mix \"ops=2,eng=2,mgmt=1\"   custom; aliases ops eng bus mgmt rnd intern\n" +
    "  run corp-jobs.js --dry                        preview, change nothing\n" +
    "  Zeroes every role first, so it's always safe to re-run or change your mind.\n"
  );
}
