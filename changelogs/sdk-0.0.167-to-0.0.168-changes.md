# OpenDAW SDK Changelog: 0.0.167 → 0.0.168

One release. Two headline features: **Cubed**, a new 303-style bassline instrument (box
schema + adapter + Rust WASM plugin + `InstrumentFactories.Cubed`), and the **Playfield
auto-chop stack** promoted to SDK surface (`ChopModel`/`ChopMath`/`GridDivisions` +
`PlayfieldDeviceBoxAdapter.chop()` re-exported from `@opendaw/studio-sdk`). Alongside:
automation-region seeds are now **interpolation-aware** (float parameters ramp, bool/int
parameters step), regions/clips are **no longer created with default "Notes"/"Automation"
labels** (a migration clears stored ones), parameter display names became **observable
and display-cased** ("volume" → "Volume", #342), the **Neon synth finally honors note
velocity** (audible change — it previously ignored it), Spielwerk gains a `@no-pass`
directive (scriptless/broken devices now forward notes instead of muting the chain),
offline renders broadcast master **PEAKS** telemetry, and ysync collab publishes its
deterministic repairs back to the room document.

Sub-package versions (installed): `studio-adapters` 0.3.0 (was 0.2.1 — new Cubed/Chop
adapters + the observable-name constructor change), `studio-core` 0.2.2 (was 0.2.1),
`studio-core-wasm` 0.0.13 (was 0.0.12), `studio-boxes` 0.0.106 (was 0.0.105 — new
`CubedDeviceBox`/`CubedPattern`), `studio-enums` 0.1.0 (was 0.0.84 — new
`IconSymbol.Vaporisateur/FolderOpen/FolderAdd`, new `Pointers.Pattern`). `engine.wasm`
SHA-256 changed (`767ac356…` → `50d534ed…`); the core-wasm dist ships a new
`plugins/device_cubed.wasm`.

## New instrument: Cubed (303-style bassline synth)

- **`CubedDeviceBox`** (studio-boxes): params `tuning` (±1200 ct), `cutoff`, `resonance`,
  `env-mod`, `decay`, `accent` (unipolar), `volume` (dB), `waveform` (0=saw, 1=square,
  automatable Int32), `pattern-index` (0–15, automatable) — plus a 16-slot `patterns`
  array of `CubedPattern` objects (`length` 1–64 + 64 packed Int32 `steps`; each step
  packs midi-note (7 bits) | on/off | slide | accent — the adapter packs/unpacks).
- **`CubedDeviceBoxAdapter`** (studio-adapters): `namedParameter.*`, plus pattern ops
  `currentPattern()`, `readCurrentPattern()` / `writeCurrentPattern(data)`,
  `clearCurrentPattern()`, `randomizeCurrentPattern(options)`,
  `rotateCurrentPattern(offset)`. `CubedPatternData` has `toJSON`/`fromJSON`
  (`"cubed-pattern"` type tag, version 1) and `parseNote` (`60`, `C3`, `C#3`).
  `AblPattern` parses the AudioRealism Bass Line pattern text format (#343 shipped a
  copy/paste clipboard around it in the studio; `ClipboardManager.encode/decode` were
  exported for it).
- **`InstrumentFactories.Cubed`** — trackType Notes, `briefDescription` "303-style
  Synth"; registered in `InstrumentBox` union, `BoxAdapters` visitor, and the WASM
  engine's device module list (`device_cubed.wasm`). The pattern sequencer runs in the
  DEVICE (Rust), not the engine: the box's packed `steps` array is delivered to the
  plugin whole, which needed two engine-side additions —
  **`FIELD_KIND_INT_ARRAY`/`PACKAGE_INT_ARRAY`** (an array field flattens to one
  contiguous i32 buffer for the synchronous `device_field_changed` call) and
  **`Propagation.Parent` field observation** (array elements are edited one level below
  the observed address; an exact-address monitor would only ever see the catch-up).

**This repo:** nothing to change — new opt-in instrument. A Cubed demo (step grid +
acid bassline) is an obvious future candidate; the whole pattern API is main-thread
adapter surface, no UI dependencies.

## Playfield auto-chop exported through the SDK

`@opendaw/studio-sdk` now re-exports `ChopMath`, `ChopModel`, `GridDivisions`,
`PlayfieldDeviceBoxAdapter` (+ types `ChopMode`, `GridDivision`, `PlayfieldChopOptions`,
`PlayfieldChopSlice`). The intended flow (per the sdk index doc comment): slice
boundaries live in a pure-math `ChopModel` as unit values — seed via
`fromTransients(transientSeconds, duration, maxSlices)` (feed
`Workers.Transients.detect`, which predates this release) or `fromGrid(bpm, division,
duration, maxSlices)`; edit via `dragBoundary` / `splitAt` / `removeBoundary`; then pass
`model.slices(startKey)` to **`PlayfieldDeviceBoxAdapter.chop({file, startKey,
slices})`** inside `editing.modify()`. `chop` deletes the slot adapters in the target
key range and creates one `PlayfieldSampleBox` per slice (all sharing one
`AudioFileBox`, `sampleStart`/`sampleEnd` from the slice, `exclude` set). Helpers:
`ChopMath.fitBpmPow2(duration)` (folds 60/duration into 90–180 BPM),
`ChopMath.sliceSecondsForGrid(bpm, division)`, `ChopMath.MAX_KEY = 128` (slice count is
capped at generation AND `slices()` clamps to the MIDI ceiling). The chop dialog stays
in the studio — hosts bring their own UI.

Related Playfield fix (#339): a slot's waveform + label now reload when the slot's
sample pointer is repointed at a different file.

## Automation seed: interpolation-aware (#271 follow-up)

`createTrackRegion` on a Value track still seeds one node at region-local position 0,
but the seed now carries an interpolation matched to the parameter:
`InterpolationFieldAdapter.map(type)` → `Interpolation.None` (step) for Int32/Boolean
parameters, `Interpolation.Linear` for floats. New exports: `AutomationSeed` type
(core), `InterpolationFieldAdapter.Plain` + `.map()` (adapters). Previously a mute/solo
automation seed ramped as if continuous. Upstream tests cover both paths.

**This repo:** no change needed — `track-automation-demo.tsx` and `compLaneUtils.ts`
clear the seed in a follow-up `editing.append()` before writing their own events (the
0.0.167 restructure), so the seed's interpolation never survives to playback.

## Regions/clips no longer labeled "Notes"/"Automation" (+ migration)

`createNoteClip` / `createValueClip` / `createNoteRegion` / `createTrackRegion` now
write `""` when no name is given (was `"Notes"` / `"Automation"`), and
`RecordAutomation` no longer stamps the parameter name on recorded value regions —
the UI composes display names at draw time (automation regions render their parameter's
name via the new `TrackBoxAdapter.targetControlName`). A new migration,
`migrateDefaultLabels`, clears the stored literal `"Notes"`/`"Automation"` labels from
old projects (they would otherwise read as user-chosen names).

**This repo:** audited — no demo reads note/value region labels; all label reads target
custom labels the demos wrote themselves (audio regions named "Guitar", clip-fade type
names, `comp:`-prefixed metadata labels). The label-metadata pattern in CLAUDE.md is
unaffected (custom prefixes never collide with the cleared literals).

## Observable, display-cased parameter names (#342)

`AutomatableParameterFieldAdapter` now accepts `string | ObservableValue<string>` as its
name and exposes **`catchupAndSubscribeName(observer)`**; `.name` still returns a plain
string (`getValue()` behind the getter). `ParameterAdapterSet.createParameter` forwards
the union. Motivation: MIDI-output device parameters rename with the device's channel
config, and value-track headers must follow. `TrackBoxAdapter` gains **`get
targetControlName(): Option<string>`** (synchronous read), and its internal
subscription now tracks name changes live. Built-in names were re-cased for display:
audio-unit `"volume"/"panning"/"mute"/"solo"` → `"Volume"/"Panning"/"Mute"/"Solo"`,
groove `"duration"/"amount"` → `"Duration"/"Amount"`; Werkstatt `@param` labels are
displayed through the new **`Strings.capitalize`** (lib-std, mirrors CSS
`text-transform: capitalize`) while the STORED label stays verbatim (ScriptCompiler
keys parameter boxes by it). Also new: `StringMapping.oneBasedIndex(unit?)` (lib-std) —
displays 0-based ints as 1-based (Cubed's pattern index).

**This repo:** no demo renders `adapter.name` — no impact. Anything future that
compares against `"volume"`-style lowercase names must use the new casing.

## Neon honors note velocity (audible change)

`NeonVoice` now stores the note-on velocity and scales its output by
`velocity_to_gain(velocity)` — velocity was previously IGNORED (every note played
full-scale). **This repo:** the Neon demo sends `sendNoteOn(note, 0.8)`, so it now
plays quieter than at 0.0.167 by that mapping's 0.8 gain. Behavior, not a bug — no
code change; re-baseline any future loudness measurements against 0.0.168.

## Spielwerk: `@no-pass` directive + transparent fallback

A Spielwerk (note transformer) script now FORWARDS its input verbatim and adds
generated notes on top; a script opts out with a `// @no-pass` line (malformed forms
throw at compile). New `ScriptDeclaration.parsePassThrough(code)`; the compiled
registry entry carries the verdict (`pass`), and the WASM script bridge forwards input
events when no live Processor exists — so a device whose script never loaded (or died)
is transparent rather than a mute button. A `@no-pass` script keeps its silence. Also:
Spielwerk releases held notes on a transport jump.

## Offline renders broadcast master PEAKS

The core-wasm offline worker now runs a `PeakBroadcaster` next to its
spectrum/waveform taps, so a live-stream consumer of an offline render (the video
export's shadertoy reads `iPeaks`) receives peak data — previously zero, and shaders
scaling by it rendered black. Render loop refactored to pass the whole `EngineState`.

## YSync: repairs are published back to the room (collab)

`deterministicReconcile` results were applied locally but suppressed from the document
(`#ignoreUpdates`), silently breaking the "graph equals document" invariant — healed
peers could hold a state no late joiner could reproduce. Now a `#publishFrom` watermark
suppresses only the mirrored batch and publishes the repair updates; `#deleteBox`
tolerates a box already deleted (two peers publishing the same repair); a snapshot
join seeds the watermark the same way.

## Cloud backup: folder structure + deletion tombstones

New `StructureFile` (core export) — a zod-validated `structure.json` per resource
folder (folder tree + local trash), with `Storage.updateMeta` generalized alongside.
`CloudBackupStructure` syncs the folder TREE across devices (local placement wins,
union merge) while the TRASH stays per-device; `CloudBackupTombstones` converges
permanent deletions as a grow-only union so an offline device cannot resurrect them —
remote deletions land in the local trash, never straight in the bin. Backs the new
studio sample/soundfont browser folders. Headless-irrelevant unless we adopt cloud
backup.

## Misc

- **`AssetService.replaceMissingFiles` degrades gracefully** (live error 1096): a
  rejected catalog fetch now warns + notifies and skips the scan instead of failing
  the whole project-load path; the index fetches retry the transport. Upstream test
  added (`AssetServiceCatalogUnreachable.test.ts`).
- `Files.save` (lib-dom) rejects on a user-cancelled save picker (`AbortError`)
  instead of falling through to the blob-download fallback (#340).
- `StudioSettings` (studio prefs, not engine prefs): pointer setting
  `normalize-mouse-wheel` (boolean) replaced by `wheel-zoom-speed` (number, default
  100, `.catch(100)`) — per-device wheel-zoom calibration.
- `PresetStorage`'s inline rack-binary inspection moved to a new `PresetInspector`
  (core export); Soundfont's `InstrumentFactory` attachment type changed from
  `{uuid, name}` to `SoundfontFileBox` (referred at create when provided).
- `Vaporisateur` gets its own `IconSymbol.Vaporisateur` default icon (was `Piano`).
- Engine (Rust): strip solo automation rebound through a shared
  `observe_field_automation` helper (same resolve path as gain/pan/mute); test-only
  `pull_lock` serialization replaced by a `shared_static!` thread-local macro.
- `boxGraph.stageBox` documents the nested-construction assert: create boxes in
  sequence and wire pointers after (pointers into an unstaged outer box would refer
  to a vertex the graph doesn't have).
- DawProject: accepts old `.odp` files (project-open compatibility).
- Studio-app-only: sample/soundfont browser folders + trash UI, dashboard sections,
  Cubed device editor (step grid, randomize dialog, pattern shift/copy/paste),
  region-strip bound dragging (#298) with auto-scroll, drag-after-create snap fix
  (#309), unit-lane menu fixes, per-device wheel zoom (#73), track icon updates.

## opendaw-headless follow-ups shipped with this upgrade

- No code changes required: `npx tsc --noEmit` (TS 5.9) error set is byte-identical to
  the main baseline (70 pre-existing `^src/` errors, 0 new / 0 resolved), `npm run
  build` passes, all 63 vitest tests pass, `npm ci` verifies the regenerated lockfile.
- Every API claim above verified against the installed tarballs
  (`node_modules/@opendaw/*/dist`): the sdk chop re-exports,
  `PlayfieldDeviceBoxAdapter.chop`, `InstrumentFactories.Cubed` +
  `CubedDeviceBoxAdapter` pattern ops, `AutomationSeed` +
  `InterpolationFieldAdapter.map/Plain`, `label.setValue(name ?? "")` in the four
  ProjectApi creators, `migrateDefaultLabels`, `catchupAndSubscribeName` +
  `targetControlName`, `Strings.capitalize`, `StringMapping.oneBasedIndex`,
  `ScriptDeclaration.parsePassThrough`, `StructureFile`, and the shipped
  `device_cubed.wasm`.
- Audible-change note: the Neon demo plays quieter (velocity 0.8 now maps to gain
  instead of being ignored). No measurement baselines in `debug/` reference Neon
  loudness.
