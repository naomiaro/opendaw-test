# Debug investigations

Documented bugs and open questions from working with the OpenDAW SDK. Each investigation describes a specific behaviour, the mechanism (verified against current SDK source), and how to reproduce it using one of the unlisted debug demo pages.

## Waiting for a read

Drafts that are written and not posted. Find them at any time with `ls debug/*/drafts/TO-REVIEW-*`.

Nothing is waiting.

## Layout

- **One folder per investigation, named `YYYY-MM-DD-topic/`.** The date is the day the investigation started and does not change afterwards, so a listing reads oldest to newest. The write-up is `note.md`; anything that belongs to it (a second note, a script) sits beside it.
- **Drafts of public posts live in the investigation's `drafts/`, and the file name says where each stands:**
  - `TO-REVIEW-<target>.md` — written, waiting for a read, nothing posted. Add it to "Waiting for a read" above.
  - `posted-<tracker>-<number>[-topic].md` — renamed from `TO-REVIEW-…` when it is posted; the body as filed, with the link at its head.
  - `withdrawn-<topic>.md` — not posted, with the reason at its head.
- **The index below is newest first.** A new folder gets a row; a row's status is kept current.
- **The `.md` files at this folder's top level other than this one are stubs.** Each stands at a path that a filed upstream issue or PR links to and says where the note went. Do not add notes there, and do not delete the stubs.

## Conventions

- **Each note states the SDK version it was verified against.** Code citations (file:line) are point-in-time and decay — re-verify before quoting.
- **Focus on evidence and repro, not advocacy.** Document what's observed and how to reproduce it; label what's inferred from source-tracing as inferred. The goal is to make the symptom reproducible by anyone reading the note — diagnosis, recommendations, and contract questions are out of scope.
- **Repro pages are unlisted.** They live alongside the regular demos but are not added to `src/index.tsx` or `public/sitemap.xml`. The HTML carries `<meta name="robots" content="noindex, nofollow">`. They're reachable only by direct URL and are intentionally minimal — one button, one configuration, one thing to listen for.
- **Proven browser-probe techniques** (no SDK or page changes needed): patch
  `OfflineAudioContext.prototype.startRendering` to capture rendered buffers; intercept
  `MessagePort.prototype.postMessage` to log engine transport commands; pull `project`
  from a mounted component's React fiber. All three were used to close the seam and
  mode-swap investigations.
- **All demo pages boot the WASM engine (the only engine).** Their
  offline scan always routes through `OfflineEngineRenderer` —
  `OfflineAudioContext` + `createEngine` throws with the WASM `EngineVariant` once any wasm
  engine booted on another context (`ensureReady` registers the processor only on the first
  context — see [the wasm-ensure-ready note](./2026-07-15-wasm-ensure-ready-second-context/note.md)).
  The live WASM transport can take 20–30 s+ after `play()`
  before position advances on these pages; the offline scan does not depend on it.
  **Update 2026-07-16:** observed at SDK 0.0.159; re-tested at 0.0.160 and the delay did
  NOT reproduce — position advanced in ~3.3 s.
- **Claims about runtime behaviour must be empirically verified, not inferred.** Tracing through SDK source produces plausible-looking explanations but can include unverified steps. If the doc states "X happens because Y," `Y` must be confirmed by logging the relevant value at runtime, stepping through with a debugger, or otherwise observing it directly. Citation of file:line for `Y` is not verification of `Y` — it's verification that the code at that location *exists*. When in doubt, present the symptom and repro without the mechanism, and let the maintainer diagnose.


## Index

| Started | Investigation | What | Status | Repro page | Drafts |
|---|---|---|---|---|---|
| 2026-10-02 | [loudness-meter](./2026-10-02-loudness-meter/note.md) | What the engine's loudness meter reads for the EBU Tech 3341 / 3342 test signals and a K-weighting sweep, played through the live engine. | **Standing sweep** after SDK upgrades | [`loudness-meter-audit-debug-demo.html`](../loudness-meter-audit-debug-demo.html) |  |
| 2026-10-01 | [worklet-clock-stale](./2026-10-01-worklet-clock-stale/note.md) | Chrome's worklet clock stands still for a quantum while the main thread changes the audio graph; the SDK's start-of-take stamps read it, so a rare take is a quantum off. Firefox and Safari read true. | **Open.** Filed as [openDAW#424](https://github.com/andremichelle/openDAW/issues/424); Chrome defect ([Chromium 442866743](https://issues.chromium.org/issues/442866743), cause added in [comment 5](https://issues.chromium.org/issues/442866743#comment5)) | [`worklet-clock-debug-demo.html`](../worklet-clock-debug-demo.html) | [posted #424](./2026-10-01-worklet-clock-stale/drafts/posted-openDAW-424.md); [posted Chromium comment](./2026-10-01-worklet-clock-stale/drafts/posted-chromium-442866743-comment.md) |
| 2026-09-28 | create-note-region-loop-offset (`2026-09-28-create-note-region-loop-offset/`) | `ProjectApi.createNoteRegion` never wrote its `loopOffset` parameter. No note: the filed issue is the write-up. | Fixed in SDK 0.0.173 ([openDAW#420](https://github.com/andremichelle/openDAW/issues/420)) |  | [posted #420](./2026-09-28-create-note-region-loop-offset/drafts/posted-openDAW-420.md) |
| 2026-09-28 | [metronome-click-survives-pause](./2026-09-28-metronome-click-survives-pause/note.md) | A metronome click in flight when the transport stops resumed at the next play. | Fixed in SDK 0.0.173 ([openDAW#419](https://github.com/andremichelle/openDAW/issues/419)); page is the regression test | [`metronome-stale-click-debug-demo.html`](../metronome-stale-click-debug-demo.html) | [posted #419](./2026-09-28-metronome-click-survives-pause/drafts/posted-openDAW-419.md) |
| 2026-09-02 | [recording-start-alignment](./2026-09-02-recording-start-alignment/note.md) | Campaign register: where a recorded take lands on the timeline, measured against a same-context loopback; input-latency calibration; the one-quantum event. Also the [bring-up probe note](./2026-09-02-recording-start-alignment/probe-note.md). | **Standing sweep** after SDK upgrades. [#374](https://github.com/andremichelle/openDAW/issues/374), [#375](https://github.com/andremichelle/openDAW/issues/375) closed, PR [#376](https://github.com/andremichelle/openDAW/pull/376) shipped in 0.0.172; PRs #378, #380, #418 open. Open finding: a last repeat that never finalized one tape (3 of 51 cells) | [`recording-alignment-audit-debug-demo.html`](../recording-alignment-audit-debug-demo.html) | posted [#374](./2026-09-02-recording-start-alignment/drafts/posted-openDAW-374-placement-bias.md), [#375](./2026-09-02-recording-start-alignment/drafts/posted-openDAW-375-take-collision.md), [PR #376](./2026-09-02-recording-start-alignment/drafts/posted-openDAW-376-pr.md); 3 withdrawn |
| 2026-08-27 | [sample-rate-alignment-audit](./2026-08-27-sample-rate-alignment-audit/note.md) | Cross-rate, cross-BPM alignment audit of the engine: 180 of 180 offline cells pass, no new engine bug. | **Standing sweep** after SDK upgrades | [`samplerate-audit-debug-demo.html`](../samplerate-audit-debug-demo.html) |  |
| 2026-08-27 | [countin-metronome-boundary-click](./2026-08-27-countin-metronome-boundary-click/note.md) | With the metronome off and a count-in on, one extra click at the punch-in downbeat. | Fixed in SDK 0.0.172 ([openDAW#367](https://github.com/andremichelle/openDAW/issues/367)) | [`swipe-comping-demo.html`](../swipe-comping-demo.html) | [posted #367](./2026-08-27-countin-metronome-boundary-click/drafts/posted-openDAW-367.md) |
| 2026-08-26 | [automation-simplifier-flattening](./2026-08-26-automation-simplifier-flattening/note.md) | A slow recorded automation gesture came back from finalize as a straight line. | Fixed in SDK 0.0.172 ([openDAW#363](https://github.com/andremichelle/openDAW/issues/363)); page is the regression test | [`automation-simplifier-debug-demo.html`](../automation-simplifier-debug-demo.html) |  |
| 2026-07-15 | [wasm-ensure-ready-second-context](./2026-07-15-wasm-ensure-ready-second-context/note.md) | `WasmEngine.ensureReady` registers the processor only on the first context it is called with. | Closed wontfix ([openDAW#315](https://github.com/andremichelle/openDAW/issues/315)): use `OfflineEngineRenderer` | [`wasm-ensure-ready-second-context-debug-demo.html`](../wasm-ensure-ready-second-context-debug-demo.html) |  |
| 2026-06-12 | [recording-finalize-no-terminal-state](./2026-06-12-recording-finalize-no-terminal-state/note.md) | A recording whose finalization never completes stays in `record` with no error and no terminal event. | **Open.** Not reproduced on demand; page kept as the capture instrument | [`recording-finalize-debug-demo.html`](../recording-finalize-debug-demo.html) |  |
| 2026-06-11 | [seconds-overlap-validation-unit-mismatch](./2026-06-11-seconds-overlap-validation-unit-mismatch/note.md) | The overlap validator compared seconds with PPQN on Seconds-timeBase regions. | Closed by SDK 0.0.173 |  |  |
| 2026-06-09 | [time-pitch-start-position-pop](./2026-06-09-time-pitch-start-position-pop/note.md) | A pop when playback starts inside a mid-file silent gap with a time-stretch box attached. | **Open.** A fade-in added in SDK 0.0.165 is expected to mask it; re-verify pending | [`time-pitch-start-position-debug-demo.html`](../time-pitch-start-position-debug-demo.html) |  |
| 2026-05-19 | [voice-fadein-clip-fadein-product](./2026-05-19-voice-fadein-clip-fadein-product/note.md) | A dip on the fade-in side of a crossfade: the voice fade multiplied the clip fade. | Fixed in SDK 0.0.159 ([openDAW#312](https://github.com/andremichelle/openDAW/issues/312)) | [`voice-fadein-clip-fadein-product-debug-demo.html`](../voice-fadein-clip-fadein-product-debug-demo.html) |  |
| 2026-05-19 | [shared-source-double-process](./2026-05-19-shared-source-double-process/note.md) | A sample-level discontinuity two samples before a seam between regions that share a source. | Fixed in SDK 0.0.159 ([openDAW#311](https://github.com/andremichelle/openDAW/issues/311)) | [`shared-source-double-process-debug-demo.html`](../shared-source-double-process-debug-demo.html) |  |
| 2026-05-19 | [project-copy-deletes-overlapping-regions](./2026-05-19-project-copy-deletes-overlapping-regions/note.md) | `project.copy()` deleted both regions of a same-track overlap, a sub-PPQN one included. | By design (overlaps are not allowed); the repair trims instead of deleting since SDK 0.0.173 | [`voice-fadein-clip-fadein-product-debug-demo.html`](../voice-fadein-clip-fadein-product-debug-demo.html) |  |
| 2026-05-12 | [fade-out-end-of-file-pop](./2026-05-12-fade-out-end-of-file-pop/note.md) | A click at the end of a clip whose fade-out ends exactly at the file's end. | Fixed upstream (core 0.0.145); page is the regression check | [`fade-out-end-of-file-debug-demo.html`](../fade-out-end-of-file-debug-demo.html) |  |
| 2026-05-01 | [splice-click-cross-file](./2026-05-01-splice-click-cross-file/note.md) | A click at region boundaries when consecutive regions reference different audio files. | Resolved by SDK 0.0.165 (automatic crossfade); page is the regression check | [`comp-lanes-debug-demo.html`](../comp-lanes-debug-demo.html) |  |

**Target / reference comparison:**

- [`pure-webaudio-target-debug-demo.html`](../pure-webaudio-target-debug-demo.html) — Same crossfade scenario (two slightly phase-offset 440 Hz sines, 40 ms linear crossfade at the seam) rendered three ways for A/B/C comparison. **ALIGNED** (pure Web Audio + phase-correlation shift + linear crossfade) is the audible target — clean unity-sum through the crossfade. **UNALIGNED** (pure Web Audio, shift = 0) is the control showing what a phase-mismatched linear crossfade sounds like. **OPENDAW** runs the same configuration through OpenDAW's `TapeDeviceProcessor` with each region on its own Tape track (workaround for the `project.copy()` overlap-deletion bug). The audible delta between OPENDAW and ALIGNED is the gap the engine artifacts documented above currently produce — OPENDAW should match ALIGNED once those are resolved.
