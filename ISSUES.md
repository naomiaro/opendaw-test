# OpenDAW Issues

This document tracks issues discovered while building demos with OpenDAW.

## 1. AudioFileBox.endInSeconds Rejects Values < 1.0 Second

**Status**: Workaround implemented

**Description**:
The `AudioFileBox.endInSeconds` field will not accept values less than 1.0 second unless it has first been set to a value >= 1.0 second.

**Impact**:
- Cannot directly set duration for short audio samples (drum hits, sound effects, etc.)
- Affects any use case with audio files shorter than 1 second

**Reproduction**:
```typescript
const audioFileBox = AudioFileBox.create(boxGraph, uuid, box => {
  box.fileName.setValue("Short Sample");
  box.endInSeconds.setValue(0.5);  // This will fail silently - value stays at 0
});

console.log(audioFileBox.endInSeconds.getValue());  // Prints: 0 (not 0.5)
```

**Workaround**:
```typescript
const audioFileBox = AudioFileBox.create(boxGraph, uuid, box => {
  box.fileName.setValue("Short Sample");

  // Set to >= 1.0 first, then set actual duration
  if (duration < 1.0) {
    box.endInSeconds.setValue(2.0);
  }
  box.endInSeconds.setValue(duration);  // Now works!
});
```

**Location in codebase**:
`src/drum-scheduling-demo.tsx` lines 141-147

---

## 2. AutofitUtils.changeBpm() Causes Audio Artifacts on Short Samples

**Status**: Unresolved - audio playback issue persists

**Description**:
When using `AutofitUtils.changeBpm()` with `AudioPlayback.AudioFit` regions containing short audio samples (< 1 second), the audio playback exhibits pitch artifacts at the start of the sample that then normalize.

**Impact**:
- BPM changes cause audible glitches on short samples
- Most noticeable on sustained sounds like open hi-hats
- Makes dynamic BPM changes unusable for drum patterns with short samples

**Reproduction Steps**:
1. Create AudioRegionBox with `AudioPlayback.AudioFit` mode
2. Use audio sample < 1 second (e.g., open hi-hat: 1.928s works, but shorter samples are more affected)
3. Call `AutofitUtils.changeBpm(project, newBpm, false)`
4. Play the pattern
5. Observe: Open hi-hat at the start of the first bar sounds "off pitch at the beginning, then normalizes"

**Expected Behavior**:
Samples should maintain consistent pitch throughout playback after BPM change.

**Actual Behavior**:
Samples start with pitch artifacts that normalize partway through playback.

**Console Output**:
Before fix for Issue #1, this also caused warnings:
```
AutofitUtils.changeBpm: durationInSeconds is 0. Try to access file.
```
(This warning is now resolved by the workaround for Issue #1, but audio issue persists)

**Configuration**:
```typescript
AudioRegionBox.create(boxGraph, UUID.generate(), box => {
  box.regions.refer(trackBox.regions);
  box.file.refer(audioFileBox);
  box.playback.setValue(AudioPlayback.AudioFit);  // Critical: AudioFit mode
  box.position.setValue(position);
  box.duration.setValue(clipDurationInPPQN);
  box.loopOffset.setValue(0);
  box.loopDuration.setValue(clipDurationInPPQN);
});

// Later, when BPM changes:
AutofitUtils.changeBpm(project, newBpm, false);
```

**Sample Details**:
- Kick (0.140s): Affected but less noticeable
- Snare (0.205s): Affected but less noticeable
- Hi-Hat Closed (0.271s): Affected but less noticeable
- Hi-Hat Open (1.928s): Most audibly affected - clear pitch issue at start

**Location in codebase**:
- Demo: `src/drum-scheduling-demo.tsx`
- BPM change handler: lines 291-306
- Audio samples: `public/audio/90sSamplePack/`

**Notes**:
- Issue only occurs AFTER BPM slider is moved
- Initial playback at 90 BPM sounds correct
- Issue persists even after samples are fully loaded into sample manager
- May be related to how AudioFit mode recalculates sample playback after duration changes
