<!-- FOR NAOMI, REMOVE BEFORE POSTING: the repro URL and the note link work once feat/export-regression-harness is merged. Nothing else is pending. -->

# An entire-song render stops at 10 s of silence even when regions follow, and they are missing from the file

**Version:** `@opendaw/studio-sdk@0.0.182`, Chrome 156, macOS.

`OfflineEngineRenderer.start`, and `renderSection` with `tail: true`, stop the render once audio has played and 10 s has then stayed at or below -72 dB, whatever the song still holds. A region after that is not in the file, and the render resolves normally.

Ending a render on trailing silence when nothing follows is fine, and is not what this is about.

**Repro:** https://opendaw-test.pages.dev/export-regression-audit-debug-demo?rows=gap-none-start,gap-none-section-entire,gap-none-stem-start,gap-none-stem-mix, and `&rate=44100` for the other rate (click Run, a few seconds, no audio plays).

**The mix.** A 200 ms burst region at 0 and another at 16 s, 440 Hz at 0.5, no device, so the gap is exact zeros. The second burst ends at 16.2 s. "Bursts" gives the frame of each burst's largest sample on channel 1.

| Page rate | Path | Frames | Bursts |
|---|---|---|---|
| 48000 | `step`, 18 s | 864000 | 300, 768300 |
| 48000 | `start` | **21472** | **300** |
| 48000 | `renderSection`, "Entire song" | **21472** | **300** |
| 44100 | `step`, 18 s | 793800 | 7542, 713142 |
| 44100 | `start` | **19729** | **7542** |
| 44100 | `renderSection`, "Entire song" | **19729** | **7542** |

`start` and `renderSection` match the `step` bit for bit as far as they go.

**A single stem, with the mix playing throughout.** The same regions, exported as the only stem. A second unit plays an 18 s bed from 0 and is not in the stems configuration.

| Page rate | Stem through | Frames | Bursts |
|---|---|---|---|
| 48000 | `step`, 18 s | 864000 | 300, 768300 |
| 48000 | `start` | **21472** | **300** |
| 44100 | `step`, 18 s | 793800 | 7542, 713142 |
| 44100 | `start` | **19729** | **7542** |

A stem render hands back only its stems, so the mix is read from the same project rendered as a mix over the 18 s: no 128-frame block of it falls to -72 dB, the quietest peaking at 0.295 at 48 kHz and 0.291 at 44.1 kHz. The second burst is missing from the stem's file while the song is still sounding.

**Where it happens** (read at the tag):

- The worker's `render` breaks once 10 s of silence has passed (`core-wasm/src/offline-worker.ts:424-426`) and keeps at most a quarter of a second of it (`:440`). Nothing in that loop looks at the song's end.
- `start` and `renderSection` pass only `maxDurationSeconds` (`core/src/OfflineEngineRenderer.ts:279`, `:312`), so 10 s and -72 dB are `render`'s defaults (`offline-worker.ts:398-399`). `endPosition` reaches only the progress display (`OfflineEngineRenderer.ts:438-443`).
- Silence before the first audio does not count (`hasHadAudio`, `offline-worker.ts:404`, `:423-424`).
- The silence is judged on the channels the render returns (`offline-worker.ts:416-423`). In a stem export those are the stems' alone (`:112-119`, `:361`), so a stem's own silence ends the render.
- `MixdownSection.collect` marks "Entire song" and the last marker section `tail: true` (`core/src/MixdownSection.ts:21`, `:39`), and the studio sends the song to `start` (`app/studio/src/service/Mixdowns.ts:28-29`).

**Not measured:** the studio's own Export dialog (I call the SDK directly), the last marker section with a gap, an export of several stems, and any gap other than this one.

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md
