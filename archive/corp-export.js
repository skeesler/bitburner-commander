/** @param {NS} ns
 *
 *  CORP EXPORT — standing inter-division material transfers. 51.6GB.
 *
 *      run corp-export.js --preset agri-chem     # the round-2 loop, both directions, all cities
 *      run corp-export.js --show                 # every export order that currently exists
 *      run corp-export.js --routes "Agriculture/Plants > Chemical"
 *      run corp-export.js --preset agri-chem --clear     # tear the loop down
 *
 *  THERE IS NO IMPORT API. exportMaterial is the only call; an "import" is just the receiving
 *  end of somebody else's export, and shows up on the destination as Material.importAmount.
 *  So everything here is expressed from the SOURCE's point of view.
 *
 *  WHY YOU WANT THIS (round 2, corp-design.md). PURCHASED material always arrives at quality 1
 *  and dilutes what's already in the warehouse, so buying your Chemicals permanently caps the
 *  quality of the Plants and Food you make from them. MAKING them doesn't. The fix is a support
 *  division: Agriculture ships Plants to Chemical, Chemical ships Chemicals back, and nobody
 *  buys either one. Requires the Export unlock ($20b).
 *
 *  THE AMOUNT IS A LITTLE EXPRESSION LANGUAGE, and this is the part worth understanding.
 *  From Division.ts:742-749 the string is macro-expanded every cycle and evaluated as a
 *  PER-SECOND RATE (Division.ts:763 multiplies it back up by the cycle length):
 *
 *      MAX     the source's whole stock, spread across one cycle
 *      EPROD   the Exporter's productionAmount for this material
 *      EINV    the Exporter's stored amount
 *      IPROD   the Importer's productionAmount for this material
 *      IINV    the Importer's stored amount
 *
 *  Only + - * / . ( ) and those keywords survive the sanitizer (Actions.ts:569) — there is no
 *  min() or max(), which is why the defaults below are shaped the way they are.
 *
 *  A CONSUMED MATERIAL HAS A NEGATIVE productionAmount. That is the whole trick behind the
 *  well-known adaptive formula:
 *
 *      (IPROD+IINV/10)*(-1)      ship exactly what the importer is burning, less a tenth of
 *                                what it already has — self-throttling, settles at zero surplus
 *
 *  ...which has one flaw: it CANNOT START. A division with no inputs produces nothing, so it
 *  consumes nothing, so IPROD and IINV are both 0, so the formula evaluates to 0 and the first
 *  shipment never leaves. A dead division stays dead. So the default here adds a seed term:
 *
 *      (IPROD+IINV/10)*(-1)+EPROD/20
 *
 *  The extra term is 5% of the EXPORTER's production, which is always flowing, so the first
 *  shipment goes out immediately. The importer then produces a little, IPROD goes negative, and
 *  the flow roughly doubles each cycle until it matches consumption — at which point the
 *  IINV/10 term cancels the seed and it settles exactly where the classic formula would.
 *  Pass --amount "(IPROD+IINV/10)*(-1)" for the unmodified classic, or --amount MAX to dump.
 *
 *  SAFETY. exportMaterial THROWS on a duplicate route (Actions.ts:558-565) rather than silently
 *  stacking a second order, so this script reads the existing exports first and cancels any it
 *  is about to replace — which is what makes it idempotent and safe to re-run. The game also
 *  clamps every shipment to the source's stock AND to the destination's free space, and skips
 *  the transfer entirely if the destination warehouse is full, so an export cannot overfill a
 *  warehouse the way a runaway buyMaterial rate can.
 *
 *  ORDER OF OPERATIONS. Exports run in the EXPORT state, which is BEFORE SALE — so a division
 *  can export what its partner needs and still sell the remainder in the same cycle.
 *
 *  RAM: exportMaterial (20) + cancelExportMaterial (20) + getMaterial (10) + 1.6 base = 51.6GB.
 */

// ---- Defaults (all overridable by flag) ------------------------------------
const STATE_FILE = "corp-state.txt";
const AMOUNT = "(IPROD+IINV/10)*(-1)+EPROD/20";   // adaptive, and starts from cold — see above
const AGRI = "Agriculture";
const CHEM = "Chemical";
// ---------------------------------------------------------------------------

export async function main(ns) {
  const opts = ns.flags([
    ["routes", ""], ["preset", ""], ["amount", AMOUNT],
    ["agri", ""], ["chem", ""],
    ["show", false], ["clear", false], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const cities = Object.values(ns.enums.CityName);

  if (opts.show) { showExports(ns, cities); return; }

  let routes;
  if (opts.preset) {
    routes = presetRoutes(ns, opts);
    if (!routes) return;
  } else if (opts.routes) {
    routes = parseRoutes(ns, opts.routes);
    if (!routes) return;
  } else {
    ns.tprint("\nNothing to do — pass --preset agri-chem, --routes \"...\", or --show.\n" +
      "Run with --help for the route syntax.");
    return;
  }

  const done = [], seeded = [], skipped = [], failed = [], replaced = [];

  for (const route of routes) {
    for (const city of cities) {
      const toCity = route.toCity || city;
      if (route.from === route.to && toCity === city) continue;   // the game forbids this anyway

      // The source material. If this throws, the source has no warehouse here.
      let src;
      try { src = ns.corporation.getMaterial(route.from, city, route.material); }
      catch (e) {
        if (/no division named/i.test(String(e))) { abortNoDivision(ns, route.from); return; }
        skipped.push(`${city}: no ${route.from} warehouse`);
        continue;
      }

      const existing = (src.exports || []).find((x) => x.division === route.to && x.city === toCity);
      const where = `${route.from}/${city} ${route.material} -> ${route.to}/${toCity}`;

      // ---- clear mode ----------------------------------------------------
      if (opts.clear) {
        if (!existing) { skipped.push(`${where}: nothing to clear`); continue; }
        if (opts.dry) { done.push(`[dry] would cancel ${where}`); continue; }
        try {
          ns.corporation.cancelExportMaterial(route.from, city, route.to, toCity, route.material);
          done.push(`cancelled ${where}`);
        } catch (e) { failed.push(`${where} (${short(e)})`); }
        continue;
      }

      // ---- pick the amount ------------------------------------------------
      // Reading the DESTINATION costs nothing extra (same charged function) and tells us
      // whether the adaptive formula would dead-lock here.
      let amount = String(opts.amount);
      let isSeed = false;
      try {
        const dst = ns.corporation.getMaterial(route.to, toCity, route.material);
        if (dst.productionAmount === 0 && dst.stored === 0 && /IPROD/.test(amount) && !/EPROD/.test(amount)) {
          // A classic-formula route into a cold division would evaluate to 0 forever. Seed it
          // off the exporter's production instead; a later re-run picks up the normal formula.
          amount = "EPROD/20";
          isSeed = true;
        }
      } catch (e) {
        skipped.push(`${where}: no ${route.to} warehouse in ${toCity}`);
        continue;
      }

      if (existing && existing.amount === amount) { skipped.push(`${where}: already set`); continue; }
      if (opts.dry) { done.push(`[dry] would set ${where} = "${amount}"`); continue; }

      // exportMaterial THROWS on a duplicate, so clear the old order before setting the new one.
      if (existing) {
        try {
          ns.corporation.cancelExportMaterial(route.from, city, route.to, toCity, route.material);
          replaced.push(where);
        } catch (e) { failed.push(`${where} (could not cancel: ${short(e)})`); continue; }
      }

      try {
        ns.corporation.exportMaterial(route.from, city, route.to, toCity, route.material, amount);
        (isSeed ? seeded : done).push(where);
      } catch (e) {
        const msg = String(e);
        if (/cannot export material/i.test(msg)) {
          failed.push(`${where}: ${route.to} has no use for ${route.material}`);
        } else if (/no division named/i.test(msg)) { abortNoDivision(ns, route.to); return; }
        else failed.push(`${where} (${short(msg)})`);
      }
    }
  }

  ns.tprint(
    `\n===== corp-export ${opts.dry ? "(DRY RUN)" : ""}${opts.clear ? "(CLEARING)" : ""}=====\n` +
    `  routes: ${routes.map((r) => `${r.from}/${r.material} -> ${r.to}`).join(" · ")}\n` +
    (opts.clear ? "" : `  amount: "${opts.amount}"\n`) +
    `  set:      ${done.length ? `${done.length}\n    ` + done.join("\n    ") : "(none)"}\n` +
    (seeded.length
      ? `  SEEDED:   ${seeded.length}\n    ` + seeded.join("\n    ") +
        `\n    ...these destinations were completely cold, so they got "EPROD/20" instead — the\n` +
        `    adaptive formula evaluates to 0 when the importer has no production and no stock.\n` +
        `    Once material is flowing, re-run this to switch them to the adaptive amount.\n`
      : "") +
    (replaced.length ? `  replaced: ${replaced.length} existing order(s)\n` : "") +
    `  skipped:  ${skipped.length ? skipped.length + " (already set, or no warehouse)" : "(none)"}\n` +
    `  failed:   ${failed.length ? "\n    " + failed.join("\n    ") : "(none)"}\n` +
    (opts.dry || opts.clear ? "" :
      `\n  Exports move in the EXPORT state, before SALE — so a division can ship what its\n` +
      `  partner needs and still sell the remainder the same cycle.\n` +
      `  Check it landed:  run corp-export.js --show\n` +
      `  Then STOP BUYING what you now make yourself, or quality-1 purchases dilute it again:\n` +
      `      run corp-supply.js --inputs "Water=0.5"        # drop Chemicals from the buy list\n`) +
    `=====`
  );
}

/** Every export order in the corporation, read back from the source materials. */
function showExports(ns, cities) {
  const divisions = readDivisions(ns);
  if (!divisions.length) {
    ns.tprint("\ncorp-export --show: no divisions known. Run corp-status.js first.");
    return;
  }
  // getConstants is 0GB and is the honest source of the material list.
  let materialNames = [];
  try { materialNames = ns.corporation.getConstants().materialNames || []; } catch (e) { /* none */ }

  const rows = [];
  let flowing = 0, starved = 0;
  for (const division of divisions) {
    for (const city of cities) {
      for (const mat of materialNames) {
        let m;
        try { m = ns.corporation.getMaterial(division, city, mat); } catch (e) { continue; }
        for (const x of m.exports || []) {
          // The number that answers "is this route working?" lives on the DESTINATION —
          // importAmount is what actually arrived last cycle. Reading it costs nothing extra,
          // since getMaterial is already paid for.
          let dst = null;
          try { dst = ns.corporation.getMaterial(x.division, x.city, mat); } catch (e) { /* gone */ }

          // Distinguishing "correctly throttled" from "genuinely stuck" is the whole point of
          // this view. The adaptive amount ships what the destination BURNS, so a destination
          // that is holding stock and consuming none of it is supposed to receive nothing —
          // that is the formula working, not a broken route, and it points at a different
          // problem: the destination is missing some OTHER input it can't make or import.
          const moved = dst ? dst.importAmount : 0;
          let verdict;
          if (!dst) verdict = "?? destination unreadable";
          else if (moved > 0) { verdict = "FLOWING"; flowing++; }
          else if (m.stored <= 0) {
            verdict = "idle — source has nothing to ship right now";
            starved++;
          } else if (dst.productionAmount < 0) {
            verdict = "STALLED — destination IS consuming this but nothing arrived; " +
              "check its warehouse isn't full (a full destination skips the transfer entirely)";
            starved++;
          } else {
            // productionAmount of exactly 0 means the destination is not running at all. The
            // adaptive amount ships what the far end BURNS, so sending nothing is arithmetically
            // correct — but the route is still doing you no good, and the fault is upstream of
            // it. Don't dress this up as success the way an earlier version did.
            verdict = `DESTINATION NOT PRODUCING — it holds ${qty(dst.stored)} and consumes none, ` +
              `so the amount evaluates to nothing. Give that division its OTHER inputs first.`;
            starved++;
          }

          rows.push(`  ${division}/${city} ${mat} -> ${x.division}/${x.city}\n` +
            `      amount "${x.amount}"\n` +
            `      source stored ${qty(m.stored)} · destination stored ${dst ? qty(dst.stored) : "?"}` +
            ` · arrived last cycle ${qty(moved)}   <-- ${verdict}`);
        }
      }
    }
  }

  ns.tprint(
    `\n===== corp-export --show =====\n` +
    (rows.length ? rows.join("\n") : "  (no export orders anywhere)") +
    `\n\n  ${rows.length} export order(s): ${flowing} flowing, ${starved} not.\n` +
    (starved
      ? `\n  Read THROTTLED as success, not failure: the amount formula ships what the far end\n` +
        `  actually burns, so a destination sitting on stock it isn't consuming is meant to\n` +
        `  receive nothing. It means that division is missing a DIFFERENT input.\n` +
        `  A support division must still BUY whatever nobody exports to it — Chemical needs\n` +
        `  Water, and gets Plants by export — or it produces nothing and ships nothing back:\n` +
        `      run corp-supply.js --division Chemical --inputs "Water=0.5" --outputs "Chemicals"\n` +
        `  A genuine STALLED route is usually a full destination warehouse, which makes the\n` +
        `  game skip the transfer outright (Division.ts:770-773).\n`
      : "") +
    (rows.length ? "" : `  Set the round-2 loop up with:  run corp-export.js --preset agri-chem\n`) +
    `=====`
  );
}

/** The round-2 support loop: Plants out to the chemical plant, Chemicals back. */
function presetRoutes(ns, opts) {
  if (String(opts.preset).toLowerCase() !== "agri-chem") {
    ns.tprint(`\nUnknown preset "${opts.preset}". Known: agri-chem`);
    return null;
  }
  const divisions = readDivisions(ns);
  const agri = opts.agri || pick(divisions, AGRI) || AGRI;
  const chem = opts.chem || pick(divisions, CHEM) || CHEM;
  if (agri === chem) {
    ns.tprint(`\nBoth halves of the preset resolved to "${agri}". Pass --agri and --chem explicitly.`);
    return null;
  }
  return [
    { from: agri, material: "Plants", to: chem, toCity: null },
    { from: chem, material: "Chemicals", to: agri, toCity: null },
  ];
}

/** Parse "Agriculture/Plants > Chemical, Chemical/Chemicals > Agriculture/Aevum". */
function parseRoutes(ns, text) {
  const out = [];
  for (const part of String(text).split(",")) {
    const bit = part.trim();
    if (!bit) continue;
    const halves = bit.split(">");
    if (halves.length !== 2) { ns.tprint(`\nBad route "${bit}" — expected "Division/Material > Division".`); return null; }
    const left = halves[0].trim(), right = halves[1].trim();
    const cut = left.lastIndexOf("/");
    if (cut < 1) { ns.tprint(`\nBad source "${left}" — expected "Division/Material".`); return null; }
    const from = left.slice(0, cut).trim();
    const material = left.slice(cut + 1).trim();
    // An explicit destination city sends every source city to that one warehouse; the default
    // is same-city, which is what you almost always want.
    const rcut = right.lastIndexOf("/");
    const to = rcut > 0 ? right.slice(0, rcut).trim() : right;
    const toCity = rcut > 0 ? right.slice(rcut + 1).trim() : null;
    if (!from || !material || !to) { ns.tprint(`\nBad route "${bit}".`); return null; }
    out.push({ from, material, to, toCity });
  }
  if (!out.length) { ns.tprint("\nNo routes given."); return null; }
  return out;
}

/** Division names from corp-state.txt. ns.read is 0GB, so this is free. */
function readDivisions(ns) {
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (Array.isArray(st.divisions) && st.divisions.length) return st.divisions;
    }
  } catch (e) { /* fall through */ }
  return [];
}

/** Prefer an exact name, else the first division whose name contains the hint. */
function pick(divisions, hint) {
  if (divisions.includes(hint)) return hint;
  const lower = hint.toLowerCase();
  return divisions.find((d) => d.toLowerCase().includes(lower)) || null;
}

function abortNoDivision(ns, division) {
  ns.tprint(`\nABORT: no division named "${division}".\n` +
    `  run corp-status.js    # list the real names and record them\n`);
}

function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 140); }

/** Print a quantity HONESTLY. Rounding a trace amount to a flat "0" made a verdict that only
 *  fires when stock is above zero read as "holds 0" — a self-contradiction that hid the real
 *  story, which was that a trickle had arrived and then stopped. Small non-zero stays visible. */
function qty(n) {
  if (!Number.isFinite(n)) return "?";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.01) return n > 0 ? "<0.01" : ">-0.01";
  return String(Math.round(n * 100) / 100);
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-export.js — standing inter-division material transfers (51.6GB).\n" +
    "  run corp-export.js --preset agri-chem      Plants -> Chemical, Chemicals -> Agriculture\n" +
    "  run corp-export.js --show                  list every export order that exists\n" +
    "  run corp-export.js --routes \"A/Plants > B\"  custom; same-city unless you write \"B/Aevum\"\n" +
    "  run corp-export.js --preset agri-chem --clear    remove those orders\n" +
    "  run corp-export.js --amount \"MAX\"          override the transfer amount\n" +
    "  run corp-export.js --dry                   preview, change nothing\n" +
    "  There is no import API — an import is the far end of an export. Amounts are per-second\n" +
    "  expressions over MAX / EPROD / EINV / IPROD / IINV. Safe to re-run: it replaces rather\n" +
    "  than stacking duplicate orders, which the game rejects outright.\n"
  );
}
