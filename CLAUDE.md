# OpenDAW Headless Development Guide

## Project Overview
This project demonstrates headless usage of the OpenDAW SDK for browser-based audio recording and playback.

## Key OpenDAW APIs

### Recording
```typescript
// Start recording (handles everything: Tape instrument, track arming, microphone, regions, peaks)
project.startRecording(useCountIn: boolean);

// CRITICAL: Use stopRecording() to stop recording, NOT stop(true).
// stop(true) kills the audio graph, preventing RecordingProcessor from
// writing remaining data to the RingBuffer. It also resets position to 0,
// which triggers spurious loop-wrap detection in loop recording (muting
// the last take). Call stop(true) only AFTER finalization completes.
project.engine.stopRecording();
// Wait for finalization via sampleLoader.subscribe, then reset engine:
const sub = sampleLoader.subscribe((state: any) => {
  if (state.type === "loaded") {
    sub.terminate();
    project.engine.stop(true);
  }
});

// Stop everything and reset position to 0
project.engine.stop(true);

// Stop without resetting position
project.engine.stop(false);
```

### Audio Input & Capture
```typescript
import { AudioDevices, CaptureAudio } from "@opendaw/studio-core";
import type { MonitoringMode } from "@opendaw/studio-core";

// Request mic permission and enumerate devices
await AudioDevices.requestPermission();
await AudioDevices.updateInputList();
const inputs = AudioDevices.inputs; // ReadonlyArray<MediaDeviceInfo>

// Access capture device for an armed track
const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
if (capture instanceof CaptureAudio) {
  // deviceId, requestChannels, gainDb are box graph fields — require transaction
  project.editing.modify(() => {
    capture.captureBox.deviceId.setValue(deviceId);
    capture.requestChannels = 1;        // 1 = mono, 2 = stereo
    capture.captureBox.gainDb.setValue(0); // dB
  });
  // monitoringMode manipulates Web Audio nodes — set outside transaction
  capture.monitoringMode = "direct";  // "off" | "direct" | "effects"
}

// Track arming
project.captureDevices.setArm(capture, true); // exclusive=true disarms others
const armed = project.captureDevices.filterArmed();

// Multi-device recording: arm multiple captures non-exclusively
project.captureDevices.setArm(capture1, false); // false = keep others armed
project.captureDevices.setArm(capture2, false);
// startRecording() uses filterArmed() internally — records ALL armed captures in parallel
```

### MIDI Devices & Recording
```typescript
import { MidiDevices } from "@opendaw/studio-core";
import { NoteSignal } from "@opendaw/studio-adapters";  // NoteSignalOn, NoteSignalOff
import { NoteEventBox, NoteEventCollectionBox, NoteRegionBox } from "@opendaw/studio-boxes";

await MidiDevices.requestPermission();
const devices = MidiDevices.inputDevices(); // includes Software Keyboard

// Software keyboard for on-screen note input
MidiDevices.softwareMIDIInput.sendNoteOn(60, 0.8); // note, velocity (0-1)
MidiDevices.softwareMIDIInput.sendNoteOff(60);

// Subscribe to MIDI events
const sub = MidiDevices.subscribeMessageEvents(event => { ... }, channel?);

// IMPORTANT: CaptureMidi must be explicitly armed for MIDI to produce sound.
// Unlike CaptureAudio (which auto-arms when monitoringMode is set), CaptureMidi
// has no implicit arming. Without arming, softwareMIDIInput notes never reach
// the synth (no live monitoring) and Recording.start() skips the capture (no recording).
const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
project.captureDevices.setArm(capture, true);

// MIDI capture channel filter: set on CaptureMidiBox
captureMidiBox.channel.setValue(-1); // -1=all, 0-15=specific channel
```

### Recording Preferences (Takes)
```typescript
const settings = project.engine.preferences.settings;
settings.recording.allowTakes = true;        // enable loop-based takes (default: true since SDK 0.0.109)
settings.recording.olderTakeAction = "mute-region"; // or "disable-track"
settings.recording.olderTakeScope = "previous-only"; // or "all"
settings.recording.countInBars = 1;          // 1-8
```

**How takes work:** Takes are driven by the timeline loop area (`timelineBox.loopArea`).
When `allowTakes` is true AND `loopArea.enabled` is true, each time playback wraps past
`loopArea.to` back to `loopArea.from`, the current take is finalized and a new take begins.

- Recording can start **before** the loop region. Take 1 records from the start position
  through the first loop wrap. Subsequent takes are scoped to the loop region
  (`loopFrom` → `loopTo`).
- With `loopArea.enabled = false`, `allowTakes` has no effect — recording produces a
  single continuous region regardless of the setting.
- Loop-wrap detection uses `currentPosition < lastPosition` (position jumped backward),
  then calls `startNewTake(loopFrom)` to begin the next take at the loop start.

### Reactive Box Graph Subscriptions (pointerHub)
```typescript
// Prefer pointerHub subscriptions over AnimationFrame polling for structural changes.
// Use AnimationFrame ONLY for continuous rendering (e.g., waveform peaks at 60fps).

// Reactive subscription chain: audioUnit → tracks → regions → field changes
const subs: Terminable[] = [];
const trackSub = audioUnitBox.tracks.pointerHub.catchupAndSubscribe({
  onAdded: (pointer) => {
    const trackBox = pointer.box;
    const regionSub = (trackBox as any).regions.pointerHub.catchupAndSubscribe({
      onAdded: (regionPointer: any) => {
        const regionBox = regionPointer.box as AudioRegionBox;
        // Subscribe to scalar field changes (e.g., mute)
        const muteSub = regionBox.mute.subscribe((obs: any) => {
          const isMuted = obs.getValue();
        });
        subs.push(muteSub);
      },
      onRemoved: () => {},
    });
    subs.push(regionSub);
  },
  onRemoved: () => {},
});
subs.push(trackSub);
// Cleanup: terminate all subs (outer first to prevent cascading callbacks)
```

**Key rules:**
- `catchupAndSubscribe` fires immediately for existing data + future changes (preferred)
- `subscribe` fires only for future changes (use when initial state already known)
- `pointerHub.incoming()` is a snapshot read, NOT reactive
- Pointer callbacks receive `PointerField` — access box via `pointer.box`
- Terminate pointer hub subs BEFORE engine cleanup when stopping recording
- After recording stops, reactive subscriptions are terminated — update React state directly for user-initiated changes (e.g., mute toggle)

### Waveform Rendering (SDK 0.0.126+)
`PeaksPainter.renderBlocks()` was replaced by `PeaksPainter.renderPixelStrips()` with a new signature:
```typescript
PeaksPainter.renderPixelStrips(context, peaks, channel, {
  x0, x1,       // pixel x range on canvas
  y0, y1,       // pixel y range on canvas
  u0, u1,       // frame range in peaks data
  v0: -1, v1: 1 // amplitude range (always -1 to 1)
});
```
**IMPORTANT:** `renderPixelStrips` uses the current `ctx.fillStyle` — set it before calling.
It does NOT accept color parameters. Without setting fillStyle, waveforms are invisible.

### SoundfontService (Disabled via Proxy Guard)
- `SoundfontService` constructor auto-fetches `api.opendaw.studio/soundfonts/list.json` (CORS error in dev)
- SDK declares `soundfontService` in `ProjectEnv` but never reads it (verified in 0.0.129)
- We pass a Proxy that throws a clear error if a future SDK version accesses it
- None of the demos use soundfont instruments (MIDI demo uses Vaporisateur built-in synth)

### SampleService (SDK 0.0.124+)
- `new SampleService(audioContext)` required in `ProjectEnv` for recording finalization
- `CaptureAudio.prepareRecording()` injects it into `RecordingWorklet` automatically

### capture.armed Is Not a Box Graph Field
- `capture.armed` is a `MutableObservableValue<boolean>`, not a box graph field
- Set directly: `capture.armed.setValue(false)` — do NOT wrap in `editing.modify()`
- Same as `monitoringMode` — runtime observable, not persisted in the box graph

### Playback
```typescript
// Set playback position (in PPQN - pulses per quarter note)
project.engine.setPosition(0);

// Start playback
project.engine.play();

// Wait for all audio samples to be loaded before playing
// NOTE: loadTracksFromFiles() calls this automatically before returning,
// so you only need this for recordings or manually created tracks
await project.engine.queryLoadingComplete();
// NOTE: queryLoadingComplete() resolves before SamplePeaks worker finishes
// (~120ms gap). To get peaks, use sampleLoader.subscribe() and wait for
// state.type === "loaded". Direct sampleLoader.peaks read immediately after
// loadTracksFromFiles returns will be empty.
```

### Engine State Observables
```typescript
// Subscribe to engine state changes
project.engine.isRecording.catchupAndSubscribe(obs => {
  const recording = obs.getValue();
});

project.engine.isPlaying.catchupAndSubscribe(obs => {
  const playing = obs.getValue();
});

project.engine.isCountingIn.catchupAndSubscribe(obs => {
  const countingIn = obs.getValue();
});

project.engine.countInBeatsRemaining.catchupAndSubscribe(obs => {
  const beats = Math.ceil(obs.getValue());
});
```

### Engine Preferences (SDK 0.0.87+)
```typescript
// Access via project.engine.preferences.settings
const settings = project.engine.preferences.settings;

// Metronome
settings.metronome.enabled = true;
settings.metronome.gain = -6; // dB
settings.metronome.beatSubDivision = 1; // 1=quarter, 2=eighth, 4=16th, 8=32nd

// Recording
settings.recording.countInBars = 1; // 1-8 bars
```

### Finding Recording Regions
```typescript
// Recording regions are labeled "Take N" (SDK 0.0.91+) or "Recording" (older)
const boxes = project.boxGraph.boxes();
const recordingRegion = boxes.find((box: any) => {
  const label = box.label?.getValue?.();
  return label === "Recording" || (label && label.startsWith("Take "));
});

// Get duration for setting up playback
const duration = recordingRegion.duration.getValue();
```

### Accessing Live Peaks During Recording
```typescript
// 1. Find the recording region
const recordingRegion = boxes.find(box => /* ... */);

// 2. Get the AudioFileBox from the region's file pointer
const fileVertexOption = recordingRegion.file.targetVertex;
const audioFileBox = fileVertexOption.unwrap();

// 3. Get SampleLoader via sampleManager
const uuid = audioFileBox.address.uuid;
const sampleLoader = project.sampleManager.getOrCreate(uuid);

// 4. Access peaks (Option type - check isEmpty())
const peaksOption = sampleLoader.peaks;
if (!peaksOption.isEmpty()) {
  const peaks = peaksOption.unwrap();

  // Check if live recording (PeaksWriter) or final (Peaks)
  const isPeaksWriter = "dataIndex" in peaks;

  if (isPeaksWriter) {
    // Live recording - render based on dataIndex
    const unitsToRender = peaks.dataIndex[0] * peaks.unitsEachPeak();
  } else {
    // Final peaks - render all
    const unitsToRender = peaks.numFrames;
  }
}
```

### Time Signature Events
```typescript
// Access signature track
const signatureTrack = project.timelineBoxAdapter.signatureTrack;

// Create event at PPQN position
signatureTrack.createEvent(position, nominator, denominator);

// Iterate all events (index -1 is storage signature)
const events = Array.from(signatureTrack.iterateAll());

// Delete event
signatureTrack.adapterAt(event.index).ifSome(a => a.box.delete());

// PPQN per bar: PPQN.fromSignature(nom, denom) = Math.floor(3840/denom) * nom
```

### Tempo Automation Events
```typescript
// Access tempo track events
project.timelineBoxAdapter.tempoTrackEvents.ifSome(collection => {
  // Clear existing
  collection.events.asArray().forEach(event => event.box.delete());
  // Create event
  collection.createEvent({ position, index: 0, value: bpm, interpolation });
});
// Interpolation: Interpolation.Linear, Interpolation.None from @opendaw/lib-dsp
```

### Track Automation (Volume, Pan, Effects)
```typescript
// Create automation track targeting a parameter field
let trackBox: TrackBox;
project.editing.modify(() => {
  trackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume);
});

// Create a region and add events
project.editing.modify(() => {
  const regionOpt = project.api.createTrackRegion(trackBox, position, duration);
  const regionBox = regionOpt.unwrap() as ValueRegionBox;
  const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
  const collection = adapter.optCollection.unwrap();
  collection.createEvent({ position: 0 as ppqn, index: 0, value: 0.5, interpolation: Interpolation.Linear });
});
```

**Automation event positions are REGION-LOCAL, not absolute.**
`ValueRegionBoxAdapter.valueAt()` calls `LoopableRegion.globalToLocal(region, ppqn)` =
`mod(ppqn - region.position + region.loopOffset, region.loopDuration)` before looking up events.
Events at absolute positions will fall outside the region duration and never trigger.

### Curve Rendering Must Use SDK's Curve.normalizedAt
Canvas rendering of automation curves must use `Curve.normalizedAt(t, slope)` from `@opendaw/lib-std`,
not quadratic bezier approximations. The SDK uses an exponential formula:
`(p²)/(1-2p) * (((1-p)/p)^(2x) - 1)` (Möbius-Ease) — visually different from bezier.
Slope semantics: 0.75 = steep start, flat end (logarithmic feel); 0.25 = flat start, steep end.
For a round swell: use Curve(0.75) rising, Curve(0.25) falling.

### EffectBox Is a Union Type
`project.api.insertEffect()` returns `EffectBox` which is a union of device box types
(`ReverbDeviceBox | CompressorDeviceBox | WerkstattDeviceBox | SpielwerkDeviceBox | ...`), not a wrapper. Cast directly:
`const reverbBox = effectBox as ReverbDeviceBox;`
Automatable fields: `reverbBox.wet`, `reverbBox.dry`, etc.

### WavFile Moved to lib-dsp (SDK 0.0.129+)
`WavFile` was removed from `@opendaw/studio-core` and moved to `@opendaw/lib-dsp`.
```typescript
// Before (0.0.128)
import { WavFile } from "@opendaw/studio-core";
// After (0.0.129)
import { WavFile } from "@opendaw/lib-dsp";
```
Now supports 24-bit PCM WAV decoding in addition to 16-bit PCM and 32-bit float.

### Scriptable Devices (SDK 0.0.129+)
Three new scriptable device types powered by `ScriptCompiler`:
- **Apparat** — scriptable instrument (`InstrumentFactories.Apparat`), accepts MIDI, runs JS DSP
- **Werkstatt** — scriptable audio effect (`EffectFactories.Werkstatt`), runs JS audio DSP
- **Spielwerk** — scriptable MIDI effect (`EffectFactories.Spielwerk`), processes MIDI via JS
All use `// @param` and `// @sample` comment declarations in code for parameters/samples.
Box types: `ApparatDeviceBox`, `WerkstattDeviceBox`, `SpielwerkDeviceBox`.
SDK 0.0.132 adds `// @label <name>` (auto-sets device label) and `// @group <name> [color]` (groups params visually).
`ScriptParamDeclaration` was renamed to `ScriptDeclaration` in 0.0.132.

### Scriptable Device Code: Must Use ScriptCompiler.compile()
**CRITICAL:** `deviceBox.code.setValue(script)` does NOT execute the script. You must use
`ScriptCompiler.compile()` which wraps the code, registers it via `audioWorklet.addModule()`,
and writes back a header (`// @werkstatt js 1 <update-number>`) that the processor detects.
Without compilation, the processor sees `update === 0` and stays silent.
```typescript
import { ScriptCompiler } from "@opendaw/studio-adapters";

const compiler = ScriptCompiler.create({
  headerTag: "werkstatt",       // or "apparat" or "spielwerk"
  registryName: "werkstattProcessors",  // or "apparatProcessors" or "spielwerkProcessors"
  functionName: "werkstatt",    // or "apparat" or "spielwerk"
});

// Insert the effect first (in editing.modify), then compile OUTSIDE the transaction:
let werkstattBox: WerkstattDeviceBox;
project.editing.modify(() => {
  const effectBox = project.api.insertEffect(audioBox.audioEffects, EffectFactories.Werkstatt);
  werkstattBox = effectBox as WerkstattDeviceBox;
  werkstattBox.label.setValue("My Effect");
});
await compiler.compile(audioContext, project.editing, werkstattBox, userCode);
// Parameters are now available via werkstattBox.parameters.pointerHub.incoming()
```
`compiler.stripHeader(code)` removes the `// @werkstatt ...` header to recover user code.
`compiler.load(audioContext, deviceBox)` reloads already-compiled code (e.g., on page load).

### Werkstatt Parameter Access
Parameters are created by `ScriptCompiler.compile()`. Access via:
`werkstattBox.parameters.pointerHub.incoming()` → `pointer.box` as `WerkstattParameterBox`
Fields: `.label` (StringField), `.value` (Float32Field, automatable), `.defaultValue` (Float32Field).

### Werkstatt Generator Scripts Must Check Transport
Scripts that generate audio (ignoring `src`) must check `block.flags & 4` (playing flag)
and return early when stopped, otherwise they produce continuous output after Stop is pressed:
```javascript
process({src, out}, block) {
  const [, ] = src
  const [outL, outR] = out
  if (!(block.flags & 4)) {
    // Must zero output — the SDK does NOT clear buffers between blocks
    for (let i = block.s0; i < block.s1; i++) { outL[i] = 0; outR[i] = 0 }
    return
  }
  // ... generate audio
}
```

### Parsing Werkstatt Script Declarations (SDK 0.0.132+)
Use `ScriptDeclaration.parseGroups(code)` from `@opendaw/studio-adapters` to get structured
param metadata (min, max, mapping, unit, defaultValue) grouped by `// @group` directives.
Prefer this over manual `// @param` string parsing. Returns `DeclarationSection[]` with
`group: { label, color } | null` and `items: DeclarationItem[]`.

### Effect Display Name Changes (SDK 0.0.129+)
- `EffectFactories.Reverb` display name changed from "Cheap Reverb" to "Free Reverb" (API name unchanged)
- `EffectFactories.NeuralAmp` display name changed to "Tone3000" (`IconSymbol.Tone3000`)
- `EffectFactories.AudioNamed` now alphabetically ordered; `includeNeuralAmp` flag removed

### Timeline and Loop Area
```typescript
project.editing.modify(() => {
  project.timelineBox.loopArea.from.setValue(0);
  project.timelineBox.loopArea.to.setValue(duration);
  project.timelineBox.loopArea.enabled.setValue(false);
});

// BPM and time signature
project.timelineBox.bpm.setValue(120);
project.timelineBox.signature.nominator.setValue(4);
project.timelineBox.signature.denominator.setValue(4);
```

### Clip Fades
```typescript
// Fades are relative to region start, NOT the timeline.
// fillGainBuffer computes: startPpqn = cycle.resultStart - regionPosition
// If the region spans full audio but playback is mid-file, fades at the
// edges are never reached (early-return keeps gain at 1.0).
//
// To make fades audible, trim regions to short clips:
project.editing.modify(() => {
  adapter.box.position.setValue(clipStartPPQN);      // where on timeline
  adapter.box.duration.setValue(clipDurationPPQN);    // clip length
  adapter.box.loopOffset.setValue(clipStartPPQN);     // where to read in audio
  // loopDuration can stay at full audio length
});

// Fades can be set in the same transaction as region changes
project.editing.modify(() => {
  // Region trimming + fades together
  adapter.box.position.setValue(clipStartPPQN);
  adapter.box.duration.setValue(clipDurationPPQN);
  adapter.box.loopOffset.setValue(clipStartPPQN);

  adapter.fading.inField.setValue(fadeInPPQN);
  adapter.fading.outField.setValue(fadeOutPPQN);
  adapter.fading.inSlopeField.setValue(slope);  // 0.25=log, 0.5=linear, 0.75=exp
  adapter.fading.outSlopeField.setValue(slope);
});
```

### AudioContext Suspension
Browser autoplay policy means `AudioContext` starts suspended until a user gesture.
`initializeOpenDAW()` registers click/keydown listeners to auto-resume it (one-shot).
iOS Safari can re-suspend after backgrounding/locking. Before calling `play()`:
```typescript
if (audioContext.state !== "running") {
  await audioContext.resume();
  // iOS Safari may not be "running" yet — wait for statechange event
}
```

## Important Patterns

### Option Types Are Always Truthy
OpenDAW uses Option types that are **always truthy** (even `Option.None`):
```typescript
// WRONG - Option.None is truthy, this never triggers
if (!sampleLoader.peaks) { ... }

// CORRECT
const peaksOption = sampleLoader.peaks;
if (peaksOption.isEmpty()) { return; }
const peaks = peaksOption.unwrap();
```
API: `.isEmpty()`, `.nonEmpty()`, `.unwrap()`, `.unwrapOrNull()`, `.unwrapOrUndefined()`

### Always Use editing.modify() for State Changes
```typescript
project.editing.modify(() => {
  // All box graph modifications go here
  project.timelineBox.bpm.setValue(120);
});
```

### SignatureTrack: One editing.modify() Per Event
`SignatureTrackAdapter.createEvent()` calls `iterateAll()` internally. Inside a single
`editing.modify()` transaction, adapter collection notifications are deferred, so subsequent
calls see stale state. Use separate `editing.modify()` per `createEvent` and per deletion.

### Pointer Re-Routing: Separate Transaction from Creation
`createInstrument()` internally routes `audioUnitBox.output` to master. Re-routing with
`output.refer(newTarget)` in the same `editing.modify()` may not disconnect the old
connection, causing dual routing. Always re-route in a separate transaction. Similarly,
`targetVertex` traversal on pointers created in the same transaction may return stale data.
This also applies to `captureDevices.get(uuid)` — resolve captures and set their fields
(deviceId, requestChannels) in a **separate** transaction after `createInstrument` commits.

### Fades Can Share a Transaction with Region Changes
Fading values (in, out, slopes) can be set in the same `editing.modify()` as
region property changes (position, duration, loopOffset). No separate transaction needed.

### createInstrument Must Be Destructured Inside editing.modify()
`project.api.createInstrument()` returns `{ audioUnitBox, trackBox }` directly — no `.unwrap()`.
But `editing.modify()` does NOT forward return values, so capture via outer variable:
```typescript
let audioUnitBox: any = null;
project.editing.modify(() => {
  const result = project.api.createInstrument(InstrumentFactories.Tape);
  audioUnitBox = result.audioUnitBox;
});
// audioUnitBox is now available outside the transaction
```

### monitoringMode Not in Type Declarations
`capture.monitoringMode` exists at runtime but isn't in `.d.ts` files.
Use `(capture as any).monitoringMode = "direct"` when TypeScript complains.

### UUID.Bytes Is Not a String
`audioUnitBox.address.uuid` is `UUID.Bytes`, not `string`. Use `UUID.toString(uuid)` for
React keys, Map keys, or any string context. Import: `import { UUID } from "@opendaw/lib-std"`.

### Capture Settings Require editing.modify()
`captureBox.deviceId`, `captureBox.gainDb`, and `capture.requestChannels` are box graph fields —
wrap in `editing.modify()`. `capture.monitoringMode` is NOT a box graph field (it manipulates
Web Audio nodes), so set it outside the transaction.

### MIDI Recording Requires a Synth Instrument
`startRecording()` auto-creates a Tape (audio-only) when no instruments exist. Tape can't play
MIDI notes. For MIDI recording, pre-create a synth instrument before recording:
```typescript
project.editing.modify(() => {
  project.api.createInstrument(InstrumentFactories.Vaporisateur); // built-in synth, no files needed
});
// startRecording() will find and arm this instrument's CaptureMidiBox
```
Available MIDI instruments: `Vaporisateur` (synth), `Soundfont` (sf2 player), `Nano` (sampler), `Playfield` (drums), `Apparat` (scriptable DSP).

### Region Sorting When Positions Match
When regions share the same position, sort by label for deterministic ordering:
`regionAdapters.sort((a, b) => labelIndex(a) - labelIndex(b))`
Set custom labels with `adapter.box.label.setValue("name")`.

### waveformOffset vs loopOffset
- `loopOffset` (PPQN) — controls which loop cycle aligns with which timeline position on playback. Does NOT shift audio read position in the file.
- `waveformOffset` (seconds, field 7 on AudioRegionBox) — shifts where TapeDeviceProcessor reads in the audio buffer: `sampleIndex = (elapsedSeconds + waveformOffset) * sampleRate`
- To skip silence at the start of an audio file, set `waveformOffset` in seconds. `loopOffset` alone won't change what audio you hear.
- For waveform rendering, use `loopOffset` to compute the peaks frame range (visual), and `waveformOffset` for the engine read position (audio).

### Recording Peaks Include Count-In Frames
The SDK captures audio during count-in. `waveformOffset` on the region (in seconds)
tells playback to skip it. When rendering peaks, use `waveformOffset * sampleRate`
as the `u0` parameter to `PeaksPainter.renderPixelStrips()` to skip count-in frames.

For **loop recording takes**, all takes share one `AudioFileBox` (continuous buffer).
Each take's `waveformOffset` = count-in + sum of prior take durations. Render each take
with `u0 = waveformOffset * sampleRate`, `u1 = u0 + duration * sampleRate`.

### Take Waveform Rendering: Shared Buffer Gotcha
All takes share ONE PeaksWriter during recording. `dataIndex[0] * unitsEachPeak()`
returns total accumulated frames across ALL takes — NOT per-take. Using it as `u1`
causes finalized takes to render audio from subsequent takes.
**Always use `u0 + durationFrames` for per-take waveform bounds.** The SDK updates
`regionBox.duration` every frame via `RecordAudio.ts`, so even the live take grows
smoothly. Only fall back to `dataIndex` when `durationFrames === 0`.

### Take-to-Track Matching (Multi-Track Loop Recording)
SDK creates take regions on new TrackBoxes under the same AudioUnitBox. Match via:
`regionBox.regions.targetVertex` → `TrackBox` → `trackBox.tracks.targetVertex` → `AudioUnitBox`
Then `UUID.toString(audioUnitBox.address.uuid)` matches `RecordingInputTrack.id`.

### Loop Take Buffer Layout and Offsets
All takes record into a single continuous audio buffer. The count-in offset is only
explicitly set for take 1; subsequent takes inherit it transitively through accumulation:
```
Buffer: [count-in frames | Take 1 audio | Take 2 audio | Take 3 audio ...]

Take 1: waveformOffset = preRecordingSeconds (count-in duration)
Take 2: waveformOffset = take1.waveformOffset + take1.duration
Take 3: waveformOffset = take2.waveformOffset + take2.duration
```
The count-in frames sit at the start of the buffer and are never referenced after take 1
skips past them. Each take's `waveformOffset` is set once at creation time in
`RecordAudio.ts` and never modified afterward.

**Duration overshoot (~2-3ms):** Loop-wrap detection (`currentPosition < lastPosition`)
fires at audio block boundaries (~128 frames), so each take's `duration` includes a few
extra frames past the exact loop boundary. The next take's `waveformOffset` compensates
(starts after those frames), so audio reads stay aligned. This causes a minor visual
artifact where each take's waveform shows ~2-3ms of extra audio at the tail.

**20ms voice crossfade at loop boundaries:** At loop wrap, the engine sets
`BlockFlag.discontinuous`, which fades out old voices over `VOICE_FADE_DURATION = 0.020s`
(20ms) and fades in new voices over the same duration. During this window, both the
outgoing and incoming take audio overlap briefly. This is SDK-level behavior to prevent
clicks — not a bug.

**Playback audio read formula** (TapeDeviceProcessor.ts):
`sampleIndex = ((elapsedSeconds + waveformOffset) * sampleRate) | 0`
where `elapsedSeconds = tempoMap.intervalToSeconds(cycle.rawStart, cycle.resultStart)`

### Dark Ride Audio
- BPM: 124 (pass to `initializeOpenDAW({ bpm: 124 })`)
- Stems: `public/audio/DarkRide/01_Intro` through `07_EffectReturns` (.opus + .m4a)
- Full song length (~235 seconds, ~117 bars at 124 BPM)
- All stems have silence at the beginning (intro/buildup)
- Guitar: audible content from bar 17+
- Drums: full drum pattern from bar 25+ (sparse/building before that)
- To skip silence: set `regionBox.waveformOffset.setValue(seconds)` to shift the audio read position
- For waveform rendering: compute peaks frame range from the PPQN offset into the audio

### localAudioBuffers Must Be Passed to initializeOpenDAW
The sample manager's fetch callback checks `localAudioBuffers` map at init time.
Create the map BEFORE calling `initializeOpenDAW`, pass it in, then pass the same
map to `loadTracksFromFiles`. Without this, the sample manager falls back to
OpenSampleAPI (CORS error in dev).
```typescript
const localAudioBuffers = new Map<string, AudioBuffer>();
const { project, audioContext } = await initializeOpenDAW({ localAudioBuffers, bpm: 124 });
const tracks = await loadTracksFromFiles(project, audioContext, files, localAudioBuffers);
```

### Safari Audio Format Compatibility
Safari can't decode Ogg Opus via `decodeAudioData` (even though `canPlayType` returns
`"maybe"`). Provide m4a (AAC) fallback. Detect Safari via UA string, not feature detection.
See `src/lib/audioUtils.ts` `getAudioExtension()`.

### Proper Recording to Playback Flow
1. Call `project.startRecording(useCountIn)`
2. During recording, discover `sampleLoader` via `sampleManager.getOrCreate(audioFileBox.address.uuid)`
3. Call `engine.stopRecording()` (NOT `stop(true)`) to stop recording
4. Subscribe to `sampleLoader.subscribe()` — wait for `state.type === "loaded"`
5. Call `engine.stop(true)` to reset, then `engine.play()`
**Multi-device**: When recording multiple tracks, subscribe to ALL sampleLoaders and only call
`stop(true)` after all have emitted `"loaded"` (counting barrier pattern). Add a safety
timeout (~10s) to force-finalize if any loader fails to emit.
**Note**: `queryLoadingComplete()` resolves before `sampleLoader.data` is set — do NOT use it to detect recording data availability.

### Offline Audio Rendering (Export)
`OfflineEngineRenderer.create()` panics with `numStems === 0` — it only supports stem export,
not mixdown. Both `OfflineEngineRenderer` and `AudioOfflineRenderer` (deprecated) reject `Option.None`.
`OfflineEngineRenderer` also throws "Already connected" when passed a live project (due to
`liveStreamReceiver` conflict).

**Working approach for all offline rendering:**
```typescript
const projectCopy = project.copy();
projectCopy.boxGraph.beginTransaction();
projectCopy.timelineBox.loopArea.enabled.setValue(false);
projectCopy.boxGraph.endTransaction();

const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
const worklets = await AudioWorklets.createFor(context);
const engineWorklet = worklets.createEngine({
  project: projectCopy,
  exportConfiguration, // undefined = mixdown (metronome included), config = stems (no metronome)
});
engineWorklet.connect(context.destination);

// Engine preferences don't travel with project.copy() — set on worklet directly
engineWorklet.preferences.settings.metronome.enabled = true;
engineWorklet.preferences.settings.metronome.gain = -6; // dB, max 0

engineWorklet.setPosition(startPpqn);
await engineWorklet.isReady();
engineWorklet.play();
while (!(await engineWorklet.queryLoadingComplete())) { await Wait.timeSpan(TimeSpan.millis(100)); }
const audioBuffer = await context.startRendering();
projectCopy.terminate();
```

- Mixdown path (no `exportConfiguration`) = `EngineProcessor` branch `stemExports.length === 0` = metronome included
- Stem path (`exportConfiguration` provided) = per-track channels, metronome excluded
- `project.copy()` shares the same `sampleManager` (samples stay loaded) but NOT engine preferences
- Metronome gain: `z.number().min(-Infinity).max(0)` — default `-6` dB, max `0` dB (no boost, unlike track volume which goes to +6)

### Stop Button Behavior
- `stopRecording()` - Stops recording but keeps engine alive for finalization
- `stop(true)` - Resets position to 0, clears all voices, resets processors (like DAW stop button)
- `stop(false)` - Pauses without resetting position
- **NEVER call `stop(true)` while recording** — kills the audio graph and prevents finalization

### Effects Parameter Architecture
Effects use a 3-layer chain: Box (raw storage) → Adapter (UI mapping) → Processor (DSP).
`box.field.setValue()` stores raw values that the processor reads directly via `getValue()`.
`ValueMapping` in adapters only affects UI display/automation — NOT audio processing.

**Gotchas discovered during SDK 0.0.115 audit:**
- Delay has its own 21-entry `Fractions` array (Off→1/1) — different from Tidal's 17-entry `RateFractions` (1/1→1/128)
- Crusher processor inverts crush: `setCrush(1.0 - value)` — higher box value = MORE crushing
- DattorroReverb `preDelay` is in milliseconds (0-1000), standard Reverb is in seconds (0.001-0.5)
- DattorroReverb `dry` uses `DefaultDecibel` mapping (-60 to 6 dB), not -60 to 0
- StereoTool `stereo` (width) is bipolar (-1..1), not unipolar — 0 = normal, not center of 0-2 range
- `DefaultDecibel` mapping: `decibel(-72, -12, 0)` — unitValue 0.0 = -inf, 0.5 = -12 dB, 1.0 = 0 dB
- AudioUnit `VolumeMapper`: `decibel(-96, -9, +6)` — different range, unitValue 0.0 = -inf, 1.0 = +6 dB
- Automation values (unitValue 0-1) go through ValueMapping before reaching the processor:
  `AutomatableParameterFieldAdapter.valueAt()` calls `valueMapping.y(unitValue)` to convert to dB/raw
- Convert dB ↔ unitValue: `AudioUnitBoxAdapter.VolumeMapper.x(0)` → unitValue for 0 dB (~0.734);
  `.y(0.5)` → -9 dB. Import `AudioUnitBoxAdapter` from `@opendaw/studio-adapters`.
  For effects: `ValueMapping.DefaultDecibel` from `@opendaw/lib-std`.
- To verify parameter ranges, audit all 3 layers: schema (Box), adapter (ValueMapping), and processor (how value is consumed)

## React Integration Tips

### Monitoring Peaks Across Recording Lifecycle
Use state (not refs) to track monitoring status, since refs don't trigger effect re-runs:
```typescript
const [shouldMonitorPeaks, setShouldMonitorPeaks] = useState(false);

// Start monitoring when recording starts
useEffect(() => {
  if (isRecording && !shouldMonitorPeaks) {
    setShouldMonitorPeaks(true);
  }
}, [isRecording, shouldMonitorPeaks]);

// Effect runs while shouldMonitorPeaks is true
useEffect(() => {
  if (!project || !shouldMonitorPeaks) return;

  const animationFrame = AnimationFrame.add(() => {
    // Monitor peaks here...
    // When final peaks received, call setShouldMonitorPeaks(false)
  });

  return () => animationFrame.terminate();
}, [project, shouldMonitorPeaks]);
```

### Using AnimationFrame from OpenDAW
```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

const terminable = AnimationFrame.add(() => {
  // Called every frame
});

// Cleanup
terminable.terminate();
```

### Always Terminate Observable Subscriptions
`catchupAndSubscribe()` and `subscribe()` return `Terminable` objects. Store them and call
`.terminate()` in the React `useEffect` cleanup. Discarding the return value leaks the
subscription — callbacks continue firing after unmount.
For one-shot subscriptions (e.g., waiting for `sampleLoader` "loaded"), terminate
inside the callback on success AND on error — don't rely solely on effect cleanup:
```typescript
const sub = sampleLoader.subscribe((state: any) => {
  if (state.type === "loaded") {
    // ... handle data
    sub.terminate(); // terminate immediately, don't wait for unmount
  }
});
```

### CanvasPainter in React: Use Refs to Avoid Per-Frame Recreation
`CanvasPainter` creates a `ResizeObserver` + `AnimationFrame` subscription — expensive to
teardown/recreate. If a `useEffect` depends on an object prop (e.g., `region`) that gets
recreated each frame, the painter is destroyed and rebuilt every frame (150ms+ per frame → crash).
**Fix:** Store frequently-changing props in refs, read them inside the painter's render callback,
and limit `useEffect` deps to stable values like `height` or `sampleRate`. For live data
(e.g., recording duration), read directly from the box graph: `regionBox.duration.getValue()`.

### AnimationFrame Scanning: Use Structural Fingerprints
When scanning box graph state every frame (e.g., `scanAndGroupTakes`), avoid calling
`setState()` unless structure actually changed. Build a fingerprint string from stable
identifiers (take numbers, mute states, track IDs) and compare to previous. Duration
growth doesn't need re-renders when painters read live values from the box graph via refs.
Also limit AnimationFrame scanning to active recording — idle scanning is redundant when
direct calls handle mute toggles, finalization, and clear.

### Mixer Groups (Sub-Mixing)
```typescript
import { AudioBusFactory } from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";

// Create a group bus (routes to master by default)
project.editing.modify(() => {
  const audioBusBox = AudioBusFactory.create(
    project.skeleton,          // provides boxGraph + mandatory boxes
    "Rhythm",                  // group name
    IconSymbol.AudioBus,       // icon
    AudioUnitType.Bus,         // type
    Colors.blue                // color
  );
});

// IMPORTANT: Resolve pointers AFTER the creation transaction commits
const groupUnitBox = audioBusBox.output.targetVertex.unwrap().box;

// IMPORTANT: Re-route tracks in a SEPARATE transaction from createInstrument().
// Doing output.refer() in the same transaction as createInstrument() causes
// dual routing (audio reaches master both directly AND through the group).
project.editing.modify(() => {
  audioUnitBox.output.refer(audioBusBox.input);
});
```

### Demo Layout Structure
GitHubCorner, BackLink, content, and MoisesLogo all go *inside* `<Container>`, not as siblings.
See `src/looping-demo.tsx` for the reference layout pattern.

## Build & Verification
- `npm run build` — Vite handles TypeScript transpilation (no standalone `tsc` available)
- After SDK upgrades, clear Vite dep cache: `rm -rf node_modules/.vite` (dev server pre-bundles old SDK)
- Verify SDK exports: check `node_modules/@opendaw/<package>/dist/*.d.ts` before writing imports
- SDK version lives in `node_modules/@opendaw/studio-sdk/package.json`, NOT in individual sub-packages (studio-core, studio-boxes, etc.) which have their own independent version numbers

### Adding a New Demo
1. Create `<name>-demo.html` (copy existing HTML entry point, update meta tags and script src)
2. Create `src/<name>-demo.tsx` (use Radix UI Theme, GitHubCorner, BackLink, MoisesLogo, API Reference Callout)
3. Add build entry in `vite.config.ts` → `rollupOptions.input`
4. Add card in `src/index.tsx`

## Reference Files
- Recording demo: `src/recording-api-react-demo.tsx` (audio input, mono/stereo, gain, monitoring)
- Recording track card: `src/components/RecordingTrackCard.tsx` (per-track capture controls)
- MIDI recording demo: `src/midi-recording-demo.tsx` (MIDI devices, keyboard, step recording)
- Loop recording demo: `src/loop-recording-demo.tsx` (takes, loop recording preferences)
- Project setup: `src/lib/projectSetup.ts`
- Track loading: `src/lib/trackLoading.ts` (handles queryLoadingComplete automatically)
- Engine preferences hook: `src/hooks/useEnginePreference.ts`
- Track automation demo: `src/track-automation-demo.tsx` (volume, pan, effect parameter automation with canvas + JSON)
- Track automation: `documentation/19-track-automation.md` (automation lanes, region-local events, Möbius-Ease curves)
- Tempo automation demo: `src/tempo-automation-demo.tsx`
- Time signature demo: `src/time-signature-demo.tsx`
- Clip looping demo: `src/clip-looping-demo.tsx` (region loopDuration/loopOffset/duration tiling)
- Clip fades demo: `src/clip-fades-demo.tsx`
- Mixer groups demo: `src/mixer-groups-demo.tsx`
- Group track loading: `src/lib/groupTrackLoading.ts` (creates group buses + routes tracks)
- Audio utilities: `src/lib/audioUtils.ts` (format detection, file loading)
- Effects demo: `src/effects-demo.tsx` (multi-track mixer with dynamic effects)
- Effect hook: `src/hooks/useDynamicEffect.ts` (effect configs, parameter ranges, defaults)
- Effect presets: `src/lib/effectPresets.ts` (preset values for all effect types)
- Take timeline: `src/components/TakeTimeline.tsx` (bar ruler, take lanes, waveform canvases)
- Werkstatt demo: `src/werkstatt-demo.tsx` (scriptable effects showcase + API reference)
- Export demo: `src/export-demo.tsx` (range-bounded export with metronome, stems, stem+metronome)
- Range export utility: `src/lib/rangeExport.ts` (OfflineAudioContext-based rendering for all export modes)
- Werkstatt DSP scripts: `src/lib/werkstattScripts.ts` (effect scripts, generator scripts, API examples)
- Effects research docs: `documentation/effects-research/` (parameter tables, code examples, architecture)
- Box subscription lifecycle: `documentation/18-box-subscriptions-lifecycle.md` (pointerHub API, reactive patterns, cleanup)
- SDK 0.0.119→0.0.128 changelog: `documentation/sdk-0.0.119-to-0.0.128-changes.md`
- SDK 0.0.128→0.0.129 changelog: `documentation/sdk-0.0.128-to-0.0.129-changes.md`
- SDK 0.0.129→0.0.132 changelog: `documentation/sdk-0.0.129-to-0.0.132-changes.md`
- OpenDAW source code locations: see `.claude/local.md`
