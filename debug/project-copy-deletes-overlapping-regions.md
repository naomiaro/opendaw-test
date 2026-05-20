# `project.copy()` silently deletes overlapping regions

**Verified against:** OpenDAW SDK 0.0.147 (`@opendaw/studio-sdk@0.0.147`, `@opendaw/studio-core@0.0.145`).

**Repro page:** [`voice-fadein-clip-fadein-product-debug-demo.html`](../voice-fadein-clip-fadein-product-debug-demo.html) (unlisted). The CROSSFADE configuration places two `AudioRegionBox`es on the same Tape track with a 40 ms timeline overlap (region A's `fading.out` extends past the seam; region B's position is shifted back by half the fade) — live playback through the engine plays both regions audibly, but the offline-scan path (which uses `project.copy()`) returns silence.

Note: the sibling target demo [`pure-webaudio-target-debug-demo.html`](../pure-webaudio-target-debug-demo.html) deliberately uses **two separate Tape tracks** for the same crossfade configuration as a workaround, since this is the only way to get a usable OpenDAW offline render. Each track has its own `regions` collection, so the per-track overlap check doesn't fire.

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

```bash
npm run dev
# open https://localhost:5173/voice-fadein-clip-fadein-product-debug-demo.html
```

**HTTPS required.** Click **Play (CROSSFADE)** to mutate the project into the overlapping-regions configuration (`applyScenarioAndPlay` extends region A's duration forward by half the fade and shifts region B's position back by half the fade, so the two regions overlap by `CROSSFADE_MS` = 40 ms on the same track). Live playback works — the seam is audible. Click **Stop**, then **Scan current scenario**. The offline scan reports `reference peak: 0.0000`, `min envelope peak: 0.0000`, with all subsequent metrics at zero (the entire rendered buffer is silence). The browser console shows:

```
_AudioRegionBox _AudioRegionBox Overlapping regions
Deleting 2 invalid boxes:
```

The deletion fires inside `project.copy()`, which the offline-scan path (`renderOfflineSlice` in `src/lib/offlineScan.ts`) uses to snapshot project state for the offline engine. After the deletion the copied project has no regions to render.

Switching to the HARD-CUT configuration in the same demo (no clip fades, regions touch but do not overlap) renders normal audio offline — the same code path produces ~0.5 peak amplitude through the seam.

Minimal box-graph setup that triggers the deletion (also matches the OPENDAW scenario in the repro page):

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

## Suspected mechanism

_Inferred from runtime warnings; not source-traced._

The console warnings point to `TrackRegions`'s `onAdded` callback ("Overlapping region added") and to a box-graph validation pass ("`_AudioRegionBox _AudioRegionBox Overlapping regions`" → "Deleting 2 invalid boxes"). The live engine appears to tolerate the violation at runtime — it accepts the second region during the initial `editing.modify` and renders both regions through `TapeDeviceProcessor`. The `project.copy()` path runs a stricter validator that deletes any box flagged invalid, including both overlapping regions.

The two overlapping regions are presumably both flagged because the validator can't decide which one is "wrong." Either way, the offline-render path has no chance to surface the actual artefact because the regions are gone before the offline engine starts.

## Open questions

1. Is the OpenDAW data model meant to disallow overlapping regions on a single track, or is the deletion in `project.copy()` over-eager? The live engine plays the configuration without removing it; only `copy()` deletes. If overlap on one track is unsupported, what is the intended way to author a crossfade between two regions of the same lane?
2. The deletion is silent — only console warnings, no thrown error or callback to the consumer. A consumer using `project.copy()` for offline rendering has no signal that the rendered output is structurally invalid. Should `copy()` throw, or at least return a manifest of deleted boxes?
