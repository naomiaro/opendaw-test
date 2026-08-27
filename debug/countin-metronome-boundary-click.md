# Count-in leaks the punch-in downbeat click when the metronome is off

**Verified against:** OpenDAW SDK 0.0.170 (`crates/engine/src/lib.rs` — same code on upstream `main` as of 2026-08-27) and reproduced live on https://opendaw.studio/.
**Upstream issue:** [openDAW#367](https://github.com/andremichelle/openDAW/issues/367)
**Repro pages:** https://opendaw.studio/ (metronome disabled, count-in enabled, record) and this repo's `swipe-comping-demo.html` (Click mode "Count-in only").

## Symptom

With the metronome **preference disabled** and a 1-bar count-in, starting a recording
can play **five** clicks — `1 2 3 4` and then one more click exactly at the punch-in
downbeat — instead of four. Audibly: "1,2,3,4,1". The recording itself is then
click-free, so the leak is exactly one click at the boundary.

**Audibility is quantum-alignment dependent** (mechanism deterministic, occurrence
conditional): the click leaks iff `recording_start` falls strictly inside a render
quantum. At 44.1 kHz / 120 BPM a bar is 88 200 samples = 689.0625 quanta — always
mid-quantum, always leaks. At 48 kHz / 120 BPM a bar is exactly 750 quanta, but the
transport accumulates position in float pulses (5.12/quantum, not binary-exact), so
the rounding direction of 750 additions decides it. Expect intermittence across
machines/sample rates.

The pre-WASM TS engine behaved correctly: `1 2 3 4`, then silence at punch-in.
The responsible code is unchanged from 0.0.161 (first WASM-only release) through
upstream main — the regression window is the TS→WASM transition, not a recent update.

## Cause (source level, `crates/engine/src/lib.rs` @ 0.0.170 = upstream main)

1. During a count-in the metronome is **forced on** regardless of the preference:

   ```rust
   // line 1799
   fn apply_metronome(&mut self) {
       self.metronome.set_enabled(self.metronome_pref || self.is_counting_in);
   }
   ```

2. The count-in → recording flip runs once per render quantum, testing the **block
   start** position:

   ```rust
   // lines 1466-1471 — comment: "Quantum-granular (TS splits the block at the
   // exact position; one quantum ≈ 2.7 ms)."
   if self.is_counting_in && self.transport.position() >= self.recording_start {
       self.is_counting_in = false;
       self.is_recording = true;
       self.metronome.set_enabled(self.metronome_pref);
   }
   ```

3. For the quantum **containing** `recording_start`, the block-start position is still
   `< recording_start`, so the flip does not fire and the metronome remains
   forced-enabled for that whole block. `Metronome::process` (`metronome.rs`) then
   schedules every beat in `[p0, p1)` — and the punch-in downbeat sits exactly at
   `recording_start ∈ [p0, p1)`. One extra click renders; the flip lands on the next
   quantum.

The old TS engine split the block at `recording_start` (`renderer.setCallback(...)`,
as the port comment notes), so the boundary beat fell in the post-flip half and was
correctly suppressed when the preference was off. The quantum-granular port keeps the
count-in *duration* exact (measured previously in this repo — see
`../documentation`-adjacent note in memory: count-in measures exactly N bars) but
extends the forced-metronome *window* one block past the boundary.

## Suggested fix

While counting in with the preference off, clamp metronome scheduling to
`position < recording_start` — e.g. pass an optional pulse limit into
`Metronome::process` for the count-in case, or perform the flip against the block's
**end** position before scheduling. Either restores the TS engine's behavior without
re-introducing block splitting.

## App-side status

No workaround exists: the forced-on window ignores `settings.metronome.enabled`.
`swipe-comping-demo` ships a "Click: Count-in only" mode that pre-disarms the
preference just before the boundary so the flip restores `false` and the recording
stays click-free — but the boundary click itself still sounds until the engine fix
lands. Re-verify on the next SDK upgrade: with the fix, "Count-in only" should play
exactly `1 2 3 4`.
