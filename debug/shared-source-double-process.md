# Sample-level discontinuity at touching region seams

**Verified against:** OpenDAW SDK 0.0.158 (`@opendaw/studio-sdk@0.0.158`, `@opendaw/studio-core@0.0.156`); re-verified 2026-07-14 via the repro page's offline scan — seam-Δ/pre-Δ = 2.00 (max |Δ| 0.05745 at τ −0.042 ms), SHARED and DISTINCT cells identical, unchanged from 0.0.147. The addendum's suggested fixes are not in the 0.0.158 diff. First verified at SDK 0.0.147.

**Repro page:** [`shared-source-double-process-debug-demo.html`](../shared-source-double-process-debug-demo.html) (unlisted; filename preserved for history, but the artifact is NOT shared-source-specific and NOT block-alignment-specific — see "Mechanism" below). Audio fixture: [`public/audio/test-440hz.wav`](../public/audio/test-440hz.wav) (60 s, 440 Hz sine, mono, 44.1 kHz, 16-bit).

## Symptom

Two adjacent `AudioRegionBoxAdapter`s on the same track that touch at an exact PPQN boundary (`region A.end == region B.start`) produce a sample-level discontinuity at the seam: `seam-band max |Δsample|` measured ~2× the clean-sine baseline (`2π·440·0.5/SR`). Peak amplitude is unchanged.

The repro page toggles **seam position** × **mediaId**. Both seam positions are chosen so `PPQN.secondsToPulses(seamSec, BPM 120)` returns an exact integer — required because `AudioRegionBox.position` is `Int32Field` (truncates non-integer PPQN) while `duration` is `Float32Field`; fractional PPQN values applied to both fields create a sub-PPQN overlap that `project.copy()` deletes (see [`project-copy-deletes-overlapping-regions.md`](./project-copy-deletes-overlapping-regions.md#sub-ppqn-overlap-from-int32-position-vs-float32-duration)).

- **Block-aligned** = 30.000 s = PPQN 57600. At an AudioContext of 48 kHz this is sample 1,440,000 = 11,250 × 128, exactly on a render-quantum block boundary.
- **Off-boundary** = 30.500 s = PPQN 58560. At 48 kHz this is sample 1,464,000 = 11,437 × 128 + 64, exactly 64 samples into a block.
- **SHARED** = both regions reference one `AudioFileBox`. **DISTINCT** = two `AudioFileBox`es with identical on-disk content.

Where the seam lands within a 128-sample render quantum at non-48 kHz contexts depends on the rate; the repro page displays the live offset.

Offline-render `seam-band max |Δ|` measured on a 48 kHz AudioContext (BPM 120, 440 Hz / 0.5-amplitude sine):

```
                            BLOCK-ALIGNED (30.000 s, PPQN 57600)   OFF-BOUNDARY (30.500 s, PPQN 58560)
                            SHARED        DISTINCT                 SHARED        DISTINCT
pre-seam peak               0.5000        0.5000                   0.5000        0.5000
voice-fade-window peak      0.4999        0.4999                   0.4999        0.4999
expected clean max |Δ|      0.02880       0.02880                  0.02880       0.02880
pre-seam max |Δ|            0.02884       0.02884                  0.02884       0.02884
seam-band max |Δ|           0.05747       0.05747                  0.05747       0.05747
seam-Δ / pre-Δ              1.99          1.99                     1.99          1.99
largest jump at             29.999958 s   29.999958 s              30.499958 s   30.499958 s
                                          (all four: τ = −0.042 ms = 2 samples before seam)
```

All four configurations produce bit-identical offline output to floating-point precision. The artifact is **independent of both mediaId and the seam's offset within the 128-sample render quantum**. The originally-suspected "two regions sharing an `AudioFileBox`" mechanism is not the cause; the block-alignment-dependence mechanism initially inferred from live listening is not the cause either.

## Live vs offline discrepancy

Live playback through the AudioContext *does* sound different across seam positions: a block-aligned seam produces a quieter snap than an off-boundary seam (listener-reported, in a normal listening environment with the repro page). The offline render does not reproduce this difference: it shows the same 0.05747 `max |Δ|` at the same `τ = −0.042 ms` offset for both seam positions.

We don't have an offline metric that captures the live audibility difference. Possible explanations:

- The live worklet runs through an output device whose buffering or anti-aliasing interacts differently with seams on vs near block boundaries; the OfflineAudioContext doesn't pipe through that path.
- Some live-only code (e.g. the live-stream receiver, peak-cache hooks, mute/unmute handlers) introduces a smoothing or zero-crossing-snap step at block boundaries that the offline renderer skips.
- Perceptual masking related to AudioContext output-device sample-rate conversion (if the device runs at 48 kHz internally, an offline-rendered 48 kHz block-aligned discontinuity at sample 1,440,000 may resample to a different live position).

The repro page has both seam positions side-by-side so live A/B is one click apart, and the offline scan numbers are reproducible.

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/shared-source-double-process-debug-demo.html
```

**HTTPS required** (self-signed cert). The page sets up two `AudioRegionBox`es on one Tape track at touching PPQN positions over a 60 s 440 Hz sine. Two toggles:

- **Seam position**: Block-aligned (30.000 s, PPQN 57600 at BPM 120) or Off-boundary (30.500 s, PPQN 58560). Both are exact integer PPQN to avoid the sub-PPQN-overlap deletion described above. The in-block sample offset at the live AudioContext rate is shown next to each button.
- **Scenario (mediaId)**: SHARED (one `AudioFileBox`) or DISTINCT (two `AudioFileBox`es with identical content).

Playback starts at 28 s so you reach the seam in ~2 s; a live playhead readout turns red when the seam passes. Click the **Scan step N** button inside the step that matches your current seam-position + scenario to render `[seam ± 100 ms]` offline via `OfflineAudioContext` and report peak-amplitude and `max |Δsample|` metrics annotated with the current seam-in-block offset.

Minimal box-graph setup:

```
BPM 120, AudioContext sample rate (typically 48 kHz), one Tape track.
One or two AudioFileBoxes (identical audio content, same or different UUIDs).
Two AudioRegionBoxes:
  - Region A: position = 0, duration = PPQN(seam),
              loopOffset = 0, loopDuration = PPQN(60 s),
              fading.in = 0, fading.out = 0, waveformOffset = 0.
  - Region B: position = PPQN(seam), duration = PPQN(60 s − seam),
              loopOffset = PPQN(seam), loopDuration = PPQN(60 s),
              fading.in = 0, fading.out = 0, waveformOffset = seam.
```

## Mechanism — **open**

Two mechanisms initially considered and ruled out:

- **Shared-voice double-process** (a single `PitchVoice` keyed by `sourceUuid` getting `process()` called twice per block, doubling `readPosition` advancement) does not match the source. `TapeDeviceProcessor.#processPassPitch` calls `this.#updateOrCreatePitchVoice(lane, sourceUuid, ...)` with `sourceUuid = region.uuid` (the AudioRegionBox UUID via `AudioRegionBoxAdapter.uuid → this.#box.address.uuid`), so voices are keyed per-region, not per-file. Two same-file regions get two independent voices. The SHARED/DISTINCT toggle in the repro confirms this empirically — bit-identical output.
- **Block-alignment-dependence** (artifact only fires when the seam falls strictly inside a block) was the hypothesis after live listening, but the seam-position toggle disproved it: both `BLOCK-ALIGNED` and `OFF-BOUNDARY` offline scans show `seam-band max |Δ| = 0.05747` (~2× the baseline), with the largest jump consistently at `τ = −0.042 ms` (2 samples before the seam). Offline render is invariant in seam-in-block offset.

What we do see consistently:

- The discontinuity lives at `seam − 2 samples`, i.e. inside region A's last 128 samples, not at the seam transition itself.
- Magnitude is approximately twice the maximum slope of a clean 440 Hz / 0.5-amplitude sine (`2π·f·A/SR`).
- Live playback shows an audibility difference between block-aligned and off-boundary seams that the offline scan does not reproduce.

**Mechanism left as open question for the OpenDAW team.**

## Open questions

1. What produces the ~2× sample-to-sample first difference 2 samples before a touching region seam, given that voices are per-region and `bp0`/`bp1` math correctly partitions the block at the seam sample?
2. Why does the offline scan show identical `seam-band max |Δ|` for block-aligned vs off-boundary seams while live playback sounds audibly different? Is there a live-only signal path (output-device buffering, sample-rate conversion, peak-cache writes) that doesn't run through `OfflineAudioContext + AudioWorklets.createFor`?
3. Is the audible "snap is louder in the shared-`AudioFileBox` case than in the two-distinct-`AudioFileBox` case" perception (which the offline render does *not* reproduce — both cases render bit-identical) a live-only artifact, or a perceptual artifact from playback context differences (timing, buffering, AudioContext output device)?

---

## Addendum 2026-06-11 — mechanism CLOSED (core 0.0.152 / SDK 0.0.154)

**Simulation artefacts** (script at [`debug/seam-sim.js`](./seam-sim.js)): exact-arithmetic reimplementation of the `TapeDeviceProcessor`/`PitchVoice` pitch path against the 440 Hz sine fixture. The simulation matches the engine's offline render to 4 decimal places on every probe point, including two exact-zero samples, confirming the mechanism below is complete.

### Three stacked effects

**(1) The −2-sample 2× slope jump — truncation in the block partition.**

`bpn = (bp1 − bp0) | 0` (integer truncation) and `voice.process(bp0 | 0, bpn, …)` together truncate the fractional block partition that arises because `BlockRenderer` accumulates `p0` in non-exact `+5.12 PPQN` steps (128 samples at 48 kHz, BPM 120 = exactly 5.12 PPQN, not a round number). The outgoing region's voice therefore writes **one sample short**: its last rendered sample lands at `seam − 2`, leaving `seam − 1` zero-forced in the output buffer. The incoming voice's first sample carries fade-in amplitude exactly 0 (its `blockOffset = 0` and `readPosition = loopOffset` so the constructor enters `Fading/fadeDirection=+1`, and `fadeProgress/fadeLength = 0/960 = 0`). A second exactly-zero sample lands at `seam + 63` for the same reason on the next quantum boundary.

**(2) Offline bit-identicality across the 2 × 2 matrix — a render-harness geometry artefact.**

The scan geometry (`shared-source-double-process-debug-demo.tsx:345`) passes `startSeconds = seamSeconds − 0.1` to `renderOfflineSlice`, starting transport exactly 0.1 s = 4800 samples = 37.5 quanta before the seam. Both seam positions (block-aligned = seam at 30.000 s; off-boundary = seam at 30.500 s) therefore land exactly 0.5 quanta = 64 samples into the offline-rendered slice, regardless of the page's seam-position toggle. The offline render never exercises the block-aligned geometry (seam at quantum 0). The note's earlier inference that "the artifact is independent of seam-in-block offset" holds only within the range of offsets the harness actually tests; it does not generalise to all offsets. This is a **harness artefact**, not an engine invariant.

**(3) Live audibility gap — geometry-dependent composite.**

At **offset 0** (seam falls on a block boundary), the outgoing voice's next-block eviction fade is exactly complementary to the incoming 20 ms fade-in (sum = 1 over the fade window). The audible artefact reduces to the single dropped sample at `seam − 1` — a faint tick (−0.004 dB dip in a 2.5 ms envelope window).

At **offset 64** (seam falls 64 samples into a block, the live geometry for the 30.500 s case), the incoming voice alone covers the quantum remainder at ≤ 6.7% gain (1.33 ms near-silent hole at seam), then the outgoing voice returns one quantum later, 65 samples late in phase (65 × 440 / 48000 × 360° = 214.5° at 440 Hz), producing a 20 ms destructive crossfade that dips to −9.7 dB at seam + 11.25 ms with a mid-fade polarity inversion.

**Empirical probe values** (engine vs simulation, 48 kHz, BPM 120, 440 Hz / 0.5-amplitude sine):

| Sample position | Engine | Sim |
|---|---|---|
| `out[seam − 1]` | 0 (exact) | 0 (exact) |
| `out[seam]` | 0.0000300081 | 0.000030 |
| `out[seam + 63]` | 0 (exact) | 0 (exact) |
| `out[seam + 64]` | −0.04603 | −0.04605 |
| `out[seam + 960]` | −0.44350 | −0.44357 |
| envelope min | 0.16398 (−9.68 dB) at +11.25 ms | 0.1640 / −9.7 dB / +11.25 ms |
| `max |Δsample|` | 0.05746985 at τ − 2 | 0.05747 at τ − 2 |

### Metric / method note

`max |Δsample|` is blind to the near-silent hole and to the envelope collapse (both are ramped transitions, not sharp steps). A sliding-envelope metric (implemented in `seam-sim.js` `minEnvelope()`) captures the −9.68 dB collapse. The offline harness must also start transport at the live play position (e.g. 28.0 s) to exercise the correct seam-in-block geometry, not at `seam − 0.1 s`.

### Suggested SDK fixes

- **Evict ended-region voices at their cycle end within the same block** (pass `bp1` as `fadeOutBlockOffset` to `startFadeOut` inside `#processPassPitch`) instead of deferring to `removeByPredicate` on the next block. This prevents the outgoing voice from returning 65 samples late in the off-boundary case.
- **Round rather than truncate the block partition** (`bpn = Math.round(bp1 − bp0)` instead of `(bp1 − bp0) | 0`), or carry the residual forward, to prevent the one-sample short-write that forces `seam − 1` to zero.
