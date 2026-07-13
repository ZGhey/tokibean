# ADR-0007: Agents are detected; config grows additively

**Status:** Accepted — 2026-07-13. **Amended by [ADR-0014](0014-setup-lives-in-settings.md)** on two
points, same day:

1. *"Detect, don't configure"* was only ever implemented for Codex. Claude was never detected at all,
   so a user who has never touched Claude Code was shown an "Install Claude Code hooks" button — and
   clicking it created `~/.claude` for him. Claude is now detected the same way Codex is.
2. *"An agent appears in the UI only if its config directory exists"* was too broad: applied to the
   **Settings** window it means almost nobody ever learns Tokibean supports Codex. The rule is narrowed
   to the **panel** (the daily glance). Settings may show an undetected agent, greyed and honestly
   labelled — that is information, not clutter.

Detection also became live (it ran once at startup), and the config directory is now overridable per
agent, because `CLAUDE_CONFIG_DIR` / `CODEX_HOME` users were invisible to us entirely. See ADR-0014.

## Context

Two questions, one answer: how does the pet decide which agents to watch, and what happens to the
config.json of every existing user?

`Config` is flat, and it holds live credentials: `oauth_access`, `oauth_refresh`, `oauth_expires_ms`.
**Anthropic's refresh token rotates on every use and invalidates the old one.** A migration that
rewrites those fields wrongly doesn't produce a cosmetic bug — it logs the user out of an account
they had to connect through a browser OAuth flow.

## Decision

**Detect, don't configure.** An agent appears in the UI only if its config directory exists on the
machine (`~/.claude`, `~/.codex`). A Claude-only user's UI is byte-for-byte today's UI — no Codex
button, no empty Codex card, no new setting to notice.

**Config grows by exactly one additive field:** `agents: { codex: { enabled: bool } }`, used only to
*override* detection (opt out of a detected agent).

**Claude's fields stay at the top level.** `mode`, `block_limit`, `oauth_*` are not moved under
`agents.claude.*`. `#[serde(default)]` means every existing config.json loads unchanged, and there is
**zero migration code**.

## Consequences

- Zero risk to the credential fields. This is the point.
- The config shape is asymmetric: Claude's settings are top-level, other agents' are nested. Accepted
  — it mirrors [ADR-0001](0001-multi-agent-positioning.md) (Claude is the flagship, not one of N
  equals), and symmetry isn't worth a migration that can log people out.
- Explicit opt-in (every agent off until ticked) was rejected: the discovery moment — "oh, it watches
  Codex too" — *is* the feature. Hiding it behind a checkbox the user must find wastes it.
- If a future agent's config lives somewhere non-obvious, detection needs a per-agent probe function,
  not a shared path convention.
