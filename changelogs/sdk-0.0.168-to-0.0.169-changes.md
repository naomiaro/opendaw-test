# OpenDAW SDK Changelog: 0.0.168 → 0.0.169

One small release (8 commits). The headline is **#360: tolerate and repair pointers whose
target is gone** — a generic, box-type-agnostic repair for documents where a pointer names
a box the graph no longer holds (a Yjs merge, or a host app replaying its own undo into
the document, can produce this; nothing rejected it because the graph validates that a
pointer HAS an address, not that it resolves). Previously it committed silently and
surfaced much later as a panic in `dependenciesOf` ("Could not find target of …") that
also wedged the cleanup code, since every cleanup path routes through `Box.delete`. The
rest of the release is studio-app-only polish (iPad layout, touch context menus,
double-click text input, error triage for Firefox-internal errors) and Rust test-warning
cleanup.

Sub-package versions (installed): `studio-adapters` 0.3.1 (was 0.3.0), `studio-core`
0.2.3 (was 0.2.2), `studio-core-wasm` 0.0.14 (was 0.0.13), `studio-boxes` 0.0.107 (was
0.0.106 — version bump only, **no schema changes**: upstream `forge-boxes` diff touches
only package metadata), `studio-enums` 0.1.0 (unchanged), `lib-box` 0.0.92 (was 0.0.91 —
carries the new graph APIs). `engine.wasm` SHA-256 changed (`50d534ed…` → `495f7d89…`)
and `device_neon.wasm` changed (`dd2d0c34…` after) — both rebuilds from warning/dead-code
cleanup, no behavioral diff (see Misc); the other 27 device plugins and
`stretch_wasm.wasm` are byte-identical.

## #360: Dangling-pointer tolerance + generic repair

Two new rules that name no box type, applied on load, in collab reconcile, and in live
collab batches:

### lib-box: `BoxGraph` gains unresolvable-pointer surface

- **`boxGraph.unresolvablePointers(): ReadonlyArray<PointerField>`** — edges naming a box
  the graph does not hold. Only deserialization or a merged document can produce them
  (`refer()` demands a live vertex).
- **`boxGraph.clearUnresolvablePointers(): int`** — makes a pointer whose target is gone
  indistinguishable from one that was never set, so every consumer's existing "not set"
  handling applies unchanged. Never deletes. Deliberately NOT part of deserialization
  (a clipboard subset points outside itself on purpose — only a caller that claims its
  graph should be whole may ask for this). Clearing a mandatory pointer leaves the graph
  momentarily invalid by design, so when it opens its own transaction it closes WITHOUT
  validation (`#finalizeWithoutValidation`, also factored out of the two existing
  no-validate paths); called inside an open transaction it just clears, and the caller's
  `endTransaction` validates as usual. Logs `[BoxGraph] cleared N pointer(s)…`.
- **`boxGraph.edges().unsatisfiedMandatoryPointers(): ReadonlyArray<PointerField>`**
  (GraphEdges) — every mandatory pointer is registered there, so this is the
  authoritative "who is missing a required target" without walking fields box by box.
- **`dependenciesOf` no longer panics on a dangling edge** — it warns
  (`[BoxGraph] skipping dangling …`) and skips the walk, but still records the pointer so
  `Box.delete` defers it (unstage rejects a box with live edges). This unwedges the
  repair code itself.

### studio-core: `migrateUnsatisfiedMandatory` (new), `migrateSelectionBox` + `migrateDanglingPointers` (gone)

`ProjectMigration.migrate` now:

1. Runs **`boxGraph.clearUnresolvablePointers()` first**, so every existing "not set"
   migration branch repairs targets it knows how to rebuild (e.g. `rootBox.groove`
   recreates its GrooveShuffleBox through the branch that was already there) without
   knowing anything about dangling.
2. Wraps each 2nd-pass box visitor in a **per-box tryCatch**: a box that is already
   doomed (holds an unsatisfied mandatory pointer) cannot abort the whole migration; its
   open transaction is rolled back and the box is skipped with a warning. Anything else
   still rethrows — a genuine bug in a pass fails loudly instead of loading a
   half-migrated project.
3. Runs **`migrateUnsatisfiedMandatory(boxGraph)` LAST**: whoever is still left holding a
   required pointer with nothing on the other end is deleted (`box.delete()`, cascading),
   looping to a fixpoint since deleting an owner can leave the next box unsatisfied.
   Ordering matters — every pass that knows how to rebuild a target gets its chance
   first. Counts one deletion per box; if it deleted anything it notifies via
   `RuntimeNotifier.info` ("Some data is corrupt…"). Exported from
   `studio-core` `project/migration` index.

`migrateSelectionBox` and `migrateDanglingPointers` are deleted — both were the generic
rule hand-coded for one box type. (A stale `MigrateSelectionBox.js` still sits in the
published dist but is no longer referenced from the migration index.)

### ysync: live batches assert resolvability; reconcile gains the same two rules

- `YSync.#applyEvents` now returns the touched boxes, and a new **`#assertResolvable`**
  pass checks every touched box's outgoing edges after the whole batch (a box created
  early may legitimately point at one created later in the batch). An unresolvable edge
  throws into the existing reconcile path instead of committing silently —
  `endTransaction` validates address presence, not resolvability, so this was the hole.
- `deterministicReconcile` scope grew from exclusive-target overflow (+ duplicate value
  events) to also cover **unresolvable pointers** (clear all at once — order-independent)
  and **unsatisfied mandatory pointers** (drop the lowest-addressed owner per round; the
  fixpoint loop picks up what that exposes). The exclusive-overflow rule simplified: it
  now just `defer()`s the losing edges — a mandatory pointer left unsatisfied is deleted
  by the new rule on the next round instead of inline.
- Extensive new upstream tests: `unresolvable-pointers.test.ts` (lib-box, 327 lines),
  `ProjectMigrationDangling.test.ts`, `MigrateUnsatisfiedMandatory.test.ts`,
  expanded `Reconcile.test.ts` / `YSyncCollab.test.ts`.

**This repo:** no code changes needed. We never deserialize corrupt/merged documents
(projects are built fresh in `projectSetup.ts`), don't use ysync, and don't call the
migration passes directly. The two behavioral touchpoints are benign: project load now
runs `clearUnresolvablePointers()` (no-op on healthy graphs), and `dependenciesOf`
warns-and-skips instead of panicking on a dangling edge — strictly more forgiving for
any future demo that hand-builds boxes. The new `unresolvablePointers()` /
`unsatisfiedMandatoryPointers()` reads are handy graph-integrity asserts for tests.

## DeviceManualUrls corrections (studio-adapters)

Three URL constants fixed to match the actual manual site paths:
`StereoTool` `audio/stereo-tool` → `audio/stereotool`, `Reverb` `audio/cheap-reverb` →
`audio/reverb`, `MIDIOutput` `instruments/midi-output` → `instruments/midioutput`.
**This repo:** `DeviceManualUrls` is unused — no impact.

## Misc

- **Rust/WASM rebuilds without behavior change:** "fixes test warnings" cleaned
  test-only code — `cfg(test)`-gated `PanicWriter`/`UnsafeCell` import in the engine,
  removed a test-only `pooled_sequencers` helper and unused `mut`s/imports in
  device tests, removed Neon's unused `MOD_NONE` const. Neon's `pd.rs` added an explicit
  `WAVE_RES_TRAPEZOID` match arm that is identical to the existing `_` fallback —
  cosmetic. Net: `engine.wasm` and `device_neon.wasm` hashes changed, audio output
  does not.
- Studio-app-only: iPad layout fix, better touch context-menu handling (long-press),
  double-click text input fixes, `FloatingTextInput` cancel now rejects with the shared
  `Errors.AbortError` instead of the raw string `"cancel"` (a cancelled edit no longer
  uploads as a crash, live error 1098), Firefox cross-compartment
  "Permission denied to access property" errors classified as browser-internal and
  non-fatal (1105/1106), diagnostic probe ahead of the audio-clip-painter unwrap (1097).
- `lib-fusion` 0.0.101 / `lib-inference`: version bumps only.

## opendaw-headless follow-ups shipped with this upgrade

- No code changes required: `tsc --noEmit` (TS 5.9) error set is byte-identical to the
  pre-upgrade baseline (70 pre-existing `^src/` errors, 0 new / 0 resolved), `npm run
  build` passes, all 63 vitest tests pass, `npm ci` verifies the regenerated lockfile.
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`):
  `clearUnresolvablePointers` + `unresolvablePointers` (lib-box `graph.d.ts`),
  `unsatisfiedMandatoryPointers` (`graph-edges.d.ts`), the dangling-skip warn in
  `graph.js`, `migrateUnsatisfiedMandatory` wired into `ProjectMigration.js` (and
  `migrateSelectionBox` gone from the migration index), `#assertResolvable` in
  `YSync.js`, and the corrected `DeviceManualUrls` strings.
- WASM audit: 2 of 30 binaries changed (`engine.wasm`, `device_neon.wasm`), both traced
  to test/dead-code cleanup with no behavioral diff in the Rust source.
