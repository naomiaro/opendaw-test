# OpenDAW SDK Changelog: 0.0.135 → 0.0.138

## Breaking Changes for SDK Consumers

### MIDI Permission Auto-Request Removed (0.0.137)

`CaptureMidi.prepareRecording()`, `CaptureMidi.#updateStream()`, and `MIDILearning` no longer auto-request MIDI permission when `MidiDevices.get().isEmpty()`. Callers must explicitly call `MidiDevices.requestPermission()` before invoking capture/learning APIs.

**Why:** Auto-requesting permission inside `prepareRecording()` made the user-gesture timing implicit and unreliable across browsers. Putting the request at the explicit call site (e.g., a button click handler) keeps it inside the user-gesture window every time.

**Migration:** If you depended on the auto-request, ensure your UI flow calls `MidiDevices.requestPermission()` before recording. This project's `midi-recording-demo.tsx` already does this — no code change needed.

### `RegionEditing.cut()` and `clip()` Return Types Changed (0.0.138)

| Function | Before | After |
|----------|--------|-------|
| `RegionEditing.cut(region, cut, consolidate)` | `void` | `Option<REGION>` |
| `RegionEditing.clip(region, begin, end)` | `void` | `REGION` |

Both are now generic over the input region type (`<REGION extends AnyRegionBoxAdapter>`), so the returned region is the same concrete adapter type as the input.

**Source compatibility:** Existing call sites that ignore the return value continue to work unchanged. `track-editing-demo.tsx` calls `RegionEditing.cut(...)` without using the return value, so no migration needed.

**New capability:** You can now chain operations on the right-hand piece produced by `cut()`/`clip()` (e.g., apply a fade-in to the new region) without re-querying the box graph.

## Bug Fixes

### `addDefaultWarpMarkers` Validates Duration (0.0.138)

`AudioContentHelpers.addDefaultWarpMarkers()` now panics with a descriptive message if `durationInPPQN <= 0` or `durationInSeconds <= 0` instead of silently producing invalid warp markers. Affects callers that bootstrap pitch/time-stretch boxes for a sample — duration must be positive at the call site.

### MIDI `duration(0) must be positive` Fixed (0.0.136)

`RecordMidi` now deletes a take whose region has zero or negative duration during loop recording instead of finalizing it (which would crash). Also adds a terminator that cleans up an in-progress zero-duration region when MIDI recording stops.

### Safari MIDI Capture Fix (0.0.136)

`CaptureMidi.prepareRecording()` switched from `Errors.warn("MIDI not available")` (which throws) to `console.warn("MIDI not available")` (which just logs). Safari lacks Web MIDI API support, and the previous throw-on-missing-MIDI broke any recording flow in Safari that wasn't MIDI-specific.

## API Additions

### `quantiseNotes` `offset` Option (0.0.136)

`ProjectApi.quantiseNotes()` accepts a new `offset?: ppqn` field on `QuantiseNotesOptions`. The offset is added before quantization and subtracted after (`quantizeRound(position + offset, q) - offset`), enabling quantization grids that don't start at PPQN 0 — useful for quantizing relative to a region start, a marker, or a non-zero bar.

### Better Error Handling in `AudioContentHelpers` (0.0.138)

See *Bug Fixes* — the new validation surfaces invalid input at the boundary instead of producing garbage warp markers downstream.

## Dependency Updates

| Package | 0.0.135 | 0.0.138 |
|---------|---------|---------|
| `@opendaw/studio-sdk` | 0.0.135 | 0.0.138 |
| `@opendaw/studio-core` | 0.0.133 | 0.0.136 |
| `@opendaw/studio-adapters` | 0.0.104 | 0.0.105 |
| `@opendaw/studio-boxes` | 0.0.87 | 0.0.87 (unchanged) |
| `@opendaw/lib-box` | 0.0.82 | 0.0.82 (unchanged) |
| `@opendaw/lib-dsp` | 0.0.81 | 0.0.81 (unchanged) |
| `@opendaw/lib-std` | 0.0.75 | 0.0.75 (unchanged) |

The schema/box layer (`studio-boxes`, `lib-box`, `lib-dsp`) is unchanged — no project file format migration required.

## Files Changed in SDK Source

### 0.0.136
- `packages/studio/core/src/capture/RecordMidi.ts` — guard against zero-duration takes
- `packages/studio/core/src/capture/CaptureMidi.ts` — Safari `Errors.warn` → `console.warn`
- `packages/studio/core/src/project/ProjectApi.ts` — `quantiseNotes` `offset` option

### 0.0.137
- `packages/studio/core/src/capture/CaptureMidi.ts` — remove auto-request of MIDI permission
- `packages/studio/core/src/midi/MIDILearning.ts` — remove auto-request of MIDI permission

### 0.0.138
- `packages/studio/adapters/src/timeline/RegionEditing.ts` — generic return types for `cut`/`clip`
- `packages/studio/core/src/project/audio/AudioContentHelpers.ts` — duration validation in `addDefaultWarpMarkers`

## Impact on This Project

| Area | Change | Action |
|------|--------|--------|
| `track-editing-demo.tsx` calls `RegionEditing.cut()` | Return type now `Option<REGION>` instead of `void`. Return value is ignored. | None — source-compatible. |
| `midi-recording-demo.tsx` already calls `MidiDevices.requestPermission()` explicitly before capture. | Auto-request removed from SDK. | None — already explicit. |
| No usage of `addDefaultWarpMarkers` or `quantiseNotes`. | New validation / `offset` option. | None. |

Verified via `npm run build` — both the Vite production build and VitePress docs build pass with zero errors.
