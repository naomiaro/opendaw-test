# POSTED 2026-10-02 as https://github.com/andremichelle/openDAW/issues/429 (body below as filed).

**Title:** The first packet a new subscriber gets from a float broadcast can be the array as it stood before anyone subscribed: all zeros from the loudness meter on a new worklet

## Symptom

Subscribe to `EngineAddresses.LOUDNESS` on a freshly started engine worklet. In about half the attempts the first callback delivers `[0, 0, 0, 0, 0]` — 0.00 LUFS momentary, short-term and integrated, 0 LU range, 0.00 dB peak — and only the next one the meter's own values (−120 for an empty meter). A reader that takes the first packet as a reading sees a loud meter that has heard nothing.

Measured on `@opendaw/studio-sdk@0.0.173` in Chrome 154: 7 of 14 fresh subscriptions in each of two runs began with the all-zero packet (the harness below logs "skipped N unfilled loudness packet(s)" to the console when it happens). The same pattern — a `before` callback that fills the array only when `hasSubscribers` is true — is used for SPECTRUM, WAVEFORM, STEREO, GONIO and HEAP in `processor.ts:147-170`, so their first packet can be the array's previous contents too; for the spectrum that is one frame of empty bins, for loudness it is a number that reads as a measurement.

## Repro

- Live page: https://opendaw-test.pages.dev/loudness-meter-audit-debug-demo.html?case=peak with the console open: each of the four cases subscribes on a new worklet; a case that received the packet logs `[loudness-session] skipped 1 unfilled loudness packet(s)`.
- In code: `project.engine.releaseWorklet(); const w = project.startAudioWorklet(); await w.isReady(); project.liveStreamReceiver.subscribeFloats(EngineAddresses.LOUDNESS, v => console.log(Array.from(v).join(" ")))` — the first line is sometimes `0 0 0 0 0`, then `-120 -120 -120 0 -120`.

Write-up: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-02-loudness-meter/note.md

## Cause

Read in the source (`@opendaw/lib-fusion`, `LiveStreamBroadcaster.ts`), not stepped through at runtime:

- `broadcastFloats` (lines 114–125) registers a package whose `put(output, hasSubscribers)` calls `before?.(hasSubscribers)` and then writes `values` whatever `hasSubscribers` was.
- `#flushData` (lines 182–194) puts every package on every flush, passing each the subscription flag read from the shared flags array at that moment.
- The processor's `before` for LOUDNESS (`processor.ts:157-160`) fills the array from the meter only when `hasSubscribers` is true, so a flush that still saw the flag at 0 writes the array as it was: zeros on a new worklet, the last filled values on one that has measured.

A receiver that subscribes between the broadcaster reading the flags and the receiver reading that flush's data gets that packet first.

## Related

Same stream, same release: #426 (weighting) and #427 (true peak).
