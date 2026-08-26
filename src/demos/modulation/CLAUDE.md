# Modulation Demos — OpenDAW SDK Reference

## ProjectModulation (`project.api.modulation`)
- `createLfo/createSteps/createMacro/createRandom(label?)`, `assign(modulator, target, depth?)`,
  `replace`, `duplicate(All)`, `delete(All)`, `move`, `adapters()`, `kinds`.
- **None of these open a transaction** (`Modulators.*` states "every caller is inside an
  `editing.modify`") — always wrap calls in `project.editing.modify()`.
- **One transaction per modulator creation.** The attach step reads
  `rootBoxAdapter.modulators.adapters()` for the new modulator's index and unique label;
  boxes created in a still-open transaction are not in that collection yet, so batching
  several `create*` calls into one `modify()` hands every modulator index 0 and duplicate
  labels. Creating + configuring + assigning ONE modulator per transaction is fine
  (`assign`'s index read on the fresh modulator's empty `assignments` hub correctly
  yields 0).
- `api.modulation.create*` return the **`ModulatorBox` union**, not the concrete class —
  narrow with `asInstanceOf(box, LfoModulatorBox)` before touching kind-specific fields.
- `assign(modulator, param.modulationTarget, depth)` — the target comes from
  `AutomatableParameterFieldAdapter.modulationTarget` (`Field<Pointers.Modulation>`);
  `depth` is SIGNED (−1..+1) and stored on the returned `ModulationBox.depth`.
  A parameter accepts several assignments; their contributions **sum**.

## Engine math (what a depth/amount/bipolar combo does)
Modulator kinds generate `raw` in **−1..+1**. Then, per modulator:
`folded = bipolar ? raw : raw * 0.5 + 0.5` (unipolar folds into 0..1, never negative),
`output = folded × amount`. Per assignment the engine adds `depth × output` onto the
parameter's **normalized (unit) value**, clamped to [0,1] together with the base.
Practical recipes measured in this demo:
- LFO sine, bipolar, depth 0.3 on cutoff base 0.45 → controlled value sweeps 0.15–0.75.
- Steps unipolar + **negative** depth on channel volume = rhythmic ducking (channel
  volume's unit value already sits near the top of its dB mapping — positive depth
  would mostly clamp).
- Macro bipolar at its default `value` 0.5 emits raw 0 → **zero offset at rest**; the
  knob shifts the target both ways. Stacked on the LFO's target it audibly re-centers
  the wobble (measured: macro 1.0 + depth 0.45 moved the wobble center 0.45 → ~0.84).

## Reading modulation on the main thread
- `param.getControlledUnitValue()` = storage value + streamed modulation sum (clamped) —
  the engine streams `[automatedValue, modulationSum]` per parameter address once ANY
  external control pointer (Automation/Modulation/MIDI) targets the field. Plot this for
  live scopes; no extra subscription needed beyond an AnimationFrame read.
- **Free-running starts with the first Play.** On a fresh page the scopes are FLAT until
  the transport has run once; after that, modulation keeps moving while paused (engine
  free-runs on `transport.free_running()`) — position frozen, `isPlaying` false, values
  still sweeping (measured span 0.6 while paused). Don't diagnose flat pre-play scopes
  as a bug, and don't claim "moves while paused" before the first Play.

## Adapter constants for UI labels
- `LfoModulatorBoxAdapter.ShapeStrings` / `.RateStrings` / `.RatePPQNs` (index 0 = off;
  4 = 1 bar, 6 = 1/4, 8 = 1/8, 10 = 1/16), `LfoShape` enum.
- `StepsModulatorBoxAdapter.DirectionStrings`, `StepsDirection` enum; step fields via
  `box.steps.fields()` (ArrayField, 64 × Float32Field storing unitValues 0..1 —
  raw emitted is `stored*2−1`); helpers `randomize()`, `clear()`, `rotate()`.
- `ModulatorBoxAdapter` base: `label`, `enabled`, `bipolarField`, `amount`,
  `assignments: ReadonlyArray<ModulationBoxAdapter>` (each has `.target:
  Option<AutomatableParameterFieldAdapter>` — Option, unwrap it).

## Vaporisateur patch notes
- The box schema defaults oscillator volumes to **−∞ dB**; the `InstrumentFactories`
  preset makes it audible, but a deterministic patch should set `oscillators.fields()`
  waveform/volume/tune explicitly (`ClassicWaveform` enum from `@opendaw/lib-dsp`;
  volumes are plain dB Float32 fields).
- Set continuous parameters through
  `VaporisateurDeviceBoxAdapter.namedParameter.*.setUnitValue()` — range-safe against
  each field's ValueMapping (cutoff/resonance/sustain/release etc.).
- Sustained bass notes make cutoff/volume modulation audible; a decaying arpeggio hides it.

## Reference Files
- Content builder: `src/demos/modulation/modulationContent.ts`
- Demo: `src/demos/modulation/modulation-demo.tsx`
