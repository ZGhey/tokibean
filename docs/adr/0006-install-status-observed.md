# ADR-0006: Install status is observed, not claimed

**Status:** Accepted — 2026-07-13

## Context

`hooks_install.rs` reports success when it writes the marker into the agent's config. For Claude,
written is close enough to active.

**For Codex it isn't.** Codex hashes each hook definition and **will not run it until the user
approves it via `/hooks` in the Codex TUI** — and any subsequent edit re-arms that review. Codex also
requires `[features] hooks = true` in `~/.codex/config.toml` before hooks run at all.

A user who clicks install, sees "installed", and then sees the pet do nothing will conclude the pet
is broken. The install claim would be false, and there'd be no way for the user to discover why.

## Decision

**Per-agent install status is a three-state value, and `active` is a fact we observed:**

- `absent` — no Tokibean marker in that agent's hook config.
- `pending` — marker written, but the pet has **never received an event** from this agent.
- `active` — an event actually arrived from this agent.

`Shared.hooks_seen: AtomicBool` becomes a per-agent set. While an agent is `pending`, the panel shows
the exact next step ("Run `/hooks` in Codex and approve").

## Consequences

- The pet stops claiming success it hasn't verified.
- This same signal retroactively catches a **silently-broken Claude install** — a case we previously
  had no way to distinguish from "you just haven't used Claude yet".
- `pending` is not an error state and must not be styled like one: for Codex it is the *expected*
  state immediately after install.
