# The SDK's loudness meter against the EBU test signals

Verified against: `@opendaw/studio-sdk` 0.0.173.
Harness: [`loudness-meter-audit-debug-demo.html`](../../loudness-meter-audit-debug-demo.html).

## Bring-up probe (2026-10-02)

Before the harness was built, a throwaway page checked the two things it rests on: that
restarting the engine worklet empties the meter, and that a tone on a Tape track reaches the
engine's output at its synthesized level, sample for sample. It played a 1 kHz tone at
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

The engine worklet runs a loudness meter on its main stereo output while something is
subscribed to `EngineAddresses.LOUDNESS`, and publishes
`[momentary, shortTerm, integrated, loudnessRange, peak]`. The harness plays tones whose
loudness is known through a Tape track at unity gain and judges what the meter reads:

- EBU Tech 3341 (2023), Table 1, cases 1–5 (loudness) and 15–18 (true peak).
- EBU Tech 3342 (2023), Table 1, cases 1–4 (loudness range).
- A sweep of fifteen tones against the ITU-R BS.1770 K-weighting response. This group and its
  ±0.1 LU tolerance are the harness's own, not an EBU case.

A tap on the engine's output confirms each tone arrived at its synthesized level before the
meter is judged. The meter has no reset, and both EBU documents require one before each
measurement, so each case runs on a restarted worklet.

## How to run

`loudness-meter-audit-debug-demo.html?case=all` (add `&rate=44100` for the second rate). Click
Run, keep the tab visible. About twelve minutes, silent unless `&audible=1`. The summary lands
in `.verify-output/loudness-audit-<timestamp>.json`.

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

## Observed

- Tones at 1 kHz read 0.25 to 0.27 LU below their level in every loudness case, at both rates:
  integrated −23.25 to −23.27 for −23.0, and −33.27 for −33.0; maximum momentary and
  short-term 0.25 LU low in cases 1 and 2.
- The range cases read 10.00, 5.00, 20.00 and 15.00 LU, the expected values exactly.
- The fifth value equals the delivered sample peak in cases 15–18: it reads −6.02, −9.03,
  −7.27 and −6.71 dB, and the tap measured the tones' highest samples at those values. Each
  tone's true peak is −6.02 dBTP.
- The sweep is within tolerance at and below 500 Hz and at and above 5 kHz (0.04 to 0.07 LU
  low), and low by 0.17 to 0.49 LU from 1 kHz to 3 kHz, most at 1.5 kHz.
- Five seconds after the signal ends, integrated reads the same as at the end in all five
  loudness cases, and range reads the same as at the end in all four range cases.
- Range reads 4.20 LU five seconds after a steady 20 s tone (cases 1 and 2). The harness
  takes range at the end of the signal only in the range cases, so these rows do not show
  whether the 4.20 arose during the tone or after it.
- In each full run, 7 of the 14 cases began with one loudness packet whose five values were
  all zero, before the first packet from the meter (which reads −120 when empty).

## The first packet after subscribing

The first full run marked 20 of 28 rows invalid with "the meter was not empty at the start
(integrated 0.00)", while every judged reading in those rows was the same as in the runs
registered above. The harness was reading an all-zero packet as the meter's first reading. It
now skips a packet whose five values are all zero and logs how many it skipped; with that, no
row is invalid.

Inferred from `lib-fusion` `LiveStreamBroadcaster.broadcastFloats` and the engine processor,
not observed directly: the broadcaster writes the array on every flush after calling the
processor's callback with whether the address has subscribers, and the processor fills the
array from the meter only when it has. A flush that still sees no subscriber sends the array
as it stands, which on a new worklet is zeros.

## Inferred from the source, not observed

Read in `studio-core-wasm/src/analysis-dsp.ts` at the version above. These are readings of the
code, and the rows above do not prove them:

- The K-weighting shelf is built with lib-dsp's general high-shelf, and the high-pass is
  normalized to unity; BS.1770's two stages differ from both.
- The fifth value is `max(|l|, |r|)` per sample; the comment above the class says 4x
  oversampled.
- Blocks are 100 ms without overlap; BS.1770 gates 400 ms blocks at 75 % overlap.

## What differs from the Node measurements

Before the harness existed, the meter class was run in Node on the same signals, imported
from the installed dist file. The live rows agree with those numbers to two decimals, with one
difference: integrated reads −23.26 or −23.27 in cases 1 to 4 where Node read −23.25. In Node
the signal was fed with nothing before or after it; in the engine it sits between silences.
Whether that is the cause was not tested.
