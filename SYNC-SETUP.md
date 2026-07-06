# Auto-syncing scripts into Bitburner (stop copy-pasting)

Manually pasting scripts from VS Code into the in-game editor is miserable and error-prone
(it's how we shipped a stale `dnet-step.js` and lost an afternoon). Bitburner has an official
**Remote File API**: you run a tiny watcher on your Mac, point the game at it, and from then
on **saving a file in VS Code pushes it straight into the game's `home`** — edits and brand-new
files alike. One-time setup, ~10 minutes.

This is for Bitburner **3.0.1** (Steam/web) on Apple Silicon macOS.

## 0. Prerequisite: Node.js (~2 min)

Check if you have it:

```
node --version
```

If that errors, install it with Homebrew (yours lives at `/opt/homebrew/bin/brew`):

```
/opt/homebrew/bin/brew install node
```

## 1. Start the file watcher (~3 min)

From **this folder** (`~/claude/bitburner`), run:

```
npx bitburner-filesync
```

The first run creates a `filesync.json` config and starts watching. Leave this terminal
running — it's the sync server. It'll print something like `Server listening on port 12525`.

Open `filesync.json` and make sure it's watching this folder and using a port you'll remember:

```json
{
  "allowDeletingFiles": false,
  "allowedFiletypes": [".js", ".script", ".txt"],
  "port": 12525,
  "scriptsFolder": "./",
  "quiet": false
}
```

- `scriptsFolder: "./"` = sync the `.js` files sitting right here (flat, no subfolder).
- `allowDeletingFiles: false` = a safe default; deleting a local file won't nuke it in-game.

Save `filesync.json`, then stop (Ctrl-C) and re-run `npx bitburner-filesync` so it picks up
the config.

## 2. Point the game at it (~2 min)

In Bitburner: **Options** (the gear icon) → **Remote API** section →
- Hostname: `localhost`
- Port: `12525` (match `filesync.json`)
- press **Connect**.

You should see it report connected, and the watcher terminal should log the game connecting.

## 3. Verify (~1 min)

In VS Code, save any `dnet-*.js` file (Cmd-S). Then in the game terminal:

```
ls
cat dnet-step.js
```

You should see all your files, and `dnet-step.js` should contain `ns.ls("home", "dnet-")`
(the current version), not a `const PAYLOAD = [...]` array. If so, sync is live.

From now on: **edit in VS Code, hit save, it's in the game.** No more pasting.

## Notes / gotchas

- Keep the `npx bitburner-filesync` terminal open while you play; closing it stops syncing.
- If the game says "disconnected," re-press **Connect** in Options → Remote API (or restart the
  watcher). On reconnect it re-pushes everything, which is also the quick way to force-refresh
  every file at once.
- Local files are the source of truth. Don't edit scripts in the in-game editor anymore, or
  the next save from VS Code will overwrite your in-game change.
- Alternative if you'd rather not keep a terminal open: the **"Bitburner File Sync Plugin"**
  VS Code extension does the same thing from inside the editor.
