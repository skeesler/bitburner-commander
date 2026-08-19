/** @param {NS} ns
 *
 *  SLEEVE MANAGER — puts your BN10 duplicate sleeves to work.
 *  Runs from home alongside commander.js / gang-manager.js; tiny footprint.
 *
 *      run sleeve-manager.js [--crime Mug] [--shock 90] [--sync] [--keepLiquid 0] [--no-augs]
 *
 *  Default behaviour: knock the worst edge off shock, then commit crime on every
 *  sleeve (karma + money + combat xp) and buy any affordable sleeve augs.
 *
 *    --crime NAME     crime every sleeve commits. Default "Mug" (reliable). Switch
 *                     to "Homicide" for far more negative karma once combat is up.
 *    --shock N        run Shock Recovery only while shock% is ABOVE N, then push
 *                     through the rest as it decays. Default 90. Use 0 to fully
 *                     de-shock first (max output), 100 to never recover.
 *    --sync           Synchronize each sleeve to 100% before working (better stat
 *                     transfer). Default off — go straight to crime.
 *    --keepLiquid N   min cash on home before buying sleeve augs. Default $0.
 *    --no-augs        never auto-buy sleeve augmentations.
 *
 *  Needs BitNode 10 / Source-File 10. Progress resets with the node; re-run after
 *  each install (or add to ascend-boot.js).
 */

// ---- Tuning ----------------------------------------------------------------
const CRIME         = "Mug"; // crime every sleeve commits (karma + money + combat xp)
const SHOCK_ABOVE   = 90;    // run Shock Recovery only while shock% is above this
const SYNC_TARGET   = 100;   // when --sync is set, Synchronize until sync% reaches this
const KEEP_LIQUID    = 0;    // min cash on home before buying sleeve augs
const TICK          = 6000;  // ms between control passes (sleeves update slowly)
const STATUS_EVERY  = 5;     // print a status line every N ticks
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const sl = ns.sleeve;

  const opts = ns.flags([
    ["crime", CRIME],
    ["shock", SHOCK_ABOVE],
    ["sync", false],
    ["keepLiquid", KEEP_LIQUID],
    ["no-augs", false],
    ["help", false],
  ]);

  if (opts.help) { printHelp(ns); return; }

  let count;
  try { count = sl.getNumSleeves(); }
  catch (e) { ns.tprint("ERROR sleeve-manager: sleeve API unavailable — needs BitNode 10 / Source-File 10."); return; }
  if (count === 0) { ns.tprint("ERROR sleeve-manager: you have no sleeves."); return; }

  ns.ui.openTail();
  ns.print(
    `Sleeve manager online. ${count} sleeve(s). Crime: ${opts.crime}. ` +
    (opts.sync ? `Sync→${SYNC_TARGET}% first. ` : "") +
    `Shock floor ${opts.shock}%. Keeping $${fmt(opts.keepLiquid)} liquid.`
  );

  let tick = 0;

  while (true) {
    const n = sl.getNumSleeves();

    // ---- 1. ASSIGN --------------------------------------------------------
    for (let i = 0; i < n; i++) {
      const s = sl.getSleeve(i);

      // Sync first (opt-in): worthless work until stats actually transfer to you.
      if (opts.sync && s.sync < SYNC_TARGET) { setTask(ns, sl, i, "SYNCHRO", opts.crime); continue; }

      // Shock recovery: only knock the worst edge off, then crime through the rest.
      if (s.shock > opts.shock) { setTask(ns, sl, i, "RECOVERY", opts.crime); continue; }

      // Earn: crime for karma + money + combat xp.
      setTask(ns, sl, i, "CRIME", opts.crime);
    }

    // ---- 2. BUY AUGS ------------------------------------------------------
    if (!opts["no-augs"] && ns.getServerMoneyAvailable("home") > opts.keepLiquid) {
      buySleeveAugs(ns, sl, n, opts.keepLiquid);
    }

    // ---- 3. STATUS --------------------------------------------------------
    if (tick++ % STATUS_EVERY === 0) printStatus(ns, sl, n);

    await ns.sleep(TICK);
  }
}

/** Set a sleeve's task, but only if it isn't already doing exactly that —
 *  re-issuing setToCommitCrime every tick would restart the crime and it would
 *  never complete. */
function setTask(ns, sl, i, want, crime) {
  const t = sl.getTask(i);
  const type = t ? t.type : null;

  if (want === "CRIME") {
    if (type === "CRIME" && t.crimeType === crime) return;
    if (!sl.setToCommitCrime(i, crime))
      ns.print(`WARN sleeve ${i}: could not start crime "${crime}".`);
  } else if (want === "RECOVERY") {
    if (type === "RECOVERY") return;
    sl.setToShockRecovery(i);
  } else if (want === "SYNCHRO") {
    if (type === "SYNCHRO") return;
    sl.setToSynchronize(i);
  }
}

/** Buy affordable sleeve augs (permanent per-sleeve boosts), cheapest first so a
 *  tight budget spreads across sleeves instead of blowing on one pricey aug. */
function buySleeveAugs(ns, sl, n, keepLiquid) {
  for (let i = 0; i < n; i++) {
    const augs = sl.getSleevePurchasableAugs(i); // [{name, cost}] — already rep-gated
    augs.sort((a, b) => a.cost - b.cost);
    for (const a of augs) {
      if (ns.getServerMoneyAvailable("home") - a.cost < keepLiquid) break; // rest are pricier
      if (sl.purchaseSleeveAug(i, a.name))
        ns.print(`Sleeve ${i}: bought "${a.name}" ($${fmt(a.cost)}).`);
    }
  }
}

function printStatus(ns, sl, n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const s = sl.getSleeve(i);
    parts.push(`#${i} ${taskLabel(sl.getTask(i))} shk${Math.round(s.shock)} syn${Math.round(s.sync)}`);
  }
  ns.print(`karma ${fmt(ns.heart.break())} (-54k for a gang) | ` + parts.join(" | "));
}

function taskLabel(t) {
  if (!t) return "idle";
  if (t.type === "CRIME") return t.crimeType ?? "crime";
  return t.type.toLowerCase();
}

function printHelp(ns) {
  ns.tprint(
    "\nsleeve-manager.js — work your BN10 sleeves (crime by default).\n" +
    "  run sleeve-manager.js [--crime Mug] [--shock 90] [--sync] [--keepLiquid 0] [--no-augs]\n" +
    "  --crime NAME   crime to commit (e.g. Mug, Homicide). Default Mug.\n" +
    "  --shock N      recover shock only while above N% (0=full de-shock, 100=never). Default 90.\n" +
    "  --sync         Synchronize to 100% before working. Default off.\n" +
    "  --keepLiquid N min cash before buying sleeve augs. Default 0.\n" +
    "  --no-augs      don't auto-buy sleeve augs.\n"
  );
}

function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  for (const [v, s] of [[1e12, "t"], [1e9, "b"], [1e6, "m"], [1e3, "k"]]) {
    if (a >= v) return sign + (a / v).toFixed(2) + s;
  }
  return n.toFixed(0);
}
