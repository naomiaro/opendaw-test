# No plug-in delay compensation: a look-ahead device shifts its track by its latency

Verified against `@opendaw/studio-sdk` 0.0.175 (WASM engine), Chrome, macOS, 2026-10-19.
Filed as [openDAW#482](https://github.com/andremichelle/openDAW/issues/482). **Fixed in 0.0.176**
(plug-in delay compensation, upstream `df8c72f90` + `1bfbdcb50` + `54ac2db89`), verified on the
release 2026-10-20 — see Status.
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
one by normalized cross-correlation (`bestLag`, ±2400 frames; the dry render with itself). Device settings apply no gain reduction
(Compressor: threshold 0 dB, ratio 1, knee 0, input gain 0, makeup 0, auto-makeup off, mix 1;
Maximizer: threshold 0 dB, its fixed −0.001 dB headroom stays); the look-ahead toggle is set before the renderer starts, so its 15 ms
crossfade does not run inside the render.

| render | onset (frame) | peak | lag vs dry | score |
|---|---|---|---|---|
| dry | 12000 (250.00 ms) | 0.500 | 0 | 1.000 |
| Compressor, look-ahead off | 12000 | 0.500 | 0 | 1.000 |
| Compressor, look-ahead on | 12240 (255.00 ms) | 0.500 | **+240 frames (5.00 ms)** | 1.000 |
| Maximizer, look-ahead off | 12000 | 0.500 | 0 | 1.000 |
| Maximizer, look-ahead on | 12240 (255.00 ms) | 0.500 | **+240 frames (5.00 ms)** | 1.000 |

The shift is the device's whole look-ahead (0.005 s in both devices: `LOOKAHEAD_SECONDS` in the Compressor, `LOOK_AHEAD_SECONDS` in the Maximizer), the sample is
otherwise untouched (peak within the Maximizer's headroom and correlation unchanged), and the look-ahead-off rows are the control.
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

## Status

Filed as [openDAW#482](https://github.com/andremichelle/openDAW/issues/482) (body as filed:
`drafts/posted-openDAW-482-plugin-delay-compensation.md`). **Fixed upstream in 0.0.176**, published
2026-10-20: devices report their latency (`host_set_latency`; Compressor and Maximizer look-ahead,
Fold oversampling, Autotune, WebCLAP `clap.latency`, Werkstatt `// @latency` / `this.latency`) and
every junction delays its earlier inputs to the latest one (buses, aux returns, composite sums, an
effects stack's dry path, sidechains), capped at 0.1 s per stage; the metronome, take placement,
MIDI out, mixdowns and stems follow the total, automation behind a latent device reads where its
audio was rendered. Measured on the release with this page, one click: every row `onset 12000
(250.00 ms), peak 0.500, lag 0 frames (0.00 ms), score 1.000` — the two look-ahead-on rows read
+240 frames on 0.0.175. The page stays the regression check (expect lag 0 on every row).
Details: `changelogs/sdk-0.0.175-to-0.0.176-changes.md`.
