# OpenDAW SDK Changelog: 0.0.165 → 0.0.167

Two releases (0.0.166 was published from this range but never pinned here; there is no
`@opendaw/studio-sdk@0.0.166` tag upstream — the 0.0.167 tag covers both). Headline: a
new **offline tempo + material analysis stack** (Rust `crates/stretch/tempo.rs` shipped
as `stretch_wasm.wasm`, surfaced as `WasmBpmDetector` / `AudioMaterialAnalyzer` through
new `Workers.Bpm` / `Workers.Material` channels), and **one breaking change for this
repo**: `SampleService` now requires a `BpmDetector` as its second constructor argument.
Alongside: `ProjectApi.createTrackRegion` now **resolves overlaps** (default mode clips —
deletes/trims covered regions — then hard-validates the track) and **seeds a new
automation region with one inherited node** (#271), `SampleLoader` gains a synchronous
`meta` getter that `AudioContentModifier` uses to **resize regions to the sample's own
tempo** on stretch-mode conversions, `LoopableRegion` guards degenerate loop durations,
and the Rust engine fixes note clip/region **consolidation rebinding** (#337), polyphonic
**glide source selection** (#334), and Autotune **near-zero onset note changes** (#338).

Sub-package versions (installed): `studio-adapters` 0.2.1, `studio-core` 0.2.1 (both
jumped 0.1.6 → 0.2.x on the breaking SampleService change), `studio-core-wasm` 0.0.12,
`studio-boxes` 0.0.105 (version bump only — no schema diff in forge-boxes),
`studio-enums` 0.0.84 (unchanged). `engine.wasm` SHA-256 changed
(`810e767b…` → `767ac356…`) — the note-rebind / voicing / autotune fixes shipped.
`stretch_wasm.wasm` in core-wasm dist gains the `detect_bpm` export.

## BREAKING: SampleService requires a BpmDetector (core 0.2.x, adapters 0.2.x)

```typescript
new SampleService(audioContext, bpmDetector)  // was: new SampleService(audioContext)
```

`BpmDetector` (new, `@opendaw/studio-adapters`) is
`{ detect(audioData, progress): Promise<Option<bpm>> }`. `Option.None` means "unknown"
and is stored as `SampleMetaData.bpm = 0`, which leaves the material in seconds
(unwarped). Implementations:

- **`BpmDetector.Unknown`** — never guesses, always `None`.
- **`WasmBpmDetector(moduleUrl)`** (core) — runs Rust tempo detection
  (`crates/stretch/tempo.rs`, ~430 lines, autocorrelation-based) in the core worker via
  the new `Workers.Bpm` channel; `moduleUrl` points at `stretch_wasm.wasm` from the
  core-wasm dist. Degrades to `None` on any failure (missing module never fails an
  import). The studio app wires this one.

Behavioral change inside `importFile`: the bpm fallback was `bpm ?? estimateBpm(duration)`
(fabricate a tempo from length); it is now detector-or-0. A caller-supplied bpm remains
authoritative and skips detection entirely — `importRecording(audioData, bpm, name)` is
unchanged. `AssetService.ImportArgs` carries `bpm?`, and `importFile` gains an optional
`transformMeta(meta, audioData)` hook. `AudioConsolidation` now passes the project bpm to
its flatten-import (a render knows its tempo). `estimateBpm` itself is still exported
from `lib-dsp`, just no longer called here.

**This repo:** `projectSetup.ts` now passes `BpmDetector.Unknown` — nothing here calls
`importFile` (recording finalization goes through `importRecording` with an explicit
bpm), so the no-op detector preserves existing behavior exactly.

## New: offline tempo + material analysis stack (lib-dsp, core-workers, core, core-wasm)

- **`BpmProtocol`** (lib-dsp) + **`Workers.Bpm`** channel: worker-side
  `detectBpm(audioData, moduleUrl)` copies planar PCM into the wasm module's memory and
  calls the new `detect_bpm` export; 0 = no measurable pulse.
- **`AudioMaterial`** namespace + **`AudioMaterialFeatures`/`AudioMaterialSegment`**
  (lib-dsp): measured features of imported audio — transient density, attack sharpness,
  tonality/harmonicity, inter-onset grid regularity, RMS — plus a documented logistic
  `drumLoopProbability` heuristic (weights are exported constants, explicitly draft).
  Purpose: pick a stretch algorithm without asking (percussive → `AudioTimeStretchBox`,
  sustained → `AudioSignalsmithBox`) — but it decides nothing itself.
- **`AudioMaterialAnalyzer(moduleUrl)`** (core) + **`Workers.Material`** channel: runs
  the `crates/stretch` analyzer (same wasm module, 64-byte `#[repr(C)]` transient
  records) off the main thread. Rejects on module failure — unlike bpm there is no sane
  "unknown" to degrade to.
- **The `studio-sdk` meta-package now has real exports** beyond `OPENDAW_SDK_VERSION`:
  `BpmDetector`, `SampleService`, `WasmBpmDetector`, `Workers`, `AudioMaterial`,
  `AudioMaterialAnalyzer` and the feature types re-exported at the top level.
- `TempoDetectionTask` (lib-inference, tempo-cnn) now accepts **any sample rate ≥ 11025
  Hz** — polyphase halvings plus a zero-phase (forward-backward biquad) lowpass and
  linear SRC replace the old "11025/22050/44100/88200 only" panic.
- Both worker channels ride the existing `Workers.install(workersUrl)` — the worker
  bundle comes from `@opendaw/studio-core/workers-main.js`, so this repo picks the new
  channels up automatically.

## ProjectApi.createTrackRegion: overlap resolution + automation seed (core 0.2.x)

`createTrackRegion` (Notes and Value tracks) previously stacked a new region on top of
whatever occupied the range — a later `validateTracks` hard-asserted and crashed
(upstream live errors 1086/1087). Now it runs `project.overlapResolver.fromRange(track,
start, end)` around the creation, honoring the studio `overlapping-regions-behaviour`
setting (**default `"clip"`**: covered regions are deleted, partially-covered ones
trimmed, then `RegionClipResolver.validateTrack` runs).

For Value tracks it additionally **seeds one `ValueEventBox` at region-local position 0**
(#271): the preceding region's outgoing value, else the following region's incoming
value, else the parameter's current dial value — computed before the region is created.

`RegionClipResolver` itself gains a **`static fatal`** flag: violations `panic` when true
(default — tests and dev fail loudly), log-and-continue when false (the studio app flips
it off in production boot so a stray overlap can't kill a session). Overlap comparison
now tolerates float slivers via a boundary tolerance.

**This repo:** two demos re-create automation regions and write their own position-0
events — both collide with the seed ((position, index) is a composite key; duplicates
panic "are identical in terms of comparison"), and the overlap resolver deletes old
regions the demos then tried to delete again. One subtlety cost a browser-verified
iteration: clearing the seed via `adapter.optCollection …events.asArray()` **inside the
creating transaction is a no-op** — the adapter's event collection doesn't see the seed
box until the transaction commits, so the clear must run in a separate follow-up
transaction (the create/configure split CLAUDE.md already prescribes for captures and
pointer re-routing):

- `track-automation-demo.tsx`: creates the region in one transaction; clears the seed and
  writes the preset curve in a second; skips old-region deletion for boxes the clip
  resolver already removed (verified: all 10 presets across 3 tracks apply with a clean
  console).
- `compLaneUtils.ts` (comp lanes): splits rebuildAutomation into delete-old+create-regions
  then clear-seeds+write-events transactions (verified: demo-vocals load and lane
  reassignment clicks run with a clean console).

## SampleLoader.meta + tempo-aware stretch conversions (adapters 0.2.x, core 0.2.x)

`SampleLoader` gains **`get meta(): Option<SampleMetaData>`** — synchronous access to the
loaded sample's metadata (tempo included) from the copy already in memory.
`DefaultSampleLoader` serves it; `RecordingWorklet` (a loader for the take in progress)
returns `None` until finalization.

`AudioContentModifier.toTimeStretch` / `toPitchStretch` / `toSignalsmith` use it: when
converting a **NoWarp** region whose sample has a known tempo (`meta.bpm > 0`), the
seeded warp-marker pair is now (sample's own musical span at that tempo, audio length in
seconds) instead of (region span, region seconds) — and a region that still exactly
covers its audio (±1 ms) is **resized** to that measured span (loopOffset scaled,
duration clamped to the gap before the next region so growth never creates an overlap).
A region the user has trimmed or extended keeps its span. Two subtle fixes ride along:
the seeded audio length is now the actual audible extent (file minus waveform offset) —
previously enlarging a region past its audio seeded a marker pointing into silence and
the mapping stayed 1:1 — and warp-marker adoption + time-base switching compose in one
step. Conversions with existing warp markers (mode-to-mode switches) still adopt them
unchanged.

**This repo:** the warp/time-pitch demos hand-build their stretch boxes (they don't call
`AudioContentModifier`), so no code path changes; note that our custom sample-manager
fetch stamps `meta.bpm` with the **project** bpm, which is now visible to any future
`AudioContentModifier` use.

## LoopableRegion: degenerate loopDuration guard (lib-dsp)

`locateLoop` and the `locateLoops` generator now return no cycles when
`loopDuration` is 0, negative, or NaN (NaN-rejecting comparison). Previously a
degenerate duration could hang the calling thread in `locateLoops` (rawStart never
advanced). Complements this repo's long-standing "NoteRegion needs loopDuration" note:
a `loopDuration: 0` region is now a guaranteed-silent no-op rather than a potential hang.

## Rust engine fixes (core-wasm 0.0.12)

- **Note clip/region consolidation rebind (#337):** each note region/clip binding now
  watches its `events` pointer (mirroring the audio side's play-mode pointer sub).
  Consolidating a mirrored region, or copying a clip, repoints `events` at a fresh
  collection — the old binding kept playing the ORIGINAL notes. A rebuild triggered by
  the pointer move keeps a playing clip's launch state (swap notes, don't stop).
- **Polyphonic glide source (#334):** glide seeded from the first released voice by slot
  index and never marked it spent — with a long release, every note glided from the same
  stale tail. Now: the NEWEST still-decaying released voice, spent once per note.
- **Autotune near-zero onset note changes (#338):** a sustained jump beyond ±0.7
  semitones re-seeds the pitch centre after 2 control frames (~11 ms) instead of gliding
  through the 120 ms one-pole; at full-hard retune it locks in one frame (~5 ms).
  Vibrato-sized drifts still glide. A ~4 ms declick floor on the smooth stage stops the
  hard-retune step from rendering as an audible click.

## DawProject import: derived loop window (#336) (core 0.2.x)

Clips without loop markers previously imported with whatever loop window fell out of the
schema — now the importer derives a positive window: `loopOffset = playStart`,
`loopDuration = loopEnd` when given (a non-zero `loopStart` is not representable and
warns), else `max(contentDuration, playStart + duration)` so the content plays once.
Covers note, audio, and nested-clip content; tests added.

## Misc

- `validateTrack` in the shipped studio app is non-fatal (see `RegionClipResolver.fatal`
  above); upstream also fixed two UI-outlives-model crashes (1094/1095) and added a
  `ClipCellLifetime` regression test.
- Studio-app-only (not SDK surface): `AudioMaterialDialog` (visualizes the new material
  features), sample dialogs/upload page showing detected tempo, region-modifier
  selection consolidation (`RegionModifierSelection`), Deminix example gains parameter
  groups + color, snapping/UI polish.
- `plans/riffle-material-classifier.md` (upstream) documents the intended corpus-fitting
  of the draft material-classifier weights.

## opendaw-headless follow-ups shipped with this upgrade

- `src/lib/projectSetup.ts`: `new SampleService(audioContext, BpmDetector.Unknown)` —
  no-op detector, behavior-preserving (nothing here calls `importFile`; the comment
  documents the `WasmBpmDetector` upgrade path).
- `src/demos/automation/track-automation-demo.tsx` and `src/lib/compLaneUtils.ts`:
  two-transaction restructure around `createTrackRegion` — create regions first, then
  clear the seeded node and write events in a follow-up transaction (see the
  createTrackRegion section above for why one transaction cannot work); the
  track-automation demo also skips deleting regions the overlap resolver removed.
- Every API claim above verified against the installed tarballs
  (`node_modules/@opendaw/*/dist`): `SampleService` constructor, `BpmDetector.Unknown`,
  `WasmBpmDetector`, `Workers.Bpm`/`Workers.Material`, `SampleLoader.meta`,
  `RecordingWorklet.meta`, `Project.overlapResolver`, `RegionClipResolver.fatal`,
  `AssetService.ImportArgs.bpm` + `transformMeta`, the sdk index re-exports, the
  `LoopableRegion` guards, and the `"clip"` default for
  `overlapping-regions-behaviour` in `StudioSettings`.
- Verification results: see PR notes (tsc baseline, build, tests, audio-verify suite).
