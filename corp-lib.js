/** corp-lib.js — the corporation rig's shared logic. Imported by corp.js, corp-do.js and
 *  corp-report.js; tested under plain Node by corp-lib.test.mjs.
 *
 *  Almost everything here is PURE — numbers in, numbers out, no `ns` — because that is the part
 *  that has actually bitten us (the boost split, the job allocation, the price controller) and
 *  pure code is the part a Node spec can pin down. The few helpers that touch the game take `ns`
 *  as an argument and are grouped at the bottom.
 *
 *  WHY ONE LIBRARY NOW. The old rig was 29 small scripts, each re-implementing the same helpers,
 *  because every ns.corporation.* mention costs 10GB (read) / 20GB (action) and the rig had to
 *  fit a 64GB home. Mentioning the ENTIRE corporation API in one file costs 961.6GB, and the game
 *  caps any script at 1024GB both statically and at call time [SRC v3.0.1: RamCalculations.ts:255,
 *  NetscriptHelpers.tsx:442]. With a big home the RAM wall is gone, so the split is now by JOB —
 *  corp.js runs, corp-do.js acts on purpose, corp-report.js reads — and this file is what they share.
 *  The old modules live in archive/ (see corp-design.md → "The 2026-09 rewrite").
 *
 *  NAMING: the RAM walker bills identifiers by BARE NAME against the whole cost tree (AGENTS.md).
 *  Nothing here may be called `research`, `buy`, `sell`, `scan`, `share`, `probe`, `hack`, ... —
 *  hence mixForJobs, boostTargets, priceStep and friends.
 */

// ---- constants --------------------------------------------------------------

export const STATE_NAMES = ["START", "PURCHASE", "PRODUCTION", "EXPORT", "SALE"];
export const BOOST_MATERIALS = ["Real Estate", "Hardware", "Robots", "AI Cores"];
export const CONFIG_FILE = "corp-config.txt";

// The five production roles plus Intern. "Unassigned" is deliberately absent: setJobAssignment
// refuses it (returns false, does nothing), and zeroing these six is what fills Unassigned.
export const ROLES = ["Operations", "Engineer", "Business", "Management", "Research & Development", "Intern"];
const SPREAD = ["Operations", "Engineer", "Business", "Management", "Research & Development"];

export const JOB_ALIAS = {
  ops: "Operations", operations: "Operations",
  eng: "Engineer", engineer: "Engineer",
  bus: "Business", business: "Business",
  mgmt: "Management", management: "Management",
  rnd: "Research & Development", "r&d": "Research & Development", research: "Research & Development",
  "research & development": "Research & Development",
  intern: "Intern",
};

// Product quality weights, Product.ts:148 (v3.0.1):
//   balanceMult = 1.2*engineer + 0.9*management + 1.3*rnd + 1.5*operations + business
const PRODUCT_WEIGHTS = {
  "Operations": 1.5, "Research & Development": 1.3, "Engineer": 1.2, "Business": 1.0, "Management": 0.9,
};
// Export-only material division: no Business, because nothing is SOLD for Business to act on.
// The ratio is a considered guess (corp-design.md), not source-confirmed like the product weights.
const MATERIAL_WEIGHTS = {
  "Operations": 1.5, "Engineer": 1.2, "Management": 0.9, "Research & Development": 0.6,
};

// 2/9 of a 9+ office on Intern is where perfMult stops eating morale and energy
// (OfficeSpace.ts:77-85). Under 9 staff the office gets the full 1.002 for free.
const INTERN_SHARE = 2 / 9;

export const JOB_PRESETS = ["auto", "hold", "spread", "product", "material", "rnd", "round1"];

// ---- small utilities --------------------------------------------------------

export function short(msg, n = 140) { return String(msg).replace(/\s+/g, " ").slice(0, n); }
export function listOf(v) { return String(v || "").split(",").map((s) => s.trim()).filter(Boolean); }
export function sameName(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
export function clamp01(n) { const v = Number(n); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
export function round(n, dp = 2) {
  if (!Number.isFinite(n)) return "?";
  const f = Math.pow(10, dp);
  return String(Math.round(n * f) / f);
}
export function pct(f) { return Number.isFinite(f) ? `${(100 * f).toFixed(1)}%` : "?"; }

/** ns.formatNumber was REMOVED in 3.0.0 (a tombstone that throws); ns.format.number is 0GB. */
export function fmt(ns, n, dp = 3) {
  if (!Number.isFinite(n)) return "?";
  try { return ns.format.number(n, dp); } catch (e) { return String(Math.round(n)); }
}

/** The game's default sell amount is 0 — the $0.00/s failure mode. "" and "0" count as zero. */
export function isZero(v) {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v === "number") return v <= 0;
  const s = String(v).trim().toUpperCase();
  return s === "0" || s === "0.0";
}

/** "5t" / "500b" / "2.5e12" / "all" -> a number. "all"/"max"/"" fall back to `whole`. */
export function parseMoney(text, whole = NaN) {
  const s = String(text).trim().toLowerCase();
  if (!s || s === "all" || s === "max") return whole;
  const m = s.match(/^([0-9.]+(?:e[0-9]+)?)\s*([kmbtq]?)$/);
  if (!m) { const n = Number(s); return Number.isFinite(n) ? n : NaN; }
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 }[m[2]];
  return Number(m[1]) * mult;
}

// ---- jobs -------------------------------------------------------------------

/** Parse "ops=2,eng=2,mgmt=1" into exact API role names. Returns {mix} or {error}. */
export function parseJobMix(text) {
  const mix = {};
  for (const bit of listOf(text)) {
    const m = bit.split(/[=:]/);
    if (m.length !== 2) return { error: `bad entry "${bit}" — expected name=count` };
    const role = JOB_ALIAS[m[0].trim().toLowerCase()];
    const n = Number(m[1]);
    if (!role) return { error: `unknown job "${m[0].trim()}" — use ${Object.keys(JOB_ALIAS).join(" ")}` };
    if (!Number.isInteger(n) || n < 0) return { error: `bad count "${m[1]}" for ${role}` };
    mix[role] = (mix[role] || 0) + n;
  }
  if (!Object.keys(mix).length) return { error: "empty mix" };
  return { mix };
}

/** Is `text` a preset name or a mix string corp-do.js / corp.js will accept? */
export function validJobPolicy(text) {
  const t = String(text || "").trim().toLowerCase();
  if (JOB_PRESETS.includes(t)) return true;
  return !parseJobMix(t).error;
}

/** The job mix for an office of `n` employees under a policy.
 *
 *    spread   — 2/9 interns in a 9+ office, the rest evenly over the five roles (leftovers to
 *               Operations first). At n=4 that is exactly the classic round-1 1/1/1/1.
 *    product  — interns as above, the rest weighted by what scores a product.
 *    material — interns as above, the rest weighted for an export-only division (no Business).
 *    rnd      — everyone on R&D (the round-1 opening, until RP ~55).
 *    round1   — 1/1/1/1 Ops/Eng/Bus/Mgmt.
 *    a mix string — fixed counts; returns null if the office is too small for it.
 *
 *  Returns null for "hold"/"auto" (the caller resolves auto first) or an impossible mix. */
export function mixForJobs(policy, n) {
  const p = String(policy || "").trim().toLowerCase();
  if (n <= 0) return {};
  if (p === "rnd") return { "Research & Development": n };
  if (p === "round1") {
    if (n < 4) return null;
    return { Operations: 1, Engineer: 1, Business: 1, Management: 1, ...(n > 4 ? { "Research & Development": n - 4 } : {}) };
  }
  if (p === "spread" || p === "product" || p === "material") {
    const interns = n >= 9 ? Math.ceil(n * INTERN_SHARE) : 0;
    const rest = n - interns;
    const out = {};
    if (interns > 0) out.Intern = interns;
    if (p === "spread") {
      const base = Math.floor(rest / SPREAD.length);
      let extra = rest - base * SPREAD.length;
      for (const role of SPREAD) {
        const count = base + (extra > 0 ? 1 : 0);
        if (extra > 0) extra--;
        if (count > 0) out[role] = count;
      }
      return out;
    }
    const weights = p === "product" ? PRODUCT_WEIGHTS : MATERIAL_WEIGHTS;
    return { ...out, ...largestRemainder(rest, weights) };
  }
  if (p === "hold" || p === "auto" || !p) return null;
  const parsed = parseJobMix(p);
  if (parsed.error) return null;
  const want = Object.values(parsed.mix).reduce((a, b) => a + b, 0);
  return want <= n ? parsed.mix : null;
}

/** Split `total` seats across roles in proportion to weights, summing EXACTLY to total. */
function largestRemainder(total, weights) {
  const roles = Object.keys(weights);
  const sum = roles.reduce((a, r) => a + weights[r], 0);
  const rows = roles.map((role) => {
    const want = (total * weights[role]) / sum;
    return { role, want, count: Math.floor(want) };
  });
  let given = rows.reduce((a, r) => a + r.count, 0);
  rows.sort((a, b) => (b.want - b.count) - (a.want - a.count));
  for (let i = 0; given < total; i++, given++) rows[i % rows.length].count++;
  const out = {};
  for (const r of rows) if (r.count > 0) out[r.role] = r.count;
  return out;
}

/** Does an office's current employeeJobs already match `target` (and nobody is Unassigned)? */
export function jobsMatch(current, target) {
  const cur = current || {};
  if ((cur.Unassigned || 0) > 0) return false;
  for (const role of ROLES) if ((cur[role] || 0) !== (target[role] || 0)) return false;
  return true;
}

/** What "auto" means for a division: a product division gets the product mix, a materials
 *  division that exports ALL its output gets the no-Business mix, anything else spreads evenly. */
export function autoJobPolicy({ makesProducts, exportsAllOutput }) {
  if (makesProducts) return "product";
  if (exportsAllOutput) return "material";
  return "spread";
}

// ---- boost materials --------------------------------------------------------

/** The industry's four boost factors, keyed by material name, from getIndustryData(). */
export function boostFactors(ind) {
  return {
    "Real Estate": Number(ind.realEstateFactor) || 0,
    "Hardware": Number(ind.hardwareFactor) || 0,
    "Robots": Number(ind.robotFactor) || 0,
    "AI Cores": Number(ind.aiCoreFactor) || 0,
  };
}

/** The best split of `whSize * totalFrac` warehouse space across the boost materials.
 *
 *  Maximise  cityMult = prod (0.002*q_i + 1)^f_i   subject to  sum q_i*size_i = S.
 *  Logs make it concave, so a Lagrange multiplier solves it in closed form:
 *      q_i = f_i / (L * size_i) - 500,   L = (sum f_i) / (S + 500 * sum size_i)
 *  A material whose q_i comes out <= 0 wants no space: drop it and re-solve on the rest.
 *
 *  Returns {material: fraction of the warehouse}, summing to totalFrac, or null. The answer
 *  depends on S, so it must be recomputed when a warehouse grows (the Smart Storage dilution). */
export function boostTargets(factors, unitSize, whSize, totalFrac) {
  const S = whSize * totalFrac;
  if (!(S > 0)) return null;
  let active = Object.keys(factors).filter((m) => factors[m] > 0 && unitSize[m] > 0);
  for (let guard = 0; guard <= BOOST_MATERIALS.length; guard++) {
    if (!active.length) return null;
    const sumF = active.reduce((a, m) => a + factors[m], 0);
    const sumS = active.reduce((a, m) => a + unitSize[m], 0);
    const lambda = sumF / (S + 500 * sumS);
    const qty = {}, drop = [];
    for (const m of active) {
      const q = factors[m] / (lambda * unitSize[m]) - 500;
      if (q <= 0) drop.push(m); else qty[m] = q;
    }
    if (!drop.length) {
      const mix = {};
      for (const m of active) mix[m] = (qty[m] * unitSize[m]) / whSize;
      return mix;
    }
    active = active.filter((m) => !drop.includes(m));
  }
  return null;
}

// ---- supply (the custom Smart Supply) ----------------------------------------

/** One city's input purchase plan — a feedback controller, not a production model.
 *
 *  Aim `growth` above what the division actually produced last cycle; buy one cycle of inputs
 *  for that plus `buffer` cycles of slack, minus what is stored and what arrives by export;
 *  taper to nothing as the warehouse fills; cap a cycle's volume at SPACE_CAP of free space.
 *  If inputs were the bottleneck output climbs next cycle and the target follows; if something
 *  else is, stock piles up and the deficit goes to zero on its own.
 *
 *  AN IMPORTED INPUT IS BOUGHT LEAN: one cycle of use plus LEAN_GROWTH, no buffer. The export
 *  amount is "(IPROD+IINV/10)*(-1)+EPROD/20" — it ships LESS the more the destination holds. Holding
 *  the usual ~1.8 cycles made IINV/10 exceed the burn, the export fell to a trickle, and this
 *  controller topped the gap up with quality-1 purchases, which kept IINV high: a deadlock, live
 *  2026-09-28 (Agriculture importing 16 Chemicals/s and BUYING 47; Chemical selling what it should
 *  have shipped). Lean buying leaves ~nothing after PRODUCTION, so the export (evaluated at EXPORT,
 *  after production) ships the full burn, and purchases cover only what the exporter can't.
 *  Imports are NOT subtracted: importAmount is per SECOND and arrives after this cycle's
 *  production, and what already arrived is in `stored`.
 *
 *  in:  {prod, size, used, stored:{m}, imported:{m}, ratios:{m}, unitSize:{m}, cycleSeconds}
 *  out: {rates:{m: per-second}, target, freeFrac, congested} */
export function supplyPlan(inp, tune = {}) {
  const growth = tune.growth ?? 0.20;
  const buffer = tune.buffer ?? 0.5;
  const EASE = 0.25, HALT = 0.03, SPACE_CAP = 0.80, SEED = 2, LEAN_GROWTH = 0.05;

  const free = Math.max(0, inp.size - inp.used);
  const freeFrac = inp.size > 0 ? free / inp.size : 0;
  const scale = freeFrac <= HALT ? 0 : freeFrac >= EASE ? 1 : (freeFrac - HALT) / (EASE - HALT);
  const target = (inp.prod > 0 ? inp.prod * (1 + growth) : SEED) * scale;

  const deficit = {};
  let volume = 0;
  for (const [mat, ratio] of Object.entries(inp.ratios)) {
    const lean = (inp.imported[mat] || 0) > 0;
    const t = lean ? (inp.prod > 0 ? inp.prod * (1 + LEAN_GROWTH) : SEED) * scale : target;
    const want = ratio * t * inp.cycleSeconds * (lean ? 1 : 1 + buffer);
    deficit[mat] = Math.max(0, want - (inp.stored[mat] || 0));
    volume += deficit[mat] * (inp.unitSize[mat] || 0);
  }
  let fit = 1;
  if (volume > 0 && free <= 0) fit = 0;
  else if (volume > free * SPACE_CAP) fit = (free * SPACE_CAP) / volume;

  const rates = {};
  for (const mat of Object.keys(deficit)) rates[mat] = round4((deficit[mat] * fit) / inp.cycleSeconds);
  return { rates, target, freeFrac, congested: freeFrac <= HALT || (inp.prod <= 0 && freeFrac < EASE) };
}

// ---- product pricing (until Market-TA.II) -----------------------------------

// Per product PER CITY we hold a multiplier k and sell at "MP*k". "MP" on a PRODUCT means its
// productionCost — a zero margin — so k=1 is the floor, never below (selling under cost only
// makes moving more units worse; a product that won't clear at cost is obsolete, not mispriced).
export const PRICE = { START: 1, MIN: 1, MAX: 1e7, COARSE: 1.25, FINE: 1.05, DOWN: 0.9, GROWTH_TOL: 0.02, SALES_TOL: 0.03, STUCK: 8 };

/** One step of the clearing-price hunt. Pure.
 *    prev: {k, coarse, stuck, stored, sold, dir} from last cycle (or {})
 *    obs:  {stored, made, sold, unpriced}
 *
 *  THE SALE FORMULA HAS A FREE BAND. Volume is multiplied by 1 for any price from cost up to
 *  cost + markupLimit, and only falls, as (markupLimit/(price-cost))^2, above it [SRC v3.0.1:
 *  calculateMarkupMultiplier, Corporation/helpers.ts:133]. So a BACKLOG does not mean "too
 *  expensive": if sales capacity (Business, awareness, rating) is below production, stock piles up
 *  at EVERY price in the band. The first version cut on any backlog and parked Tobacco's Prod-1 at
 *  cost, selling 5 of 16/s at zero margin (live, 2026-09-28). The test that matters is whether the
 *  last RAISE cost volume:
 *    everything cleared, shelf not growing  -> raise (coarse until the first setback, then fine)
 *    backlog, and the last raise cut sales  -> cut: we crossed the top of the band
 *    backlog, but sales held                -> raise: capacity is the limit, price is free
 *  Near the top of the band this alternates up/down by a step, which is the tracking we want. */
export function priceStep(prev, obs) {
  let k = Number(prev.k);
  if (!Number.isFinite(k) || k <= 0) k = PRICE.START;
  let coarse = prev.coarse !== false;
  let stuck = Number(prev.stuck) || 0;
  let dir = prev.dir || "";
  if (!obs.unpriced) {
    const last = Number.isFinite(Number(prev.stored)) ? Number(prev.stored) : obs.stored;
    const growing = obs.stored > last * (1 + PRICE.GROWTH_TOL) + 0.5;
    const movingAll = obs.made > 0 && obs.sold >= obs.made * 0.995;
    const lastSold = Number(prev.sold);
    const raiseHurt = dir === "up" && Number.isFinite(lastSold) && obs.sold < lastSold * (1 - PRICE.SALES_TOL);
    if (movingAll && !growing) {
      k *= coarse ? PRICE.COARSE : PRICE.FINE; dir = "up"; stuck = 0;
    } else if (raiseHurt) {
      k *= PRICE.DOWN; coarse = false; dir = "down";
      stuck = k <= PRICE.MIN * 1.0001 ? stuck + 1 : 0;
    } else {
      k *= PRICE.FINE; dir = "up";
      stuck = 0;
    }
  }
  k = Math.max(PRICE.MIN, Math.min(PRICE.MAX, k));
  return { k, coarse, stuck, dir, stored: obs.stored, sold: obs.sold, str: `MP*${k.toFixed(3)}` };
}

/** Prod-1, Prod-2, ... skipping any index already taken. */
export function nextProductName(existing, prefix = "Prod") {
  let top = 0;
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  for (const name of existing) {
    const hit = pattern.exec(name);
    if (hit) top = Math.max(top, Number(hit[1]));
  }
  return `${prefix}-${top + 1}`;
}

// ---- exports ----------------------------------------------------------------

// Ship what the importer burns, less a tenth of its stock — plus 5% of the exporter's output so
// a cold destination (IPROD = IINV = 0, which evaluates the classic formula to 0 forever) starts.
// Consumed materials have NEGATIVE productionAmount, hence *(-1). See corp-design.md, round 2.
export const EXPORT_AMOUNT = "(IPROD+IINV/10)*(-1)+EPROD/20";

/** Parse "Agriculture/Plants > Chemical, Chemical/Chemicals > Agriculture/Aevum". */
export function parseRoutes(text) {
  const out = [];
  for (const bit of listOf(text)) {
    const halves = bit.split(">");
    if (halves.length !== 2) return { error: `bad route "${bit}" — expected "Division/Material > Division"` };
    const left = halves[0].trim(), right = halves[1].trim();
    const cut = left.lastIndexOf("/");
    if (cut < 1) return { error: `bad source "${left}" — expected "Division/Material"` };
    const rcut = right.lastIndexOf("/");
    out.push({
      from: left.slice(0, cut).trim(), material: left.slice(cut + 1).trim(),
      to: rcut > 0 ? right.slice(0, rcut).trim() : right,
      toCity: rcut > 0 ? right.slice(rcut + 1).trim() : null,
    });
  }
  if (!out.length) return { error: "no routes given" };
  return { routes: out };
}

// ---- the few helpers that touch the game ------------------------------------

/** corp-config.txt: the standing intent corp-do.js records and corp.js enforces. 0GB (ns.read). */
export function readConfig(ns) {
  try {
    const raw = ns.read(CONFIG_FILE);
    const cfg = raw ? JSON.parse(raw) : {};
    return { jobs: {}, ...(cfg && typeof cfg === "object" ? cfg : {}) };
  } catch (e) { return { jobs: {} }; }
}

export function writeConfig(ns, cfg) {
  ns.write(CONFIG_FILE, JSON.stringify(cfg, null, 2), "w");
}

/** Set an office's job mix, the only safe way: zero every role, then set each target.
 *  setJobAssignment is RELATIVE (it moves people from/to Unassigned and throws if short), and it
 *  lands at the next START state. Returns "" on success or the error text. */
export function assignJobs(ns, division, city, target) {
  try {
    for (const role of ROLES) ns.corporation.setJobAssignment(division, city, role, 0);
    for (const [role, n] of Object.entries(target)) {
      if (n > 0) ns.corporation.setJobAssignment(division, city, role, n);
    }
    return "";
  } catch (e) { return short(e); }
}

/** Fill every empty seat in an office. Hiring is free up front (salary is ongoing). */
export function fillOffice(ns, division, city, office) {
  let hired = 0;
  for (let i = office.numEmployees; i < office.size; i++) {
    let ok = false;
    try { ok = ns.corporation.hireEmployee(division, city); } catch (e) { break; }
    if (!ok) break;
    hired++;
  }
  return hired;
}

function round4(n) { return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : 0; }
