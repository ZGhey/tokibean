# ADR-0003: One pet, aggregating across all agents

**Status:** Accepted — 2026-07-13

## Context

With N agents, "how many pets, and what does the pet show" is the first question. Options were: one
pet aggregating everything; one pet that visually signals *which* agent is driving it; or one pet
window per agent.

Tokibean's window machinery is its most expensive, hardest-won code: the `PREALLOC` never-resize rule
(a resize that moves the window's top edge makes the pet flash, because the webview paints the stale
frame for one frame after the geometry changes — and doing move+resize atomically does not fix it),
the layout-independent `pet_anchor_y` persistence, and the 50ms click-through thread that decides
which strip of a mostly-transparent window is solid.

## Decision

**One pet. `Session` gains an `agent` field, and the existing priority aggregation
(`working > attention > done > limit > idle`) runs across all sessions regardless of agent.**

- The ×N badge counts working sessions across all agents.
- The panel's per-session list gains an agent label per row.
- The pet body itself carries **no** agent tint or glyph.

## Consequences

- Zero new window management. The `PREALLOC` rule, `pet_anchor_y`, the click-through thread, and the
  tray are untouched by this feature. This is the whole point.
- Every skin keeps working with no changes — the pet renders the same five states it always did.
- A user with three agents working at once sees one busy pet, not three. Accepted: the pet is a
  *mood*, and the panel is where you go for detail. An agent tint was rejected because with N agents
  working the glyph has to pick a winner anyway, and it would add surface to the skin contract that
  every existing skin would have to implement.
