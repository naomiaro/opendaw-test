# Mixer Groups (Sub-Mixing) in OpenDAW

## Overview

OpenDAW supports **group buses** (also called sub-groups or submixes) — intermediate mixing stages where multiple tracks are summed together before reaching the master output. This is a standard DAW mixing pattern for controlling related tracks as a unit.

**Signal flow:** Track → Group Bus → Master Output

For example, routing Drums and Bass to a "Rhythm" group lets you mute, solo, or adjust the volume of the entire rhythm section with a single control.

## Architecture

### Audio Routing Graph

```
┌──────────┐     ┌──────────────────┐     ┌──────────────┐
│  Drums   │────▸│                  │     │              │
│ AudioUnit│     │  Rhythm Group    │────▸│              │
│  Box     │     │  AudioBusBox     │     │    Master    │
├──────────┤     │  + AudioUnitBox  │     │  AudioBus    │
│  Bass    │────▸│                  │     │  + AudioUnit │
│ AudioUnit│     └──────────────────┘     │              │
│  Box     │                              │              │
├──────────┤     ┌──────────────────┐     │              │
│  Vocals  │────▸│                  │────▸│              │
│ AudioUnit│     │  Melodic Group   │     │              │
│  Box     │     │  AudioBusBox     │     └──────────────┘
├──────────┤     │  + AudioUnitBox  │
│  Guitar  │────▸│                  │
│ AudioUnit│     └──────────────────┘
│  Box     │
└──────────┘
```

### Box Structure per Group

Each group bus consists of two connected boxes:

| Box | Purpose |
|-----|---------|
| **AudioBusBox** | Receives and sums multiple input signals. Has `input` (pointer hub) and `output` (pointer field). |
| **AudioUnitBox** | Applies channel strip processing (volume, panning, mute, solo). Connected to the AudioBusBox's output. Routes to master by default. |

`AudioBusFactory.create()` creates both boxes and wires them together in a single call.

### Default Routing

When a track is created via `project.api.createInstrument()`, its `AudioUnitBox.output` is automatically connected to the master bus's input. To route through a group instead, you re-assign this output pointer to the group's `AudioBusBox.input`.

## Creating Group Buses

### AudioBusFactory API

```typescript
import { AudioBusFactory } from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";

// Create the bus in its own transaction
project.editing.modify(() => {
  const audioBusBox = AudioBusFactory.create(
    project.skeleton,       // { boxGraph, mandatoryBoxes }
    "Rhythm",               // display name
    IconSymbol.AudioBus,    // icon enum
    AudioUnitType.Bus,      // type discriminator
    Colors.blue             // color from @opendaw/studio-enums
  );
});
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `skeleton` | `ProjectSkeleton` | Access via `project.skeleton`. Provides `boxGraph` and `mandatoryBoxes` (rootBox, primaryAudioBus, etc.) |
| `name` | `string` | Display label for the group |
| `icon` | `IconSymbol` | Icon enum (e.g., `IconSymbol.AudioBus`, `IconSymbol.Mix`) |
| `type` | `AudioUnitType` | `AudioUnitType.Bus` for groups, `AudioUnitType.Aux` for auxiliary sends |
| `color` | `Color` | Pre-defined colors from `Colors` (blue, purple, green, red, orange, etc.) |

**Returns:** `AudioBusBox` — the bus box. The paired `AudioUnitBox` is accessible via pointer traversal (see below).

### Accessing the Group's AudioUnitBox

The `AudioBusBox.output` pointer connects to the `AudioUnitBox.input`. Traverse it to get the AudioUnitBox for volume/mute/solo control:

```typescript
// IMPORTANT: Do this AFTER the creation transaction commits.
// targetVertex traversal within the same transaction may return stale data.
const audioUnitBox = audioBusBox.output.targetVertex
  .unwrap("No AudioUnitBox found").box as AudioUnitBox;
```

The AudioUnitBox provides the same mixer controls as instrument tracks:

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `.volume` | float | -inf to +12 dB | Group volume |
| `.mute` | boolean | — | Mutes all audio through the group |
| `.solo` | boolean | — | Solos the group (virtual solo propagates to child tracks) |
| `.panning` | float | -1.0 to 1.0 | Stereo panning |

## Routing Tracks to Groups

### Critical: Use Separate Transactions

`createInstrument()` internally routes `audioUnitBox.output` to the master bus. Re-routing with `output.refer()` **in the same `editing.modify()` transaction** may not properly disconnect the old connection, causing **dual routing** — audio reaches master both directly and through the group.

Always re-route in a separate transaction:

```typescript
// Step 1: Create the track (routes to master by default)
let trackAudioUnitBox: AudioUnitBox;

project.editing.modify(() => {
  const { audioUnitBox, trackBox } = project.api.createInstrument(
    InstrumentFactories.Tape
  );
  trackAudioUnitBox = audioUnitBox;
  // ... create AudioFileBox, AudioRegionBox, etc.
});

// Step 2: Re-route to group in a SEPARATE transaction
project.editing.modify(() => {
  trackAudioUnitBox.output.refer(groupBusBox.input);
});
```

### Why Separate Transactions?

OpenDAW's box graph defers pointer hub notifications within a single `editing.modify()` transaction. When `createInstrument()` connects the track to master, the pointer hub on the master bus records the incoming connection. If you immediately call `output.refer(newTarget)` in the same transaction, the hub notification to remove the old connection may not fire until after the transaction commits — leaving both connections active.

This is analogous to the documented [SignatureTrack one-transaction-per-event](./02-timing-and-tempo.md#critical-one-transaction-per-event) requirement, which is caused by the same deferred notification mechanism.

## Complete Example

```typescript
import { AudioBusFactory } from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";
import { AudioUnitBox } from "@opendaw/studio-boxes";

// 1. Create group buses
const busBoxes = new Map<string, AudioBusBox>();

project.editing.modify(() => {
  busBoxes.set("Rhythm", AudioBusFactory.create(
    project.skeleton, "Rhythm", IconSymbol.AudioBus,
    AudioUnitType.Bus, Colors.blue
  ));
  busBoxes.set("Melodic", AudioBusFactory.create(
    project.skeleton, "Melodic", IconSymbol.AudioBus,
    AudioUnitType.Bus, Colors.purple
  ));
});

// 2. Resolve AudioUnitBoxes (after transaction commits)
const rhythmUnitBox = busBoxes.get("Rhythm")!.output
  .targetVertex.unwrap().box as AudioUnitBox;
const melodicUnitBox = busBoxes.get("Melodic")!.output
  .targetVertex.unwrap().box as AudioUnitBox;

// 3. Create tracks (each gets default master routing)
const tracks: { name: string; audioUnitBox: AudioUnitBox }[] = [];

for (const file of audioFiles) {
  project.editing.modify(() => {
    const { audioUnitBox, trackBox } = project.api.createInstrument(
      InstrumentFactories.Tape
    );
    // ... create AudioFileBox, AudioRegionBox ...
    tracks.push({ name: file.name, audioUnitBox });
  });
}

// 4. Re-route to groups (separate transaction)
project.editing.modify(() => {
  for (const track of tracks) {
    if (track.name === "Drums" || track.name === "Bass") {
      track.audioUnitBox.output.refer(busBoxes.get("Rhythm")!.input);
    } else {
      track.audioUnitBox.output.refer(busBoxes.get("Melodic")!.input);
    }
  }
});

// 5. Control group mixer parameters
project.editing.modify(() => {
  rhythmUnitBox.volume.setValue(-3);  // -3 dB
  melodicUnitBox.volume.setValue(-6); // -6 dB
});
```

## Solo Behavior

OpenDAW's `Mixer` class automatically handles solo propagation through the routing graph:

| Action | Result |
|--------|--------|
| Solo a group | All tracks routed to that group are **virtually soloed** — they keep playing. All other groups and their tracks are muted. |
| Solo a track | The track's output chain (its group, then master) is virtually soloed. Other tracks in the same group are muted. |
| Solo master | Everything plays (effectively un-solos all). |

Virtual solo is bidirectional: the `Mixer` traverses both upstream (inputs to the soloed channel) and downstream (outputs from the soloed channel) to determine which channels should remain audible. No special handling is needed in your code — create the routing structure and the solo buttons work correctly.

## Subscribing to Group State

Use `catchupAndSubscribe` to observe group mixer state changes, the same pattern used for instrument tracks:

```typescript
useEffect(() => {
  const box = group.audioUnitBox;

  const volSub = box.volume.catchupAndSubscribe(obs =>
    setVolume(obs.getValue())
  );
  const muteSub = box.mute.catchupAndSubscribe(obs =>
    setMuted(obs.getValue())
  );
  const soloSub = box.solo.catchupAndSubscribe(obs =>
    setSoloed(obs.getValue())
  );

  return () => {
    volSub.terminate();
    muteSub.terminate();
    soloSub.terminate();
  };
}, [group]);
```

## Master Output Access

The master output's AudioUnitBox is accessible via the root box's output device pointer hub:

```typescript
const masterAudioBox = project.rootBox.outputDevice
  .pointerHub.incoming().at(0)?.box as AudioUnitBox;

// Control master volume
project.editing.modify(() => {
  masterAudioBox.volume.setValue(-3);
});
```

## Groups vs Aux Units

OpenDAW supports two types of bus units:

| Feature | Group (`AudioUnitType.Bus`) | Aux (`AudioUnitType.Aux`) |
|---------|---------------------------|--------------------------|
| Routing | **Serial** — track output → group → master | **Parallel** — track sends a copy to aux |
| Use case | Submixing related tracks (drums group, vocal group) | Effects processing (reverb bus, delay bus) |
| Signal path | Replaces the track's default master routing | Runs alongside the main signal path |
| Creation | `AudioBusFactory.create(..., AudioUnitType.Bus, ...)` | `AudioBusFactory.create(..., AudioUnitType.Aux, ...)` |

The mixer groups demo uses serial group routing. For parallel aux/send routing, see the retro example in the OpenDAW source.

## Demo

See `src/mixer-groups-demo.tsx` for a complete working example that:

- Creates two group buses (Rhythm and Melodic) using `AudioBusFactory`
- Loads 7 audio stems and routes them to the appropriate group
- Provides per-track volume/mute/solo controls
- Provides per-group volume/mute/solo controls
- Provides master output volume control
- Displays a visual signal flow diagram

The track loading logic is in `src/lib/groupTrackLoading.ts`.

## References

- [Box System & Reactivity](./04-box-system-and-reactivity.md) — Understanding boxes, pointers, and transactions
- [Clip Fades](./16-clip-fades.md) — Another example of transaction-sensitive operations
- [Time Signature Changes](./02-timing-and-tempo.md#advanced-time-signature-changes) — Documents the same deferred notification behavior
