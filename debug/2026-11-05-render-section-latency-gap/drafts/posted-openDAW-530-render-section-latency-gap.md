<!-- Posted as https://github.com/andremichelle/openDAW/issues/530 on 2026-11-05. Body as filed. -->

# `renderSection` drops frames at frame 48000 when delay compensation is not a whole number of quanta

**Version:** `@opendaw/studio-sdk@0.0.181`, Chrome, macOS. The code cited is unchanged on main at `10088021d`.

With a latent device in the project, a section rendered through `OfflineEngineRenderer.renderSection` with `tail: false` loses frames at frame 48000 of the render, unless the latency is a whole number of quanta. Everything after that frame comes out early, and a sustained sound jumps there.

**Repro:** https://opendaw-test.pages.dev/render-section-latency-debug-demo, and `?rate=44100` for the other rate (click Run, about twenty seconds, no audio plays)

**Measured.** Each row renders the same section twice: through `renderSection`, and with one `renderer.step(n)` over the same frames as the reference. Tone bursts sit at 0.5, 1.5, 2.5 and 3.5 s, and "early" compares their positions. "Largest step" is the largest move between neighbouring samples on a steady 997 Hz tone at 0.5, which is 0.065 at 48 kHz and 0.071 at 44.1 kHz through the reference. Latency is what `engine.compensationLatency` reports, read back before each row.

| Project | 48 kHz: latency | Early after frame 48000 | Largest step | 44.1 kHz: latency | Early after frame 48000 | Largest step |
|---|---|---|---|---|---|---|
| No latent device | 0 | 0 | 0.065 | 0 | 0 | 0.071 |
| Maximizer, default settings, on a muted track | 240 | **16** | **0.500 at frame 48000** | 221 | **35** | **0.519 at frame 48000** |
| Compressor look-ahead on the track | 240 | **16** | **0.500 at frame 48000** | 220 | **36** | **0.449 at frame 48000** |
| Fold, on a muted track | 15 | **113** | **0.475 at frame 48000** | 15 | **113** | **0.893 at frame 48000** |
| Autotune, on a muted track | 1280 | 0 | 0.065 | 1280 | 0 | 0.071 |
| Compressor look-ahead, 0.9 s section | 240 | no hit that late | 0.065 | 220 | no hit that late | 0.071 |

At 48 kHz with a look-ahead Compressor, the burst positions read 24034 **72018 120018 168018** against 24034 72034 120034 168034 through the reference. The burst before frame 48000 is on time.

The frames lost come to `(128 − (latency mod 128)) mod 128`, and each row's prediction was on the page before it ran. Device rate plays no part: the figures are identical with the output device at 44.1 kHz and at 48 kHz.

**Two passes.** The render is counted across both passes, so the loss falls in different places by section length:

- A section of at least 48000 frames has it in the discarded first pass, so no jump shows but every kept frame is early: 16 frames at 48 kHz with a look-ahead Compressor, for a 4 s section.
- A shorter section of more than 24000 frames has it inside the kept pass, at frame `48000 − section frames`. For a 0.9 s section at 48 kHz, a burst at 0.5 s reads 16 early and the tone jumps 0.552 at frame 4800.
- A 4 s two-pass render at 44.1 kHz also reads 1 frame early with no latency at all. I haven't explained that frame, and it looks separate from this: with a Compressor the same render reads 37, the formula's 36 plus 1.

**Where it happens** (read at the tag):

- `step` returns exactly what was asked and discards the rest of its last quantum (`core-wasm/src/offline-worker.ts:382-391`).
- `#renderFrames` therefore steps in whole quanta, and says why: "chunks must be quantum multiples: a step discards the rest of its last quantum" (`OfflineEngineRenderer.ts:407-408`, added in `42232752f`).
- `trimStart` then drops the settled latency from the start of the output (`offline-worker.ts:93`, added a day later in `df8c72f90`). Those frames come out of the first chunk, so with a latency that is not whole quanta the chunk ends part way through a quantum.

**Reach, from the source:** `Mixdowns.render` (`Mixdowns.ts:30`) sends every section but "Entire song" to `renderSection`, so this applies to "Loop Area", "Loop Area (two passes)" and every marker section but the last, whenever more than 48000 frames are rendered, both passes counted. `MasteringPanel.tsx:207` renders sections through it too. A Maximizer has look-ahead on by default, so adding one is enough.

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-05-render-section-latency-gap/note.md
