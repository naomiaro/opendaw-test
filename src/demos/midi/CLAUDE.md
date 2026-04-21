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
region.events       // NoteEventCollectionBoxAdapter (note event container)
region.offset       // content offset (PPQN)
region.loopOffset   // loop start offset (PPQN)
region.loopDuration // loop duration (PPQN)

// Methods
region.moveContentStart(delta)    // shift content start position
region.resolveLoopDuration(ppqn)  // compute duration at position
region.copyTo({ target })         // copy to another track
region.consolidate()              // bake loop into single region
```

### NoteEventCollectionBoxAdapter (Event Container)
Container for MIDI note events within a region:
```typescript
const collection = region.events;

collection.events         // EventCollection of NoteEventBoxAdapter
collection.createEvent({
  position: 0 as ppqn,   // region-local position (NOT absolute)
  duration: 480 as ppqn, // note duration (480 = quarter note at 960 PPQN)
  pitch: 60,             // MIDI note number (60 = middle C)
  velocity: 100,         // 0-127
  index: 0,              // ordering index
});
collection.deleteEvent(adapter)  // remove a note
collection.copy()                // copy all events
collection.valueAt(ppqn)        // query events at position
```

### NoteEventBoxAdapter (Individual Note)
Each MIDI note event:
- `.position` — PPQN position (region-local)
- `.duration` — note length (PPQN)
- `.pitch` — MIDI note number (0-127)
- `.velocity` — note velocity (0-127)
- `.index` — ordering index
- `.isSelected` — selection state
- `.type` — event type discriminator
- `.copyTo(target)` — copy note to another collection
- `.moveToPosition(ppqn)` — move note to new position
- `.delete()` — remove note

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
