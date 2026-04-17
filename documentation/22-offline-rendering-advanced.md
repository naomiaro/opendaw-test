# Offline Rendering: Advanced Patterns

Range-bounded export, metronome rendering, and the OfflineAudioContext approach.

## Background: Two Offline Render Paths in OpenDAW

OpenDAW has two offline renderers, but both have limitations when used from a live project:

| Renderer | Status | Limitation |
|----------|--------|------------|
| `AudioOfflineRenderer` | Deprecated | Uses `OfflineAudioContext` on main thread. `Option.None` → `countStems` returns 1, routing through stem path (no metronome). No range support (always renders 0 to last region). |
| `OfflineEngineRenderer` | Current | Worker-based custom render loop. `Option.None` → same `countStems=1` stem routing. Throws "Already connected" on live project's `liveStreamReceiver`. |

**Key clarification:** `ExportStemsConfiguration.countStems(Option.None)` returns **1** (not 0). The `numStems === 0` panic guard only fires for `Option.Some({})` (empty config object). With `Option.None`, the renderer creates 2 channels (`1 * 2`) and routes through the **stem export branch** — which excludes metronome. This is the fundamental reason neither renderer supports mixdown-with-metronome, not the panic guard.

Neither renderer supports:
- Rendering the **mixdown path** (which includes metronome) — `Option.None` routes through the stem branch
- **Range-bounded** export (start position + exact sample count) via the `start()` convenience method
- Both rely on silence detection or `maxDurationSeconds` for end bounds

## The OfflineAudioContext Approach

The working approach bypasses both renderers and uses the same building blocks they use internally: `project.copy()`, `OfflineAudioContext`, and `AudioWorklets.createEngine()`.

```typescript
import { Project, AudioWorklets } from "@opendaw/studio-core";
import { ppqn } from "@opendaw/lib-dsp";
import { TimeSpan } from "@opendaw/lib-std";
import { Wait } from "@opendaw/lib-runtime";

async function renderRange(
  project: Project,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number,
  exportConfiguration?: ExportStemsConfiguration,
  mutateBeforeCopy?: () => void,
  restoreAfterCopy?: () => void,
  metronomeEnabled: boolean = false,
  metronomeGain: number = -6
): Promise<Float32Array[]> {
  // 1. Calculate exact sample count from PPQN range
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const numChannels = exportConfiguration
    ? Object.keys(exportConfiguration).length * 2
    : 2;
  const numSamples = Math.ceil(durationSeconds * sampleRate);

  // 2. Mutate original (e.g., mute tracks), copy synchronously, restore immediately
  if (mutateBeforeCopy) mutateBeforeCopy();
  const projectCopy = project.copy();
  if (restoreAfterCopy) restoreAfterCopy();

  try {
    projectCopy.boxGraph.beginTransaction();
    projectCopy.timelineBox.loopArea.enabled.setValue(false);
    projectCopy.boxGraph.endTransaction();

    // 3. Create OfflineAudioContext with exact bounds
    const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
    const worklets = await AudioWorklets.createFor(context);
    const engineWorklet = worklets.createEngine({
      project: projectCopy,
      exportConfiguration, // undefined = mixdown (metronome included), config = stems
    });
    engineWorklet.connect(context.destination, 0); // output 0 = main audio (worklet has 2 outputs since SDK 0.0.133)

    // 4. Set preferences on the worklet (not the project copy)
    engineWorklet.preferences.settings.metronome.enabled = metronomeEnabled;
    engineWorklet.preferences.settings.metronome.gain = metronomeGain;

    // 5. Set position and render
    engineWorklet.setPosition(startPpqn);
    await engineWorklet.isReady();
    engineWorklet.play();

    const startTime = Date.now();
    while (!(await engineWorklet.queryLoadingComplete())) {
      if (Date.now() - startTime > 30_000) {
        throw new Error("Sample loading timed out after 30s");
      }
      await Wait.timeSpan(TimeSpan.millis(100));
    }

    const audioBuffer = await context.startRendering();

    // 6. Extract channels
    const channels: Float32Array[] = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      channels.push(audioBuffer.getChannelData(i));
    }
    return channels;
  } finally {
    projectCopy.terminate();
  }
}
```

## Key Concepts

### Mixdown vs Stem Path

The `EngineProcessor.render()` method has a hard branch:

```typescript
if (this.#stemExports.length === 0) {
  // Mixdown path: primary output + metronome
  this.#primaryOutput.unwrap().audioOutput().replaceInto(output)
  if (metronomeEnabled) { this.#metronome.output.mixInto(output) }
} else {
  // Stem path: individual AudioUnit outputs, NO metronome
  this.#stemExports.forEach((unit, index) => {
    const [l, r] = unit.audioOutput().channels()
    output[index * 2].set(l)
    output[index * 2 + 1].set(r)
  })
}
```

- **No `exportConfiguration`** passed to `createEngine()` → `stemExports.length === 0` → mixdown path → metronome included
- **With `exportConfiguration`** → per-track channels → metronome excluded

There is no way to get metronome in the stem path or individual stems in the mixdown path. This is a fundamental SDK design decision.

**Note:** This is different from passing `Option.None` to `OfflineEngineRenderer.create()`. The renderer's `countStems(Option.None)` returns 1, which still populates `stemExports` — routing through the stem branch. Our approach bypasses the renderer entirely and passes `undefined` to `createEngine()`, which leaves `stemExports` empty.

### Mutate-Copy-Restore Pattern

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

### project.copy() Behavior

`project.copy()` serializes the box graph via `toArrayBuffer()` and creates a new `Project` instance.

**What transfers:**
- Box graph state (track structure, regions, audio file references, mute/solo states)
- Sample manager reference (samples stay loaded — same `sampleManager` instance)

**What does NOT transfer:**
- Engine preferences (metronome enabled/gain, recording settings)
- Engine state (playback position, playing/recording flags)
- Live stream receiver connections
- Box instances (the copy has new instances with the same UUIDs)

Preferences must be set on `engineWorklet.preferences` after `createEngine()`.

### Metronome Preferences

Metronome settings are stored in `EnginePreferences`, not the box graph:

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

Click sounds are built into the processor — no `loadClickSound()` call is needed for default clicks.

### Why OfflineEngineRenderer Doesn't Work for Mixdown

1. **Stem-path routing with `Option.None`**: `countStems(Option.None)` returns 1, creating 2 channels routed through the stem export branch. The metronome lives in the mixdown branch (`stemExports.length === 0`), which is never reached.

2. **`liveStreamReceiver` conflict**: `create()` calls `source.liveStreamReceiver.connect()` on the source project. If the live engine already has it connected, this throws "Already connected". Using `project.copy()` avoids this, but introduces issue #3.

3. **Worker sample fetching with `project.copy()`**: The worker's `fetchAudio` callbacks use `source.sampleManager.getOrCreate(uuid)`. While `project.copy()` shares the same `sampleManager` reference, the worker communicates via `MessageChannel` — the sample loading callbacks need to resolve through the message passing layer, which may not work correctly with the copy's context.

## Export Modes

### Export Mixdown (selected tracks + optional metronome)

Mute unselected tracks on the original, copy, restore, render via mixdown path.

```typescript
const channels = await renderRange(
  project, startPpqn, endPpqn, 48000,
  undefined,  // mixdown path
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
  },
  true,  // metronome enabled
  -6     // metronome gain dB
);
// Result: stereo mixdown of selected tracks + metronome
```

This replaces the original Mode 1 (metronome only) and Mode 3 (single stem + metronome) — select any combination of tracks and metronome.

### Export Stems (individual files + optional metronome stem)

Render via stem path for per-track files. If metronome is requested, run a second render pass via mixdown path with all tracks muted.

```typescript
// Pass 1: Stem export (per-track channels, no metronome)
const exportConfig: ExportStemsConfiguration = {};
for (const track of selectedTracks) {
  const uuid = UUID.toString(track.audioUnitBox.address.uuid);
  exportConfig[uuid] = {
    includeAudioEffects: true,
    includeSends: true,
    useInstrumentOutput: true,
    fileName: track.name,
  };
}

const channels = await renderRange(
  project, startPpqn, endPpqn, 48000,
  exportConfig,  // stem path
  undefined, undefined,
  false  // no metronome in stem path
);
// Split interleaved channels: [stem1_L, stem1_R, stem2_L, stem2_R, ...]

// Pass 2 (optional): Metronome-only stem via mixdown path
if (includeMetronome) {
  const metronomeChannels = await renderRange(
    project, startPpqn, endPpqn, 48000,
    undefined,  // mixdown path
    () => { /* mute all tracks */ },
    () => { /* restore mutes */ },
    true, -6    // metronome enabled
  );
  // Append as additional "Metronome" stem
}
```

## Range Selection: Bars to PPQN

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

For projects with time signature changes, compute bar positions by accumulating `PPQN.fromSignature(nom, denom)` per bar (see `src/time-signature-demo.tsx` for reference).

## Encoding and Download

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

## In-Browser Preview

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

## Future: Worker-Based Rendering with Mixdown Support

### Current Limitation

Our `OfflineAudioContext` approach works but runs on the main thread. The SDK's `OfflineEngineRenderer` runs in a dedicated Web Worker using a custom render loop (no Web Audio API), which is faster and non-blocking.

### How the SDK Worker Actually Renders

The offline engine worker does **not** use `OfflineAudioContext`. It polyfills AudioWorklet globals and calls `processor.process()` directly in a tight loop:

```typescript
// offline-engine-main.ts (simplified)
while (offset < numSamples) {
  updateFrameTime(engine.totalFrames, engine.sampleRate)
  engine.processor.process([[]], outputs)
  engine.totalFrames += RenderQuantum
  offset += RenderQuantum
}
```

The metronome is already wired into `EngineProcessor.process()` — it runs in the mixdown branch (`stemExports.length === 0`) and would produce audio if the engine were configured for mixdown. Sample fetching, script device loading, and preference syncing all work over MessageChannel between main thread and worker.

### SDK Changes Requested

**1. Support mixdown path in `OfflineEngineRenderer`**

Currently, `Option.None` → `countStems` returns 1 → stem path (no metronome). To enable the mixdown path, the renderer needs a way to set `stemExports` to empty while still creating 2 output channels. Options:
- Add an explicit `mixdown: boolean` flag to the config
- Treat `Option.None` differently (set `numberOfChannels = 2` without populating `stemExports`)
- Add a new `ExportStemsConfiguration` variant that means "mixdown"

**2. Accept engine preferences in `OfflineEngineInitializeConfig`**

`project.toArrayBuffer()` serializes the box graph but not engine preferences. The offline worker creates fresh `EnginePreferences` with defaults (metronome disabled). Adding an optional `engineSettings` field would let the caller pass metronome state:

```typescript
export interface OfflineEngineInitializeConfig {
  // ... existing fields ...
  engineSettings?: Partial<EngineSettings>  // metronome, playback, recording prefs
}
```

**3. Support `setPosition()` before `play()` for range rendering**

`OfflineEngineRenderer` already exposes `setPosition(ppqn)` and `step(numSamples)` for precise range rendering. However, the `start()` convenience method always renders from position 0. Adding optional range parameters would make this a first-class feature:

```typescript
static async start(
  source, optExportConfiguration, progress, abortSignal?, sampleRate?,
  startPosition?: ppqn,  // default: 0
  endPosition?: ppqn     // default: source.lastRegionAction()
): Promise<AudioData>
```

**4. Resolve `liveStreamReceiver` conflict**

`OfflineEngineRenderer.create()` calls `source.liveStreamReceiver.connect()` on the passed project, which throws "Already connected" if the live engine is running. Either:
- Use `project.copy()` internally (like `AudioOfflineRenderer` does), or
- Guard the connect call, or
- Allow multiple connections on `liveStreamReceiver`

### Workaround: Custom Worker Fork

Until SDK changes land, a custom worker could be created by forking `offline-engine-main.ts` (~120 lines). The main thread coordinator (`OfflineEngineRenderer.create()` setup — MessageChannel, Communicator, fetchAudio, script device loading) would need to be replicated (~60 lines), but the EngineProcessor, Metronome, and all DSP code are reused as-is from the SDK.

This is a meaningful chunk of work (~200 lines + worker bundling) and probably warrants a separate PR if pursued.

## Reference

- Export demo: `src/export-demo.tsx`
- Range export utility: `src/lib/rangeExport.ts`
- Existing export docs: `documentation/audio-export.md`
- OpenDAW source repo paths (not this project):
  - SDK offline renderer: `packages/studio/core/src/OfflineEngineRenderer.ts`
  - SDK deprecated renderer: `packages/studio/core/src/AudioOfflineRenderer.ts`
  - Engine processor render method: `packages/studio/core-processors/src/EngineProcessor.ts`
  - Engine preferences schema: `packages/studio/adapters/src/engine/EnginePreferencesSchema.ts`
  - Metronome processor: `packages/studio/core-processors/src/Metronome.ts`
  - Offline engine worker: `packages/studio/core-workers/src/offline-engine-main.ts`
  - Worklet environment polyfill: `packages/studio/core-workers/src/worklet-env.ts`
