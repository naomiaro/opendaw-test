# AudioBuffer Chunk Extraction During Recording

## Overview

This document explores the feasibility and implementation of extracting chunks of an AudioBuffer during active recording in OpenDAW. The research reveals that the architecture already supports real-time chunk extraction through a ring buffer pattern.

**TL;DR**: Yes, it's possible to extract chunks during recording. The infrastructure is already in place - chunks are collected in real-time and stored internally. The main limitation is that the API doesn't currently expose these intermediate chunks publicly.

## Current Recording Architecture

### Key Components

| Component | File Path | Purpose |
|-----------|-----------|---------|
| **Recording Control** | `/packages/studio/core/src/capture/RecordAudio.ts` | Orchestrates recording lifecycle |
| **RecordingWorklet** | `/packages/studio/core/src/RecordingWorklet.ts` | Collects and manages audio chunks |
| **Ring Buffer** | `/packages/studio/adapters/src/RingBuffer.ts` | Lock-free chunk transfer between threads |
| **Audio Processor** | `/packages/studio/core-processors/src/RecordingProcessor.ts` | Audio worklet that writes chunks |
| **PeaksWriter** | `/packages/studio/core/src/PeaksWriter.ts` | Real-time chunk processing example |
| **AudioBuffer Utils** | `/packages/lib/dsp/src/AudioBuffer.ts` | Buffer manipulation utilities |

### Architecture Pattern: Real-Time Ring Buffer

OpenDAW uses a **lock-free ring buffer** architecture that enables thread-safe chunk extraction during recording:

```
┌─────────────────────┐
│  Audio Thread       │
│  (AudioWorklet)     │
│                     │
│  128 samples/chunk  │
└──────────┬──────────┘
           │ write
           ▼
┌─────────────────────┐
│ SharedArrayBuffer   │
│  Ring Buffer        │
│  128 chunks × 128   │
│  = 16,384 samples   │
└──────────┬──────────┘
           │ read
           ▼
┌─────────────────────┐
│  Main Thread        │
│  (RecordingWorklet) │
│                     │
│  #output array      │
└─────────────────────┘
```

## Recording Flow

### 1. Recording Initiation

**File**: `/packages/studio/core/src/capture/Recording.ts`

The static `Recording` class manages the recording state and initiates the capture process.

### 2. Audio Capture Setup

**File**: `/packages/studio/core/src/capture/CaptureAudio.ts`

```typescript
const numChunks = 128
const recordingWorklet = audioWorklets.createRecording(
    channelCount,
    numChunks,
    audioContext.outputLatency
)
```

Creates a RecordingWorklet with:
- **128 chunks** buffer capacity
- **128 samples** per chunk (one RenderQuantum)
- Total buffer: 16,384 samples (~0.33 seconds at 48kHz)

### 3. Audio Worklet Processing

**File**: `/packages/studio/core-processors/src/RecordingProcessor.ts:20`

```typescript
process(inputs: ReadonlyArray<ReadonlyArray<Float32Array>>): boolean {
    this.#writer.write(inputs[0])  // Write each 128-sample chunk
    return true
}
```

The AudioWorkletProcessor runs in the audio thread and writes incoming audio to the ring buffer every render quantum (128 samples).

### 4. Chunk Collection

**File**: `/packages/studio/core/src/RecordingWorklet.ts:60`

```typescript
readonly #output: Array<ReadonlyArray<Float32Array>>

// In the reader callback:
if (this.#isRecording) {
    this.#output.push(array)  // array is the chunk of audio data
}
```

The main thread reads chunks from the ring buffer via callback and stores them in the `#output` array.

## Ring Buffer Implementation

**File**: `/packages/studio/adapters/src/RingBuffer.ts:50`

### Configuration

```typescript
export interface Config {
    sab: SharedArrayBuffer           // Shared memory between threads
    numChunks: int                   // 128 chunks for buffering
    numberOfChannels: int            // Number of audio channels
    bufferSize: int                  // 128 samples per chunk (RenderQuantum)
}
```

### Reader Function

```typescript
export const reader = (
    {sab, numChunks, numberOfChannels, bufferSize}: Config,
    append: Procedure<Array<Float32Array>>
): Reader => {
    // ... atomic read/write pointers management ...

    while (readPtr !== writePtr) {
        // Extract chunk of audio
        const channels: Array<Float32Array> = []
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const start = channel * bufferSize
            const end = start + bufferSize
            channels.push(planarChunk.slice(start, end))
        }
        append(channels)  // CALLBACK with extracted chunk
    }
}
```

**How it works:**
1. Audio thread writes 128-sample chunks to SharedArrayBuffer using atomic operations
2. Main thread reads from ring buffer via callback function
3. RecordingWorklet receives each chunk and can process it immediately
4. Chunks are stored in `#output` array during recording

## Chunk Data Structure

Each chunk is represented as `Array<Float32Array>` where:
- Array length = number of audio channels
- Each Float32Array contains 128 samples (one RenderQuantum)
- Format is planar (one array per channel)

### Merging Chunks

**File**: `/packages/studio/adapters/src/RingBuffer.ts`

```typescript
export const mergeChunkPlanes = (
    chunks: ReadonlyArray<ReadonlyArray<Float32Array>>,
    bufferSize: int,                          // 128
    maxFrames: int = Number.MAX_SAFE_INTEGER
): ReadonlyArray<Float32Array> => {
    if (chunks.length === 0) {return Arrays.empty()}

    const numChannels = chunks[0].length
    const numFrames = Math.min(bufferSize * chunks.length, maxFrames)

    return Arrays.create(channelIndex => {
        const outChannel = new Float32Array(numFrames)
        chunks.forEach((recordedChannels, chunkIndex) => {
            const recordedChannel = recordedChannels[channelIndex]
            const remaining = numFrames - chunkIndex * bufferSize
            outChannel.set(
                remaining < bufferSize
                    ? recordedChannel.slice(0, remaining)
                    : recordedChannel,
                chunkIndex * bufferSize
            )
        })
        return outChannel
    }, numChannels)
}
```

This utility combines multiple chunks into continuous channel buffers.

## Current Access to Recording Data

### During Recording

**File**: `/packages/studio/core/src/RecordingWorklet.ts`

The RecordingWorklet provides limited read-only access during recording:

```typescript
get numberOfFrames(): int {
    return this.#output.length * RenderQuantum  // Current sample count
}

get peaks(): Option<Peaks> {
    return this.#peaks.isEmpty() ? Option.wrap(this.#peakWriter) : this.#peaks
}
```

### Real-Time Chunk Processing Example

**File**: `/packages/studio/core/src/PeaksWriter.ts`

The PeaksWriter demonstrates how chunks are processed in real-time:

```typescript
// In RingBuffer reader callback:
if (this.numberOfFrames >= latencyInSamples) {
    this.#peakWriter.append(array)  // Process chunk
}

// PeaksWriter.append processes each chunk
append(frames: ReadonlyArray<Float32Array>): void {
    for (let channel = 0; channel < this.numChannels; ++channel) {
        // Calculate min/max peaks for visualization
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        for (let i = 0; i < RenderQuantum; ++i) {
            const frame = frames[channel][i]
            min = Math.min(frame, min)
            max = Math.max(frame, max)
        }
    }
}
```

This pattern could be extended for other real-time chunk processing needs.

## Proposed Approaches for Chunk Extraction

Since the infrastructure is already in place, here are four viable approaches to expose chunk extraction:

### Approach 1: Expose Chunk Array (Most Straightforward)

Add public methods to RecordingWorklet to access chunks:

```typescript
export class RecordingWorklet {
    private #lastExtractedIndex = 0

    /**
     * Get chunks collected since last call
     */
    getNewChunks(): Array<ReadonlyArray<Float32Array>> {
        const newChunks = this.#output.slice(this.#lastExtractedIndex)
        this.#lastExtractedIndex = this.#output.length
        return newChunks
    }

    /**
     * Get all chunks collected so far
     */
    getCurrentChunks(): Array<ReadonlyArray<Float32Array>> {
        return this.#output
    }
}
```

**Pros:**
- Simple and straightforward
- No additional architecture needed
- Minimal code changes

**Cons:**
- Requires polling
- Consumer must track when to read

### Approach 2: Chunk Callback Pattern

Register callbacks to receive chunks as they arrive:

```typescript
export class RecordingWorklet {
    readonly #chunkCallbacks: Set<(chunk: Array<Float32Array>) => void> = new Set()

    /**
     * Subscribe to chunk events
     * @returns Terminable to unsubscribe
     */
    onChunk(callback: (chunk: Array<Float32Array>) => void): Terminable {
        this.#chunkCallbacks.add(callback)
        return Terminable.create(() => this.#chunkCallbacks.delete(callback))
    }

    // In reader callback:
    // this.#chunkCallbacks.forEach(cb => cb(array))
}
```

**Pros:**
- Real-time notification
- Follows existing pattern (similar to PeaksWriter)
- No polling required

**Cons:**
- Slightly more complex
- Need to manage callback lifecycle

### Approach 3: Observable State Pattern (Already Partially Implemented)

Extend the existing subscription mechanism:

```typescript
recordingWorklet.subscribe((state: SampleLoaderState) => {
    if (state.type === "record") {
        const frames = recordingWorklet.numberOfFrames
        const peaks = recordingWorklet.peaks
        const newChunks = recordingWorklet.getNewChunks()
        // Process intermediate state
    }
})
```

**Pros:**
- Uses existing subscription infrastructure
- Consistent with current API design
- Easy to integrate with reactive patterns

**Cons:**
- Requires polling within subscription
- State updates may not align with chunk arrival

### Approach 4: Polling with Intervals

Query RecordingWorklet at regular intervals:

```typescript
const interval = setInterval(() => {
    const newChunks = recordingWorklet.getNewChunks()
    newChunks.forEach(chunk => {
        // Process chunk in real-time
        processingCallback(chunk)
    })
}, 100) // 100ms polling
```

**Pros:**
- Simple to implement
- Decoupled from recording internals

**Cons:**
- Potential delay in processing
- Less efficient than callbacks
- Need to manage interval lifecycle

## Technical Specifications

### Chunk Properties

- **Size**: 128 samples per chunk (fixed by Web Audio API RenderQuantum)
- **Buffer Capacity**: 128 chunks circular buffer
- **Total Buffered**: 128 × 128 = 16,384 samples
- **Duration at 48kHz**: ~0.341 seconds
- **Format**: `Array<Float32Array>` (planar audio)
- **Thread-Safe**: Yes (SharedArrayBuffer with atomic operations)
- **Latency Compensation**: Includes `audioContext.outputLatency`

### Recording State Lifecycle

```
1. initialize     → RingBuffer created with SharedArrayBuffer
2. start          → Chunks flow into #output array
3. during         → Chunks accessible (with proposed API)
4. finalization   → mergeChunkPlanes() combines all chunks
5. save           → AudioData stored with complete recording
```

## Current Limitations

1. **Private `#output` array**: Cannot directly access intermediate chunks from outside the class
2. **No real-time chunk callback**: PeaksWriter is an internal implementation detail
3. **Finalization-only state**: Data only transitions to "loaded" after recording ends
4. **Limited intermediate access**: Can only query `numberOfFrames` and `peaks` during recording
5. **No chunk streaming API**: No public interface for consuming chunks as they arrive

## Recommendations

Based on the analysis, here are the recommended implementation priorities:

### 1. Short Term: Expose Chunk Access (Approach 1)

Implement `getNewChunks()` and `getCurrentChunks()` methods on RecordingWorklet. This provides immediate value with minimal code changes.

**Estimated effort**: Low
**Impact**: High for basic use cases

### 2. Medium Term: Add Chunk Callbacks (Approach 2)

Implement `onChunk()` subscription method for real-time notification. This enables more advanced use cases like live streaming or real-time analysis.

**Estimated effort**: Medium
**Impact**: High for advanced use cases

### 3. Long Term: Streaming API

Design a comprehensive streaming API that integrates with the existing state management system.

**Estimated effort**: High
**Impact**: Medium (enables future features)

## Use Cases

Potential applications for chunk extraction during recording:

1. **Real-time audio analysis**: Process audio as it's recorded for level meters, spectrum analysis, etc.
2. **Live streaming**: Send chunks to remote endpoints during recording
3. **Incremental encoding**: Encode audio chunks progressively during recording
4. **Preview playback**: Play back recent audio while still recording
5. **Real-time effects**: Apply effects to incoming audio with low latency
6. **Storage optimization**: Write chunks to disk incrementally instead of storing entire recording in memory

## Conclusion

**Is it possible to extract chunks of an AudioBuffer during recording in OpenDAW?**

**Yes, absolutely.** The architecture already supports it through:

- ✅ Real-time ring buffer with 128-chunk capacity
- ✅ Callback architecture for chunk processing (demonstrated by PeaksWriter)
- ✅ Thread-safe SharedArrayBuffer implementation
- ✅ Atomic read/write operations preventing data races
- ✅ Internal storage of chunks in chronological order

The only requirement is to expose the existing internal chunk collection through a public API. The infrastructure is production-ready and battle-tested - it just needs to be surfaced to consumers.

## References

### Related Files

- Recording lifecycle: `/packages/studio/core/src/capture/RecordAudio.ts`
- Chunk management: `/packages/studio/core/src/RecordingWorklet.ts`
- Ring buffer: `/packages/studio/adapters/src/RingBuffer.ts`
- Audio processor: `/packages/studio/core-processors/src/RecordingProcessor.ts`
- Chunk processing example: `/packages/studio/core/src/PeaksWriter.ts`
- Buffer utilities: `/packages/lib/dsp/src/AudioBuffer.ts`

### Related Documentation

- [08-recording-and-live-peaks.md](./08-recording-and-live-peaks.md) - Recording and peak visualization
- [05-sample-management-and-peaks.md](./05-sample-management-and-peaks.md) - Sample data structures
