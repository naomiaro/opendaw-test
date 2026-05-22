# Troubleshooting & FAQ

> **Skip if:** everything works and you're just exploring. This chapter is for when it doesn't.
>
> **Prerequisites:** [Ch. 01 (Introduction)](./01-introduction.md) and [Ch. 03 (AnimationFrame)](./03-animation-frame.md) are the most-referenced.

Common issues, grouped by symptom. Find the heading that matches your problem, follow the diagnostic checklist, and stop reading when something fixes it.

## "The engine won't start"

The engine throws on initialization or the worklet never reaches the `ready` state.

### Symptom: `SharedArrayBuffer is not defined`

Your page isn't cross-origin isolated. OpenDAW needs:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

on every response (HTML, JS, workers, fonts, images). In Vite dev:

```typescript
// vite.config.ts
server: {
  headers: {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  }
}
```

In production behind Cloudflare/Vercel/Nginx, set the same headers on the static files endpoint. See [Ch. 12 — Browser Compatibility](./12-browser-compatibility.md) for the full headers-and-iframes story.

### Symptom: `AudioContext was not allowed to start`

A modern browser policy: an `AudioContext` only starts after a user gesture (click, key press). The fix is to resume it inside the click handler that starts playback:

```typescript
const handlePlayClick = async () => {
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  project.engine.play();
};
```

Calling `audioContext.resume()` *before* any user gesture is a no-op in current Chrome/Edge/Safari.

### Symptom: dev server won't load over HTTP

You need HTTPS for `SharedArrayBuffer` to be constructable in most browsers. Generate a local cert with `mkcert` (most setups do this once with `npm run cert` or similar), then point Vite at it:

```typescript
// vite.config.ts
import { readFileSync } from "fs";

export default {
  server: {
    https: {
      key: readFileSync("./certs/localhost-key.pem"),
      cert: readFileSync("./certs/localhost.pem"),
    },
  },
};
```

Browse to `https://localhost:5173` (or whatever port). Accept the cert prompt once and you're set.

### Symptom: `Failed to fetch worker`

The studio-core ships its workers as separate ESM files (`workers-main.js`, `processors.js`, `offline-engine.js`) loaded by URL. The setup helper uses Vite's `?worker&url` import syntax:

```typescript
import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url";
import WorkletsUrl from "@opendaw/studio-core/processors.js?url";
import OfflineEngineUrl from "@opendaw/studio-core/offline-engine.js?worker&url";
```

If you're not using Vite, you'll need an equivalent for your bundler (webpack's `new URL(...)`, esbuild's plugin, etc.). The URLs must end up reachable by the browser.

## "No sound plays"

The engine started but you don't hear anything.

### Checklist (in order)

1. **`audioContext.state === "running"`** — if it's `"suspended"`, you need a user gesture.
2. **Sample finished loading** — the audio thread plays silence for clips whose sample is still loading. Either:
   - `await project.engine.queryLoadingComplete()` before `play()`, or
   - subscribe to `sampleLoader.state` and only start playback after `"loaded"`.
3. **Output device** — confirm the system output device is what you expect. Browser tabs sometimes route to a different default than the OS.
4. **Track not muted, no other track soloed** — check `audioUnitBox.mute.getValue()` and `audioUnitBox.solo.getValue()`. If *any* track is solo'd, all non-solo tracks go silent ([Ch. 05 internals — channel strip](./internals/05-devices-and-effects.md#channel-strip-and-aux-sends)).
5. **Volume not at −∞** — `volume` on the channel strip is in dB; very negative values are inaudible. Default is `0` (unity gain).
6. **Region inside the loop bounds** — if you have a loop region active and your clip is outside it, you'll never hear it.
7. **Tape track points at an `AudioFileBox` with a valid sample** — if `loaderState === "error"`, the file failed to load and the track plays silence.

If steps 1–7 check out, open Chrome DevTools → `chrome://media-internals` while pressing play. It logs the actual audio output node tree.

## "My UI doesn't update during playback"

The playhead doesn't move, meters don't animate, or button states stay stale.

### `AnimationFrame.start(window)` wasn't called

This is the #1 cause. The `initializeOpenDAW()` helper handles it; if you're not using the helper, you must call it yourself, once, near app startup:

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

AnimationFrame.start(window);
```

Without this, `Observable.subscribe()` callbacks fire on transition (correct), but anything polling via `AnimationFrame.add(...)` (the playhead position) never ticks. See [Ch. 03 — AnimationFrame](./03-animation-frame.md) for the why.

### You're subscribing but not catching up

`Observable.subscribe(observer)` fires *on change*. If the value is already what you want when you subscribe, the observer never runs. Use `catchupAndSubscribe(observer)`:

```typescript
// ❌ Late subscriber misses the initial value
project.engine.isPlaying.subscribe(obs => setIsPlaying(obs.getValue()));

// ✅ Late subscriber gets the current value immediately
project.engine.isPlaying.catchupAndSubscribe(obs => setIsPlaying(obs.getValue()));
```

### Your subscription leaked

`subscribe()` returns a `Subscription` (with `.terminate()`). React's `useEffect` cleanup must call it:

```typescript
useEffect(() => {
  const sub = project.engine.isPlaying.catchupAndSubscribe(obs =>
    setIsPlaying(obs.getValue())
  );
  return () => sub.terminate();
}, [project]);
```

Without `terminate()`, swapping projects leaves stale subscribers wired to the old project, and your UI shows old data.

## "Clips are in the wrong place"

### Mixing seconds and PPQN

PPQN is musical time. Seconds is wall-clock time. They convert through BPM:

```typescript
import { PPQN } from "@opendaw/lib-dsp";

const ppqn = PPQN.secondsToPulses(durationInSeconds, bpm);
const seconds = PPQN.pulsesToSeconds(ppqnDuration, bpm);
```

If your project has *tempo automation*, single-BPM conversions are wrong. Use `project.tempoMap`:

```typescript
const seconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
```

See [Ch. 02 — Timing & Tempo](./02-timing-and-tempo.md).

### Forgetting `Math.round` on PPQN

`PPQN.secondsToPulses()` returns a `float`. `AudioRegionBox.position` is an `Int32`. Setting a float either truncates or causes subtle drift between adjacent regions:

```typescript
// ❌ may misalign
box.position.setValue(PPQN.secondsToPulses(seconds, bpm));

// ✅ safe
box.position.setValue(Math.round(PPQN.secondsToPulses(seconds, bpm)));
```

`duration`, `loopOffset`, and `loopDuration` are `Float32` but should still be integer-rounded in Musical timebase to keep loop seams clean.

### Playhead "jumps" on tempo change

Setting BPM is fine while stopped, but if you change BPM during playback the playhead position in **seconds** changes (same PPQN, different wall time). Some UIs read out playback in seconds and panic. Either display position in PPQN (musical time), or re-derive seconds on every animation frame from the live BPM via the tempo map.

## "Waveforms don't render"

### The peaks aren't loaded yet

`sampleLoader.peaks` is `Option<Peaks>`. It's `None` while loading. Render-time code must guard:

```typescript
sampleLoader.subscribe(state => {
  if (state.type === "loaded") {
    sampleLoader.peaks.ifSome(peaks => drawWaveform(peaks));
  }
});
```

### `PeaksPainter` is being given the wrong stage

`Peaks.nearest(unitsPerPixel)` picks the right downsample level for the current zoom. If you pass `peaks.stages[0]` directly at a zoomed-out view, you'll draw 125,000 peaks across 300 pixels — slow and wrong. Always use `nearest()`.

### Peaks file is corrupt

The OPFS storage layer self-heals corrupt peaks ([Ch. 04 — Sample Loading internals](./internals/04-sample-loading.md#corruption-recovery)). If you see `peaks.bin is corrupted for ... regenerating` in the console, the recovery worked — the next load is fresh.

## "Export is silent or incomplete"

### Silent export

- **No track is unmuted** — `OfflineEngineRenderer` honours mute/solo. If a solo is active when you start export, only the solo'd track is in the result.
- **Silence detector cut early** — the default is "stop after 10 seconds below −72 dB". A very quiet outro can hit this prematurely. Adjust:

  ```typescript
  await renderer.render({
    silenceThresholdDb: -90,
    silenceDurationSeconds: 30,
    maxDurationSeconds: 600,
  });
  ```
- **Range is wrong** — if you pass an `ExportConfiguration.range = { start, end }`, double-check `start` and `end` are both in PPQN, not seconds.

### Export hangs

- **Samples not loaded** — the offline worker fetches audio over RPC just like the live engine. If a sample's loader is stuck, the offline render hangs the same way. `await project.engine.queryLoadingComplete()` before kicking off the render.
- **Infinite project** — without `maxDurationSeconds`, a generative or feedback-loop project can render forever. Always set the cap.

## "Where is my data?"

### Project files

OPFS, under `projects/v1/{uuid}/`:

```
projects/v1/{uuid}/
  project.od     ← the project binary
  meta.json      ← name, artist, dates, tags
  image.bin      ← cover image (optional)
```

To inspect in Chrome: DevTools → Application tab → Storage → IndexedDB and OPFS sections. Safari's tooling for OPFS is sparser; Chromium-based browsers are the easiest to debug.

### Samples

OPFS, under `samples/v2/{uuid}/`:

```
samples/v2/{uuid}/
  audio.wav      ← re-encoded as WAV
  peaks.bin      ← multi-scale peak data
  meta.json      ← bpm, duration, sample rate, origin
```

### Clearing everything

If you need a clean slate:

```typescript
const root = await navigator.storage.getDirectory();
for await (const [name] of root.entries()) {
  await root.removeEntry(name, { recursive: true });
}
```

Or in DevTools: Application → Clear storage → Clear site data. (Closes the AudioContext too; reload after.)

### Storage quota

OPFS shares a quota with IndexedDB and Cache Storage. Run:

```typescript
const { usage, quota } = await navigator.storage.estimate();
console.log(`${usage} / ${quota} bytes`);
```

If you're close to quota, `storage.write` will reject with `QuotaExceededError`. Audio files are large; a sample-heavy project burns through quota fast.

## "Deployment to production broke"

### Headers stripped at the CDN edge

Cloudflare Pages, Vercel, Netlify all let you set custom headers but each does it differently:

- **Cloudflare Pages** — `_headers` file at the root of `dist/`.
- **Vercel** — `vercel.json` with a `headers` array.
- **Netlify** — `netlify.toml` with `[[headers]]` blocks.

The headers must apply to *every* response — HTML, JS, CSS, fonts, workers. A common mistake is restricting the rule to `/*.html`; the workers won't load.

### CDN rewriting iframe pages

If your site is embedded in an iframe (e.g. for a presentation), the *parent* page must also send the COOP/COEP headers. Otherwise the iframe is treated as cross-origin and `SharedArrayBuffer` is denied. The iframe path is fragile; native pages are easier.

### Cross-origin asset fetches

Loading samples from a third-party CDN requires that CDN to send `Cross-Origin-Resource-Policy: cross-origin` (or `Access-Control-Allow-Origin: *` plus `crossorigin="use-credentials"` on the fetch). Otherwise the browser refuses the resource in an isolated context. Self-host your samples or proxy them.

## "I'm doing something weird and nothing makes sense"

A short list of "have you considered" things that come up for advanced users:

- **The audio worklet is a snapshot.** When you press play, the project graph is *serialized* and shipped to the worklet. Live changes via `editing.modify()` propagate via `SyncSource`, but if you reach around the SDK and mutate something directly (don't), the worklet's copy stays unchanged.
- **`Map`/`Set` with `UUID.Bytes` won't deduplicate.** UUIDs are byte arrays; JavaScript's `Map` compares by reference. Use `UUID.newSet` / `UUID.newMap`.
- **`Set` lookups on box graphs are slow** — boxes are stored in `SortedSet`s keyed by UUID. Don't iterate the entire graph in a render loop; pre-cache pointer references.
- **The dev server fast-refresh sometimes leaves stale subscriptions.** If you change a subscriber's closure during HMR and the engine doesn't update, full-reload (Cmd+R) to clear.
- **Recording with `olderTakeScope` set to a value the SDK doesn't recognise** — the SDK accepts `"none"`, `"all"`, or `"previous-only"`. Other strings silently fall through to the default.

## When all else fails

- **`console.log` from the worklet ends up in `engineToClient.log()`** which routes to the main thread console. So `console.log("WORKLET", x)` inside a processor *does* show up.
- **Open the system DSP-load meter** — `project.engine.preferences.settings.debug.dspLoadMeasurement = true` enables the HRClock-based meter (see [internals/01](./internals/01-engine-processor.md#further-reading)). If the load is consistently above 1.0, you're dropping audio.
- **Reduce to a minimal repro.** Start from one of the smallest demos in [`src/demos/`](https://github.com/naomiaro/opendaw-test/tree/main/src/demos) and add complexity until the bug appears. If your problem reproduces in a demo-sized component, it's probably an SDK issue; file a bug. If it doesn't, the issue is somewhere in your app code.
- **Read the relevant chapter's "Common Issues" section.** Each major chapter (Ch. 02, 04, 06, 07, 08) has scenario-specific gotchas. This chapter covers the cross-cutting ones.
