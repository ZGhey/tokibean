# ADR-0004: One quota card per agent; quota windows are never normalized

**Status:** Accepted — 2026-07-13

## Context

`UsageSnapshot` is a single flat struct: one `mode`, one `basis`, one `block_pct`, one
`block_reset_ts`. `projection::usage_flags` derives `warn` / `at_limit` from that single percentage.

Claude's quantity is "percent of a 5-hour billing block, on an `official` / `manual` / `none` basis."
Codex's quantity is "`used_percent` against a window whose length it tells us in `window_minutes`,
resetting at `resets_at`." **These are different quantities.** They have different lengths, different
reset semantics, and different provenance. Averaging or summing them produces a number that means
nothing.

## Decision

**`UsageSnapshot` goes from flat to a list: one entry per agent, each carrying its own percentage,
basis, window label, and reset time, read from that agent's own metadata. The panel renders one card
per agent. Nothing is normalized, averaged, or compared across agents.**

An agent with no quota (Cursor, later) simply has no card — not a card reading "unknown".

## Consequences

- Breaking shape change to `UsageSnapshot`, touching `usage.rs`, `projection.rs`, `state.rs`, and
  `main.js`. This is the largest single diff in the feature and should be its own ticket.
- The panel can honestly answer "how much Codex do I have left" — which is the entire reason we read
  its rollout files.
- Adding Gemini or Cursor later is additive: a new entry in the list, not a new special case.
- The "single worst-case bar" alternative was rejected: it makes the pet logic trivial but throws
  away the per-agent number users actually want.
