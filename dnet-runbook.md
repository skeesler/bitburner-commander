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
| `run dnet-map.js [--models] [--all]` | **The map, quietly.** Live servers grouped by row (the game's `depth`), ✓ cracked / · not, deepest cracked row, and the row lab 1 hangs off (6). `--models` adds model + charisma gate; `--all` includes ghosts. Reads the DB only, so it's as fresh as the commander's last drain. |
| `run dnet-lab-arm.js [off]` | **Opt in to the maze walker**, one lab at a time (solving a lab disarms it). Without this, crawlers only report `LAB … found`. If the lab already has an **anchor**, arming also sends the walker there from home right away. |
| *(automatic)* `dnet-pin.js <lab>` | **Stasis anchor.** The first crawler beside a lab with a stasis link free pins its own server (13.6 GB, ~30 s): it stops moving and home can exec onto it. Recorded on home as `dnet-anchor-<lab>.txt`; `dnet-reset.js` clears those after an install. Prints `PIN …`. |
| *(automatic)* `dnet-lab.js <lab>` | **BN15 maze walker.** When a crawler finds a labyrinth next to its server (the net's last row), your charisma clears the lab's gate, **and you've armed it**, the crawler launches this there with every spare thread. It walks the maze (~27 moves avg for lab 1), then copies `dnet-lab-open.js` onto the lab to open `the_great_work.cache`, which queues the reward augmentation. **Then install.** Below the gate you'll see `LAB … needs charisma N` instead. Progress prints as `LAB …` lines. |
| `run dnet-db.js` | Print the current DB, no draining. |
| `run dnet-db.js prune [keepEpochs]` | Clean up the DB: drop stale ghost servers/edges + old frontier hints + trim the harvest log, **keeping all passwords**. Shows before/after. Optional `keepEpochs` (default 20) = how recent a server must be to survive. The commander also auto-prunes once the catalog passes ~500 nodes. |
| `run dnet-bleed.js [N] [--reserve GB] [--to LEVEL]` | **Charisma grinder.** Fills spare home RAM (16 GB kept free) with 2.2 GB workers that heartbleed `darkweb` forever, ~55+ cha XP per call, and shows charisma climbing toward `--to` (default 300) in a tail. Runs on home only, no darknet deployment. `run dnet-bleed.js off` stops the workers (killing the launcher alone doesn't). |
| `run dnet-reset.js` | **After every install and every new BitNode** (`kill dnet-commander.js` first). Both rebuild the darknet, so every stored password is dead, and `prune` can't drop them. Clears the DB, keeps the wordlist, saves the old one to `dnet-db-old.json`. |
| `run dnet-step.js darkweb dnet-hbprobe.js [host] [guesses…]` | **Throwaway diagnostic** — guess a node, dump its `heartbleed` after each guess. This is what pinned down that feedback lives in `heartbleed().logs[]`, not the auth reply. Delete once the solver reads the channel. |

## Where output shows up

- `dnet-crawl` / `dnet-loot` / `dnet-step` → your **main terminal** (tprint).
  Their `[host] hop N, row R:` lines: **hop** = links followed from darkweb (the recursion count);
  **row** = the server's `depth` in the net, which is what lab access depends on. A hop moves at most one row.
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

- **Frontier watch:** a crawler on row 3 or deeper that couldn't send anyone deeper stays ~3 min, re-checking
  its neighbors every 4 s, because deep links open and close faster than one pass notices. Expect lines like
  `row 5 is a frontier — watching…` and `frontier watch over: N more cracked`.
- Loot does nothing until a crawl + commander has populated passwords.
- The net **mutates between runs** — a fresh crawl re-walks from scratch. Expected, not breakage.
- **503 means the node went offline, NOT rate-limiting** (corrected 2026-10-09 from the v3.0.1 source:
  `checkDarknetServer` is the only thing that returns 503, when the target no longer exists). There is no
  guess throttle. A `BACKOFF … rate-limited (503)` line is a node that vanished mid-solve, so retrying it
  is pointless. It comes back later with a **new password**.
- **`d-1` in the map means the node was offline** when cataloged. That's the placeholder `getServerDetails`
  returns for a missing server.
- Stuck script? `kill <script.js>` or kill it from its tail window.
- **Terminal `ps` ignores a hostname arg** — it lists the *current* server only. `ps darkweb` from `home`
  shows home's processes, not darkweb's. To inspect another node: `connect <host>` then `ps` (darkweb is a
  direct neighbor of home), or use `ns.ps("<host>")` from a script.
- **Auth feedback lives in `heartbleed`, not the `authenticate` reply** (confirmed 2026-07-05). Each
  `heartbleed(host).logs[]` entry is a JSON string of a recent attempt (`{code,message,data,passwordAttempted}`);
  the `data` field carries the (noisy) hint. Bleed right after a guess and match on `passwordAttempted`.
