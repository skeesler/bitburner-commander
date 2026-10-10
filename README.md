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

It has since grown three more rigs that run alongside it, each with its own docs: the
[DarkNet](#the-darknet-advanced-frontier) crawlers, the
[augmentation flywheel](#the-augmentation-flywheel) that turns money into permanent upgrades, and a
[corporation](#the-corporation-bitnode-3) — which in BitNode 3 is not a side project but the entire
income plan. `boot.js` starts the lot.

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
2. **`Formulas.exe`** *(optional)* — a ~$5b dark-web program that lets scripts
   calculate game mechanics exactly. The rig **batches with or without it**: without
   Formulas it preps each target first and reads the live API (a short warm-up, then
   full-speed batching); with Formulas the math is exact from the first cycle. So run
   it from day one — buying Formulas later just sharpens the math (re-run to pick it
   up).

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

> Tired of copy-pasting files into the game one by one? **`SYNC-SETUP.md`** walks through
> Bitburner's Remote File API — a ~10-minute, one-time setup so saving a file in your editor
> pushes it straight onto the game's `home`.

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

**Batching is the default**, with or without `Formulas.exe`. It runs **HWGW
batches**: tightly-timed groups of four operations — **H**ack, **W**eaken,
**G**row, **W**eaken — that land a few milliseconds apart so a server is drained
and refilled in a continuous, efficient stream, always kept at its ideal "prepped"
state (minimum security, maximum money). The commander groups all your machines —
`home`, cloud servers, and every rooted world server — into **fleets** (one per
target) and runs a distributed `fleet-batcher.js` for each: many servers pool
their RAM onto a single juicy target instead of wasting a whole box on a scrap. A
reserve is kept free on `home`, and the tail prints a live earnings summary (total
this run, $/sec, best/worst fleet).

`Formulas.exe` just changes *how the batch math is computed*, not whether batching
runs:

- **With `Formulas.exe`** — the numbers (hack %, grow threads, operation times) are
  solved *exactly* for the prepped state, so a fresh target batches optimally from
  the first cycle.
- **Without it** — the batcher **preps the target first** (weakens to min security,
  grows to max money), then reads the *live* game API. Once a server is sitting at
  its prepped state, `hackAnalyze`/`growthAnalyze`/`getWeakenTime` report the very
  numbers Formulas would — so it batches for real, just after a short prep. This is
  what carries the whole pre-Formulas early game.

Any RAM the batchers **can't** use — because your target pool is thin (few crackers
/ low hacking level) — is auto-routed into an **XP farm** (`xp-farm.js`): it weakens
a big rooted box you can't yet *hack* purely for hacking XP, so idle capacity
becomes the levels that open more targets.

Prefer the old, dead-simple behavior? `run commander.js --reactive` forces a
reactive deploy-all (`early-hacking-template.js`: loop "weaken if too secure, grow
if too poor, else hack") plus the same XP soak — a safety net if a batch ever
misbehaves.

---

## The files

| File | What it is |
|---|---|
| **commander.js** | The one you run. Orchestrates everything; batches (with or without `Formulas.exe`), XP-farms idle RAM, and prints a live earnings summary. `--reactive` forces the old reactive mode. |
| **fleet-batcher.js** | Distributed HWGW batcher — one controller drives ONE target using a whole FLEET of servers, pooling their RAM. This is what the commander launches in batching mode. |
| **batcher-pipe.js** | Single-host pipelined HWGW batcher. Superseded by fleet-batcher for the fleet; kept as a simpler standalone/reference version. |
| **batcher.js** | Simplest one-batch-at-a-time batcher. Easiest to read; good for learning. |
| **hack.js / grow.js / weaken.js** | Tiny one-line workers. A batch is built from these. |
| **early-hacking-template.js** | The reactive worker used by fallback mode. Fine on its own for a beginner. |
| **xp-farm.js** | Weaken-for-XP worker. Fallback mode points otherwise-idle RAM at it to farm hacking XP (weaken needs only root, not level) — turning surplus capacity into the levels that unlock more targets. |
| **purchase-servers.js** | Standalone "buy a fleet of servers" script. The commander does this too. |
| **contract-finder.js** | Finds coding contracts network-wide and auto-solves the 30 types it knows (never guesses blind — a wrong answer burns one of a contract's limited tries). The commander runs it automatically; run it yourself with `--auto-solve`, or list-only with no flags. Its solvers are spec'd by `contract-finder.test.mjs` under plain Node. |
| **reset-scripts.js** | Surgical reset — kills only the commander's own script family (its controllers + workers) across home + cloud + world, sparing everything else (notably `stock-trader.js`). Run before a version hand-off, or to halt the rig fast. |
| **stock-trader.js** | 4S stock-market bot (long-only): buys strong-forecast stocks, sells on flips, and honors a `keepLiquid` cash reserve. A separate income stream that survives a rig reset. |
| **liquidate.js** | One-shot "sell everything, go to cash" for the stock portfolio. Pair with `kill stock-trader.js`. **Run it before every augmentation install** — an install re-initialises the stock market and your positions are destroyed, though your WSE/TIX/4S purchases survive. |
| **traceroute.js** | Prints the `connect` path from `home` to any server (case-insensitive, with a "did you mean"). Handy for reaching backdoor targets after the per-install network reshuffle. |
| **formulas-api-reference.md** | Notes on Bitburner's Formulas API — signatures, gotchas, examples. |

---

## The DarkNet (advanced frontier)

Bitburner v3 added the **DarkNet** (`ns.dnet`) — a procedurally-generated, constantly-mutating
network living alongside the static one, where every server is a little password *puzzle* and the
whole map reshuffles every few seconds. This repo includes a separate rig for automating it
(`dnet-*.js`): autonomous crawlers that replicate outward, crack each node's auth puzzle, harvest
loot, and coordinate through a durable shared database on `home` — because, unlike the light net,
you **can't** orchestrate the darknet from a single vantage point.

It's a different beast with its own docs — **start with the runbook**:

- **`dnet-runbook.md`** — the commands and when to run them.
- **`darknet-design.md`** — the *why*: architecture, the puzzle-model zoo, and field findings.

| File | What it is |
|---|---|
| **dnet-commander.js** | Home-side owner of the darknet DB: drains crawler reports into it, prints the map + password book, and can self-drive the crawl → loot → scout pipeline (`loop auto`). |
| **dnet-crawl.js** | The replicating cracker — probes a node's neighbors, cracks each password, and spiders onward. |
| **dnet-solve.js** | The password solver: a constraint model plus per-model strategies (defaults, captcha, anagram, base-conversion, buffer-overflow, Mastermind, …). |
| **dnet-constraints.js** | Pure, unit-tested constraint model behind the solver — `node dnet-constraints.test.mjs`. |
| **dnet-loot.js / dnet-scout.js** | Light passes: harvest caches/intel, and map the deep region using already-known passwords. |
| **dnet-db.js / dnet-db-drain.js** | The durable shared database (single-writer) and its inbox drain. |
| **dnet-step.js** | The door: push a darknet script onto a directly-connected node and run it there. |
| **dnet-recon.js / dnet-hbprobe.js / dnet-api.js** | Throwaway probes for learning the live API and response shapes. |

Append `--suppress-info` to any crawl (or `dnet-commander.js loop auto`) to quiet the routine chatter
and see only genuinely-new puzzle models.

---

## The augmentation flywheel

Hacking money is a means to an end: **augmentations**. Buying them, installing them (which resets
your level, your cloud servers and your programs) and coming back stronger is the actual loop of
the game. These scripts automate all of it except the trigger itself.

| File | What it is |
|---|---|
| **ascend.js** | Plans the augmentation purchase — joins factions, buys in the right order, dumps leftover cash into NeuroFlux. It **will not install** unless you pass `--install`; that trigger stays yours. |
| **ascend-boot.js** | Rebuys the `.exe` programs an install wipes, so the commander can root things again on the other side. |
| **boot.js** | Brings the *whole* earning stack back up in one command: commander, gang, stock trader, sleeves, corporation — each behind a prerequisite check, each skipped if already running. |
| **share-manager.js** | Sprays `ns.share()` across idle fleet RAM to boost faction reputation gain, with a home reserve. |
| **backdoor.js** | Walks the network installing backdoors on the servers that matter (faction unlocks, and the -50% company rep requirement). |

```
run ascend.js                          # plan and buy; never installs
run ascend.js --install --cb boot.js   # ...and pull the trigger, then reboot everything
```

**Two things survive an augmentation install: your gang and your corporation.** So an install costs
you nothing on those fronts, and there's no reason to hesitate over one.

*(One exception, learned in BitNode 9: your **hacknet** does not survive, and when the hacknet is your
income plan an install is expensive rather than free. Batch your augmentations there.)*

---

## Passive income: gang and sleeves

| File | What it is |
|---|---|
| **gang-manager.js** | Runs a gang end to end: recruits, ascends members past the diminishing-returns point, assigns tasks by what actually pays, and buys equipment. `gang-design.md` is the *why*. |
| **sleeve-manager.js** | v3: a *role* per sleeve after shock recovery and sync. **faction** (rep toward augs you still need, one faction per sleeve), **bb** (contracts, Infiltrate Synthoids, Diplomacy, Support), **crime**, **train**, or **idle**. `auto` goes crime-for-a-gang first, then Bladeburner if you're in it, then faction rep. `--roles "bb,bb,faction,…"` sets them per sleeve; `--once` prints the plan. |
| **stanek.js** | Stanek's Gift (BitNode 13, or anywhere with SF13). `plan --plan bb` searches every legal layout of a plan's fragments plus boosters on the gift's grid and shows the best; `place --yes` lays it out (clearing the gift loses charges); `charge` runs one big `stanek-charge.js` with all spare RAM, because a fragment's effect grows with the log of its *biggest single* charge. `show` draws the gift with live effects. The *why* is `bn13-design.md`. |
| **grafting-queue.js** | Queues augmentation grafting, which trades time for augs you can't otherwise reach. |
| **gang-api.js** | Throwaway live-API probe, the same shape as `dnet-api.js`. |

---

## The hacknet and hashes (BitNode 9)

The hacknet is the one income stream this repo never automated, and BN9 "Hacktocracy" is the node
built around it. The work is at the *evidence-gathering* stage rather than the rig stage, so these
three scripts are honest about what they don't know yet.

BN9 is a strange place, and three of its numbers drive everything:

- **`CloudServerLimit` is 0** — you cannot buy a single cloud server (confirmed in-game). Hacknet
  servers are the only compute you can purchase, home RAM costs 5×, and `purchase-servers.js` is
  dead weight here. **RAM is this node's real currency.**
- **`ServerMaxMoney` 0.01 × `ScriptHackMoney` 0.1** — hacking income is ~0.1% of normal, so the
  hacking rig is not the income plan in BN9.
- **`HacknetNodeMoney` is NOT set** — despite being the hacknet BitNode, BN9 applies no penalty to
  hash production. (Nodes 4/5/6/10/11 do; 9 doesn't.)

The tension the rig has to solve: hash gain scales with **free** RAM, so every GB you lend a batcher
is production you switched off — and `commander.js` will happily deploy onto hacknet servers without
a word in any log. `hacknet-scan.js` prices that tradeoff in dollars/hour.

Read **`hacknet-design.md`** for the *why* — the full BN9 multiplier table, all 11 hash upgrades with
costs and target requirements, the calibration that makes `Formulas.exe` unnecessary, and the "first
40 corporation-fund sales beat everything else" finding. Every claim is tagged [SRC] (read from the
v3.0.1 release tag), [LIVE] (confirmed in-game) or [OPEN].

| File | What it is |
|---|---|
| **hacknet-api.js** | Throwaway live-API probe, the same shape as `dnet-api.js`/`gang-api.js`/`corp-api.js`. Dumps the real surface, the live shapes, the BitNode context and the hash shop's price curve. Read-only; flushes to a file after every section so a crash still leaves evidence. |
| **hacknet-scan.js** | Read-only dashboard: what the fleet produces, whether hashes are overflowing (they're discarded silently), the whole shop priced in seconds-of-production, and every hardware upgrade ranked by dollars per extra hash/sec. |
| **hacknet-spend.js** | The one that spends, and only with `--go`. It measures the before/after deltas of a purchase rather than trusting what a guide says it does. `--discover` surveys which upgrades need a target argument — something no getter will tell you. |
| **ram-costs.js** | Prices every `ns` function with `ns.getFunctionRamCost` and every script with `getScriptRam`, side by side. Written because a read-only probe came back at 11.65 GB on a 32 GB home — and because in BN9 you cannot buy your way out of a RAM shortage. |
| **money-sources.js** | Dumps `ns.getMoneySources()` biggest-first. The honest answer to "my cash is climbing and I don't know why", which is a harder question than usual in a node that nerfs most income streams unevenly. |

```
run hacknet-api.js       # first: what is actually here?
run hacknet-scan.js      # then: what's it doing, and what should I buy next?
run money-sources.js     # where is the money actually coming from?
run ram-costs.js         # what is everything costing me in RAM?
```

None of them need `Formulas.exe` — `hacknet-scan.js` implements the confirmed gain formula and
calibrates it against live production, which also folds in every multiplier automatically.

---

## Intelligence (BitNode 5)

BN5 "Artificial Intelligence" grants the **intelligence** stat — the one stat that survives every
reset, forever, and quietly boosts hacking, reputation, crime, `share()` and program creation. The
node itself is gentle (hacking pays 15%, cloud servers work, contracts pay full price, the darknet
pays 70% — its best anywhere), and just standing in it hands you `Formulas.exe` free at every
reset plus a working `ns.getBitNodeMultipliers()`.

Like the hacknet before it, this rig starts as *evidence-gathering*: **`bn5-design.md`** is the
*why* — the full multiplier table, everything intelligence boosts and every source of int XP with
real numbers, all read from the v3.0.1 source and tagged [SRC] until the probes below promote them
to [LIVE].

| File | What it is |
|---|---|
| **int-api.js** | Read-only probe, the `hacknet-api.js` shape: node context, the int level/exp baseline and curve check, live-vs-source diffs of the BN5 *and* BN9 multiplier tables, the API surface, the exact enum strings the labs need, and a free RAM price list. Run this first. |
| **int-delta.js** | The player-action lab (acts only with `--go`): a travel round-trip (the cleanest unit test — exactly +0.00006 XP), a timed university class (solves the real study multiplier from the delta), one crime. Measures before/after instead of trusting any table, including ours. |
| **int-sleeve-delta.js** | Puts a sleeve in a Computer Science class and tests whether its int XP really mirrors to the player at ×(sync/100). If it does, eight sleeves in a classroom are a ~1,300 XP/hour intelligence farm that runs itself — and the sleeve is left studying on purpose. Needs sleeves (SF10, or being in BN10); it reports and exits cleanly if you have none. |
| **int-farm.js** | The farm the probes earned: creates `b1t_flum3.exe`, deletes it, creates it again, forever — ~360 int XP/hour (program creation pays 0.1 XP per second worked, and the delete-recreate loop was confirmed live). Runs unfocused so you keep your screen, but it *does* own your player action — kill it to do faction work. It only ever `rm`s the file it makes; **never `run b1t_flum3.exe` yourself** (running it flumes you out of the BitNode). |

```
run int-api.js                       # first: what is actually here, and do the tables match?
run int-delta.js --travel --go       # cheapest possible sanity check ($400k, exact expected value)
run int-delta.js --class --go        # 60s of class; the solved factor picks the right story
run int-sleeve-delta.js --go         # the sleeve mirror (needs sleeves — SF10 or BN10)
run int-farm.js                      # then: the payoff — farm ~360 int XP/hour while idle
```

One farm needs no new script at all: **buying an augmentation grants 15 int XP** — so `ascend.js`,
the flywheel you already run, is also the strongest int burst in the game. Every NeuroFlux level
counts. (Augs cost 2× money in BN5; the flywheel spins slower, but every spin now compounds twice.)

---

## The corporation

In BN3 the corporation is the whole income plan (hacking earns ~0.8% of normal there). Anywhere
else it's the long-game money engine you start once something like a gang is already paying.
Starting one outside BN3 costs \$150b of your own money, and getting profit *out* means going
public and selling shares.

It used to be 29 small scripts, because every `ns.corporation.*` function costs 10–20 GB just for
being mentioned in a file and the rig had to fit a 64 GB home. With a big home that wall is gone
(the whole API in one file is 961.6 GB, under the game's 1 TB per-script cap), so it's now four
files, split by *job*. The old rig is intact in `archive/` for small-home nodes.

- **`corp-runbook.md`**: the *how*. First run, rounds, getting money out, cheat sheet, troubleshooting.
- **`corp-design.md`**: the *why*. The rewrite, the RAM rules read from source, and the field
  findings behind every decision.

| File | What it is |
|---|---|
| **corp.js** | The resident manager (~495 GB). Every cycle, right after SALE: fills seats and holds the job mix, keeps morale up, puts a sell order on everything produced (the default is none, i.e. \$0/s), buys inputs or switches Smart Supply on, keeps a product in development and priced, keeps the Market-TA.II flags on. `--auto` also spends: upgrades (Wilson first), AdVert, research, boost materials. |
| **corp-do.js** | One-shot commands you run on purpose: `create`, `expand`, `office`, `warehouse`, `jobs`, `export`, `sell`, `unlock`, `research`, ... and the one-way levers `accept`, `public`, `sellshares`, which need `--yes`. |
| **corp-report.js** | Everything about the corporation in one paste-back block, ending in a FLAGS section. Reads, never spends. |
| **corp-lib.js** | The shared maths (boost split, job mixes, supply controller, price hunt), specced by `node corp-lib.test.mjs`. |

`corp.js` never accepts an offer, goes public, sells shares, or retires a product without
`--rotate`. Those stay yours.

---

## Tuning

- `run commander.js [serverRam] [hackFraction] [--no-auto-solves]`
  - `serverRam` — GB per cloud server to buy (default 512). It's a *default*, not a floor — pass a smaller number when you're broke.
  - `hackFraction` — how much of a server's money each batch steals (default 0.10). Smaller = smoother, more batches in flight.
  - `--no-auto-solves` — stop the commander from auto-solving coding contracts, so you can tackle them by hand.
  - `--reactive` — force the old reactive deploy-all instead of batching (a safety net if a batch misbehaves).
- In `commander.js`: `HOME_RESERVE_GB` reserves RAM on `home` so the commander and your own scripts always have room; `CONTRACT_EVERY` sets how often it scans for contracts.
- **Cash-awareness** (in `commander.js`): server-buying keeps a *cash reserve* equal to the price of the next dark-web tool you don't own yet (TOR → the five crackers → Formulas), so it never drains you below your next unlock — the reserve rises on its own each time you buy the tool below it, and drops to zero once you own them all. While you're still banking for one, `TRICKLE` (default `0.10`) is the share of cash it still trickles into servers so RAM keeps creeping up. Bump `TRICKLE` if the ramp feels too slow; lower it to hoard harder.
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
- **Installing Augmentations destroys your stock POSITIONS but keeps your stock
  PURCHASES.** `prestigeAugmentation()` calls `initStockMarket()`, which deletes every
  `Stock` object and rebuilds it — shares included. Your WSE account, TIX API and 4S
  data are only reset on a *BitNode* change, so they're a once-per-node purchase. Always
  `run liquidate.js` before installing; holding through one is pure loss.
- **Installing Augmentations wipes your cloud servers, your programs and your
  hacknet** (including `Formulas.exe` and every hacknet node/server) — but keeps your
  `home` RAM and your scripts. After a reset, the rig drops to fallback mode until you
  re-buy Formulas. Just re-run it. The hacknet loss barely matters in most BitNodes; in
  **BitNode 9 it's severe**, because the free level-100 starter server is granted only on
  entering a BitNode, not on installing — see `hacknet-design.md`.

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
