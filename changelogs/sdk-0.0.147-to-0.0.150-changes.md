# OpenDAW SDK Changelog: 0.0.147 → 0.0.150

Three point releases (0.0.148, 0.0.149, 0.0.150). **No breaking changes.** Most of the diff is internal performance work (`VaryingTempoMap` memoisation, `AudioRegionBoxAdapter` getter caching), one recording-preferences bug fix, one new enum value, and a new public export.

## Out-of-cycle release note

> These three versions were published from the upstream **`dev`** branch and have **not yet merged back to `main`**. The opendaw-test baseline (0.0.147) tracked `main`; this upgrade brings in changes that don't appear in the upstream `main` branch's `CHANGELOG.md` files yet. The publish is real — the tags exist on `dev`, the npm registry has them as `latest` — but the usual "merge to main, then publish" sequence has been skipped this cycle.
>
> All the changes are stabilised on `dev` and treated as production by the upstream maintainers. The integration risk is the same as a normal release; the cosmetic difference is just where the audit trail lives.

## Breaking Changes

**None.** No public API has been renamed, removed, or had its signature changed. opendaw-test's source under `src/` requires no edits for this upgrade.

## Additive APIs

### `TempoGridCursor` (new public export)

Exported from `@opendaw/studio-adapters` alongside `VaryingTempoMap`. The class is the internal stateful cursor that drives the new tempo-map memoisation (see [Bug Fixes / Internal Optimisations](#bug-fixes--internal-optimisations) below), exposed for callers that want to build their own incremental tempo analysis on top.

```typescript
export class TempoGridCursor {
    integrate(events: ReadonlyArray<ValueEvent>, fromPPQN: ppqn, toPPQN: ppqn, storageBpm: bpm): seconds
    advance(events: ReadonlyArray<ValueEvent>, fromPPQN: ppqn, fromSeconds: seconds,
            targetSeconds: seconds, storageBpm: bpm): ppqn
}
```

If you weren't reaching into the tempo internals before, you can ignore this. opendaw-test doesn't currently use it.

### `EnginePreferencesSchema.recording.olderTakeScope` accepts `"none"`

The recording-preferences enum gains a third value:

```typescript
// before (0.0.147)
_OlderTakeScopeOptions = ["all", "previous-only"] as const

// after (0.0.150)
_OlderTakeScopeOptions = ["none", "all", "previous-only"] as const
```

Setting `olderTakeScope = "none"` makes `RecordAudio.start()` and `RecordMidi.start()` short-circuit older-take management entirely. The existing values (`"all"`, `"previous-only"`) keep their original behaviour.

**opendaw-test impact:** none required. `src/demos/recording/loop-recording-demo.tsx` types its local state as a literal union `"all" | "previous-only"` (not pulled from the SDK) and exposes only those two options in the UI; adding `"none"` is optional. If you want users to be able to opt out of take management on loop recording, broaden the union and add the option to the select.

## Bug Fixes / Internal Optimisations

### Recording — `olderTakeScope === "none"` was previously ignored (upstream #254)

`RecordAudio.start()` and `RecordMidi.start()` didn't guard for the case where `olderTakeScope` is `"none"` (a value that didn't exist in the schema before this release, but could be reached via custom preference sources). The fix adds an early return:

```typescript
// In RecordAudio.start() and RecordMidi.start()
const {olderTakeAction, olderTakeScope} = recording
if (olderTakeScope === "none") {return}   // NEW
if (olderTakeScope === "all") { … }
```

This pairs with the new enum value — there's now a coherent "skip older-take management" pathway end-to-end.

### `VaryingTempoMap.intervalToSeconds()` is now incremental

Two commits (`0f3d0f93`, `a2589011`) introduce memoisation in `VaryingTempoMap`:

- A private `#cursor: TempoGridCursor` field caches the last (`fromPPQN`, `toPPQN`, `seconds`) result.
- When the next call has the same `fromPPQN` and a `toPPQN ≥ cachedTo`, the previously-integrated `[fromPPQN, cachedTo]` segment is reused and only the new tail is computed.
- The cache invalidates on any tempo-event change (same hook as the old invalidation path).

The signature and observable behaviour of `intervalToSeconds(a, b)` are unchanged. The relevant call sites in opendaw-test are:

```typescript
// src/lib/rangeExport.ts (3 sites)
const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);

// src/demos/export/export-demo.tsx
? project.tempoMap.intervalToSeconds(startPpqn, endPpqn)
```

These callers benefit transparently — long renders or scroll-driven previews that repeatedly compute overlapping intervals will be faster. No code changes required.

### `AudioRegionBoxAdapter` caches `duration()` / `loopDuration()`

`AudioRegionBoxAdapter` now memoises the derived `duration()` and `loopDuration()` values (which go through `DurationConverter.toPPQN()` and depend on the tempo map). The cache invalidates when any region property changes.

Internal-only; consumers (including opendaw-test) see no API change.

### Smaller fixes

- **`forge-boxes/src/schema/std/AudioFileBox.ts`** picked up a small `recording.olderTakeAction` path fix; doesn't affect the box catalog itself.
- **Error handler** in the app layer was tightened (upstream commit `7c035ab3`, `fix 970`). Internal-only.

## Library Bumps

The SDK aggregates these `@opendaw/*` package updates (mostly carrying through the changes above):

| Package | 0.0.147 baseline | 0.0.150 baseline |
|---|---|---|
| `@opendaw/lib-std` | `^0.0.77` | `^0.0.78` |
| `@opendaw/lib-runtime` | `^0.0.78` | `^0.0.79` |
| `@opendaw/lib-dom` | `^0.0.82` | `^0.0.83` |
| `@opendaw/lib-jsx` | `^0.0.82` | `^0.0.83` |
| `@opendaw/lib-dsp` | `^0.0.83` | `^0.0.84` |
| `@opendaw/lib-box` | `^0.0.85` | `^0.0.86` |
| `@opendaw/lib-xml` | `^0.0.63` | `^0.0.64` |
| `@opendaw/lib-midi` | `^0.0.65` | `^0.0.66` |
| `@opendaw/lib-fusion` | `^0.0.93` | `^0.0.94` |
| `@opendaw/lib-dawproject` | `^0.0.69` | `^0.0.70` |
| `@opendaw/studio-enums` | `^0.0.74` | `^0.0.75` |
| `@opendaw/studio-boxes` | `^0.0.90` | `^0.0.91` |
| `@opendaw/studio-adapters` | `^0.0.109` | `^0.0.112` |
| `@opendaw/studio-core` | `^0.0.145` | `^0.0.148` |

The biggest jump is `studio-adapters` (three patches), driven by the `VaryingTempoMap` and recording-preference work.

## New upstream feature: Tap-Tempo (app-only)

Several commits add a "tap tempo" gesture to the upstream Studio UI (`9809e165 adds tab tempo`, plus layout/header polish commits). This is entirely in the app layer (`@opendaw/app-studio`) — not in any SDK package — so the SDK consumed by opendaw-test is unaffected. If you want to surface tap-tempo in your own UI, you'd implement it on top of the existing `project.engine.bpm` Observable; no new SDK helper exists.

## Other touches in the diff

- **`plans/match-tempo.md`** — a new contributor design doc for a "match tempo" feature. Not implemented yet; mentioned here so you don't think it's a feature you missed.
- **One additional manual-page reference** (`adds manual`) — doc-only.

## Upgrade test plan

- [x] `npm install` regenerates the lockfile cleanly.
- [x] `npm ci` passes from the regenerated lockfile.
- [x] `npm run build` (Vite + VitePress) succeeds with no type errors.
- [ ] Smoke-test the export demo — long renders should be no slower (and probably faster).
- [ ] Smoke-test the loop-recording demo — recording behaviour at `olderTakeScope = "all"` and `"previous-only"` unchanged from before.
- [ ] Optionally surface the new `"none"` option in the loop-recording-demo UI if you want to demonstrate it.
