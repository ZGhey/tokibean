# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Claude Pet: a Tauri 2 desktop pet that monitors Claude Code activity (via hooks) and token usage (via local JSONL logs). Transparent, always-on-top, frameless window with a tray icon. Cross-platform (Windows/macOS/Linux). All comments, UI text, and the README are in Chinese — keep new code comments and user-facing strings in Chinese to match.

## Commands

```bash
npm install        # one-time; installs @tauri-apps/cli
npm run dev        # tauri dev — compiles Rust and launches with hot-reloaded frontend
npm run build      # tauri build — production bundles (macOS: run `npm run tauri icon app-icon.png` first for icns)
```

Rust-only checks (faster than a full dev launch): `cargo check` / `cargo clippy` inside `src-tauri/`.

There are no tests and no linter configured. The frontend is plain HTML/CSS/JS with no build step — `src/` is served directly (`frontendDist: "../src"` in tauri.conf.json), so frontend edits need no compilation.

## Architecture

Two halves connected by a single Tauri event:

**Rust backend (`src-tauri/src/`)** — owns all state, runs two background threads started in `main.rs`:

1. **Hook server thread** (`hooks_server.rs`): a `tiny_http` server on `127.0.0.1:8737` (configurable). Claude Code hooks POST event JSON to `/event`; the `hook_event_name` field drives per-session state transitions (`UserPromptSubmit`/`PreToolUse`→Working, `Stop`→Done + bubble with duration + celebrate level, `Notification`→Attention, `SessionStart`/`SessionEnd`). State is per `session_id` (HashMap in `Core`), aggregated for display: any attention > any working > any done > limit > idle. Stop notifications are suppressed for jobs shorter than `notify_min_secs`. CAUTION: `push_update` locks `core` — never call it while holding the `core` lock (past deadlock).
2. **Heartbeat thread** (`main.rs`): every 1s expires transient state (Done, bubbles); every 30s rescans usage JSONL and checks 80%/100% usage alerts. Official usage API fetches are event-driven, decided inside `refresh_usage`: on Stop / panel open (via the `official_want` flag), while working with a >5min-old cache, or once the cached reset time passes — never while fully idle. All triggers share a 60s debounce (`official_last_try`), a 5min rate-limit backoff (`official_backoff`), and a 15min token-refresh backoff (`refresh_backoff` — without it an expired credential would hammer the token endpoint into rate-limiting the user's IP).

Both threads mutate `state::Shared` (Mutexes + atomics, managed by Tauri) and push a full `PetUpdate` snapshot to the frontend via `app.emit("pet-update", ...)`.

- `state.rs` — the state machine. Base states with priority: attention > working > done > limit > idle. `limit` (sleeping) is derived, not stored: it's `idle` while subscription block usage ≥ 100%. `warn` (≥ 80%) is an overlay flag, not a state.
- `usage.rs` — incremental parser of `~/.claude/projects/**/*.jsonl`. `Scanner` remembers per-file byte offsets and only reads appended data; dedupes by message/request id (session resume duplicates lines across files); keeps 8 days of events. `build_snapshot` groups events into 5-hour billing blocks (start floored to the UTC hour of first activity — matches ccusage semantics). Subscription block limit is estimated from the historical max block unless `block_limit` is set in config.
- `config.rs` — `~/.config/claude-pet/config.json` (`%APPDATA%\claude-pet` on Windows). `resolved_mode()` decides subscription vs API: explicit setting, else heuristic (`ANTHROPIC_API_KEY` present → api).
- `hooks_install.rs` — merges 5 curl-command hooks into `~/.claude/settings.json` (backs up to `settings.json.bak-claude-pet` first; idempotent by checking for the port marker string). Uses curl commands rather than http-type hooks for Claude Code version compatibility.

**Frontend (`src/`)** — no framework, uses `window.__TAURI__` global (`withGlobalTauri: true`):

- `main.js` — listens for `pet-update`, invokes Tauri commands (`get_update`, `install_hooks`, `set_mode`), renders the usage panel, runs the canvas animation loop.
- `pet.js` — the skin layer, deliberately isolated. All drawing lives here behind one interface: `window.PetRenderer.draw(ctx, canvas, state, warn, bubble, t, extra)` with states `idle | working | attention | done | limit`. `extra` is optional (`{sessions, workSecs, toolNote, celebrate, dragging, pat}`) — old skins that ignore it must keep working. Replacing this file swaps the skin; do not leak rendering logic into main.js.
- Skins live in `src/skins/*.js` (override `window.PetRenderer`, may reuse `window.PetKit`). The default skin in pet.js IS the original mascot "拱门·墩墩" (persimmon arch). `src/skins/tribute.js` is a LOCAL-ONLY skin (gitignored) — never commit it or recreate its likeness in the repo.
- The panel expands the window upward on toggle (`setWindowHeight` in main.js keeps the bottom edge fixed and always measures from the window's *current* height — do not assume it's at BASE_H). Window position persists to config (throttled save on Moved, skipped within 1.2s of a programmatic resize).

## Constraints

- The default skin references the official pixel mascot and is for personal use only — if asked to prepare this project for public distribution, `pet.js` needs an original character and "Claude" must be dropped from the name (see README).
- Changing the port requires reinstalling hooks (the port is baked into the curl commands in settings.json).
- Rust holds locks briefly and clones snapshots out; keep that pattern — the hook server and heartbeat threads share every Mutex in `Shared`.
