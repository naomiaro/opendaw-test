<!-- FOR NAOMI, REMOVE BEFORE POSTING: this one is your call, and it is written as a question. The repro URL and the note link work only once feat/export-regression-harness is merged. Beyond what you asked for: the gap table below, a console probe at 48 kHz, one run. It turned the question from a short file into a lost region. -->

# Question: an entire-song render stops after 10 s of silence. Is that meant, given a bounce keeps its span?

**Version:** `@opendaw/studio-sdk@0.0.182`, Chrome 156, macOS.

`OfflineEngineRenderer.start`, and `renderSection` with `tail: true`, can come out shorter than the song, and a region after a long enough gap is not in the render. I can't tell whether that is meant.

**Repro:** https://opendaw-test.pages.dev/export-regression-audit-debug-demo?group=tail, and `&rate=44100` for the other rate (click Run, a few seconds, no audio plays). The rows are `tail-none-section-entire-long` and `tail-none-start-long`. The gap table below is from a console probe; the note has how it was made.

**A song ending in silence.** A 4 s region holding a 0.2 s burst, through a default Reverb. Both paths give the same bits, identical to a `step` over the same frames as far as they go, then they end:

| Page rate | Song | Rendered |
|---|---|---|
| 48000 | 192000 frames | **80992** |
| 44100 | 176400 frames | **74001** |

**A second region after a gap.** The same project, with the region copied to a later position, through `start` at 48 kHz:

| Second region at | `lastRegionAction` | Rendered | Last sample over 0.01 |
|---|---|---|---|
| none | 4 s | 1.687 s | 0.562 s |
| 6 s | 10 s | 7.687 s | 6.562 s |
| 16 s | 20 s | **1.687 s** | **0.562 s** |
| 30 s | 34 s | **1.687 s** | **0.562 s** |

At 16 s and 30 s the second region is not in the file.

**Where it happens** (read at the tag):

- The worker's `render` breaks once 10 s of silence has passed (`core-wasm/src/offline-worker.ts:399`, `:426`) and keeps at most a quarter of a second of it (`:440`). Nothing in that loop looks at the song's end.
- `MixdownSection.collect` marks "Entire song" and the last marker section `tail: true` (`MixdownSection.ts:21`, `:39`), and `Mixdowns.render` sends the song to `start` (`Mixdowns.ts:28`).
- A bounce keeps its span: "The exact span is always kept, a tail only adds what is still audible after it" (`AudioBounce.ts:138`).

Trimming trailing silence from a mixdown may well be the intent. Is that so for silence inside the song's span too, and for what comes after it?

**Not measured:** the last marker section with a gap, and the studio's own Export dialog (I call the SDK directly).

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md
