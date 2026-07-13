# ADR-0005: The pet sleeps only when every agent is exhausted

**Status:** Accepted — 2026-07-13

## Context

Today, `at_limit` means "the 5-hour block is at 100%", and it does two things: it puts the pet into
the `limit` (sleeping) state, and it **force-idles every Working/Attention session** — because at the
limit the API is already rejecting requests, so no `Stop` event will ever arrive to end those
sessions, and the pet would pretend to think forever.

With two agents, "Claude at 100%, Codex free and actively editing files" is a real state. Extending
today's rule literally would nap the pet on the desk while work is visibly happening.

## Decision

- **`warn` (≥80%) fires on ANY agent** with a valid basis. It's an overlay — it warns about the
  agent that's nearly out.
- **`limit` (sleep) requires EVERY agent with a valid percentage to be ≥100%** (and at least one such
  agent to exist).
- **The force-idle narrows to the exhausted agent's sessions only.** A Codex session must not be
  force-idled because Claude ran out — a `Stop` will arrive for it perfectly well.
- The limit bubble and notification **name the agent** ("Claude 额度用完了…").

## Consequences

- `limit` keeps its real meaning: "there is no work I could do anywhere." Anything weaker is a lie
  the pet tells on your desk.
- This is the same principle that already makes `working` outrank `attention` in the aggregation: the
  pet must never look idle while work is happening.
- `check_usage_alerts` needs the agent dimension, and the `warned_80` / `warned_limit` latches become
  per-agent (otherwise one agent's alert suppresses the other's).
