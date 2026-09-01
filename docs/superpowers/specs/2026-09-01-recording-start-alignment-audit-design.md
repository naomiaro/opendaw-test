# Recording Start-Alignment Audit — Design

**Date:** 2026-09-01
**Status:** Approved design, pre-implementation
**SDK under test:** `@opendaw/studio-sdk@0.0.170` (upstream openDAW)
**Successor to:** the sample-rate/quantum-alignment audit campaign (#122), whose register
explicitly left the adversarial main-thread-jank scenario (S24) and audio-content
cross-correlation (S22) unexercised.

## 1. Problem

Live audio recording in the SDK places each take on the timeline using two main-thread
observations made in the first position callback after `isRecording` flips:

- `recordingWorklet.numberOfFrames / sampleRate` — the ring-buffer *reader's* frame
  counter, which trails the audio thread by a delivery lag (measured random ~±15 ms
  even on an idle main thread), and
- `currentPosition` — the transport position *as first observed on the main thread*,
  which can be tens to hundreds of milliseconds past the position recording actually
  started when the main thread is busy.

Code analysis of `packages/studio/core/src/capture/RecordAudio.ts` (0.0.170) plus prior
local loopback calibration measurements predict four concrete defect classes:

| ID | Failure mode | Predicted upstream signature |
|----|--------------|------------------------------|
| A | Take anchored at first-*observed* position, not the start position. `Recording.wasStartingAt()` exists upstream (added for issue #183) but is never consulted here. | Head of the performance cut off the downbeat / shifted; loss grows with main-thread observation lag. Content before the first callback exists in the capture buffer but the placed region skips it. |
| B | `numberOfFrames` ring-reader delivery lag used as the elapsed-capture clock. | Random ~±15 ms placement band across repeated nominal recordings. |
| C | No bounded wait for an audio-thread anchor before creating the take — the laggy fallback is accepted immediately. | Under main-thread load, take placement errors of ~50–235 ms. |
| D | Loop-wrap takes: rendered audio of each wrapped cycle emerges one voice-crossfade + one render quantum late (`BlockFlag.discontinuous` restarts voices behind a ~10 ms fade), uncompensated. | Each wrap take's content lands ~20–24 ms late within its window, flat across consecutive takes (not accumulating). |

The campaign has three goals:

1. **Measure** upstream 0.0.170 against these predictions with enough precision to
   support upstream issue filings (repro + measured signature, per the repo's
   issue-filing convention).
2. **Discover additional issues**: every measured deviation that matches no predicted
   signature is classified `investigate`, not discarded.
3. **Verify candidate fixes**: re-run the identical harness against a locally built
   candidate SDK dist and confirm every defect cell flips to `aligned` with no
   regressions — the operational definition of "complete and correct".

## 2. Out of scope

- VST-related recording paths.
- `InputLatency.resolve()` semantics (sentinels, negative overrides) — a configuration
  surface, deliberately excluded.
- Real hardware round-trip latency (speaker→mic). The digital loopback below removes
  the air gap by construction; absolute device latency is not what this campaign
  measures.
- MIDI recording. Noted in passing from code inspection: upstream
  `RecordMidi.ts:50` falls back to `outputLatency ?? 10.0` — 10 *seconds*, shifting
  MIDI takes 10 s early on browsers that report no `outputLatency`. Trivially provable
  from code; a candidate for a standalone issue filing, but not exercised by this
  harness.

## 3. Architecture

### 3.1 Signal path: digital loopback

An injection layer, installed **before SDK initialization**, patches
`navigator.mediaDevices.getUserMedia` to resolve with the stream of a
`MediaStreamAudioDestinationNode` in the same `AudioContext`. Two references feed that
node, band-separated so a single recording carries both:

- **Engine metronome loopback (low band).** The engine worklet's output 0, with the
  metronome enabled, routed (through a lowpass) into the fake mic. The "performer" is
  the engine itself: it plays exactly what a musician monitoring the engine hears —
  count-in clicks included, wrap-restart lateness included. A correctly-placed take
  maps every metronome click back onto its beat.
- **Context-clock reference clicks (high band).** Short ~4 kHz tone bursts scheduled at
  exact, recorded `AudioContext` times (regular grid, schedule retained as ground
  truth). These provide an absolute context-clock ruler, give every click an identity
  (index in the schedule), and therefore prove head/tail truncation: a first-recovered
  click with index > 0, or a missing final click, is missing recording data regardless
  of placement magnitude.

Any placement error measured through this path is SDK-internal by construction: no
hardware, no OS capture stack, no air gap.

`enumerateDevices` is patched alongside to advertise one synthetic input device so the
capture-arming flow behaves normally. Monitoring stays off (no feedback path — the fake
mic feeds only the recording worklet).

### 3.2 Scenarios (the provocations)

| Scenario | Provokes | Procedure |
|----------|----------|-----------|
| `nominal-start` | B | Arm, start recording from bar 1 with an idle main thread. |
| `janked-start` | A + C | Same, but a synchronous busy-loop blocks the main thread from just before the record trigger until well past the expected first callback (jank duration a per-cell parameter, e.g. 150 ms). |
| `midtimeline-start` | A | Transport already playing; recording engaged mid-timeline, where the observed-position anchor error is largest. |
| `countin-start` | A/B interaction | Recording with a 1-bar count-in; verifies the `countInSeconds` arm of the offset math and that the count-in boundary loses no content. |
| `loop-wrap` | D | Loop region active; record 5 consecutive wrap takes; per-take content lateness measured independently. |

Every scenario also runs the head/tail integrity check. Each scenario repeats ≥3× per
cell so the error *distribution* is visible — a random band implicates B, a constant
offset implicates A/D. That distinction is part of the verdict, not an afterthought.

### 3.3 Matrix

2 sample rates (44 100, 48 000) × 2 BPMs (120, 97.3) × 5 scenarios × ≥3 repeats.
Live-only — recording cannot be offline-rendered. The failure modes are load- and
timing-driven, not rate-arithmetic-driven (the previous campaign already swept rate
arithmetic), so the matrix stays modest.

### 3.4 Measurement pipeline

After a take finalizes:

1. Read the placed region's `position` (PPQN → seconds via the tempo map) and
   `waveformOffset`, plus the finalized sample data.
2. Detect onsets separately in the low band (metronome) and high band (reference
   clicks), reusing `src/lib/audit/onsetDetection.ts` with band-filtered input.
3. Map each onset's file time to timeline time:
   `timelineSeconds = regionStartSeconds + (fileTime − waveformOffset)`.
4. Match metronome onsets to their nearest beat (error = signed distance, ms) and
   reference clicks to the retained schedule. The schedule uses unique growing gaps
   (gap between click *i* and *i+1* = base + *i*·increment), so any two consecutive
   recovered clicks identify their schedule indices, which recovers the capture
   buffer's context-time anchor T0 = scheduled time − file time. Head/tail integrity
   compares T0 and T0 + buffer duration against the context times recorded at the
   record/stop requests.
5. Telemetry recorded per take: `position`, `waveformOffset`, per-take
   `waveformOffset` deltas (loop-wrap), final-take buffer overshoot, first/last
   recovered click indices.

### 3.5 Verdict model

Per cell, from the matched-onset error set:

- `aligned` — |median error| within the calibrated tolerance (floor ~2 ms, final values
  calibrated during bring-up as in the previous campaign) and head/tail integrity
  clean.
- `matches-known-defect` — error matches a predicted signature (A–D) in scenario,
  direction, and magnitude band.
- `investigate` — anything else: unexpected magnitude, wrong direction, accumulation
  where flatness was predicted, missing content with aligned placement, etc. This is
  the additional-issues funnel; `investigate` cells get individual follow-up before the
  campaign closes.

Tolerances and predicted-signature bands live in `src/lib/audit/` calibration constants
alongside the existing campaign's. The signature bands are treated as *predictions to
test*, not truths: a systematic mismatch updates the register, not the data.

### 3.6 Harness page

Unlisted debug demo per repo convention: `recording-alignment-audit-debug-demo.html` +
`src/demos/recording/recording-alignment-audit-debug-demo.tsx`, `noindex`, not in `src/index.tsx`
or the sitemap. Self-classifying in-page results table (per-cell verdict, error stats,
integrity flags), stage-trail/deadline self-classification (OK/HUNG/THREW) per the
established debug-demo pattern, JSON + WAV export to `.verify-output/`. Scenario/cell
selection via query params (`?scenario=…&rate=…&bpm=…` with `all` supported) so
browser-automation runs are scriptable. Transport start requires a real trusted click;
the run protocol documents the visibility-freeze pitfall.

### 3.7 Fix-verification mode

`vite.config.ts` gains a neutral, committed mechanism: when an `SDK_DIST_OVERRIDE` env
var is set, `@opendaw/*` package imports alias to the dist directories under the given
path; unset, the installed npm SDK is used untouched. The candidate-build directory
itself is local-only (path noted in `.claude/local.md`, never in committed docs).

Verification criteria:

- every upstream `matches-known-defect` cell flips to `aligned`;
- no cell regresses from `aligned` to anything else;
- head/tail integrity clean everywhere.

Failures of the harness *glue* against the candidate build (API drift — the candidate
build tracks a slightly older SDK base) are harness work, not findings, and are fixed
in the harness with the upstream path re-verified afterwards.

**Public wording rule:** the committed register and any upstream filings describe this
only as "a candidate-fix build was verified locally". The build's origin is never
named in committed or posted text.

## 4. Deliverables

1. This spec (deleted in the PR that completes the work, per repo convention).
2. Measurement utils in `src/lib/audit/` (schedule matching, band-split onset mapping,
   verdict classification) — TDD'd with vitest.
3. The unlisted harness page.
4. Campaign register `debug/recording-start-alignment-audit.md`: predictions, per-cell
   results for upstream and candidate builds, verdict tally, `investigate` follow-ups.
5. Upstream issue drafts as md files under `debug/drafts/` for user review before any
   posting (repro URL + register link + measured signature; no suggested-fix sections).

## 5. Risks

- **Jank realism:** a synchronous busy-loop is a coarse model of real main-thread load;
  if it fails to reproduce the C-class magnitudes, the fallback provocation is
  repeated long tasks via `MessageChannel` flooding. The register records which
  provocation produced each measurement.
- **Metronome-band overlap:** if the metronome click's spectrum bleeds into the 4 kHz
  reference band, the reference moves higher (6–8 kHz) during bring-up calibration.
- **Injection feasibility (known prior failure):** `src/demos/recording/CLAUDE.md`
  records that a `getUserMedia` override returning a `MediaStreamAudioDestinationNode`
  stream read as SILENT when consumed **cross-AudioContext**, and that a shared dest
  stream dies when a consumer stops its track. This campaign uses the same-context
  topology (dest node created in the SDK's own AudioContext, `stream.clone()` handed
  out per call) and gates all harness work behind an explicit feasibility probe
  (implementation plan Task 1). Probe failure stops the campaign for a fallback
  decision (real-mic loopback protocol, or a virtual audio device).
- **Candidate-build API drift** vs the 0.0.170 demo glue (see 3.7).

## 6. Success criteria

- Matrix runs to completion on upstream with every cell classified (no `run-failed`).
- Each predicted signature A–D is either confirmed with a measured magnitude or
  explicitly refuted in the register.
- All `investigate` cells triaged (harness artifact vs candidate new issue) before the
  campaign closes.
- Candidate build passes the verification criteria in 3.7, or the register documents
  precisely which criterion failed and how.
