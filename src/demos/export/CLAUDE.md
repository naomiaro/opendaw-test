# Export Demo — OpenDAW SDK Reference

### Which Offline Render Path to Use (decision table)
`src/lib/rangeExport.ts` renders on two paths; pick by ONE question — does the render
need the metronome?

| Need | Path | Why |
|---|---|---|
| Exact-range mixdown/stems, no metronome | `OfflineEngineRenderer` `create → setPosition → play → waitForLoading → step(numSamples)` with `variant: false` | Current API, worker-based, exact frame count |
| Anything with the metronome | `OfflineAudioContext` + `AudioWorklets.createFor` + `createEngine` (EngineWorklet) | The ONLY path that reaches engine preferences |

Key facts behind the split (verified SDK 0.0.159):
- **Metronome enable/gain are engine PREFERENCES**, synced over the engine port's
  `"engine-preferences"` channel. `EngineWorklet` hosts the sync (`worklet.preferences`);
  `OfflineEngineRenderer` never attaches the host side — its processor keeps
  `EngineSettingsSchema` defaults (metronome disabled) with NO way to change them.
  Feature request filed upstream as
  [openDAW#316](https://github.com/andremichelle/openDAW/issues/316) — if it lands,
  the worklet path (and this split) can be retired.
- **`renderer.render(config, start, end, progress)` does NOT stop at `end`** — the worker
  loop runs until silence detection or `config.maxDurationSeconds`; `endPosition` only
  drives the progress observable. For exact ranges always use `step(numSamples)`.
- **`step(numSamples)` returns exactly numSamples frames** per channel
  (`numChannels = countStems × 2`), assembled from 128-frame quanta. Validate
  `channels.length` and `channels[0].length` anyway — a wedged worker returns garbage.
- **Pass `variant: false` explicitly** — `variant` defaults to
  `WasmEngine.useForExports()` (enabled && ready && hasVariant), so an installed+booted
  WASM engine silently flips variant-less renders to the WASM worker.
- **Pass a `project.copy()`, never the live project** — `create()` connects the source's
  `liveStreamReceiver` (throws "Already connected" against a live engine). The copy also
  isolates loopArea/mute mutations.
- **`play()` + `waitForLoading()` poll with no ceiling** — wrap them (and `step`) in a
  deadline (`src/lib/deadline.ts` `withDeadline`) or a wedged worker hangs the export
  forever with no error.
- **Do NOT use the deprecated `AudioOfflineRenderer`** — beyond deprecation it throws
  `InvalidStateError` once any WASM engine booted (openDAW#315, ensureReady registers the
  processor module only on the first context).
- Both paths verified to produce the SAME program material and identical frame counts
  (A/B: byte-identical WAV sizes; spectral bands ~same; metronome render differs by
  exactly the click content: +4.2 dB peak, +3.5 dB low-mid, tempo detector locks to
  project BPM from the clicks).

### Offline Audio Rendering (Export)
With `Option.None`, `ExportConfiguration.countStems(config)` returns 1 (not 0), so the
mixdown branch is selected (`stemExports.length === 0` inside the engine processor) and
the metronome bus is mixed in — when enabled, which on `OfflineEngineRenderer` it never
is (see above). Provide a non-empty `ExportConfiguration.stems` map to take
the stem branch (metronome excluded).

**Higher-level shortcuts** (when you don't need step-by-step control):
- `AudioOfflineRenderer.start(source, optConfig, progress, abortSignal?, sampleRate?)` →
  `Promise<AudioBuffer>` (in `@opendaw/studio-core`) — one-shot mixdown/stems to a
  ready-to-play AudioBuffer. `@deprecated` since studio-core@0.0.93; prefer
  `OfflineEngineRenderer` for new code (`progress` here is a `Progress.Handler`).
- `OfflineEngineRenderer.start(source, optConfig, progress, abortSignal?, sampleRate?)` →
  `Promise<AudioData>` — same flow but returns the raw AudioData. `progress` is a
  `DefaultObservableValue<number>` (NOT a `Progress.Handler`). Also exposes
  `.create(source, optConfig, sampleRate?)` for step-by-step (`play(): Promise<void>`, `step(samples)`,
  `setPosition`, `waitForLoading`, etc.) and `.render(config, start, end, progress, abortSignal?)`
  for arbitrary ranges (config is `OfflineEngineRenderConfig`, not `ExportConfiguration`).

Pass a copy (not the live project) — both wrappers connect the source's
`liveStreamReceiver`, which conflicts with a live engine.

**Manual approach (metronome renders — the one thing only this path can do):**
```typescript
const projectCopy = project.copy();
projectCopy.boxGraph.beginTransaction();
projectCopy.timelineBox.loopArea.enabled.setValue(false);
projectCopy.boxGraph.endTransaction();

const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
const worklets = await AudioWorklets.createFor(context);
const engineWorklet = worklets.createEngine({
  project: projectCopy,
  exportConfiguration, // undefined = mixdown (metronome included), config = stems (no metronome)
});
engineWorklet.connect(context.destination, 0);

// Engine preferences don't travel with project.copy() — set on worklet directly
engineWorklet.preferences.settings.metronome.enabled = true;
engineWorklet.preferences.settings.metronome.gain = -6; // dB, max 0

engineWorklet.setPosition(startPpqn);
await engineWorklet.isReady();
engineWorklet.play();
while (!(await engineWorklet.queryLoadingComplete())) { await Wait.timeSpan(TimeSpan.millis(100)); }
const audioBuffer = await context.startRendering();
projectCopy.terminate();
```

- Mixdown path (no `exportConfiguration`) = `EngineProcessor` branch `stemExports.length === 0` = metronome included
- Stem path (`exportConfiguration` provided) = per-track channels, metronome excluded
- `project.copy()` shares the same `sampleManager` (samples stay loaded) but NOT engine preferences
- Metronome gain: `z.number().min(-Infinity).max(0)` — default `-6` dB, max `0` dB (no boost, unlike track volume which goes to +6)
- Metronome schema also carries a `monophonic: boolean` field

### Mutate-Copy-Restore Pattern for Offline Rendering
`project.copy()` creates new box instances — you cannot modify the original project's
boxes through the copy's `editing.modify()` (throws "Modification only prohibited in
transaction mode"). To capture muted state in a copy:
```typescript
// 1. Save state, 2. Mutate original, 3. Copy (synchronous), 4. Restore original
const saved = track.audioUnitBox.mute.getValue();
project.editing.modify(() => track.audioUnitBox.mute.setValue(true));
const projectCopy = project.copy(); // synchronous — captures muted state
project.editing.modify(() => track.audioUnitBox.mute.setValue(saved)); // restore immediately
// 5. Use projectCopy for async rendering — original is already restored
```
The mute window is a single synchronous JS task — no audio blocks process in between.

### WavFile.encodeFloats Accepts Duck-Typed Input
`WavFile.encodeFloats` takes any `{sampleRate, length, numberOfChannels, getChannelData}`
— wrap `ExportResult.channels` directly instead of copying through `channelsToAudioBuffer`
when encoding render output for upload/download.
Encoders: `encodeFloats` (32-bit float) and `encodeInts16` (16-bit PCM, clamps to [-1,1]) —
no 24-bit encoder. `decodeFloats(buffer)` returns `AudioData`
(`{sampleRate, numberOfFrames, numberOfChannels, frames: Float32Array[]}`), NOT `{channels, numFrames}`.

### Transfer APIs (Cross-Project Copy)
`@opendaw/studio-adapters` provides namespace utilities for copying content between
projects. Both work across `BoxGraph`s — shared resources already present in the
target graph are reused rather than duplicated.

**TransferRegions** — copy a single region (with dependencies) to a target track:
```typescript
import { TransferRegions } from "@opendaw/studio-adapters";

const newRegion = TransferRegions.transfer(
  sourceRegion,     // AnyRegionBox
  targetTrack,      // TrackBox
  insertPosition,   // ppqn
  deleteSource = false,
);
```

**TransferAudioUnits** — copy whole mixer channels (effects, routing, automation):
```typescript
import { TransferAudioUnits } from "@opendaw/studio-adapters";

const newUnits = TransferAudioUnits.transfer(
  [sourceAudioUnitBox, ...],
  targetProject.skeleton, // ProjectSkeleton
  {
    insertIndex?: int,
    deleteSource?: boolean,
    includeAux?: boolean,
    includeBus?: boolean,
    excludeTimeline?: boolean,
  },
);
```

### Preset Encode/Decode (Audio Unit State)
Encode/decode preset is per `AudioUnitBox` (a mixer channel), not per device:
```typescript
import { PresetEncoder, PresetDecoder } from "@opendaw/studio-adapters";
import type { PresetHeader } from "@opendaw/studio-adapters";

// Encode an audio unit (instrument + effects + optional timeline)
const bytes = PresetEncoder.encode(audioUnitBox, {
  excludeEffect?: (box) => boolean, // skip specific effect boxes
  includeTimeline?: boolean,        // include track regions/events
});

// Decode into a target project — returns the new audio unit boxes
const newUnits = PresetDecoder.decode(bytes, targetProject.skeleton);

// Replace an existing audio unit's contents (preserving the box identity)
PresetDecoder.replaceAudioUnit(bytes, existingAudioUnitBox, {
  keepMIDIEffects?: boolean,
  keepAudioEffects?: boolean,
  keepTimeline?: boolean,
}); // returns Attempt<void, string>

// Encode just an effect chain (no audio unit)
const chainBytes = PresetEncoder.encodeEffects(effectBoxes, PresetHeader.ChainKind.Audio);
PresetDecoder.insertEffectChain(chainBytes, targetUnit, insertIndex, PresetHeader.ChainKind.Audio);
```
`PresetHeader.ChainKind` is `{ Midi, Audio }`. `PresetHeader` also exposes
`MAGIC_HEADER_OPEN` and `FORMAT_VERSION` constants. `PresetDecoder.peekHasTimeline(buffer)`
checks whether a preset includes timeline content without fully decoding.

### Stem Export Configuration
When exporting individual stems (vs full mixdown), `ExportConfiguration.stems` is a
record keyed by audio unit UUID:
```typescript
import type { ExportConfiguration } from "@opendaw/studio-adapters";

const stemConfig: ExportConfiguration = {
  stems: {
    [UUID.toString(drumUnit.address.uuid)]: {
      includeAudioEffects: true,   // render with effects
      includeSends: false,         // exclude aux sends
      useInstrumentOutput: false,  // see below — true bypasses effects/sends/strip
      skipChannelStrip: false,     // optional: bypass channel-strip volume/pan (and drops sends)
      fileName: "drums",
    },
    [UUID.toString(bassUnit.address.uuid)]: {
      includeAudioEffects: true,
      includeSends: true,          // include reverb/delay sends
      useInstrumentOutput: false,
      fileName: "bass",
    },
  },
  // range is honored ONLY by OfflineEngineRenderer.start/create — see below
};

// Pass to worklets.createEngine({ project: copy, exportConfiguration: stemConfig })
// Each stem renders to a stereo pair in the output buffer (interleaved by stem order)
```
`useInstrumentOutput: true` wires the raw instrument output directly to the bus and returns
early — audio effects, aux sends, AND the channel strip are all bypassed, so
`includeAudioEffects` / `includeSends` are dead. Set it `false` (or omit) for an
effects-inclusive stem; openDAW's own export dialog omits the flag.
`skipChannelStrip: true` also drops aux sends regardless of `includeSends` (same
early-return-before-sends mechanism) — it bypasses the channel-strip volume/pan/mute.
`ExportConfiguration.range` is read ONLY by `OfflineEngineRenderer`; the manual
`worklets.createEngine` path (`EngineProcessor`) never reads it.
- Mixdown path (`exportConfiguration` = undefined): all audio mixed, metronome included
- Stem path (`exportConfiguration` provided): per-track isolation, metronome excluded

## Reference Files
- Export demo: `src/demos/export/export-demo.tsx`
- Range export utility: `src/lib/rangeExport.ts`
- Audio export hook: `src/hooks/useAudioExport.ts`
