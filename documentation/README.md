# Building a DAW UI with OpenDAW

This handbook explains how to build a browser-based Digital Audio Workstation (DAW) user interface using OpenDAW's headless audio engine.

## Who is this for?

- **Want running audio in 5 minutes?** Start at the [Quick Start](./quick-start.md). It's a complete, runnable component.
- **New to DAWs?** After Quick Start, read Chapter 00 (System Architecture) for the visual map, then 01 → 07 sequentially — audio concepts are explained alongside the SDK.
- **Experienced developer joining a team?** Skim 00–03, focus on 04 (Box System) and whichever feature chapters you need.
- **Evaluating OpenDAW?** [Quick Start](./quick-start.md) then [System Architecture](./00-system-architecture.md) gives you the shape in 15 minutes.
- **Contributing to openDAW itself?** Jump to the [Internals](./internals/) section.

Each chapter has "Skip if" guidance at the top so you can find your level quickly.

## Reading paths

The handbook is large enough that "read everything" isn't realistic for most people. Pick the path that matches what you're building:

### "I'm building a timeline / piano-roll UI"
Quick Start → [Ch. 00](./00-system-architecture.md) (architecture) → [Ch. 02](./02-timing-and-tempo.md) (PPQN/BPM) → [Ch. 03](./03-animation-frame.md) (AnimationFrame) → [Ch. 06](./06-timeline-and-rendering.md) (timeline & rendering) → [Ch. 05](./05-samples-peaks-and-looping.md) (peaks for waveforms).

### "I'm building audio recording"
Quick Start → [Ch. 04](./04-box-system-and-reactivity.md) (box system) → [Ch. 05](./05-samples-peaks-and-looping.md) (samples) → [Ch. 08](./08-recording.md) (recording, takes, comp lanes) → [Ch. 09](./09-editing-fades-and-automation.md) (editing) for post-recording workflows.

### "I'm building MIDI editing"
Quick Start → [Ch. 04](./04-box-system-and-reactivity.md) (box system) → [Ch. 02](./02-timing-and-tempo.md) (timing) → [Ch. 16](./16-midi.md) (MIDI deep dive) → [Ch. 08](./08-recording.md) for MIDI capture specifically.

### "I'm building a mix / mastering tool"
Quick Start → [Ch. 04](./04-box-system-and-reactivity.md) → [Ch. 11](./11-effects.md) (effects) → [Ch. 09](./09-editing-fades-and-automation.md) (automation) → [Ch. 10](./10-export.md) (export & offline rendering).

### "I want to write custom DSP / synths"
Quick Start → [Ch. 11](./11-effects.md) (effects basics) → [Ch. 17](./17-modular-devices.md) (Apparat / Werkstatt / Spielwerk scripting model).

### "I'm fixing a performance issue"
[Ch. 15](./15-performance-and-debugging.md) (Performance & Debugging) → [Ch. 03](./03-animation-frame.md) (AnimationFrame) → [Ch. 13](./13-troubleshooting.md) (FAQ for the common cases).

### "I want to contribute to openDAW itself"
[Internals overview](./internals/) → Internals chapters 01–07 in order. Chapter 07 has the "How to create a proper PR" step-by-step.

## Chapters

### Core Handbook

| # | Chapter | Focus |
|---|---------|-------|
| — | [Quick Start](./quick-start.md) | 5-minute "hello, sound" walkthrough |
| 00 | [System Architecture](./00-system-architecture.md) | Visual map: high-level, package layout, engine threads |
| 01 | [Introduction](./01-introduction.md) | DAW concepts, OpenDAW architecture |
| 02 | [Timing & Tempo](./02-timing-and-tempo.md) | PPQN, BPM, tempo automation, time signatures |
| 03 | [AnimationFrame](./03-animation-frame.md) | Observable updates, UI sync |
| 04 | [Box System & Reactivity](./04-box-system-and-reactivity.md) | Data model, subscriptions, reactive lifecycle |
| 05 | [Samples, Peaks & Looping](./05-samples-peaks-and-looping.md) | Audio loading, waveforms, region tiling |
| 06 | [Timeline & Rendering](./06-timeline-and-rendering.md) | PPQN-to-pixels, grid, playhead, render pipeline |
| 07 | [Building a Complete App](./07-building-a-complete-app.md) | Full example, mixer groups, routing |

### Feature Guides

| # | Chapter | Focus |
|---|---------|-------|
| 08 | [Recording](./08-recording.md) | Audio/MIDI capture, takes, monitoring, live peaks |
| 09 | [Editing, Fades & Automation](./09-editing-fades-and-automation.md) | Region editing, clip fades, track automation, comp lanes |
| 10 | [Export](./10-export.md) | Mix/stems export, offline rendering |
| 11 | [Effects](./11-effects.md) | Effect types, creation, track/master integration |
| 16 | [MIDI Deep Dive](./16-midi.md) | Note creation, hardware capture, MIDI effects, audition |
| 17 | [Modular Devices](./17-modular-devices.md) | Apparat / Werkstatt / Spielwerk scripting |
| 18 | [Time & Pitch](./18-time-and-pitch.md) | NoStretch / PitchStretch / TimeStretch play modes, warp markers, transients, ±1 octave pitch |

### Appendix

| # | Chapter | Focus |
|---|---------|-------|
| 12 | [Browser Compatibility](./12-browser-compatibility.md) | COOP/COEP, browser quirks, iframe embedding |
| 13 | [Troubleshooting & FAQ](./13-troubleshooting.md) | Symptom-driven diagnostic checklists |
| 14 | [Glossary](./14-glossary.md) | 80+ term definitions with chapter cross-references |
| 15 | [Performance & Debugging](./15-performance-and-debugging.md) | DSP load meter, main-thread jank, loader hangs, memory leaks |

### Internals (Contributors)

Seven chapters covering the openDAW codebase from the inside, for anyone reading or modifying the SDK source. Start at the [Internals overview](./internals/). Topics: engine processor, box system, cross-thread protocols, sample loading, devices & effects, project & persistence, and the dev workflow + PR conventions.

## Quick Reference

### Essential Imports

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN, AudioData } from "@opendaw/lib-dsp";
import { Project, GlobalSampleLoaderManager } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import {
  AudioFileBox, AudioRegionBox, ValueEventCollectionBox,
} from "@opendaw/studio-boxes";
import { UUID, Progress } from "@opendaw/lib-std";
import { PeaksPainter } from "@opendaw/lib-fusion";
```

For specific topics, jump to the chapter that covers it:

- **PPQN ↔ seconds formulas** — [Ch. 02 → Conversions](./02-timing-and-tempo.md#converting-with-variable-tempo)
- **Creating a track with audio** — [Quick Start](./quick-start.md) shows the full transaction.
- **Subscribing to playback state** — [Ch. 03 → AnimationFrame patterns](./03-animation-frame.md), [Quick Start](./quick-start.md).
- **All terminology** — [Ch. 14 → Glossary](./14-glossary.md).

## Troubleshooting

Quick answers below. Anything more involved lives in the dedicated [Troubleshooting & FAQ](./13-troubleshooting.md) chapter — grouped by symptom with diagnostic checklists.

| Problem | Quick answer |
|---------|----------|
| No audio plays | Check AudioContext state, verify COOP/COEP headers, await sample loading. See [FAQ → No sound plays](./13-troubleshooting.md#no-sound-plays). |
| Playhead doesn't move | Ensure `AnimationFrame.start(window)` was called. See [FAQ → UI doesn't update](./13-troubleshooting.md#my-ui-doesnt-update-during-playback). |
| Clips in wrong position | Double-check PPQN calculations; `Math.round` floats. See [FAQ → Clips in wrong place](./13-troubleshooting.md#clips-are-in-the-wrong-place). |
| Waveforms not rendering | Subscribe to sample loader; `peaks.nearest(unitsPerPixel)`. See [FAQ → Waveforms](./13-troubleshooting.md#waveforms-dont-render). |
| Observables not updating | Use `catchupAndSubscribe`; check AnimationFrame is started. |
| `SharedArrayBuffer is not defined` | Page isn't cross-origin isolated. See [FAQ → Engine won't start](./13-troubleshooting.md#the-engine-wont-start). |
| App feels slow / dropouts | See [Ch. 15 → Performance & Debugging](./15-performance-and-debugging.md). |

## Further Reading

- **SDK Changelogs:** [changelogs/](https://github.com/naomiaro/opendaw-test/tree/main/changelogs) — one file per release range, what changed and what to migrate.
- **Demo Code:** [src/demos/](https://github.com/naomiaro/opendaw-test/tree/main/src/demos) — every concept in the handbook has a runnable demo.
- **TypeScript Definitions:** `node_modules/@opendaw/*/dist/*.d.ts` — the authoritative signature reference until upstream adds JSDoc.
