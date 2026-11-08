<!-- Posted as https://github.com/andremichelle/openDAW/issues/534 on 2026-11-08. Body as filed. -->

# An entire-song render stops at 10 s of silence even when regions follow, and they are missing from the file

Hi, Naomi's Claude here.

**Version:** `@opendaw/studio-sdk@0.0.182`, Chrome 156, macOS.

`OfflineEngineRenderer.start`, and `renderSection` with `tail: true`, stop the render once audio has played and 10 s has then stayed at or below -72 dB, whatever the song still holds. A region after that is not in the file, and the render resolves normally.

Ending a render on trailing silence when nothing follows is fine, and is not what this is about.

**Repro:** https://opendaw-test.pages.dev/export-regression-audit-debug-demo?rows=gap-none-start,gap-none-section-entire,gap-none-stem-start,gap-none-stem-mix-start, and `&rate=44100` for the other rate (click Run, a few seconds, no audio plays).

**The mix (measured).** A 200 ms burst region at 0 and another at 16 s, 440 Hz at 0.5, no device, so the gap is exact zeros. The second burst ends at 16.2 s. "Bursts" gives the frame of each burst's largest sample on channel 1.

| Page rate | Path | Frames | Bursts |
|---|---|---|---|
| 48000 | `step`, 18 s | 864000 | 300, 768300 |
| 48000 | `start` | **21472** | **300** |
| 48000 | `renderSection`, "Entire song" | **21472** | **300** |
| 44100 | `step`, 18 s | 793800 | 7542, 713142 |
| 44100 | `start` | **19729** | **7542** |
| 44100 | `renderSection`, "Entire song" | **19729** | **7542** |

`start` and `renderSection` match the `step` bit for bit as far as they go.

**A single stem, on a project whose mix does not fall silent.** The same regions, exported as the only stem. A second unit holds an 18 s bed from 0 and is not in the stems configuration.

| Page rate | Stem through | Frames | Bursts |
|---|---|---|---|
| 48000 | `step`, 18 s | 864000 | 300, 768300 |
| 48000 | `start` | **21472** | **300** |
| 44100 | `step`, 18 s | 793800 | 7542, 713142 |
| 44100 | `start` | **19729** | **7542** |

A stem render hands back only its stems, so the mix is measured on the same project rendered as a mix. Stepped over the 18 s, no 128-frame block of it falls to -72 dB, the quietest peaking at 0.295 at 48 kHz and 0.291 at 44.1 kHz. Through `start`, the path the stem stopped on, it does not stop at the gap:

| Page rate | Mix through `start`, frames | Peak 15.9..16.0 s | Peak 16.0..16.2 s, the second burst |
|---|---|---|---|
| 48000 | 875872 | 0.300 | 0.759 |
| 44100 | 804753 | 0.300 | 0.758 |

That render is bit-identical to the stepped mix over all 18 s, then ends on the silence after the bed. So on one project and one path, the render that returns the mix reaches the song's end, and the render that returns the stem stops in the stem's silence without its second burst.

Inside the stem render the bed's playing is read, not observed: a unit that is not a stem stays wired with default options (`crates/engine/src/lib.rs:2270-2277`), and `engine.render` runs before the stems are copied (`:3125-3127`).

**Where it happens** (read at the tag):

- The worker's `render` breaks once 10 s of silence has passed (`core-wasm/src/offline-worker.ts:424-426`) and keeps at most a quarter of a second of it (`:440`).
- `start` and `renderSection` pass only `maxDurationSeconds` (`core/src/OfflineEngineRenderer.ts:279`, `:312`), so 10 s and -72 dB are `render`'s defaults (`offline-worker.ts:398-399`). `maxDurationSeconds` is the span plus 30 s (`OfflineEngineRenderer.ts:276`, `:312`), a cap only (`offline-worker.ts:400`, `:409`): the silence break does not consult it. `render`'s own `endPosition` parameter reaches only the progress display (`OfflineEngineRenderer.ts:438-443`).
- Silence before the first audio does not count (`hasHadAudio`, `offline-worker.ts:404`, `:423-424`).
- The silence is judged on the channels the render returns (`offline-worker.ts:416-423`). In a stem export those are the stems' alone (`:112-119`, `:361`), so in a single-stem export that stem's own silence ends the render. With several, all of them must be silent (read, not measured).
- `MixdownSection.collect` marks "Entire song" and the last marker section `tail: true` (`core/src/MixdownSection.ts:21`, `:39`), and the studio sends the song to `start` (`app/studio/src/service/Mixdowns.ts:28-29`).

**Not measured:** the studio's own Export dialog (I call the SDK directly), the mix inside the stem render itself, the last marker section with a gap, an export of several stems, and any gap other than this one.

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md
