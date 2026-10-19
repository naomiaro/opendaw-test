# No plug-in delay compensation: a look-ahead device shifts its track by its latency

Verified against `@opendaw/studio-sdk` 0.0.175 (WASM engine), Chrome, macOS, 2026-10-19.
Repro page: [`plugin-delay-compensation-debug-demo.html`](../../plugin-delay-compensation-debug-demo.html)
(unlisted; `src/demos/effects/plugin-delay-compensation-debug-demo.tsx`). Lag helper and its tests:
`src/lib/audit/lagEstimate.ts`.

## Symptom

The Compressor and the Maximizer buffer 5 ms when their look-ahead is on. The engine delays nothing
else to match, so the track that carries such a device arrives 5 ms after every other track, and
after its own dry rendering. The same holds for any device whose output arrives late: the engine has
no stage that reads a device's latency.

## Measured

One Tape track plays a single-sample impulse (0.5) at 0.25 s. The same half second is rendered
offline at 48 kHz five times through `OfflineEngineRenderer`; each render is compared with the dry
one by normalized cross-correlation (`bestLag`, ±2400 frames). Device settings change no gain
(Compressor: threshold 0 dB, ratio 1, knee 0, input gain 0, makeup 0, auto-makeup off, mix 1;
Maximizer: threshold 0 dB); the look-ahead toggle is set before the renderer starts, so its 15 ms
crossfade does not run inside the render.

| render | onset (frame) | peak | lag vs dry | score |
|---|---|---|---|---|
| dry | 12000 (250.00 ms) | 0.500 | 0 | 1.000 |
| Compressor, look-ahead off | 12000 | 0.500 | 0 | 1.000 |
| Compressor, look-ahead on | 12240 (255.00 ms) | 0.500 | **+240 frames (5.00 ms)** | 1.000 |
| Maximizer, look-ahead off | 12000 | 0.500 | 0 | 1.000 |
| Maximizer, look-ahead on | 12240 (255.00 ms) | 0.500 | **+240 frames (5.00 ms)** | 1.000 |

The shift is the device's whole look-ahead (`LOOKAHEAD_SECONDS = 0.005` in both devices), the sample
is otherwise untouched (peak and correlation unchanged), and the look-ahead-off rows are the control.
A delay-compensating engine would read 0 in every row.

## Where the engine stands (read, not measured)

- The device ABI registers `process`, `init`, `parameter_changed`, `field_changed`,
  `sample_changed`, `soundfont_changed`, `reset` and `terminate` (`device_register`,
  `crates/engine/src/lib.rs`). No slot carries a latency, no device exports one, and the
  audio-unit graph (`crates/engine/src/audio_unit/`) has no delay stage.
- The WebCLAP bridge writes `0` into the CLAP audio-buffer `latency` word it hands the plug-in
  (`packages/studio/core-wasm/src/wclap/wclap-bridge.ts`, two sites) and does not query the plug-in's
  latency extension, so a hosted plug-in with internal latency sits late by that amount the same way.
- Upstream feature requests on the same ground: [#355](https://github.com/andremichelle/openDAW/issues/355)
  (hardware latency compensation, monitoring and MIDI output) and
  [#357](https://github.com/andremichelle/openDAW/issues/357) (latency compensation for Werkstatt
  effects, "also a thing that is required for some VST effects"). Neither carries a measurement.

## Why it matters here

The moisesDAW fork hosts native VST plug-ins through a ring that is 4–6 quanta deep (512–768
frames, 11.6–17.4 ms at 44.1 kHz), and its devices already export the figure
(`latency_samples`); nothing upstream or in the fork consumes it
([moisesDAW#28](https://github.com/moises-ai/moisesDAW/issues/28)). A compensation stage upstream
would be the place to feed it.

## Status

Open. Issue draft for upstream in `drafts/` (TO-REVIEW). The page is the regression check: the two
look-ahead-on rows read 0 once the engine compensates.
