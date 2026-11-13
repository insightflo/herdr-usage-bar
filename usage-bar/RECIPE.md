# Usage bar

A 24px line for the bottom of the window: how full this Mac is, and how much of
each AI subscription is left before it resets. Left to right, one quiet row —
`Host CPU 58% · 디스크 76% · 메모리 82% · 스왑 91% (4.0G)`, then one item per
signed-in service: `Codex plus 25% — 4d 19h 후 초기화`, `GLM pro 95% — 57m 후
초기화`, `Antigravity Gemini 100% — 2d 7h 후 초기화`. A service you are not
signed in to draws nothing, so the line stays as short as it can be. Three
numbers per service is all it says: the name, the percent of the window closest
to running out, and the time left on that window.

![Usage bar](preview.png)

## What you see

One block, the full window width, **24px** tall (`{"type":"block","size":{"px":24},
"content":{"mod":"herdr-tui-layout-status"}}` in a layout's bottom child). Its
background is the theme's `chrome`, with a 1px `border` line on all four sides —
so at the bottom of a dark window it reads as a single hairline box, not a
panel. Inside: `px(8)` padding, `gap(12)` between the row and each item, every
glyph at **12px**.

Two kinds of row, same height, both vertically centred:

1. **Host row, always first, only when a reading exists.** The word `Host` in
   `dim`, then up to four measurements, each a `dim` label plus a **semibold**
   percent, joined by a `·` in `dim`:
   - `CPU 58%` — user + sys from one `top` sample.
   - `디스크 76%` — the APFS **Data** volume's used percent (the one that
     actually fills up), not `/`.
   - `메모리 82%` — Activity Monitor's basis: app memory + wired + compressed
     over physical RAM; cached file pages do not count as in use.
   - `스왑 91% (4.0G)` — used/total swap percent, then the total size in
     gigabytes to one decimal, in parentheses. The size is part of the label
     because 91% of 1G and 91% of 8G are different problems.

2. **One row per service**, in this fixed order: `Claude`, `Codex <plan>`,
   `GLM <level>`, `Antigravity Gemini`, `Antigravity Claude·GPT`. The name is
   `dim`; the percent is **semibold**; then `dim` `— 4d 19h 후 초기화`. The
   remaining time is `Nd Nh` over a day, `Nh Nm` over an hour, `Nm` under an
   hour; when the reset time is unknown or already passed, the row ends at a
   bare `—` instead of inventing a countdown. The plan/level suffix (`plus`,
   `pro`, `team`) is whatever the provider reports, and is dropped when it
   reports nothing.

**Colour is the only alarm.** Every percent — host and usage alike — is
`foreground` below 75, `working` from 75, `blocked` from 95. Nothing blinks,
nothing is bold-faced twice, no icon pretends to be a gauge; the percentages
are the whole picture and the bar is meant to be read in a glance or ignored.

Empty states, centred alone in the left padding: `usage: first refresh…` in
`accent` while the first round is still out, and — once a round has finished
and found nothing — `usage: no subscription found` in `dim`.

## How it behaves

- **On open**, no waiting: the two loops start, the block paints its empty
  state immediately, and results land as they arrive. A slow provider never
  holds up the others — each is its own promise, `allSettled`, so one failure
  is one missing item instead of a dead bar.
- **Host loop**, every **60s**: one `sh` call reads CPU, disk, memory and swap
  at once. This is the cheap half, so it moves every minute.
- **Usage loop**, every **5 min** with a 15s cap per round: the four providers
  are asked in parallel; a round that hangs (a keychain dialog waiting for a
  click, a stalled HTTPS request) is abandoned at 15s but still applied if it
  settles — a late answer overwrites nothing else.
- **Countdown tick**, every **60s**: a re-render only. The time text is derived
  from `Date.now()`, so `4d 19h` becomes `4d 18h` without a network call.
- **Clicks, keys, hovers: nothing.** This mod is read-only and takes no input;
  it never opens a panel. The one interaction it has is with the OS: the first
  keychain read may raise macOS's "allow access" dialog — allow it once and the
  Claude item appears and stays.
- **Nothing is logged and nothing is stored.** Tokens are read per fetch into
  memory and never written, printed or kept in `shared.json`. There is no state
  to lose across restarts; the bar fills again on the next paint.

## Built from

One mod, `mods/herdr-tui-layout-status/` (`main.js` + `mod.json`), no other
mods, no `keys.json`, no assets. Imports `View`, `div` from `gpui-kit`;
`h_flex` from `gpui-base`; `exec` and `theme` from `herdr`. It uses the
platform `fetch` for HTTPS. It calls no `hc` command and touches no terminal.

Layout wiring, bottom child of the window column:

```json
{ "id": "status", "type": "block", "content": { "mod": "herdr-tui-layout-status" },
  "size": { "px": 24 } }
```

Sources, one per service — the method Orca's bottom line uses:

| Item | Credential | Request |
| --- | --- | --- |
| Claude | `security find-generic-password -s 'Claude Code-credentials' -w`, else `~/.claude/.credentials.json`; `claudeAiOauth.accessToken` | `GET https://api.anthropic.com/api/oauth/usage`, `Bearer`, `anthropic-beta: oauth-2025-04-20`; pick the worst of `five_hour` / `seven_day` (`used_percentage`, `resets_at`) |
| Codex | `~/.codex/auth.json` → `tokens.access_token`, `tokens.account_id` | `GET https://chatgpt.com/backend-api/wham/usage`, `Bearer`, `chatgpt-account-id`; worst of `rate_limit.primary_window` / `secondary_window` (`used_percent`, `reset_at` × 1000) |
| GLM | `~/.opencodex/auth.json` → `glm-zcode` active account `credential.access`, else `~/.zcode/cli/config.json` provider `options.apiKey` (+ its `baseURL` origin) | `GET {origin}/api/monitor/usage/quota/limit`, `Bearer`; worst of `data.limits[].percentage` / `nextResetTime`; `data.level` is the suffix |
| Antigravity | local CLI only, no token file | `agy --version` (gate) then `agy -p '/usage' --output-format json --print-timeout 12s`; `command.data.groups[].buckets[]` → `(1 - remaining_fraction) * 100`, `reset_time`; a group named `/gemini/i` is `Antigravity Gemini`, any other is `Antigravity Claude·GPT` |

Host row, one `sh -c` string: `top -l 1 -n 0` (CPU usage, PhysMem), `vm_stat`
(active / inactive / wired down / occupied by compressor / File-backed pages /
page size), `df -k /System/Volumes/Data`, `sysctl -n hw.memsize`,
`sysctl -n vm.swapusage`.

## Watch out

- **It reaches the network and runs programs.** Install it only if that is
  fine: four HTTPS calls to Anthropic, OpenAI, z.ai and a local CLI. Say so
  before copying it into someone's window.
- **The Host row is macOS only.** `top -l 1`, `vm_stat`, `df` on
  `/System/Volumes/Data`, `sysctl hw.memsize` and `sysctl vm.swapusage` are the
  Darwin spelling. On Linux the whole row silently disappears (the percentages
  are simply absent) — port it to `vmstat`/`free`/`df` if you want it there.
  The usage items above it are portable; only Claude's keychain read is
  macOS-flavoured, with the credentials file as the fallback.
- **Memory is not "free RAM".** Activity-Monitor basis means
  `(active + inactive − file-backed + wired + compressor) × pageSize /
  hw.memsize`. This Mac's `vm_stat` has **no** `Pages anonymous` field, so
  anonymous memory is derived as `active + inactive − file-backed`; if any of
  those lines is missing the mod falls back to `top`'s `PhysMem used/(used+unused)`,
  which reads several points higher. Expect the two numbers to differ.
- **What "the percent" means is the worst window, not the sum.** Claude's 5h
  and weekly windows both exist; the item shows whichever is closest to
  running out, and its own reset. The same applies per Antigravity group.
- **The labels are Korean** (`디스크`, `메모리`, `스왑`, `후 초기화`) — that is
  how it was built for its author. Translating them is a two-line edit in
  `hostRow()` and `itemRow()`; leave them if the window is Korean.
- **`agy` is gated on purpose.** Below 1.1.11, `agy -p /usage` spends quota
  instead of reporting it, so the mod refuses to run the CLI at all. Two more
  traps live in the same snippet: `AGY_CLI_DISABLE_AUTO_UPDATE=true` (an
  auto-update would hang the read) and `< /dev/null` (given an open pipe on
  stdin, `agy` waits for input forever). Also bind the binary to a variable —
  `A="$(command -v agy || echo …)"; exec "$A" args` — because the tempting
  `command -v agy && exec agy || exec …` form attaches the arguments to the
  fallback branch only, launching bare interactive `agy` when it is on `PATH`.
- **A service with no credential draws no row at all**, silently and by
  design. If somebody expects five items and sees four, the missing one is a
  sign-in problem, not a bug: check the table above. On this Mac the Claude item
  can be absent because the keychain entry holds only `mcpOAuth` (no
  `claudeAiOauth.accessToken`) and `~/.claude/.credentials.json` does not exist.
- **`GLM` reads a coding-plan key out of another tool's store.** If neither
  opencodex nor the ZCode CLI has ever been configured, that item is simply
  missing.
- **Sizes are fixed**, not draggable: everything is `flex_none` at 12px, so on
  a narrow window the items are clipped from the right rather than reflowed.
  Five services plus four host numbers need roughly 900 logical pixels.

## Done when

- `herdr-app check <this folder>/mods/herdr-tui-layout-status` passes.
- Dropped into a layout as a 24px bottom block, the window shows a single
  hairline strip at the bottom, and `herdr-app shot` shows `Host` followed by
  at least one labelled percent on the left.
- At least one service row appears on a machine signed in to it, with its name
  in `dim`, its percent semibold, and a countdown of the form `4d 19h` /
  `57m`; a section with no sign-in is absent rather than shown as `0%`.
- Regressing on purpose: with no credential at all, the strip reads
  `usage: first refresh…` and then `usage: no subscription found` — never a
  crash, never a permanent `0%`.
- The percent turns `working`-coloured between 75 and 95 and `blocked`-coloured
  from 95, on either a host number or a usage item.
- A minute later the strip is still there and the countdown has moved — proof
  the 60s tick is alive and that the fetch loop did not die with one provider.
