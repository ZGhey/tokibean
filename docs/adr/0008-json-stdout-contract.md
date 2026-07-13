# ADR-0008: Agent identity is in the URL path; hooks emit JSON on stdout

**Status:** Accepted — 2026-07-13

## Context

Two mechanical facts about hooks, decided together because both live in the hook transport.

**1. Which agent sent this event?** Codex's payload is *nearly identical* to Claude's — same
`hook_event_name`, same `session_id`, same snake_case. There is essentially nothing to sniff, and it
gets worse as agents converge on Claude's schema.

**2. All three agents (and Copilot) require the hook process to emit valid JSON on stdout.** Empty or
invalid stdout is logged as an error; in Copilot's case it can deadlock the UI. Tokibean's hooks are
fire-and-forget `curl` commands, which looks incompatible — but isn't: curl already prints the
response body to stdout. Today the server replies with the plain string `"ok"`.

## Decision

**Agent identity is decided at install time and carried in the URL path:** `POST /event/codex`,
`/event/gemini`, `/event/cursor`. The installer bakes the agent slug into the URL it writes into that
agent's config. It is never inferred from the payload.

**Bare `/event` keeps working and means `claude`** — every already-installed user's hooks survive
untouched, with no reinstall prompt.

**The hook transport becomes JSON-clean:** the server replies `{}` with
`Content-Type: application/json`; hook commands append `|| echo '{}'` so an offline pet still emits
valid JSON; and `curl --max-time` is bounded under each agent's hook timeout (Codex: seconds,
default 600; Gemini: milliseconds).

## Consequences

- The session key becomes `(agent, session_id)`, so id collisions across agents are impossible by
  construction rather than by luck.
- The curl-based install model — chosen originally for Claude Code version compatibility — survives
  intact for every agent. No move to http-type hooks.
- Changing the port still invalidates every marker in every agent's config (unchanged from today).
