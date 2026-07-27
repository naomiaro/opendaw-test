# OpenDAW SDK Changelog: 0.0.160 → 0.0.162

Two releases. **0.0.161 removes the TypeScript audio engine entirely** — the removal
announced when openDAW#315 closed ("The Typescript audio-engine will be removed soon")
— and lands a new *effect composite* device family (Frequency Split, Stereo Composite,
generic parallel chains). **0.0.162 adds Autotune**, a real-time pitch-correction audio
effect. This repo went WASM-only in PR #98, so the engine removal was philosophy-aligned
but still **breaking at the API level** (see below).

Sub-package versions (installed): `studio-adapters` 0.1.3, `studio-core` 0.1.3,
`studio-core-wasm` 0.0.7, `studio-boxes` 0.0.101, `studio-enums` 0.0.83.

## ⚠ Breaking: the TypeScript engine is gone (0.0.161)

`studio-core-processors`' entire DSP source tree is deleted upstream (every
`*DeviceProcessor`, `EngineProcessor`, `BlockRenderer`, Tape voices, FreeVerb, the
TS `Metronome`, voicing strategies — ~15k lines). What remains of the package is the
shared plumbing the WASM engine still uses. Consequences for consumers, all verified
against the installed dists:

- **`AudioOfflineRenderer` is deleted** (class + export). The offline render API is
  `OfflineEngineRenderer` only. Our `audioExport.ts` (effects + drum-scheduling demos)
  migrated to `OfflineEngineRenderer.start` — which renders `[0, lastRegionAction()]`,
  takes progress as a `DefaultObservableValue<number>` (not a `Progress.Handler`), and
  returns `AudioData` (not `AudioBuffer`; `WavFile.encodeFloats` accepts it directly).
- **`studio-core`'s dist no longer ships `offline-engine.js`** (the TS offline worker).
  Gotcha: the package.json `exports` map still lists `"./offline-engine.js"` — the entry
  points at a file that does not exist, so the import fails at build time, not resolve
  time. Removed from `projectSetup.ts`.
- **`OfflineEngineRenderer` API collapsed to one engine:**
  - `install(url)` → `install(url, attachment)` — the one worker, installed by
    `WasmEngine.install` (attachment carries the wasm artifacts base url).
  - `installVariant` / `installVariantPolicy` / `hasVariant` / `getWorkerUrl` — **gone**;
    `isInstalled()` is the remaining probe.
  - `create(source, config, sampleRate, variant?, abortSignal?)` → the `variant`
    parameter is **removed**: `create(source, config, sampleRate, abortSignal?)`.
    Same for `start(…)`. A stale `true` in the 4th slot now lands in `abortSignal`
    — TS catches it; do not leave it to runtime.
- **`EngineVariant.current()` is non-nullable** — `null` used to select the built-in TS
  engine; now a missing provider is a boot error ("No engine installed
  (WasmEngine.install must run before an engine boots)"). `EngineWorklet` always boots
  the installed variant's processor.
- **`WasmEngine.isEnabled` / `setEnabled` / `useForExports` are removed** (the
  `opendaw-wasm-engine` localStorage flag is dead — there is nothing to toggle to).
  `WasmEngine` is now just `install(urls)` / `ensureReady(ctx)` / `isReady()`.
  Our `installWasmEngine()` dropped its force-enable guard.

## ⚠ Breaking: `DeviceHost` chains are now `Option` (adapters 0.1.2)

`DeviceHost.midiEffects` / `audioEffects` / `midiEffectsField` / `audioEffectsField`
changed from bare values to `Option<…>` — `None` means "this host does not host that
chain kind at all" (an effect-composite branch hosts audio effects but no midi effects),
which is distinct from an empty chain. New `hostsInstrument: boolean` distinguishes
instrument-heading hosts (audio unit, Playfield slot) from composite branches. New
`DeviceHost` namespace helpers: `chainOf(host, accepts)`, `chainFieldOf(host, accepts)`,
`takesEffect(host, accepts)`.

**This repo is unaffected in code**: all our `insertEffect` call sites pass the *box*
field (`audioUnitBox.audioEffects`, unchanged schema), not the adapter getter. Anything
reading `audioUnitAdapter.audioEffects` must now unwrap.

## New device family: effect composites (0.0.161)

Parallel audio-effect chains as first-class devices — three boxes sharing one shape
(`entries` → `AudioEffectCompositeCellBox` branches, `dry`/`wet`, side-chain `input` tap):

- **`AudioEffectCompositeBox`** — broadcast distributor: every branch gets the full input.
- **`StereoCompositeBox`** — stereo distributor: entry 0 gets left, entry 1 gets right.
- **`FrequencySplitBox`** — frequency distributor: subtractive TPT **Linkwitz-Riley
  crossovers** (`crossover1..3` fields) split the input into bands, one branch per band,
  low to high, with exact reconstruction.

Each `AudioEffectCompositeCellBox` branch has its own `audioEffects` chain plus
`gain` / `pan` / `mute` / `solo` — a miniature mixer strip per branch. New pointer type
`Pointers.AudioEffectCompositeCell` (enums 0.0.83). The Rust engine registers these via
`EffectCompositeSpec` / `registerEffectComposite` (`core-wasm` 0.0.6+ —
`WasmEngineAttachment` gained an `effectComposites` array; supplied by
`WasmEngine.install`, transparent to consumers). Adapters: `AudioCompositeAdapter`,
`AudioEffectCompositeCellBoxAdapter` (a `DeviceHost` with audio-only chains),
plus preset encode/decode support for composite subtrees.

`EffectFactories.AudioNamed` grew `AudioEffectComposite`, `StereoComposite`,
`FrequencySplit` (and `Autotune`, below). Existing keys are unchanged — our
`EffectFactories.AudioNamed.Reverb` / `.Delay` call sites compile as-is.

## New device: Autotune (0.0.162)

`AutotuneDeviceBox` — real-time pitch correction, its own wasm plugin
(`device_autotune.wasm`, PSOLA). Parameters (all automatable):
`key` (C…B), `scale` (Chromatic, Major, Minor, Major/Minor Pentatonic, Blues, Dorian,
Mixolydian), `amount` (%), `retune` (%, speed), `smooth` (%), `shift` (±12 st).
Adapter `AutotuneDeviceBoxAdapter`, factory `EffectFactories.AudioNamed.Autotune`,
manual at `manuals/devices/audio/autotune`. 0.0.162's other commits refine its vibrato
handling (flatten gated on glide settledness).

## ProjectApi additions (core 0.1.2)

- **`moveEffects(targetField, boxes, insertIndex)`** — move existing effect boxes
  between chains (parent chain ↔ composite branch, or same-chain reorder): re-homes each
  box's `host` pointer and reindexes source + target chains contiguously. Caller guards
  against moving a composite into its own subtree.
- **`duplicateRegion(region, {findFreeSpace?, position?})`** — new explicit `position`
  option; the copy is created directly at its final position and overlap resolution
  (clip/push/keep) is evaluated exactly once there, never against a transient placement.
  An explicit `position` wins over `findFreeSpace`. The copy now also passes
  `target: targetTrack.box.regions` so overlap-resolver track redirection sticks.

## Misc

- `AutomatableParameterFieldAdapter`: the engine's live-stream now uses **NaN as the
  "automation attached but yields no value here" sentinel** — the adapter falls back to
  the storage value instead of misreading 0 as unit 0 (knob pinned to minimum).
- NAM (Neural Amp): model-info no longer crashes when the model file has no `config`.
- `lib-jsx` Router: a cancelled loading page is torn down before its replacement mounts.
- `DeviceManualUrls`: + `Autotune`, `FrequencySplit`.
- `PlayfieldSampleBoxAdapter` / `AudioUnitBoxAdapter`: updated to the `Option`-chain
  `DeviceHost` contract (`hostsInstrument` true / true respectively).
- Upstream studio UI work not in the SDK surface: composite drag-and-drop editing,
  per-branch peak meters, effect-preset application into the device's own chain.

## opendaw-headless follow-ups shipped with this upgrade

- `audioExport.ts` migrated off deleted `AudioOfflineRenderer` (see above) — public
  API (`exportFullMix` / `exportStems`) unchanged. One behavioral trap closed in the
  migration: `AudioOfflineRenderer.start` copied the project internally;
  `OfflineEngineRenderer` does NOT (it connects the **source's** `liveStreamReceiver`,
  which the live engine already holds → "Already connected"), so `audioExport` now
  renders from an explicit `project.copy()`.
- `projectSetup.ts` no longer installs a TS offline worker; `wasmEngine.ts` dropped the
  `setEnabled` force-enable; `rangeExport.ts` / `offlineScan.ts` dropped the `variant`
  argument.
- `wasm-ensure-ready-second-context-debug-demo`: retired former step 3 (the deprecated
  `AudioOfflineRenderer.start` repro — the API no longer exists to misbehave); step 2
  (second-context `ensureReady` registration bug) and step 4 (OfflineEngineRenderer
  workaround) still stand.
