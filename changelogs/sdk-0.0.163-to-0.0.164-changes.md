# OpenDAW SDK Changelog: 0.0.163 → 0.0.164

One release, one headline: **Neon**, a new stock instrument — a Casio CZ-101 phase-distortion
synthesizer calibrated against VirtualCZ, with `.syx` tone-dump import/export. Alongside it:
a Rust-engine fix for **seconds-timebase audio clips** (they looped every ~1 ms instead of at
their real duration), and **`CaptureMidi` now follows MIDI hot-plug / late permission** while
armed. No breaking changes; no `lib-*` package changed.

Sub-package versions (installed): `studio-adapters` 0.1.5, `studio-core` 0.1.5,
`studio-core-wasm` 0.0.9, `studio-boxes` 0.0.103, `studio-enums` 0.0.84.

## New instrument: Neon — CZ-style phase distortion (boxes 0.0.103, adapters 0.1.5, core-wasm 0.0.9, enums 0.0.84)

A faithful Casio CZ-101 model: two lines of phase-distortion oscillators, ring/noise
modulation, and the CZ's six 8-stage envelopes. The DSP is a new Rust `device-neon` crate
(calibrated against VirtualCZ with A/B render tests upstream), shipped as
`wasm/plugins/device_neon.wasm` and registered in core-wasm's `DEVICES` table — verified
present in the installed dist.

**`NeonDeviceBox`** (studio-boxes) — CZ hardware values (0–99) are stored as *continuous*
floats so typed times/levels land exactly; a `.syx` import writes whole numbers, the DSP
owns the hardware rate/level tables. Fields:

- `line-select` (int, 4 values: 1, 2, 1+1′, 1+2′), `modulation` (int: Off, Ring, Noise)
- `octave` (int, ±3), `detune` (float, ±4800 cents — the `.syx` note+fine pair folds into
  this; offsets only the primed line of 1+1′/1+2′), `tune` (float, ±1200 cents — shifts the
  whole instrument), `glide-time` (unipolar), `voicing-mode` (`VoicingMode` mono/poly)
- `vibrato` object: `wave` (Triangle, Saw Up, Saw Down, Square), `delay`, `rate`, `depth`
- `lines` array (2): `wave1` (8 waves: Saw, Square, Pulse, Double Sine, Saw-Pulse,
  Resonance Saw/Triangle/Trapezoid), `wave2` (Off + the 8), `dcw-key-follow` /
  `dca-key-follow` (0–9)
- `envelopes` array (6 × `NeonEnvelope`): `rate1..8`, `level1..8` (raw 0–99, plain fields,
  not automatable), `sustain` (1–8, 0 = none), `end` (1–8). Fixed order: line1
  pitch/DCW/DCA, then line2 pitch/DCW/DCA.

**`InstrumentFactories.Neon`** (in `InstrumentFactories.Named`, so name-keyed factory
lookups gain a `"Neon"` key) — the init tone is line-1 saw, DCW fully open, organ-style DCA
(full until note-off, short release).

**`NeonDeviceBoxAdapter`** (studio-adapters) — `InstrumentDeviceBoxAdapter` with
`namedParameter` covering lineSelect / modulation / octave / detune / tune / glideTime /
voicingMode, the vibrato quad, and per-line wave/key-follow params. Helpers in the exported
`Neon` namespace: `Waves`, `LineSelect`, `Modulation`, `VibratoWaves` label arrays and
`envelopeIndex(line, kind)`; the adapter's `envelope(line, "pitch" | "dcw" | "dca")`
returns the `NeonEnvelope` object directly.

**`CzSysex` + `NeonPreset`** (studio-adapters) — real CZ-101 patch interchange:
`CzSysex.isToneDump(bytes)`, `decode(bytes): CzTone`, `encode(tone, channel?, program?)`,
and `NeonPreset.apply(box, tone)` to write a decoded tone into a `NeonDeviceBox`. `CzTone`
mirrors the hardware dump (per-line wave pair, key-follows, pitch/DCW/DCA envelopes,
detune note+fine, vibrato block).

**`IconSymbol`** (studio-enums) gains `Neon`, `Ring`, `Noise`.

## Fix: seconds-timebase audio CLIPS played a ~1 ms loop (Rust engine, core-wasm 0.0.9)

Import-as-clip (`AudioContentFactory.createNotStretchedClip`) stores `timeBase: "seconds"`
with `duration` in **seconds**. The engine's `read_audio_clip` read that duration raw as
pulses — a 2-second clip became a 2-*pulse* loop (~1 ms), audibly a repeated short burst
that never advanced through the file. The clip's virtual region now converts via the tempo
map (`seconds_span_to_ppqn(0, duration)`, matching TS `TimeBaseConverter.toPPQN` at
position 0) when the timebase field says `"seconds"`. Upstream regression test renders a
clip and asserts head-sounds / silent-past-file / wraps-at-converted-duration. Timeline
*regions* were unaffected — this was clip-launcher-path only.

## CaptureMidi: armed captures follow access grants and hot-plug (core 0.1.5)

The MIDI input stream snapshots the available devices when arming. Previously, granting
MIDI access *after* arming (e.g. a header permission toggle) or hot-plugging a controller
left an armed capture listening to nothing until re-armed. `CaptureMidi` now subscribes to
`MidiDevices.available()` and the `MIDIAccess` `statechange` event, rebuilding the stream
of an armed capture on either signal. Additive — no API change.

## Misc

- **`EnginePreferences` tests** rewritten against `EngineSettingsDefaults` and dB-domain
  metronome gain values (test-only; the dB gain contract itself shipped earlier).
- **Rust engine**: `crates/studio-boxes` registry gains the Neon box; `build-wasm.sh`
  adds `device-neon` to the device-crate list.
- Upstream studio-app work not in the SDK surface: the Neon device editor (envelope
  editor with stage indicator, wave display), the Neon manual page + icons, a rewritten
  "creating a device" manual, upload access-key from localStorage in the OpenDAW API
  clients, and a project-profile dialog bugfix.

## opendaw-headless follow-ups shipped with this upgrade

- **No code changes needed** — the release is additive; we don't touch `CaptureMidi`
  internals, audio clips, or the changed factory surfaces (our MIDI demo uses
  Vaporisateur). `npm ci`, `npx tsc --noEmit` (0 src errors), `npm run build`, and all
  41 tests pass unchanged on the new SDK.
- `documentation/08-recording.md` Device Enumeration gained a note that an armed
  `CaptureMidi` rebuilds its stream on late permission grants and device hot-plug.
