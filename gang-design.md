# gang-design.md — the *why* for `gang-manager.js`

A standalone gang-automation bot for Bitburner 3.0.1. Sibling to `stock-trader.js`: a
**separate income stream** that runs *alongside* `commander.js`, not a replacement. It
touches none of your server RAM economy — it only polls `ns.gang.*` and issues orders, so
it costs just the sliver of `home` RAM the manager script itself uses. Survives an
`ascend.js` install (installing Augmentations does **not** reset gang progress; you auto-rejoin
the gang faction afterward).

Written after probing the **live** API with the throwaway `gang-api.js` (delete after use).
Everything here is confirmed against the running game on 2026-07-30, not the dev-branch docs.

---

## Confirmed live API surface (27 methods — one MORE than the dev docs)

The dev-branch markdown lists 26. The **live game also exposes `getOtherGangInformation`**
alongside `getAllGangInformation`. Trust the game. Full callable set:

`ascendMember`, `canRecruitMember`, `createGang`, `getAllGangInformation`,
`getAscensionResult`, `getBonusTime`, `getChanceToWinClash`, `getEquipmentCost`,
`getEquipmentNames`, `getEquipmentStats`, `getEquipmentType`, `getGangInformation`,
`getInstallResult`, `getMemberInformation`, `getMemberNames`, `getOtherGangInformation`,
`getRecruitsAvailable`, `getTaskNames`, `getTaskStats`, `inGang`, `nextUpdate`,
`purchaseEquipment`, `recruitMember`, `renameMember`, `respectForNextRecruit`,
`setMemberTask`, `setTerritoryWarfare`.

`inGang()` is the only one that works **without** gang API access — use it as the top guard.

## Confirmed shapes

- **`getGangInformation()`** → `{ faction, isHacking, moneyGainRate, power, respect,
  respectGainRate, respectForNextRecruit, territory (0..1), territoryClashChance,
  territoryWarfareEngaged, wantedLevel, wantedLevelGainRate, wantedPenalty,
  equipmentCostMult }`.
- **`getMemberInformation(name)`** → `name, task, earnedRespect`; six skills `hack/str/def/dex/agi/cha`
  each with `_exp`, `_mult` (equipment), `_asc_mult` + `_asc_points` (ascension); `upgrades[]`,
  `augmentations[]`, `respectGain`, `wantedLevelGain`, `moneyGain`, `expGain` (null when Unassigned).
- **`getTaskStats(name)`** → `{ name, desc, isHacking, isCombat, baseRespect, baseWanted,
  baseMoney, hackWeight, strWeight, defWeight, dexWeight, agiWeight, chaWeight, difficulty,
  territory:{money,respect,wanted} }`. **This is the assignment brain** — score tasks from
  weights × the member's stats, not hardcoded ladders.
- **`getEquipmentStats(name)`** → sparse multiplier object, e.g. `{str:1.04, def:1.04}`.
  **`getEquipmentType(name)`** ∈ `Weapon | Armor | Vehicle | Rootkit | Augmentation`.
- **`getBonusTime()`** → banked accelerated ms (gang double-processes during it).

Our gang: **Tetrads**, combat (`isHacking:false`) → level str/def/dex/agi, Train **Combat**.
Task list (15): Unassigned, Mug People, Deal Drugs, Strongarm Civilians, Run a Con, Armed
Robbery, Traffick Illegal Arms, Threaten & Blackmail, Human Trafficking, Terrorism,
Vigilante Justice, Train Combat, Train Hacking, Train Charisma, Territory Warfare.

## Gotchas the probe caught (bake these into the code)

1. **`getAscensionResult(name)` returns `undefined`** for a member with nothing to gain
   (fresh, zero exp). **Guard for undefined** before reading `.str` etc. — else it crashes.
2. **`wantedPenalty = respect / (respect + wanted)`** — it's an *efficiency multiplier* on
   money & respect gains, not a cost. Fresh gang sits at `1/(1+1) = 0.5` → **you earn at 50%**
   until respect outpaces wanted. Protecting this number is the loop's #1 job.
3. **`equipmentCostMult ≈ 1.0`** early (barely any discount); it improves as the gang grows.
   Don't assume cheap gear at the start.
4. **Ascension resets a member's skills/exp** for a permanent `_asc_mult` gain, and **wipes
   non-aug `upgrades` but keeps `augmentations`**. Re-buy plain gear after ascending.
5. Sync the loop with **`await ns.gang.nextUpdate()`**, not a fixed `ns.sleep` — one iteration
   per gang tick, no drift.

---

## Decisions (locked with Sara, 2026-07-30)

- **Ascension: AUTO on threshold.** Each tick, for each member, if `getAscensionResult` (≠
  undefined) shows a stat's projected `_asc_mult` gain ≥ `ASCEND_THRESHOLD` (default **1.15**,
  i.e. +15%), ascend. Accept the temporary dip; it compounds.
- **Territory: BUILD power, AUTO-ENGAGE only when safe.** Keep members building power via the
  Territory Warfare task. Compute the **minimum** `getChanceToWinClash` across all rival gangs
  (from `getAllGangInformation` keys, excluding our own). `setTerritoryWarfare(true)` only while
  that min ≥ `CLASH_MIN_WIN` (default **0.55**); otherwise keep it **off** so nobody dies.
- **Priority: RESPECT first.** Score crime tasks weighted toward respect until the roster is
  full (12 members), then shift the weighting toward money. Respect unlocks recruits and lifts
  the wanted penalty out of the 50% hole fast.

## The control loop (spec)

Guard: `if (!ns.gang.inGang()) { warn + exit }`. Then loop, each iteration = one `nextUpdate()`:

1. **Recruit** — while `canRecruitMember()`, `recruitMember(autoName())`. Name scheme e.g.
   `Tetrad-1`, `Tetrad-2`… (must be unique; `renameMember` available if needed).
2. **Ascend** — per member, guarded `getAscensionResult`; ascend if any stat's mult gain ≥
   `ASCEND_THRESHOLD`.
3. **Assign** — per member, pick a task:
   - stats below `TRAIN_UNTIL` (default **50** combat avg) → **Train Combat**;
   - else if gang `wantedPenalty < WANTED_FLOOR` (default **0.90**) → put a fraction of members
     on **Vigilante Justice** until it recovers;
   - else → the crime scored best by `score(task, member)` = `(baseRespect*wRespect +
     baseMoney*wMoney) * statFit(task, member) / difficulty`, where `statFit` is the
     weighted-average of the member's relevant stats vs the task's `*Weight`s, and `wRespect ≫
     wMoney` until the roster is full (respect-first), then flipped;
   - reserve a slice of the roster for **Territory Warfare** to grow power (start ~1–2 members,
     scale with roster).
4. **Equip** — for each member, buy affordable `Augmentation`-type first, then other gear whose
   multiplier helps its assigned task, while keeping `KEEP_LIQUID` cash (default like the stock
   bot). Respect `equipmentCostMult`.
5. **Territory toggle** — set warfare on/off per the `CLASH_MIN_WIN` rule above.
6. **Status line** — keep it watchable (Sara likes watching runs): respect, $/sec, wanted
   penalty, territory %, member count, who's on what. Mirror the tone of the commander's tail.

## Tuning constants (top of file, all overridable by argv where sensible)

`ASCEND_THRESHOLD=1.15`, `CLASH_MIN_WIN=0.55`, `WANTED_FLOOR=0.90`, `TRAIN_UNTIL=50`,
`KEEP_LIQUID` (cash reserve for equipment), roster target `12`, `TERRITORY_MEMBERS` (how many
to park on power-building). Document each inline like the commander does.

## Coexistence notes

- Runs from `home`. Independent of `commander.js` / `stock-trader.js` / the darknet rig.
- `reset-scripts.js` currently spares `stock-trader.js`; when this ships, decide whether the
  gang manager should likewise be spared on a rig reset (it should — gang progress persists
  across installs, so killing/restarting it is just churn).
- `ascend.js`: no special handling needed — gang survives the install and auto-rejoins the
  faction. Optionally, later, have `ascend-boot.js` re-launch `gang-manager.js` after a reset.

---

## Not in v1 (later)

- Formulas-based exact task optimization if `ns.formulas.gang` exists (probe it; Formulas.exe is
  wiped on install, so keep the heuristic path as the always-works fallback).
- Smarter respect↔money↔wanted balancing (e.g. target a wanted-penalty setpoint via PID-ish
  member reallocation).
- Spend `getBonusTime()` deliberately (e.g. hold big reassignments for when bonus time is banked).
