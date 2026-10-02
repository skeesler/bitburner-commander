/** @param {NS} ns
 *
 *  SLEEVE MANAGER v3 — gives every sleeve a ROLE, not just a crime.
 *
 *      run sleeve-manager.js                          # auto: pick roles from what the node needs
 *      run sleeve-manager.js --roles "bb,bb,bb,faction,faction,crime"   # per sleeve, in order
 *      run sleeve-manager.js --once                   # one pass, print the plan, exit
 *
 *  Before any role: shock to 0 (shockBonus = (100-shock)/100 taxes rep, XP, money and Bladeburner
 *  gains, and sleeve aug purchases are gated on shock === 0 [SRC: Sleeve.ts:356]), then sync to
 *  100. Entering a new node resets shock to 100 but sync to max(Memory, 1) [SRC: sleeve.prestige()],
 *  so with 100 Memory only the shock needs working off. Shock Recovery runs at 0.0003/cycle against
 *  0.0001 passive: ~5.4 points an hour, so 100 -> 0 is most of a day.
 *
 *  EXCEPT FOR KARMA. A sleeve's crime takes crime.karma x syncBonus() off your karma, with NO shock
 *  term (SleeveCrimeWork.ts); shock only cuts the XP and money. So while you're still earning
 *  karma toward a gang, auto sleeves skip recovery and commit crime from minute one (found live:
 *  -18k karma from sleeves still at 77% shock).
 *
 *  ROLES (v3.0.1 source for every rule):
 *    faction  work for a joined faction whose augs you still lack rep for — reputation goes to
 *             YOUR standing. One sleeve per faction (NetscriptFunctions/Sleeve.ts:152), never the
 *             gang's faction. Nearest-to-done factions first; work type by the sleeve's strengths
 *             (setToFactionWork returns false for a type the faction doesn't offer, so we just try).
 *    bb       Bladeburner, all credited to you (rank, money, Bladeburner rep):
 *               contracts  one sleeve per contract type (Sleeve.ts:283) — Retirement, Bounty Hunter,
 *                          Tracking — only while it has count and the sleeve's odds are good;
 *               Diplomacy  one sleeve when chaos in Bladeburner's city is high (sleeve actions run
 *                          in Bladeburner's city, not the sleeve's);
 *               Infiltrate every 60s adds 0.5/sqrt(n) to EVERY contract and operation count, n =
 *                          infiltrating sleeves (Bladeburner.ts:1253) — one is plenty;
 *               Support    +1 team member each, for operations and Black Ops (:747).
 *    crime    --crime (default Homicide): money, combat XP, karma.
 *    train    Powerhouse Gym, Sector-12, on the sleeve's weakest combat stat (travels there first).
 *    idle     leave the sleeve alone (you're steering it by hand).
 *    auto     no gang yet and karma above -54k -> crime (a gang is the best early earner);
 *             in Bladeburner -> the first 4 auto sleeves go bb; the rest -> faction while any
 *             faction still has rep to earn, else crime.
 *
 *  Tasks are only re-issued when they CHANGE: setting the same task again restarts it, and a
 *  contract or crime restarted every tick never finishes.
 *
 *  RAM is deliberately not optimised: this is for once a node is under way (early on, setting
 *  sleeves to Shock Recovery then Homicide by hand is enough). Singularity calls pick faction
 *  targets; with SF4.3 they cost normal RAM.
 */

// ---- Tuning ----------------------------------------------------------------
const CRIME          = "Homicide";
const SHOCK_ABOVE    = 0;
const SYNC_TARGET    = 100;
const KEEP_LIQUID    = 0;
const TICK           = 6000;
const STATUS_EVERY   = 5;
const KARMA_FOR_GANG = -54000;
const BB_AUTO        = 4;      // auto sleeves given to Bladeburner (3 contracts + 1 infiltrate)
const BB_MIN_CHANCE  = 0.6;    // lower bound of a sleeve's contract success range
const BB_CHAOS_HIGH  = 50;     // above this, one bb sleeve does Diplomacy
const CONTRACTS      = ["Retirement", "Bounty Hunter", "Tracking"];   // most rank first
const GYM            = "Powerhouse Gym";
const GYM_CITY       = "Sector-12";
const ROLES          = ["auto", "faction", "bb", "crime", "train", "idle"];
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const sl = ns.sleeve;
  const opts = ns.flags([
    ["roles", "auto"], ["crime", CRIME], ["shock", SHOCK_ABOVE], ["no-sync", false],
    ["keepLiquid", KEEP_LIQUID], ["no-augs", false], ["bb-min-chance", BB_MIN_CHANCE],
    ["once", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  let count;
  try { count = sl.getNumSleeves(); }
  catch (e) { ns.tprint("ERROR sleeve-manager: sleeve API unavailable — needs BitNode 10 / Source-File 10."); return; }
  if (count === 0) { ns.tprint("ERROR sleeve-manager: you have no sleeves."); return; }

  const wanted = String(opts.roles).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = wanted.filter((r) => !ROLES.includes(r));
  if (bad.length) { ns.tprint(`sleeve-manager: unknown role(s) ${bad.join(", ")} — use ${ROLES.join(" ")}`); return; }

  if (!opts.once) ns.ui.openTail();
  ns.print(`Sleeve manager v3: ${count} sleeve(s), roles ${wanted.join(",")}${wanted.length < count ? " (rest auto)" : ""}.`);

  // Survives between ticks: factions found to offer no work at all (Bladeburners, for one) are
  // never targets again — otherwise one would soak up a sleeve every tick forever.
  const state = { noWork: new Set() };
  for (let tick = 0; ; tick++) {
    const n = sl.getNumSleeves();
    const ctx = { ns, sl, opts, n, notes: [], labels: [], state };
    ctx.world = readWorld(ns, n, state);

    // ---- 1. who is free to take a role (shock and sync come first) ----------
    // ...except in the karma phase, where shock costs nothing an auto sleeve is there for.
    const karmaPhase = !ctx.world.inGang && ctx.world.karma > KARMA_FOR_GANG;
    const free = [];
    for (let i = 0; i < n; i++) {
      const s = sl.getSleeve(i);
      if (karmaPhase && (wanted[i] || "auto") === "auto") { free.push(i); continue; }
      if (s.shock > opts.shock) { setTask(ctx, i, { kind: "RECOVERY" }); ctx.labels[i] = `shock ${Math.round(s.shock)}`; continue; }
      if (!opts["no-sync"] && s.sync < SYNC_TARGET) { setTask(ctx, i, { kind: "SYNCHRO" }); ctx.labels[i] = `sync ${Math.round(s.sync)}`; continue; }
      free.push(i);
    }

    // ---- 2. roles -----------------------------------------------------------
    const role = resolveRoles(ctx, free, wanted);
    const byRole = (r) => free.filter((i) => role[i] === r);
    assignBladeburner(ctx, byRole("bb"));
    assignFactions(ctx, byRole("faction"));
    for (const i of byRole("crime")) {
      setTask(ctx, i, { kind: "CRIME", crime: opts.crime });
      const shock = Math.round(sl.getSleeve(i).shock);
      ctx.labels[i] = karmaPhase && shock > 0 ? `${opts.crime} (karma; shock ${shock} doesn't cut it)` : opts.crime;
    }
    for (const i of byRole("train")) assignTraining(ctx, i);
    for (const i of byRole("idle")) ctx.labels[i] = "idle (manual)";

    // ---- 3. sleeve augs -----------------------------------------------------
    if (!opts["no-augs"] && ns.getServerMoneyAvailable("home") > opts.keepLiquid) buySleeveAugs(ctx);

    // ---- 4. say so ----------------------------------------------------------
    for (const note of ctx.notes) ns.print(note);
    if (opts.once || tick % STATUS_EVERY === 0) {
      const line = `karma ${fmt(ctx.world.karma)} | ` +
        [...Array(n).keys()].map((i) => `#${i} ${ctx.labels[i] || "?"}`).join(" | ");
      if (opts.once) ns.tprint(line); else ns.print(line);
    }
    if (opts.once) return;
    await ns.sleep(TICK);
  }
}

// =============================== the world ==================================

/** Everything the role logic decides on, read once per tick. Every probe is guarded: gang and
 *  Bladeburner calls throw in nodes where you lack access, which just means "not in one". */
function readWorld(ns, n, state) {
  const w = { karma: safe(() => ns.heart.break(), 0) };
  w.inGang = safe(() => ns.gang.inGang(), false);
  w.gangFaction = w.inGang ? safe(() => ns.gang.getGangInformation().faction, "") : "";
  w.inBB = safe(() => ns.bladeburner.inBladeburner(), false);
  if (w.inBB) {
    w.bbCity = safe(() => ns.bladeburner.getCity(), "");
    w.bbChaos = w.bbCity ? safe(() => ns.bladeburner.getCityChaos(w.bbCity), 0) : 0;
    w.contractCount = {};
    for (const c of CONTRACTS) w.contractCount[c] = safe(() => ns.bladeburner.getActionCountRemaining("Contracts", c), 0);
  }
  w.factionNeeds = factionNeeds(ns, w.gangFaction).filter((x) => !state.noWork.has(x.faction));
  w.tasks = [...Array(n).keys()].map((i) => safe(() => ns.sleeve.getTask(i), null));
  return w;
}

/** Joined factions that still have an aug you don't own and lack the rep for, as
 *  [{faction, deficit}], smallest deficit first (finish factions, unlock augs sooner). */
function factionNeeds(ns, gangFaction) {
  const owned = new Set(safe(() => ns.singularity.getOwnedAugmentations(true), []));
  const out = [];
  for (const f of safe(() => ns.getPlayer().factions, [])) {
    if (f === gangFaction) continue;
    let need = 0;
    for (const a of safe(() => ns.singularity.getAugmentationsFromFaction(f), [])) {
      if (owned.has(a) || a === "NeuroFlux Governor") continue;   // NFG never runs out; it isn't a goal
      need = Math.max(need, safe(() => ns.singularity.getAugmentationRepReq(a), 0));
    }
    const deficit = need - safe(() => ns.singularity.getFactionRep(f), 0);
    if (deficit > 0) out.push({ faction: f, deficit });
  }
  return out.sort((a, b) => a.deficit - b.deficit);
}

/** Explicit role per index where given; "auto" (or no entry) resolved from the world. */
function resolveRoles(ctx, free, wanted) {
  const { world: w } = ctx;
  const role = {};
  const autos = [];
  for (const i of free) {
    const r = wanted[i] || "auto";
    if (r === "auto") autos.push(i); else role[i] = r;
  }
  if (!w.inGang && w.karma > KARMA_FOR_GANG) {
    for (const i of autos) role[i] = "crime";              // karma toward a gang comes first (shock or not)
    return role;
  }
  let rest = autos;
  if (w.inBB) { for (const i of rest.slice(0, BB_AUTO)) role[i] = "bb"; rest = rest.slice(BB_AUTO); }
  const takenByHand = free.filter((i) => role[i] === "faction").length;
  const factionSlots = Math.max(0, w.factionNeeds.length - takenByHand);
  rest.forEach((i, k) => { role[i] = k < factionSlots ? "faction" : "crime"; });
  return role;
}

// =============================== roles ======================================

function assignFactions(ctx, sleeves) {
  const { sl, world: w, notes } = ctx;
  const needed = new Set(w.factionNeeds.map((x) => x.faction));
  const taken = new Set();
  const unplaced = [];
  // Keep a sleeve on its faction while that faction still needs rep: changing restarts nothing,
  // but churning between factions would make the status line useless.
  for (const i of sleeves) {
    const t = w.tasks[i];
    if (t && t.type === "FACTION" && needed.has(t.factionName) && !taken.has(t.factionName)) {
      taken.add(t.factionName);
      ctx.labels[i] = `${t.factionName} (${t.factionWorkType})`;
    } else unplaced.push(i);
  }
  for (const i of unplaced) {
    const types = workTypeOrder(sl.getSleeve(i));
    let placed = false;
    for (const target of w.factionNeeds) {
      if (taken.has(target.faction)) continue;
      let started = "", refused = false;
      for (const type of types) {
        let ok = false;
        try { ok = sl.setToFactionWork(i, target.faction, type); } catch (e) { refused = true; break; }
        if (ok) { started = type; break; }
      }
      if (started) {
        taken.add(target.faction);
        notes.push(`sleeve ${i}: ${target.faction} (${started}) — ${fmt(target.deficit)} rep to go`);
        ctx.labels[i] = `${target.faction} (${started})`;
        placed = true;
        break;
      }
      // Offers none of the three work types (Bladeburners) or refused outright (the gang's
      // faction): never a target again this run. Then try the next faction for this sleeve.
      if (!refused) ctx.state.noWork.add(target.faction);
      else taken.add(target.faction);
    }
    if (!placed) {
      setTask(ctx, i, { kind: "CRIME", crime: ctx.opts.crime });
      ctx.labels[i] = `${ctx.opts.crime} (no faction left to work)`;
    }
  }
}

/** Hacking first for a hacker, security first for a fighter; field sits in between. */
function workTypeOrder(s) {
  const k = s.skills;
  const combat = (k.strength + k.defense + k.dexterity + k.agility) / 4;
  return k.hacking >= combat ? ["hacking", "field", "security"] : ["security", "field", "hacking"];
}

function assignBladeburner(ctx, sleeves) {
  const { ns, sl, opts, world: w } = ctx;
  if (!sleeves.length) return;
  if (!w.inBB) { for (const i of sleeves) ctx.labels[i] = "bb (not in Bladeburner — idle)"; return; }
  const minChance = Number(opts["bb-min-chance"]);
  const canWin = (c, i) =>
    safe(() => ns.bladeburner.getActionEstimatedSuccessChance("Contracts", c, i), [0, 0])[0] >= minChance;
  const contractOf = (i) => {
    const t = w.tasks[i];
    return t && t.type === "BLADEBURNER" && CONTRACTS.includes(t.actionName) ? t.actionName : "";
  };
  // ONE SLEEVE PER CONTRACT, ENFORCED BY THE GAME (Sleeve.ts:283) — so assignments must be stable.
  // Handing a contract to sleeve 0 while sleeve 1 still holds it throws, every tick, until sleeve 1
  // is moved — which the first version only did LATER in the same pass (live, 2026-10-02).
  //   1. a sleeve already on a contract it can still win keeps it;
  //   2. a contract held by a sleeve leaving Bladeburner (another role, recovery) waits a tick;
  //   3. what's left goes to the sleeves still unplaced.
  let contractsLeft = CONTRACTS.filter((c) => w.contractCount[c] >= 1);
  const inSet = new Set(sleeves);
  for (let j = 0; j < w.tasks.length; j++) {
    const held = contractOf(j);
    if (held && !inSet.has(j)) contractsLeft = contractsLeft.filter((c) => c !== held);
  }
  const keep = {};
  for (const i of sleeves) {
    const held = contractOf(i);
    if (held && contractsLeft.includes(held) && canWin(held, i)) {
      keep[i] = held;
      contractsLeft = contractsLeft.filter((c) => c !== held);
    }
  }
  let diplomacy = w.bbChaos > BB_CHAOS_HIGH, infiltrate = true;
  for (const i of sleeves) {
    const pick = keep[i] || contractsLeft.find((c) => canWin(c, i));
    if (pick) {
      contractsLeft = contractsLeft.filter((c) => c !== pick);
      setTask(ctx, i, { kind: "BB", action: "Take on contracts", contract: pick });
      ctx.labels[i] = `bb ${pick}`;
    } else if (diplomacy) {
      diplomacy = false;
      setTask(ctx, i, { kind: "BB", action: "Diplomacy" });
      ctx.labels[i] = `bb Diplomacy (chaos ${Math.round(w.bbChaos)})`;
    } else if (infiltrate) {
      infiltrate = false;
      setTask(ctx, i, { kind: "BB", action: "Infiltrate Synthoids" });
      ctx.labels[i] = "bb Infiltrate";
    } else {
      setTask(ctx, i, { kind: "BB", action: "Support main sleeve" });
      ctx.labels[i] = "bb Support";
    }
  }
}

function assignTraining(ctx, i) {
  const { sl, notes } = ctx;
  const s = sl.getSleeve(i);
  if (s.city !== GYM_CITY) {
    if (!safe(() => sl.travel(i, GYM_CITY), false)) { ctx.labels[i] = "train (can't afford travel)"; return; }
    notes.push(`sleeve ${i}: travelled to ${GYM_CITY} to train`);
  }
  const k = s.skills;
  const stat = [["str", k.strength], ["def", k.defense], ["dex", k.dexterity], ["agi", k.agility]]
    .sort((a, b) => a[1] - b[1])[0][0];
  setTask(ctx, i, { kind: "GYM", stat });
  ctx.labels[i] = `gym ${stat}`;
}

// =============================== tasks ======================================

/** Issue a task only if the sleeve isn't already doing exactly that. */
function setTask(ctx, i, want) {
  const { sl, ns, world } = ctx;
  const t = (world && world.tasks[i]) || safe(() => sl.getTask(i), null);
  const type = t ? t.type : null;
  let same = false, go;
  switch (want.kind) {
    case "RECOVERY": same = type === "RECOVERY"; go = () => sl.setToShockRecovery(i); break;
    case "SYNCHRO":  same = type === "SYNCHRO";  go = () => sl.setToSynchronize(i); break;
    case "CRIME":    same = type === "CRIME" && t.crimeType === want.crime; go = () => sl.setToCommitCrime(i, want.crime); break;
    case "GYM":      same = type === "CLASS" && t.classType === want.stat; go = () => sl.setToGymWorkout(i, GYM, want.stat); break;
    case "BB": {
      if (want.action === "Infiltrate Synthoids") same = type === "INFILTRATE";
      else if (want.action === "Support main sleeve") same = type === "SUPPORT";
      else same = type === "BLADEBURNER" && t.actionName === (want.contract || want.action);
      go = () => sl.setToBladeburnerAction(i, want.action, want.contract);
      break;
    }
    default: return;
  }
  if (same) return;
  let ok = false;
  try { ok = go(); } catch (e) { ctx.notes.push(`WARN sleeve ${i}: ${want.kind} ${want.crime || want.action || want.stat || ""} — ${String(e).slice(0, 120)}`); return; }
  if (ok === false) ctx.notes.push(`WARN sleeve ${i}: could not start ${want.kind} ${want.crime || want.action || want.stat || ""}`);
}

/** Buy affordable sleeve augs, cheapest first, so a tight budget spreads across sleeves. */
function buySleeveAugs(ctx) {
  const { ns, sl, opts, n, notes } = ctx;
  for (let i = 0; i < n; i++) {
    const augs = safe(() => sl.getSleevePurchasableAugs(i), []).sort((a, b) => a.cost - b.cost);
    for (const a of augs) {
      if (ns.getServerMoneyAvailable("home") - a.cost < opts.keepLiquid) break;
      if (sl.purchaseSleeveAug(i, a.name)) notes.push(`sleeve ${i}: bought "${a.name}" ($${fmt(a.cost)})`);
    }
  }
}

// =============================== small stuff ================================

function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  for (const [v, s] of [[1e15, "q"], [1e12, "t"], [1e9, "b"], [1e6, "m"], [1e3, "k"]]) {
    if (a >= v) return sign + (a / v).toFixed(2) + s;
  }
  return sign + a.toFixed(0);
}

function printHelp(ns) {
  ns.tprint(
    "\nsleeve-manager.js v3 — a role per sleeve (after shock recovery and sync).\n" +
    "  run sleeve-manager.js                               auto: crime for a gang, bb if in Bladeburner, else faction rep\n" +
    "  run sleeve-manager.js --roles \"bb,bb,bb,bb,faction\"  per sleeve, in order; missing entries are auto\n" +
    "  roles: auto faction bb crime train idle\n" +
    "  --crime Homicide   crime for the crime role (default Homicide)\n" +
    "  --bb-min-chance 0.6  a sleeve only takes a contract it wins at least this often\n" +
    "  --shock 0  --no-sync  --keepLiquid 1t  --no-augs  --once (one pass, print the plan)\n"
  );
}
