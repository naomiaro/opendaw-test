# PPQN Fundamentals

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

### Understanding Resolution

Higher PPQN = more precise timing:
```
PPQN = 960  → We can place notes at 1/960th of a quarter note
PPQN = 480  → We can place notes at 1/480th of a quarter note (less precise)
PPQN = 1920 → We can place notes at 1/1920th of a quarter note (more precise)
```

960 is the standard used by most professional DAWs (Logic, Ableton, etc.).

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

## The Golden Rule

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
   - Clip durations need recalculation ✓
   - The audio still plays at original speed/pitch (with NoSync mode) ✓

## Next Steps

Now that you understand PPQN, continue to **Box System** to learn how OpenDAW structures its data.
