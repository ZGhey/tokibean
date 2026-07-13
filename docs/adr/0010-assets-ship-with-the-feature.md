# ADR-0010: Outward-facing assets change in the release that ships the feature

**Status:** Accepted — 2026-07-13

## Context

A promotion pass already shipped: MIT `LICENSE`, a search-tuned repo description and 20 topics, a
GitHub Pages landing page (`docs/index.html` + a real 1200×630 OG card), and an
[awesome-tauri PR](https://github.com/tauri-apps/awesome-tauri/pull/796). All of it is written
Claude-first. [ADR-0001](0001-multi-agent-positioning.md) invalidates that copy.

Google takes weeks to re-crawl, which is an argument for rewriting the copy *now*, ahead of the code.

## Decision

**The assets change in the same release that ships Codex support** — repo description, topics,
`docs/index.html`, the OG card, `README.md`, and `README.zh-CN.md`, in one commit, as the last ticket
in the chain, blocked by the Codex work.

## Consequences

- We give up a few weeks of crawl head start.
- We don't advertise a feature that isn't there. A visitor who arrives from a Codex search, finds no
  Codex support, and leaves is precisely the traffic this whole effort exists to capture — burning it
  early to rank earlier is self-defeating.
- Both READMEs must stay in sync (project rule); the OG card is regenerated from `docs/_og-src.html`
  via headless Chrome.
- Also gated on this release: the demo video and the launch posts in `.scratch/launch/posts.md`
  (uncommitted by design — `.scratch/` is gitignored).
