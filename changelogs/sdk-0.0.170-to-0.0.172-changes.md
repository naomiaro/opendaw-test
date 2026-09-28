# OpenDAW SDK Changelog: 0.0.170 → 0.0.172

Two publishes (0.0.171 on 2026-09-14, 0.0.172 on 2026-09-18; 125 commits tag-to-tag). A
recording-focused release for this repo — five of the upstream items it tracked closed:

1. **Recording start alignment (upstream PR #376, merged)** — the engine now reports its own
   recording start on the engine→client channel and `RecordAudio` anchors every take on it,
   the `RecordingWorklet` keeps the buffer HEAD at finalize (it dropped it), the loop-wrap
   finalization hang is gone, a prepared worklet that never records is disposed, the latency
   is read at placement rather than at start, and the capture owns the recording's uuid so
   there is no `AudioFileBox` swap after save (closes #375, the simultaneous-take collision).
2. **Count-in boundary click fixed (#367)** — the metronome gets a click ceiling at the
   punch-in pulse during count-in, so the quantum-granular count-in→recording flip no longer
   leaks the downbeat click when the preference is off.
3. **Automation simplifier is Douglas-Peucker (#363)** — the finalize-time thinning recurses on
   the worst point and ε now bounds the error.
4. **MIDI take placement (#379)** — the `outputLatency` fallback was 10 *seconds*; it is 10 ms.
5. **Cross-project copy (#385)** — modulators travel with a copied audio unit / preset / device
   chain and keep their identity, so a paste into another project no longer throws.

Plus: **Nano is a real polyphonic sampler** (root key / octave / tune, start–end region,
crossfaded loop, attack — ten new box fields, Rust voice rewrite), a **voicing fade-reserve**
so polyphonic voice stealing no longer clicks (every `voicing`-based instrument), an
**engine-side non-finite-sample report** that surfaces as an engine error instead of silent
NaN output, `RegionClipResolver.fatal` **removed** (validation always panics again), the
`NoteRegionBox.eventOffset` field **deprecated**, a scripting storage layer (`ScriptStorage` +
cloud backup), and — **licence change**: every `@opendaw/*` package except `nam-wasm` (MIT)
switched its declared licence from `LGPL-3.0-or-later` to **`AGPL-3.0-or-later`**
(upstream `28e40ce99`, LICENSE file added at the monorepo root).

Sub-package versions (installed): `studio-adapters` 0.3.4 (was 0.3.2), `studio-core` 0.2.6
(was 0.2.4), `studio-core-wasm` 0.0.17 (was 0.0.15), `studio-boxes` 0.0.110 (was 0.0.108 —
NanoDeviceBox gained ten fields, NoteRegionBox field 14 deprecated), `studio-enums` 0.1.3
(was 0.1.1 — one icon), `lib-box` 0.0.94, `lib-std` 0.0.85, `lib-dom` 0.0.90, `lib-dsp`
0.0.93, `lib-fusion` 0.0.103, `lib-jsx` 0.0.92, `lib-midi` 0.0.74, `lib-runtime` 0.0.86,
`lib-xml` 0.0.71, `lib-dawproject` 0.0.78; `nam-wasm` 1.2.0 unchanged. WASM: **4 of 32
binaries changed** — `engine.wasm` (recording-start report, click ceiling, non-finite report,
device naming), `device_nano.wasm` (sampler rewrite), `device_neon.wasm` and
`device_vaporisateur.wasm` (both rebuilt for the `voicing` fade-reserve; Neon also for the
live-sustain envelope chase); the other 26 device plugins, `stretch_wasm.wasm` and `nam.wasm`
are byte-identical.

## Recording: start alignment, finalize head, uuid ownership (studio-core 0.2.5/0.2.6, core-wasm 0.0.16, adapters 0.3.3)

Upstream PR #376 (this repo's recording start-alignment campaign, register
`debug/recording-start-alignment-audit.md`) plus two follow-ups by the maintainer.

### Protocol and engine surface

- **`EngineToClient.recordingStarted(contextTime, position, generation)`** (adapters
  `protocols.ts`) — a one-shot report the WASM processor sends from `render()` the first
  quantum the engine-state `isRecording` flag is seen high (`RecordingStartEdge` in
  `core-wasm/src/recording-start-edge.ts`; the edge resets on `stopRecording` and on the
  processor's stop path, since a stop and restart between two renders would otherwise leave
  the flag at 1). `contextTime` is the quantum END (`currentTime + 128 / sampleRate` — the
  state position is post-render), `position` the engine-state position after that render.
- **`EngineCommands.prepareRecordingState(countIn, generation)`** — gained a generation
  counter. `EngineWorklet.prepareRecordingState()` increments it, clears the last report and
  passes it down; the processor stamps it on the report; the worklet drops a report whose
  generation is not the current one (a report for an earlier recording delivered after the
  next one was prepared). The processor's counter starts at −1 and the client's at 0→1, so a
  report before any prepare never matches. `OfflineEngineRenderer` and the offline worker
  carry the new argument as no-ops.
- **`Engine.recordingStart: ObservableOption<RecordingStart>`** with
  `RecordingStart = {contextTime, position}` — on the `Engine` interface, `EngineFacade`
  (mirrors the worklet's `MutableObservableOption`, `clear` on none) and `EngineWorklet`.
  `worklet.d.ts` declares `currentTime` for the worklet global scope.
- **`RecordingProcessorToClient.firstQuantum(contextTime)`** on channel
  `RecordingProcessorChannel = "recording-to-client"` (adapters `RecordingProcessorOptions.ts`):
  the recording processor reports the context time of its first captured quantum;
  `RecordingWorklet.firstQuantumTime: Option<number>` exposes it.

### RecordAudio placement

- New `RecordAudio.Latency = {outputLatency, inputLatency}` and the context takes
  **`readLatency: Provider<Latency>`** instead of two numbers — `CaptureAudio.startRecording`
  builds the provider (`InputLatency.resolve` over the box/preference values and
  `audioContext.outputLatency`), so the values are read at PLACEMENT time, when output has
  started, not at record start when Chrome still reports 0 (upstream `2069b419c`). The start
  values are kept as a fallback when the placement read is non-finite or 0.
- **Anchored placement**: on the first position tick with both `engine.recordingStart` and
  `recordingWorklet.firstQuantumTime` present, `startOffset = contextTime − firstQuantumTime +
  outputLatency + inputLatency`; `takePosition = floor(position)` (the region position is an
  Int32 field, the fraction moves into `waveformOffset` through
  `tempoMap.intervalToSeconds`); a negative offset (first captured frame postdates the start)
  advances the take to the first covered pulse instead. Debug line `[RecordAudio] anchored:`.
  If either report is still missing the tick RETURNS and waits (`ANCHOR_WAIT_SECONDS = 0.25`
  of context time) before falling back to the 0.0.170 count-in/head-start arithmetic
  (`[RecordAudio] anchor fallback:`), which is kept verbatim.
- **Take regions are created with `duration = loopDuration = minTakeSeconds`** (one render
  quantum, `RenderQuantum / sampleRate`) and the live duration write is
  `Math.max(minTakeSeconds, …)` — a take can never sit at duration 0 between ticks
  (upstream "fixes 1129": `validateTrack`'s "duration must be positive" fired on a fresh take).
- **Stop path** (`Terminable.create`): the current take's duration is set from the delivered
  frames (`totalSeconds − currentWaveformOffset`), a take that would be ≤ 0 is deleted; then
  **`recordingWorklet.limit(numberOfFrames)`** — every delivered frame is kept. 0.0.170 set
  the limit to `ceil((offset + duration) · sampleRate)`, a value ABOVE the delivered count
  whenever the region was written a tick short, so the limit was never reached and the
  recording never finalized (the loop-recording hang in the register). With no takes the
  file box is deleted and the worklet terminated. The loop-wrap deletion test likewise reads
  the worklet's frame count instead of the region duration.
- **`onSaved` is `Exec`** (no uuid argument). The 0.0.170 handler created a NEW
  `AudioFileBox` under the content-addressed uuid the import returned and re-pointed every
  region at it; now the capture GENERATES the uuid up front
  (`audioWorklets.createRecording(UUID.generate(), channels, chunks)`), the worklet carries it
  (`new RecordingWorklet(context, uuid, config)`), the file box is created under it, and
  **`SampleService.importRecording(uuid, audioData, bpm, name?)`** stores under that uuid.
  No box swap, and two simultaneous byte-identical takes no longer collide on one
  content-addressed uuid (#375).

### RecordingWorklet

- `#finalize` → **`recordedFrames(chunks, numFrames)`** (exported): keeps the first
  `ceil(numFrames / 128)` chunks and trims the TAIL to `numFrames`. 0.0.170 did
  `frame.slice(-totalSamples)` — the last N frames — which DROPPED the head of the buffer by
  the ring's overshoot (the register's "finalize head drop" defect).
- After the import the worklet **adopts the stored peaks and metadata**
  (`SampleStorage.loadPeaks(uuid, audioData)` — new — and the returned `Sample` as `meta`),
  empties its chunk list and only then flips to `loaded`. `get meta` therefore returns the
  imported sample's metadata once finalized (0.0.170: always `Option.None`; the doc note in
  `documentation/08-recording.md` is updated). `limit()` is ignored once no longer recording;
  finalize errors are no longer swallowed by a `.catch(console.warn)`.

### CaptureAudio

- Still open upstream: **PR #418** (2026-09-28) extracts the three lifecycle fixes from #380 —
  `terminate()` tears the audio chain down and releases the microphone, an unstamped capture
  reuses its stream across recordings, the keep-alive sink — plus a stream-lifetime rule and
  prepared-worklet discard on `terminate()`. Not in 0.0.172.
- `prepareRecording()` first **discards a previously prepared worklet** that `startRecording`
  never consumed (it stayed connected and buffering forever), then **resumes the
  AudioContext through `AudioContexts.resume`** and REJECTS with
  `Cannot record while the audio context is '<state>'` if it is still not running.
  `startRecording` on a missing chain/worklet also discards the prepared worklet.

### RecordMidi (fixes #379, "1129")

- `outputLatency ?? 0.01` — the fallback when the browser has no `outputLatency` (Safari/iOS
  < 18.4) was `10.0` SECONDS; it is 10 ms. The value is still read ONCE at record start (the
  first-of-session 0-until-output-starts read #379 also described is not changed; the audio
  path's placement-time provider was not extended to MIDI).
- Takes are created with a duration (`takeDuration(regionPosition, writePosition)`: at least
  one beat, capped at the loop end when takes are allowed) instead of 0, the duration grows
  through the same helper, and the zero-duration deletion paths (loop wrap and stop) were
  removed with the condition that produced them.

### RecordAutomation (fixes #363)

`simplifyRecordedEvents` is now recursive Ramer–Douglas–Peucker on `[first, last]`: the
point with the largest deviation from the chord splits the range, a range whose worst point is
within ε = 0.01 drops all its interior points. Points that are not linear, or share a position
with a neighbour, are anchored (infinite error) so they are never dropped. Measured on this
repo's repro page (`automation-simplifier-debug-demo.html`, same two-bar arc): **116 → 11
events, max deviation 0.0037 unitValue = 0.4× ε** (0.0.170: 116 → 4, 0.198 = 19.8× ε). The
latch-overdub front-trim the page measures alongside it is by-design and unchanged (verdict
"B"; end-to-end deviation 0.796 from the second pass's flat hold).

## Engine (WASM): count-in click ceiling, non-finite report, device naming

- **#367** — `Metronome::set_click_ceiling(pulse)` (exclusive; `INFINITY` = unbounded).
  `prepare_recording_state`'s count-in flip sets it to `recording_start` while counting in
  with the preference off, else `INFINITY`; `Metronome::process` clamps each region's end to
  the ceiling. Upstream regression tests: a block straddling pulse 0 no longer schedules the
  boundary downbeat, a count-in beat strictly before it still sounds. Measured here on
  `swipe-comping-demo.html?sampleRate=44100` (120 BPM, Click "Count-in only", output tapped
  through an `AnalyserNode` installed before page load, three recordings): **four clicks
  each time**, onsets on the 500 ms grid, no click at the punch-in (0.0.170: five).
- **Non-finite output report** (upstream "fixes 1116"): `PluginInstrument` and
  `PluginAudioEffect` scan their output once per block for the first non-finite sample and
  call `report_error("<BoxType> <uuid> wrote a non-finite sample (channel c, frame f)")` —
  once per node instance. The report lives in a 256-byte `REPORT_MESSAGE` buffer (first
  message stands until cleared), read through new exports `report_message_ptr/len/clear`
  (`EngineExports` + `takeReportMessage()` in `engine-exports.ts`); the processor raises it
  after every `render()` as `engineToClient.error(new Error("engine: …"))`, the offline
  worker throws it. `PluginInstrument::new` / `PluginAudioEffect::new` now take the box uuid
  and type name (`Engine::box_type_name`) for that message. `PanicWriter` became the shared
  `BufferWriter`.
- `crates/abi`: native (non-wasm) test seams — `set_native_sample` / `clear_native_sample`
  registry behind `resolve_sample` / `SampleRef::plane`, `native_parameter_id` behind
  `bind_parameter` — so device crates can drive the real sample/parameter path in `cargo
  test`. No wasm behaviour change.

## Nano sampler 2.0 (boxes 0.0.110, adapters, device_nano.wasm)

Upstream PR #308 (SynthsBack-lab's "re-soul" sampler, ported in place onto the Nano device;
`InstrumentFactories.Nano` now reads "Polyphonic sampler with root key, region, crossfade loop
and envelope").

- **`NanoDeviceBox` fields** (all `ParameterPointerRules` — automatable, MIDI-controllable,
  modulatable): `11 octave` (Int32 −3..3), `13 tune` (Float32 ±1200 ct, linear), `14 root-key`
  (Int32 0..127, default 60), `21 attack` (0.001–5 s exponential, default 0.003 — the old
  fixed 3 ms), `22 sample-start` / `23 sample-end` (unipolar, start past end plays backwards),
  `24 loop` (bool), `25 loop-fade` (0.001–1 s exponential, default 0.05), `26 loop-start` /
  `27 loop-end` (unipolar, clamped inside the region). `10 volume` and `20 release` unchanged.
  A project saved before these fields loads with the defaults, which reproduce the original
  two-parameter Nano sample-for-sample (upstream `tests/legacy_parity.rs`).
- **`NanoDeviceBoxAdapter.namedParameter`** gains `octave`, `tune`, `rootKey` (labels via
  `MidiKeys.toFullString`), `attack`, `sampleStart`, `sampleEnd`, `loop`, `loopFade`,
  `loopStart`, `loopEnd`; `volume`'s label is "Gain". New `file(): Option<AudioFileBoxAdapter>`
  (subscribes the `file` pointer and pre-creates the loader) and
  `positionsAddress = box.address.append(1001)` — the device publishes up to 16 active read-head
  positions (source frames, −1-terminated) through a float broadcast at that address, which
  the studio's editor paints as playheads.
- Rust voice (`device-nano/src/voice.rs`): rate
  `2^(pitch/12 − (rootKey/12 − octave − tune/1200))` (bit-identical to the old `2^(pitch/12 −
  5)` at root 60 — pinned by test), region captured at the voice's first chunk (a moved region
  does not affect held notes; root key / octave / tune are read live and retune held notes),
  crossfaded loop with a shift ≥ half the loop span so a one-frame loop cannot stall, a
  release started mid-attack decays from the level reached (never swells), a second stop
  keeps the first release, a sample swapped for a shorter one mid-note ends the voice instead
  of reading out of bounds.

## Voicing and Neon (device_neon.wasm, device_vaporisateur.wasm)

- **`PolyphonicStrategy` fade reserve** (`crates/voicing`): a stolen voice is relocated into
  one of `FADE_SLOTS = 4` reserve slots so its force-stop de-click fade completes, instead of
  being overwritten in place (the click heard once play exceeds `VOICES` notes). With a
  saturated pool the victim is a released voice if any, else the OLDEST (was slot 0); a burst
  of steals past the reserve falls back to the in-place cut. Rendered every chunk beside the
  main pool, cleared on `reset()`.
- **Neon envelope**: a voice HOLDING at sustain chases live sustain-level edits at the
  sustain stage's own rate (the input-window Hold/Colour macros write that level while notes
  sound); a released voice does not.

## Timeline / editing

- **`RegionClipResolver.fatal` REMOVED** (upstream "make validateTrack fatal again").
  `validateTrack` panics unconditionally on a non-positive duration or an overlap; the
  studio app no longer flips it off at boot. New `classifySeparation(region, begin, end) →
  "delete" | "start" | "complete" | "clip"` folds a within-tolerance remainder into the empty
  side (`boundaryTolerance` on the right edge; the left edge is an Int32 field and never
  drifts), used by the `separate` task and `#trimStart` (which also deletes when the trim
  position is within tolerance of the region end) — a sub-tolerance sliver no longer becomes
  a degenerate region that then fails validation (upstream "fixes 1025–1027",
  `RegionClipResolver.producer.test.ts`).
- **`NoteRegionBox.eventOffset` (field 14) is `deprecated`** in the forge schema: the getter
  still exists on the box class (the `deprecated` marker keeps stored documents readable), but
  `ProjectApi.createNoteRegion` dropped its `eventOffset` param and no longer writes the
  field, and the Rust box registry dropped field 14 — the engine ignores it.
- `ValueUndoZombie.test.ts`, `CreateTrackRegionResolvesOverlap.test.ts` updates upstream.

## Transfer, presets, clipboard: modulators keep their identity (#385)

- `TransferUtils.keepsIdentity(box)` = `resource === "preserved" || isModulatorBox(box)`;
  `TransferUtils.withModulators(boxes)` appends the modulator behind every `ModulationBox`
  in a dependency set (carried alone, their other assignments are not walked);
  `TransferUtils.mapModulatorCollection(pointer, targetGraph)` re-points a
  `Pointers.ModulatorCollection` pointer at the target root's `modulators` field. Used by
  `PresetEncoder`/`PresetDecoder` (all three paths), `TransferAudioUnits`,
  `TransferUtils.copyAudioUnits`, and the audio-units clipboard. `copyBoxes` skips
  modulators that already exist in the target graph (shared, not copied).
- `BoxGraphCopy.Options<T>` is an exported type; `AudioUnitsClipboard.newAudioUnitPasteOptions
  (rootBox, primaryBusUuid)` centralises the paste mapping (audio units, output bus, MIDI
  devices, modulation pointers, `keepUuid: isModulatorBox`, exclude existing modulators).
- `DevicesClipboard.isTimelineContent(box)` (tracks, regions, clips, event collections AND
  the events / curves themselves — the 0.0.170 list missed `NoteEventBox`, `ValueEventBox`,
  `ValueEventCurveBox`, upstream "#1049, #1128"); the replace-instrument decision only
  considers a selected instrument that belongs to the pasting host (the selection outlives a
  switch of the edited unit).

## Scripting storage, cloud, lib

- **`studio-core/scripts`** (new, exported from the package index): `ScriptMeta`
  (`{name, description, created, modified, stock?}` + `init/copy/fromJSON`), `ScriptPaths`
  (OPFS layout `scripts/v1/<uuid>/script.ts` + `meta.json`, `trash.json`), `ScriptStorage`
  (singleton over `Workers.Opfs`: `list/loadMeta/loadSource/exists/save/saveMeta/delete/
  loadTrashedIds/syncStock`, FNV-1a `hash` so a newer build replaces stock scripts and a
  deleted one stays deleted). `CloudBackupScripts` (sixth backup stage, pristine stock scripts
  skipped) and `FilePickerAcceptTypes.ScriptFileType` (`.ts`). Studio-app side: scripting
  docs, `project.mixdown()` / `openDAW.saveFile()`, script edits are history steps.
- **lib-box `applyUpdateTasks(graph, updates)`** — the sync target's task applier extracted
  and exported, so forward-only update tasks can run inside a caller-owned (undoable)
  transaction.
- **lib-dom `Files.saveWithApproval({buffer, headline, message?, suggestedName, types?})`** —
  approval dialog then `save`, abort-tolerant (browsers need a user input to allow the
  download). `Browser.id()` moved its localStorage key from `__id__` to `browser-id` (the old
  key carried the visitor-counting uuid and is purged at boot).
- lib-std `requireProperty` throws `<key>'s owner not available` when the owner is absent.
- `AssetService.list()` (samples/soundfonts: `collectAllFiles`). `CloudBackup.backup` loops a
  "Cloud sync failed — Retry / Cancel" dialog on failure and reports connection errors as an
  info dialog; `DropboxHandler` wraps every call's failure as
  `Dropbox <op> '<path>' failed (<status>): <summary>`.
- `IconSymbol.StereoSplit` appended (185); `EffectFactories.StereoComposite` uses it.
  `StudioSettings` gains `interface.offer-studio-tour` (default true).

## Upstream tests

`packages/studio/core-wasm/test/` gained ~90 test files (~10k lines) plus `.od` project
fixtures and loop WAVs — render smoke/parity suites per device, recording-state and
recording-start-edge tests, sync/emission, marker playback, metronome signature, MIDI output,
stem export, live-meter teardown fuzz. `RecordAudio.test.ts` (350 lines), `CaptureAudio.test.ts`,
`RecordMidi.test.ts`, `RecordingWorklet.test.ts`, `SampleService.importRecording.test.ts`,
`ScriptStorage.test.ts`, `CloudBackupScripts.test.ts`, `PresetModulators.test.ts`,
`TransferModulators.test.ts`, `NanoDeviceBox.test.ts` added in the TS packages.

## Studio-app only (no SDK surface)

Studio tour (guided cards after opening a project, `offer-studio-tour` preference), the Nano
editor (Main / Pitch / Envelope / Waveform / Loop sections, draggable loop markers, manual
page), a standalone manuals app that does not boot the studio, scripting docs, mobile Sass
updates, a demux button, TimeCodeInput commits all four sub-fields on Enter/focusout (#369),
software keyboard retains state between toggles (#294), the dashboard adopts the tempo when
creating an audio track, loopmasters samples, error-triage flips (1097…1129).

## opendaw-headless follow-ups shipped with this upgrade

- **No code changes forced**: `npx tsc --noEmit` reports zero `^src/` errors before and after
  (the baseline was already clean), `npm run build` passes, all 326 vitest tests pass,
  `npm ci` verifies the regenerated lockfile. Nothing in `src/` calls `createRecording`,
  `importRecording`, `onSaved`, `createNoteRegion({eventOffset})` or `RegionClipResolver.fatal`.
- **Audit build probe re-targeted**: `detectSdkBuildProbe` in
  `recording-alignment-audit-debug-demo.tsx` and `input-latency-calibration-debug-demo.tsx`
  keyed on `engine.recordingStart`, which every release from 0.0.172 on ships — the installed
  build would have read `candidate`. The marker is now `CaptureAudio.prototype.
  calibrateInputLatency` (upstream PR #380, still open), so the release reads `upstream` again
  and an override build carrying #380 reads `candidate`. Band selection (`profileKeyFor`) was
  already keyed on the persisted `buildFeatures` list, not the label, and is unchanged: the
  release's features are `[recordingStart]`, which resolves to bands A–D — the same table the
  register's Task 9 branch runs (the #376 build) were judged against.
- **Regression checks on the installed build** (both pages are the standing regression tests):
  `automation-simplifier-debug-demo.html` → 116 → 11 events, 0.0037 (0.4× ε), verdict B
  (front-trim only); `swipe-comping-demo.html?sampleRate=44100` Count-in only → four clicks in
  each of three recordings, none at the punch-in.
- **Standing sweeps re-run against the release** (register section "Standing sweep on 0.0.172
  (2026-09-28)" in `debug/recording-start-alignment-audit.md`): sample-rate/quantum-alignment
  180 of 180 cells pass; recording start-alignment 48 kHz and 44.1 kHz 60 rows each, 0 error
  rows, 30 of 30 repeats finalized (no loop-wrap hang), head/tail deficits 0, per-cell means
  −4…+0.3 ms raw (+17…+23 ms after the harness-path term) versus −35…−53 ms on 0.0.170;
  multi-mic 6 of 6 repeats on both tapes (no #375 collision), skew ≤ one quantum. Verdicts
  are `matches-known-defect`/`investigate` against bands A–D, which were fitted to the
  0.0.170 bug — a release band table is a harness follow-up, not an SDK finding.
- **Stale docs updated in this PR**: root `CLAUDE.md` (`RegionClipResolver.fatal` no longer
  exists; `importRecording` takes the uuid first), `documentation/08-recording.md`
  (`RecordingWorklet.meta` / peaks after finalize), `documentation/09-editing-fades-and-
  automation.md` (simplifier is Douglas-Peucker, ε bounds the error), `documentation/16-midi.md`
  (`eventOffset` deprecated), `src/demos/automation/CLAUDE.md` (simplifier paragraph),
  `src/demos/recording/CLAUDE.md` (#376 shipped, build-probe marker, finalize head-keep),
  `src/demos/recording/swipe-comping-demo.tsx` and
  `src/demos/automation/{automation-simplifier-debug-demo,live-automation-recording-demo}.tsx`
  copy (the leak / flattening are fixed; pages kept as regression tests),
  `debug/README.md` + the two debug notes marked fixed, the register's contribution table.
- **Licence**: this repo consumes the packages under their new AGPL-3.0-or-later declaration
  from this version on (LGPL-3.0-or-later through 0.0.170).
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`):
  `Engine.recordingStart` / `RecordingStart`, `prepareRecordingState(countIn, generation)`,
  `recordingStarted` in `protocols.d.ts` and both wasm bundles, `RecordingProcessorToClient` /
  `RecordingProcessorChannel`, `createRecording(uuid, …)`, `RecordingWorklet(context, uuid,
  config)` + `firstQuantumTime` + `recordedFrames` + `onSaved: Exec`, `importRecording(uuid,
  …)`, `SampleStorage.loadPeaks`, `ANCHOR_WAIT_SECONDS = 0.25` and `minTakeSeconds` in
  `RecordAudio.js`, `AudioContexts.resume` + `#discardPreparedWorklet` in `CaptureAudio.js`,
  `outputLatency ?? 0.01` and `takeDuration` in `RecordMidi.js`, the recursive `simplify` in
  `RecordAutomation.js`, `report_message_ptr/len/clear` exported by `engine.wasm`,
  `classifySeparation` present and `fatal` absent on `RegionClipResolver.d.ts`, the ten
  `NanoDeviceBox` getters + `positionsAddress` / `file()`, `eventOffset` still a getter on
  `NoteRegionBox.d.ts` and absent from `ProjectApi.d.ts`, `applyUpdateTasks`,
  `saveWithApproval`, `studio-core/dist/scripts/`, `AssetService.list`, `IconSymbol.StereoSplit
  = 185`, `keepsIdentity` / `withModulators` / `mapModulatorCollection`, `isTimelineContent`,
  `newAudioUnitPasteOptions`, `offer-studio-tour`, and the AGPL licence field on 16 of 17
  installed `@opendaw/*` packages.
