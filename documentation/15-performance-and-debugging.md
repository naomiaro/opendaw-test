# Performance and Debugging

> **Skip if:** your app feels fast on every browser you care about. Come back when it doesn't.
>
> **Prerequisites:** [Ch. 03 (AnimationFrame)](./03-animation-frame.md), [Ch. 04 (Box System)](./04-box-system-and-reactivity.md). Familiarity with browser DevTools.

When something feels slow, the question is *which thread is the bottleneck*: the audio thread (causes dropouts), the main thread (causes UI jank), or a Web Worker (causes loading hangs). They have separate symptoms and separate fixes.

## Where the time goes

A 30-second video of a working DAW UI typically spends about:

- **~50% on the main thread** rendering React/canvas, dispatching observable callbacks, handling input.
- **~30% on the audio thread** in the `EngineProcessor`'s render loop.
- **~15% on workers** decoding samples, generating peaks, doing OPFS reads.
- **~5% on disk and network** I/O.

If yours doesn't look like that — and you're not deliberately doing something different — one of those budgets is being abused.

## Diagnosing audio dropouts

Symptoms: clicks, glitches, "buzz" during playback, choppy meters, console messages about underruns.

### Step 1: enable the DSP load meter

The engine has a built-in timer that measures how long each `process()` call takes versus the audio-thread budget. Enable it:

```typescript
project.engine.preferences.settings.debug.dspLoadMeasurement = true;
```

Then read the value at any time:

```typescript
const load = project.engine.cpuLoad.getValue();
console.log(`DSP load: ${(load * 100).toFixed(1)}%`);
```

- **< 0.5** — comfortable headroom.
- **0.5 – 0.9** — running hot; investigate.
- **≥ 1.0** — the audio thread is overrunning. You will hear dropouts.

The meter is implemented with the `HRClock` worker that signals across a `SharedArrayBuffer` ([internals/03 — HRClock](./internals/03-cross-thread-protocols.md#hrclock--high-resolution-timing-via-atomicswaitnotify)).

### Step 2: bisect the chain

When the load is too high, the question is *which device*. The fastest way to find out:

1. Mute every track. Confirm load drops to near zero.
2. Solo each track in turn. Note which one spikes the load.
3. Within that track, disable each effect in sequence — same bisection.

If a single effect crosses the threshold by itself, you've found it. Three common culprits in user apps:

- **Convolution reverb** with a very long impulse response.
- **Neural Amp Modeler** running multiple instances of the same model.
- **A modular device** with an inefficient user script.

### Step 3: freeze the offender

If you can't avoid the cost, freeze the track. Freezing renders the chain offline once and plays back the buffer in real time instead of running the effects on every quantum. See [internals/06 — track freeze](./internals/06-project-and-persistence.md#track-freeze) for the mechanism, [Ch. 11](./11-effects.md) for the UI surface.

### Step 4: check sample rate

Higher sample rates linearly increase audio-thread work. 48 kHz is the default. 96 kHz doubles the cost of every DSP loop without doubling the audible benefit. If you're running 96 kHz "for quality", confirm you actually need it — most material is recorded at 48 kHz and the chain gets resampled either way.

### Step 5: rule out the host

A common false positive: a fan-throttled laptop on battery. The audio thread is the same code; the CPU has less budget. Plug the laptop in, set the OS power mode to "high performance", and re-measure before assuming the SDK is at fault.

## Diagnosing main-thread jank

Symptoms: scrolling stutters, dragging clips lags, the playhead skips frames during scroll.

### Profile in the browser

Chrome DevTools → Performance → record 10 seconds of the interaction. Look for:

- **Long tasks** (> 50 ms purple bars). They block paint. Find the call stack at the top.
- **High "Scripting" time per frame** — usually a re-render storm.
- **Reflow or layout thrashing** — interleaved DOM read/write patterns.

Most main-thread jank traces back to **too much re-rendering**.

### Common re-render storms

| Symptom | Cause | Fix |
|---|---|---|
| Every observable update triggers a React re-render of the whole timeline | Subscribing in a high-level component | Subscribe in the component that actually uses the value |
| Playhead updates re-render every clip | Reading `position` in clip components | Read `position` once at the timeline root, pass via context, or use the imperative DOM update for the playhead only |
| Drag operation lags as the drag continues | Calling `editing.modify()` on every mousemove | Batch into one `modify()` on mouseup; previewing meanwhile with local React state, not the box graph |
| Volume slider feels sluggish | Subscribing to `audioUnitBox.volume` in many components | Subscribe at one root; use uncontrolled sliders backed by `requestAnimationFrame` |

### The "imperative escape hatch"

For things that change every frame (playhead, meters, scroll-driven previews), bypass React. Set the DOM property directly inside an `AnimationFrame.add(...)` callback:

```typescript
useEffect(() => {
  const sub = AnimationFrame.add(() => {
    const x = positionToPixels(project.engine.position.getValue());
    playheadRef.current.style.transform = `translateX(${x}px)`;
  });
  return () => sub.terminate();
}, [project]);
```

This avoids reconciler overhead. React-controlled state is fine for "the playhead changed from stopped to playing" (rare); imperative is right for "the playhead moved one pixel" (every frame).

### Memoise canvas draws

If you're drawing waveforms on a canvas:

1. Draw once into an offscreen `<canvas>` per region. Use `CanvasPattern` or `drawImage()` to paint it into the visible canvas during scroll.
2. Re-draw the offscreen canvas only when the region's audio changes, *not* when the timeline scrolls.
3. For very zoomed-in views (sub-pixel sample detail), draw at higher resolution and let the GPU scale.

`PeaksPainter` already supports this pattern; what kills it is consumers that recompute the offscreen canvas on every scroll event.

## Diagnosing loader hangs

Symptoms: project opens but stays loading forever; tracks don't start when you press play; samples missing from the waveform view.

### Check the loader state

`sampleLoader.state` is observable:

```typescript
project.sampleManager.getOrCreate(uuid).subscribe(state => {
  console.log(state.type, state);
});
```

Possible states ([Ch. 05 / internals/04](./05-samples-peaks-and-looping.md)):

- `progress` with `progress: 0 → 1` — loading, normal.
- `error` with a `reason` — the sample failed; it'll be silent at playback.
- `loaded` — ready.

If you see *no* state changes after several seconds, the worker probably hung. Open DevTools → Application → Service Workers (and Storage → OPFS) to confirm OPFS isn't full and the worker is alive.

### `queryLoadingComplete()` for deterministic startup

Use this if your UX requires "everything is ready before play":

```typescript
const allReady = await project.engine.queryLoadingComplete();
if (allReady) project.engine.play();
```

The Promise resolves once every pending resource (every sample, every soundfont, NAM WASM, …) has finished. Don't `await` it on every play — only on initial project open, before the user starts interacting.

### Stuck imports

If `SampleService.importFile()` never resolves, the most common causes:

- **The file is unsupported.** `WavFile.decodeFloats()` covers WAV; `AudioContext.decodeAudioData()` covers MP3/AAC/OGG/FLAC/Opus. A `.aiff` file in Safari can fail both paths.
- **OPFS quota.** `navigator.storage.estimate()` will tell you. If you're near the limit, the write fails silently inside the worker.
- **Peaks worker died.** If a worker threw and you didn't catch it, subsequent imports queue forever. Reload the page (the worker pool is recreated on init).

## Memory leaks

Symptoms: tab memory grows over time, eventually crashes; project loads get slower with each open.

### Find unterminated subscriptions

Every `subscribe()` call returns a `Subscription`. Every one of them must be `terminate()`d when the subscriber goes away. The most common leak source:

```typescript
// ❌ leaks one subscription per render
useEffect(() => {
  observable.subscribe(...);
});

// ✅ cleaned up on unmount
useEffect(() => {
  const sub = observable.subscribe(...);
  return () => sub.terminate();
}, []);
```

Use Chrome DevTools → Memory → "Allocations on timeline" to find what's growing. If `Subscription` instances grow without bound, you've found the family.

### Forgotten box adapter `register`/`terminate` pairs

Adapters call `sampleManager.register(uuid)` to retain their sample in the loader cache. The returned `Terminable` must be `terminate()`d when the adapter goes away — otherwise the sample lives in memory forever. Adapter implementations handle this via their `Terminator`; if you build your own adapter, follow the pattern:

```typescript
this.#terminator.own(this.#context.sampleManager.register(uuid));
```

### Canvas references held by closures

If your render loop captures a `<canvas>` element in a closure that's still subscribed to an observable, the canvas (and its bitmap) can't be GC'd. Same fix as above: clean up the subscription, and consider using a `ref` rather than a captured node.

## Project-size hygiene

Large projects (hundreds of tracks, thousands of regions) develop their own performance characteristics. A few practical limits:

| Resource | Typical comfort | Hard limit |
|---|---|---|
| Audio tracks | ≤ 60 | ~250 before noticeable lag |
| Effects per track | ≤ 8 | depends entirely on the effects |
| Total regions | ≤ 5,000 | ~50,000 before transactions take seconds |
| Automation events per lane | ≤ 1,000 | ~100,000 before scroll-time evaluation cost is visible |
| OPFS quota use | < 5 GB | browser-dependent |

If you're over the comfort number on one axis, prioritise mitigations:

- **Many tracks** — group routing reduces effect-chain count: send several tracks to one aux bus that holds the effect.
- **Many regions** — consolidate (bounce to a single audio file) for sections that no longer need editing. See [Ch. 09 — region consolidation](./09-editing-fades-and-automation.md).
- **Many automation events** — use larger interpolation gaps. The engine evaluates the curve sample-accurately at event boundaries; fewer events means less work per render quantum.

## Debugging engine state

### Read the synced state directly

The audio worklet writes its state every render quantum to a `SharedArrayBuffer`. The main thread's `project.engine` exposes these as `Observable`s. To dump them all at once:

```typescript
console.log({
  isPlaying: project.engine.isPlaying.getValue(),
  position: project.engine.position.getValue(),
  bpm: project.engine.bpm.getValue(),
  isRecording: project.engine.isRecording.getValue(),
  isCountingIn: project.engine.isCountingIn.getValue(),
  perfIndex: project.engine.perfIndex,
});
```

If any value is stuck or impossible, the worklet has either crashed or detached. Check the console — a worklet exception is logged via `engineToClient.error()` and shows up as a regular console error on the main thread.

### Trace box mutations

For "why did this field change?", subscribe with logging:

```typescript
box.someField.subscribe(field => {
  console.trace("Field changed to", field.getValue());
});
```

`console.trace` includes the stack trace — points you straight at the mutation site.

### Diff the box graph between two points in time

For "what changed when I clicked X?", capture the graph state before and after:

```typescript
const before = project.boxGraph.toArrayBuffer();
// ... user action ...
const after = project.boxGraph.toArrayBuffer();
console.log(`Before: ${before.byteLength}, After: ${after.byteLength}, diff: ${after.byteLength - before.byteLength} bytes`);
```

Not a structural diff, but a quick sanity check that *something* changed. For a true structural diff, write the box updates collected by `editing.modify()` to a log and replay.

## What "fast" looks like in production

For a final reference, here's what a healthy openDAW app looks like at peak:

- DSP load < 0.6 with all effects on.
- Main-thread frame time < 8 ms (sustained 120 fps headroom).
- Project save < 250 ms for an average-sized project.
- Sample import (10-second WAV) < 200 ms including peaks generation.
- Cold project open < 1 s after the page has loaded.

If you're missing more than one of those by a wide margin, this chapter's diagnostics should narrow down which thread or worker is the bottleneck. The [Troubleshooting & FAQ](./13-troubleshooting.md) chapter covers fixes for the most common symptoms; this chapter covers the *measurement* side of "is it me or is it the SDK?".
