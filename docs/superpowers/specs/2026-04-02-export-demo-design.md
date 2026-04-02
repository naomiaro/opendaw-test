# Export Demo Design Spec

## Purpose

Demonstrate advanced audio export capabilities using the low-level `OfflineEngineRenderer.create()` + `step()` API: range-bounded export, metronome-only export, clean stem export, and single stem + metronome export.

## Audio Content

Dark Ride stems (124 BPM), same as the effects demo. Standard transport controls for live preview.

## Export Modes

All modes accept a start/end range in bars, converted to PPQN internally.

### Mode 1: Metronome Only

- Mute all tracks in the project
- Enable metronome in engine preferences (with user-specified gain)
- Create renderer with `Option.None` (non-stem path, so metronome is mixed into output)
- `setPosition(startPpqn)` + `step(numSamples)` for exact range
- Unmute tracks after renderer is created (serialization already captured the muted state)
- Output: single stereo WAV of metronome clicks for the selected range

### Mode 2: Clean Stems

- User selects which tracks to include via checkboxes (all selected by default)
- Disable metronome in engine preferences
- Create renderer with `ExportStemsConfiguration` containing only the selected tracks
- `setPosition(startPpqn)` + `step(numSamples)` for exact range
- Output: one stereo WAV per selected track, no metronome

### Mode 3: Single Stem + Metronome

- User selects which track from a dropdown
- Mute all tracks except the selected one
- Enable metronome in engine preferences
- Create renderer with `Option.None` (non-stem path, so the unmuted track + metronome mix together)
- `setPosition(startPpqn)` + `step(numSamples)` for exact range
- Unmute tracks after renderer is created
- Output: single stereo WAV of the selected track mixed with metronome

## Range Selection

- Two numeric inputs: Start Bar and End Bar (1-indexed, whole bars)
- Default range: bar 1 to last bar (derived from `project.lastRegionAction()`)
- Bar-to-PPQN conversion: `(barNumber - 1) * PPQN.fromSignature(nom, denom)` using the project's time signature (read from `project.timelineBox.signature`)
- Sample count: `Math.ceil(project.tempoMap.intervalToSeconds(startPpqn, endPpqn) * sampleRate)`

## Rendering Pipeline

All three modes follow the same pattern:

```
1. Snapshot current project state (mute states, metronome enabled/gain)
2. Mutate project state for the export mode
3. Create renderer: OfflineEngineRenderer.create(project, config, 48000)
4. Restore project state (renderer already serialized the snapshot)
5. renderer.setPosition(startPpqn)
6. renderer.play()
7. channels = await renderer.step(numSamples)
8. renderer.terminate()
9. Encode to WAV / create preview AudioBuffer
```

Step 4 happens immediately after step 3 — the renderer serializes the project into a worker on creation, so restoring state does not affect the render.

## Output & Preview

Each export produces:
- **In-browser preview**: `AudioBuffer` created from the rendered `Float32Array[]` channels, played via an `AudioBufferSourceNode` connected to `audioContext.destination` (separate from the engine). Play/stop controls per export result.
- **Download**: WAV file via `WavFile.encodeFloats()` from `@opendaw/lib-dsp`. Triggered by a download button.
- **Metadata display**: duration (seconds), sample rate, file size (KB/MB).

For Mode 2 (clean stems), each stem gets its own preview player and download button.

## UI Layout

### Transport Section
- Play / Stop buttons for live playback (standard transport)
- BPM display (124)

### Metronome Settings
- Enable/disable toggle (affects live playback too)
- Gain slider (dB, range -60 to 0)
- Beat subdivision selector (quarter, eighth, 16th, 32nd)

### Range Selection
- Start Bar input (number, min 1)
- End Bar input (number, min start bar, max derived from last region)
- Total bars / duration display

### Export Actions
- "Export Metronome Only" button (Mode 1)
- Track checkboxes for stem selection (select/deselect all toggle)
- "Export Stems" button (Mode 2, exports selected tracks)
- Track dropdown + "Export Stem + Metronome" button (Mode 3)
- Progress bar (shared, one export at a time)

### Results Section
- List of export results, each with:
  - Label (e.g., "Metronome (bars 17-25)", "Guitar", "Drums + Metronome")
  - Duration and file size
  - Play / Stop preview buttons
  - Download WAV button
- "Clear Results" button

## Files

### New Files
- `export-demo.html` — HTML entry point (minimal style, matching existing demos)
- `src/export-demo.tsx` — Main React component
- `src/lib/rangeExport.ts` — Export utilities using `OfflineEngineRenderer.create()` + `step()`

### Modified Files
- `vite.config.ts` — Add `export` entry to `rollupOptions.input`
- `src/index.tsx` — Add export demo card to the index page

### Reused
- `src/lib/projectSetup.ts` — `initializeOpenDAW({ localAudioBuffers, bpm: 124 })`
- `src/lib/trackLoading.ts` — `loadTracksFromFiles()` for Dark Ride stems
- `src/lib/audioUtils.ts` — `getAudioExtension()` for Safari compatibility
- `src/components/GitHubCorner.tsx`, `BackLink.tsx`, `MoisesLogo.tsx` — standard layout
- `@opendaw/lib-dsp` — `WavFile.encodeFloats()` for WAV encoding

## rangeExport.ts API

```typescript
interface RangeExportOptions {
  project: Project;
  audioContext: AudioContext;
  startPpqn: ppqn;
  endPpqn: ppqn;
  sampleRate?: number; // default 48000
  onProgress?: (progress: number) => void;
  abortSignal?: AbortSignal;
}

interface ExportResult {
  label: string;
  channels: Float32Array[];
  sampleRate: number;
  durationSeconds: number;
  audioBuffer: AudioBuffer; // for preview playback
}

// Mode 1: Metronome only for a range
async function exportMetronomeOnly(
  options: RangeExportOptions & { metronomeGain?: number }
): Promise<ExportResult>;

// Mode 2: Clean stems for a range (selected tracks only)
async function exportStemsRange(
  options: RangeExportOptions & {
    audioUnitUuids: string[]; // which tracks to export
  }
): Promise<ExportResult[]>; // one per selected track

// Mode 3: Single stem + metronome for a range
async function exportStemWithMetronome(
  options: RangeExportOptions & {
    audioUnitUuid: string;
    metronomeGain?: number;
  }
): Promise<ExportResult>;
```

Each function follows the snapshot/mutate/create/restore/render/encode pattern described above.

## Key Technical Details

- `OfflineEngineRenderer.create()` serializes the project via `project.toArrayBuffer()` — state mutations before creation are captured, restoration after creation is safe
- `Option.None` for export config means the normal playback path runs, which includes metronome when `preferences.settings.metronome.enabled` is true
- `ExportStemsConfiguration` triggers the stem path, which excludes metronome entirely
- Muting tracks: `audioUnitBox.mute.setValue(true)` inside `editing.modify()`
- The renderer runs in a Web Worker — `OfflineEngineRenderer.install(workerUrl)` must be called. This is NOT currently done in `projectSetup.ts`. We need to add `import OfflineEngineUrl from "@opendaw/studio-core/offline-engine.js?worker&url"` and call `OfflineEngineRenderer.install(OfflineEngineUrl)` during init (same pattern as `Workers.install` and `AudioWorklets.install`)
- `step()` returns `Float32Array[]` — for `Option.None` that's 2 channels (L/R); for stems it's `stemCount * 2` channels

## What This Demo Does NOT Include

- No visual timeline/waveform range selector (text inputs only)
- No format options beyond WAV
- No "export all" button that runs all three modes at once
- No loop area manipulation (range is independent of the timeline loop)
