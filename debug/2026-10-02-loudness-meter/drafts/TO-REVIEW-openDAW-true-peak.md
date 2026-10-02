# TO REVIEW — for https://github.com/andremichelle/openDAW/issues (new)

**Title:** The loudness stream's "true peak" is the highest sample: EBU Tech 3341 cases 16–18 read −9.03, −7.27 and −6.71 dBTP for a −6.0 dBTP tone

## Symptom

The fifth value of the engine's loudness stream (`EngineAddresses.LOUDNESS`), shown as "TP … dBTP" on the studio's Level card, is the largest sample magnitude, not the true peak. For the four true-peak signals of EBU Tech 3341 — a half-scale sine at fs/4, fs/6 or fs/8 whose phase puts every sample off the crest — it reads:

| Case | Signal | Expected | Reads |
|---|---|---|---|
| 15 | fs/4, 0° | −6.0 dBTP (+0.2 / −0.4) | −6.02 |
| 16 | fs/4, 45° | −6.0 | −9.03 |
| 17 | fs/6, 60° | −6.0 | −7.27 |
| 18 | fs/8, 67.5° | −6.0 | −6.71 |

Each reading equals the tone's highest sample (−9.03 dBFS for fs/4 at 45°, and so on), as a tap on the engine's output confirmed. Measured on `@opendaw/studio-sdk@0.0.173` at 48 kHz and 44.1 kHz in Chrome 154, Firefox 157 and Safari 18.6.

## Repro

- Live page: https://opendaw-test.pages.dev/loudness-meter-audit-debug-demo.html?case=peak (about a minute, silent; keep the tab visible).
- Unit level, at the `@opendaw/studio-sdk@0.0.173` tag: `new LoudnessMeter(48000)` fed `0.5·sin(π/4 + n·π/2)` on both channels, then `fill(out)`: `out[4]` is `20·log10(0.5·sin 45°)` = −9.03.

Write-up: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-02-loudness-meter/note.md

## Cause

`LoudnessMeter.process` (`packages/studio/core-wasm/src/analysis-dsp.ts:108-109`) keeps `#truePeak` as `Math.max(Math.abs(l), Math.abs(r))` over the samples, and `fill` (line 123) converts it to dB. There is no oversampling, so a crest between two samples is not seen. The comment above the class (line 64) describes the value as "dBTP (4x oversampled)", and the Level card labels it dBTP; both describe a different measurement from the one made. ITU-R BS.1770 Annex 2 defines true peak as the maximum after 4× interpolation and gives a 48-tap, 4-phase filter for it; a local build using that filter reads −6.02, −5.98, −6.31 and −6.03 on the four cases.

## Related

#203 (Analyser Device) lists true peak among the planned level meters; #245 (Podcast Recording) asks for a true-peak limiter.
