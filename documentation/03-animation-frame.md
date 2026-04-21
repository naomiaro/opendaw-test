# AnimationFrame: The Observable Update Loop

## Critical Concept

**⚠️ IMPORTANT:** OpenDAW's observables will **not work** without AnimationFrame.

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

### Why OpenDAW Needs This

Most Web Audio applications connect native `AudioNode` objects together and let the browser manage timing. OpenDAW takes a different approach — it runs its own audio engine inside an `AudioWorklet`, processing audio sample-by-sample in custom code. This gives the engine full control over scheduling, effects, and mixing, but it also means the browser has no built-in way to report engine state (playback position, transport state, recording status) back to the UI. AnimationFrame bridges that gap.

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
                                   UI updates
```

JavaScript can't directly share data between threads. OpenDAW solves this with `SharedArrayBuffer` — the audio worklet writes state, and AnimationFrame reads it every frame (~60fps), updating observables that your UI subscribes to.

## API

### `AnimationFrame.start(window)`

Starts the update loop. Call this **once**, before creating the project.

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

AnimationFrame.start(window);

// Then create project
const project = Project.new({ /* ... */ });
```

### `observable.subscribe()` — Discrete State Changes

Fires when a value changes. Use for state that transitions occasionally (play/stop, BPM, mute).

```typescript
const sub = project.engine.isPlaying.subscribe(obs => {
  setIsPlaying(obs.getValue());
});

// Cleanup when done
sub.terminate();
```

Use `catchupAndSubscribe()` instead of `subscribe()` to also receive the current value immediately.

### `AnimationFrame.add()` — Continuous Updates

Runs a callback every frame (~60fps). Use for values that change continuously (playhead position, audio levels, meters).

```typescript
const sub = AnimationFrame.add(() => {
  setPosition(project.engine.position.getValue());
});

// Cleanup when done
sub.terminate();
```

Don't subscribe to position via `observable.subscribe()` — it fires too frequently. `AnimationFrame.add()` naturally throttles to 60fps.

### Putting It Together

```typescript
// Discrete state — catchup gets initial value, then fires on transitions
const playingSub = project.engine.isPlaying.catchupAndSubscribe(obs => {
  setIsPlaying(obs.getValue());
});

const recordingSub = project.engine.isRecording.catchupAndSubscribe(obs => {
  setIsRecording(obs.getValue());
});

// Continuous state — fires every frame
const positionSub = AnimationFrame.add(() => {
  setPosition(project.engine.position.getValue());
});

// Cleanup all
playingSub.terminate();
recordingSub.terminate();
positionSub.terminate();
```

## Debugging

### Observables never fire

AnimationFrame wasn't started, or was started after the project was created. Ensure `AnimationFrame.start(window)` is called before `Project.new()`.

### Position doesn't update

You're probably subscribing to the position observable directly. Use `AnimationFrame.add()` instead — see [Continuous Updates](#animationframeadd--continuous-updates) above.

### "SharedArrayBuffer is not defined"

Your server needs cross-origin isolation headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Framework Integration Pitfalls

> The examples below use React, but the same principles apply to any framework with batched or asynchronous rendering.

### Don't Gate AnimationFrame on UI State via Refs

Frameworks that batch state updates (React, Vue, Solid) can skip intermediate renders. If you store a value during render and check it inside an AnimationFrame callback, the callback may never see the intermediate value:

```typescript
// ❌ BAD — the framework may batch "finalizing"→"ready"→"recording" into one render,
// so the ref goes from true → true (never false). The AnimationFrame misses
// the transition and never renders peaks on the second recording.
const shouldRenderRef = useRef(session.shouldMonitorPeaks);
shouldRenderRef.current = session.shouldMonitorPeaks; // assigned during render

const sub = AnimationFrame.add(() => {
  if (!shouldRenderRef.current) return; // may stay false due to batching
  renderPeaks();
});

// ✅ GOOD — run unconditionally; when there's nothing to render it's a no-op
const sub = AnimationFrame.add(() => {
  const trackState = trackPeaksRef.current.get(i);
  if (!trackState?.sampleLoader) return; // natural guard — no data, no work
  renderPeaks(trackState);
});
```

### Use AnimationFrame for Rendering, Not Structural Discovery

Use SDK subscriptions (`catchupAndSubscribe`, adapter layer) to discover structural changes (new regions, tracks). Use AnimationFrame only to read continuously-changing values (peaks, position) for rendering.

```typescript
// ❌ BAD — scans entire box graph every frame
AnimationFrame.add(() => {
  const boxes = project.boxGraph.boxes();
  for (const box of boxes) { /* discover regions */ }
});

// ✅ GOOD — adapter subscriptions for discovery, AnimationFrame for rendering
audioUnitAdapter.tracks.catchupAndSubscribe({
  onAdd: (trackAdapter) => { /* discover tracks reactively */ }
});
AnimationFrame.add(() => {
  /* read peaks from already-discovered loaders */
});
```

## Summary

1. **`AnimationFrame.start(window)`** — call once, before creating the project
2. **`observable.subscribe()`** — for discrete state changes (play/stop, BPM)
3. **`AnimationFrame.add()`** — for continuous values (position, levels)
4. **Always terminate** subscriptions when your component unmounts
