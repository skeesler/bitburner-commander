/** @param {NS} ns
 *
 *  CORP HIRE — fill every office to capacity, hiring straight into a job. 31.6GB.
 *
 *      run corp-hire.js [--job rnd] [--division NAME] [--dry]
 *
 *  hireEmployee takes an OPTIONAL position (corpns.ts:543). Omit it and the new hire lands in
 *  "Unassigned", where they produce nothing and you need a second (20GB) script to fix it.
 *  Pass it and they start working immediately — so this script never needs setJobAssignment,
 *  which is what keeps it under the 32GB ceiling.
 *
 *  Round 1: hire all four into Research & Development (the default here) and let RP build to
 *  ~55 before switching to a production mix with corp-jobs.js. RP is what lifts output quality
 *  early, and waiting for it is free.
 *
 *  Job names are exact strings in the API ("Research & Development"), but this accepts short
 *  aliases so you never have to type an ampersand into the terminal: rnd, ops, eng, bus, mgmt,
 *  intern.
 *
 *  Hiring costs no money up front — employees are an ongoing salary expense, not a purchase —
 *  so this is safe to run even when corp funds are low.
 *
 *  RAM: hireEmployee (20) + getOffice (10) + 1.6 base = 31.6GB.
 */

const DIVISION = "Agriculture";
const STATE_FILE = "corp-state.txt";
const JOB = "rnd";

// Short alias -> the exact string the API demands.
const JOBS = {
  rnd: "Research & Development", "r&d": "Research & Development",
  research: "Research & Development", "research & development": "Research & Development",
  ops: "Operations", operations: "Operations",
  eng: "Engineer", engineer: "Engineer",
  bus: "Business", business: "Business",
  mgmt: "Management", management: "Management",
  intern: "Intern", unassigned: "Unassigned",
};

export async function main(ns) {
  const opts = ns.flags([
    ["job", JOB], ["division", ""], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const job = JOBS[String(opts.job).toLowerCase()];
  if (!job) {
    ns.tprint(`\nUnknown job "${opts.job}". Use one of: ${Object.keys(JOBS).join(", ")}`);
    return;
  }

  const division = resolveDivision(ns, opts.division);
  const cities = Object.values(ns.enums.CityName);
  const hired = [], full = [], failed = [], missing = [];

  for (const city of cities) {
    let office;
    try {
      office = ns.corporation.getOffice(division, city);
    } catch (e) {
      if (/no division named/i.test(String(e))) { abortNoDivision(ns, division); return; }
      missing.push(city);
      continue;
    }

    const room = office.size - office.numEmployees;
    if (room <= 0) { full.push(`${city}(${office.numEmployees}/${office.size})`); continue; }
    if (opts.dry) { hired.push(`${city} +${room}`); continue; }

    let n = 0;
    // Bounded by `room` rather than looping on a re-read, so a false return can never spin.
    for (let i = 0; i < room; i++) {
      let ok = false;
      try { ok = ns.corporation.hireEmployee(division, city, job); }
      catch (e) { failed.push(`${city} (${short(String(e))})`); break; }
      if (!ok) break;   // office full or hiring refused
      n++;
    }
    if (n) hired.push(`${city} +${n}`);
    if (n < room && !failed.length) failed.push(`${city} (only ${n} of ${room} hired)`);
  }

  ns.tprint(
    `\n===== corp-hire: ${division} -> ${job} ${opts.dry ? "(DRY RUN)" : ""}=====\n` +
    `  hired:     ${hired.length ? hired.join(", ") : "(none)"}\n` +
    `  already full: ${full.length ? full.join(", ") : "(none)"}\n` +
    `  no office: ${missing.length ? missing.join(", ") + " — run corp-cities.js" : "(none)"}\n` +
    `  failed:    ${failed.length ? failed.join("; ") : "(none)"}\n` +
    (opts.dry ? "  [dry] nobody hired.\n" :
      `\n  Employees produce from the next START state. Watch RP with corp-status.js;\n` +
      `  at RP >= 55, switch to the production mix:  run corp-jobs.js --preset round1\n`) +
    `=====`
  );
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
    "\ncorp-hire.js — fill every office, hiring directly into a job (31.6GB).\n" +
    "  run corp-hire.js                 fill every office with R&D staff (round 1)\n" +
    "  run corp-hire.js --job ops       aliases: rnd ops eng bus mgmt intern\n" +
    "  run corp-hire.js --division X    override the division name\n" +
    "  run corp-hire.js --dry           preview, hire nobody\n" +
    "  Hiring is free up front (salary is an ongoing expense). Safe to re-run.\n"
  );
}
