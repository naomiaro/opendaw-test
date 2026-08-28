# Sample-Rate / Quantum-Alignment Audit — campaign register & results

**Title:** Sample-Rate / Quantum-Alignment Audit — campaign register & results

**SDK Pin:** `@opendaw/studio-sdk@0.0.170` (openDAWOriginal checkout at that tag, swept 2026-08-27)

**Harness:** unlisted debug demo `samplerate-audit-debug-demo.html?family=all&bpm=all&rate=all` on the dev server; calibration in `src/lib/audit/auditCalibration.ts`. WAV and JSON uploads land in `.verify-output/` (visible in the dev server's `.superpowers/` path)

**Design Spec:** retired per repo convention (recovery: `git log --all --oneline -- 'docs/superpowers/specs/*samplerate*'` → `git show <sha>:<path>`)

## Outcome summary

**Matrix:** 180/180 offline cells pass — 9 families (metronome, loop-wrap, seam,
region-fencepost, note-onsets, automation, tempo-ramp, signature, transport-pos) x 5
BPMs (90, 97.3, 120, 124, 133) x 4 rates (44100, 48000, 88200, 96000), 0 errors, 0
run-failed families. Reached clean only after two harness-artifact fixes mid-campaign
(register S27, S28: a rate-dependent onset-detector hop size and a bpm-dependent
refractory window vs. Vaporisateur's release ring — both isolated to
`src/lib/audit/onsetDetection.ts`/the demo's `ONSET_OPTIONS_BY_FAMILY`, never to engine
or SDK code, and both re-run 40/40 clean). Tolerances are calibrated per family, not a
single fixed number: a 2 ms floor for 8 of the 9 families (`AUDIT_TOLERANCES`), 4.236 ms
for `tempo-ramp` (2x the signed post-calibration residual, which grows toward a ramp's
end by design — the engine applying a continuous tempo curve at finite block
granularity, not a bug). `seam` is judged separately, against per-rate amplitude
thresholds (`SEAM_THRESHOLDS`: 1.12–2.46 ms, 5x the measured 0.0.165-transparent
clean-splice step at that rate) rather than the tolerance table.

**Live recording path:** clean. All three multi-take loop-recording cells (44.1 kHz/120
BPM, 48 kHz/120 BPM, 44.1 kHz/97.3 BPM) show consecutive `waveformOffset` deltas and the
final-take buffer-overshoot within <0.1 sample of the ideal tempo-math/RenderQuantum
bound, with no growth by take number.

**#367 (known exemplar):** confirmed live at 44.1 kHz (5-click count-in boundary leak,
matches the predicted signature exactly); already filed upstream, not re-reported here.
48 kHz attempt was inconclusive due to browser-automation tooling limits, not a negative
finding.

**Register tally (28 numbered suspects + the #367 exemplar), final status:**
- **cleared** — 3: S8, S9 (matrix — `quantize_ceil`/position-summation confirmed
  by-design), S26 (live — `audioContext.sampleRate` matched the requested rate exactly
  in every session, no context/engine mismatch)
- **confirmed (nominal case only)** — 1: S24 (final-take buffer-overshoot bounded under
  1.1 samples in both nominal cells measured; the adversarial main-thread-jank scenario
  the register itself calls out remains untested)
- **harness-artifact (fixed 2026-08-27)** — 2: S27, S28 (see Matrix note above)
- **open (not exercised)** — 22: S1–S7, S10–S23 (excluding S24), S25 — including one
  partial match (S15: right rate, ~40x off on magnitude — held to `open` per the "predict
  rate + BPM + magnitude" evidence bar) and S22 (mechanism consistent w/ code; magnitude
  unmeasured — the specific predicted divergence needs audio-content cross-correlation
  this campaign did not perform)
- **known exemplar, confirmed + filed** — 1: #367 (not a numbered suspect)

**Zero new confirmed engine bugs — no new upstream issues met the evidence bar.** Every
`investigate` cell the matrix produced traced to a harness detector artifact (S27/S28),
not an SDK bug; the one register suspect a live measurement could have confirmed as a
genuine defect (S24) instead confirmed the nominal-case bound the code's own comment
already assumes, and S26 confirmed a by-design invariant. S15's rate-direction match
falls short of the magnitude bar. What WOULD change this: the 22 open suspects are open
because their specific provoking scenarios were never exercised by this campaign's 9
offline families or 3 live cells — not because they were tested and passed. New
scenario families targeting degenerate loop/marker widths (the S5/S6 hang suspects) and
forced tempo/loop/marker split-block placement (the S14/S16/S17 divergence suspects)
would be the concrete next step to actually exercise the highest-risk open items; see
below.

### Open questions / future scenario ideas

- **S5/S6** — transport hang risk on sub-sample-width loop/marker sections
  (`transport.rs:252-260`/`284-306`): `emit_until`'s floored `s1` can equal `s0` forever
  on a loop or `plays==0` marker section narrower than one sample-in-pulses, with no
  de-dup guard (unlike the `Tempo` action). Needs a scripted loop/marker scenario with a
  sub-sample pulse-width region, run under a per-call render deadline/watchdog — the
  harness itself would hang without one, which is why this was never exercised offline.
- **S14/S16** — audio-region-vs-note-onset placement divergence inside a block a
  tempo-automation grid tick, loop wrap, or marker jump also splits (`emit_until`'s
  floored sample span vs. the block-local ratio formula in
  `audio_region_player.rs:879-884`). Needs a scenario that deliberately forces a region
  start or note-on to land inside a split block — the current families place events
  independent of split-tick timing, so this path was never hit.
- **S15** — sub-sample truncation bias in note-on placement (`lib.rs:1174-1184`);
  directionally confirmed (44.1 kHz shows the largest residual in `note-onsets` at 4 of 5
  bpms) but ~40x too large in magnitude to attribute to this mechanism alone. Needs a
  finer-resolution, per-cell (not per-family-scalar) calibration to isolate this specific
  bias from what `AUDIT_CALIBRATION`'s single 48 kHz-control-row scalar leaves
  uncorrected at 44.1 kHz.
- **S20/S21/S23/S25** — recording-glue C5 paths Task 9's 3 live cells didn't isolate.
  S20 needs a `settings.recording.inputLatency=0` control to separate `headStartSeconds`
  from `inputLatency`; S21 needs a live output-device switch (e.g. Bluetooth handoff)
  mid-session; S23/S25 are cosmetic-only (live waveform-painter jitter, no persisted
  artifact) and would need frame-by-frame canvas inspection during/just after recording.
- **Spec narrowings (not implemented this campaign):** the design spec's transport-ops family also listed a "stop declick" scenario (render around transport stop and measure the declick window per rate) — future work. The spec placed #367's known-positive in offline harness validation, but moved here to the live phase because count-in cannot render offline (recording-transport feature); the offline detector check was covered by the `shiftExpectedMs` knob instead.

## Known exemplar (filed, not re-reported)

**openDAW#367** — count-in→recording boundary click at `crates/engine/src/lib.rs:1468-1471` (if-guard on quantum-start position) + forced metronome restoration at `lib.rs:1799`. Static audit confirms present and unchanged at 0.0.170. See also: [countin-metronome-boundary-click.md](countin-metronome-boundary-click.md).

## Suspect register

Merged from five static audits (2026-08-27), grouped by source area. Statuses reflect final outcomes from matrix and live phases: 3 cleared, 1 confirmed (nominal case), 2 harness-artifact (fixed), 22 open (not exercised).

| ID | file:line | area | class | what it decides | alignment condition (misbehaves when…) | provoking matrix scenario | predicted measurable signature | status |
|---|---|---|---|---|---|---|---|---|
| S1 | `lib.rs:1481` | engine-lib | C1 | Whether an AUTOMATED solo curve silences/unmutes other mixer strips this quantum — resolved ONCE, from `transport.position()` read at the quantum's **start**, before `transport.render_quantum` advances the playhead through this quantum's blocks. | Same shape as the #367 exemplar: a solo-automation crossing that lands inside `[quantum_start, quantum_start + quantum_pulses)` is invisible until the *next* quantum. Every other strip's mute/audible state for the whole 128-sample block is decided by the position at the block's leading edge, not by where in the block the crossing actually falls. Worse at low sample rates / high BPM (quantum spans more pulses) and on any tempo-ramp block where `quantum_pulses` (computed from *current* bpm) under/over-estimates the true block span. | `automation` family (solo-lane automation event), crossed with `metronome`/`transport-pos` for audibility check. Cells: 44.1k/120bpm (~128/44100*120/60*960≈…, baseline), 48k/120bpm, 44.1k/200bpm (widest quantum in pulses), 96k/120bpm (narrowest quantum, smallest error). | A silenced/unsilenced strip's onset lags the true automation crossing by up to one quantum (≤ 128 samples ≈ 2.9 ms @44.1k, ≈1.3ms @96k). Measurable as a solo-audibility transition boundary offset in a diff-render vs. a sample-accurate reference, magnitude bounded by `RENDER_QUANTUM` samples regardless of BPM (position test is in *pulses* but gates a *sample-domain* strip mix each render call). | open (not exercised) |
| S2 | `lib.rs:854-859` | engine-lib | C3 | The next automation/modulation "update-clock" grid point (10-pulse grid, `UPDATE_CLOCK_RATE`) strictly after `after`, used to advance a device's per-quantum fragment loop. Computed locally as `((after / UPDATE_CLOCK_RATE) as i64 + 1) as f64 * UPDATE_CLOCK_RATE`, with a `position <= after` guard that only nudges forward, never back. | Rust's `f64 as i64` cast **truncates toward zero**, not floor. For any `after < 0` that is **not** an exact multiple of `UPDATE_CLOCK_RATE` (10 pulses), `trunc(after/10)` equals `floor(after/10) + 1`, so the formula computes `R*(floor+2)` instead of the correct `R*(floor+1)` — it overshoots by one full grid step (10 pulses) — and the `position <= after` guard never fires to correct it (the result is already too large, never too small). Contrast: the sibling `dsp::ppqn::first_update_position` has an explicit `if floored < at { +RATE }` correction that happens to compensate correctly for the same truncation quirk; `host_next_update_position`'s guard only compensates the opposite (too-small) direction, so the asymmetry is real, not stylistic. | `automation` / `modulation` family, specifically during **count-in pre-roll**: `prepare_recording_state` (`lib.rs:1614-1641`) seeks the transport to `recording_start - offset`, which is **negative** whenever `recording_start < offset` — i.e. any count-in recording armed at/near timeline position 0 (the single most common count-in scenario: "hit record on an empty bar-1 project with a 1–2 bar count-in"). Cells: bpm 60/120/180 × count-in 1/2/4 bars (all push `recording_start - offset` well below 0), with any device carrying automation or a free-running modulator (`modulation_armed`) so `quantum_transporting()` gates it open. | During the negative pre-roll window, a fragmented automated parameter's value update is delayed by exactly one 10-pulse grid step (skips a fragmentation boundary) — at 120 BPM, 10 pulses ≈ 5.2 ms of stale/held parameter value right when it should have updated. Reproducible deterministically for any `after` in `(-10k-10, -10k)` pulses that isn't itself a multiple of 10; self-corrects once the transport crosses pulse 0 (all `after >= 0` traffic is unaffected — `trunc == floor` there). | open (not exercised) |
| S3 | `lib.rs:1930-1954` | engine-lib | C1 | Whether the free-running modulation clock advances incrementally (`modulators.advance`) or re-anchors (`modulators.anchor`) this quantum — decided from `self.transport.is_playing()`/`position()`/`free_running()` sampled **before** `transport.render_quantum` runs (i.e. using the transport's state as of the *previous* quantum's end / this quantum's nominal start). | The `pauseOnLoopDisabled` path (`lib.rs:1533-1550`) can flip the transport from playing→paused **mid-quantum** (loop end reached partway through the 128 frames), but `advance_modulation` already ran earlier in `render()` using `playing = true` for the whole quantum. The transition is only observed on the *next* quantum's `playing == self.modulation_playing` comparison, forcing an unnecessary re-anchor (a modulator phase jump/discontinuity) one quantum late, right at a stop event where a seamless free-run would be expected. Separately, the continuity tolerance `quantum_pulses * 0.5` is computed from `self.transport.bpm()` (single scalar, quantum-start value), so on a tempo-ramp quantum whose blocks each carry a different `block.bpm`, the tolerance band is only an approximation of the true pulse span rendered. | `loop-wrap` × `pauseOnLoopDisabled=true` (the exact family this project's `pause_on_loop_disabled` control gates) crossed with a bound modulator (LFO/Steps/Random) on an audible parameter; secondarily `tempo-ramp` family (fast tempo-automation curve) × modulation-armed device. | A one-quantum-late re-anchor produces a small but audible modulator phase discontinuity (click/jump in an LFO-modulated parameter) exactly at a `pauseOnLoopDisabled` stop, instead of the tail-out being silent/continuous like the audio path's own release handling. Under a steep tempo ramp, expect occasional false continuity failures/passes near the `0.5×quantum_pulses` tolerance edge — magnitude a fraction of one quantum's modulator advance step. | open (not exercised) |
| S4 | `lib.rs:1175-1184` | engine-lib | C3 | Converts a pulse position within a block to a sample offset (`s0 + pulses_to_samples(pulses, block.bpm, sample_rate) as usize`), used by `host_pulse_to_offset` (arpeggiator/generative event timing) and internally for event placement within the current quantum. | `pulses_to_samples(...) as usize` is a truncating (floor, for positive inputs) cast — always rounds a fractional sample offset **down**, never to nearest. Systematic, one-directional sub-sample bias (up to ~1 sample early) on every non-integer pulse→sample conversion; the epsilon guard (`pulses.abs() < 1.0e-7 → s0`) only protects the exact block-start case, not general fractional offsets. | `note-onsets` family (arpeggiator / generative event scheduling) crossed with sample-rate cells (44.1k vs 48k vs 96k) and BPM cells that produce non-integer pulses-per-sample ratios (nearly all BPM values at nearly all rates). | A systematic ≤1-sample (≈0.02 ms @44.1k) early bias on every generative/arpeggiated note's placement within its block — not audible per-note, but a consistent directional (never late) timing signature distinguishable from random jitter in a high-resolution onset-time histogram. | open (not exercised) |
| S5 | `transport.rs:252-260` → `316-332` | transport | C3 | Whether/when the loop-area end splits the current sub-block and jumps back to `loop_from` | Fires once per pass whenever `p0 < loop_to <= p1`, with NO check that the resulting split has ≥1 sample of width. `emit_until` (line 342) computes `s1 = s0 + pulses_to_samples(action_position - p0, bpm, sample_rate) as i64 as usize` — truncates toward zero. If `loop_to - loop_from` converts to **< 1 sample** at the current bpm/sample_rate (threshold: `samples_to_pulses(1, bpm, sample_rate)` pulses, e.g. 0.04 pulses @ 120bpm/48kHz), `s1 == s0` every pass, `emit_until` never emits a block, `p0` is reassigned to the exact same `loop_from` every iteration, `s0` never advances, and the `while s0 < RENDER_QUANTUM` loop (line 204) **never terminates** — traced by hand: `loop_from=0, loop_to=0.01` pulses, 120bpm/48kHz → `pulses_to_samples(0.01,…) ≈ 0.025` → truncates to 0 samples every pass, forever. Unlike the `Tempo` action (line 307-315), which is self-guarding (`if tempo_at != self.bpm` — the value-changed check prevents re-firing once bpm is already applied, even when `s1==s0`), the `Loop` action has no such de-dup and will re-fire indefinitely on a sub-sample-width loop region. | loop-wrap family, extreme sub-fencepost cell: a loop area whose width in pulses is smaller than one sample's worth at the tested bpm/rate (drag loop handles to near-zero width, or a scripted `set_loop_from`/`set_loop_to` pair a fraction of a pulse apart) | Not a numeric misalignment but a **hang**: `render_quantum` never returns, test/engine call times out, CPU pegs at 100%, position frozen at `loop_from`, zero further audio rendered. A matrix harness without a per-call deadline would appear to "hang" rather than report a signature — needs a watchdog/timeout around this cell specifically. | open (not exercised) |
| S6 | `transport.rs:284-306` | transport | C3 | Whether a marker section replays (jump back to `prev.position`) forever (`plays==0`) or a bounded number of times | Same truncation mechanism as the loop case: `emit_until`'s `s1 = s0 + pulses_to_samples(...) as i64 as usize` can floor to `s1==s0` if the section width (`p0 - prev.position` at the jump) is sub-sample. For `plays > 0` this is self-limiting — the play count still increments every pass and eventually exceeds `prev.plays`, breaking into the fallthrough branch (line 297-300) with no split, ending the spin. For `plays == 0` ("repeat forever", tested in `markers.rs::plays_zero_repeats_the_section_forever` but only with a 10-pulse-wide section) there is no such backstop — a `plays==0` marker whose section width truncates to 0 samples has the same non-terminating potential as the loop case. | marker family, extreme cell: two adjacent markers (or a marker section) with `plays=0` and a position delta below one sample-in-pulses at the tested bpm/rate | Hang, same signature as the loop entry — frozen position, `current_marker` count climbing every logical pass but no wall-clock progress, `render_quantum` never returns. | open (not exercised) |
| S7 | `transport.rs:341-347` | transport | C3 | The sample-domain boundary (`s1`) for every marker/tempo/loop split, from the pulse-domain `action_position` | `pulses_to_samples(...) as i64 as usize` truncates toward zero (floor for positive values) rather than rounding — explicitly intentional (mirrors TS `\| 0`, see `markers.rs:46` comment: "4.88 pulses = 121.99999… samples; the TS `\| 0` truncation (mirrored by `as i64`) floors to 121"). Each split independently floors from the exact pulse-domain `action_position`/`p0` (not accumulated sample-to-sample), so the bias does not compound block-to-block within a quantum — but it does mean a boundary that is conceptually exact in pulse-space (e.g., a marker or tempo-grid position landing exactly on an integer number of samples in real arithmetic) can render 1 sample short due to float noise in the `pulses↔samples` round-trip (seconds intermediate, `* sample_rate` at the end). | region-fencepost / marker / tempo-ramp families at bpm/rate combos that don't divide evenly (e.g. 48000 Hz vs 90.0 bpm, or any non-power-of-two sample rate) | A systematic **≤1-sample floor bias** at every split boundary — visible as `s1` one sample earlier than the "ideal" rounded value in fencepost-style tests, never one sample late. Should reproduce deterministically per (bpm, sample_rate, pulse-position) triple; not a drift (doesn't accumulate across many splits since `p0` is always re-derived from exact pulse values, never from the truncated sample count). | open (not exercised) |
| S8 | `transport.rs:19-26` | transport | C3 | The next tempo-automation grid point (`TEMPO_CHANGE_GRID` = 80 pulses) at or after `p0`, used to decide whether a tempo split falls inside `[p0, p1)` (line 266-267) | `(position / grid) as i64 as f64` truncates toward zero (floor for positive positions), then steps up by one grid unit only if the floored value is strictly less than `position` — i.e., INCLUSIVE ceil: a position that already sits exactly on a grid multiple returns itself, matching the crate-doc reference to `first_update_position` in `crates/dsp/src/ppqn.rs:19-22` (`UPDATE_CLOCK_RATE`/`Fragmentor` semantics) and the loop's own `<=` deviation comment at transport.rs:250-251. This is a SEPARATE reimplementation from `first_update_position` (same shape, different grid constant, duplicated rather than shared) — a latent divergence risk if one is edited without the other, though currently they agree in behavior. | tempo-ramp family, positions exactly on the 80-pulse grid (e.g. seek to a multiple of 80 pulses, then check whether the tempo split fires that same quantum or the next) | If `quantize_ceil` and `first_update_position` ever diverge (e.g. a future edit to one grid's rounding), tempo splits and other update-clock-driven fragmentation (channel-strip automated gains, per the dsp/ppqn.rs comment) would disagree on whether a boundary is "now" vs "next" — currently CLEARED (identical truncate-then-conditional-step logic, verified by reading both), but flagged because they are two independent implementations of the same rule. | cleared (matrix) |
| S9 | `transport.rs:182-187` / `335-336` / `200` | transport | C2 | Long-run pulse position accumulation across repeated 128-sample quanta | `position` is advanced by literal `+=`-style reassignment (`p0 + samples_to_pulses(128, bpm, sample_rate)`) once per quantum, matching the TS `timeInfo.advanceTo` step-by-step summation order exactly (confirmed both by the file-header comment and by `transport.rs` test `per_quantum_accumulation_is_exact`, which asserts `transport.position() == reference` bit-for-bit after 2000 quanta of independent summation). This is standard f64 running-sum drift (ULP-scale per addition), present by design to stay bit-identical with the TS reference implementation — not a Rust-vs-TS divergence. | transport-pos family, long-duration cells (many thousands of quanta) at bpm/rate combos with non-terminating binary fractions (most bpm values) | Any drift here is inherent to floating summation and shared with the TS engine (both accumulate the same way) — CLEARED as a Rust/TS divergence source, but it is the mechanism that would produce whatever slow float drift a long-duration transport-pos matrix cell measures. Predicted signature if isolated: sub-ULP-per-quantum drift, only detectable after very large quantum counts, identical in both engines. | cleared (matrix) |
| S10 | `metronome.rs:200` | metronome-signature | C4 | `distance` (sample offset of a click within its block), via `floor(pulses_to_samples(position-block.p0, bpm, sample_rate))` | any beat whose true continuous-time sample position is non-integer (the generic case for irrational `bpm/sample_rate` ratios — true for every BPM in the matrix except degenerate rate/bpm coincidences) | metronome family, all 4 rates × all 5 BPMs; strongest/most visible at 44100 (largest µs-per-sample) and irrational BPMs (97.3, 133) | every click lands **0 to ~1 sample EARLY, never late**, relative to the analytic ideal — a uniform one-sided bias, not a symmetric jitter. Magnitude = fractional part of the true sample position (rate/BPM/beat-index dependent); measured example: 44100 Hz/97.3 BPM, beat at pulse 960 → true sample 27194.406 → placed at 27194 (−0.406 samples, −9.2 µs) | open (not exercised) |
| S11 | `metronome.rs:136` | metronome-signature | C4 | `fade_out_duration = (0.005*sample_rate) as i32` — the monophonic cut-fade length in samples | `0.005*sample_rate` non-integer | monophonic family at 44100 (`220.5→220`, i.e. the fade is 220 samples = 4.9887 ms, 0.0113 ms short); NOT triggered at 48000/88200/96000 (`240.0/441.0/480.0` all exact) | monophonic overlap-cut fade is ~11 µs shorter than the nominal 5 ms only at 44100 among the matrix rates — a rate-dependent asymmetry in an otherwise rate-independent spec | open (not exercised) |
| S12 | `metronome.rs:45` | metronome-signature | C4 | `attack = (0.002*sample_rate) as usize` — default click's attack length in samples | `0.002*sample_rate` non-integer | default-click envelope at 44100 (`88.2→88`) and 88200 (`176.4→176`); NOT at 48000/96000 (`96.0/192.0` exact) | default 880 Hz/440 Hz click attack is ~4.5 µs (44100) / ~4.5 µs (88200, scaled) shorter than the nominal 2 ms at those two rates only — same rate-dependent asymmetry pattern as the fade | open (not exercised) |
| S13 | `metronome.rs:91,104-113` | metronome-signature | C6 | `ratio = sound_sr/engine_sr` resampling walk; loop exits once `position >= frame_count-1` | uploaded click sound's `sample_rate != engine sample_rate` (any non-unity `ratio`) | any matrix cell using an uploaded (non-default) click sound at a rate where `sound_sr/engine_sr` isn't 1 — most prominently a click authored at one of {44100,48000,88200,96000} played back at a different one | the source's true final frame is only ever used as an interpolation **target** (weight `p_alpha<1`), never rendered at full weight — playback halts ~1 source-frame-equivalent (scaled by `ratio`) before the nominal end. This is a **duration** effect on the click tail, not an **onset** effect; low severity, and matches the ported TS `Click` behavior (see `an_uploaded_click_resamples_from_its_own_rate` test, whose own comment says "stopping at frame_count - 1") — registered as informational, only worth chasing if the harness measures click envelope/tail length rather than onset time | open (not exercised) |
| S14 | `transport.rs:341-347` (`emit_until`) | region-player | C2/C3 | The sample span (`s1`) of a **split** sub-block emitted at a tempo-automation grid tick, loop wrap, or marker jump: `s1 = s0 + pulses_to_samples(action_position - p0, bpm, sr) as i64 as usize`. | The pulse span (`action_position - p0`) is exact; the sample span is *floored* to an integer. So a split block's local ratio `samples/pulses` can differ from the nominal rate `sr*60/(bpm*960)` by up to 1 sample — unlike an ordinary `Action::None` 128-sample block, whose `p0/p1/s0/s1` are all derived from the same unrounded `samples_to_pulses` call and so satisfy the ratio exactly (to float rounding only). | `seam` and `region-fencepost` scenarios that place a region start, or `note-onsets` that place a note-on, inside a block split by tempo automation / loop wrap / marker jump — NOT inside a plain fixed-quantum block. | A rate-dependent (44.1k vs 48k) ≤1-sample **divergence** between an audio-region sample placed via `sample_of` (block-local ratio, row below) and a note-on placed via `lib.rs::sample_offset` (absolute-rate formula, row below) when both fall in the SAME split block — the two use different formulas that only provably agree when the block's ratio is exact. Second-difference seam metric would show a rate-dependent step confined to split-block scenarios. | open (not exercised) |
| S15 | `lib.rs:1174-1184` | region-player | C3 | Output sample offset of a note-on/off within its block: `s0 + pulses_to_samples(position - p0, bpm, sr) as usize` (truncating `\| 0` cast), with a `pulses.abs() < 1e-7 → s0` snap for the exact-start case. | Rate-dependent truncation of the fractional sample. Hand-traced: region/note at PPQN 1680 (1.75 beats) at 120 bpm → 0.875 s. At 48000 Hz: `0.875*48000 = 42000.0` exactly (no truncation loss). At 44100 Hz: `0.875*44100 = 38587.5` → truncates to 38587, a 0.5-sample bias that 48 kHz does not exhibit for the same musical position. | `note-onsets` family, any scenario with a non-round-sample musical position (very common at 44.1 kHz; round PPQN/bpm combos land exact at 48 kHz far more often). | 44.1 kHz renders show a systematic sub-sample truncation bias (average ~0.5 sample early) relative to the exact musical time that 48 kHz renders of the identical scenario do not — a rate-dependent onset-timing signature, not a fixed constant. | open (not exercised) |
| S16 | `audio_region_player.rs:879-884` | region-player | C3 | Output sample index a region's (or its fade envelope's) pulse position maps to, via a **block-local linear ratio**: `(s0 as f64 + samples*((pulse-p0)/pulses)).clamp(s0,s1) as usize`. | Same truncation family as the `lib.rs::sample_offset` row, but a *different formula* (ratio-based, not absolute-rate-based). The two are mathematically equivalent only when the containing block's `samples/pulses` ratio equals the nominal rate exactly — guaranteed for `Action::None` blocks, NOT guaranteed for a split block (see `emit_until` row). | `region-fencepost` (region starting at 1.75 beats) landing inside a split block; `seam` scenarios at a tempo-automation/loop boundary. | Agrees with `lib.rs::sample_offset` to float rounding in ordinary blocks; diverges by up to 1 sample specifically when the same pulse position is evaluated inside a split block — i.e., an audio region and a MIDI note scheduled at the identical pulse position near a tempo/loop/marker split can render 1 sample apart. | open (not exercised) |
| S17 | `audio_region_player.rs:940-948` | region-player | C2 | Source-samples-advanced-per-output-sample for a PitchStretch/warp region, via `audio_samples_per_ppqn / (samples/pulses)` — again the block-local ratio, not the absolute rate. | Same split-block ratio-drift risk as the `sample_of` row, but here it corrupts a **rate** (continuous per-sample read-rate), not just a one-time placement — so a drift compounds over the block instead of being a single fencepost error. | `seam`/`region-fencepost` scenarios combined with tempo automation, specifically where a PitchStretch region's render block is also a tempo-grid split. | A brief but real rate discontinuity (micro pitch/time glitch) in warped audio precisely at a tempo-automation grid tick inside an active warp region — distinguishable from a placement-only click by its shape (a slope error, not a step). | open (not exercised) |
| S18 | `audio_region_player.rs:789-801` | region-player | C1 | Whether a no-stretch region's free-running read head **continues** (locked to the output clock) or **reseats** from the tempo map, via a fixed epsilon compare: `(cursor.next_pulse - cycle.result_start).abs() < 1e-6` AND `(cursor.raw_start - cycle.raw_start).abs() < 1e-6`. | `1e-6` pulses (~5e-10 s) is far below 1 sample at any audio rate for a single quantum, but it is a **fixed absolute** tolerance, not ULP-relative — the repo's own sibling check for Signalsmith (`play_signalsmith` line 553, same `1e-6` form) was flagged risky enough to need a documented ULP-tolerant fallback (`try_restore`) plus a dedicated regression test (`signalsmith_loop_wrap_cache_survives_pulse_jitter`, lines 1293-1315) after exact-match jitter caused most wraps to miss the fast path. The native-cursor check has no such fallback/test. | `loop-wrap` family run over MANY iterations (the jitter test's own scenario, ~26+ wraps) applied to a no-stretch/native region instead of Signalsmith. | Over a long-running loop, an occasional spurious reseat (harmless — tempo-map reseat is exact) OR, the higher-risk direction, a genuinely-discontinuous cycle miscompared as continuous, producing a brief sample skip/repeat (audible click) that only manifests after many loop passes — a short seam test would not catch it. | open (not exercised) |
| S19 | `value/src/region.rs:42-51` | region-player | C2 | Which loop cycle (and therefore `raw_start`, the anchor every downstream read/placement formula above is relative to) a search window's start falls into. | Exact-boundary case: a search position landing precisely on a loop-cycle multiple (`seek_min == offset + k*loop_duration`) depends on `floor` of a quotient that should be exactly integer `k` but may not be bit-exact under IEEE division — could select cycle `k` or `k-1`. | `loop-wrap` and `region-fencepost` scenarios where a region/window boundary coincides exactly with a loop-duration multiple. | An off-by-one-cycle `raw_start` selection at the exact boundary sample, which would propagate into both `sample_of`/`sample_offset`-style placement and the tempo-map read offset simultaneously (so audio and any co-located note would move together, not diverge — a harder-to-spot class than the split-block rows above). | open (not exercised) |
| S20 | `RecordAudio.ts:270-274` | recording-glue | C5 | `headStartSeconds` (worklet-connect-to-count-in-start gap) and the first take's `waveformOffset = headStartSeconds + countInSeconds + outputLatency + inputLatency` | `headStartSeconds` is derived from `recordingWorklet.numberOfFrames / sampleRate` at the instant `isRecording` is first observed true. `numberOfFrames = #output.length * RenderQuantum(128)` — readable **only** at 128-sample-multiple granularity, quantized by whichever real time the worker-drained ring buffer happened to be at on that read. This is a one-time term baked into every take's offset for the whole session. | Compare measured splice/attack alignment of take 1's audio against a hardware-timed reference click, at 44100 vs 48000 with count-in ON. | Fixed (per-session) bias in `waveformOffset` of magnitude 0 to 1 RenderQuantum period: **0–2.90 ms @44100, 0–2.67 ms @48000**, same sign for every take in that session (inherited additively — see next row), scales with `1/sampleRate`, not with take count. | open (not exercised) |
| S21 | `RecordAudio.ts:217` / `CaptureAudio.ts:217` | recording-glue | C5 | `outputLatency = audioContext.outputLatency ?? 0` — snapshotted **once** at `startRecording()`, held constant for the entire multi-take session | No re-read across the session. `AudioContext.outputLatency` can change live (Bluetooth output handoff, sample-rate/device switch) but the offset baked into every subsequent take's `waveformOffset` never updates. Also silently falls back to `0` (not re-measured) when `outputLatency` is `undefined`, after the user dismisses a one-time warning in `prepareRecording()`. | Long recording session (5+ min, several takes) with a live output-device change mid-session (e.g. switch to Bluetooth headphones) at 44100 vs 48000; or a browser where `outputLatency` reads `undefined`. | Splice alignment error that is CONSTANT across the whole session up to the device switch, then a step-change misalignment for takes recorded after the switch that isn't captured anywhere in the model. On the `undefined` fallback path: whatever `outputLatency` truly is (device+driver dependent, typically 5–20 ms) becomes an unmodeled, un-compensated constant offset on every take. | open (not exercised) |
| S22 | `RecordAudio.ts:235-238` | recording-glue | **C5 (primary)** | `takeDurationSeconds = tempoMap.intervalToSeconds(take.position, loopTo)`; `currentWaveformOffset += takeDurationSeconds` — the offset every *subsequent* take's `waveformOffset` is built from | `intervalToSeconds` → `VaryingTempoMap.intervalToSeconds` (no tempo automation case) → `PPQN.pulsesToSeconds(toPPQN-fromPPQN, bpm) = (pulses*60/960)/bpm` — a **pure float, continuous-time** formula with zero coupling to `sampleRate` or to `RenderQuantum`. Meanwhile the actual audio in the shared ring buffer is captured by the real ADC/engine clock, which (per `EngineWorklet.ts:91-102`, `SyncStream` fed from the WASM audio thread) can only report/wrap `position` at RenderQuantum(128)-sample boundaries. The idealized tempo-math duration and the engine's actual per-block wrap sample are therefore two independently-computed numbers with no reconciliation step. Same fixed loop length ⇒ same delta **every wrap**, so unlike the one-time `headStartSeconds` term, this error is additive per take: `error(take_n) ≈ (n-1) × Δ_wrap`, `Δ_wrap ∈ [0, 128) samples` one-sided (a block that straddles `loopTo` must finish before the wrap applies, so the true wrap sample is always ≥ the idealized one). | Multi-take (≥3) loop recording with a loop length deliberately chosen to land far from a 128-sample boundary (`round(loopLenSeconds × sampleRate) mod 128` near 64), at both 44100 and 48000. Cross-correlate each take boundary against the continuous reference capture. | Splice misalignment that **grows linearly with take number** (not present in take 1, present and worsening by take 3, 4, …), bounded per-wrap by `128/sampleRate` (2.90 ms @44100, 2.67 ms @48000), always in the direction "declared `waveformOffset` undershoots the true buffer split" (real content starts later in the shared file than the declared window claims). This is the highest-value target for the live phase — see hand trace in register source. | open (mechanism consistent w/ code; magnitude unmeasured) |
| S23 | `RecordAudio.ts:281-289` | recording-glue | C5 (secondary, self-healing) | Live/in-progress `duration`/`loopDuration` continuously rewritten as `takeSeconds = (numberOfFrames/sampleRate) − currentWaveformOffset` on every `engine.position` tick | `numberOfFrames` is RenderQuantum-granular; `currentWaveformOffset` carries the two upstream biases above. Not itself a persistence bug — for a wrap-finalized take this value is **overwritten** by the exact `intervalToSeconds` value in `finalizeTake` (line 97-98), so the RenderQuantum noise here never reaches storage for wrapped takes. It only matters for whichever take is still open at *session stop* (next row) and for any UI/painter reading `duration` live mid-recording. | N/A directly measurable in the final file — check only that peak/waveform painters reading this live value don't visibly jitter mid-recording (cosmetic, non-audio). | Low-amplitude visual jitter in a live waveform overlay only; no persisted audio artifact. | open (not exercised) |
| S24 | `RecordAudio.ts:198` + `RecordingWorklet.ts:64-69,103-119` | recording-glue | **C5 + C3 (primary)** | `recordingWorklet.limit(Math.ceil((currentWaveformOffset + duration) * sampleRate))` sets the target frame count that `#finalize()`'s `mergeChunkPlanes(...).map(frame => frame.slice(-totalSamples))` trims the **entire shared recording** down to — this is what determines the persisted length of the FINAL (non-wrapped, stop-terminated) take's backing audio | `duration = regionBox.duration.getValue()` is the **last value written by the position-tick handler above** (RenderQuantum-granular, and — because it's set on a *different* update cadence than the moment `terminate()`/`disconnect()` fires — potentially stale relative to `recordingWorklet.numberOfFrames` read one line earlier in the *same* cleanup callback, which reflects the ring buffer's current state as continuously drained by the dedicated `Atomics.wait`-driven worker in `RingBuffer.ts` (independent of main-thread `engine.position` polling cadence, not bounded to a single render quantum). `Math.ceil` itself is a harmless <1-sample epsilon guard, not the risk — the risk is that `totalSamples` (derived from the stale `duration`) can under-shoot the buffer's true current length by more than the code comment's claimed "up to one quantum," in which case `slice(-totalSamples)` (which keeps the **tail**, i.e. discards from the **front** of the whole-session buffer) trims more than the intended trailing overshoot. In the common case (disconnect happens promptly after the last tick, and any backlog is only the render quanta produced between the tick and disconnect) this stays within roughly one RenderQuantum as the comment assumes; the live phase should confirm the bound, not just accept the comment. | Stop recording (not wrap) immediately after inducing main-thread jank (heavy synchronous JS, occluded/backgrounded tab per the CLAUDE.md `visibilityState` note) right at the stop click, at 44100 vs 48000; compare the finalized `AudioFileBox.endInSeconds`/`audioData.numberOfFrames` against a hardware-timed reference, and verify the *start* of take 1's content is bit-identical to a non-jank control run (confirms trimming came from the tail, not the head). | Nominal case: overshoot bounded to `[0,128)` samples per the code's own assumption — **2.90 ms @44100, 2.67 ms @48000** trimmed off the tail, invisible. Jank case: a measurable, non-quantum-bounded gap between expected and actual final sample count, and (if the front-trim theory is right) a detectable shift/loss at the very start of take 1's audio rather than at the stop point. | confirmed (nominal case — behaving within designed RenderQuantum bound; NOT a bug) |
| S25 | `RecordAudio.ts:139-172` | recording-glue | C5 (cosmetic) | `oldFileBox.endInSeconds` (visible between stop-time and the async `importRecording` completing) vs the corrected `newFileBox.endInSeconds = audioData.numberOfFrames / audioData.sampleRate` | Documented in-code: the pre-correction value uses the live/possibly-overshot `recordingWorklet.numberOfFrames` (line 203, set at stop-cleanup, *before* `#finalize()`'s slice), so any waveform painter reading it in that narrow async window sees a linearly-stretched-by-overshoot picture. Self-corrects once `onSaved` fires. | Screenshot/sample the waveform canvas in the stop→onSaved async gap at both rates; confirm the window width and its correction. | Transient visual stretch only, bounded by the same RenderQuantum overshoot as the row above; no persisted/audible effect once `onSaved` completes. | open (not exercised) |
| S26 | `RecordingWorklet.ts:110` vs `RecordAudio.ts:51` | recording-glue | C5 (provenance, cleared as app-invariant) | Which `sampleRate` value backs the persisted `AudioData` vs which one all of `RecordAudio.ts`'s float-seconds math uses | Both derive from `BaseAudioContext.sampleRate` read off what should be the *same* `AudioContext` object — `RecordingWorklet` is constructed via `AudioWorklets.createRecording()` → `new RecordingWorklet(this.#context, …)`, and `AudioWorklets` is looked up/created keyed by `project.env.audioContext` (`AudioWorklets.createFor`/`.get`, `AudioWorklets.ts:17-27`). Nothing in these files *enforces* identity (types are `BaseAudioContext`), it's an app-bootstrap invariant (single `AudioContext` per project) outside this glue's files. | Not independently provoke-able from this layer; would require an app-boot bug that constructs two contexts. | None expected under normal boot; flagging only because the audit brief explicitly asked where `sampleRate` comes from and whether context/engine could mismatch. | cleared (live) |
| S27 | `src/lib/audit/onsetDetection.ts:56` (hop RMS envelope) | harness-artifact | harness-C1 (detector-only, not engine) | Whether `detectOnsets`'s hop-quantized RMS envelope sees a real energy rise vs. phase-dependent ripple on a sustained tone | Fixed 64-*sample* hop is rate-DEPENDENT: hop duration halves at 88.2k/96k vs. 44.1k/48k, so the RMS-envelope ripple ratio on a sustained 440Hz tone crosses the 25%-of-max-rise trigger threshold only at the two higher rates (analytic repro: ripple ratio 0.18@44.1k/0.13@48k vs. 0.39@88.2k/0.44@96k) | `automation` family @ rate ∈ {88200, 96000}, all 5 bpms | 55-124 spurious "extra" onsets per cell, all confined to the sustained-tone ON windows (0 in the silent OFF windows) — matches the analytic rate split exactly | harness-artifact (fixed 2026-08-27) |
| S28 | harness detector refractory vs. Vaporisateur release ring (`ONSET_OPTIONS_BY_FAMILY["loop-wrap"]`, `src/demos/engine/samplerate-audit-debug-demo.tsx:119`) | harness-artifact | harness-C1 (detector-only, not engine) | Whether a second detector trigger inside a note's release ring counts as a genuine extra onset | Vaporisateur's release ring extends ~0.35-0.4s after the true attack; the family's old `refractorySec: 0.2` was tuned against a bpm where the ring's absolute-time duration stayed under 200ms — at the two SLOWEST matrix bpms (90, 97.3) the ring crosses 400ms and clears the 0.2s gate exactly once per loop pass | `loop-wrap` family @ bpm ∈ {90, 97.3}, all 4 rates | one extra re-trigger ~0.35-0.4s after each real note-on, every loop pass, only at the two slowest bpms (0 extras at bpm 120/124/133) | harness-artifact (fixed 2026-08-27) |

## Cleared sites

All five audits identified cleared sites (no Cn risk). Listed by area for reference:

**engine-lib**: `lib.rs:1468-1471` + `lib.rs:1799` (known exemplar), `lib.rs:1043-1047`, `lib.rs:1533-1550`, `lib.rs:1176-1180`, `lib.rs:1938-1940`, `lib.rs:1627`, `lib.rs:1505-1550`, `lib.rs:985`.

**transport**: `transport.rs:316-332` (wrap-target assignment), `transport.rs:248-260` (loop-vs-block-end comparison), `transport.rs:221-247` (action precedence), `transport.rs:307-315` (tempo re-fire protection), `dsp::ppqn` conversion functions, `value::value_at` boundary handling, `transport.rs:54-56` (binary search).

**metronome-signature**: `metronome.rs:19-21,197` (ceil fencepost), `metronome.rs:25-27,201` (js_round half-rounding), `signature_track.rs:77-93` (accumulated_ppqn exactness), `metronome.rs:104-107` (array bounds).

**region-player**: `math::mod_euclid`, `math::floor`, `ppqn` conversion functions, `audio_region_player.rs:813-819` (interpolate truncation), `note_region.rs` (trivial data struct), `processors::sequencer.rs` (legacy/unwired).

**recording-glue**: `RecordTrack.ts`, `Recording.ts`, `RecordMidi.ts`, `RecordAutomation.ts`, `CaptureMidi.ts`, `CaptureDevices.ts`, `MonitoringMode.ts`, `InputLatency.ts`, `PPQN.pulsesToSeconds`/`secondsToPulses` (rate-agnostic by design), `RingBuffer.ts`, `AudioWorklets.ts`.

## Matrix results

Run: `samplerate-audit-debug-demo.html?family=<f>&bpm=all&rate=all`, 9 families x 5 bpms x
4 rates = 180 cells, all fresh page loads 2026-08-27, all completed `data-audit-state=done`
(no run-failed families, no per-cell `status:"error"` rows). Format per line: rate:status(maxDeviationSec
in ms); seam's metric is `seamStep` (a discontinuity amplitude, ms-scale label kept for readability,
not a duration) judged against `SEAM_THRESHOLDS`, not `maxDeviationSec`. "spread" = max−min of that
metric across the 4 rates; "verdict" = rate-dependent iff spread exceeds the family's `AUDIT_TOLERANCES`
entry (n/a for seam, judged per-rate already).

### metronome (JSON: `audit-1787880069621.json`)

- bpm=90: 44100:pass(0.077ms) 48000:pass(0.074ms) 88200:pass(0.066ms) 96000:pass(0.074ms) — spread=0.011ms — rate-consistent
- bpm=97.3: 44100:pass(0.077ms) 48000:pass(0.074ms) 88200:pass(0.065ms) 96000:pass(0.074ms) — spread=0.011ms — rate-consistent
- bpm=120: 44100:pass(0.077ms) 48000:pass(0.074ms) 88200:pass(0.066ms) 96000:pass(0.074ms) — spread=0.011ms — rate-consistent
- bpm=124: 44100:pass(0.074ms) 48000:pass(0.072ms) 88200:pass(0.063ms) 96000:pass(0.073ms) — spread=0.011ms — rate-consistent
- bpm=133: 44100:pass(0.076ms) 48000:pass(0.070ms) 88200:pass(0.065ms) 96000:pass(0.070ms) — spread=0.011ms — rate-consistent

All 20 cells pass, all clean 32/32 matched (0 missing/extra). Post-calibration residual is
flat (~11 µs spread) across every bpm — no rate- or bpm-dependent signature above detector noise.
S10/S11/S12's predicted sub-sample floor biases (tens of µs, one-sided) are consistent with these
residuals in magnitude but the matrix's 2 ms pass tolerance and single-scalar calibration can't
isolate a signed, rate-varying bias at this resolution — inconclusive, not cleared (see triage).

### loop-wrap (JSON: `audit-1787880081585.json` original run; **RE-RUN after detector fix**,
JSON: `audit-1787881458893.json`, run id 1787881458893, 2026-08-27 — see Triage/S28)

**Re-run results (post-fix, `refractorySec: 0.6`): 20/20 pass, 0 investigate.**

- bpm=90: 44100:pass(0.007ms) 48000:pass(0.146ms) 88200:pass(0.538ms) 96000:pass(0.542ms) — spread=0.535ms — rate-consistent (pass)
- bpm=97.3: 44100:pass(0.159ms) 48000:pass(0.062ms) 88200:pass(0.538ms) 96000:pass(0.542ms) — spread=0.480ms — rate-consistent (pass)
- bpm=120: 44100:pass(0.165ms) 48000:pass(0.000ms) 88200:pass(0.538ms) 96000:pass(0.542ms) — spread=0.542ms — rate-consistent (pass)
- bpm=124: 44100:pass(0.114ms) 48000:pass(0.066ms) 88200:pass(0.538ms) 96000:pass(0.542ms) — spread=0.476ms — rate-consistent (pass)
- bpm=133: 44100:pass(0.149ms) 48000:pass(0.012ms) 88200:pass(0.538ms) 96000:pass(0.542ms) — spread=0.530ms — rate-consistent (pass)

All 8 real onsets matched with 0 missing/extra at every one of the 20 cells (`matched=8` always).
The per-cell `maxDeviationSec` values are UNCHANGED from the original run (widening the
refractory window only suppresses the spurious release-ring re-trigger; it does not move the
real onsets' detected times) — the only change is bpm=90/97.3 now read `extra=0` instead of
`extra=3-7` and therefore pass. Original run (pre-fix) for reference: bpm=90 and bpm=97.3
investigated at all 4 rates (bpm-triggered, not rate-triggered); all 8 real onsets matched with
0 missing at every cell even then — "extra" hits were a second re-trigger ~0.35-0.4s after each
real note-on. Root cause and fix: see Triage (S28) below.

### seam (JSON: `audit-1787880088826.json`)

- bpm=90: 44100:pass(0.908ms-step) 48000:pass(0.801ms-step) 88200:pass(0.246ms-step) 96000:pass(0.225ms-step)
- bpm=97.3: 44100:pass(0.842ms-step) 48000:pass(0.630ms-step) 88200:pass(0.246ms-step) 96000:pass(0.222ms-step)
- bpm=120: 44100:pass(0.491ms-step) 48000:pass(0.448ms-step) 88200:pass(0.246ms-step) 96000:pass(0.224ms-step)
- bpm=124: 44100:pass(0.911ms-step) 48000:pass(0.497ms-step) 88200:pass(0.246ms-step) 96000:pass(0.225ms-step)
- bpm=133: 44100:pass(0.492ms-step) 48000:pass(0.448ms-step) 88200:pass(0.246ms-step) 96000:pass(0.224ms-step)

All 20 cells pass — every `seamStep` is well under its rate's `SEAM_THRESHOLDS` entry (5x the
clean-splice measurement from Task 6). Every seam row also carries a large `onsets`/`extra` count
(46-101) from the plain `detectOnsets` call the harness runs on every family for informational
onset arrays — this is the SAME hop-envelope-ripple artifact seen in `automation` (a sustained
220 Hz tone re-triggers the 64-sample-hop RMS detector), but seam's pass/fail path never reads
`verdict.extra`/`missing` (it judges `seamStep` directly per the demo's `judgeCell` special case),
so it has zero effect on this family's verdicts — noted for completeness, not a finding.

### region-fencepost (JSON: `audit-1787880096503.json`)

- bpm=90: 44100:pass(0.021ms) 48000:pass(0.000ms) 88200:pass(0.009ms) 96000:pass(0.010ms) — spread=0.021ms — rate-consistent
- bpm=97.3: 44100:pass(0.030ms) 48000:pass(0.022ms) 88200:pass(0.019ms) 96000:pass(0.014ms) — spread=0.016ms — rate-consistent
- bpm=120: 44100:pass(0.009ms) 48000:pass(0.000ms) 88200:pass(0.002ms) 96000:pass(0.000ms) — spread=0.009ms — rate-consistent
- bpm=124: 44100:pass(0.024ms) 48000:pass(0.024ms) 88200:pass(0.013ms) 96000:pass(0.014ms) — spread=0.011ms — rate-consistent
- bpm=133: 44100:pass(0.027ms) 48000:pass(0.023ms) 88200:pass(0.015ms) 96000:pass(0.012ms) — spread=0.015ms — rate-consistent

All 20 cells pass, clean matches. Sub-30µs residuals throughout — no rate-dependent divergence
above detector floor. S7/S14/S15/S16's predicted ≤1-sample floor biases (µs-scale) are again
below what this matrix's calibration/tolerance can isolate — inconclusive, not cleared.

### note-onsets (JSON: `audit-1787880104330.json`)

- bpm=90: 44100:pass(0.476ms) 48000:pass(0.013ms) 88200:pass(0.046ms) 96000:pass(0.050ms) — spread=0.463ms — rate-consistent (pass)
- bpm=97.3: 44100:pass(0.475ms) 48000:pass(0.012ms) 88200:pass(0.046ms) 96000:pass(0.050ms) — spread=0.463ms — rate-consistent (pass)
- bpm=120: 44100:pass(0.476ms) 48000:pass(0.013ms) 88200:pass(0.046ms) 96000:pass(0.050ms) — spread=0.463ms — rate-consistent (pass)
- bpm=124: 44100:pass(0.468ms) 48000:pass(0.032ms) 88200:pass(0.046ms) 96000:pass(0.050ms) — spread=0.436ms — rate-consistent (pass)
- bpm=133: 44100:pass(0.473ms) 48000:pass(0.066ms) 88200:pass(0.119ms) 96000:pass(0.132ms) — spread=0.407ms — rate-consistent (pass)

All 20 cells pass, 10/10 matched every cell. 44100 consistently shows the largest residual
(~0.47-0.48ms) of the 4 rates at every bpm except 133 — directionally consistent with S15's
predicted 44.1kHz-specific truncation bias (0.875s musical position lands exact at 48kHz,
truncates at 44.1kHz), but the measured magnitude (~0.47ms ≈ 21 samples @44.1k) is roughly
40x S15's predicted ~0.5-sample (~11µs) bias — too large to be that mechanism alone; more
likely dominated by `AUDIT_CALIBRATION`'s single per-family scalar (measured at the 48k control
row) leaving a larger uncorrected residual at 44.1k. Flagged as open/inconclusive, not confirmed.

### automation (JSON: `audit-1787880112075.json` original run; **RE-RUN after detector fix**,
JSON: `audit-1787881446952.json`, run id 1787881446952, 2026-08-27 — see Triage/S27)

**Re-run results (post-fix, `hopSeconds: 64/44100`): 20/20 pass, 0 investigate.**

- bpm=90: 44100:pass(0.921ms) 48000:pass(0.931ms) 88200:pass(0.933ms) 96000:pass(0.941ms) — spread=0.020ms — rate-consistent (pass)
- bpm=97.3: 44100:pass(0.921ms) 48000:pass(0.931ms) 88200:pass(0.933ms) 96000:pass(0.941ms) — spread=0.020ms — rate-consistent (pass)
- bpm=120: 44100:pass(0.921ms) 48000:pass(0.931ms) 88200:pass(0.933ms) 96000:pass(0.941ms) — spread=0.020ms — rate-consistent (pass)
- bpm=124: 44100:pass(0.921ms) 48000:pass(0.931ms) 88200:pass(0.933ms) 96000:pass(0.941ms) — spread=0.020ms — rate-consistent (pass)
- bpm=133: 44100:pass(0.921ms) 48000:pass(0.931ms) 88200:pass(0.933ms) 96000:pass(0.941ms) — spread=0.020ms — rate-consistent (pass)

All 20 cells matched the 3 real onset transitions with 0 missing/extra (`matched=3` always,
identical `maxDeviationSec` per rate at every bpm — the family's content doesn't vary with bpm).
Switching to a rate-independent hop duration (`hopSeconds: 64/44100`, same ~1.45ms hop at every
rate) eliminated every spurious re-trigger at 88.2k/96k with zero effect on the real onsets'
detected times. Original run (pre-fix) for reference: 88200/96000 investigated at all 5 bpms
(rate-triggered, not bpm-triggered) with 55-124 spurious "extra" onsets per cell, all confined
to the sustained-tone ON windows (0 in the OFF/silent windows). Root cause and fix: see Triage
(S27) below.

### tempo-ramp (JSON: `audit-1787880119622.json`)

- bpm=90: 44100:pass(2.667ms) 48000:pass(2.138ms) 88200:pass(2.004ms) 96000:pass(2.000ms) — spread=0.667ms — rate-consistent (pass, within 4.236ms tolerance)
- bpm=97.3: 44100:pass(2.431ms) 48000:pass(2.249ms) 88200:pass(2.003ms) 96000:pass(2.006ms) — spread=0.428ms — rate-consistent (pass)
- bpm=120: 44100:pass(2.645ms) 48000:pass(2.118ms) 88200:pass(2.003ms) 96000:pass(2.009ms) — spread=0.642ms — rate-consistent (pass)
- bpm=124: 44100:pass(2.428ms) 48000:pass(2.150ms) 88200:pass(2.003ms) 96000:pass(2.014ms) — spread=0.425ms — rate-consistent (pass)
- bpm=133: 44100:pass(2.529ms) 48000:pass(2.206ms) 88200:pass(2.006ms) 96000:pass(2.011ms) — spread=0.523ms — rate-consistent (pass)

All 20 cells pass under the family's widened 4.236ms tolerance (calibrated for the continuous
tempo-integration residual, see `AUDIT_TOLERANCES`). 44100 consistently shows the largest
residual, decreasing monotonically toward 96000 at every bpm — a real, repeatable rate-dependent
trend, but it stays inside the pre-calibrated tolerance band at all 20 cells, and the tolerance
was explicitly sized for "the engine applying the continuous tempo curve at finite block
granularity" (by-design per the tolerance comment) — not flagged as a new finding.

### signature (JSON: `audit-1787880126387.json`)

- bpm=90: 44100:pass(0.073ms) 48000:pass(0.071ms) 88200:pass(0.062ms) 96000:pass(0.071ms) — spread=0.011ms — rate-consistent
- bpm=97.3: 44100:pass(0.067ms) 48000:pass(0.069ms) 88200:pass(0.061ms) 96000:pass(0.070ms) — spread=0.009ms — rate-consistent
- bpm=120: 44100:pass(0.073ms) 48000:pass(0.071ms) 88200:pass(0.062ms) 96000:pass(0.071ms) — spread=0.011ms — rate-consistent
- bpm=124: 44100:pass(0.072ms) 48000:pass(0.067ms) 88200:pass(0.061ms) 96000:pass(0.069ms) — spread=0.011ms — rate-consistent
- bpm=133: 44100:pass(0.060ms) 48000:pass(0.070ms) 88200:pass(0.060ms) 96000:pass(0.070ms) — spread=0.010ms — rate-consistent

All 20 cells pass, clean matches, flat ~10µs spread — no rate/bpm-dependent signature above
detector noise.

### transport-pos (JSON: `audit-1787880133114.json`)

- bpm=90: 44100:pass(0.073ms) 48000:pass(0.070ms) 88200:pass(0.062ms) 96000:pass(0.070ms) — spread=0.011ms — rate-consistent
- bpm=97.3: 44100:pass(0.054ms) 48000:pass(0.065ms) 88200:pass(0.054ms) 96000:pass(0.069ms) — spread=0.015ms — rate-consistent
- bpm=120: 44100:pass(0.062ms) 48000:pass(0.070ms) 88200:pass(0.050ms) 96000:pass(0.070ms) — spread=0.020ms — rate-consistent
- bpm=124: 44100:pass(0.061ms) 48000:pass(0.070ms) 88200:pass(0.061ms) 96000:pass(0.070ms) — spread=0.009ms — rate-consistent
- bpm=133: 44100:pass(0.062ms) 48000:pass(0.068ms) 88200:pass(0.061ms) 96000:pass(0.069ms) — spread=0.007ms — rate-consistent

All 20 cells pass, clean matches, flat ~10-20µs spread — no rate/bpm-dependent signature above
detector noise. Long-run accumulation (S9) is by-design/cleared per the register already; this
matrix's 8-16s render windows are far too short to exercise the "many thousands of quanta" S9's
own note says is needed to see summation drift, but the flat spread here is at least consistent
with no gross divergence over this window.

### Summary: 180/180 cells run, 0 errors, 0 run-failed families, 18 investigate cells (all in
`loop-wrap` and `automation`), 0 confirmed engine bugs — see Triage below. **Both clusters
resolved after the detector fix (Task 8 follow-up, register S27/S28): re-run of both families
(40/40 cells, run ids 1787881446952 automation / 1787881458893 loop-wrap) is 40/40 pass, 0
investigate — see the updated `automation`/`loop-wrap` Matrix results subsections above and
Triage below.**

## Triage (Task 8)

Every `investigate` cell (18 total, all in `loop-wrap` and `automation`) was traced to its
root cause. **Neither cluster matches any register suspect's predicted signature — both are
harness detector artifacts, not SDK engine bugs.** 0 confirmed bugs; fixed-on-main gate is
therefore not applicable (nothing to diff against `origin/main`).

**Resolution (Task 8 follow-up, same commit as this note's edit):** both artifacts were fixed
in the detector/harness (never in engine or SDK code) and both families were re-run clean —
see the end of each cluster's writeup below, and register rows S27/S28.

### Cluster 1 — `automation` @ rate ∈ {88200, 96000}, all 5 bpms (10 cells)

**Measurement:** all 20 `automation` cells matched the 3 real volume-gate onsets with 0
missing/extra confusion (`matched=3` always); at 88200/96000 only, `detectOnsets` additionally
reports 55-124 "extra" onsets, ALL of them inside the sustained-tone ON windows and NONE in the
silent OFF windows (verified directly on the uploaded WAVs — `spectral_features` on the OFF
window shows real silence, RMS ≈0.0004, no ripple).

**Prediction check against the register:** no suspect predicts this shape. The closest
candidates by area/family are S1 (`lib.rs:1481`, solo-automation quantum-boundary decision) and
S2 (`lib.rs:854-859`, count-in negative-pre-roll grid truncation) — both explicitly engine-lib/C1
or C3 mechanisms tied to *solo automation* or *count-in pre-roll*, neither of which this
scenario exercises (the `automation` family gates plain volume via a step `ValueRegionBox`, no
solo lane, no count-in). Predicted magnitudes for S1 (≤128 samples ≈2.9ms @44.1k) and S2
(~5.2ms @120bpm) also don't match: the measured "extra" onsets are spaced at the harness's own
0.05s `refractorySec` floor and confined to two rates only, not a quantum- or grid-bound
magnitude. **No register match.**

**Root cause (deep-dived, `onsetDetection.ts`):** `detectOnsets`'s energy envelope uses a FIXED
`hopSize` of 64 *samples* (not scaled to sample rate). For a steady 440Hz tone, the RMS-per-hop
value depends on which phase of the waveform each 64-sample hop happens to capture — at 44100Hz/
48000Hz this phase-dependent variance stays under the 25%-of-max-rise trigger threshold, but at
88200Hz/96000Hz it does not. Reproduced with a **from-scratch synthetic 440Hz sine, zero SDK/engine
code involved** (`/private/tmp/.../scratchpad/wavripple.js`): hop-envelope ripple ratio
(max−min)/max = 0.18 @44100, 0.13 @48000, **0.39 @88200, 0.44 @96000** — the exact same rate
split the matrix shows as pass/investigate. This conclusively isolates the artifact to the onset
detector's hop-quantization, independent of any engine or resampling behavior.

**Classification: tolerance artifact — harness-followup.** Fix (out of scope for this task):
scale `hopSize` in `onsetDetection.ts` by sample rate (e.g. a fixed hop *duration* in seconds
rather than samples), or raise `thresholdRatio` for sustained-tone families. Do not touch
`onsetDetection.ts` in Task 8; re-run `automation` after the fix lands.

**RESOLVED (Task 8 follow-up, register S27):** `OnsetOptions` gained a `hopSeconds?: number`
field (`Math.round(hopSeconds * sampleRate)` when set, `hopSize` behavior unchanged otherwise —
`src/lib/audit/onsetDetection.ts`); `ONSET_OPTIONS_BY_FAMILY.automation` now sets
`hopSeconds: 64/44100` (the 44.1k baseline hop duration, ~1.45ms) so the hop DURATION — and
therefore the ripple ratio — is identical at every rate. `AUDIT_CALIBRATION.automation` and
`AUDIT_TOLERANCES.automation` were re-measured on the control row (unchanged to float noise —
see `src/lib/audit/auditCalibration.ts`). Re-run (run id 1787881446952, all 5 bpms x 4 rates):
20/20 pass, 0 investigate, `matched=3`/`missing=0`/`extra=0` at every cell.

### Cluster 2 — `loop-wrap` @ bpm ∈ {90, 97.3}, all 4 rates (8 cells)

**Measurement:** all 8 real note-on onsets matched with 0 missing at every cell, all 5 bpms, all
4 rates. Only bpm=90 and bpm=97.3 show extras (3-7 per cell) — a SECOND onset ~0.35-0.4s after
each real note-on, at every loop pass. bpm=120/124/133 are perfectly clean (0 extras).

**Prediction check against the register:** S3 (`lib.rs:1930-1954`, modulation re-anchor on
`pauseOnLoopDisabled`) is the only loop-wrap-tagged suspect, but its provoking scenario requires
a bound modulator (LFO/Steps/Random) and `pauseOnLoopDisabled=true` — this matrix's `loop-wrap`
scenario has neither (plain loop, no modulator, `keepLoopEnabled: true` per the demo's
`renderOfflineSlice` call). S18 (native-cursor reseat epsilon over many loop wraps) needs
"26+ wraps" per its own evidence; this scenario only wraps 8 times. Neither predicts a
bpm-selective (not rate-selective) artifact. **No register match.**

**Root cause:** matches the demo's own `ONSET_OPTIONS_BY_FAMILY` comment almost exactly —
Vaporisateur's note envelope "keeps rippling... for ~350-400ms after the true attack," and the
family's calibrated `refractorySec: 0.2` was tuned against a control bpm where the note's
absolute-time release duration stayed under 200ms. At bpm=90/97.3 (the two SLOWEST bpms in
`AUDIT_BPMS`), the same note plays back over a longer absolute-time window, so its release ring
crosses the 400ms mark and clears the 0.2s refractory gate once — producing exactly one extra
re-trigger per loop pass, every time. This is consistent with the direction (slower bpm → longer
absolute note/release duration) and the fixed ~0.35-0.4s offset from the real onset in every
affected cell.

**Classification: tolerance artifact — harness-followup.** Fix (out of scope for this task):
widen `refractorySec` for `loop-wrap` beyond 0.4s (still far under the family's ≥3.6s
loop-period floor, so no risk of merging two real onsets), or make it bpm-aware. Do not touch
`onsetDetection.ts`/`ONSET_OPTIONS_BY_FAMILY` in Task 8; re-run `loop-wrap` after the fix lands.

**RESOLVED (Task 8 follow-up, register S28):** `ONSET_OPTIONS_BY_FAMILY["loop-wrap"]`'s
`refractorySec` widened from 0.2s to 0.6s (`src/demos/engine/samplerate-audit-debug-demo.tsx`)
— safely under the family's ≥3.6s loop-period floor, well past the ~0.4s measured release-ring
duration. `AUDIT_CALIBRATION["loop-wrap"]` and `AUDIT_TOLERANCES["loop-wrap"]` were re-measured
on the control row (unchanged to float noise — see `src/lib/audit/auditCalibration.ts`). Re-run
(run id 1787881458893, all 5 bpms x 4 rates): 20/20 pass, 0 investigate, `matched=8`/`missing=0`/
`extra=0` at every cell, including bpm=90/97.3.

### Register status updates

All 26 suspects' `status` column updated in the table above:
- **S8, S9 → `cleared (matrix)`** — both were already statically cleared in the register
  (S8: `quantize_ceil` verified identical to `first_update_position`; S9: float summation drift
  shared with the TS reference by design). The matrix's `tempo-ramp` (tempo-grid boundaries) and
  `transport-pos` (position accumulation) families ran cleanly across all 20 cells each with no
  rate-dependent anomaly, confirming no regression at the resolution this harness can measure.
- **All other 24 suspects (S1-S7, S10-S26) → `open (not exercised)`.** None of their specific
  provoking scenarios (solo automation, negative count-in pre-roll, `pauseOnLoopDisabled` +
  modulator, arpeggiator/generative note scheduling, sub-sample loop/marker widths, uploaded
  click sounds, PitchStretch/warp split-block drift, many-wrap cursor reseat, exact loop-cycle
  boundaries, and all of S20-S26's live-recording-glue mechanisms) were built by this offline
  matrix's 9 families as scoped — most predict sub-sample/µs-scale systematic biases that this
  harness's 2ms `AUDIT_TOLERANCES` floor and single-scalar per-family calibration cannot reliably
  isolate from detector noise even where the general family DID run cleanly (see the
  per-family "inconclusive, not cleared" notes above for `metronome`, `region-fencepost`, and
  `note-onsets`). S20-S26 (recording-glue) are explicitly deferred to Task 9's live
  multi-take recording phase, which is the only phase that exercises real `RecordAudio.ts`/
  `RecordingWorklet.ts` code paths.
- One partial-match worth flagging explicitly: **S15** (44.1kHz-specific truncation bias in
  note-on placement) predicts the right RATE (44100 shows the largest residual in every
  `note-onsets` bpm but 133 — directionally correct) but fails the MAGNITUDE check by ~40x
  (predicted ~11µs / measured ~470µs) — per the task's "must predict rates/BPMs/magnitude"
  standard this does not count as a confirmed match; left `open (not exercised)` rather than
  promoted to `confirmed`.
- **S27, S28 → `harness-artifact (fixed this commit)`** — new register rows added this task
  (Task 8 follow-up) for the two `investigate` clusters' actual root cause: both are bugs in the
  audit harness's own `onsetDetection.ts`/`ONSET_OPTIONS_BY_FAMILY` calibration, not the SDK.
  S27 (rate-dependent hop size) and S28 (refractory vs. release-ring duration) are fixed in this
  same commit (see the "RESOLVED" notes on each cluster above); both `automation` and
  `loop-wrap` re-run 40/40 pass with 0 investigate cells.

### Fixed-on-main gate

Not applicable — 0 confirmed bugs from this matrix run, so there is no responsible file to diff
against `origin/main`.

## Live recording-path results

**Date**: 2026-08-27. **Harness**: `swipe-comping-demo.html?sampleRate=<n>` (new dev-only
knob, this task) at `https://localhost:5173`, real microphone, real trusted clicks
(claude-in-chrome `computer` for the #367 audio-tap runs, Playwright `browser_click` for the
box-graph C5 runs — see environment note below for why two tools were needed).

### `?sampleRate` knob (Task 9 Step 1)

`ProjectSetupOptions.audioContextSampleRate?: number` added to
`src/lib/projectSetup.ts` — threads into `new AudioContext({ sampleRate })` when set, default
(device-native) behavior unchanged otherwise. Wired in
`src/demos/recording/swipe-comping-demo.tsx` only, parsed once at module load from
`?sampleRate=<n>`, no UI. Gates green: `npx tsc --noEmit` zero `^src/` lines,
`npx vitest run src/lib/audit` 28/28 passed, `npm run build` OK.

### Environment note: two browser tools were required

`document.visibilityState` stayed `"hidden"` for the entire claude-in-chrome tab session
(confirmed via JS: `hasFocus()` true, `visibilityState` "hidden") despite the CLAUDE.md
occlusion-recovery recipe (AnalyserNode tap on a swapped `liveStreamReceiver` +
`startAudioWorklet()`). That recipe restores the OUTPUT tap (used successfully for the
#367 audio validation below) but **does not restore the recording-start path** — every
`Record` click issued in claude-in-chrome after a worklet swap left
`engine.isRecording`/`isCountingIn` permanently `false` with no `[RecordAudio] start`
console line, tried both swap-before-first-record and swap-after-a-completed-recording
orderings, same result both times. Separately, `requestAnimationFrame` freezes on the
occluded tab (per CLAUDE.md), which stalls the main-thread box-graph sync that finalizes
takes — confirmed empirically: 0 regions existed 20s into a session that should have
wrapped at ~10s. Playwright's browser window reported `visibilityState: "visible"` and
recorded/finalized takes normally, so **all C5 box-graph measurements were taken in
Playwright**; the #367 audio-tap measurements (which only need the output signal, not
main-thread box-graph sync) were taken in claude-in-chrome, where the tap technique was
proven working. This split, not either tool alone, is what closed out this task.

### Step 2: #367 known-positive validation

**44100 Hz, 120 BPM, Click "Count-in only", count-in ON** — real Record/Stop clicks,
`AudioNode.prototype.connect` patched to tee an `AnalyserNode` onto the destination
connection (installed via a batched navigate+inject to win the race against the engine's
own connect), RMS sampled at ~4 ms via `setInterval` (not `requestAnimationFrame`, which
would have frozen on this occluded tab). `audioContext.sampleRate` confirmed `44100` via
the React fiber (`project.env.audioContext.sampleRate`).

Detected 5 distinct RMS clusters (peak ≈0.13–0.17, silence between = true separate
transients, not one long ringing note) at relative onsets **≈0, 452, 949, 1447, 1951 ms**
— uniform ~475–500 ms spacing matching a 120 BPM quarter-note grid. A 1-bar count-in in
"Count-in only" mode should produce exactly 4 clicks (the recorded bar is supposed to be
silent); measuring **5** confirms the predicted boundary leak — one extra click exactly
where the app's own in-code comment (`swipe-comping-demo.tsx:260-268`) says the SDK
"forces the metronome on through the boundary block" and cannot be suppressed.
**#367 CONFIRMED live at 44100 Hz** — this is the "live-harness validates the
known-positive" checkpoint the task asked for.

**48000 Hz** — attempted 3 times (batched navigate+inject race, twice more with the
worklet-swap recovery in both orderings described above). The tap-connect race was lost
on every fresh 48000 Hz load (analyser never attached before the engine's own destination
connect fired), and the worklet-swap recovery — which works for the tap but breaks
`Record` — could not be combined with a real recording session to reproduce the click.
**Result: inconclusive at 48000 Hz, not a negative finding** — this is a tooling
limitation of the two browser-automation paths available in this session, not a
measurement that failed to find the leak. No claim is made about `#367`'s presence or
absence at 48000 Hz; the campaign register's static read (`countin-metronome-boundary-click.md`)
already establishes the code path is sample-rate-independent (a `position`/quantum
comparison, not a literal 44.1k-only constant), so the leak is expected to reproduce
there too, but this session did not measure it.

### Step 3: C5 measurements (box graph, Playwright)

All three cells below: `settings.recording.allowTakes=true`, 4-bar loop
(`loopArea = [0, 15360]` PPQN), real mic (ambient room noise — no injected tone; acceptable
per the task brief since these are box-graph-field measurements, not audio-content
measurements), real trusted `browser_click`. `ppqnToSec(p, bpm) = p·60/(960·bpm)`.

**Cell A — 44100 Hz, 120 BPM** (6 takes; `outputLatency=0.023s`, `baseLatency≈0.0029s`):

| take | position (ppqn) | duration (ppqn → s) | waveformOffset (s) |
|---|---|---|---|
| 1 | 55 | 15304.9997 → 7.971354 | 2.083770990371704 |
| 2 | 0 | 15360 → 8.000000 | 10.05512523651123 |
| 3 | 0 | 15360 → 8.000000 | 18.055124282836914 |
| 4 | 0 | 15360 → 8.000000 | 26.055124282836914 |
| 5 | 0 | 15360 → 8.000000 | 34.05512619018555 |
| 6 (live/stop) | 0 | 6557.4742 → 3.415351 | 42.05512619018555 |

Consecutive-offset deltas vs the ideal 8.000000 s: 7.999999046 s, 8.000000000 s,
8.000001907 s, 8.000000000 s — max deviation ≈2 µs ≈ **0.09 samples**. Additive-chain
check (`take1.waveformOffset + take1.durationSec` vs measured `take2.waveformOffset`):
predicted 10.055124998092651, measured 10.05512523651123, diff ≈0.24 µs ≈ **0.01 samples**.
Shared-buffer length (`AudioFileBox.endInSeconds`, identical across all 6 takes since they
share one buffer) = 45.470497131347656 s = 2,005,248.923 samples; **mod 128 = 0.92
samples** (~21 µs) from an exact RenderQuantum boundary. Final live take's declared end
(`waveformOffset+duration`) = 45.47047734260559 s vs the actual buffer end
45.470497131347656 s: gap ≈0.87 samples (~20 µs).

**Cell B — 48000 Hz, 120 BPM** (5 takes; `outputLatency=0.023s`, `baseLatency≈0.002917s`):

| take | position (ppqn) | duration (ppqn → s) | waveformOffset (s) |
|---|---|---|---|
| 1 | 46 | 15314.0002 → 7.976042 | 2.073666572570801 |
| 2 | 0 | 15360 → 8.000000 | 10.049708366394043 |
| 3 | 0 | 15360 → 8.000000 | 18.049707412719727 |
| 4 | 0 | 15360 → 8.000000 | 26.049707412719727 |
| 5 (live/stop) | 0 | 5976.8802 → 3.113542 | 34.04970932006836 |

Deltas: 7.999999046 s, 8.000000000 s — max deviation ≈1 µs ≈ **0.05 samples**.
Additive-chain check: predicted == measured to displayed float precision (diff = 0 s).
Buffer length = 37.162689208984375 s = 1,783,809.082 samples; **mod 128 = 1.08 samples**
(~22.5 µs). Final live take declared end = 37.162667751312256 s vs buffer end
37.162689208984375 s: gap ≈1.03 samples (~21 µs).

**Cell C — adversarial, 44100 Hz, 97.3 BPM** (4 takes, register's recommended irrational-BPM
cell; 4-bar loop, not the register's 1-bar hand-trace example, so the specific
`ideal_sample_count mod 128` value differs from that worked example but the cell is still
a non-power-of-two-friendly bpm/rate pairing):

| take | position (ppqn) | duration (ppqn → s) | waveformOffset (s) |
|---|---|---|---|
| 1 | 27 | 15332.9994 → 9.849049 | 2.5336575508117676 |
| 2 | 0 | 15360 → 9.866392 | 12.382706642150879 |
| 3 | 0 | 15360 → 9.866392 | 22.249099731445312 |
| 4 (live/stop) | 0 | 7375.3079 → 4.549292 | 32.1154899597168 |

Ideal loop duration `ppqnToSec(15360, 97.3) = 9.866392290751904 s`. Measured deltas:
9.866393089 s, 9.866390228 s — deviation ≈0.8–2 µs ≈ **0.03–0.09 samples**. Additive-chain
check: predicted 12.38270616531372, measured 12.382706642150879, diff ≈0.48 µs ≈
**0.02 samples**.

**Verdict across all three cells**: consecutive `waveformOffset` deltas match the pure
`intervalToSeconds` tempo-math ideal to within float-precision noise (<0.1 sample) at
every step, with **no growth by take number** and no rate- or BPM-dependent divergence —
the opposite of a `(n−1)×Δ_wrap` compounding signature, and roughly 30–100× below the
predicted worst-case 128-sample (2.90 ms @44100 / 2.67 ms @48000) bound. This is
**expected, not a refutation of S22's mechanism**: the register itself describes
`currentWaveformOffset += intervalToSeconds(...)` as pure continuous-time float addition
with zero `sampleRate`/`RenderQuantum` coupling — so of course the *declared* box-graph
value advances by the exact ideal amount every time; that is the code's own arithmetic,
not something a live measurement could falsify. What S22 actually predicts is a
divergence between this declared value and the point where the *real* audio content
begins in the shared ring buffer — a quantity this method cannot see (box-graph fields
carry no information about the underlying audio thread's true wrap-sample). Confirming or
refuting the magnitude of that specific divergence needs audio-content cross-correlation
against a hardware-timed reference (e.g. an injected tone or click track), which was not
performed this session (mic captured only ambient room noise — sufficient for box-graph
field measurements per the task brief, insufficient for reliable cross-correlation).

The final-live-take overshoot (S24) *is* fully measurable from box-graph + file fields
alone, and both nominal-case cells (A, B) confirm it: buffer-length-mod-128 and
declared-end-vs-buffer-end gaps both land under 1.1 samples (~20–23 µs), deep inside the
predicted `[0,128)`-sample/2.9 ms bound. No main-thread jank was induced this session, so
this confirms only the nominal case — the register's adversarial jank scenario (heavy
synchronous JS or an occluded tab right at the Stop click) remains untested.

### Task 9 register status updates (S20–S26)

| ID | status | note |
|---|---|---|
| S20 | open (not exercised) | take1 `waveformOffset` values (2.08 s@44100/120bpm, 2.07 s@48000/120bpm, 2.53 s@44100/97.3bpm) decompose plausibly into count-in + `outputLatency` (0.023 s, both rates) + a small remainder (~30–60 ms) attributable to `headStartSeconds`+`inputLatency`; no anomaly, but headStart wasn't isolated from inputLatency independently — would need `settings.recording.inputLatency=0` control to isolate. |
| S21 | open (not exercised) | no live output-device switch was performed mid-session; `outputLatency` read as the same `0.023s` at both rates, consistent with a single stable snapshot. |
| S22 | open (mechanism consistent w/ code; magnitude unmeasured) | 3 cells (A, B, C above) show declared `waveformOffset` deltas match pure tempo-math to <0.1 sample, no compounding by take number — consistent with the register's own description of the code (pure float addition, no RenderQuantum coupling in the *declared* value). Does not confirm or refute the predicted declared-vs-true-audio-content divergence, which needs audio-content cross-correlation (not performed — see above). Left `open` rather than `confirmed`/`cleared`; a future pass with an injected reference tone/click and WAV cross-correlation is the concrete next step. |
| S23 | open (not exercised) | cosmetic-only per register (live waveform painter jitter); not pursued — would need frame-by-frame canvas inspection during recording. |
| S24 | **confirmed (nominal case)** | cells A and B both show buffer-length-mod-128 and final-take declared-end-vs-actual-buffer-end gaps under 1.1 samples (~20–23 µs), deep inside the predicted `[0,128)`/2.9 ms bound. The register's adversarial jank scenario (heavy main-thread work or an occluded tab right at Stop) was not tested — nominal-case confirmation only, jank case remains open. |
| S25 | open (not exercised) | would need a waveform-canvas screenshot in the stop→`onSaved` async gap; not attempted. |
| S26 | **cleared, confirmed live** | `audioContext.sampleRate` (read via the React fiber) matched the `?sampleRate` query param exactly (44100, 48000) in every session; `AudioFileBox.endInSeconds × sampleRate` landed within ~1 sample of the independently-computed take-boundary sums at both rates in every cell — no context/engine sampleRate mismatch observed, consistent with the register's own "cleared as app-invariant" classification. |

`#367` (known exemplar, not a register row): **confirmed live at 44100 Hz** (5-click
boundary leak measured via output tap, matching the predicted signature exactly);
**inconclusive at 48000 Hz** (tooling limitation, not a measurement — see environment
note above and the Step 2 write-up).
