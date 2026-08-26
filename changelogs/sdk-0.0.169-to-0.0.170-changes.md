# OpenDAW SDK Changelog: 0.0.169 → 0.0.170

A big release (111 commits tag-to-tag) with two headline features and one breaking API
removal:

1. **Modulations** — a project-global modulator system (LFO, step sequencer, macro knob,
   random) that adds a bipolar offset on top of any automatable device parameter. New box
   types, new adapters, a new `project.api.modulation` facade, and an engine-side
   modulation resolver. The plugin ABI grew a `modulation` float, so **every device
   plugin rebuilt**.
2. **Convolver** — a new stock audio-effect device: zero-latency non-uniform partitioned
   convolution against an impulse-response sample (new DSP crate, new box/adapter/factory).
3. **The parameter touch API is gone** (breaking): `touchStart`/`touchEnd`/`isTouched`/
   `subscribeTouchEnd` were removed from both `AutomatableParameterFieldAdapter` and
   `ParameterFieldAdapters`. Automation recording is now latch-based, and a new
   `AutomationSuspension` runtime rule (upstream #347) lets a manual write override a
   playing curve.

Sub-package versions (installed): `studio-adapters` 0.3.2 (was 0.3.1), `studio-core`
0.2.4 (was 0.2.3), `studio-core-wasm` 0.0.15 (was 0.0.14), `studio-boxes` 0.0.108 (was
0.0.107 — **real schema changes** this time: six new box classes + a RootBox field),
`studio-enums` 0.1.1 (was 0.1.0 — two new Pointers members, seven new icons, cream color
tweak), `lib-box` 0.0.93, `lib-std` 0.0.84, `lib-fusion` 0.0.102, remaining lib-*
version bumps. WASM: `engine.wasm` and 27 of 28 device plugins rebuilt (ABI change, see
below), `device_convolver.wasm` **added** (29 plugins now); unchanged: `device_zeitgeist.wasm`
(exports no parameters, untouched upstream), `stretch_wasm.wasm`, `nam.wasm`.

## Modulation system

### Boxes (studio-boxes 0.0.108)

Five new box classes plus wiring, all forged from `forge-boxes`:

- **`ModulationBox`** — one assignment edge: `source` (mandatory pointer,
  `Pointers.ModulatorSource` → a modulator's `assignments` field), `target` (mandatory
  pointer, `Pointers.Modulation` → the parameter field), `depth` (Float32 bipolar −1..+1,
  itself automatable/MIDI-controllable via `ParameterPointerRules`), `enabled`, `index`.
  Both pointers mandatory ⇒ deleting either end cascades the assignment away.
- **`LfoModulatorBox`** — `shape` (0–4: sine/triangle/saw-up/saw-down/square), `rateSync`
  (0–12 index into a PPQN table, 0 = off/free, default one bar), `rateAbsolute` (0–10 Hz
  free-running), `phase`, `exponent` (bipolar curve shaper).
- **`StepsModulatorBox`** — `count` (1–64), `steps` (fixed Float32 array[64]), `direction`
  (0–4: forward/backward/ping-pong/alternate/random), `rateSync`/`rateAbsolute`/`phase`/
  `smooth`.
- **`RandomModulatorBox`** — `seed`, `loop` (0 = never repeats), `levels` (0 = continuous,
  else quantized), `smooth`, `rateSync`/`rateAbsolute`/`phase`.
- **`MacroModulatorBox`** — a single `value` knob (manual macro source).
- Modulator boxes share `ModulatorFactory.createModulator` common fields: `collection`
  (mandatory → RootBox), `assignments` (field accepting `Pointers.ModulatorSource`),
  `label`, `enabled`, `index`, `tracks` (field accepting `Pointers.TrackCollection` — a
  modulator owns its own automation lanes), `bipolar`, `amount` (0..1). Tagged
  `{type: "modulator"}`.
- **`RootBox` field 11 `modulators`** — the project-global modulator collection.
- **`Pointers`** appends `ModulatorCollection` and `ModulatorSource` (append-only — the
  enum values are ordinals baked into stored documents).
- New `ModulatorParameterPointerRules` (`Defaults.ts`): a modulator's **own** parameters
  accept MIDI + automation but NOT `Pointers.Modulation` — modulating a modulator needs a
  cycle check that doesn't exist yet, so the pointer type is deliberately withheld.

### Adapters (studio-adapters 0.3.2)

New `modulation/` module:

- **`ModulatorBoxAdapter`** (abstract base) — `label`/`labelField`, `enabled`,
  `indexField`, `bipolarField`, `amount` (parameter adapter),
  `assignments: ReadonlyArray<ModulationBoxAdapter>`, `tracks: FieldParameterTracks`.
  Union type `ModulatorBox = Lfo|Steps|Macro|Random…Box`, guards `isModulatorBox` /
  `isModulatorBoxAdapter`. Per-kind subclasses (`LfoModulatorBoxAdapter` carries the
  `RatePPQNs` table the schema comments reference).
- **`ModulationBoxAdapter`** — `source` (ModulatorBoxAdapter), `target`
  (`Option<AutomatableParameterFieldAdapter>`), `targetAudioUnit`, `targetOwner` (display
  name), `namedParameter.depth`, `enabled`, `depth`.
- **`Modulators` namespace** — `createLfo/Steps/Macro/Random(context, label?)`, `Kinds`
  (label + boxName + create), `assign(context, modulator, targetField, depth?)`,
  `replace` (swap kind, keeps assignments + depth automation), `duplicate`/`duplicateAll`,
  `deleteAll`, `move`.
- **`rootBoxAdapter.modulators`** —
  `IndexedBoxAdapterCollection<ModulatorBoxAdapter, Pointers.ModulatorCollection>`.
- `BoxAdapters` registers the six new adapters (incl. `ConvolverDeviceBoxAdapter`).

### Core (studio-core 0.2.4)

- **`project.api.modulation: ProjectModulation`** — the app-facing facade:
  `kinds`, `adapters()`, `create(kind)` / `createLfo/Steps/Macro/Random(label?)`,
  `assign(modulator, targetField, depth?)` → `ModulationBox`, `replace`, `duplicate`,
  `duplicateAll`, `delete`, `deleteAll`, `move`.
- **`project.modulatorSelection: FilteredSelection<ModulatorBoxAdapter>`** — alongside
  the existing device/region selections.
- Every parameter field already accepted `Pointers.Modulation` (`ParameterPointerRules`
  pre-dates this release); the adapter now exposes it:
  `adapter.modulationTarget: Field<Pointers.Modulation>` (the assign target) and
  `adapter.modulations: ReadonlyArray<ModulationBox>`.
- Clipboard: new **`ModulatorsClipboardHandler`** (copy/paste modulators), and
  `DevicesClipboardHandler` now keeps a duplicated device's modulation assignments —
  via a new `BoxGraphCopy.pasteBoxes` **`keepUuid?: Predicate<Box>`** option (a box that
  keeps its UUID keeps its identity, so the paste re-links to the existing modulator
  instead of cloning it).

### Engine (WASM) + plugin ABI

- New `crates/engine/src/modulation.rs` (~1000 lines): resolves every modulator per
  block. LFO rate table `RATES[13]` in PPQN (mirrored by `LfoModulatorBoxAdapter.RatePPQNs`),
  free-running Hz mode, steps with 5 traversal directions, seeded random with levels/
  smooth/loop, macro passthrough. While the transport is **paused**, modulation
  free-runs on a dedicated `transport.free_running()` pulse position (curve keeps
  moving, automation holds — the strip-value sources were reworked to resolve
  "automation holds while modulation keeps moving" per paused block).
- **Plugin ABI change** (`crates/abi`): `ParamChange` grew a fourth wire component —
  `(id, kind, value, modulation)` — where `modulation` is the summed offset in
  NORMALIZED space, NaN = none. `ParamValue` gains a `Modulated {base, kind, sum}`
  variant; the shared resolvers (`float_value`, `int_value`, `bool_value`, new
  `unit_value`) fold `clamp_unit(unit + sum)` through the device's own mapping — only
  the device knows its ValueMapping, so the fold lives device-side. Every stock device's
  `parameter_changed` export gained the `modulation: f32` arg ⇒ all plugins rebuilt.
- Parameter live streams to the UI are now **two floats per address**:
  `[0]` the automated unit value, `[1]` the modulation sum (NaN = "does not apply" in
  both). `AutomatableParameterFieldAdapter` switched from
  `liveStreamReceiver.subscribeFloat` to `subscribeFloats`, and
  `getControlledUnitValue()` returns `clamp(base + modulationSum, 0, 1)` — UI knobs
  show the modulated value. (`subscribeFloat` itself still exists in lib-fusion.)

### Modulator automation lanes: ParameterTracks

A modulator's own parameters record automation into lanes the modulator itself owns
(upstream decided the "timeline route"), which restructured the tracks plumbing:

- New **`ParameterTracks`** interface + **`FieldParameterTracks`** implementation
  (`studio-adapters/timeline/ParameterTracks`): `create(type, target, index?)` (now
  returns the created **`TrackBox`** — was `void`), `controls(target)`, `delete(adapter)`,
  `values()`, `collection`, `catchupAndSubscribe`, `subscribeAnyChange`.
- **`AudioUnitTracks` now `extends FieldParameterTracks`** — same public surface as
  before (`.values()`, `.collection`, no `.adapters()` — our existing rules still hold),
  plus `audioUnitBox`.
- `AutomatableParameterFieldAdapter.registerTracks(tracks)` takes any `ParameterTracks`;
  new **`optTracks()`** resolves the lane owner: an explicitly registered owner
  (modulators register themselves) or the parameter's audio unit as fallback — so a
  lane resolves with no editor mounted.
- **`TrackBoxAdapter.optAudioUnit: Option<AudioUnitBox>`** — a track can now hang off a
  modulator, so `.audioUnit` (still present) panics for modulator lanes; SDK internals
  (`Recording`, `Project`, region overlap resolvers) switched to `optAudioUnit` and
  skip modulator lanes in track-overflow resolution.
- `TrackBoxAdapter.targetName` resolution was factored into a new **`ParameterOwner`**
  namespace (`nameOf`/`audioUnitOf`) and learned to name modulation targets.

## Automation: touch model removed, suspension added (breaking; upstream #347)

- **REMOVED** from `ParameterFieldAdapters`: `touchStart(address)`, `touchEnd(address)`,
  `isTouched(address)`, `subscribeTouchEnd(observer)`. **REMOVED** from
  `AutomatableParameterFieldAdapter`: `touchStart()`, `touchEnd()`. Remaining registry
  surface: `get/opt`, `registerTracks`/`getTracks` (now `ParameterTracks`-typed),
  `setMode/getMode`, `subscribeWrites`.
- `RecordAutomation` is now **latch-based**: while `engine.isRecording`, ANY parameter
  write opens (or extends) the automation take — no touch gate — and only the transport
  (stop) or a loop wrap closes it. A knob, a MIDI controller and a checkbox all record
  alike. Track creation goes through `adapter.optTracks()` + `tracks.create()`, so
  recording onto a modulator's parameter lands in the modulator's own lane.
- New **`AutomationSuspension`** (auto-started by every `Project`): a parameter changed
  by hand or MIDI **while playing** takes over from its own automation for as long as
  the transport runs — `engine.suspendAutomation(uuid)` (new on the `Engine` interface,
  `EngineFacade`, `EngineWorklet`, `OfflineEngineRenderer` command port) suspends that
  track's lane in the engine; the engine drops all suspensions on pause/stop/
  stopRecording, so the next play reads the curve again. Runtime-only — nothing is
  written to the box graph. Modulation still applies on top of a suspended lane.
- New adapter helper `notifyPrinting()` (re-notify observers after a mapping change),
  `context` getter, and `setPrintValue` now interprets **bare numeric input in the
  currently displayed unit** ("10" while the label shows "ms" = 10 ms) via new
  `StringMapping.withDisplayUnit(text, unit)` (lib-std).

**This repo:** no code changes needed — nothing in `src/` used the touch API or
`subscribeFloat` (verified by grep). Stale docs updated in this PR:
`documentation/09-editing-fades-and-automation.md` (touch-recording section rewritten as
latch + suspension), root `CLAUDE.md` and `src/demos/automation/CLAUDE.md`
(`parameterFieldAdapters` touch-API references). Behavioral touchpoint: a parameter
write during an active recording now records automation unconditionally (previously
gated on touch) — none of our demos write device parameters mid-recording today.

## Convolver device (new stock audio effect)

- **`ConvolverDeviceBox`**: `file` (optional pointer, `Pointers.AudioFile` — the IR
  sample), `wet` (dB, default **−3 dB**), `dry` (dB, 0), `pre-delay` (0–500 ms,
  pow-by-center: 50 ms at knob center, true 0 at min), `normalize` (default true) and
  `reverse` — the last two are **plain fields, deliberately not automatable** (they
  retransform the IR).
- **`EffectFactories.Convolver`** joins `EffectFactories.AudioEffects` (between
  Compressor and Crusher; icon `IconSymbol.Convolver`, manual page under
  `DeviceManualUrls.Convolver`), `ConvolverDeviceBox` added to the `EffectBox` union,
  `ConvolverDeviceBoxAdapter` added.
- DSP (`crates/dsp/convolution.rs` + `rfft.rs`, `device-convolver` crate): zero-latency
  **non-uniform partitioned convolution** (canonical 3-level layout won the upstream
  bench: ~1% of block budget, flat in IR length), SIMD128, IR cap **16 s**. The IR
  transform is time-distributed (a partition budget per block) with per-instance spike
  staggering, so loading/swapping an IR never spikes the render; IR swaps crossfade
  seamlessly (incl. pre-delay changes). Stereo IRs supported (channel-wise, resampled
  to the engine rate at load). Normalization is peak-band (matches perceived loudness
  across IRs). Removing the sample keeps the device (drop-zone shows an error state
  for a missing sample).

## Device parameter-mapping fixes (Rust)

- **#348 — modulating Tidal's rate crashed the engine**: the rate handler panicked on
  any wire value other than `Unit`/`Float` ("tidal rate expects a unit or float value")
  — a `Modulated` wire hit it as soon as an LFO was assigned. New `rate_index` resolver
  folds base+sum through the rate table; Delay's `sync` index got the same treatment
  (`linearInteger` on a Float32 field, so the shared `int_value` can't serve it).
- **Cubed mappings**: `tuning`, `volume`, `waveform` (and the pattern index) previously
  read the wire value raw — an automation-carried UNIT value was misinterpreted as the
  real value (e.g. unit 0..1 fed into a ±1200-cent tuning formula). Now mapped through
  the real `ValueMapping`s mirroring the adapter (`Linear ±1200`, `Decibel`,
  `LinearInteger`). Also: a transport-driven pattern change (automation/modulation)
  switches immediately, a manual edit still waits for the pattern boundary.
- Vaporisateur/others: refactored onto the shared `abi::unit_value` helper (no
  behavior change beyond `Modulated` support).

## Project MIDI-out subscription

`project.subscribeMIDIOut(observer)` (new) with `MIDIOutMessage = {deviceId, data}`:
what THIS project's engine sent out, before it reaches the globally shared device.
An internal sink must listen here rather than at the device — a second engine (e.g. a
video export rendering its own copy of the project) writes to the same device id, and
its values would otherwise land in the first project's sink.
`receivedMIDIFromEngine` now notifies this notifier (debug logging removed).

## AudioContexts.resume hardening (live error 1108)

New `AudioContexts` class (studio-core): `resume(context)` returns `boolean` instead of
letting `AudioContext.resume()` rejections propagate — on failure it logs the state +
the hardware sample rate (probed via a throwaway `AudioContext`, to tell a device
failure from a refused 48 kHz request) and raises a one-shot `RuntimeNotifier.info`
("Audio Device Unavailable"). `EngineFacade.play()` now routes its suspended-context
resume through it (a failed resume no longer calls `worklet.play()`).
**This repo:** our own resume-before-play guard in `initializeOpenDAW` stays — it
covers the raw-worklet paths the facade doesn't.

## lib fixes

- **lib-box `Serializer` unknown-field fix**: deserializing a box whose schema lacks a
  stored field key previously `continue`d WITHOUT consuming the field's bytes —
  corrupting the read of every subsequent field. Now the bytes are always read, then
  skipped if unknown. This is the forward-compatibility path (an older runtime reading
  a document that carries newer fields), exercised hard by this release's new box
  fields.
- **lib-std `StringMapping`**: new `withDisplayUnit` (see above), and the metric-prefix
  parser no longer reads a decimal point as the prefix character (`"10.0m"` parsed the
  `.` before; now the full numeric literal is skipped and `m` is found).
- **lib-fusion `OpfsWorker`**: "Storage not available" errors now carry the underlying
  reason (`NAME: message`).

## Misc

- `Colors.cream` saturation 20 → 37 (studio-enums).
- `IconSymbol` appends `Modulation`, `Alternate`, `PingPong`, `Forward`, `Backward`,
  `Bipolar`, `Convolver`.
- Studio-app-only: modulation screen UI (editors, target lists, playhead dots),
  device-panel focus kept across chain rebuilds, iPad/touch/text-input fixes,
  Nextcloud/publish error handling, error-triage updates (1097/1098/1105–1108),
  shadertoy MIDI-out isolation, debug-box hidden when the debug menu is off.
- Extensive new upstream tests: modulation engine (`modulation-*.test.ts`,
  `modulator-param-automation`, `param-mapping-parity`, `modulated-tidal-rate`),
  convolution DSP oracle/bench suites, `RecordAutomation.test.ts` (557 lines),
  `ModulationSchema.test.ts`, `ModulatorActions.test.ts`, clipboard handler tests.

## opendaw-headless follow-ups shipped with this upgrade

- **`typescript` added as a devDependency** (`^5.9.2` → installs 5.9.3, matching the
  upstream openDAW monorepo's pin). `npx tsc --noEmit` now runs the local 5.9.3 — the
  globally-installed-TS workaround (`--ignoreDeprecations "6.0"`, TS5101 noise) is
  obsolete; plain `npx tsc --noEmit` is the verification command. (TS 7 removed
  `baseUrl` outright, so don't jump majors without revisiting the tsconfig.)
- No code changes required: `tsc --noEmit` (TS 5.9.3) error set is **byte-identical**
  to the pre-upgrade baseline (70 pre-existing `^src/` errors, 0 new / 0 resolved),
  `npm run build` passes, all 63 vitest tests pass, `npm ci` verifies the regenerated
  lockfile.
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`):
  the six new box classes (`studio-boxes/dist`), `ProjectModulation` +
  `api.modulation` wiring, `subscribeMIDIOut`, `suspendAutomation` (Engine/Facade/
  Worklet), `AudioContexts`, `EffectFactories.Convolver`, `ParameterTracks`/
  `FieldParameterTracks` + `AudioUnitTracks extends`, the removed touch API (absent
  from `ParameterFieldAdapters.d.ts`), `subscribeFloats` usage,
  `StringMapping.withDisplayUnit`, `rootBoxAdapter.modulators`.
- WASM audit: 29 of 32 binaries changed (`engine.wasm` + 27 device plugins rebuilt for
  the ABI change, `device_convolver.wasm` added); `device_zeitgeist.wasm`,
  `stretch_wasm.wasm`, `nam.wasm` byte-identical.
- Stale-doc updates rolled in: `documentation/09-editing-fades-and-automation.md`
  automation-recording section (touch → latch + suspension), root `CLAUDE.md` +
  `src/demos/automation/CLAUDE.md` touch-API references.
