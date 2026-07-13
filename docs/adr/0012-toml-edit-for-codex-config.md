# ADR-0012: Edit ~/.codex/config.toml with toml_edit

**Status:** SUPERSEDED by [ADR-0013](0013-no-config-toml-write-installer-owns-hooks-json.md) —
2026-07-13, same day, on verification against a real Codex install.

**Why it fell:** the premise was wrong. `hooks` is `stable` and **on by default** in `codex-cli
0.144.2`, so the `[features] hooks = true` write this ADR exists to perform is not needed at all.
Tokibean now writes no TOML and takes no `toml_edit` dependency.

**What survived:** the reasoning. The real `config.toml` on the verification machine already contains
a `[features]` table with an unrelated key — so the "append raw text" option rejected below would in
fact have written a duplicate table and stopped Codex from starting.

Kept for the record.

---

**Original status:** Accepted — 2026-07-13

## Context

Codex won't run hooks at all unless `~/.codex/config.toml` contains `[features] hooks = true`. That
file is hand-maintained: it holds the user's own settings, their comments, their ordering.

Three ways to get the key in there:

- Append a `[features]` block as raw text. No dependency — and it corrupts the file the moment a
  `[features]` table already exists (a duplicate table is a TOML parse error, and Codex then won't
  start at all).
- Don't write it; detect the missing key and tell the user to add it. Zero risk, zero dependency —
  but it stacks a copy-paste chore on top of the `/hooks` approval Codex already forces, turning a
  one-click install into a two-chore install.
- Parse and rewrite, preserving format.

## Decision

**Add the `toml_edit` crate** (the standard format-preserving TOML editor — it's what Cargo itself
uses). Parse `config.toml`, set `features.hooks = true`, write back: comments, key order, and spacing
survive.

**Back up to `config.toml.bak-tokibean` first**, matching what `hooks_install.rs` already does for
`settings.json`.

## Consequences

- One new Rust dependency, for the only approach that cannot silently mangle a user's config.
- If `config.toml` doesn't exist, create it with just the `[features]` table.
- If it exists but doesn't parse, **do not write** — surface the problem and fall back to instructing
  the user. Never overwrite a file we failed to understand.
