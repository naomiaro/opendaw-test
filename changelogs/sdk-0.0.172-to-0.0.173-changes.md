# OpenDAW SDK Changelog: 0.0.172 → 0.0.173

One publish (0.0.173 on 2026-09-30; 112 commits tag-to-tag). What matters for this repo:

1. **Stale metronome click fixed (#419, filed from this repo)** — `Engine::pause` / `stop` /
   `stop_recording` now clear the metronome's click list, so a click cut by a stop no longer
   resumes at the next play.
2. **`createNoteRegion` writes `loopOffset` (#420, filed from this repo)** — the parameter was
   assigned to `loopDuration` and then overwritten; it now reaches `box.loopOffset`.
3. **The timeline loop is OFF by default** — `TimelineBox.loopArea.enabled` schema default
   flipped `true → false` (upstream `af938c9c0` "default loop disabled"). A fresh project no
   longer wraps at bar 4. Three sites in this repo relied on the old default and two demos
   gained a Loop switch; see the follow-ups at the end.
4. **One overlap rule** — a new `RegionOverlap` namespace in `studio-adapters` backs every
   overlap check. A Seconds-timeBase region never overlaps its successor (it ends where the
   next region starts), and load-time validation TRIMS a musical overlap to the gap instead
   of deleting both regions.
5. **Seconds-based audio spans follow tempo changes in the engine** — a bpm or
   tempo-automation edit re-sizes the PPQN span of every Seconds-timeBase region and clip.

Plus three new devices — **Tubular** (six-operator FM synth, DX7 compatible), the
**instrument Composite** (layered instruments, each layer with its own strip and chains) and
**Sink** (an audio effect that routes the signal at its chain position into a bus, #350) —
and a set of engine fixes: automated parameters follow a locate made while paused (#393),
Werkstatt forwards a transport reset to its script (#394), the Crusher's mix is linear
(#400), aux-send routing honours pre/post (#402), per-transaction reconcile storms that
starved the render thread are gone (#415), the arpeggiator runs on a stopped transport.

Sub-package versions (installed): `studio-adapters` 0.3.5 (was 0.3.4), `studio-core` 0.2.7
(was 0.2.6), `studio-core-wasm` 0.0.18 (was 0.0.17), `studio-boxes` 0.0.111 (was 0.0.110),
`studio-enums` 0.1.4 (was 0.1.3), `lib-box` 0.0.95, `lib-std` 0.0.86, `lib-dom` 0.0.91,
`lib-dsp` 0.0.94, `lib-fusion` 0.0.104, `lib-jsx` 0.0.93, `lib-midi` 0.0.75, `lib-runtime`
0.0.87, `lib-xml` 0.0.72, `lib-dawproject` 0.0.79; `nam-wasm` 1.2.0 unchanged. Licences
unchanged (AGPL-3.0-or-later; `nam-wasm` MIT). WASM: **33 binaries (was 32), 10 changed and
1 new** — `engine.wasm`, `device_arpeggio.wasm`, `device_autotune.wasm`,
`device_convolver.wasm`, `device_crusher.wasm`, `device_neon.wasm`, `device_tidal.wasm`,
`device_werkstatt.wasm` (all with source changes below), `device_compressor.wasm` and
`device_fold.wasm` (byte-different with no change in their own crates), and the new
`device_tubular.wasm`; the other 20 device plugins, `stretch_wasm.wasm` and `nam.wasm` are
byte-identical. `OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.173"`.

## Metronome: clicks in flight are cleared at a stop (#419)

`Metronome::clear()` (new, `crates/engine/src/metronome.rs`) empties `self.clicks`;
`Engine::pause`, `Engine::stop` and `Engine::stop_recording` call it. Upstream tests pin both
sides: without the clear a click cut by a pause is still in flight at the restart and sums
under the new downbeat (sample 0 at 2.0), with it only the restart's click sounds.

Measured here on `metronome-stale-click-debug-demo.html` (44.1 kHz, 120 BPM): control head
ratio 0.14; stale step, stop landing 3.9 ms / 9.7 ms / 3.9 ms into the beat-2 click over
three runs: restart head ratio **0.14, verdict FIXED 3 of 3** (0.0.172: 0.47–0.80, BUG
PRESENT 3 of 3). The page stays as the regression test.

## `ProjectApi.createNoteRegion` writes `loopOffset` (#420)

`box.loopOffset.setValue(loopOffset ?? 0)` followed by
`box.loopDuration.setValue(loopDuration ?? duration)` (installed
`studio-core/dist/project/ProjectApi.js`). Every caller in this repo passes `loopOffset: 0`
or omits it, so no demo changes behaviour; the "set it on the box yourself" warnings in the
engine and MIDI notes are removed.

## Timeline: the loop area is disabled by default

`TimelineBox.loopArea` (`LoopArea`): `enabled` default `false` (was `true`); `from` 0 and `to`
15360 PPQN unchanged. A project that never touches the loop area now plays linearly past bar
4 instead of wrapping, and `allowTakes` loop recording needs the loop switched on explicitly
(it always did in this repo's loop-recording demos). Stored projects carry their own value.
Studio side: "loop selection" enables the loop if it is off (#392), a loop-region shortcut
(#416).

## Regions: one overlap rule (`RegionOverlap`)

Upstream `2c2506987`: "Six places decided what an overlap is, five of them read a seconds
duration as ppqn." New `RegionOverlap` namespace (`studio-adapters`, `timeline/RegionOverlap`):

- `boundaryTolerance(value)` — float32 tolerance at a boundary (moved out of
  `RegionClipResolver`).
- `endsAtSuccessor(box)` — true for an `AudioRegionBox` whose timeBase is not Musical: its
  end moves with the tempo, so it "ends where the next region starts, never an error".
- `sortedRegions(trackBox)`, `find(sorted) → Option<int>` (index of the first region that its
  predecessor overlaps beyond tolerance, skipping predecessors that end at their successor),
  `hasSpace(boxAdapters, trackBox, position, complete)` (reads live from the pointer hub and
  resolves a seconds region's end through its adapter).

It backs `RegionClipResolver.validateTrack`, `ProjectValidation.validate`, `Project.invalid()`,
`Validator.hasOverlappingRegions`, `ProjectApi.compactTracks` and the push / keep-existing
resolvers. What changed in behaviour:

- **Load-time validation (`ProjectValidation`, run by `Project.load` and therefore by
  `project.copy()`)**: a musical overlap with a positive gap between the two positions is
  TRIMMED — `left.duration = right.position − left.position` — and only two regions at the
  same position are still deleted. A Seconds region followed by a close successor is no
  longer deleted (0.0.172 compared its seconds duration against PPQN positions). The dialog
  still reads "Some data is corrupt", counting trims and deletions together.
- **`Project.invalid()` / `Validator.hasOverlappingRegions`**: a Seconds region no longer
  switches the check off for the rest of its track (the old loop returned `false` on the
  first Seconds region it met); it is skipped as a predecessor only.
- `compactTracks` and the push / keep-existing resolvers no longer place a region on top of a
  Seconds region.
- `DawProjectExporter` writes a Seconds region's `duration` / `loopEnd` in beats at the
  project bpm.
- `AudioContentModifier` (switching a Seconds region to a stretched play mode) always clamps
  the new musical duration to the gap before the next region (`clampToGap`; upstream "live
  1140" — an unclamped switch minted a musical overlap that panicked on a later edit).
- The engine already cut a Seconds region at its successor (pinned upstream in
  `crates/value/tests/region.rs`).

Overlapping regions on one track remain invalid by design; what changed is how the SDK
repairs a musical overlap on load (trim, not delete) and that Seconds regions are judged in
the right unit everywhere.

## Engine (WASM)

- **Seconds-based spans re-sized on a tempo change** (upstream `7f02eeb8a`): after every
  transaction the engine compares a `TempoStamp {bpm, tempo-automation enabled, automation
  collection version}`; when it moved, the tempo map is refreshed and every Seconds-timeBase
  region and clip is re-read (`reread_seconds_based`), regions re-sorted. Before, their PPQN
  spans were converted at bind and only re-read on a region field edit. `ValueCollection`
  gained the `version()` counter behind the stamp.
- **#393 — parameters follow a locate while paused**: a `setPosition` on a stopped transport
  sets a one-quantum `paused_locate` flag; that quantum the update clock opens once at the
  block start, so automated device parameters take the value at the new position without
  playing.
- **#415 — audio dropouts while interacting with the UI**: a composite re-bound a surviving
  child's strip automation on every reconcile, and a modulator's bind re-queued itself
  through its own subscription catch-ups, so every transaction (a selection, a knob at its
  limit) reconciled every unit (~10 ms). An idle reconcile now leaves units un-enqueued and
  `ModulatorTable::discard_rebinds` drops the rebinds a bind pass recorded for itself. The
  follow-up gives each Convolver instance its FFT stagger from an instance ordinal
  (`Convolver::stagger_for_ordinal`, 11 mod 64) instead of the state address, which put
  instances built in one transaction on the same heavy quantum.
- **#402 — aux-send routing**: the engine honours the send's pre / post routing
  (`AuxSendBoxAdapter.routingField` exposes the field).
- **Arpeggio on a stopped transport**: the Rust port emitted nothing while not transporting;
  it now arpeggiates the held live notes, as the TS processor did.
- **A unit-level MIDI effect in front of a Playfield or a composite**: every cell / slot
  folds its own replica of a stateful MIDI effect (two layers behind one arp sounded
  continuously before), and `pull_from_slot_route` carries the note duration (an arp in front
  of a Playfield was silent).
- **CPU**: Autotune skips the YIN pass on frames below the RMS floor; PSOLA caches its Hann
  window per period; Tidal returns unity at depth 0; Neon computes the DCA key-follow rate
  once per chunk instead of per sample.
- `Engine::refresh_joiner_params` removed (internal).

## Tubular — six-operator FM instrument (boxes, adapters, `device_tubular.wasm`)

A Rust port of Dexed's msfa engine with Dexed's host layer and output stage; reads and writes
DX7 voices.

- **`TubularDeviceBox`** (`InstrumentFactories.Tubular`, icon `IconSymbol.Tubular`, notes
  track): `10 cutoff`, `11 resonance`, `12 volume` (unipolar), `13 voicing-mode`
  (mono / poly), `14 tune` (±100 ct), `15 algorithm` (0..31, shown 1..32), `16 feedback`
  (0..7), `17 osc-key-sync`, `20 lfo` (`TubularLfo`: speed, delay, pm-depth, am-depth, sync,
  wave), `21 pitch-mod-sens`, `22 transpose` (0..48, 24 = no shift), `30 pitch-envelope`
  (`TubularPitchEnvelope`: four rates, four levels), `40 operators` (array of six
  `TubularOperator`, panel order OP1..OP6, 22 fields each: four rates, four levels,
  break-point, left/right depth and curve, rate-scaling, amp-mod-sens, velocity-sens,
  output-level, mode, coarse, fine, detune, enabled). Apart from the Float32 `cutoff`,
  `resonance`, `volume` and `tune`, values are the DX7 panel bytes (Int32); all carry
  `ParameterPointerRules` (automatable, MIDI-controllable, modulatable). Plain
  fields: `50 voice-load` (bumped by every voice load — the device cuts all notes and
  restarts the LFO) and `51 engine` (0 = Mark I hardware-like tables, 1 = Modern msfa,
  default 1).
- **`TubularDeviceBoxAdapter`**: `namedParameter` mirrors the box (`operators` is an array
  of six parameter sets, `lfo` and `pitchEnvelope` nested), `spectrum` address
  (`address.append(0xFFF)`). Namespace `Tubular`: label tables (`Algorithms`, `Curves`,
  `Modes`, `Detunes`, `LfoWaves`, `Switch`, `Engines`, `Transposes`) and
  `roles(algorithm) → OperatorRole[]` (carrier / modulation targets / feedback per panel
  operator).
- **`Dx7Sysex`** (`decode(bytes) → Dx7Voice[]` of `{name, data}` from a 32-voice bank or a
  single-voice dump, `encodeBank(voices)`, `encodeVoice(patch)`, `pack` / `unpack` between the
  128-byte packed and the 155-byte voice, `voiceName`, `withName`, `checksum`; `PATCH_SIZE`
  155, `BANK_SIZE` 4104) and **`TubularPreset.apply(box, voice)` / `.read(box)`** — call
  `apply` inside `editing.modify` so a voice load is one undo step; it writes the label and
  bumps `voiceLoad`.
- The factory's init voice has OP1 as the only sounding carrier (`outputLevel` 99).
- The studio's cartridge library (`/tubular/cartridges/*.syx`, `index.json`) is app-side and
  not in the SDK packages.

## Instrument Composite — layered instruments

`CompositeDeviceBox` / `CompositeCellBox` are RENAMED `InstrumentCompositeBox` /
`InstrumentCompositeCellBox` (pointer type `Pointers.CompositeCell` →
`Pointers.InstrumentCompositeCell`; no studio code created the old boxes, so no stored
project holds the old class names) and the device is now complete end to end.

- **`InstrumentCompositeCellBox`** gained `7 minimized` and a strip: `40 gain` (dB), `41 mute`,
  `42 solo`, `43 pan` (bipolar) — the four strip fields automatable; the `instrument` field is no longer
  mandatory; the box accepts the `Editing` pointer (a layer can be entered in the device
  panel). Engine: mute / solo silence at the strip, the layer keeps running.
- **Adapters**: `InstrumentCompositeBoxAdapter` (`cells` collection),
  `InstrumentCompositeCellBoxAdapter` (a `DeviceHost` with both chains, `namedParameter`
  gain / pan / mute / solo, label = the layer instrument's label or `Layer N`).
  `InstrumentFactories.InstrumentComposite` ("Composite"), `isLayerInstrument(factory)` (any
  Notes instrument except MIDI Output) and `keyOfBox(box)`; `Named` gained
  `InstrumentComposite` and `Tubular`.
- **`DeviceHost.asCompositeCell(): Option<CompositeCell>`** — new REQUIRED member of the
  `DeviceHost` interface (audio units and Playfield slots return `None`). `CompositeCell`
  (shared by audio-effect entries and instrument layers): `cellKind`, `namedParameter`,
  `indexField`, `compositeDevice()`, `siblings()`, `subscribeSiblings()`.
- **`ProjectApi`**: `createCompositeLayer(composite, factory, attachment?, atIndex?)`,
  `setLayerInstrument(cellBox, factory)`, `moveCompositeLayer`, `duplicateCompositeLayer`,
  `deleteCompositeLayer`, `wrapInstrumentIntoComposite(instrumentBox)` (re-hosts by pointer,
  automation lanes keep their targets), `pasteAudioUnitAsLayer(composite, data, notes?)`
  (namespace `AudioUnitAsLayer`, `Notes = "keep" | "replace" | "append"`). The create / wrap /
  paste methods return `Attempt<CompositeLayerProduct<INST>, string>` with
  `CompositeLayerProduct<INST> = {cellBox, instrumentBox}`; `setLayerInstrument` returns
  `Attempt<InstrumentBox, string>`, `duplicateCompositeLayer` the new cell box, the other two
  `void`.
- `NestedHostExit` (owned by every `Project`): when the entered layer / entry / Playfield
  slot is deleted, the device panel exits to the nearest surviving parent instead of
  crashing.
- Engine: layers read launched clips through a shared, non-advancing read
  (`ClipRead::Shared`, the clip machine advances once per block).

## Sink — route a chain position into a bus (#350)

- **`AudioSinkDeviceBox`** (`EffectFactories.Sink`, in `AudioNamed`): `10 pass` (dB,
  default −∞ — the level the signal continues down the chain at; 0 dB = a full copy),
  `11 target-bus` (`Pointers.AudioOutput`, optional). The bus receives the full signal at
  that chain position regardless of `pass`.
- `AudioSinkDeviceBoxAdapter` (`namedParameter.pass`, `targetBus: AudioUnitOutput`).
- `AudioUnitFreeze.hasSink()` — a unit containing a Sink refuses to freeze; `Mixer` resolves
  a Sink to its unit's channel strip for solo logic (its constructor now takes `boxAdapters`).

## Effects and scriptable devices

- **Crusher mix (#400)**: schema constraint `unipolar` (was exponential 0.001..1), adapter
  mapping `ValueMapping.unipolar()`, engine `Linear::unipolar()`. The raw field value was and
  is the wet amount; what changed is the unit ↔ value mapping (knob travel, automation,
  modulation) and that 0 (fully dry) is reachable.
- **Werkstatt reset (#394)**: `device_werkstatt.wasm` exports `reset`, forwarded to the
  script bridge. A script with its own `reset()` gets it called; an audio effect script
  without one has its `Processor` rebuilt on the next pull (params and samples replayed), so
  feedback delays stop sounding on transport stop. Spielwerk: the script's `reset()` is
  called again on a discontinuous block.
- **Script bridge keyed per instance (#395)**: `uuid:statePtr` instead of the uuid, so a
  composite's replicas of one unit-level scripted device each own their Processor.
- **`EffectFactory.boxName: keyof BoxIO.TypeMap`** — new REQUIRED member; `EffectFactories.
  keyOfBox` looks the box name up instead of deriving `<Key>DeviceBox` (the Sink is keyed
  `Sink` but creates `AudioSinkDeviceBox`).
- **Composite entry labels**: `AudioEffectCompositeCellBox.label` (field 4) is `deprecated`;
  an entry is named by its composite — `AudioCompositeAdapter.entryLabelAt(index)` ("Entry
  N", "L" / "R", `FrequencySplitBoxAdapter.BAND_LABELS`). REMOVED: `EffectFactories.
  STEREO_ENTRY_LABELS`, `EffectFactories.FREQUENCY_SPLIT_ENTRY_LABELS`,
  `AudioEffectCompositeCellBoxAdapter.labelField`.
- **Cubed**: a fresh step's note is 36 (C1), was 60 (`CubedStep.DefaultNote`, schema default
  of `pattern.steps`). Stored patterns keep their notes.

## Presets, transfer, clipboard

- `PresetDecoder.decode(bytes, target, insertIndex?)` — places an all-instrument preset at a
  slot among the units; `PresetDecoder.replaceLayerInstrument(bytes, cellBox)` and
  `PresetEncoder.encodeLayerInstrument(instrument)` (a layer's instrument saved as an
  ordinary instrument preset).
- `TransferUtils.deviceDependencies(root, exclude?)`, `mapUuids(boxes)`,
  `cloneBoxes(sources, uuidMap, targetGraph)`.
- `ProjectApi.copyEffects(targetField, boxes, insertIndex)`, `placeAudioUnit(box, slot)`,
  `placeAudioUnitBefore(box, anchor)`, `audioUnitIndex(uuid)`.
- `BoxGraphCopy.readGraph(data)`; `ClipboardManager.peek()` / `.write(entry)`;
  `AudioUnitsClipboard.copyEntry(adapter)` (and the `ClipboardAudioUnits` type exported);
  `DevicesClipboard.isOwnedByInstrument(box)` — pasting an instrument that is not placed
  drops what it owns (upstream "live 1139"); a nested (layer) instrument travels without the
  unit's timeline (#390).

## Project, services, lib

- **`Project.copy()` / `copyWithNewIdentities()` keep the whole env** (upstream "fixes
  1142", live error 1141): the env was merged with an object spread, which drops members that are
  prototype getters, so copies lost `sampleService` / `soundfontService`. Members are now
  read one by one (`#mergeEnv`). This repo's env is a plain object; unaffected.
- `AssetService.importFiles(files)`, abstract `acceptsFile(file)`, static
  `extensionOf(file)`; `SampleService.AudioExtensions` (#361, drag-and-drop import).
- `StructureFile.save` reports a failed OPFS write in a dialog instead of rejecting.
- `StudioSettings`: `visibility.auto-open-clips` REMOVED; new `timeline` group (`markers`,
  `tempo`, `signature`, `clips`, `follow-cursor`, #412) and `appearance` group
  (`neutral-hue`, `neutral-saturation`).
- `studio-enums`: `Colors` neutrals are getters over a mutable scheme
  (`setColorScheme({hue, saturation})`, `DefaultColorScheme`, type `ColorScheme`); lightness
  values changed (`bright` 100, `gray` 91, `dark` 84, `shadow` 60, `black` 30,
  `panelBackgroundBright` 16); new `menuActive`, `headerBackground`, `footerBackground`.
  `IconSymbol` gained `FolderTrash` (INSERTED after `FolderAdd` — every later ordinal shifts
  by one), `Tubular`, `Algorithm`.
- `RootBox.editingChannel` (field 111) is `deprecated`.
- `DeviceManualUrls`: `Sink`, `InstrumentComposite`, `Tubular`.
- lib-dom: `Files.open` rejects with `AbortError` while a picker is already open;
  `Events.subscribeSingleClick` (ignores the second click of a double click).
- lib-std: `isProvider(value)`; function checks use `typeof` instead of `instanceof
  Function` (also lib-jsx `onInit` / `onConnect`).
- `NotesRenderer` leaves a 1 px gap at a note's end.

## Upstream tests

`crates/engine/src/audio_unit/tests.rs` +1273 lines (sink routing, composite strips, paused
locate, idle reconcile, tempo re-read), `crates/engine-env/tests/audio_sink.rs`,
`note_sequencer_shared_clips.rs`, the Tubular parity suite (1232 fixture cases against
Dexed), `core-wasm/test/` (`audio-sink`, `script-transport-reset`,
`instrument-composite-*`, `playfield-unit-arp`), `RegionOverlapSites.test.ts`,
`ProjectCopyEnv.test.ts`, `EffectFactories.test.ts`, `PresetEncoder.sink.test.ts`,
`AudioContentModifier.warp.test.ts`.

## Studio-app only (no SDK surface)

The Tubular editor (tabs, algorithm display, cartridge audition), the Composite editor
(layer panel, drag and drop, wrap on drop, copy / paste as layer), the Sink editor and bus
selector, TONE3000 OAuth PKCE flow (PR #401), the scripting API for composites and Tubular
(`studio-scripting`, not installed here), a spectrum card, neutral colour scheme settings,
timeline visibility toggles (#412), region edge contrast (#421), new device drag UX (#403),
selectable curve envelopes (#405), alt+scroll on devices and mixer (#410), time-signature
grid fixes (#391, #417), jump to marker on click, sample browser enhancements (#361), manual
pages (Sink, Composite, Tubular), `StudioService.restartEngine` removed, error-triage flips
(1139…1154).

## opendaw-headless follow-ups shipped with this upgrade

- **No code change forced by the compiler**: `npm run typecheck` exits 0 before and after the
  bump. Nothing in `src/` implements `DeviceHost` or `EffectFactory`, constructs a `Mixer`, or
  reads `EffectFactories.STEREO_ENTRY_LABELS`, `Pointers.CompositeCell`,
  `CompositeDeviceBox`, `rootBox.editingChannel`, a composite cell's `labelField`, or a
  numeric `IconSymbol` ordinal.
- **Loop default** — sites that relied on `loopArea.enabled` being `true` on a fresh project
  now say so, and no demo that loops stopped looping:
  - `setLoopEndFromTracks` (`src/lib/projectSetup.ts`, called by `loadTracksFromFiles` and
    `loadTracksWithGroups`) wrote only `loopArea.to`; it now also writes `enabled = true`.
    Effects, mixer-groups and track-editing demos keep looping over the full song (checked on
    the live projects: `enabled: true, to: 474241` / `471943`). No caller disables the loop
    before the helper; those that want it off set it after loading.
  - `convolverContent.ts` ("Loop the timeline over the drum loop") wrote only `to`; now `from`,
    `to`, `enabled = true`.
  - `time-pitch-demo.tsx` set no loop at all and so cycled over the default four bars; it now
    sets that loop explicitly (position measured wrapping at 15360 PPQN, as before).
  - `liveAutomationContent.ts` and `src/demos/automation/CLAUDE.md`: the comment and the note
    said the default is `true`; rewritten.
  - **A Loop switch on the two demos that set no loop** (they used to wrap at bar 4 without
    saying so), each with a line stating what it changes. MIDI recording: off at load — a
    recording is one take and Play runs through it; on, every pass over the four bars becomes
    its own take with the pass before it muted (measured: 18 s at 120 BPM → takes of 15360,
    15360 and 4800 PPQN, the first two muted). Cubed: on at load — the sequencer's step is the
    position in sixteenths modulo the pattern length, so a wrap restarts the pattern and cuts a
    length that does not divide 64 steps; off, the transport runs on (measured past 29000 PPQN)
    and the pattern cycles on its own length. Both, and the live-automation demo's existing
    switch, go through the new `useTimelineLoop` hook (`src/hooks/`, 6 tests).
  - The audit harnesses set the loop area per scenario and are unaffected (sample-rate sweep
    180 of 180).
- **#419 and #420 closed out**: `metronome-stale-click-debug-demo` is a regression test now
  (copy, heading and title reworded; FIXED 3 of 3); `debug/2026-09-28-metronome-click-survives-pause/note.md`
  and `debug/README.md` marked fixed; the "set `loopOffset` yourself" caveats removed from
  `src/demos/engine/CLAUDE.md` and `src/demos/midi/CLAUDE.md`.
- **Overlap rule**: demo copy and comments that said `project.copy()` DELETES overlapping
  regions, or that Seconds overlaps slip through a mixed-unit check, now describe the trim
  and the Seconds rule (`timebase-demo.tsx`, `track-editing-demo.tsx`,
  `pure-webaudio-target-debug-demo.tsx`, `voice-fadein-clip-fadein-product-debug-demo.tsx`,
  `shared-source-double-process-debug-demo.tsx`, `compLaneUtils.ts`,
  `src/demos/playback/CLAUDE.md`, `documentation/02-timing-and-tempo.md`,
  `documentation/10-export.md`, and dated updates on
  `debug/2026-05-19-project-copy-deletes-overlapping-regions/note.md` and
  `debug/2026-06-11-seconds-overlap-validation-unit-mismatch/note.md`, which this release closes). Measured with
  real boxes on the installed SDK: musical `0+3840` / `1920+3840` → `0+1920` / `1920+3840`;
  two musical regions at one position → both deleted; Seconds regions reaching over their
  successor → untouched and not `invalid`. No demo behaviour changes: the demos prevent
  same-track overlaps at write time.
- **Other stale docs updated**: `documentation/11-effects.md` (Crusher mix range and mapping,
  Werkstatt `reset()`), `documentation/16-midi.md` (arpeggio on a stopped transport),
  `documentation/internals/05-devices-and-effects.md` (paused locate, `InstrumentCompositeBox`),
  `src/demos/effects/CLAUDE.md` (Crusher mix, Sink, script reset), `src/demos/midi/CLAUDE.md`
  (Tubular and Composite adapters), root `CLAUDE.md` (`asCompositeCell`, aux-send routing),
  the aux-send tap point in `documentation/internals/05-devices-and-effects.md` and
  `documentation/14-glossary.md`, and `documentation/internals/01-engine-processor.md` /
  `08-time-and-pitch.md` (solo on a located quantum, `refresh_tempo_map`, the clamp on a
  timeBase switch).
- **Crusher in the effects demo**: the demo writes the raw `mix` field (0..1), which the
  engine reads as the wet amount before and after the change; no audible difference.
- **Recording audit harness, not part of the SDK change**: every repeat now stops an eighth
  note before the next metronome click (`STOP_LEAD_PPQN`), which removes the double click a
  listener heard at each repeat boundary (last click to next start 432 ms or more, was
  187–280 ms). A linear take matches 15 beats instead of 16 and loop-wrap's last take is about
  0.39 s long instead of 0.06 s; verdicts and medians do not move. Each row persists
  `stopLeadMs` (how far ahead of the click the stop request went out; the page warns under
  30 ms), since no verdict would show a missed lead.
- **Standing sweeps on the release** (register section "Standing sweep on 0.0.173, and the
  stop moved ahead of the next click" in `debug/2026-09-02-recording-start-alignment/note.md`):
  sample-rate/quantum-alignment 180 of 180 cells pass; recording start-alignment 48 kHz (three
  runs) and 44.1 kHz (one), 60 rows each, 0 error rows, every repeat finalized, netted medians
  +1.07…+1.17 ms and +0.97…+1.19 ms as on 0.0.172 on all but one row; multi-mic three runs, 96 rows, no collision,
  no hang. Three things to read there: the first recording after a cold start had an 84 ms
  head deficit once and not again; and the open one-quantum event showed twice in 168 repeats
  (once in 416 on 0.0.172), one of them a real 2.67 ms misplacement of one tape — not enough
  repeats to say the rate moved.
- **Verification**: `npm run typecheck` 0 errors, 870 of 870 vitest tests (19 of them new: 13
  on the harness's stop lead, 6 on the loop hook), `npm run build`,
  `npm ci` on the regenerated lockfile.
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`):
  `LoopArea` `enabled` default `false`; `box.loopOffset.setValue(loopOffset ?? 0)` in
  `ProjectApi.js`; `OPENDAW_SDK_VERSION = "0.0.173"`; the box classes `TubularDeviceBox`,
  `TubularOperator`, `TubularLfo`, `TubularPitchEnvelope`, `InstrumentCompositeBox`,
  `InstrumentCompositeCellBox`, `AudioSinkDeviceBox` present and `CompositeDeviceBox` /
  `CompositeCellBox` absent; `TubularDeviceBox.engine` default 1; `RegionOverlap` exported
  and used by `Validator.js`; `trims` in `ProjectValidation.js`; `#mergeEnv` in `Project.js`;
  the eleven new `ProjectApi` methods; `EffectFactories.Sink`, `EffectFactory.boxName`, no
  `*_ENTRY_LABELS`; `InstrumentFactories.Tubular` / `InstrumentComposite` / `keyOfBox` /
  `isLayerInstrument`; `DeviceHost.asCompositeCell`; `Mixer` constructor with `boxAdapters`;
  `AssetService.importFiles` / `acceptsFile` / `extensionOf`, `SampleService.AudioExtensions`;
  `pendingOpen` in lib-dom `files.js`, `Events.subscribeSingleClick`, lib-std `isProvider`;
  `setColorScheme`; `IconSymbol.FolderTrash = 178`, `StereoSplit = 186`, `Tubular = 187`,
  `Algorithm = 188`; `Pointers.InstrumentCompositeCell`; `StudioSettings` `timeline` and
  `appearance` groups, no `auto-open-clips`; `AuxSendBoxAdapter.routingField`;
  `PresetDecoder.decode(…, insertIndex?)` / `replaceLayerInstrument`,
  `PresetEncoder.encodeLayerInstrument`; `TransferUtils.deviceDependencies` / `mapUuids` /
  `cloneBoxes`; `BoxGraphCopy.readGraph`; `ClipboardManager.peek` / `write`;
  `AudioUnitFreeze.hasSink`; `STALE_UPDATE` and the per-instance map in core-wasm
  `script-bridge.js`; `device_tubular.wasm` in `engine-modules.js`; `CubedStep.DefaultNote =
  36`; `ValueMapping.unipolar()` for the Crusher mix; `RootBox.editingChannel` and
  `AudioEffectCompositeCellBox.label` still getters, the cell adapter's `labelField` gone;
  `toBeats` in `DawProjectExporter.js`, `clampToGap` in `AudioContentModifier.js`. The
  `Metronome::clear` call sites live in `engine.wasm` and are verified by the repro page, not
  by reading the binary.
