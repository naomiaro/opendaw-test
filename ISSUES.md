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
`src/drum-scheduling-demo.tsx` lines 137-143
