# Analysis Demos — OpenDAW SDK Reference

### WasmBpmDetector (SDK 0.0.167+)
`import { WasmBpmDetector } from "@opendaw/studio-core"` — implements the
`BpmDetector` seam from `@opendaw/studio-adapters`:
```typescript
const detector = new WasmBpmDetector("/wasm-engine/wasm/stretch_wasm.wasm");
const bpmOption = await detector.detect(audioData, progress); // Promise<Option<bpm>>
```
- Constructor takes the URL of `stretch_wasm.wasm` (served by the repo's
  wasm-engine-assets Vite plugin under `/wasm-engine/wasm/`; the studio app uses the
  same file from its own base URL). Requires `Workers.install` first — already done
  by `initializeOpenDAW`.
- Input is `AudioData` (SharedArrayBuffer-backed), NOT `AudioBuffer` — convert with
  `audioBufferToAudioData()` from `src/lib/audioUtils.ts`.
- Returns `Option<number>`: `None` means "no measurable tempo" (pads, one-shots,
  speech, tones, silence, files < 1.5 s). `None` is a first-class answer by design —
  the SDK stores bpm 0 and leaves the sample in seconds rather than warping it to a
  fabricated tempo. Handle with `.isEmpty()` / `.unwrap()`, never `?.`.
- The progress handler only ever fires `progress(1.0)` on completion — show a busy
  state, not a progress bar.
- Detection runs off the main thread in the core worker (`Workers.Bpm.detect`).
  Worker/module failures degrade to `None` with a console.warn, never a throw.

### Detection Is One Global Tempo — First 60 Seconds Only
The algorithm (`crates/stretch/src/tempo.rs`, exported as `detect_bpm` from
`crates/stretch-wasm`): spectral-flux
onset function → smoothed → autocorrelation with a harmonic comb (multiples up to 8)
→ log-normal tempo prior centered at 120 BPM → parabolic peak refinement → bar snap.
Hard limits to surface in UI copy and never design around:
- `max_analysis_seconds: 60` — only the FIRST 60 s of the file are analyzed
  ("tempo is a global property"). A tempo change at 1:30 is never seen.
- ONE number per file: no segment output, no tempo map, no rubato tracking.
- Period only, NO beat phase/downbeat detection — a metronome at the detected tempo
  can click offset from the actual hits even when the rate is exactly right.
- Search range 70–200 BPM. Octave errors are the benign, expected failure mode
  (a half-time backbeat at 87 may report 174 — still grid-aligned).
- Bar snap: a grid-cut loop measuring 127.94 snaps to exactly 128 when the file
  duration is within 0.05 bars of a whole bar count (`snapped_to_grid`; plus a
  looser ±5% ratio guard so the snap never moves the estimate far). The snap uses
  the FULL file duration — do NOT slice the buffer to the 60 s window before
  detection, it changes results for long files.
- The richer Rust-side `TempoEstimate` (correlation, snapped_to_grid) is discarded
  at the WASM boundary — JS receives a bare number (an f32 at the ABI; 0 = None).
- `min_duration_seconds: 1.5` — shorter files are refused.

### Metronome Verification Pattern
To prove a detected tempo by ear: set `timelineBox.bpm` to the detected value in its
OWN transaction BEFORE creating the track (per the separate-transaction rule; the PPQN
durations computed from the detected bpm only map back to the file's real length at
playback when the project bpm matches, and the metronome click reads it live), then
create Tape instrument + AudioFileBox + AudioRegionBox exactly as
`loadTracksFromFiles` does, enable `settings.metronome.enabled = true`, and play with
`loopArea` spanning the region. On replace: `audioUnitBox.delete()` cascades to track
lane and region, but AudioFileBox and ValueEventCollectionBox are freestanding
(referenced, not owned) — delete them explicitly and drop the `localAudioBuffers`
map entry.

## Reference Files
- BPM detect demo: `src/demos/analysis/bpm-detect-demo.tsx`
- AudioBuffer → AudioData conversion: `src/lib/audioUtils.ts` (`audioBufferToAudioData`)
- Transient detection (same worker family): `src/lib/transientDetection.ts`
