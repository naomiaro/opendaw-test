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
- The step is the transport position counted in sixteenths, modulo the pattern length
  (`floor(position / SemiQuaver) mod length`), so a timeline loop wrap restarts the pattern
  at step 1 and releases the held note: with a four-bar loop a length that does not divide
  64 steps is cut short at the wrap; with the loop off the pattern cycles on its own length.
  The demo's Loop switch (`useTimelineLoop`, on at load) shows both.
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

### Nano (polyphonic sampler)
- Create with the sample attached: the factory's attachment is an `AudioFileBox`, and the
  file box and the instrument go in ONE transaction —
  `project.api.createInstrument(InstrumentFactories.Nano, { attachment: fileBox })`.
  Arm the unit's CaptureMidi AFTER that transaction or keys are silent.
- In-memory samples: put the decoded `AudioBuffer` in the `localAudioBuffers` map passed
  to `initializeOpenDAW`, keyed by `UUID.toString(uuid)`, BEFORE the file box exists. Swap
  samples with `referSampleFile()` from `src/lib/sampleFiles.ts` (call it inside a
  transaction; it deletes the old file box when the sampler was its only pointer) and
  watch the load with `watchSampleLoad()`.
- `NanoDeviceBoxAdapter.namedParameter`, all automatable and modulatable:
  `volume` (label "Gain", dB: 0 at the top, −72 along the curve, −∞ at unit 0),
  `octave` (int −3..3), `tune` (±1200 ct),
  `rootKey` (int 0..127, default 60), `attack` (0.001–5 s, exponential),
  `release` (0.001–8 s, exponential), `sampleStart` / `sampleEnd` (0..1),
  `loop` (boolean), `loopFade` (0.001–1 s, exponential), `loopStart` / `loopEnd` (0..1).
- `adapter.file()` is `Option<AudioFileBoxAdapter>`; its `peaks` and `data` are Options
  too. Peaks arrive after the loader finishes — invalidate the waveform painter from
  `watchSampleLoad`'s `onLoaded`.
- **All four markers are shares of the WHOLE sample**, not of the region. Start past end
  plays backwards.
- **Captured at note start vs read live.** A voice captures its REGION when it starts:
  moving Start/End, or modulating Sample Start, is heard on the NEXT note. Everything
  else is read every block and changes sounding notes: root key, octave, tune, loop
  on/off, loop points, fade, attack, release, gain. Measured: a held 220.5 Hz note
  moved to 441 Hz when Tune went to +1200 ct, with one read head throughout and no gap.
  Reverse measured on a 200→2000 Hz sweep: start 1 / end 0 reads 1026 Hz then 723 Hz
  (falling); start 0 / end 1 reads 405 Hz then 573 Hz (rising).
- **Loop rules** (from the voice): the two loop points are ordered, clamped inside the
  region, and fall back to the whole region when less than ONE SOURCE FRAME is left
  between them. A region holding less than one frame plays nothing. The fade is capped
  at half the loop span and is in seconds of SOURCE material, so a note an octave up
  crosses it in half the time. There are TWO fade zones, one at each end of the loop
  (`[lo, lo+fade]` and `[hi−fade, hi]`): the fade runs while the head crosses the end
  zone, and the wrap lands at `lo+fade`, so the loop repeats every span minus fade.
  Switching the loop off mid-note lets the voice run out. `nanoMarkers.ts` mirrors these
  rules for drawing; `regionBounds` and `effectiveLoop` take the sample's frame count
  because "one frame" depends on it (0.1 % of a 60 s sample is 60 ms of sound).
- Measured with a decaying 1.5 s pluck held past its end: loop on, output RMS 0.008 at
  2.5 s; loop off, RMS 0.
- **The empty-region message depends on modulation.** The markers show the STORED
  start; the engine reads the start with modulation added. With Start equal to End
  and the LFO on, held notes sounded on 5 of 6 tries (RMS 0.08–0.10), so the page only
  claims silence while nothing modulates the start (`regionMessage` in
  `nanoMessages.ts`).
- Pitch, octave and reverse were measured at both 44.1 kHz and 48 kHz contexts
  (48 kHz: 220.2 Hz, 440.4 Hz an octave up, pad 130.8 Hz, reversed sweep 960 → 676 Hz).
- **Read heads:** `project.liveStreamReceiver.subscribeFloats(adapter.positionsAddress, …)`
  delivers the positions of the first 16 sounding voices in SOURCE FRAMES. A −1 ends the
  list when fewer than 16 are sounding; entries after it are stale, and with 16 or more
  there is no −1. Divide by `numberOfFrames − 1` for a share of the sample. The device keeps broadcasting while
  idle (about 50 packets a second, first entry −1), so an overlay is cleared by the next
  packet; the demo also clears on a 150 ms stale timer. Draw straight to a canvas in the
  callback — no React state per packet. A releasing voice still has a head: a three-note
  chord with a 0.8 s release shows 6 heads where the next chord starts.
- **Integer parameters need an integer slider.** A unit-space step of 1/6 or 1/127 is
  not exactly representable: the unit value read back from the parameter misses the
  Radix slider's step grid by a hair and arrow keys stop moving it (Octave stuck at 2,
  Root key stuck after one step). `ParamSlider` takes `positions` (7 for octave, 128 for
  root key) and runs over whole-number positions; math in `src/lib/parameterSteps.ts`.
- **LFO on Sample Start:** create it unipolar (`box.bipolar.setValue(false)`). A bipolar
  LFO on a start of 0 spends half of every cycle clamped at 0. Base plus modulation
  is clamped to the sample, so on a start of 1 (the Riser as loaded) only a NEGATIVE
  depth does anything. While the transport plays, a synced LFO's phase is tied to the
  position: it re-anchors on start, locate and every loop jump (measured: a "4 bars"
  LFO over the two-bar loop gave two alternating first read-head positions, 0.16 and
  0.32 — the start plus a few tens of ms of travel). Stopped, it keeps advancing on the
  engine's free-running clock (from the engine source; `src/demos/modulation/CLAUDE.md`
  has the flat-until-first-Play caveat). So every synced rate of one bar or less gives
  notes on bar lines the same start each time — the demo defaults to "4 bars".
- **Presets are checked against the parameter's own mapping.** `setValue` does not
  clamp, so `applyParams` refuses a value that `parameter.valueMapping.clamp(value)`
  would change (out of range, NaN, a fraction for an integer) and throws, which aborts
  the transaction.
- **Deleting a file box ends its loader.** When `referSampleFile` deletes the old
  `AudioFileBox`, the project unregisters the sample and its loader goes with it;
  selecting that sample again builds a new loader, which asks the provider for the
  buffer again. So gallery buffers STAY in `localAudioBuffers` for the page's lifetime —
  only a dropped file's buffer is removed when its file box goes. Taking a buffer away
  while a load for it is still running fails that load.
- **`queryLoadingComplete()` resolves for a FAILED sample too** (it plays as silence).
  Read the loader's state afterwards — `project.sampleManager.getOrCreate(uuid).state` —
  or a failed first sample gives a page that looks ready and makes no sound.
- **Replacing a note pattern** takes two commits: `editing.modify()` deleting the
  existing events, then `editing.append()` creating the new ones (one undo step). A
  collection does not see its own in-flight changes.
- **Naming:** the SDK prints note 60 as "C3" (`MidiKeys.toFullString`, so the Root key
  readout says A2 for note 57), while the on-screen `PianoKeyboard` labels note 60 as C4.
- A themed Radix `Slider` does not forward `aria-label` to its thumb (the element with
  `role="slider"`). Use `ParamSlider`, or `useSliderThumbLabel()` for a raw Slider.

### Browser-testing gotchas (Nano page)
- The keyboard's first 21 `.pk-key` elements are the white keys from note 48 upward:
  index 0 = 48, 5 = 57, 7 = 60, 14 = 72. Scroll a key into view before a mouse gesture —
  a key below the fold receives nothing and measures RMS 0.
- The playhead overlay (`.nn-wave-overlay`) exposes `data-playheads` (count) and
  `data-positions` (shares of the sample, comma-separated).
- An `AnalyserNode` read reflects the PAST: with `fftSize` 16384 the buffer is 0.37 s
  long at 44.1 kHz, so a pitch read from its start describes audio from about 0.3 s earlier. Read a
  moving pitch at two points at least 0.4 s into the note.
- Autocorrelation pitch reads need the FIRST strong peak, not the best one: two periods
  score as high as one, and a 220 Hz note reads as 110 Hz.
- To measure at another sample rate, force it before the page loads: replace
  `window.AudioContext` in an init script with a subclass whose constructor passes
  `sampleRate`.
- A multi-file drop can be made in the page: fill a `DataTransfer` with `File`s and
  dispatch a `DragEvent("drop", { dataTransfer })` on `.mc-dropzone`. `setInputFiles`
  with several files fails on the single-file input.
- Two sliders share a parameter on this page (a waveform marker and a parameter slider).
  The markers are named "… marker"; match parameter sliders with `exact: true`.

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
