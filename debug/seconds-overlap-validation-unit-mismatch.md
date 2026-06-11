# Seconds-timeBase overlap detection fails due to unit mismatch in ProjectValidation

**Verified against:** studio-core 0.0.152 (`ProjectValidation.ts`, `Project.ts:487-489`, `RegionClipResolver.ts:36,82`), studio-adapters 0.0.116.

**Status:** Open. Not a new regression — the mismatch is structural and present since Seconds timeBase was introduced. No repro page (the symptom is silent: overlaps survive `project.copy()` and offline render undetected).

## Symptom

`ProjectValidation.validate()` (run on load and inside `project.copy()`) detects region overlap via:

```ts
right.position < left.position + left.duration
```

on raw box field values. In `Musical` timeBase, both `position` (Int32, PPQN) and `duration` (Float32, PPQN) share the same unit, so the comparison fires correctly. In `Seconds` timeBase, `position` is still stored in **PPQN** while `duration` is stored in **seconds** — the comparison mixes units.

At typical values (positions in the thousands of PPQN, durations in the range 0–300 seconds), the comparison `right.position < left.position + left.duration` effectively fires only when the two regions have nearly identical positions. A realistic Seconds overlap (e.g. region A at PPQN 0, duration 30 s; region B at PPQN 57600, duration 30 s, extending 5 s past A's end in file time) produces `57600 < 0 + 30` → **false** — the overlap is not detected and both regions survive `project.copy()` intact.

Both live probe points skip Seconds tracks entirely:

- `Project.invalid()` (`Project.ts:487-489`): iterates tracks but returns early for Seconds regions — no overlap check.
- `RegionClipResolver.validateTrack` (`RegionClipResolver.ts:36,82`): the resolver skips Seconds regions by design.

Net: Musical overlaps are detected and deleted (by-design enforcement); Seconds overlaps are not detected (unit-broken enforcement) and silently survive into the offline render.

## Impact

Overlapping regions are invalid by design in both timeBase modes (maintainer ruling, confirmed in [`project-copy-deletes-overlapping-regions.md`](./project-copy-deletes-overlapping-regions.md#status)). In Musical timeBase the engine enforces this at `project.copy()` time. In Seconds timeBase the enforcement is unit-broken, so:

1. A Seconds-timeBase project with a genuine overlap will render the overlap live (the live engine tolerates it) and also render it offline through `project.copy()` (the validator misses it) — producing output that differs from a well-formed project in a hard-to-predict way.
2. A consumer who authored the overlap accidentally (e.g. via the sub-PPQN truncation footgun described in the sibling note) receives no console warning and no deletion — the silent-failure mode is worse than the Musical case, where at least the console warns.

**Prevention is the only protection at present**: author Seconds regions with non-overlapping timeline ranges. The validator fix requires converting duration to PPQN (or position to seconds) before the comparison, or skipping Seconds tracks the same way `RegionClipResolver` does and treating Seconds tracks as always-valid.

## Suggested SDK fix

Either:

- Normalise both operands to the same unit before the `right.position < left.position + left.duration` comparison in `ProjectValidation.validate()` (e.g. convert `duration` from seconds to PPQN via `tempoMap.secondsToPPQN` for Seconds tracks), or
- Mirror `RegionClipResolver`'s approach and skip Seconds tracks in `ProjectValidation` as well (consistent with the current live-engine tolerance), documenting that Seconds-timeBase overlaps are the consumer's responsibility.
