# MIDI Demo — OpenDAW SDK Reference

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
There is no `region.events` getter — go through `optCollection` (or guard with
`hasCollection`) and read `collection.events` for the event list.

### NoteEventCollectionBoxAdapter (Event Container)
Container for MIDI note events within a region:
```typescript
const collection = region.optCollection.unwrap(); // or: if (!region.hasCollection) return
collection.events         // EventCollection<NoteEventBoxAdapter>

collection.createEvent({
  position: 0 as ppqn,    // region-local position (NOT absolute)
  duration: 480 as ppqn,  // note duration (480 = quarter note at 960 PPQN)
  pitch: 60,              // MIDI note number (60 = middle C)
  cent: 0,                // microtuning offset in cents (required field)
  velocity: 0.8,          // float, 0-1 (NOT 0-127 — see normalizedPitch helpers below)
  chance: 100,            // playback probability (0-100, %); 100 = always
  playCount: 1,           // note-repeat count; 1 = single hit
});
collection.copy()                              // copy all events into a new collection
collection.overlapping(from, to, pitch)        // events touching a PPQN range at a pitch
collection.selectableAt({ x: ppqn, y: pitch }) // events at a (position, pitch) coordinate
```
There is no `deleteEvent()` or `valueAt()` — remove events by unstaging the underlying
box (`adapter.box`), and query position-bound events via `overlapping()` or
`iterateActiveNotesAt()` on the region.

### NoteEventBoxAdapter (Individual Note)
Each MIDI note event:
- `.position` — PPQN position (region-local)
- `.duration` — note length (PPQN)
- `.pitch` — MIDI note number (`int`, 0-127)
- `.cent` — microtuning offset in cents
- `.velocity` — note velocity (`float`, 0-1)
- `.chance` — playback probability (0-100)
- `.playCount` — note-repeat count
- `.playCurve` — repeat-velocity curve
- `.collection` — `Option<NoteEventCollectionBoxAdapter>` (back-reference)
- `.isSelected` — selection state
- `.type` — event type discriminator (`"note-event"`)
- `.copyTo({ position?, duration?, pitch?, playCount?, events? })` — copy with overrides
- `.normalizedPitch()` — `pitch / 127` as a `unitValue` (for UI lanes)
- `.computeCurveValue(ratio)` — velocity at a playCurve ratio
- `.canConsolidate()` / `.consolidate()` — fold repeat events into separate adapters

There is no `.moveToPosition()` or `.delete()` — move by setting `box.position.setValue()`
inside `editing.modify()`; delete by unstaging the box (`boxGraph.unstageBox(adapter.box)`).

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

## Cross-References
- For recording preferences (takes, count-in), see `src/demos/recording/CLAUDE.md`
- For general recording flow (startRecording, stopRecording), see `src/demos/recording/CLAUDE.md`

## Reference Files
- MIDI recording demo: `src/demos/midi/midi-recording-demo.tsx`
