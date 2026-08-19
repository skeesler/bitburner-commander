/** @param {NS} ns
 *
 *  CORP STATUS — read the corporation's shape and record it for the other modules. 21.6GB.
 *
 *      run corp-status.js [--quiet] [--silent]
 *
 *  Prints funds/shares/divisions/cities, and writes corp-state.txt so the cheap modules
 *  (corp-cities.js, corp-warehouses.js, …) can look up the real division name instead of
 *  guessing. ns.read costs 0GB, so every other script gets that lookup for free — this is
 *  the one place that pays the 10GB for getCorporation.
 *
 *  Run it once after creating the corporation and expanding into an industry, and again any
 *  time you add a division. It only reads; it never spends.
 *
 *  THREE VOLUME LEVELS, because this is called by other scripts on a timer. Default prints the
 *  full block; --quiet prints one line; --silent prints nothing to the terminal at all and logs
 *  to the script log instead. corp-conductor.js refreshes the state file every few cycles and
 *  uses --silent — during bonus time a cycle is 1s rather than 10s, so anything louder buries
 *  the terminal in a wall of identical lines.
 *
 *  RAM: getCorporation (10) + getDivision (10) + 1.6 base = 21.6GB.
 */

const STATE_FILE = "corp-state.txt";
const STATE_VERSION = 1;

export async function main(ns) {
  const opts = ns.flags([["quiet", false], ["silent", false], ["help", false]]);
  if (opts.help) {
    ns.tprint("\ncorp-status.js — show the corporation and write corp-state.txt (21.6GB).\n" +
      "  run corp-status.js           print status, refresh corp-state.txt\n" +
      "  run corp-status.js --quiet   refresh the state file, print only a one-liner\n" +
      "  run corp-status.js --silent  refresh the state file, say nothing (for scripts)\n");
    return;
  }

  // --silent still needs somewhere to put its errors, so route everything through one printer
  // rather than sprinkling `if (!opts.silent)` around. Silent goes to the script log, which
  // `tail corp-status.js` will show if you ever need to see why a refresh failed.
  if (opts.silent) ns.disableLog("ALL");
  const say = opts.silent ? (msg) => ns.print(msg) : (msg) => ns.tprint(msg);

  let info;
  try {
    info = ns.corporation.getCorporation();
  } catch (e) {
    say(`No corporation yet (${e}).\n` +
      `Create one at City Hall in Sector-12 — pick "Use seed money" (free, BN3 only).`);
    return;
  }

  // Preserve any role mapping a previous run (or corp-boot.js) already established, so
  // re-running this never clobbers hand-assigned roles.
  let roles = {};
  try {
    const prev = ns.read(STATE_FILE);
    if (prev) roles = (JSON.parse(prev) || {}).roles || {};
  } catch (e) { /* unreadable or malformed — start fresh */ }

  // With a single division there's no ambiguity: it's the material division we bootstrap on.
  if (!roles.material && info.divisions.length === 1) roles.material = info.divisions[0];

  const lines = [];
  // Division name -> industry. Recorded because a division can be called anything, while the
  // things that depend on it (boost-material factors, whether it makes products) are properties
  // of the INDUSTRY. getDivision is already paid for here, so every 0GB reader gets it free.
  const industries = {};
  for (const name of info.divisions) {
    try {
      const d = ns.corporation.getDivision(name);
      industries[name] = d.industry;
      // Record the first product-capable division as the "product" role, so corp-product.js can
      // find it without paying 10GB for getCorporation. Never overwrite a hand-assigned one.
      if (!roles.product && d.makesProducts) roles.product = name;
      lines.push(`  ${name} — ${d.industry}, ${d.cities.length}/6 cities, ` +
        `RP ${fmt(ns, d.researchPoints)}, awareness ${fmt(ns, d.awareness)}, ` +
        `products ${d.products.length}/${d.maxProducts}` +
        (roles.material === name ? "  [material]" : "") +
        (roles.product === name ? "  [product]" : ""));
    } catch (e) {
      lines.push(`  ${name} — could not read (${e})`);
    }
  }

  const state = {
    version: STATE_VERSION,
    corp: info.name,
    // totalShares > initialShares (1e9) means the government took its 500m — i.e. seed money.
    seedFunded: info.totalShares > 1e9,
    divisions: info.divisions,
    industries,
    roles,
    // The live numbers, recorded so corp-conductor.js can render a status line for free —
    // ns.read is 0GB, so this is the one place that pays the 10GB for getCorporation and
    // everything else reads the result. Refresh cadence is the conductor's --status-every.
    ts: Date.now(),
    funds: info.funds,
    revenue: info.revenue,
    expenses: info.expenses,
    valuation: info.valuation,
    numShares: info.numShares,
    totalShares: info.totalShares,
    public: info.public,
    dividendRate: info.dividendRate,
    prevState: info.prevState,
    nextState: info.nextState,
  };
  try { ns.write(STATE_FILE, JSON.stringify(state, null, 2), "w"); }
  catch (e) {
    // A failed write is worth interrupting for even in --silent mode: every other module reads
    // this file, so a stale one quietly sends them at the wrong division.
    ns.tprint(`corp-status WARN: could not write ${STATE_FILE}: ${e}`);
  }

  if (opts.silent || opts.quiet) {
    say(`corp-status: "${info.name}", ${info.divisions.length} division(s), ` +
      `$${fmt(ns, info.funds)} funds — ${STATE_FILE} refreshed.`);
    return;
  }

  say(
    `\n===== ${info.name} =====\n` +
    `  funds:     $${fmt(ns, info.funds)}\n` +
    `  revenue:   $${fmt(ns, info.revenue)}/s   expenses: $${fmt(ns, info.expenses)}/s\n` +
    `  valuation: $${fmt(ns, info.valuation)}\n` +
    `  shares:    ${fmt(ns, info.numShares)} of ${fmt(ns, info.totalShares)} ours ` +
    `(${(100 * info.numShares / info.totalShares).toFixed(1)}%, ${state.seedFunded ? "seed-funded" : "self-funded"})\n` +
    `  public:    ${info.public ? `yes, dividend rate ${info.dividendRate}` : "no"}\n` +
    `  state:     prev ${info.prevState} -> next ${info.nextState}\n` +
    `  divisions:\n${lines.length ? lines.join("\n") : "    (none — expand into an industry)"}\n` +
    `\n  ${STATE_FILE} refreshed` +
    (roles.material ? ` — other scripts will default to division "${roles.material}".` : ".") +
    `\n=====`
  );
}

// ns.formatNumber was removed in 3.0.0; ns.format.number is the current name (0GB).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "0";
  if (ns.format && typeof ns.format.number === "function") { try { return ns.format.number(n); } catch { /* fall through */ } }
  const a = Math.abs(n), s = ["", "k", "m", "b", "t", "q"];
  let i = 0; let v = a;
  while (v >= 1000 && i < s.length - 1) { v /= 1000; i++; }
  return (n < 0 ? "-" : "") + v.toFixed(v < 10 && i > 0 ? 2 : 1) + s[i];
}
