/** @param {NS} ns
 *
 *  CORP CONDUCTOR — the resident brain for the corporation. ~3.6GB.
 *
 *      run corp-conductor.js              # start it and leave it
 *      run corp-conductor.js --dry        # narrate what it would do, launch nothing
 *
 *  One script to start, and the corporation runs itself: it keeps the supply controller alive,
 *  refreshes the status file, notices the two failure modes that silently cost you all your
 *  money, and prints a status line you can watch.
 *
 *  WHY IT'S ALMOST FREE. Five corporation calls cost 0GB — hasCorporation, getConstants,
 *  nextUpdate, getBonusTime, canCreateCorporation — and this script uses only those. Every
 *  charged call happens inside the modules it launches, so peak RAM is
 *  "conductor + largest module", not the ~700GB a monolithic manager would cost. See
 *  corp-design.md → The RAM wall.
 *
 *  WHAT IT ACTUALLY DOES, each 10-second cycle:
 *    1. Keeps corp-supply.js --loop resident (relaunching it if it dies or was never started).
 *       Supply stays RESIDENT rather than being dispatched per-cycle on purpose: only the last
 *       buy rate written before the PURCHASE state counts, so a controller that recomputes on
 *       every state tick is correct no matter where in the cycle it started. A one-shot
 *       dispatched at the wrong moment reads an inflated `stored` and buys nothing.
 *    2. Refreshes corp-state.txt periodically via corp-status.js --silent, which is where the
 *       funds / revenue / valuation in the status line come from — read back with ns.read (0GB).
 *       --silent, not --quiet: during bonus time a cycle is 1s instead of 10s, so a one-liner
 *       per refresh becomes a wall of near-identical terminal lines. The conductor's own status
 *       line is the intended place to read those numbers.
 *    3. Watches every corp-supply-<division>.txt for the two silent killers:
 *         NO SELL ORDER  — a division producing perfectly and earning exactly $0.00/s.
 *                          Auto-fixed by running corp-sell.js (disable with --no-autosell).
 *         CONGESTION     — warehouse full, production halted. Reported loudly, NOT auto-fixed:
 *                          unjamming means dumping stock at price 0, and doing that to boost
 *                          materials by mistake would be expensive. That one stays your call.
 *
 *    4. Re-asserts Market-TA.II on every material and product (corp-ta.js), on a timer. This
 *       is not spending — the research is already bought — but the FLAG is per item and every
 *       new product corp-product.js finishes starts with it off, silently reverting to selling
 *       at cost. --no-ta stops it.
 *
 *  WHAT IT DOESN'T DO BY DEFAULT. It never spends discretionary money and it never takes an
 *  investment offer — those stay manual, the same way ascend.js holds the install behind
 *  --install. Going public and accepting an offer are one-way and stay manual permanently.
 *
 *  ...BUT SPENDING CAN BE SWITCHED ON, because a corporation that only accumulates is a
 *  corporation doing nothing. Upgrade levels, AdVert, research and bribery are all REVERSIBLE
 *  in the only sense that matters — you can stop at any time, and nothing you bought is lost —
 *  so each is available as an opt-in flag, off by default:
 *
 *      --auto-upgrade            corp-upgrade.js --go   (corporation-wide upgrade levels)
 *      --auto-advert             corp-advert.js --go    (AdVert, only where it pays)
 *      --auto-research           corp-research.js --auto --go
 *      --auto-boost              corp-boost.js --loop, once per division
 *
 *  --auto-boost matters more than it sounds. Every Smart Storage level MULTIPLIES warehouse size
 *  and the boost stock does not follow, so a corporation buying upgrades automatically dilutes its
 *  own boost fraction on every purchase — production multiplier quietly stops improving while
 *  everything else grows. Seen live: Smart Storage 40 -> 90 doubled every warehouse, boost went
 *  30.8% -> 15.4% of the space, and Agriculture's multiplier sat at x881.851 unchanged for 94
 *  minutes while revenue rose 7x around it. Refilling to the 40% default modelled at x2.77 there.
 *      --auto-bribe "Daedalus"   corp-bribe.js --go     (funds -> faction reputation)
 *
 *  At most ONE spend module runs per spend tick, round-robin, because they are 50-60GB one-shots
 *  and two at once would not fit beside a resident corp-product.js. --spend-every sets the
 *  cadence (default 30 cycles) with a real-time floor, so bonus time doesn't turn it into a
 *  spending spree — during bonus time a cycle is 1s instead of 10s.
 *
 *  SAFE ACROSS RESETS. Corporation progress survives an augmentation install, and
 *  reset-scripts.js only kills the commander family, so this is left alone by both. boot.js
 *  relaunches it when a corporation exists.
 *
 *  Stopping the conductor also stops the supply controller it started (ns.atExit), so you never
 *  leave a 51.6GB script running invisibly.
 *
 *  RAM: ns.run (1.0) + ns.kill (0.5) + ns.ps (0.2) + ns.getScriptRam (0.1) + ns.fileExists (0.1)
 *       + getServerMaxRam/UsedRam (0.05 each) + 1.6 base ~= 3.6GB. Every ns.corporation call
 *       used here is 0GB. Check with `mem corp-conductor.js` before adding anything.
 */

// ---- Tuning (overridable by flag where it matters) ------------------------
const SUPPLY     = "corp-supply.js";
// One resident supply controller per division that BUYS inputs. `division: null` means "whatever
// corp-state.txt calls the material division", which is corp-supply.js's own default. An entry
// naming a division is only launched once that division exists, so the list is safe to grow
// ahead of time.
//
// Note what Chemical does NOT buy: Plants. They arrive by export from Agriculture, because
// purchased material always lands at quality 1 and dilutes the warehouse — which is the entire
// reason the support division exists. See corp-export.js.
const SUPPLIES = [
  { division: null, args: ["--loop", "--quiet"] },
  { division: "Chemical", args: ["--loop", "--quiet", "--division", "Chemical",
                                 "--inputs", "Water=0.5", "--outputs", "Chemicals"] },
];
const MORALE     = "corp-morale.js";
const MORALE_ARGS = ["--loop", "--quiet"];
// Only started once corp-state.txt names a product division. It develops and sells products but
// never DISCONTINUES one — rotation stays behind corp-product.js's own --rotate flag, because
// retiring a product is irreversible and takes its revenue with it.
const PRODUCT     = "corp-product.js";
const PRODUCT_ARGS = ["--loop", "--quiet"];
// Market-TA.II is a per-item flag, not just a research: a product created after the last pass
// sells at cost until something sets it. Cheap to re-assert, catastrophic to forget.
const TA = "corp-ta.js";
const TA_EVERY = 30;       // cycles between corp-ta.js re-asserts
const TA_FLOOR_MS = 120e3; // ...but never more often than this (bonus time makes cycles 1s)
// The opt-in spend modules, in the order they take turns. One per spend tick.
const SPENDERS = [
  { flag: "auto-upgrade",  script: "corp-upgrade.js",  args: ["--go"] },
  { flag: "auto-advert",   script: "corp-advert.js",   args: ["--go"] },
  { flag: "auto-research", script: "corp-research.js", args: ["--auto", "--go"] },
];
// corp-boost.js is expanded to one entry PER DIVISION, because the optimal boost split is solved
// from that division's own industry factors — there is no corporation-wide pass. It is also the
// one spender that stays alive while it works (it buys until it hits target, then clears every
// rate and exits on its own), which is why the dispatcher below skips a pick that is already
// running instead of launching a second copy.
const BOOST = "corp-boost.js";
const SPEND_EVERY = 30;      // cycles between spend passes
const SPEND_FLOOR_MS = 240e3; // ...and a real-time floor, so bonus time can't accelerate spending
// AT MOST ONE HEAVY MODULE PER CYCLE. corp-ta.js is 61.6GB, the spend modules are 51.6-61.6GB and
// corp-status.js is 21.6GB — on a 512GB home with corp-product.js resident at 91.6GB there is room
// for exactly one of them at a time. Their periods also share factors (30 and 6), so left alone
// they fire on the SAME cycles every single time and the loser is starved permanently rather than
// occasionally. So a tick that can't run sets a DUE flag and retries on the next cycle instead of
// waiting out another whole period.
const RETRY_CYCLES = 10;     // ...but give up after this many, rather than staying due forever
const STATUS_EVERY = 6;    // cycles between corp-status.js refreshes (6 = once a minute)
const PRINT_EVERY  = 1;    // cycles between status lines in the script log
const BANNER_EVERY = 30;   // cycles between full banners to the terminal (30 = every 5 minutes)
const BANNER_FLOOR_MS = 240e3;  // ...but never more often than this. During bonus time a cycle is
                                // 1s instead of 10s, so a pure cycle count fires 10x too fast.
const SELL_COOLDOWN = 6;   // cycles to wait before re-running corp-sell.js after an autofix
const MATERIALS = "Plants,Food";   // what autosell puts on the market
const STATE_FILE  = "corp-state.txt";
// corp-supply.js writes one report per division (corp-supply-<division>.txt) because two
// resident controllers sharing one file would overwrite each other every cycle.
const REPORT_PREFIX = "corp-supply-";
// A supply report is only evidence while a supply controller is alive to refresh it. Once
// Smart Supply owns the buying you may well run --no-supply, at which point these files freeze
// and every warning in them becomes a ghost — the conductor would keep shouting CONGESTED about
// a jam you fixed an hour ago. Anything older than this is treated as no data, not as data.
const REPORT_MAX_AGE_MS = 120e3;
// Same rule for corp-state.txt itself, on a longer clock (it refreshes every ~minute while the
// conductor runs). Home files survive an install AND a BitNode jump; the corporation's divisions
// may not. A state file from last node still lists BN3's Agriculture/Chemical/Tobacco, and
// trusting it means launching supply and product controllers at divisions that no longer exist —
// each aborts, is relaunched next cycle, and spams the terminal forever. Stale state is last
// life's evidence: treat it as nothing, and the corp-status refresh a cycle later rebuilds it.
const STATE_MAX_AGE_MS = 600e3;
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["materials", MATERIALS],
    ["status-every", STATUS_EVERY],
    ["banner-every", BANNER_EVERY],
    ["no-supply", false],     // don't manage corp-supply.js (you're running it yourself)
    ["no-morale", false],     // don't manage corp-morale.js
    ["no-product", false],    // don't manage corp-product.js
    ["no-autosell", false],   // don't auto-fix a missing sell order
    ["no-ta", false],         // don't re-assert Market-TA.II (corp-ta.js)
    // Opt-in spending. Off by default: the conductor's standing promise is that it does not
    // spend your money unless you say so.
    ["auto-upgrade", false],
    ["auto-advert", false],
    ["auto-research", false],
    ["auto-boost", false],    // re-level boost materials (see the note on BOOST above)
    ["auto-bribe", ""],       // faction name; empty = off
    ["spend-every", SPEND_EVERY],
    ["dry", false],
    ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  // ---- guards -------------------------------------------------------------
  // hasCorporation is 0GB and works with no corporation — the right top guard, exactly like
  // ns.gang.inGang() in gang-manager.js.
  if (!ns.corporation.hasCorporation()) {
    ns.tprint("\ncorp-conductor: no corporation yet.\n" +
      "  Create one at City Hall in Sector-12 — choose \"Use seed money\" (free in BN3).\n" +
      "  Then: run corp-division.js, corp-cities.js, corp-warehouses.js, corp-status.js\n" +
      "  See bn3-runbook.md for the round-1 checklist.\n");
    return;
  }
  const self = ns.getScriptName();
  if (ns.ps("home").some((p) => p.filename === self && p.pid !== ns.pid)) {
    ns.tprint("corp-conductor: already running. Nothing to do.");
    return;
  }

  // Leaving 51.6GB residents behind would be rude and hard to notice.
  if (!opts.dry) {
    const owned = [];
    if (!opts["no-supply"]) owned.push(SUPPLY);
    if (!opts["no-morale"]) owned.push(MORALE);
    if (!opts["no-product"]) owned.push(PRODUCT);
    // corp-boost.js is the one SPENDER that stays alive while it works, and what keeps it alive is
    // a standing per-second buy rate. Leaving it running after the conductor is gone is precisely
    // the runaway-purchase failure its own header was written about, so it gets cleaned up too.
    if (opts["auto-boost"]) owned.push(BOOST);
    if (owned.length) {
      ns.atExit(() => { for (const p of ns.ps("home")) if (owned.includes(p.filename)) ns.kill(p.pid); });
    }
  }

  let cycleSeconds = 10, stateNames = [];
  try {
    const K = ns.corporation.getConstants();     // 0GB, no corporation required
    cycleSeconds = K.secondsPerMarketCycle || 10;
    stateNames = Array.isArray(K.stateNames) ? K.stateNames : [];
  } catch (e) { /* defaults are fine */ }

  ns.tprint(`corp-conductor: up. ${cycleSeconds}s cycle, ` +
    `${opts["no-supply"] ? "supply NOT managed" : "supply resident"}, ` +
    `autosell ${opts["no-autosell"] ? "off" : "on"}, ` +
    `TA ${opts["no-ta"] ? "off" : "on"}, ` +
    `spending ${[...new Set(spendPlan(opts, divisionsFromState(ns))
        .map((x) => x.script.replace(/^corp-|\.js$/g, "")))].join("+") || "OFF"}` +
    `${opts.dry ? ", DRY RUN" : ""}. ` +
    `Watch it with:  tail corp-conductor.js`);

  let tick = 0, cycle = 0, sellCooldown = 0, lastWarn = "", lastBanner = 0;
  let lastTa = 0, lastSpend = 0, spendTurn = 0;
  let taDue = 0, spendDue = 0;   // >0 = owed a launch, counting down retry attempts

  for (;;) {
    // The corporation's own clock. 0GB, and the only correct thing to sleep on.
    let state = null;
    try { state = await ns.corporation.nextUpdate(); }
    catch (e) { await ns.sleep(cycleSeconds * 1000); }

    tick++;
    // Prefer the real state name; fall back to counting ticks if nextUpdate's shape ever
    // changes. Nothing here is timing-critical — supply is resident precisely so it isn't.
    const known = typeof state === "string" && stateNames.includes(state);
    const boundary = known ? state === stateNames[0] : tick % Math.max(1, stateNames.length || 5) === 0;
    if (!boundary) continue;
    cycle++;
    if (sellCooldown > 0) sellCooldown--;

    // ---- 1. keep the supply controller alive ------------------------------
    if (!opts["no-supply"]) {
      const known = divisionsFromState(ns);
      for (const entry of SUPPLIES) {
        if (entry.division && !known.includes(entry.division)) continue;
        if (!isRunning(ns, SUPPLY, entry.args)) launch(ns, SUPPLY, entry.args, opts.dry);
      }
    }

    // ---- 1b. keep morale and energy off the floor -------------------------
    // Employee output is morale * energy * 1e-4, so an office left to decay to the 10/10 floor
    // produces 1% of normal — the most expensive silent failure in the corporation, and one
    // that only shows up as "revenue is oddly low". Resident for the same reason as supply.
    if (!opts["no-morale"]) {
      const running = ns.ps("home").some((p) => p.filename === MORALE);
      if (!running) launch(ns, MORALE, MORALE_ARGS, opts.dry);
    }

    // ---- 1c. keep a product in development --------------------------------
    // Round 3+ only, and only once there's a division that can make products. A finished
    // product with no sell order earns exactly nothing, and an idle product slot is the most
    // expensive thing in the corporation at this stage — neither should depend on remembering
    // to relaunch a script after an augmentation install.
    if (!opts["no-product"] && productDivision(ns)) {
      const running = ns.ps("home").some((p) => p.filename === PRODUCT);
      if (!running) launch(ns, PRODUCT, PRODUCT_ARGS, opts.dry);
    }

    // ---- 2. refresh the numbers -------------------------------------------
    // (cycle - 1) % N, not cycle % N === 1 — the latter never fires when N is 1.
    let heavy = false;   // has this cycle already spent its one big-module slot?
    if ((cycle - 1) % Math.max(1, opts["status-every"]) === 0) {
      if (launch(ns, "corp-status.js", ["--silent"], opts.dry, true)) heavy = true;
    }

    // ---- 2b. keep Market-TA.II switched on --------------------------------
    // The research being owned is NOT the same as the flag being set, exactly like owning the
    // Smart Supply unlock versus calling setSmartSupply. Every product corp-product.js finishes
    // arrives with the flag off and sells at productionCost — i.e. at no margin at all — until
    // something sets it. This is the something.
    if (!opts["no-ta"] && (cycle - 1) % TA_EVERY === 0 && Date.now() - lastTa >= TA_FLOOR_MS) {
      taDue = RETRY_CYCLES;
      lastTa = Date.now();     // the FLOOR is about how often we WANT to run, not how often we did
    }
    if (taDue > 0 && !heavy) {
      if (fits(ns, TA) || opts.dry) { launch(ns, TA, ["--quiet"], opts.dry, true); taDue = 0; heavy = true; }
      else if (--taDue === 0) ns.print(`SHORT ${TA} — no room in ${RETRY_CYCLES} cycles; skipping this pass.`);
    }

    // ---- 2c. opt-in spending ----------------------------------------------
    // One module per tick, round-robin. They are 50-60GB one-shots and corp-product.js is
    // resident at 91.6GB, so launching two together would just produce a RAM shortfall log.
    const plan = spendPlan(opts, divisionsFromState(ns));
    if (plan.length && (cycle - 1) % Math.max(1, opts["spend-every"]) === 0 &&
        Date.now() - lastSpend >= SPEND_FLOOR_MS) {
      spendDue = RETRY_CYCLES;
      lastSpend = Date.now();
    }
    if (spendDue > 0 && plan.length && !heavy) {
      // Walk the rotation until something can actually run: a pick may be mid-job (corp-boost.js
      // stays alive while it buys) or too big for the RAM free right now. Skipping to the next
      // one keeps the pass useful instead of wasting it on a module that was never going to go.
      let started = false;
      for (let i = 0; i < plan.length && !started; i++) {
        const pick = plan[(spendTurn + i) % plan.length];
        if (isRunning(ns, pick.script, pick.args)) continue;
        if (!fits(ns, pick.script) && !opts.dry) continue;
        launch(ns, pick.script, pick.args, opts.dry);
        spendTurn += i + 1; spendDue = 0; heavy = started = true;
      }
      if (!started && --spendDue === 0) {
        ns.print(`SHORT — no spend module could run in ${RETRY_CYCLES} cycles; skipping this pass.`);
        spendTurn++;   // don't let one blocked module own the rotation forever
      }
    }

    // ---- 3. watch for the two silent killers ------------------------------
    // One report per division, because there is one supply controller per division. Fixing the
    // wrong division's materials is worse than not fixing anything, so each warning carries the
    // division that raised it and the autosell acts on THAT division's own outputs.
    const reports = readReports(ns);
    const warns = [];
    for (const rep of reports) {
      // Never warn — and above all never AUTO-FIX — from a frozen file.
      if (rep.stale) continue;
      if (rep.noSellCities && rep.noSellCities.length) {
        warns.push(`NO SELL ORDER in ${rep.division}: ${rep.noSellCities.join(", ")} — earning $0 there`);
        if (!opts["no-autosell"] && sellCooldown === 0) {
          // Materials come from the report when it names them; opts.materials is only the
          // fallback for an older report that predates the field.
          const mats = Array.isArray(rep.outputs) && rep.outputs.length
            ? rep.outputs.join(",") : String(opts.materials);
          ns.tprint(`corp-conductor: no sell order in ${rep.noSellCities.length} ${rep.division} cit` +
            `${rep.noSellCities.length === 1 ? "y" : "ies"} — running corp-sell.js for ${mats}.`);
          if (launch(ns, "corp-sell.js",
            ["--materials", mats, "--division", String(rep.division)], opts.dry)) {
            sellCooldown = SELL_COOLDOWN;
          }
        }
      }
      if (rep.congestedCities && rep.congestedCities.length) {
        warns.push(`CONGESTED in ${rep.division}: ${rep.congestedCities.join(", ")} — production halted`);
      }
    }

    // ---- 4. say something useful ------------------------------------------
    // freshState, not readJson: showing last week's funds as if they were live is worse than
    // "waiting for corp-status.js", which statusLine already says for missing data.
    const st = freshState(ns);
    if (cycle % Math.max(1, PRINT_EVERY) === 0) ns.print(statusLine(ns, st, reports, warns, opts));

    // A new warning is worth interrupting for; a repeat of the same one isn't.
    const warnKey = warns.join(" | ");
    if (warnKey && warnKey !== lastWarn) {
      ns.tprint(`\ncorp-conductor WARNING:\n  ${warns.join("\n  ")}\n${advice(warns)}`);
    }
    lastWarn = warnKey;

    if (cycle % Math.max(1, opts["banner-every"]) === 0 &&
        Date.now() - lastBanner >= BANNER_FLOOR_MS) {
      lastBanner = Date.now();
      ns.tprint(`\n[corp] ${statusLine(ns, st, reports, warns, opts)}`);
    }
  }
}

/** The spend modules the user actually switched on, in rotation order.
 *
 *  Boost is expanded per division and bribery is separate from the rest, for opposite reasons:
 *  boost has no corporation-wide form (the split comes from each industry's own factors), and
 *  bribery needs a faction NAME rather than a boolean, because reputation is per-faction and does
 *  not transfer — there is no sensible default to pick on your behalf. */
function spendPlan(opts, divisions) {
  const out = SPENDERS.filter((x) => opts[x.flag]).map((x) => ({ script: x.script, args: x.args.slice() }));
  if (opts["auto-boost"]) {
    for (const d of divisions || []) out.push({ script: BOOST, args: ["--loop", "--division", String(d)] });
  }
  const faction = String(opts["auto-bribe"] || "").trim();
  if (faction) out.push({ script: "corp-bribe.js", args: ["--faction", faction, "--go"] });
  return out;
}

/** Every division's supply report. ns.read is 0GB, so reading them all costs nothing. */
function readReports(ns) {
  const out = [];
  for (const division of divisionsFromState(ns)) {
    const file = REPORT_PREFIX + String(division).replace(/[^A-Za-z0-9_-]/g, "_") + ".txt";
    const rep = readJson(ns, file);
    if (!rep) continue;                       // no supply controller for this division (yet)
    if (!rep.division) rep.division = division;
    rep.ageMs = Number.isFinite(rep.ts) ? Date.now() - rep.ts : Infinity;
    rep.stale = rep.ageMs > REPORT_MAX_AGE_MS;
    out.push(rep);
  }
  return out;
}

/** Build the human-readable line. Everything here comes from files — 0GB. */
function statusLine(ns, st, reports, warns, opts) {
  const bits = [];
  if (st && Number.isFinite(st.funds)) {
    const profit = (st.revenue || 0) - (st.expenses || 0);
    bits.push(`${st.corp || "corp"} · funds $${fmt(ns, st.funds)}`);
    bits.push(`${profit >= 0 ? "+" : "-"}$${fmt(ns, Math.abs(profit))}/s ` +
      `(rev $${fmt(ns, st.revenue || 0)} − exp $${fmt(ns, st.expenses || 0)})`);
    if (Number.isFinite(st.valuation)) bits.push(`val $${fmt(ns, st.valuation)}`);
  } else {
    bits.push("waiting for corp-status.js");
  }
  // Say so when the eyes are shut. Silence from a dead monitor should never read as "all clear".
  // But distinguish the two ways the eyes get shut. Under --no-supply they are shut ON PURPOSE
  // because Smart Supply owns the buying, and telling you to "run corp-supply.js --loop" there is
  // actively bad advice — it would set standing buy rates that fight the game's own per-cycle
  // sizing. Only nag when supply is supposed to be managed and the report has frozen anyway.
  const stale = (reports || []).filter((r) => r.stale);
  if (opts && opts["no-supply"]) {
    if (stale.length) bits.push("supply not managed (Smart Supply owns buying) — congestion detection OFF");
  } else if (stale.length) {
    bits.push(`supply report stale for ${stale.map((r) => r.division).join(", ")} ` +
      `— corp-supply.js should be resident but isn't reporting; congestion detection OFF`);
  }
  const rows = (reports || []).filter((r) => !r.stale).flatMap((r) => r.cities || []);
  if (rows.length) {
    // Per-division, because "total production" across an output division and a support division
    // is a number that means nothing.
    bits.push(`prod ${(reports || []).filter((r) => !r.stale && (r.cities || []).length)
      .map((r) => `${r.division} ${fmt(ns, r.totalProd || 0)}/s`).join(" + ")}`);
    const full = 1 - rows.reduce((a, c) => a + (c.free || 0), 0) / rows.length;
    bits.push(`${rows.length} warehouses ${(100 * full).toFixed(0)}% full`);
  }
  let bonus = 0;
  try { bonus = ns.corporation.getBonusTime(); } catch (e) { /* 0GB, but be safe */ }
  if (bonus > 1000) bits.push(`bonus ${(bonus / 1000).toFixed(0)}s`);
  if (warns.length) bits.push(`!! ${warns.length} warning${warns.length === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

/** Turn warnings into the exact command that fixes them. */
function advice(warns) {
  const out = [];
  if (warns.some((w) => w.startsWith("NO SELL"))) {
    out.push("  Fix:    run corp-sell.js");
  }
  if (warns.some((w) => w.startsWith("CONGESTED"))) {
    // FIND OUT WHAT'S ACTUALLY IN THERE FIRST. A warehouse can be full of unsold output (dump it)
    // or of boost material bought too enthusiastically (sell it back at MP, never dump it) — and
    // the fixes are opposites. Guessing "it must be output" once cost this corporation $100b.
    out.push("  First:  run corp-boost.js          # is it boost material filling the warehouse?");
    out.push("  If YES — boost material is over target. Sell it back at MARKET PRICE, never at 0:");
    out.push("      run corp-boost.js --loop --trim");
    out.push("  If NO — it's unsold output, so dump it and restore pricing straight after:");
    out.push("      run corp-sell.js --materials \"Plants,Food\" --price 0   # ONE cycle only");
    out.push("      run corp-sell.js                                        # back to market price");
    out.push("  Either way:  run corp-warehouse-upgrade.js --add 5          # so it stops happening");
  }
  return out.join("\n");
}

/** Launch a module on home, reporting a RAM shortfall instead of thrashing (same as boot.js).
 *  `routine` marks a launch that happens on a timer (the status refresh) — those log only when
 *  something goes wrong, so `tail corp-conductor.js` stays readable. Failures always log. */
function launch(ns, script, args, dry, routine = false) {
  if (!ns.fileExists(script, "home")) { ns.print(`skip ${script} — not on home.`); return 0; }
  const cost = ns.getScriptRam(script, "home");
  const free = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
  if (dry) { ns.print(`[dry] would run ${script} ${args.join(" ")} (${cost}GB, ${free.toFixed(1)}GB free).`); return 0; }
  if (cost > free) {
    ns.print(`SHORT ${script} — needs ${cost}GB, ${free.toFixed(1)}GB free on home.`);
    return 0;
  }
  const pid = ns.run(script, 1, ...args);
  if (pid) { if (!routine) ns.print(`started ${script} ${args.join(" ")} (pid ${pid}).`); }
  else ns.print(`FAILED ${script} — run refused (needs ${cost}GB).`);
  return pid;
}

/** Would this module fit in home's free RAM right now? Checked BEFORE calling launch() so a
 *  module waiting its turn stays quiet instead of logging a shortfall on every retry. */
function fits(ns, script) {
  if (!ns.fileExists(script, "home")) return true;   // let launch() report the missing file once
  return ns.getScriptRam(script, "home") <= ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
}

/** Same script, same args = the same controller. Two supply instances differ only by their
 *  args, so matching on filename alone would let the second one never start. */
function isRunning(ns, script, args) {
  const want = args.join(" ");
  return ns.ps("home").some((p) => p.filename === script && (p.args || []).join(" ") === want);
}

/** corp-state.txt, but only if fresh enough to trust (see STATE_MAX_AGE_MS). 0GB. */
function freshState(ns) {
  const st = readJson(ns, STATE_FILE);
  return st && Number.isFinite(st.ts) && Date.now() - st.ts <= STATE_MAX_AGE_MS ? st : null;
}

/** Division names from corp-state.txt (0GB), so a division-specific module waits its turn. */
function divisionsFromState(ns) {
  const st = freshState(ns);
  return st && Array.isArray(st.divisions) ? st.divisions : [];
}

/** The product division, if corp-status.js has seen one. 0GB — it's a file read. */
function productDivision(ns) {
  const st = freshState(ns);
  return (st && st.roles && st.roles.product) || "";
}

/** ns.read is 0GB, so reading the modules' output costs the conductor nothing. */
function readJson(ns, file) {
  try {
    const raw = ns.read(file);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// ns.formatNumber was removed in 3.0.0 (tombstone: typeof passes, calling throws).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "0";
  try { return ns.format.number(n, 2); } catch (e) { return String(Math.round(n)); }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-conductor.js — resident brain for the corporation (~3.6GB).\n" +
    "  run corp-conductor.js               start it and leave it; tail it to watch\n" +
    "  run corp-conductor.js --dry         narrate, launch nothing\n" +
    "  run corp-conductor.js --no-supply   don't manage corp-supply.js (running it yourself)\n" +
    "  run corp-conductor.js --no-morale   don't manage corp-morale.js (tea/parties)\n" +
    "  run corp-conductor.js --no-product  don't manage corp-product.js (round 3+)\n" +
    "  run corp-conductor.js --no-autosell don't auto-fix a missing sell order\n" +
    "  run corp-conductor.js --no-ta       don't re-assert Market-TA.II every 30 cycles\n" +
    "  SPENDING (all off by default — the conductor does not spend unless told):\n" +
    "  run corp-conductor.js --auto-upgrade            buy corporation upgrade levels\n" +
    "  run corp-conductor.js --auto-advert             buy AdVert where it pays\n" +
    "  run corp-conductor.js --auto-research           buy research, keeping half the RP pool\n" +
    "  run corp-conductor.js --auto-boost              re-level boost materials per division\n" +
    "  run corp-conductor.js --auto-bribe \"Daedalus\"   funds -> that faction's reputation\n" +
    "  run corp-conductor.js --spend-every 60          cycles between spend passes\n" +
    "  run corp-conductor.js --materials \"Plants\"     what autosell puts on the market\n" +
    "  run corp-conductor.js --banner-every 60        terminal banner cadence, in cycles\n" +
    "  Keeps corp-supply.js resident, refreshes corp-state.txt, and shouts about the two\n" +
    "  silent killers: no sell order ($0.00/s) and warehouse congestion (production halted).\n" +
    "  It takes no investment offer and never goes public — those are one-way and stay yours.\n"
  );
}
