# Timing & Tempo

> **Skip if:** you're experienced with PPQN-based timing systems and tempo automation
> **Prerequisites:** Chapter 01 (Introduction)

## Table of Contents

- [What is PPQN?](#what-is-ppqn)
- [Why Not Just Use Seconds?](#why-not-just-use-seconds)
- [OpenDAW's PPQN System](#opendaws-ppqn-system)
- [PPQN vs BPM: The Key Difference](#ppqn-vs-bpm-the-key-difference)
- [Musical Time Units in PPQN](#musical-time-units-in-ppqn)
- [Positioning on the Timeline](#positioning-on-the-timeline)
- [Audio Duration (Use PPQN Utilities)](#audio-duration-use-ppqn-utilities)
- [Positions vs Durations](#positions-vs-durations)
- [Complete Example](#complete-example)
- [Visualizing PPQN on Timeline](#visualizing-ppqn-on-timeline)
- [Key Takeaways](#key-takeaways)
- [Two Timebase Modes for Clips](#two-timebase-modes-for-clips)
  - [Musical Timebase](#musical-timebase)
  - [Seconds Timebase](#seconds-timebase)
  - [Choosing Between Them](#choosing-between-them)
- [Advanced: Tempo Automation](#advanced-tempo-automation)
  - [Accessing the Tempo Track](#accessing-the-tempo-track)
  - [Creating Tempo Events](#creating-tempo-events)
  - [Interpolation Modes](#interpolation-modes)
  - [Setting Up the Timeline](#setting-up-the-timeline)
  - [Common Patterns (Tempo)](#common-patterns-tempo)
  - [Converting with Variable Tempo](#converting-with-variable-tempo)
  - [The Integration Algorithm](#the-integration-algorithm)
- [Advanced: Time Signature Changes](#advanced-time-signature-changes)
  - [PPQN and Time Signatures](#ppqn-and-time-signatures)
  - [Accessing the Signature Track](#accessing-the-signature-track)
  - [Setting the Initial Time Signature](#setting-the-initial-time-signature)
  - [Creating Signature Change Events](#creating-signature-change-events)
  - [Clearing Existing Signature Events](#clearing-existing-signature-events)
  - [Iterating Signature Events](#iterating-signature-events)
  - [Computing Bar Layout](#computing-bar-layout)
  - [Timeline Visualization](#timeline-visualization)
  - [Common Patterns (Time Signatures)](#common-patterns-time-signatures)

---

## What is PPQN?

**PPQN** stands for **Pulses Per Quarter Note**. It's a system for measuring time in musical units rather than seconds.

Think of it like this:
- A clock measures time in seconds ⏱️
- A DAW measures time in musical beats 🎵

## Why Not Just Use Seconds?

In a DAW, users think in terms of **bars and beats**, not seconds:
- "Place the kick drum on beat 1"
- "The snare hits on beats 2 and 4"
- "This loop is 4 bars long"

If we measured everything in seconds, changing the tempo (BPM) would break everything:
```
❌ Using seconds:
- Kick at 0.0s, 1.0s, 2.0s, 3.0s
- Change from 60 BPM to 120 BPM
- Problem: Kick is now at wrong positions!

✅ Using PPQN:
- Kick at beat 1, beat 2, beat 3, beat 4
- Change from 60 BPM to 120 BPM
- Still correct: Kick stays on beats 1, 2, 3, 4
```

## OpenDAW's PPQN System

In OpenDAW:
```typescript
PPQN.Quarter = 960
```

This means **one quarter note = 960 pulses**.

This is a **resolution constant** that never changes. It defines how precisely we can measure time.

### Why 960?

960 = 2⁶ × 3 × 5. This factorization gives clean integer division for every common musical subdivision:

| Subdivision | Calculation | Ticks |
|-------------|-------------|-------|
| Quarter note | 960 | 960 |
| Eighth note | 960 / 2 | 480 |
| Triplet eighth | 960 / 3 | 320 |
| Sixteenth note | 960 / 4 | 240 |
| Triplet sixteenth | 960 / 6 | 160 |
| Thirty-second note | 960 / 8 | 120 |
| Quintuplet | 960 / 5 | 192 |
| Septuplet | 960 / 7 | ~137 |

Every division except 7 (rare in practice) produces a clean integer. No floating-point rounding errors for standard note values. 960 is widely used by professional DAWs (Logic Pro, Ableton Live, etc.).

### PPQN Values Are Integers

The `position` field on `AudioRegionBox` is Int32 — it must receive integer values. The `duration`, `loopOffset`, and `loopDuration` fields are Float32 with `unit: "mixed"`, but in Musical timeBase they store PPQN ticks, which should be integers to avoid fractional pulse misalignment.

Since `PPQN.secondsToPulses()` returns a float, always wrap the result with `Math.round()`:

```typescript
// ❌ Float — causes misalignment between region boundaries
region.position.setValue(PPQN.secondsToPulses(seconds, bpm));

// ✅ Integer — safe
region.position.setValue(Math.round(PPQN.secondsToPulses(seconds, bpm)));
```

This applies to `position` (Int32, always needs rounding) and `duration`, `loopOffset`, `loopDuration` (Float32, need rounding in Musical timeBase).

## PPQN vs BPM: The Key Difference

### PPQN = Resolution (Constant)
- Defines the timing grid precision
- `PPQN.Quarter = 960` never changes
- It's like the pixels on a screen - determines how fine-grained positions can be

### BPM = Playback Speed (Variable)
- Defines how fast the music plays
- Can change during playback
- Determines how long those 960 pulses take in real time

### Example:

```typescript
const Quarter = 960; // This is always 960 (the resolution)

// At 60 BPM:
// 60 beats per minute = 1 beat per second
// 960 pulses play in 1 second

// At 120 BPM:
// 120 beats per minute = 2 beats per second
// 960 pulses play in 0.5 seconds

// At 240 BPM:
// 240 beats per minute = 4 beats per second
// 960 pulses play in 0.25 seconds
```

The **musical position** stays the same (960 pulses = 1 beat), but the **playback speed** changes.

## Musical Time Units in PPQN

Given `PPQN.Quarter = 960`:

```typescript
// Quarter note = 960 pulses
const quarterNote = 960;

// Eighth note = half a quarter note
const eighthNote = 960 / 2;  // = 480

// Sixteenth note = quarter of a quarter note
const sixteenthNote = 960 / 4;  // = 240

// Half note = two quarter notes
const halfNote = 960 * 2;  // = 1920

// Whole note = four quarter notes
const wholeNote = 960 * 4;  // = 3840

// One bar in 4/4 time = 4 quarter notes
const oneBar = 960 * 4;  // = 3840
```

## Positioning on the Timeline

### Musical Positions (Use Quarter Constant)

When placing clips at **musical positions** (beats), use the `Quarter` constant:

```typescript
import { PPQN } from "@opendaw/lib-dsp";
const { Quarter } = PPQN;

// Kick drum on beat 1
const kickBeat1 = 0 * Quarter;  // = 0

// Snare on beat 2
const snareBeat2 = 1 * Quarter;  // = 960

// Hi-hat on beat 3
const hihatBeat3 = 2 * Quarter;  // = 1920

// Clap on beat 4
const clapBeat4 = 3 * Quarter;  // = 2880

// Next bar (beat 5 in 4/4 time)
const nextBar = 4 * Quarter;  // = 3840
```

**These positions never change when BPM changes!** A kick on beat 1 is always at position 0, regardless of tempo.

## Audio Duration (Use PPQN Utilities)

When working with **audio file durations** (real-world time), use OpenDAW's conversion utilities:

```typescript
import { PPQN } from "@opendaw/lib-dsp";

const audioDuration = 0.5; // 500ms kick drum sample
const bpm = 120;

// Convert seconds to PPQN pulses
const durationInPPQN = PPQN.secondsToPulses(audioDuration, bpm);

console.log(durationInPPQN); // = 1920 pulses at 120 BPM
```

**These durations DO change when BPM changes:**

```typescript
const kickSample = 0.5; // 500ms audio file

// At 60 BPM
PPQN.secondsToPulses(0.5, 60);  // = 960 pulses (one quarter note)

// At 120 BPM
PPQN.secondsToPulses(0.5, 120); // = 1920 pulses (two quarter notes)

// At 240 BPM
PPQN.secondsToPulses(0.5, 240); // = 3840 pulses (four quarter notes)
```

Why? Because at higher BPM, the same audio file covers more musical time (more beats).

## Positions vs Durations

```typescript
// ✅ CORRECT: Musical positions (beat grid)
const kickPosition = 0 * Quarter;        // Beat 1
const snarePosition = 1 * Quarter;       // Beat 2
const nextBarPosition = 4 * Quarter;     // Next bar

// ✅ CORRECT: Audio durations (real-world time)
const clipDuration = PPQN.secondsToPulses(audioBuffer.duration, bpm);

// ❌ WRONG: Don't manually calculate
const wrongCalc = Math.ceil(((duration * bpm) / 60) * Quarter);
// This is what secondsToPulses does internally - just use the utility!
```

## Complete Example

```typescript
import { PPQN } from "@opendaw/lib-dsp";
const { Quarter } = PPQN;

// Create a simple drum pattern
const bpm = 120;
const pattern = [
  {
    name: "Kick",
    position: 0 * Quarter,           // Beat 1 (position never changes)
    audioDuration: 0.5,               // 500ms audio file
    duration: PPQN.secondsToPulses(0.5, bpm)  // Duration in PPQN (changes with BPM)
  },
  {
    name: "Snare",
    position: 1 * Quarter,           // Beat 2 (position never changes)
    audioDuration: 0.3,               // 300ms audio file
    duration: PPQN.secondsToPulses(0.3, bpm)  // Duration in PPQN (changes with BPM)
  },
  {
    name: "Hi-hat",
    position: Quarter / 2,           // Eighth note (position never changes)
    audioDuration: 0.1,               // 100ms audio file
    duration: PPQN.secondsToPulses(0.1, bpm)  // Duration in PPQN (changes with BPM)
  }
];

// If user changes BPM from 120 to 90:
const newBpm = 90;
pattern.forEach(clip => {
  // Position stays the same!
  // clip.position unchanged

  // Duration needs recalculation
  clip.duration = PPQN.secondsToPulses(clip.audioDuration, newBpm);
});
```

## Visualizing PPQN on Timeline

When rendering a timeline:

```typescript
// Timeline is 800 pixels wide, showing 4 bars
const timelineWidth = 800;
const bars = 4;
const totalDuration = bars * 4 * Quarter; // 4 bars in 4/4 = 15,360 pulses

// Clip at position 960 (beat 2)
const clip = {
  position: 1 * Quarter,  // 960 pulses
  duration: 1920          // 1920 pulses
};

// Convert PPQN position to pixels
const x = (clip.position / totalDuration) * timelineWidth;
// = (960 / 15360) * 800 = 50 pixels

const width = (clip.duration / totalDuration) * timelineWidth;
// = (1920 / 15360) * 800 = 100 pixels
```

The ratio `(position / totalDuration)` gives you the percentage of the timeline, then multiply by pixel width.

## Key Takeaways

1. **PPQN.Quarter = 960** is a constant that never changes (it's the resolution)
2. **BPM** determines playback speed (how fast those pulses play)
3. **Musical positions** use `Quarter` constant and don't change with BPM
4. **Audio durations** use `PPQN.secondsToPulses()` and DO change with BPM
5. When BPM changes:
   - Clip positions stay the same ✓
   - Clip durations need recalculation (NoSync mode — no time-stretching) ✓

---

## Two Timebase Modes for Clips

Every audio region has a `timeBase` property that controls how its duration relates to tempo. This matters whenever BPM changes — either from the user adjusting it or from tempo automation.

```typescript
import { TimeBase } from "@opendaw/lib-dsp";

box.timeBase.setValue(TimeBase.Musical);  // or TimeBase.Seconds
```

### Musical Timebase

Position and duration are both stored in PPQN ticks. The clip occupies a fixed number of beats regardless of tempo. When BPM increases, the clip plays faster (shorter wall-clock time) but stays at the same bar/beat position.

**When to use:**
- Drum loops and patterns that should stay locked to the grid
- MIDI-recorded performances
- Any content composed to fit specific bars and beats
- Loops that tile — the tiling stays aligned to beats at any tempo

**Behavior when BPM changes:** A 4-beat clip always occupies 4 beats. At 120 BPM that's 2 seconds; at 60 BPM it's 4 seconds. The audio plays back at the original speed (no time-stretching) — it just finishes sooner or later relative to the grid.

**Overlap rule:** Musical timebase regions are **not allowed to overlap** on the same track. The engine validates this during export.

### Seconds Timebase

Position is in PPQN (for grid alignment), but duration is in real-time seconds. When BPM changes, the engine recomputes how many PPQN ticks the clip spans. A 4-second clip is always 4 seconds — it just covers more or fewer beats depending on tempo.

**When to use:**
- Sound effects with a fixed real-time duration
- Dialogue or voiceover
- Field recordings
- One-shot samples like drum hits (the sound's natural decay shouldn't change with tempo)

**Behavior when BPM changes:** A 4-second clip always plays for 4 seconds. At 120 BPM it spans 8 beats; at 60 BPM it spans 4 beats. The clip's tick-duration is recalculated.

**Overlap rule:** Seconds timebase regions **are allowed to overlap** (e.g., a drum hit's decay can extend into the next hit).

### Choosing Between Them

| Scenario | Timebase | Why |
|----------|----------|-----|
| Drum loop | Musical | Loop should stay on the beat grid |
| Kick drum one-shot | Seconds | Natural decay shouldn't change with tempo |
| MIDI piano recording | Musical | Performance is locked to beats |
| Voiceover narration | Seconds | Speech has a fixed duration |
| Sound effect (explosion) | Seconds | Effect timing is absolute |
| Synth pad (4-bar chord) | Musical | Chord should fill exactly 4 bars |

See the [TimeBase demo](https://opendaw-test.pages.dev/timebase-demo.html) for an interactive comparison.

---

## Advanced: Tempo Automation

> **Skip if:** you don't need variable BPM playback

### Overview

OpenDAW supports tempo automation — changing BPM over time during playback. You can create stepped tempo changes (instant jumps) or linear ramps between tempo values.

### Key Concepts

- **Tempo events** are stored in a `ValueEventCollectionBox` on the timeline
- Each event has a **position** (in PPQN), a **value** (BPM), and an **interpolation** mode
- The engine's `VaryingTempoMap` reads these events and provides position-dependent tempo
- The metronome and all time-based processing automatically follow tempo changes

### Accessing the Tempo Track

```typescript
const adapter = project.timelineBoxAdapter;

// tempoTrackEvents is an Option — use ifSome() to access it
adapter.tempoTrackEvents.ifSome(collection => {
  // collection is a ValueEventCollectionBoxAdapter
});
```

The tempo track is bootstrapped automatically by `ProjectSkeleton` during `Project.new()`.

### Creating Tempo Events

```typescript
import { Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";

project.editing.modify(() => {
  adapter.tempoTrackEvents.ifSome(collection => {
    // Clear existing events
    collection.events.asArray().forEach(event => event.box.delete());

    // Create new events
    collection.createEvent({
      position: 0 as ppqn,        // Start position in PPQN
      index: 0,                    // Event index
      value: 120,                  // BPM
      interpolation: Interpolation.Linear,
    });

    collection.createEvent({
      position: 30720 as ppqn,     // 8 bars of 4/4 (8 × 3840)
      index: 0,
      value: 160,
      interpolation: Interpolation.Linear,
    });
  });
});
```

### Interpolation Modes

| Mode | Effect |
|------|--------|
| `Interpolation.None` | Stepped — instant jump to new value |
| `Interpolation.Linear` | Straight-line ramp between values |
| `Interpolation.Curve(slope)` | Curved ramp — `slope` is 0–1 where 0.5 = linear, < 0.5 = slow start (logarithmic), > 0.5 = fast start (exponential) |

All imported from `@opendaw/lib-dsp`.

#### Stepped (Discrete Jumps)

```typescript
// 120 BPM for bars 1-2, then 140 BPM for bars 3-4
collection.createEvent({
  position: 0 as ppqn, index: 0,
  value: 120, interpolation: Interpolation.None,
});
collection.createEvent({
  position: (2 * 3840) as ppqn, index: 0,
  value: 140, interpolation: Interpolation.None,
});
```

#### Linear Ramp (Accelerando)

```typescript
// Even speed up from 100 to 160 BPM over 8 bars
collection.createEvent({
  position: 0 as ppqn, index: 0,
  value: 100, interpolation: Interpolation.Linear,
});
collection.createEvent({
  position: (8 * 3840) as ppqn, index: 0,
  value: 160, interpolation: Interpolation.Linear,
});
```

#### Curve (Logarithmic / Exponential)

```typescript
// Fast initial pickup that eases into final tempo (slope 0.75)
collection.createEvent({
  position: 0 as ppqn, index: 0,
  value: 90, interpolation: Interpolation.Curve(0.75),
});
collection.createEvent({
  position: (8 * 3840) as ppqn, index: 0,
  value: 160, interpolation: Interpolation.None,
});
```

Curve slopes create natural-sounding tempo changes:
- **0.25** — slow start, steep finish (exponential ritardando)
- **0.5** — equivalent to `Interpolation.Linear`
- **0.75** — fast start, gentle finish (logarithmic accelerando)

Combine curves for expressive shapes like a "breath" swell (fast rise with `0.75`, gentle fall with `0.25`). See the [Tempo Automation demo](https://opendaw-test.pages.dev/tempo-automation-demo.html) for interactive examples.

### Setting Up the Timeline

After creating tempo events, configure the timeline duration and loop area:

```typescript
import { PPQN } from "@opendaw/lib-dsp";

const BAR = PPQN.fromSignature(4, 4); // 3840 PPQN per bar in 4/4
const TOTAL_PPQN = BAR * 8;           // 8 bars

project.editing.modify(() => {
  project.timelineBox.durationInPulses.setValue(TOTAL_PPQN);
  project.timelineBox.loopArea.from.setValue(0);
  project.timelineBox.loopArea.to.setValue(TOTAL_PPQN);
  project.timelineBox.loopArea.enabled.setValue(true);
});
```

### Common Patterns (Tempo)

#### Preset-Based Tempo Patterns

Define patterns as data and apply them programmatically:

```typescript
type TempoPoint = {
  position: ppqn;
  bpm: number;
  interpolation: "step" | "linear";
};

type TempoPattern = {
  name: string;
  description: string;
  points: TempoPoint[];
};

function applyPattern(project: Project, pattern: TempoPattern): void {
  project.editing.modify(() => {
    const adapter = project.timelineBoxAdapter;

    adapter.tempoTrackEvents.ifSome(collection => {
      // Clear existing
      collection.events.asArray().forEach(event => event.box.delete());

      // Create new
      for (const point of pattern.points) {
        collection.createEvent({
          position: point.position,
          index: 0,
          value: point.bpm,
          interpolation: point.interpolation === "linear"
            ? Interpolation.Linear
            : Interpolation.None,
        });
      }
    });

    // Set timeline duration and loop
    project.timelineBox.durationInPulses.setValue(TOTAL_PPQN);
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(TOTAL_PPQN);
    project.timelineBox.loopArea.enabled.setValue(true);
  });
}
```

#### Monitoring Playhead Position

Use `AnimationFrame` to track the playhead during playback:

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

const terminable = AnimationFrame.add(() => {
  const position = project.engine.position.getValue();
  // Use position (in PPQN) to update UI
});

// Cleanup
terminable.terminate();
```

### Converting with Variable Tempo

The fundamentals section above uses `PPQN.secondsToPulses(seconds, bpm)` and `PPQN.pulsesToSeconds(ppqn, bpm)` — these assume a single constant BPM. When your project has tempo automation, use `project.tempoMap` instead:

```typescript
// Seconds → PPQN (variable tempo)
const ppqn = project.tempoMap.secondsToPPQN(seconds);

// PPQN → Seconds (variable tempo)
const seconds = project.tempoMap.ppqnToSeconds(ppqn);

// Duration of a PPQN interval in seconds (e.g., for export)
const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
```

To convert a duration at a specific timeline position:

```typescript
// "How many PPQN ticks does 2 seconds occupy starting at bar 5?"
const startPpqn = 5 * BAR; // bar 5
const startSeconds = project.tempoMap.ppqnToSeconds(startPpqn);
const endPpqn = project.tempoMap.secondsToPPQN(startSeconds + 2.0);
const durationPpqn = endPpqn - startPpqn;
// At constant 120 BPM this equals PPQN.secondsToPulses(2.0, 120) = 3840
// With a tempo ramp, the result depends on integration across the ramp
```

#### Why "integration across the ramp"?

At a constant tempo, converting between ticks and seconds is simple multiplication: `seconds = ticks * 60 / (960 * bpm)`. But when tempo changes mid-timeline, different regions of the timeline have different tick-to-second ratios.

Think of it like driving on a highway where the speed limit changes. If you drive 100km at 100km/h, then 100km at 50km/h, the total time isn't `200km / 75km/h` (averaged). You have to compute each segment separately: 1 hour + 2 hours = 3 hours.

Same principle with tempo: if ticks 0-3840 (bar 1) are at 120 BPM, that's 2 seconds. If ticks 3840-7680 (bar 2) are at 60 BPM, that's 4 seconds. The total time to tick 7680 is 6 seconds — not the 4 seconds you'd get by averaging to 90 BPM.

With a linear ramp (e.g., 120 BPM accelerating to 180 BPM over 8 bars), the tempo is different at every point. The `tempoMap` handles this by stepping through the ramp in small 80-tick segments (~10ms each), computing each segment's duration at its local tempo, and summing them — a [Riemann sum](https://en.wikipedia.org/wiki/Riemann_sum) approximating the integral of `1/tempo` over the tick range.

This is all handled internally by `project.tempoMap` — you just call `ppqnToSeconds()` or `intervalToSeconds()` and get the correct result.

### The Integration Algorithm

The `VaryingTempoMap` converts ticks to seconds by stepping through 80-tick intervals (~10ms at typical tempos):

```
function ppqnToSeconds(targetTick):
    accumulatedSeconds = 0
    currentTick = 0

    while currentTick < targetTick:
        bpm = tempoMap.getTempoAt(currentTick)
        nextGrid = ceil(currentTick / 80) * 80
        segmentEnd = min(nextGrid, targetTick)
        segmentTicks = segmentEnd - currentTick
        segmentSeconds = segmentTicks * 60 / (960 * bpm)
        accumulatedSeconds += segmentSeconds
        currentTick = segmentEnd

    return accumulatedSeconds
```

Each step assumes constant tempo within the 80-tick window. This is a **Riemann sum** — approximating the integral of `1/tempo` over the tick range.

A **cache** stores pre-computed (tick, seconds, bpm) entries at tempo event boundaries for performance — binary search finds the nearest entry, then integration continues from there.

The inverse (`secondsToTicks`) uses the same stepping approach but accumulates ticks instead of seconds, interpolating linearly within the final segment when it would overshoot the target.

### Seconds Timebase Duration with Variable Tempo

When using [Seconds Timebase](#seconds-timebase) with tempo automation, converting a real-time duration to PPQN ticks is **position-dependent** — the same 4-second clip gets a different tick-duration depending on where it sits on the timeline:

```typescript
const startSeconds = tempoMap.ppqnToSeconds(positionTick);
const endTick = tempoMap.secondsToPPQN(startSeconds + durationSeconds);
const durationInTicks = endTick - positionTick;
```

At constant 120 BPM: 4 seconds = 7680 ticks. At constant 60 BPM: 4 seconds = 3840 ticks. At a ramp from 120→60: somewhere in between, determined by integration.

### VaryingTempoMap API Reference

`project.tempoMap` (a `VaryingTempoMap` instance) provides the full tempo-aware conversion API:

| Method | Description |
|--------|-------------|
| `getTempoAt(ppqn)` | BPM at a specific timeline position |
| `ppqnToSeconds(ppqn)` | Convert absolute PPQN position to seconds |
| `secondsToPPQN(seconds)` | Convert seconds to absolute PPQN position |
| `intervalToSeconds(from, to)` | Duration of a PPQN range in seconds |
| `intervalToPPQN(from, to)` | Duration of a seconds range in PPQN |
| `subscribe(callback)` | React to tempo automation changes |

All conversion methods account for tempo ramps and automation — they integrate across tempo changes rather than using a single BPM value. Use these instead of `PPQN.pulsesToSeconds()`/`PPQN.secondsToPulses()` when your project has tempo automation.

### Reference (Tempo Automation)

- Tempo demo: [tempo-automation-demo](https://opendaw-test.pages.dev/tempo-automation-demo.html)
- TimeBase demo: [timebase-demo](https://opendaw-test.pages.dev/timebase-demo.html)
- VaryingTempoMap: `packages/studio/adapters/src/VaryingTempoMap.ts`
- ValueEventCollectionBoxAdapter: `packages/studio/adapters/src/timeline/collection/ValueEventCollectionBoxAdapter.ts`

---

## Advanced: Time Signature Changes

> **Skip if:** your project uses only 4/4 time

### Overview

OpenDAW supports time signature changes during playback. You can place signature change events at specific PPQN positions on the timeline, and the metronome and bar/beat grid automatically adapt.

### Key Concepts

- **Signature events** are managed by `SignatureTrackAdapter`
- The **storage signature** (index -1) defines the initial time signature
- Additional events at PPQN positions change the signature from that point forward
- Bar duration in PPQN depends on the signature: `PPQN.fromSignature(nominator, denominator)`

### PPQN and Time Signatures

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// PPQN.fromSignature(nom, denom) = Math.floor(3840 / denom) * nom
PPQN.fromSignature(4, 4);  // 3840 — standard bar
PPQN.fromSignature(3, 4);  // 2880 — waltz
PPQN.fromSignature(7, 8);  // 3360 — prog rock
PPQN.fromSignature(5, 4);  // 4800 — quintuple meter
PPQN.fromSignature(6, 8);  // 2880 — compound duple
```

Note that 3/4 and 6/8 have the same PPQN duration (2880) but different beat subdivisions — the metronome reflects this difference.

### Accessing the Signature Track

```typescript
const signatureTrack = project.timelineBoxAdapter.signatureTrack;
```

### Setting the Initial Time Signature

The storage signature is set on the `TimelineBox`:

```typescript
project.editing.modify(() => {
  project.timelineBox.signature.nominator.setValue(6);
  project.timelineBox.signature.denominator.setValue(8);
});
```

### Creating Signature Change Events

```typescript
import type { ppqn } from "@opendaw/lib-dsp";

// Create a signature change at a specific PPQN position
project.editing.modify(() => {
  signatureTrack.createEvent(
    7680 as ppqn,  // Position: after 2 bars of 4/4 (2 × 3840)
    3,             // Nominator: 3
    4              // Denominator: 4
  );
});
```

#### Critical: One Transaction Per Event

`SignatureTrackAdapter.createEvent()` calls `iterateAll()` internally to determine the insertion index. Inside a single `editing.modify()` transaction, adapter collection notifications are deferred — the collection doesn't update until the transaction commits. This means multiple `createEvent` calls in one transaction will see stale state and produce incorrect results.

```typescript
// ❌ WRONG — events will have incorrect positions/indices
project.editing.modify(() => {
  signatureTrack.createEvent(3840 as ppqn, 7, 8);
  signatureTrack.createEvent(7680 as ppqn, 5, 4);  // Sees stale state!
});

// ✅ CORRECT — separate transactions per event
project.editing.modify(() => {
  signatureTrack.createEvent(3840 as ppqn, 7, 8);
});
project.editing.modify(() => {
  signatureTrack.createEvent(7680 as ppqn, 5, 4);
});
```

### Clearing Existing Signature Events

When switching between patterns, clear existing events before creating new ones. Delete in reverse order, each in its own transaction:

```typescript
// Get all events (slice(1) skips the storage signature at index -1)
const existingEvents = Array.from(signatureTrack.iterateAll()).slice(1);

// Delete in reverse order, each in its own transaction
for (let i = existingEvents.length - 1; i >= 0; i--) {
  project.editing.modify(() => {
    signatureTrack.adapterAt(existingEvents[i].index).ifSome(a => a.box.delete());
  });
}
```

### Iterating Signature Events

```typescript
// iterateAll() yields { index, accumulatedPpqn, accumulatedBars, nominator, denominator }
for (const event of signatureTrack.iterateAll()) {
  console.log(
    `Index: ${event.index}, Position: ${event.accumulatedPpqn}, ` +
    `Bar: ${event.accumulatedBars}, ` +
    `Signature: ${event.nominator}/${event.denominator}`
  );
}
// Index -1 is the storage signature (initial time signature)
// Index 0+ are change events
```

### Computing Bar Layout

After applying signature events, read the authoritative bar layout from the SDK via `signatureTrack.iterateAll()`. Each `SignatureEvent` provides `accumulatedPpqn` (where the section starts) and `accumulatedBars` (how many bars precede it) — expand each section into individual bars:

```typescript
import { PPQN } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";

type BarInfo = {
  startPpqn: ppqn;
  durationPpqn: ppqn;
  nominator: number;
  denominator: number;
  barNumber: number;
};

function computeBarsFromSDK(project: Project): BarInfo[] {
  const signatureTrack = project.timelineBoxAdapter.signatureTrack;
  const totalPpqn = project.timelineBox.durationInPulses.getValue();
  const sections = Array.from(signatureTrack.iterateAll());
  const bars: BarInfo[] = [];
  let barNumber = 1;

  for (let s = 0; s < sections.length; s++) {
    const { accumulatedPpqn: sectionStart, nominator, denominator } = sections[s];
    const sectionEnd = (s + 1 < sections.length)
      ? sections[s + 1].accumulatedPpqn
      : totalPpqn;
    const barDuration = PPQN.fromSignature(nominator, denominator);

    for (let pos = sectionStart; pos < sectionEnd; pos += barDuration) {
      bars.push({
        startPpqn: pos as ppqn,
        durationPpqn: barDuration as ppqn,
        nominator,
        denominator,
        barNumber: barNumber++,
      });
    }
  }

  return bars;
}
```

This reads from the SDK's actual state rather than re-deriving bar positions from pattern data independently. The `iterateAll()` generator yields one `SignatureEvent` per section (index -1 for the storage signature, then 0+ for change events).

### Timeline Visualization

Bar widths should be proportional to their PPQN duration. This means bars with more beats (e.g., 5/4) are wider than bars with fewer beats (e.g., 3/4), keeping the quarter-note pixel width consistent:

```typescript
const totalPpqn = bars.reduce((sum, b) => sum + b.durationPpqn, 0);

// Convert PPQN position to pixel X coordinate
const toX = (ppqnPos: number) => (ppqnPos / totalPpqn) * canvasWidth;

// Bar pixel width
const barPixelWidth = toX(bar.startPpqn + bar.durationPpqn) - toX(bar.startPpqn);
```

### Common Patterns (Time Signatures)

#### Preset-Based Signature Sequences

```typescript
type SignatureChange = {
  barOffset: number;   // Bars of previous signature before this change
  nominator: number;
  denominator: number;
};

// Example: Prog Rock — 4/4 → 7/8 → 5/4 → 4/4, each for 2 bars
const progRock: SignatureChange[] = [
  { barOffset: 2, nominator: 7, denominator: 8 },
  { barOffset: 2, nominator: 5, denominator: 4 },
  { barOffset: 2, nominator: 4, denominator: 4 },
];
```

#### Applying a Pattern

1. Clear existing signature events (reverse order, separate transactions)
2. Set the storage signature (initial time signature)
3. Create each change event at the correct PPQN position (separate transactions)
4. Set timeline duration and loop area

See `src/demos/automation/time-signature-demo.tsx` for a complete implementation of this pattern.

### Reference (Time Signature Changes)

- Demo: `src/demos/automation/time-signature-demo.tsx`
- SignatureTrackAdapter: `packages/studio/adapters/src/timeline/SignatureTrackAdapter.ts`
- PPQN utilities: `packages/lib/dsp/src/ppqn.ts`

---

## Advanced: Cue Point Markers

> **Skip if:** you don't need arrangement markers or navigation points

### Overview

OpenDAW supports **cue point markers** on the timeline via `MarkerTrackAdapter`. Markers are named positions used for navigation, arrangement sections, or loop boundaries.

### Accessing the Marker Track

```typescript
const markerTrack = project.timelineBoxAdapter.markerTrack;

// Enable/disable the marker track
markerTrack.enabled; // boolean
```

### MarkerBoxAdapter

Each marker has:

| Property | Type | Description |
|----------|------|-------------|
| `.position` | PPQN | Timeline position of the marker |
| `.label` | string | Display name (e.g., "Intro", "Chorus", "Bridge") |

### Subscribing to Marker Changes

```typescript
const sub = markerTrack.subscribe(listener);
// Returns Terminable — clean up in useEffect

// Iterate current markers
const markers = markerTrack.events; // EventCollection of MarkerBoxAdapter
```

### Use Cases

- **Arrangement sections** — mark Intro, Verse, Chorus, Bridge positions
- **Navigation** — jump to named positions with `engine.setPosition(marker.position)`
- **Loop boundaries** — set `loopArea.from`/`.to` from marker positions
- **Export ranges** — define stem export start/end from marker pairs

### Reference (Markers)

- MarkerTrackAdapter: `packages/studio/adapters/src/timeline/MarkerTrackAdapter.ts`
- MarkerBoxAdapter: `packages/studio/adapters/src/timeline/MarkerBoxAdapter.ts`
