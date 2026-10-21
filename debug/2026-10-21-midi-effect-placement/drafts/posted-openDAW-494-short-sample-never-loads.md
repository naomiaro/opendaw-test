<!-- Posted 2026-10-21 as https://github.com/andremichelle/openDAW/issues/494 — the body below is as filed. -->

# A sample of 1200 frames or fewer never loads: the peaks stage fit returns no stage and the peak worker throws

**SDK:** `@opendaw/studio-sdk` 0.0.176 (WASM engine), Chrome, macOS.

A sample shorter than about 25 ms (1200 frames at 48 kHz, 27 ms at 44.1 kHz) cannot be loaded, and a
recording of that length cannot be imported. On the load path the fetch succeeds, then peaks generation
fails and the loader ends in its `error` state; the instrument that points at the sample stays silent, in
the live worklet and in an offline render. On the recording path `importRecording` rejects with the same
error. A one-shot click, a short drum hit, a synthetic burst, or a take stopped within 25 ms of its start
is unusable.

**Repro page (unlisted, Chrome; deterministic, no hardware):**
https://opendaw-test.pages.dev/midi-effect-placement-audit-debug-demo.html?sampleMs=20
— the page loads a 960-frame sample into a Nano and reports `error:sample load failed: Cannot read
properties of undefined (reading 'shift')` in its state badge before anything is rendered; without the
parameter the sample is one second long and the page runs. And
https://opendaw-test.pages.dev/midi-effect-placement-audit-debug-demo.html?importMs=20
— the page first runs a synthetic 960-frame stereo take through `SampleService.importRecording` (the
function a finished recording's audio goes through) and reports `error:recording import of 20 ms (960
frames) failed: Cannot read properties of undefined (reading 'shift')`; `?importMs=1000` imports and runs.

**Measured on the load path** (headless, a 960-frame stereo `AudioBuffer` registered under a uuid in the
sample provider, an `AudioFileBox` with that uuid attached to a Nano through `InstrumentFactories.Nano`'s
attachment, the unit's region played by an offline render):

```
Sample manager fetch called for UUID: 9c9904d0-aac4-41e5-a903-ac097142feaa
Unexpected error loading sample: TypeError: Cannot read properties of undefined (reading 'shift')
    at t (…/@opendaw/studio-core/dist/workers-main.js:3:20848)
    at Object.generateAsync (…/@opendaw/studio-core/dist/workers-main.js:3:20554)
WORKLET sample load failed: Error: Cannot read properties of undefined (reading 'shift')
OFFLINE-ENGINE sample load failed: Error: Cannot read properties of undefined (reading 'shift')
```

The render is silent (peak 0). The same buffer padded with silence to one second (48 000 frames) loads
and plays; nothing else changed.

**Measured on the recording path:** `sampleService.importRecording(uuid, audioData, 120, "short take")`
with a 960-frame stereo `AudioData` rejects with `Cannot read properties of undefined (reading 'shift')`;
with 48 000 frames it resolves.

**Read in the source (0.0.176), consistent with the error:** `packages/lib/fusion/src/peaks/Peaks.ts`,
`Peaks.findBestFit(numFrames, width = 1200)` returns an empty `Uint8Array` when `numFrames / width ≤ 1`.
`packages/lib/fusion/src/peaks/SamplePeakWorker.ts`, `generatePeaks`, builds its stages from those shifts
and then reads `stages[0].shift` for `minMask`, which is the `TypeError` above. The fit is called from four
places with the sample's frame count: `GlobalSampleLoaderManager.ts` (the fetch path, measured),
`SampleService.ts` (`importFile`, reached by `importRecording`, measured), `SampleStorage.ts` and
`cloud/CloudBackupSamples.ts` (read, not run).

Write-up:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-21-midi-effect-placement/note.md
(section "Observation: a short sample never loads").
