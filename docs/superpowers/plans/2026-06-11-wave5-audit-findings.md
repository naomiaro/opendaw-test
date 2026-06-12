# Wave 5 Audit Findings — Recording + MIDI Demos (working file)

> Working file for the wave-5 demo audit. Consumed by Tasks 2-8, deleted by Task 8.
> Pinned tags: studio-sdk@0.0.154, studio-core@0.0.152, studio-adapters@0.0.116,
> studio-boxes@0.0.94, studio-enums@0.0.77, lib-dsp@0.0.84, lib-std@0.0.78,
> lib-box@0.0.86, lib-dom@0.0.83. All `git show`/`git grep` reads are against
> `@opendaw/studio-core@0.0.152` (monorepo snapshot) unless noted.
> Upstream paths: studio-core = `packages/studio/core`, processors =
> `packages/studio/core-processors`, schemas = `packages/studio/forge-boxes/src/schema`,
> adapters = `packages/studio/adapters`.

## Recording claims

### Claim 1 — BlockFlag.discontinuous loop-wrap crossfade [Task 8 — wave-3 carry-over]
Recording CLAUDE.md:251-256. Sub-claims verified separately:
- **Who sets the flag:** `BlockRenderer` sets `discontinuous = true` when processing a
  `"loop"` action (`p0 = action.target; discontinuous = true`) and on marker jumps; the
  flag is packed via `BlockFlags.create(transporting, discontinuous, playing, bpmChanged)`.
  `@opendaw/studio-core@0.0.152:packages/studio/core-processors/src/BlockRenderer.ts:218` (loop), `:230` (marker), `:180` (pack).
  **Scoping:** the loop action sets the flag only on the `else` arm of `pauseOnLoopDisabled`
  (BlockRenderer.ts:213-219) — with `playback.pauseOnLoopDisabled` enabled the engine pauses
  at the wrap instead and no crossfade occurs. The CLAUDE.md graduation must not state the
  mechanism as universal.
- **Who consumes:** `TapeDeviceProcessor.#processBlock`: `if (Bits.some(flags, BlockFlag.discontinuous)) { this.#fadeOutAllPitchVoices(lane); lane.sequencer.reset() }`.
  `@opendaw/studio-core@0.0.152:packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:122-125`.
- **Fade duration:** `VOICE_FADE_DURATION: number = 0.020` (20 ms); voices use
  `fadeLengthSamples = Math.round(VOICE_FADE_DURATION * sampleRate)`.
  `@opendaw/studio-core@0.0.152:packages/studio/core-processors/src/devices/instruments/Tape/constants.ts:1`,
  `TapeDeviceProcessor.ts:270`.
- **Fade-in when read offset non-zero:** `PitchVoice` constructor: `offset === 0` →
  `VoiceState.Active` (no fade-in); otherwise `VoiceState.Fading` with `fadeDirection = 1.0` (fade-in).
  `@opendaw/studio-core@0.0.152:packages/studio/core-processors/src/devices/instruments/Tape/PitchVoice.ts:32-38`.
- **Fade-out starts from current amplitude:** `startFadeOut()` seeds
  `fadeProgress = fadeLength * (1.0 - this.#lastFinalAmplitude)` so the out-ramp begins at the
  last applied amplitude. `PitchVoice.ts:46-53`.

CONFIRMED
`@opendaw/studio-core@0.0.152:packages/studio/core-processors/src/BlockRenderer.ts:218`; `.../Tape/constants.ts:1`; `.../Tape/PitchVoice.ts:32-53`; `.../TapeDeviceProcessor.ts:122-125`

### Claim 2 — `stop(true)` vs `stopRecording()` semantics [Task 2/4]
Recording CLAUDE.md:8-12,111-118.
- `EngineFacade.stop(reset=false)` → worklet → `EngineProcessor.#stop(reset)`: if
  recording/counting-in it clears both flags AND resets `timeInfo.position` (to
  `playbackTimestamp` or 0); `reset===true` additionally calls `#reset()` (position 0,
  all processors reset). `@opendaw/studio-core@0.0.152:packages/studio/core-processors/src/EngineProcessor.ts:498-513,558-570`.
- The position reset while RecordAudio's `engine.position` subscription is still live is
  the spurious-wrap mechanism (`currentPosition < lastPosition` check in RecordAudio.ts).
  Plausible and consistent with source; exact main-thread observable ordering
  (position-jump arriving before isRecording=false) is not provable from source alone.
- "Prevents RecordingProcessor from flushing": finalization is driven from the main thread —
  `Recording.start` subscribes `engine.isRecording`/`isCountingIn` and on false runs
  `terminator.terminate()` → RecordAudio teardown → `recordingWorklet.limit(...)` →
  `#finalize()` merges the ring buffer and imports the sample
  (`Recording.ts:38-48`, `RecordAudio.ts:168-191` teardown Terminable, `RecordingWorklet.ts:64-69,100-118`).
  Both `stop(true)` and `stopRecording()` trip the same teardown; the danger of `stop(true)`
  is the position reset + processor `#reset()` racing the in-flight async finalization, not a
  separate kill switch. Demo-observed flush failures are consistent with this but the "kills
  the audio graph" wording overstates the mechanism.
- "OpenDAW's own transport never calls stop(true) after stopRecording()": record button
  calls `project.stopRecording()` only; stop-playback shortcut calls `engine.stop(true)` as a
  separate user action. `@opendaw/studio-core@0.0.152:packages/app/studio/src/ui/header/TransportGroup.tsx:34-39`,
  `packages/app/studio/src/service/StudioShortcutManager.ts:113,118`.
- **Drift note:** `EngineProcessor.#stopRecording()` sets `timeInfo.transporting = false` —
  at 0.0.152 stopping recording also STOPS transport. CLAUDE.md:114-115 "finalization
  completes asynchronously while the engine keeps playing" is stale: finalization is async,
  but playback does not continue. `EngineProcessor.ts:547-556`.
  Severity: this sub-claim is WRONG-level in isolation — the sentence is flatly false at
  0.0.152 (the doc-corrections table below already carries the fix); do not deprioritize it
  under this section's NUANCED header.

NUANCED (practical rule stands — never `stop(true)` until loaders are terminal; but (a) the flush-prevention wording overstates the mechanism (it is a race with async finalization, both paths trip the same teardown), and (b) `stopRecording()` now also stops transport, so "engine keeps playing" is stale)
`@opendaw/studio-core@0.0.152:packages/studio/core-processors/src/EngineProcessor.ts:498-513,547-556`; `packages/studio/core/src/capture/Recording.ts:38-48`; `packages/app/studio/src/ui/header/TransportGroup.tsx:34-39`

### Claim 3 — Takes mechanism [Task 4]
Recording CLAUDE.md:69-88.
- Gate: `if (loopEnabled && allowTakes && currentTake.nonEmpty() && currentPosition < lastPosition)` —
  requires `loopArea.enabled` AND `allowTakes` AND backward position jump. CONFIRMED.
  `@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/RecordAudio.ts:210` (gate), `:233` (`startNewTake(loopFrom)`).
- Take 1 records from the start position through first wrap: first region is created at
  `currentPosition` when recording starts (`createTakeRegion(currentPosition, waveformOffset, null)`);
  at wrap its duration is computed `position → loopTo`. CONFIRMED. `RecordAudio.ts:269,227-229`.
- `olderTakeAction` ∈ {"disable-track", "mute-region"} CONFIRMED; **`olderTakeScope` is a
  THREE-value union: {"none", "all", "previous-only"}** — CLAUDE.md omits `"none"` (skip
  any muting/disabling). `@opendaw/studio-core@0.0.152:packages/studio/adapters/src/engine/EnginePreferencesSchema.ts:5-6`;
  `RecordAudio.ts` `finalizeTake` (`if (olderTakeScope === "none") {return}`).
- Defaults: `allowTakes: true`, `olderTakeAction: "mute-region"`, `olderTakeScope: "previous-only"`,
  `countInBars: 1` (allowed values 1-8). `EnginePreferencesSchema.ts:4,41-48`.
- New at 0.0.152: zero-duration takes are deleted at wrap (`take.regionBox.delete()`),
  and a WRAP-finalized take's duration is the DETERMINISTIC tempo-map interval
  `tempoMap.intervalToSeconds(take.regionBox.position.getValue(), loopTo)` — not the live
  frame count. `RecordAudio.ts:221-233`. (Scope: wrap path only — see Claim 4 for the
  teardown-finalized last take.)

NUANCED (mechanism confirmed; add `olderTakeScope: "none"` to the documented union)
`@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/RecordAudio.ts:210-233`; `packages/studio/adapters/src/engine/EnginePreferencesSchema.ts:4-6,41-48`

### Claim 4 — waveformOffset accumulation + playback read formula [Task 4]
Recording CLAUDE.md:231-260.
- Buffer layout `[count-in | take 1 | take 2 …]` CONFIRMED — single RecordingWorklet ring
  buffer, all takes share one `AudioFileBox`, count-in frames included.
- Take 1 offset: `waveformOffset = headStartSeconds + countInSeconds + outputLatency + inputLatency` —
  CLAUDE.md:237 omits **`inputLatency`** (manual mic→engine compensation, resolved via
  `InputLatency.resolve(captureBox.inputLatency, prefs.recording.inputLatency, outputLatency)`).
  `@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/RecordAudio.ts:266` (formula), `packages/studio/core/src/capture/CaptureAudio.ts:213-217` (resolution).
- "Set once at creation, never modified" CONFIRMED — `box.waveformOffset.setValue(waveformOffset)`
  only inside `createTakeRegion`. `RecordAudio.ts:78`.
- Accumulation: `currentWaveformOffset += takeDurationSeconds` at each wrap, where
  `takeDurationSeconds = tempoMap.intervalToSeconds(take.regionBox.position.getValue(), loopTo)`.
  CONFIRMED structurally, BUT:
- **Drift: "duration overshoot ≈ one audio block" is STALE at 0.0.152 — but only for
  WRAP-finalized takes.** At each loop wrap the take's duration is set to the deterministic
  tempo-map interval to `loopTo` (source comment: "Stays deterministic (avoids the
  latency-lagged live regionBox.duration that previously caused peak drift)") — no ~2-3 ms
  tail overshoot for those takes. `RecordAudio.ts:221-233`.
  **The LAST take is teardown-finalized, not tempo-map-derived:** the stop teardown
  (`RecordAudio.ts:179-191`) reads `regionBox.duration.getValue()` — i.e. the last live
  `numberOfFrames/sampleRate - currentWaveformOffset` write, which is RenderQuantum-granular
  — and uses it for `recordingWorklet.limit(...)`. So the final take's duration remains
  quantum-granular. Task 8's CLAUDE.md rewrite must say: "wrap-finalized takes are
  deterministic tempo-map intervals; the final take (teardown-finalized) remains
  quantum-granular". Context: the `onSaved` comment (`RecordAudio.ts:142-150`) documents a
  residual up-to-one-quantum ring-buffer overshoot on `endInSeconds`, corrected at import
  from the imported sample's actual frame count.
  The live duration during recording still tracks
  `numberOfFrames/sampleRate - currentWaveformOffset`. `RecordAudio.ts:273-283`.
- Read formula: `#processPass` (no-stretch path):
  `elapsedSeconds = this.context.tempoMap.intervalToSeconds(cycle.rawStart, cycle.resultStart)`;
  `offset = (elapsedSeconds + waveformOffset) * data.sampleRate` — the offset seeds a
  `PitchVoice` whose read loop uses `readInt = readPosition | 0` plus linear interpolation,
  advancing by `playbackRate = data.sampleRate / sampleRate`. The CLAUDE.md one-liner
  (`sampleIndex = ((elapsedSeconds + waveformOffset) * sampleRate) | 0`) compresses this; the
  structure (elapsed + waveformOffset, file sample rate, truncation) is right.
  `@opendaw/studio-core@0.0.152:packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:216-222` and `Tape/PitchVoice.ts:100-108`.

NUANCED (layout + set-once + formula confirmed; ADD inputLatency to the take-1 offset; REWORD the duration-overshoot paragraph — wrap-finalized takes are deterministic tempo-map intervals at 0.0.152, while the final take (teardown-finalized) remains quantum-granular)
`@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/RecordAudio.ts:179-191,210-283`; `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:216-222`

### Claim 5 — PeaksWriter discrimination [Task 2]
- `PeaksWriter` lives in **studio-core** (`packages/studio/core/src/PeaksWriter.ts`), implements
  `Peaks` + `Peaks.Stage` from lib-fusion. Has `readonly dataIndex: Int32Array` — so
  `"dataIndex" in peaks` discriminates live writer from final `Peaks`. CONFIRMED.
- `unitsEachPeak(): int {return 1 << this.shift}` (shift=7 → 128 frames per peak);
  `dataIndex[channel]` increments once per appended RenderQuantum block →
  `dataIndex[0] * unitsEachPeak()` = total frames appended across ALL takes. CONFIRMED.
- PeaksWriter also has `numFrames` (set via `RecordingWorklet.setFillLength` each position
  tick); final lib-fusion `Peaks` exposes `numFrames` too. CONFIRMED.
- Per-frame duration write: RecordAudio's `engine.position.catchupAndSubscribe` callback sets
  `duration`/`loopDuration` on the live take and `setFillLength(numberOfFrames)` on every
  position tick. ("Every frame" = every engine position update.) CONFIRMED.

CONFIRMED
`@opendaw/studio-core@0.0.152:packages/studio/core/src/PeaksWriter.ts:5-26`; `packages/studio/core/src/RecordingWorklet.ts:75-79`; `packages/studio/core/src/capture/RecordAudio.ts:273-283`

### Claim 6 — Capture field taxonomy [Task 2]
- `CaptureAudioBox` schema fields: `device-id` (string), `record-mode` (string, "normal" |
  "replace" | "punch" — NEW, not in our docs), `request-channels` (**int32**, default 2),
  `gain-db` (float32, decibel), `input-latency` (float32, default -2.0; comment: -2 = inherit
  engine prefs, -1 = equals output latency, >=0 added to output latency). NO `arm` field.
  `@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/CaptureBox.ts:4-30`.
- `capture.requestChannels` setter writes the Int32Field:
  `set requestChannels(value: 1 | 2) {this.captureBox.requestChannels.setValue(value)}`. CONFIRMED.
  `@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/CaptureAudio.ts:106`.
- `capture.armed` is `DefaultObservableValue<boolean>` exposed as
  `MutableObservableValue<boolean>` — runtime-only, NOT a box field. CONFIRMED.
  `@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/Capture.ts:34,54`.
- `monitoringMode` is a plain getter/setter manipulating Web Audio nodes; **setting any
  non-"off" mode auto-arms** (`this.armed.setValue(true)`). CONFIRMED.
  `CaptureAudio.ts:93-102`.

CONFIRMED (note the additional `record-mode` schema field and `input-latency` sentinel semantics)
`@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/CaptureBox.ts:4-30`; `@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/Capture.ts:34,54`; `CaptureAudio.ts:93-106`

### Claim 7 — Monitor signal chain (0.0.133+) [Task 2]
- `monitorVolumeDb`/`monitorPan`/`monitorMuted` are direct property setters writing
  GainNode/StereoPannerNode params (mute zeroes the gain). CONFIRMED. `CaptureAudio.ts:118-137`.
- `setMonitorOutputDevice(Option<string>)`: non-empty → creates
  `MediaStreamAudioDestinationNode`, `new Audio()`, `setSinkId(deviceId)`, `audio.play()`;
  `Option.None` → `audioContext.destination`. On failure it reverts to `Option.None` and
  raises `RuntimeNotifier.info({headline: "Output Device Error", ...})`. CONFIRMED.
  `CaptureAudio.ts:140-176`.
- Chain order (direct): `sourceNode → monitorGainNode → monitorPanNode → destination`
  (`monitorGain.connect(monitorPan)` in ctor; `sourceNode.connect(monitorGain)`,
  `monitorPan.connect(destination)` in `#connectMonitoring`). CONFIRMED. `CaptureAudio.ts:49-53,318-329`.
- "effects" mode: `engine.registerMonitoringSource(uuid, sourceNode, channelCount, monitorGainNode)` —
  engine processes, returns into `monitorGainNode → monitorPanNode → destination`. CONFIRMED.
  `CaptureAudio.ts:324-328`.

CONFIRMED
`@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/CaptureAudio.ts:49-53,118-176,318-340`

### Claim 8 — Arming semantics [Task 2/6]
- **`setArm(subject, exclusive)` is a TOGGLE, not a setter:**
  `const arming = !subject.armed.getValue(); subject.armed.setValue(arming);` and only when
  `arming && exclusive` are the others disarmed. Calling `setArm(capture, true)` on an
  already-armed capture DISARMS it. Frozen audio units are skipped entirely.
  `@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/CaptureDevices.ts:55-64`.
- `filterArmed()` exists but ALSO requires `audioUnitBox.input.pointerHub.nonEmpty()` (an
  instrument/input is connected) and the unit not frozen. `CaptureDevices.ts:69-75`.
- `Recording.start` records all `filterArmed()` captures in parallel
  (`prepareRecording()` for all, then `startRecording()` each). CONFIRMED.
  `packages/studio/core/src/capture/Recording.ts:18-27`.
- **"startRecording() auto-creates a Tape when no instruments exist" (midi CLAUDE.md:31) is
  WRONG at 0.0.152:** `Recording.start` simply proceeds with zero captures
  (`if (captures.length > 0) {...}`) — the engine enters recording state but nothing is
  recorded and no instrument is created. No `InstrumentFactories.Tape` call exists anywhere
  in the recording path (only stem-import/drag-drop/sample-selection paths create Tapes).
  `Recording.ts:17-28`; grep `InstrumentFactories.Tape` at the tag — no hit under `core/src/capture`.

WRONG (two fixes: `setArm` is a toggle — demos/docs that treat it as "arm = true" must guard with `armed.getValue()`; and the auto-create-Tape claim must be dropped/reworded: with no armed captures, recording records nothing)
`@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/CaptureDevices.ts:55-75`; `packages/studio/core/src/capture/Recording.ts:17-28`

### Claim 9 — SampleLoader contract [Task 4]
- Subscribe-only: both `RecordingWorklet` and `DefaultSampleLoader` implement
  `SampleLoader.subscribe()`; no `catchupAndSubscribe` anywhere on the interface. CONFIRMED.
- Synchronous callback + `Terminable.Empty` for terminal states:
  - `DefaultSampleLoader.subscribe`: fires synchronously for `"loaded"` **and** `"error"`,
    returns `Terminable.Empty`. `packages/studio/core/src/samples/DefaultSampleLoader.ts:20-26`.
  - `RecordingWorklet.subscribe`: fires synchronously **only for `"loaded"`** — an
    errored/terminated recording worklet never had an "error" state (its `#finalize` rejects
    via console.warn; state stays `"record"`). NUANCE for finalization barriers: during
    recording the loader IS the RecordingWorklet, so an `"error"` state will never be
    emitted by it at 0.0.152; the error-handling requirement still applies to
    `DefaultSampleLoader` (post-reload loads, decode failures).
    `packages/studio/core/src/RecordingWorklet.ts:84-90,100-118`.
- `state.type` union: `"idle" | "record" | "progress" | "error" | "loaded"`; error carries
  `reason: string` (NOT `.error`). CONFIRMED.
  `@opendaw/studio-core@0.0.152:packages/studio/adapters/src/sample/SampleLoaderState.ts:3-8`.
- `queryLoadingComplete()` resolving before recording data is set: `Project.queryLoadingComplete`
  aggregates `AudioFileBoxAdapter` loaders' terminal states; `RecordingWorklet` reaches
  `"loaded"` only after `importRecording` resolves, but the recording-era file box is swapped
  (`onSaved` re-points to a NEW AudioFileBox) — the demos' empirical rule ("don't use it to
  detect recording data availability") remains sound. NUANCED (unverifiable in full from
  source alone: depends on subscription timing across the box swap).

NUANCED (contract confirmed; correction: RecordingWorklet emits only "loaded" — "error" handling matters for DefaultSampleLoader paths, and barriers still need the timeout because a worklet failure produces NO terminal state at all)
`@opendaw/studio-core@0.0.152:packages/studio/core/src/samples/DefaultSampleLoader.ts:20-26`; `packages/studio/core/src/RecordingWorklet.ts:84-118`; `packages/studio/adapters/src/sample/SampleLoaderState.ts:3-8`

### Claim 10 — Take labels [Task 2/4]
`RecordAudio.createTakeRegion`: `box.label.setValue(\`Take ${takeNumber}\`)` — every audio
recording region is labeled `"Take N"` starting at N=1, including single non-loop recordings.
`RecordMidi.createTakeRegion` does the same for MIDI takes (`Take ${takeCount}`). No
`"Recording"` label is written anywhere at 0.0.152 (legacy only). String-matching
`label.startsWith("Take ")` is valid; the `"Recording"` fallback is dead code for new sessions.
CONFIRMED
`@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/RecordAudio.ts:77` ; `packages/studio/core/src/capture/RecordMidi.ts:64`

### Claim 11 — Take-to-track matching chain [Task 4]
Schema pointer names: `AudioRegionBox` field 1 `regions` (pointerType RegionCollection,
mandatory) → targets `TrackBox.regions` field; `TrackBox` field 1 `tracks` (pointerType
TrackCollection, mandatory) → targets `AudioUnitBox.tracks`. So
`regionBox.regions.targetVertex` → TrackBox and `trackBox.tracks.targetVertex` → AudioUnitBox.
CONFIRMED
`@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/timeline/AudioRegionBox.ts:11`; `.../TrackBox.ts:10-12`

## MIDI claims

### Claim 12 — MidiDevices API surface [Task 6]
All present at studio-core@0.0.152 (`packages/studio/core/src/midi/MidiDevices.ts`):
- `canRequestMidiAccess(): boolean` (`"requestMIDIAccess" in navigator`) — line 25
- `requestPermission()` — memoized `navigator.requestMIDIAccess({sysex: false})`; on failure
  logs a warning and returns `Errors.warn(...)` — lines 70-85
- `inputDevices(): ReadonlyArray<MIDIInput>` — external inputs concatenated with
  `softwareMIDIInput`; returns `[softwareMIDIInput]` when no MIDI access — lines 101-104
- `softwareMIDIInput.sendNoteOn(note: byte, velocity: unitValue = 1.0)` — asserts 0-127,
  velocity clamped 0-1 then scaled to a 0-127 byte; `sendNoteOff(note: byte)` —
  `packages/studio/core/src/midi/SoftwareMIDIInput.ts:52-62`
- `subscribeMessageEvents(observer, channel?: byte): Subscription` — works pre-permission by
  deferring until access is available — MidiDevices.ts:89-98

CONFIRMED
`@opendaw/studio-core@0.0.152:packages/studio/core/src/midi/MidiDevices.ts:25,70-104`; `packages/studio/core/src/midi/SoftwareMIDIInput.ts:52-62`

### Claim 13 — CaptureMidi has no implicit arming [Task 6]
- CaptureAudio: `set monitoringMode(...)` auto-arms (`this.armed.setValue(true)` for any
  non-"off" mode). `@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/CaptureAudio.ts:93-102`.
- CaptureMidi: NO equivalent. MIDI message subscriptions (`#updateStream`) are only created
  inside `this.armed.catchupAndSubscribe(...)` when armed=true; un-armed, `#bufferNote`
  returns immediately and no `midimessage` listener exists — software-keyboard notes never
  reach `engine.noteSignal()` (no monitoring) and `Recording.start`'s `filterArmed()` skips
  the capture (no recording). CONFIRMED.

CONFIRMED
`@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/CaptureMidi.ts:62-78,168-170`; `packages/studio/core/src/capture/Recording.ts:18`

### Claim 14 — NoteEventBox creation: manual vs createEvent [Task 6]
- Schema (`@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/timeline/NoteEventBox.ts`):
  `position` **int32**, `duration` **int32** (default SemiQuaver, min 1), `pitch` **int32**
  (0-127, default 60), `velocity` **float32** (0-1, default 100/127), `play-count` **int32**
  (1-128), `play-curve` **float32** (-1..+1), `cent` **float32** (**range -50.0..+50.0**, NOT
  unbounded cents), `chance` **int32** (0-100). Pointer: field 1 `events`
  (Pointers.NoteEvents, mandatory) — event points AT the collection's `events` field.
- Demo's manual path (midi-recording-demo.tsx:292-297: `NoteEventBox.create` + setValues +
  `box.events.refer(collection.events)`) matches EXACTLY what the SDK itself does — both
  `RecordMidi.flushPendingNotes` (`@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/RecordMidi.ts:113-121`)
  and `NoteEventCollectionBoxAdapter.createEvent` build the box this way.
- `createEvent({position, duration, pitch, cent, velocity, chance, playCount})` exists at
  studio-adapters@0.0.116, takes ALL SEVEN params (none optional), returns
  `NoteEventBoxAdapter`, and must be called inside `editing.modify()` (it does not open a
  transaction itself).
  `@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/timeline/collection/NoteEventCollectionBoxAdapter.ts:22-30,80-93`.
- Verdict for Task 6: **migrate the demo to `collection.createEvent({...})`** — it is the
  adapter-layer idiom, removes the box-class import and manual pointer wiring, and returns a
  typed adapter. The manual path is not wrong, just lower-level.

NUANCED (manual path is valid SDK-mirroring code, but createEvent is the prescribed idiom — Task 6 migrates; also record cent range -50..+50 and chance/playCount Int32 typing)
`@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/timeline/NoteEventBox.ts:13-30`; `@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/timeline/collection/NoteEventCollectionBoxAdapter.ts:22-30,80-93`

### Claim 15 — Note event deletion idiom [Task 6/8]
- `NoteEventBox.pointerRules.accepts = [Pointers.Selection, Pointers.NoteEventFeature]`.
  `NoteEventRepeatBox.event` is a **mandatory** pointer of type `Pointers.NoteEventFeature`
  targeting a NoteEventBox — i.e. NoteEventBox CAN have a mandatory dependent.
  `@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/timeline/NoteEventRepeatBox.ts:11`.
- HOWEVER at 0.0.152 nothing ever creates a `NoteEventRepeatBox` (schema carries a TODO
  "Create, refer this and remove 'play-count'/'play-curve' from NoteEventBox"; zero
  `NoteEventRepeatBox.create` hits outside forge-boxes). So bare `unstageBox` does not break
  today, but is fragile against that TODO landing.
- Upstream's own note editors delete via `adapter.box.delete()`
  (`@opendaw/studio-core@0.0.152:packages/app/studio/src/ui/timeline/editors/notes/pitch/PitchEditor.tsx:201,231`).

NUANCED (today bare `unstageBox` works because NoteEventRepeatBox is never instantiated, but the idiom should be `box.delete()` — matches upstream editors and the wave-4 curve-event rule; Task 6/8 switch demo + CLAUDE.md to `box.delete()`)
`@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/timeline/NoteEventRepeatBox.ts:11`; `@opendaw/studio-core@0.0.152:packages/app/studio/src/ui/timeline/editors/notes/pitch/PitchEditor.tsx:201`

### Claim 16 — Note adapter API sweep [Task 8]
Checked every member listed in midi CLAUDE.md:41-103 against studio-adapters@0.0.116.
Deviations only:
- `collection.selectableAt(...)` takes `Coordinates<ppqn, int>` which is **`{u, v}`** —
  `export type Coordinates<U, V> = { u: U, v: V }`
  (`@opendaw/lib-std@0.0.78:packages/lib/std/src/selection.ts:4`). CLAUDE.md:79 writes
  `{ x: ppqn, y: pitch }` — WRONG field names; must be `{ u: position, v: pitch }`.
  Severity: this entry is WRONG-level in isolation — code copying `{x, y}` is structurally
  rejected (`coordinates.u` reads `undefined` at runtime); do not deprioritize it under
  this section's NUANCED header.
- `NoteRegionBoxAdapter.offset` is a COMPUTED getter `position - loopOffset`
  (NoteRegionBoxAdapter.ts:145), not a box field — doc wording "content offset" is fine.
- `NoteEventBoxAdapter.playCount` upstream inline comment says "1...16" but the schema says
  1-128 — upstream comment drift, schema wins; our doc says "note-repeat count" (no range) — OK.
- `copyTo` params confirmed: region `{target?, position?, duration?, loopOffset?,
  loopDuration?, consolidate?}` (NoteRegionBoxAdapter.ts:26-33); event
  `{position?, duration?, pitch?, playCount?, events?}` — OK.
- `iterateActiveNotesAt(position): IterableIterator<NoteEvent>` confirmed (NoteRegionBoxAdapter.ts:120).
- `overlapping(from, to, pitch)` confirmed (NoteEventCollectionBoxAdapter.ts:121).
- Everything else as documented.

NUANCED (one real error: selectableAt coordinates are `{u, v}` not `{x, y}` — Task 8 fixes midi CLAUDE.md:79)
`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/timeline/region/NoteRegionBoxAdapter.ts:88-166`; `.../event/NoteEventBoxAdapter.ts:59-108`; `.../collection/NoteEventCollectionBoxAdapter.ts:80-130`; `@opendaw/lib-std@0.0.78:packages/lib/std/src/selection.ts:4`

### Claim 17 — CaptureMidiBox.channel [Task 8]
Schema: `{type: "int32", name: "channel", value: -1, constraints: "any", unit: ""}` with
comment "-1 for all channels". Runtime: `CaptureMidi` maps `channel >= 0 ?
Option.wrap(channel) : Option.None` (None = all channels), and the stream filter compares
`MidiData.readChannel(data) === channel` for 0-15.
CONFIRMED
`@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/CaptureBox.ts:36`; `@opendaw/studio-core@0.0.152:packages/studio/core/src/capture/CaptureMidi.ts:62-66,253`

### Claim 18 — MIDI effect + instrument adapter lists; insertEffect [Task 8]
- All five MIDI effect adapters exist at studio-adapters@0.0.116:
  `ArpeggioDeviceBoxAdapter`, `PitchDeviceBoxAdapter`, `VelocityDeviceBoxAdapter`,
  `SpielwerkDeviceBoxAdapter`, `ZeitgeistDeviceBoxAdapter`
  (`packages/studio/adapters/src/devices/midi-effects/*.ts`).
- All seven instrument adapters exist: `VaporisateurDeviceBoxAdapter`,
  `SoundfontDeviceBoxAdapter`, `TapeDeviceBoxAdapter`, `NanoDeviceBoxAdapter`,
  `PlayfieldDeviceBoxAdapter`, `ApparatDeviceBoxAdapter`, `MIDIOutputDeviceBoxAdapter`
  (`packages/studio/adapters/src/devices/instruments/*.ts`).
- `insertEffect(field: Field<EffectPointerType>, factory: EffectFactory, insertIndex: int =
  Number.MAX_SAFE_INTEGER): EffectBox` — matches the CLAUDE.md call shape
  (`project.api.insertEffect(audioUnitBox.midiEffects, EffectFactories.Arpeggio)`);
  `EffectFactories.Arpeggio` exists; `AudioUnitBox` has a `midi-effects` field.

CONFIRMED
`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/devices/{midi-effects,instruments}/`; `@opendaw/studio-core@0.0.152:packages/studio/core/src/project/ProjectApi.ts:169`; `packages/studio/core/src/EffectFactories.ts:36`

### Claim 19 — Step-recording traversal: cast-free adapter path [Task 6]
- Demo (midi-recording-demo.tsx:236-240) does `region.box as NoteRegionBox` then
  `noteBox.events.targetVertex.unwrap().box as NoteEventCollectionBox`.
- Adapter path verified at studio-adapters@0.0.116: after `region.isNoteRegion()` narrows,
  `region.optCollection` is `Option<NoteEventCollectionBoxAdapter>`
  (NoteRegionBoxAdapter.ts:154-157); `.unwrap().events` is
  `EventCollection<NoteEventBoxAdapter>` and `.unwrap().createEvent({...})` creates events —
  zero casts needed. `NoteRegionBoxAdapter.box` is already typed `NoteRegionBox`
  (NoteRegionBoxAdapter.ts:138).

CONFIRMED (cast-free path exists — Task 6 rewrites the traversal to `region.optCollection` + `createEvent`)
`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/timeline/region/NoteRegionBoxAdapter.ts:138,154-157`; `.../collection/NoteEventCollectionBoxAdapter.ts:80-93`

## API-surface sweep (deviations only)

Checked: AudioDevices (`requestPermission()`, `updateInputList()`, `inputs`,
`requestStream(constraints)`, `defaultInput` — all present,
`@opendaw/studio-core@0.0.152:packages/studio/core/src/AudioDevices.ts:6-42`); recording
preference paths (`recording.allowTakes/olderTakeAction/olderTakeScope/countInBars` — all
present; `countInBars` literal union 1-8 confirmed); monitoring-peaks lifecycle pattern
(recording CLAUDE.md:279-302 — React pattern, no SDK API to verify; consistent with
`AnimationFrame.add` from lib-dom); region-discovery idioms (CLAUDE.md:139-167 —
`AudioUnitTracks` uses `onAdd`/`onRemove`/`onReorder`, `TrackRegions` uses
`onAdded`/`onRemoved` — re-confirmed in adapters source; `getAllAudioRegions` util exists in
this repo). Deviations:
- `olderTakeScope` union is `["none", "all", "previous-only"]` (see Claim 3).
- `recording.inputLatency` preference (number, ≥ -1) and `CaptureAudioBox.inputLatency`
  field with `InputLatency.Inherit (-2)` / `InputLatency.EqualsOutput (-1)` sentinels exist —
  already used by RecordingTapeCard; recording CLAUDE.md does not document them.
- `recording.automationEnabled` preference exists (drives `RecordAutomation.start`) — not
  documented in recording CLAUDE.md (automation demos' territory, but it IS in the recording
  preference block).
- `EngineSettings.RecordingCountInBars` / `OlderTakeActionOptions` / `OlderTakeScopeOptions`
  are exported constants — demos hard-code literal unions instead (optional improvement).
- doc 16 extras verified: `softwareMIDIInput.releaseAllNotes()`, `set channel(byte)`
  (releases held notes on change), `MidiDevices.panic()` all exist.
  `@opendaw/studio-core@0.0.152:packages/studio/core/src/midi/SoftwareMIDIInput.ts:65,78-80`; `MidiDevices.ts:126`.

## Changelog sweep (entries newer than the demos; candidates, not mandates)

- **0.0.140→0.0.147:** recording timing fixes — worklet head-start recovery (~30 ms bias
  removed), no `quantizeFloor` snap of take position, deterministic WRAP-finalized take
  duration via `tempoMap.intervalToSeconds` (matches Claims 3/4 drift findings; the final,
  teardown-finalized take stays quantum-granular). Demos read `waveformOffset` directly, so
  no code change; CLAUDE.md duration-overshoot paragraph must be reworded per Claim 4.
- **0.0.147→0.0.150:** `olderTakeScope: "none"` added end-to-end. Candidate: surface "none"
  in loop-recording-demo's scope select (currently `"all" | "previous-only"` only). [Task 4 optional]
- **0.0.150→0.0.154:** `recording.inputLatency` engine preference + `CaptureAudioBox.inputLatency`
  per-track override + `InputLatency` sentinel namespace export. Already adopted by
  RecordingTapeCard/useEnginePreference. Candidate: document in recording CLAUDE.md (the
  capture-fields block lists only deviceId/gainDb/requestChannels). [Task 8]
- No newer peaks APIs or MIDI adapter conveniences found in the swept range relevant to
  these demos.

## Doc corrections (documentation/08-recording.md, 16-midi.md) — exercised claims only

| File:line | Wrong claim | Correction |
|---|---|---|
| 08-recording.md:188 | "`stop(true)` kills the audio graph immediately, which prevents `RecordingProcessor.process()` from writing remaining data" | Overstated: both stop paths trip the same main-thread teardown; the real hazards are the position reset (spurious loop-wrap muting) and `#reset()` racing async finalization. Keep the rule, fix the mechanism wording. (Claim 2) |
| 08-recording.md:193 | "Stop recording — keeps the engine alive for finalization" | At 0.0.152 `stopRecording()` also sets `transporting = false` (playback stops); finalization is still async on the main thread. Reword "keeps the engine alive" → "does not reset position/processors; finalization completes asynchronously". (Claim 2) |
| 08-recording.md:229-233 | Comments imply `setArm(capture, true)` = "arm exclusively", `setArm(capture, false)` = "arm non-exclusively" | `setArm` TOGGLES the armed state; `exclusive` only controls whether others are disarmed when the toggle lands on armed. Calling it on an armed capture disarms. Document the toggle + `capture.armed.setValue()` for deterministic set. (Claim 8) |
| 08-recording.md:391 | "Enable takes (defaults to true only in dev/localhost)" | Schema default is `allowTakes: true` unconditionally. (Claim 3) |
| 08-recording.md:399-401 | `olderTakeScope` shows only "previous-only"/"all" | Add `"none"` (skip older-take management). (Claim 3) |
| 16-midi.md:222 | `project.captureDevices.setArm(cap, true)` presented as "arm" | Same toggle correction as 08:229. (Claim 8) |
| 08-recording.md:450-454 | (verified OK) take-1 offset already includes `inputLatency` | No change — doc 08 is ahead of recording CLAUDE.md:237 here. |

Also exercised and verified OK: 08:212 `queryLoadingComplete` warning; 08:379
monitoringMode-not-a-box-field note; 08:363-377 monitoring modes + auto-arm note ("Enabling
monitoring automatically arms" — confirmed); 16:179-206 MidiDevices surface (incl.
`releaseAllNotes`, `panic`, `kb.channel`); 16:113-130 `createEvent` example; 16:219
`captureBox.channel` -1/0-15.

## Code-level issues (verified, Step 4)

1. **loop-recording finalization barrier handles only `"loaded"`** —
   loop-recording-demo.tsx:480-495 (`if (state.type === "loaded")` only). Violates recording
   CLAUDE.md:127-128. Nuance from Claim 9: during recording the loaders are
   `RecordingWorklet`s, which never emit `"error"` at 0.0.152 (a worklet failure produces NO
   terminal state), so the 10s timeout is the only true safety net — but `"error"` must
   still be counted (defensive + future SDK versions + DefaultSampleLoader cases). Fix:
   treat `"error"` as done + surface a UI warning. `[Task 4]`
2. **useRecordingSession error/timeout paths are console-only** —
   useRecordingSession.ts:111 (`console.error` on loader error), :136-141 (30s timeout
   `console.warn`, silently transitions to "ready"). UI shows "Processing…" then snaps to
   ready with no explanation. Needs an error message surface consumed by
   recording-api-react-demo (and exported state for loop demo reuse). Also stale comment
   at :83 "engine was still playing since stopRecording() doesn't stop playback" — wrong at
   0.0.152 (Claim 2 drift). `[Task 2]`
3. **Init error handling**: all three demos catch init errors but only
   `setStatus(\`Error: ...\`)` — plain status text, not the visible init-error card pattern
   from waves 2-4. recording-api-react-demo.tsx:439-442, loop-recording-demo.tsx:185-188,
   midi-recording-demo.tsx:469-472. `[Tasks 2/4/6]`
4. **loop-recording subscription leak on tape removal: NOT a leak in practice** —
   the adapter subscriptions (loop-recording-demo.tsx:343-391) live in a local `subs` array
   whose effect cleanup terminates them whenever `recordingTapes` changes, and tape removal
   is gated off during recording (`disabled={isRecording || isCountingIn}`,
   loop-recording-demo.tsx:696; Remove button uses `disabled`, RecordingTapeCard.tsx:246).
   `sampleLoadersRef` persistence across cleanup is intentional (barrier ownership,
   comment at :389-391). No fix required; optionally assert the gating in code review. `[Task 4]`
5. **midi-recording `let audioUnitBox: any = null`** — midi-recording-demo.tsx:439. Type as
   `AudioUnitBox | null` (import type from `@opendaw/studio-boxes`; same pattern as
   useRecordingTapes.ts:48). Also the comment above it (:437-438) repeats the WRONG
   auto-create-Tape claim (Claim 8) — reword while touching. `[Task 6]`
6. **RecordingTapeCard.setMonitorOutputDevice failure** — RecordingTapeCard.tsx:160-167:
   `.catch` → console.debug + revert select to "default". Classification: the select
   reverting IS user-visible feedback, AND the SDK itself raises a
   `RuntimeNotifier.info({headline: "Output Device Error"})` dialog on the same failure
   (CaptureAudio.ts:168-170) before the rejection reaches the demo. Verdict: current
   handling meets the no-silent-failures bar; a status line is optional polish, not
   required. `[Task 2]`
7. **mute-subscription callback typed `(obs: any)`** — loop-recording-demo.tsx:367. The
   field is `BooleanField`; its `subscribe` passes an `Observer<Observable>` — type as the
   field observable instead of `any` (mirror CLAUDE.md root example or use
   `regionBox.mute.subscribe(obs => ...)` with inferred typing — verify with LSP during fix). `[Task 4]`
8. **File sizes (800-line ceiling)** — loop-recording-demo.tsx 1062 lines (over),
   recording-api-react-demo.tsx 860 (over), midi-recording-demo.tsx 822 (over). Extraction
   seams confirmed: recording-api (peaks state + waveform canvas → hook/component),
   loop-recording (take discovery/grouping → hook), midi (PianoKeyboard +
   StepRecordingSection are already isolated inline components → own files). `[Tasks 3/5/7]`
9. **midi stop pattern** — midi-recording-demo.tsx:561-562 calls `stopRecording()` then
   `requestAnimationFrame(() => stop(true))`. For MIDI there are no sample loaders to
   finalize (notes are box events, `RecordMidi` has no worklet), so immediate `stop(true)`
   is safe; the rAF deferral is cargo-cult from the audio path. Simplify or comment
   accurately. `[Task 6]`
10. **Demo arm paths rely on toggle semantics** — useRecordingTapes.ts:81
    (`setArm(capture, false)` on fresh capture → arms) and RecordingTapeCard.tsx:170-178
    (disarm via `armed.setValue(false)`, arm via `setArm(capture, false)`); both work only
    because the pre-state is known. With Claim 8 (toggle), prefer `capture.armed.setValue(true/false)`
    for deterministic state, reserving `setArm` for exclusive-arm UX. midi demo:452
    `setArm(capture, true)` on fresh capture → arms exclusively (only one capture exists —
    OK today). `[Tasks 2/4/6]`
11. **Step-recording uses negative narrowing + casts** — midi-recording-demo.tsx:236-240
    `!region.isAudioRegion()` + `region.box as NoteRegionBox` + collection cast; rewrite per
    Claim 19 (`region.isNoteRegion()` + `region.optCollection`); manual `NoteEventBox.create`
    at :292-297 migrates to `collection.createEvent({...})` per Claim 14 — note createEvent
    requires ALL seven params (`cent: 0, chance: 100, playCount: 1` for defaults). `[Task 6]`

## Verification spike decision

**DECISION: Recording demos ARE browser-verifiable end-to-end via Playwright MCP.**
Verified live against `recording-api-react-demo.html` (dev server `npm run dev -- --port
5180 --host 127.0.0.1`, lands on next free port — check the vite banner; HTTPS required).

Key facts established:
1. The plain MCP tools cannot grant mic permission — `getUserMedia` hangs on the prompt
   forever (no rejection). The demo's "Request Microphone Permission" button appears to do
   nothing.
2. `browser_run_code_unsafe` CAN grant it:
   `await page.context().grantPermissions(["microphone"]); await page.reload();` —
   grant must happen BEFORE the page calls `getUserMedia` (a pending prompt never resolves
   retroactively, hence the reload). After that, `getUserMedia` resolves with the REAL
   default input ("Default - MacBook Pro Microphone (Built-in)"). There is no fake-media
   device (launch flags aren't controllable post-launch), so E2E asserts FLOW/STATE, not
   audio content (recorded audio is room noise/silence).
3. **Reusable E2E steps (validated, full pass):**
   1. `browser_run_code_unsafe`: `page.context().grantPermissions(["microphone"])` + `page.reload()`, wait ~2s for init
   2. Click "Request Microphone Permission" → device list + "Add Tape" appear
   3. Click "Add Tape" → "Tape 1" card with "Capture armed" badge (auto-armed)
   4. Click "⏺ Record" → body text shows "Recording" (after count-in)
   5. Wait ~6s, click "⏹ Stop" → Play button enabled within ~500 ms (finalization barrier passed)
   6. Click "▶ Play" → status "Playing"; Stop again to reset
   Assertions via `document.body.innerText.includes(...)` (JSX splits text nodes — no XPath text matching).
4. **MIDI page:** `grantPermissions(["midi"])` / `["midi", "midi-sysex"]` does NOT satisfy
   Chrome's Web MIDI gate — `navigator.requestMIDIAccess({sysex: false})` still rejects
   "Permission to use Web MIDI API was not granted". So `MidiDevices.requestPermission()`
   CANNOT be exercised in this browser → hardware-MIDI path goes on the PR's manual
   verification list. HOWEVER the software-keyboard + step-recording paths ARE verifiable
   headlessly: after the demo's "Request MIDI Access" button runs (permission denied
   internally, `Errors.warn` path), `MidiDevices.inputDevices()` still returns the
   always-present `softwareMIDIInput` ("Software Keyboard" appears in the device list) and
   the on-screen keyboard / step recording need no permission at all.
5. Tasks 2-7 verification scope: recording demos — full record→finalize→playback E2E per the
   steps above; MIDI demo — software keyboard, step recording, region/note creation E2E;
   hardware MIDI input listed for user manual verification in the PR.

## New mysteries

- `CaptureBox` schema carries a `record-mode` string field ("normal" | "replace" | "punch",
  default "normal") at studio-boxes@0.0.94 — punch/replace recording modes appear to be
  schema-ahead-of-implementation (no consumer found in a quick scan of RecordAudio at
  0.0.152). Not chased further (~time-box); candidate for a future changelog watch.
- `RecordingWorklet` has no `"error"` terminal state — `#finalize()` failures only
  `console.warn` (`.catch(error => console.warn(error))`, RecordingWorklet.ts:56-57) and the
  loader stays in `"record"` forever. Upstream issue candidate: recording finalization
  failures are silent at the SDK level; consumers can only timeout. (Feeds the Task 2/4
  timeout+error-surface work; could be reported upstream.)

## Wave-review follow-up candidates (from task-level quality reviews)

- **[Task 9 — integration round decision] getCanvasRef ref-callback churn (pre-existing, preserved by the Task-3 move):** `ref={getCanvasRef(index)}` creates a new closure identity every render, so React runs detach(null)→attach(el) per render — the null branch terminates the painter and rebuilds it (useTapePeaks.ts:67-74, call site recording-api-react-demo.tsx:586). Not per-frame (renders are event-driven), so works in practice; the fix is a stable per-index callback map. Cheap — apply in the wave-integration round if low-risk, else PR follow-up.
- **[Task 9 — PR follow-up] useTapePeaks cohesion:** the hook carries a ~77-line finalization-drift debug logger (useTapePeaks.ts:214-290) unrelated to peaks rendering; candidate extraction `useRecordingDriftLog` or rename. Naming judgment, not a defect.
