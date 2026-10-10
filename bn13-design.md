# bn13-design.md — BitNode 13 ("They're lunatics") and Stanek's Gift, the *why*

Same contract as `bn10-design.md` / `bn6-design.md`: every claim is tagged **[SRC]** (read from the
`v3.0.1` tag), **[LIVE]** (confirmed in the running game) or **[OPEN]**. The running game outranks
everything here.

> **Position (2026-10-03): entered BN13.1.** Holding SF 1.3 / 2.3 / 3.3 / 4.3 / 5.3 / 6.2 / 9.1 /
> 10.1 [LIVE, `stanek-api.js`]; 6 sleeves (1 from SF10.1 + 5 bought from the Covenant). Route chosen:
> **Bladeburner**, carried by the sleeves the way BN6.2 was. Stanek's Gift **accepted** [LIVE].

## 1. The node [SRC: BitNode.tsx case 13]

Everything the repo already does is crushed; the gift is what the node hands you instead.

| lever | mult | so what |
|---|---|---|
| HackingLevelMultiplier · HackExpGain · ScriptHackMoney | **0.25 · 0.1 · 0.2** | the hacking rig barely earns; the World Daemon route is hard |
| ServerMaxMoney · ServerStartingSecurity | 0.3375 · 3 | |
| Str/Def/Dex/Agi LevelMultiplier | 0.7 each | combat grows slower — the gift's combat fragments make it up |
| Crime / Company / Hacknet / Contract money | 0.4 each | |
| Class/Gym, Company, Crime, Faction work exp | 0.5 each | |
| FactionWorkRepGain | 0.6 | |
| **CorporationValuation** · Softcap · Divisions | **0.001** · 0.4 · 0.4 | the corp rig is dead here |
| BladeburnerRank · BladeburnerSkillCost | 0.45 · 2 | the chosen route, at about half speed |
| GangSoftcap · GangUniqueAugs | 0.3 · 0.1 | |
| DarknetMoneyMultiplier | 0.1 | |
| **StaneksGiftPowerMultiplier · StaneksGiftExtraSize** | **2 · +1** | the node's one gift |
| WorldDaemonDifficulty | 3 | |

## 2. The one-way door [SRC: CotMG/Helper.tsx:59-74]

`canAcceptStaneksGift()` refuses if you own **or have queued** any augmentation other than NeuroFlux
Governor. Buy one aug before accepting and the gift is gone for the node. Accepting joins the Church
of the Machine God and installs "Stanek's Gift - Genesis" [SRC: NetscriptFunctions/Stanek.ts]. The
ns call does not check your city, so `ns.stanek.acceptGift()` works from anywhere. [LIVE 2026-10-03:
accepted, Genesis installed, CotMG joined.]

## 3. The gift

- **Grid** [SRC: StaneksGift.ts:24-33]: `base = 9 + StaneksGiftExtraSize + SF13 level`;
  `width = floor(base/2 + 1)`, `height = floor(base/2 + 0.6)`, between 2x3 and 25x25. BN13.1 → **6x5**
  [LIVE: matches]. With SF13.1, base 11 gives **6x6** in BN13; outside BN13 (no extra size) base
  10 gives 6x5.
- **Fragments** [LIVE: 24 definitions, `stanek-api.js` dump]: 16 effect fragments (tetrominoes,
  limit 1 each; power 0.4–10) and 8 boosters (pentominoes, power 1.1, limit 99). Powers that
  matter: work money **10**, charisma 3, combat stats / hack power / crime 2, hack speed 1.3,
  hacking skill 1, rep and grow 0.5, **Bladeburner 0.4**. `type` comes back as a number (18 = booster).
- **Effect** [SRC: StaneksGift.effect, CotMG/formulas/effect.ts]:
  `1 + ln(highestCharge+1)/60 × ((numCharge+1)/5)^0.07 × power × boost × StaneksGiftPowerMultiplier`.
  `boost` multiplies the power of each **distinct** booster touching the fragment (4-neighbour,
  `Fragment.neighbors`). Boosters have no effect of their own. **[LIVE 2026-10-03, to 4 decimals]**:
  strength at highest 8, numCharge 7, power 2, one booster → `1 + ln(9)/60 × (8/5)^0.07 × 2 × 1.1 × 2`
  = x1.1665, as shown; two boosters (agility, dexterity) x1.1832/x1.1815, defense at 6 charges x1.1650,
  Bladeburner (power 0.4) x1.0333. All five match.
- **Charging** [SRC: NetscriptFunctions/Stanek.ts]: `chargeFragment(x, y)` takes 1s (0.2s in bonus
  time) and charges with **the calling script's threads × that host's core bonus**
  (`1 + (cores-1)/16`). `highestCharge` is the largest single call, and it sits inside a log, so
  **one big script beats many small ones**. Smaller calls still add `threads/highest` to `numCharge`.
  Each charge also pays CotMG rep: `faction_rep × threads^0.95 × (favor+100)/1000`.
- **Installs** [SRC: StaneksGift.prestigeAugmentation]: an augmentation install **clears every charge**
  but keeps the placement. A BitNode change clears the gift entirely.
- **Sleeves** [SRC: StaneksGift.updateMults; Augmentations.ts:2070]: a sleeve only gets the gift's
  bonuses with the **Z.O.Ë.** sleeve aug ($1t), scaled by `3/(Z.O.Ë. sleeves + 2)`: one sleeve gets it
  all, six get 37.5% each (2.25 sleeves' worth in total). [OPEN: how Z.O.Ë. is offered — it has no
  faction and infinite rep cost; probably via `getSleevePurchasableAugs` once the gift is accepted.]
- **RAM** [SRC: RamCostGenerator.ts:63-73, 422-434]: every Stanek call is 0–5 GB; the API is clean
  [LIVE: 11 of 11 documented methods, nothing extra].

## 4. The route: Bladeburner

- **The API works here.** `getBladeburner()` allows `canAccessBitNodeFeature(7) ||
  canAccessBitNodeFeature(6)` [SRC: NetscriptFunctions/Bladeburner.ts:35], and SF6.2 qualifies, so
  `bb-conductor.js` runs your own actions. Sleeve Bladeburner work goes through the sleeve API and
  needs only membership (`sleeve-manager.js` `bb` role).
- **The layout.** `stanek.js plan --plan bb` places strength, defense, dexterity, agility and the
  Bladeburner fragment with two boosters on the 6x5 grid. All five fit, and the game accepted all 7
  `placeFragment` calls first time [LIVE 2026-10-03], so stanek-lib's rotation/root geometry is the
  game's. The Bladeburner fragment's power is only 0.4, so even boosted it adds ~5% at today's charge.
  The combat fragments (power 2) are where the value is.
- **Charge scale.** At 32 GB / 1 core (BN13.1 start [LIVE]), the charger runs ~14 threads →
  ~x1.25 per combat fragment. Every 10x threads adds ~+0.22 at power 2 (x2 node mult). Home RAM and
  cores are the lever, and installs reset charges, so re-charge after each one.

## 5. Tools

| file | what |
|---|---|
| `stanek-api.js` | throwaway probe: surface, the one-way door, grid, fragment table, charge curve |
| `stanek-lib.js` | pure geometry + scoring + layout search (branch and bound) |
| `stanek-lib.test.mjs` | Node spec on the live fragment table — geometry, scoring, every plan |

**The search is exact, not heuristic** [verified 2026-10-03]. The branch-and-bound found the same
best score as an exhaustive search (`bestLayout({prune: false})`) on all four plans on the live 6x5
table. bb took 60k nodes against 152m (222s), combat 33k/97m, hack 1.0m/72m, money 169k/44m. The first
bound was *not* admissible: it assumed the remaining fragments always go in before boosters, and
pruned the hack and money optima, which drop a light fragment to fit more boosters around a heavy one.
The bound now takes the best over every future booster count (a small knapsack). Re-run that check
if the scoring or the bound changes, or on a bigger grid.
| `stanek.js` | `show` · `plan` · `place --yes` · `charge` |
| `stanek-charge.js` | 2 GB/thread worker, coordinates passed in as arguments |
