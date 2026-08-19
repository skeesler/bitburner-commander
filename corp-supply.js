/** @param {NS} ns
 *
 *  CORP SUPPLY — the custom Smart Supply. Works out how much input material to buy, every
 *  cycle, in every city, so production runs flat out without ever jamming a warehouse. 51.6GB.
 *
 *      run corp-supply.js --loop            # resident controller — the normal way to run it
 *      run corp-supply.js                   # one pass, print a report, exit
 *      run corp-supply.js --clear           # stop buying inputs entirely
 *      run corp-supply.js --dry             # show the plan, change nothing
 *
 *  WHAT IT REPLACES. "Smart Supply" is a $25b corporation unlock that sizes input purchases
 *  for you. corp-design.md deliberately skipped it — $25b is 38% of the round-1 upgrade
 *  budget — on the promise of writing this instead. This is that script.
 *
 *  THE PROBLEM. buyMaterial sets a PER-SECOND rate that runs forever until you change it. Set
 *  it too low and production starves; set it too high and inputs fill the warehouse, leaving
 *  no room for output, at which point production silently drops to zero and stays there.
 *  Tuning that by hand — per material, per city, again after every warehouse upgrade — is the
 *  most tedious job in the corporation, and getting it wrong is invisible until revenue stops.
 *
 *  HOW IT WORKS. Not a reimplementation of the game's production formula (that formula is not
 *  reliably documented, and corp-design.md's rule is that the running game is the only source
 *  of truth). It is a FEEDBACK CONTROLLER, which needs no formula at all:
 *
 *    1. Read what the division actually produced last cycle. Every produced material's
 *       productionAmount equals the division's raw production, so one read gives us P.
 *    2. Aim slightly above it: Ptarget = P * (1 + growth). If inputs were the limit, output
 *       climbs ~20% next cycle. Repeat and it walks up to whatever the real ceiling is —
 *       employees, warehouse, boost materials — and then stops on its own.
 *    3. Buy the difference: enough for one cycle of Ptarget plus a small buffer, minus what's
 *       already stored. When production is capped, stored stays high, the deficit goes to
 *       zero, and buying stops by itself. Nothing to tune.
 *    4. Never buy into a full warehouse: purchases taper off below 25% free space and stop
 *       below 3%, and each cycle's total purchase volume is capped at 80% of the free space
 *       using each material's real unit size.
 *    5. Never buy what another division is already exporting to us. Imported stock counts
 *       against the deficit, so as an export ramps up the purchase rate falls to zero by
 *       itself — which matters because purchased material arrives at quality 1 and dilutes
 *       the warehouse, defeating the point of the support division (corp-export.js).
 *
 *  WHY --loop IS THE RIGHT MODE. Only the LAST rate written before the PURCHASE state matters,
 *  so a resident controller that recomputes on every state tick is always correct regardless of
 *  where in the cycle it started. A one-shot run dispatched at the wrong moment reads an
 *  inflated `stored` (right after a purchase) and would buy nothing. corp-conductor.js keeps
 *  this alive in --loop mode for exactly that reason.
 *
 *  IT ALSO WATCHES THE THING THAT COSTS YOU EVERYTHING. Reading a produced material for its
 *  productionAmount is free once we've paid for getMaterial, so it also checks
 *  desiredSellAmount and reports any city with NO SELL ORDER — the failure mode where a
 *  division produces perfectly and earns exactly $0.00/s. corp-conductor.js reads that report
 *  and can fix it automatically.
 *
 *  Writes corp-supply.txt (a small JSON report) every pass. ns.write is 0GB.
 *
 *  RAM: buyMaterial (20) + getMaterial (10) + getWarehouse (10) + getMaterialData (10)
 *       + 1.6 base = 51.6GB. getConstants and nextUpdate are free.
 */

// ---- Defaults (all overridable by flag) ------------------------------------
const DIVISION = "Agriculture";
const STATE_FILE  = "corp-state.txt";

// ONE REPORT PER DIVISION. Once a support division exists you run two of these resident at
// once (Agriculture buying Water+Chemicals, Chemical buying Water), and a single shared report
// file would mean each overwrites the other every cycle — corp-conductor.js would read
// whichever wrote last and warn about the wrong division. The conductor reads them all.
const REPORT_PREFIX = "corp-supply-";
function reportFile(division) {
  return `${REPORT_PREFIX}${String(division).replace(/[^A-Za-z0-9_-]/g, "_")}.txt`;
}

// Input materials and how much of each is consumed per unit of RAW PRODUCTION. These are
// getIndustryData(industry).requiredMaterials — passed as a flag rather than read, to keep this
// script at four charged functions. Agriculture is Water 0.5 / Chemicals 0.2.
const INPUTS  = "Water=0.5,Chemicals=0.2";
// Any produced material works; we only read productionAmount and the sell order off it.
const OUTPUTS = "Plants,Food";

const GROWTH        = 0.20;  // aim this fraction above observed production, so output climbs to its ceiling
const BUFFER_CYCLES = 0.5;   // extra stock held on top of one cycle's consumption
const EASE_BELOW    = 0.25;  // taper buying once free warehouse space drops below this fraction
const HALT_BELOW    = 0.03;  // buy nothing at all below this
const SPACE_CAP     = 0.80;  // never let one cycle's purchase exceed this fraction of free space
const SEED_PROD     = 2;     // raw production to assume at a cold start (nothing produced yet)
const PRINT_EVERY   = 5;     // in --loop mode, print one line every N state ticks (5 = once a cycle)
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["division", ""], ["inputs", INPUTS], ["outputs", OUTPUTS],
    ["growth", GROWTH], ["buffer", BUFFER_CYCLES],
    ["loop", false], ["quiet", false], ["dry", false], ["clear", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const division = resolveDivision(ns, opts.division);
  const inputs = parsePairs(ns, opts.inputs);
  if (!inputs) return;
  const outputs = String(opts.outputs).split(",").map((s) => s.trim()).filter(Boolean);
  if (!outputs.length) { ns.tprint("\nNo output materials given — need at least one to measure production."); return; }

  // getConstants is 0GB and needs no corporation; never hardcode the cycle length.
  let cycleSeconds = 10;
  try { cycleSeconds = ns.corporation.getConstants().secondsPerMarketCycle || 10; } catch (e) { /* keep default */ }

  const cities = Object.values(ns.enums.CityName);

  // Unit sizes never change, so read them once. Used only for the volume cap.
  const unitSize = {};
  for (const mat of Object.keys(inputs)) {
    try { unitSize[mat] = ns.corporation.getMaterialData(mat).size || 0; }
    catch (e) { unitSize[mat] = 0; }   // unknown size -> the volume cap simply doesn't bind
  }

  let tick = 0;
  for (;;) {
    let report;
    try {
      report = pass(ns, division, cities, inputs, outputs, unitSize, cycleSeconds, opts);
    } catch (e) {
      if (/no division named/i.test(String(e))) {
        ns.tprint(`\nABORT: no division named "${division}".\n  run corp-status.js\n`);
        return;
      }
      ns.tprint(`\ncorp-supply: ${e}`);
      return;
    }

    try { ns.write(reportFile(division), JSON.stringify(report), "w"); } catch (e) { /* report is a nicety */ }

    if (!opts.loop) { if (!opts.quiet) printReport(ns, report, opts); return; }

    if (!opts.quiet && tick % PRINT_EVERY === 0) ns.print(oneLine(ns, report));
    tick++;

    // Tick on the corporation's own clock (0GB). Acting on every state is deliberate: the last
    // rate written before PURCHASE is the one that counts, so this is correct whenever it starts.
    try { await ns.corporation.nextUpdate(); }
    catch (e) { await ns.sleep(cycleSeconds * 1000); }
  }
}

/** One full pass over every city. Returns the report object. */
function pass(ns, division, cities, inputs, outputs, unitSize, cycleSeconds, opts) {
  const growth = Number(opts.growth);
  const buffer = Number(opts.buffer);
  const names = Object.keys(inputs);

  const report = {
    ts: Date.now(), division, cycleSeconds,
    // Recorded so corp-conductor.js can fix the RIGHT division's RIGHT materials rather than
    // falling back to its own Agriculture-shaped defaults.
    outputs: outputs.slice(),
    cities: [], noSellCities: [], congestedCities: [], missingCities: [],
    totalProd: 0, cleared: !!opts.clear, dry: !!opts.dry,
  };

  for (const city of cities) {
    let wh;
    try {
      wh = ns.corporation.getWarehouse(division, city);
    } catch (e) {
      if (/no division named/i.test(String(e))) throw e;   // real problem — bubble up
      report.missingCities.push(city);                     // just no warehouse here yet
      continue;
    }

    const free = Math.max(0, wh.size - wh.sizeUsed);
    const freeFrac = wh.size > 0 ? free / wh.size : 0;

    // ---- measure: raw production, and whether output is actually being sold --------------
    let prod = 0, noSell = false;
    for (const out of outputs) {
      let m;
      try { m = ns.corporation.getMaterial(division, city, out); }
      catch (e) { continue; }   // this industry may not produce it; ignore
      if (m.productionAmount > prod) prod = m.productionAmount;
      // A material with a standing EXPORT order already has somewhere to go, so having no sell
      // order is correct for it — that is the whole shape of a support division, whose output
      // feeds a sister division rather than the market. Reporting it as the $0.00/s failure
      // would make corp-conductor.js "fix" it every few cycles, forever.
      if (sellsNothing(m) && !(m.exports && m.exports.length)) noSell = true;
    }
    report.totalProd += prod;
    if (noSell) report.noSellCities.push(city);

    // Producing nothing while the warehouse is full is the congestion signature.
    const congested = freeFrac <= HALT_BELOW || (prod <= 0 && freeFrac < EASE_BELOW);
    if (congested) report.congestedCities.push(city);

    // ---- plan: how much of each input do we want to end up holding? -----------------------
    // Below EASE_BELOW free space we scale the whole plan down rather than buying into a jam.
    const scale = freeFrac <= HALT_BELOW ? 0
      : freeFrac >= EASE_BELOW ? 1
        : (freeFrac - HALT_BELOW) / (EASE_BELOW - HALT_BELOW);

    // Aim above what we actually managed. If inputs were the limit, output rises next cycle and
    // the target rises with it; if something else is the limit, stored piles up and the deficit
    // below goes to zero on its own. That self-limiting property is the whole design.
    const target = (prod > 0 ? prod * (1 + growth) : SEED_PROD) * scale;

    const want = {}, deficit = {}, stored = {}, imported = {};
    let volume = 0;
    for (const mat of names) {
      let m;
      try { m = ns.corporation.getMaterial(division, city, mat); }
      catch (e) { continue; }
      stored[mat] = m.stored;
      imported[mat] = m.importAmount || 0;
      // One cycle of consumption at the target rate, plus a little slack.
      want[mat] = inputs[mat] * target * cycleSeconds * (1 + buffer);
      // Whatever is arriving by export from another division is stock we don't have to buy —
      // and MUST NOT buy. Purchased material always lands at quality 1 and dilutes the
      // warehouse, which is the entire reason a support division exists (corp-export.js).
      // As an export ramps up, this drives the purchase rate to zero on its own.
      deficit[mat] = Math.max(0, want[mat] - m.stored - imported[mat]);
      volume += deficit[mat] * (unitSize[mat] || 0);
    }

    // ---- cap: one cycle's purchase must fit in the space we actually have -----------------
    let fit = 1;
    if (volume > 0 && free > 0 && volume > free * SPACE_CAP) fit = (free * SPACE_CAP) / volume;
    else if (volume > 0 && free <= 0) fit = 0;

    // ---- act ------------------------------------------------------------------------------
    const rates = {};
    for (const mat of names) {
      if (deficit[mat] === undefined) continue;
      const rate = opts.clear ? 0 : round4((deficit[mat] * fit) / cycleSeconds);
      rates[mat] = rate;
      if (!opts.dry) {
        try { ns.corporation.buyMaterial(division, city, mat, rate); }
        catch (e) { /* one bad city shouldn't stop the pass */ }
      }
    }

    report.cities.push({
      city, prod: round4(prod), free: round4(freeFrac), size: wh.size,
      // NB: this key is "buyRate", not "buy". The RAM walker resolves identifiers by BARE NAME
      // against the whole cost tree ignoring namespace (AGENTS.md), and stock's old `buy`/`sell`
      // names are exactly the kind of thing that bills a script for an API it never touches.
      target: round4(target), fit: round4(fit), stored, imported, buyRate: rates, congested, noSell,
    });
  }

  return report;
}

/** Is this material's sell order effectively "sell nothing"? The game's default is 0. */
function sellsNothing(m) {
  const d = m.desiredSellAmount;
  if (d === undefined || d === null || d === "") return true;
  if (typeof d === "number") return d <= 0;
  const s = String(d).trim().toUpperCase();
  return s === "0" || s === "0.0";
}

/** Parse "Water=0.5,Chemicals=0.2". Material names are exact and may contain spaces. */
function parsePairs(ns, text) {
  const out = {};
  for (const part of String(text).split(",")) {
    const bit = part.trim();
    if (!bit) continue;
    const at = bit.lastIndexOf("=");
    if (at < 1) { ns.tprint(`\nBad entry "${bit}" — expected Name=amount.`); return null; }
    const name = bit.slice(0, at).trim();
    const n = Number(bit.slice(at + 1));
    if (!Number.isFinite(n) || n < 0) { ns.tprint(`\nBad amount for "${name}".`); return null; }
    out[name] = n;
  }
  if (!Object.keys(out).length) { ns.tprint("\nNo input materials given."); return null; }
  return out;
}

/** Compact one-liner for the resident log. */
function oneLine(ns, r) {
  const buys = {};
  for (const c of r.cities) for (const [m, v] of Object.entries(c.buyRate)) buys[m] = (buys[m] || 0) + v;
  const bits = Object.entries(buys).map(([m, v]) => `${m} ${fmt(ns, v)}/s`).join(", ");
  const flags = (r.noSellCities.length ? ` NO-SELL:${r.noSellCities.length}` : "") +
                (r.congestedCities.length ? ` JAMMED:${r.congestedCities.length}` : "");
  return `prod ${fmt(ns, r.totalProd)}/s across ${r.cities.length} cities · buying ${bits || "nothing"}${flags}`;
}

function printReport(ns, r, opts) {
  const rows = r.cities.map((c) => {
    const st = Object.entries(c.stored).map(([m, v]) => `${m} ${fmt(ns, v)}`).join(", ");
    const by = Object.entries(c.buyRate).map(([m, v]) => `${m} ${fmt(ns, v)}/s`).join(", ");
    const im = Object.entries(c.imported || {}).filter(([, v]) => v > 0)
      .map(([m, v]) => `${m} ${fmt(ns, v)}`).join(", ");
    return `  ${c.city.padEnd(12)} prod ${fmt(ns, c.prod).padStart(8)}/s · ` +
      `free ${(100 * c.free).toFixed(0).padStart(3)}% of ${Math.round(c.size)}` +
      `\n    stored: ${st || "(none)"}\n    buying: ${by || "(nothing)"}` +
      (im ? `\n    imported: ${im}  (bought stock is reduced by this — exports beat purchases)` : "") +
      (c.congested ? "  <-- CONGESTED" : "") + (c.noSell ? "  <-- NO SELL ORDER" : "");
  });

  ns.tprint(
    `\n===== corp-supply: ${r.division} ${opts.dry ? "(DRY RUN)" : ""}${opts.clear ? "(CLEARED)" : ""}=====\n` +
    (rows.length ? rows.join("\n") : "  (no warehouses found)") +
    `\n\n  total raw production: ${fmt(ns, r.totalProd)}/s\n` +
    (r.missingCities.length ? `  no warehouse: ${r.missingCities.join(", ")} — run corp-warehouses.js\n` : "") +
    (r.noSellCities.length
      ? `\n  !! NO SELL ORDER in ${r.noSellCities.join(", ")} — you are earning $0 there.\n` +
        `     Fix:  run corp-sell.js\n` : "") +
    (r.congestedCities.length
      ? `\n  !! CONGESTED in ${r.congestedCities.join(", ")} — no room to produce.\n` +
        `     Unjam:  run corp-sell.js --materials "Plants,Food" --price 0   (one cycle, then re-run corp-sell.js)\n` +
        `     Then:   run corp-warehouse-upgrade.js --add 5\n` : "") +
    `\n  Run it resident so it keeps tuning:  run corp-supply.js --loop\n` +
    `  Or let the conductor own it:          run corp-conductor.js\n=====`
  );
}

function round4(n) { return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : 0; }

// ns.formatNumber was REMOVED in 3.0.0 and survives only as a tombstone that throws when called,
// so a typeof guard passes and tells you nothing. ns.format.number is the real name (0GB).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "0";
  try { return ns.format.number(n, 2); } catch (e) { return n.toFixed(2); }
}

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
    "\ncorp-supply.js — custom Smart Supply: auto-sizes input purchases every cycle (51.6GB).\n" +
    "  run corp-supply.js --loop              resident controller (the normal way to run it)\n" +
    "  run corp-supply.js                     one pass + a full per-city report, then exit\n" +
    "  run corp-supply.js --dry               show the plan, buy nothing\n" +
    "  run corp-supply.js --clear             set every input rate to 0\n" +
    "  run corp-supply.js --inputs \"Water=0.5,Chemicals=0.2\"   industry's requiredMaterials\n" +
    "  run corp-supply.js --outputs \"Plants,Food\"              used to measure production\n" +
    "  run corp-supply.js --growth 0.3        chase capacity harder (default 0.2)\n" +
    "  Replaces the $25b Smart Supply unlock. Tapers off near a full warehouse; never jams.\n" +
    "  It also flags any city with no sell order — the $0.00/s failure mode.\n"
  );
}
