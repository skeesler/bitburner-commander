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

## What's here

- `commander.js` — top-level runner for the **light net** (the normal, static server
  network): roots, buys/upgrades cloud servers, picks targets, hacks. Everything else
  in the repo is a piece it uses (batchers, contract-finder, purchase-servers, etc.).
- `stock-trader.js`, `liquidate.js` — 4S stock bot + cash-out helper.
- `README.md` — the human-facing guide; start there for how the light-net rig fits together.

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

## Conventions

- Scripts target `home` as the primary host and are meant to be copied there wholesale.
- Prefer one self-managing entry point (like `commander.js`) over many manual scripts.
- Keep the human-readable status/earnings output — Sara likes watching runs.
