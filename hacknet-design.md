# hacknet-design.md — the *why* for the hash economy in **BitNode 9**

**Context: written during Sara's BN9 "Hacktocracy" run (2026-09-02 → 09-07, holding SF1.3 / SF2.3
/ SF3.3 / SF4.3 — no SF5, no SF9 at the time). She exited with SF9.1 and moved to BN5; this doc
becomes current again on the return trip for BN9.2.**

Tags: **[LIVE]** confirmed in the running game (probe run 2026-09-02, see `hacknet-api.js`);
**[SRC]** read from the **v3.0.1 release tag**; **[OPEN]** nobody has checked.
The running game outranks the tag — that's why the probe exists.

---

## Correction, kept on the record

An earlier draft of this document said BN9 sets `HacknetNodeMoney` to **0.1** and that hash
production therefore ran at a tenth. **That was wrong.** The key is **not present in BN9's multiplier
object at all** — it defaults to 1.0. The nodes that do set it are 4 (0.05), 5 (0.2), 6 (0.2),
10 (0.5) and 11 (0.1); **9 does not** [SRC].

The error came from asking a documentation fetcher a *leading* question ("state the value for both
node 3 and node 9"), which supplied a number rather than pushing back. Worth remembering as a
research failure mode distinct from the ones already in `AGENTS.md`: not a stale doc, not a
tombstone — **a question whose phrasing presupposed the answer.**

The live data killed it independently. See the calibration below.

---

## The calibration — and why no script here needs Formulas.exe

The gain formula, confirmed [SRC: `src/Hacknet/formulas/HacknetServers.ts`]:

```js
baseGain       = HashesPerLevel * level          // HashesPerLevel = 0.001
ramMultiplier  = Math.pow(1.07, Math.log2(maxRam))
coreMultiplier = 1 + (cores - 1) / 5
ramRatio       = 1 - ramUsed / maxRam
rate = baseGain * ramMultiplier * coreMultiplier * ramRatio * mult * currentNodeMults.HacknetNodeMoney
```

Sara's starter server [LIVE]: `level 100, ram 1, cores 10, ramUsed 0, production 0.3587584`.

```
un-multiplied = 0.001*100 * 1.07^log2(1) * (1 + 9/5) * 1 = 0.28
solved multiplier = 0.3587584 / 0.28 = 1.28128
```

**1.28** is exactly SF1.3's +28% to all multipliers ~~with nothing else in it~~ — *correction,
2026-09-07*: the solved figure was 1.28**128**, and 1.28 × 1.001 = 1.28128 exactly. The extra
factor is **SF-1 (Exploits)**: each found exploit multiplies every positive player multiplier by
1.001 [SRC: `applyExploits.ts`, `1.001^exploits.length`], and Sara had one exploit at the time
(three as of 2026-09-07 → ×1.003003). The calibration approach absorbed it without anyone knowing
it existed — which is the argument for solving the multiplier from live data restated. Had BN9
applied 0.1, her player multiplier would have to be **12.81**. Independently corroborated by hardware pricing: a
second server quotes $124,875 against a base of `50e3 × 3.2 = $160,000`, a cost multiplier of
0.78047 ≈ 1/1.28 [LIVE].

That calibration is the design decision behind `hacknet-scan.js`: it implements the formula locally
and **solves the trailing multiplier from live production**, so it needs no `Formulas.exe`, costs no
RAM for it, and captures player, Source-File and BitNode effects at once with no table to drift.
It prints the solved figure so the model is always auditable — if it stops matching your SF bonus,
the script is wrong and says so.

*(`Formulas.exe` is granted at the start of **BitNode 5**, on `canAccessBitNodeFeature(5)` [SRC] — so
SF5 would hand it to you at the start of every node thereafter. Worth knowing; not needed here.)*

---

## What BN9 actually does to you [SRC: `BitNode.tsx` case 9]

| Multiplier | BN9 | Consequence |
|---|---|---|
| `CloudServerLimit` | **0** | **No purchased servers, at all.** Confirmed [LIVE]: `getServerLimit()` → 0. |
| `ServerMaxMoney` | **0.01** | |
| `ScriptHackMoney` | **0.1** | Together: hacking income ≈ **0.1% of normal**. |
| `HackExpGain` | **0.05** | XP at a twentieth; levelling is glacial. |
| `HackingLevelMultiplier` | 0.5 | Effective hacking skill halved on top. |
| `HomeComputerRamCost` | **5** | Home RAM — now the main compute lever — costs 5×. |
| `ServerStartingMoney` / `ServerStartingSecurity` | 0.1 / 2.5 | |
| `DarknetMoneyMultiplier` | **0.05** | The `dnet-*` rig earns 5%. Off duty this node. |
| `CrimeMoney` | 0.5 | |
| `CorporationValuation` / `CorporationSoftcap` / `CorporationDivisions` | 0.5 / **0.75** / 0.8 | Barely touched. |
| `GangSoftcap` / `GangUniqueAugs` | 0.8 / 0.25 | Gang still works. |
| `FourSigmaMarketDataCost` / `ApiCost` | 5 / 4 | The 4S unlock costs 4–5×. |
| `WorldDaemonDifficulty` | 2 | |
| `HacknetNodeMoney` | **absent → 1.0** | **No hacknet penalty.** See the correction above. |
| `CodingContractMoney` | **absent → 1.0** | **Contracts pay full price.** |

That last row is the standout. In a node where hacking pays 0.1% and the darknet pays 5%, coding
contracts pay **100%** — and `contract-finder.js` already solves ~22 types network-wide. That makes
contracts a *lever worth pulling*, though not an explanation for income when nothing is running.

**A note on the probe's own numbers:** it reported `homeRamGB: 32, homeUsedGB: 11.65`, and the probe
itself measured 11.65 GB — so at that moment **nothing else was running on home**. Any money arriving
in that state is not script income. `money-sources.js` reads the game's own ledger and settles it.

BN9 also grants the starter Hacknet Server on entry — **level 100, 10 cores, cache 5** [SRC:
`Prestige.ts`], which matches `getNodeStats(0)` exactly [LIVE].

---

## The API [LIVE, 2026-09-02]

**21 of 21 expected methods present. Zero tombstones. Zero undocumented extras.** All eight
speculative names came back `undefined`. `ns.hacknet` did not move in the v3 reorg.

The top-level dump did catch **11 tombstones** sitting on `ns` — `purchaseServer`,
`getPurchasedServers`, `getPurchasedServerCost`, `getPurchasedServerLimit`,
`getPurchasedServerMaxRam`, `getPurchasedServerUpgradeCost`, `upgradePurchasedServer`,
`renamePurchasedServer`, `deleteServer`, `getServerRam`, `tail`, plus the number formatters
(`formatNumber`, `formatRam`, `formatPercent`, `nFormat`, `tFormat`) and `getTimeSinceLastAug`.
Every one passes `typeof x === "function"` and throws when called. This is the definitive list for
the compatibility table in `README.md`.

Also newly noticed and immediately useful: **`ns.getFunctionRamCost`** and **`ns.getMoneySources`**.
`ram-costs.js` and `money-sources.js` exist because of them.

---

## The shop [LIVE — all 11 names and costs confirmed against source]

Cost model [SRC: `HashUpgrade.getCost`]: a flat `cost` field never escalates; otherwise the **n-th**
purchase costs `costPerLevel × n`. Confirmed live by the `hashCost(name, 5)` column.

| Upgrade | Cost | Effect | Target |
|---|---|---|---|
| **Sell for Money** | **flat 4** ✔ live | $1,000,000 | — |
| Sell for Corporation Funds | 100 × n | $1e9 corp funds | — (needs a corp) |
| Reduce Minimum Security | 50 × n | ×0.98 min security, floor 1% | **server** |
| Increase Maximum Money | 50 × n | ×1.02 max money, soft cap over $10t | **server** |
| Improve Studying | 50 × n | +20% university exp | — |
| Improve Gym Training | 50 × n | +20% gym exp | — |
| Exchange for Corporation Research | 200 × n | 1,000 research | — |
| Exchange for Bladeburner Rank | 250 × n | +100 rank | — |
| Exchange for Bladeburner SP | 250 × n | +10 SP | — |
| **Generate Coding Contract** | **25 × n** | 1 contract | — |
| Company Favor | 200 × n | +5 favor, persists until new BitNode | **company** |

`hashCost(name, 5)` returned exactly `20` for Sell for Money and `costPerLevel × 15` for everything
else — the flat-vs-escalating model is confirmed live, both branches.

### The numeraire

**Sell for Money is 4 hashes for $1,000,000, flat, forever — $250,000 per hash, unlimited.** Every
other upgrade is priced against it throughout the scripts.

**Sell for Corporation Funds** is worth `$1e7 / n` per hash, so it beats the floor until **n = 40**:
the first 40 purchases are **82,000 hashes for $40b of corporate funding**, and after that plain
selling wins permanently. Founding a corp outside BN3 needs $150b of your own money first
(`canCreateCorporation(false)` → `UseSeedMoneyOutsideBN3`), so this is a mid-game pivot, not an
opening move.

---

## Overflow is auto-sold, not lost — second correction

An earlier draft of this section called the full bank an urgent leak destroying $89,690/sec. **Wrong
again, and in the same way: I reasoned from `HashManager.storeHashes` returning a `wastedHashes`
value without reading its caller.** The caller converts it:

```js
const wastedHashes = Player.hashManager.storeHashes(hashes);   // [SRC] HacknetHelpers.tsx
if (wastedHashes > 0) {
  const upgrade = HashUpgrades[HashUpgradeEnum.SellForMoney];
  const multiplier = wastedHashes / upgrade.cost;
  if (multiplier > 0) Player.gainMoney(upgrade.value * multiplier, "hacknet");
}
```

Overflow is auto-sold at `value/cost = 1e6/4` — **exactly the $250,000/hash floor**, credited to the
`"hacknet"` money source. A full bank costs you **nothing** if selling was the plan. It costs you
only the *difference* against a better sink.

**This is confirmed by the ledger** [LIVE]: `money-sources.js` reported `hacknet $266.84m`, which at
$250k/hash is ~1,067 overflowed hashes — matching the 804 implied at probe time plus ~12 minutes of
continued full-bank production. **That is where the money was coming from**, with no scripts running
at all.

The practical consequences invert the earlier advice:

- **There is no urgency to spend.** The floor rate is being collected automatically, forever.
- **Cache is only worth buying to reach a sink that beats $250k/hash** — Sell for Corporation Funds
  (up to 40×), or a compounding server upgrade. Cache buys the *option* to save up, nothing else.
- `hacknet-scan.js` still computes `produced − held − spent`, but reports it as **auto-sold** with
  the dollars it generated, not as waste.

---

## Hardware: what to actually buy

### Correction: the RAM cost model (third fragment-reading error)

An earlier version of this section claimed maxing RAM cost **$30.6m total**. Wrong, and badly. I read
a summary of the cost function saying *"baseCost * mult, where mult uses `Math.pow(UpgradeRamMult,
numUpgrades)`"* and assumed `baseCost` was the constant `RamBaseCost`. **It is scaled by the server's
current RAM.** Both live quotes pin it exactly:

```
ramUpgradeCost = RamBaseCost(200e3) x currentRam x 1.4^log2(currentRam) x costMult
   ram   1 -> 2   : 200e3 x   1 x 1.4^0 x 0.78047 = $156,094      <- matches live
   ram 128 -> 256 : 200e3 x 128 x 1.4^7 x 0.78047 = $210,616,181  <- matches live
```

So **each doubling costs x2.8 and returns x1.07**. RAM is spectacular early and turns hostile fast.
Going 128 -> 8192 GB now costs **$56.3b** for +0.288 hash/s — a **9-day** payback.

What was and wasn't affected: `hacknet-scan.js` reads every price live through `getRamUpgradeCost`,
so its ranking was always right. Only the hand-arithmetic in this document was wrong. **Prefer the
script's numbers to any table written here.**

The *gain* model, meanwhile, survived its real test: it predicted 0.5761 hash/s for
`level 100, ram 128, cores 10` and the game displayed **0.576**.

### The ranking at 128 GB [LIVE, 2026-09-02]

Current rate **0.5761 hash/s = $144,022/sec**. Getting here from 1 GB cost ~$117m and paid back in
about 36 minutes — a good buy. What comes next is a different story:

| Purchase | Cost | Gain | Payback at $250k/hash |
|---|---|---|---|
| new server #2 (starts 1/1/1) | $124,875 | +0.00128 hash/s | **6 min** |
| **cores 10 → 11** | **$40,303,318** | +0.04115 hash/s | **65 min** |
| ram 128 → 256 GB | $210,616,000 | +0.04033 hash/s | 5.8 h |
| level 100 → 101 | $5,378,000,000 | +0.00576 hash/s | 43 days |
| cache 5 → 6 | $117,135,062 | +0 hash/s | never (bank ceiling only) |

**Cores have overtaken RAM.** Both give roughly the same absolute gain per step, but cores escalate
at x1.55 against RAM's x2.8. Each core adds a flat +0.04115 hash/s (coreMultiplier rises by exactly
0.2 per core), so the payback walks up gently: 65 min, then 101, then 156. Going 10 -> 20 cores costs
~$5.79b and takes the server to 0.988 hash/s — a 15.6-hour payback overall.

New servers have the best payback of anything, but read it carefully: it is a **tiny absolute gain**
($320/sec) on a **tiny price**. Each costs x3.2 more than the last, so #2 pays back in 6 min, #3 in
21, #4 in 67, #5 in 3.6 h. Buy the first few because they are nearly free, not because they matter.

Two structural notes:

- **Levelling is a trap on this machine.** Level cost is `10 × 50e3 × 1.1^level × costMult`, and the
  starter arrives at **level 100** — so `1.1^100 ≈ 13,780×` base. Verified against the live quote to
  the dollar. Base gain per level is only 0.001, so you are paying $5.4b for +1% of a small number.
- **New servers start at 1/1/1** and produce 0.0013 hash/s against the starter's 0.359 — 280× worse.
  They are cheap and their ROI is fine in isolation, but the starter server is the asset here.
  `PurchaseMult 3.2` means each additional one costs 3.2× the last.

---

## The central tension: RAM you use is hashes you don't get

`ramRatio = 1 − ramUsed/maxRam` means hash output scales with **free** RAM, and `CloudServerLimit: 0`
means hacknet servers are the only compute you can buy. Currently clean [LIVE]: `ramUsed 0`, nothing
running on `hacknet-server-0`.

**It did not stay clean by itself — but it failed loudly, which we got lucky on.** Running
`commander.js` in BN9 crashed immediately:

```
RUNTIME ERROR
getServerMaxMoney: Cannot be executed on hacknet-server-0. The server must not be a hacknet server.
  commander.js:L578@rankTargets  <-  L326@ensureFleets  <-  L177@main
```

`scanAll` walks the network from home, hacknet servers are **real hosts** that `ns.scan` returns, and
`rankTargets` then asked one how much money it holds. The game refuses that call outright.

**Fixed** [2026-09-02]: `scanAll` now takes an exclusion set and `hacknetHosts(ns)` supplies it,
reading hostnames from `ns.hacknet.getNodeStats` rather than matching a `hacknet-server-` prefix
(authoritative, survives a rename, and correctly returns nothing on a hacknet-NODE save). One change
covers `rootAll`, `rankTargets`, `worldHosts` and `farmIdleRam` at once. It costs commander 1.0 GB
and prints the exclusion when the count changes.

Note the luck: the crash is the *good* outcome. Had `getServerMaxMoney` merely returned 0, the
commander would have silently parked batcher workers on the hacknet and paid for them in hashes,
with nothing in any log to say so. That was the failure mode this document warned about, and it
would have been invisible.

Note the interaction with maxing RAM: at 8192 GB, a batcher borrowing 512 GB costs only 6% of that
server's output. RAM upgrades make the machine *both* a better generator and a cheaper host.

---

## RAM is this node's real currency [LIVE]

**Every single `ns.hacknet.*` function costs 0.50 GB** — all 21 of them, so the whole namespace is
10.5 GB. That is the answer to why a read-only probe weighed 11.65 GB: 15 hacknet mentions (7.5) +
`getResetInfo` (1.0) + `cloud.getServerNames` (1.05) + `ps` (0.2) + small change + 1.6 base = 11.65,
to the decimal. No collision — the namespace is simply expensive, and any hacknet script should be
budgeted at half a gig per distinct function it names.

Other prices worth remembering [LIVE, `ns.getFunctionRamCost`]: `corporation.research` **20 GB**,
`corporation.getCorporation` and `codingcontract.attempt` **10 GB**, `singularity.getOwnedAugmentations`
5, `getBitNodeMultipliers` 4, `sleeve.getTask` 4, `share` 2.4, `getServer` 2, `cloud.getServerNames`
**1.05** (vs 0.05 for `getServerLimit`). All of `ns.formulas.*` is **0 GB**.

### And it immediately caught one of ours

`hacknet-spend.js` measured **16.70 GB** against ~6.7 GB of honest usage. The extra **10 GB** was a
local helper named **`attempt`**, which the walker resolved by bare name to `ns.codingcontract.attempt`
in a script that has nothing to do with contracts. Renamed to `invoke`. This is the trap `AGENTS.md`
has warned about since the darknet crawler — and it was written *into a file whose own header
documents the trap*. The lesson isn't "be careful", it's **measure every script with `ram-costs.js`
before trusting its size**, because reading the code will not show you this.

---

## Open questions

| # | Question | Answered by |
|---|---|---|
| ~~1~~ | ~~Why does `hacknet-api.js` cost 11.65 GB?~~ | **ANSWERED** — 0.50 GB per hacknet function |
| ~~2~~ | ~~Where is the money coming from?~~ | **ANSWERED** — auto-sold hash overflow, $266.84m |
| 3 | What does one `Generate Coding Contract` actually pay, and how often is it money vs rep? | `hacknet-spend.js "Generate Coding Contract" --go`, repeated |
| 4 | Do the target requirements hold live? | `hacknet-spend.js --discover --go` |
| 5 | Is `hashCapacity = 32 × 2^cache`? (cache 5 → 1024 fits) | one cache upgrade, then `hacknet-scan.js` |
| ~~6~~ | ~~Making `commander.js` leave hacknet RAM alone~~ | **DONE** — `scanAll` now excludes them |

---

## Next, in order

1. **Buy cores on the starter server**, and a couple of cheap extra servers alongside. Cores are
   ~65 min payback and escalate gently (x1.55); RAM has flipped to 5.8 h and escalates at x2.8.
2. `run hacknet-scan.js` after each batch — it re-solves the multiplier and re-ranks against **live**
   prices. Trust it over any table in this document; the tables here have been wrong twice.
3. **No urgency on the bank.** Overflow auto-sells at the floor. Decide a sink only when one beats
   $250k/hash.
4. Then decide the shape: keep selling, pump a hacking target with Increase Maximum Money, or bank
   toward the $150b that founding a corporation needs.
