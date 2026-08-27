# Sample-Rate / Quantum-Alignment Audit — Design

**Date:** 2026-08-27
**Status:** Approved design, pre-implementation
**Motivation:** openDAW#367 (count-in boundary click) is a quantum-alignment bug that
is masked at 48 kHz / 120 BPM and always audible at 44.1 kHz — the maintainer likely
tests on "kind" configurations. This campaign systematically hunts the whole bug class
and establishes a permanent cross-rate regression harness.

## Goal

Production-level assurance that the openDAW engine (WASM, SDK 0.0.170) and the live
recording glue behave correctly across sample rates, via a **full empirical
differential matrix** (Approach B) with a static suspect register in a supporting
triage role. Confirmed bugs become debug notes + upstream issues; cleared cells become
recorded assurance; the harness becomes the standing SDK-upgrade regression sweep.

## Scope

- **In:** the Rust engine crates (`crates/engine`, `crates/transport`,
  `crates/value`, metronome, audio_region_player, signature_track, time-stretch
  paths) at the installed tag `@opendaw/studio-sdk@0.0.170`, AND the
  **studio-core recording/finalization glue** — live TypeScript
  (`RecordAudio.ts`, capture, finalization, waveformOffset/duration math), distinct
  from the REMOVED TS engine (the DSP renderer deleted upstream in 0.0.161, which
  appears only as a historical baseline in regression framing).
- **Out:** the studio app UI, the deprecated TS engine, non-audio subsystems.
- **Evidence bar:** upstream issues are filed only for empirically confirmed
  findings (measured deviation from analytic expectation). Source-level-only
  suspicions stay in the campaign debug note as open questions.

## The matrix (Approach B backbone)

- **Sample rates (4):** 44 100, 48 000 (primary differential pair), 88 200, 96 000
  (×2 rates catch quantum-duration scaling bugs).
- **BPMs (5):** 120 (48k-exact control), 90, 124, 133 (prime), 97.3 (fractional —
  maximal float stress).
- **Scenario families:** offline — metronome/count-in cadence (incl. #367 as a
  known-positive harness-validation row), loop-wrap timing over N cycles
  (accumulation drift), region butt-seams (0.0.165 self-crossfade continuity,
  known-clean control row), region start/end fenceposts (mid-timeline starts,
  loopOffset/waveformOffset reads), note-onset scheduling, automation event landing,
  tempo-map conversions under tempo automation, signature changes (3/4↔4/4 accents),
  transport ops (setPosition mid-block, stop declick). Live-only — the recording
  path via `new AudioContext({sampleRate})` forced-rate sessions with the real mic
  (count-in offset, take boundaries at wrap, waveformOffset math).
- **Judgment:** every cell is compared against an **analytic expectation**
  (event times computed from BPM/PPQN math) — never only against other rates (two
  rates agreeing proves nothing). ~180 offline renders, run in batches.

**Tolerance model:** exact-math families (note onsets, automation landings)
≤ 1 sample deviation; block-granular mechanisms ≤ 128 samples but must be
rate-consistent — the bug signature is deviation that CHANGES with sample rate.

## The harness

One unlisted debug page (`samplerate-audit-debug-demo`, noindex, root-HTML repo
convention, not in index/sitemap) that:

1. Builds each scenario programmatically in a fresh project.
2. Renders through `OfflineEngineRenderer` at the requested rate.
3. Extracts event onsets in-page (transient/click detection on the rendered buffer,
   plus the seam-Δ metric from `src/lib/offlineScan.ts`).
4. Emits verdict rows `{family, bpm, rate, events[], expected[], deviations[]}` into
   an on-page accumulating table, exportable as JSON; suspicious cells export WAVs
   for audio-analyzer MCP deep analysis (audio-verify skill pattern).

Browser automation drives the matrix in batches. Verdicts are pure data — re-runs are
cheap and comparable across SDK upgrades (standing regression value).

**Harness validation before any matrix conclusions:** the #367 row must detect the
boundary click at 44.1 kHz/120 BPM (and show the 48 kHz ambiguity), and the 0.0.165
seam-transparency control row must pass. A harness that can't reproduce the known
positive and known negative produces no trustworthy verdicts.

## The suspect register (Approach A in support)

A static sweep of the in-scope code, classified by bug class:

- **C1** — per-quantum boundary decisions tested against block START
  (`position >= X` once per quantum): loop wrap, marker actions, stop-at-end, clip
  launch, punch-in/out.
- **C2** — float pulse accumulation (`p1 = p0 + samples_to_pulses(128, …)`) compared
  against exact PPQN targets (loop_to, region ends, automation positions).
- **C3** — floor/ceil/round fenceposts in pulses↔samples conversions (metronome's
  `ceil`/`js_round` pattern in other schedulers).
- **C4** — seconds-based windows truncated per rate (`(0.020 * sr) as i32`, click
  fades, release tails) and hard 128-quantum assumptions.
- **C5** — recording-glue float-seconds math (waveformOffset composition, take
  duration accumulation, `sec × sampleRate` roundings).
- **C6** — linear-interpolation resampling bounds (readers touching `frame[i+1]`).

Each register entry: site (file:line at the 0.0.170 tag), class, alignment condition,
provoking scenario. The register triages matrix divergences: a matching entry must
**predict** the measured deviation (which rates, which BPMs, what magnitude) before a
finding is called confirmed — the #367 precision lesson, institutionalized.

## Triage & publication

- Divergence → register match (or focused deep-dive) → classify: **bug** (deviates
  from analytic expectation, rate-dependent), **tolerance artifact** (fix the
  harness), or **by-design** (recorded, not filed).
- **Fixed-on-main gate:** diff the responsible code against upstream `main` before
  filing; already-fixed findings become "upgrade and re-verify" notes.
- **Campaign debug note** `debug/sample-rate-alignment-audit.md`: the register, the
  full verdict matrix, cleared suspects (ruled-out is a result), open questions.
- Per confirmed bug: its own debug note + a drafted issue body in `debug/drafts/`
  for **user review before posting** (convention: measured signature + cause
  analysis, NO suggested-fix section). File only on approval; cross-link issue
  numbers back into notes.

## Phases

1. **Static sweep** → suspect register (parallel readers over crates + recording
   glue; register lands in the campaign note).
2. **Harness build** → debug page, onset extraction, analytic expectations, verdict
   JSON; validated by the #367 known-positive and the seam known-clean rows.
3. **Matrix run** → offline families × 5 BPMs × 4 rates, batched.
4. **Triage** → root-cause divergences, classify, focused re-runs.
5. **Recording-path live runs** → forced-rate AudioContext sessions (real mic).
6. **Publish** → campaign note, per-bug notes, draft issues for review, file on
   approval; document the harness as the standing SDK-upgrade regression sweep
   (CLAUDE.md pointer).

## Non-goals

- No engine fixes in this repo (findings go upstream).
- No auditing of the removed TS engine or the studio app UI.
- No issue filed without a measured, register-predicted signature.
- The harness page stays unlisted (no index card, no sitemap, no og-image).

## Risks / notes

- Offline rendering fidelity: `OfflineEngineRenderer` must actually honor arbitrary
  sample rates — Phase 2 verifies this first (render a trivial scenario at 44.1k and
  check buffer length math) before building the matrix on top.
- Onset detection is itself fenceposty — the known-positive/known-negative
  validation rows exist precisely to calibrate it.
- Recording-path live runs depend on mic + browser session quality; they run last
  and their scope is the C5 measurements only.
- 97.3 BPM cells may produce block-granular deviations that are correct-but-odd;
  the rate-consistency rule (not absolute deviation) is the bug discriminator.
