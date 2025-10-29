# AnimationFrame: The Observable Update Loop

## Critical Concept

**⚠️ IMPORTANT:** OpenDAW's observables will **not work** without AnimationFrame. This is the most common mistake when integrating OpenDAW!

```typescript
// ❌ WITHOUT AnimationFrame.start()
project.engine.play(); // Audio plays
project.engine.isPlaying.subscribe(obs => {
  console.log(obs.getValue()); // NEVER FIRES! Still shows false
});

// ✅ WITH AnimationFrame.start()
AnimationFrame.start(window); // REQUIRED!
project.engine.play(); // Audio plays
project.engine.isPlaying.subscribe(obs => {
  console.log(obs.getValue()); // ✓ Fires! Shows true
});
```

## What is AnimationFrame?

AnimationFrame is OpenDAW's mechanism for syncing real-time audio state from the **audio worklet thread** to the **main thread** where your UI runs.

### The Problem It Solves

Web audio processing happens in a separate thread (AudioWorkletGlobalScope) for performance:

```
Main Thread (UI)              Audio Worklet Thread
─────────────────             ────────────────────
React Components              Audio Processing
  │                              │
  │  How does UI know           │  Playing audio
  │  audio is playing?           │  at 120 BPM
  │                              │  Position: 3840 PPQN
  │  Need to sync! ──────────────┤
  │                              │
  ▼                              ▼
```

**Problem:** JavaScript can't directly share data between threads.

**Solution:** OpenDAW uses `SharedArrayBuffer` + AnimationFrame polling.

## How It Works

### Architecture

```
AudioWorklet Thread                Main Thread
───────────────────                ───────────
Engine processes audio             AnimationFrame loop (60fps)
    ↓                                  ↓
Writes to SharedArrayBuffer        Reads from SharedArrayBuffer
    ↓                                  ↓
[position: 3840]                   position observable updates
[isPlaying: true]                  isPlaying observable updates
[isRecording: false]               isRecording observable updates
    ↓                                  ↓
                                   React components re-render
```

### The Update Loop

```typescript
// What AnimationFrame does internally (simplified)
AnimationFrame.start(window);

// This creates a loop:
function loop() {
  // 1. Read from SharedArrayBuffer (written by audio worklet)
  const audioState = readFromSharedBuffer();

  // 2. Update observables
  project.engine.position.notify(audioState.position);
  project.engine.isPlaying.notify(audioState.isPlaying);
  project.engine.isRecording.notify(audioState.isRecording);

  // 3. All subscribers get notified → React re-renders

  // 4. Loop again next frame (60fps)
  window.requestAnimationFrame(loop);
}

loop(); // Start
```

## Required Setup

### Step 1: Start the Loop

**This MUST be called before creating the project:**

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

// ✅ Call this early in your app initialization
AnimationFrame.start(window);

// Then create project
const project = Project.new({ /* ... */ });
```

### Step 2: Subscribe to Observables

Now observables will actually update:

```typescript
// Subscribe to playing state
const subscription = project.engine.isPlaying.subscribe(obs => {
  const playing = obs.getValue();
  console.log("Playing:", playing); // ✓ Works!
  setIsPlaying(playing); // Update React state
});

// Don't forget to clean up
subscription.terminate();
```

## Common Usage Patterns

### Pattern 1: Playback State

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

function App() {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // Subscribe to engine state
    const sub = project.engine.isPlaying.catchupAndSubscribe(obs => {
      setIsPlaying(obs.getValue());
    });

    return () => sub.terminate();
  }, [project]);

  // isPlaying now updates automatically when audio starts/stops!
}
```

### Pattern 2: Position Tracking

For rapidly updating values like position, subscribe via AnimationFrame directly to avoid excessive React renders:

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

function Timeline() {
  const [currentPosition, setCurrentPosition] = useState(0);

  useEffect(() => {
    // Instead of subscribing to observable directly:
    // const sub = project.engine.position.subscribe(...) // Too many updates!

    // ✅ Better: throttle to 60fps
    const sub = AnimationFrame.add(() => {
      setCurrentPosition(project.engine.position.getValue());
    });

    return () => sub.terminate();
  }, [project]);

  // currentPosition updates at 60fps, not thousands of times per second!
}
```

### Pattern 3: Multiple Observables

```typescript
useEffect(() => {
  const playingSub = project.engine.isPlaying.subscribe(obs => {
    setIsPlaying(obs.getValue());
  });

  const recordingSub = project.engine.isRecording.subscribe(obs => {
    setIsRecording(obs.getValue());
  });

  const positionSub = AnimationFrame.add(() => {
    setPosition(project.engine.position.getValue());
  });

  return () => {
    playingSub.terminate();
    recordingSub.terminate();
    positionSub.terminate();
  };
}, [project]);
```

## AnimationFrame API

### `AnimationFrame.start(window)`

Starts the update loop. Call this **once** during app initialization.

```typescript
// In your initialization code
AnimationFrame.start(window);
```

**When to call:**
- Before creating the OpenDAW project
- Early in your app's lifecycle
- Only call once (calling multiple times is safe but unnecessary)

### `AnimationFrame.add(callback)`

Register a callback to run every frame (60fps).

```typescript
const subscription = AnimationFrame.add(() => {
  // This runs ~60 times per second
  const position = project.engine.position.getValue();
  updateUI(position);
});

// Cleanup when done
subscription.terminate();
```

**Use cases:**
- Position tracking for playhead
- Real-time meter/level displays
- Animation that syncs with audio

### Observable.subscribe()

Subscribe to state changes (fires when value changes).

```typescript
const subscription = observable.subscribe(obs => {
  const value = obs.getValue();
  // Handle change
});

subscription.terminate();
```

**Use cases:**
- Playback state changes (play/stop)
- Recording state changes
- BPM changes
- Any state that changes occasionally (not continuously)

## Why Two Different Approaches?

### Observable.subscribe() - For Discrete Changes

```typescript
// Fires only when state CHANGES
project.engine.isPlaying.subscribe(obs => {
  console.log(obs.getValue());
});

// User clicks play → Fires once (false → true)
// User clicks stop → Fires once (true → false)
// While playing → Doesn't fire
```

**Use when:**
- Value changes occasionally
- You want to react to specific state transitions
- Examples: play/stop, BPM changes, track mute

### AnimationFrame.add() - For Continuous Updates

```typescript
// Fires EVERY FRAME (~60fps)
AnimationFrame.add(() => {
  const position = project.engine.position.getValue();
  console.log(position);
});

// While playing:
// Frame 1: 960
// Frame 2: 1020
// Frame 3: 1080
// ... (60 times per second)
```

**Use when:**
- Value changes continuously
- You need smooth animation
- Examples: playhead position, audio levels, meters

## Complete Initialization Example

```typescript
// src/lib/projectSetup.ts
import { AnimationFrame } from "@opendaw/lib-dom";
import { Workers, AudioWorklets, Project } from "@opendaw/studio-core";

export async function initializeOpenDAW() {
  console.log("Initializing OpenDAW...");

  // STEP 1: Start AnimationFrame loop (CRITICAL!)
  console.log("Starting AnimationFrame...");
  AnimationFrame.start(window);

  // STEP 2: Install workers and worklets
  console.log("Installing workers...");
  await Workers.install("/workers-main.js");
  AudioWorklets.install("/processors.js");

  // STEP 3: Create AudioContext
  const audioContext = new AudioContext({ latencyHint: 0 });

  // STEP 4: Create worklets
  await AudioWorklets.createFor(audioContext);

  // STEP 5: Create project
  const project = Project.new({
    audioContext,
    sampleManager,
    soundfontManager,
    audioWorklets: AudioWorklets.get(audioContext)
  });

  // STEP 6: Start audio worklet
  project.startAudioWorklet();
  await project.engine.isReady();

  console.log("OpenDAW ready!");

  return { project, audioContext };
}
```

## Debugging AnimationFrame Issues

### Problem: Observables never fire

```typescript
// Check if AnimationFrame was started
project.engine.play();

setTimeout(() => {
  console.log("Playing?", project.engine.isPlaying.getValue());
  // If this shows false but audio is playing → AnimationFrame not started!
}, 1000);
```

**Solution:**
```typescript
// Add this BEFORE creating project
AnimationFrame.start(window);
```

### Problem: Position doesn't update

```typescript
// Bad: Direct subscription to position
project.engine.position.subscribe(obs => {
  setPosition(obs.getValue()); // Fires too often or not at all
});

// Good: Use AnimationFrame throttling
AnimationFrame.add(() => {
  setPosition(project.engine.position.getValue());
});
```

### Problem: "SharedArrayBuffer is not defined"

**Solution:** Ensure cross-origin isolation headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers are required for SharedArrayBuffer, which AnimationFrame uses.

## Performance Considerations

### Good: Throttled Position Updates

```typescript
// ✅ Updates at 60fps (smooth, not excessive)
const sub = AnimationFrame.add(() => {
  setPosition(project.engine.position.getValue());
});
```

### Bad: Unthrottled Updates

```typescript
// ❌ Could fire thousands of times per second
const sub = project.engine.position.subscribe(obs => {
  setPosition(obs.getValue());
});
```

### Good: Memoize Expensive Calculations

```typescript
const sub = AnimationFrame.add(() => {
  const position = project.engine.position.getValue();

  // Only recalculate if position changed
  if (position !== lastPosition) {
    const pixels = (position / totalDuration) * width;
    updatePlayhead(pixels);
    lastPosition = position;
  }
});
```

## Common Mistakes

### Mistake 1: Forgetting to Start

```typescript
// ❌ Forgot to start AnimationFrame
const project = Project.new({ /* ... */ });

project.engine.isPlaying.subscribe(obs => {
  console.log(obs.getValue()); // NEVER FIRES!
});
```

### Mistake 2: Starting Too Late

```typescript
// ❌ Started after project creation
const project = Project.new({ /* ... */ });
AnimationFrame.start(window); // Too late!
```

### Mistake 3: Not Cleaning Up

```typescript
// ❌ Memory leak - subscription never terminated
useEffect(() => {
  AnimationFrame.add(() => {
    updateUI(project.engine.position.getValue());
  });
  // Missing cleanup!
}, []);

// ✅ Proper cleanup
useEffect(() => {
  const sub = AnimationFrame.add(() => {
    updateUI(project.engine.position.getValue());
  });

  return () => sub.terminate();
}, []);
```

## Summary

### Key Points

1. **AnimationFrame is required** for OpenDAW observables to work
2. **Call `AnimationFrame.start(window)`** before creating the project
3. **Use `AnimationFrame.add()`** for high-frequency updates (position)
4. **Use `observable.subscribe()`** for discrete state changes (play/stop)
5. **Always clean up** subscriptions in React useEffect returns

### Essential Pattern

```typescript
// 1. Start AnimationFrame (once, early)
AnimationFrame.start(window);

// 2. Create project
const project = await initializeOpenDAW();

// 3. Subscribe to state (in React)
useEffect(() => {
  // Discrete state
  const playingSub = project.engine.isPlaying.subscribe(obs => {
    setIsPlaying(obs.getValue());
  });

  // Continuous state
  const positionSub = AnimationFrame.add(() => {
    setPosition(project.engine.position.getValue());
  });

  // Cleanup
  return () => {
    playingSub.terminate();
    positionSub.terminate();
  };
}, [project]);
```

### Mental Model

Think of AnimationFrame as the **bridge** between the audio world and the UI world:

```
Audio World                 Bridge                    UI World
───────────                ─────────                 ─────────
Audio Worklet    ←→    SharedArrayBuffer    ←→    Main Thread
(processing)           (AnimationFrame          (React UI)
                        reads every frame)
```

Without this bridge, your UI has no way to know what the audio is doing!

## Next Steps

With AnimationFrame understood, you're ready to build reactive UIs that stay in sync with OpenDAW's audio engine. See the other documentation for building timelines, waveforms, and complete DAW interfaces.
