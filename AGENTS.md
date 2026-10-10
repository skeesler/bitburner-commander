# AGENTS.md — notes for an AI assistant working in this repo

This folder is a set of [Bitburner](https://bitburner-official.github.io/) automation
scripts, co-written by Sara and an assistant across sessions. Read this before writing code.

## Game version: **Bitburner 3.0.1** (Steam/web, May 2026)

- **v3 was a breaking API reorg.** Scripts and examples from before v3 — and anything
  an LLM half-remembers from old training data — use function names that **no longer exist**.
  When you generate Netscript, assume v3 namespaces, not the old flat `ns.*` names.
- The most common breakages are mapped in `README.md` → "Read this first: version
  compatibility" (e.g. `ns.purchaseServer` → `ns.cloud.purchaseServer`,
  `ns.tail` → `ns.ui.openTail`). **Check that table before using any server/UI call.**
- When unsure of a signature, verify against the official docs
  (`github.com/bitburner-official/bitburner-src`, `markdown/` and
  `src/Documentation/doc/en/`) rather than guessing. `formulas-api-reference.md` here
  captures the formulas namespace we've already pulled.
- **The running game is the ONLY source of truth for the API — not even the official dev repo.**
  The `bitburner-src` markdown runs *ahead* of the 3.0.1 release: we built a whole "freeze-to-crack"
  plan on `ns.dnet.freezeServer` from the dev docs, and it doesn't exist in 3.0.1 (`is not a function`).
  Before designing around any `ns.dnet.*` method, confirm it's real — `run dnet-api.js` dumps the actual
  22-method surface. Trust the in-game `ns.` autocomplete (and a live probe) over any doc or chatbot.

## What's here

- `commander.js` — top-level runner for the **light net** (the normal, static server
  network): roots, buys/upgrades cloud servers, picks targets, hacks. Everything else
  in the repo is a piece it uses (batchers, contract-finder, purchase-servers, etc.).
- `stock-trader.js`, `liquidate.js` — 4S stock bot + cash-out helper.
- `boot.js` — brings the **whole** earning stack back up in one command (commander, gang,
  stock, sleeves, corporation), each behind a prerequisite guard. It is what `ascend.js`
  relaunches after an install, so args that must survive a reset are baked into its `STACK`
  rather than typed at the terminal.
- `ascend.js` / `ascend-boot.js` — the augmentation flywheel: plan the purchase, hold the
  install behind `--install`, restore `.exe` programs on the other side.
- `gang-manager.js`, `sleeve-manager.js`, `grafting-queue.js` — the other passive income and
  stat streams. Both a gang and a corporation **survive an augmentation install**.
- `corp.js` / `corp-do.js` / `corp-report.js` / `corp-lib.js` — the corporation rig, rewritten
  2026-09-27 from 29 RAM-split scripts into four split by job: resident manager, deliberate
  commands (one-way levers behind `--yes`), read-only report, shared pure logic (specced by
  `node corp-lib.test.mjs`). The whole corp API in one file is 961.6 GB, under the 1024 GB
  per-script cap [SRC], so it needs a big home. The old low-RAM rig is in `archive/` with its
  `bn3-runbook.md`. **Read `corp-runbook.md` (the *how*) and `corp-design.md` → "The 2026-09
  rewrite" (the *why*) before touching any of it.** Outside BN3 the money tap is `sellshares`,
  not dividends (tribute exponent 0.75 in BN10).
- `stanek*.js` + `bn13-design.md` — Stanek's Gift for **BitNode 13** (entered 2026-10-03, Bladeburner
  route). `stanek-lib.js` is pure geometry/scoring/layout search, specced by `node stanek-lib.test.mjs`
  on the LIVE fragment table, with the branch-and-bound cross-checked against exhaustive search.
  **Accept the gift before buying ANY augmentation** (one-way door, bn13-design.md §2).
- `bn15-design.md` — **BitNode 15** (entered 2026-10-09): the Red Pill is at the bottom of the fifth
  darknet labyrinth, one lab per install. The *why* for everything BN15 added to the `dnet-*` rig:
  `dnet-strategies.js` (pure solvers for RateMyPix.Auth, KingOfTheHill and the maze, specced in
  `dnet-constraints.test.mjs` against the game's own formulas), `dnet-lab.js` / `dnet-lab-open.js` /
  `dnet-lab-arm.js` (opt-in maze walker), `dnet-pin.js` (stasis anchor beside a lab), `dnet-bleed.js`
  (charisma grinder), `dnet-map.js` (quiet map by row) and `dnet-reset.js` (run after every install).
- `hacknet-*.js` — the hacknet and its hash economy rig, and the point of **BitNode 9** (Sara ran
  BN9 2026-09-02 → 2026-09-07, banking SF9.1; she'll return for 9.2 once the corp rig is proven
  outside BN3). Still at the probe stage. `hacknet-design.md` tags every claim [SRC] (read from the v3.0.1 tag), [LIVE] (confirmed
  in-game) or [OPEN], and it is the *why*.
- `int-api.js` / `int-delta.js` / `int-sleeve-delta.js` / `int-farm.js` — the **BN5 /
  intelligence** rig (current node): read-only surface+table probe, the player-action delta lab,
  the sleeve-mirror test (shelved — no SF10), and the farm the probes earned: an infinite
  `b1t_flum3.exe` create/delete loop at ~360 int XP/hr, confirmed live. Split into small scripts
  for the same RAM reason as the corp rig. `bn5-design.md` is the *why* — its probe record is a
  clean sweep so far: every [SRC] claim tested has matched live to float precision.
- `README.md` — the human-facing guide; start there for how the pieces fit together.

> **Update (2026-09-29): BN10 goal met — all five Covenant sleeves bought**, Memory 100 on each.
> Sleeves 1–4 came from gang income. The $100q fifth came from the corporation: the four-file rig
> grew a self-funded corp to a ~$200q private valuation in about two days of play. Then it went
> public with 0 new shares and sold most of Sara's stake the same minute (`corp-do.js ipo`, and
> `corp-design.md` → "Timing the exit"). Sara is leaving BN10 next; the next node is her call.
>
> **Current position (2026-09-21): BN6.1 complete** — Operation Daedalus succeeded; bb-conductor v2
> ran the whole Bladeburner ladder (see `bn6-design.md`, the *why* for that node, and `bb-conductor.js`).
> Holding SF1.3 / 2.3 / 3.3 / 4.3 / 5.3 / **6.1** / 9.1, plus **SF-1 level 3** (three exploits: every
> positive player multiplier ×1.001³ ≈ ×1.003, cost multipliers ×0.999³ [SRC: `applyExploits.ts`] —
> include this in any calibration math). Earlier stated plan: back to BN9 for 9.2; next node is
> Sara's call. `bn5-design.md` remains the intelligence/int-farm reference, every claim tagged.
> The darknet pays **70%** here (`DarknetMoneyMultiplier` 0.7 [SRC] — its best value anywhere), so
> the `dnet-*` rig is back on duty, with one twist: darknet auth time is *multiplied* by
> `calculateIntelligenceBonus(int, 0.25)`, so intelligence makes cracking slower, not faster.

## Current frontier: the **DarkNet** (`ns.dnet`)

New in v3. A procedurally-generated, **constantly-mutating** network that lives
alongside the static net (servers restart, move, change links, or vanish). Access needs
`DarkscapeNavigator.exe` (Tor + `buy`, or Chongqing). It is a fundamentally different
problem from the light net: you **cannot orchestrate it from `home`** — discovery is
local-only (`dnet.probe()` sees direct neighbors only), so agents must replicate outward
and coordinate through durable shared state. Auth is a puzzle: **`heartbleed(host)` returns the
per-guess hint in its `.logs[]`** — NOT on the `authenticate` reply (confirmed live 2026-07-05) —
which you decode → `authenticate`. The rig is built and partly field-confirmed; **`darknet-design.md`
(the *why*) and `dnet-runbook.md` (the *how*) are the source of truth** — read them before touching
darknet code. API surface re-derived from the official 3.0 docs, now being confirmed node-by-node.

## Field findings

- **Batching's prep RAM starves a thin pool → earns $0.** At a BitNode start (esp. BN4, whose
  hacking penalty stretches prep times) the fleet-batcher weakens/grows a target to prepped state
  *before* it steals a cent; on a small pool (home + tiny world boxes, no cloud servers yet) prep
  eats all the RAM and the steal never runs — `sinceInstall.hacking` sits at $0. Reactive mode
  (`early-hacking-template.js`) earns immediately on any pool. Commander now AUTO-switches: starts
  reactive, promotes to batching once the usable pool clears `BATCH_MIN_POOL`, demotes back (raising
  the bar) if hack income stalls. `--reactive` still force-pins the old behavior.

- **Every `ns.hacknet.*` function costs 0.50 GB** — all 21, so the namespace is 10.5 GB if you touch
  it all [LIVE 2026-09-02]. Budget half a gig per distinct hacknet function a script names. More
  generally: **`ns.getFunctionRamCost(name)` exists and is free** — use it instead of estimating, and
  `ram-costs.js` prints it for a curated set plus `getScriptRam` for our own scripts side by side.
  Reference points from that run: `corporation.research` 20 GB, `corporation.getCorporation` and
  `codingcontract.attempt` 10 GB, `getBitNodeMultipliers` 4, `getServer` 2, `cloud.getServerNames`
  **1.05** but `cloud.getServerLimit` only 0.05, and all of `ns.formulas.*` **0**.
  - **The bare-name trap bit us again, in a file documenting the bare-name trap.** `hacknet-spend.js`
    weighed 16.70 GB against ~6.7 GB of honest usage; the difference was a local helper called
    **`attempt`**, billed as `ns.codingcontract.attempt` (10 GB) in a script with no contract code.
    Reading the file will never show you this. **Measure every new script with `ram-costs.js`.**
- **Stock POSITIONS die on an install; stock PURCHASES don't.** `prestigeAugmentation()` ends with
  `if (canAccessStockMarket()) initStockMarket();`, and `initStockMarket()` deletes every `Stock` and
  reconstructs it from metadata — `playerShares` included. But `hasWseAccount`/`hasTixApiAccess`/
  `has4SData`/`has4SDataTixApi` are reset only in `prestigeSourceFile()`, so the 4S ladder is bought
  **once per BitNode**, not once per install. `liquidate.js` before an install is therefore mandatory,
  not tidy-up. In BN9 that ladder costs **$110.2b** (`FourSigmaMarketDataCost` 5 and
  `FourSigmaMarketDataApiCost` 4 apply; the WSE and TIX API base costs are NOT multiplied).
- **The hacknet does NOT survive an augmentation install, and in BN9 that is expensive.**
  `Player.prestigeAugmentation()` does `this.hacknetNodes.length = 0` [SRC], so installing wipes every
  hacknet node/server exactly like purchased servers. Worse, BN9's free level-100/10-core starter
  server is granted in `prestigeSourceFile(isFlume)` — **BitNode entry only**, so an install does not
  give it back, though `b1t_flum3` does (note the parameter). Rebuilding that server from a purchased
  one costs roughly **$54b** (~$53.8b for levels 1→100 at `1.1^level`, plus ~$72m for cores 1→10).
  So the README's "two things survive an install: your gang and your corporation" is still true, but
  in BN9 **`ascend.js`'s assumption that installing is nearly free does not hold** — batch augs there.
- **Hacknet servers are real hosts on the network, and most `ns.getServer*` calls REFUSE them.**
  `ns.scan()` returns `hacknet-server-N`, they have RAM and can run scripts — but
  `ns.getServerMaxMoney` throws *"Cannot be executed on hacknet-server-0. The server must not be a
  hacknet server."* This crashed `commander.js` on its first run in BN9 (`rankTargets`). `scanAll`
  now drops them via `hacknetHosts(ns)`, which reads hostnames from `ns.hacknet.getNodeStats` rather
  than matching a name prefix. Keep them excluded from **hosts** too, not just targets: hash gain
  carries a `1 - ramUsed/maxRam` term, so borrowing their RAM is paid for in hashes.
- **Hash overflow is auto-sold, not lost.** When the hash bank is full, `processAllHacknetServerEarnings`
  converts the excess at the Sell-for-Money rate ($1e6 per 4 hashes) and credits the `"hacknet"` money
  source [SRC: `HacknetHelpers.tsx`]. A full bank is not an emergency; it is the floor rate on
  autopilot. Cache is worth buying only to save toward a sink that beats $250k/hash. *(This was
  initially mis-called as a leak — from reading `storeHashes`'s `wastedHashes` return without reading
  its caller. Read the call site, not just the function.)*
- **`typeof x === "function"` does NOT prove an API is usable.** Bitburner keeps *tombstones* for removed
  functions (`setRemovedFunctions`): they survive on the namespace and pass a typeof probe, but throw
  "removed in version X, use Y instead" when called. `ns.corporation` has 74 properties and only 63 real
  ones — the other 11 are 2.2.0/3.0.0 removals, including `setAutoJobAssignment` (removed in **3.0.0**,
  and exactly what an LLM trained on 2.x corp scripts reaches for). A live typeof probe proves *presence*;
  only a call proves *callability*. This inverts the gang lesson, where an undocumented method
  (`getOtherGangInformation`) was a real bonus — check which kind you've found before designing around it.
  - **This already bit us, and is now fixed.** `ns.formatNumber` was removed in **3.0.0**
    (→ `ns.format.number()`), as were `formatRam`, `formatPercent`, `tFormat`, `nFormat`, and
    `getTimeSinceLastAug`. `commander.js`, `ascend.js` and `ascend-boot.js` each guarded with
    `typeof ns.formatNumber === "function"` and then called it inside a `try` — the typeof passed
    (tombstone), the call threw, and all three silently took the hand-rolled fallback on *every*
    number they ever printed. They worked by accident for months. All three now call
    `ns.format.number()` (0GB) first. **Use it in new code; never reach for `ns.formatNumber`.**
- **Pin research to the `v3.0.1` release tag, not `dev`.** `github.com/bitburner-official/bitburner-src`
  has tags; `raw.githubusercontent.com/.../v3.0.1/...` gets the released source and the released
  `markdown/`. That's how to check a doc claim without guessing whether it runs ahead of the game —
  though the running game still outranks both.
  - **Don't guess the file extension.** The tree mixes `.ts` and `.tsx` with no pattern you can
    predict — `src/Hacknet/HashUpgrades.ts` is TypeScript but `src/Hacknet/data/HashUpgradesMetadata.tsx`
    is TSX, and guessing wrong just returns a bare 404. List the directory first:
    `https://api.github.com/repos/bitburner-official/bitburner-src/contents/<path>?ref=v3.0.1`.
  - **Beware the LEADING question.** A fetcher asked "state the value of X for node 3 and node 9"
    obligingly produced a number for both — but the key is **absent** from BN9's object entirely. That
    fabricated `HacknetNodeMoney: 0.1` survived into a design doc and a README before live data killed
    it. This is a distinct failure mode from a stale doc or a tombstone: **the question presupposed
    the answer.** Ask "is key K present in case N, and quote it" — never "what is K for N".
  - **BN9 facts pulled this way** (`src/BitNode/BitNode.tsx` case 9): `CloudServerLimit` **0** (no
    purchased servers at all — confirmed live), `ServerMaxMoney` 0.01, `ScriptHackMoney` 0.1,
    `HackExpGain` 0.05, `HackingLevelMultiplier` 0.5, `HomeComputerRamCost` 5,
    `DarknetMoneyMultiplier` 0.05, `CorporationSoftcap` 0.75. **`HacknetNodeMoney` and
    `CodingContractMoney` are ABSENT**, i.e. 1.0 — no hacknet penalty, and contracts pay full price.
    The full table, the 11-entry hash shop and the confirmed gain formula are in `hacknet-design.md`.

## Conventions

- Scripts target `home` as the primary host and are meant to be copied there wholesale.
- Prefer one self-managing entry point (like `commander.js`) over many manual scripts.
- Keep the human-readable status/earnings output — Sara likes watching runs.
- **Before committing, check what you changed.** `node --check <file>` on every edited script (parse
  errors otherwise only surface in-game), and keep all four specs green — `node dnet-constraints.test.mjs`
  (the darknet solver's spec; add a test when you add a puzzle-model parser) and
  `node contract-finder.test.mjs` (the coding-contract solvers), plus `node corp-lib.test.mjs`
  (the corporation maths) and `node stanek-lib.test.mjs` (the Stanek placer). **Never add a contract solver
  without a test**: a wrong answer burns one of a contract's limited tries, and the dispatch KEY
  is as likely to be wrong as the algorithm — test through the `solvers` map, not just the
  function. All run under plain Node.
- **RAM is charged for every `ns.*` a script's imports *mention*, even uncalled.** The darknet crawler
  sits on a knife-edge against 16GB nodes, so check `ns.getScriptRam` (or `mem` in-game) before adding an
  `ns` call to it or a module it imports — a stray `ns.rm`/`ns.heartbleed` can strand its reach.
  - **Worse: the RAM walker resolves identifiers by BARE NAME against the whole cost tree, namespace
    ignored** (`RamCalculations.ts:225-249`). A local helper or property named `probe` bills you
    `ns.dnet.probe`; one named `research` bills **20GB** for `ns.corporation.research` — in a file that
    never touches either namespace. Name locals defensively.
  - **It bit the darknet crawler too, for three months** (found 2026-10-09). `dnet-solve.js` named its
    guess helper `attempt` → billed 10 GB as `ns.codingcontract.attempt`, making the crawler 15.3 GB
    instead of ~5.3. That is the whole "crawler won't fit a 16 GB node" saga in `darknet-design.md`.
    Renamed `guessOnce`. Audit a module by stripping comments/strings and matching identifiers against
    the leaf keys of `src/Netscript/RamCostGenerator.ts` (v3.0.1).
  - **...but strings, comments and unused imports are free** [LIVE 2026-09-27]. The walker bills
    real code identifiers only: `corp-report.js` prints the words `research`, `sellShares` and
    `issueNewShares` in its output text and was NOT billed for them, and it pays nothing for the
    `corp-lib.js` helpers it doesn't import (`mem` 192 GB, matching a count of identifiers in
    reached code exactly). An estimate that greps the whole file overcounts; strip comments and
    string literals first, or just run `mem`.
  - **There is no bracket-access loophole.** `const c = ns.corporation; c[name](...)` hides the call from
    the *static* walker, but the runtime enforces a SECOND budget: `updateDynamicRam`
    (`NetscriptHelpers.tsx:434-458`) adds each function's cost the first time it's actually called and
    kills the script with *"Dynamic RAM usage calculated to be greater than RAM allocation"* the moment
    the running total exceeds what was statically allocated. So dynamic dispatch works **only for 0-cost
    functions** (`hasCorporation`, `getConstants`, `nextUpdate`, `ns.enums`, …). A script must honestly
    pay for every charged function it calls, however it calls it. Budget by splitting work across small
    scripts, never by hiding the call.
- **Model-hunting loop (darknet).** A `FAILED … (Model)` trace is the spec: read the `heartbleed data`,
  name the grammar, add a parser in `dnet-constraints.js` (static hints) or a strategy in `dnet-solve.js`
  (adaptive/feedback), test, commit. Run crawls with `--suppress-info` to surface only new models.
- **Commits/push.** Sara commits at her own discretion; end messages with the `Co-Authored-By: Claude …`
  trailer. Push only when asked.
