# ADR-0011: Codex must be installed before the first ticket ships

**Status:** Accepted, and **discharged the same day** — Codex was already installed
(`codex-cli 0.144.2`), and verification ran. It paid for itself immediately: the real bytes
contradicted the research handoff on three points and surfaced a live data-pollution bug the handoff
never mentioned. See [ADR-0013](0013-no-config-toml-write-installer-owns-hooks-json.md) and the
"Verified facts" section of `.scratch/multi-agent/spec.md`.

The one thing still **unverified**: the actual Codex hook *payload* shape. Codex's trust gate blocked
it (which is itself the empirical proof that the gate is real — a genuine turn with unapproved hooks
present fired **zero** events). The first implementation ticket must capture a real payload before
the adapter is written. Do not write the adapter against the handoff's description of it.

**Original status:** Accepted — 2026-07-13

## Context

Codex is not installed on the development machine. The plan's facts about it come from the research
handoff and from OpenAI's docs — good sources, but descriptions, not bytes.

The two things most likely to break are exactly the two things fixtures cannot prove:

1. **The trust gate.** Codex refuses to run a hook until the user approves it in `/hooks`, and any
   edit re-arms the review. A fixture-tested installer would report success into a void.
2. **The rollout schema.** The quota parser reads `payload.rate_limits.primary.used_percent` /
   `window_minutes` / `resets_at` and takes deltas against `payload.info.total_token_usage`. If the
   real file's shape differs, that is a rewrite, not a tweak — and a hand-written fixture would
   simply encode our misunderstanding and then pass.

Also unprovable by fixture: the Windows quirk that Codex runs command strings through PowerShell, so
a quoted exe path needs a leading `&`.

## Decision

**Install Codex and run one real turn before any implementation ticket ships.** Every downstream
ticket is then verifiable end-to-end, and the quota parser is written against real bytes from a real
`~/.codex/sessions/**/rollout-*.jsonl`.

This blocks the build. It is ~10 minutes.

## Consequences

- Tickets can carry real acceptance criteria ("drive a Codex turn, the pet goes Working") instead of
  fixture assertions that only prove we agree with ourselves.
- Captured real rollout lines become the test fixtures — earned, not invented.
- "Ship as beta, let users report" was rejected: the trust gate guarantees the first-run experience
  of a broken build is "I installed it and nothing happened", which is the brand damage this whole
  feature is meant to avoid.
