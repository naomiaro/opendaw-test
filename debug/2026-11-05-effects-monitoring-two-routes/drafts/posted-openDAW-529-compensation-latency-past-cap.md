<!-- Posted as https://github.com/andremichelle/openDAW/issues/529 on 2026-11-05. Body as filed. -->

# Past the 100 ms cap, `compensationLatency` and the PDC footer report more delay than the audio gets

**Build:** https://opendaw.studio, build `adc1d47d-eda2-406c-a1ef-87a7bbd61f83` (2026-11-04), Chrome, macOS, 48 kHz.

Above the 100 ms compensation cap, the footer and `engine.compensationLatency` keep rising while the delay applied to the
other paths stops at 100 ms. The script compiles without a message and the footer shows no warning.

**Steps**

1. New Project, Add audio track. Add a second audio track with a Werkstatt whose script starts with `// @latency 150`, click Run.
2. Read the footer: `PDC 150.0ms`.

**Measured.** With the second track muted, the first track was monitored With Effects from a burst stream, and worklet
outputs 0 and 1 were recorded side by side. The monitor output does not follow compensation, so output 0 minus output 1 is the delay applied to that path.

| Declared | Footer | Output 0 minus output 1 |
|---|---|---|
| `// @latency 99` | `PDC 99.0ms` | 4752 frames (99 ms) |
| `// @latency 150` | `PDC 150.0ms` | 4800 frames (100 ms) |

**Where it happens** (read at `@opendaw/studio-sdk@0.0.181`): `compensation.rs:47` clamps the delay to the cap, and
`lib.rs:1761` takes `output_latency` from the uncapped arrival, which is what `compensation_latency()` returns.

The cap itself is documented (the Werkstatt manual: "up to 100 ms per path"), and the Signal Graph page marks such an edge
as `exceeded`. The uncapped figure also feeds the offline render's start trim (`offline-worker.ts:89`) and take placement
(`RecordAudio.ts:124`, `RecordMidi.ts:74`), so those may land off by the excess. I read that in the source and did not
measure it.

Found while measuring #528. Probe and figures: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-05-effects-monitoring-two-routes/note.md
