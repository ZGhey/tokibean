# ADR-0013: Don't write config.toml; the installer owns hooks.json

**Status:** Accepted — 2026-07-13. **Supersedes [ADR-0012](0012-toml-edit-for-codex-config.md).**

## Context

ADR-0012 was written from the research handoff, which said Codex needs `[features] hooks = true` in
`~/.codex/config.toml` before hooks run. Verification against a real install (`codex-cli 0.144.2`)
found otherwise, and found something the handoff missed entirely.

**The `[features] hooks = true` write is unnecessary.** `codex features list` reports `hooks` as
`stable` and **on by default**. And if a future version ever ships it off, Codex has an official
command for it — `codex features enable hooks` — which we can shell out to rather than parsing
someone's TOML.

(ADR-0012's *reasoning* was vindicated even as its conclusion was obsoleted: the real `config.toml`
already contains a `[features]` table with an unrelated key, so the "append raw text" approach it
rejected would indeed have written a duplicate table and stopped Codex from starting. The real
`notify` array is likewise already occupied — by Codex Computer Use — confirming it must never be
touched.)

**The thing the handoff missed:** Codex's onboarding offers to import a user's Claude Code setup, and
that import copies **Tokibean's own hooks** — curl commands pointing at `127.0.0.1:8737/event` —
verbatim into `~/.codex/hooks.json`. This is not a hypothetical: it is what the verification machine
was found in. Under [ADR-0008](0008-json-stdout-contract.md), bare `/event` means **claude**, so once
the user clears Codex's trust gate, **Codex events get counted as Claude sessions**. This is a live
data-pollution bug affecting any Tokibean user who installs Codex and accepts the import — with no
action from us and no signal to the user.

## Decision

**Tokibean never writes `~/.codex/config.toml`.** No `toml_edit` dependency. The installer writes
`hooks.json` and nothing else.

**The Codex installer owns `hooks.json`,** through a pure planner (`existing Value -> new Value`) that:

1. **Strips imported pollution** — any hook carrying the Tokibean marker but pointing at the **bare
   `/event`** path is an artifact of Codex's Claude-import, not something the user wrote. Remove it.
2. Installs the `/event/codex` hooks.
3. **Never touches a hook the user wrote.** Only Tokibean-marker hooks are in scope.
4. Is **idempotent** — Codex can re-import at any time, so re-running the install must re-clean.
5. Backs up `hooks.json` first, as the Claude installer already does for `settings.json`.

## Consequences

- One fewer dependency, and one fewer of someone else's config files that we can corrupt.
- The pollution cleanup ships as a **bug fix**, not merely a feature, and should be called out as
  such in the release notes.
- The cleanup only runs when the user installs Codex support. A user who accepted the import but
  never enables Codex in Tokibean stays polluted. Accepted for v1: cleaning another app's config file
  unprompted, for a feature the user hasn't asked for, is a bigger liberty than the bug warrants.
- If Codex ever changes its imported-hook shape, the marker-plus-bare-path signature is what
  identifies the pollution — it is a heuristic about *our own* hooks, not about Codex's format, which
  keeps it stable.
