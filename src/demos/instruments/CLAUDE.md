# Instruments Demos — OpenDAW SDK Reference

### Cubed (303-style acid bassline)
- Create: `project.api.createInstrument(InstrumentFactories.Cubed)`. No armed capture
  needed for the demo — the built-in step sequencer follows the transport (plays while
  the project plays); MIDI input is only for live-note layering on the same mono voice.
- Pattern data lives ON the device box: 16 `CubedPattern` array entries (`length` Int32
  1–64 + 64 packed Int32 `steps`). `CubedStep.pack/unpack` converts
  `{note, active, slide, accent}` ↔ packed int. All adapter pattern ops
  (`writeCurrentPattern`, `clearCurrentPattern`, `randomizeCurrentPattern`,
  `rotateCurrentPattern`) and per-step field writes are PLAIN field writes — wrap every
  call in `editing.modify()`.
- `currentPattern()` reads `patternIndex.getValue()` — the TARGET pattern. A manual
  `patternIndex` write switches audio at the next bar line WHILE PLAYING (stopped, it
  applies at once; re-selecting the playing pattern disarms a pending switch — engine
  `pattern.rs` tests), but the grid should render the target immediately (matches the
  studio editor).
- `readCurrentPattern()` slices steps to `length` — JSON export via
  `CubedPatternData.toJSON` only carries `length` steps. For a grid showing all 64,
  read `currentPattern().steps.getField(absIndex)` directly. Steps beyond length
  survive length changes and `rotateCurrentPattern` ONLY — `writeCurrentPattern`
  (presets, JSON/ABL apply) and `randomizeCurrentPattern` reset them to the default
  step, and `clearCurrentPattern` clears all 64. `writeCurrentPattern` also clamps
  `length` to 1–64 and truncates >64-step input silently — report the applied count.
- Playhead: the device streams its current step as
  `liveStreamReceiver.subscribeIntegers(adapter.address.append(0), array => array[0])`.
  Toggle DOM classes directly in the callback (no setState per packet).
- Grid refresh: one `project.editing.subscribe(() => setVersion(v => v + 1))` in the
  parent + synchronous box reads during render covers every write path (step toggles,
  presets, randomize, rotate, JSON/ABL import, pattern switch) — no per-field subs.
- Note-cell drag: commit the FIRST change of a gesture with `editing.modify()` and
  every further change with `editing.append()` — one undo entry per drag instead of
  one per semitone. Clear the drag ref in `onPointerCancel`/`onLostPointerCapture`
  too, not just `onPointerUp` — a stale anchor makes later hovers transpose notes.
- `--mc-faint` is strokes-only (fails AA). Dim beyond-length cells with a darker
  ground (`--mc-bg`) + `--mc-label` text, NOT `opacity` on the live buttons — 0.35
  over `--mc-text` blends to ≈2.6:1.
- Unipolar params (`cutoff`/`resonance`/`envMod`/`decay`/`accent`) are declared
  `AutomatableParameterFieldAdapter<PrimitiveValues>` (not `<number>`) — type UI
  binding helpers with the bare `AutomatableParameterFieldAdapter` (unit-value API is
  type-independent) or TS2322s appear.
- `CubedRandomize.Default.octave` is 1 with base `(octave+2)*12+root` (≈C1); density,
  accent, slide are probabilities 0..1; `Motifs = [0,2,3,4,8]` (0 = off);
  `randomizeCurrentPattern` fills only up to the CURRENT length.
- `CubedPatternData.parseNote` accepts `60`, `C3`, `C#3` (octave convention matches
  `MidiKeys.toFullString`, 60 = C3) — returns `Option<int>`.
- `AblPattern.parse(text)` reads ABL2/ABL3 `.pat` dialects; check
  `parsed.steps.length === 0` for "not a pattern" (it doesn't throw on garbage);
  `AblPattern.BASE_NOTE` = 36 (C1), NOT the Cubed step default 60.
- Verified end-to-end 2026-08-26 (SDK 0.0.170): pattern plays on transport Play
  (master RMS 0.064/peak 0.52 via analyser tap), ABL fixture round-trips
  (pitch/gate/slide/accent/length), JSON export→apply round-trips, LFO on
  `cutoff.modulationTarget` sweeps (scope on `getControlledUnitValue()`).

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
- Line-param activity per mode: "1" reads line 1 only; "2" reads line 2 only; "1+1'"
  reads line 1 only (the primed line is a detuned COPY of line 1 — line 2's params are
  unused); "1+2'" reads both. The demo dims whichever line card is out of the signal path.
- `octave` and `tune` are global pitch (octave ±1 audibly doubles/halves frequency).
- UI labels come from the SDK: `Neon.Waves` / `Neon.LineSelect` / `Neon.Modulation` /
  `Neon.VibratoWaves` — don't hand-write wave names.
- **Envelope rate → time is hardware-table exponential** (measured on the WASM engine):
  rate 99 = instant, 75 ≲ 0.1 s, 50 ≈ 0.4 s, 35 ≈ 2 s. Author DCA attack rates ≥ ~55
  for click-playable patches — a mouse click holds a key ~150 ms, and a rate-35 attack
  reaches <1 % amplitude by release (reads as "keyboard doesn't work"). Decay rates
  ≥ ~70 collapse to an inaudible tick; key follow shortens times further up the keyboard.
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
- Playwright locator clicks AUTO-SCROLL the page — cached piano-key coordinates go stale
  after any `getByText(...).click()`, and a stale-coordinate "tap" can land on a Radix
  Select trigger, leaving its dropdown overlay open: every later click is swallowed and
  the page reads as "engine dead" (taps measure 0 RMS in every mode). Re-fetch
  `boundingBox()` immediately before each mouse gesture; if taps suddenly measure 0,
  screenshot FIRST and look for an open dropdown before debugging audio.
