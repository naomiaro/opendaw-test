# Voice fade-in multiplies clip fade-in at crossfade entry

**Verified against:** OpenDAW SDK 0.0.147 (`@opendaw/studio-sdk@0.0.147`, `@opendaw/studio-core@0.0.145`).

**Repro pages:**
- [`voice-fadein-clip-fadein-product-debug-demo.html`](../voice-fadein-clip-fadein-product-debug-demo.html) (unlisted) — A/B between CROSSFADE (40 ms region fades) and HARD-CUT (no region fades, voice fade only) configurations on the same regions.
- [`pure-webaudio-target-debug-demo.html`](../pure-webaudio-target-debug-demo.html) (unlisted) — three-way A/B/C: pure-Web-Audio ALIGNED target (−0.00 dB through crossfade), pure-Web-Audio UNALIGNED control (−4.57 dB phase-mismatch dip), OpenDAW with phase-corrected `loopOffset` (−1.56 dB dip at τ ≈ −7.5 ms relative to seam). Comparing OpenDAW against the pure-JS ALIGNED case empirically confirms the mechanism — both use the same phase-corrected configuration, both run linear crossfade math, only OpenDAW shows the residual dip on the V2-fadeIn side.

Audio fixtures: [`public/audio/test-440hz.wav`](../public/audio/test-440hz.wav) and [`public/audio/test-440hz-offset30.wav`](../public/audio/test-440hz-offset30.wav) (the second file is the same 440 Hz sine delayed by 30 samples = ~0.68 ms = ~24° at 440 Hz).

## Symptom

Crossfading between two `AudioRegionBoxAdapter`s that reference **different `AudioFileBox`es** (different `sourceUuid`s, so the shared-source path in [shared-source-double-process.md](./shared-source-double-process.md) does **not** apply) produces an audible amplitude dip on the new voice's fade-in side. The dip is **not symmetric**: the second half of the crossfade (after the new voice's 20 ms voice-fade-in completes) sums to unity.

The dip survives perfect phase alignment of the two regions at the seam. It's not caused by phase mismatch in the source signals — confirmed in the target demo, where the pure-Web-Audio ALIGNED scenario (same phase-corrected configuration, no engine) measures `min/ref = 0.9998` (−0.00 dB) through the crossfade.

**Measured magnitude** (target demo, 40 ms linear crossfade, BPM 120, 48 kHz, sustained 440 Hz sine with 30-sample inter-file delay corrected by phase-correlate shift):

```
ALIGNED  (pure Web Audio):   min/ref = 0.9998  (-0.00 dB)
UNALIGNED (pure Web Audio):  min/ref = 0.5906  (-4.57 dB)   ← control: phase-mismatch dip
OPENDAW  (TapeDeviceProcessor): min/ref = 0.8352  (-1.56 dB)  ← residual dip at τ ≈ -7.5 ms
```

The OPENDAW dip is the artifact this note documents.

**Analytic prediction from the source-traced mechanism below** (voice-fade × clip-fade product on a 40 ms linear crossfade with 20 ms voice fade):

```
τ (relative to seam)     V1 gain (outgoing)    V2 gain (incoming)    sum
-20 ms                   1.000                  0.000                 1.000
-15 ms                   0.875                  0.047                 0.922   ← −0.71 dB
-10 ms                   0.750                  0.125                 0.875   ← −1.16 dB (predicted peak dip)
 -5 ms                   0.625                  0.281                 0.906   ← −0.86 dB
  0 ms                   0.500                  0.500                 1.000
 +5 ms                   0.375                  0.625                 1.000
+10 ms                   0.250                  0.750                 1.000
+15 ms                   0.125                  0.875                 1.000
+20 ms                   0.000                  1.000                 1.000
```

The measured peak dip in the target demo (−1.56 dB at τ ≈ −7.5 ms) is in the same range and on the same side as the predicted peak (−1.16 dB at τ = −10 ms). The remaining ~0.4 dB discrepancy and the shift in τ are not yet accounted for — possibilities include the V1 voice not being in `Active` state at the moment we expect, additional gain factors in the voice or capture path, or sample-rate-dependent fadeLength rounding. Reported empirically; mechanism partially confirmed.

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/voice-fadein-clip-fadein-product-debug-demo.html
```

**HTTPS is required** (same self-signed cert as the other demos). Click **Play (CROSSFADE)**; playback starts at 28 s and reaches the crossfade region at 30 s in ~2 s. Listen for a brief amplitude dip on the new voice's fade-in side of the seam. Then click **Play (HARD-CUT)** for the same regions with `fading.in = fading.out = 0` (regions touch, voice-fade alone handles the boundary).

**Note on the offline scan:** As of 2026-05-21, this demo's CROSSFADE configuration places each region on its own Tape track (mix happens at the master), matching the pattern used by the sibling [`pure-webaudio-target-debug-demo.html`](../pure-webaudio-target-debug-demo.html). Earlier versions placed both regions on a single track and were silently deleted by the per-track no-overlap validator (see [project-copy-deletes-overlapping-regions.md](./project-copy-deletes-overlapping-regions.md)); the scan now measures the dip directly. The numbers in the **Symptom** section are cross-checked against the target demo.

Minimal box-graph setup:

```
BPM 120, sample rate 44.1 kHz, two Tape tracks (one region each — mix at master).
Two AudioFileBoxes with distinct UUIDs:
  - File A: test-440hz.wav
  - File B: test-440hz-offset30.wav
One AudioRegionBox per file, each on its own track:
  - Region A: position = 0,
              duration = PPQN(30 s) + PPQN(20 ms),   // 20 ms extension into B
              loopOffset = 0, loopDuration = PPQN(60 s),
              fading.in = 0, fading.out = PPQN(40 ms),
              waveformOffset = 0.
  - Region B: position = PPQN(30 s) − PPQN(20 ms),    // 20 ms extension before A end
              duration = PPQN(30 s) + PPQN(20 ms),
              loopOffset = PPQN(30 s + 30 samples/SR − 20 ms),
              loopDuration = PPQN(60 s),
              fading.in = PPQN(40 ms), fading.out = 0,
              waveformOffset = loopOffset.
```

The `loopOffset` on Region B compensates for two things at once: (1) Region B starts 20 ms before the seam in the timeline (because of the half-crossfade extension), so it needs to read 20 ms earlier in source; (2) `test-440hz-offset30.wav` is the original sine delayed by 30 samples (`B[N] = A[N − 30]`), so to play the same musical moment as File A, Region B must read its source 30 samples *later*. Net: `loopOffset = seam + 30 samples/SR − 20 ms`.

Play and listen for a brief dip about 10 ms before the 30 s mark. The dip persists if you flip the slope from 0.5 (linear) to 0.25 or 0.75 — only the shape changes.

To confirm it's not a phase-alignment issue: import the same WAV (e.g. `test-440hz.wav`) into both `AudioFileBox`es. With identical audio in both regions and the same crossfade, the dip is still audible at the same timeline position. _(Note: copying the same on-disk file into two `AudioFileBox`es with different UUIDs is the way to dodge the shared-source double-process described in the sibling note. It's also how this dip stays visible without the other artifact contaminating the test.)_

## Suspected mechanism

_Inferred from source-tracing; the dip's timing and magnitude are empirical from offline render._

`PitchVoice`'s constructor (`packages/studio/core-processors/src/devices/instruments/Tape/PitchVoice.ts`) starts every new voice in `VoiceState.Fading` with `fadeDirection = 1` for `fadeLength` samples (`VOICE_FADE_DURATION × sampleRate` = 20 ms at 44.1 kHz). Inside `PitchVoice.process`, while in that state:

```ts
if (state === VoiceState.Fading && fadeDirection > 0) {
    amplitude = fadeProgress / fadeLength;
    if (++fadeProgress >= fadeLength) {
        state = VoiceState.Active;
    }
}
// …
const finalAmplitude = amplitude * fadingGainBuffer[i];
```

The voice-fade-in `amplitude` and the clip's `fadingGainBuffer[i]` are **multiplied**. For the new voice in a crossfade:

```
V2_effective(τ) = voice_fadeIn(τ) × clip_fadeIn(τ)
```

With a 40 ms linear `fading.in` (slope 0.5) and a 20 ms voice fade, both quantities are linear in `τ + 20 ms` over the voice-fade region `τ ∈ [−20 ms, 0]`. Their product is quadratic:

```
V2_effective(τ) = ((τ + 20 ms) / 20 ms) × ((τ + 20 ms) / 40 ms)
                = (τ + 20 ms)² / (20 ms × 40 ms)
                = (τ + 20 ms)² / 800 ms²
```

The outgoing voice is `VoiceState.Active`, so its effective gain is just `1 × clip_fadeOut(τ)` — linear. The crossfade math assumes both halves are linear so their sum is `1 + 0 = 1`; instead we get `(1 − (τ+20)/40) + ((τ+20)²/800)`, which has a minimum near `τ = −10 ms`:

```
V1(−10 ms) = 1 − 0.25 = 0.750
V2(−10 ms) = 0.5 × 0.5 = 0.250 × 0.5 = 0.125
sum        = 0.875
```

Past the voice-fade-in region (`τ ≥ 0`), V2's `amplitude` reaches 1.0, so the multiplication becomes a no-op and `V1 + V2 = 1.0` resumes.

## Open question

Is `PitchVoice`'s 20 ms voice-fade-in intended to apply when the consuming region carries its own non-zero `fading.in`? The voice fade is a click-prevention behaviour at voice creation; the clip fade is an authored crossfade. They are currently composed multiplicatively, which corrupts the authored fade shape over the first 20 ms.

Observable on any crossfade between regions whose `sourceUuid`s differ; most audible on sustained pure tones because complex material masks the small amplitude curve.
