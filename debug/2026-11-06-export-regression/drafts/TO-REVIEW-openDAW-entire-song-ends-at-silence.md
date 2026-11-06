<!-- FOR NAOMI, REMOVE BEFORE POSTING: this one is your call, and it is written as a question. The repro URL and the note link work only once feat/export-regression-harness is merged. The rows gap-none-start and gap-none-section-entire are in the catalogue but have NOT run yet (no browser this round): run them first and put their frame counts in the second table, with 44.1 kHz and renderSection. The table below is one console probe. -->

# An entire-song render ends at the first 10 s of silence, and what follows is not in the file

**Version:** `@opendaw/studio-sdk@0.0.182`, Chrome 156, macOS.

`OfflineEngineRenderer.start`, and `renderSection` with `tail: true`, end the render once audio has played and 10 s stays at or below -72 dB. A region after that is not in the file, and the render resolves normally.

**Repro:** https://opendaw-test.pages.dev/export-regression-audit-debug-demo?rows=gap-none-start,gap-none-section-entire, and `&rate=44100` for the other rate (click Run, a few seconds, no audio plays): a 200 ms burst region at 0 and another at 16 s, no device, held to a `step` over the same span.

**A second region after a gap.** One run, 48 kHz, through `start`. A 4 s region holding a 0.2 s burst, through a default Reverb, and a copy of it later:

| Second region at | `lastRegionAction` | Rendered | Last sample over 0.01, channel 0 |
|---|---|---|---|
| none | 4 s | 1.687 s | 0.562 s |
| 6 s | 10 s | 7.687 s | 6.562 s |
| 16 s | 20 s | **1.687 s** | **0.562 s** |
| 30 s | 34 s | **1.687 s** | **0.562 s** |

At 16 s and 30 s the second region is not in the file.

**A song ending in silence.** A 4 s region holding a 0.2 s burst, through a default Reverb. `start` and `renderSection` give the same bits, identical to a `step` over the same frames as far as they go, then they end:

| Page rate | Song | Rendered |
|---|---|---|
| 48000 | 192000 frames | **80992** |
| 44100 | 176400 frames | **74001** |

**Where it happens** (read at the tag):

- The worker's `render` breaks once 10 s of silence has passed (`core-wasm/src/offline-worker.ts:399`, `:426`) and keeps at most a quarter of a second of it (`:440`). Nothing in that loop looks at the song's end.
- `MixdownSection.collect` marks "Entire song" and the last marker section `tail: true` (`MixdownSection.ts:21`, `:39`), and `Mixdowns.render` sends the song to `start` (`Mixdowns.ts:28`).
- A bounce keeps its span: "The exact span is always kept, a tail only adds what is still audible after it" (`AudioBounce.ts:138`).
- `start` and `renderSection` pass only `maxDurationSeconds`, so 10 s and -72 dB are `render`'s defaults (`offline-worker.ts:398-399`); `endPosition` reaches only the progress display. Silence before the first audio does not count (`hasHadAudio`).

Trimming trailing silence may well be the intent, though a bounce keeps its span. Is a render shorter than the song meant when nothing follows?

**Not measured:** `renderSection` with a gap, 44.1 kHz with a gap, the last marker section with a gap, and the studio's own Export dialog (I call the SDK directly).

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md
