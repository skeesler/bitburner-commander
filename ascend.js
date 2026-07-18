/** @param {NS} ns
 *
 *  ASCEND — the augmentation flywheel, run as a background loop.
 *
 *      run ascend.js [--install] [--formulas] [--join-all] [--no-join]
 *                    [--no-work] [--no-nfg] [--reserve N] [--dry] [--cb script]
 *
 *  This is the "buy every aug → install → re-grind with fatter multipliers" loop
 *  we used to do by hand, turned into a script via the Singularity API (ns.singularity.*).
 *  Every tick it:
 *    1. Buys the TOR router, then every port cracker, as soon as each is affordable
 *       (add --formulas to also grab Formulas.exe). Uses the game's OWN darkweb
 *       program list, so it buys with whatever exact name strings your version reports.
 *    2. Accepts faction invitations. By default it SKIPS factions that have enemies
 *       (joining them can permanently lock you out of a rival) — pass --join-all to
 *       take those too. --no-join disables joining entirely.
 *    3. Works (in the background, no focus stolen) for a faction that still gates an
 *       aug you can't yet afford on reputation — channelling the grind toward unlocks.
 *       --no-work leaves your player action alone.
 *    4. Buys every augmentation you have the rep + cash + prerequisites for, most-
 *       expensive-first (respects the escalating price multiplier), then pours
 *       leftover cash into NeuroFlux Governor (--no-nfg to skip).
 *    5. ONLY IF you pass --install: when there's nothing left to buy this pass, it
 *       installs (which resets you to level 1 and wipes cloud servers + programs) and
 *       relaunches your commander via the callback. Without --install it just keeps
 *       banking augs and never pulls that trigger — you install when YOU'RE ready.
 *
 *  --reserve N  keep $N in the bank (default 0).   --dry  preview, spend nothing.
 *  --cb script  what to relaunch after an install (default commander.js).
 *
 *  RAM NOTE: Singularity functions are RAM-expensive, and OUTSIDE BitNode 4 that cost
 *  is ×16 / ×4 / ×1 for Source-File 4 level 1 / 2 / 3. This script mentions ~16 of them,
 *  so at SF4.1 it wants a chunk of home RAM. Inside BN4 it's cheap. If it won't fit,
 *  raise the SF4 level (re-clear BN4) or run it on a bigger home.
 *
 *  Signatures were pinned against the v3 docs but NOT run live here — trust the in-game
 *  `ns.singularity.` autocomplete if any call errors, and tell me.
 */

const CRACKERS = ["brutessh", "ftpcrack", "relaysmtp", "httpworm", "sqlinject"];
const NFG = "NeuroFlux Governor";
const TICK = 12000; // ms between passes; Singularity actions are slow, no need to spin fast

export async function main(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags([
    ["install", false],    // actually pull the install trigger when out of buys
    ["formulas", false],   // also buy Formulas.exe from the darkweb
    ["join-all", false],   // join even factions that have enemies
    ["no-join", false],    // don't auto-join at all
    ["no-work", false],    // don't auto-work factions for rep
    ["no-nfg", false],     // don't dump leftover cash into NeuroFlux
    ["reserve", 0],        // cash to keep in the bank
    ["dry", false],        // preview only — never spend
    ["cb", "commander.js"], // callback script relaunched after an install
  ]);
  const reserve = Number(flags["reserve"]) || 0;
  const dry = flags["dry"];

  ns.ui.openTail();
  ns.print(`ASCEND online — install=${flags["install"] ? "ARMED" : "off"}, ` +
           `join=${flags["no-join"] ? "off" : (flags["join-all"] ? "all" : "safe")}, ` +
           `work=${flags["no-work"] ? "off" : "on"}, nfg=${flags["no-nfg"] ? "off" : "on"}` +
           `${dry ? ", DRY-RUN" : ""}, reserve=$${fmt(ns, reserve)}.`);

  const sing = ns.singularity;

  while (true) {
    const spendable = () => Math.max(0, ns.getServerMoneyAvailable("home") - reserve);

    // 1. Darkweb tools — TOR first, then crackers (+ optional Formulas).
    buyTools(ns, sing, spendable, flags["formulas"], dry);

    // 2. Factions — accept invitations (skipping enemy-bearing ones unless --join-all).
    if (!flags["no-join"]) joinFactions(ns, sing, flags["join-all"], dry);

    // 3. Augmentations — buy everything we can, then NeuroFlux with the change.
    const player = ns.getPlayer();
    const joined = player.factions;
    const bought = buyAugs(ns, sing, joined, spendable, dry);
    if (!flags["no-nfg"]) buyNeuroFlux(ns, sing, joined, spendable, dry);

    // 4. Work a faction that still gates an aug on rep (background, no focus stolen).
    if (!flags["no-work"]) maybeWork(ns, sing, joined, dry);

    // 5. Install — ONLY if armed AND we've stalled (nothing bought and nothing left we
    //    can reach by more rep). Otherwise keep banking.
    if (flags["install"] && !dry && bought === 0 && !anythingReachable(ns, sing, joined)) {
      const owned = sing.getOwnedAugmentations(true).length;
      ns.print(`>>> INSTALLING ${owned} augmentations and relaunching ${flags["cb"]} — resetting to level 1.`);
      sing.installAugmentations(flags["cb"]);
      return; // installAugmentations resets the game; we won't get here, but be explicit.
    }

    status(ns, sing, joined, reserve);
    await ns.sleep(TICK);
  }
}

/* ---- 1. darkweb tools ------------------------------------------------------ */

function buyTools(ns, sing, spendable, wantFormulas, dry) {
  if (!ns.hasTorRouter()) {
    // TOR itself is a fixed cost; buy it the moment we can, it gates everything else.
    if (spendable() > 0 && !dry && sing.purchaseTor()) ns.print("bought TOR router.");
    if (!ns.hasTorRouter()) return; // no TOR yet → no darkweb to buy from
  }
  let programs;
  try { programs = sing.getDarkwebPrograms(); } catch { return; }
  for (const name of programs) {
    const norm = name.toLowerCase().replace(/\.exe$/, "");
    const want = CRACKERS.includes(norm) || (wantFormulas && norm.includes("formulas"));
    if (!want) continue;
    if (ns.fileExists(name, "home")) continue;
    const cost = sing.getDarkwebProgramCost(name);
    if (cost <= 0 || cost > spendable()) continue;
    if (dry) { ns.print(`[dry] would buy ${name} ($${fmt(ns, cost)}).`); continue; }
    if (sing.purchaseProgram(name)) ns.print(`bought ${name} ($${fmt(ns, cost)}).`);
  }
}

/* ---- 2. factions ----------------------------------------------------------- */

function joinFactions(ns, sing, joinAll, dry) {
  for (const fac of sing.checkFactionInvitations()) {
    let enemies = [];
    try { enemies = sing.getFactionEnemies(fac) || []; } catch { /* older API: treat as none */ }
    if (enemies.length && !joinAll) {
      ns.print(`holding invite: ${fac} (enemies: ${enemies.join(", ")}) — use --join-all to take it.`);
      continue;
    }
    if (dry) { ns.print(`[dry] would join ${fac}.`); continue; }
    if (sing.joinFaction(fac)) ns.print(`joined ${fac}${enemies.length ? " (⚠ locked out rivals)" : ""}.`);
  }
}

/* ---- 3. augmentations ------------------------------------------------------ */

/** Buy every aug we have rep + cash + prereqs for, most-expensive-money-first so the
 *  escalating price multiplier lands on the cheap ones. Returns how many we bought. */
function buyAugs(ns, sing, joined, spendable, dry) {
  const owned = new Set(sing.getOwnedAugmentations(true));
  let count = 0;

  for (let guard = 0; guard < 60; guard++) {
    // Rebuild candidates each pass: a purchase changes prices and can satisfy a prereq.
    const cands = [];
    for (const fac of joined) {
      const rep = sing.getFactionRep(fac);
      for (const aug of sing.getAugmentationsFromFaction(fac)) {
        if (aug === NFG || owned.has(aug)) continue;
        if (sing.getAugmentationRepReq(aug) > rep) continue;         // not enough rep yet
        const prereq = sing.getAugmentationPrereq(aug);
        if (prereq.some((p) => !owned.has(p))) continue;             // prereq not installed/bought
        const price = sing.getAugmentationPrice(aug);
        if (price > spendable()) continue;
        cands.push({ fac, aug, price });
      }
    }
    if (!cands.length) break;
    cands.sort((a, b) => b.price - a.price); // most expensive first
    const pick = cands[0];
    if (dry) { ns.print(`[dry] would buy ${pick.aug} from ${pick.fac} ($${fmt(ns, pick.price)}).`); owned.add(pick.aug); count++; continue; }
    if (sing.purchaseAugmentation(pick.fac, pick.aug)) {
      ns.print(`bought ${pick.aug} from ${pick.fac} ($${fmt(ns, pick.price)}).`);
      owned.add(pick.aug);
      count++;
    } else {
      owned.add(pick.aug); // buy failed unexpectedly — skip it so we don't loop forever
    }
  }
  return count;
}

/** Pour leftover cash into NeuroFlux Governor — infinitely repeatable, its rep req and
 *  price both climb per purchase, so re-check every time. Buys from whichever joined
 *  faction offers it and we currently have the rep for. */
function buyNeuroFlux(ns, sing, joined, spendable, dry) {
  for (let guard = 0; guard < 40; guard++) {
    const repReq = sing.getAugmentationRepReq(NFG);
    const price = sing.getAugmentationPrice(NFG);
    if (price > spendable()) break;
    const fac = joined.find((f) =>
      sing.getFactionRep(f) >= repReq && sing.getAugmentationsFromFaction(f).includes(NFG));
    if (!fac) break; // no faction with enough rep for the next NFG level
    if (dry) { ns.print(`[dry] would buy ${NFG} from ${fac} ($${fmt(ns, price)}).`); break; }
    if (!sing.purchaseAugmentation(fac, NFG)) break;
    ns.print(`bought ${NFG} from ${fac} ($${fmt(ns, price)}).`);
  }
}

/* ---- 4. faction work ------------------------------------------------------- */

/** If we're not already working a faction, start background work for one that still
 *  gates an unowned aug on reputation — so the grind buys us the next unlock. */
function maybeWork(ns, sing, joined, dry) {
  const cur = sing.getCurrentWork();
  if (cur && cur.type === "FACTION") return; // already grinding a faction; leave it
  const owned = new Set(sing.getOwnedAugmentations(true));
  for (const fac of joined) {
    const rep = sing.getFactionRep(fac);
    const gated = sing.getAugmentationsFromFaction(fac).some(
      (a) => a !== NFG && !owned.has(a) && sing.getAugmentationRepReq(a) > rep);
    if (!gated) continue;
    if (dry) { ns.print(`[dry] would work ${fac} for rep.`); return; }
    for (const type of ["hacking", "field", "security"]) {
      if (sing.workForFaction(fac, type, false)) { ns.print(`working ${fac} (${type}) for rep.`); return; }
    }
  }
}

/** Is there any unowned aug we could still reach by grinding more rep in a joined
 *  faction? (Used to decide whether an armed install has truly stalled.) */
function anythingReachable(ns, sing, joined) {
  const owned = new Set(sing.getOwnedAugmentations(true));
  for (const fac of joined) {
    for (const aug of sing.getAugmentationsFromFaction(fac)) {
      if (aug !== NFG && !owned.has(aug)) return true;
    }
  }
  return false;
}

/* ---- status + formatting --------------------------------------------------- */

function status(ns, sing, joined, reserve) {
  const owned = sing.getOwnedAugmentations(true).length;
  const cash = ns.getServerMoneyAvailable("home");
  const invites = sing.checkFactionInvitations().length;
  ns.print(`— augs owned/queued: ${owned} | factions: ${joined.length} | invites pending: ${invites} | ` +
           `cash: $${fmt(ns, cash)} (reserve $${fmt(ns, reserve)})`);
}

/** Short currency formatting, robust to ns.formatNumber being absent (matches commander.js). */
function fmt(ns, n) {
  if (ns.format && typeof ns.format.number === "function") { try { return ns.format.number(n); } catch { /* fall through */ } }
  if (typeof ns.formatNumber === "function") { try { return ns.formatNumber(n); } catch { /* fall through */ } }
  const a = Math.abs(n), s = ["", "k", "m", "b", "t", "q"];
  let i = 0; let v = a;
  while (v >= 1000 && i < s.length - 1) { v /= 1000; i++; }
  return (n < 0 ? "-" : "") + v.toFixed(v < 10 && i > 0 ? 2 : 1) + s[i];
}
