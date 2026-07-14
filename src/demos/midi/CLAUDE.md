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
region.moveContentStart(delta)           // shift content start position
region.resolveLoopDuration(ppqn)         // compute duration at position
region.copyTo({ target, position?, duration?, loopOffset?, loopDuration?, consolidate? })
region.consolidate()                     // bake loop into single region
region.iterateActiveNotesAt(position)    // IterableIterator<NoteEvent> at a PPQN
```
Read events via `region.optCollection.unwrap().events` (or guard with `hasCollection`).

### Programmatic Note Regions Need loopDuration (or they play silently)
A hand-built `NoteRegionBox` schedules events within `[loopOffset, loopOffset+loopDuration]`;
with the default `loopDuration:0` the engine plays ZERO notes (silent) even though the events,
collection, note track and output routing all look correct and `iterateActiveNotesAt` yields
nothing. Setting `box.duration` + the timeline `loopArea` is NOT enough. Set
`box.loopOffset.setValue(0)` + `box.loopDuration.setValue(contentLenPPQN)`, or use
`project.api.createNoteRegion(...)`, which defaults `loopDuration` to `duration` when omitted
(only raw `NoteRegionBox.create` leaves it at 0). Caveat (verified in studio-core
`ProjectApi.js`): `createNoteRegion` never writes `loopOffset` — the implementation writes
`loopDuration` twice — so a non-zero `loopOffset` param is silently ignored; set it on the box
afterwards if needed. `StepRecordingSection` omits loopDuration (its regions are
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
Access via `audioUnitBoxAdapter.midiEffects` (IndexedBoxAdapterCollection):
- **ArpeggioDeviceBoxAdapter** — arpeggiator patterns (up, down, random, etc.)
- **PitchDeviceBoxAdapter** — pitch transpose/shift
- **VelocityDeviceBoxAdapter** — velocity curve mapping
- **SpielwerkDeviceBoxAdapter** — scriptable MIDI effect (JavaScript)
- **ZeitgeistDeviceBoxAdapter** — step sequencer/pattern generator

Insert via: `project.api.insertEffect(audioUnitBox.midiEffects, EffectFactories.Arpeggio)`

### Instrument Adapters
Available instrument adapters (each implements `InstrumentDeviceBoxAdapter`):
- `VaporisateurDeviceBoxAdapter` — built-in synth (no external files)
- `SoundfontDeviceBoxAdapter` — SF2 soundfont player
- `TapeDeviceBoxAdapter` — audio sample playback (default for audio recording)
- `NanoDeviceBoxAdapter` — lightweight sampler
- `PlayfieldDeviceBoxAdapter` — drum pad sampler with `Gate` triggers
- `ApparatDeviceBoxAdapter` — scriptable instrument (JavaScript DSP)
- `MIDIOutputDeviceBoxAdapter` — routes to external MIDI hardware

### Diagnosing "keyboard plays but no sound"
`capture.captureNoteOnCount` (observable) increments when an armed capture receives a note-on outside recording — read it before/after a key press to prove MIDI reached the capture without any audio tap. If it increments but output RMS is 0, the fault is engine-side rendering, not MIDI routing.

## Cross-References
- For recording preferences (takes, count-in), see `src/demos/recording/CLAUDE.md`
- For general recording flow (startRecording, stopRecording), see `src/demos/recording/CLAUDE.md`

## Reference Files
- MIDI recording demo: `src/demos/midi/midi-recording-demo.tsx`
- On-screen keyboard: `src/demos/midi/PianoKeyboard.tsx`
- Step recording (createEvent path): `src/demos/midi/StepRecordingSection.tsx`
