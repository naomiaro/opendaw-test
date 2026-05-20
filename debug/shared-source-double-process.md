# Sample-level discontinuity at touching region seams

**Verified against:** OpenDAW SDK 0.0.147 (`@opendaw/studio-sdk@0.0.147`, `@opendaw/studio-core@0.0.145`).

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

Live playback through the AudioContext *does* sound different across seam positions: a block-aligned seam produces a noticeably quieter snap than an off-boundary seam — sometimes close to inaudible on quiet material. The offline render does not reproduce this difference: it shows the same 0.05747 `max |Δ|` at the same `τ = −0.042 ms` offset for both seam positions.

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

Playback starts at 28 s so you reach the seam in ~2 s; a live playhead readout turns red when the seam passes. Click **Scan current scenario** to render `[seam ± 100 ms]` offline via `OfflineAudioContext` and report peak-amplitude and `max |Δsample|` metrics annotated with the current seam-in-block offset.

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
- Magnitude is approximately twice the maximum slope of a clean 440 Hz / 0.5-amplitude sine (`2π·f·A/SR`). The doubling is suspicious — it suggests an inversion of the 1-sample-ahead difference, or two equal contributions adding instead of cancelling.
- Live playback shows an audibility difference between block-aligned and off-boundary seams that the offline scan does not reproduce.

A satisfying mechanism would explain (1) why the jump appears 2 samples before the seam rather than at it, (2) why the magnitude is exactly ~2× the clean-sine slope, and (3) why the offline render is block-alignment-invariant while live playback is not. **Mechanism left as open question for the OpenDAW team.**

## Open questions

1. What produces the ~2× sample-to-sample first difference 2 samples before a touching region seam, given that voices are per-region and `bp0`/`bp1` math correctly partitions the block at the seam sample?
2. Why does the offline scan show identical `seam-band max |Δ|` for block-aligned vs off-boundary seams while live playback sounds audibly different? Is there a live-only signal path (output-device buffering, sample-rate conversion, peak-cache writes) that doesn't run through `OfflineAudioContext + AudioWorklets.createFor`?
3. Is the audible "snap is louder in the shared-`AudioFileBox` case than in the two-distinct-`AudioFileBox` case" perception (which the offline render does *not* reproduce — both cases render bit-identical) a live-only artifact, or a perceptual artifact from playback context differences (timing, buffering, AudioContext output device)?
