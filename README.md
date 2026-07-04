<div align="center">

# Tokibean 🫘

### A desktop pet that shows you what Claude Code is doing

It thinks, codes, searches, and celebrates right alongside you — and keeps an eye on your token budget.

[![Release](https://img.shields.io/github/v/release/ZGhey/tokibean?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ZGhey/tokibean/total?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/releases)
[![Stars](https://img.shields.io/github/stars/ZGhey/tokibean?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/stargazers)
![Platforms](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)
[![License](https://img.shields.io/github/license/ZGhey/tokibean?style=flat-square)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

<img src="docs/gifs/thinking.gif" width="150" alt="thinking"> <img src="docs/gifs/coding.gif" width="150" alt="coding"> <img src="docs/gifs/done.gif" width="150" alt="celebrating">

**[⬇ Download for macOS / Windows / Linux](https://github.com/ZGhey/tokibean/releases/latest)** &nbsp;·&nbsp; macOS one-liner: `brew install --cask zghey/tap/tokibean`

</div>

A desktop pet that lives on your screen and watches Claude Code. No feeding, no leveling — it does just three things:

1. **Knows whether Claude is working**: receives Claude Code hook events in real time — puffs thinking dots while working, bounces happily and fires a system notification when done, waves at you when it needs input or approval.
2. **Live token usage**: parses the local JSONL logs under `~/.claude/projects/`. Subscription users (Pro/Max) see the 5-hour window percentage and reset countdown; API users see today's / last-7-days dollar cost.
3. **Quota state at a glance**: an exclamation mark pops over its head past 80% window usage, and it flops down to sleep once the quota is spent (nothing to do anyway).

Cross-platform: Windows / macOS / Linux (Tauri 2).

> A community project, not affiliated with or endorsed by Anthropic; "Claude" is used only as a factual compatibility reference. The default mascot "Archway Dundun" (拱门·墩墩) is an original character, and every built-in skin is free to redistribute.

## State gallery

Every state has its own animation, so a glance tells you where Claude is:

| Thinking | Running a command | Editing code |
| :---: | :---: | :---: |
| ![thinking](docs/gifs/thinking.gif) | ![cmd](docs/gifs/cmd.gif) | ![coding](docs/gifs/coding.gif) |
| Einstein hair + mustache, pacing with a pipe | QWER keycaps light up as the little hands type | Lightbulb first, then a hard hat and pickaxe |

| Reading files | Searching code | Browsing the web |
| :---: | :---: | :---: |
| ![reading](docs/gifs/reading.gif) | ![searching](docs/gifs/searching.gif) | ![browsing](docs/gifs/browsing.gif) |
| Scholar's cap + monocle, tassel swaying, turning pages | Sweeping left and right with a magnifying glass | A tiny globe spinning beside it |

| Spawning subtasks | Planning | Celebrating a finish |
| :---: | :---: | :---: |
| ![agents](docs/gifs/agents.gif) | ![planning](docs/gifs/planning.gif) | ![done](docs/gifs/done.gif) |
| Mini clones pop out on both sides, hopping in sync | Ticking off tasks on a clipboard | Bounces and throws confetti; bubble reports duration + summary |

| Waiting for you | Something errored | Being picked up |
| :---: | :---: | :---: |
| ![attention](docs/gifs/attention.gif) | ![oops](docs/gifs/oops.gif) | ![drag](docs/gifs/drag.gif) |
| Waves and hops; if you're slow, escalates to a horn/sigh | Angry red marks, shaking with frustration | Dangles and kicks in mid-air, drops back on release |

| Idle / slacking | Background task running | |
| :---: | :---: | :---: |
| ![idle](docs/gifs/idle.gif) | ![satellite](docs/gifs/satellite.gif) | |
| Strolls / naps / stretches / chases a butterfly | A little satellite orbits its head | |

There are also hidden bits — a late-night miner's lamp, hearts when you pat it, flopping down to sleep when the quota runs out. Install it and find them yourself.

## Requirements

All platforms:
- [Rust](https://rustup.rs/) (1.77.2+, just install via `rustup`)
- Node.js 18+

Per-platform extras:
- **Windows**: Microsoft C++ Build Tools (prompted when installing Rust); WebView2 usually ships with the system.
- **macOS**: `xcode-select --install`
- **Linux (Debian/Ubuntu)**:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

> **WSL users**: this is a GUI program — run it on the Windows side (install Rust + Node on Windows), not inside WSL. Claude Code running inside WSL is still detected: the panel's "Install hooks" automatically syncs to each WSL distro's `~/.claude/settings.json` (mirrored networking uses `127.0.0.1` directly; NAT mode switches to the Windows host gateway address, but you also need to set `bind` to `"0.0.0.0"` in the pet config and restart the pet).

## Quick start

```bash
cd tokibean
npm install
npm run dev        # launch in dev mode
```

Once the pet shows up on screen:

1. **Click the pet** → expand the usage panel.
2. Click **"Install Claude Code hooks"** → it writes 7 event forwarders into `~/.claude/settings.json` (backing the file up as `settings.json.bak-claude-pet` first).
3. **Restart Claude Code** (or run `/hooks` inside it) to apply.
4. Send any message in Claude Code → the pet should immediately switch to its "thinking" state.

Hovering over the top reveals a drag handle; hold it to move the pet anywhere. The system tray icon lets you hide/quit.

To build an installer: `npm run build` (on macOS, run `npm run tauri icon app-icon.png` once first to generate the icns icon).

## How it works

```
Claude Code hooks ──HTTP POST──▶ 127.0.0.1:8737/event ──▶ state machine ──▶ pet animation + system notification
~/.claude/projects/*.jsonl ──incremental parse──▶ 5-hour window aggregation ──▶ usage panel + warn/limit state
```

- **Event mapping**: `UserPromptSubmit` → working, `PreToolUse` → shows the current tool ("running a command" / "editing code" …), `Stop` → done (bubble shows duration and a summary of the last message; confetti past 1 minute, a big celebration past 10), `Notification` → waiting for you, `SessionStart/End` → session boundaries.
- **Multi-session**: state is tracked per `session_id`; a ×N badge appears over its head when several run in parallel. Any one working counts as working; it only celebrates when all are done.
- **Notification de-noising**: finishing a task shorter than 30 seconds fires no system notification (tunable via `notify_min_secs` in the config).
- **Hooks forward via curl** rather than http-type hooks, for compatibility with more Claude Code versions; curl ships by default on Win10+/macOS/mainstream Linux.
- **5-hour window semantics**: starts at the UTC top-of-hour of the window's first activity and lasts 5 hours (matching ccusage's block semantics).
- **Official usage (subscription mode)**: automatically reads the local Claude Code login credential (macOS Keychain / `~/.claude/.credentials.json` / Windows Credential Manager) and queries the Anthropic official usage endpoint for real 5-hour-window and weekly percentages. The credential is used only in memory on your machine, sent only to `api.anthropic.com`, never written to disk or shared. You can also authorize separately via "Connect Claude account" in the panel.
- **About subscription limits**: Anthropic doesn't publish exact limits, and they float with server load. Without official data, the estimate defaults to your **historical peak window usage** as the baseline; set `block_limit` in the config to specify it manually.
- **Subscription vs API detection**: in auto mode, `ANTHROPIC_API_KEY` in the environment means API billing, otherwise subscription. Switch manually in the panel if it guesses wrong.
- **Auto-update** (from 0.2.0): checks for new releases on launch and every 24h; when one is found the panel shows a one-click "Update" banner (or use the tray's *Check for Updates…*), which downloads, installs, and relaunches. Update packages are signed and served from GitHub Releases. Existing 0.1.x users download 0.2.0 manually once — updates are in-app from there on.

## Configuration

Config file: `~/.config/claude-pet/config.json` (macOS: `~/Library/Application Support/claude-pet/config.json`; Windows: `%APPDATA%\claude-pet\config.json`), auto-generated on first run:

```jsonc
{
  "mode": "auto",        // auto | subscription | api
  "port": 8737,          // hook server port; reinstall hooks after changing
  "block_limit": 0,      // subscription window limit (token count), 0 = auto-learn
  "notify": true,        // system notification toggle
  "prices": { ... }      // per-model unit prices for API cost estimation, USD / million tokens; edit when stale
}
```

## Uninstalling hooks

Open `~/.claude/settings.json` and delete every hook entry whose `command` contains `127.0.0.1:8737/event`; or just restore from the backup `settings.json.bak-claude-pet`.

## Skins

Built-in skins: **Archway Dundun (default, persimmon orange)** / Bean / Tabby cat, switchable instantly from the panel dropdown. A skin is a standalone file under `src/skins/` that overrides `window.PetRenderer` and may reuse the `window.PetKit` toolkit (pixels / bubbles / status boxes / hearts / confetti).

All drawing logic lives in the single file `src/pet.js`. Keep the `window.PetRenderer.draw(ctx, canvas, state, warn, bubble, t, extra)` interface unchanged and draw however you like. There are 5 states: `idle / working / attention / done / limit`, plus a `warn` overlay flag. The 7th argument `extra` is optional (old skins can ignore it): `{sessions, workSecs, attnSecs, toolNote, celebrate, oops, bgCount, dragging, pat}` — for the multi-session badge, work-time corner tag / tired face, tool label, celebration level, error frustration, background-task satellite, drag dangle, and head pat respectively.

> Not affiliated with Anthropic; "Claude Code" is used only as a factual compatibility reference.

## Known limitations

- **Linux Wayland**: transparency and always-on-top depend on the compositor; where unsupported it degrades to a normal window. X11 has no such issue.
- **Quota percentage is an estimate**: without official data, the 80%/100% thresholds are based on your historical peak window or a manually set value.
- **Only counts Claude Code**: usage from the claude.ai web app isn't in local files, so it can't be monitored.
- **Weekly limit**: the official figure isn't published; the panel's "last 7 days" is a rolling approximation.
- If port 8737 is in use, the hook server fails to start (check the terminal log); change the port in the config and reinstall hooks.

## Star history

If Tokibean made you smile, a ⭐ helps others find it.

<a href="https://star-history.com/#ZGhey/tokibean&Date">
  <img src="https://api.star-history.com/svg?repos=ZGhey/tokibean&type=Date" width="600" alt="Star History Chart">
</a>
