# Issue draft — loop-recording sessions frequently never finalize

**WITHDRAWN (Task 9, 2026-09-02) — do not file; the accompanying PR fixes it.** Root cause found on the installed build with instrumentation (register, Task 9 section): when a take's live duration is still ≤ 0 at stop — the case right behind a loop wrap — `RecordAudio`'s stop path deletes the region and never calls `RecordingWorklet.limit()`, so `#finalize` never runs (persisted per-repeat probe `recaudit-summary-1788327757434.json`: 4 of 6 repeats hung, all four with no `limit()` call and the loader still in `record`; both finalized repeats had exactly one call). The reworked branch always finalizes the file for the takes that remain: 0 of 12 branch repeats hung against 10 of 12 upstream (`…1788324358634`, `…1788324856598` vs `…1788310164556`, `…1788310817094`). Kept for history; the text below is as it stood before withdrawal.

**Status (superseded): DRAFT for user review. Not filed.** Target: `andremichelle/openDAW`.

## Title

Loop recording frequently never finalizes: the sample import either completes in under
100 ms or never completes at all

## Symptom

Stopping a loop recording that produced several wrap takes often leaves the session
permanently unfinalized. The takes' shared `AudioFileBox` never reaches a usable state
and its `SampleLoader` never emits a terminal state, so anything waiting on finalization
waits indefinitely. In the measurement harness the wait is bounded by a 30 s deadline and
the repeat is recorded as `finalizing: finalization timed out after 30s`; without such a
deadline the wait does not end.

The regions exist on the timeline from the recording itself; what never arrives is the
imported sample behind them.

## It is binary, not slow

This is the part that distinguishes it from a deadline being set too tight. Every
finalization either completes in well under a tenth of a second or does not complete at
all. There is no middle.

Successful finalizations that persist a duration:

| population | duration |
|---|---|
| fresh unfixed runs, the two repeats that succeeded | 72 ms and 91 ms |
| 12 repeats on a build carrying the accompanying placement fix | 64–98 ms |

Against a 30 s deadline, that is nearly three orders of magnitude of headroom.

**Tripling the deadline changes nothing.** A diagnostic run widened the wait from 30 s to
90 s (`recaudit-summary-1788291343233.json`, 48000 Hz): **4 of 6 repeats still timed out**
— 3 of 3 at 120 bpm and 1 of 3 at 97.3 bpm — with the error text updated to
`finalization timed out after 90s`. The deadline was reverted afterwards, because the
longer one bought nothing but wall-clock time.

## Measured signature

| population | failures | artifacts |
|---|---|---|
| five campaign runs that attempted `loop-wrap` | **18 of 27** | `recaudit-summary-1788287951691.json`, `…1788288625777.json`, `…1788288803959.json`, `…1788291343233.json`, `…1788291706370.json` |
| fresh matrix runs, both rates | **10 of 12** | `recaudit-summary-1788310164556.json`, `…1788310817094.json` |

Per-rate split of the fresh 10 of 12: **5 of 6 at each rate**.

Per cell, of 3 repeats each:

| run | rate | bpm | failed |
|---|---|---|---|
| `…1788310164556` | 48000 | 120 | **3 of 3 — every repeat lost** |
| `…1788310164556` | 48000 | 97.3 | 2 of 3 |
| `…1788310817094` | 44100 | 120 | 2 of 3 |
| `…1788310817094` | 44100 | 97.3 | **3 of 3 — every repeat lost** |

So two of the four fresh loop-wrap cells produced no usable measurement at all. There is
no clean bpm or rate correlation across the wider set either: per-cell failure rates
range from 33 % to 100 % across different runs at both rates and both tempi, which reads
as an intermittent timing-dependent condition rather than one keyed to a particular
configuration.

Every failing row across every run carries one of exactly two error strings, differing
only in the deadline that was configured at the time:

```
finalizing: finalization timed out after 30s
finalizing: finalization timed out after 90s
```

This was checked on every failing row individually, not spot-checked. No other failure
mode appears on any `loop-wrap` row anywhere in the campaign.

## What is known about where it stalls

Precisely this much, and no more:

- It is specific to `loop-wrap`. The other four single-capture scenarios in the same
  harness, same code path up to the wrap, do not show it.
- A `loop-wrap` session has exactly **one** `RecordingWorklet` and therefore exactly one
  `SampleService.importRecording` call for the entire multi-wrap sequence — all its takes
  share one `AudioFileBox` by construction. So this is not a collision between two
  concurrent imports; there is structurally only one import per session. (A separate,
  distinct defect does cause exactly such a collision, but it requires two armed
  captures, which loop-wrap does not have. That one is filed on its own and does not
  explain this.)
- The distinguishing property of a `loop-wrap` finalization against the other scenarios
  is the size and shape of what it imports: one larger, multi-wrap shared buffer rather
  than a single take's.
- **Root cause not identified.** No live in-flight inspection of the finalization
  pipeline was achieved. The React-fiber live-inspection technique that works elsewhere
  does not apply to this harness, because its `project` and `audioContext` are local
  closures inside an async function rather than React state, so there was nothing to walk
  while a hang was in progress.

## A build carrying the accompanying placement fix does not reproduce it — unexplained

A build carrying the changes in the accompanying take-placement submission finalized
**12 of 12** `loop-wrap` repeats successfully across both rates
(`recaudit-summary-1788299505584.json` 48000 Hz and `…1788299943226.json` 44100 Hz,
3 repeats × 2 bpms each), in 64–98 ms.

**No mechanism linking those changes to the finalization pipeline was identified.** They
do not touch that pipeline's code. The clean sweep is a measured outcome, not a traced
fix, and 12 repeats is not a large population against a condition whose per-cell rate
varies from 33 % to 100 %. **This issue is therefore filed on its own footing**: the hang
may well still be present and merely not provoked under those conditions, and it should
not be considered addressed by that submission.

## Repro

The harness is an unlisted debug demo in a separate repository, served from a local
HTTPS dev server — **there is no public URL.**

```
recording-alignment-audit-debug-demo.html?scenario=loop-wrap&bpm=all&rate=<44100|48000>
```

The scenario sets a 2-bar loop area, records 5 consecutive wrap takes, then stops and
waits for the shared file's loader to reach a terminal state. Run it several times: the
rate is intermittent per cell, and roughly two thirds of attempts across the campaign
never finalized.

All the measurements above were taken through that harness, and no attempt was made to
reproduce it anywhere else — so nothing here establishes what an application built on
the SDK would see. What the harness adds is only the bounded wait that turns an
indefinite wait into a reported timeout; the code path under it is the SDK's own
`RecordingWorklet` finalization.

## Environment

`@opendaw/studio-sdk@0.0.170`, WASM engine, Chrome, macOS. Measured at 44100 and
48000 Hz, 120 and 97.3 bpm.

## Notes

Full campaign register, including the deadline diagnostic and the per-run tally:
https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md
(section "C2: `loop-wrap` finalization timeout — characterized, not resolved")
