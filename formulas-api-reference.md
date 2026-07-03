# Bitburner Formulas API — quick reference

The Formulas API (`ns.formulas`) is a set of **pure calculation functions**. They
compute game mechanics without *doing* anything — no RAM cost to the action, no time
elapsed. You feed them state objects (a `Server`, a `Player`) and they hand back a
number. This is what you use to plan a batch instead of trial-and-error.

**Requirement:** `Formulas.exe` must be on your `home` machine. Buy it from the dark
web (`buy Formulas.exe`) or write it via *Create Program* once your hacking level is
high enough. Every function throws if the program isn't present.

**The core idea:** instead of `ns.hackAnalyzeChance("n00dles")` (reads *current*
live state), you call `ns.formulas.hacking.hackChance(server, player)` with a
`server`/`player` object you can *modify first* — e.g. set the server to min
security and max money to see what a prepped server will behave like.

---

## Getting the input objects

```js
const server = ns.getServer("n00dles");   // a Server object
const player = ns.getPlayer();            // a Player object
// ...or build fake ones to model a hypothetical:
const s = ns.formulas.mockServer();       // blank Server, fill in fields
const p = ns.formulas.mockPlayer();       // blank Player
```

A common move is to clone the real server and force the "prepped" state:

```js
const s = ns.getServer("phantasy");
s.hackDifficulty = s.minDifficulty;   // as if fully weakened
s.moneyAvailable = s.moneyMax;        // as if fully grown
```

---

## The nine namespaces

`ns.formulas.` →
`hacking` · `hacknetNodes` · `hacknetServers` · `skills` · `reputation` ·
`work` · `gang` · `bladeburner` · `dnet`

Plus mock builders: `mockServer()`, `mockPlayer()`, `mockPerson()`.

---

## hacking — the one you'll live in

| Function | Signature | Returns |
|---|---|---|
| `hackChance` | `(server, player)` | success probability, 0–1 |
| `hackExp` | `(server, player)` | hack exp for **one** thread |
| `hackPercent` | `(server, player)` | fraction of money stolen per **one** thread (0.25 = 25%) |
| `growPercent` | `(server, threads, player, cores)` | grow **multiplier** for that many threads |
| `growThreads` | `(server, player, targetMoney, cores)` | threads needed to grow to `targetMoney` |
| `growAmount` | `(server, player, threads, cores)` | money the server ends with after grow |
| `hackTime` | `(server, player)` | ms |
| `growTime` | `(server, player)` | ms |
| `weakenTime` | `(server, player)` | ms |
| `weakenEffect` | `(threads, cores)` | security points removed |

### ⚠️ Parameter-order footgun
Note the order is **not** consistent between these:

- `hackPercent(server, player)`
- `growPercent(server, threads, player, cores)`  ← threads is 2nd, player 3rd
- `growThreads(server, player, targetMoney, cores)` ← player 2nd

When a formula returns `NaN` or something absurd, this is the first thing to check.

### Worked example: threads to steal ~50% and regrow

```js
const s = ns.getServer(target);
s.hackDifficulty = s.minDifficulty;
s.moneyAvailable = s.moneyMax;
const p = ns.getPlayer();

const perThread = ns.formulas.hacking.hackPercent(s, p);   // e.g. 0.005
const hackThreads = Math.floor(0.5 / perThread);           // steal ~50%

// after the hack, money is at 50% — how many grow threads to refill?
s.moneyAvailable = s.moneyMax * 0.5;
const growThreads = Math.ceil(
  ns.formulas.hacking.growThreads(s, p, s.moneyMax, 1)
);
```

---

## skills — level ↔ exp conversion

| Function | Signature | Returns |
|---|---|---|
| `calculateSkill` | `(exp, skillMult)` | skill level for that much exp |
| `calculateExp` | `(skill, skillMult)` | exp required to reach that level |

Handy for "how long until I hit hacking 500?" math. `skillMult` comes from the
player's multipliers (e.g. `player.mults.hacking`).

---

## hacknetServers — hash economy planning

| Function | Signature |
|---|---|
| `hashGainRate` | `(level, ramUsed, maxRam, cores, mult)` |
| `hacknetServerCost` | `(n, mult)` — cost of the n-th server |
| `levelUpgradeCost` | `(startingLevel, extraLevels, costMult)` |
| `ramUpgradeCost` | `(startingRam, extraLevels, costMult)` |
| `coreUpgradeCost` | `(startingCore, extraCores, costMult)` |
| `cacheUpgradeCost` | `(startingCache, extraCache)` |
| `hashUpgradeCost` | `(upgName, level)` — hash price of a shop upgrade |
| `constants` | `()` — all hacknet-server constants |

(There's a parallel `hacknetNodes` namespace for the pre-server hacknet, same shape.)

---

## The others (brief)

- **reputation** — faction/company rep gain and favor math.
- **work** — income/rep/exp rates for jobs, crimes, classes, faction work.
- **gang** — member stat gains, ascension multipliers, respect/wanted rates.
- **bladeburner** — action success chances and times.
- **dnet** ("Darknet") — newer namespace; check your game version's docs.

I only pulled full signatures for the hacking/skills/hacknet sets since those are
where you are in the game. Say the word and I'll expand any of the others.

---

## Sources
- [Formulas interface — official markdown docs](https://github.com/bitburner-official/bitburner-src/blob/dev/markdown/bitburner.formulas.md)
- [ns.formulas API](https://github.com/bitburner-official/bitburner-src/blob/dev/markdown/bitburner.ns.formulas.md)
- [Formulas API — DeepWiki](https://deepwiki.com/bitburner-official/bitburner-src/5.4-formulas-api)

*A note on trust: I pulled function names and descriptions straight from the official
docs, but I inferred a couple of the descriptions where the doc text was terse, and
the worked examples are mine (untested against your game build). Sanity-check the
example numbers in-game before you rely on them.*
