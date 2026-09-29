# bn10-design.md — Sleeves, Grafting and BitNode 10 ("Digital Carbon"), the *why*

Same contract as `bn6-design.md` / `bn5-design.md`: every claim is tagged **[SRC]** (read from
the `v3.0.1` tag, 2026-09-21), **[LIVE]** (confirmed in the running game), or **[OPEN]**.
The running game outranks everything here.

> **Position (2026-09-21): entered BN10.1.** Holding SF 1.3 / 2.3 / 3.3 / 4.3 / 5.3 / **6.1** /
> 9.1 — **no SF10 yet**, so exactly **1 sleeve** (the BN10 freebie; formula in §3). Sara has
> been in BN10 before, pre-repo: a grafting misunderstanding forced **three b1t_flum3 exits**.
> This doc exists so there is no fourth — §4 is the burn ward. `sleeve-manager.js` and
> `grafting-queue.js` survive from those runs and must be **audited against this doc before
> first use** (they may encode the old misunderstanding, and possibly pre-v3 API names).

## 1. The headline: Entropy is a NODE-LIFETIME debt [SRC]

- Every completed graft applies **+1 Entropy stack**; each stack multiplies essentially every
  player multiplier by **0.98** [SRC: Constants.ts `EntropyEffect`, EntropyAccumulation.ts]:
  all hacking/combat/charisma levels and exp, hacking money/speed/chance/grow, company AND
  faction rep, crime money/success, work money, hacknet money — with hacknet *costs divided*
  by 0.98 (made worse) — plus **dnet_money and all four bladeburner mults**. Ten grafts =
  ×0.817 on your entire life.
- **Installing augmentations does NOT clear entropy.** `this.entropy = 0` lives in
  `prestigeSourceFile` ONLY [SRC: PlayerObjectGeneralMethods.ts:144] — i.e. b1t_flum3 or
  destroying the node. Inside a node, entropy only ever goes up.
- Consequence: **graft nothing until the Congruity Implant (§4) erases the mechanic.** Before
  it, each graft must beat a permanent −2% on everything — a bar almost no ordinary aug clears
  (the three-flume lesson, §4). After it, graft freely. Side note either way: grafting grants
  int XP (`IntelligenceGraftBaseExpGain` 0.05 [SRC]) and graft time *shrinks* with int via
  `graftingIntBonus` — the BN5 int investment compounds here.

## 2. BN10 multipliers [SRC: BitNode.tsx case 10 — checked key-by-key; not yet [LIVE]-verified]

| lever | mult | so what |
|---|---|---|
| Hacking/Str/Def/Dex/Agi/Cha LevelMultiplier | **0.35 / 0.4 ×5** | everything levels slowly; gym/uni are sleeve jobs |
| ScriptHackMoney · CrimeMoney · CompanyWorkMoney · HacknetNodeMoney · ManualHackMoney · CodingContractMoney | **0.5 each** | all income halved, none zeroed |
| **ServerMaxMoney, HackExpGain: ABSENT = 1.0** | full-size pots, full hack exp — the commander earns here |
| **AugmentationMoneyCost 5 · AugmentationRepCost 2** | augs are brutal; note graft cost ×3 stacks on this (§4) |
| CloudServerCost 5 · Softcap 1.1 · Limit 0.6 · MaxRam 0.5 | the fleet is small and pricey |
| HomeComputerRamCost 1.5 | home upgrades +50% |
| CorporationValuation 0.5 · Softcap 0.9 · Divisions 0.9 | corp viable — likely the Covenant wallet (§3) |
| GangSoftcap 0.9 · GangUniqueAugs 0.25 | gang near full strength |
| BladeburnerRank 0.8 | division works; sleeves can staff it |
| DarknetMoneyMultiplier 0.4 | darknet pays 40% |
| StaneksGift 0.75 power, −3 size · InfiltrationMoney 0.5 · WorldDaemonDifficulty 2 | |

## 3. Sleeves [SRC: SleeveCovenantPurchases.tsx, Sleeve.ts]

- **Count = `min(3, SF10 level + (in BN10 ? 1 : 0)) + sleevesFromCovenant`.** We hold SF10 0 →
  **1 sleeve now**; destroying BN10.1 banks SF10.1 → 1 sleeve in every future node.
- **The Covenant sells 5 more, in BN10 only, members only**: cost `$10t × 10^n` for the n-th —
  $10t, $100t, $1q, $10q, $100q ($111.1q for all five). **Purchased sleeves are PERMANENT
  across every future node and install** — the code deliberately reads `sourceFileLvl(10)`,
  not the active override, so bought sleeves are never destroyed [SRC comment]. This is the
  node's real prize beyond SF10 itself.
- **Memory (1→100, Covenant, BN10 only, ~$1t·1.02^level per point) is also permanent**, and is
  the floor `sync` starts at each node: `sleeve.prestige()` sets `sync = max(memory, 1)`,
  `shock = 100`. **BN10 entry is merciful: shock clamped ≤25, sync ≥25** [SRC:
  prestigeSourceFile]. An *install* keeps shock/sync values as-is and just re-tasks the sleeve
  (shock>0 → Shock Recovery, else Synchronize) [SRC: prestigeAugmentation].
- `shockBonus = (100−shock)/100`, `syncBonus = sync/100` [SRC: Sleeve.ts:173-179] — both scale
  sleeve output, so the opening move is always: recover shock to 0, then synchronize.
  [OPEN: exact formula for how sleeve exp flows to the player — pull SleeveWork sources.]
- Work menu [SRC: ns API surface]: Idle, Shock Recovery, Synchronize, Crime, University, Gym,
  Company work, Faction work, Bladeburner action, Travel.
- **Sleeve augs [SRC: Sleeve.ts:356-399 — SETTLED 2026-09-21]: purchase is hard-gated on
  shock === 0; rep-gated through the PLAYER's factions; cost flat `baseCost` — NO BN10 ×5, NO
  1.9× batch escalation — and apply instantly.** The cheapest augs in the node. They reset
  only in `sleeve.prestige()`, so they survive installs. Passive shock decay exists but is
  glacial (0.0001/cycle [SRC: Sleeve.ts:269]) — Shock Recovery work is the only real path
  to 0. [OPEN: does sleeve crime karma flow to the player (gang unlock at −54k)?
  sleeve-manager.js assumes yes — verify with `ns.heart.break()` early.]
- Sleeves do NOT occupy the player action — they are parallel bodies. The player-action fight
  (classes, bladeburner, **grafting**) is about "you" only.

## 4. Grafting — the burn ward [SRC: GraftableAugmentation.ts, GraftingHelpers.ts]

- Gate: `canAccessBitNodeFeature(10)` — BN10 now, SF10 later. Done at VitaLife (New Tokyo).
- **Cost = aug baseCost × 3** (`AugmentationGraftingCostMult`) — [OPEN: whether that stacks on
  BN10's AugmentationMoneyCost 5× (probe `getAugmentationGraftPrice` live vs the shop price)].
- **Time = (1h · log2(max(Σ of the aug's non-1 mults, 1)) + 30min) / 2, then ÷ graftingIntBonus**
  — int shortens it, so our int 90+ carry from BN5 pays off here.
- **Grafting is a Work: it owns the player action** for the whole duration, like a class or
  bladeburner work. [OPEN: what happens to progress if interrupted — resumable or lost?]
- On completion the aug applies **immediately** — no install needed — and entropy ticks +1 (§1).
- **What burned the three flumed runs [LIVE — Sara, 2026-09-21]: graft SELECTION, not entropy
  ignorance.** She grafted batches of ordinary augs; each buys +5–15% on one or two multipliers
  while its stack takes −2% off ~forty of them. **A typical small aug is strictly net-negative
  to graft.** Fewer-but-still-small augs failed the same way on the retry. The bar: an aug must
  be a monster (huge mults across several axes) — or a capability unlock with no mult math at
  all — before it beats a permanent −2% on everything.
- **THE FIX THIS RUN — the nickofolas Congruity Implant [SRC: Augmentations.ts:391]:**
  graft-only (`repCost: Infinity`, no faction carries it), **$50t base** (×3 graft mult; ×5
  BN10 [OPEN] → plan for $150t–$750t, probe the real price live). Its effect: **"removes the
  Entropy virus, and prevents it from affecting you again."** All prior stacks erased, all
  future grafts free of entropy. This dissolves the selection problem entirely: post-Congruity,
  grafting is a pure money+time aug engine with no install and no downside. The policy writes
  itself: **graft NOTHING until Congruity is affordable; graft Congruity; then graft greedily.**
- `grafting-queue.js` predates this doc: audit its model against every line above before
  running — it has an `--auto N cheapest` mode, which is EXACTLY the pre-Congruity trap.
- **Installing is NOT grafting: buy+install carries ZERO entropy** [SRC: entropy ticks only in
  the graft-completion path]. An installed aug can never lower a multiplier — if a run felt
  worse after installing small augs, that was the reset cost (momentum lost for weak gains),
  not a debuff. BN10 install economics: ×5 money, ×2 rep, and the standard same-batch
  escalation `MultipleAugMultiplier` **1.9** per successive purchase [SRC: Constants.ts:41] —
  so plan fewer, bigger install rounds, led by the highest-value augs. What survives an
  install here: corp, gang, sleeve shock/sync/memory/augs, Covenant sleeves. What doesn't:
  hacknet (BN9 lesson), stock positions (liquidate first), combat/hacking levels.
- **Post-Congruity, grafting IS the answer to the install grind**: augs for money alone — no
  rep grind (dodges the ×2), no install, no reset, effects immediate. The endgame acquisition
  engine of this node.

## 5. RAM prices [SRC: RamCostGenerator.ts — not yet [LIVE]-verified]

- **Every `ns.sleeve` function is 4 GB** (`SleeveBase` — all 22 of them; the whole namespace is
  88 GB). No free names, no free `nextUpdate` equivalent — budget like the corp rig: few
  functions per script, or one honest conductor on 512 GB home... which we do NOT start with
  this run — home RAM starts small and upgrades cost 1.5×. **Small scripts first.**
- `ns.grafting`: `graftAugmentation` 7.5, `getGraftableAugmentations` 5,
  `getAugmentationGraftPrice`/`getAugmentationGraftTime` 3.75, `waitForOngoingGrafting` **0**.
- Verify all of it with `ram-costs.js` (`getFunctionRamCost` is free) before designing tight.

## 6. Rig sketch (audit the survivors first, then build)

1. **Audit `sleeve-manager.js`** ~~+ `grafting-queue.js`~~ — **sleeve-manager DONE 2026-09-21**:
   API was v3-clean; defaults were wrong (shock floor 90 starved the shock-0 aug gate; sync
   was off) — now de-shock → sync → crime by default. Gaps left for a later pass: no faction
   work mode, no Covenant sleeve/memory purchases. ~35 GB — run it from a cloud box until
   home grows. **grafting-queue.js still unaudited** — do it before Congruity money arrives.
2. **sleeve-scan.js** (stage-2 probe, bladeburner-scan style): getSleeve per sleeve (shock,
   sync, memory, stats), getTask, purchasable augs + prices, graftable augs + price/time —
   settles the §3/§4 [OPEN]s and gives the conductor its numbers.
3. **sleeve-conductor.js**: shock → 0, sync → ceiling, then per-sleeve assignment (gym/uni to
   rebuild 0.4-mult stats, crime for cash/karma, faction work toward The Covenant, bladeburner
   if the division is running). Player money engine: commander + corp (full-size pots [SRC] —
   ServerMaxMoney absent — make BN10 the corp rig's second proving ground).
4. **Grafting policy: Congruity-first.** Graft nothing until the Congruity Implant is
   affordable (~$150t+, price [OPEN]); graft it; then grafting is entropy-free and the queue
   script (post-audit) can run greedily on the biggest augs money can buy — no installs needed,
   which also sidesteps BN10's 2× aug rep costs entirely for graft-only acquisition.
5. Endgame: Covenant sleeves+memory as money allows ($10t first rung — very reachable;
   $111.1q for all five — corp money), then the WD at difficulty 2.

## 7. Open questions for the scan / play

1. Graft price live: does ×3 stack on BN10's ×5 aug prices? (`getAugmentationGraftPrice` vs
   shop.) And is graft progress lost or paused when the player action is stolen?
2. Sleeve exp → player flow (rate, sync scaling); sleeve crime karma → player?
3. ~~Sleeve augs: money-only or rep-gated? Require shock 0? Survive installs?~~ **SETTLED
   [SRC 2026-09-21]: rep-gated via player factions, flat baseCost, shock must be exactly 0,
   and they survive installs — see §3.**
4. The Covenant invite requirements this node (stats at 0.4 mults will be slow — how slow?).
5. ~~What went wrong with grafting in the flumed runs~~ **SETTLED [LIVE 2026-09-21]: small-aug
   grafting is net-negative; see §4 and the Congruity-first policy.** Still to verify live:
   the Congruity Implant's actual graft price in BN10, and that it appears in
   `getGraftableAugmentations` with no prerequisites.
6. `ns.formulas` for sleeves/grafting: anything live? (BN5 pattern says probe before trusting.)
