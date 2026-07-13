# ADR-0001: Tokibean is an agent pet, Claude-first

**Status:** Accepted — 2026-07-13

## Context

Tokibean watches exactly one agent: Claude Code. [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk),
the same idea, watches 18 coding agents and took 5,307 stars in 4 months without even setting a
homepage URL. It collects the users and the search traffic of every one of those ecosystems.
Tokibean collects one. That is a ceiling no amount of SEO moves.

The alternative framings were: stay Claude-only (accept the ceiling), or go fully agent-neutral
(no flagship).

## Decision

**Tokibean is "a desktop pet for AI coding agents — Claude Code, Codex, Gemini, Cursor", with Claude
as the flagship.**

Claude keeps the deepest support — the official Anthropic usage API, in-app OAuth account connect,
WSL hook sync. Other agents are first-class citizens of the state machine and the panel, but
shallower where their platform gives us less.

## Consequences

- Existing users' mental model survives; existing assets get an edit, not a rewrite.
- The Claude-specific machinery (`official.rs`, `login.rs`, the 5-hour block) stays as-is rather than
  being generalized into an abstraction that has exactly one implementation.
- Outward-facing assets (repo description, topics, landing page, OG card, both READMEs) must be
  updated — but only in the same release that actually ships another agent. See [ADR-0010](0010-assets-ship-with-the-feature.md).
- Full neutrality remains available later; this decision doesn't foreclose it.
