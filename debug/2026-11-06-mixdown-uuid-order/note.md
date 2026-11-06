# A mixdown of several audio units depends on their UUIDs, in the last bits

**Status:** not a defect, not filed. A project keeps its UUIDs when copied, so rendering the same project again is
bit-identical. It matters to anything that compares hashes between separately built projects.

**Verified against:** `@opendaw/studio-sdk@0.0.182`, Playwright's Chrome on macOS, output device at 44.1 kHz. Source citations are read
at that tag.

**Repro page:** none kept. The page was a throwaway, deleted after the run. Rules and the fix:
`documentation/10-export.md` ("Bit-Exact Renders and Audio Unit UUIDs"), `src/demos/export/CLAUDE.md`.

## What was run

One project of five Tapes (a tone, a sweep, impulses, noise, a chord), 2 s, sample generated in memory, rendered offline. Each row
rendered twice per page load and hashed with SHA-256 over the rendered samples. 16 page loads across random and seeded UUIDs on 33
rows, then 11 loads on the five mix and path rows with ascending, descending and seeded UUIDs. Page rates 48 and 44.1 kHz.

The 33 rows: the five units summed; a control with one unit's volume nudged by 0.0001 dB; five units each with an effect; 21 stock effects
each on one unit, the others muted; 6 instruments with four notes; `OfflineEngineRenderer.start`; `renderSection` on the loop area, one
pass; stems. The later loads added the mix with the master Maximizer removed.

## What was measured

- The same render twice in one load: identical on every row of every load.
- Across loads with random UUIDs: 28 of 33 rows identical, including all the single-unit rows and the stems. The 5 that differ are the ones
  summing several units: the mix, its nudged control, the mix with effects, `start`, `renderSection`.
- The control changes the hash, and the same float32 stems summed forward and reversed differ on 41928 of 107872 frames, so the hash can
  see a change of order.
- Random loads land on the same hashes as seeded ones (`a304d3e5`, `eb33fc83` at 48 kHz): a small set of results, as a set of orders
  would give.
- The same seed gives the same hash on every row across loads, at both rates.
- Ascending UUIDs: identical across loads with 0, 3 and 17 extra `UUID.generate()` calls after each Tape, at both rates (0 and 17 at 44.1 kHz).
- Descending UUIDs: a different hash on every summed row, identical with 0 and 3 extra calls. This is the control that the order is the cause.
- `renderSection` on one pass hashes the same as one `step` of the same project (read at 48 kHz).

Sizes of the difference, sample by sample, over both channels:

| Compared | Rate | Row | Samples differing | Largest |
|---|---|---|---|---|
| Ascending, descending | 48 kHz | Mix | 84254 of 192000 | 2.146e-6 (−113.4 dBFS) |
| Seed 1, seed 2 | 48 kHz | Mix | 81764 of 192000 | 1.073e-6 (−119.4 dBFS) |
| Ascending, descending | 44.1 kHz | Mix | 85378 of 176400 | 4.172e-7 (−127.6 dBFS) |
| Ascending, descending | 48 kHz | Mix, no master Maximizer | 83856 of 192000 | 1.192e-7 (−138.5 dBFS) |
| Seed 1, seed 2 | 48 kHz | Mix, no master Maximizer | 75340 of 192000 | 1.192e-7 (−138.5 dBFS) |
| Ascending, descending | 44.1 kHz | Mix, no master Maximizer | 73906 of 176400 | 1.192e-7 (−138.5 dBFS) |
| Ascending, descending | 48 kHz | Mix with effects | 79476 of 192000 | 2.980e-7 (−130.5 dBFS) |

## Mechanism (read at the tag)

- `observe_audio_units` says "We do not order the units (order is not audible)" (`crates/engine/src/audio_unit/mod.rs:747`).
- An offline render boots from the project's bytes (`studio-core/dist/OfflineEngineRenderer.js:175`). The graph's incoming pointers are sorted
  by address, UUID first (`crates/boxgraph/src/graph.rs`), so the units are pushed in UUID order (`mod.rs:836-843`).
- `resolve_outputs` adds each unit to its bus in that order (`routing.rs:167`), and `AudioBusProcessor::process` sums its sources in list order
  (`crates/engine-env/src/audio_bus_processor.rs:108-117`).
- A running engine appends a unit that arrives in a later transaction, and a re-route removes and re-adds a source, so its order also depends on
  the edit history. Read in the source, not measured.
- `ProjectSkeleton` stamps `rootBox.created`, so the project's bytes differ on every build. The render does not read it: rows held across loads with
  those bytes differing.

## What this does not show

- Other machines and other browsers.
- Buses and aux sends in the mix. Sends and sinks follow the unit outputs on a bus (`resolve_sends`, `resolve_sinks` run after `resolve_outputs`), so
  the order there is not purely by UUID. Read in the source, not measured.
- Sample-based instruments, tempo changes, automation.
- Some single-unit rows prove nothing about their device: with default settings Convolver, StereoTool, NeuralAmp, Waveshaper and both composites
  equal their input, and Werkstatt, Sink and Apparat are silent.
- The peak of 1.167 on the mix through the default master Maximizer (look-ahead off) was not looked into.
