# Issue draft — simultaneous takes with identical audio collide on the content-addressed `AudioFileBox` uuid

**Status: DRAFT for user review. Not filed.** Target: `andremichelle/openDAW`.

## Title

Recording two armed captures at once panics `BoxGraph.stageBox` when both takes encode
byte-identical audio

## Symptom

With two audio captures armed simultaneously, one of the two takes never finalizes. The
browser console shows:

```
Error: AudioFileBox <uuid> already staged
    at panic (…)
    at BoxGraph.stageBox (…)
    at _AudioFileBox.create (…)
    …
    at recordingWorklet.onSaved (…)
```

The affected tape's `AudioFileBox` never reaches a usable state and its `SampleLoader`
never emits a terminal state, so anything waiting on finalization for that tape waits
forever. The other tape finalizes normally.

## Cause

`RecordingWorklet.#finalize` calls `SampleService.importRecording`, which calls
`SampleService.importFile` without ever passing a `uuid`. `importFile`
(`packages/studio/core/src/samples/SampleService.ts`) then derives one by content:

```ts
async importFile({uuid, name, bpm, arrayBuffer, …}: AssetService.ImportArgs, …) {
    uuid ??= await UUID.sha256(arrayBuffer)
    …
```

So a recording's `AudioFileBox` uuid is `SHA-256` of the WAV-encoded capture bytes. Two
different recordings normally hash differently, and content-addressing is the intended
behaviour for imported files. But two *simultaneous* captures are two different
recordings that can legitimately contain identical audio — two microphones on the same
signal, two inputs fed from one source, or a loopback split. When their encoded bytes
match exactly, both derive the same uuid, and the second `BoxGraph.stageBox` call
panics on a uuid already staged by the first.

There is no collision handling on that path: `stageBox` panics rather than reusing the
existing box or disambiguating the new one.

Note this needs two independently-finalizing `RecordingWorklet`s. A single-capture loop
recording is not affected, because one `RecordingWorklet` produces exactly one
`importRecording` call for its whole multi-wrap sequence — all its takes share one
`AudioFileBox` by construction.

## It is deterministic, not a race

A dedicated confirmation cell armed both captures on the *same* synthetic loopback
device, removing the small independent-worklet timing jitter that normally keeps two
captures' byte lengths apart. **Every repeat collided: 3 of 3**
(`recaudit-mt-summary-1788304987514.json`, `confirmCollision: true` persisted in the
run).

Corroborating: across the wider matrix, every pair of takes that *did* finalize
successfully has distinct WAV bytes (verified by `shasum` on all 10 surviving pairs).
That is exactly what content-addressing predicts — a pair that finalizes is by
construction a pair whose bytes were not identical. A race would predict no such
correlation.

## Measured signature

| population | repeats lost to the panic |
|---|---|
| same-device confirmation cell, `recaudit-mt-summary-1788304987514.json` | **3 of 3** |
| two-distinct-device matrix, four runs, both builds | 10 of 24 |

The 10-of-24 figure is *not* a property of the SDK. It measures how often two
independently-scheduled capture windows happened to land on byte-identical content in
that particular session, which depends on the harness's own timing and each rate's
render-quantum granularity. Per run: `recaudit-mt-summary-1788302627819.json` 2/6,
`…1788302870379.json` 4/6, `…1788303391228.json` 1/6, `…1788303605274.json` 3/6.

Every failing repeat carries the same `errorMessage`,
`finalizing: finalization tape<A|B> timed out after 30s`, preceded by the console panic
above. Which of the two tapes loses varies; that only reflects which one finalized
first.

## Repro

The harness is an unlisted debug demo in a separate repository, served from a local
HTTPS dev server — **there is no public URL.** Two tapes are armed on two synthetic
loopback devices that both receive clones of one injected signal:

```
recording-alignment-audit-debug-demo.html?scenario=multitrack-start&bpm=120&rate=48000&confirmCollision=1
```

`confirmCollision=1` arms both tapes on the identical loopback device, which removes
the incidental jitter and reproduces the collision on every repeat rather than
intermittently. Without it, the same page reproduces intermittently at the rate tabled
above.

The same conditions arise outside a synthetic harness whenever two armed inputs carry
the same signal.

## Environment

`@opendaw/studio-sdk@0.0.170`, WASM engine, Chrome, macOS. Measured at 44100 and
48000 Hz; the collision itself is rate-independent, only how often two captures happen
to match is not.

## Notes

Measured while auditing recording start-alignment. Full campaign register, with the
per-run data behind every figure above:
https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md
(section "Multi-mic simultaneous recording (Task 7b)", Finding 1)
