# MIDI Deep Dive

> **Skip if:** your app doesn't deal with MIDI input, MIDI editing, or virtual instruments. Audio-only DAWs can ignore this chapter.
>
> **Prerequisites:** [Ch. 04 (Box System)](./04-box-system-and-reactivity.md), [Ch. 08 (Recording)](./08-recording.md) for capture, [Ch. 11 (Effects)](./11-effects.md) for the MIDI-effect API surface.

MIDI surfaces in openDAW are split across several layers: the box-graph data model (notes are boxes), the live engine (hardware capture and instrument routing), and the studio adapters (typed accessors). This chapter consolidates them into one reference, plus walks through the patterns for programmatic note creation, hardware capture, and the five built-in MIDI effects.

**Honest about gaps:** the SDK is strong on programmatic note creation and hardware *input*, with a working MIDI-effects pipeline. MIDI *output* to external gear and standalone MIDI Clock configuration exist in the codebase but don't have a documented consumer API yet — flagged inline where they come up.

## The data model

Three boxes carry every MIDI note in an openDAW project.

### `NoteRegionBox`

A region on a track that contains MIDI notes. Symmetric to `AudioRegionBox` but holds notes instead of an audio file.

| Field | Type | Meaning |
|---|---|---|
| `regions` | `PointerField<RegionCollection>` | Parent track's `regions` field |
| `events` | `PointerField<NoteEventCollection>` | The note collection it plays |
| `position` | `Int32Field` | Timeline position in PPQN |
| `duration` | `Int32Field` | Length in PPQN |
| `loopOffset` / `loopDuration` | `Int32Field` | Looping bounds (PPQN) |
| `eventOffset` | `Int32Field` | Where in the collection playback starts |
| `mute` | `BooleanField` | |
| `label`, `hue` | `StringField`, `Int32Field` | UI labelling |

A `NoteRegionBox` doesn't own its notes — it *points* at a `NoteEventCollectionBox`. That indirection means two regions can share the same notes (loop a phrase across multiple bars, link two takes), and copy-on-write is explicit.

### `NoteEventCollectionBox`

The container for notes. Two pointer fields, no scalar data of its own:

| Field | Type | Meaning |
|---|---|---|
| `events` | `Field<NoteEvents>` | Points at the individual `NoteEventBox`es |
| `owners` | `Field<NoteEventCollection>` | Points at the `NoteRegionBox`es using this collection |

The `events` field is the "downward" side — individual notes register themselves here. The `owners` field is the "upward" side — when a region wants to use this collection, it refers `box.events.refer(collection.owners)`.

### `NoteEventBox`

The actual MIDI note. Fields:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `events` | `PointerField<NoteEvents>` | — | Back-reference to the collection |
| `position` | `Int32Field` | 0 | Position within the region, in PPQN |
| `duration` | `Int32Field` | 240 | Length in PPQN (240 = one 16th note) |
| `pitch` | `Int32Field` | 60 | MIDI pitch (0–127, 60 = C4) |
| `velocity` | `Float32Field` | ≈0.787 | 0.0–1.0 |
| `playCount` | `Int32Field` | 1 | Repeat the note 1–128 times across `duration` |
| `playCurve` | `Float32Field` | 0 | −1.0 to 1.0 — curve applied to velocity across repeats |
| `cent` | `Float32Field` | 0 | Fine-tune in cents (±50) |
| `chance` | `Int32Field` | 100 | Probability the note plays at all (0–100%) |

Note positions are **region-local** (PPQN from the region's `position`, not from the timeline origin). A note at `position: 0` plays when the region itself starts. The `playCount` + `playCurve` combo is how openDAW expresses things like "ratcheted hi-hat" without inflating the note list — one note plays `playCount` times within its `duration`, with velocity walked along `playCurve`.

## Creating notes programmatically

The transaction pattern for placing a region with notes on it. Inside one `editing.modify()`:

```typescript
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import {
  NoteEventBox,
  NoteEventCollectionBox,
  NoteRegionBox,
} from "@opendaw/studio-boxes";

const { Quarter } = PPQN;

project.editing.modify(() => {
  // 1. Create the collection that will hold the notes.
  const collection = NoteEventCollectionBox.create(
    project.boxGraph,
    UUID.generate(),
  );

  // 2. Create the region that plays this collection.
  NoteRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
    box.regions.refer(trackBox.regions);
    box.events.refer(collection.owners);
    box.position.setValue(0);          // beat 1
    box.duration.setValue(Quarter * 4); // one bar in 4/4
    box.label.setValue("Bassline");
  });

  // 3. Add notes — each `events.refer(collection.events)` registers it.
  for (let beat = 0; beat < 4; beat++) {
    NoteEventBox.create(project.boxGraph, UUID.generate(), (box) => {
      box.events.refer(collection.events);
      box.position.setValue(beat * Quarter); // 0, 960, 1920, 2880
      box.duration.setValue(Quarter / 2);     // eighth note
      box.pitch.setValue(48 + beat);          // C3, C#3, D3, D#3
      box.velocity.setValue(0.8);
    });
  }
});
```

A few patterns worth knowing:

- **Two-step or one-step?** You can either create the region and notes in one `editing.modify()` (one undo step that adds everything) or split them across multiple transactions (each step undoable independently). For programmatic patterns where the user thinks of "this whole bar" as one operation, one transaction is right.
- **The region's `events.refer(collection.owners)`** — note the `.owners` on the right-hand side. The region points at the collection's *owners* slot; symmetrically, individual notes point at the collection's *events* slot via `box.events.refer(collection.events)`. The asymmetry is the box-system's way of expressing the "one collection, many regions, many notes" topology.
- **Position is region-local.** When a region moves on the timeline, every note moves with it because positions are stored relative to the region.

### Using the adapter helper

If you have an `NoteEventCollectionBoxAdapter` rather than the raw box, you can use its `createEvent` shortcut instead of constructing `NoteEventBox`es by hand:

```typescript
import { NoteEventCollectionBoxAdapter } from "@opendaw/studio-adapters";

const adapter = project.boxAdapters.adapterFor(
  collection,
  NoteEventCollectionBoxAdapter,
);

project.editing.modify(() => {
  adapter.createEvent({
    position: Quarter,
    duration: Quarter / 2,
    pitch: 64,
    velocity: 0.7,
    chance: 100,
    playCount: 1,
    cent: 0,
  });
});
```

The adapter builds the box and wires the `events.refer` for you.

## Reading notes from a region

The reverse: iterate the notes in an existing region for piano-roll rendering, statistics, etc.

```typescript
import { NoteEventRegionBoxAdapter } from "@opendaw/studio-adapters";

// Get the region adapter (e.g. from a track's region list)
const regionAdapter = trackAdapter.regions.adapters.values()[0];
if (!regionAdapter.isAudioRegion()) {
  const noteRegion = regionAdapter as NoteEventRegionBoxAdapter;

  // Iterate notes
  for (const noteAdapter of noteRegion.events.selectable()) {
    const pitch = noteAdapter.box.pitch.getValue();
    const velocity = noteAdapter.box.velocity.getValue();
    const position = noteAdapter.box.position.getValue();
    const duration = noteAdapter.box.duration.getValue();
    console.log({ pitch, velocity, position, duration });
  }

  // React to changes (note added / removed / mutated)
  noteRegion.events.subscribeChange(() => {
    // re-draw the piano roll
  });
}
```

For UI render loops, the typical pattern is one subscription at the region level that redraws on any change to the underlying collection.

## MIDI input from hardware

This part is already covered in [Ch. 08 — Recording](./08-recording.md#midi-input-configuration); the summary here is for context.

The entry point is the `MidiDevices` class from `@opendaw/studio-core`:

```typescript
import { MidiDevices } from "@opendaw/studio-core";

// Probe browser support and request access.
if (MidiDevices.canRequestMidiAccess()) {
  await MidiDevices.requestPermission();
}

// List external inputs.
const devices = MidiDevices.inputDevices(); // ReadonlyArray<MIDIInput>

// Find a specific device by ID (returns Option<MIDIInput>).
const found = MidiDevices.findInputDeviceById(someId);

// The software keyboard is always available, useful for on-screen UIs:
const kb = MidiDevices.softwareMIDIInput;
kb.sendNoteOn(60, 0.8);    // pitch, velocity (0–1)
kb.sendNoteOff(60);
kb.releaseAllNotes();
kb.channel = 0;            // 0–15

// Subscribe to raw MIDI input across all (or one) channel:
const sub = MidiDevices.subscribeMessageEvents(
  (event: MIDIMessageEvent) => {
    const [status, note, velocity] = event.data;
    const channel = status & 0x0f;
    const type = status & 0xf0; // 0x90 note-on, 0x80 note-off, ...
  },
  /* channelFilter */ undefined,
);

// Emergency:
MidiDevices.panic(); // note-off everything on every channel
```

### Recording from a device into a track

Per-track MIDI capture is handled by `CaptureMidi`, retrieved through the project's `captureDevices`:

```typescript
import { CaptureMidi } from "@opendaw/studio-core";

const cap = project.captureDevices.get(audioUnitBox.address.uuid).unwrap() as CaptureMidi;

project.editing.modify(() => {
  cap.captureBox.channel.setValue(-1); // -1 = any channel; 0–15 = specific
});

// armed is a runtime observable — set it directly, outside editing.modify().
// (captureDevices.setArm() TOGGLES the armed state; its second parameter only
// controls whether other captures are disarmed — see Ch. 08.)
cap.armed.setValue(true);
```

When armed and the engine is recording, notes received from the matching channel land in a new `NoteRegionBox` on the track. The full lifecycle (count-in, takes, comp lanes) is detailed in [Ch. 08](./08-recording.md).

## MIDI output to external gear

The codebase contains a `MIDIOutputDeviceBox` and the engine has a `MIDISender` (in the audio-thread internals; see [internals/05](./internals/05-devices-and-effects.md#midi-plumbing)) that routes notes through a ring buffer back to the main thread, which forwards to a Web MIDI output port. **However, the consumer-facing surface to wire a track's output to a physical MIDI port is not yet documented in the public SDK.**

What you can do today:

- **Capture from a hardware keyboard** — fully supported, see above.
- **Trigger virtual instruments inside openDAW** — fully supported.
- **Send the audio output of your project to any audio output device** — `audioContext.destination` plus the standard Web Audio routing, with `audioContext.setSinkId(...)` for non-default outputs in Chromium-based browsers.

What you cannot do as cleanly today:

- Drive a hardware synth or external module from a `NoteRegionBox` over a Web MIDI output. The plumbing exists but the public API to attach a `MIDIOutputDeviceBox` to a track's output and stream notes through it is not yet surfaced.

If your app needs this, file an issue upstream or work around it by listening to the project's note events at the main-thread level and dispatching to a `MIDIOutput` yourself (you can read note positions from `NoteEventCollectionBoxAdapter` and use the engine's playback position to schedule MIDI messages — outside the SDK's recommended path, but feasible).

## MIDI Clock to external gear

The engine has a `MIDITransportClock` that, when active, sends standard MIDI Clock pulses at 24 PPQ (24 pulses per quarter note) to any registered MIDI output, plus Start / Stop / Continue messages on transport state changes. Same caveat as MIDI output: **the consumer-facing toggle isn't currently part of the documented SDK surface.** It works internally; the API to enable it from your app isn't exposed in the public API surface yet.

If you need to slave external gear to openDAW's transport today, the practical workaround is to derive timing on the consumer side: subscribe to `project.engine.isPlaying` and `project.engine.position`, compute clock pulses yourself, send them via a Web MIDI `MIDIOutput` you manage independently of the SDK.

## MIDI effects

Five MIDI effects ship with the SDK, inserted into a track's MIDI device chain (before the instrument). Use the `MidiEffectFactories` from `@opendaw/studio-adapters` to add them in a transaction — same pattern as audio effects, see [Ch. 11](./11-effects.md#adding-an-effect).

### Arpeggio

Plays notes in patterns over a configurable rate and number of octaves.

| Field | Type | Range | Meaning |
|---|---|---|---|
| `modeIndex` | `Int32Field` | 0–2 | Up / Down / UpDown |
| `numOctaves` | `Int32Field` | 1–5 | Range of arpeggio in octaves |
| `rateIndex` | `Int32Field` | 0–16 | Note rate (1/4, 1/8T, 1/16, …) |
| `gate` | `Float32Field` | 0–2 | Gate time as a fraction of step length |
| `repeat` | `Int32Field` | 1–16 | Repeats of each note |
| `velocity` | `Float32Field` | −1.0 to 1.0 | Velocity offset |

### Pitch

Transpose notes by semitones / cents / octaves before they reach the instrument.

| Field | Type | Range | Meaning |
|---|---|---|---|
| `semiTones` | `Int32Field` | −36 to +36 | Semitone shift |
| `cents` | `Float32Field` | −50 to +50 | Fine-tune in cents |
| `octaves` | `Int32Field` | −7 to +7 | Octave shift |

### Velocity

Reshape velocity — humanise, scale, randomise.

| Field | Type | Range | Meaning |
|---|---|---|---|
| `magnetPosition` | `Float32Field` | 0.0–1.0 | Target velocity for "magnet" pull |
| `magnetStrength` | `Float32Field` | 0.0–1.0 | How strongly velocities snap to the target |
| `randomSeed` | `Int32Field` | int | RNG seed |
| `randomAmount` | `Float32Field` | 0.0–1.0 | Random velocity variation |
| `offset` | `Float32Field` | −1.0 to 1.0 | Constant offset added before clamp |
| `mix` | `Float32Field` | 0.0–1.0 | Dry/wet between original and processed |

### Zeitgeist

Applies a "groove" template (timing pushback / pull) sourced from a `Groove` box.

| Field | Type | Meaning |
|---|---|---|
| `groove` | `PointerField<Groove>` | The groove template to apply |

### Spielwerk

User-written JavaScript MIDI processor. The full programming model is covered in [Ch. 11 — Spielwerk](./11-effects.md); the box-level fields:

| Field | Type | Meaning |
|---|---|---|
| `code` | `StringField` | The script source |
| `parameters` | `Field<Parameter>` | Declared parameters (registered automatically when the script is compiled) |
| `samples` | `Field<Sample>` | Declared samples (likewise) |

Spielwerk is the right tool when none of the four built-in effects above match your need — algorithmic patterns, generative sequences, custom mappings.

## How notes reach the instrument

When a `NoteRegionBox` plays, the engine walks an internal pipeline (see [internals/01 — NoteSequencer](./internals/01-engine-processor.md#notesequencer)) that converts the static note data into a stream of *note-on* / *note-off* events delivered to the instrument's input. From a consumer perspective, what you need to know:

- **You don't route notes manually.** Place a `NoteRegionBox` on a track whose `AudioUnit` has an instrument (`Tape`, `Vaporisateur`, `Soundfont`, `Apparat`, etc.). Playback "just works".
- **MIDI effects insert before the instrument.** They transform note events between source (the region) and sink (the instrument). The order is `region → midi effects → instrument`.
- **`Tape` doesn't respond to MIDI input.** Tape plays audio files, not notes. If you want a sample-based instrument that responds to MIDI, use `Soundfont` or `Playfield`.
- **The audio thread runs everything sample-accurately.** A note that should start at position `P` starts at `P` regardless of when in a render block it lands; the engine schedules it within the 128-sample quantum.
- **Synth tuning follows `project.rootBox.baseFrequency`.** Synth instruments like `Vaporisateur` compute oscillator frequency as `midiToHz(event.pitch + event.cent / 100, baseFrequency)` per note. Set the project's reference pitch (default 440 Hz, range 400–480 Hz, see `BaseFrequencyRange` in `@opendaw/studio-adapters`) once and every MIDI-driven instrument retunes. Audio files do not — see [Ch. 18 → Reference Pitch](./18-time-and-pitch.md#reference-pitch-concert-tuning).

## Note auditioning

For "click a piano key to preview a note without recording", the SDK uses `NoteSignal`:

```typescript
import { NoteSignal } from "@opendaw/studio-adapters";

const signal = NoteSignal.audition(
  audioUnitBox.address.uuid,
  /* pitch */ 60,
  /* duration */ PPQN.Quarter,
  /* velocity */ 0.9,
);

project.engine.noteSignal(signal);
```

The engine plays the note immediately on the addressed unit's instrument, releases it after `duration`, and does *not* persist anything to the box graph. This is what an on-screen keyboard or piano-roll preview should call when you click a key.

`NoteSignal` also has `.on(uuid, pitch, velocity)` and `.off(uuid, pitch)` constructors for held notes (e.g. mouse-down / mouse-up); together with `NoteSignal.fromEvent(messageEvent, uuid)` they make it possible to forward Web MIDI input straight to a specific unit's instrument without recording.

## MIDI in offline export

**MIDI does not export.** Offline render writes the audio output of the project. Notes in a `NoteRegionBox` feed the track's instrument, the instrument produces audio, and the audio gets exported. The MIDI itself is not written to a file.

If you need a `.mid` file from your project, that's a separate workflow — read the regions yourself and emit a Standard MIDI File via `@opendaw/lib-midi`. There's no built-in "export project to MIDI" command.

## What lives where

A quick map of the SDK surfaces this chapter touches:

| Concept | Surface | Where |
|---|---|---|
| Note data | `NoteEventBox`, `NoteEventCollectionBox`, `NoteRegionBox` | `@opendaw/studio-boxes` |
| Note iteration | `NoteEventCollectionBoxAdapter`, `NoteEventRegionBoxAdapter` | `@opendaw/studio-adapters` |
| Hardware input | `MidiDevices` | `@opendaw/studio-core` |
| Recording | `CaptureMidi`, `project.captureDevices` | `@opendaw/studio-core` |
| Note signals (audition) | `NoteSignal` | `@opendaw/studio-adapters` |
| Engine note input | `project.engine.noteSignal(signal)` | `@opendaw/studio-core` |
| MIDI effects | `ArpeggioDeviceBox`, `PitchDeviceBox`, `VelocityDeviceBox`, `ZeitgeistDeviceBox`, `SpielwerkDeviceBox` | `@opendaw/studio-boxes` |
| Add an effect | `MidiEffectFactories` | `@opendaw/studio-adapters` |
| MIDI output to hardware | Not yet exposed publicly | (internals only) |
| MIDI Clock | Not yet exposed publicly | (internals only) |

## Further reading

- [Ch. 08 — Recording](./08-recording.md) for the full MIDI capture / takes / count-in / monitoring lifecycle.
- [Ch. 11 — Effects](./11-effects.md) for adding effects to a track and the Spielwerk programming model.
- [internals/01 — Engine Processor](./internals/01-engine-processor.md#notesequencer) for how the engine actually schedules notes per render quantum.
- [internals/05 — Devices and Effects](./internals/05-devices-and-effects.md#midi-plumbing) for the MIDI output / clock / `MIDISender` plumbing if you're trying to extend the SDK in that direction.
- [`src/demos/midi/midi-recording-demo.tsx`](https://github.com/naomiaro/opendaw-test/tree/main/src/demos/midi) — the canonical end-to-end MIDI demo in this repo.
