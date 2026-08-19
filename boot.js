/** @param {NS} ns
 *
 *  BOOT — relaunches the whole earning stack after an augmentation install.
 *  Point ascend.js at it so the flywheel comes back to life on its own:
 *
 *      run ascend.js --install --cb boot.js
 *
 *  installAugmentations() relaunches its callback with NO args, so everything that
 *  must survive a reset is baked into the constants below — not passed as flags.
 *  (Flags on a manual `run boot.js` still work for that one invocation.)
 *
 *  Each entry only launches if its prerequisite is met (in a gang, has sleeves,
 *  has 4S, script exists) and it isn't already running — so it's safe to re-run
 *  by hand to top up a partially-started stack.
 *
 *      run boot.js              # start/refresh the earning stack
 *      run boot.js --flywheel   # also relaunch ascend (this run only)
 *      run boot.js --dry        # show what would launch, start nothing
 */

// ---- What to launch (args baked in — they must survive an argless relaunch) ----
const STACK = [
  { script: "commander.js",       args: [],      when: () => true },
  { script: "gang-manager.js",    args: [],      when: inGang },
  { script: "stock-trader.js",    args: [],      when: has4S },
  { script: "sleeve-manager.js",  args: [],      when: hasSleeves },
  // The --auto-* flags are baked in HERE, not typed at the terminal, for the reason at the top
  // of this file: installAugmentations() relaunches boot with no args, so a conductor started by
  // hand with spending on comes back after an install with spending off. That failure is silent —
  // the corporation looks perfectly healthy and just quietly stops buying anything.
  // Bribery is deliberately NOT here: it needs a faction name, reputation doesn't transfer between
  // factions, and the right target moves as ascend.js changes what it's queuing. Run corp-bribe.js
  // by hand when you want it.
  { script: "corp-conductor.js",  args: ["--auto-upgrade", "--auto-advert", "--auto-research"],
                                                 when: hasCorp },
];

// ---- Hands-free flywheel --------------------------------------------------
// If true, boot also relaunches ascend.js after every install, so the game keeps
// installing augs → resetting → rebooting on its own. Leave false for a human
// checkpoint each cycle (run ascend.js yourself when you're ready to install).
// ASCEND_ARGS MUST keep --cb boot.js or the loop breaks after one install.
const RELAUNCH_ASCEND = false;
const ASCEND_ARGS     = ["--install", "--cb", "boot.js"];
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([["flywheel", false], ["dry", false], ["help", false]]);
  if (opts.help) { printHelp(ns); return; }

  const running = new Set(ns.ps("home").map(p => p.filename));

  for (const { script, args, when } of STACK) {
    if (!ns.fileExists(script, "home")) { ns.tprint(`skip ${script} — not on home.`); continue; }
    if (running.has(script))            { ns.tprint(`skip ${script} — already running.`); continue; }
    if (!safe(when, ns))                { ns.tprint(`skip ${script} — prerequisite not met yet.`); continue; }
    launch(ns, script, args, opts.dry);
  }

  // ascend last — only if configured for a hands-free flywheel, or asked this run.
  if (RELAUNCH_ASCEND || opts.flywheel) {
    if (!ns.fileExists("ascend.js", "home")) ns.tprint("skip ascend.js — not on home.");
    else if (running.has("ascend.js"))       ns.tprint("skip ascend.js — already running.");
    else launch(ns, "ascend.js", ASCEND_ARGS, opts.dry);
  }

  ns.tprint(opts.dry ? "boot: dry run — nothing launched." : "boot: stack up.");
}

/** exec a script on home, reporting success or (almost always) a RAM shortfall. */
function launch(ns, script, args, dry) {
  const cost = ns.getScriptRam(script, "home");
  if (dry) { ns.tprint(`[dry] would run ${script} ${args.join(" ")} (${cost}GB).`); return; }
  const pid = ns.exec(script, "home", 1, ...args);
  if (pid) ns.tprint(`started ${script} ${args.join(" ")} (pid ${pid}).`);
  else     ns.tprint(`FAILED ${script} — likely not enough free home RAM (needs ${cost}GB).`);
}

/** Run a prerequisite predicate, treating a thrown API-access error as "no". */
function safe(pred, ns) {
  try { return pred(ns); } catch (e) { return false; }
}

function inGang(ns)     { return ns.gang.inGang(); }                 // works without gang access (returns false)
function hasSleeves(ns) { return ns.sleeve.getNumSleeves() > 0; }    // throws without SF10 → treated as false
function has4S(ns)      { return ns.stock.has4SDataTIXAPI(); }       // throws without TIX API → treated as false
function hasCorp(ns)    { return ns.corporation.hasCorporation(); }  // 0GB, so boot.js costs no more than before

function printHelp(ns) {
  ns.tprint(
    "\nboot.js — relaunch the earning stack after an install.\n" +
    "  run boot.js              start/refresh commander + gang + stock + sleeves + corp\n" +
    "  The corp conductor comes up with --auto-upgrade --auto-advert --auto-research, so the\n" +
    "  corporation keeps spending its funds after an install. Bribery stays manual.\n" +
    "  run boot.js --flywheel   also relaunch ascend.js (this run only)\n" +
    "  run boot.js --dry        preview, launch nothing\n" +
    "  Set as ascend's callback:  run ascend.js --install --cb boot.js\n" +
    "  For a fully hands-free flywheel, set RELAUNCH_ASCEND = true at the top of boot.js.\n"
  );
}
