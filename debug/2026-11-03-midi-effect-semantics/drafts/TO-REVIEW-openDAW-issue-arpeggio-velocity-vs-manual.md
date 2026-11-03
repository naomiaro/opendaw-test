<!-- Draft for the user's read. Target: a new issue on andremichelle/openDAW. Not posted. -->

# Arpeggio: the Velocity control does not do what its manual says (−100 % is silent, 0 % is full)

**SDK:** `@opendaw/studio-sdk` 0.0.180 (WASM engine), Chrome, macOS.

The Arpeggio's manual describes its Velocity control as a blend between a fixed full velocity and the
input note's own velocity (`packages/app/manual/public/devices/midi/arpeggio.md`, "6. Velocity"):

> −100 % (displayed 0 %): All notes play at full velocity (127), ignoring input
> 0 % (displayed 50 %): Blend of fixed and original velocity
> +100 % (displayed 100 %): Notes retain their original input velocity

The engine does something else over the whole lower half of the range. At −100 % every step is
emitted at velocity 0, which an instrument renders as silence; at 0 % every step is emitted at 1.0
whatever the input; the input's own velocity comes through only at +100 %. Between −100 % and 0 %
the output is the constant `1 + v`, independent of the input.

**Measured** (a Nano playing a sine, a held C-major triad at velocity 0.8 arpeggiated Up at 1/16, gate
50 %, the render read back note by note; the manual's blend is `vel + (1 − vel) × (1 − v) / 2`):

| Velocity (box value `v`) | manual | engine (read velocity) |
|---|---|---|
| −1.0 (displayed 0 %) | 1.00 | silence, no note emitted at an audible level |
| −0.5 | 0.95 | 0.50 |
| 0.0 (displayed 50 %) | 0.90 | 1.00 |
| +0.5 | 0.85 | 0.90 |
| +1.0 (displayed 100 %) | 0.80 | 0.80 |

The read velocities are relative to the same instrument's level at velocity 1.0; the reader resolves
0.005. The same holds on a single held note at velocity 1.0, where −100 % is silent and −50 % reads
0.50.

**Where it comes from:** `crates/stock-devices/device-arpeggio/src/lib.rs`, `set_velocity_matrix`
(lines 108–118 in the 0.0.180 tag): for `value <= 0` the multiplier is 0 and the addend `1 + value`;
for `value > 0` the multiplier is `value` and the addend `1 − value`. The crate's comment says it
mirrors the TS `parameterChanged` velocity branch, so the TS device likely behaved the same; the
manual describes the opposite ends.

**Repro page (unlisted, Chrome; deterministic, no hardware):**
https://opendaw-test.pages.dev/midi-effect-semantics-audit-debug-demo.html?rows=dry-sixteenths,arp-vel-1-held-chord,arp-vel-0.5-held-chord,arp-vel0-held-chord,arp-vel0.5-held-chord,arp-vel1-held-chord
— a real click on Run; each `arp-vel…` row reads `matches-known-deviation arpeggio-velocity-matrix`
against the manual's rule, with the read velocities in its figure, and `arp-vel-1-held-chord` reads
silence. (The page goes live when the branch that carries it merges.)

**Register and method:**
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-03-midi-effect-semantics/note.md
("Known deviations", `arpeggio-velocity-matrix`, and "Questions for upstream").
