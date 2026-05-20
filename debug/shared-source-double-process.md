# Sample-level discontinuity at non-block-aligned region seams

**Verified against:** OpenDAW SDK 0.0.147 (`@opendaw/studio-sdk@0.0.147`, `@opendaw/studio-core@0.0.145`).

**Repro page:** [`shared-source-double-process-debug-demo.html`](../shared-source-double-process-debug-demo.html) (unlisted; filename preserved for now but the artifact is NOT shared-source-specific — see "Mechanism" below). Audio fixture: [`public/audio/test-440hz.wav`](../public/audio/test-440hz.wav) (60 s, 440 Hz sine, mono, 44.1 kHz, 16-bit).

## Symptom

Two adjacent `AudioRegionBoxAdapter`s on the same track that touch at an exact PPQN boundary (`region A.end == region B.start`) produce an audible sample-level discontinuity at the seam **when the seam time falls strictly inside an audio block** (i.e. `(seamSeconds × sampleRate) mod RenderQuantum ≠ 0`). When the seam falls *on* a block boundary, the artifact is silent. The artifact's magnitude tracks where the seam lands inside the block; at the midpoint of a block, the discontinuity is most audible.

Offline render measurements (440 Hz / 0.5-amplitude sine, mono, 48 kHz, BPM 120, seam at 30.5 s = sample 1,464,000 = mid of block 11,437 + 64 samples):

```
                            SHARED (1 AudioFileBox)   DISTINCT (2 AudioFileBoxes)
pre-seam peak amplitude     0.5000                    0.5000
seam-band peak amplitude    0.4999                    0.4999
expected clean max |Δ|      0.02880  (= 2π·440·0.5/SR for a 440 Hz, 0.5-amp sine)
pre-seam max |Δ|            0.02884                   0.02884
seam-band max |Δ|           0.05747                   0.05747       ← ~2× expected
seam-Δ / pre-Δ              1.99                       1.99
largest jump at             30.499958 s                30.499958 s   ← 2 samples before seam
```

The peak-amplitude metric is *unchanged* by the artifact; only the sample-to-sample first difference reveals it. The discontinuity is audible — listeners describe it as a brief snap — because the ear is sensitive to high-frequency content introduced by sample-level jumps.

**Both configurations produce identical output to floating-point precision.** The originally-suspected "two regions sharing an `AudioFileBox`" path is not the cause: configurations using one shared file (SHARED) vs two distinct files with the same audio content (DISTINCT) render bit-identical output and have the same artifact. Neither is a "workaround" for the other — both demonstrate the seam artifact identically.

## Block alignment dependency

The artifact only fires when the seam time falls strictly inside an audio block (`RenderQuantum = 128` samples on the audio worklet). Demo evidence:

- Seam at 30.0 s on a 48 kHz AudioContext: `30 × 48000 = 1,440,000 samples = 11,250 × 128` (block boundary). No measurable discontinuity (delta scan shows `pre-seam-Δ ≈ seam-band-Δ`); audibly silent.
- Seam at 30.5 s on a 48 kHz AudioContext: `30.5 × 48000 = 1,464,000 samples = 11,437 × 128 + 64` (sample 64 of block — exactly mid-block). 2× delta as above; audibly snaps.

Live playback at 48 kHz can be unpredictable about block alignment depending on when `engine.play()` lands relative to the AudioContext's block clock, so the same configuration can sound clean on one playback and snap on the next.

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/shared-source-double-process-debug-demo.html
```

**HTTPS required** (self-signed cert). The repro page sets up two `AudioRegionBox`es on one Tape track at touching PPQN positions over a 60 s 440 Hz sine, with seam at 30.5 s (deliberately mid-block at 48 kHz). Click **Play (BUG)** or **Play (WORKAROUND)** for live audition (playback starts at 28 s so you reach the seam in ~2 s; a live playhead readout turns red when the seam passes). Click **Scan current scenario** to render `[seam ± 100 ms]` offline via `OfflineAudioContext` and report peak-amplitude and `max |Δsample|` metrics.

Minimal box-graph setup:

```
BPM 120, sample rate 48 kHz (or 44.1 kHz), one Tape track.
One or two AudioFileBoxes (identical audio content, same or different UUIDs).
Two AudioRegionBoxes:
  - Region A: position = 0, duration = PPQN(30.5 s),
              loopOffset = 0, loopDuration = PPQN(60 s),
              fading.in = 0, fading.out = 0, waveformOffset = 0.
  - Region B: position = PPQN(30.5 s), duration = PPQN(29.5 s),
              loopOffset = PPQN(30.5 s), loopDuration = PPQN(60 s),
              fading.in = 0, fading.out = 0, waveformOffset = 30.5.
```

## Mechanism — **open**

The originally-drafted mechanism (a shared `PitchVoice` keyed by `sourceUuid` getting `process()` called twice per block, doubling `readPosition` advancement) does not match the source. `TapeDeviceProcessor.#processPassPitch` calls `this.#updateOrCreatePitchVoice(lane, sourceUuid, ...)` with `sourceUuid = region.uuid` (the AudioRegionBox UUID via `AudioRegionBoxAdapter.uuid → this.#box.address.uuid`), so voices are keyed per-region, not per-file. Two same-file regions get two independent voices.

Working through the `#processPassPitch` and `PitchVoice.process` math for the documented configuration:

- For seam at sample 1,464,000 (sample 64 of audio block 11,437), region A's `bp0 = 0`, `bp1 = 64`, `bpn = (64 - 0) | 0 = 64`. Region B's `bp0 = 64`, `bp1 = 128`, `bpn = 64`. Voice A writes `output[0..63]`, voice B writes `output[64..127]`. No overlap, no gap.
- Voice A's `readPosition` at block start (after 11,437 prior blocks) = `initial_offset + 11437 × 128`. With `initial_offset = 28 × 48000 = 1,344,000` (engine start at 28 s), readPos at block start = 1,463,936. After 64 iterations: 1,464,000 — exactly the seam sample. Voice A reads `source[1,463,936..1,463,999]`, writes to `output[0..63]` at unit gain.
- Voice B is created at block start with `offset = 30.5 × 48000 = 1,464,000`. Voice B reads `source[1,464,000..1,464,063]` with voice-fade-in amplitude `0 → 63/882 ≈ 0.071`, writes to `output[64..127]`.

Computed analytically, `|Δsample|` across this configuration should peak at the expected clean-sine maximum of `2π × 440 × 0.5 / 48000 ≈ 0.0288`. The empirical 0.057 result (~2× expected) and its location 2 samples before the seam do not match the analytic prediction, and re-reading `PitchVoice.process` and the adapter loop has not surfaced an obvious off-by-one. **Mechanism left as open question for the OpenDAW team.**

## Open questions

1. What produces the ~2× sample-to-sample first difference in the rendered output near a non-block-aligned region seam, given that voices are per-region and `bp0`/`bp1` math correctly partitions the block at the seam sample?
2. Is the block-aligned vs mid-block dependency intentional (e.g. an unstated invariant that consumers should snap region boundaries to render quantum), or a real artifact to fix? At 48 kHz with 128-sample quanta, only seams at multiples of `1/375 s` (≈ 2.67 ms) align to block boundaries — the vast majority of musically-meaningful seams will not align.
3. Is the audible "snap is louder in the shared-`AudioFileBox` case than in the two-distinct-`AudioFileBox` case" perception (which the offline render does *not* reproduce — both cases render bit-identical) a live-only artifact, or a perceptual artifact from playback context differences (timing, buffering, AudioContext output device)?
