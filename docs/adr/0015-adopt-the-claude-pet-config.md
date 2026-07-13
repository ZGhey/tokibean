# ADR-0015: The config directory becomes `tokibean`, and the old one is adopted

**Status:** Accepted — 2026-07-14. **Reverses constraint #5 in [CONTEXT.md](../../CONTEXT.md)**, which
read: *"The config directory is `claude-pet`, forever."*

## Context

The app is called Tokibean. It watches two agents. Its internal name was still `claude-pet` — the
Cargo package, the npm package, the `[claude-pet]` log prefix, the CI artifact, the hook backup file
`settings.json.bak-claude-pet`, and the config directory.

All of those are cosmetic except the last one. Constraint #5 existed for a real reason:

> Renaming it silently orphans every existing user's config, credentials included.

`config.json` holds `oauth_access` / `oauth_refresh` for the account the user connected through a
browser OAuth flow. Anthropic's refresh token **rotates on every use and invalidates its predecessor**
— so an orphaned refresh token isn't merely inconvenient, it is *unrecoverable*. The only fix is for
the user to reconnect. The original constraint concluded: don't rename, the user never sees the path
anyway.

That conclusion was right about the risk and wrong about the remedy. The risk isn't the *rename*,
it's the *abandonment*. Nothing forced those to be the same thing.

## Decision

Rename the directory to `tokibean`, and **adopt** the old one on first launch instead of abandoning it.

`Config::load` reads both paths and hands them to a pure function, `choose(ours, legacy)`:

- **ours parses** → use it. Always. Even when a `claude-pet` file also exists.
- **ours missing or corrupt, legacy parses** → adopt it: return it *and write it to the new path*, so
  this happens exactly once.
- **neither** → a first run.

Two invariants, both of which exist to protect the refresh token:

1. **Ours always beats the legacy file.** Adoption is a *copy*, so the `claude-pet` file survives and
   immediately begins to go stale. If it could ever win again — say, on a launch where our own file
   failed to parse — it would restore a refresh token that has since been rotated and invalidated,
   and log the user out of the account they are currently connected to. Our file existing is proof
   that adoption already happened; the old one is then dead to us.
2. **The old file is never deleted.** A user who downgrades to a pre-rename build must still find
   their credentials where that build looks for them. A stale file costs a few hundred bytes; a
   deleted one costs a browser OAuth flow.

The pure `choose` is where the whole rename's risk lives, so it is where the tests are
(`config.rs`, six of them — adoption, ours-wins, adopt-once, first-run, corruption, path shape).

## Consequences

- Existing users upgrade and notice nothing: connected account, pet position, size, skin all carried
  over. That silence is the entire point.
- The `claude-pet` directory lingers on their disk, unread. Acceptable: deleting it is the one action
  with an unrecoverable failure mode, and it buys nothing.
- Corruption of our own config is now *safer* than before — where it used to mean a blank config, it
  now falls back to the pre-rename file if one is there.
- Config is still extended additively and never restructured (constraint #4 stands, untouched). This
  ADR moves the *file*; it does not touch a single field inside it.
