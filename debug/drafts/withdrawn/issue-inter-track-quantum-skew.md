# Issue draft — simultaneously armed captures land one render quantum apart

**WITHDRAWN (Task 9, 2026-09-02) — do not file as an SDK defect.** On the reworked branch, each tape persists the SDK's own first-frame time next to the harness's loopback-derived buffer start, so each capture's loopback delay is known per row. In every successful multi-mic repeat (`recaudit-mt-summary-1788325557229.json`) the two tapes' residuals after netting their OWN loopback delay are identical (+1.15 ms both, to 0.01 ms) and the measured skew equals the difference of the two delays exactly (18.96 vs 21.63 ms → 2.667; 18.96 vs 20.96 → 2.000; 12.29 vs 9.62 → −2.667). The skew is the two loopback streams' delay difference, not the SDK's arithmetic; with both captures anchored on the same `recordingStarted` instant the SDK-side skew is zero. The same magnitudes on 0.0.170 are consistent with the same cause but cannot be decomposed there (no first-frame time). Kept for history; the text below is as it stood before withdrawal.

**Status (superseded): DRAFT for user review. Not filed.** Target: `andremichelle/openDAW`.

## Title

Two captures armed and recorded together place their takes up to one render quantum
apart

## Symptom

Two audio captures armed at the same time and recording the same instant do not place
their takes at the same timeline position. The offset between them is small but
systematic and audible as comb filtering when the two tracks carry correlated material,
which is exactly the multi-mic case this affects — a stereo pair, a DI plus an amp mic,
a drum kit.

## Cause

Each armed capture gets its own `RecordingWorklet` and places its take from that
worklet's own elapsed-capture measure paired with the transport position observed at
its own creation. Two independently-scheduled AudioWorklet callbacks land on different
render quanta, so even when each take's own placement math is internally correct, the
two disagree by whatever quantum-boundary difference separates their two callback
invocations. Nothing aligns the two captures to a common instant.

The measured values are consistent with that: the skew is not scatter around zero but
sits on exact multiples of one render quantum.

## Measured signature

Two tapes armed on two synthetic loopback devices both receiving clones of one injected
signal, so every shared bias cancels by subtraction. Skew is
`tape B's beat error − tape A's beat error`, paired by absolute beat index.

Of the **14** measurable median-skew values across four matrix runs (both builds, both
rates, 120 bpm, 3 repeats per cell):

| bucket | count |
|---|---|
| zero to float precision | 3 |
| within 0.02 ms of ±1 render quantum | 10 |
| a distinct constant outlier, −10.000001 ms | 1 |
| **exceeding the 2 ms measurement tolerance** | **11 of 14** |

One render quantum is 128 frames: `2.667 ms` at 48000 Hz and `2.902 ms` at 44100 Hz.
Every one of the 10 quantum-bucket values matches its rate's figure to within 0.02 ms.

Artifacts: `recaudit-mt-summary-1788302627819.json` (48000 Hz),
`…1788302870379.json` (44100 Hz), `…1788303391228.json` (48000 Hz),
`…1788303605274.json` (44100 Hz).

**A second, separate constant.** One repeat
(`recaudit-mt-summary-1788303605274.json`, `multitrack-start`, repeat 2, 44100 Hz)
measures `−10.000001450 ms` on **every one of its 16 paired beats**, agreeing to six
decimal places. This is as rock-steady as the render-quantum cases but at a different
value: 10.00 ms at 44100 Hz is exactly 441 samples, a clean decimal fraction of the
sample rate and *not* an integer multiple of the 128-frame quantum (`441 / 128 ≈ 3.45`).
It is recorded as its own observation rather than folded into the quantum clustering,
because nothing in the persisted data explains it.

## The take placement fix does not change this

The same magnitudes appear on a build carrying a separate fix that corrects each take's
placement against its own clock (submitted separately). That fix reduces each capture's
own placement bias by a large margin and leaves the inter-track skew untouched, which
is what its scope predicts: correcting each capture against its own anchor does not
align two captures to each other.

## Repro

The harness is an unlisted debug demo in a separate repository, served from a local
HTTPS dev server — **there is no public URL.**

```
recording-alignment-audit-debug-demo.html?scenario=multitrack-start&bpm=120&rate=<44100|48000>
```

`?scenario=multitrack-janked` runs the same cell with a 150 ms main-thread block after
the recording flip; it shows the same quantum-granular skew.

Note that repeats of this page are also affected by a separate, unrelated defect where
two simultaneous takes of byte-identical audio collide on a content-addressed uuid,
filed on its own. Roughly 4 in 10 repeats are lost to it, which is why the population
above is 14 values and not 24.

## Environment

`@opendaw/studio-sdk@0.0.170`, WASM engine, Chrome, macOS. Measured at 44100 and
48000 Hz, 120 bpm.

## Notes

Measured while auditing recording start-alignment. Full campaign register, with the
per-repeat data behind every figure above:
https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md
(section "Multi-mic simultaneous recording (Task 7b)", Finding 2)
