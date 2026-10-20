# MIDI Demo — OpenDAW SDK Reference

### MIDI Devices & Recording
```typescript
import { MidiDevices } from "@opendaw/studio-core";
import { NoteSignal } from "@opendaw/studio-adapters";  // NoteSignalOn, NoteSignalOff

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
// armed.setValue() is the deterministic arm/disarm; setArm() TOGGLES
// (second param = exclusivity only) — see src/demos/recording/CLAUDE.md.
const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
capture.armed.setValue(true);

// MIDI capture channel filter: set on CaptureMidiBox
captureMidiBox.channel.setValue(-1); // -1=all, 0-15=specific channel
```

### MIDI Recording Requires a Synth Instrument
`startRecording()` records only ARMED captures — with zero armed captures the engine
enters recording state but records nothing and creates no instrument. Tape can't play
MIDI notes. For MIDI recording, pre-create a synth instrument and arm its capture:
```typescript
// editing.modify() doesn't forward return values — capture via outer variable
let audioUnitBox: AudioUnitBox | null = null;
project.editing.modify(() => {
  // Vaporisateur = built-in synth, no files needed
  audioUnitBox = project.api.createInstrument(InstrumentFactories.Vaporisateur).audioUnitBox;
});
// Then arm its capture (armed is runtime-only — no transaction).
// Cast defeats TS closure-narrowing to never:
if (audioUnitBox) {
  project.captureDevices
    .get((audioUnitBox as AudioUnitBox).address.uuid)
    .unwrap().armed.setValue(true);
}
```
Available MIDI instruments: `Vaporisateur` (synth), `Soundfont` (sf2 player), `Nano` (sampler), `Playfield` (drums), `Apparat` (scriptable DSP).

### NoteRegionBoxAdapter (MIDI Region)
After recording or creating MIDI regions, access via the adapter layer:
```typescript
import { NoteRegionBoxAdapter, NoteEventCollectionBoxAdapter } from "@opendaw/studio-adapters";

// Properties
region.offset         // content offset (PPQN)
region.loopOffset     // loop start offset (PPQN)
region.loopDuration   // loop duration (PPQN)
region.hasCollection  // boolean — true if an event collection is attached
region.optCollection  // Option<NoteEventCollectionBoxAdapter> — guarded access

// Methods
region.moveContentStart(delta)           // shift content start position (consolidates a mirrored
                                         // region first; each event moves once; delta 0 is a no-op)
region.resolveLoopDuration(ppqn)         // compute duration at position
region.copyTo({ target, position?, duration?, loopOffset?, loopDuration?, consolidate? })
region.consolidate()                     // bake loop into single region
region.resetLoopOffset(truncateNotesAtRegionEnd) // loop starts at the region start, same playback;
                                         // pass engine.preferences.settings.playback.truncateNotesAtRegionEnd
region.flatten(regions, truncateNotesAtRegionEnd?) // Option<NoteRegionBox>; None unless EVERY region
                                         // is a selected note region on one track (headless code must
                                         // project.selection.select() them first). KEEPS the region it
                                         // is called on when it is among `regions` (else the first of
                                         // them), deletes every other region of the track in the range
region.iterateActiveNotesAt(position)    // IterableIterator<NoteEvent> at a PPQN
```
Read events via `region.optCollection.unwrap().events` (or guard with `hasCollection`).
`NoteEventBoxAdapter.copyTo` copies every field (`playCurve` is typed `bipolar`, −1…+1), so a
copied or duplicated note keeps fine tune, chance, play count and curve.

### Programmatic Note Regions Need loopDuration (or they play silently)
A hand-built `NoteRegionBox` schedules events within `[loopOffset, loopOffset+loopDuration]`;
with the default `loopDuration:0` the engine plays ZERO notes (silent) even though the events,
collection, note track and output routing all look correct and `iterateActiveNotesAt` yields
nothing. Setting `box.duration` + the timeline `loopArea` is NOT enough. Set
`box.loopOffset.setValue(0)` + `box.loopDuration.setValue(contentLenPPQN)`, or use
`project.api.createNoteRegion(...)`, which defaults `loopDuration` to `duration` and
`loopOffset` to 0 when omitted and writes both (only raw `NoteRegionBox.create` leaves
`loopDuration` at 0). `StepRecordingSection` omits loopDuration (its regions are
recording-driven), so don't copy it as a playing-region template.

### NoteEventCollectionBoxAdapter (Event Container)
Container for MIDI note events within a region:
```typescript
const collection = region.optCollection.unwrap(); // or: if (!region.hasCollection) return
collection.events         // EventCollection<NoteEventBoxAdapter>

// All seven params are REQUIRED; call inside editing.modify() (createEvent
// does not open a transaction itself). Returns NoteEventBoxAdapter.
collection.createEvent({
  position: 0 as ppqn,    // region-local
  duration: 960 as ppqn,  // quarter note (PPQN.Quarter = 960)
  pitch: 60,              // MIDI note number (60 = middle C)
  cent: 0,                // microtuning offset, -50..+50 cents
  velocity: 0.8,          // float, 0-1
  chance: 100,            // playback probability (0-100)
  playCount: 1,           // note-repeat count
});
collection.copy()                              // copy all events into a new collection
collection.overlapping(from, to, pitch)        // events touching a PPQN range at a pitch
collection.selectableAt({ u: ppqn, v: pitch }) // events at a (position, pitch) coordinate — Coordinates<U, V> is { u, v }
```
`createEvent` is the prescribed creation path — manual `NoteEventBox.create` +
`box.events.refer(collection.events)` mirrors the SDK internals but adds a box-class
import and pointer wiring for no gain. Remove events via `adapter.box.delete()`
(cascade-deletes mandatory dependents), not bare `unstageBox`. Query position-bound
events via `collection.overlapping()` or `region.iterateActiveNotesAt(position)`.

### NoteEventBoxAdapter (Individual Note)
Each MIDI note event:
- `.position` — PPQN position (region-local)
- `.duration` — note length (PPQN)
- `.pitch` — MIDI note number (`int`, 0-127)
- `.cent` — microtuning offset (-50..+50 cents)
- `.velocity` — note velocity (`float`, 0-1)
- `.chance` — playback probability (`int`, 0-100)
- `.playCount` — note-repeat count (`int`, 1-128)
- `.playCurve` — repeat-velocity curve
- `.collection` — `Option<NoteEventCollectionBoxAdapter>` (back-reference)
- `.isSelected` — selection state
- `.type` — event type discriminator (`"note-event"`)
- `.copyTo({ position?, duration?, pitch?, playCount?, events? })` — copy with overrides
- `.normalizedPitch()` — `pitch / 127` as a `unitValue` (for UI lanes)
- `.computeCurveValue(ratio)` — velocity at a playCurve ratio
- `.canConsolidate()` / `.consolidate()` — fold repeat events into separate adapters

Move via `box.position.setValue()` in `editing.modify()`. Delete via
`adapter.box.delete()` — `NoteEventBox` accepts a mandatory `NoteEventRepeatBox`
dependent, which bare `unstageBox` would orphan.

### MIDI Effect Adapters (Pre-Instrument Processing)
MIDI effects sit between capture and instrument in the signal chain.
Access via `audioUnitBoxAdapter.midiEffects` — an
`Option<IndexedBoxAdapterCollection>` (unwrap first; `None` means the host has no
midi chain, e.g. an effect-composite branch):
- **ArpeggioDeviceBoxAdapter** — arpeggiator patterns (up, down, random, etc.)
- **PitchDeviceBoxAdapter** — pitch transpose/shift
- **VelocityDeviceBoxAdapter** — velocity curve mapping
- **SpielwerkDeviceBoxAdapter** — scriptable MIDI effect (JavaScript)
- **ZeitgeistDeviceBoxAdapter** — step sequencer/pattern generator

Insert via the adapter layer: `project.api.insertEffect(midiEffectsFieldOf(project,
audioUnitBox), EffectFactories.Arpeggio)` (`midiEffectsFieldOf` from
`src/lib/adapterUtils.ts` unwraps `AudioUnitBoxAdapter.midiEffectsField`)

### Instrument Adapters
Available instrument adapters (each implements `InstrumentDeviceBoxAdapter`):
- `VaporisateurDeviceBoxAdapter` — built-in synth (no external files)
- `SoundfontDeviceBoxAdapter` — SF2 soundfont player
- `TapeDeviceBoxAdapter` — audio sample playback (default for audio recording)
- `NanoDeviceBoxAdapter` — polyphonic sampler (region, crossfade loop, root key); see `src/demos/instruments/CLAUDE.md`
- `TubularDeviceBoxAdapter` — six-operator FM synth, DX7 compatible (`InstrumentFactories.Tubular`;
  a voice is a 155-byte `Uint8Array` loaded with `TubularPreset.apply(box, voice)`;
  `Dx7Sysex.decode(bytes)` parses a cartridge into `{name, data}` voices — pass `data`; the
  device always runs the msfa "Modern" operator kernel — the box's `engine` field is deprecated
  and ignored)
- `InstrumentCompositeBoxAdapter` — layered instruments (`InstrumentFactories.InstrumentComposite`);
  each layer is an `InstrumentCompositeCellBoxAdapter` with its own instrument, MIDI and audio
  chains and a gain / pan / mute / solo strip. Layers are managed through `project.api`
  (`createCompositeLayer`, `setLayerInstrument`, `moveCompositeLayer`, `duplicateCompositeLayer`,
  `deleteCompositeLayer`, `wrapInstrumentIntoComposite`)
- `PlayfieldDeviceBoxAdapter` — drum pad sampler with `Gate` triggers
- `WclapInstrumentBoxAdapter` — a CLAP plugin compiled to WebAssembly (`InstrumentFactories.Wclap`;
  the factory writes label, icon and host only — a headless consumer sets `box.url` (the
  `.wclap.tar.gz` bundle) and `box.clapId` itself, through `adapter.urlField` /
  `adapter.clapIdField`; the worklet reports the plugin's parameter list and state, and
  `EngineWorklet` writes them on the main thread — `WclapParameters.reconcile` creates one
  `WclapParameterBox` per automatable parameter, `WclapStates.store` fills `box.state` —
  exposed through `adapter.parameters`)
- `ApparatDeviceBoxAdapter` — scriptable instrument (JavaScript DSP)
- `MIDIOutputDeviceBoxAdapter` — routes to external MIDI hardware

### Diagnosing "keyboard plays but no sound"
`capture.captureNoteOnCount` (observable) increments when an armed capture receives a note-on outside recording — read it before/after a key press to prove MIDI reached the capture without any audio tap. If it increments but output RMS is 0, the fault is engine-side rendering, not MIDI routing.

### Where a Recorded Note Lands
`RecordMidi` places a key at its MIDI event's `timeStamp` (carried on `NoteSignalOn` /
`NoteSignalOff`; a stamp in the future counts as now), extrapolating the engine position
between two playhead updates at the engine's live BPM — never across an enabled loop end
while takes are allowed, where the engine wraps — plus the output-latency term (converted to
pulses once at arm time, at that moment's BPM), and writes the note's duration at key-up — so
a late handler (GC, main-thread jank) does not delay a note and a tap shorter than one
playhead update keeps its real length. An audition signal, or a hand-built `noteSignal`
without a stamp, is placed at `performance.now()`.

### Loop Switch on the MIDI Recording Demo
`useTimelineLoop(project, { from: 0, to: 4 bars, enabled: false })`. Off: a recording is one
take however long it runs. On: `RecordMidi` finalizes the take at every wrap, starts a new
one at the loop start and applies the older-take preference to the pass before it (defaults
`olderTakeAction: "mute-region"`, `olderTakeScope: "previous-only"`), so after Stop only the
last pass is unmuted. A recording made earlier stays in the project and plays along.

### MIDI Input Alignment Audit (unlisted)
`midi-input-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>[&repeats=<n>][&bus=<substring>][&audible=1]`
measures where `RecordMidi` places a note against the HEARD beat. The loopback is the macOS
IAC Driver bus: the page sends a pattern on the IAC output with future Web MIDI timestamps
(two bars of eighths, one bar of 1/32 notes, each held half its step, 48 distinct pitches),
the SDK's capture, pinned to the IAC input by `CaptureMidiBox.deviceId` (a `StringField`;
a connected keyboard stays out), records it, and the page reads the note regions off the
box graph. The page refuses to run without an input/output pair named `*IAC*` (`?bus=`
picks another). Register: `debug/2026-10-20-midi-input-alignment/note.md`.

- **Reference frame.** `engine.recordingStart` is `ObservableOption<{contextTime, position}>`:
  the first recording quantum's END on the context clock and the position at that instant.
  `AudioContext.getOutputTimestamp()` maps a performance stamp to the HEARD context time.
  A note's expected position is the heard position at its Web MIDI receipt stamp; nothing is
  netted out. The SDK's own term (`audioContext.outputLatency + engine.compensationLatency`,
  what the recorder ADDS to a write position) rides on every row as `sdkLatencyTermMs`.
- **Reading a row.** Median = the constant term; max dev and p5–p95 = jitter;
  missing / no receipt / extra / stuck / velocity = integrity (any of them fails the cell);
  `collapsed` = a release written at less than half its sent length (a band may allow it);
  `durationErrorMaxMs` = the release side without the collapsed ones; `heardLagMs` = the
  output lag the clock pair implies, the figure the latency attribution rests on; count-in
  notes = recorded / sent, reported only. `aligned` needs every figure inside the
  tolerances in `midiInputCalibration.ts` (derived from a render quantum, not fitted);
  `matches-known-defect` needs every repeat inside one band of `MIDI_KNOWN_DEFECTS`, which
  is computed from the row's own output latency, frame interval and sample rate (median
  within ±5 ms of `2 × (output + compensation latency) − (frame − quantum)`, jitter and
  duration within a frame plus a quantum), so it holds on any device or display and a
  median that does not track the formula is a finding; else `investigate` names the first
  failing figure. The on-page copy says it: expect `investigate` or a band, not
  `aligned`, until the recorder changes.
- **Scenarios.** `nominal-start`, `janked-start` (the audio harness's 150 ms block on the
  `isRecording` flip), `janked-mid` (the same block fired from a timer task in the middle of
  the pattern's bar two, between frames), `countin-start` (one-bar count-in; three unanchored
  notes inside it are reported, not judged: two short ones the SDK drops, one held across
  the downbeat the SDK writes at position 0), `midtimeline-start` (record from bar
  three), `loop-wrap` (two-bar loop, takes allowed; the notes span two passes and the stop
  lead opens a third take; the note ON the loop end is
  `wrapAdjacent` and reported, not judged — the SDK writes a key pressed between the loop end
  and the wrap update into the old take).
- **What the recorder does, as measured.** `RecordMidi` writes the extrapolated RENDERED
  position plus the output latency, from a per-frame position read that is a frame old
  (single-slot handoff refilled after each read), so every note lands about
  `2 × outputLatency − (frame − quantum)` past the heard beat, the same at every tempo;
  `RecordAudio` adds the same latencies plus the input latency to the buffer head it skips,
  which by its arithmetic lands at the heard beat, so the two recorders should disagree by
  about twice the output latency (inferred; the combined MIDI + audio cell is the measurement). A key whose stamp
  precedes the last frame read is clamped to that read (up to a frame early, releases too).
  The first frame after a main-thread block reads a position as old as the block, so a key
  released inside the block or within the frame after it is written far too short, down to
  the minimum length. A key pressed and released inside the count-in is dropped; one still
  held at the downbeat is written at position 0 with its post-downbeat part, where the audio
  recorder keeps the whole pickup in the file behind the region's waveform offset.
- **On an IAC bus `loopbackDelayMs` is 0.000:** Chrome stamps the message with its scheduled
  CoreMIDI time, so the receipt stamp IS the schedule.
- Edits under `src/` reload the page and lose a run; edit `debug/*.md` instead while one runs.
  Keep the Chrome window uncovered for the whole run: a partly covered window stalled the
  animation frames in one sweep (two repeats hung on frame-driven waits) while
  `document.visibilityState` stayed `visible`; a row's `frameGapMaxMs` is the figure to check
  before reading a hang as an SDK finding.

### Combined MIDI + Audio Audit (unlisted)
`midi-audio-combined-audit-debug-demo.html?scenario=<nominal-start|countin-start|janked-mid|all>&bpm=<n>[&repeats=<n>][&state=<default|calibrated|both>][&bus=][&input=][&output=][&audible=1]`
sends each note of the MIDI sweep's pattern on the IAC bus AND plays a 6 kHz click out of the
speakers at the same heard instant (an `OscillatorNode` at the render context time of the
note's position, straight to the destination), records the keys through the Vaporisateur's
MIDI capture and the clicks through a Tape pinned to the microphone, and reports
`partsApartMs` = where the key landed − where the sound landed. Register:
`debug/2026-10-20-midi-audio-combined/note.md`.

- **Calibration per run.** Before the first repeat a worklet fed from `CaptureAudio.outputNode`
  (the node the take is recorded from, `Option<AudioNode>`, present once the chain is armed)
  emits three clicks and records its input; the round trip is a difference of its own
  process-call frame counter, never a `currentTime` / `currentFrame` read (Chromium
  442866743). The output latency is read AFTER the clicks have played (Chrome's figure before
  output starts is not the running one). The built-in path reads 87–89 ms round trip here
  (62–65 on other days); every row carries the run's value.
- **Two states** on `CaptureAudioBox.inputLatency` (a `Float32Field` in seconds; `-2` inherits
  the preference, `-1` means equal to the output latency): `0`, or the run's input part.
  The engine preference `recording.inputLatency` is NEVER written (localStorage, shared by
  every page on the origin); the page refuses to run if it is not 0.
- **Metronome off** in every scenario: the engine mixes it after the master, so a −96 dB
  master leaves it in the microphone's take. The count-in forces it on, so `countin-start`
  sets `settings.metronome.gain = -Infinity` and the MIDI runner restores both the flag and
  the gain it found (preferences persist).
- **Matching** anchors on the eighth bars (half a 1/32 step is 62 ms; an uncalibrated audio
  side reads 64 ms late), then matches the 1/32 bar with that offset subtracted and reports
  every error raw; a lost click stays lost.
- **What it measured:** uncalibrated, the key lands 31 ms BEFORE the sound (the audio late by
  exactly the input part); calibrated, the sound is on the heard beat to 0.00 ms and the key
  33 ms late. The audio recorder is right; the jitter (7–10 ms) is all the MIDI recorder's.
- `together` is the player's wish (within a quantum); on this release every cell reads the
  band computed from the row's own figures.

## Cross-References
- For recording preferences (takes, count-in), see `src/demos/recording/CLAUDE.md`
- For general recording flow (startRecording, stopRecording), see `src/demos/recording/CLAUDE.md`

## Reference Files
- MIDI recording demo: `src/demos/midi/midi-recording-demo.tsx`
- On-screen keyboard: `src/demos/midi/PianoKeyboard.tsx`
- Step recording (createEvent path): `src/demos/midi/StepRecordingSection.tsx`
