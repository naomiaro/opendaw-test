<!-- TO REVIEW: not posted. Target: a new issue on andremichelle/openDAW, framed as a question (not a defect report).
The repro link works only once PR #221 is merged and deployed: check it on the public host first. -->

# Question: is `ExportConfiguration.range`'s end meant as a minimum?

Hi, Naomi's Claude here.

**Version:** `@opendaw/studio-sdk@0.0.183`, Chrome 156, macOS. This is a question, not a defect report. I could not find the intended behaviour written down, so I'd like to know which reading is meant before I document it.

When `OfflineEngineRenderer.start` gets a `range` whose end falls inside sound, the render does not stop at `end`. The timeline plays on past it, and the file holds whatever follows, until the output has been silent for 10 s, at most 30 s past `end`.

**Repro:** https://opendaw-test.pages.dev/export-regression-audit-debug-demo?rows=range-none-start-ends-in-sound, and `&rate=44100` for the other rate. Click Run; it takes a few seconds and no audio plays. The row is one region of a 4 s probe sample that sounds throughout. It passes `{range: {start: 0, end: 3840}}` (0 to 2 s at 120 bpm) to `start`.

**Measured.**

| Page rate | Range | Frames returned | Range in frames |
|---|---|---|---|
| 48000 | 0 to 2 s | 204000 | 96000 |
| 44100 | 0 to 2 s | 187537 | 88200 |

- At both rates the file is the whole 4 s song, bit for bit a stepped render of it.
- It ends at the quantum that holds the song's last sample (192000 and 176512), plus exactly a quarter second.
- So the file holds 2 s of music after the range's end.

**Where it comes from** (read at the 0.0.183 tag):

- `start` resolves `range` to `startPosition` and `endPosition`, then passes the range's length as `minDurationSeconds` and that plus 30 s as `maxDurationSeconds` (`packages/studio/core/src/OfflineEngineRenderer.ts:271-282`).
- `render` then stops only when `SilenceTail` sees 10 s at or below −72 dB past the minimum, or at the maximum (`packages/studio/core-wasm/src/offline-worker.ts:401-418`). Nothing in the loop reads `endPosition`.
- `ExportRange` (`"full" | {start, end}`, `packages/studio/adapters/src/EngineProcessorAttachment.ts`) has no comment.
- The studio's own export dialog passes no range: its sections go through `renderSection`, and a section without a tail renders an exact frame count.

**Two readings I can see:**

1. `end` is a minimum, as `tail: true` is for the song section: the file runs on until the sound after it has died away. That suits a range that ends on silence, or one whose last sound should ring out.
2. `end` is where the file ends, perhaps with the sound inside the range ringing out. Today the timeline past `end` plays on as well, so material that starts after `end` lands in the file.

Which is intended?

Investigation note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md#after-533-and-534-four-groups-of-rows-from-upstreams-replies
