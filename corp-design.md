# corp-design.md — the *why* for the corporation rig

A corporation-automation rig for Bitburner 3.0.1, and the point of BitNode 3. Sibling to
`gang-manager.js` and `stock-trader.js`: a **separate income stream** that runs alongside
`commander.js`. Unlike the gang, it is **not** RAM-free — the corporation API is the most
expensive namespace in the game, and that cost drives the entire architecture (see
[The RAM wall](#the-ram-wall)).

Written after probing the **live** game with `corp-api.js` (throwaway; delete after use).
Everything below is confirmed against the running game on **2026-08-09**, or read out of the
**v3.0.1 release tag** — not the dev branch, which historically runs ahead.

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
  - Set `setSmartSupplyOption` to **`imports`** on any division fed by exports, or Smart Supply
    buys what a sister division is already sending — at quality 1, diluting the exact material the
    support division exists to make properly.
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
