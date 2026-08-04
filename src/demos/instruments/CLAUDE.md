# Instruments Demos — OpenDAW SDK Reference

### Neon (CZ-101 phase distortion)
- Create: `project.api.createInstrument(InstrumentFactories.Neon)`; arm its CaptureMidi
  (resolved AFTER the creation transaction) or keys are silent.
- Box fields: `lineSelect`, `modulation`, `octave`, `detune` (±4800 ct), `tune` (±1200 ct),
  `glideTime`, `voicingMode`, `vibrato.{wave,delay,rate,depth}`,
  `lines.fields()[i].{wave1,wave2,dcwKeyFollow,dcaKeyFollow}`,
  `envelopes.fields()[0..5]` (order: line1 pitch/DCW/DCA, line2 pitch/DCW/DCA —
  or use `Neon.envelopeIndex(line, kind)`).
- `NeonEnvelope` getters: `rate1..rate8` / `level1..level8` (Float32Field),
  `sustain` / `end` (Int32Field). `sustain` 0 = none, 1-8 = stage; `end` 1-8.
- **`detune` applies to the PRIMED line only** (the `'` in Line Select "1+1'" / "1+2'").
  In modes "1" and "2" it is inaudible by design — matches CZ hardware architecture.
  Verified by spectrum: line "1" solo low-band ratio 0.012 vs "1+1'" detuned −4800ct
  ratio 0.417. Don't debug a "detune does nothing" report without checking Line Select.
- `octave` and `tune` are global pitch (octave ±1 audibly doubles/halves frequency).
- UI labels come from the SDK: `Neon.Waves` / `Neon.LineSelect` / `Neon.Modulation` /
  `Neon.VibratoWaves` — don't hand-write wave names.
- `CzSysex` is a LOSSY quantizing codec (panel 0-99 ↔ hardware bytes):
  `decode(encode(tone))` is a projection, not identity — it IS a fixpoint (second
  round-trip is exact). Test round-trips as fixpoint + ±1 closeness, never deep-equal
  on authored values.
- `NeonPreset.apply(box, tone)` must run inside `editing.modify()`. It writes
  **fractional** cent values to `detune` (sysex fine steps don't land on integers) —
  round before splitting into a `st + ct` readout or the UI shows float dust.
- `CzSysex.decode` reads the tone at the END of the buffer; `isToneDump` checks
  F0 44 … F7 framing + minimum length.

### Parameter panel ↔ box graph binding
- One `useNeonField(project, field, onExternalChange?)` hook per control:
  `catchupAndSubscribe` for reads, `editing.modify(() => field.setValue(v))` for writes.
  Preset applies flow back through the same subscriptions and snap every control.
- "Custom" patch-label detection: the subscription callback fires for BOTH user writes
  and preset applies — gate with a `suppressCustomRef` (set around `NeonPreset.apply`)
  plus a `mountedRef` so the initial catch-up doesn't mark the patch Custom.

### Envelope visualizer
- This repo's `CanvasPainter` DEBOUNCES (repaints only after `requestUpdate()`), it does
  NOT repaint every frame. Drive invalidation with
  `project.editing.subscribe(() => painter.requestUpdate())` — one subscription catches
  preset applies and every parameter write — plus an effect on selector state.
  (Never call `editing.modify` inside that callback.)

### Browser-testing gotchas (this page)
- Radix `SegmentedControl.Item` renders its label TWICE (hidden duplicate reserves bold
  width) — `textContent.trim() === "2"` finds nothing; match with `.includes()` or click
  by coordinates.
- Radix Slider/Switch thumbs legitimately report `scrollWidth > clientWidth` (~24>12) in
  mobile overflow scans — filter them out; they're by-design overhang, not clipping.
