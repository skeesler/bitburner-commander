# bn6-design.md — Bladeburner and BitNode 6 ("Like Tears in Rain"), the *why*

Same contract as `bn5-design.md` / `hacknet-design.md`: every claim is tagged **[SRC]** (read
from the `v3.0.1` tag, 2026-09-17), **[LIVE]** (confirmed in the running game), or **[OPEN]**.
The running game outranks everything here.

> **Position (2026-09-17): in BN6, division joined, API confirmed live.** Holding SF 1.3 / 2.3 /
> 3.3 / 4.3 / **5.3** / 9.1 — no SF6/7, no SF10 (so the sleeve Bladeburner enum is shelved this
> run). Combat 181 across the board, int 84, hacking 93 (kneecapped — see the node table).
>
> **Update (2026-09-20, three days of bb-conductor v1):** rank **44k**, SP spent to Overclock 63 /
> Intuition 42 / Observer 43, stamina 739 pegged at 100%, HP 85, charisma **611**, dex 1058.
> Every action estimates 92–100%. **v1 never attempted a black op** — see §5d for the bug.
>
> **BN6.1 COMPLETE (2026-09-21): Operation Daedalus succeeded, SF6.1 banked.** bb-conductor v2
> climbed the entire ladder teamless with zero failures, one day after the gate fix. Daedalus
> announced at est 76–100%; the real chance was the HIGH endpoint (collapsed to 100% under
> Field Analysis) — the §4 endpoint mechanics confirmed live one last time. Still-open on the
> way out (§7): failed-black-op retry (never observed a failure), passive regen units, Incite
> Violence's count grant, the difficulty level-curve exponent.

## 1. The two headline discoveries [LIVE 2026-09-17, bladeburner-api.js]

- **BN6 alone unlocks the full `ns.bladeburner` API.** The gate is
  `canAccessBitNodeFeature(7) || canAccessBitNodeFeature(6)` [SRC: NetscriptFunctions/
  Bladeburner.ts] — the v2-era "BN7/SF7 only" folklore is dead. Confirmed live with 0 GB calls
  and no SF6/7 owned. Second gate: every function except `inBladeburner` and
  `joinBladeburnerDivision` also throws until you've **joined the division** (all four combat
  stats ≥ 100 [SRC]).
- **`ns.formulas.bladeburner` exists** [LIVE — new in v3; v2 had nothing], and holds exactly
  ONE method: `skillMaxUpgradeCount(name, level, skillPoints)` [LIVE 2026-09-17, scan §1 —
  the markdown told the truth]. Skill-spend math for free; everything else costs 4 GB.

## 2. RAM prices [LIVE — all 41 names present, every price matches the tag]

The corp-rig wall, again: `BladeburnerApiBase = 4` [SRC: RamCostGenerator.ts].

| price | functions |
|---|---|
| **0 GB** | `inBladeburner`, `getBonusTime`, `nextUpdate`, and ALL name lists: `getContractNames`, `getOperationNames`, `getBlackOpNames`, `getGeneralActionNames`, `getSkillNames` |
| **1 GB** | `getCurrentAction` |
| **2 GB** | `getNextBlackOp`, `getBlackOpRank`, `stopBladeburnerAction` |
| **4 GB** | everything else — every state getter, every setter, `startAction`, `upgradeSkill`, … |

**Architecture consequence:** a monolithic manager naming ~16 state functions owes ~65 GB.
That verdict was written against a 32 GB home; **home is 512 GB as of 2026-09-17**, so a
monolithic conductor is fine here — the corp-style split stays the fallback for lean re-entries
(BN7 someday). `nextUpdate` at 0 GB is a gift either way: an event-driven conductor sleeps on
the game's own tick for free.

**API quirk [LIVE 2026-09-17]:** `getActionCurrentLevel` / `getActionMaxLevel` THROW on
General and Black-Operation actions ("Actions of type General are not levelable") — they don't
return a sentinel. Any generic per-action sweep must branch on type.

## 3. BN6 multipliers [LIVE — all 24 checked keys match the tag exactly]

| lever | mult | so what |
|---|---|---|
| HackingLevelMultiplier | **0.35** | levels crawl; hacking is a side hustle here |
| HackExpGain | **0.25** | ditto |
| ScriptHackMoney | **0.75** | but the commander still pays the bills |
| ServerMaxMoney | 0.2 | smaller pots |
| CrimeMoney | 0.75 · CompanyWorkMoney 0.5 · HacknetNodeMoney 0.2 | side income nerfed |
| CorporationValuation 0.2 · Softcap 0.9 · Divisions 0.8 | corp viable but slow — rig-proving, not carrying |
| GangSoftcap 0.7 · GangUniqueAugs 0.2 | gang weak this node |
| InfiltrationMoney | 0.75 | |
| DaedalusAugsRequirement | **35** | red pill the long way is expensive |
| StaneksGift 0.5 power, +2 size · WorldDaemonDifficulty 2 | |
| **BladeburnerRank, BladeburnerSkillCost: ABSENT = 1.0** | Bladeburner at face value — it is the point of the node |
| HomeComputerRamCost, DarknetMoneyMultiplier: ABSENT = 1.0 | home upgrades normal price; darknet pays full freight (!) |

## 4. Core mechanics [SRC unless tagged otherwise]

### Success chance — `min(1, competence / difficulty)` [SRC: Actions/Action.ts]

- **competence** = Σ over stats: `weight[stat] · effSkill(stat)^decay[stat]`, then
  × `calculateIntelligenceBonus(int, 0.75)` (the 0.75 weight bn5-design.md predicted), then
  × **stamina penalty**, then × **population factor** `(pop / 1e9)^0.7` (est-pop for the
  *displayed* chance, real pop for the roll — the gap between them IS your estimate error).
- **difficulty** = `baseDifficulty · difficultyFac^(level−1)` [OPEN: exponent form inferred;
  LevelableAction.ts not pulled], and when city **chaos > 50**: × `sqrt(1 + (chaos − 50))`.
- **Black ops ignore population AND chaos** (both factors hard-coded 1) [SRC:
  BlackOperation.ts] — only stats, stamina and skills matter for the ladder.
- `getActionEstimatedSuccessChance` returns a **[low, high] interval** built in `getSuccessRange`
  [SRC v3.0.1: Actions/Action.ts:144-167]: `diff = |real − est|` widens it, then the ratio
  `r = pop/popEst` scales one END (`low *= r` if r<1, `high *= r` if r>1) — **for every action
  type, black ops included**. Since a black op's est and real chances are identical (pop factor
  1 in both), its diff is 0 and **the real chance IS one endpoint of the displayed interval**:
  the high end if popEst reads high, the low end if it reads low. The 8-point interval Sara saw
  on Operation Typhoon was pure Sector-12 popEst noise, irrelevant to the actual roll.
- Field Analysis and successful stealth ops (Investigation +0.4%, Undercover +0.8% [SRC])
  shrink popEst error, scaled by Datamancer's Estimate mult. **FA effectiveness [SRC:
  Bladeburner.ts ~1124]: `0.04·hack^0.3 + 0.04·int^0.9 + 0.02·cha^0.3` percent per completion**
  (≈2.6%/completion at the 2026-09-20 stats, before Datamancer) — popEst converges on pop
  multiplicatively and clamps exactly at it, so a few 30s completions collapse an interval.

### Stamina — the 50% cliff [SRC: Bladeburner.ts]

- `penalty = min(1, stamina / (0.5 · maxStamina))` — **no bonus above half, linear collapse
  below.** The whole stamina game is "never dip under 50%".
- `maxStamina = (effAgi^0.8 + staminaBonus) · skillMult(Stamina) · bladeburner_max_stamina`.
  Training raises `staminaBonus` (+0.04 · Stamina mult **per completion** [SRC v3.0.1:
  Bladeburner.ts ~1100 — it's in the completion handler; SETTLED 2026-09-20]). Actions drain `0.285 · difficultyMult` per second [OPEN: exact
  difficultyMult form]; passive regen `StaminaGainPerSecond 0.0085` [OPEN: × maxStamina?].
  Hyperbolic Regeneration Chamber restores HP (+2) and stamina (+1) per tick.

### Action time [SRC: Action.ts]

`time = max(1, (difficulty / 10) / statFac) · timePenalty`, where statFac grows with effective
agi+dex (linear factors 10e3, exponents 0.04/0.035), timePenalty is 1.5 for black ops,
and Overclock cuts it (−1%/level, max 90). Recruitment uses charisma, base 300s [SRC:
Constants]. Bonus time (banked offline cycles, `getBonusTime` — 0 GB) makes the whole division
process up to **5× ticks** per second [SRC: `seconds = min(seconds, 5)`].

### Rank, skill points, faction, money [SRC]

- Rank gain = `rankGain · rewardFac^(level−1)` ±10% offset; failure loses `rankLoss` scaled the
  same. Field Analysis: flat +0.1 rank. **1 skill point per 3 rank.**
- **Rank 25 unlocks the Bladeburners faction** (`joinBladeburnerFaction`, 4 GB). While doing BB
  work, faction rep accrues automatically: `2 · rankGain · faction_rep mult · (1 + favor/100)`.
  This is the node's aug engine.
- **Money comes from contracts only**: `250k · rewardFac^(level−1) · Hands-of-Midas mult`.
  Operations pay rank/rep, not cash.
- Int XP trickle: BaseIntGain 0.003 [SRC: Constants; matches bn5-design.md's table].

### Chaos and population [SRC: Bladeburner.ts]

Kill-flagged ops and Incite Violence raise chaos (`+10, then +chaos/log10(chaos)` — it
compounds); Diplomacy lowers it by a charisma-driven percentage (charisma 2 → expect nothing
[OPEN: exact formula]). Ops with `isKill` shrink the city's synthoid population; Raid needs the
city to have **communities** (`getCityCommunities`). Population regrows (BasePopGrowth 100,
ceiling 1.5e9) and action counts refill on a 480s growth period [OPEN: exact refill formula;
Incite Violence is believed to add counts — unverified].

### Teams and casualties [SRC: TeamCasualties.ts, BlackOperation.ts]

Operations and black ops can take a team (`setTeamSize`, grown via Recruitment); the success
bonus is **`(teamCount + 1)^0.05`** [SRC v3.0.1: Operation.ts:96 — SETTLED 2026-09-20]: a team
of 7 buys +11% competence, 15 buys +15%. Casualties: up to 50% of the team on success, up to
100% on failure — and **black ops kill at least 1 member even on success**. Ops minimum is 0.
Verdict: at ≥92% chances teamless remains correct; revisit only if a late rung's tight
estimate sits just under the attempt bar.

## 5. The action data [SRC: data/*.ts]

### Contracts (money + rank; per-stat weights favor dex/agi)

| name | baseDiff | diffFac | rewardFac | rank | hpLoss | notes |
|---|---|---|---|---|---|---|
| Tracking | 125 | 1.02 | 1.041 | 0.3 | 0.5 | dex/agi 0.35 each; minCount 25 |
| Bounty Hunter | 250 | 1.04 | 1.085 | 0.9 | 1 | best rank/count; minCount 5 |
| Retirement | 200 | 1.03 | 1.065 | 0.6 | 1 | minCount 5 |

Success-count level curve: contracts level every 3 successes, operations every 2.5 [SRC:
ContractSuccessesPerLevel, OperationSuccessesPerLevel].

### Operations (rank engine; hacking/charisma matter — our charisma 2 hurts the stealth ops)

| name | baseDiff | diffFac | rewardFac | rank± | hpLoss | flags |
|---|---|---|---|---|---|---|
| Investigation | 400 | 1.03 | 1.07 | 2.2 / −0.2 | 0 | stealth; improves pop est |
| Undercover Op | 500 | 1.04 | 1.09 | 4.4 / −0.4 | 2 | stealth; improves pop est |
| Sting Op | 650 | 1.04 | 1.095 | 5.5 / −0.5 | 2.5 | stealth |
| Raid | 800 | 1.045 | 1.1 | **55 / −2.5** | 50 | kill; needs communities; drops pop hard |
| Stealth Retirement | 1000 | 1.05 | 1.11 | 22 / −2 | 10 | stealth+kill |
| Assassination | 1500 | 1.06 | 1.14 | **44 / −4** | 5 | stealth+kill; weights dex/agi 0.3 |

### The Black Op ladder — 21 rungs, strictly ordered, one attempt each is the plan

reqdRank → name (baseDiff, hpLoss): 2.5k Typhoon (2k, 100) · 5k Zero · 7.5k X · 10k Titan ·
12.5k Ares · 15k Archangel · 20k Juggernaut · 25k Red Dragon · 30k K · 40k Deckard · 50k
Tyrell · 75k Wallace · 100k Shoulder of Orion · 125k Hyron · 150k Morpheus · 175k Ion Storm ·
200k Annihilus · 250k Ultron · 300k Centurion · 350k Vindictus (75k diff, **20k rank loss**) ·
**400k Daedalus (80k diff, 100k hpLoss) — completing it DESTROYS BN6.** [LIVE: names+order
via getBlackOpNames; numbers SRC.] Failure loses rank AND the attempt survives (retry allowed
[OPEN: verify a failed black op can be retried]).

### Skills [SRC: data/Skills.ts — cost scales by costInc per level; BladeburnerSkillCost 1.0 here]

| skill | base/inc | effect/level | verdict for this run |
|---|---|---|---|
| Blade's Intuition | 3 / 2.1 | +3% ALL success | always-buy |
| Tracer | 2 / 2.1 | +4% contract success | early money |
| Digital Observer | 2 / 2.1 | +4% operation success | the rank engine |
| Short-Circuit | 2 / 2.1 | +5.5% kill-op success | pairs with Assassination |
| Cloak | 2 / 1.1 | +5.5% stealth success | cheap inc — stacks high |
| Overclock | 3 / 1.4, **max 90** | −1% action time | throughput king |
| Reaper / Evasive System | 2 / 2.1 | +2% all combat / +4% dex+agi eff | stat amplifiers |
| Datamancer | 3 / **1.0** | +5% estimate accuracy | flat cost — a few early |
| Cyber's Edge | 1 / 3 | +2% max stamina | cliff insurance |
| Hands of Midas | 2 / 2.5 | +10% contract money | only if BB is the wallet |
| Hyperdrive | 1 / 2.5 | +10% stat exp from actions | compounds combat stats |

## 5b. First live snapshot [LIVE 2026-09-17 — rank 0, combat 181, int 84, day one]

- **Contracts are the only viable work at these stats**: Tracking 58–100% est (best rank/min at
  1.29), Retirement 30–73%, Bounty Hunter 24–59%. **Every operation is single-digit-to-20%** —
  the rank engine is locked until stats/skills grow. Naive rank/min ranks Raid first (4.0) but
  that's a trap at 4.5–11% success: failure costs 2.5 rank AND 50 HP.
- **HP is 28.** Op failure damage (hpLoss × difficulty mult) is life-threatening at day-one HP;
  the conductor needs an HP guard, not just a stamina guard. Regen Chamber heals +2 HP/tick.
- **The estimate intervals are WIDE** (Tracking spans 42 points) — day-one popEst is noisy;
  Field Analysis pays for itself immediately.
- Stamina 64/64 (agi 181 eff → `181^0.8 ≈ 64` — matches the [SRC] maxStamina formula with no
  bonus yet). Chaos 0 in all six cities; popEst 0.8–1.7b, Sector-12 highest at 1.716b (a fine
  place to stand: pop factor ~1.5, and no reason to pay `switchCity` 4 GB yet). Communities:
  New Tokyo 138 / Chongqing 126 (Raid fodder for much later).
- Action counts are FRACTIONAL and regrow live (Tracking "151.85") — the 480s growth period
  [SRC] ticking in real time. Skill costs at level 0 match the [SRC] baseCosts exactly.

## 5c. The Bladeburners aug shop [SRC: Augmentations.ts, 2026-09-17]

Rep costs are TINY (rep accrues at 2x rank gain once joined at rank 25); money is the gate.
Ordered ladder of the notable pieces (repCost / moneyCost / bladeburner mults):

- EsperTech Eyewear 1.25k / $165m / +3% success · EMS-4 Recombination 2.5k / $275m / +3%
  success +5% analysis +2% stamina gain · ORION-MKIV 6.25k / $550m / +4% success ·
  BLADE-51b IPU 15k / $1.1b / +15% analysis +2% success · Hyperion V1 12.5k / $2.75b / +6%
  success · armor line up to Omnibeam 62.5k / $27.5b / +10% success · INTERLINKED 25k /
  $5.5b / +10% max stamina · Vangelis Virus 3.0 37.5k / $11b / +15% analysis +5% success.
- **The Blade's Simulacrum — 1.25k rep / $150b, `isSpecial: true`**: Bladeburner actions AND
  normal work (job, crime, faction grind) at the same time. Dissolves the player-action fight
  with int-farm/ascend --work permanently. Effect applies on INSTALL, like all augs.
  [OPEN: what isSpecial exempts it from — likely the Daedalus aug count; check before
  counting it toward the 35.]
- Install safety: Bladeburner survives `prestigeAugmentation` — rank, skills, SP, ladder
  progress all kept; the running action is cancelled and the faction auto-rejoined [SRC:
  Prestige.ts → Bladeburner.prestigeAugmentation()]. Combat stats do NOT survive, so
  post-install the conductor limps until combat is rebuilt (~100+).

## 5d. Second live snapshot [LIVE 2026-09-20 — rank 44k, three days of bb-conductor v1]

- **v1's black-op gate never fired.** Operation Typhoon (rank 2.5k, we're at 44k) estimated
  92.0–100.0% for days, and the conductor gates on est-low ≥ 0.95. The design assumption
  "black ops have a tight interval" was wrong — see §4: `getSuccessRange` applies popEst error
  to every type, and the real chance is an *endpoint* of the interval. **v2 fix: when the
  interval spans the bar, Field Analysis until it collapses** (self-terminating either way).
  **CONFIRMED [LIVE 2026-09-20]: v2 chained Red Dragon → K → Deckard → Tyrell back-to-back
  on its first run (all successes, teamless), and the Ishima city move fired as designed.**
- **Kill-ops graze the city you stand in.** Sector-12 popEst fell 1.716b → 675m in three days
  of Stealth Retirement grinding; pop factor `(0.675)^0.7 ≈ 0.76` vs Ishima's 1.668b → 1.43 —
  standing in the grazed city costs ~2× competence. v2 adds city rotation ([SRC]:
  `switchCity` 4 GB; score = popFactor / chaos penalty, 10% hysteresis).
- **The rank engines are Stealth Retirement (228 rank/min, level 25/25) and Raid (186) —
  both kill ops; Assassination (85) is stealth+kill.** Short-Circuit sat at level 0 in the v1
  plan and Cloak capped at 25: both now uncapped in v2 (every engine is stealth and/or kill).
- **Chaos is a non-event so far**: ≤13.1 (Aevum) after three days of kill ops; threshold 50.
  Diplomacy stays cut. Action counts are plentiful (800–1600); Incite Violence stays cut.
  Stamina pegged 739/739 — Training stays cut. Charisma 611 makes Recruitment 100% (113s/
  member), but the (n+1)^0.05 bonus doesn't justify feeding recruits to the ladder yet.
- **The player-action fight is SETTLED: Bladeburner work owns "you".** Sara runs `ascend.js
  --no-work` alongside the conductor. Permanent fix someday: The Blade's Simulacrum ($150b).
- Bonus time banked: ~24.8h (division runs 5× while it lasts).

## 6. Rig sketch (build after bladeburner-scan.js pastes back)

Loop shape for a conductor (micro-script or cloud-hosted): keep stamina ≥ 55% (Regen Chamber
under, contracts/ops over) → Field Analysis / stealth ops until the chance interval is tight →
grind the best rank/min action (est-mid × rankGain / time) → Diplomacy only when chaos drags
success down → autolevel on, autobuy skills (Intuition/Observer/Overclock first) → attempt the
next black op when est-low is ~100% and team ≥ a few members → Daedalus at 400k ends the node.
`nextUpdate()` (0 GB) is the tick; the 4 GB getters are rationed corp-style.

## 7. Open questions for the scan / play

1. ~~Does live `ns.formulas.bladeburner` expose more than `skillMaxUpgradeCount`?~~
   **SETTLED [LIVE 2026-09-17]: no — skill math only.**
2. Difficulty level-curve form (`difficultyFac^(level−1)` assumed) — watch `getActionTime` and
   success chance as contract levels rise past 1/1.
3. ~~Training's staminaBonus cadence~~ **SETTLED [SRC 2026-09-20]: +0.04·mult per completion.**
   Still open: passive regen units; Incite Violence's count grant.
4. ~~Team success-bonus formula~~ **SETTLED [SRC 2026-09-20]: `(teamCount+1)^0.05`.** Still
   open: whether a failed black op is retryable (no failure observed yet — v1 never attempted).
5. ~~Does Bladeburner work block the player action slot~~ **SETTLED [LIVE 2026-09-20]: yes —
   it fights for "you"; Sara runs ascend --no-work alongside. Blade's Simulacrum dissolves it.**
6. Does `switchCity` cancel the action in progress? (v2 switches only on a fresh cycle, so
   low stakes — but watch the first few moves.)
