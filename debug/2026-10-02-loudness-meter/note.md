# The SDK's loudness meter against the EBU test signals

Verified against: `@opendaw/studio-sdk` 0.0.173, in Chrome 154, Firefox 157 and Safari 18.6 on macOS.
Harness: [`loudness-meter-audit-debug-demo.html`](../../loudness-meter-audit-debug-demo.html);
Firefox and Safari are driven by `scripts/audit/loudness/`.
Filed upstream (2026-10-02): [openDAW#426](https://github.com/andremichelle/openDAW/issues/426)
(weighting), [#427](https://github.com/andremichelle/openDAW/issues/427) (true peak),
[#428](https://github.com/andremichelle/openDAW/issues/428) (no reset),
[#429](https://github.com/andremichelle/openDAW/issues/429) (first packet after subscribing);
the build below is [PR #430](https://github.com/andremichelle/openDAW/pull/430). Bodies as filed:
[`drafts/`](./drafts/).

## Bring-up probe (2026-10-02)

Before the harness was built, a throwaway page checked the two things it rests on: that
restarting the engine worklet empties the meter, and that a tone on a Tape track reaches the
engine's output at its synthesized level with its highest sample unchanged. It played a 1 kHz tone at
−23 dBFS twice and an fs/4 tone at half scale and 45° once, each for five seconds on a
restarted worklet, at 48 kHz.

```
sample rate 48000
tone-1: first reading integrated -120.00
tone-1: delivered level L -23.001 R -23.001 dBFS
tone-1: delivered sample peak -23.001 dBFS
tone-1: delivered length 5.013 s
tone-1: SDK integrated -23.34 LUFS, SDK peak -23.00 dB
tone-1: readings 351, hidden false
tone-2: first reading integrated -120.00
tone-2: delivered level L -23.001 R -23.001 dBFS
tone-2: delivered sample peak -23.001 dBFS
tone-2: delivered length 5.013 s
tone-2: SDK integrated -23.34 LUFS, SDK peak -23.00 dB
tone-2: readings 357, hidden false
peak: first reading integrated -120.00
peak: delivered level L -6.022 R -6.022 dBFS
peak: delivered sample peak -9.032 dBFS
peak: delivered length 5.013 s
peak: SDK integrated -2.85 LUFS, SDK peak -9.03 dB
peak: readings 357, hidden false
peak: analytic sample peak -9.031 dBFS
```

- A restarted worklet reads integrated −120.00 before anything plays: yes, on all three runs,
  the second and third of which followed a run that had left the previous meter at −23.34.
- A −23 dBFS tone arrives at −23.00 dBFS on both channels: yes (−23.001).
- An fs/4 tone at 45° arrives with its sample peak unchanged (−9.03 dBFS): yes (−9.032
  delivered, −9.031 synthesized).

The delivered length reads 5.013 s for a 5.000 s tone because the tap places the start and
the end to one 1024-frame chunk each.

## What is measured

The engine worklet publishes `[momentary, shortTerm, integrated, loudnessRange, peak]` on
`EngineAddresses.LOUDNESS`, from a loudness meter on its main stereo output. Read in the
source, not measured here: the meter runs only while that address has a subscriber, and it
has no reset. The harness plays tones whose
loudness is known through a Tape track at unity gain and judges what the meter reads:

- EBU Tech 3341 (2023), Table 1, cases 1–5 (loudness) and 15–18 (true peak).
- EBU Tech 3342 (2023), Table 1, cases 1–4 (loudness range).
- A sweep of fifteen tones against the ITU-R BS.1770 K-weighting response. This group and its
  ±0.1 LU tolerance are the harness's own, not an EBU case.

Not measured, and why:

- Tech 3341 case 6 is 5.0 surround; the meter takes a stereo signal.
- Tech 3341 cases 7–8 and Tech 3342 cases 5–6 need the EBU's authentic programme files.
- Tech 3341 cases 9–14 (momentary and short-term dynamics), 19 (a tone above full scale) and
  20–23 (signals synthesized at four times the rate and downsampled) can be synthesized and
  are left for a later version. Adding one is a new row in `src/lib/audit/loudnessCases.ts`.

A tap on the engine's output confirms each tone arrived at its synthesized level before the
meter is judged. Both EBU documents require the meter to be reset before each measurement,
so each case runs on a restarted worklet, which the probe above showed starts empty.

A row is `invalid`, and the meter is not judged, when the tone was not delivered as
synthesized, when the meter was not empty at the start, when readings were missing for more
than half a second during the signal, when the tap's timing of the signal does not match its
length, or when the tab was hidden.

## How to run

`loudness-meter-audit-debug-demo.html?case=all` (add `&rate=44100` for the second rate). Click
Run, keep the tab visible. About twelve minutes, silent unless `&audible=1`. The summary lands
in `.verify-output/loudness-audit-<timestamp>.json`. In Firefox and Safari:
`node scripts/audit/loudness/drive-firefox.ts <url> 1100` and `drive-safari.ts` (see the README
there); the page is the same, only the click is delivered differently.

## Register

In every row of both runs the tap found the tone within 0.003 dB of its synthesized level, and
in the peak cases within 0.001 dB of its synthesized sample peak. Both runs: 28 rows, 16 pass,
12 fail, none invalid, none in error.

### SDK 0.0.173, 48 kHz, 2026-10-02, Chrome 154 on macOS

| Row | Verdict | Meter (error) | 5 s after the end |
|---|---|---|---|
| `3341-1` | fail | integrated −23.27 (−0.27), maxMomentary −23.25 (−0.25), maxShortTerm −23.25 (−0.25) | I −23.27, LRA 4.20, peak −23.00 |
| `3341-2` | fail | integrated −33.27 (−0.27), maxMomentary −33.25 (−0.25), maxShortTerm −33.25 (−0.25) | I −33.27, LRA 4.20, peak −33.00 |
| `3341-3` | fail | integrated −23.26 (−0.26) | I −23.26, LRA 13.00, peak −23.00 |
| `3341-4` | fail | integrated −23.26 (−0.26) | I −23.26, LRA 13.00, peak −23.00 |
| `3341-5` | fail | integrated −23.25 (−0.25) | I −23.25, LRA 6.00, peak −20.00 |
| `3342-1` | pass | range 10.00 (+0.00) | I −22.85, LRA 10.00, peak −20.00 |
| `3342-2` | pass | range 5.00 (+0.00) | I −17.08, LRA 5.00, peak −15.00 |
| `3342-3` | pass | range 20.00 (+0.00) | I −20.27, LRA 20.00, peak −20.00 |
| `3342-4` | pass | range 15.00 (+0.00) | I −24.76, LRA 15.00, peak −20.00 |
| `3341-15` | pass | peak −6.02 (−0.02) | I −2.85, LRA 9.40, peak −6.02 |
| `3341-16` | fail | peak −9.03 (−3.03) | I −2.85, LRA 8.50, peak −9.03 |
| `3341-17` | fail | peak −7.27 (−1.27) | I −2.85, LRA 9.30, peak −7.27 |
| `3341-18` | fail | peak −6.71 (−0.71) | I −2.85, LRA 9.30, peak −6.71 |
| `kweight-25` | pass | shortTerm −31.13 (−0.04) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-40` | pass | shortTerm −26.30 (−0.04) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-60` | pass | shortTerm −23.63 (−0.04) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-100` | pass | shortTerm −21.87 (−0.04) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-250` | pass | shortTerm −20.89 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-500` | pass | shortTerm −20.71 (−0.06) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-1000` | fail | shortTerm −20.25 (−0.26) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-1500` | fail | shortTerm −19.14 (−0.49) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-2000` | fail | shortTerm −18.03 (−0.41) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-3000` | fail | shortTerm −17.05 (−0.17) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-5000` | pass | shortTerm −16.74 (−0.06) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-8000` | pass | shortTerm −16.70 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-12000` | pass | shortTerm −16.69 (−0.04) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-16000` | pass | shortTerm −16.69 (−0.04) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-20000` | pass | shortTerm −16.69 (−0.04) | I −18.58, LRA 9.70, peak −20.00 |

### SDK 0.0.173, 44.1 kHz, 2026-10-02, Chrome 154 on macOS

| Row | Verdict | Meter (error) | 5 s after the end |
|---|---|---|---|
| `3341-1` | fail | integrated −23.27 (−0.27), maxMomentary −23.25 (−0.25), maxShortTerm −23.25 (−0.25) | I −23.27, LRA 4.20, peak −23.00 |
| `3341-2` | fail | integrated −33.27 (−0.27), maxMomentary −33.25 (−0.25), maxShortTerm −33.25 (−0.25) | I −33.27, LRA 4.20, peak −33.00 |
| `3341-3` | fail | integrated −23.26 (−0.26) | I −23.26, LRA 13.00, peak −23.00 |
| `3341-4` | fail | integrated −23.26 (−0.26) | I −23.26, LRA 13.00, peak −23.00 |
| `3341-5` | fail | integrated −23.25 (−0.25) | I −23.25, LRA 6.00, peak −20.00 |
| `3342-1` | pass | range 10.00 (+0.00) | I −22.85, LRA 10.00, peak −20.00 |
| `3342-2` | pass | range 5.00 (+0.00) | I −17.08, LRA 5.00, peak −15.00 |
| `3342-3` | pass | range 20.00 (+0.00) | I −20.27, LRA 20.00, peak −20.00 |
| `3342-4` | pass | range 15.00 (+0.00) | I −24.75, LRA 15.00, peak −20.00 |
| `3341-15` | pass | peak −6.02 (−0.02) | I −2.85, LRA 9.30, peak −6.02 |
| `3341-16` | fail | peak −9.03 (−3.03) | I −2.85, LRA 9.30, peak −9.03 |
| `3341-17` | fail | peak −7.27 (−1.27) | I −2.85, LRA 9.30, peak −7.27 |
| `3341-18` | fail | peak −6.71 (−0.71) | I −2.85, LRA 9.20, peak −6.71 |
| `kweight-25` | pass | shortTerm −31.13 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-40` | pass | shortTerm −26.30 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-60` | pass | shortTerm −23.63 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-100` | pass | shortTerm −21.87 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-250` | pass | shortTerm −20.89 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-500` | pass | shortTerm −20.71 (−0.07) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-1000` | fail | shortTerm −20.25 (−0.26) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-1500` | fail | shortTerm −19.14 (−0.49) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-2000` | fail | shortTerm −18.03 (−0.42) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-3000` | fail | shortTerm −17.05 (−0.17) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-5000` | pass | shortTerm −16.74 (−0.06) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-8000` | pass | shortTerm −16.70 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-12000` | pass | shortTerm −16.69 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-16000` | pass | shortTerm −16.69 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |
| `kweight-20000` | pass | shortTerm −16.69 (−0.05) | I −18.58, LRA 9.70, peak −20.00 |

### Firefox 157 and Safari 18.6, 48 kHz, 2026-10-02

The same 28 rows as Chrome at 48 kHz, every verdict and every reading to the two decimals
shown (`loudness-audit-1790979375072.json`, `loudness-audit-1790980068328.json`).

## Observed

- Tones at 1 kHz read 0.25 to 0.27 LU below their level in every loudness case, at both rates:
  integrated −23.25 to −23.27 for −23.0, and −33.27 for −33.0; maximum momentary and
  short-term 0.25 LU low in cases 1 and 2.
- The range cases read 10.00, 5.00, 20.00 and 15.00 LU, the expected values exactly.
- The fifth value equals the delivered sample peak in cases 15–18: it reads −6.02, −9.03,
  −7.27 and −6.71 dB, and the tap measured the tones' highest samples at those values. Each
  tone is synthesized at half scale, so its true peak is −6.02 dBTP by construction.
- The sweep is within tolerance at and below 500 Hz and at and above 5 kHz (0.04 to 0.07 LU
  low), and low by 0.17 to 0.49 LU from 1 kHz to 3 kHz, most at 1.5 kHz.
- Five seconds after the signal ends, integrated reads the same as at the end in all five
  loudness cases, and range reads the same as at the end in all four range cases.
- Range reads 4.20 LU five seconds after a steady 20 s tone (cases 1 and 2). The register
  shows range at the end of the signal only where it is judged, in the range cases, so these
  rows do not show whether the 4.20 arose during the tone or after it.
- In each full run, 7 of the 14 cases began with one loudness packet whose five values were
  all zero, before the first packet from the meter (which reads −120 when empty).

## The first packet after subscribing

The first full run marked 20 of 28 rows invalid with "the meter was not empty at the start
(integrated 0.00)", while every judged reading in those rows was the same as in the runs
registered above. The harness was reading an all-zero packet as the meter's first reading. It
now skips an all-zero packet that arrives before the first reading and logs how many it
skipped; with that, no row is invalid. An all-zero packet later in a capture is kept and
judged.

Inferred from `lib-fusion` `LiveStreamBroadcaster.broadcastFloats` and the engine processor,
not observed directly: the broadcaster writes the array on every flush after calling the
processor's callback with whether the address has subscribers, and the processor fills the
array from the meter only when it has. A flush that still sees no subscriber sends the array
as it stands, which on a new worklet is zeros.

## A build with the standard's filters

To tell the meter's error from the harness's, and to turn two source readings into verified
causes, a local build of the release was made with two changes to
`packages/studio/core-wasm/src/analysis-dsp.ts` and nothing else:

- the pre-filter's two stages are ITU-R BS.1770's own (its analog prototypes transformed at the
  running rate, which gives the standard's printed coefficients at 48 kHz) in place of lib-dsp's
  general high-shelf and high-pass;
- the fifth value is the maximum of the 4× interpolated signal (the 48-tap, 4-phase filter of
  BS.1770 Annex 2, coefficients copied from the document) and the samples, in place of the
  highest sample.

The build is commit `ca95e0e` on branch `fix/loudness-meter-bs1770` of the local openDAW
checkout, on top of the `@opendaw/studio-sdk@0.0.173` tag (rebased onto `main` as
[PR #430](https://github.com/andremichelle/openDAW/pull/430)), with a vitest file that feeds the
EBU signals to `LoudnessMeter` directly (57 checks at 48 kHz and 44.1 kHz: 29 fail before the
change, 0 after). Only the worklet bundle was rebuilt; it was served through
`SDK_DIST_OVERRIDE` in a copy of the 0.0.173 release.

Results, same page, same procedure, 2026-10-02:

| Browser | Rate | Rows |
|---|---|---|
| Chrome 154 | 48 kHz | 28 pass (`loudness-audit-1790976413371.json`) |
| Firefox 157 | 48 kHz | 28 pass, identical rows (`…1790977142399.json`) |
| Safari 18.6 | 48 kHz | 28 pass, identical rows (`…1790977921579.json`) |
| Firefox 157 | 44.1 kHz | 28 pass; three sweep rows 0.01 apart from 48 kHz (`…1790978642630.json`) |

### Local build `ca95e0e` (the 0.0.173 release with the two changes), 48 kHz, 2026-10-02, Chrome 154 — identical rows in Firefox 157 and Safari 18.6

| Row | Verdict | Meter (error) | 5 s after the end |
|---|---|---|---|
| `3341-1` | pass | integrated −22.97 (+0.03), maxMomentary −22.99 (+0.01), maxShortTerm −22.99 (+0.01) | I −22.97, LRA 4.30, peak −22.99 |
| `3341-2` | pass | integrated −32.97 (+0.03), maxMomentary −32.99 (+0.01), maxShortTerm −32.99 (+0.01) | I −32.97, LRA 4.10, peak −32.99 |
| `3341-3` | pass | integrated −22.96 (+0.04) | I −22.96, LRA 13.00, peak −22.99 |
| `3341-4` | pass | integrated −22.96 (+0.04) | I −22.96, LRA 13.00, peak −22.99 |
| `3341-5` | pass | integrated −22.95 (+0.05) | I −22.95, LRA 6.00, peak −19.99 |
| `3342-1` | pass | range 10.00 (+0.00) | I −22.55, LRA 10.00, peak −19.99 |
| `3342-2` | pass | range 5.00 (+0.00) | I −16.78, LRA 5.00, peak −14.99 |
| `3342-3` | pass | range 20.00 (+0.00) | I −19.97, LRA 20.00, peak −19.99 |
| `3342-4` | pass | range 15.00 (+0.00) | I −24.45, LRA 15.00, peak −19.99 |
| `3341-15` | pass | peak −6.02 (−0.02) | I −2.75, LRA 9.30, peak −6.02 |
| `3341-16` | pass | peak −5.98 (+0.02) | I −2.75, LRA 9.20, peak −5.98 |
| `3341-17` | pass | peak −6.31 (−0.31) | I −2.75, LRA 9.20, peak −6.31 |
| `3341-18` | pass | peak −6.03 (−0.03) | I −2.75, LRA 9.40, peak −6.03 |
| `kweight-25` | pass | shortTerm −31.08 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-40` | pass | shortTerm −26.26 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-60` | pass | shortTerm −23.59 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-100` | pass | shortTerm −21.83 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-250` | pass | shortTerm −20.84 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-500` | pass | shortTerm −20.65 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-1000` | pass | shortTerm −19.99 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-1500` | pass | shortTerm −18.66 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-2000` | pass | shortTerm −17.62 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-3000` | pass | shortTerm −16.88 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-5000` | pass | shortTerm −16.68 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-8000` | pass | shortTerm −16.65 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-12000` | pass | shortTerm −16.65 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-16000` | pass | shortTerm −16.65 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |
| `kweight-20000` | pass | shortTerm −16.65 (−0.00) | I −18.46, LRA 9.60, peak −19.81 |

Observed on this build:

- The loudness cases read +0.03 to +0.05 LU: −22.97 for case 1, −22.95 for case 5. The sweep
  reads its expected value to the second decimal at every frequency.
- The true-peak cases read −6.02, −5.98, −6.31 and −6.03 dBTP. Case 17 (fs/6 at 60°) is the
  closest to the −0.4 limit: that is the standard's own filter's under-read at fs/6.
- Range, and the delivered-signal checks (worst 0.004 dB), are as before.

## Cause of the weighting error, verified by the build above

`LoudnessMeter`'s constructor builds the pre-filter from lib-dsp's `setHighShelfParams` (an RBJ
high shelf with slope 1) and `setHighpassParams` (an RBJ high-pass, unity passband), passing them
BS.1770's prototype parameters. Those parameters describe the standard's stages in another
formulation (the shelf's lower gain is `Vh^0.4997`), so the RBJ shelf with the same centre and
gain has a different transition: 0.26 dB under the standard at 1 kHz, 0.49 dB at 1.5 kHz; and
the normalized high-pass leaves out the +0.04 dB the standard's numerator (1, −2, 1) carries.
That is the sweep's error profile above, and replacing the two stages removes it.

## Cause of the peak reading, observed

The fifth value equals the highest sample in every peak row (register above) and `process`
keeps `max(|l|, |r|)` per sample (`analysis-dsp.ts:108`); the comment above the class says
"4x oversampled" and the Level card labels the value dBTP. With the Annex 2 interpolator the same
rows read the true peak.

## Inferred from the source, not observed

- Blocks are 100 ms without overlap; BS.1770 gates 400 ms blocks at 75 % overlap. No row shows
  this: the loudness cases pass on the build above with the blocks unchanged.

## What differs from the Node measurements

Before the harness existed, the meter class was run in Node on the same signals. The package
does not export it, so it was imported from the installed dist file by path and bundled with
esbuild. The live rows agree with those numbers to two decimals, with one
difference: integrated reads −23.26 or −23.27 in cases 1 to 4 where Node read −23.25. In Node
the signal was fed with nothing before or after it; in the engine it sits between silences.
Whether that is the cause was not tested.
