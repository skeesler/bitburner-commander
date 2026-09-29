/** @param {NS} ns
 *
 *  CORP BRIBE — turn corporation funds into faction reputation. 32.1GB.
 *
 *      run corp-bribe.js                                  # what it's worth, and to whom. Spends nothing.
 *      run corp-bribe.js --faction Daedalus --amount 5t --go
 *      run corp-bribe.js --faction Daedalus --loop --go   # the flywheel: profit -> rep, forever
 *
 *  THIS IS THE ANSWER TO BN3's REAL WALL. BN3 charges 3x AugmentationRepCost and 3x
 *  AugmentationMoneyCost. The money side you can out-earn — a corporation making $600m/s solves
 *  it. The REPUTATION side you cannot: rep comes from working for a faction in real time, and no
 *  amount of corporate profit shortens that grind. bribe() is the exception. Once the
 *  corporation's valuation clears bribeThreshold ($100t), funds convert directly into reputation
 *  at bribeAmountPerReputation ($1b per point), with no cooldown and no cap.
 *
 *  IT IS ALSO THE ONLY TAP THAT DOESN'T NEED YOU TO GO PUBLIC. Dividends and sellShares both
 *  move money to your WALLET, and going public is a one-way lever you may not want yet. Bribery
 *  spends corporation funds where they already sit — which matters here, because those funds
 *  are otherwise a number that goes up and does nothing (bn3-runbook.md, Loop 3).
 *
 *  WHERE IT FEEDS. Reputation buys augmentations, and ascend.js already plans and installs those.
 *  So the loop closes: corp profit -> bribe -> faction rep -> `run ascend.js` -> install.
 *  Corporation progress survives an install, so nothing here is lost on the other side.
 *
 *  BOTH THRESHOLD AND RATE ARE READ, NOT ASSUMED — getConstants() is 0GB and exposes
 *  bribeThreshold and bribeAmountPerReputation, so this script stays correct if they change.
 *
 *  SPEND IT ON THE FACTION WHOSE AUGMENTATIONS YOU ACTUALLY WANT. Reputation is per-faction and
 *  does not transfer. This script lists the factions you have joined but deliberately will not
 *  pick one for you — that depends on which augmentations ascend.js is queuing, which is a
 *  judgement call about the run, not something to infer from a balance sheet.
 *
 *  SIGNATURE NOTE: bribe(factionName, amountCash) is taken from the v3.0.1 API surface, and this
 *  script has NOT been confirmed against a live call here (the rest of the rig's calls have).
 *  It checks the return value and passes any thrown error through verbatim, so a wrong shape
 *  reports itself on the first --go instead of failing quietly. AGENTS.md: only a call proves
 *  callability.
 *
 *  RAM: bribe (20) + getCorporation (10) + ns.getPlayer (0.5) + 1.6 base = 32.1GB.
 *       getConstants and nextUpdate are free.
 */

const RESERVE = 0;          // funds floor: never bribe below this
const FRAC = 0.5;           // --loop with no --amount spends this share of spendable funds a pass
const EVERY = 30;           // --loop: cycles between bribes (30 cycles = ~5 minutes)

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["faction", ""], ["amount", ""], ["frac", FRAC], ["reserve", RESERVE],
    ["go", false], ["loop", false], ["every", EVERY],
    ["quiet", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const say = opts.quiet ? (msg) => ns.print(msg) : (msg) => ns.tprint(msg);

  // Looping without somewhere to send the money would just reprint the report forever.
  if (opts.loop && (!opts.faction || !opts.go)) {
    ns.tprint("\ncorp-bribe: --loop needs both --faction NAME and --go.\n" +
      "  Run it without --loop first to see the rate and your factions.\n");
    return;
  }

  let threshold = 100e12, perRep = 1e9;
  try {
    const K = ns.corporation.getConstants();
    if (Number.isFinite(K.bribeThreshold)) threshold = K.bribeThreshold;
    if (Number.isFinite(K.bribeAmountPerReputation)) perRep = K.bribeAmountPerReputation;
  } catch (e) { ns.tprint(`\ncorp-bribe: no corporation (${short(e)}).\n`); return; }

  do {
    const stop = onePass(ns, say, threshold, perRep, opts);
    if (stop || !opts.loop) break;
    for (let i = 0; i < Math.max(1, opts.every); i++) await ns.corporation.nextUpdate();
  } while (opts.loop);
}

/** Returns true if the loop should stop (a condition no amount of waiting will fix). */
function onePass(ns, say, threshold, perRep, opts) {
  let info;
  try { info = ns.corporation.getCorporation(); }
  catch (e) { say(`corp-bribe: could not read the corporation (${short(e)}).`); return true; }

  const joined = factionList(ns);
  const spendable = Math.max(0, info.funds - opts.reserve);

  if (info.valuation < threshold) {
    say(`\n===== corp-bribe =====\n` +
      `  valuation $${fmt(ns, info.valuation)} is below the $${fmt(ns, threshold)} bribe threshold.\n` +
      `  Nothing to do yet — grow the corporation. corp-upgrade.js and corp-advert.js are the levers.\n=====`);
    return true;   // waiting in a loop is fine, but the user should see this and decide
  }

  // ---- report mode --------------------------------------------------------
  if (!opts.faction || !opts.go) {
    const want = opts.amount ? parseMoney(opts.amount, spendable) : spendable * clamp01(opts.frac);
    say(`\n===== corp-bribe (REPORT ONLY — needs --faction NAME and --go) =====\n` +
      `  valuation $${fmt(ns, info.valuation)} — past the $${fmt(ns, threshold)} threshold, bribery is available\n` +
      `  funds     $${fmt(ns, info.funds)} · reserve $${fmt(ns, opts.reserve)} · spendable $${fmt(ns, spendable)}\n` +
      `  rate      $${fmt(ns, perRep)} per reputation point\n` +
      `  a bribe of $${fmt(ns, want)} would buy ${fmt(ns, want / perRep)} reputation\n` +
      `  income    $${fmt(ns, info.revenue - info.expenses)}/s = ${fmt(ns, (info.revenue - info.expenses) * 3600 / perRep)} rep/hour if you spend all of it\n` +
      `  joined factions: ${joined.length ? joined.join(", ") : "(none — join one first)"}\n` +
      `\n  Pick the faction whose augmentations you actually want; rep does not transfer.\n` +
      `  Then: run corp-bribe.js --faction "NAME" --amount 5t --go\n=====`);
    return false;
  }

  // ---- spending mode ------------------------------------------------------
  if (joined.length && !joined.some((f) => eq(f, opts.faction))) {
    // Not fatal — the game may still accept it — but overwhelmingly this is a typo, and a
    // mistyped faction is money into a faction you are not a member of.
    say(`\ncorp-bribe: you have not joined "${opts.faction}".\n` +
      `  joined: ${joined.join(", ")}\n  Refusing to bribe. Fix the name, or join first.\n`);
    return true;
  }

  const amount = opts.amount ? parseMoney(opts.amount, spendable) : spendable * clamp01(opts.frac);
  if (!Number.isFinite(amount) || amount <= 0) {
    say(`corp-bribe: nothing to spend (funds $${fmt(ns, info.funds)}, reserve $${fmt(ns, opts.reserve)}).`);
    return !opts.loop;
  }
  if (amount > spendable) {
    say(`corp-bribe: $${fmt(ns, amount)} exceeds spendable $${fmt(ns, spendable)}. Nothing sent.`);
    return true;
  }

  let ok = false, err = "";
  try { ok = ns.corporation.bribe(opts.faction, amount) !== false; }
  catch (e) { err = short(e); }

  if (err) {
    say(`\ncorp-bribe: the game refused the call — ${err}\n` +
      `  If that reads like a signature problem, bribe(faction, amount) is the documented v3.0.1\n` +
      `  shape but was never confirmed live here. Check the in-game ns. autocomplete.\n`);
    return true;
  }
  if (!ok) {
    say(`corp-bribe: bribe returned false — $${fmt(ns, amount)} to "${opts.faction}" was not accepted.`);
    return true;
  }

  say(`corp-bribe: $${fmt(ns, amount)} -> "${opts.faction}" = ${fmt(ns, amount / perRep)} reputation.` +
      (opts.loop ? `  (next pass in ${opts.every} cycles)` : `  Next: run ascend.js`));
  return false;
}

/** Joined factions, for typo-checking. ns.getPlayer is 0.5GB and needs no Singularity. */
function factionList(ns) {
  try { return (ns.getPlayer() || {}).factions || []; }
  catch (e) { return []; }
}

/** "5t" / "500b" / "2.5e12" / "all" -> a number. `all` and "" fall back to `whole`. */
function parseMoney(text, whole) {
  const s = String(text).trim().toLowerCase();
  if (!s || s === "all" || s === "max") return whole;
  const m = s.match(/^([0-9.]+)\s*([kmbtq]?)$/);
  if (!m) { const n = Number(s); return Number.isFinite(n) ? n : NaN; }
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 }[m[2]];
  return Number(m[1]) * mult;
}

function eq(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function clamp01(n) { const v = Number(n); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 140); }

// ns.formatNumber was removed in 3.0.0; ns.format.number is the current name (0GB).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "?";
  try { return ns.format.number(n, 3); } catch (e) { return String(Math.round(n)); }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-bribe.js — corporation funds -> faction reputation (32.1GB).\n" +
    "  run corp-bribe.js                                     report: rate, spendable, your factions\n" +
    "  run corp-bribe.js --faction \"Daedalus\" --amount 5t --go\n" +
    "  run corp-bribe.js --faction \"Daedalus\" --amount all --go\n" +
    "  run corp-bribe.js --faction \"Daedalus\" --loop --go     half of spendable funds, every 30 cycles\n" +
    "  run corp-bribe.js --reserve 5t --faction ... --go      keep $5t back for upgrades\n" +
    "  Needs valuation past $100t. Rep is per-faction and does not transfer, so pick the one\n" +
    "  whose augmentations ascend.js is queuing. This is BN3's 3x rep penalty, bought off.\n"
  );
}
