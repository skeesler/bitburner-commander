/** @param {NS} ns
 *
 *  CORP MORALE — keep every office at full energy and morale. 51.6GB.
 *
 *      run corp-morale.js --loop      # resident: hold every office at 100/100 (the normal way)
 *      run corp-morale.js             # one pass, report where every office stands, exit
 *      run corp-morale.js --dry       # show the plan, spend nothing
 *
 *  WHY THIS IS THE HIGHEST-VALUE SCRIPT IN THE RIG. Employee output is scaled by
 *
 *      prodBase = avgMorale * avgEnergy * 1e-4          (OfficeSpace.ts:142, v3.0.1)
 *
 *  so 100/100 gives x1.0 and the floor of 10/10 (corpConstants.minEmployeeDecay) gives x0.01.
 *  An office that has decayed to the floor produces ONE PERCENT of what it should, no matter
 *  how big your production multiplier is. This was found in the field: two divisions, 132
 *  employees, every office pinned at 10/10, revenue a hundredth of what the corporation was
 *  built for.
 *
 *  WHY OFFICES DECAY AT ALL — AND WHY INTERNS ARE THE REAL FIX. From OfficeSpace.ts:77-85, the
 *  per-cycle multiplier on both stats is 1.002 for an office under 9 employees, but for 9 or
 *  more it becomes
 *
 *      perfMult = (1 + 0.002 * min(1/9, Intern/numEmployees - 1/9) * 9) ^ marketCycles
 *
 *  With NO interns that is 0.998 — a compounding 0.2%-per-cycle slide to the floor that no
 *  amount of tea prevents, only outruns. You need Intern/numEmployees > 1/9 to stop the decay
 *  and >= 2/9 to get the full 1.002 back. So:
 *
 *      this script  = the ambulance, for climbing back to 100/100 fast
 *      interns      = the cure, so you never fall again   (run corp-jobs.js --preset intern)
 *      AutoBrew (12k RP) + AutoPartyManager (15k RP) = the permanent fix; they pin both stats
 *                     to max and skip the decay entirely (OfficeSpace.ts:90-98)
 *
 *  COST, AND WHY IT ONLY ACTS WHEN IT NEEDS TO. Tea is a flat +2 energy per cycle at
 *  teaCostPerEmployee ($500k) x headcount. Parties MULTIPLY morale, at mult = 1 +
 *  costPerEmployee/10e6 (Actions.ts:411), plus a flat +(mult-1)*10 to make climbing off the
 *  floor easier. Recovering 10 -> 100 costs a few billion and takes ~45 cycles. But holding
 *  100/100 only needs a top-up every ten-ish cycles, so this buys nothing while an office is
 *  already at target — which matters, because during bonus time a cycle is 1s and tea for 132
 *  employees would otherwise run to $66m per second.
 *
 *  The party spend is sized to the gap: a long way down buys a big multiplier, a small dip
 *  buys a cheap one.
 *
 *  RAM: buyTea (20) + throwParty (20) + getOffice (10) + 1.6 base = 51.6GB.
 *       getConstants and nextUpdate are free.
 */

// ---- Tuning (all overridable by flag) --------------------------------------
const STATE_FILE = "corp-state.txt";
const TARGET      = 99.5;   // treat an office at or above this as fine
const RESERVE     = 0;      // corp funds to keep untouched
// Party spend per employee, chosen by how far morale has fallen. mult = 1 + cost/10e6.
const BIG_GAP     = 20, BIG_COST  = 5e6;    // mult 1.50 — climbing off the floor
const MID_GAP     = 5,  MID_COST  = 1e6;    // mult 1.10 — a real dip
const SMALL_COST  = 200e3;                  // mult 1.02 — a routine top-up
const PRINT_EVERY = 10;     // in --loop, print one line every N cycles
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["divisions", ""], ["target", TARGET], ["reserve", RESERVE],
    ["loop", false], ["quiet", false], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const divisions = resolveDivisions(ns, opts.divisions);
  if (!divisions.length) {
    ns.tprint("\ncorp-morale: no divisions known.\n" +
      "  run corp-status.js          # records them in corp-state.txt\n" +
      "  ...or pass --divisions \"Agriculture,Chemical\"\n");
    return;
  }

  let cycleSeconds = 10;
  try { cycleSeconds = ns.corporation.getConstants().secondsPerMarketCycle || 10; } catch (e) { /* default */ }
  const cities = Object.values(ns.enums.CityName);
  const target = Number(opts.target);

  let cycle = 0;
  for (;;) {
    const pass = sweep(ns, divisions, cities, target, opts);

    if (!opts.loop) { if (!opts.quiet) printPass(ns, pass, opts, target); return; }
    if (!opts.quiet && cycle % PRINT_EVERY === 0) ns.print(oneLine(ns, pass));
    cycle++;

    try { await ns.corporation.nextUpdate(); }
    catch (e) { await ns.sleep(cycleSeconds * 1000); }
  }
}

/** One pass over every office. Buys tea / throws a party only where it's actually needed. */
function sweep(ns, divisions, cities, target, opts) {
  const out = { offices: [], teaBought: 0, parties: 0, spend: 0, lowest: 100, atTarget: 0, missing: 0 };

  for (const division of divisions) {
    for (const city of cities) {
      let office;
      try { office = ns.corporation.getOffice(division, city); }
      catch (e) { out.missing++; continue; }          // no office in this city
      if (!office.numEmployees) continue;

      const energy = office.avgEnergy, morale = office.avgMorale;
      const maxE = office.maxEnergy || 100, maxM = office.maxMorale || 100;
      const wantEnergy = energy < Math.min(target, maxE);
      const wantParty = morale < Math.min(target, maxM);

      // Interns are what stop the decay; flag an office that will slide back (OfficeSpace.ts:77-85).
      const interns = (office.employeeJobs && office.employeeJobs["Intern"]) || 0;
      const decaying = office.numEmployees >= 9 && interns / office.numEmployees <= 1 / 9;

      const row = {
        division, city, energy, morale, interns, decaying,
        employees: office.numEmployees, tea: false, partyMult: 0, cost: 0,
      };

      if (wantEnergy) {
        row.cost += 500e3 * office.numEmployees;      // teaCostPerEmployee x headcount
        if (opts.dry) row.tea = true;
        else {
          try { row.tea = ns.corporation.buyTea(division, city); } catch (e) { /* funds or already pending */ }
        }
        if (row.tea) out.teaBought++;
      }

      if (wantParty) {
        const gap = Math.min(target, maxM) - morale;
        const per = gap > BIG_GAP ? BIG_COST : gap > MID_GAP ? MID_COST : SMALL_COST;
        row.cost += per * office.numEmployees;
        row.partyPer = per;
        if (opts.dry) row.partyMult = 1 + per / 10e6;
        else {
          try { row.partyMult = ns.corporation.throwParty(division, city, per); } catch (e) { /* skip */ }
        }
        if (row.partyMult > 1) out.parties++;
      }

      out.spend += row.cost;
      if (!wantEnergy && !wantParty) out.atTarget++;
      out.lowest = Math.min(out.lowest, energy, morale);
      out.offices.push(row);
    }
  }
  return out;
}

function oneLine(ns, pass) {
  const bad = pass.offices.filter((o) => o.energy < 99 || o.morale < 99).length;
  const decaying = pass.offices.filter((o) => o.decaying).length;
  return `${pass.atTarget}/${pass.offices.length} offices at target · lowest stat ` +
    `${pass.lowest.toFixed(1)} · tea ${pass.teaBought} · parties ${pass.parties} · ` +
    `spent $${fmt(ns, pass.spend)}` + (bad ? ` · ${bad} below par` : "") +
    (decaying ? ` · ${decaying} WILL DECAY (no interns)` : "");
}

function printPass(ns, pass, opts, target) {
  const rows = pass.offices.map((o) =>
    `  ${o.division.padEnd(12)} ${o.city.padEnd(11)} ` +
    `energy ${o.energy.toFixed(1).padStart(5)} morale ${o.morale.toFixed(1).padStart(5)} · ` +
    `${o.employees} staff, ${o.interns} intern${o.interns === 1 ? "" : "s"}` +
    (o.tea ? " · tea" : "") +
    (o.partyMult > 1 ? ` · party x${o.partyMult.toFixed(2)} ($${fmt(ns, o.partyPer)}/head)` : "") +
    (o.decaying ? "  <-- WILL DECAY: needs interns" : ""));

  const decaying = pass.offices.filter((o) => o.decaying);

  ns.tprint(
    `\n===== corp-morale ${opts.dry ? "(DRY RUN — nothing spent)" : ""}=====\n` +
    (rows.length ? rows.join("\n") : "  (no offices found)") +
    `\n\n  at target (>=${target}): ${pass.atTarget}/${pass.offices.length}` +
    `\n  spent this pass:      $${fmt(ns, pass.spend)}` +
    `\n\n  Employee output scales with morale x energy x 1e-4, so an office at the 10/10 floor\n` +
    `  produces 1% of what it should. Run it resident to climb and then hold:\n` +
    `      run corp-morale.js --loop\n` +
    (decaying.length
      ? `\n  !! ${decaying.length} office(s) have 9+ staff and too few interns, so both stats will\n` +
        `     slide back 0.2% every cycle no matter how much tea you buy. Fix it once:\n` +
        `         run corp-jobs.js --preset intern      # ~2/9 of each office on Intern\n` +
        `     Later, AutoBrew (12k RP) + AutoPartyManager (15k RP) remove the problem for good.\n`
      : "") +
    `=====`
  );
}

/** Explicit flag > corp-state.txt > nothing. ns.read is 0GB, so this is free. */
function resolveDivisions(ns, flagValue) {
  if (flagValue) return String(flagValue).split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (Array.isArray(st.divisions) && st.divisions.length) return st.divisions;
    }
  } catch (e) { /* fall through */ }
  return [];
}

// ns.formatNumber was removed in 3.0.0 (tombstone: typeof passes, the call throws).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "0";
  try { return ns.format.number(n, 2); } catch (e) { return String(Math.round(n)); }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-morale.js — hold every office at full energy and morale (51.6GB).\n" +
    "  run corp-morale.js --loop             resident; climbs to 100/100 and holds there\n" +
    "  run corp-morale.js                    one pass + a report of every office, then exit\n" +
    "  run corp-morale.js --dry              show the plan, spend nothing\n" +
    "  run corp-morale.js --target 99.5      what counts as 'fine'\n" +
    "  run corp-morale.js --divisions \"A,B\"  override the division list\n" +
    "  Output scales with morale x energy x 1e-4 — the 10/10 floor is 1% production.\n" +
    "  It spends nothing on an office already at target. Interns are the permanent fix.\n"
  );
}
