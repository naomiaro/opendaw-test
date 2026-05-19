# OpenDAW SDK Changelog: 0.0.140 → 0.0.147

Seven point releases bundled together (0.0.141, 0.0.142, 0.0.143, 0.0.144,
0.0.145, 0.0.146, 0.0.147 — note 0.0.145 was a version-bump-only publish for
intermediate packages). One consumer-visible **type rename** is the only
required code change; the rest of the surface is bug fixes (mostly to the
audio-recording timing path), additive APIs, and a brand-new in-tree
`@opendaw/lib-inference` package that is not yet registry-published.

## Breaking Changes

### `ExportStemsConfiguration` Renamed to `ExportConfiguration`, New Shape

The flat record type `ExportStemsConfiguration = Record<string,
ExportStemConfiguration>` is gone. The replacement wraps it inside a
configuration object that also supports a render range:

```typescript
// before (0.0.140)
export type ExportStemsConfiguration = Record<string, ExportStemConfiguration>

// after (0.0.147)
export type ExportRange = "full" | { start: ppqn, end: ppqn }
export type ExportConfiguration = {
  stems?: Record<string, ExportStemConfiguration>
  range?: ExportRange
}
```

The namespace statics (`countStems`, `sanitizeFileName`, `sanitizeExportNamesInPlace`)
moved with it. `countStems(Option.Some(cfg))` now reads `cfg.stems` rather than
treating the whole config as the stem map.

All call sites that accept the export config have moved:

| Function | Old param type | New param type |
|----------|----------------|----------------|
| `AudioWorklets.createEngine({…, exportConfiguration})` | `ExportStemsConfiguration` | `ExportConfiguration` |
| `AudioOfflineRenderer.start(project, opt, …)` | `Option<ExportStemsConfiguration>` | `Option<ExportConfiguration>` |
| `OfflineEngineRenderer.create(source, opt, …)` | `Option<ExportStemsConfiguration>` | `Option<ExportConfiguration>` |
| `OfflineEngineRenderer.start(source, opt, …)` | `Option<ExportStemsConfiguration>` | `Option<ExportConfiguration>` |
| `OfflineEngineRenderer.render(config, end, …)` | — | `render(config, start, end, …)` (extra `startPosition` arg) |

The `OfflineEngineRenderer.render(config, start, end, progress, abort?)`
signature change is a hard break — there is a new required `startPosition`
argument before `endPosition`, and progress is now normalised against
`endPosition - startPosition`. `OfflineEngineRenderer.start` and
`AudioOfflineRenderer.start` callers are unaffected by the position-arg change
because those entry points haven't moved.

**Behaviour gain (additive):** the new `range` field on `ExportConfiguration`
makes section rendering a first-class option — the renderer seeks to `range.start`
and computes `maxDurationSeconds` from `tempoMap.intervalToSeconds(start, end)`
internally. Previously you had to clip output after rendering or run via
`AudioWorklets.createEngine` + `OfflineAudioContext` directly.

**This project's impact:** Two files imported the renamed type:

- `src/lib/audioExport.ts` — passes a `Record<uuid, StemExportConfig>` to
  `AudioOfflineRenderer.start`. Migration: import `ExportConfiguration`, wrap
  the flat map as `{ stems: stemsConfig }` before calling `Option.wrap()`.
- `src/lib/rangeExport.ts` — internal `renderRange()` helper accepts the flat
  stem map and forwards it to `AudioWorklets.createEngine`. Migration: import
  the inner item type `ExportStemConfiguration` instead, keep the function's
  public param as `Record<string, ExportStemConfiguration>`, and wrap the value
  inline (`{ stems: exportConfiguration }`) at the `createEngine` call site.

Doc files (`documentation/10-export.md`, `src/demos/export/CLAUDE.md`) still
reference the old name in prose and code blocks and have been updated.

## Recording Timing Fixes (0.0.144 + 0.0.146)

Three related fixes to `CaptureAudio` / `RecordAudio` that change the value the
SDK writes into `AudioRegionBox.waveformOffset` and the per-take `duration`.
Consumers that read these fields are transparently affected — peaks now align
more accurately and drift across multi-take loop recordings is eliminated.

### `waveformOffset` Formula Now Includes Worklet Head-Start (#252)

The first take's `waveformOffset` previously had a systematic ~30 ms bias
because the formula didn't account for the wall-clock gap between worklet
connect (in `prepareRecording`) and the engine actually firing count-in. The
new formula reads:

```typescript
const wallclockSinceWorklet = recordingWorklet.numberOfFrames / sampleRate
const headStartSeconds = countedIn
  ? Math.max(0, wallclockSinceWorklet - countInSeconds)
  : wallclockSinceWorklet
const waveformOffset = headStartSeconds + countInSeconds + outputLatency
```

Take position is no longer snapped via `quantizeFloor` — recording starts at
the live `currentPosition`.

### Loop-Take Duration Uses Tempo-Map Interval (#947)

Per-take `duration` used to be read from the live `regionBox.duration` at
loop-wrap time, which lagged by `outputLatency + dispatch jitter`. Across many
loops, peaks visibly drifted (one `outputLatency` per cycle was dropped). The
fix computes the take length from `tempoMap.intervalToSeconds(loopArea.from,
loopArea.to)` directly.

A follow-up (`fix #252` part 1) refines this further: when recording starts
mid-loop, the first take spans `[takePosition, loopTo]` not the full loop, so
the first take uses `intervalToSeconds(take.regionBox.position, loopTo)`
instead.

### File-Box Frame Count No Longer Overshoots

`RecordAudio.start()`'s final file-box recreation now writes
`startInSeconds = 0` and `endInSeconds = audioData.numberOfFrames / sampleRate`,
rather than copying `oldFileBox.endInSeconds`. The previous read could
overshoot by up to one quantum because the worklet ring buffer didn't truncate
until `#finalize`, producing a slowly-drifting visual waveform stretch (audio
playback was always correct).

### CaptureAudio Latency Debug Logging

`RecordAudio.start()` now emits a `[CaptureAudio] latency report` `console.debug`
line with `outputLatency`, `baseLatency`, `MediaTrackSettings.latency`,
`deviceId`, and `deviceLabel`. Diagnostic-only.

**This project's impact:** The recording demos read `regionAdapter.waveformOffset`
from the SDK (`recording-api-react-demo.tsx`, `loop-recording-demo.tsx`) and use
the live `duration` field for waveform `u1` — they don't re-derive these values,
so the fixes propagate transparently. Multi-take loop recordings should now
exhibit zero drift across cycles. The known per-take ~128-frame overshoot from
loop-wrap detection latency (documented in `src/demos/recording/CLAUDE.md`) is
unrelated to these fixes and remains.

## MIDI Capture Fixes (0.0.141 + 0.0.147)

### Timing Anchored to Engine PPQN (#?)

`CaptureMidi.commitCapturedNotes()` previously used `performance.now()` to
compute note origins. When the engine was already playing, this produced a
mismatch between the captured notes and the timeline — replays of recorded MIDI
would be subtly off-beat. The new code reads `project.engine.position` when
state is `"playing"` and falls back to wall-clock only when the engine is
stopped (`"performing"`).

### `commitCapturedNotes` Sorts by Position (#215)

The resolved-notes array returned by `commitCapturedNotes` is now
`sort((a, b) => a.position - b.position)` before being handed to
`Project.commitMidiCapture`. The latter anchors region position to
`notes[0].position`, so without sorting an early-released note-off could become
the array head and shift the rest of the chord to negative relative positions.

**This project's impact:** The MIDI demo uses live note-input via `CaptureMidi`
but currently doesn't surface recorded MIDI regions to the user — these fixes
improve correctness if/when we add MIDI region recording to the demo set.

## End-of-File Pop Fix (0.0.147)

`TapeDeviceProcessor` previously evicted mid-fade pitch voices to the
`fadingVoices` pool when a new playback cycle began. Eviction used unit gain,
dropping the region's remaining fade buffer (~20 ms) and producing an audible
pop at region end. The fix keeps the voice in place (updating its playback
rate) when `drift ≤ fadeLengthSamples`, falling back to the evict-and-replace
behaviour only when drift is too large to interpolate over.

**This project's impact:** Directly resolves the issue investigated in
`debug/fade-out-end-of-file-pop/` (PR #29). The debug demo previously
demonstrated an audible pop on region-end with non-zero fade-out — that should
no longer reproduce. Worth re-running `fade-out-eof-debug-demo.html` to
confirm.

## Project Migration: Duplicate Markers Tolerated (0.0.147)

Two new migrations cover historical project files with corrupted
`TransientMarkerBox` / `WarpMarkerBox` rows (same `position` key):

- `MigrateAudioFileBox.ts` — drops duplicate `TransientMarkerBox` rows from
  `AudioFileBox`.
- `MigrateWarpMarkers.ts` (new file) — drops duplicate `WarpMarkerBox` rows
  from `AudioPitchStretchBox` and `AudioTimeStretchBox`. Dispatched from
  `ProjectMigration` via two new visitor cases (`visitAudioPitchStretchBox`,
  `visitAudioTimeStretchBox`).

Projects that previously failed to `Project.load` (panicking on
`EventCollection.asArray()` when two events shared a position) now load with a
`console.debug` line emitted for each duplicate removed.

`TransientDetector.detect()` was also tightened to enforce strictly-increasing
positions in its output (`seconds.filter((v, i) => i === 0 || v > seconds[i-1])`),
preventing the corruption from being re-introduced when running transient
detection on freshly-loaded samples.

## Additive APIs (Not Required, but Available)

### `Project.loadScriptDevices()` and `Project.commitMidiCapture()`

`Project` gains two new public methods:

```typescript
project.loadScriptDevices(): void  // dedupes via internal UUID set
project.commitMidiCapture(): void  // packages CaptureMidi.ResolvedNote[] into a NoteRegionBox
project.subscribeMidiCaptureAvailable(observer: Observer<boolean>): Subscription
```

`loadScriptDevices()` is called internally by `startAudioWorklet()`; consumers
can also call it themselves after applying a preset to reload Apparat /
Werkstatt / Spielwerk scripts without re-creating the worklet.
`commitMidiCapture()` lets consumers finalise an in-flight MIDI capture into a
`NoteRegionBox` on the armed unit's focused track without going through the
full transport stop/finalize cycle.

### `ProjectApi.compactTracks(audioUnitBox)`

New method on `project.api`:

```typescript
project.api.compactTracks(audioUnitBox: AudioUnitBox): void
```

Packs an audio unit's same-typed tracks (Notes for MIDI units, Audio for audio
units) onto the fewest lanes possible by moving each region to the lowest
non-overlapping track above it. Empty tracks are deleted (at least one is kept).
Clip tracks and automation tracks are untouched. Could be useful for cleaning up
loop-recording results in our recording demos if we surface a UI affordance.

### Preset System (Opt-In)

New folder `src/presets/` in `@opendaw/studio-core` re-exported from the main
entry point:

- `OpenPresetAPI` (`@internal`) — fetches from `api.opendaw.studio/presets`.
- `PresetStorage` — OPFS-backed user preset store (`presets/user/*.odp` +
  `index.json` + `trash.json`). Public surface: `observable()`, `readIndex()`,
  `save()`, `update()`, `rebuildIndex()`, plus binary `.odp` parsing.
- `PresetMeta` — preset metadata type.
- `CloudBackupPresets` (in `cloud/`) — two-way sync between `PresetStorage`
  and a user's cloud bucket. Paired with `SampleStorage` and `CloudBackup`
  changes.

`PresetEncoder` / `PresetDecoder` / `PresetHeader` (in `@opendaw/studio-adapters`)
were reworked for the new binary layout. Anyone decoding `.odp` files directly
needs to migrate; the high-level `PresetStorage` API hides this.

### New Standard-Library Additions

Mostly small utilities, all additive:

- `Arrays.partition(array, ...predicates)` (`@opendaw/lib-std`) — returns one
  bucket per predicate; an item can be in multiple buckets if multiple
  predicates match.
- `IndexedBox.moveIndices(field, startIndices, dropIndex)` (`@opendaw/lib-box`)
  — multi-item reorder primitive.
- `WavFile.encodeInts16(audio, maxLength?)` (`@opendaw/lib-dsp`) — 16-bit PCM
  WAV encoder alongside the existing `encodeFloats`.
- `EventSpanRetainer.releaseAll()` (`@opendaw/lib-dsp`) — now yields events
  with `duration === Infinity` instead of skipping them. Behaviour change
  visible at transport stop / loop jump for permanent-event consumers.

### `@opendaw/lib-inference` (In-Tree, Not Yet Published)

A brand-new package implementing ONNX-runtime-web-backed audio inference:
stem separation, tempo detection, pitch estimation (basic-pitch).
Surface: `Inference.install({opfs})`, `Inference.run(taskName, input, options)`.

The package is marked `"private": true` in its own `package.json` and is not
pulled in transitively by `@opendaw/studio-sdk` — upgrading the SDK does not
add it to our `node_modules`. If we want to experiment with stem separation
or tempo detection in a future demo, we'd add it as a separate dependency
once published.

## Internal Fixes (No Consumer Impact)

- **YSync conflict handling** — `YSync` no longer publishes inverse ops when a
  remote/local transaction conflict is detected; it aborts the local txn and
  lets the next legitimate op converge. Only relevant for collaborative
  sessions (we don't use this).
- **OPFS availability** — `OpfsWorker` now wraps `navigator.storage.getDirectory()`
  in a `tryCatch` helper that throws `"Storage not available"` on rejection.
  Affects private-mode Safari/Firefox.
- **`AudioContentFactory` quantisation** — Very-short stretched clips
  (`pulses < PPQN.SemiQuaver`) no longer round up to a full semiquaver.
- **`TrackBoxAdapter.audioUnit`** — `unwrap()` now passes a diagnostic message.
- **`EngineWorklet.stop(reset)`** — no longer locally flips `#isPlaying`; only
  the engine state push does. Consumers using `catchupAndSubscribe(isPlaying)`
  unaffected. Synchronous-flip readers (we have none) would see a one-frame
  lag.

## Library Bumps

Transitive package versions resolved by `^0.0.147` of `@opendaw/studio-sdk`:

| Package | Range |
|---------|-------|
| `@opendaw/lib-box` | `^0.0.85` |
| `@opendaw/lib-dawproject` | `^0.0.69` |
| `@opendaw/lib-dom` | `^0.0.82` |
| `@opendaw/lib-dsp` | `^0.0.83` |
| `@opendaw/lib-fusion` | `^0.0.93` |
| `@opendaw/lib-jsx` | `^0.0.82` |
| `@opendaw/lib-midi` | `^0.0.65` |
| `@opendaw/lib-runtime` | `^0.0.78` |
| `@opendaw/lib-std` | `^0.0.77` |
| `@opendaw/lib-xml` | `^0.0.63` |
| `@opendaw/studio-adapters` | `^0.0.109` |
| `@opendaw/studio-boxes` | `^0.0.90` |
| `@opendaw/studio-core` | `^0.0.145` |
| `@opendaw/studio-enums` | `^0.0.74` |

## Files Changed (Consumer Side)

```
package.json                                    # SDK bump to ^0.0.147
package-lock.json                               # regenerated
src/lib/audioExport.ts                          # ExportStemsConfiguration → ExportConfiguration ({stems: …})
src/lib/rangeExport.ts                          # ExportStemsConfiguration → Record<string, ExportStemConfiguration>; wrap at call site
documentation/10-export.md                      # rename references in prose + code blocks
src/demos/export/CLAUDE.md                      # rename reference
```
