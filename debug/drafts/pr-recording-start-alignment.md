# PR description draft — recording start-alignment

**Status: DRAFT for user review. Nothing pushed, no PR opened.**
Target: `andremichelle/openDAW`, branch `fix/recording-start-alignment` in the local
upstream checkout, one commit on top of `origin/main` (`4a9f183f6`).

Every number below was recomputed from the persisted measurement artifacts in
`.verify-output/` and each is followed by the file it came from. Candidate-build
figures are analytically corrected from persisted per-row geometry, not re-measured.

---

## Title

`fix(recording): anchor take placement on the audio-thread clock`

## Body

### The problem

Audio takes are placed early on the timeline. On an idle main thread, with no
count-in, the placement bias measures **−34.97 to −52.51 ms** as a per-cell mean
across 18 of the 20 cells of a live matrix on `@opendaw/studio-sdk@0.0.170`
(`recaudit-summary-1788310164556.json` at 48000 Hz, `…1788310817094.json` at
44100 Hz). It appears at both sample rates tested (44100, 48000) and both tempi
(120, 97.3 bpm), on every scenario that does not carry a count-in offset. The two
cells without a figure are `loop-wrap` cells where every repeat failed to finalize
(see "Measured but unexplained" below).

Content lands early, so the head of a performance sits ahead of the downbeat the
musician played to.

### Where the error comes from

`RecordAudio.ts` derives the take's `waveformOffset` from two quantities, both read
on the main thread:

```ts
const wallclockSinceWorklet = recordingWorklet.numberOfFrames / sampleRate
const headStartSeconds = countedIn
    ? Math.max(0, wallclockSinceWorklet - countInSeconds)
    : wallclockSinceWorklet
const waveformOffset = headStartSeconds + countInSeconds + outputLatency + inputLatency
```

The total error decomposes into three additive terms, established by reading the
source and confirmed against the diagnostic fields persisted on every measured take:

1. **`outputLatency` (23 ms at both rates).** Real compensation for a
   speaker → ear → mic path. A digital loopback never incurs it, so in the
   measurement harness this term is unearned. It is named here for completeness and
   is *not* what this PR changes — absolute device latency was explicitly out of the
   audit's scope.
2. **The uncompensated worklet-connect gap — the dominant term.** The
   `RecordingWorklet`'s frame counter starts at `prepareRecording()`'s
   `recordGainNode.connect(recordingWorklet)`, a wall-clock instant that occurs
   *before* the transport's position begins advancing from 0. For the no-count-in
   path there is nothing subtracted, so that pre-roll goes straight into
   `headStartSeconds`. Worked example from a persisted row: with
   `waveformOffsetSec = 0.055000` and `outputLatency = 0.023`, `headStartSeconds` is
   32 ms while the same callback's `regionStartSec` reads 2.6 ms — the frame-count
   clock and the PPQN clock, read at the same tick, disagree by roughly 12×.
3. **An anchor-position residual.** `currentPosition` is read once, at the first
   `isRecording=true` tick, by which time the transport has already advanced. This
   residual scales with main-thread scheduling lag rather than being a fixed
   constant: the raw worklet-connect-to-first-frame lag stays flat at ~15–25 ms
   regardless of whether a given repeat's total bias is −65 ms or −110 ms, which a
   pure pre-roll constant would not do.

Terms 2 and 3 are the same story from two directions: the elapsed-capture clock and
the transport position are read on the main thread, so both carry its scheduling lag,
and nothing pairs them to a common instant.

### What the commit changes

It replaces both main-thread reads with anchors taken on the audio thread.

- `RecordingProcessor` posts the context time of the buffer's first captured frame
  (`{type: "first-quantum", contextTime}`), gated on the same channel-count check the
  ring writer uses so setup-phase quanta are skipped. `RecordingWorklet` exposes it as
  `firstQuantumTime`.
- The engine state packet gains `contextTime`, the audio-thread `currentTime` at which
  its `position` was sampled. `EngineWorklet` and `EngineFacade` expose it as
  `syncContextTime`.
- `RecordAudio` computes elapsed capture time as the difference between those two,
  which puts both halves of the pair on one clock, and keeps the previous observation
  pair as a fallback when either anchor is unavailable. It waits a bounded three
  callbacks for the first-quantum announcement before accepting that fallback, since
  the announcement rides a MessagePort and can trail the first `isRecording`
  observation on a busy main thread.
- The take is anchored at the position recording *started*
  (`Recording.wasStartingAt()`, already present upstream) rather than the first
  observed position, walking the waveform offset back by the musical time between the
  two. A one-second sanity window keeps the observed anchor when the start position is
  stale, which can happen after a seek dispatched just before the request.
  `waveformOffset` is clamped at 0.
- Wrapped loop takes start their window one voice-crossfade plus one render quantum
  deeper into the buffer. The transport clock wraps seamlessly, but the rendered audio
  of each wrapped cycle emerges that much late behind `BlockFlag.discontinuous`, so a
  player following what they hear is late within each cycle's window. The compensation
  is applied per take rather than added to the chained base, which would accumulate.

Two small independent fixes ride along, both touching the same recording path:

- `CaptureAudio` opts out of OS-level ML voice filtering (macOS Voice Isolation via
  Chrome 120+), which adds latency and mangles instrument input, and asks for minimal
  capture buffering. Both are `ideal`/ignorable constraints, so browsers without
  support are unaffected. `env.d.ts` declares the two constraint properties lib.dom
  omits.
- `RecordMidi`'s `outputLatency` fallback read `?? 10.0` — ten *seconds*, not ten
  milliseconds. On a browser that does not report `outputLatency` this shifted MIDI
  takes ten seconds early. It is now `0.010`.

### Measured effect

Live matrix: 5 scenarios × 2 bpms (120, 97.3) × 2 rates (44100, 48000) × 3 repeats,
recorded through a synthetic in-context digital loopback so that the measurement
carries no real device latency. Take placement is judged against the project's
**absolute** beat grid (integer multiples of the beat period from timeline zero), and
a harness-path `outputLatency` term of 23 ms is netted out of the classification math
on both sides equally.

Per-cell mean placement bias, candidate versus unfixed, by scenario group:

| scenario group | cells | bias reduction |
|---|---|---|
| `nominal-start` + `countin-start` | 8 | 50.5–82.1 % |
| `janked-start` (150 ms main-thread block after the recording flip) | 4 | 71.5–81.2 % |
| `midtimeline-start` (punch-in on a running transport) | 4 | 42.1–69.3 % |
| `loop-wrap` (takes 1–4) | 2 comparable | 35.2–40.2 % |

**The bias is smaller on all 18 comparable cells; none regresses.** Five cells move
from unclassified into the predicted random-band signature (`nominal-start`/120/48000,
`countin-start`/120/48000, `nominal-start`/120/44100, `nominal-start`/97.3/44100,
`countin-start`/120/44100). No cell reaches the harness's 2 ms `aligned` tolerance —
a residual bias remains.

The remaining two of the twenty cells (`loop-wrap`/120/48000 and
`loop-wrap`/97.3/44100) have no comparison at all: every unfixed repeat of them hit
the finalization failure described below.

Artifacts: unfixed baseline `recaudit-summary-1788310164556.json` (48000 Hz) and
`…1788310817094.json` (44100 Hz), both measured directly on the absolute grid.
Candidate `recaudit-summary-1788299505584.json` (48000 Hz) and `…1788299943226.json`
(44100 Hz), **analytically corrected from persisted per-row geometry rather than
re-measured** — the build layout those runs used no longer exists on disk. The
correction adds each row's own off-grid phase, an identity verified directly on every
row of the campaign where both grids were computed on the same audio.

### Measured but unexplained

On the unfixed build, `loop-wrap` recordings fail to finalize at a high rate, with
`finalization timed out after 30s`:

| population | failures |
|---|---|
| five campaign runs that attempted `loop-wrap` | 18 of 27 |
| fresh baseline matrix, both rates | 10 of 12 |
| this branch, both rates | **0 of 12** |

The failure is a binary fast-success-or-never split, not a slow gradient: raising the
deadline from 30 s to 90 s left 4 of 6 repeats still failing
(`recaudit-summary-1788291343233.json`), while successful finalizations complete in
86–146 ms. Nothing in this commit touches the finalization pipeline, so the clean
sweep on this branch is **a measured outcome with no traced mechanism**. It is
reported here so it is not mistaken for an established fix — the underlying hang may
still be present and merely not provoked.

Baseline artifacts: `recaudit-summary-1788287951691.json`, `…1788288625777.json`,
`…1788288803959.json`, `…1788291343233.json`, `…1788291706370.json`,
`…1788310164556.json`, `…1788310817094.json`. Branch artifacts:
`recaudit-summary-1788299505584.json`, `…1788299943226.json`.

### What this does not fix

- **Residual placement bias.** No cell reaches the 2 ms alignment tolerance. The
  remaining error is smaller but not zero.
- **Inter-track skew between simultaneously armed captures**, about one render
  quantum, unchanged by this commit and present identically on both builds. Each
  capture is anchored against its own worklet's callback; this commit corrects each
  one against its own clock and does not synchronize two of them to each other.
  Filed separately.
- **A content-address collision on simultaneous identical takes.** Filed separately.
- **A small head loss on punch-in** (12–49 ms of content between the record request
  and the first captured frame) that is inherent to connecting the capture path inside
  `startRecording`'s async chain. Pre-connecting the recording worklet at arm time so
  the ring holds pre-roll would remove it, but that is a design change to the capture
  path rather than a bug fix and is out of scope here.

### Reproducing the measurement

The harness is an unlisted debug demo in a separate repository and runs only on a
local HTTPS dev server — **there is no public URL for it.**

```
recording-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>
```

Scenarios: `nominal-start`, `janked-start`, `midtimeline-start`, `countin-start`,
`loop-wrap`, plus `multitrack-start` / `multitrack-janked` for the simultaneous-capture
cells. Each run writes a summary JSON and one WAV per repeat.

Full campaign register, including every prediction that was refuted or withdrawn and
the harness measurement defect that was found and fixed mid-campaign:
https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md

### Verification

- `npx turbo run build --filter=@opendaw/studio-core --filter=@opendaw/studio-core-processors --filter=@opendaw/studio-core-workers` — 16 tasks successful.
- `npm run build:bundles` in `packages/studio/core-wasm` — both bundles emitted.
- `npm run typecheck` in `packages/studio/core-wasm` — 9 errors, all pre-existing in
  `test/`, identical set before and after the change; zero in `src/`.
- `npm test` in `packages/studio/core` — 43 files, 400 tests passing.

A Rust rebuild is not required: the change is entirely JS/TS. The engine state
schema's byte layout is an output-side concern of the JS SyncStream writer, which
assigns fields by name; the Rust-side `write_engine_state` and its byte-offset
constants are untouched.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
