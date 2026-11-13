# usage-bar — a Herdr mod

The bottom line of my herdr-app window: local load on the left, then how much of
each AI subscription is left and when it resets.

![Usage bar](usage-bar/preview.png)

A community mod for [herdr-app](https://herdr.dev), by a user. Not affiliated
with Herdr.

## What it shows

```
Host CPU 58% · 디스크 76% · 메모리 82% · 스왑 91% (4.0G)  Codex plus 25% — 4d 19h 후 초기화  GLM pro 95% — 57m 후 초기화
```

One row per signed-in service — Claude, Codex, GLM Coding Plan, Antigravity
(Gemini and Claude/GPT groups) — each showing the percent of the window closest
to running out and the time left on it. A service you are not signed in to
draws nothing. Percent turns amber from 75 and red from 95.

The **Host** row is macOS only (it reads `top -l`, `vm_stat`, the APFS Data
volume, `sysctl`); the usage items work anywhere.

## Install

1. Copy the folder — it must land on the home path, as `mods/<name>/`:

   ```sh
   mkdir -p ~/.config/herdr-app/mods
   cp -r usage-bar/mods/herdr-tui-layout-status ~/.config/herdr-app/mods/
   herdr-app check ~/.config/herdr-app/mods/herdr-tui-layout-status
   ```

2. Wire it as a 24px block at the bottom of a layout in
   `~/.config/herdr-app/layouts/<yours>.json`:

   ```json
   { "id": "status", "type": "block", "content": { "mod": "herdr-tui-layout-status" },
     "size": { "px": 24 } }
   ```

   Or put it in place from the running app (no layout edit):

   ```sh
   herdr-app do mod.open --mod herdr-tui-layout-status
   ```

3. Look at it: `herdr-app shot`.

Nothing else to add — no `keys.json`, no other mod, no assets.

## Sign-in it reads (and nothing else)

| Item | Where it looks |
| --- | --- |
| Claude | login keychain `Claude Code-credentials` (allow the dialog once), else `~/.claude/.credentials.json` |
| Codex | `~/.codex/auth.json` |
| GLM | `~/.opencodex/auth.json`, else `~/.zcode/cli/config.json` |
| Antigravity | the local `agy` CLI, version 1.1.11 or newer |

It **reaches the network** (Anthropic, OpenAI, z.ai) and **runs programs**
(`top`, `vm_stat`, `df`, `sysctl`, `security`, `agy`). Tokens are read per fetch
into memory, never logged, never stored.

## Read the recipe

[`usage-bar/RECIPE.md`](usage-bar/RECIPE.md) is the brief another agent builds
this from in an empty folder — regions, sizes, colours, every endpoint, and the
traps (macOS-only host row, the `agy` version gate, the memory basis).

## Licence

MIT.
