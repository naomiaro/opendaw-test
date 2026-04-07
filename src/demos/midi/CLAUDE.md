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

## Cross-References
- For recording preferences (takes, count-in), see `src/demos/recording/CLAUDE.md`
- For general recording flow (startRecording, stopRecording), see `src/demos/recording/CLAUDE.md`

## Reference Files
- MIDI recording demo: `src/demos/midi/midi-recording-demo.tsx`
