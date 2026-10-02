# POSTED 2026-10-02 as https://github.com/andremichelle/openDAW/pull/430 (body below as filed).

**Title:** fix(analysis): BS.1770 pre-filter and an oversampled true peak in the loudness meter

Fixes #426 and #427.

## What changes

Two things in `packages/studio/core-wasm/src/analysis-dsp.ts`, nothing else in the meter:

- **The pre-filter is ITU-R BS.1770's.** `LoudnessMeter` built its K-weighting from lib-dsp's general high shelf and high-pass, handing them the standard's prototype parameters. The RBJ shelf has a different transition from the standard's shelf, and the normalized high-pass loses the +0.04 dB of the standard's numerator; the meter read 0.25 LU low at 1 kHz and up to 0.49 LU low at 1.5 kHz (#426). The two stages are now the standard's analog prototypes transformed at the running sample rate, which gives the coefficients the standard prints at 48 kHz.
- **The fifth stream value is a true peak.** It was the highest sample (#427). It is now the maximum of the samples and of the 4× interpolated signal, using the 48-tap, 4-phase FIR of BS.1770 Annex 2 with the coefficients from the document. This costs 96 multiply-adds per stereo sample, only while the loudness address has subscribers, as before.

Block structure (100 ms, non-overlapping), gating, loudness range, the stream layout and the Level card are unchanged. #428 (no reset) and #429 (the first packet after subscribing) are not addressed here.

## Verification

- `test/loudness-meter.test.ts` feeds the EBU Tech 3341 minimum-requirements signals (loudness cases 1–5, true-peak cases 15–18), the EBU Tech 3342 loudness-range cases 1–4 and a fifteen-tone sweep against the BS.1770 response to the meter at 48 kHz and 44.1 kHz, one render quantum at a time with silence around each signal: 29 of 57 checks fail on `main`, none with this change. Case 17 (fs/6 at 60°) reads −6.31 dBTP against a −0.4 limit, the Annex 2 filter's own under-read at fs/6.
- The same signals through the live engine, with a tap on the output confirming each tone arrived at its level: on the release, 12 of 28 rows fail in Chrome 154, Firefox 157 and Safari 18.6; with this change all 28 pass in each, at both rates. Rows and method: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-02-loudness-meter/note.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
