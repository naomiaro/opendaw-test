# Shared-source double-process at adjacent same-track regions

**Verified against:** OpenDAW SDK 0.0.147 (`@opendaw/studio-sdk@0.0.147`, `@opendaw/studio-core@0.0.145`).

**Repro page:** _TBD — pending example._ Audio fixture: [`public/audio/test-440hz.wav`](../public/audio/test-440hz.wav) (60 s, 440 Hz sine, mono, 44.1 kHz, 16-bit).

## Symptom

Two `AudioRegionBoxAdapter`s on the same track that **reference the same `AudioFileBox`** and have **touching or overlapping positions** produce an audible artifact at the seam. On a sustained 440 Hz sine the artifact sounds like a brief amplitude jump (with crossfade extensions: a smooth dip down to roughly 65 % through the overlap; without extensions, just touching: a single-block snap of ~130 % inverted amplitude). The shape of the artifact depends on the timeline block size and the signal's fundamental frequency.

The artifact does **not** depend on the relative `waveformOffset` of the two regions — it appears regardless of whether the source positions at the seam coincide (`x_end_source == y_start_source`) or differ. It does **not** appear when the two regions reference **different** `AudioFileBox`es, even when those files contain identical audio content.

A simple way to demonstrate the difference is to render the project offline and scan the seam-spanning block:

- **Same `AudioFileBox` reference, regions touching** → the block's output amplitude is ~`2·cos(π·f·bpn/SR)` times the input. For 440 Hz at 44.1 kHz with a 128-sample render quantum that's ~−1.3× — a single block of inverted-and-amplified waveform.
- **Different `AudioFileBox` references (same audio content), regions touching** → the block's output amplitude matches the input. No artifact.

## How to reproduce

_Pending demo page._ Minimal setup that reproduces the symptom in a fresh project:

```
BPM 120, sample rate 44.1 kHz, one Tape track.
One AudioFileBox referencing test-440hz.wav (60 s).
Two AudioRegionBoxes on the track, both referring to that one AudioFileBox:
  - Region A: position = 0, duration = PPQN(30 s),
              loopOffset = 0,  loopDuration = PPQN(60 s),
              fading.in = 0,   fading.out = 0,
              waveformOffset = 0.
  - Region B: position = PPQN(30 s), duration = PPQN(30 s),
              loopOffset = PPQN(30 s), loopDuration = PPQN(60 s),
              fading.in = 0,   fading.out = 0,
              waveformOffset = 30 s.
```

Play. The seam at 30 s contains the artifact. Now duplicate the `AudioFileBox` (create a second one with a different `UUID` referring to the same on-disk file) and have Region B reference the second `AudioFileBox` instead. Same playback, same source positions — the artifact is gone.

Adding a `fading.out` to Region A and a `fading.in` to Region B (so the regions overlap in time) makes the artifact broader and lower-amplitude rather than eliminating it: the overlap region's output amplitude drops to ~65 % at the midpoint for 440 Hz with 40 ms of crossfade.

## Suspected mechanism

_Inferred from source-tracing; the offline-rendered amplitude pattern is empirical._

`TapeDeviceProcessor.#processAdapter` (`packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts`) keys voices in `lane.pitchVoices` by `sourceUuid` (= the AudioFileBox UUID). When two adapters in a block share that UUID, both call `voice.process(bp0, bpn, gainBuffer)` on the **same shared voice** (the second adapter's `#updateOrCreatePitchVoice` call lands in the `drift ≤ fadeLengthSamples` branch and returns without replacing the voice).

`PitchVoice.process` (`packages/studio/core-processors/src/devices/instruments/Tape/PitchVoice.ts`) advances `#readPosition` by `playbackRate` per loop iteration, i.e. by `bpn × playbackRate` per call. Two calls per block ⇒ `readPosition` advances `2 × bpn × playbackRate`. The first call writes `sample[N + i] × x_gain[i]` into the output buffer for `i ∈ [0, bpn)`; the second call writes `sample[N + bpn + i] × y_gain[i]` into the same output indices. The block's per-sample output becomes:

```
out[i] = sample[N + i]       × x_gain[i]
       + sample[N + bpn + i] × y_gain[i]
```

For touching regions without fades, `x_gain = y_gain = 1`, so `out[i] = sample[N + i] + sample[N + bpn + i]`. For a sinusoid that's `2·sin(ω(N + bpn/2)/SR)·cos(ω·bpn/(2·SR))`. With overlapping regions and linear clip fades, `x_gain + y_gain = 1` per the crossfade math, but the read-position advance still produces two phase-shifted samples summed at different weights → the output peaks at the timeline position where the weights are equal (mid-overlap on a sine, this is where the −3.7 dB dip lands for 440 Hz / 128-sample quantum).

## Open question

Is `voice.process` intended to advance read position only once per block regardless of how many adapters call it (i.e. the second adapter should sum into the already-computed output without re-reading source), or is `sourceUuid` keying intended to be one-region-per-source-per-lane (i.e. consumers should never produce two regions referring to the same `AudioFileBox` on one track, and the SDK should perhaps reject or merge such inputs)?

This case arises naturally in comp-track layouts where multiple lane tracks reference the same recorded buffer (loop-recorded takes share one `AudioFileBox`; comp clips taken from different lanes can land on the comp track with matching `waveformOffset`s). Avoiding the shared `sourceUuid` requires either duplicating the `AudioFileBox` or merging adjacent comp clips at the consumer layer.
