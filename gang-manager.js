/** @param {NS} ns
 *
 *  GANG MANAGER — automates the Tetrads combat gang income stream.
 *  Runs from home alongside commander.js; uses ~0 server RAM beyond its own.
 *
 *      run gang-manager.js [keepLiquid]
 *
 *  keepLiquid = dollars to always leave unspent before buying gear. Default $10m.
 *      run gang-manager.js 50e6
 *
 *  Gang progress survives augmentation installs — auto-rejoins the faction.
 *  Re-run (or add to ascend-boot.js) after each install.
 */

// ---- Tuning ----------------------------------------------------------------
const ASCEND_THRESHOLD  = 1.15; // ascend when any stat's projected asc_mult gain ratio >= this (+15%)
const CLASH_MIN_WIN     = 0.55; // only wage territory warfare when min win-chance vs all rivals >= this
const WANTED_FLOOR      = 0.90; // wantedPenalty below this → divert members to Vigilante Justice
const TRAIN_UNTIL       = 50;   // keep a member on Train Combat until their combat avg reaches this
const KEEP_LIQUID       = 10e6; // min cash on home before spending on gear ($10m default)
const ROSTER_TARGET     = 12;   // roster size that flips task weighting from respect-first to money-first
const TERRITORY_MEMBERS = 1;    // floor of Territory Warfare members during the land-grab (rest flood in until territory ~100%)
const STATUS_EVERY      = 3;    // print a status line every N gang ticks
// ---------------------------------------------------------------------------

const SKIP_TASKS = new Set([
  "Unassigned", "Train Combat", "Train Hacking", "Train Charisma",
  "Territory Warfare", "Vigilante Justice",
]);

const STAT_KEYS = ["str", "def", "dex", "agi", "hack", "cha"];

export async function main(ns) {
  ns.disableLog("ALL");
  const g = ns.gang;

  if (!g.inGang()) {
    ns.tprint("ERROR gang-manager: not in a gang. Start one first, then re-run.");
    return;
  }

  const keepLiquid = Number(ns.args[0]) || KEEP_LIQUID;

  ns.ui.openTail();
  const gi0 = g.getGangInformation();
  ns.print(
    `Gang manager online. Gang: ${gi0.faction} (${gi0.isHacking ? "hacking" : "combat"}). ` +
    `Targeting ${ROSTER_TARGET}-member roster. Keeping $${fmt(keepLiquid)} liquid.`
  );

  // Task stats are static within a session — cache them once.
  const taskStats = {};
  for (const t of g.getTaskNames()) taskStats[t] = g.getTaskStats(t);

  // Equipment names are static too.
  const equipNames = g.getEquipmentNames();

  let tick = 0;

  while (true) {
    await g.nextUpdate();
    tick++;

    const gi = g.getGangInformation();

    // ---- 1. RECRUIT -------------------------------------------------------
    {
      const existing = new Set(g.getMemberNames());
      while (g.canRecruitMember()) {
        let i = 1;
        while (existing.has(`Tetrad-${i}`)) i++;
        const name = `Tetrad-${i}`;
        existing.add(name);
        g.recruitMember(name);
        ns.print(`Recruited ${name}.`);
      }
    }

    // ---- 2. ASCEND --------------------------------------------------------
    for (const name of g.getMemberNames()) {
      const res = g.getAscensionResult(name); // undefined if no xp to gain from
      if (!res) continue;
      if (STAT_KEYS.some(k => (res[k] ?? 0) >= ASCEND_THRESHOLD)) {
        g.ascendMember(name);
        ns.print(`Ascended ${name}.`);
      }
    }

    // ---- 3. ASSIGN --------------------------------------------------------
    const members = g.getMemberNames(); // re-fetch after possible ascensions
    const total = members.length;
    const rosterFull = total >= ROSTER_TARGET;

    // Land-grab: commit most of the roster to Territory Warfare (the only task
    // that builds power) until we own ~100% of the map, then drop to zero and
    // let everyone earn. Territory is a global multiplier on all money/respect,
    // so maxing it once permanently lifts the whole gang's income ceiling.
    const landGrab = gi.territory < 0.99;
    const twCount = landGrab
      ? Math.max(TERRITORY_MEMBERS, total - 3) // keep ~3 earning/training during the grab
      : 0;

    // Vigilantes: divert ~25% (min 1) when wanted penalty needs recovery
    const vigCount = gi.wantedPenalty < WANTED_FLOOR
      ? Math.max(1, Math.floor(total * 0.25))
      : 0;

    let twAssigned = 0, vigAssigned = 0;

    for (const name of members) {
      const mi = g.getMemberInformation(name);
      const combatAvg = (mi.str + mi.def + mi.dex + mi.agi) / 4;

      if (combatAvg < TRAIN_UNTIL) {
        g.setMemberTask(name, "Train Combat");
        continue;
      }

      if (twAssigned < twCount) {
        g.setMemberTask(name, "Territory Warfare");
        twAssigned++;
        continue;
      }

      if (vigAssigned < vigCount) {
        g.setMemberTask(name, "Vigilante Justice");
        vigAssigned++;
        continue;
      }

      g.setMemberTask(name, bestCrimeTask(taskStats, mi, rosterFull));
    }

    // ---- 4. EQUIP ---------------------------------------------------------
    if (ns.getServerMoneyAvailable("home") > keepLiquid) {
      for (const name of members) {
        const mi = g.getMemberInformation(name);
        const owned = new Set([...mi.upgrades, ...mi.augmentations]);
        const myTask = taskStats[mi.task] ?? null;

        // Augmentations first — they survive ascension, so best long-term value
        for (const eq of equipNames) {
          if (g.getEquipmentType(eq) !== "Augmentation") continue;
          if (owned.has(eq)) continue;
          if (ns.getServerMoneyAvailable("home") - g.getEquipmentCost(eq) < keepLiquid) continue;
          g.purchaseEquipment(name, eq);
          owned.add(eq);
        }

        // Other gear that boosts at least one stat the member's current task uses
        for (const eq of equipNames) {
          if (g.getEquipmentType(eq) === "Augmentation") continue;
          if (owned.has(eq)) continue;
          if (!equipHelpsTask(g.getEquipmentStats(eq), myTask)) continue;
          if (ns.getServerMoneyAvailable("home") - g.getEquipmentCost(eq) < keepLiquid) continue;
          g.purchaseEquipment(name, eq);
          owned.add(eq);
        }
      }
    }

    // ---- 5. TERRITORY TOGGLE ----------------------------------------------
    const allGangs = g.getAllGangInformation();
    const rivals = Object.keys(allGangs).filter(f => f !== gi.faction);
    const minWin = rivals.length > 0
      ? Math.min(...rivals.map(f => g.getChanceToWinClash(f)))
      : 1;
    g.setTerritoryWarfare(minWin >= CLASH_MIN_WIN);

    // ---- 6. STATUS --------------------------------------------------------
    if (tick % STATUS_EVERY === 0) printStatus(ns, gi, g, members, minWin);
  }
}

/** Score every crime task for this member and return the best name. */
function bestCrimeTask(taskStats, mi, rosterFull) {
  // Respect-first until roster is full, then flip to money.
  const wRespect = rosterFull ? 1  : 10;
  const wMoney   = rosterFull ? 10 : 1;

  let best = null, bestScore = -Infinity;
  for (const [name, ts] of Object.entries(taskStats)) {
    if (SKIP_TASKS.has(name)) continue;
    const score = (ts.baseRespect * wRespect + ts.baseMoney * wMoney)
      * statFit(ts, mi) / Math.max(1, ts.difficulty);
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best ?? "Mug People";
}

/** Weighted avg of the member's stats, weighted by the task's stat weights. */
function statFit(ts, mi) {
  const statMap = {
    hackWeight: mi.hack, strWeight: mi.str, defWeight: mi.def,
    dexWeight:  mi.dex,  agiWeight: mi.agi, chaWeight: mi.cha,
  };
  let wSum = 0, wStatSum = 0;
  for (const [key, stat] of Object.entries(statMap)) {
    const w = ts[key] ?? 0;
    if (w > 0) { wSum += w; wStatSum += w * stat; }
  }
  return wSum > 0 ? wStatSum / wSum : 1;
}

/** True if buying this equipment helps the stat(s) the current task weights. */
function equipHelpsTask(eqStats, ts) {
  if (!ts) return true; // unknown task → buy it anyway
  if (eqStats.hack && (ts.hackWeight ?? 0) > 0) return true;
  if (eqStats.str  && (ts.strWeight  ?? 0) > 0) return true;
  if (eqStats.def  && (ts.defWeight  ?? 0) > 0) return true;
  if (eqStats.dex  && (ts.dexWeight  ?? 0) > 0) return true;
  if (eqStats.agi  && (ts.agiWeight  ?? 0) > 0) return true;
  if (eqStats.cha  && (ts.chaWeight  ?? 0) > 0) return true;
  return false;
}

function printStatus(ns, gi, g, members, minWin) {
  const taskCounts = {};
  for (const name of members) {
    const task = g.getMemberInformation(name).task;
    taskCounts[task] = (taskCounts[task] || 0) + 1;
  }
  const taskStr = Object.entries(taskCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n}×${t}`)
    .join(", ");

  const penalty   = (gi.wantedPenalty * 100).toFixed(1);
  const territory = (gi.territory     * 100).toFixed(1);
  const warfare   = gi.territoryWarfareEngaged
    ? `WAR (win ${(minWin * 100).toFixed(0)}%)`
    : "peace";

  ns.print(
    `gang [${members.length}] | ` +
    `rep ${fmt(gi.respect)} (+${fmt(gi.respectGainRate)}/s) | ` +
    `$${fmt(gi.moneyGainRate)}/s | ` +
    `penalty ${penalty}% | ` +
    `terr ${territory}% [${warfare}] | ` +
    taskStr
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
