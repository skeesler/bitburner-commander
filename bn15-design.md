# bn15-design.md — BitNode 15 ("The Secrets of the Dark Net"), the *why*

Same contract as the other node docs: every claim is tagged **[SRC]** (read from the `v3.0.1` tag),
**[LIVE]** (confirmed in the running game) or **[OPEN]**. The running game outranks everything here.

> **Position (2026-10-09): entered BN15.1.** First visit, so no SF15 yet. Charisma 54 at start. The live findings so
> far are in "Open questions" at the end.

## 1. The headline: the Red Pill is at the bottom of a labyrinth

"In this BitNode, the Daedalus faction has not yet found and monopolized the fabled Red Pill" [SRC:
`BitNode.tsx` BN15 description]. You don't buy it from Daedalus here. You get it from a **maze server at the
bottom of the darknet**, and in BN15 it's the **fifth** labyrinth [SRC: `DarkNet/effects/labyrinth.ts`
`getCurrentLabName`, `getLabAugReward`].

Labyrinths come one at a time. Which one exists depends on which lab augmentations you have **installed**
(`Player.augmentations`, not the queue):

| # | lab hostname | net depth | charisma | maze (w×h) | GUI-solvable? | reward (BN15) |
|---|---|---|---|---|---|---|
| 1 | `th3_l4byr1nth` | 7 | 300 | 20×14 | yes | The Broken Wings |
| 2 | `cru3l_l4byr1nth` | 12 | 600 | 30×20 | yes | The Boots |
| 3 | `m3rc1l3ss_l4byr1nth` | 19 | 1500 | 40×26 | **script only** | The Hammer |
| 4 | `ub3r_l4byr1nth` | 23 | 2500 | 60×40, random start/end | script only | The Staff |
| 5 | `et3rn4l_l4byr1nth` | 29 | **3000** | 60×40, random start/end | script only | **The Red Pill** |

[SRC: `labData`, `getCurrentLabName`'s BN15 branch]. After the Red Pill come Endless/Final/Bonus labs
(The Law, The Sword, then NeuroFlux), which are optional.

**Each lab costs an install.** Clearing a maze drops `the_great_work.cache` on the lab; opening it calls
`Player.queueAugmentation(reward)` [SRC: `cacheFiles.ts` `getLabReward`]. The next lab only appears once the
reward is *installed*. So: five labs means **five augmentation installs**, and the Red Pill install is the
fifth. Then `w0r1d_d43m0n` still has to be hacked (§5).

## 2. The net gets deeper as you go

`getNetDepth()` returns the **current lab's depth** [SRC]. Without SF15 and outside BN15 it falls back to
**5** [SRC: `getLabyrinthDetails`, "Lab not unlocked yet"]. That explains every crawl the rig ever did: it
was a 5-row net. In BN15 the net is **7 rows** at the start and grows to 12 → 19 → 23 → 29 as labs fall.

- The lab is wired only to servers in the **last row** (`depth === netDepth - 1`) [SRC:
  `NetworkGenerator.addServerToNetwork`]. For lab 1, that's depth 6, so a script must be running on a
  depth-6 node.
- Server difficulty is drawn uniformly from `[0, netDepth)` [SRC: `addRandomDarknetServers`], and the model
  pool is chosen by difficulty (§4). A deeper net brings harder puzzles.
- **`dnet-crawl.js` defaulted `maxDepth` to 4 hops**, which caps it at row 3. Raised to 12 hops for crawl,
  loot and scout on 2026-10-09.

## 3. How a labyrinth is walked [SRC: `labyrinth.ts`, `NetscriptFunctions/Darknet.ts`]

- **Moving is authenticating.** `ns.dnet.authenticate(lab, "north")` (also `n`/`up`, `e`/`east`/`right`,
  `s`/`south`/`down`, `w`/`west`/`left`; first direction word wins) moves you **2 cells**. A wall returns
  401 "You cannot go that way". A legal move returns 401 "You have moved to x,y" with the 3×3 surroundings
  as `data`. **Here the feedback comes back in the auth reply**, unlike the heartbleed channel on other models.
  Reaching the end returns 200 and admin rights.
- Typing the lab's real password is refused, so there's no shortcut. Charisma below the lab's gate returns
  `NotEnoughCharisma` on every move.
- **Position is per-PID** (`DarknetState.labLocations[pid]`). If the walker script dies, it starts over.
  The maze itself survives until an install, but it is **not saved**: reloading the game regenerates it
  [SRC: `SaveLoad.ts` stores only `storedCycles`/`hasUsedHeartbleed`]. So a learned map is good for one
  play session.
- **`labreport()`** returns `{coords, north, east, south, west}` (open/closed). **`labradar()`** returns a
  7×7 text picture around you (`@` you, `X` the exit if it's in range). Both need the script to be on a node
  directly connected to the lab, and both cost one auth-time delay.
- **Each step costs auth time**: `850 × (5·chaReq + 1100)/(cha + 150) × 1/(1 + 0.2·(threads−1))`, also
  ×0.8 with The Boots [SRC: `calculateAuthenticationTime`, lab difficulty 10]. Lab 1 at cha 300 is ~4.9 s
  per step with one thread, and **threads help**: 20 threads cuts that by ~4.8×. The walker wants as
  many threads as the depth-6 host can give it.
- The maze is four stitched recursive-backtracker mazes with four gaps [SRC: `generateMaze`]. It's a
  near-perfect maze, so wall-following works, but DFS with a remembered map wastes fewer steps.

## 4. Puzzle models: what the deeper net brings [SRC: `ServerGenerator.ts`]

BN15 (or SF15) adds two models to tier 3: **`KingOfTheHill`** ("Ascend the highest mountain!") and
**`RateMyPix.Auth`** (hint `!!🌶️!!`). Tiers by difficulty:

| difficulty | pool |
|---|---|
| ≤2 | ZeroLogon, DeskMemo, FreshInstall, CloudBlare |
| 3–4 | the above + tier 2 + tier 3 |
| 5–8 | tier 1 + 2 + 3 |
| 9–18 | tier 2 + 3 + **tier 4** |
| 19+ | tier 3 + 4 |

- tier 2: Laika4, NIL, Pr0verFl0
- tier 3: PHP 5.4, DeepGreen, BellaCuore, **AccountsManager_4.2**, OctantVoxel, Factori-Os,
  OpenWebAccessPoint, **KingOfTheHill**, **RateMyPix.Auth**
- tier 4: **PrimeTime 2, TopPass, EuroZone Free, 2G_cellular** (timing attack), **110100100** (binary),
  **MathML** (arithmetic), **OrdoXenos** (XOR-masked), **BigMo%od** (triple modulo)

Lab 1's net (depth 7, difficulty 0–6) stays in tiers 0–3. Bold names are models the rig has never met.
Tier 4 first shows up once lab 2 makes the net 12 deep. Model-hunting gets busy from there.

## 5. The node's multipliers [SRC: `BitNode.tsx` case 15]

| lever | mult | so what |
|---|---|---|
| **CharismaLevelMultiplier** | **1.1** | the one boost, and charisma is what the labs gate on |
| HackingLevelMultiplier · HackingSpeedMultiplier | 0.6 · 0.6 | |
| Str/Def/Dex/Agi LevelMultiplier | 0.7 each | |
| ServerMaxMoney · ServerStartingMoney · ServerStartingSecurity | 0.8 · 0.5 · 1.5 | the light net is mildly worse |
| **AugmentationMoneyCost** | **3** | augs cost 3× |
| CorporationValuation · Softcap · Divisions | 0.2 · 0.4 · 0.4 | |
| BladeburnerRank · SkillCost | 0.2 · 3 | |
| GangUniqueAugs | 0.3 | |
| StaneksGift Power · ExtraSize | 0.7 · −2 | |
| DaedalusAugsRequirement | 20 | |
| **WorldDaemonDifficulty** | **2** | `w0r1d_d43m0n` needs hacking **6000** (3000 × 2) [SRC: `ServerHelpers.ts`] |
| DarknetMoneyMultiplier | *absent → 1.0* | the darknet pays full price |

## 6. The lab augmentations [SRC: `Augmentations.ts`]

All are `isSpecial`, cost $1m / 10k rep nominally, and each needs the one before it. **Three of them raise the
stasis-link limit by one** (Wings, Hammer, Staff), on a base of 1 [SRC: `getStasisLinkLimit`].

| aug | charisma | other |
|---|---|---|
| The Broken Wings | ×1.05 | agi ×1.1, dnet money ×1.3, +1 stasis link |
| The Boots | ×1.06 | dex ×1.06, **auth + heartbleed 20% faster** |
| The Hammer | ×1.07 | str ×1.1, dnet money ×1.1, +1 stasis link |
| The Staff | cha **exp** ×1.1 | def ×1.1, dnet money ×1.1, +1 stasis link |
| The Law | ×1.09 | company rep ×1.05, dnet money ×1.15 |
| The Sword | ×1.1 | hacking ×1.1, company rep ×1.1, dnet money ×1.1 |

## 7. What SF15 gives later [SRC: BN15 source-file text]

1. Start every node with TOR + DarkscapeNavigator, and **full darknet** (labs and the two new models)
   everywhere.
2. Charisma boosts job salary and rep. Auth is 20% faster.
3. Charisma boosts faction rep. `.cache` xp and money ×1.5.
   *(The code tests `activeSourceFileLvl(15) > 2` for the 20% auth speed, i.e. level 3, not 2 as the text
   says [SRC: `calculateAuthenticationTime`]. Unconfirmed in game.)*

## 8. The shape of the run (draft)

1. **Charisma is the long pole.** The gates are 300 → 600 → 1500 → 2500 → **3000**. Sources: darknet auth
   attempts (the crawler already self-grinds), `phishingAttack`, Leadership at a university, and the
   charisma augs. CharismaLevelMultiplier 1.1 helps.
2. **Hacking 6000** for the World Daemon at HackingLevelMultiplier 0.6 is the other long pole. Run the light
   net rig the whole time.
3. Per lab: crawl to the last row → a walker solves the maze → open `the_great_work.cache` → **install**.
   Each install also resets the darknet (`prestigeDarknetState`), so the crawl starts over every time.
4. The first two labs can be walked by hand in the GUI, so they're good for learning the maze before it's
   automated.

## Open questions

- [LIVE 2026-10-09] `ns.dnet` surface in BN15 is the same 22 methods as before; `freezeServer` is still
  absent. `labradar`/`labreport` were always present, they just had no lab to point at.
- [OPEN] Does the lab show up in `probe()` from a depth-6 node, and what does `getServerDetails` say about it?
- [OPEN] How much RAM do depth-6 nodes have, and how many walker threads fit?
- [OPEN] Hint formats for KingOfTheHill, RateMyPix.Auth and AccountsManager_4.2. Read `ServerGenerator.ts`
  and `DarknetServerOptions.ts` before meeting them, or learn them from FAILED traces.
- [LIVE 2026-10-09] The DB entered BN15 carrying 7,322 passwords from earlier nodes, all dead (the net is
  rebuilt on install and on node entry). `prune` keeps every password and every server with one, so it
  couldn't shrink the DB. Added `dnet-reset.js`: run it after **every** install, which in BN15 means after
  every lab.
- [SRC, corrects darknet-design.md] **503 is "server offline", not rate-limiting.** In v3.0.1 the only
  source of `ServiceUnavailable` is `checkDarknetServer` finding no such server. There is no guess
  throttle anywhere. The July "throttle" and "password reroll" readings were nodes going offline and
  coming back with new passwords. 408 (Request Timeout) is real and comes from darknet instability.
- [LIVE 2026-10-09] Both BN15 models seen on the shallow rows: `RateMyPix.Auth` (Los7_Iza1i7h) and
  `KingOfTheHill` (dark::phantom). The rig has no strategy for either yet.
  - **RateMyPix.Auth** [SRC: `authentication.ts`]: numeric (letters only past difficulty 8), length
    `3 + difficulty/3`. A wrong guess returns `data` = one 🌶️ per correct digit-in-place, then
    `/length` (`"0/5"` when none match). Bulls-only Mastermind: it gives the count, not which positions.
  - **KingOfTheHill** [SRC]: numeric, length `min(1 + difficulty/6, 10)`, so 1 to 2 digits on lab-1 rows.
    `data` = altitude, `10000·exp(-((guess−pw)/w)²)` with `w = 10^max(len−2,0) + 1`. Below difficulty
    8 there's ONE hill centred on the password, so one guess gives the distance and a second picks the
    side. From difficulty 8 up, side hills are added (up to 9). Within 3% of the password only the main
    hill counts.
- [SRC → built 2026-10-09] **Solvers for both BN15 models** live in `dnet-strategies.js` (pure, zero RAM),
  wired into `dnet-solve.js` for `RateMyPix.Auth` and `KingOfTheHill` (no static phase, exact-match
  heartbleed). Specced end to end against a simulated server built from the game's own formulas
  (including the WHRNG decoy hills): RateMyPix avg ~10–13 guesses (worst 16, len 1–6). KingOfTheHill
  fits the hill it lands on from two guesses (every hill is the same bell curve, so the centre has a
  closed form), then hops k decoys both ways: ~3 guesses below difficulty 8 (always cracks), ~10–18
  with decoys, ≥99% through difficulty 28 (lab 5's ceiling) in 1000-per-tier stress runs.
  - [LIVE 2026-10-09] RateMyPix counting phase confirmed (`🌶️/5`, `0/5` read correctly on rogue;tech).
    Then one guess's log entry vanished before we read it, almost certainly another reader on the same
    node. `ask` now re-sends a guess once when its entry is missing.
  - [LIVE 2026-10-09] **First RateMyPix.Auth crack**: `hyper%s3c70r-12_ci7y_hall` → `81345` in 14 tries
    (spec predicted ~12 avg, 15 worst for length 5).
  - [LIVE 2026-10-09] **First KingOfTheHill crack**: `nogard` → `6` in 2 tries (1 digit, one hill).
- [SRC + audit] **The crawler was paying 10 GB for nothing.** `dnet-solve.js` called its guess helper
  `attempt`, billed as `ns.codingcontract.attempt`. Honest crawler cost ≈ 5.25 GB; 5.25 + 10 = the
  15.3 GB the game reported. Renamed to `guessOnce`. The crawler should now fit ~5.3 GB nodes. [OPEN:
  confirm with `mem dnet-crawl.js`.]
- [SRC] **Heartbleed is a charisma engine.** Each call pays `50 × (500 + cha)/500` cha XP (×cha_exp
  mults), against `3 + 1.1^difficulty` for a wrong guess. It takes 1.5× auth time, which threads shrink
  (`1/(1 + 0.2·(threads−1))`) and the XP doesn't scale with threads, so many small scripts on many nodes
  beat one big one. Needs `cha ≥ target's requiredCharismaSkill`; pick a difficulty-0, cha-0 neighbor.
- [SRC → built 2026-10-09] **`dnet-bleed.js` + `dnet-bleeder.js`, the charisma grinder.** Many 1-thread
  workers on home heartbleed `darkweb` (difficulty 0, cha 0, depth −1 so no underleveled penalty,
  stationary, directly connected to home). A server also counts as connected to *itself*
  (`isDirectConnected`), so a darknet node could bleed itself if home RAM runs out. Estimate at
  cha 54: ~88 XP/s per worker, so cha 300 (~2.6M XP at ×1.1) is ~50 min with 10 workers or ~16 with 30,
  faster as charisma rises. [OPEN: measure live.]
- [LIVE 2026-10-09 → fixed] **`heartbleed` defaults to ONE line, and consumes it** (`logsToCapture: 1`,
  `peek: false` [SRC: `heartbleedOptions`]). The server's own traffic lines share the log, so one arriving
  between a guess and its bleed hid the guess's entry: `FAILED zer0_day::c0rp (KingOfTheHill) … no
  feedback`, `bleedAfter "55": null`. `bleedData` now reads 20 lines with `peek: true` and takes the
  FIRST match (logs are newest-first; the old loop kept the last, i.e. oldest). This was also quietly
  costing the July NIL/DeepGreen solves.
- [LIVE 2026-10-09] **Charisma 54 → 219 in roughly an hour** with `dnet-bleed.js` running alongside the
  crawlers. The map then showed the deepest cracked row stuck at 3: the crawler's 4-hop default caps it
  at row ≤ 3 (a hop moves at most one row). Raised crawl/loot/scout defaults to 12 hops.
- [LIVE 2026-10-09] **Lab 1 found**: `th3_l4byr1nth` next to a crawler's server at cha ~219. `getServerDetails`
  says model `(The Labyrinth)`, cha 300, difficulty 10, `depth` −1, stationary, password length 36 ASCII.
  A guess below the gate returns 401 "You stumble in the dark. You need more moxie…" (the internal 451
  `NotEnoughCharisma` is flattened to 401 by `authenticate`; detect it by message).
- [SRC → built 2026-10-09] **Maze walker**: `walkLabyrinth` (pure DFS with a remembered map, in
  `dnet-strategies.js`) + `dnet-lab.js` (in-game, launched by the crawler once cha ≥ gate) +
  `dnet-lab-open.js` (opens the prize on the lab). Specced on a transcription of the game's maze
  generator, 100 mazes per size: lab 1 avg 27 moves (worst 76), lab 2 62 (176), lab 3 108 (332),
  labs 4–5 264 (761). Not yet run live.
- [LIVE 2026-10-09] **Row 6 is sparse and briefly linked.** Over 10 min the map showed rows 3–5 with 2
  servers each and row 6 empty, then a single row-6 server (`zero_day^PineappleCorp`, RateMyPix.Auth, cha
  198) seen but uncracked. Mutations come every ~4 s here (not 12). [SRC] A server's row is its difficulty
  ±3, the generator pads rows 0–3, and vertical links thin with depth, so the last row is often empty or cut
  off. One RateMyPix solve there is ~12 guesses × ~7.5 s (auth + 1.5× bleed at cha ~320) ≈ 90 s of the
  server staying linked.
- [built 2026-10-09] **Frontier watch** in `dnet-crawl.js`: a crawler on row ≥ 3 that sent no child deeper
  than itself stays 3 min, re-probing every 4 s and visiting any new neighbor (crack / spawn / lab
  walker). A neighbor it failed on gets retried only after it leaves and comes back. Mock-tested; not
  yet live.
- [LIVE 2026-10-09] **Lab 1 SOLVED** by the walker: 30 moves in 1:46 (spec avg 27). The cache gave
  "The W1ngs of Icarus" — the in-game display name of `AugmentationName.TheBrokenWings`. A second walker
  (another crawler on a different row-6 server) "solved" it in 20 moves once the lab had admin rights (any
  move then returns 200) and found the cache already opened: harmless duplicate work.
- [SRC → built 2026-10-10] **Stasis anchors.** `setStasisLink` self-targets, takes a flat ~20–30 s
  (`1000/(cha+1000) × 30 s`), and sets `backdoorInstalled`, so home can exec onto the server at any
  distance (after `connectToSession`, which never checks distance). Links ≤ 2 cost nothing: the auth
  debuff is `1.07^(backdoors − max(admin/24, 2))`. Built: the crawler beside a lab runs `dnet-pin.js` if a
  link is free and the lab has no anchor; `dnet-lab-arm.js` sends the walker to an anchor from home;
  `dnet-reset.js` clears anchors. Mock-tested; not yet live. Limit is 1 base +1 each for Wings, Hammer
  and Staff, so after the Wings install there's a spare link.
