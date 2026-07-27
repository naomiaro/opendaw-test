# Export & Offline Rendering

> **Skip if:** you're not implementing audio export
> **Prerequisites:** Chapter 07 (Building a Complete App)

Comprehensive guide to exporting audio from OpenDAW projects, including full mix exports and individual stems with effects, plus advanced offline rendering patterns.

Everything below uses the OpenDAW SDK directly: `OfflineEngineRenderer` from `@opendaw/studio-core`, `WavFile` from `@opendaw/lib-dsp`, and the `ExportConfiguration` type from `@opendaw/studio-adapters`. The only browser API involved is the anchor-click used to save the encoded bytes.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core API](#core-api)
- [Full Mix Export](#full-mix-export)
- [Stems Export](#stems-export)
- [Export Options](#export-options)
- [Effects Rendering](#effects-rendering)
- [File Formats](#file-formats)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Advanced: Offline Rendering Patterns](#advanced-offline-rendering-patterns)
  - [Range-Bounded Export via the Step API](#range-bounded-export-via-the-step-api)
  - [Key Concepts](#key-concepts)
  - [Export Modes](#export-modes)
  - [Range Selection: Bars to PPQN](#range-selection-bars-to-ppqn)
  - [Encoding and Download](#encoding-and-download)
  - [In-Browser Preview](#in-browser-preview)
  - [Worker-Based Rendering Background](#worker-based-rendering-background)
  - [Reference](#reference)

---

## Overview

OpenDAW provides powerful audio export capabilities through its offline rendering engine. You can export:

- **Full Mix** - All tracks mixed down to a single stereo file
- **Individual Stems** - Separate files for each track
- **With Effects** - All audio effects fully rendered in the export
- **High Quality** - 48kHz sample rate, 32-bit float WAV files

**Key Features:**
- Offline rendering (non-real-time, accurate processing)
- Progress tracking and cancellation support
- Per-stem control of effects inclusion
- Automatic browser downloads
- WAV, MP3, and FLAC format support (WAV built-in, others require FFmpeg)

### How offline rendering works

Export doesn't touch the live audio engine. `OfflineEngineRenderer` runs the engine in a dedicated Worker, calling the render loop as fast as the CPU can crunch frames:

```mermaid
flowchart TD
    P["Project (live)"]
    Copy["Project.copy()"]
    OER["OfflineEngineRenderer"]
    Worker["offline engine Worker"]
    EP["WASM engine (in worker)"]
    Frames["Float32Array[]"]
    WAV["WAV bytes"]
    File["Browser download"]

    P --> Copy
    Copy --> OER
    OER --> Worker
    Worker --> EP
    EP --> Frames
    Frames --> WAV
    WAV --> File

    classDef src fill:#e8f0ff,stroke:#4a6fa5,color:#000
    classDef wrk fill:#fde8e8,stroke:#c25555,color:#000
    classDef out fill:#eef7ee,stroke:#5a9a5a,color:#000
    class P,Copy src
    class OER,Worker,EP wrk
    class Frames,WAV,File out
```

The worker runs the **same WASM engine** as the realtime audio worklet — same effects, same automation, same DSP. The only difference is the driver: in realtime, the audio thread pulls a render quantum 375 times a second; offline, the worker renders as quickly as possible until the silence detector says the mix has finished decaying. That's why export is *bit-exact* with realtime playback: it's literally the same code path. The worker self-loads its own WASM artifacts, so it is independent of any engine booted on the page's audio contexts.

---

## Quick Start

`OfflineEngineRenderer.start` is the one-shot renderer — render, encode the result with `WavFile`, and save it with a small anchor-click helper. Render from a `project.copy()`: the renderer connects the source's `liveStreamReceiver`, which the live engine already holds (see [Rendering from a Copy](#rendering-from-a-copy)).

### Render a full mix to WAV

```typescript
import { OfflineEngineRenderer } from "@opendaw/studio-core";
import { WavFile } from "@opendaw/lib-dsp";
import { DefaultObservableValue, Option } from "@opendaw/lib-std";

// Render the whole project (0 → last region end) to AudioData.
// Option.None = full mix.
const progress = new DefaultObservableValue(0);
const sub = progress.subscribe((o) => console.log(`${Math.round(o.getValue() * 100)}%`));

const projectCopy = project.copy();
try {
  const audioData = await OfflineEngineRenderer.start(
    projectCopy,
    Option.None,   // no stem config → full mix
    progress,
    undefined,     // optional AbortSignal
    48000          // sample rate
  );
  // Encode to 32-bit float WAV and download (encodeFloats accepts AudioData directly).
  downloadWav(WavFile.encodeFloats(audioData), "my-mix.wav");
} finally {
  sub.terminate();
  projectCopy.terminate();
}
```

### Render stems to WAV

```typescript
import { OfflineEngineRenderer } from "@opendaw/studio-core";
import { WavFile } from "@opendaw/lib-dsp";
import { DefaultObservableValue, Option } from "@opendaw/lib-std";
import type { ExportConfiguration } from "@opendaw/studio-adapters";

// A non-empty `stems` map takes the stem branch: one stereo pair per track.
// `fileName` is required on each entry; the other flags control what's baked in.
const exportConfig: ExportConfiguration = {
  stems: {
    [drumsUUID]: { includeAudioEffects: true, includeSends: false, useInstrumentOutput: false, fileName: "drums" },
    [bassUUID]:  { includeAudioEffects: true, includeSends: false, useInstrumentOutput: false, fileName: "bass" },
  },
};

const progress = new DefaultObservableValue(0);
const projectCopy = project.copy();
try {
  const audioData = await OfflineEngineRenderer.start(
    projectCopy, Option.wrap(exportConfig), progress, undefined, 48000
  );
  // Channels are interleaved by stem order: [s1_L, s1_R, s2_L, s2_R, ...]
  Object.values(exportConfig.stems!).forEach((stem, i) =>
    downloadWav(WavFile.encodeFloats(sliceStem(audioData, i)), `${stem.fileName}.wav`)
  );
} finally {
  projectCopy.terminate();
}
```

The `downloadWav` and `sliceStem` helpers are defined in [Core API](#core-api).

---

## Core API

### OfflineEngineRenderer

The offline rendering entry point from `@opendaw/studio-core`. It runs the engine in a
dedicated Worker (no `OfflineAudioContext`). Its worker is registered once at startup by
`WasmEngine.install` (see Ch. 19 / The WASM Audio Engine), so an app that has booted its
engine needs no extra setup.

```typescript
import { OfflineEngineRenderer } from "@opendaw/studio-core";
import { DefaultObservableValue, Option } from "@opendaw/lib-std";
import type { AudioData } from "@opendaw/lib-dsp";

// progress is a DefaultObservableValue<number> (NOT a callback) — subscribe to it
const progress = new DefaultObservableValue(0);
const sub = progress.subscribe((o) => console.log(`${Math.round(o.getValue() * 100)}%`));

const audioData: AudioData = await OfflineEngineRenderer.start(
  projectCopy,
  Option.None,        // or Option.wrap(exportConfiguration) for stems
  progress,
  undefined,          // AbortSignal (optional)
  48000               // sample rate
);
sub.terminate();
```

**Signature:** `OfflineEngineRenderer.start(source, optExportConfiguration, progress, abortSignal?, sampleRate?)` → `Promise<AudioData>`.

**How it works:**
1. Disables the timeline loop on the source (restores it after the render)
2. Resolves the render range — `[0, lastRegionAction()]`, or `ExportConfiguration.range` when set
3. Spawns the offline engine worker (which self-loads the WASM artifacts)
4. Renders all audio with effects, bounded by silence detection / `maxDurationSeconds`
5. Returns `AudioData` with the rendered audio

**For stems export:**
- Each stem is rendered to separate channels in the `AudioData`
- Channel layout: `[stem1_L, stem1_R, stem2_L, stem2_R, ...]`
- Effects are optionally included per stem

**Lower-level entry points** for full control:
`.create(source, optConfig, sampleRate?, abortSignal?)` (then `play()`, `step(samples)`,
`setPosition`, `waitForLoading`, `terminate`) and
`.render(config, startPosition, endPosition, progress, abortSignal?)` for arbitrary
ranges (where `config` is an `OfflineEngineRenderConfig`, not an `ExportConfiguration`).

> **Live-project caveat:** the renderer connects the source project's
> `liveStreamReceiver`, which throws "Already connected" if the live engine already holds
> it. Render from a `project.copy()`. See
> [Advanced: Offline Rendering Patterns](#advanced-offline-rendering-patterns) for
> exact-range export via `step()`, `render()`'s silence-bounded (not end-bounded) loop,
> and the metronome export configuration.

### WavFile

WAV file encoding/decoding from `@opendaw/lib-dsp`:

```typescript
import { WavFile } from "@opendaw/lib-dsp";

// Convert AudioData (or an AudioBuffer-like) to a WAV ArrayBuffer (32-bit float)
const wavArrayBuffer = WavFile.encodeFloats(audioData);

// Decode a WAV ArrayBuffer to AudioData
const audio = WavFile.decodeFloats(arrayBuffer);
// Returns AudioData: { sampleRate: number, numberOfFrames: number, numberOfChannels: number, frames: Float32Array[] }
```

**Encoders:**
- `encodeFloats` — 32-bit IEEE float (lossless, the default used throughout this chapter)
- `encodeInts16` — 16-bit PCM (same input shape; float samples clamped to [-1, 1])

Both accept `AudioData | AudioBufferLike`, mono or stereo. There is no 24-bit encoder.

### Saving and slicing the result

The renderer returns audio in memory; these two small helpers turn it into downloads. They
use only standard DOM APIs — no SDK or framework dependency:

```typescript
import type { AudioData } from "@opendaw/lib-dsp";

// Save an encoded WAV ArrayBuffer as a browser download.
function downloadWav(bytes: ArrayBuffer, fileName: string): void {
  const blob = new Blob([bytes], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// Extract stem `index` (a stereo pair) from a multi-channel stems render.
function sliceStem(audioData: AudioData, index: number): AudioData {
  const left = index * 2;
  const right = index * 2 + 1;
  if (right >= audioData.numberOfChannels) {
    throw new Error(`Stem ${index} needs channel ${right}, render has ${audioData.numberOfChannels}`);
  }
  return {
    sampleRate: audioData.sampleRate,
    numberOfFrames: audioData.numberOfFrames,
    numberOfChannels: 2,
    frames: [audioData.frames[left], audioData.frames[right]],
  };
}
```

---

## Full Mix Export

### Use Cases

**When to use full mix export:**
- Final master for distribution
- Sharing your complete mix
- Archiving finished projects
- Creating reference mixes
- Testing mix decisions

### Example

`Option.None` selects the mixdown branch — all tracks, all effects, and all automation are
mixed into one stereo result (add `metronome: { includeInMixdown: true }` to a config to
include the click — see [the metronome configuration](#range-bounded-export-via-the-step-api)):

```typescript
import { OfflineEngineRenderer } from "@opendaw/studio-core";
import { WavFile } from "@opendaw/lib-dsp";
import { DefaultObservableValue, Option } from "@opendaw/lib-std";

async function exportMix(project: Project, fileName = "mix"): Promise<void> {
  const progress = new DefaultObservableValue(0);
  const projectCopy = project.copy();
  try {
    const audioData = await OfflineEngineRenderer.start(
      projectCopy, Option.None, progress, undefined, 48000
    );
    downloadWav(WavFile.encodeFloats(audioData), `${fileName}.wav`);
  } finally {
    projectCopy.terminate();
  }
}
```

**What gets exported:**
- All tracks mixed together
- All audio effects rendered
- All automation applied
- Master output effects included
- Final stereo mixdown

---

## Stems Export

### Use Cases

**When to use stems export:**
- Sharing individual tracks for collaboration
- Sending to mixing/mastering engineer
- Remixing or rearranging
- Creating sample packs
- Archiving project components
- A/B testing with and without effects

### Effect Inclusion Control

A stems export is driven by an `ExportConfiguration` whose `stems` map is keyed by audio-unit
UUID. Each entry controls what gets baked into that stem:

```typescript
import type { ExportConfiguration } from "@opendaw/studio-adapters";

const exportConfig: ExportConfiguration = {
  stems: {
    // Vocals: include all audio effects (Reverb + Compressor)
    [vocalsUUID]: { includeAudioEffects: true,  includeSends: false, useInstrumentOutput: false, fileName: "vocals" },
    // Drums: include compression, export a tight sound
    [drumsUUID]:  { includeAudioEffects: true,  includeSends: false, useInstrumentOutput: false, fileName: "drums" },
    // Guitar: export dry for re-amping later
    [guitarUUID]: { includeAudioEffects: false, includeSends: false, useInstrumentOutput: false, fileName: "guitar" },
  },
};
```

**Per-stem flags** (the `ExportStemConfiguration` type):
- `fileName` *(required)* — display name for the stem; the SDK also uses it when naming output
- `includeAudioEffects` — bake the track's audio-effect chain into the stem
- `includeSends` — include aux/send returns (reverb/delay buses) in the stem
- `useInstrumentOutput` — **keep this `false`.** `true` wires the raw instrument output
  straight to the bus and returns early, bypassing audio effects, sends, **and** the channel
  strip — which makes `includeAudioEffects`/`includeSends` dead. (openDAW's own export dialog
  omits the flag for this reason.)
- `skipChannelStrip` *(optional)* — bypasses the channel-strip volume/pan/mute and, as a
  side effect of the same early return, drops aux sends regardless of `includeSends`.

### Channel layout and extraction

A stems render returns a single multi-channel result with one stereo pair per stem, **in the
order the `stems` map was iterated**:

```
channel:  0     1     2     3     4     5    ...
stem:     s1_L  s1_R  s2_L  s2_R  s3_L  s3_R ...
```

Slice each pair into its own stereo file (see `sliceStem` in [Core API](#saving-and-slicing-the-result)):

```typescript
const projectCopy = project.copy();
try {
  const audioData = await OfflineEngineRenderer.start(
    projectCopy, Option.wrap(exportConfig), progress, undefined, 48000
  );
  // `Object.values` preserves insertion order, which matches the channel layout
  Object.values(exportConfig.stems!).forEach((stem, i) =>
    downloadWav(WavFile.encodeFloats(sliceStem(audioData, i)), `${stem.fileName}.wav`)
  );
} finally {
  projectCopy.terminate();
}
```

**What gets exported:**
- One WAV file per stem
- Each rendered to its own stereo pair
- Effects optionally included per stem (via the flags above)

---

## Export Options

### Sample Rate

The fifth argument to `start()` sets the render sample rate.

**Common values:**
- `44100` - CD quality
- `48000` - Professional standard (recommended, the SDK default)
- `96000` - High resolution (larger files)

```typescript
await OfflineEngineRenderer.start(projectCopy, Option.None, progress, undefined, 48000);
```

### Progress Tracking

The renderer reports progress as a normalized `0.0–1.0` value through a
`DefaultObservableValue<number>` you subscribe to:

```typescript
import { DefaultObservableValue } from "@opendaw/lib-std";
const progress = new DefaultObservableValue(0);
const sub = progress.subscribe((o) => setPercent(Math.round(o.getValue() * 100)));
await OfflineEngineRenderer.start(projectCopy, Option.None, progress, undefined, 48000);
sub.terminate();
```

Offline rendering runs as fast as the CPU allows and the end is determined by silence
detection, so the rate of progress updates is not uniform. For long renders, an
indeterminate indicator with a "may take a moment" note often reads better than a precise bar.

### Cancellation

Pass an `AbortSignal` as the fourth argument and abort it to cancel a render. The promise
rejects with an abort error — detect it with `Errors.isAbort`:

```typescript
import { Errors } from "@opendaw/lib-std";

const controller = new AbortController();
try {
  const audioData = await OfflineEngineRenderer.start(
    projectCopy, Option.None, progress, controller.signal, 48000
  );
  downloadWav(WavFile.encodeFloats(audioData), "mix.wav");
} catch (error) {
  if (Errors.isAbort(error)) {
    console.log("Export cancelled");
  } else {
    throw error;
  }
}
```

### Range

`ExportConfiguration.range` bounds the render window: `"full"` (the default — `[0, last
region end]`) or `{ start: ppqn, end: ppqn }`. Note the worker's loop still stops on
silence detection, not at `end` — for an exact frame count use the
[step API](#range-bounded-export-via-the-step-api).

### Filenames

`downloadWav` takes whatever filename you pass. For names that come from user input, the SDK
ships a sanitizer — `ExportConfiguration.sanitizeFileName(name)`, plus
`ExportConfiguration.sanitizeExportNamesInPlace(config)` to fix every stem `fileName` in a
config at once:

```typescript
import { ExportConfiguration } from "@opendaw/studio-adapters";

downloadWav(WavFile.encodeFloats(audioData), `${ExportConfiguration.sanitizeFileName(userTitle)}.wav`);
```

---

## Effects Rendering

### How Effects Are Rendered

When exporting, OpenDAW renders all effects **offline** (non-real-time):

**Advantages:**
- **Accurate processing** - No real-time constraints
- **High quality** - All effects rendered at full precision
- **Automation included** - Parameter changes over time preserved
- **Consistent results** - Same output every time

**What gets rendered:**
- ✓ Audio effects (Reverb, Delay, Compressor, EQ, etc.)
- ✓ Audio effect automation
- ✓ Volume and pan automation
- ✓ Master output effects
- ✗ Send effects (optional, controlled per stem via `includeSends`)

### Full mix — all effects always included

The mixdown branch renders the project exactly as it sounds in realtime, so every effect is
baked in automatically:

```typescript
const audioData = await OfflineEngineRenderer.start(projectCopy, Option.None, progress, undefined, 48000);
downloadWav(WavFile.encodeFloats(audioData), "mix-with-all-effects.wav");
```

### Per-stem effect control

For stems, the `includeAudioEffects` flag decides whether each track's effect chain is baked in:

```typescript
const exportConfig: ExportConfiguration = {
  stems: {
    // Wet: Reverb, Compressor, EQ rendered in order
    [vocalsUUID]: { includeAudioEffects: true,  includeSends: false, useInstrumentOutput: false, fileName: "vocals" },
    // Dry: instrument/clip signal only, no effects
    [guitarUUID]: { includeAudioEffects: false, includeSends: false, useInstrumentOutput: false, fileName: "guitar" },
  },
};
const audioData = await OfflineEngineRenderer.start(projectCopy, Option.wrap(exportConfig), progress, undefined, 48000);
```

When `includeAudioEffects` is `true`, the full chain renders in order — a vocals track with
Compressor → Reverb → EQ produces a stem with Compressor → Reverb → EQ applied.

---

## File Formats

### WAV (Built-in)

**Format:** 32-bit IEEE float, WAV container
**Quality:** Lossless
**Use case:** Default, highest quality
**File size:** Large (~10 MB/minute stereo)

```typescript
import { WavFile } from "@opendaw/lib-dsp";

const audioData = await OfflineEngineRenderer.start(projectCopy, Option.None, progress, undefined, 48000);
downloadWav(WavFile.encodeFloats(audioData), "mix.wav");
```

### MP3 and FLAC (Via OpenDAW Studio)

`WavFile` only encodes WAV. For MP3/FLAC, use OpenDAW Studio's `Mixdowns` service:

```typescript
import { Mixdowns } from "@opendaw/studio/service/Mixdowns";

// MP3/FLAC export (requires FFmpeg)
await Mixdowns.exportMixdown({ project, meta });
// User selects format in dialog: WAV, MP3, or FLAC
```

**MP3:**
- Lossy compression
- Smaller files (~1 MB/minute)
- Requires FFmpeg (lazy-loaded)

**FLAC:**
- Lossless compression
- Medium files (~5 MB/minute)
- Requires FFmpeg (lazy-loaded)

---

## Examples

### Example 1: Full mix with a generated filename

```typescript
const audioData = await OfflineEngineRenderer.start(
  projectCopy, Option.None, progress, undefined, 48000
);
downloadWav(WavFile.encodeFloats(audioData), `drum-pattern-${bpm}bpm.wav`);
```

### Example 2: Stems with effects baked in

```typescript
const exportConfig: ExportConfiguration = {
  stems: Object.fromEntries(
    tracks.map((t) => [t.uuid, { includeAudioEffects: true, includeSends: false, useInstrumentOutput: false, fileName: t.name }])
  ),
};
const audioData = await OfflineEngineRenderer.start(projectCopy, Option.wrap(exportConfig), progress, undefined, 48000);
tracks.forEach((t, i) => downloadWav(WavFile.encodeFloats(sliceStem(audioData, i)), `${t.name}.wav`));
// Result: one WAV per track, each with its effects rendered
```

### Runnable demos

These concepts ship as runnable demos in this handbook's companion app — see the
[Export Demo](https://opendaw-test.pages.dev/export-demo.html) for full-mix, stems, and
range export wired up to a UI.

---

## Best Practices

### 1. Stop playback before exporting

The render runs on a copy in a worker, but stopping the live transport first avoids
contention for CPU:

```typescript
if (project.engine.isPlaying.getValue()) {
  project.engine.stop();
}
const audioData = await OfflineEngineRenderer.start(projectCopy, Option.None, progress, undefined, 48000);
```

### 2. Show progress and a long-render hint

```typescript
const progress = new DefaultObservableValue(0);
const sub = progress.subscribe((o) => setPercent(Math.round(o.getValue() * 100)));
try {
  const audioData = await OfflineEngineRenderer.start(projectCopy, Option.None, progress, undefined, 48000);
  downloadWav(WavFile.encodeFloats(audioData), "mix.wav");
} finally {
  sub.terminate();
}
```

### 3. Handle errors (and aborts) gracefully

```typescript
import { Errors } from "@opendaw/lib-std";

try {
  const audioData = await OfflineEngineRenderer.start(projectCopy, Option.None, progress, undefined, 48000);
  downloadWav(WavFile.encodeFloats(audioData), "mix.wav");
} catch (error) {
  if (Errors.isAbort(error)) return; // user cancelled
  console.error("Export failed:", error);
}
```

### 4. Use descriptive filenames

```typescript
// Good
"darkride-master-v3-with-compression.wav"
"vocals-dry-for-reamping.wav"

// Less helpful
"mix.wav"
"export1.wav"
```

### 5. Consider file sizes

**WAV files are large:**
- Stereo, 48kHz, 32-bit: ~10 MB per minute
- 3-minute song: ~30 MB
- 7 stems × 3 minutes: ~210 MB total

**Recommendations:**
- Use WAV for archival and processing
- Convert to MP3/FLAC for sharing (use OpenDAW Studio's `Mixdowns` service)
- Warn users about file sizes for long exports

---

## Troubleshooting

### Render throws "Already connected"

**Problem:** Rendering directly from the live project — the renderer connects the source
project's `liveStreamReceiver`, which the live engine already holds.

**Solution:** Render from a copy (and terminate it afterwards):

```typescript
const projectCopy = project.copy();
try {
  const audioData = await OfflineEngineRenderer.start(projectCopy, Option.None, progress, undefined, 48000);
} finally {
  projectCopy.terminate();
}
```

### Render throws "No engine worker installed"

**Problem:** `WasmEngine.install` never ran — it registers the offline engine worker with
`OfflineEngineRenderer`.

**Solution:** Run the engine bootstrap before rendering (see Ch. 19 / The WASM Audio Engine).

### No download triggered

**Problem:** Browser blocked the download.

**Solution:**
- A user gesture is required — trigger the export from a click handler
- Check the console for errors and verify a popup/download blocker isn't interfering

### Effects not rendered in a stem

**Problem:** `includeAudioEffects: false`, or `useInstrumentOutput: true` (which bypasses the
effect chain, sends, and channel strip entirely).

**Solution:**
```typescript
[uuid]: { includeAudioEffects: true, includeSends: false, useInstrumentOutput: false }
```

### Export takes a long time

**Explanation:** Offline rendering still processes every sample through the full DSP graph;
long tracks and heavy effect chains take proportionally longer. This is expected and is what
makes the export bit-exact with realtime.

**Solution:**
- Subscribe to the renderer's progress and show status to the user
- Test with a short range first (see [Range Selection](#range-selection-bars-to-ppqn))

### Volume too low/high in export

**Problem:** Gain staging or effect parameters.

**Solution:**
- Check the master volume level
- Verify effect parameters (especially Crushers and Compressors)
- Adjust levels before exporting and test with a short export first

### "Overlapping regions" warning and incomplete export

Overlapping regions on a single track are invalid by design in both timeBases. The
Seconds-timeBase path surfaces no warning for overlaps during editing — this is **not a bug**,
but it can truncate an export. Keep one region per position per track.

---

## Additional Resources

### Related Files

- **Drum Demo Integration:** `src/demos/playback/drum-scheduling-demo.tsx`
- **Effects Demo Integration:** `src/demos/effects/effects-demo.tsx`
- **Export Demo:** [opendaw-test.pages.dev/export-demo.html](https://opendaw-test.pages.dev/export-demo.html)

### OpenDAW Core Files

- **Offline Renderer:** `@opendaw/studio-core/OfflineEngineRenderer.ts`
- **WAV Encoding:** `@opendaw/lib-dsp/WavFile.ts`
- **Export Configuration type:** `@opendaw/studio-adapters/ExportConfiguration.ts`
- **Mixdowns Service:** `@opendaw/studio/service/Mixdowns.ts`
- **Offline worker:** `@opendaw/studio-core-wasm/wasm-offline-worker.js`

### Documentation

- [Effects Documentation](./11-effects.md)
- [Timing & Tempo](./02-timing-and-tempo.md)
- [Box System & Reactivity](./04-box-system-and-reactivity.md)

---

## Advanced: Offline Rendering Patterns

> **Skip if:** the basic export API meets your needs

Range-bounded export and metronome rendering.

### Path selection: mixdown vs stems

`ExportConfiguration.countStems(Option.None)` returns **1** (not 0), so the `numStems === 0` panic guard only fires for `Option.Some({stems: {}})` (an empty stems map, with no metronome stem). The engine then branches on the **stems array**, which is empty for `Option.None`/undefined config — so it takes the **mixdown branch**. A non-empty `stems` map takes the **stem branch** (per-unit stereo pairs). So:
- `Option.None` / undefined `exportConfiguration` = **mixdown path** (add `metronome: { includeInMixdown: true }` for a click)
- non-empty `stems` map = **stem path** (add `metronome: { stem: { fileName } }` for a click stem)

**Range bounds:** the `start()` convenience method relies on silence detection or
`maxDurationSeconds` for the end bound, and `OfflineEngineRenderer.render(config,
startPosition, endPosition, progress)` does NOT stop at `endPosition` either — the worker's
loop runs until silence/`maxDurationSeconds`; `endPosition` only drives the progress value.
For an **exact** range (precise sample count, stems of equal length), use the step API:

### Range-Bounded Export via the Step API

`create → setPosition → play → waitForLoading → step(numSamples)` renders exactly the
requested frame count on the worker. Wrapped as a reusable helper (the two export-mode
examples below both call it), combined with the mutate-copy-restore pattern for muting
tracks before the copy:

```typescript
import { OfflineEngineRenderer } from "@opendaw/studio-core";
import { Option } from "@opendaw/lib-std";
import type { ExportConfiguration } from "@opendaw/studio-adapters";

async function renderRange(
  project: Project,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number,
  exportConfiguration?: ExportConfiguration,
  mutateBeforeCopy?: () => void,
  restoreAfterCopy?: () => void
): Promise<Float32Array[]> {
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const numSamples = Math.ceil(durationSeconds * sampleRate);

  // Mutate the original project (e.g., mute tracks), copy synchronously to capture
  // the state, then restore immediately — see Mutate-Copy-Restore Pattern below.
  if (mutateBeforeCopy) mutateBeforeCopy();
  const projectCopy = project.copy(); // never the live project — liveStreamReceiver conflict
  if (restoreAfterCopy) restoreAfterCopy();

  try {
    const renderer = await OfflineEngineRenderer.create(
      projectCopy,
      exportConfiguration ? Option.wrap(exportConfiguration) : Option.None,
      sampleRate
    );
    try {
      renderer.setPosition(startPpqn);
      await renderer.play();           // starts transport + one queryLoadingComplete
      await renderer.waitForLoading(); // NOTE: polls with no ceiling — add your own deadline
      return await renderer.step(numSamples); // Float32Array[], exact length
      // stems config → channels interleaved [stem1_L, stem1_R, stem2_L, ...]
    } finally {
      renderer.stop();
      renderer.terminate();
    }
  } finally {
    projectCopy.terminate();
  }
}
```

**Metronome:** the click travels in the export configuration — no renderer wiring
([openDAW#316](https://github.com/andremichelle/openDAW/issues/316)):

```typescript
// click mixed into a (no-stems) stereo mixdown
{ metronome: { includeInMixdown: true, settings: { gain: -6 } } }
// click as its own stem, appended AFTER the unit stems (countStems counts the extra pair)
{ stems, metronome: { stem: { fileName: "Metronome" }, settings: { gain: -6 } } }
```

Enabled is implied by presence (`ExportConfiguration.isMetronomeAudible`); `settings`
overrides gain/beatSubDivision/monophonic; `clickSounds: {downbeat?, beat?}` supplies
custom PCM in place of the synthesized 880/440 Hz defaults.

### Key Concepts

#### Mixdown vs Stem Path

There is no way to get individual stems in the mixdown path — the branch is decided by the
`stems` map alone (see [Path selection](#path-selection-mixdown-vs-stems)). The metronome,
by contrast, works on **both** paths, but only through the export configuration:
`includeInMixdown` on the mixdown branch, `metronome.stem` on the stem branch (appended as
the LAST stereo pair; `sanitizeExportNamesInPlace` sanitizes it last so a filename
collision renames the click, not a project stem). Enabling the click is a property of the
export configuration (`isMetronomeAudible`), not of engine preferences.

#### Mutate-Copy-Restore Pattern

`project.copy()` creates **new box instances** from the serialized box graph. You cannot modify the original project's boxes through the copy's `editing.modify()` — this throws "Modification only prohibited in transaction mode."

To capture muted state in a copy, mutate the **original** project, copy synchronously, then restore:

```typescript
// Save original state
const originalMutes = new Map<TrackData, boolean>();
for (const track of tracks) {
  originalMutes.set(track, track.audioUnitBox.mute.getValue());
}

// Mutate → copy (synchronous) → restore
project.editing.modify(() => {
  for (const track of tracks) {
    track.audioUnitBox.mute.setValue(true);
  }
});
const projectCopy = project.copy(); // synchronous — captures muted state
project.editing.modify(() => {
  for (const [track, wasMuted] of originalMutes) {
    track.audioUnitBox.mute.setValue(wasMuted);
  }
});

// projectCopy has muted state baked in, original is restored
```

The mute window is a single synchronous JS task — no audio blocks process in between, so there is no audible glitch during live playback.

#### project.copy() Behavior

`project.copy()` serializes the box graph via `toArrayBuffer()` and creates a new `Project` instance.

**What transfers:**
- Box graph state (track structure, regions, audio file references, mute/solo states)
- Sample manager reference (samples stay loaded — same `sampleManager` instance)

**What does NOT transfer:**
- Engine preferences (metronome enabled/gain, recording settings)
- Engine state (playback position, playing/recording flags)
- Live stream receiver connections
- Box instances (the copy has new instances with the same UUIDs)

Engine preferences don't travel with the copy, so metronome state can't ride along with
them either: the metronome for an offline render travels in the export configuration
instead — `ExportConfiguration.metronome` (see [Metronome Preferences](#metronome-preferences)
below and [Range-Bounded Export](#range-bounded-export-via-the-step-api)) —
not through any preferences object set after the fact.

#### Metronome Preferences

Live-playback metronome settings are stored in `EnginePreferences`, not the box graph:

```typescript
// Schema from EnginePreferencesSchema.ts
metronome: {
  enabled: boolean,          // default: false
  beatSubDivision: 1|2|4|8, // default: 1 (quarter notes)
  gain: number,              // default: -6 dB, range: -Infinity to 0
  monophonic: boolean        // default: true
}
```

The gain max is **0 dB** (unity), not +6 dB like track volume. There is no boost available.

Click sounds are built into the engine — no `loadClickSound()` call is needed for default
clicks. For offline renders, `ExportConfiguration.metronome.settings` merges over these
schema defaults.

#### Rendering from a Copy

Two practical notes on driving `OfflineEngineRenderer` from an app with a live engine:

1. **`liveStreamReceiver` conflict**: `create()` calls `source.liveStreamReceiver.connect()` on the source project. If the live engine already has it connected, this throws "Already connected" — always render from a `project.copy()`.

2. **Worker sample fetching works through the copy**: the worker's `fetchAudio` callbacks resolve via `source.sampleManager.getOrCreate(uuid)` over the `MessageChannel`, and `project.copy()` shares the same `sampleManager` reference — samples stay loaded and resolve normally (the export demo renders Dark Ride stems this way).

### Export Modes

#### Export Mixdown (selected tracks + optional metronome)

Mute unselected tracks on the original, copy, restore, render the mixdown branch — with the click expressed in the export configuration.

```typescript
const channels = await renderRange(
  project, startPpqn, endPpqn, 48000,
  includeMetronome
    ? { metronome: { includeInMixdown: true, settings: { gain: -6 } } }
    : undefined, // mixdown branch either way; the click mixes into the stereo pair
  () => {
    project.editing.modify(() => {
      for (const track of tracks) {
        const uuid = UUID.toString(track.audioUnitBox.address.uuid);
        track.audioUnitBox.mute.setValue(!selectedUuids.includes(uuid));
      }
    });
  },
  () => {
    project.editing.modify(() => {
      for (const [track, wasMuted] of savedMutes) {
        track.audioUnitBox.mute.setValue(wasMuted);
      }
    });
  }
);
// Result: stereo mixdown of selected tracks (+ metronome when configured)
```

#### Export Stems (individual files + optional metronome stem)

One render for everything: per-track stereo pairs, and — when requested — the metronome as its own stem pair appended LAST (a metronome-only export is `{stems: {}, metronome: {stem}}`).

```typescript
const exportConfig: Record<string, ExportStemConfiguration> = {};
for (const track of selectedTracks) {
  const uuid = UUID.toString(track.audioUnitBox.address.uuid);
  exportConfig[uuid] = {
    includeAudioEffects: true,
    includeSends: true,
    useInstrumentOutput: false,  // true bypasses effects, sends, and the channel strip
    fileName: track.name,
  };
}

const channels = await renderRange(project, startPpqn, endPpqn, 48000, {
  stems: exportConfig,
  ...(includeMetronome
    ? { metronome: { stem: { fileName: "Metronome" }, settings: { gain: -6 } } }
    : {}),
});
// Split interleaved channels: [stem1_L, stem1_R, ..., metronome_L, metronome_R]
// (metronome pair LAST — matching ExportConfiguration.stemFileNames order)
```

### Range Selection: Bars to PPQN

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// Assumes constant 4/4 time — for variable time signatures, accumulate per-bar
const BAR = PPQN.fromSignature(4, 4); // 3840 PPQN per bar in 4/4

// Bar numbers are 1-indexed
const startPpqn = ((startBar - 1) * BAR) as ppqn;  // bar 1 = position 0
const endPpqn = (endBar * BAR) as ppqn;              // bar 4 = position 15360

// Duration via tempo map (handles tempo changes)
const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
const numSamples = Math.ceil(durationSeconds * sampleRate);
```

For projects with time signature changes, use `computeBarsFromSDK()` from `src/lib/barLayout.ts` to read bar positions from the SDK's signature track.

### Encoding and Download

```typescript
import { WavFile } from "@opendaw/lib-dsp";

// Channels → AudioBuffer → WAV (32-bit float)
const audioBuffer = new AudioBuffer({
  length: channels[0].length,
  numberOfChannels: channels.length,
  sampleRate,
});
channels.forEach((ch, i) => audioBuffer.copyToChannel(ch, i));

const wavArrayBuffer = WavFile.encodeFloats(audioBuffer);

// Trigger download
const blob = new Blob([wavArrayBuffer], { type: "audio/wav" });
const url = URL.createObjectURL(blob);
const link = document.createElement("a");
link.href = url;
link.download = "export.wav";
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
URL.revokeObjectURL(url);
```

### In-Browser Preview

Play exported audio without the engine using a plain `AudioBufferSourceNode`:

```typescript
const source = audioContext.createBufferSource();
source.buffer = audioBuffer;
source.connect(audioContext.destination);
source.onended = () => {
  source.disconnect();
  // update UI state
};
source.start();

// Stop (guard against already-ended source):
try { source.stop(); } catch { /* already ended */ }
source.disconnect();
```

This is completely separate from the OpenDAW engine — no interference with live playback.

### Worker-Based Rendering Background

The offline engine worker does **not** use `OfflineAudioContext` — it drives the WASM
engine's render function directly in a tight loop, producing a render quantum per
iteration until the requested frames are delivered. The worker self-loads the wasm
artifacts from the base URL `WasmEngine.install` registered, which is what makes it
independent of the page's audio contexts (and immune to the second-context `addModule`
bookkeeping described in Ch. 19). Sample fetching, script device loading, and click-sound
delivery all work over a `MessageChannel` between the main thread and the worker; the
metronome click PCM travels **in the export configuration** because the render loop never
yields — a racing command would land after the render finished.

### Reference

- Export demo: `src/demos/export/export-demo.tsx`
- Range export utility: `src/lib/rangeExport.ts`
- SDK packages used: `@opendaw/studio-core` (offline renderer), `@opendaw/studio-core-wasm` (engine + offline worker), `@opendaw/studio-adapters` (export configuration), `@opendaw/lib-dsp` (WavFile)
