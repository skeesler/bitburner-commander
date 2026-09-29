# bn3-runbook.md — the BN3 game loop, in plain language

The *why* for the corporation rig lives in `corp-design.md`. This is the *how*: what the loop
actually is, what you press, and in what order. Same split as `darknet-design.md` / `dnet-runbook.md`.

If you're reading this because your warehouses are full and you've earned nothing — skip to
[**Right now: the one-minute fix**](#right-now-the-one-minute-fix). Come back for the rest after.

---

## Right now: the one-minute fix

**You have earned nothing because you never placed a sell order.** That is not a bug in the rig and
it isn't something you missed in a menu — in Bitburner, a material's *sell amount defaults to zero*.
A division can be fully staffed, fully stocked, and producing at full tilt while revenue sits at
exactly `$0.00/s` and the output piles up until the warehouse jams. There is no default and nothing
warns you.

`corp-sell.js` is the switch. It's 21.6 GB and takes about five seconds to run.

**Do this, in this order** (~2 minutes, plus a minute of watching):

```
run corp-status.js            # what do I actually have? also refreshes corp-state.txt
run corp-buy.js --show        # what's stored, what's flowing, what's stuck
run corp-sell.js              # <-- THE MONEY SWITCH: sell Plants + Food at market price, all 6 cities
```

Then wait one cycle (~10 seconds) and run `corp-status.js` again. The `revenue:` line should no
longer be zero.

**If `--show` says `prod 0.00` in several cities**, the warehouses are congested — full of stuff, no
room to make more, production silently halted. Unjam them:

```
run corp-sell.js --materials "Plants,Food" --price 0    # dump: price 0 forces a ~1e12 markup, clears in one cycle
```

Wait one cycle, watch the stored numbers collapse, then **immediately restore sane pricing**:

```
run corp-sell.js                                        # back to market price
```

> ⚠️ **Only ever dump your *output* materials** (Plants, Food). Do **not** dump Real Estate, Hardware,
> Robots or AI Cores — those are boost materials, they're supposed to sit in the warehouse forever,
> and they're a large part of why you produce anything at all. If they're what's filling your
> warehouses, the answer is `corp-warehouse-upgrade.js`, not a fire sale.

**If you're still buying inputs faster than you consume them**, that's the other half of the jam.
`corp-buy.js` sets a **per-second** rate that runs *forever* until cleared — enter `10` and you get
100 units every 10-second cycle for the rest of time. Turn it down or off:

```
run corp-buy.js --clear                        # stop buying Water + Chemicals entirely
run corp-buy.js --mix "Water=6,Chemicals=2.4"  # or just ease off (keep the 5:2 ratio)
```

**The rule to remember: sell orders before purchase orders, always.** If inputs arrive while outputs
have nowhere to go, you get a congestion stall instead of money.

### Then hand it over and stop hand-tuning

Once revenue is flowing, start the conductor and you never have to think about buy rates again:

```
run corp-conductor.js
tail corp-conductor.js       # watch it work
```

It keeps `corp-supply.js` resident (which sizes every input purchase for you, every cycle, in every
city), refreshes the numbers, and shouts — with the exact fix command — the moment it sees either of
the two silent killers. It also **auto-runs `corp-sell.js` if it ever catches a missing sell order**,
so the thing that happened to you can't happen twice.

---

## The three loops

BN3 has one loop nested inside another nested inside a third. Almost every "why isn't this working"
question turns out to be a step from a different loop than the one you're staring at.

| Loop | Period | What it does | Who drives it |
|---|---|---|---|
| **1. The market cycle** | 10 seconds | buy inputs → make things → sell things → funds go up | the game, automatically — *once you've set the standing orders* |
| **2. The investment round** | hours | grow the corp, take an investment offer, spend the windfall | you, at a checkpoint |
| **3. The node** | days | corp funds → *your* wallet → augmentations → install → repeat | you, via `ascend.js` |

Loop 1 makes the corporation rich. Loop 2 makes it *much* richer, in four big steps. Loop 3 is the
only one that makes **you** rich, and it's the one that's easy to forget exists — see **Loop 3**
below for the "my corp is profitable but my money isn't going up" answer.

---

## Loop 1 — the market cycle (10 seconds)

Every 10 seconds the game runs your corporation through five states, in this order:

```
START  →  PURCHASE  →  PRODUCTION  →  EXPORT  →  SALE  →  (repeat)
```

- **START** — employees show up; job assignment changes from last cycle take effect *now*, not when
  you set them.
- **PURCHASE** — your standing `buyMaterial` rates are charged and the goods arrive.
- **PRODUCTION** — inputs are consumed, outputs are created. **Halts silently if the warehouse is
  full.**
- **EXPORT** — inter-division transfers move (you have none yet; that's round 3).
- **SALE** — your standing `sellMaterial` orders execute. **This is where revenue comes from.**

You don't script this loop — the game runs it. What you do is make sure **four standing conditions**
are true, and then it prints money on its own:

| # | Condition | Set it with | Symptom when missing |
|---|---|---|---|
| 1 | Offices have employees, doing jobs | `corp-hire.js`, `corp-jobs.js` | production is 0, revenue is 0 |
| 2 | Inputs are being bought, at the right rate | **`corp-supply.js`** (auto) or `corp-buy.js` (manual) | production is 0 with an empty warehouse — or a jam, if the rate is too high |
| 3 | Outputs are being sold | **`corp-sell.js`** | production stalls, warehouse full, revenue **exactly** 0 ← *you were here* |
| 4 | Warehouses have headroom | `corp-warehouse-upgrade.js` | production drops to 0 with a full warehouse |

Conditions 1, 3 and 4 are **set once and forgotten** — one-shot terminal commands that change a
setting and exit, which is exactly why they're cheap enough to run at all (see
[The RAM story](#the-ram-story-and-what-128-gb-changes)).

Condition 2 is the exception, and it's the one that needs *continuous* attention: the right buy rate
changes every time production grows, every time you upgrade a warehouse, and every time you add a
city. That's what `corp-supply.js` is for — see [Letting it run itself](#letting-it-run-itself).

**Reading the dials:**

```
run corp-status.js       # funds, revenue/s, expenses/s, valuation, RP per division
run corp-buy.js --show   # per city: stored / buy rate / production / sold / quality
run corp-report.js       # the lot: every division, city, office, warehouse, material, price
```

`corp-report.js` is the one to reach for when the question is *"here's my whole corporation,
what should I do next?"* rather than *"is this one thing working?"*. It prints a single block —
corp, shares, the standing investment offer, every unlock and upgrade with its next price, then
per division per city: office and job mix, warehouse level and how full it is, every material
that's moving (including exports and whether a sell order exists), every product, and what the
next warehouse level / office seat / AdVert would cost. It ends with a FLAGS section of
mechanical checks. It only reads, so it's always safe to run, and the block is written to
`corp-report.txt` as well as printed — paste it wherever you want a second opinion.

It costs ~3.7 GB because it *is* a conductor: the getters it wants add up to ~180 GB in one
file, so it launches three scanners one at a time (`corp-scan-corp` 71.6, `corp-scan-city`
61.6, `corp-scan-cost` 51.6) and merges their JSON fragments for free. Peak is ~75 GB. If one
won't fit it says so and prints the report without that section rather than lying by omission.

`revenue − expenses` is the number that matters. Early on, expenses (salaries + input purchases) can
genuinely exceed revenue and the corp runs at a loss — that's fine and expected in round 1, and
running into debt on the per-second purchase path is *intended*. What's not fine is revenue being
exactly `0`, which always means condition 3.

### Letting it run itself

Two scripts turn loop 1 into something you don't have to babysit.

**`corp-supply.js` — the custom Smart Supply (51.6 GB).** "Smart Supply" is a \$25b corporation
unlock that sizes your input purchases automatically. `corp-design.md` deliberately skipped buying
it — \$25b is 38% of the round-1 upgrade budget — on the promise of writing it instead. This is that
script.

It is a **feedback controller**, not a reimplementation of the game's production formula (that
formula isn't reliably documented, and the house rule here is that the running game is the only
source of truth). Each cycle, per city, it:

1. reads what the division actually produced last cycle;
2. aims slightly above it — if inputs were the limit, output climbs ~20% next cycle, and it walks
   up until it hits the real ceiling (employees, warehouse, boost materials) and stops on its own;
3. buys the difference — one cycle of consumption plus a small buffer, minus what's already stored.
   When production is capped, stock stays high, the deficit goes to zero, and it stops buying by
   itself;
4. **never buys into a full warehouse** — purchases taper off below 25% free space, stop below 3%,
   and each cycle's total volume is capped at 80% of the free space using each material's real unit
   size.

There is nothing to tune. It also watches `desiredSellAmount` on your output materials while it's
in there — free, since it already paid for the read — so it reports any city with **no sell order**.

```
run corp-supply.js --loop     # resident controller (the normal way to run it)
run corp-supply.js            # one pass + a full per-city report, then exit
run corp-supply.js --dry      # show the plan, buy nothing
```

**`corp-conductor.js` — the resident brain (~3.6 GB).** One script to start, and loop 1 runs itself:

```
run corp-conductor.js
tail corp-conductor.js
```

Every cycle it keeps `corp-supply.js` alive, refreshes `corp-state.txt` (which is where its status
line's funds/revenue/valuation come from), and watches for the two silent killers — printing the
**exact command** that fixes each one. A missing sell order it will fix for you automatically;
congestion it reports but deliberately won't touch, because unjamming means dumping stock at price
zero and doing that to your boost materials by mistake would be expensive.

It costs almost nothing because five corporation calls are free — `hasCorporation`, `getConstants`,
`nextUpdate`, `getBonusTime`, `canCreateCorporation` — and the conductor uses only those. Every
charged call happens inside the modules it launches.

Two deliberate choices worth knowing:

- **Supply stays resident rather than being dispatched each cycle.** Only the last buy rate written
  before the PURCHASE state counts, so a controller recomputing on every state tick is correct no
  matter where in the cycle it started. A one-shot dispatched at the wrong moment would read an
  inflated `stored` and buy nothing.
- **`--auto-boost` is not optional once `--auto-upgrade` is on.** Every Smart Storage level
  *multiplies* warehouse size, and boost stock does not follow — so a corporation buying its own
  upgrades dilutes its own boost fraction on every purchase, and the production multiplier quietly
  stops improving while everything else grows. Seen live: Smart Storage 40 → 90 doubled every
  warehouse, boost fell 30.8% → 15.4% of the space, and Agriculture's multiplier sat at **x881.851,
  unchanged**, for 94 minutes while revenue rose 7× around it. Refilling to the 40% default modelled
  at ×2.77 in Agriculture, ×1.67 in Chemical, ×1.20 in Tobacco. `corp-report.js` now flags any
  warehouse whose boost materials are under 20% of the space.
- **Spending is opt-in, and the one-way levers stay yours permanently.** By default the conductor
  buys nothing. `--auto-upgrade`, `--auto-advert`, `--auto-research` and `--auto-boost` switch on the levers that are
  safe to automate — you can stop any of them at any time and nothing you bought is lost. Accepting
  an investment offer and `goPublic()` are genuinely one-way and stay manual forever, the same way
  `ascend.js` holds the install behind `--install`. (`--auto-bribe` exists too, but needs a faction
  name; reputation doesn't transfer, so there's no sensible default to pick for you.)
- **At most one heavy module launches per cycle.** `corp-ta.js` is 61.6 GB, the spend modules are
  51.6–61.6 GB and `corp-status.js` is 21.6 GB — on a 512 GB home with `corp-product.js` resident at
  91.6 GB there is room for exactly one at a time. Their periods share factors, so left alone they
  would fire on the *same* cycles every time and starve each other permanently rather than
  occasionally. A tick that can't run sets a due flag and retries on the next cycle instead.

Stopping the conductor also stops the supply controller it started, so you can't leave a 51.6 GB
script running invisibly. `boot.js` relaunches it after an install whenever a corporation exists —
**with `--auto-upgrade --auto-advert --auto-research --auto-boost` baked into its `STACK` entry**, because
`installAugmentations()` relaunches boot with *no* args, so a conductor you started by hand with
spending on would come back with spending off and look perfectly healthy while doing it.
`reset-scripts.js` leaves it alone (it only kills the commander family).

### Boost materials, safely

Boost materials — Real Estate, Hardware, Robots, AI Cores — multiply production, and Real Estate is
the standout for Agriculture: factor 0.72 at **0.005 space per unit**. That tiny unit size is a trap.
A warehouse looks like it has loads of room right up until a per-second buy rate has spent \$165b
filling 900 units of space with 1.08 million units of Real Estate, jammed every warehouse to 100%,
halted all production, and put the corporation \$100b into debt.

`corp-boost.js` (62.6 GB) exists so that can't happen twice. Three things make it safe:

- **Targets are a fraction of the warehouse, never a unit count.** "40% of the warehouse" stays
  correct when you upgrade a warehouse, add a city, or change industry. "90,000 units" doesn't, and
  a unit count tells you nothing about whether it fits.
- **It only buys while it's running.** A one-shot script *cannot* be safe here — it would set a
  per-second rate and exit, leaving nobody to turn it off. So buying happens only in `--loop`, and
  the moment every city reaches target it zeroes every rate and exits by itself.
- **It prices the plan against your funds** every pass and scales down to what you can afford, so an
  ambitious target becomes slow progress instead of debt. Negative funds buys nothing.

```
run corp-boost.js                  # report: where you are vs target, what it'd cost. Spends nothing.
run corp-boost.js --loop           # buy to target, clear the rates, exit
run corp-boost.js --loop --trim    # also sell DOWN at market price if you're over target
run corp-boost.js --clear          # panic button: zero every boost buy rate now
```

`--trim` drives `corp-sell.js` rather than mentioning `sellMaterial` itself (1 GB for `ns.run` beats
20 GB), always at `MP`, and trims each material *independently* — each sell order clears as soon as
that material's *least*-stocked city reaches target, so nothing is ever trimmed below it. (It used
to gate every material on one shared minimum, and a single material arriving at target vetoed the
trim for all the others — the BN5 deadlock in `corp-design.md` gotcha 11.)

**Order matters:** upgrade warehouses *before* stocking boosts. A level-1 warehouse holds ~100 units
of space, and you'd only be buying again after every upgrade.

---

## Loop 2 — the investment round

There are exactly **four** investment offers in the life of a corporation, and each one is a
one-way lever: accepting early permanently sells more shares for less money. So the rig deliberately
**does not take them for you**. You grind the corp up to the round's target shape, then you look at
the offer and decide. Same shape as `ascend.js` holding the install behind `--install`.

Offer size is roughly `valuation × shareFraction × multiplier`, with the fractions and multipliers
being `[0.1, 0.35, 0.25, 0.2]` and `[3, 2, 2, 1.5]`. Translation: **grow the valuation first, then
look at the offer.** Waiting is free.

### Round 1 — the skeleton (\$150b, spent exactly)

| Step | Command | Cost |
|---|---|---|
| Create the corporation | City Hall in Sector-12, "Use seed money" *(by hand — free, one dialog)* | free |
| Expand into Agriculture | `run corp-division.js` | \$40b |
| Open the other 5 offices | `run corp-cities.js` | \$20b |
| Buy 5 warehouses | `run corp-warehouses.js` | \$25b |
| Record the shape | `run corp-status.js` | free |
| Offices to size 4 | `run corp-office.js` | small |
| Fill them, all on R&D | `run corp-hire.js` | free up front |
| *…wait for RP ≥ 55…* | watch `corp-status.js` | free |
| Switch to a production mix | `run corp-jobs.js --preset round1` | free |
| **Sell orders** | `run corp-sell.js` | free |
| **Buy orders** | `run corp-conductor.js` (auto, preferred) or `run corp-buy.js` | ongoing |
| Warehouse levels + Smart Storage | `run corp-warehouse-upgrade.js --add 5`, plus the UI Upgrades panel | the remaining ~\$65b |
| Boost materials, *after* the upgrades | `run corp-boost.js --loop` | the rest |

Sector-12's office and warehouse come **free** with the division — that's why it's five of each and
not six.

`corp-boot.js` does the first four of those in one shot, if it fits (121.6 GB — see the RAM section).

Then let it run. Revenue climbs as RP and boost materials accumulate. When the offer looks good
(check the Investors tab in the corporation UI), **accept it by hand**.

### Round 2 — quality

Buy the **Export** unlock (\$20b) first. Add a **Chemical** division as cheap support — minimal
office, no Advert, one warehouse upgrade — and export its Chemicals into Agriculture. This is
mandatory, not optional: *purchased* material always has quality 1 and dilutes what's already in the
warehouse, so buying your Chemicals caps your Plants' quality forever. Making them doesn't.

Wiring the loop is two commands:

```
run corp-export.js --preset agri-chem    # Plants -> Chemical, Chemicals -> Agriculture, all cities
run corp-export.js --show                # confirm the orders landed
```

You do **not** have to remember to stop buying Chemicals. `corp-supply.js` counts imported stock
against the deficit, so as the export ramps up the purchase rate falls to zero on its own — which
is the whole point, since a quality-1 purchase would dilute the warehouse right back.

A support division still has to **buy its own Water**, because exports only cover what the partner
makes. The conductor runs a second `corp-supply.js` for Chemical (Water only, outputs Chemicals) as
soon as that division exists, so starting the conductor covers it.

Exports are safer than purchase orders: the game clamps each shipment to the source's stock *and*
the destination's free space, and skips it entirely when the destination is full, so an export
can't jam a warehouse the way a runaway `buyMaterial` rate can.

One wrinkle worth knowing. The standard adaptive amount `(IPROD+IINV/10)*(-1)` ships exactly what
the importer is burning — a consumed material has a *negative* `productionAmount`, which is where
the `*(-1)` comes from. But it **can't start from cold**: a division with no inputs produces
nothing, so `IPROD` and `IINV` are both 0 and the first shipment never leaves. `corp-export.js`
detects that and seeds those routes off the exporter's output instead.

Agriculture offices to 8 (`run corp-office.js --size 8`, then `corp-hire.js`). Then **wait** for
research points (~700 Agriculture / ~390 Chemical). Waiting is genuinely the move; quality is what
makes output sellable at a good price.

### Round 3+ — products, and the real money

Add **Tobacco**, export Plants into it from Agriculture, and start developing products. This is
where the corporation stops being a farm and becomes an exponential curve.

Standing the division up is all existing scripts:

```
run corp-division.js --industry Tobacco --name Tobacco     # ~$20b
run corp-cities.js --division Tobacco
run corp-warehouses.js --division Tobacco
run corp-status.js                                         # records it as the [product] division
run corp-office.js --division Tobacco --size 13
run corp-hire.js --division Tobacco
run corp-jobs.js --preset product --division Tobacco
run corp-export.js --routes "Agriculture/Plants > Tobacco"
run corp-smartsupply.js                                    # covers the new warehouses too
```

Then hand the product loop over:

```
run corp-product.js --status     # what exists, progress, ratings; changes nothing
run corp-product.js --loop       # always keep one in development, sell finished ones
```

**What actually makes a product good** (`Product.ts:147-150`) is worth internalising, because it
is not what most guides imply:

```
designMult  = 1 + designInvestment^0.1 / 100
balanceMult = 1.2*engineer + 0.9*management + 1.3*rnd + 1.5*operations + business
sciMult     = 1 + researchPoints^researchFactor / 800
```

- **Investment is nearly irrelevant.** That `^0.1` means $1b buys ×1.079 and $1t buys ×1.159 —
  a thousand times the money for 7% more quality. `corp-product.js` defaults to 1% of funds and
  you should leave it there.
- **The job mix is what matters**, weighted Operations 1.5 > R&D 1.3 > Engineer 1.2 > Business 1.0
  > Management 0.9. That's exactly what `corp-jobs.js --preset product` allocates.
- **Research compounds into every future product.** Never drain the RP pool, and above all not
  just before one completes — `sciMult` is banked at completion.

Each generation you build is better than the last, so once you're at the `maxProducts` cap (3,
more with the Capacity researches) the loop is to retire the weakest and build a replacement.
That's `--rotate`, and it's **off by default**: `discontinueProduct` is permanent and takes its
revenue with it, so it's a one-way lever you pull deliberately, like `ascend.js --install`.

Alongside all this: buy Wilson Analytics whenever you can afford it, put ≥20% of funds into
Advert (Tobacco's advertising factor is worth having, unlike Agriculture's 0.04), and keep
spending the rest on upgrades.

---

## Loop 3 — the node: getting the money *out*

**This is the part that surprises everyone, and it's probably your next question after the sell
orders start working.**

Corporation funds are **not your money.** They live in a completely separate pot. Your corp can be
making \$500m/sec and your personal wallet will not move by a single dollar. There are exactly two
taps:

1. **`goPublic()` + `issueDividends()`** — go public, then set a dividend rate. A percentage of
   profit is paid out to shareholders each cycle, and you own ~66.7% of the shares, so most of it
   lands in your wallet. In BN3 the dividend penalty is the minimum (payout comes out as `(…)^0.85`).
   This is the answer to *"my corporation is profitable but my money isn't going up."*
2. **`sellShares()`** — a lump sum, on a 1-hour cooldown. Blunt, but real.

Neither is scripted yet — both are buttons in the corporation UI. Don't go public until round 4-ish;
public corporations can't take investment offers.

Once money is flowing to you personally, the outer loop is the one the rest of the repo already
automates:

```
corp dividends  →  your wallet  →  buy augmentations  →  install  →  everything reboots  →  repeat
```

- `run ascend.js` — plans the augmentation purchase and holds the install trigger behind `--install`.
- `run ascend.js --install --cb boot.js` — installs, then `boot.js` brings the whole earning stack
  back up on the other side.
- `run boot.js` — relaunches commander + gang + stock-trader + sleeves + the corp conductor
  (with its spending flags on; bribery stays manual).

**Two things survive an augmentation install: your corporation and your gang.** So an install costs
you nothing on the corp side — don't hesitate over it, and don't kill the corp scripts "to be safe."
(They're one-shot commands anyway; there's nothing running to kill.)

**Later, the cheat code:** once valuation passes \$100t you can `bribe()` factions for reputation at
\$1b per rep point. BN3 charges **3× reputation** for augmentations, which is the node's real wall —
bribery turns that wall into a purchase. It's the endgame of the corporation as far as *this* node
is concerned.

---

## The script map — what's automated, what isn't

Being straight with you: the rig covers the **tedious, repeated, six-cities-times-two-operations**
work. It does not cover the one-click decisions. That's a deliberate split, but it means a few
important things happen only in the UI, and if you're waiting for a script to do them you'll wait
forever.

### Scripted (terminal, one-shot, safe to re-run)

| Script | RAM | What it does |
|---|---|---|
| `corp-status.js` | 21.6 GB | read the corp, write `corp-state.txt` so every other script knows the division name (`--quiet` = one line, `--silent` = nothing, which is what the conductor uses) |
| `corp-division.js` | 21.6 GB | expand into an industry |
| `corp-cities.js` | 21.6 GB | open offices in all 6 cities |
| `corp-warehouses.js` | 31.6 GB | buy warehouses, and *verify* them (`purchaseWarehouse` fails silently) |
| `corp-office.js` | 31.6 GB | grow offices to a target size |
| `corp-hire.js` | 31.6 GB | fill every office, hiring straight into a job |
| `corp-jobs.js` | 31.6 GB | set the job mix safely (zero-then-set; the API is *relative*) |
| `corp-warehouse-upgrade.js` | 31.6 GB | raise warehouse levels |
| **`corp-sell.js`** | **21.6 GB** | **standing sell orders — without this, revenue is \$0** |
| `corp-buy.js` | 31.6 GB | manual per-second purchase rates; `--show` is your by-hand dashboard |
| **`corp-supply.js`** | **51.6 GB** | **custom Smart Supply — sizes every input purchase, every cycle, and can't jam a warehouse** |
| **`corp-boost.js`** | **62.6 GB** | **stocks boost materials to a target *share of the warehouse*, then clears the rates and exits** |
| **`corp-morale.js`** | **51.6 GB** | **holds every office at 100/100 energy and morale — the 10/10 floor is 1% production** |
| **`corp-export.js`** | **51.6 GB** | **standing inter-division transfers (there is no separate import API)** |
| **`corp-smartsupply.js`** | **51.6 GB** | **switch on the Smart Supply unlock per warehouse — owning it does nothing until you do** |
| **`corp-product.js`** | **91.6 GB** | **round 3+: always keep a product in development, sell finished ones, rotate the weakest** |
| **`corp-ta.js`** | **61.6 GB** | **switch Market-TA.II on per material and per product — researching it does nothing until you do** |
| **`corp-upgrade.js`** | **51.6 GB** | **buy corporation-wide upgrade levels against a budget (cheapest-first, Wilson gets first refusal)** |
| **`corp-advert.js`** | **61.6 GB** | **buy AdVert, but only in divisions whose `advertisingFactor` justifies it** |
| **`corp-research.js`** | **61.6 GB** | **spend research points — by name, or cheapest-first keeping half the pool** |
| **`corp-bribe.js`** | **32.1 GB** | **corporation funds → faction reputation, once valuation clears \$100t** |
| **`corp-dividend.js`** | **31.6 GB** | **set the dividend rate — the tap that moves profit into your wallet (needs going public first)** |
| **`corp-conductor.js`** | **~3.6 GB** | **resident brain: keeps supply + morale alive, refreshes state, re-asserts Market-TA.II, catches the silent killers** |
| `corp-boot.js` | 121.6 GB | division + cities + warehouses in one shot, if it fits |
| **`corp-report.js`** | **~3.7 GB** | **everything about the corporation in one paste-back block — reads, never spends** |
| `corp-scan-corp.js` | 71.6 GB | report part 1: corp, offer, unlocks, upgrades, divisions *(launched by `corp-report.js`)* |
| `corp-scan-city.js` | 61.6 GB | report part 2: offices, warehouses, materials, products, industry factors |
| `corp-scan-cost.js` | 51.6 GB | report part 3: warehouse/office/AdVert prices, research state |

Every one of them is **idempotent** — re-running is always safe, they skip what's already done, and
they resume where they stopped if funds ran out mid-way. Every one takes `--dry` to preview and
`--help` for its own cheat sheet. They all figure out the division name from `corp-state.txt`, so
run `corp-status.js` after any structural change.

Only `corp-conductor.js` and `corp-supply.js --loop` stay resident; everything else runs and exits.
Once the conductor is up, `corp-buy.js` becomes a diagnostic rather than a control — use `--show` to
look, and let supply do the setting.

### Not scripted — do these in the corporation UI

| Thing | Where | Notes |
|---|---|---|
| Creating the corporation | City Hall, Sector-12 | pick **"Use seed money"** — free in BN3; self-funding costs you \$150b |
| **Unlocks** (Export, Market Research, Smart Supply…) | Unlocks panel | Warehouse + Office API are free in BN3. Not scripted because the only two you can still be missing cost **\$500t** and **\$2q** — there is nothing to automate until then |
| **Investment offers** | Investors tab | deliberately manual — one-way lever, only four of them |
| **Go public** | Investors tab | one-way and permanent: a public corporation can **never** take an investment offer again |
| **Sell shares** | Investors tab | lump sum, 1-hour cooldown |
| ~~Corporation upgrades~~ | *now scripted* | `corp-upgrade.js` |
| ~~Advert~~ | *now scripted* | `corp-advert.js` |
| ~~Research~~ | *now scripted* | `corp-research.js` |
| ~~Bribing factions~~ | *now scripted* | `corp-bribe.js` |
| ~~Dividends~~ | *now scripted* | `corp-dividend.js` (after you go public by hand) |
| ~~Products~~ (make / price / discontinue) | *now scripted* | `corp-product.js` — see Round 3+ |
| ~~Exports between divisions~~ | *now scripted* | `corp-export.js` — see Round 2 |

Warehouse, Office and Advert are the three *special* upgrades — they apply to one division (Warehouse
to one **city**) and have their own formulas, so they live in the division's city view rather than on
the Upgrades panel. Nothing is missing; it's a different screen.

**`"MP"` means two different things, and on a product it means *cost*.** On a **material**, `MP` is the
market price — comfortably above what you paid, so `MP` is a fine sell price. On a **product**, `MP` is
that product's own `productionCost`, so a sell order at `MP` sells at a **zero margin**. It always
clears, precisely because nothing could be cheaper. This ran live here for all of round 3: Tobacco's
revenue was $8.94m/s against six cities × three products × ~33/s at ~$14.9k unit cost — revenue equal
to units × cost, to three significant figures, while Agriculture's plain materials earned ten times as
much. `corp-product.js --price auto` (now the default) hunts the real ceiling instead: it raises the
markup while a full cycle of output still clears and the shelf isn't growing, and cuts it when stock
starts piling up, **per product per city**. Multipliers persist in `corp-product-price.txt` so a
restart doesn't drop you back to cost. The permanent fix is the **Market-TA.II** research (50k RP,
per division) which prices at the optimum every cycle for free.

**And owning Market-TA.II is not the same as using it.** It is a research *and* a per-item flag, and
the flag defaults to off — exactly like paying \$25b for the Smart Supply unlock and never calling
`setSmartSupply`. This corporation owned Market-TA.I and Market-TA.II in all three divisions while
every material still sold at plain `MP` and every product sold at a multiplier `corp-product.js` was
hunting by experiment. `run corp-ta.js` sets the flag everywhere; `corp-conductor.js` re-asserts it
every 30 cycles, because **every new product arrives with it off** and quietly goes back to selling
at cost. Once it is on, the multipliers `corp-product.js` reports are ignored by the game — leave the
script running (developing and selling products is still its job) but stop reading its `k` as
meaningful.

**Boost materials: let `corp-boost.js` work out the mix.** Production is
`Ncities × cityMult^0.73` where `cityMult = Π (0.002·qty + 1)^industryFactor` — checked against a
live corp and reproducing x18.365, x13.069 and x438.694 to within 0.5%. Because each factor is an
exponent, stacking one material buys deep diminishing returns while the other three sit at ×1.0.
Real Estate invites exactly that mistake: 0.005 space per unit against 0.5 for Robots, so it looks
free. It genuinely is the right answer for **Agriculture** (factor 0.72 vs 0.2–0.3), and badly wrong
for **Chemical** (all four at 0.20–0.25) and **Tobacco** (0.15–0.20). The old `"Real Estate=0.40"`
default left three materials at zero for a whole playthrough; fixing it measured **2.72× production
in Chemical for $1.39b** and 2.20× in Tobacco for $2.01b. `corp-boost.js` now solves the split in
closed form (Lagrange, then drop any material wanting negative space and re-solve) from the
industry's factors, which `corp-status.js` records into `corp-state.txt`. So `run corp-boost.js
--division Chemical --loop` is enough; `--preset`, `--factors` and `--total` are there when you want
them, and `--mix` still takes a hand-written split.

**Still not built** (described in `corp-design.md`, not blocking): an **office-assignment
optimizer**. Until it
exists, spreading employees evenly across non-R&D jobs is what the official docs bless as "not
optimal, but you can still reach the endgame."

---

## The RAM story, and what 128 GB changes

You guessed the cause correctly, and it's worth knowing *why*, because it explains the whole shape of
the rig.

**Every `ns.corporation.*` function costs 10 GB (a getter) or 20 GB (an action) just for being
*mentioned* in a script** — whether or not it's ever called. A single sensible corporation manager
mentioning most of the API lands around **700 GB**. There is no way around it: the runtime charges the
budget a *second* time at call time, so clever tricks like `c[name](...)` don't dodge anything. The
only lever is mentioning fewer functions per file.

That's why you have eleven small scripts instead of one manager. `corp-sell.js` mentions exactly one
charged function, which is why it's 21.6 GB and not 200.

**What 128 GB buys you** (up from 64 GB):

- Every module in the table above now loads comfortably **alongside** the hacking rig, instead of
  competing with it. That's the real win — the friction of "will this fit?" mostly goes away.
- **`corp-supply.js` at 51.6 GB is the thing 128 GB actually bought you.** On a 64 GB home it could
  not have stayed resident next to `commander.js`; now it can, and that's what makes loop 1
  hands-free. Its four charged calls (`buyMaterial`, `getMaterial`, `getWarehouse`,
  `getMaterialData`) are all load-bearing — `getMaterialData` is what lets it convert a purchase
  into *warehouse volume* and refuse to overshoot, which is precisely the bug that jammed you.
- `corp-boot.js` (121.6 GB) will still only load if home is otherwise nearly empty. If you want it,
  pause the rig first: `run reset-scripts.js` (it kills only the commander rig and spares everything
  else), run `corp-boot.js`, then `run boot.js` to bring the stack back. Honestly, the four small
  scripts do the same job with less ceremony.
- **Budget while the conductor runs:** conductor (3.6) + supply resident (51.6) ≈ 55 GB standing,
  plus a brief 21.6 GB whenever it dispatches `corp-status.js` or `corp-sell.js`. If home gets tight,
  the conductor logs the shortfall and skips rather than thrashing — same behaviour as `boot.js`.
  You may want to raise `commander.js`'s `HOME_RESERVE_GB` to leave it room.

One warning worth carrying: **the RAM walker matches identifiers by bare name, ignoring namespace.**
A local variable named `research` bills you 20 GB for `ns.corporation.research` in a file that never
touches the corporation at all. If a script suddenly gets expensive, look at your variable names.

---

## Command cheat sheet

```
# hands-free
run corp-conductor.js                    # start the brain; keeps supply alive, watches for trouble
tail corp-conductor.js                   # watch it
run corp-supply.js --loop                # just the supply controller, without the conductor
kill corp-conductor.js                   # stops the supply controller too

# hands-free AND spending (all off by default — one flag each, and you can stop any time)
run corp-conductor.js --auto-upgrade --auto-advert --auto-research --auto-boost
run corp-conductor.js --auto-bribe "Daedalus"     # profit -> that faction's reputation
run corp-conductor.js --spend-every 60            # how often a spend pass runs, in cycles
run corp-conductor.js --no-ta                     # stop re-asserting Market-TA.II

# pricing — owning Market-TA.II does NOTHING until the per-item flag is set
run corp-ta.js                           # switch it on for every material and product
run corp-ta.js --dry                     # ...show what it would touch
run corp-ta.js --off                     # hand pricing back to your own sell orders

# spending corporation funds (each reports first; --go actually buys)
run corp-upgrade.js                      # levels and next-level prices, spends nothing
run corp-upgrade.js --go                 # buy, up to half of current funds
run corp-upgrade.js --go --budget 2t     # ...or a fixed budget
run corp-advert.js --go                  # AdVert, only where advertisingFactor >= 0.1
run corp-research.js                     # what's owned, what's next, what it costs
run corp-research.js --buy "uPgrade: Capacity.I" --go     # +1 product slot, no discontinuing
run corp-research.js --auto --go         # cheapest-first, keeping half the RP pool

# getting the money OUT (see Loop 3)
run corp-bribe.js                        # rep per dollar, spendable funds, your factions
run corp-bribe.js --faction "Daedalus" --amount 5t --go   # funds -> reputation ($1b/point)
run corp-dividend.js                     # ownership, current rate, what you're earning
run corp-dividend.js --rate 0.5 --go     # ...after you go public by hand

# dashboards
run corp-report.js                       # EVERYTHING, in one block you can paste to an assistant
run corp-report.js --json                # ...as raw JSON, if a field is missing from the report
run corp-status.js                       # funds, revenue/s, valuation, RP, divisions
run corp-status.js --silent              # just refresh corp-state.txt, print nothing
run corp-supply.js                       # one pass: per-city production, stock, plan, warnings
run corp-buy.js --show                   # per-city stored / buying / producing / selling / quality
run corp-buy.js --show --mix "Plants=0,Food=0"   # ...for your OUTPUTS (--show defaults to inputs)

# morale — output is morale x energy x 1e-4, so the 10/10 floor is 1% production
run corp-morale.js                       # where every office stands; spends nothing
run corp-morale.js --loop                # climb to 100/100 and hold there
run corp-jobs.js --preset intern         # the permanent fix for any office of 9+

# exports (round 2+) — there is no import API; an import is the far end of an export
run corp-export.js --preset agri-chem    # Plants -> Chemical, Chemicals -> Agriculture
run corp-export.js --show                # every export order that exists
run corp-export.js --preset agri-chem --clear

# the money switch
run corp-sell.js                         # sell Plants + Food at market price, everywhere
run corp-sell.js --clear                 # stop selling
run corp-sell.js --materials "Plants" --price 0    # DUMP to unjam (one cycle only!)

# boost materials (Real Estate, Hardware, Robots, AI Cores)
run corp-boost.js                        # where am I vs target? spends nothing
run corp-boost.js --loop                 # stock to target, clear the rates, exit
run corp-boost.js --loop --trim          # ...and sell down at MP if you're over
run corp-boost.js --clear                # panic button: zero every boost buy rate

# inputs (rates are PER SECOND and run forever)
run corp-buy.js --mix "Real Estate=200"  # the raw, unguarded way — this is what overshoots
run corp-buy.js --clear                  # ...then stop
run corp-supply.js --clear               # stop buying inputs (kill the conductor first, or it re-sets them)

# growing
run corp-office.js --size 8              # bigger offices
run corp-hire.js                         # fill them (defaults to R&D)
run corp-jobs.js --preset round1         # 1 Ops / 1 Eng / 1 Bus / 1 Mgmt
run corp-jobs.js --preset rnd            # everyone on research
run corp-warehouse-upgrade.js --add 5    # more space

# every script takes --dry and --help
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Revenue is **exactly** \$0.00/s | no sell order — the default is zero | `run corp-sell.js` |
| Revenue \$0.00/s but the sell orders **exist** | stock-out: congestion halted production long enough for the stored output to sell out — an order on an empty shelf earns \$0 | free warehouse space (trim boosts / dump outputs); revenue returns on the first SALE after production restarts |
| `prod 0.00` for several cycles, warehouse full | congestion — no room for output | dump with `--price 0` for one cycle, then restore; then raise warehouse levels |
| Warehouse fills up again immediately | buy rate exceeds consumption | `run corp-buy.js --clear`, then set a lower mix |
| Production is 0, warehouse **empty** | no inputs, or nobody assigned to Operations/Engineer | `run corp-buy.js`; `run corp-jobs.js --preset round1` |
| Corp is profitable, **my money isn't going up** | corp funds ≠ your wallet | go public by hand (Investors tab), then `run corp-dividend.js --rate 0.5 --go` |
| Corp funds climb into the trillions and nothing improves | nothing is spending them — for a long time nothing in the rig could | `run corp-upgrade.js --go`, `run corp-advert.js --go`, or turn on `corp-conductor.js --auto-upgrade` |
| Revenue climbs but a division's **production multiplier never moves** | Smart Storage grew the warehouse; boost stock didn't follow, so the boost *fraction* halved | `run corp-boost.js --loop --division NAME`, or `corp-conductor.js --auto-boost` so it re-levels itself |
| One upgrade never gets bought however long `corp-upgrade.js --loop` runs | its next level costs more than `--priority-frac` of a pass — fixed since, the allowance now has a one-level floor | `run corp-upgrade.js --go --only "NAME" --budget 5t` to force it now |
| Augmentations are affordable but the **reputation** grind is impossible | BN3 charges 3× rep, and no amount of money shortens faction work | `run corp-bribe.js` — past a \$100t valuation, funds buy rep at \$1b/point |
| Products sell instantly but earn almost nothing | they're priced at `MP`, which for a *product* means production **cost** | `run corp-ta.js` if Market-TA.II is researched; otherwise `corp-product.js --price auto` |
| Market-TA.II is researched and prices still look wrong | the research is not the flag; the flag is per item and defaults to off | `run corp-ta.js`, and leave the conductor's re-assert on — new products arrive with it off |
| A product slot is stuck: 3 finished products, none developing | `maxProducts` is 3 and `discontinueProduct` is the only other way out | `run corp-research.js --buy "uPgrade: Capacity.I" --go` for a 4th slot, instead of `--rotate` |
| Output sells but for very little | quality is low — you're buying inputs that arrive at quality 1 | round 2: Chemical division + Export, and let RP build |
| Production is far below what the multipliers say it should be | morale/energy have decayed to the 10/10 floor, where output is `morale x energy x 1e-4` = **1%** | `run corp-morale.js --loop`, then `run corp-jobs.js --preset intern` so it can't recur |
| Morale climbs back, then slides to 10 again | an office of 9+ with too few interns has `perfMult` 0.998 — a compounding per-cycle decay | `run corp-jobs.js --preset intern` (needs Intern > 1/9 of the office). Later, AutoBrew + AutoPartyManager end it permanently |
| A support division is staffed but produces nothing, warehouse empty | it has no inputs — exports were never wired, or it can't buy its own water | `run corp-export.js --preset agri-chem`, and let the conductor start its supply controller |
| `Tried to initialize an export to a duplicate warehouse` | `exportMaterial` throws rather than stacking a second order | that's `corp-export.js` being re-run safely — it cancels and replaces; nothing is wrong |
| A script says `no division named "Agriculture"` | `corp-state.txt` is stale or the division is named something else | `run corp-status.js`, or pass `--division NAME` |
| A script prints success but nothing changed | `purchaseWarehouse` and `upgradeWarehouse` fail *silently* on short funds | check `corp-status.js` funds; the scripts verify and will say "no change" |
| "Dynamic RAM usage calculated to be greater than…" | a script called a charged function it didn't declare | don't add `ns.corporation.*` calls to a module without re-checking `mem` |
| `corp-buy.js` rates keep changing back | `corp-supply.js` owns the input rates now, and re-sets them every cycle | that's working as intended; to take manual control, `kill corp-conductor.js` first |
| Terminal flooded with `corp-status: …` lines | you're in **bonus time**, so a cycle is 1s not 10s and every timer fires 10× faster | fixed — the conductor now refreshes with `--silent` and won't banner more than once every 4 minutes. If you started the conductor before that change, restart it |
| Conductor log says `SHORT corp-supply.js` | not enough free home RAM for the 51.6 GB module | free some up, or raise `commander.js`'s `HOME_RESERVE_GB` |
| Supply buys nothing and production stays 0 | production is 0 *and* the warehouse is nearly full — it correctly refuses to buy into a jam | unjam first (dump outputs at price 0), then raise warehouse levels |
| One city produces 0 with an **empty** warehouse and no buy order, while its neighbours are fine | a buy rate is a standing order. A jam drove it to 0, the jam cleared, and nothing was alive to raise it again | `run corp-supply.js` for the immediate fix; `run corp-smartsupply.js` so it can't recur |
| Bought the \$25b Smart Supply unlock and nothing changed | the unlock only grants the ability — every warehouse starts with it switched **off** | `run corp-smartsupply.js`. Check `smartSupply ON` per city in `corp-report.js`, not `hasUnlock` |
| "Am I production-limited or sales-limited?" | `--show` defaults to the *inputs*, so a plain run can't tell you | `run corp-buy.js --show --mix "Plants=0,Food=0"`. `sold` ≈ production with flat `stored` ⇒ production-limited (buy boosts, employees). `sold` below production with `stored` climbing ⇒ sales-limited (quality, Business headcount — **not** AdVert in Agriculture, whose advertising factor is 0.04) |
| Production climbs then plateaus below what you expected | it found a ceiling that isn't inputs | more employees (`corp-office.js` + `corp-hire.js`), more warehouse, or boost materials |
| Warehouses full of Real Estate, corp deep in debt, production 0 | a `corp-buy.js` boost rate left running — it's per-second and never stops on its own | `run corp-boost.js` to see how far over you are, then `run corp-boost.js --loop --trim`. Never `--price 0` on boost materials |
| Can't buy anything: "insufficient funds" everywhere | corp funds are negative | you can't upgrade your way out; sell surplus boost material at `MP` and put everyone on Business (`corp-jobs.js --mix "bus=4"`) until revenue recovers |

---

## The shortest possible version

1. **Set the four standing conditions** — hire, assign jobs, buy inputs, **sell outputs**. Then
   `run corp-conductor.js` and stop thinking about the buy rates. ✅
2. **Grow, then take the investment offer.** Four of them, by hand, never early.
3. **Go public and pay dividends**, or the money never reaches you.
4. **Buy augmentations, install, reboot with `boot.js`.** The corp survives; the gang survives.
5. Eventually: **bribe factions for reputation** and BN3's 3× rep penalty stops mattering.

You're at step 1, and you were one command away from it.
