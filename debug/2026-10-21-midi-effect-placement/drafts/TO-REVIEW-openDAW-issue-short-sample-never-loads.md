<!-- Draft for andremichelle/openDAW. Not posted. Target: a new issue.
     Written 2026-10-21 from the MIDI effect placement audit's first attempt (a 960-frame burst sample).
     Measured on the fetch path only (GlobalSampleLoaderManager); the other three callers of the same stage
     fit are read, not run — labelled as such below. No dedicated repro page: the audit page pads its sample
     to one second now; a `?sampleMs=` switch on it would make one if the user wants a live link before posting. -->

# A sample of 1200 frames or fewer never loads: the peaks stage fit returns no stage and the peak worker throws

**SDK:** `@opendaw/studio-sdk` 0.0.176 (WASM engine), Chrome, macOS.

A sample shorter than about 25 ms (1200 frames at 48 kHz, 27 ms at 44.1 kHz) cannot be loaded. The fetch
succeeds, then peaks generation fails and the loader ends in its `error` state; the instrument that points
at the sample stays silent, in the live worklet and in an offline render. A one-shot click, a short drum hit
or a synthetic burst of that length is unusable in a Nano, a Tape or a Playfield.

**Measured** (headless, a 960-frame stereo `AudioBuffer` registered under a uuid in the sample provider,
an `AudioFileBox` with that uuid attached to a Nano through `InstrumentFactories.Nano`'s attachment, the
unit's region played by an offline render):

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

**Read in the source (0.0.176), consistent with the error:** `packages/lib/fusion/src/peaks/Peaks.ts`,
`Peaks.findBestFit(numFrames, width = 1200)` returns an empty `Uint8Array` when `numFrames / width ≤ 1`.
`packages/lib/fusion/src/peaks/SamplePeakWorker.ts`, `generatePeaks`, builds its stages from those shifts
and then reads `stages[0].shift` for `minMask`, which is the `TypeError` above. The fit is called from four
places with the sample's frame count: `GlobalSampleLoaderManager.ts` (the fetch path, measured here),
`SampleService.ts` (`importFile`, which a finished recording also goes through), `SampleStorage.ts` and
`cloud/CloudBackupSamples.ts` (read, not run). A recording stopped within 25 ms of its start would meet the
same fit (not measured).

Write-up:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-21-midi-effect-placement/note.md
(section "Observation: a short sample never loads").
