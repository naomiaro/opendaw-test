# Cross-file splice click at exact region boundaries

**Verified against:** OpenDAW SDK 0.0.138 (`@opendaw/studio-sdk@0.0.138`, `@opendaw/studio-core@0.0.136`).

**Repro page:** [`comp-lanes-debug-demo.html`](../comp-lanes-debug-demo.html) (unlisted).

## Symptom

Two consecutive `AudioRegionBoxAdapter`s on the same track that share an exact boundary (region A ends at PPQN X, region B starts at PPQN X) produce an audible click at X when the two regions reference different audio files and each region's `loopOffset === position`.

## How to reproduce

```bash
npm run dev
# open http://localhost:5173/comp-lanes-debug-demo.html
```

1. Click **Static setup: Otherside / ScarTissue (no overlap)**.
   The page loads `Otherside.mp3` (top) and `ScarTissue.mp3` (bottom), places a comp boundary at the PPQN equivalent of 2.32 s, assigns Zone 1 → Otherside and Zone 2 → ScarTissue, and switches to splice mode with two consecutive same-track regions: A `[0.00s, 2.32s)` reading Otherside, B `[2.32s, 15.48s)` reading ScarTissue.
2. Press **Play**. The click is audible at the 2.32 s boundary.

To reproduce manually without the static-setup button: open [`comp-lanes-demo.html`](../comp-lanes-demo.html), drop two distinct audio files, switch to splice mode (splices are always exact-boundary), add a comp boundary, play.

## Open question for OpenDAW

We hear a click at this boundary. Is this intended behaviour — i.e. the caller is responsible for adding fades on each region to crossfade across cross-file splice points — or is there an automatic voice-management path in the SDK that should be handling this and isn't firing for this case?

---

## Addendum 2026-06-11 — voice-routing facts corrected; question remains OPEN

Corrected understanding of the voice routing at offset ≠ 0 (from wave-3 source audit, core 0.0.152):

- **Incoming voice** fades in-place in `pitchVoices` with the region gain buffer when `offset ≠ 0`. The `PitchVoice` constructor enters `Fading / fadeDirection = +1` for any `readPosition > 0` (not just `loopOffset = 0`), so the 20 ms voice fade-in applies even when the new region starts mid-file. The voice-fade-in × clip-gain product documented in [`voice-fadein-clip-fadein-product.md`](./voice-fadein-clip-fadein-product.md) is therefore active at cross-file splice points when the incoming region has a non-zero `fading.in`.
- **Outgoing voice** hard-cuts at its cycle end (the last sample written is at `seam − 2` due to `bpn = (bp1 − bp0) | 0` truncation, leaving `seam − 1` zero-forced in the output buffer), then is evicted from `pitchVoices` on the **next** block via `removeByPredicate` — it is NOT processed through `fadingVoices` with the region gain buffer; it receives `unitGain` during that final block. This is the same eviction mechanic as described in the seam addendum above.

The offset-geometry findings in [`shared-source-double-process.md`](./shared-source-double-process.md) (2026-06-11 addendum) are directly relevant: the one-quantum late eviction and the resulting constructive/destructive interference are the structural reason cross-file splices click at offset 64 but only tick faintly at offset 0.

The open question for the maintainer remains: **caller-managed fades or automatic SDK handling?** The geometry analysis above suggests automatic same-block eviction (passing `bp1` as the fade-out block offset) would substantially reduce the click at offset ≠ 0 even without caller-added fades.
