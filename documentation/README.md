# Building a DAW UI with OpenDAW

This handbook explains how to build a browser-based Digital Audio Workstation (DAW) user interface using OpenDAW's headless audio engine.

## Who is this for?

- **New to DAWs?** Start at Chapter 01 and read sequentially — audio concepts are explained alongside the SDK.
- **Experienced developer joining a team?** Skim 01-03, focus on 04 (Box System) and the feature chapters you need.
- **Evaluating OpenDAW?** Read 01 for architecture, then jump to the feature area you care about.

Each chapter has "Skip if" guidance at the top so you can find your level quickly.

## Chapters

### Core Handbook

| # | Chapter | Focus | Start here if... |
|---|---------|-------|-------------------|
| 01 | [Introduction](./01-introduction.md) | DAW concepts, architecture | You're new to DAW architecture |
| 02 | [Timing & Tempo](./02-timing-and-tempo.md) | PPQN, BPM, tempo automation, time signatures | You need to understand the timing system |
| 03 | [AnimationFrame](./03-animation-frame.md) | Observable updates, UI sync | Your observables aren't updating |
| 04 | [Box System & Reactivity](./04-box-system-and-reactivity.md) | Data model, subscriptions, reactive lifecycle | You need to understand data structures |
| 05 | [Samples, Peaks & Looping](./05-samples-peaks-and-looping.md) | Audio loading, waveforms, region tiling | You need to display or loop audio |
| 06 | [Timeline & Rendering](./06-timeline-and-rendering.md) | PPQN-to-pixels, grid, playhead, render pipeline | You're building the timeline view |
| 07 | [Building a Complete App](./07-building-a-complete-app.md) | Full example, mixer groups, routing | You want a working application |

### Feature Guides

| # | Chapter | Focus | Start here if... |
|---|---------|-------|-------------------|
| 08 | [Recording](./08-recording.md) | Audio/MIDI capture, takes, monitoring, live peaks | You're implementing recording |
| 09 | [Editing, Fades & Automation](./09-editing-fades-and-automation.md) | Region editing, clip fades, track automation, comp lanes | You're implementing editing features |
| 10 | [Export](./10-export.md) | Mix/stems export, offline rendering | You're implementing audio export |
| 11 | [Effects](./11-effects.md) | Effect types, creation, track/master integration | You're implementing audio effects |

**Recommended reading order:** 01 → 02 → 03 → 04 → 05 → 06 → 07, then jump to whichever feature chapter you need.

**Troubleshooting?** Read Chapter 03 (AnimationFrame) first — it's the #1 cause of "why isn't my UI updating?"

## Quick Reference

### Core Formulas

**Convert PPQN to Pixels:**
```typescript
pixels = (ppqnPosition / totalPPQNDuration) * timelineWidthInPixels
```

**Convert Seconds to PPQN (single tempo):**
```typescript
ppqn = PPQN.secondsToPulses(durationInSeconds, bpm)
```

**Convert Seconds to PPQN (variable tempo):**
```typescript
// Use the tempo map when your project has tempo automation
const endPpqn = project.tempoMap.secondsToPPQN(durationInSeconds)

// Convert a duration at a specific position (accounts for tempo changes)
const startSeconds = project.tempoMap.ppqnToSeconds(positionPpqn)
const endPpqn = project.tempoMap.secondsToPPQN(startSeconds + durationInSeconds)
const durationPpqn = endPpqn - positionPpqn
```

**Musical Positions (constant):**
```typescript
const { Quarter } = PPQN; // Always 960

beatOne = 0 * Quarter;           // 0
beatTwo = 1 * Quarter;           // 960
oneBar = 4 * Quarter;            // 3840 (in 4/4 time)
eighthNote = Quarter / 2;        // 480
```

### Key Concepts

| Concept | Description | Changes with BPM? |
|---------|-------------|-------------------|
| `PPQN.Quarter = 960` | Resolution constant | Never |
| Clip position | Musical beat location | Never |
| Clip duration | Audio length in PPQN | Yes |
| BPM | Playback speed | User adjustable |

### Essential Imports

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN, AudioData } from "@opendaw/lib-dsp";
import { Project, GlobalSampleLoaderManager } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { UUID, Progress } from "@opendaw/lib-std";
import { PeaksPainter } from "@opendaw/lib-fusion";
```

## Common Patterns

### Create a Track with Audio Clip

```typescript
project.editing.modify(() => {
  const { audioUnitBox, trackBox } = project.api.createInstrument(
    InstrumentFactories.Tape
  );

  const fileUUID = UUID.generate();
  const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
    box.fileName.setValue("audio.wav");
    box.endInSeconds.setValue(audioBuffer.duration);
  });

  const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

  const clipDuration = PPQN.secondsToPulses(audioBuffer.duration, bpm);

  AudioRegionBox.create(boxGraph, UUID.generate(), box => {
    box.regions.refer(trackBox.regions);
    box.file.refer(audioFileBox);
    box.events.refer(eventsCollectionBox.owners);
    box.position.setValue(0 * Quarter);
    box.duration.setValue(clipDuration);
    box.loopDuration.setValue(clipDuration);
  });
});
```

### Subscribe to Changes

```typescript
useEffect(() => {
  const playingSub = project.engine.isPlaying.subscribe(obs => {
    setIsPlaying(obs.getValue());
  });

  const positionSub = AnimationFrame.add(() => {
    setCurrentPosition(project.engine.position.getValue());
  });

  return () => {
    playingSub.terminate();
    positionSub.terminate();
  };
}, [project]);
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No audio plays | Check AudioContext state, verify COOP/COEP headers, check console |
| Playhead doesn't move | Ensure `AnimationFrame.start(window)` was called |
| Clips in wrong position | Double-check PPQN calculations |
| Waveforms not rendering | Subscribe to sample loader, check `!peaksOption.isEmpty()` |
| Observables not updating | Read Chapter 03 — AnimationFrame must be started |

## Further Reading

- **SDK Changelogs:** [changelogs/](https://github.com/naomiaro/opendaw-test/tree/main/changelogs)
- **Demo Code:** [src/demos/](https://github.com/naomiaro/opendaw-test/tree/main/src/demos)
- **TypeScript Definitions:** Check `node_modules/@opendaw/*/dist/*.d.ts` for API details
