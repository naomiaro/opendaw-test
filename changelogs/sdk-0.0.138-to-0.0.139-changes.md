# OpenDAW SDK Changelog: 0.0.138 → 0.0.139

This release focuses on bug fixes and relaxing strict device-id matching in the
capture layer. There is one breaking signature change in `OfflineEngineRenderer.play()`,
otherwise the surface area is unchanged.

## Breaking Changes for SDK Consumers

### `OfflineEngineRenderer.play()` Is Now Async

`OfflineEngineRenderer.play()` changed signature from `void` to `Promise<void>`
and now awaits `queryLoadingComplete()` before returning. The internal
`renderToFile()` flow already `await`s `play()`, so this only matters if you
construct an `OfflineEngineRenderer` directly and call `play()` yourself.

| Function | Before | After |
|----------|--------|-------|
| `OfflineEngineRenderer.play()` | `void` | `Promise<void>` |

**Migration:** Add `await` (or `.then(...)`) at any direct call site.

**This project's impact:** None. We `OfflineEngineRenderer.install(...)` during
bootstrap (`projectSetup.ts`) but never instantiate one — our export demos use
the live `engineWorklet.play()` path. See `src/demos/export/CLAUDE.md` for why.

## Behaviour Changes

### Audio Device Selection Is Now Best-Effort

`CaptureAudio.#updateStream()` no longer rejects when the requested input
device isn't available. Two changes:

1. The constraint switched from `{exact: deviceId}` to `{ideal: deviceId}`, so
   the browser is allowed to substitute a fallback device.
2. The `Errors.warn(...)` (which throws) on mismatched `gotDeviceId` was
   replaced with `console.warn(...)` and the audio chain is rebuilt with
   whatever device the browser returned.

**Migration:** If your UI assumes "selected deviceId == active deviceId", read
the actual `MediaStreamTrack.getSettings().deviceId` after stream acquisition
instead of trusting the requested id.

**This project's impact:** Recording demos no longer surface a thrown error
when a previously-stored device disappears (e.g., USB unplug between sessions);
they silently fall back to the system default. The `useRecordingTapes` flow
doesn't require strict device-id matching, so no code change is needed.

### `CaptureMidi.prepareRecording()` Is Now a No-Op

Previously it warned when the requested MIDI device id wasn't found in
`MidiDevices.inputDevices()`. Now it returns immediately. The "device not
available" check moved into `#updateStream()`, which falls back to listening
on **all** inputs (with a `console.warn`) when the requested device id
doesn't match any present device.

**Migration:** None required. If you depended on `prepareRecording()`'s
warn-throw to short-circuit recording, gate on `MidiDevices.inputDevices()`
yourself before invoking the capture flow.

**This project's impact:** None. Our MIDI demo doesn't depend on
`prepareRecording()` rejecting.

## API Additions

### `AudioRegionBoxAdapter.optFile`

New getter returning the file adapter as an `Option`:

```typescript
get optFile(): Option<AudioFileBoxAdapter>
```

Use this when you need to handle audio regions whose file pointer is not yet
resolved without catching the unwrap exception. The existing `.file` getter
still throws `"Cannot access file."` for empty file pointers.

**This project's impact:** Optional adoption only. Our existing call sites
(`recording-api-react-demo.tsx`, `loop-recording-demo.tsx`, `comp-lanes-demo.tsx`)
all run in flows where the file pointer is guaranteed populated by the time
the adapter is read, so `.file` is fine. Adopt `.optFile` if a future demo
needs to render placeholder regions before audio data arrives.

## Bug Fixes

### Box Graph Rollback Fix (lib-box)

`BoxGraph.#rollback()` now drains the `#deferredPointerUpdates` queue into
`#transactionUpdates` before inverting, so a transaction that sets a pointer
**inside a box constructor** rolls back cleanly when aborted. Without this,
the deferred pointer update was discarded and the rollback left the graph in
an inconsistent state. New regression test in `editing.test.ts`.

**This project's impact:** None directly — we don't call `abortTransaction()`
explicitly, but anything that aborts via constraint failure now rolls back
correctly.

### `NoteBroadcaster.reset()` Now Clears State

`NoteBroadcaster.reset()` was a no-op despite the name; it now calls
`this.#bits.clear()` (matching `clear()`). This fixes a piano-roll bug where
notes lit up during recording stayed lit after stop/seek. Also touches
`PitchDeviceProcessor` and `NoteEventInstrument` for consistent reset
semantics.

**This project's impact:** Minor — our MIDI demo benefits from the cleaner
visual reset, but we don't render the piano roll directly.

### Engine Waits for SoundfontFileBox Loading

`EngineProcessor` now blocks `queryLoadingComplete()` on `SoundfontFileBox`
sample data, not just `AudioFileBox`. Previously, kicking off playback right
after loading a soundfont could read silence for the first few buffers.

**This project's impact:** None today — no demo uses soundfont instruments —
but the `SoundfontService` proxy guard in `projectSetup.ts` means we'd benefit
automatically if we ever add one.

### Sample Loader Pending Cleanup Refactor

`GlobalSampleLoaderManager.#load()` consolidated three `removeByKey(uuid)`
calls into a single `.finally(...)`. Pure refactor; behaviour identical.

## Library Bumps

Transitive package versions resolved by `^0.0.139` of `@opendaw/studio-sdk`:

| Package | Range |
|---------|-------|
| `@opendaw/lib-box` | `^0.0.83` |
| `@opendaw/lib-dawproject` | `^0.0.67` |
| `@opendaw/lib-dom` | `^0.0.80` |
| `@opendaw/lib-dsp` | `^0.0.81` |
| `@opendaw/lib-fusion` | `^0.0.90` |
| `@opendaw/lib-jsx` | `^0.0.80` |
| `@opendaw/lib-midi` | `^0.0.63` |
| `@opendaw/lib-runtime` | `^0.0.76` |
| `@opendaw/lib-std` | `^0.0.75` |
| `@opendaw/lib-xml` | `^0.0.61` |
| `@opendaw/studio-adapters` | `^0.0.106` |
| `@opendaw/studio-boxes` | `^0.0.88` |
| `@opendaw/studio-core` | `^0.0.137` |
| `@opendaw/studio-enums` | `^0.0.72` |

## Files Changed (SDK Source)

```
packages/studio/adapters/src/NoteBroadcaster.ts
packages/studio/adapters/src/timeline/region/AudioRegionBoxAdapter.ts
packages/studio/core/src/OfflineEngineRenderer.ts
packages/studio/core/src/capture/CaptureAudio.ts
packages/studio/core/src/capture/CaptureMidi.ts
packages/studio/core/src/samples/GlobalSampleLoaderManager.ts
packages/studio/core-processors/src/EngineProcessor.ts        # SoundfontFileBox await
packages/lib/box/src/graph.ts                                  # rollback fix
packages/studio/sdk/src/version.ts                             # 0.0.138 → 0.0.139
```
