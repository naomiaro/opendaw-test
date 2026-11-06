<!-- TO REVIEW, not posted. The repro URL and the note link go live when the PR holding them merges. -->

# `renderSection` drops frames at frame 48000 when delay compensation is not a whole number of quanta

**Version:** `@opendaw/studio-sdk@0.0.181`, Chrome, macOS. The code cited is unchanged on main at `10088021d`.

With a latent device in the project, a section rendered through `OfflineEngineRenderer.renderSection` loses frames at frame 48000 of the output, unless the latency is a whole number of quanta. Everything after that frame comes out early, and a sustained sound jumps there.

**Repro:** https://opendaw-test.pages.dev/render-section-latency-debug-demo, and `?rate=44100` for the other rate (click Run, about ten seconds, no audio plays)

**Measured.** Each row renders the same section twice: through `renderSection`, and with one `renderer.step(n)` over the same frames as the reference. Tone bursts sit at 0.5, 1.5, 2.5 and 3.5 s, and "early" compares their positions. "Largest step" is the largest move between neighbouring samples on a steady 997 Hz tone at 0.5, which is 0.065 at 48 kHz and 0.071 at 44.1 kHz through the reference.

| Project | 48 kHz: latency | Early after frame 48000 | Largest step | 44.1 kHz: latency | Early after frame 48000 | Largest step |
|---|---|---|---|---|---|---|
| No latent device | 0 | 0 | 0.065 | 0 | 0 | 0.071 |
| Compressor look-ahead | 240 | **16** | **0.500 at frame 48000** | 220 | **36** | **0.449 at frame 48000** |
| Fold, on a muted track | 15 | **113** | **0.475 at frame 48000** | 15 | **113** | **0.893 at frame 48000** |
| Autotune, on a muted track | 1280 | 0 | 0.065 | 1280 | 0 | 0.071 |
| Compressor look-ahead, 0.9 s section | 240 | no hit that late | 0.065 | 220 | no hit that late | 0.071 |

At 48 kHz with a look-ahead Compressor, the burst positions read 24034 **72018 120018 168018** against 24034 72034 120034 168034 through the reference. The burst before frame 48000 is on time.

The frames lost come to `(128 − (latency mod 128)) mod 128`, and each row's prediction was on the page before it ran. Device rate plays no part: the figures are identical with the output device at 44.1 kHz and at 48 kHz.

**Two passes.** The boundary falls in the discarded first pass, so there is no jump in the output, but every kept frame is early: 16 frames at 48 kHz, 37 at 44.1 kHz. The 37 is the formula's 36 plus 1: a two-pass render at 44.1 kHz reads 1 frame early with no latency too, which I haven't explained and which looks separate from this.

**Where it happens** (read at the tag):

- `step` returns exactly what was asked and discards the rest of its last quantum (`core-wasm/src/offline-worker.ts:382-391`).
- `#renderFrames` therefore steps in whole quanta, and says why: "chunks must be quantum multiples: a step discards the rest of its last quantum" (`OfflineEngineRenderer.ts:407-408`, added in `42232752f`).
- `trimStart` then drops the settled latency from the start of the output (`offline-worker.ts:93`, added a day later in `df8c72f90`). Those frames come out of the first chunk, so with a latency that is not whole quanta the chunk ends part way through a quantum.

**Reach, from the source:** `Mixdowns.render` (`Mixdowns.ts:30`) sends every section but "Entire song" to `renderSection`, so this applies to "Loop Area", "Loop Area (two passes)" and every marker section but the last, on anything over 48000 frames. `MasteringPanel.tsx:207` renders sections through it too. I called the SDK directly and did not run those through the studio's dialog, and I have not listened to the result.

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-05-render-section-latency-gap/note.md
