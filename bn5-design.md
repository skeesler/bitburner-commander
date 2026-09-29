# bn5-design.md — the *why* for **BitNode 5 "Artificial Intelligence"** and the intelligence stat

**Context: Sara entered BN5 on 2026-09-07, holding SF1.3 / SF2.3 / SF3.3 / SF4.3 / SF9.1, plus
SF-1 level 3 (three exploits). Plan: clear BN5 three times (5.1 → 5.3), verify the corporation rig
works outside BN3 along the way, then return for BN9.2.**

Tags: **[SRC]** read from the **v3.0.1 release tag** (local clone of commit `3162fd2`, verified);
**[LIVE]** confirmed in the running game; **[OPEN]** nobody has checked. The `int-api.js` probe ran
2026-09-07 and promoted the big tables — see "Field findings" at the bottom. The delta labs are
still pending, so the XP-rate claims stay [SRC].

---

## What BN5 actually does to you [SRC: `BitNode.tsx` case 5 — quoted complete, 17 keys] **[LIVE
2026-09-07: `getBitNodeMultipliers()` matched all 17 in-game]**

| Multiplier | BN5 | Consequence |
|---|---|---|
| `ScriptHackMoney` | **0.15** | Hacking pays 15%. After BN9's 0.1%, this is luxury — the commander is a real income stream again. |
| `HackExpGain` | **0.5** | Levelling at half speed. XP farm stays useful. |
| `ServerStartingMoney` / `ServerStartingSecurity` | 0.5 / 2 | Prep is slower at the start; watch the reactive→batch promotion. |
| `CloudServerSoftcap` | 1.2 | Cloud servers exist at normal limit/cost; big RAM sizes cost somewhat extra (BN3 had 1.3). `purchase-servers.js` works. |
| `CrimeMoney` | 0.5 | Crime pays half — fine, we farm crime for *int*, not money. |
| `HacknetNodeMoney` | 0.2 | Hacknet at a fifth. SF9.1's +12% doesn't rescue it. Not the plan here. |
| `AugmentationMoneyCost` | **2** | **Augs cost double.** The NFG int-farm loop (below) is priced against this. Rep costs are normal. |
| `InfiltrationMoney` / `InfiltrationRep` | **1.5** | The one *boosted* income. Infiltration is manual-only, but if Sara ever feels like a minigame session, this node is where it pays. |
| `CorporationValuation` / `CorporationDivisions` | 0.75 / 0.75 | Mild. **No `CorporationSoftcap` penalty** (absent → 1.0, vs BN9's 0.75). The corp-verification plan is viable here. |
| `GangUniqueAugs` | 0.5 | Gang works; fewer unique augs from it. |
| `StaneksGiftPowerMultiplier` | 1.3 | Stanek is stronger here, if we ever adopt it. |
| `DarknetMoneyMultiplier` | **0.7** | **The darknet's best value in any node** (BN9 was 0.05). The `dnet-*` rig is back on duty. |
| `WorldDaemonDifficulty` | 1.5 | The exit is a bit harder. |
| `StaneksGiftExtraSize` | 0 | Same as default; explicitly present in the object. |

**Everything else is ABSENT → 1.0** [SRC: `BitNodeMultipliers.ts` defaults — every field 1 except
`DaedalusAugsRequirement` 30, also absent here]. The standouts among the absences:
`CloudServerLimit`/`CloudServerCost` (buy servers freely), `CodingContractMoney` (contracts pay
full price — `contract-finder.js` earns real money again), `HackingLevelMultiplier` and
`HackingSpeedMultiplier` (untouched, unlike BN9), `FourSigma*` (the 4S ladder at normal price —
remember it's once per BitNode, so buy it once and it survives installs).

Two v2 facts that are simply gone in v3 [SRC]: BitNode difficulty ratings no longer exist
(the `BitNode` constructor has no difficulty field), and **`getServer` is NOT gated on SF5** —
full server data for everyone. Any guide talking about either is pre-v3.

## What you get just for standing here [SRC]

`canAccessBitNodeFeature(5)` = *in BN5 or holding SF5* [SRC: `BitNodeUtils.ts`]. From day one of
this run, without SF5:

- **`Formulas.exe` free at every prestige** [SRC: `Prestige.ts:93` and `:277`] — already on home,
  and re-granted after every install. The commander batches exactly from the first cycle, free.
- **`ns.getBitNodeMultipliers(n?, lvl?)` works** (4 GB) — and the v3 signature takes *any*
  BitNode and SF level, not just the current one [SRC: `NetscriptFunctions.ts:914`]. A planning
  script can price the next node before entering it. This alone retires half the "fetch the
  multiplier table from the source" research chore — once we trust it [OPEN: confirm live].
- **Intelligence gains XP** — see below.
- The Stats page shows the BitNode multiplier panel and effective-vs-base multipliers.

## Source-File 5, per level [SRC: `applySourceFile.ts` case 5]

`mult += 8 / 2^i` per level → **+8% / +12% / +14%** (cumulative) to six hacking multipliers:
`hacking`, `hacking_chance`, `hacking_speed`, `hacking_money`, `hacking_grow`, `hacking_exp`.
That is the *only* thing that scales with level — intelligence, Formulas.exe,
`getBitNodeMultipliers` and the UI panels all arrive at level 1 and don't improve. So 5.1 is the
prize; 5.2/5.3 are +4% and +2% hacking QoL (and Sara wants them anyway for the corp-verification
runs).

**+300 int XP per BitNode destruction** [SRC: `Prestige.ts:363`]: requires `activeSourceFileLvl(5)
!== 0` and not-flume. `giveSourceFile(destroyedBitNode)` runs *before* `prestigeSourceFile` in
`enterBitNode` [SRC: `RedPill.tsx:62-78`], so **the first BN5 exit already pays the 300**. (Edge:
the check uses `activeSourceFileLvl`, and the *next* run's options are applied first — a run
started with SF5 overridden off would skip the grant. Don't do that.)

---

## Intelligence: the mechanics

### The gate [SRC: `Person.ts:185`]

```ts
if (Player.sourceFileLvl(5) > 0 || Player.bitNodeN === 5) {
  this.exp.intelligence += exp;
  this.skills.intelligence = Math.floor(this.calculateSkill(this.exp.intelligence, 1));
  this.persistentIntelligenceData.exp += exp;
}
```

Deliberately `sourceFileLvl`, not `activeSourceFileLvl` — the source comments that once you own
SF5, gaining int is a permanent benefit even in an override run. **No multiplier ever touches int
XP**: `multWorkStats` passes `intExp` through untouched, there is no `intelligence_exp` player
mult, no aug grants one, no BitNode key scales it. What the tables below say is what you get.

### The bonus formula [SRC: `formulas/intelligence.ts` — the whole file]

```ts
calculateIntelligenceBonus(intelligence, weight = 1) = 1 + (weight * intelligence^0.8) / 600
```

At int 50: +2.3%·w. Int 100: +6.6%·w. Int 200: +11.6%·w. Int 300: +16.0%·w. Int 975: +41.2%·w.
Sub-linear (^0.8) and divided by 600 — int is a slow-burn compounding asset, not a lever.

### Everything intelligence boosts [SRC — exhaustive call-site sweep]

| Mechanic | Weight | Notes |
|---|---|---|
| Hack success chance | 1 | `Hacking.ts:22` |
| Hack/grow/weaken **time** | 1 | faster — `Hacking.ts:77` |
| Faction rep (hack/field/security work) | 1 | int/3 (hack) or int (field/sec) also enters the stat sum |
| Program creation speed | **3** | the biggest weight in the game, then dampened `1+(m-1)/5` |
| `share()` power | **2** | int makes share-manager.js better |
| Crime success chance | 1 | plus additive `0.025·int/975` |
| Grafting speed | 1 | |
| Bladeburner action success | 0.75 | plus per-action int weights 0.04–0.1 |
| Sleeve shock recovery / sync | 0.75 / 0.5 | |
| Company rep | — | additive `int/975` rep/s, not through the formula |
| Infiltration difficulty | — | reduced by `int/1600` |
| **Darknet auth time** | 0.25 | **MULTIPLIES the time** [SRC: `DarkNet/effects/effects.ts:89`] — int makes cracking *slower*. Bug or balance, the code is unambiguous. [OPEN: still true in-game?] |

ABSENT: augmentation prices, company salary, hacking money per se, anything in corp/gang/stocks.

### The curve [SRC: `formulas/skill.ts` — always mult = 1 for int]

`level = floor(32·ln(exp + 534.6) − 200)`, clamped below at 1, **no upper clamp — int is uncapped
in v3** (`MaxSkillLevel` 975 is only a normalizing divisor in other formulas). Milestones:

| Level | 10 | 25 | 50 | 75 | 100 | 150 | 200 | 250 | 300 |
|---|---|---|---|---|---|---|---|---|---|
| XP | 173 | 597 | 1.9k | 4.9k | 11.3k | 55.7k | 268k | 1.28M | 6.11M |

Each +32 levels costs e ≈ 2.72× more XP. Getting to ~100 is a project; past ~200 is a lifestyle.

### Persistence [SRC]

v3 keeps a dedicated `persistentIntelligenceData.exp` fed in parallel by every gain, and
`overrideIntelligence()` restores from it on every prestige — installs, soft resets, BitNode
destruction, everything. `prestigeAugmentation` resets every other exp and deliberately skips
intelligence. It only zeroes if you hold no SF5 *and* aren't in BN5. Sleeves have their own
persistent store and keep their int across prestiges too [SRC: `Sleeve.ts:255`].

---

## Every source of int XP, and what a script can do with it

Constants [SRC: `Constants.ts:50-54`]: crime weight 0.025, crime base 0.05, program base 0.1,
graft base 0.05, singularity base 1.5.

| Source | XP | Rate |
|---|---|---|
| **BitNode destruction** | flat **300** (needs SF5 active, not flume) | per node |
| `singularity.purchaseAugmentation` | **15** per success | per purchase — NFG stacks! |
| `singularity.installAugmentations` | **15** | per install |
| `singularity.joinFaction` | 7.5 | per faction |
| `singularity.upgradeHomeRam` / `Cores` | 3 | per upgrade |
| University class (any, incl. free CS) | 0.01/s × location expMult | ZB Institute ×4 = **0.04/s** [SRC: `LocationsMetadata.ts` — Rothman ×2, Summit ×3, ZB ×4]; also × hash "Improve Studying" |
| Program creation | 0.1 per second worked, **paid only on completion** | any program |
| Crimes (success only, player) | crime's `intelligence_exp` × 0.05 | best ≈ 0.011/s: Kidnap, Assassination, Heist. Shoplift/mug/homicide: **zero** |
| Grafting | 0.005/s, on completion | plus the aug |
| Bladeburner actions | ~0.003·time·difficulty^0.28·weight | trickle; Field Analysis flat 0.003 |
| Terminal `hack` (manual, UI) | `4·log10(hackExp)` ≈ 2–7 | not scriptable; `singularity.manualHack` pays a flat **0.005** instead |
| `travelToCity`/`goToLocation` | 0.00003 | spam-proof by design |
| Backdoors, contracts, darknet, faction/company work, gang, stocks, hacknet | **ZERO** [SRC] | v2 intuition about backdoor int is dead |

### The sleeve mirror — the automation centerpiece [SRC: `Sleeve/Work/Work.ts:17-25`]

```ts
applyWorkStatsExp(sleeve, shockedStats, mult);
const sync = sleeve.syncBonus();               // sync / 100
applyWorkStatsExp(Player, shockedStats, mult * sync);
Player.sleeves.forEach((s) => s !== sleeve && applyWorkStatsExp(s, shockedStats, mult * sync * s.shockBonus()));
```

**Every sleeve's int XP is mirrored to the player at ×(sync/100)** — and to every other sleeve.
Eight sleeves in a ZB Institute classroom each feed the player 0.04/s at full sync. Sleeve crimes
even pay int on *failure* (×0.25), unlike the player's own. The `sleeve-manager.js` rework below
falls straight out of this.

### Ranked: automatable int XP/hour

1. **Aug-purchase loop** — 15 XP per NFG level plus 15 per install plus 7.5 per faction join.
   Bursty and bounded by money/rep, not time; in a mature run it dwarfs everything else. Already
   automated: `ascend.js` IS this loop — every flywheel cycle is now also an int farm. Note
   `AugmentationMoneyCost` 2 prices NFG dumps at double here. [SRC amounts; rate OPEN]
2. **Sleeve university farm** — player + 8 sleeves at ZB ≈ 0.36/s ≈ **1,300 XP/hr** at full
   sync/no shock [SRC rates; sync assumption OPEN]. Fully AFK. **Unavailable this run: Sara holds
   no SF10 (the BN10 attempt stalled), so sleeves don't exist here.** The math and
   `int-sleeve-delta.js` stay on the shelf for the day they do.
3. **Program creation — CONFIRMED and scripted: `int-farm.js`.** 0.1/s = 360 XP/hr, flat [SRC],
   paid on completion for the wall-clock seconds worked; the rm-and-recreate loop on
   `b1t_flum3.exe` works [LIVE 2026-09-08], making the channel infinite. The focus penalty applies
   to creation *speed* [SRC: `CreateProgramWork.process`, `skillMult *= focusBonus`] but int pays
   per second worked — so unfocused creation takes longer and pays MORE per program at the same
   hourly rate: farm it in the background and keep your screen. **This is the steady-state engine
   of the run.** Cost: it owns the player action (no faction/company work while it runs).
4. **Player university** — 0.04/s at ZB ≈ **144 XP/hr**, but it occupies *you* (blocks faction
   work etc.). The idle-time filler, not the plan.
5. **Player crime** — ≈ 39 XP/hr at best; only worth it while grinding karma for the gang anyway.
6. Everything else is a rounding error or a side effect. Don't script `goToLocation` spam
   (0.1 XP per 3,333 calls); don't script `manualHack` for int (0.005/success).

---

## The shape of the run (proposal — decisions to lock with Sara)

1. **Money**: commander + contracts from minute one (hacking pays 15% and cloud servers are
   normal — after BN9 this feels rich). Gang when karma allows (crime phase doubles as int farm).
   Darknet rig back on at 70% once `DarkscapeNavigator.exe` is bought.
2. **Int** (no sleeves this run — no SF10): `ascend.js` flywheel as usual (its NFG dumping is the
   top int burst); settle the program-recreation [OPEN] and loop it if real; university as the
   idle-time filler. `share-manager.js` quietly benefits (weight 2).
3. **Corp verification** (the actual point of 5.2/5.3): founding outside BN3 costs **$150b of your
   own money** (`UseSeedMoneyOutsideBN3` [SRC, from the BN9 research]). SF3.3 grants the Warehouse
   + Office APIs free at creation (`activeSourceFileLvl(3) === 3` [SRC: corp-design gotcha 4]) —
   so the whole `corp-*` rig runs, minus BN3's free seed. `CorporationValuation`/`Divisions` 0.75
   is a haircut, not a wall. The corp-state ghost bug (corp-design gotcha 10) is already fixed.
   **Live so far (2026-09-12): round 1 stood up end-to-end and paid, and the run banked three
   findings** — the trim-gate deadlock (gotcha 11, fixed), a stale in-game `corp-boost.js` driving
   a \$30b overbuy (gotcha 12 — reconnect the Remote API before launching resident scripts), and
   the round-1-offer-can't-fund-round-2 squeeze under the 0.75 valuation (gotcha 13, plan an
   earning plateau between rounds).
4. **Exit**: `WorldDaemonDifficulty` 1.5. Each destruction: +300 int **XP** (not levels — ≈ +1
   level at a 4–5k exp total, under an hour of the farm, and it lands *silently* on ENTERING the
   next node, so don't expect to see it; details and the guard at the [SRC] note above). Plus
   +8/4/2% hacking mults per SF5 level.

## Scripting notes

- **RAM**: at SF4.3 every `ns.singularity.*` costs its base price (×1). The int-relevant set:
  `commitCrime`/`createProgram`/`purchaseAugmentation`/`installAugmentations`/`goToLocation` 5 GB,
  `workForFaction`/`joinFaction`/`upgradeHome*` 3 GB, `universityCourse`/`manualHack`/`travelToCity`
  2 GB, all `ns.sleeve.*` 4 GB, all `ns.formulas.*` 0 GB. **Measure with `ram-costs.js` anyway** —
  the bare-name trap does not care what a table says.
- **Reading int from a script**: `ns.getPlayer().skills.intelligence` and `.exp.intelligence`
  (0.5 GB total). There is **no** `formulas` function for the int bonus — replicate
  `1 + w·int^0.8/600` locally. `ns.formulas.work.universityGains`/`crimeGains` return `intExp`
  fields for planning, and `ns.formulas.skills.calculateSkill(exp, 1)` maps exp → level.
- **The probe lab exists — three scripts, split so each fits a 32 GB home** (the corp-rig RAM
  lesson applied): **`int-api.js`** (~7.4 GB, read-only: context, curve check, both
  `getBitNodeMultipliers` diffs, surface sweep, the enum strings, and a free RAM price list for
  the labs), **`int-delta.js`** (~12 GB: player actions behind `--go` — travel, class, crime —
  each measured before/after with the solved factor printed), **`int-sleeve-delta.js`** (~10 GB:
  the sleeve-mirror test; deliberately leaves the sleeve studying if the mirror is real). Run
  order: api first (it validates the strings the labs hardcode), then the labs one at a time —
  their deltas are only attributable when nothing else grants int in the window.

## Open questions

| # | Question | Answered by |
|---|---|---|
| 1 | Do the flat singularity grants match live? | **ANSWERED [LIVE 2026-09-08], all five tiers**: `--travel --go` returned +0.00006 to float epsilon; the baseline exp of 7.5042 is exactly joinFaction 7.5 + purchaseTor 0.003 + 4× purchaseProgram 0.0003; and `ascend.js` buying 3 augs (confirmed by Sara) moved exp by +45.000 exactly = 3 × 15 per purchaseAugmentation |
| 2 | Does `rm Program.exe` + `createProgram` re-grant the 0.1/s? | **ANSWERED [LIVE 2026-09-08]: YES.** After a false start (darkweb `buy` grants no int — buying isn't creating, so DeepscanV1 buy/rebuy showing nothing was the expected null), Sara rm'd and re-created `b1t_flum3.exe` (create.level 1, base 15s, junk as a file — only *running* it flumes) and int moved. **The infinite ~360 XP/hr loop is real and is now scripted: `int-farm.js`.** Its live XP/hr line is the remaining calibration — paste one back |
| 3 | Sleeve mirror: does player exp move at ×sync/100 live? | **ANSWERED [LIVE 2026-09-23]: YES.** `int-sleeve-delta.js --go`, sleeve #0 in CS for 60s at sync 100: sleeve +12.48, player +12.48, ratio 1.000 = sync/100 exactly. **But the rate came in ~10.4× the model** (expected ~1.2 = 0.01/s × Rothman ×2 × 60s, the same number the player earned in Q6). **Cause: sleeve bonus time** (stored offline cycles spent at an accelerated rate) — confirmed by Sara 2026-09-23. So the 10× is a temporary burst, not the farm rate; the steady rate should be the model's 0.01/s × expMult (unmeasured on a sleeve — a bonus-free re-run would pin it) |
| 4 | Darknet auth-time int debuff — really slower? | `formulas.dnet.getAuthenticateTime` confirmed present [LIVE]; time it at two int levels once the dnet rig is back up |
| 5 | `getBitNodeMultipliers(9)` from inside BN5 — matches the BN9 table? | **ANSWERED [LIVE 2026-09-07]: 17/17 BN5 keys and 20/20 BN9 keys match the tag.** Future nodes get priced with one 4 GB call |
| 6 | Does class int XP take the 0.8 unfocused penalty? expMult ×2/×3/×4 right? | **ANSWERED [LIVE 2026-09-08]**: 60s unfocused CS at Rothman gave +1.200 — solved factor exactly **×2.000**. expMult applies, and there is **no unfocused penalty on class int XP**. (ZB's ×4 still [SRC]-only, but the mechanism is proven) |
| 7 | Does the hash "Improve Studying" mult apply to the int component of classes? | [SRC says yes — `scaleWorkStats` hashMult]; confirm on the BN9.2 return trip |

## Field findings [LIVE — `int-api.js` probe, 2026-09-07]

- **`getBitNodeMultipliers` is trustworthy**: the live BN5 object matched all 17 [SRC] keys, and
  `getBitNodeMultipliers(9)` matched all 20 keys of hacknet-design.md's BN9 table — including the
  two famously-absent ones coming back 1.0. The "fetch the multiplier table from the source"
  research chore is retired while we hold BN5 access: one 4 GB call prices any node.
- **Travel grant confirmed to float epsilon** [LIVE 2026-09-08]: `int-delta.js --travel --go`
  measured +0.000059999999999504894 against an expected 0.00006 — a Sector-12 → Aevum round trip
  is exactly 2 × 1.5/50000, no multipliers touch it. First controlled experiment, exact match.
- **The 15-per-aug tier confirmed** [LIVE 2026-09-08]: between two lab runs, exp moved +45.000
  exactly while `ascend.js` bought three augmentations (Sara confirmed the count). 3 × 15, to the
  last decimal — the flywheel really is the top int burst.
- **Class int takes NO unfocused penalty** [LIVE 2026-09-08]: 60s of unfocused Computer Science at
  Rothman measured +1.200 int XP — solved factor **×2.000** flat, the location expMult and nothing
  else. The 0.8 focus penalty either skips int or skips classes entirely [OPEN which]; for farm
  math it doesn't matter — background study pays full rate. Player-at-ZB is a true 144 XP/hr.
  (Same window's hacking exp: +7,949 — 132/s, showing how mult-inflated the other stats are by
  comparison; int alone has no multipliers, which is what makes these deltas so cleanly readable.)
- **The rm-and-recreate loop is REAL** [LIVE 2026-09-08, Sara's experiment]: deleting
  `b1t_flum3.exe` and re-creating it granted int. Program creation is therefore an *unlimited*
  channel, not a finite list — `int-farm.js` loops it. The false start is worth recording too:
  buying a program grants no int — `buy` ≠ Create Program, and a null result from the wrong
  experiment looks exactly like a null result from the right one.
- **Farm calibration** [LIVE 2026-09-08]: `int-farm.js` on b1t_flum3 held a steady **304 XP/hr**
  (0.5s/cycle, +0.04 XP per creation). The 0.04 is exactly **2 game cycles × 0.02** — creation
  time quantizes to whole 200ms cycles and every worked cycle is paid — so the 15% gap to 360 was
  pure loop overhead (the 250ms completion poll, since cut to 50ms). Two structural notes: a
  longer program (`--program DeepscanV1.exe`, ~15–20s cycles) amortizes the overhead to ~nothing;
  and b1t_flum3's rate will *degrade* as hacking grows, because creation speed scales with
  hacking / create.level and its level is 1 — cycles shrink toward the poll floor. Watch the
  s/cycle readout and size the program up when it gets small.
- **The forensic baseline**: player int exp was **7.5042** with no farm ever run. That decomposes
  as `joinFaction` 7.5 + `purchaseTor` 0.003 + 4 × `purchaseProgram` 0.0003 — exactly one faction
  joined and TOR + four darkweb programs bought (by `ascend.js`) since entry. Three grant
  constants confirmed to four decimals without running an experiment. The 15-per-aug tier is
  still unobserved.
- **The curve is `calculateSkill(exp, 1)`** — formulas agreed with the displayed level.
- **The surface is all there**: 65 singularity methods including `stopAction` (1 GB) and
  `universityCourse` (2 GB); all 24 sleeve methods; `formulas.dnet` has `getAuthenticateTime` /
  `getHeartbleedTime` / `getExpectedRamBlockRemoved`. Every RAM quote matched the v2-era
  estimates — no v3 price changes in this set, and `int-api.js` weighed 7.3 GB against a 7.4
  prediction.
- **Enum strings confirmed** for the labs: cities ("Sector-12"), `UniversityClassType.computerScience`
  = "Computer Science", the three university `LocationName` keys as mapped.
- **`ownedSF` does NOT list SF-1** — exploits (1/2/3/4/9 showed; the three exploits didn't). SF-1
  is invisible to `getResetInfo`; the Stats/BitVerse UI is its only witness. Calibration scripts
  can't detect it programmatically [OPEN: any API that exposes it?].
- **Sleeve mirror CONFIRMED** [LIVE 2026-09-23]: player gain = sleeve gain × sync/100 to three
  decimals (Q3). The rate was ~10.4× the classroom model — sleeve bonus time (confirmed by Sara), a temporary burst.
  Note `sleeve-manager.js` has no university mode yet and will pull a studying sleeve back onto crime.
- **No sleeves** (at the time of the BN5 probe): Sara held no SF10 (a BN10 attempt stalled), so `int-sleeve-delta.js` and the
  1,300 XP/hr classroom farm are shelved this run. Program creation is the top steady-state
  candidate; question #2 is promoted accordingly.
- **Home is tight**: 121 of 128 GB in use at probe time. `int-delta.js` (~12.3 GB) needs room —
  pause the commander or raise `HOME_RESERVE_GB` before a lab run, and re-check with `free`/`mem`.

## Corrections, kept on the record

- The BN9 calibration's solved multiplier 1.28128 was read as "exactly SF1.3, nothing else in it."
  Actually 1.28 × **1.001** — SF-1 (Exploits) multiplies every positive player mult by
  `1.001^exploits` [SRC: `applyExploits.ts`], and one exploit was held at the time. Sara now holds
  **three** (N00dles, UndocumentedFunctionCall, Bypass): ×1.003003 on gains, ×0.997 on costs.
  Any hand calibration must include it; anything that solves from live data absorbs it silently —
  which is the argument for solving from live data, restated.
