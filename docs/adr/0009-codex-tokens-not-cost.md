# ADR-0009: Codex contributes tokens, not cost

**Status:** Accepted — 2026-07-13

## Context

Codex's rollout JSONL carries two useful things: `payload.rate_limits` (the quota window — see
[ADR-0004](0004-per-agent-quota-window.md)) and `payload.info.total_token_usage` (token counts).

The panel today also shows today/7-day tokens, a trend chart, a model breakdown, and a **USD cost** —
all Claude-only concepts backed by an Anthropic price table in `config.rs`.

If Codex tokens fold into the totals but cost doesn't, the panel reads "1.2M tokens · $4.10" where
the tokens are two agents and the dollars are one.

## Decision

- **Codex tokens fold into today/7-day totals and the trend chart**, tagged by agent. The daily
  battle-report bubble then means *all* your work, not just Claude's.
- **Cost stays Claude-only and is explicitly labeled as such.** No OpenAI price table.
- The trend chart distinguishes agents so you can see which one burned what.

## Consequences

- Needs a second incremental scanner over `~/.codex/sessions/**`, with the same offset/dedupe
  discipline as `usage.rs`.
- **The trap this ADR originally named does not exist.** It predicted that `total_token_usage` is
  cumulative and would have to be differenced by hand. Verification against a real rollout file found
  that the payload also carries **`info.last_token_usage`** — the per-turn delta, already computed.
  Use it.
- **The real trap, found only in the real bytes:** rollout files that Codex's onboarding *imported*
  from Claude Code carry `rate_limits` fields that are all `null`, and their envelope timestamps are
  **newer** than a genuine turn's. "Newest file wins" and "newest `token_count` line wins" both pick
  a quota-less line and blank the card. The parser must select **the newest `token_count` line whose
  `rate_limits.primary` is non-null**.
- Second verified surprise: **`used_percent` is on a 0–100 scale** (Claude's `five_pct` is 0–1), and
  **`window_minutes` is not five hours** — it is `43200` (thirty days) on the free plan. Both are
  reconciled once, at the parser boundary. See [ADR-0004](0004-per-agent-quota-window.md), which the
  real data vindicates hard: a Codex card that hard-codes "5h" is simply wrong.
- The dollar figure never pretends to be a total it isn't. Cost is already the least-trusted number
  in the panel; giving it a second way to be wrong was not worth it.
- Adding an OpenAI price table later is additive and doesn't change any shape decided here.
