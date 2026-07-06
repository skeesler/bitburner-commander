# DarkNet runbook — the commands, and when to run them

A glance-able companion to `darknet-design.md` (which is the *why*; this is the *how*). For the
light-net rig see `README.md`. DarkNet basics: you need `DarkscapeNavigator.exe` and to be able to
reach `darkweb`.

## Three facts that make the commands make sense

1. **Everything lives on `home`; you *push* it into the dark.** You never run darknet logic
   directly — `dnet-step.js` scp's the scripts onto a node and `exec`s them there. `home → darkweb`
   is the one free door (ZeroLogon, session already held), so `darkweb` is always the launch pad.
2. **Two passes, on purpose.** Pass 1 (`dnet-crawl.js`) cracks + maps; Pass 2 (`dnet-loot.js`)
   harvests. Split because the cracker is too big to fit on small nodes.
3. **The commander owns the DB.** Crawlers/looters only drop report files; `dnet-commander.js` is
   the *single writer* that folds them into `dnet-db.json`. Hence its `loop` mode — it's meant to
   sit there draining while a pass runs.

## Commands

| Command | What it does |
|---|---|
| `run dnet-step.js <target> <script> [args]` | Transport: scp all `dnet-*` files (+ DB) onto `<target>`, exec `<script>`. Defaults: `darkweb` + `dnet-recon.js`. |
| `run dnet-commander.js` | Drain reports once, print the map + password book. |
| `run dnet-commander.js loop` | Same, refreshing ~4s in its own floating window. Stop: `kill dnet-commander.js`. |
| `run dnet-step.js darkweb dnet-crawl.js` | **Pass 1** — crack + map + spider the reachable net. |
| `run dnet-step.js darkweb dnet-loot.js` | **Pass 2** — harvest caches/intel. Needs Pass 1 first. |
| `run dnet-step.js darkweb dnet-solve.js <neighbor>` | Spot-crack one named node (direct neighbor only, else 351). |
| `run dnet-step.js darkweb dnet-recon.js` | Dump the shape of darkweb's neighbors (probe helper). |
| `run dnet-db.js` | Print the current DB, no draining. |
| `run dnet-step.js darkweb dnet-hbprobe.js [host] [guesses…]` | **Throwaway diagnostic** — guess a node, dump its `heartbleed` after each guess. This is what pinned down that feedback lives in `heartbleed().logs[]`, not the auth reply. Delete once the solver reads the channel. |

## Where output shows up

- `dnet-crawl` / `dnet-loot` / `dnet-step` → your **main terminal** (tprint).
- `dnet-commander` / `dnet-solve` → a **floating tail window** (`openTail`), refreshed live. There's
  only one terminal; these just float their own window. Running a pass + the commander loop at the
  same time is fine — separate PIDs.

## The canonical loop (the flywheel)

```
run dnet-commander.js loop                  # start once; leave it draining
run dnet-step.js darkweb dnet-crawl.js      # Pass 1: crack + map
   … watch the commander window fill with nodes + passwords …
run dnet-step.js darkweb dnet-loot.js       # Pass 2: harvest caches + intel
   … looted creds / "contains X,Y" hints land in the DB …
run dnet-step.js darkweb dnet-crawl.js      # crawl again — cracks harder nodes from that intel
```

Each crawl→loot turn cracks a bit deeper. Done for now: `kill dnet-commander.js`.

**Quieter runs (model hunting):** append `--suppress-info` to show only `FAILED`/`failed` lines and
genuine errors — hides the `CRACKED`/`SKIP`/`BACKOFF` spam, neighborhood summaries, and launch chatter.
Honored across the whole chain (`dnet-step` → crawl/loot/scout → their children → `solve()`), and by the
commander, which also **forwards it to the stages it auto-launches**. The commander's floating tail window
still shows the full map/intel; the flag only quiets the shared terminal.

```
run dnet-step.js darkweb dnet-crawl.js --suppress-info      # one quiet crawl
run dnet-commander.js loop auto --suppress-info             # quiet self-driving pipeline
```

## Gotchas

- Loot does nothing until a crawl + commander has populated passwords.
- The net **mutates between runs** — a fresh crawl re-walks from scratch. Expected, not breakage.
- Nodes **503-rate-limit** on too many guesses; the solver deliberately guesses as few times as
  possible. If you see `BACKOFF … rate-limited`, that node throttled us — it'll retry next crawl.
- Stuck script? `kill <script.js>` or kill it from its tail window.
- **Terminal `ps` ignores a hostname arg** — it lists the *current* server only. `ps darkweb` from `home`
  shows home's processes, not darkweb's. To inspect another node: `connect <host>` then `ps` (darkweb is a
  direct neighbor of home), or use `ns.ps("<host>")` from a script.
- **Auth feedback lives in `heartbleed`, not the `authenticate` reply** (confirmed 2026-07-05). Each
  `heartbleed(host).logs[]` entry is a JSON string of a recent attempt (`{code,message,data,passwordAttempted}`);
  the `data` field carries the (noisy) hint. Bleed right after a guess and match on `passwordAttempted`.
