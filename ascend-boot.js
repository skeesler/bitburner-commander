/** @param {NS} ns
 *
 *  ASCEND-BOOT — the lean tool-buyer, sized to run ALONGSIDE commander.
 *
 *      run ascend-boot.js [--formulas] [--reserve N] [--dry]
 *
 *  The one thing worth automating right after a reset that commander doesn't already
 *  do: buy the TOR router, then every port cracker as each becomes affordable (add
 *  --formulas to also grab Formulas.exe). It reads the game's OWN darkweb program list,
 *  so it buys with whatever exact name strings your version reports.
 *
 *  Deliberately tiny (~7GB) so it coexists with `commander.js` on a small home. The
 *  RAM-hungry parts of ascension — accepting faction invites, buying augs, NeuroFlux,
 *  faction work, install — are left out on purpose:
 *    - Faction invites are rare right after a reset and a single click to accept; the
 *      `checkFactionInvitations` + `getFactionEnemies` + `joinFaction` trio costs 9GB,
 *      more than the whole tool-buyer, so it's not worth holding resident. Accept them
 *      by hand, or let the full `ascend.js` sweep them once your home is grown.
 *    - Everything else lives in `ascend.js`, for once home RAM is big enough.
 *
 *  --reserve N  keep $N in the bank (default 0).   --dry  preview, spend nothing.
 */

const CRACKERS = ["brutessh", "ftpcrack", "relaysmtp", "httpworm", "sqlinject"];
const TICK = 12000; // ms between passes; nothing here is urgent

export async function main(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags([
    ["formulas", false],   // also buy Formulas.exe from the darkweb
    ["reserve", 0],        // cash to keep in the bank
    ["dry", false],        // preview only — never spend
  ]);
  const reserve = Number(flags["reserve"]) || 0;
  const dry = flags["dry"];
  const sing = ns.singularity;

  ns.ui.openTail();
  ns.print(`ASCEND-BOOT online — TOR + crackers only (fits beside commander).` +
           `${dry ? " DRY-RUN." : ""} reserve=$${fmt(ns, reserve)}. ` +
           `Faction invites: accept by hand, or hand off to ascend.js once home is grown.`);

  while (true) {
    const spendable = () => Math.max(0, ns.getServerMoneyAvailable("home") - reserve);
    const done = buyTools(ns, sing, spendable, flags["formulas"], dry);
    status(ns, reserve);
    // Once TOR + every cracker (+ Formulas if asked) is owned, there's nothing left to
    // watch for — free the RAM for commander instead of idling resident forever.
    if (done && !dry) { ns.print("all tools owned — exiting to free RAM for commander."); return; }
    await ns.sleep(TICK);
  }
}

/** Buy TOR then any missing wanted darkweb program we can afford. Returns true once
 *  nothing is left to buy (TOR + all crackers, plus Formulas when --formulas). */
function buyTools(ns, sing, spendable, wantFormulas, dry) {
  if (!ns.hasTorRouter()) {
    if (spendable() > 0 && !dry && sing.purchaseTor()) ns.print("bought TOR router.");
    if (!ns.hasTorRouter()) return false; // no TOR yet → no darkweb to buy from
  }
  let programs;
  try { programs = sing.getDarkwebPrograms(); } catch { return false; }
  let allOwned = true;
  for (const name of programs) {
    const norm = name.toLowerCase().replace(/\.exe$/, "");
    const want = CRACKERS.includes(norm) || (wantFormulas && norm.includes("formulas"));
    if (!want) continue;
    if (ns.fileExists(name, "home")) continue;
    allOwned = false; // something wanted is still missing
    const cost = sing.getDarkwebProgramCost(name);
    if (cost <= 0 || cost > spendable()) continue;
    if (dry) { ns.print(`[dry] would buy ${name} ($${fmt(ns, cost)}).`); continue; }
    if (sing.purchaseProgram(name)) ns.print(`bought ${name} ($${fmt(ns, cost)}).`);
  }
  return allOwned;
}

function status(ns, reserve) {
  const have = CRACKERS.filter((c) => ns.fileExists(canonical(c), "home")).length;
  const tor = ns.hasTorRouter() ? "yes" : "no";
  const cash = ns.getServerMoneyAvailable("home");
  ns.print(`— TOR: ${tor} | crackers: ${have}/${CRACKERS.length} | ` +
           `cash: $${fmt(ns, cash)} (reserve $${fmt(ns, reserve)})`);
}

/** Best-guess filename for a normalized cracker key (status display only; the actual
 *  buy uses the game's own program strings). Capitalization varies by version. */
function canonical(norm) {
  const map = { brutessh: "BruteSSH.exe", ftpcrack: "FTPCrack.exe", relaysmtp: "relaySMTP.exe", httpworm: "HTTPWorm.exe", sqlinject: "SQLInject.exe" };
  return map[norm] || norm + ".exe";
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
