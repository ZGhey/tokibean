<div align="center">

# Tokibean 🫘

### A desktop pet that shows you what your AI coding agent is doing

Claude Code and Codex. It thinks, codes, searches, and celebrates right alongside you — and keeps an eye on your quota.

[![Release](https://img.shields.io/github/v/release/ZGhey/tokibean?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ZGhey/tokibean/total?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/releases)
[![Stars](https://img.shields.io/github/stars/ZGhey/tokibean?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/stargazers)
![Platforms](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)
[![License](https://img.shields.io/github/license/ZGhey/tokibean?style=flat-square)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

<img src="docs/gifs/thinking.gif" width="150" alt="thinking"> <img src="docs/gifs/coding.gif" width="150" alt="coding"> <img src="docs/gifs/done.gif" width="150" alt="celebrating">

**[⬇ Download for macOS / Windows / Linux](https://github.com/ZGhey/tokibean/releases/latest)** &nbsp;·&nbsp; macOS one-liner: `brew install --cask zghey/tap/tokibean`

</div>

A desktop pet that lives on your screen and watches your AI coding agents — **Claude Code** and **Codex**. No feeding, no leveling — it does just three things:

1. **Knows whether your agent is working**: receives hook events in real time — puffs thinking dots while working, bounces happily and fires a system notification when done, waves at you when it needs input or approval. Run several agents at once and it watches all of them: one pet, a ×N badge, and a session list that names which agent (and which project) needs you.
2. **Live quota and token usage**: Claude's 5-hour window and Codex's own window sit side by side, one card each — each with its own length and its own reset, never averaged together. Plus today's and this week's tokens across every agent.
3. **Quota state at a glance**: an exclamation mark pops over its head when any agent passes 80%, and it flops down to sleep only once *every* agent is spent (if Codex still has room, there's still work to do).

Cross-platform: Windows / macOS / Linux (Tauri 2).

**What makes it different from the other coding-agent pets:** for Claude it reads the **official Anthropic usage API** (connect your account once, in-app OAuth), so the 5-hour-window percentage and reset countdown are the real numbers, not an estimate. It also has a whole ambient world — real moon phases, seasons, weather, festivals — all computed offline from your local clock.

Claude Code is the flagship: it gets the official usage API, in-app account connect, and WSL hook sync. Codex is first-class but simpler — its quota comes free from its own local logs, no login required.

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

### Ambience & Easter eggs

The scene lives on its own — all from your local clock, no network:

- **🌙 Real moon phase** at night, computed from the date — it waxes and wanes over the month.
- **🍂 Seasons**: drifting snow, spring blossom, summer fireflies (out at dusk), autumn leaves.
- **🎉 Festivals**: New Year fireworks, Lunar New Year lanterns, a Christmas tree, a Halloween pumpkin, a Mid-Autumn mooncake under the full moon.
- **🌦 Weather**: the odd spell of rain (it puts up an umbrella) or wind (things blow sideways).
- **☕ Time of day**: a morning coffee break, and extra-drowsy head-nods in the small hours.
- **👀 Eyes that follow your cursor**; **😆 tickle it** (wiggle over it fast) for a giggle, or pat it for hearts.
- **🌅 Quota reset**: as the 5-hour window is about to refill, the sleeping pet stirs awake at dawn.

Plus the original hidden bits — flopping down to sleep when the quota runs out, and more. Install it and find them yourself.

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

Once the pet shows up on screen, open **Settings** (from the tray, or the ⚙ at the bottom of the usage panel). Setup lives there, not in the daily panel — you do it once and never look at it again.

**Claude Code** — the *Claude Code* tab:

1. Click **"Install hooks"** → it writes 7 event forwarders into `~/.claude/settings.json` (backing the file up as `settings.json.bak-tokibean` first). On Windows this also syncs into each WSL distro that has Claude Code.
2. **Restart Claude Code** (or run `/hooks` inside it) to apply.
3. Send any message in Claude Code → the pet should immediately switch to its "thinking" state.

**Codex** — the *Codex* tab (Settings lists it whether or not you have it; the panel only ever shows agents you actually run):

1. Click **"Install hooks"** → writes into `~/.codex/hooks.json` (backed up first).
2. **Run `/hooks` inside Codex and approve them.** This step is not optional: Codex hashes every hook definition and refuses to run it until you say so, and any edit re-arms that review. Until then Codex is not merely quiet — it will happily print `hook: … Completed` while never running the command at all.
3. Run anything in Codex → the panel flips to *"Active"*, because an event actually arrived. That is the only honest proof, which is why we wait for it.

> Hooks written but the pet still ignores Codex? [docs/codex-hooks.md](docs/codex-hooks.md) — why Codex prints `Completed` for a hook it never ran, and how to tell whose hook actually failed.

> **If you let Codex import your Claude Code setup** (its onboarding offers this), it copied Tokibean's own hooks into `~/.codex/hooks.json` — still pointing at Claude's endpoint. Left alone, your Codex work would be counted as Claude's. Installing Codex hooks cleans those copies up; the panel tells you when it did.

Hovering over the top reveals a drag handle; hold it to move the pet anywhere. The system tray icon lets you hide/quit.

To build an installer: `npm run build` (on macOS, run `npm run tauri icon app-icon.png` once first to generate the icns icon).

## How it works

```
Claude Code hooks ──POST──▶ 127.0.0.1:8737/event        ─┐
Codex hooks       ──POST──▶ 127.0.0.1:8737/event/codex  ─┴─▶ one state machine ──▶ pet + notifications

~/.claude/projects/*.jsonl  ──incremental parse──▶ 5-hour window   ─┐
~/.codex/sessions/*.jsonl   ──incremental parse──▶ Codex's window  ─┴─▶ one quota card each
```

- **Event mapping**: `UserPromptSubmit` → working, `PreToolUse` → shows the current tool ("running a command" / "editing code" …), `Stop` → done (bubble shows duration and a summary of the last message; confetti past 1 minute, a big celebration past 10), `Notification` → waiting for you, `SessionStart/End` → session boundaries. Shell commands are recognized a bit further — `git`, running tests, and installing dependencies each get their own animation.
- **Multi-agent, multi-session**: state is tracked per `(agent, session_id)`, and the agent is decided at install time by the hook's URL path — never guessed from the payload. A ×N badge appears over its head when several run in parallel, across all agents. Any one working counts as working; it only celebrates when all are done. The usage panel lists each session by agent, project folder, state, and elapsed time.
- **Quota windows are never normalized**: Claude's is a 5-hour billing block; Codex reports its own window (thirty days on the free plan) with its own reset. They are different quantities, so they get one card each, with the length rendered from the agent's own data. The pet warns when *any* agent passes 80%, but only sleeps when *every* agent with a real percentage is spent — napping while Codex is free would be a lie.
- **Codex's quota is free**: it writes `used_percent`, its window length and its reset straight into `~/.codex/sessions/**/*.jsonl`. No OAuth, no API call, no token to refresh. (Tokens count toward the totals; cost does not — we model Anthropic's prices and nobody else's, so the dollar figure is labelled as Claude's rather than pretending to be a total.)
- **Codex's trust gate**: Codex hashes each hook definition and won't run it until you approve it via `/hooks`, so "written" is not "live". The panel only claims *Active* once an event has actually arrived. Two things Codex simply cannot tell us: whether a tool *failed* (a successful `true` and a failing `false` produce byte-identical payloads), and whether it was reading or searching (it does both through `Bash`), so the pet skips its annoyed face on Codex rather than guessing.
- **Notification de-noising**: finishing a task shorter than 30 seconds fires no system notification (tunable via `notify_min_secs` in the config).
- **Hooks forward via curl** rather than http-type hooks, for compatibility with more Claude Code versions; curl ships by default on Win10+/macOS/mainstream Linux.
- **5-hour window semantics**: starts at the UTC top-of-hour of the window's first activity and lasts 5 hours (matching ccusage's block semantics).
- **Official usage (subscription mode)**: click **"Connect Claude account"** in the panel once — a standard OAuth flow opens in your browser and Tokibean stores its **own** credential, then queries the Anthropic official usage endpoint for real 5-hour-window and weekly percentages. It refreshes that token itself in the background (with backoff), so you only connect once — no re-login when the access token expires or after a reboot. As a standalone app it deliberately does **not** borrow the Claude Code CLI's credential (Keychain / `.credentials.json` / Credential Manager); before you connect there is no 5-hour-window percentage unless you set a manual limit. The token stays on your machine, sent only to `api.anthropic.com`. (If the stored credential ever goes stale, the panel simply prompts you to reconnect.)
- **About subscription limits**: Anthropic doesn't publish exact limits, and they float with server load. Without official data the panel shows no window percentage; to get one without connecting, set `block_limit` (a token count) in the config manually.
- **Subscription vs API detection**: in auto mode, `ANTHROPIC_API_KEY` in the environment means API billing, otherwise subscription. Switch manually in the panel if it guesses wrong.
- **Auto-update** (from 0.2.0): checks for new releases on launch and every 24h; when one is found the panel shows a one-click "Update" banner (or use the tray's *Check for Updates…*), which downloads, installs, and relaunches. A manual *Check for Updates…* also confirms with a dialog when you're already on the latest version. Update packages are signed and served from GitHub Releases. Existing 0.1.x users download 0.2.0 manually once — updates are in-app from there on.
- **Launch at login** (from 0.3.3): toggle it in the Settings window — Tokibean registers itself with the OS (Windows `Run` registry key / macOS LaunchAgent / Linux `.desktop`) so it starts quietly with your session. The switch reflects the real system state, so it stays in sync even if you change it elsewhere.
- **Pet size** (from 0.4.4): pick Small / Normal / Large / Extra large in the Settings window. Only the pet scales (the usage panel stays the same size); it grows in place from its feet and applies instantly. Rendered crisp at any size — the pixel art stays sharp.

## Configuration

Config file: `~/.config/tokibean/config.json` (macOS: `~/Library/Application Support/tokibean/config.json`; Windows: `%APPDATA%\tokibean\config.json`), auto-generated on first run.

> Upgrading from a build older than 0.5.0? That one kept its config in a `claude-pet` directory, back when the pet only watched Claude Code. The new build adopts it on first launch — connected account, pet position, skin and all — so there is nothing to do and nothing to reconnect. The old directory is left untouched, in case you ever go back.

```jsonc
{
  "mode": "auto",        // auto | subscription | api
  "port": 8737,          // hook server port; reinstall hooks after changing
  "block_limit": 0,      // subscription window limit (token count), 0 = no local % (connect an account for official usage)
  "notify": true,        // system notification toggle
  "prices": { ... }      // per-model unit prices for API cost estimation, USD / million tokens; edit when stale
}
```

## Uninstalling hooks

Open `~/.claude/settings.json` (and/or `~/.codex/hooks.json`) and delete every hook entry whose `command` contains `127.0.0.1:8737/event`; or just restore from the backup — `settings.json.bak-tokibean` for Claude Code, `hooks.json.bak-tokibean` for Codex.

## Skins

Built-in skins: **Archway Dundun (default, persimmon orange)** / Tabby / Shiba / Maneki / Daruma / Tu'er Ye, switchable instantly from the panel dropdown. A skin is a standalone file under `src/skins/` that overrides `window.PetRenderer` and may reuse the `window.PetKit` toolkit (pixels / bubbles / status boxes / hearts / confetti).

Skins can also rotate on their own: Settings → Skin rotation, hourly or daily (aligned to the top of the hour / local midnight), cycling through whichever skins you tick. The current skin is derived from the clock — a restart lands on the same one — and picking a skin by hand simply turns rotation off.

All drawing logic lives in the single file `src/pet.js`. Keep the `window.PetRenderer.draw(ctx, canvas, state, warn, bubble, t, extra)` interface unchanged and draw however you like. There are 5 states: `idle / working / attention / done / limit`, plus a `warn` overlay flag. The 7th argument `extra` is optional (old skins can ignore it): `{sessions, workSecs, attnSecs, toolNote, celebrate, oops, bgCount, dragging, pat}` — for the multi-session badge, work-time corner tag / tired face, tool label, celebration level, error frustration, background-task satellite, drag dangle, and head pat respectively.

> Not affiliated with Anthropic; "Claude Code" is used only as a factual compatibility reference.

## Known limitations

- **Linux Wayland**: transparency and always-on-top depend on the compositor; where unsupported it degrades to a normal window. X11 has no such issue.
- **Quota percentage needs official data or a manual limit**: connect an account for real percentages, or set `block_limit`. With neither, there's no window percentage and no 80%/100% alert (an earlier auto-estimate from your historical peak was removed as too unreliable).
- **Only counts local agent usage**: work done in the claude.ai or ChatGPT web apps isn't in local files, so it can't be monitored.
- **No "oops" face on Codex**: Codex's hook payload cannot express that a tool failed — success and failure are byte-identical — so the pet doesn't guess. Its `reading`/`searching` animations are also rare on Codex, which reads and greps through the shell.
- **Weekly limit**: the official figure isn't published; the panel's "last 7 days" is a rolling approximation.
- If port 8737 is in use, the hook server fails to start (check the terminal log); change the port in the config and reinstall hooks.

## Star history

If Tokibean made you smile, a ⭐ helps others find it.

<a href="https://star-history.com/#ZGhey/tokibean&Date">
  <img src="https://api.star-history.com/svg?repos=ZGhey/tokibean&type=Date" width="600" alt="Star History Chart">
</a>
