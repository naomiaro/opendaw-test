## Symptom

With the metronome **preference disabled** and a count-in enabled, starting a recording can play one extra click exactly at the punch-in downbeat: a 1-bar 4/4 count-in sounds as **1 2 3 4 — 1** instead of **1 2 3 4**. The recording itself is click-free afterwards, so the leak is exactly the boundary click.

The pre-WASM TS engine behaved correctly (1 2 3 4, then silence at punch-in). The responsible code is unchanged from `@opendaw/studio-sdk@0.0.161` (the first WASM-only release) through current `main`, so the regression window is the TS→WASM engine transition.

## Repro

https://opendaw.studio/ — disable the metronome, keep a 1-bar count-in, arm a track, record (reproduced 2026-08-27 at default settings). Also reproducible from the SDK at 0.0.170.

Note: whether the click audibly leaks depends on quantum alignment (below), so it can appear intermittent across machines/sample rates — e.g. it always leaks at 44.1 kHz / 120 BPM, while some 48 kHz configurations can mask it.

## Cause (`crates/engine/src/lib.rs`, same on current `main`)

1. The metronome is forced on during count-in regardless of the preference:
```rust
// ~line 1799
self.metronome.set_enabled(self.metronome_pref || self.is_counting_in);
```
2. The count-in → recording flip is quantum-granular and tests the **block start** position:
```rust
// ~lines 1466-1471 — the comment itself notes: "Quantum-granular (TS splits the
// block at the exact position; one quantum ≈ 2.7 ms)."
if self.is_counting_in && self.transport.position() >= self.recording_start {
    self.is_counting_in = false;
    self.is_recording = true;
    self.metronome.set_enabled(self.metronome_pref);
}
```
3. When `recording_start` falls **strictly inside** a quantum, the flip hasn't fired for that block, the metronome is still forced-enabled, and `Metronome::process` schedules every beat in `[p0, p1)` — including the punch-in downbeat at exactly `recording_start`. One extra click renders; the flip lands on the next quantum.

If `recording_start` happens to land exactly on a quantum boundary, the flip fires first and the click is correctly suppressed — which is why audibility is alignment-dependent. `Transport::process_quantum` advances the position in float pulses (`p1 = p0 + samples_to_pulses(128, …)`), so alignment depends on sample rate × BPM × count-in length plus float accumulation: at 44.1 kHz / 120 BPM a bar is 88 200 samples = 689.0625 quanta (boundary always mid-quantum → always leaks); at 48 kHz / 120 BPM a bar is exactly 750 quanta, but 5.12 pulses/quantum is not binary-exact, so the rounding direction of 750 accumulations decides it.

The TS engine split the render block at `recording_start` (`renderer.setCallback(...)`), so the boundary beat fell in the post-flip half and was suppressed when the preference was off.

## Suggested fix

While counting in with the preference off, clamp metronome scheduling to `position < recording_start` — e.g. pass an optional pulse limit into `Metronome::process` for the count-in case, or evaluate the flip against the block **end** before scheduling. Either removes the alignment dependence and restores the TS behavior without re-introducing block splitting.

## Notes

- Count-in *duration* is unaffected (measures exactly N bars — verified separately); only the forced-metronome *window* extends one block past the boundary.
- No app-side workaround exists, since the forced-on window ignores `settings.metronome.enabled`.
- Write-up with full details: https://github.com/naomiaro/opendaw-test/blob/main/debug/countin-metronome-boundary-click.md (lands on main shortly; currently on the feat/swipe-comping-demo branch)
