# ADR-0014: Setup lives in Settings; the panel is for what you watch daily

**Status:** Accepted — 2026-07-13. **Amends [ADR-0007](0007-detect-agents-additive-config.md)** (see
"The invisibility rule was drawn in the wrong place" below).

## Context

Three bugs, one root cause, found by asking a simple question: *what should a first-time user see?*

**Only Codex was ever detected.** ADR-0007 said agents are detected by their config directory — and
we did that for Codex and never went back for Claude. `hooks_install::incomplete()` returns `true`
when it can't read `~/.claude/settings.json`, which the panel reads as "not installed, go install it".
So **a user who has never touched Claude Code sees an "Install Claude Code hooks" button**, and
clicking it makes Tokibean `mkdir ~/.claude` and write a settings file into it. We create a config
directory for an agent the user doesn't have.

**Detection only ran at startup.** `installed()` is called from `get_config`, which runs once on
launch. Install Codex while the pet is running and it won't notice until you restart it — and nothing
tells you to.

**Every path is hard-coded to `~`.** `usage.rs`, `codex.rs` and both installers assume `~/.claude` and
`~/.codex`. But Claude Code honours `CLAUDE_CONFIG_DIR` and Codex honours `CODEX_HOME` (its own error
message proves it: *"CODEX_HOME points to …"*). **A user who sets either one is blind to us today** —
no usage, no quota, no events. That bug predates multi-agent support entirely; nobody had reported it.

Underneath all three: the panel had become the setup screen. The account row, the connect button, the
hook row, the install button and now the Codex block all live in the panel — one-time things you never
look at again, permanently occupying the surface you open every day to check your quota. They are also
what overflowed it: a fresh install's panel measured 569px against a 430px cap, and the first thing to
scroll out of sight was the buttons a new user needs. Raising the cap (which we did) treats the
symptom. The next agent would overflow it again.

## Decision

**Setup moves to the Settings window. The panel keeps only what you watch.**

The Settings window gains three tabs: **General / Claude Code / Codex**. Each agent tab holds that
agent's detection status, its install button, its connect-account button (Claude), and — only when
detection fails — an **Add** button to point us at its config directory by hand. A new agent is a new
tab; the panel is untouched.

The panel keeps the quota cards, tokens, trend and session list. It gains a **gear** (Settings was
previously reachable ONLY from the tray menu — a hole, not just an inconvenience) and, when something
needs doing, **one actionable line** ("hooks aren't installed → Settings") that disappears once it's
done.

**Claude is detected the same way Codex is:** `~/.claude` exists. Symmetric, no guessing.

**Detection happens at three levels**, each covering a scenario the others can't:

1. **On demand** — opening the panel or the Settings window re-detects immediately. These are the
   moments you look at the answer, so the answer is never stale.
2. **In the background** — the existing 1-second heartbeat re-checks every 30s. This is the one that
   matters, and it exists for a user who **doesn't know he's supposed to do anything**: someone who
   has run Tokibean happily for months installs Codex, and the pet simply starts reacting. He never
   learns that a detection happened, which is the point. Two `stat()` calls per 30s is not a cost.
3. **By hand** — the **Add** button, shown only when detection failed, for a config directory that
   isn't where we looked.

There is deliberately **no manual "Detect" button**. With the three levels above it has no scenario
left to rescue, and putting one on screen tells the user our detection can't be trusted.

**Config directories are configurable, per agent.** The default comes from detection; if
`CLAUDE_CONFIG_DIR` / `CODEX_HOME` happen to be in our process environment we seed the default from
them. We do **not** rely on reading them, for the same reason we don't scan `PATH`: **a GUI app does
not inherit your shell's environment.** Launched from the Dock, Tokibean's process has never seen your
`.zshrc`. The env vars fail precisely in the case that needs them. Asking the user beats guessing.

**First run demonstrates rather than explains.** The panel opens itself once, and the pet blows a
bubble ("click me for usage"). No modal dialog: a desktop pet's entire proposition is that it doesn't
interrupt you — transparent, click-through, ignorable. A modal steals focus while you're typing, which
is the exact thing the click-through thread and the boss key exist to prevent. Breaking that promise
in the first five seconds is not worth the guaranteed impression. Existing users get the one-time
panel open too, on upgrade; the panel changed enough that they should see it.

### The invisibility rule was drawn in the wrong place

ADR-0007 said an agent that isn't installed "appears nowhere in the UI". Applied to the Settings
window that means **a Claude-only user — i.e. almost everyone — never learns that Tokibean watches
Codex at all**, unless they read the README. The entire point of this release is invisible to the
people using it.

So: the invisibility rule is **narrowed to the panel**. The panel is a glance, and a glance must not
carry noise. The Settings window is where you go *to find out what this thing can do*, and there a
greyed-out **Codex** tab reading *"Not detected (`~/.codex` doesn't exist). Install Codex and Tokibean
will start watching it."* is information, not clutter.

The principle is unchanged — never pretend, never mislead, never offer a button that can't work. What
was wrong was the boundary, and a boundary error gets fixed in the ADR, not worked around quietly in
the code.

## Consequences

- The Settings window is currently a fixed-size box with seven controls. Tabs plus per-agent status,
  buttons and a path field mean **redesigning and enlarging it** — this is a rebuild, not an addition.
- Connected users lose `acct-row` / `connect-claude` / `hook-row` from their panel. They won't miss
  them (they're finished with them), but it's a visible change and belongs in the release notes.
- Hard-coded `~` paths become a per-agent resolved path threaded through `usage.rs`, `codex.rs` and
  both installers. This fixes a pre-existing bug for `CLAUDE_CONFIG_DIR` users, unrelated to Codex.
- Agent state (detected / hooks written / event seen) stops being split between `get_config`
  (one-shot) and `PetUpdate` (live). Three facts about one thing belong in one payload.
- **Ships with the multi-agent release, not after it.** The headline is "it watches Codex now", and a
  Codex-only user's first sight would otherwise be a button telling him to install Claude Code. That
  doesn't read as a rough edge — it reads as the claim being false.
