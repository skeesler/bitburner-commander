# bitburner-commander

A batteries-included hacking rig for [Bitburner](https://bitburner-official.github.io/). Copy the
files onto your `home` server, run **one** command, and it roots servers, buys
servers, picks targets, and hacks them for you — automatically, forever.

New to Bitburner? Start at [What is this?](#what-is-this). Scripts erroring for
your friend? Jump straight to [Read this first: version compatibility](#-read-this-first-version-compatibility)
— it's the most common reason copy-pasted scripts don't run.

---

## What is this?

Bitburner is an incremental/idle game where you write JavaScript to hack servers
for money. Early on you do it by hand; soon you want scripts doing it while you
sleep. This repo is a complete, self-managing automation for that grind:

- It **roots** (gains admin on) every server it can, using whatever hacking tools you own.
- It **buys** "cloud" servers (Bitburner's rentable compute) as you can afford them, and upgrades them over time.
- It **picks the most profitable targets** it can currently hack.
- It **hacks them efficiently** — with a simple method at first, and a much faster "batching" method once you unlock the right in-game tool.

You run `commander.js`. It does the rest. Everything else in the repo is a piece
it uses.

---

## ⚠️ Read this first: version compatibility

**This rig is written for Bitburner v3 and later** (the current Steam and
web releases). Bitburner reorganized a chunk of its scripting API in v3, and
**a lot of older scripts — and scripts from AI assistants trained on old
examples — use function names that no longer exist.** If your scripts fail
with errors like `ns.purchaseServer is not a function` or `ns.tail is not a
function`, that's almost certainly the problem, not your logic.

Here's the map from the **old (pre-v3, now broken)** names to the **current**
ones this repo uses:

| If you see this (old, broken on current Bitburner) | Use this (current) |
|---|---|
| `ns.purchaseServer(host, ram)` | `ns.cloud.purchaseServer(host, ram)` |
| `ns.getPurchasedServers()` | `ns.cloud.getServerNames()` |
| `ns.getPurchasedServerCost(ram)` | `ns.cloud.getServerCost(ram)` |
| `ns.getPurchasedServerLimit()` | `ns.cloud.getServerLimit()` |
| `ns.getPurchasedServerMaxRam()` | `ns.cloud.getRamLimit()` |
| `ns.deleteServer(host)` | `ns.cloud.deleteServer(host)` |
| `ns.tail()` | `ns.ui.openTail()` |

The API keeps evolving between versions. If a function errors with "not a
function," open the in-game script editor and type `ns.` — the autocomplete
shows the names your exact version supports. Trust that over any guide (or any
chatbot, including the one that helped write this).

---

## What you need in-game

Nothing exotic — the rig adapts to what you have:

1. **Port crackers** — programs like `BruteSSH.exe` that let you root servers.
   Buy them from the dark web (get the **TOR router** first, then `buy BruteSSH.exe`
   in the terminal). The more you own, the more servers the rig can hack. It works
   with zero, and gets stronger as you collect them (`BruteSSH`, `FTPCrack`,
   `relaySMTP`, `HTTPWorm`, `SQLInject`).
2. **`Formulas.exe`** *(optional but transformative)* — a ~$5b dark-web program
   that lets scripts calculate game mechanics exactly. With it, the rig switches
   into high-performance **batching** mode. **Without it, the rig automatically
   falls back to a simpler mode** — so you can run it from day one and it'll
   upgrade itself the moment you buy Formulas (just re-run it).

That's all. Everything runs from your `home` server.

---

## Quick start

1. In Bitburner, open the script editor (`nano <name>.js` in the terminal, or the
   Script Editor tab) and create each `.js` file from this repo on your **home**
   server, pasting in the contents. Keep the same filenames.
2. In the terminal, run:
   ```
   run commander.js
   ```
3. A log window pops up. That's it — it now roots servers, buys servers, and hacks.

Low on cash and it's not buying servers? Tell it to buy cheaper ones:
```
run commander.js 64        # buy 64GB servers instead of the 512GB default
```
Later, when you're rich, re-run with a bigger size (e.g. `run commander.js 512`)
and it rolls your smaller servers up to the new size automatically.

---

## How it works

`commander.js` is a **control loop**. Every ~10 seconds it:

1. Roots every server it can with your port crackers.
2. Buys one cloud server if you can afford it (or upgrades your smallest one once you're at the server limit).
3. Ranks the servers you can hack by profitability.
4. Makes sure your compute is aimed at the best targets.
5. Finds and solves **coding contracts** across the network — free money and faction reputation — unless you pass `--no-auto-solves`.

It runs in one of two modes, chosen automatically:

- **Batching mode** (you own `Formulas.exe`) — the fast one. It runs
  **HWGW batches**: tightly-timed groups of four operations — **H**ack,
  **W**eaken, **G**row, **W**eaken — that land a few milliseconds apart so a
  server is drained and refilled in a continuous, efficient stream, always kept
  at its ideal "prepped" state (minimum security, maximum money). The commander
  groups all your machines — `home`, cloud servers, and every rooted world server —
  into **fleets** (one per target) and runs a distributed `fleet-batcher.js` for
  each: many servers pool their RAM onto a single juicy target instead of wasting a
  whole box on a scrap. A reserve is kept free on `home` so the commander and
  contract-solver keep running, and the commander tail prints a live earnings
  summary (total this run, $/sec, and the best/worst fleet).
- **Fallback mode** (no `Formulas.exe`) — a simpler reactive worker
  (`early-hacking-template.js`) that just loops "weaken if too secure, grow if too
  poor, else hack." Less efficient, but needs no special tools and gets you
  earning immediately.

---

## The files

| File | What it is |
|---|---|
| **commander.js** | The one you run. Orchestrates everything; auto-selects batching vs. fallback, and prints a live earnings summary. |
| **fleet-batcher.js** | Distributed HWGW batcher — one controller drives ONE target using a whole FLEET of servers, pooling their RAM. This is what the commander launches in batching mode. |
| **batcher-pipe.js** | Single-host pipelined HWGW batcher. Superseded by fleet-batcher for the fleet; kept as a simpler standalone/reference version. |
| **batcher.js** | Simplest one-batch-at-a-time batcher. Easiest to read; good for learning. |
| **hack.js / grow.js / weaken.js** | Tiny one-line workers. A batch is built from these. |
| **early-hacking-template.js** | The reactive worker used by fallback mode. Fine on its own for a beginner. |
| **purchase-servers.js** | Standalone "buy a fleet of servers" script. The commander does this too. |
| **contract-finder.js** | Finds coding contracts network-wide and auto-solves the ~22 types it knows (never guesses blind). The commander runs it automatically; run it yourself with `--auto-solve`, or list-only with no flags. |
| **reset-scripts.js** | Emergency stop / clean slate — kills every script on every server (except itself). Run it before a major version hand-off, or to halt everything fast. |
| **formulas-api-reference.md** | Notes on Bitburner's Formulas API — signatures, gotchas, examples. |

---

## Tuning

- `run commander.js [serverRam] [hackFraction] [--no-auto-solves]`
  - `serverRam` — GB per cloud server to buy (default 512). It's a *default*, not a floor — pass a smaller number when you're broke.
  - `hackFraction` — how much of a server's money each batch steals (default 0.10). Smaller = smoother, more batches in flight.
  - `--no-auto-solves` — stop the commander from auto-solving coding contracts, so you can tackle them by hand.
- In `commander.js`: `HOME_RESERVE_GB` reserves RAM on `home` so the commander and your own scripts always have room; `CONTRACT_EVERY` sets how often it scans for contracts.
- In `batcher-pipe.js`: `SPACER` (gap between operations landing) and `BATCH_GAP` (gap between batch launches). Tighter = more throughput, less margin for timing jitter.

---

## Things that will bite you (learned the hard way)

- **One target per batcher.** Two batchers — or a batcher and reactive workers —
  aimed at the same server fight over its state and ruin each other's math. The
  commander keeps targets distinct automatically; if you launch things by hand,
  keep them apart.
- **A running batcher never looks "prepped" mid-cycle.** Its money dips and
  recovers by design. Don't write health checks that panic on that normal dip.
- **RAM cost is static.** Every `ns.*` function a script *mentions* is charged
  against its RAM whether it's called or not. Keep worker scripts tiny so more
  copies fit.
- **Cloud servers always have 1 CPU core; `home` can have more.** Cores boost
  grow/weaken only. So buy cloud servers for raw RAM, and value cores only on home.
- **Installing Augmentations wipes your cloud servers and your programs**
  (including `Formulas.exe`) — but keeps your `home` RAM and your scripts. After a
  reset, the rig drops to fallback mode until you re-buy Formulas. Just re-run it.

---

## Ideas / not done yet

- Use `ns.cloud.upgradeServer()` for in-place server upgrades instead of the
  current delete-and-rebuy (cleaner, and doesn't interrupt running scripts).
- Detect `Formulas.exe` appearing mid-run and switch from fallback to batching
  without a manual re-run.
- Re-optimize *running* fleets when a clearly-better host↔target pairing exists.
  Fleets are frozen once launched, so a poor assignment made during server-upgrade
  churn sticks until you restart the commander.
- Grow a running fleet as new servers are bought (a new host currently only seeds a
  new fleet for the next un-batched target, never enlarges an existing fleet).
- Denser batch pipelining for higher throughput.

---

## Where this came from

These scripts grew, piece by piece, during an actual playthrough — starting from
the beginner's-guide hacking loop and evolving into a self-running economy. That's
why the comments read like a running commentary; they're the reasoning left in
place on purpose, so you can see *why* each part exists, not just what it does.

Released into the **public domain** (see [LICENSE](LICENSE)). Copy it, break it,
improve it, share it. No attribution needed. Good luck out there.
