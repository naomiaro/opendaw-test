# `project.copy()` silently deletes overlapping regions

**Verified against:** OpenDAW SDK 0.0.147 (`@opendaw/studio-sdk@0.0.147`, `@opendaw/studio-core@0.0.145`).

**Status (2026-05-21):** Resolved by SDK author. Andre confirmed: "Regarding overlapping regions: They are not allowed in openDAW. That is why they get deleted in case the UI allowed such positioning at some point (which is considered a bug)." The deletion is intentional. Consumers authoring a crossfade between two regions of the same lane must use **separate tracks** for the overlapping regions and let the crossfade emerge from mixing the track outputs — see `pure-webaudio-target-debug-demo.tsx` for the working pattern. The sub-PPQN overlap from `Int32` `position` vs `Float32` `duration` (below) is still worth being aware of as a consumer footgun: it produces the same deletion without the consumer intending any overlap.

**Repro page:** [`voice-fadein-clip-fadein-product-debug-demo.html`](../voice-fadein-clip-fadein-product-debug-demo.html) (unlisted). The CROSSFADE configuration places two `AudioRegionBox`es on the same Tape track with a 40 ms timeline overlap (region A's `fading.out` extends past the seam; region B's position is shifted back by half the fade) — live playback through the engine plays both regions audibly, but the offline-scan path (which uses `project.copy()`) returns silence.

Note: the sibling target demo [`pure-webaudio-target-debug-demo.html`](../pure-webaudio-target-debug-demo.html) deliberately uses **two separate Tape tracks** for the same crossfade configuration as a workaround. Each track has its own `regions` collection, so the per-track overlap check doesn't fire.

## Symptom

A project containing two `AudioRegionBox`es on the **same track** whose timeline ranges overlap (e.g. region A: `position = 0`, `duration = 30.02 s`; region B: `position = 29.98 s`, `duration = 30.02 s` — a 40 ms overlap centred on a comp seam, the natural shape for a linear crossfade) is silently mutated by `project.copy()`. Both overlapping regions are **deleted from the copied project**.

Console output during a `project.copy()` call against such a project:

```
[TrackRegions] Overlapping region added { track: -1, added: …, existing: …, stack: Error … }
_AudioRegionBox _AudioRegionBox Overlapping regions
Deleting 2 invalid boxes:
```

The live engine plays the same project's two overlapping regions without removing them — the deletion only happens through the `copy()` path. As a result any offline rendering done via the standard pattern

```ts
const projectCopy = project.copy();
const context = new OfflineAudioContext(…);
const worklets = await AudioWorklets.createFor(context);
const engineWorklet = worklets.createEngine({ project: projectCopy });
…
const buffer = await context.startRendering();
```

produces a zero-filled buffer. `engineWorklet.queryLoadingComplete()` returns `true` on the first call (there are no regions to load samples for), `startRendering()` succeeds, and the rendered output has `peak = 0`, `mean = 0`.

## How to reproduce

The original reproducer was the CROSSFADE configuration of `voice-fadein-clip-fadein-product-debug-demo.html` placing two overlapping regions on a single Tape track. That demo has since been updated to use two Tape tracks (mix at master) so its offline scan can measure the actual voice-fade × clip-fade dip; the deletion is therefore no longer surfaced by any live demo on this repo.

To repro from scratch with the SDK directly, set up two `AudioRegionBox`es on the **same** track with overlapping timeline ranges (e.g. region A: `position = 0`, `duration = 30.02 s`; region B: `position = 29.98 s`, `duration = 30.02 s` — a 40 ms overlap). The live engine plays the configuration; calling `project.copy()` against it deletes both regions and the browser console logs:

```
_AudioRegionBox _AudioRegionBox Overlapping regions
Deleting 2 invalid boxes:
```

This is the expected, by-design behaviour — see the **Status** banner at the top of this note.

Minimal box-graph setup that triggers the deletion:

```
One Tape track.
Two AudioFileBoxes (distinct UUIDs).
Two AudioRegionBoxes on the same track:
  - Region A: position = 0,
              duration = PPQN(seam + halfFade),
              loopOffset = 0, loopDuration = PPQN(fileDuration),
              fading.out = PPQN(fade), fading.in = 0,
              waveformOffset = 0.
  - Region B: position = PPQN(seam − halfFade),    // overlaps A by `fade` ms
              duration = PPQN(fileDuration − seam + halfFade),
              loopOffset = ..., loopDuration = PPQN(fileDuration),
              fading.in = PPQN(fade), fading.out = 0,
              waveformOffset = loopOffset.
```

Touching seams (A ends at PPQN X, B starts at PPQN X, no overlap) do **not** trigger the deletion. The check is specifically for time-range overlap; the shared-source repro page uses touching regions and its scan returns non-zero peak amplitudes through the same code path.

## Sub-PPQN overlap from `Int32` `position` vs `Float32` `duration`

The most surprising way a consumer can hit this deletion is **without authoring any overlap at all**. From `packages/studio/boxes/src/AudioRegionBox.ts`:

```
position:      Int32Field    ← integer storage, ECMA ToInt32 truncation toward zero
duration:      Float32Field  ← fractional storage (Float32-precision)
loopOffset:    Float32Field
loopDuration:  Float32Field
```

A consumer who computes a seam-in-PPQN value from a non-trivial seam-in-seconds will commonly get a fractional `Number` back from `PPQN.secondsToPulses(seamSec, bpm)`. Passing that same value to `regionA.duration.setValue(...)` and `regionB.position.setValue(...)` produces two different stored values:

```
regionA.duration  : 57602.56  → Float32 nearest value 57602.5625 (preserved)
regionB.position  : 57602.56  → Int32 truncated to 57602
```

`regionA.end = regionA.position + regionA.duration = 0 + 57602.5625 = 57602.5625`.
`regionB.start = regionB.position = 57602`.
**The two regions now overlap by 0.5625 PPQN**, even though the consumer's intent was that they touch exactly. `project.copy()`'s validator fires and deletes both regions.

We hit this directly in the shared-source repro: an initial seam-in-samples calculation produced a non-integer PPQN at the chosen seam time, the offline scan returned all zeros, and the only signal was the console warning above. We worked around it by picking seam-in-seconds values whose PPQN happens to be integer at BPM 120 (`30.0 s → 57600`; `30.5 s → 58560`).

## Suspected mechanism

_Inferred from runtime warnings; not source-traced._

The console warnings point to `TrackRegions`'s `onAdded` callback ("Overlapping region added") and to a box-graph validation pass ("`_AudioRegionBox _AudioRegionBox Overlapping regions`" → "Deleting 2 invalid boxes"). The live engine appears to tolerate the violation at runtime — it accepts the second region during the initial `editing.modify` and renders both regions through `TapeDeviceProcessor`. The `project.copy()` path runs a stricter validator that deletes both overlapping regions. The offline-render path has no chance to surface the actual artefact because the regions are gone before the offline engine starts.

## Open questions

1. ~~Is the OpenDAW data model meant to disallow overlapping regions on a single track…~~ **Answered (2026-05-21):** overlaps are disallowed by design; `project.copy()` deletion is the data model's enforcement, and any UI path that permits authoring an overlap on one track is a bug. Intended way to author a crossfade between two regions of the same lane: put the two regions on separate tracks; the crossfade emerges from mixing the track outputs at the master.
2. The deletion is silent from the consumer's perspective — only console warnings, no thrown error or callback. A consumer using `project.copy()` for offline rendering has no programmatic signal that the rendered output is structurally invalid. **Still open** as a diagnostics/UX concern, separate from the data-model question. The sub-PPQN overlap path above is the most likely way for a consumer to hit this without knowing they authored an overlap.
