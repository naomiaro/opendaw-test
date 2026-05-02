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

To reproduce manually without the static-setup button: open [`comp-lanes-demo.html`](../comp-lanes-demo.html), drop two distinct audio files, switch to splice mode, uncheck Region overlap, add a boundary, play.

## Open question for OpenDAW

We hear a click at this boundary. Is this intended behaviour — i.e. the caller is responsible for adding fades on each region to crossfade across cross-file splice points — or is there an automatic voice-management path in the SDK that should be handling this and isn't firing for this case?
