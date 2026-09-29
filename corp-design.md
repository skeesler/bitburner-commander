# corp-design.md — the *why* for the corporation rig

A corporation-automation rig for Bitburner 3.0.1, and the point of BitNode 3. Sibling to
`gang-manager.js` and `stock-trader.js`: a **separate income stream** that runs alongside
`commander.js`. Unlike the gang, it is **not** RAM-free — the corporation API is the most
expensive namespace in the game, and that cost drives the entire architecture (see
[The RAM wall](#the-ram-wall)).

Written after probing the **live** game with `corp-api.js` (throwaway; delete after use).
Everything below is confirmed against the running game on **2026-08-09**, or read out of the
**v3.0.1 release tag** — not the dev branch, which historically runs ahead.

> **2026-09-27: the rig was rewritten into four files** — see [The 2026-09 rewrite](#the-2026-09-rewrite)
> directly below. Everything after that section is the original BN3 design record: the game
> mechanics, gotchas and decisions in it still hold, but its *architecture* (29 small scripts, a
> free conductor, `corp-state.txt`) now lives in `archive/`. The how-to is `corp-runbook.md`.

---

## The 2026-09 rewrite

**The RAM wall was real but it was also finite, and a big home clears it.** Read out of the v3.0.1
tag, not estimated:

- `RamCostGenerator.ts`: the corporation namespace is **20 read functions at 10 GB, 38 actions at
  20 GB, 5 free** (`hasCorporation`, `canCreateCorporation`, `getConstants`, `getBonusTime`,
  `nextUpdate`). Mentioning **every** corporation function in one file is **961.6 GB**.
- `RamCalculations.ts:255` caps a script's static RAM at `RamCostConstants.Max` = **1024 GB**, and
  `NetscriptHelpers.tsx:442` caps the dynamic (call-time) total at the same figure. So no corp
  script can cost more than 1 TB, whatever it mentions. The "~700 GB monolith" in the RAM-wall
  section below was an estimate; the true ceiling is lower than the cap.
- `Corporation.ts:181`: `nextUpdate()` resolves with **the state that was just processed**. That
  settles the "needs field confirmation" note in the control-loop spec below: a resident manager
  can act at a known point in the cycle. `corp.js` acts once per cycle, right after SALE — job
  changes land at the next START, buy rates are in place for PURCHASE, and last cycle's
  production and sales figures are complete.

So the split is now by **job**, not by RAM:

| File | Role | RAM (counted from the cost table) |
|---|---|---|
| `corp-lib.js` | pure logic: boost Lagrange split, job mixes, supply controller, price hunt, export amount, parsers | 0 GB of its own; every importer pays for the few `ns.corporation` names it mentions |
| `corp.js` | resident manager: staff, morale, sell orders, supply / Smart Supply, products, Market-TA.II flags; opt-in spending | ~495 GB (32 charged functions) |
| `corp-do.js` | one-shot commands: build, size, and the one-way levers behind `--yes` | ~565 GB (36), for a second |
| `corp-report.js` | the paste-back report, now reading everything itself | **192 GB measured** (19), for a few seconds |
| `corp-lib.test.mjs` | Node spec for the lib — `node corp-lib.test.mjs` | — |

What went away with the wall, and why each was only ever a RAM workaround:

- **`corp-state.txt` and its freshness rules** (gotcha 10, the ghost divisions). `corp.js` reads
  the live division list every cycle. The only file left is `corp-config.txt`: *intent* recorded
  by `corp-do.js jobs`, which `corp.js` enforces.
- **The conductor's scheduling**: launching modules, "one heavy module per cycle", retry counters,
  `atExit` cleanup of children, supply report files with timeouts.
- **Three report scanners** merging JSON fragments.
- **Standing-rate staleness in the custom supply controller.** It still exists (Smart Supply costs
  $25b), but it now runs inside the always-on manager at a known point in the cycle, so a rate a
  jam drove to 0 is recomputed next cycle. Owning the unlock switches every warehouse over.

Behaviour changes worth knowing, all deliberate:

- **Sell orders go on exported materials too.** EXPORT runs before SALE, so `MAX` sells only what
  the export left behind; without an order that leftover piles up until the warehouse jams.
- **Boost is a controller, not a one-shot.** `--auto-boost` re-solves each city's target every
  cycle against that city's current warehouse size, so Smart Storage can no longer dilute the
  boost share (the ×881 plateau). It still only buys while the manager is alive and clears its
  rates on exit. Boost materials the industry also consumes or makes are left to supply and sales.
- **Staffing is automatic.** Seats are filled every cycle; the job mix per division is
  `corp-config.txt`'s policy (`auto` = product mix for a product division, no-Business mix for an
  export-only one, otherwise an even spread with 2/9 interns in any 9+ office).
- **Two AdVerts per division, always, even in Agriculture** [SRC + LIVE 2026-09-27]. At awareness
  0 the sales multiplier is `(0.01)^0.85 ≈ 0.02` (`Division.ts:1035`). The rewrite's first live
  run showed it: Agriculture made 20–25/s per city and sold 4–6, and every warehouse filled with
  unsold Food and Plants. The `advertisingFactor` filter only decides whether to buy *more*.
  (Round 1 of the original plan said "plus 2 Advert"; the rewrite had dropped it.)
- **Upgrades are cheapest-first by price × weight** (Smart Factories/Storage 0.4, DreamSense 3),
  and Wilson is skipped until a division clears the AdVert factor filter. Plain cheapest-first
  spent the first round-1 pass on \$1b employee-stat upgrades plus a \$4b Wilson that Agriculture
  can't use.
- **`--auto` buys warehouse levels** (with `--auto-boost`), ranked against Smart Storage by space
  per dollar. The first live run never grew a warehouse past L1 (110 space), which capped boost
  material, and so production, at 42 units of space per city.
- **Imported inputs are bought lean** (one cycle + 5%, no buffer) [LIVE 2026-09-28]. The export
  amount ships *less* the more the destination holds (`−IINV/10`). With the controller's usual
  ~1.8-cycle stock that term exceeded the burn, the export dropped to a trickle, and the controller
  filled the gap with quality-1 purchases, which kept the stock high. Agriculture imported 16
  Chemicals/s and bought 47; Chemical sold 25/s of what it should have shipped. Buying lean leaves
  almost nothing after PRODUCTION, so the export (evaluated at EXPORT, after production) ships the
  full burn. Owning Smart Supply with `leftovers` behaves the same way.
- **Product pricing: a backlog is not a price signal** [SRC + LIVE 2026-09-28]. Volume is
  multiplied by exactly 1 anywhere from cost to `cost + markupLimit`
  (`calculateMarkupMultiplier`), and a product's `markupLimit = effectiveRating / markup`
  (`Division.ts:322`), roughly $60 on Tobacco's first $15k product. The original hunt cut on any
  backlog and parked Prod-1 at cost, selling 5 of 16/s: sales *capacity* was the limit, so stock
  piled up at every price. The hunt now cuts only when the last raise lost sales.
- **Market-TA.I is for materials only; products wait for TA.II** [LIVE 2026-09-28]. TA.I prices at
  exactly `cost + markupLimit` and stops there. Once Tobacco's products sold out every cycle
  (demand above production), the right price was *above* the band, which the hunt finds and TA.I
  can't. So `corp.js` switches TA.I **off** for products and on for materials until TA.II exists.
- **Research points are output quality in a materials division** [SRC: `Division.ts:679`,
  `tempQlt = Engineer/90 + researchPoints^researchFactor + ...`]. Letting TA.I "dip below the
  keep" made Chemical, which sells nothing, spend 17.5k → 1.3k RP on it, and its Chemicals fell from
  quality ~1,100 to 234. Now: Market-TA is never researched in an export-only division, materials
  divisions keep 80% of their pool, and only Hi-Tech, Capacity.I and (where something is sold)
  TA.I/II may dip below the keep, and then only as far as 50%.
- **...and in a product division it is the product's rating** [SRC + LIVE 2026-09-29]. Rating is
  multiplied by `1 + researchPoints^researchFactor / 800`, banked when the product finishes.
  Capacity.I took Tobacco from ~20k to ~1k RP, and the next product finished at 2,520 against
  3,700 and 4,443 before it. With `--rotate` something is always in development, so the 90% hold
  can't protect it. Product divisions now keep 80% too, with the same 50% floor for the must-haves.
- **Boost orders are reconciled against the game, every cycle** [LIVE 2026-09-29]. A buy rate is a
  standing per-second order *in the save*. `corp.js` only zeroed orders it remembered placing, and
  a game close or reload restarts it with an empty memory without running `atExit`. Inherited
  orders in Chemical/Sector-12, Aevum and Chongqing kept buying until Real Estate (41%) and Robots
  (40%) filled the warehouses to 100%. Chemical stopped, Agriculture's quality there fell from ~200
  to 14, and Tobacco's effective ratings from ~4,400 to ~1,000. Now any boost order the game holds
  that isn't being placed this cycle is zeroed, even without `--auto-boost`. Stray sell orders on
  boost materials are cleared, and a warehouse ≥90% full trims over-target boost stock at MP with
  or without `--trim`. **Rule: never trust process memory for a standing order; read the game.**
- **Four actions fail SILENTLY on short funds, and every call is now verified** [SRC + LIVE
  2026-09-27]: `upgradeOfficeSize`, `purchaseWarehouse`, `upgradeWarehouse` and `hireAdVert` just
  `return` without spending, with no error and no return value (`Actions.ts:398,426,446,454`).
  The old rig knew about the warehouse pair. The rewrite's first live `office Agriculture 5` printed
  six successes and grew nothing. `corp-do.js` and `corp.js` now re-read the office size, warehouse
  level or AdVert count after each of these, and report `DID NOT HAPPEN` if it didn't change.
  (`levelUpgrade`, `expandCity` and `research` throw instead, so a try/catch is enough for those.)
- **Research holds off while a product is ≥90% developed**, since `sciMult` banks at completion.
- **The one-way levers are now scripted, behind `--yes`**: `accept`, `public`, `sellshares`. They
  still never run from the resident loop.
- `corp-do.js sell ... --price 0` refuses boost materials outright (the \$100b story).

### Money out, outside BN3 [SRC]

`tributeModifier = 1.15 − CorporationSoftcap` (`Corporation.ts:54`), and a cycle's dividend to you
is `payout ^ (1 − tributeModifier)` (`:195`). BN3's softcap is 1, so the exponent there is 0.85. In
**BN10 the softcap is 0.9, so the exponent is 0.75**. Shady Accounting (−0.05) and Government
Partnership (−0.1) are the only ways to move it (`:394-397`). At the scales the Covenant sleeves ask
for (\$1q–\$100q) that exponent is ruinous: \$1q of payout per cycle arrives as roughly \$0.2t.

`sellShares` has no exponent: it pays the share price in steps of 1m shares, the price sliding 0.5%
per step (`calculateShareSale`, `:285-325`), on a 1-hour cooldown, and only once public. The share
price tracks valuation (market cap is 0.5×–1.5× valuation depending on how much you own,
`getTargetSharePrice`). So **outside BN3 the money tap is selling shares**, and `corp-do.js
sellshares` is scripted for exactly that. Self-funding at creation (\$150b, trivial with a gang
running) keeps 100% of the shares to sell; seed money is BN3-only anyway.

### Extra divisions: mostly no, except as valuation filler [SRC]

Agriculture → Chemical → Tobacco is the whole engine; the other eleven industries are variations,
not upgrades. The one mechanical reason to open more is the valuation multiplier: private and
public, valuation is multiplied by `1.0079741^(offices + warehouses)`, i.e. `1.1^(n/12)`
(`Corporation.ts:208-217`, v3.0.1). A division in all six cities adds 12, so **×1.10 on the
valuation** for its build cost, compounding per division. Worth it just before taking an offer or
selling shares, once the valuation dwarfs the ~\$50–70b price. Valuation is averaged over recent
cycles (`determineValuation`), so add them a little *before* the sale, not the same minute.
BN10 also caps the division count (`CorporationDivisions` 0.9).
Mark such a division with `corp-do.js filler DIV`: otherwise `corp.js` runs it as a real business
(boost stock, warehouse levels, AdVerts, a product), and none of that moves the office/warehouse
count. The first one, Restaurant, got all four before the mode existed.

### Timing the exit [SRC + LIVE 2026-09-29]

- Share sales run in 1m-share steps. After each step the price moves 0.5% toward the target price
  for the ownership that's *left*: `valuation × (0.5 + √own) / totalShares` (`calculateShareSale`,
  `getTargetSharePrice`, `Corporation.ts:251-325`). A big sale therefore walks the price down to
  the new target and then hovers there. `corp-lib.js shareSale()` mirrors it step for step
  (tested).
- `goPublic` prices shares off the current, *private* valuation (`Actions.ts:144`). From then on the
  corp is valued by the public formula, `funds + profit×85k` instead of `10b + funds/3 + profit×315k`
  (`Corporation.ts:198-222`), about 27% as much at a live $7b/s. The price drifts toward that by up
  to 1% a cycle, so **go public only when ready, and sell the big block the same minute**. Later
  hourly sales are priced off the lower number.
- **Freeze spending for 10+ cycles before the sale.** Valuation is the mean of the last
  `valuationLength` = 10 cycles (`Constants.ts:73`). Offices, upgrades, AdVert and research are not
  assets (`updateTotalAssets` counts funds, half of each division's build cost, and stock). A cycle
  whose assets *fell* gets no profit term: its private valuation is just `10b + funds/3`
  (`Corporation.ts:214-217`). `corp.js --auto` spends half the funds each pass, so each such cycle in
  the window can take up to 10% off the price.
- **Offices keep paying for a long time.** A seat costs `~1.3b × 1.09^(size/3)` (`calculateOfficeSizeUpgradeCost`):
  $3b at 30, $23b at 100, $0.4t at 200, $7t at 300. It lowers the valuation by about cost/3, and each
  $/s of profit it adds is worth about $250k of valuation. So a seat that pays for itself within
  about 11 days raises the valuation. Tobacco (billions/s from ~180 staff) clears that easily up to
  a few hundred per office. Agriculture, space-bound, doesn't.
- `corp-do.js ipo` prints what that would pay today and the valuation a goal needs. At $1.558q and
  55% ownership, half the shares raised $488t, so $100q needs a valuation of about $320q.

### What the rewrite gave up

**Small homes.** Home RAM resets when a BitNode ends, and `corp.js` needs ~495 GB free. On a fresh
node, either wait for the home upgrades or use the low-RAM rig in `archive/` — it is intact, with
`archive/bn3-runbook.md` as its how-to. There is deliberately no second maintained rig.

**Field confidence.** The archived modules had real play across BN3 and BN5. The new files were
exercised against a mock corporation under Node (every `corp-do` command, every `corp.js` branch,
the report) but not yet in the running game. First run: `run corp.js --once --dry`.

---

## Why this matters in BN3

BN3 is a money-starvation node. From `BitNode.tsx` at v3.0.1:

| Multiplier | BN3 |
|---|---|
| `ServerMaxMoney` | **0.04** |
| `ScriptHackMoney` | **0.2** |
| `ServerGrowthRate` | 0.2 |
| `CrimeMoney` / `CompanyWorkMoney` / `HacknetNodeMoney` | 0.25 |
| `DarknetMoneyMultiplier` | 0.4 |
| `AugmentationMoneyCost` / `AugmentationRepCost` | **3×** |
| `HomeComputerRamCost` | 1.5× |
| `CloudServerCost` | 2× (softcap 1.3) |
| `GangSoftcap` | 0.9 |
| `WorldDaemonDifficulty` | 2 |

Hacking income lands at roughly **0.8% of normal** (0.04 × 0.2) while augmentations cost 3× money
*and* 3× rep. The existing rig still earns XP, solves contracts, and feeds `ascend.js` — but it is
not going to pay for this node. **The corporation is the income plan; everything else is support.**

Confirmed live: `currentNode: 3`, `ownedSF: {1:3, 2:3, 4:3}`. So no SF3 yet (first run through this
node), SF4.3 keeps Singularity RAM at 1× for `ascend.js`, SF2.3 keeps the gang alive, and no SF10 —
`boot.js` will correctly skip `sleeve-manager.js` on its `hasSleeves` guard.

---

## Confirmed live API surface (63 methods — all present)

`ns.corporation` exposes **74** properties. **63** are the documented, callable API:

- **Corporation** (27): `acceptInvestmentOffer`, `bribe`, `buyBackShares`, `canCreateCorporation`,
  `createCorporation`, `expandCity`, `expandIndustry`, `getBonusTime`, `getConstants`,
  `getCorporation`, `getDivision`, `getIndustryData`, `getInvestmentOffer`, `getMaterialData`,
  `getUnlockCost`, `getUpgradeLevel`, `getUpgradeLevelCost`, `goPublic`, `hasCorporation`,
  `hasUnlock`, `issueDividends`, `issueNewShares`, `levelUpgrade`, `nextUpdate`, `purchaseUnlock`,
  `sellDivision`, `sellShares`.
- **WarehouseAPI** (23): `bulkPurchase`, `buyMaterial`, `cancelExportMaterial`,
  `discontinueProduct`, `exportMaterial`, `getMaterial`, `getProduct`, `getUpgradeWarehouseCost`,
  `getWarehouse`, `hasWarehouse`, `limitMaterialProduction`, `limitProductProduction`,
  `makeProduct`, `purchaseWarehouse`, `sellMaterial`, `sellProduct`, `setMaterialMarketTA1`,
  `setMaterialMarketTA2`, `setProductMarketTA1`, `setProductMarketTA2`, `setSmartSupply`,
  `setSmartSupplyOption`, `upgradeWarehouse`.
- **OfficeAPI** (13): `buyTea`, `getHireAdVertCost`, `getHireAdVertCount`, `getOffice`,
  `getOfficeSizeUpgradeCost`, `getResearchCost`, `hasResearched`, `hireAdVert`, `hireEmployee`,
  `research`, `setJobAssignment`, `throwParty`, `upgradeOfficeSize`.

Unlike the gang probe — where an undocumented method (`getOtherGangInformation`) turned out to be a
real bonus — here the v3.0.1 tag, the dev branch, and the live game all agree exactly. No surprises.

### The other 11 are TOMBSTONES — do not call them

`assignJob`, `getEmployee`, `getExpandCityCost`, `getExpandIndustryCost`, `getIndustryTypes`,
`getMaterialNames`, `getPurchaseWarehouseCost`, `getResearchNames`, `getUnlockables`,
`getUpgradeNames`, `setAutoJobAssignment`.

These are registered via `setRemovedFunctions` (`NetscriptFunctions/Corporation.ts:822`). **`typeof`
reports `function`, but calling one throws** a "removed in version X, use Y instead" error. Ten went
in 2.2.0 (the employee rework, plus eight getters folded into `getConstants()`); **`setAutoJobAssignment`
went in 3.0.0** — a v3 breaking change, and exactly what an LLM trained on 2.x corp scripts will reach
for. Their replacements are all things we already use.

**Lesson for the repo: `typeof x === "function"` is NOT proof an API is usable.** A live typeof probe
proves presence, not callability. Only an actual call proves callability.

---

## Confirmed constants (`getConstants()`, live)

`getConstants()` costs **0 GB** and needs **no corporation** — it is the cheapest and most useful call
in the namespace, and the source of every valid name string. Do not hardcode name lists; read them.

- **Money**: `officeInitialCost` 4e9, `officeSizeUpgradeCostBase` **1e9**, `warehouseInitialCost` 5e9,
  `warehouseInitialSize` 100, `warehouseSizeUpgradeCostBase` 1e9, `teaCostPerEmployee` 500e3.
  - Note the published upgrade table lists Office base price as 4e9; that's the *initial* office
    cost. The **upgrade** base is 1e9. Use `getOfficeSizeUpgradeCost()` and stop doing the algebra.
- **Timing**: `secondsPerMarketCycle` 10, `gameCyclesPerMarketCycle` 50, `gameCyclesPerCorpStateCycle` 10.
- **Shares**: `initialShares` 1e9, `sharesPerPriceUpdate` 1e6, `issueNewSharesCooldown` 72e3 cycles
  (4h), `sellSharesCooldown` 18e3 cycles (1h), `dividendMaxRate` 1.
- **Bribery**: `bribeThreshold` 100e12 valuation, `bribeAmountPerReputation` 1e9.
- **Other**: `maxProductsBase` 3, `minEmployeeDecay` 10, `baseProductProfitMult` 5,
  `employeeSalaryMultiplier` 3, `marketCyclesPerEmployeeRaise` 400, `employeeRaiseAmount` 50.
- **Name lists**: `stateNames` (5), `employeePositions` (7), `industryNames` (14), `materialNames` (12),
  `boostMaterials` (4), `unlockNames` (8), `upgradeNames` (9), `researchNames` (20),
  `smartSupplyOptions` (`leftovers` | `imports` | `none`).

`fundingRoundShares` and `fundingRoundMultiplier` are **deliberately withheld** from `getConstants()`.
From v3.0.1 source they are `[0.1, 0.35, 0.25, 0.2]` and `[3, 2, 2, 1.5]`; offer =
`valuation × shares × multiplier`. Hardcode with a comment that these are source-read, not API-read.

---

## The RAM wall

**Every `ns.corporation.*` function costs 10 GB (info) or 20 GB (action) just for being *mentioned*.**
This is the dominant design constraint — larger than any gameplay consideration.

- A monolithic manager mentioning most of the API lands around **700 GB**, and the game *clamps* any
  single script at **1024 GB** (`RamCalculations.ts:255` — it silently caps rather than erroring).
- On a BN3 home (`HomeComputerRamCost` 1.5×) that is an absurd amount of RAM to buy, and it would be
  competing with `commander.js`, `gang-manager.js`, and `ascend.js`.

**Architecture: a free conductor + one resident module at a time.**

These calls cost **0 GB**: `nextUpdate`, `getConstants`, `hasCorporation`, `canCreateCorporation`,
`getBonusTime`. So the conductor — which owns the clock and dispatches work — is essentially free
(~2.8 GB: base 1.6 + `ns.run` 1.0 + `ns.ps` 0.2). Each module is `run()` as a **short-lived,
single-purpose script that exits immediately**, so peak usage is *conductor + largest module*, not
the sum:

| Module | Mentions | ~RAM |
|---|---|---|
| `corp-boot.js` — create, expand to 6 cities, buy warehouses (one-shot) | 4 actions, 4 infos | **121.6 GB** (measured) |
| `corp-office.js` — hire, size, job assignment, tea/party | 4 actions, 3 infos | ~140 GB |
| `corp-supply.js` — custom Smart Supply (buy inputs) | 2 actions, 5 infos | ~110 GB |
| `corp-price.js` — custom Market-TA2 (set sell prices) | 2 actions, 6 infos | ~110 GB |
| `corp-upgrade.js` — levelUpgrade / purchaseUnlock / hireAdVert / research | 4 actions, 5 infos | ~130 GB |
| `corp-product.js` — makeProduct / discontinue / sell (round 3+) | 3 actions, 2 infos | ~110 GB |

Built since, and sized the same way — one concern per script so peak stays "conductor + largest module":

| Module | Charged calls | RAM |
|---|---|---|
| `corp-ta.js` — set the Market-TA.II flag per material and product | 2 actions, 2 infos | **61.6 GB** |
| `corp-upgrade.js` — corporation-wide `levelUpgrade` | 1 action, 3 infos | **51.6 GB** |
| `corp-advert.js` — `hireAdVert`, filtered by `advertisingFactor` | 1 action, 4 infos | **61.6 GB** |
| `corp-research.js` — `research` against an RP reserve | 1 action, 3 infos | **61.6 GB** |
| `corp-bribe.js` — `bribe` funds → faction reputation | 1 action, 1 info (+`getPlayer`) | **32.1 GB** |
| `corp-dividend.js` — `issueDividends` rate dial | 1 action, 1 info | **31.6 GB** |

They are split by concern rather than merged because merging them lands at ~171 GB — more than a
512 GB home has free beside a resident `corp-product.js` at 91.6 GB. The division LIST comes from
`corp-state.txt` via `ns.read` (0 GB) rather than `getCorporation` (10 GB) wherever live funds aren't
needed; the cost of that is a division created since the last `corp-status.js` refresh being
invisible, which every affected script documents and `--divisions` overrides.

Peak ≈ **145 GB** instead of ~700 GB. That is the difference between "playable on a modest home" and
"buy a terabyte first." Modules communicate through a small JSON state file on `home` (same pattern as
`dnet-db.js`, minus the single-writer contention — here the conductor is the only scheduler).

### There is no way to dodge the cost — only to split it

The runtime enforces the budget a **second** time. `updateDynamicRam` (`NetscriptHelpers.tsx:434-458`)
adds each function's cost the first time it is actually **called** and kills the script with *"Dynamic
RAM usage calculated to be greater than RAM allocation"* once the running total passes what was
statically allocated. So calling through bracket access (`c[name](...)`) hides a function from the
static walker but **not** from the runtime — it works only for genuinely 0-cost functions. `corp-api.js`
originally got this wrong and would have died mid-run the moment a corporation existed.

The only lever is **how many distinct charged functions one script mentions**. Two useful properties
found while exploiting that:

- `expandCity` **throws** on both "already expanded" and "insufficient funds", so it is self-reporting
  and needs no getter beside it — a script doing only that is **21.6 GB**, the floor for any corp action.
- `purchaseWarehouse` **fails silently** (`Actions.ts:425-427` plain `return`s on short funds *or*
  existing warehouse). It must be paired with `hasWarehouse` for a truthful result — **31.6 GB**.

### Sizing target: ~32 GB per module

Home is **64 GB** (and BN3 charges 1.5× for home RAM upgrades), so the module table above is aspirational,
not currently runnable — `corp-office.js` at ~140 GB cannot load at all. Every module must therefore be
built at **≤ ~32 GB**, which is achievable throughout:

| Job | Split as | RAM |
|---|---|---|
| Open 6 offices | `corp-cities.js` (`expandCity`) | 21.6 GB |
| Buy 6 warehouses | `corp-warehouses.js` (`purchaseWarehouse` + `hasWarehouse`) | 31.6 GB |
| Assign jobs | `setJobAssignment` + `getOffice` | 31.6 GB |
| Hire / grow office | `hireEmployee` + `getOffice` | 31.6 GB |
| Morale | `buyTea` + `getOffice` (party split off separately) | 31.6 GB |

**And this is likely permanent, not a stopgap.** Corporation profit accumulates in *corporation funds*,
which are a separate pot from the player's wallet — it only reaches you after `goPublic()` +
`issueDividends()`. Combined with BN3 crushing every other income source, personal cash for home-RAM
upgrades stays scarce for a long while. Design for a 64 GB home and treat any headroom as a bonus.

**Corollary, and a repo-wide trap this rig surfaced:** the RAM walker resolves every identifier it
collects against the **entire `RamCosts` tree by bare name, ignoring namespace**
(`RamCalculations.ts:225-249`). A local helper named `probe` bills you `ns.dnet.probe`; one named
`research` bills **20 GB** for `ns.corporation.research`, in a script that never touches either
namespace. `corp-api.js` originally had a helper called `probe` for exactly this reason. Check locals
against the 535 leaf names in `RamCosts` before shipping — this matters most in the darknet crawler,
already on a knife-edge against 16 GB nodes.

---

## Gotchas the probe and the source caught

1. **`expandIndustry` includes a free Sector-12 office AND warehouse** (`Division.ts:93-101`;
   `createDivision` bumps `numberOfOfficesAndWarehouses` by 2). Don't pay for city #1 — expand to the
   *other five* and buy *five* warehouses. This is worth \$9b in round 1.
2. **`setJobAssignment` is relative, not absolute.** Calling it with 5 when 7 are assigned demotes 2 to
   Unassigned; calling it with 5 when 2 are assigned pulls 3 from Unassigned and **throws if there
   aren't enough**. The only safe use is: zero every job, then set every job. It also takes effect at
   the *next* START state, not immediately.
3. **Nearly everything requires an existing corporation.** `checkAccess` throws "Must own a
   corporation." — including `getIndustryData` and `getMaterialData`, which are otherwise pure constant
   lookups. Only `hasCorporation`, `canCreateCorporation`, and `getConstants` work before creation.
4. **In BN3, `Warehouse API` and `Office API` unlocks are granted free at corp creation**
   (`PlayerObjectCorporationMethods.ts:21`: `bitNodeN === 3 || activeSourceFileLvl(3) === 3`). Outside
   BN3 without SF3.3 they cost \$50b each. So we script from minute one — but any code that checks
   `hasUnlock("Warehouse API")` must not assume that holds in a future node.
5. **Purchased material always has quality 1, and it dilutes what's in the warehouse** during PURCHASE
   (`Quality = (Quality·Qty + BuyAmount) / (Qty + BuyAmount)`). This is why the Chemical support
   division is mandatory, not optional — see round 2.
6. **Warehouse congestion halts production silently.** If input materials fill the warehouse there's no
   space for output and `productionAmount` sits at 0 forever. Detect with a per-warehouse counter:
   `productionAmount === 0` for >5 consecutive cycles ⇒ congested. Mitigate by dumping (set sell price
   to `0`, which triggers a `1e12` markup multiplier and clears stock in one cycle).
7. **The published industry factor tables are stale.** Docs give Tobacco `robotFactor` 0.25; v3.0.1
   source says **0.2**. Always read factors from `getIndustryData()` at runtime.
8. **Sync the loop on `await ns.corporation.nextUpdate()`**, never a fixed `ns.sleep` — same discipline
   as `ns.gang.nextUpdate()`. It costs 0 GB.
9. **`getAscensionResult`-style undefined guards apply here too**: `Material.demand` / `.competition`
   and `Product.demand` / `.competition` are `undefined` unless the Market Research unlocks are owned.
   Our custom Market-TA2 needs both (5e9 each) — budget for them in round 3.
10. **`corp-state.txt` outlives the corporation it describes** [found 2026-09-07, in BN5]. Home files
   survive an augmentation install AND a BitNode jump; the corporation's divisions do not. The BN3
   state file (divisions `Agriculture/Chemical/Tobacco`, `roles.product: Tobacco`) was still on home
   in BN5, so the conductor would have launched `corp-product.js`/`corp-supply.js` at ghost divisions
   — each aborts, relaunches next cycle, spams the terminal. And it was *permanent*: `corp-status.js`
   preserved `roles` from the previous file without checking the named divisions still exist. Fixed
   three ways: `corp-status.js` drops roles naming divisions absent from `getCorporation().divisions`;
   the conductor treats a state file older than `STATE_MAX_AGE_MS` (10 min) as **no data** — the same
   rule its supply reports already followed — and `corp-supply.js`/`corp-product.js` apply the same
   freshness test before trusting `roles`. Also fixed while there: a *single*-division corp is no
   longer auto-claimed as `roles.material` when that division makes products (a product-first corp,
   possible outside BN3, must not inherit corp-supply's Agriculture-shaped defaults).
11. **Trim gated on the wrong minimum** [found 2026-09-12, in BN5]. `corp-boost.js --trim` started
   selling only when the least-over *material* in the least-over city cleared tolerance — so Real
   Estate arriving within 2% of target silently vetoed the whole trim while Hardware and AI Cores
   sat 25–30% of the warehouse over, production stalled at 100% full, revenue hit exactly \$0 (a
   stock-out, not a missing sell order — the flag in `corp-report.js` now knows the difference),
   and the script exited claiming "at target in every city". Fixed three ways: trim now gates
   **per material** (each sells only while its least-stocked city is over target), the DONE
   message admits when a material is still over, and the report's manual `corp-sell` suggestion
   lists only the over-target materials instead of all of them.
12. **A stale in-game copy can undo any of this** [the \$30b overbuy, 2026-09-12]. The runaway that
   bought boost materials to 97.5% of every warehouse was an old `corp-boost.js` running from the
   game's copy of the file — the current solver's targets always sum to `--total` (the mix is
   normalised) and `--max-total` refuses plans over 60%, so the running code *provably* wasn't
   this code. Same failure as the stale `dnet-step.js` in `SYNC-SETUP.md`: after any Remote API
   disconnect, reconnect (which force-pushes everything) **before** launching a resident script,
   and treat "a script did something its source can't do" as staleness until proven otherwise.
13. **Outside BN3, round 1 does not fund round 2** [BN5, `CorporationValuation` 0.75]. The round-1
   offer came to \$29.7b and the boost fill consumed all of it, where BN3's fatter offer paid for
   Export and the Chemical division too. The valuation haircut compounds: smaller offers, same
   price tags. Plan an earning plateau between the rounds — offices to 8 (the new hires default
   to R&D, which restarts the RP/quality climb), let profit accumulate to the \$20b Export unlock
   and then the Chemical division — or knowingly take the round-2 offer early at a discount.

---

## Decisions (locked with Sara, 2026-08-09)

- **Funding: SEED MONEY.** Free; the corp still starts with \$150b of funds, but the government
  permanently takes 500m shares (we own 1b of 1.5b = 66.7%). Self-funding would cost \$150b of personal
  cash for 100% ownership — indefensible in a node where hacking earns ~0.8% of normal. Per the FAQ,
  ownership percentage stops mattering once profit goes exponential. **Neither the government's nor
  investors' shares can ever be bought back** — only issued shares can.
- **Investment offers: CHECKPOINT EVERY ROUND.** The manager preps the corp to the round's target
  state, then **stops and prints the offer** for Sara to accept by hand. Same shape as `ascend.js`
  holding the install trigger behind `--install`: the script does the grinding, the human pulls the
  one-way lever. There are exactly 4 offers and a premature one permanently costs shares for less
  money.
- **Smart Supply: CUSTOM SCRIPT, not the \$25b unlock.** Skipping it takes the round-1 upgrade budget
  from \$40b to **\$65b** (+62%). The logic is well-specified and we can afford the complexity.
  - **SUPERSEDED once the unlock is owned (bought by round 3).** The trade was about round-1 budget,
    and it expires the moment there's cash. The game's own Smart Supply is strictly better than
    `corp-supply.js`: it recomputes `buyAmount` every PURCHASE state (`Division.ts:497-503`) and
    clamps to free space, so there is **no standing rate to go stale** — which is the one failure
    mode the custom controller cannot fix, because a jam correctly drives the rate to 0 and only a
    *live* controller ever raises it again. Field-confirmed: Agriculture/Aevum sat at 0 production
    with 78% free warehouse and no buy order.
  - **Owning the unlock does nothing on its own.** It must be enabled per division per city via
    `setSmartSupply` — `corp-smartsupply.js`. We paid \$25b and ran fully manual in all 12
    warehouses for an unknown number of hours. Check `warehouse.smartSupplyEnabled`, not
    `hasUnlock("Smart Supply")`.
  - Set `setSmartSupplyOption` to **`leftovers`** — field-corrected. `imports` looked right for
    an export-fed division, but it subtracts only the *flow* of arriving exports: when that flow
    dips to zero, Smart Supply buys the full requirement at quality 1, the stock stays high, the
    export formula goes negative, and the flow stays at zero. Seen live in Chemical/Ishima and
    Volhaven (Chemicals quality 411 and 290 vs 777 in healthy cities). `leftovers` subtracts the
    *stock*, so imported material already present suppresses the purchase.
- **Market-TA2: CUSTOM SCRIPT** once we're in round 3+. The research costs 75k RP total
  (Hi-Tech R&D Lab → Market-TA.I → Market-TA.II) and the official docs call reimplementing it "the
  best optimization in round 3+". We still buy the two Market Research unlocks (\$5b each) because our
  implementation needs `demand` and `competition`.
  - **SUPERSEDED once the research is owned — and this repeated the Smart Supply mistake exactly.**
    Market-TA.II is a research *and* a per-item flag (`setMaterialMarketTA2` per division/city/material,
    `setProductMarketTA2` per division/product), and the flag defaults to **off**. All three divisions
    owned Market-TA.I and Market-TA.II while every material still sold at plain `MP` and every product
    at a multiplier `corp-product.js` was hunting by experiment. Nothing in the rig had ever called
    either setter. **Check the flag, not `hasResearched`** — the same lesson as
    `warehouse.smartSupplyEnabled` vs `hasUnlock("Smart Supply")`, one section up.
  - The flag is **per item**, so every product `corp-product.js` finishes arrives with TA.II off and
    silently reverts to selling at `productionCost`. `corp-ta.js` is idempotent and `corp-conductor.js`
    re-asserts it on a timer for exactly this reason.
  - TA.I is deliberately never set: TA.II supersedes it wherever both are researched, so setting only
    the II flag is correct and saves 40 GB of two more charged functions.

---

## Round plan

**Round 1 — budget is exactly \$150b.**

| Item | Cost |
|---|---|
| Agriculture division | \$40b |
| `expandCity` × 5 (Sector-12 is free) | \$20b |
| `purchaseWarehouse` × 5 | \$25b |
| **Remaining for upgrades + boost materials** | **\$65b** |

Expand to all 6 cities — `productionMult` sums per-warehouse `cityMult`, so 6 cities is roughly a
**36×** production swing. Office 3→4, put all 4 on R&D until RP ≥ 55, then switch to
Operations/Engineer/Business/Management 1/1/1/1. Spend the rest on **Smart Storage** and warehouse
levels, plus 2 Advert. Then buy boost materials via per-second `buyMaterial` — **not `bulkPurchase`**,
which demands payment upfront; the per-second path can run us into debt, which is fine and intended.

**Round 2.** Buy `Export` (\$20b) first. Add a **Chemical** division as cheap support — minimal office,
no Advert, exactly 1 warehouse upgrade. Agriculture office to 8. Then *wait* for RP (~700 Agriculture /
~390 Chemical); waiting is free and quality is what makes output sellable.

**Round 3+.** Add **Tobacco**, export Plants in from Agriculture. The loop becomes: buy Wilson when
affordable → ≥20% of funds into Advert → develop a new product continuously → upgrades → repeat.
Prioritise **Engineer** in support divisions (it dominates `MaxOutputQuality` once offices are big).
Never deplete the RP pool, especially right before a product completes. Dummy Restaurant divisions
(\$10b, 6 cities + 6 warehouses, nothing else) inflate `numberOfOfficesAndWarehouses`, which is the
exponent in the valuation formula — cheap offer inflation once funds allow.

---

## The control loop (spec)

Guard: `if (!ns.corporation.hasCorporation()) { … }` — costs 0 GB, works with no corp, the top guard
exactly like `ns.gang.inGang()`.

The conductor loops on `const state = await ns.corporation.nextUpdate()` and dispatches by state:

1. **START** → `corp-office.js`: tea/party if energy or morale below ~99.5, hire to office size, rebalance
   jobs (zero-then-set). Also the cheap place to re-read `getCorporation()` into the state file.
2. **PURCHASE** (just happened) → `corp-supply.js` *phase B*: record `TotalRawProduction` per
   `division|city` for next cycle's sizing.
3. **PRODUCTION** → idle; congestion detector ticks here off `productionAmount`.
4. **EXPORT** → `corp-price.js`: compute and set optimal sell prices before SALE.
5. **SALE** → `corp-upgrade.js` (throttled, every N cycles): Smart Storage / Smart Factories / warehouse
   levels / Wilson / Advert / research / unlocks, against a funds reserve.

Smart Supply *phase A* (the actual buy) must land **before** PURCHASE, i.e. on the START tick.

> **Needs field confirmation:** whether `nextUpdate()` resolves *before* or *after* the named state is
> processed, and whether a 2-second state window (10s cycle ÷ 5 states) is enough to `run()` a module and
> have it finish its work. `CorporationInfo.prevState` / `.nextState` disambiguate — the docs say when
> `prevState` is PURCHASE, purchasing *just happened*. First thing to verify in the field, because the
> whole schedule hangs off it. If the window turns out to be too tight, fall back to keeping
> `corp-supply.js` resident rather than re-launching it each cycle.

**Bonus time**: `getBonusTime()` (0 GB) reports banked accelerated ms, during which a cycle takes 1s
instead of 10s. Worth reading for the status line and, later, for holding big reassignments until it's
banked.

**Status line**, in the commander's voice: funds, revenue − expenses, valuation, \$/sec, per-division RP
and awareness/popularity, product development %, and the round-N checkpoint banner when an offer is
ready.

---

## Tuning constants (top of file, overridable by argv where sensible)

`ROUND` (which round plan to execute), `KEEP_FUNDS` (corp funds reserve before discretionary upgrades),
`TEA_BELOW` / `MORALE_BELOW` (default 99.5), `PARTY_COST_PER_EMPLOYEE` (default 500e3),
`UPGRADE_EVERY` (cycles between upgrade passes), `ADVERT_FUNDS_FRACTION` (0.20 in round 3+),
`DESIGN_INVEST_FRACTION` / `MARKETING_INVEST_FRACTION` (0.01 each — the exponent is 0.1, they scale
terribly), `CONGESTION_STRIKES` (5), `RP_RESERVE_FRACTION` (never spend research below this).

---

## Coexistence notes

- Runs from `home`. Independent of `commander.js`, `stock-trader.js`, `gang-manager.js`, and the
  darknet rig — but **not** RAM-free, unlike the gang. The conductor should refuse to launch a module
  that won't fit rather than thrash, and log the shortfall the way `boot.js` does.
- `reset-scripts.js` spares `stock-trader.js`; the corp conductor should be spared too. **Corporation
  progress survives an augmentation install** (like the gang), so killing and restarting it is pure
  churn.
- `boot.js`: add `{ script: "corp-conductor.js", args: [], when: hasCorporation }` to `STACK`, with a
  guard that treats a thrown API error as "no" — same `safe()` wrapper as `inGang` / `hasSleeves`.
- Home RAM is 1.5× cost in BN3, and the corp modules want ~145 GB peak on top of the existing stack.
  Expect `commander.js`'s `HOME_RESERVE_GB` to need raising.

---

## Not in v1 (later)

- The office-assignment **optimizer** (Raw production / Progress / Profit / Profit-Progress setups).
  v1 spreads employees evenly across non-R&D jobs, which the official docs explicitly bless as
  "not optimal, but you can still reach the endgame."
- **Product markup recovery** via Ceres solver. v1 uses the empirical trick instead: set an absurd
  price for one cycle, read `actualSellAmount`, solve `MarkupLimit` backwards, and cache it —
  `ProductMarkup` never changes for a given product.
- The **boost-material Lagrange optimizer** (closed-form solution exists in the official docs, including
  the recursive handling of negative quantities at small warehouse sizes). v1 uses a fixed sensible split.
- ~~`bribe()` for faction reputation~~ — **built: `corp-bribe.js`.** Once valuation ≥ 100e12, funds
  convert to reputation at 1e9 per point, no cooldown and no cap. This is the answer to BN3's real
  wall: the 3× `AugmentationMoneyCost` you can out-earn, the 3× `AugmentationRepCost` you cannot,
  because reputation comes from working in real time. It is also the only tap that does **not**
  require going public. Feeds `ascend.js`. The `bribe(factionName, amountCash)` signature is taken
  from the v3.0.1 surface and has **not** been confirmed by a live call — the script checks the
  return value and passes any throw through verbatim, per the "only a call proves callability" rule.
- ~~`issueDividends()`~~ — **built: `corp-dividend.js`.** `goPublic()` deliberately stays manual: it
  is one-way and a public corporation can never take an investment offer again. The dividend *rate*
  is not one-way — it is a dial you can move every cycle — which is exactly why it is safe to script
  and `goPublic` is not. Note the penalty: `TributeModifier = 1.15 − CorporationSoftcap`, and BN3's
  softcap is 1, so we pay the *minimum* 0.15 and dividends come out as `(…)^0.85`. The script does
  not model that — `getCorporation()` reports `dividendEarnings` and `tributeModifier` directly.
