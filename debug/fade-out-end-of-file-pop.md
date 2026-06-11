# Fade-out pop when clip ends at audio file end

**Verified against:** OpenDAW SDK 0.0.140 (`@opendaw/studio-sdk@0.0.140`, `@opendaw/studio-core@0.0.136`).

**Repro page:** [`fade-out-end-of-file-debug-demo.html`](../fade-out-end-of-file-debug-demo.html) (unlisted).

## Symptom

A single-region clip whose `position + duration` equals the underlying audio file's full duration, with a fade-out ending at the region end, produces an audible click at the moment the fade-out should reach silence. The region's fading math is clean — `endProgress` reaches 1.0 and the fade gain buffer's last sample is 0 — yet the rendered output near the region end contains near-full-amplitude audio.

Sample-to-sample delta scan of the rendered buffer (Vocals30.mp3, 30.000978 s, 48 kHz, BPM 120, fade-out 0.7766 s, slope 0.5):

```
sample 1,439,104  (t = 29.9813 s)  step  -0.005 → -0.118   (|Δ| = 0.113)
sample 1,439,264  (t = 29.9847 s)  audio at -0.418
sample 1,439,360  (t = 29.9867 s)  audio at -0.260
... continues at near-full amplitude until sample 1,440,047 (region end)
```

The step lands at `numberOfFrames − VOICE_FADE_DURATION × sampleRate = 1,440,047 − 960 = 1,439,087`, a couple of samples earlier than the block boundary at which it becomes externally observable.

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/fade-out-end-of-file-debug-demo.html
```

**HTTPS is required.** The dev server uses the local `localhost.pem` / `localhost-key.pem` certificates and does not respond on plain `http://` (the browser shows `ERR_EMPTY_RESPONSE`). Accept the self-signed cert warning on first load.

1. Click **Play (BUG)**. Playback starts at `t = 20 s` and the pop is audible after ~10 s, at the end of the fade-out.
2. Click **Play (WORKAROUND)**. Same starting position, same fade. No click.

Audio: `public/audio/Vocals30.mp3`. Configuration: BPM 120, single Tape track, one `AudioRegionBox` at position 0 with the file's full PPQN duration, `fading.in = 0`, `fading.out` = 0.7766 s converted to PPQN, slope 0.5 (linear).

The workaround trims the region's duration by 21 ms (`VOICE_FADE_DURATION + 1 ms safety`), so playback ends before `PitchVoice`'s end-of-file threshold is crossed.

## Suspected mechanism

`PitchVoice` (`packages/studio/core-processors/src/devices/instruments/Tape/PitchVoice.ts`) holds an end-of-file fade-out: when `readPosition >= numberOfFrames − fadeLength × playbackRate`, it transitions to `VoiceState.Fading` with `fadeDirection = -1`. On the next call to `TapeDeviceProcessor.#updateOrCreatePitchVoice`, the existing voice's `isFadingOut()` returns true, so:

```ts
// TapeDeviceProcessor.ts (paraphrased)
} else if (existing.isFadingOut()) {
    lane.fadingVoices.push(existing);
    lane.pitchVoices.add(new PitchVoice(/* … */));
}
```

The old voice is pushed onto `lane.fadingVoices`. Later in the same block:

```ts
const sn = s1 - s0;
for (const voice of lane.fadingVoices) {
    voice.process(s0, sn, this.#unitGainBuffer);
}
```

`#unitGainBuffer` is filled with 1.0 — the region's fade gain (`#fadingGainBuffer`) is applied only to voices in `lane.pitchVoices`. Result: the old voice plays its remaining ~20 ms of file content at unit amplitude, attenuated only by its own short internal fade. The new voice in `pitchVoices` does receive the region fade gain, but at this point the region fade is near 0, so its contribution is tiny. Sum ≈ old voice ≈ near-full amplitude. Region then ends, audio drops to 0 → click.

The mechanism is **inferred from source-tracing**; the empirical verification at the sample level is the step at `numberOfFrames − VOICE_FADE_DURATION × sampleRate` and the fact that trimming the region by 21 ms eliminates the artifact.

---

## Addendum 2026-06-11 — fixed upstream; re-verified clean at SDK 0.0.154 / core 0.0.152

Fixed in core 0.0.145: a keep-guard was added to `#updateOrCreatePitchVoice` (commits `3a243e7b` + `e55c12c8`; the guard's comment names the pop). Re-verified clean at SDK 0.0.154 / core 0.0.152:

```
peak in 20 ms fade window:           0.01056   (bug-era: ~0.1, near-full vocal level)
max sample-to-sample delta in window: 0.00193
pre-window baseline noise:            0.00142
```

No anomalous step is present; the max delta in the fade window is within noise of the pre-window baseline. The page is reframed as a **regression check** for this fix.
