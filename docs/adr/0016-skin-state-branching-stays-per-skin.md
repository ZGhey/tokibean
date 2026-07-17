# ADR-0016: Each skin keeps its own idle/working/attention/done/limit branching

**Status:** Accepted — 2026-07-17.

## Context

An architecture review (`/improve-codebase-architecture`) flagged that every skin —
`pet.js` (the default) and `tabby.js` at the time, briefly joined by four more (`ghost.js`,
`hermes.js`, `robot.js`, `slime.js`) before those were judged not worth keeping and removed the same
day — independently re-implements the same five-way branch over `state`:
`idle → limit → working → attention → done`, same order, in every file. Even at five skins the raw
duplication was small: roughly 40–50 lines of near-identical `if`/`else if` scaffolding spread across
five files.

The proposed fix was to have the base (`pet.js`) own the branching and have each skin supply five
named per-state functions instead of one `draw()` — "deepen" the skin layer by moving the state
switch out of every skin and into one shared dispatcher.

Put through the codebase-design lens the fix does not hold up, on its own two tests:

- **The deletion test.** Delete the shared dispatcher and the complexity it captured does not
  reappear anywhere in force — it's the same ~40–50 lines, just moved back into the five files they
  came from. Compare to a real seam (e.g. the incremental JSONL scanner shared by `usage.rs`/
  `codex.rs`): deleting *that* regrows ~80 lines of byte-offset/truncation logic per file. The skin
  dispatcher clears no such bar — it's a hypothetical seam, not a real one.
- **Depth is a property of the interface.** Today's skin contract is already about as narrow as it
  gets: one function, `window.PetRenderer.draw(ctx, canvas, state, warn, bubble, t, extra)`. Forcing
  every skin to export five named per-state functions instead of that one `draw()` makes the
  **interface wider** (five required exports instead of one) to save a few dozen lines of branching
  that were never the expensive part — the hundreds of lines of skin-specific drawing *inside* each
  branch are exactly the content a skin exists to supply, not duplication to eliminate. Depth would
  go down, not up.

Separately, this path is also unverifiable in an agent session with no GUI: canvas/animation
correctness across five skins can only really be judged by watching the pet animate on a real
machine, and a change here touches every skin's render entrypoint at once.

## Decision

**Skins keep their own copy of the state branch.** `pet.js`'s `draw()` interface stays the single
entrypoint; `PetKit`'s shared primitives stay available for skins that want them, but the state
dispatch itself is not extracted into the base or into a shared contract.

Revisit only if a concrete, different problem shows up — e.g. the branch order or a state's meaning
actually drifts between skins (a correctness bug, not a line-count one), or a skin author asks for
help implementing a new state. Skin count alone (more skins landing) is not, by itself, a reason to
revisit this — the review that raised it initially deferred on "wait for more skins to land," and
this ADR is the record that when they did, the conclusion didn't flip.

## Consequences

- No code changes. `src/pet.js` and `src/skins/*.js` are unaffected by this ADR.
- A future architecture review re-reading the skin layer should not re-propose "unify the state
  switch across skins" without a new, different justification than "it's duplicated" — that
  duplication was examined here and found to be content, not structure.
