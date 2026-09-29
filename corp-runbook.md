# corp-runbook.md — running a corporation, the four-file way

The *why* is `corp-design.md` (start with "The 2026-09 rewrite"). This is the *how*. It replaces
`bn3-runbook.md`, which now lives in `archive/` with the old 29-script rig it describes.

**What you need:** about **500 GB free on home** for `corp.js`, plus ~570 GB of headroom for a
second while a `corp-do.js` command runs. A gang (or anything else paying well) makes this easy:
starting a corporation outside BitNode 3 costs **\$150b of your own money**.

**Time:** first-time setup ~10 minutes. After that the corporation runs itself, and you visit it
only for decisions — expanding, and the four investment offers.

---

## 0. One-time: clear out the old rig (~2 minutes)

The file sync only ever *adds* files to the game; it never deletes them. So the 28 old `corp-*.js`
scripts are still sitting on home, still runnable, even though they've moved to `archive/` here.
A stale in-game copy has already cost this corporation \$30b once, so tidy them away:

```
run corp-do.js cleanup          # lists what it would delete (and kills any that are running)
run corp-do.js cleanup --yes    # deletes them from home
```

The copies in `archive/` on your Mac are untouched, and the sync will also put an `archive/` folder
into the game. That's harmless. Nothing in it runs unless you run it.

Then check the new files arrived and see what they cost:

```
mem corp.js          # expect ~495GB
mem corp-do.js       # expect ~565GB
mem corp-report.js   # expect 192GB — if it says ~3.7GB, the game still has the OLD report
```

`corp-report.js` is the one to watch: it kept its old filename, and on 2026-09-27 the sync missed
it — the game ran the old version, which went looking for its three deleted scanners. If `mem`
shows the wrong number, reconnect the Remote API (Options → Remote API → Connect), which re-pushes
every file.

---

## 1. First test: look before it touches anything (~2 minutes)

If a corporation already exists, this is how to meet the new manager safely. It reads the whole
corporation, **prints every action it would take, and changes nothing**:

```
run corp.js --once --dry --auto
```

Read the list. Every line is something like `[dry] sell order Agriculture/Aevum Plants MAX@MP` or
`[dry] jobs Tobacco/Ishima -> Int7 Ops8 R&D7 ...`. If something looks wrong, that's the moment to
say so, before it's real. Then the full picture:

```
run corp-report.js
```

---

## 2. Starting a corporation from nothing (~5 minutes, then waiting)

```
run corp-do.js create                    # $150b from your wallet; you keep 100% of the shares
run corp-do.js expand Agriculture        # division + offices + warehouses in all 6 cities (~$85b of corp funds)
run corp-do.js office Agriculture 4      # offices start at 3; 4 gives the classic 1 Ops/1 Eng/1 Bus/1 Mgmt
run corp.js --auto                       # the manager: start it and leave it
tail corp.js                             # watch it think, one line per 10-second cycle
```

That's it. On its first cycle `corp.js` fills every office, sets the job mix, places sell orders
(**without these a corporation earns exactly \$0.00/s** — the game's default is no order), starts
buying inputs, and begins spending on upgrades and boost materials.

**Optional, the classic round-1 opening.** Research points early lift quality for good:

```
run corp-do.js jobs Agriculture rnd      # everyone on R&D...
run corp-report.js                       # ...until the division shows RP >= ~55
run corp-do.js jobs Agriculture auto     # then back to the normal mix
```

`corp.js` *holds* whatever `jobs` policy you set. It's written to `corp-config.txt`, so it
survives restarts. `auto` hands the choice back.

---

## 3. The rounds (hours apart)

A corporation gets exactly **four investment offers**, and taking one early permanently sells more
of the company for less. So the script never takes them. It mentions the current offer in its
terminal banner every 5 minutes, and you decide:

```
run corp-do.js offer                     # what's on the table, and what it costs you
run corp-do.js accept --yes              # one-way
```

**Rule of thumb:** wait while the valuation is still climbing noticeably. The offer is
`valuation × share × multiplier`, so waiting is free money.

**Round 2 — a support division, for quality.**

```
run corp-do.js unlock Export
run corp-do.js expand Chemical
run corp-do.js export agri-chem          # Plants -> Chemical, Chemicals -> Agriculture, every city
run corp-do.js office Agriculture 8
```

Bought materials always arrive at quality 1 and water down what you make. Making your own
Chemicals doesn't. `corp.js` notices the imports and stops buying what's already arriving.

**Round 3+ — products, the real money.**

```
run corp-do.js expand Tobacco
run corp-do.js export "Agriculture/Plants > Tobacco"
run corp-do.js office Tobacco 30
run corp-do.js unlock "Smart Supply"     # $25b; corp.js switches every warehouse over for you
```

From here `corp.js` keeps one product always in development. At the product cap (3) it stops and
tells you. Two ways past it:

```
run corp-do.js research Tobacco "uPgrade: Capacity.I"    # a 4th slot, nothing lost
# or restart the manager with rotation (retires the weakest product — PERMANENT):
kill corp.js
run corp.js --auto --rotate
```

---

## 4. Getting the money OUT (the sleeves question)

**Corporation funds are not your money.** Profit accumulates inside the corporation, and there
are only three taps to your wallet:

| Tap | Needs | Good for |
|---|---|---|
| **sellshares** | go public first | **the big one outside BN3** — paid at share price, which tracks valuation |
| dividend | go public first | weak in BN10: you receive `payout^0.75` (in BN3 it was `^0.85`) |
| bribe | valuation past \$100t | faction reputation, not money |

So for the \$1q / \$10q / \$100q Covenant sleeves, the path is: grow the valuation → take the
offers you want → go public → sell shares every hour.

```
run corp-do.js public 0 --yes            # ONE-WAY: no more investment offers, ever. 0 = no dilution
run corp-do.js sellshares 10%            # shows the price and what it'd raise, sells nothing
run corp-do.js sellshares 10% --yes      # sells; 1-hour cooldown before the next
```

Selling lowers the share price as you go (0.5% per million shares) and lowers your ownership,
which lowers the price a little more. Smaller, regular sales beat one giant one.

---

## Cheat sheet

```
# the manager
run corp.js --auto                       # normal: keep it running AND spend (upgrades, AdVert, research, boost)
run corp.js                              # keep it running, spend nothing discretionary
run corp.js --once --dry --auto          # one pass, print every action, change nothing
run corp.js --auto --trim                # ...also sell boost material that's over target (at market price)
run corp.js --auto --reserve 5t          # never spend corp funds below $5t
run corp.js --auto --auto-bribe "Daedalus"
kill corp.js                             # stops it; zeroes the boost buys and trims it set

# building (all take --dry)
run corp-do.js expand INDUSTRY
run corp-do.js office DIV|all SIZE
run corp-do.js warehouse DIV|all --add 5
run corp-do.js jobs DIV auto|hold|spread|product|material|rnd|round1|"ops=2,eng=1"
run corp-do.js export agri-chem | "A/Plants > B" | --show
run corp-do.js unlock [NAME]             # no name = list them with prices
run corp-do.js research DIV [NAME]       # no name = list, with RP costs
run corp-do.js upgrade "Smart Storage" 5
run corp-do.js advert Tobacco 3
run corp-do.js filler Restaurant         # a division kept only for the valuation bonus: corp.js leaves it alone

# decisions (one-way ones need --yes)
run corp-do.js offer  /  accept --yes  /  public 0 --yes  /  sellshares 10% --yes
run corp-do.js dividend 0.1
run corp-do.js bribe Daedalus 5t

# looking
run corp-report.js                       # everything, one paste-back block, ends in FLAGS
run corp-report.js --render              # re-show the last read without touching the game
```

---

## Troubleshooting

| Symptom | What it means | Do this |
|---|---|---|
| `corp: already running.` | one manager is enough | `tail corp.js` |
| boot.js says `FAILED corp.js — likely not enough free home RAM` | it needs ~495 GB free | free RAM, or run it by hand later |
| `corp WARNING: CONGESTED DIV/CITY` | warehouse ≥97% full and making nothing | `run corp-report.js` to see *what* is filling it. Unsold output: `corp-do.js sell DIV MATS --price 0` for ONE cycle, then `corp-do.js sell DIV MATS` to restore. Boost over target: restart with `--trim`. Then `corp-do.js warehouse DIV --add 5` |
| `jobs "…" doesn't fit DIV/CITY` | a fixed mix wants more people than the office has | grow the office, or `corp-do.js jobs DIV auto` |
| `at the 3-product cap, nothing developing` | a slot has to open | `corp-do.js research DIV "uPgrade: Capacity.I"`, or `--rotate` |
| `won't clear even at cost — obsolete` | a product nobody wants at any sane price | `--rotate` retires it |
| Revenue fine, but my wallet doesn't move | corp funds ≠ your wallet | section 4 |
| Everything looks stuck, nothing in the log | check it's actually running | `ps`, then `run corp.js --auto` |

If something the scripts do looks impossible from their source, suspect a **stale in-game copy**
before anything else: reconnect the Remote API (it re-pushes every file), then restart `corp.js`.
