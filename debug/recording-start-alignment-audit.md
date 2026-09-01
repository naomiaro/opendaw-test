# Recording Start-Alignment Audit — campaign register & results

**Title:** Recording Start-Alignment Audit — campaign register & results

**SDK Pin:** `@opendaw/studio-sdk@0.0.170` (installed npm package; WASM engine only)

**Harness:** unlisted debug demo `recording-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>`
on the dev server (`?scenario=probe` runs the same-context loopback feasibility probe
instead of the matrix). Measurement library: `src/lib/audit/recordingAlignment.ts`;
calibration constants: `src/lib/audit/recordingAuditCalibration.ts`. WAV
(`recaudit-<scenario>-<bpm>-<rate>-r<repeat>.wav`) and JSON
(`recaudit-summary-<timestamp>.json`) uploads land in `.verify-output/` via the dev
server's `/__verify` sink.

**Design Spec:** `docs/superpowers/specs/2026-09-01-recording-start-alignment-audit-design.md`
(deleted in the PR that completes this work, per repo convention — recovery:
`git log --all --oneline -- 'docs/superpowers/specs/*recording-start-alignment*'`)

## Predicted upstream signatures (spec §1)

Predictions derived from code analysis of `packages/studio/core/src/capture/RecordAudio.ts`
(0.0.170) plus prior local loopback calibration measurements — predictions to test, not
truths.

| ID | Failure mode | Predicted upstream signature |
|----|--------------|------------------------------|
| A | Take anchored at first-*observed* position, not the start position. `Recording.wasStartingAt()` exists upstream (added for issue #183) but is never consulted here. | Head of the performance cut off the downbeat / shifted; loss grows with main-thread observation lag. Content before the first callback exists in the capture buffer but the placed region skips it. |
| B | `numberOfFrames` ring-reader delivery lag used as the elapsed-capture clock. | Random ~±15 ms placement band across repeated nominal recordings. |
| C | No bounded wait for an audio-thread anchor before creating the take — the laggy fallback is accepted immediately. | Under main-thread load, take placement errors of ~50–235 ms. |
| D | Loop-wrap takes: rendered audio of each wrapped cycle emerges one voice-crossfade + one render quantum late (`BlockFlag.discontinuous` restarts voices behind a ~10 ms fade), uncompensated. | Each wrap take's content lands ~20–24 ms late within its window, flat across consecutive takes (not accumulating). |

## Scenario → prediction map

| Scenario | Provokes | Procedure |
|----------|----------|-----------|
| `nominal-start` | B | Arm, start recording from bar 1 with an idle main thread. |
| `janked-start` | A + C | Same, but a synchronous busy-loop blocks the main thread from just before the record trigger until well past the expected first callback (150 ms). |
| `midtimeline-start` | A | Transport already playing; recording engaged mid-timeline. |
| `countin-start` | A/B interaction | Recording with a 1-bar count-in. |
| `loop-wrap` | D | Loop region active; record 5 consecutive wrap takes; per-take content lateness measured independently. |

Matrix: 2 sample rates (44100, 48000) × 2 BPMs (120, 97.3) × 5 scenarios × 3 repeats
(5 for loop-wrap's take count), live-only.

## Outcome summary

_(filled in Step 5 — triage)_

## Bring-up calibration

_(filled in Step 2)_

## Matrix results — 48000 Hz

_(filled in Step 3)_

## Matrix results — 44100 Hz

_(filled in Step 4)_

## Triage

_(filled in Step 5)_
