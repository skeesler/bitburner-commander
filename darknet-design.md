# DarkNet traversal agent — design

Design notes for automating the **DarkNet** (`ns.dnet`, new in Bitburner v3). This is the
doc we *thought* we had and didn't; API surface re-derived from the official 3.0 docs
(`bitburner-src/markdown/bitburner.darknet.md` and `.../doc/en/programming/darknet.md`).

## Why the DarkNet breaks our light-net playbook

The light-net rig (`commander.js`) works because `home` is omniscient: `scan` sees the
whole graph and you `exec` onto anything you've rooted. In the dark, none of that holds:

- **Local-only discovery.** `dnet.probe()` returns *only* the servers directly wired to
  the one your script stands on. No global scan — you learn the map by walking it.
- **The map mutates.** Servers restart, migrate, rewire links, or go offline for good.
  Loops and *disconnected islands*. Long-distance comms are often impossible.
- **Reach is expensive.** `scp` works at any distance once you hold a session, but `exec`
  needs a *direct* connection, a backdoor, or a **stasis link** — and stasis links are
  globally capped (`getStasisLinkLimit`).
- **Access is a puzzle.** `authenticate(host, password)` needs the real password. Hints
  come from `getServerDetails` and from `heartbleed(host)` (bleeds recent logs — may hold
  hints, failed-auth clues, or *other servers'* leaked creds). Charisma speeds auth and
  lowers requirements (`getServerRequiredCharismaLevel`).
- **Aggression has a cost.** `getDarknetInstability()` rises with excessive backdooring.

## Core inversion

You **cannot orchestrate from `home`.** You push autonomous agents into the dark and
coordinate them through **durable shared state on `home`.** Ants + a pheromone map, not a
conductor.

## Architecture (four pieces)

1. **Durable DB** (`dnet-db.json` on `home`) — the memory that survives dying scripts and
   resetting servers. Implemented in `dnet-db.js`. See schema below.
2. **Crawler** (`dnet-crawl.js`, TODO) — the replicating unit. On its current server:
   `probe()` → report neighbors home → for each neighbor, reuse a stored password or invoke
   the solver → on success `scp` self to the neighbor and `exec` there (legal: direct
   neighbor) → harvest local caches. Visited-set keyed by mutation epoch stops re-crawl.
3. **Solver** (`dnet-solve.js`, TODO) — the auth puzzle. *Collect* hint material
   (`getServerDetails` + `heartbleed`) → *decode* via pluggable strategies → *try*
   candidates (spread guesses across scripts). **Hint format unknown until we see real
   in-game `heartbleed` output** — ships as a framework with naive decoders, grown from
   real data. This is the first playtest loop.
4. **Commander** (`dnet-commander.js`, TODO) — can't traverse, so it *governs*: seeds
   crawlers onto the entry node; owns the DB and drains the inbox; spends the **stasis-link
   budget** on high-reach hubs; wakes on `nextMutation()` to re-survey/recover; throttles
   against `getDarknetInstability()`; reports harvest earnings.

## Confirmed from the field (2026-07-04, node `UwU`, model `FreshInstall_1.0`)

First cracked node pinned down the two shapes the docs didn't:

- **`authenticate` returns HTTP-style codes.** On success the log showed
  `{ message: "Success", passwordAttempted: "admin", code: 200 }`. Solver checks
  `code === 200`; assume a wrong guess is a 4xx (to confirm).
- **The auth puzzle is Mastermind/Wordle.** `heartbleed`/log hints give *positional*
  feedback on your last guess, e.g. `"The characters a, d are in the right place."`
  So the solver is a Mastermind solver: guess → parse hint grammar → constrain → re-guess.
- **Logs are mixed.** Real hints are interleaved with heartbeat noise
  (`HH:MM:SS: UwU — heartbeat check (alive)`) and flavor lines
  (`"Each creating their own universes..."`). The parser must match the hint grammar and
  ignore the rest.
- **Panel fields** → schema: `IP`, `Required charisma` (→ `charismaReq`), `RAM in use: 2+0/22.4`
  (used + blocked / max), `Model` (server archetype — drives difficulty/behavior), plus
  counts for `.cache` files, blocked RAM, and running scripts.
- **The terminal `connect` command does NOT work on darknet servers** (light-net only).
  There is no terminal-command layer for the darknet. Two interfaces only:
  (1) the **GUI** — the darkweb grid + per-node panel with "Submit Password", clickable
  cache icons, etc. (the manual way); (2) the **`ns.dnet` scripting API** (the automation
  way). Caches open via `ns.dnet.openCache(file)` from a script running *on* the node, or by
  clicking them in the GUI. `scp`/`exec` onto a node require a session (per-PID) from
  `authenticate` or `connectToSession`. `labradar()` = Labyrinth/maze navigation.

### The puzzle type varies by Model — solver is a layered dispatcher

Response envelope is consistent: `{ success, message, data, passwordAttempted, code }`.
Codes (HTTP-style): **200** authenticated · **401** wrong password · **351** Direct
Connection Required (target not directly connected — can't crack from here) · **503** Service
Unavailable (**rate-limited** — nodes throttle you if you guess too fast, so guess as FEW
times as possible; brute-force is actively harmful). `getServerDetails` returns (confirmed from
node `darkweb`): `passwordHint`, `passwordLength`, `passwordFormat`, `modelId`, `data`,
plus `isOnline`, `hasSession`, `isConnectedToCurrentServer`, `blockedRam`, `difficulty`,
`requiredCharismaSkill`, `depth`, `isStationary`, `logTrafficInterval`.

**Entry topology:** `home` is directly connected to exactly one darknet node, `darkweb`
(model `ZeroLogon`, no password, `home` already holds a session). Everything else is behind
it — you must `exec` a script onto `darkweb` and `probe()` from there. `darkweb` is the
doorway and is `isStationary` (won't migrate) — the natural anchor. Getting compute onto a
node = `scp` over a session + `exec` (see `dnet-step.js`).

Archetypes seen (2026-07-04):

| Model | Type | Signal | Crack |
|---|---|---|---|
| `FreshInstall_1.0` | Default password | hint "I never changed the password" | try defaults → `admin` |
| `DeskMemo_3.1` | Literal leak | hint "The PIN is 77" | parse answer from hint text → `77` |
| `CloudBlare(tm)` | Captcha | `data: 3(8~6`, numeric len 3 | strip non-format chars → `386` |
| `NIL` | Mastermind | **heartbleed** `data: yesn't,yesn't,…` (len == pw) | positional broadcast (stationary nodes; mobile ones mutate out mid-solve — see latency note) |
| `PHP 5.4` | Anagram | hint "**sorted** the password: 346" / "The PIN **uses** 035" · `data:"035"` | permutations of those digits (≤3!=6); triggers on sorted/anagram/rearranged/uses/made-up-of/consists-of |
| `Laika4` | Trivia | hint "It's the dog's name" (alphabetic) | *unsolved — needs a knowledge/wordlist strategy* |
| `Factori-Os` | Math property | hint "The password is divisible by K" | multiples of K (K=1 = troll, whole space → brute) |
| `BellaCuore` | Roman numeral | hint "the value of the number 'XL'" | convert Roman → int (XL=40) |
| `OpenWebAccessPoint` | Fuzzy digit-leak | **heartbleed** `data`: "Did it have a 6 and a 5? Theres a 2, and maybe a 6…" | mine `\ba (\d)\b` from the hint clause → `mustContain` (drop "maybe" — soft); re-bleed to accumulate. len6/num, charisma 183 — *unsolved, framework only* |
| `OctantVoxel` | Base conversion | hint "the base 9 number 548 in base 10" · `data: "9,548"` | `parseInt(number, base)` → 449 (guard: reject digit ≥ base). Static, cracks in 1 guess — solved |
| `Pr0verFl0` | Buffer overflow | hint "password buffer is N bytes" (N == pw len) · heartbleed `null` | authenticate a NONZERO string of length **~2N** — solved: `"1"×8` cracked an N=4 node (N+1/N+2 and all-"0" failed → content + ~double-length matter). Spread tries N+1→4N |
| `DeepGreen` | Bulls & cows (Mastermind) | **heartbleed** `data: "b,c"` = [exact-place, right-digit-wrong-place] — **2** numeric tokens (fewer than pw len; that's the tell vs NIL's per-position) | candidate-elimination + minimax pick; ~6 guesses for len3. FAST (~1.3s/guess) so it fits the ~12s reroll window; empty candidate set ⇒ reroll → abort. Numeric, len ≤ 4 |

**Mastermind is positional + independent** (`yes` = right symbol/right place, `yesn't` =
wrong). So don't brute the space — **broadcast** each symbol across all positions
(`00000`, `11111`, …). Each guess resolves every position whose symbol matches, so **≤10
guesses cracks any numeric node of any length.** neon-blade `15098` → 10 guesses, not 10⁵.

**Channel CONFIRMED for NIL (2026-07-05, node `smart_doorbell`).** The positional `yes/yesn't` comes
back in `heartbleed(host).logs[]` exactly as predicted — guess `00000` → `data: "yesn't,yesn't,yesn't,
yesn't,yesn't"` (all wrong, no `0` anywhere). Clean tokens, no noise (unlike `OpenWebAccessPoint`'s
prose), so the existing comma-split `feedback()` parses it as-is. The broadcast algorithm was right all
along; it only needed feeding from heartbleed instead of the (empty) auth reply. The solver now does
this (`bleedData()` → `feedback()`); see "Solver reads the channel" below.

Solver structure (refactored 2026-07-05): everything we learn about a password is a
**predicate** in a per-host constraint set (`dnet-constraints.js`, pure/zero-RAM/unit-tested).
Producers propose candidates; `satisfies()` disposes — so a looted "contains 3 and 1" narrows
*every* strategy at once (defaults, multiples, permutations, brute), not just its own. `solve()`
then runs two phases: **static** (`generate()` — literals/captcha/anagram/divisible/range/roman/
wordlist/defaults, cheapest first) then **adaptive** (positional broadcast for Mastermind, then a
`satisfies()`-pruned numeric brute). Details + looted intel (`opts.hints`, `opts.pool`) feed one
constraint set, so soft-node leaks crack hard nodes. Spec: `dnet-constraints.test.mjs` (`node` it).

Open: alpha/alphanumeric formats (only `numeric` seen); a "right symbol wrong place" token
(Wordle-yellow) — the broadcast method doesn't need it, but note if it appears.

**RESOLVED (2026-07-05): per-guess feedback rides `heartbleed`, NOT the `authenticate` return.** The
auth reply's `data` is empty/absent on a wrong guess; the hint arrives in `heartbleed(host).logs[]`. The
solver still (wrongly) reads `resp.data` off `authenticate` via `feedback()` — which is *why* the
broadcast never engaged live. A diagnostic in `dnet-solve.js` now bleeds on the no-feedback branch to
capture the channel; the adaptive rewrite to actually READ heartbleed is pending (design below).

### Feedback channel — CONFIRMED live 2026-07-05 (node `neo%grid:2642`, model `OpenWebAccessPoint`)

The per-guess hint is delivered through `heartbleed`, not the `authenticate` reply:

- `authenticate(host, guess)` → `{ success, code, message, passwordAttempted }`. Wrong guess = `code:401`
  and **no usable `data`** (empty/absent). Reading feedback off this reply (what `feedback(resp)` does
  today) sees nothing.
- `heartbleed(host)` → `{ success, code:200, message:"Success", logs: string[] }`. Each `logs` entry is a
  **JSON-encoded string** of a recent auth attempt:
  `{"code":401,"message":"<flavor>","data":"<noise + hint>","passwordAttempted":"<your guess>"}`.
  Only the most recent attempt(s) return, so **bleed immediately after each guess** and match on
  `passwordAttempted`.

Read path: guess → `heartbleed` → `JSON.parse` each `logs[]` entry → find `passwordAttempted ===` your
guess → parse its `.data`. That `data` string is **noisy** — interleaved random numbers, flavor lines,
and *other nodes' names/creds* — with the real hint embedded. Same "match the grammar, ignore the rest"
problem as raw logs, so `decodeEntities` + `parseText` apply directly.

**Noise is loot.** This `data` leaked `z3ni7h&incservices` (a different node) — heartbleed feedback is
also a cross-node intel vector; run `harvestCandidates` + the cred/hint regexes over it too.

**Guess FEWER, not more.** The solver made 14 blind guesses before bleeding, and the response `ms` climbed
7.5s → 11s across them — a soft throttle building toward 503. The whole point of the channel is to bleed
early and constrain: one seed guess → bleed → constrain → guess the *narrowed* set, not exhaust the pool
first.

### Latency vs. mutation → mobile high-difficulty NILs can't be pinned (2026-07-05)

Authenticate on hard nodes is **slow: ~8–11s per guess** (measured on `neo%grid:2642` and
`smart_doorbell`); easy nodes answer in ~1s. A full numeric broadcast is up to ~10 guesses → **~100s**,
but the net mutates every **~12s** and these nodes are `isStationary: false` — so the broadcast **cannot
finish before the node migrates out** (→ 351). We hoped `freezeServer` would pin it; it doesn't exist in
3.0.1 (see "Stasis + the REAL API surface") and nothing else pins an *uncracked* target. So: solve the
STATIONARY NILs (no mutation risk); on mobile ones, attempt unpinned and bail on the 351 — the try still
pays charisma XP. Charisma grinding speeds auth over time and should eventually shrink the broadcast under
the mutation window (the passive fix).

**Reroll confirmed (2026-07-06, `global_pharmaceuticals`, a FAST ~1s/guess NIL).** Even when auth is fast
and the node stays reachable (no 351), mutation **rerolls the password** every ~12s: positional feedback
contradicts itself mid-sweep (a position reads digit 6 on one guess, 9 three guesses later). So a
~10-guess broadcast accumulates feedback from two different passwords and assembles a stale, mixed answer.
Only LOW-digit passwords (sweep finishes inside one ~12s window) crack; high-digit ones always straddle a
reroll. The solver now **detects the reroll** (a `yes` on a position already solved with a *different*
digit) and aborts with a `rerolled` skip instead of a bogus "possible NEW model" dump. Net: mobile NILs
are effectively unwinnable without a pin — **accepted as a game constraint, not a solver gap.**

### Solver reads the channel (built 2026-07-05, `dnet-solve.js`)

Adaptive phase rewritten: `freezeServer` mobile nodes → broadcast probe → `bleedData()` (heartbleed →
`JSON.parse` each `logs[]` entry → match `passwordAttempted` → decoded `data`) → `feedback()`. If the
tokens look positional (`isPositional`) run the Mastermind broadcast, re-bleeding after each guess; else
fold the fuzzy prose into the constraint set and re-generate. Static phase is **skipped for `NIL`** (its
defaults/pool won't hit a random broadcast password, and each ~10s guess is pre-freeze mutation exposure).
Guesses are deduped so static+adaptive never re-spend one. **LIVE-UNVERIFIED** — parses + 31/31 spec, but
the freeze+broadcast has not been run in-game yet.

## The single-writer rule (why the inbox exists)

Many crawlers, one JSON file → clobbering. So: **crawlers never write the DB.** They drop
small append-only report files (`dnet-in-*.json`) into an inbox. The **commander is the
sole writer** of `dnet-db.json` and drains the inbox on a loop. No locks, no races.

```
crawler  --report()-->  dnet-in-<pid>-<seq>.json  --drainInbox()-->  dnet-db.json
                              (many writers)          (one writer)     (commander)
```

## DB schema (`dnet-db.json`)

```
{
  epoch:    <int>,     // our own mutation counter; commander bumps it each nextMutation()
  updated:  <ms>,
  passwords: { host: password },              // crown jewels — reused across resets
  servers:   { host: { depth, charismaReq, hasCache, stasisLinked, frozen,
                       lastSeenEpoch, lastSeenTime } },
  edges:     { host: { neighbors: [host...], epoch, time } },   // stamped w/ epoch = staleness
  frontier:  { host: { hints: [...], attempts, lastTry } }      // seen, not yet cracked
}
```

**Epoch note:** the docs expose `nextMutation()` (blocks until the next mutation) but no
obvious "current mutation count" getter. So we keep our *own* `epoch` int in the DB, bumped
by the commander each time `nextMutation()` resolves. Everything is stamped with it, so any
stored edge/password is a *hypothesis with an age*, verified on use.

**Wired 2026-07-05.** The commander arms `nextMutation()` as a *background* promise (it blocks, so we
can't await it inline without stalling the drain loop) that flips a `mutated` flag; each tick, if set,
it bumps `epoch`, re-arms, logs `⟳ mutation → epoch N (Δts)` to the tail, and saves. Incoming reports
are stamped with the current `epoch` (applyReport), so post-mutation facts read fresh and pre-mutation
ones age by one — `edgeAge` finally means something.

**Field finding: the darknet mutates every ~12s** (measured off the epoch Δ). That's *seconds*, not
minutes — the map is deeply ephemeral, which retroactively explains all the crawl→scout staleness. The
durable value is the **password book + pool + intel**, NOT topology; chasing a "complete map" is futile.

**Auto-pipeline (`run dnet-commander.js loop auto`).** Given 12s churn, re-crawling *per mutation* is
nonsense (a crawl outlasts the interval), so the commander instead keeps the pipeline continuously
running: when reports go quiet for `IDLE_TICKS`, it `exec`s `dnet-step.js` to launch the next stage,
cycling **crawl → loot → scout** forever. CRUCIAL FIX made here: idle detection keys off *reports
only* — a mutation must NOT reset the quiet counter, or at 12s cadence "pass finished" never fires and
the pipeline stalls. Full map block also now renders only on a merge (not on bare mutations) to stop
12s re-spam. `edgeAge`-driven stale-edge skipping is still an open follow-up.

## Two tensions to keep arguing about

- **Persistence vs. mutation** — how stale (epoch delta) before we re-verify vs. trust?
- **Reach budgeting** — replicate-and-lose-nodes cheaply vs. spend a scarce stasis link to
  pin one. Stasis turns a fragile deep node into a stable remote-exec anchor.

## Stasis + the REAL API surface (game-verified in 3.0.1, 2026-07-05)

**Correction — trust the game, not the dev docs.** An earlier pass here documented `freezeServer` and a
"24-method" surface straight from the dev-branch markdown. `run dnet-api.js` against the actual 3.0.1
build shows **22 methods, and `freezeServer` is NOT one of them** (`d.freezeServer is not a function`) —
the dev docs are ahead of the release. The 22 that exist:

  authenticate, connectToSession, getBlockedRam, getDarknetInstability, getDepth, getServerDetails,
  getServerRequiredCharismaLevel, getStasisLinkLimit, getStasisLinkedServers, heartbleed,
  induceServerMigration, isDarknetServer, labradar, labreport, memoryReallocation, nextMutation,
  openCache, phishingAttack, probe, promoteStock, setStasisLink, unleashStormSeed

**Consequence: there is NO pre-auth way to pin an uncracked target.** `freezeServer(host)` — which would
have pinned a *neighbor* by hostname — is gone. `setStasisLink(shouldLink)` acts on the **script's
current server** only: you must already be *running on* a node to link it, i.e. already have cracked it.
So a mobile, uncracked NIL cannot be held still while we solve it. **The freeze-to-crack plan is dead.**

- **`setStasisLink(shouldLink = true)`** — self-targets the current server: grants it remote access
  (`connectToSession`/`exec` from anywhere, bypassing the direct-connection rule) + stops it moving/going
  offline. Globally capped (`getStasisLinkLimit`). Still the **deep-REACH anchor** (pin a *cracked*
  beachhead → commander remote-execs the heavy solver onto it), just NOT a way to hold an unsolved target.
- **`phishingAttack()`** (2GB, runs on a darknet node) — money + **charisma** grind: phish a middle
  manager for cash (scales with threads; rare cache). The money is pocket lint at our wealth, but the
  **charisma** it builds is exactly the passive fix for hard/mobile NILs (faster auth, lower gates) — a
  potential accelerator worth testing against the crawler's own auth-grind.
- **`induceServerMigration`, `labradar`/`labreport` (maze), `promoteStock`, `unleashStormSeed`,
  `getDarknetInstability`** — real but unexplored; parked until we meet them.

**So how do we crack a mobile high-difficulty NIL?** Auth latency scales with difficulty/charisma: easy
nodes answer in ~1s, hard NILs in ~10s. A ~10-guess broadcast on a ~10s node ≈ 100s > the ~12s mutation,
so it migrates out mid-solve (→ 351) before we finish, and nothing can pin it. Current answer:
(1) **stationary** NILs solve fine (no mutation risk); (2) **mobile** ones we attempt unpinned and bail
cleanly on the 351 — the attempt still pays charisma XP; (3) **charisma grinding** speeds auth over time,
shrinking the broadcast below the mutation window, and the crawler self-grinds, so this improves
passively. Revisit if `induceServerMigration` or the maze (`labradar`) turns out to offer a pin.

## Charisma (self-grinding — the crawler is the engine)

**Confirmed live (2026-07-04):** running the crawler grants a *lot* of charisma XP — every
`authenticate` attempt pays, and the solver makes many. This is a virtuous loop: crack nodes →
gain CHA → clear higher `requiredCharismaSkill` gates → crack deeper nodes. The crawler funds
its own reach. Largely obviates a dedicated grinder for darknet purposes (`grind-charisma.js`
stays parked). Note below kept as reference for non-darknet charisma needs.



Charisma gates DarkNet auth (`getServerRequiredCharismaLevel`) and scales `phishingAttack`,
not just factions. Scriptable **iff** Singularity is available: travel → optionally backdoor
the university server for a tuition discount → `singularity.universityCourse(uni,
"Leadership", focus)` loop to target, then stop. Without Singularity it's a manual
sit-at-university. Planned helper: `grind-charisma.js`.

## Layer 1 (behind `darkweb`, depth 0, seen 2026-07-04)

Six nodes, all solver-crackable: `7777777` (DeskMemo→620), `blade_industries` (→292),
`cell::matrix` (→846), `neon^hu🅱️` (CloudBlare captcha `1#╬:0]9]/-4`→1094, **charisma 63**),
`george` (FreshInstall, **alphabetic** len5→`admin`), `cryptic;genesis` (ZeroLogon, empty pw).
New this layer: `alphabetic` format, empty-password ZeroLogon, and a real charisma gate.

## Status

- [x] `dnet-db.js` — DB library + inbox drain + `flush()` (scp reports node→home)
- [x] `dnet-solve.js` — solver; confirmed field names; handles empty/literal/captcha/default
- [x] `dnet-constraints.js` — pure constraint model (predicates → candidates); 18/18 spec green
      (`node dnet-constraints.test.mjs`); consumed by the solver + fed looted hints by the crawler
- [x] `dnet-recon.js` — throwaway shape-dumper (served its purpose; keep for probing new layers)
- [x] `dnet-step.js` — doorway: scp+exec a script onto a directly-connected node
- [x] `dnet-crawl.js` — **Increment 1**: cracks one node's whole neighbor layer, reports home
      (verified live 2026-07-04: 5/5 cracked on a mutated darkweb layer)
- [x] `dnet-crawl.js` — **Increment 2**: self-replicates onto cracked neighbors (recurse),
      parent/per-run-marker/ps loop-guards, depth cap, skips 351/offline; solver early-aborts
      351/503 (verified live 2026-07-04: clean depth-4 crawl, no hangs)
- [x] `dnet-commander.js` — home-side: drain inbox → `dnet-db.json`, print the consolidated
      map + password book. Single writer of the DB. (`run dnet-commander.js [loop]`)
- [x] **RAM decision (2026-07-04):** `darkweb` is **16 GB** and the map+crack crawler is
      already ~15.4 GB — so **harvest CANNOT live in the crawler** (`openCache` blows past 16).
      Reverted harvest out. Looting becomes a **separate lighter pass** (below).
- [x] `dnet-loot.js` — **the loot pass** (Pass 2): light (no solver), reads passwords from
      shipped `dnet-db.json`, `connectToSession` + `openCache` + `memoryReallocation`, recurses.
      Ships `dnet-db.json` in payload (dnet-step + looter updated to carry it). Only loots cracked
      nodes. Open Qs still to verify live: exact `openCache`/`connectToSession` return shapes;
      whether `exec` onto a cracked node needs only the direct connection (assumed) or a backdoor.
- [x] `dnet-scout.js` — **the light reach + map pass** (2026-07-05): drops getServerDetails +
      authenticate (the ~7GB the crawler can't shed), so it fits the 16GB-with-overhead nodes the
      crawler bounces off. probe()s + relays + cracks only already-known passwords (connectToSession,
      no solving), mapping the deep region and confirming looted-cred nodes. Does NOT solve new nodes
      (physically can't on a small node). Complements crawl/loot/recon; own `dnet-sseen-<runId>` marker.
- [ ] stasis anchoring: a LIGHT pinner on a deep beachhead calls `setStasisLink(true)` (self-targets its
      CURRENT server — NOT a hostname; boolean; **12GB RAM**, globally capped) → commander `connectToSession`
      + `exec`s the heavy crawler/probe onto it remotely (solve deep regions). Budget readout already in
      commander. Confirmed API + the `freezeServer` companion in "Stasis, freeze, and the full API surface".
- [x] `dnet-hbprobe.js` + `dnet-solve.js` diagnostic — **found the feedback channel** (`heartbleed().logs[]`,
      not the auth reply; confirmed 2026-07-05 on `OpenWebAccessPoint` + `NIL`).
- [x] `dnet-solve.js` adaptive rewrite — reads heartbleed (`bleedData`), dispatches positional-broadcast
      vs fuzzy-prose, numeric brute capped at BRUTE_CAP. Freeze guarded (freezeServer absent in 3.0.1).
      Channel confirmed live on NIL; mobile high-difficulty NILs 351 out mid-broadcast (unpinnable).
- [ ] instability management, earnings reporting (later)

### Loot is two kinds (confirmed live 2026-07-04)

`openCache` **only accepts `.cache` files** (errors otherwise: "File must end in .cache").
The files actually seen on nodes are `.data.txt` and `.lit`, which are **read with `ns.read`**
(RAM-free), not opened. So loot splits:
- **`.cache`** → `openCache` → money/programs. *None seen yet* on reached nodes — may be rarer,
  deeper, or behind blocked RAM (`memoryReallocation` didn't surface any here).
- **`.data.txt` / `.lit`** → readable **intel**: files named `credentials.data.txt`,
  `secrets.data.txt`, `journal.data.txt` — likely hold passwords/hints for *other* nodes
  (esp. the ones logic can't crack, like `Laika4` trivia). `.lit` files skew lore
  (`server-offline-problem.lit`, `darkweb-rebooted-again.lit` = mutation flavor).
  **CONFIRMED (2026-07-04):** reading these files works and they carry cross-node intel:
  - `login.data.txt`: "Remember this password: 428" (a literal password lying around)
  - `secrets.data.txt`: "The password for `5e7aico55a_&_namhcab` contains 3 and 1" — a node's
    file leaking a *partial password constraint for a different node*. This is the mechanic:
    **loot intel off soft nodes to crack hard/charisma-gated/trivia nodes.**
  - `.lit` files are lore, but some tip off models: "servers only respond with raw binary
    data… what each bit represents?" → a binary-decode model exists, not yet met.
  - Node names are reversed leetspeak of light-net companies: `5e7aico55a_&_namhcab` =
    "associates & bachman", `drahorcim` = "microhard".

**CACHES FOUND + money confirmed (2026-07-04):** `.cache` files hidden behind owner-blocked
RAM — **repeated `memoryReallocation` until `getBlockedRam` hits 0 uncovers them**, then
`openCache`. Two subtypes: cash (`"a cache with $50.089m"`) and `"a data file cache!"`
(program/exp/intel drop). Each `openCache` returns `{success, message, karmaLoss}` and costs a
little karma. One pass pulled ~$84m. Some caches also sit on `blocked=0` nodes — reclaim is
needed only for the hidden ones, harmless elsewhere.

**Intel formats mined from `.data.txt` (auto-parsed in `db.applyReport`):**
- `Server: <host> Password: "<pw>"` → straight into the password book (the flywheel).
- `The password for <host> contains X and Y` → frontier hint (partial constraint).
- `Remember this password: <n>` → ambiguous owner, not auto-applied.
- `.lit` wordlists are answer keys for trivia models: `dog-name-ideas.lit` ("fido, spot,
  rover, max") cracks `Laika4` ("It's the dog's name", len 4 → `fido`/`spot`).

**Entity decoding (2026-07-05):** looted text arrives as raw MUI markup (`<p class="Mui…">`,
`&#x27;`, `&amp;`). `decodeEntities()` (pure, in `dnet-constraints.js`) strips/decodes it at three
points — the looter (at read time, so logs + storage are clean), `applyReport` (before parsing), and
the commander display. Not just cosmetic: node names contain `&` (`5e7aico55a_&_namhcab`), so an
escaped `…&amp;…` hostname in a `Server: … Password: …` leak would silently fail to parse and drop a
free cred. Decode-before-parse recovers those.

Loop now closes **in code** (2026-07-05): loot soft nodes → creds/hints feed the DB → the crawler
now ships `dnet-db.json` and passes each host's stored `frontier` hints into `solve()`, which folds
them into the constraint set → harder nodes crack. It also reuses a known/looted password (one
verifying `authenticate`) before spending guesses.

**Pool wiring done (2026-07-05):** `harvestCandidates()` (in `dnet-constraints.js`) mines looted
text for reusable candidates — comma-lists (`dog-name-ideas.lit`, "common passwords include …",
`factory-default.lit`) and loose "Remember this password: N" creds — which `applyReport` pools into
`db.wordlist` (capped 300). The crawler passes that pool into `solve()`; `generate()` filters it
per-node via `satisfies()` and caps the contribution (`poolLimit` 40) so a big numeric list can't
spend us into a 503. This is what should finally crack trivia models like `Laika4` (dog-name), whose
answer key we were already looting four times over. Remaining: handle the hinted binary-decode model
when we meet it.

**Reach bug found + fixed (2026-07-05): it was a recursion self-trip, NOT RAM.** Live crawls kept
printing `spawned 0 deeper crawler(s)` with `reach fails: 0` — the "0 fails" was the tell: no scp/exec
was failing, recursion just never fired. Cause: the crawler scp's its own `dnet-seen-<runId>` marker
onto a cracked neighbor (so SIBLING crawlers skip it), then immediately re-checked
`fileExists(seen, host)` before recursing — tripping on its OWN marker every time. Removed that guard
(the loop-top check + the `ps()` double-exec guard already cover sibling dedup). This should be the
whole reach story; a RAM ceiling on deep nodes may still exist but we haven't actually hit one — the
`db.spawnFails` diagnostics (host + reason + `blockedRam`, printed by the commander) will show it if so.

**Trickle reporting (2026-07-05):** the crawler now `report()`+`flush()`es as it goes — a check-in on
arrival, then each crack the instant it lands — so the commander updates node-by-node instead of in
end-of-neighborhood bursts. Idempotent fields only; `spawnFails` still ships once at the end.

**Crawler diet (2026-07-05): the RAM ceiling was real but tiny, and it's now fixed.** The "stranded"
nodes turned out NOT to be tiny airgaps — they're 16GB nodes (same as darkweb) running a ~1GB heartbeat,
leaving ~15GB free. The crawler was **15.35GB** — it missed by ~0.35GB. (The looter, 7.9GB, fits and
already spidered through them, which is why loot reached deep and crawl didn't.) Fix = shave the
crawler: a script pays RAM for every `ns.*` in its imported modules, even uncalled ones, so (1)
`drainInbox` (uses `ns.rm` ~1GB) moved to **`dnet-db-drain.js`** (commander-only import), (2) `flush()`
rewritten to skip `ns.rm` via an in-memory sent-set, (3) the `ns.ps` double-exec guard dropped (two
~14GB crawlers can't co-host a 16GB node anyway). Target ~14GB → fits the 16GB nodes with headroom.
Stasis links (now surfaced in the commander) stay the tool for genuinely deep beachheads + durability.

**Open — the two passes desync under mutation.** Loot targets darkweb's *current* neighbors, but the
map mutates between the crawl and loot passes, so loot can find a different (uncracked) neighbor set
than the crawl just cracked → `spawned 0 deeper looter(s)`. Watch whether fixed-recursion crawls
(which spider deep in one pass) leave enough freshly-cracked nodes for loot before the next mutation.

*All unit-verified (25/25 in `dnet-constraints.test.mjs`), in-game unverified.*

**Two-pass architecture (the plan):** Pass 1 = heavy crawler cracks + maps (writes passwords
to DB via commander). Pass 2 = light `dnet-loot.js` revisits with `connectToSession` (no
expensive solver) and opens caches. Splitting by RAM is the whole point: cracking is one-time
and can afford to be heavy; looting must be cheap enough to land on every node.

Confirmed live: darknet **mutates between runs** (darkweb's neighbor set changed entirely);
FreshInstall default varies by format/length (`admin` alphabetic vs `0000` numeric); a node
can be named `null` (JSON-collision hazard to watch in the DB).
- [parked] `grind-charisma.js` — deferred; charisma section above kept as reference
