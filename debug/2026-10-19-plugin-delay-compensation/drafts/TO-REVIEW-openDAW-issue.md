<!-- Draft for a new issue on andremichelle/openDAW. Not posted. Target: a bug report that carries the measurement the open feature requests #355 and #357 lack; label suggestion: bug or feature request, the maintainer's call. -->

# No plug-in delay compensation: a look-ahead device shifts its track 5 ms against the rest

**SDK:** `@opendaw/studio-sdk` 0.0.175 (WASM engine), Chrome, macOS.

A device that buffers input before it renders (the Compressor and the Maximizer with look-ahead on, 5 ms
each) delays its track by that amount, and nothing in the engine delays the other tracks to match. A track
with such a device therefore arrives 5 ms after every other track in the mix, and a user lining parts up
by ear records that offset into the arrangement. Any device with internal latency sits late the same way;
the WebCLAP bridge hands its plug-ins a `latency` word of 0 and does not read the plug-in's latency
extension, so a hosted plug-in with look-ahead of its own is shifted as well.

**Repro page (headless offline render, reads the shift by cross-correlation):**
https://opendaw-test.pages.dev/plugin-delay-compensation-debug-demo.html — click Run. One Tape track plays
a single-sample impulse at 0.25 s; the same half second is rendered at 48 kHz dry and through each device
with look-ahead off and on, at settings that apply no gain reduction (Compressor: threshold 0 dB, ratio 1, knee 0,
input gain 0, makeup 0, auto-makeup off, mix 1; Maximizer: threshold 0 dB, its fixed −0.001 dB headroom stays). The look-ahead toggle is set
before the offline renderer starts.

| render | onset (frame) | peak | lag vs dry | correlation |
|---|---|---|---|---|
| dry | 12000 (250.00 ms) | 0.500 | 0 | 1.000 |
| Compressor, look-ahead off | 12000 | 0.500 | 0 | 1.000 |
| Compressor, look-ahead on | 12240 (255.00 ms) | 0.500 | **+240 frames (5.00 ms)** | 1.000 |
| Maximizer, look-ahead off | 12000 | 0.500 | 0 | 1.000 |
| Maximizer, look-ahead on | 12240 (255.00 ms) | 0.500 | **+240 frames (5.00 ms)** | 1.000 |

The shift is the device's whole look-ahead (0.005 s in both devices: `LOOKAHEAD_SECONDS` in the Compressor, `LOOK_AHEAD_SECONDS` in the Maximizer); peak (within the
Maximizer's fixed headroom) and correlation are unchanged, so the sample is otherwise untouched; the look-ahead-off rows are the control.

**Read in the source (0.0.175):** the device ABI registers `process`, `init`, `parameter_changed`,
`field_changed`, `sample_changed`, `soundfont_changed`, `reset` and `terminate` (`device_register`,
`crates/engine/src/lib.rs`); no slot carries a latency and no device exports one; the audio-unit graph has
no delay stage. `packages/studio/core-wasm/src/wclap/wclap-bridge.ts` writes `0` into the CLAP audio-buffer
`latency` word at both of its sites.

Related: #355 (hardware latency compensation for monitoring and MIDI output) and #357 (latency compensation
for Werkstatt effects) ask for the same stage from the other side; this report adds the measured shift of
the stock devices. Write-up with the method:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-19-plugin-delay-compensation/note.md
