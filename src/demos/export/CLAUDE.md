# Export Demo — OpenDAW SDK Reference

### Offline Audio Rendering (Export)
With `Option.None`, `ExportConfiguration.countStems(config)` returns 1 (not 0), so the
mixdown branch is selected (`stemExports.length === 0` inside the engine processor) and
the metronome is included. Provide a non-empty `ExportConfiguration.stems` map to take
the stem branch (metronome excluded).

**Higher-level shortcuts** (when you don't need step-by-step control):
- `AudioOfflineRenderer.start(source, optConfig, progress, abortSignal?, sampleRate?)` →
  `Promise<AudioBuffer>` (in `@opendaw/studio-core`) — one-shot mixdown/stems to a
  ready-to-play AudioBuffer.
- `OfflineEngineRenderer.start(source, optConfig, progress, abortSignal?, sampleRate?)` →
  `Promise<AudioData>` — same flow but returns the raw AudioData. Also exposes
  `.create(source, optConfig, sampleRate?)` for step-by-step (`play`, `step(samples)`,
  `setPosition`, `waitForLoading`, etc.) and `.render(config, start, end, progress, abortSignal?)`
  for arbitrary ranges.

Pass a copy (not the live project) — both wrappers create an `OfflineAudioContext`
that conflicts with the live `liveStreamReceiver`.

**Manual approach (full control over the pipeline):**
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
      useInstrumentOutput: true,
      skipChannelStrip: false,     // optional: bypass the channel-strip volume/pan
      fileName: "drums",
    },
    [UUID.toString(bassUnit.address.uuid)]: {
      includeAudioEffects: true,
      includeSends: true,          // include reverb/delay sends
      useInstrumentOutput: true,
      fileName: "bass",
    },
  },
  // Optional: range?: "full" | { start: ppqn, end: ppqn } — "full" or a section
};

// Pass to worklets.createEngine({ project: copy, exportConfiguration: stemConfig })
// Each stem renders to a stereo pair in the output buffer (interleaved by stem order)
```
- Mixdown path (`exportConfiguration` = undefined): all audio mixed, metronome included
- Stem path (`exportConfiguration` provided): per-track isolation, metronome excluded

## Reference Files
- Export demo: `src/demos/export/export-demo.tsx`
- Range export utility: `src/lib/rangeExport.ts`
- Audio export hook: `src/hooks/useAudioExport.ts`
