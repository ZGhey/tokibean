# Context — Tokibean

Single context: one Tauri app, one package. This file is the project's **ubiquitous language**. When
code, issues, commits, or docs name a concept below, use the term as defined here — don't drift to a
synonym the glossary explicitly rejects.

Architectural decisions live in [`docs/adr/`](docs/adr/).

---

## Glossary

### Agent

An AI coding assistant whose activity the pet watches: **Claude Code**, **Codex**, and (later)
Gemini CLI, Cursor. An agent is identified by a lowercase stable slug — `claude`, `codex` — which
appears in the hook endpoint path, the session key, the config, and the panel.

Claude is the **flagship agent**: it has the deepest support (official usage API, OAuth account
connect, WSL sync). Other agents are first-class but shallower. See [ADR-0001](docs/adr/0001-multi-agent-positioning.md).

Do not say "provider", "tool", "assistant", or "CLI" to mean this. It is an **agent**.

### Session

One conversation/run inside one agent. Keyed by **`(agent, session_id)`** — the session id alone is
not unique across agents. A session carries a base state, its project name (from `cwd`), and its
last-seen instant.

### Base state

One session's status, from the state machine: `Idle | Working | Attention | Done`. Not to be confused
with the **pet state**.

### Pet state

The single value the pet renders: `idle | working | attention | done | limit`. Derived by
**aggregation** across every session of every agent. `limit` is derived, never stored.

Priority: `working > attention > done > limit > idle`. Working outranks attention deliberately — one
session waiting for input must not hide others that are actively working.

### Aggregation

The pure projection (`projection::project`) from all sessions + all quota windows to one `PetUpdate`.
It is **agent-blind for state**: a working Codex session and a working Claude session are both just
"working". It is **agent-aware for quota**: each agent keeps its own quota window.

### Quota window

One agent's own rate-limit window, **self-describing** and never normalized against another agent's:

- **Claude**: the 5-hour billing block. Percentage basis is `official` (Anthropic usage API),
  `manual` (tokens vs. a user-set `block_limit`), or `none`.
- **Codex**: the window reported in its own rollout log — `used_percent`, `window_minutes`,
  `resets_at`. Basis is `official` (it comes from the agent itself). Verified against a real install:
  `used_percent` is on a **0–100 scale** (Claude's is 0–1), and `window_minutes` is **not five
  hours** — it is `43200` (thirty days) on the free plan. **A card that hard-codes "5h" is wrong.**
  The window length is rendered from the data, always.

A Claude 5-hour block and a Codex window are **different quantities**. They are displayed
side by side, one card each, and are never averaged, summed, or compared. See
[ADR-0004](docs/adr/0004-per-agent-quota-window.md).

### Basis

How trustworthy a quota window's percentage is: `official | manual | none`. Only `official` or
`manual` may drive **warn** or **limit** (`pct_valid`). A `none` basis has no percentage at all —
the pet shows nothing rather than a guess.

### Warn

Overlay flag, not a pet state: **any** agent's quota window is ≥80% and <100%.

### Limit

Pet state (sleeping): **every** agent that has a valid percentage is ≥100%, and at least one such
agent exists. Meaning: "there is no work I could do anywhere." Claude exhausted while Codex is free
is **not** a limit. See [ADR-0005](docs/adr/0005-sleep-when-all-exhausted.md).

### Adapter

The per-agent normalizer that maps one agent's raw hook event names and tool names into Tokibean's
**existing** internal vocabulary. There is one state machine, not one per agent. Codex's
`PermissionRequest` becomes Attention (Codex has no `Notification` event); Codex's `shell` and
`apply_patch` become the tool keys `cmd` and `coding`.

### Tool key

A stable, **never localized, never extended** English key naming what the agent is doing:
`cmd | reading | coding | searching | browsing | agents | planning | git | testing | deps`.

This is a **skin contract**: every skin in `src/skins/` matches on these keys to pick an animation.
A new agent maps its tool names *onto* this set. Adding a key means auditing every skin — treat it
as a breaking change.

### Install status

Per agent, three states — and `active` is **observed, never claimed**:

- `absent` — no Tokibean marker in that agent's hook config.
- `pending` — marker written, but the pet has **never received an event** from this agent.
- `active` — an event actually arrived.

`pending` exists because for Codex, written ≠ active: Codex hashes each hook definition and refuses
to run it until the user approves it via `/hooks` in its TUI, and any edit re-arms that review. See
[ADR-0006](docs/adr/0006-install-status-observed.md).

### Hook marker

The substring the installer looks for to decide an agent's hooks are already installed: the
`:<port>/event…` fragment inside that agent's hook command. Idempotency and `incomplete()` both key
off it. Changing the port invalidates every marker — hooks must be reinstalled.

### Imported pollution

Codex's onboarding offers to import a user's Claude Code setup, and that import copies **Tokibean's
own hooks** verbatim into `~/.codex/hooks.json` — curl commands pointing at the **bare `/event`**
path, which means `claude`. Once the user clears Codex's trust gate, Codex events are then counted as
Claude sessions.

A hook carrying the Tokibean marker but pointing at the **bare `/event`** path, found in a *non-Claude*
agent's config, is **imported pollution**: an artifact of that import, not something the user wrote.
The Codex installer strips it. See [ADR-0013](docs/adr/0013-no-config-toml-write-installer-owns-hooks-json.md).

This is a live bug, not a hypothetical — it is the state the verification machine was found in.

---

## Invariants

These are load-bearing. Breaking one is a regression, not a refactor.

1. **One pet, one window.** N agents do not mean N pets. The window position / click-through /
   `PREALLOC` no-resize machinery is untouched by multi-agent work. See [ADR-0003](docs/adr/0003-one-pet-aggregate.md).
2. **A Claude-only user's UI is byte-for-byte today's UI.** Agents are detected by their config dir
   (`~/.codex`); an agent that isn't installed never appears. See [ADR-0007](docs/adr/0007-detect-agents-additive-config.md).
3. **Tool keys are a closed set.** (See *Tool key*.)
4. **Claude's credential fields never move.** `oauth_access` / `oauth_refresh` / `oauth_expires_ms`
   stay at the top level of config.json. The refresh token rotates on every use; a migration bug
   there logs the user out. Config is extended additively, never restructured.
5. **The config directory is `claude-pet`, forever.** Renaming it silently orphans every existing
   user's config, credentials included. The user never sees the path.
6. **Hooks emit valid JSON on stdout.** Every supported agent requires it (Copilot can deadlock
   without it). The hook server replies `{}` with `Content-Type: application/json`, and hook commands
   append `|| echo '{}'` so an offline pet still emits valid JSON. See [ADR-0008](docs/adr/0008-json-stdout-contract.md).
7. **Tokens are all-agent; cost is Claude-only and labeled as such.** The panel never shows a dollar
   figure that pretends to cover an agent whose prices we don't model. See
   [ADR-0009](docs/adr/0009-codex-tokens-not-cost.md).
8. **We only ever touch our own hooks.** In any agent's config file, Tokibean adds, rewrites, or
   removes **only** hooks bearing its own marker. A hook the user wrote is never modified. Every
   config file is backed up before it is written. Tokibean does **not** write `~/.codex/config.toml`
   at all. See [ADR-0013](docs/adr/0013-no-config-toml-write-installer-owns-hooks-json.md).
9. **No code from clawd-on-desk.** It is AGPL-3.0; Tokibean is MIT. Interface facts (which config
   file an agent reads, what its event names are) are not copyrightable and were independently
   verified against each agent's official docs. Its code, structure, and comments are off-limits.
