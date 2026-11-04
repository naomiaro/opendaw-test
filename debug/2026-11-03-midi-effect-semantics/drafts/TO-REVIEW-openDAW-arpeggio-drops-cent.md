<!-- TO REVIEW before posting on andremichelle/openDAW. A question, not a bug report: the manual is silent. -->

# Arpeggio: is a held note's cent meant to be dropped? Every arpeggiated note-on is emitted with cent 0

**SDK:** `@opendaw/studio-sdk` 0.0.180 (WASM engine), Chrome, macOS.

The Arpeggio keeps `(pitch, velocity)` per held note and emits every step with `cent: 0.0`, so a
note's detune never reaches the instrument through an Arpeggio. A Pitch device set to +12.5 cents
BEFORE an Arpeggio has no audible effect on the cents; the same Pitch AFTER the Arpeggio detunes every
step as expected. The manual (`packages/app/manual/public/devices/midi/arpeggio.md`) says nothing
about cents either way, so this is a question: is an arpeggiator meant to retune nothing, or was the
cent left behind unintentionally?

**Measured** (a Nano playing a sine, root key 69, four held triads (Am, F, C, G around C4) at velocity
0.8, one per half bar, the render read back note by note; the reader is tested to 0.5 cents and the
judge allows 2):

| chain (index order) | pitch read | cents read |
|---|---|---|
| Pitch (+7 semitones, +12.5 cents) → Arpeggio (Up, 1/16, gate 50 %) | +7 on every step, 32 of 32 | 0.0 on every step |
| Arpeggio (same) → Pitch (same) | +7 on every step, 32 of 32 | +12.5 on every step |

By the same line a region note's own cent (the note editor's microtuning, −50..+50) would be dropped
through an Arpeggio too; that case is not measured here.

**Where it comes from:** `crates/stock-devices/device-arpeggio/src/lib.rs` (0.0.180 tag): the stack
entry is `(note.pitch, note.velocity)` (line 275), `mode_run` returns `(pitch, velocity)` (line 299),
and the emitted note-on carries `cent: 0.0` (line 304). The Pitch device shifts `record.cent`
(`device-pitch/src/lib.rs`, `transform`), so what it adds is on the record the Arpeggio reads and is
left behind there.

**Repro pages (Chrome):**
- https://opendaw-test.pages.dev/midi-effects-rendered-demo.html — Chords pattern, a Pitch card with
  Cents at +12.5 placed before an Arpeggio card: the rendered lane labels each read note's cents and
  shows none; move the Pitch after the Arpeggio and every step reads +13¢.
- https://opendaw-test.pages.dev/midi-effect-semantics-audit-debug-demo.html?rows=dry-sixteenths,order-pitch-arpeggio,order-arpeggio-pitch
  (unlisted; a real click on Run; deterministic, no hardware): `order-pitch-arpeggio` reads
  `matches-known-deviation arpeggio-drops-cent` with max |Δcents| 12.5, `order-arpeggio-pitch` holds.

**A second question on the same device.** When the held key is released in the middle of a step, the
step does not stop: it sounds for its full gate length. Is that intended? The manual's Gate ("note
length as a percentage of the step rate") says the step's length is set by the gate alone, so the
audit takes the behaviour as intended, and a word either way would settle it. Measured: at 1/16 and
gate 50 % a step is 62.5 ms; the step that starts 36.5 ms before the release still rings 62.5 ms, so
26 ms after the key is up (`lib.rs:303-306` ends a step at `position + duration` and nowhere else).

**Register and method:**
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-03-midi-effect-semantics/note.md
("Known deviations", `arpeggio-drops-cent`).
