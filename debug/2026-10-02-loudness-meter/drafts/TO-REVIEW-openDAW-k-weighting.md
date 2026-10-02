# TO REVIEW — for https://github.com/andremichelle/openDAW/issues (new)

**Title:** The loudness meter's K-weighting reads 0.25 LU low at 1 kHz and up to 0.5 LU low between 1 and 3 kHz: EBU Tech 3341 loudness cases 1–5 fail

## Symptom

A stereo 1 kHz sine at −23.0 dBFS (EBU Tech 3341 case 1) reads −23.27 LUFS integrated and −23.25 momentary and short-term on the engine's loudness stream (`EngineAddresses.LOUDNESS`, the M / S / I of the studio's Level card), where the standard allows −23.0 ±0.1. The other loudness cases read the same way: case 2 (−33.0) −33.27; cases 3, 4 and 5 (−23.0 after gating) −23.26, −23.26, −23.25.

Swept with a −20 dBFS tone, the error follows frequency: within 0.07 LU of the ITU-R BS.1770 K-weighted level at and below 500 Hz and at and above 5 kHz; 0.26 LU low at 1 kHz, 0.49 at 1.5 kHz, 0.41 at 2 kHz, 0.17 at 3 kHz.

Measured on `@opendaw/studio-sdk@0.0.173` at 48 kHz and 44.1 kHz in Chrome 154, Firefox 157 and Safari 18.6 (macOS), the same figures in each. The loudness range cases of EBU Tech 3342 (1–4) read 10.00, 5.00, 20.00 and 15.00 LU exactly, so the gating is not involved: this is the pre-filter.

## Repro

- Live page: https://opendaw-test.pages.dev/loudness-meter-audit-debug-demo.html?case=loudness (about five minutes, silent; keep the tab visible) plays the five EBU tones through a Tape track at unity gain, confirms at a tap on the engine's output that each tone arrived at its level, and judges the stream's readings. `?case=weighting` (two minutes) is the sweep.
- Unit level, at the `@opendaw/studio-sdk@0.0.173` tag: `new LoudnessMeter(48000)` (`packages/studio/core-wasm/src/analysis-dsp.ts`), fed a 1 kHz stereo sine of peak 10^(−23/20) on both channels for 20 s in 128-frame blocks, then `fill(out)`: `out[0..2]` read −23.25.

Write-up with the full register (28 rows at two rates, three browsers): https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-02-loudness-meter/note.md

## Cause

`LoudnessMeter`'s constructor (`analysis-dsp.ts:93-94`) builds the two pre-filter stages with lib-dsp's general filters, handing them BS.1770's prototype parameters:

```ts
this.#shelfCoeff.setHighShelfParams(1681.974450955533 / sampleRate, 3.999843853973347)
this.#hpCoeff.setHighpassParams(38.13547087602444 / sampleRate, 0.5003270373238773)
```

Those parameters (1681.97 Hz, +3.9998 dB; 38.135 Hz, Q 0.50033) describe the standard's stages in the formulation that yields its printed 48 kHz coefficients (`b0 1.53512485958697 …` in Table 1), where the shelf's lower gain is `Vb = Vh^0.4997`. lib-dsp's `setHighShelfParams` is the RBJ high shelf with slope 1 and `setHighpassParams` is an RBJ high-pass with a unity passband. Given the same centre frequency and gain, the RBJ shelf has a different transition: its response sits 0.26 dB under the standard's at 1 kHz and 0.49 dB under at 1.5 kHz, and the normalized high-pass leaves out the +0.04 dB passband gain the standard's un-normalized numerator (1, −2, 1) carries. The measured error profile above is that difference.

Verified: a local build whose two stages are the standard's own (the same prototypes transformed at the running rate, which gives the printed coefficients at 48 kHz) reads −22.97 on case 1 and passes all 28 rows of the page, in all three browsers, at both rates.

## Related

#203 (Analyser Device) lists loudness measurement for the planned device.
