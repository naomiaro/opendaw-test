# Building a DAW UI with OpenDAW

This documentation explains how to build a browser-based Digital Audio Workstation (DAW) user interface using OpenDAW's headless audio engine.

## Who is this for?

This guide is for developers who:
- Want to build a DAW in the browser
- Have web development experience (React, TypeScript, Canvas)
- Are new to DAW architecture and audio programming concepts
- Need to understand OpenDAW's PPQN-based timing system

## ⚠️ Critical Concept: AnimationFrame

**Before you start coding**, understand this:

OpenDAW's observables **will not work** without `AnimationFrame.start(window)`. This is the #1 cause of "why isn't my UI updating?" issues.

**→ Read [AnimationFrame Guide](./07-animation-frame.md) first if you're having issues with observables not updating.**

## Documentation Structure

Read these documents in order to build up your understanding:

### 1. [Introduction](./01-introduction.md)
- What is a DAW?
- Why OpenDAW?
- System architecture overview
- Key components

**Start here if:** You're new to DAW concepts

---

### 2. [PPQN Fundamentals](./02-ppqn-fundamentals.md)
- What is PPQN and why use it?
- PPQN vs BPM (resolution vs speed)
- Musical time units (quarters, eighths, bars)
- Converting between PPQN and seconds
- Positioning clips and handling BPM changes

**Start here if:** You understand DAWs but not timing systems

---

### 3. [AnimationFrame Guide](./03-animation-frame.md) ⚠️
- What is AnimationFrame and why it's required
- How the audio-to-UI bridge works
- Setting up the update loop
- Observable.subscribe() vs AnimationFrame.add()
- Performance patterns
- Common mistakes and debugging
- Essential initialization sequence

**Start here if:** Your observables aren't updating or you're having UI sync issues

---

### 4. [Box System](./04-box-system.md)
- OpenDAW's data model (the "box graph")
- Creating and modifying boxes
- Transactions and undo/redo
- References and relationships
- Observing changes
- Common patterns

**Start here if:** You need to understand OpenDAW's data structures

---

### 5. [Sample Management and Peaks](./05-sample-management-and-peaks.md)
- Loading audio files
- Sample manager configuration
- Understanding peaks (waveform data)
- Rendering waveforms with PeaksPainter
- React canvas patterns
- Performance tips

**Start here if:** You need to display audio waveforms

---

### 6. [Timeline Rendering](./06-timeline-rendering.md)
- Timeline coordinate system
- Converting PPQN to pixels
- Rendering grid lines, clips, and playhead
- Advanced features (zoom, highlighting, labels)
- Handling BPM changes
- Click and drag interactions
- Performance optimization

**Start here if:** You're building the timeline view

---

### 7. [Putting It All Together](./07-putting-it-together.md)
- Complete working application
- Project initialization
- Full React component examples
- Transport controls
- Common issues and solutions
- Production considerations
- Next steps

**Start here if:** You want a complete working example

---

### 8. [Recording and Live Peaks](./08-recording-and-live-peaks.md)
- Recording API overview
- Accessing live recording peaks
- Production pattern (timeline UI - OpenDAW's approach)
- Demo pattern (standalone recording)
- Smooth 60fps waveform rendering
- Complete examples

**Start here if:** You're implementing audio recording with live waveform display

---

## Quick Reference

### Core Formulas

**Convert PPQN to Pixels:**
```typescript
pixels = (ppqnPosition / totalPPQNDuration) * timelineWidthInPixels
```

**Convert Seconds to PPQN:**
```typescript
ppqn = PPQN.secondsToPulses(durationInSeconds, bpm)
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
| `PPQN.Quarter = 960` | Resolution constant | ❌ Never |
| Clip position | Musical beat location | ❌ Never |
| Clip duration | Audio length in PPQN | ✅ Yes |
| BPM | Playback speed | ✅ User adjustable |

### Essential Imports

```typescript
// ⚠️ CRITICAL: AnimationFrame (start before creating project!)
import { AnimationFrame } from "@opendaw/lib-dom";

// PPQN utilities
import { PPQN } from "@opendaw/lib-dsp";

// Core project
import { Project, InstrumentFactories } from "@opendaw/studio-core";

// Boxes
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";

// Enums
import { AudioPlayback } from "@opendaw/studio-enums";

// Utilities
import { UUID } from "@opendaw/lib-std";

// Rendering
import { PeaksPainter } from "@opendaw/lib-fusion";
```

### AnimationFrame Setup (Required!)

```typescript
// AnimationFrame.start(window) is called automatically by initializeOpenDAW()
const project = await initializeOpenDAW();

// Now you can subscribe to observables (they work!)
project.engine.isPlaying.subscribe(obs => {
  setIsPlaying(obs.getValue()); // ✓ Updates!
});
```

**Note:** The `initializeOpenDAW()` function handles calling `AnimationFrame.start(window)` internally. If you're not using this helper function, you must call `AnimationFrame.start(window)` before creating your project.

## Common Patterns

### Create a Track with Audio Clip

```typescript
project.editing.modify(() => {
  // 1. Create track
  const { audioUnitBox, trackBox } = project.api.createInstrument(
    InstrumentFactories.Tape
  );

  // 2. Create audio file metadata
  const fileUUID = UUID.generate();
  const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
    box.fileName.setValue("audio.wav");
    box.endInSeconds.setValue(audioBuffer.duration);
  });

  // 3. Create clip on timeline
  const clipDuration = PPQN.secondsToPulses(audioBuffer.duration, bpm);

  AudioRegionBox.create(boxGraph, UUID.generate(), box => {
    box.regions.refer(trackBox.regions);
    box.file.refer(audioFileBox);
    box.playback.setValue(AudioPlayback.NoSync);
    box.position.setValue(0 * Quarter);
    box.duration.setValue(clipDuration);
    box.loopDuration.setValue(clipDuration);
  });
});
```

### Handle BPM Changes

```typescript
function handleBpmChange(newBpm: number) {
  project.editing.modify(() => {
    // Update timeline BPM
    project.timelineBox.bpm.setValue(newBpm);

    // Recalculate all clip durations
    audioRegions.forEach(({ box, audioDuration }) => {
      const newDuration = PPQN.secondsToPulses(audioDuration, newBpm);
      box.duration.setValue(newDuration);
      box.loopDuration.setValue(newDuration);
    });
  });
}
```

### Subscribe to Changes

```typescript
useEffect(() => {
  // Subscribe to playing state
  const playingSub = project.engine.isPlaying.subscribe(obs => {
    setIsPlaying(obs.getValue());
  });

  // Subscribe to position (throttled)
  const positionSub = AnimationFrame.add(() => {
    setCurrentPosition(project.engine.position.getValue());
  });

  // Cleanup
  return () => {
    playingSub.terminate();
    positionSub.terminate();
  };
}, [project]);
```

## Troubleshooting

### No audio plays
- Check AudioContext state (may need `audioContext.resume()`)
- Verify cross-origin isolation headers
- Check browser console for errors

### Playhead doesn't move
- Ensure `AnimationFrame.start(window)` was called
- Check position subscription is active
- Verify engine is actually playing

### Clips in wrong position
- Double-check PPQN calculations
- Verify `totalDuration` matches your timeline
- Check pixel conversion formula

### Waveforms not rendering
- Subscribe to sample loader state
- Check peaks are available (`!peaksOption.isEmpty()`)
- Verify canvas has proper dimensions

## Additional Resources

- **OpenDAW Examples**: See the demo applications in `src/` directory
- **TypeScript Definitions**: Check `node_modules/@opendaw/*/dist/*.d.ts` for API details
- **Live Demos**: Run `npm run dev` to see working examples

## Getting Help

If you get stuck:
1. Check the relevant documentation section above
2. Look at the working demo code in `src/`
3. Review TypeScript type definitions for API details
4. Search for similar patterns in the codebase

## Contributing

Found an error or want to improve this documentation? PRs welcome!

---

## Document Navigation

| Document | Focus Area | Audience |
|----------|------------|----------|
| [Introduction](./01-introduction.md) | Overview & concepts | Beginners to DAW architecture |
| [PPQN Fundamentals](./02-ppqn-fundamentals.md) | Timing system | All developers |
| [AnimationFrame ⚠️](./03-animation-frame.md) | Observable updates | **Required reading** |
| [Box System](./04-box-system.md) | Data model | Backend/state management |
| [Sample Management](./05-sample-management-and-peaks.md) | Audio & waveforms | Frontend/canvas developers |
| [Timeline Rendering](./06-timeline-rendering.md) | UI visualization | Frontend developers |
| [Complete Example](./07-putting-it-together.md) | Full application | All developers |
| [Recording & Live Peaks](./08-recording-and-live-peaks.md) | Recording with live waveforms | Frontend/recording features |

**Recommended reading order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (→ 8 if implementing recording)

**Troubleshooting order:** Having issues? → Read 3 first!

Happy building! 🎵
