# Offline Rendering: Advanced Patterns

Range-bounded export, metronome rendering, and the OfflineAudioContext approach.

## Background: Two Offline Render Paths in OpenDAW

OpenDAW has two offline renderers, but both have limitations when used from a live project:

| Renderer | Status | Limitation |
|----------|--------|------------|
| `AudioOfflineRenderer` | Deprecated | Panics with `numStems === 0` — no mixdown support |
| `OfflineEngineRenderer` | Current | Same panic, plus `liveStreamReceiver` "Already connected" on live projects, and `project.copy()` loses sample data in worker context |

Neither renderer supports:
- Rendering the **mixdown path** (which includes metronome)
- **Range-bounded** export (start position + exact sample count)
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
  metronomeEnabled: boolean = false,
  metronomeGain: number = -6
): Promise<Float32Array[]> {
  // 1. Calculate exact sample count from PPQN range
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const numChannels = exportConfiguration
    ? Object.keys(exportConfiguration).length * 2
    : 2;
  const numSamples = Math.ceil(durationSeconds * sampleRate);

  // 2. Copy project — isolates mute state, shares sampleManager
  const projectCopy = project.copy();
  projectCopy.boxGraph.beginTransaction();
  projectCopy.timelineBox.loopArea.enabled.setValue(false);
  projectCopy.boxGraph.endTransaction();

  // 3. Create OfflineAudioContext with exact bounds
  const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
  const worklets = await AudioWorklets.createFor(context);
  const engineWorklet = worklets.createEngine({
    project: projectCopy,
    exportConfiguration, // undefined = mixdown, config = stems
  });
  engineWorklet.connect(context.destination);

  // 4. Set preferences on the worklet (not the project copy)
  engineWorklet.preferences.settings.metronome.enabled = metronomeEnabled;
  engineWorklet.preferences.settings.metronome.gain = metronomeGain;

  // 5. Set position and render
  engineWorklet.setPosition(startPpqn);
  await engineWorklet.isReady();
  engineWorklet.play();

  while (!(await engineWorklet.queryLoadingComplete())) {
    await Wait.timeSpan(TimeSpan.millis(100));
  }

  const audioBuffer = await context.startRendering();
  projectCopy.terminate();

  // 6. Extract channels
  const channels: Float32Array[] = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }
  return channels;
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

- **No `exportConfiguration`** → `stemExports.length === 0` → mixdown path → metronome included
- **With `exportConfiguration`** → per-track channels → metronome excluded

There is no way to get metronome in the stem path or individual stems in the mixdown path. This is a fundamental SDK design decision.

### project.copy() Behavior

`project.copy()` serializes the box graph via `toArrayBuffer()` and creates a new `Project` instance.

**What transfers:**
- Box graph state (track structure, regions, audio file references, mute/solo states)
- Sample manager reference (samples stay loaded — same `sampleManager` instance)

**What does NOT transfer:**
- Engine preferences (metronome enabled/gain, recording settings)
- Engine state (playback position, playing/recording flags)
- Live stream receiver connections

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

### Why OfflineEngineRenderer Doesn't Work

1. **`create()` panics with `numStems === 0`** (line 53 in source):
   ```typescript
   if (numStems === 0) { return panic("Nothing to export") }
   ```
   Both `OfflineEngineRenderer` and `AudioOfflineRenderer` have this guard.

2. **`liveStreamReceiver` conflict**: `create()` calls `source.liveStreamReceiver.connect()` on the source project. If the live engine already has it connected, this throws "Already connected".

3. **Sample data loss with `project.copy()`**: When passed to the worker-based renderer, the copy's sample manager can't serve audio to the worker's `fetchAudio` callbacks, resulting in silent stems.

## Export Modes

### Mode 1: Metronome Only

Mute all tracks, render via mixdown path with metronome enabled.

```typescript
// Mute all tracks on the original (captured by copy)
project.editing.modify(() => {
  tracks.forEach(t => t.audioUnitBox.mute.setValue(true));
});

const channels = await renderRange(
  project, startPpqn, endPpqn, 48000,
  undefined,  // mixdown path
  true,       // metronome enabled
  -6          // metronome gain dB
);

// Restore mutes
project.editing.modify(() => {
  tracks.forEach(t => t.audioUnitBox.mute.setValue(originalMuteState));
});
```

### Mode 2: Clean Stems

Render via stem path with metronome disabled.

```typescript
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
  false          // no metronome
);

// Split interleaved channels: [stem1_L, stem1_R, stem2_L, stem2_R, ...]
```

### Mode 3: Single Stem + Metronome

Mute all tracks except the target, render via mixdown path with metronome.

```typescript
project.editing.modify(() => {
  tracks.forEach(t => {
    const uuid = UUID.toString(t.audioUnitBox.address.uuid);
    t.audioUnitBox.mute.setValue(uuid !== selectedUuid);
  });
});

const channels = await renderRange(
  project, startPpqn, endPpqn, 48000,
  undefined,  // mixdown path (includes metronome)
  true, -6
);

// Restore mutes after copy is taken
```

## Range Selection: Bars to PPQN

```typescript
import { PPQN } from "@opendaw/lib-dsp";

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

// Channels → AudioBuffer → WAV
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
source.buffer = audioBuffer; // from channelsToAudioBuffer()
source.connect(audioContext.destination);
source.onended = () => { /* update UI */ };
source.start();

// Stop: source.stop(); source.disconnect();
```

This is completely separate from the OpenDAW engine — no interference with live playback.

## Reference

- Export demo: `src/export-demo.tsx`
- Range export utility: `src/lib/rangeExport.ts`
- Existing export docs: `documentation/audio-export.md`
- SDK offline renderer source: `packages/studio/core/src/OfflineEngineRenderer.ts`
- SDK deprecated renderer: `packages/studio/core/src/AudioOfflineRenderer.ts`
- Engine processor render method: `packages/studio/core-processors/src/EngineProcessor.ts`
- Engine preferences schema: `packages/studio/adapters/src/engine/EnginePreferencesSchema.ts`
- Metronome processor: `packages/studio/core-processors/src/Metronome.ts`
