# ADR-0002: Codex is the only new agent in v1

**Status:** Accepted — 2026-07-13

## Context

Three agents were candidates for the first multi-agent release.

- **Codex** — hooks in `~/.codex/hooks.json`; event names nearly identical to Claude's
  (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, …); payload is snake_case
  JSON on stdin with `session_id`, `cwd`, `hook_event_name`, `tool_name`. **And its quota is free
  on disk**: `~/.codex/sessions/**/rollout-*.jsonl` carries `payload.rate_limits.primary|secondary`
  with `used_percent`, `window_minutes`, `resets_at`. No OAuth, no API call — the exact thing
  `official.rs` + `login.rs` cost us hundreds of lines to obtain for Claude.
- **Gemini CLI** — hooks exist, but no token counts on disk by default. Quota needs `AfterModel`
  hook accumulation or opt-in OTEL file telemetry.
- **Cursor** — hooks exist, but no on-disk session log and no local token counter at all. State only,
  no quota, ever.

## Decision

**v1 ships Codex and only Codex.** Gemini and Cursor are deferred until the agent seam is proven.

## Consequences

- Two agents is enough to force a real abstraction into existence (one agent lets you fake it; two
  don't). But we don't pay for three integrations before the shape is proven.
- The awkward cases — an agent with no on-disk quota (Gemini), an agent with no quota at all
  (Cursor) — land against a working seam instead of being designed speculatively into v1.
- No Gemini/Cursor tickets are written yet. Writing them now would be designing against an
  abstraction that doesn't exist.
- Risk accepted: the star-count value the positioning is chasing arrives incrementally, not all at
  once.
