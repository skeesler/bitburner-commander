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
- `corp-*.js` — the corporation rig, and the point of BitNode 3. Many small scripts rather than
  one manager, entirely because of the RAM wall (see `corp-design.md`). **Read `bn3-runbook.md`
  (the *how*) and `corp-design.md` (the *why*) before touching any of it.**
- `README.md` — the human-facing guide; start there for how the pieces fit together.

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

## Conventions

- Scripts target `home` as the primary host and are meant to be copied there wholesale.
- Prefer one self-managing entry point (like `commander.js`) over many manual scripts.
- Keep the human-readable status/earnings output — Sara likes watching runs.
- **Before committing, check what you changed.** `node --check <file>` on every edited script (parse
  errors otherwise only surface in-game), and keep `node dnet-constraints.test.mjs` green — it's the
  solver's spec; add a test when you add a puzzle-model parser. Both run under plain Node.
- **RAM is charged for every `ns.*` a script's imports *mention*, even uncalled.** The darknet crawler
  sits on a knife-edge against 16GB nodes, so check `ns.getScriptRam` (or `mem` in-game) before adding an
  `ns` call to it or a module it imports — a stray `ns.rm`/`ns.heartbleed` can strand its reach.
  - **Worse: the RAM walker resolves identifiers by BARE NAME against the whole cost tree, namespace
    ignored** (`RamCalculations.ts:225-249`). A local helper or property named `probe` bills you
    `ns.dnet.probe`; one named `research` bills **20GB** for `ns.corporation.research` — in a file that
    never touches either namespace. Name locals defensively.
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
