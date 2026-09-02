# Recording start-alignment audit — same-context loopback feasibility probe

**What this is:** the bring-up feasibility note for the audit harness's loopback path (Task 1 of the campaign) — a record of the probe run, not an issue or PR draft and not filed anywhere. The campaign register is `recording-start-alignment-audit.md`.

Scratch note for Task 1 of the campaign's session directory (not committed; HARD GATE). Not indexed in `debug/README.md` — this is a scratch record of the probe
run, not a standing investigation.

## Question

Does a `MediaStreamAudioDestinationNode` created in the SAME `AudioContext` the SDK's
engine runs in actually deliver signal to `CaptureAudio`, unlike the cross-context
variant documented as silent in `src/demos/recording/CLAUDE.md`'s "Don't Synthesize
Input" rule?

## Procedure

`src/lib/audit/loopbackInjection.ts` patches `navigator.mediaDevices.getUserMedia` /
`enumerateDevices` before SDK init so the SDK's own `CaptureAudio` requests a stream
from a `MediaStreamAudioDestinationNode` living in the same context the engine boots
into. Two sources feed the node: the engine's own output (through a 1500 Hz lowpass,
low band) and scheduled 6 kHz reference-click tone bursts (high band). Probe page:
`recording-alignment-audit-debug-demo.html?scenario=probe&rate=48000` — arms a Tape
onto the synthetic `"loopback-injection"` device, records ~4s (metronome on,
count-in configured but `startRecording(false)` so no count-in actually runs), stops,
waits for the take region's `SampleLoader` to finalize, and measures RMS on channel 0.
Pass threshold: `rms > 0.005`.

## Run 1 (fresh page load) — FAIL, but not a routing failure

```
[recording-alignment-audit] probe: booting engine, rate=48000
[recording-alignment-audit] probe: tape armed on loopback device
[recording-alignment-audit] probe: recording started
[RecordAudio] start {outputLatency, inputLatency}   (SDK console.debug)
[recording-alignment-audit] probe: recording stopped, waiting for finalization
[recording-alignment-audit] verdict: FAIL: no take region created
```
`#audit-state` → `done`, regions = 0. No `[RecordAudio] createTakeRegion` line ever
appeared — the SDK creates a take's `fileBox`/`AudioRegionBox` reactively, gated on
`engine.position.catchupAndSubscribe` seeing `isRecording && !isCountingIn` on a
position value that has actually advanced (`RecordAudio.js`, the
`fileBox.isEmpty()` branch). This looked like the transport-position-start delay
already documented for `engine.play()` in `src/demos/engine/CLAUDE.md` ("position can
take 20-30s+ to start advancing... occasionally not at all until a re-play") — not a
loopback-signal problem, since no take region existed to measure RMS on at all.

## Run 2 (fresh reload, added position/isRecording polling every 500ms) — PASS

```
[recording-alignment-audit] probe: recording started
[recording-alignment-audit] probe: t=501ms  position=849.9  isRecording=true isCountingIn=false
[recording-alignment-audit] probe: t=1001ms position=1843.2 isRecording=true isCountingIn=false
[recording-alignment-audit] probe: t=1501ms position=2775.0 isRecording=true isCountingIn=false
[recording-alignment-audit] probe: t=2001ms position=3763.2 isRecording=true isCountingIn=false
[recording-alignment-audit] probe: t=2501ms position=4710.4 isRecording=true isCountingIn=false
[recording-alignment-audit] probe: t=3001ms position=5688.3 isRecording=true isCountingIn=false
[recording-alignment-audit] probe: t=3502ms position=6630.4 isRecording=true isCountingIn=false
[recording-alignment-audit] probe: t=4001ms position=7587.8 isRecording=true isCountingIn=false
[recording-alignment-audit] probe: recording stopped, waiting for finalization
[recording-alignment-audit] probe: measured rms=0.074515
[recording-alignment-audit] verdict: PASS
```
`#audit-state` → `done`, `#probe-verdict` → `PASS` (`data-verdict="PASS"`). Table:
context rate 48000, regions 1, frames 192641 (≈ 4.01s at 48kHz — matches the ~4s record
window with `useCountIn=false`, no count-in padding), rms 0.074515 (14.9× the 0.005
pass threshold). Screenshot captured during this run confirms the green `PASS` badge
and the same table values shown above.

## Conclusion

**PASS.** With the transport actually advancing, the same-context
`MediaStreamAudioDestinationNode` topology delivers non-trivial signal
(rms=0.074515) into `CaptureAudio` — the cross-context silent-capture failure mode
does not reproduce here. `src/demos/recording/CLAUDE.md` updated with the verified
exception (see commit).

**Caveat for later tasks:** the transport-position-start delay is real and can
produce a false "no take region" outcome unrelated to loopback routing. Task 4 (full
scenario harness) should either poll `engine.position`/`isRecording` before trusting a
"0 regions" result, or otherwise guard against this known flakiness so it doesn't get
misread as a scenario failure.
