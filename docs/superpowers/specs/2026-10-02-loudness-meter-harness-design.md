# Loudness meter harness — design

Date: 2026-10-02. Status: waiting for review.

## Goal

A standing check that plays the EBU loudness test signals through the live engine, reads the
SDK's loudness meter, and judges each reading against the EBU tolerance. It answers one
question after every SDK upgrade: what does the meter read for a signal whose loudness is known,
and has that changed?

The page is also the repro page any upstream report about the meter would link to.

## Background

The SDK has one loudness facility. The engine worklet runs a `LoudnessMeter` on its main stereo
output while something is subscribed, and publishes five floats:

```ts
project.liveStreamReceiver.subscribeFloats(EngineAddresses.LOUDNESS, values => {
  // [momentary LUFS, shortTerm LUFS, integrated LUFS, loudnessRange LU, peak dB]
});
```

Facts the design rests on (read in the SDK source, `studio-core-wasm/src/analysis-dsp.ts` and
`processor.ts`):

- The meter is fed only while the address has a subscriber.
- It has no reset. Its gating histograms live as long as the worklet processor.
- Momentary and short-term are rings of 100 ms blocks (4 and 30 blocks).
- The offline renderer does not run it, and the class is not importable from the package. The
  live stream is the only public way to read it.

Measured in Node on 2026-10-02 against the installed SDK (0.0.173), by importing the dist file
directly: 1 kHz tones read 0.25 LU low, loudness range cases are exact, and the fifth value is
sample peak, not true peak. Those numbers are what the page's first run is checked against. They
are not the harness's pass criteria.

## Out of scope

- Export: no measurement or normalisation of rendered audio.
- A reference BS.1770 meter in this repo, and any comparison on real programme material.
- A Node test tier against the meter class.
- Upstream issue drafts. They follow the first run, on request, through the usual
  `drafts/TO-REVIEW-…` path.
- The remaining EBU cases. Tech 3341 case 6 (5.0 surround) cannot reach a stereo meter, and
  cases 7–8 and Tech 3342 cases 5–6 need the EBU's authentic programme files. Tech 3341 cases
  9–14 (momentary and short-term dynamics), 19 (a tone above full scale) and 20–23 (signals
  synthesized at four times the rate and downsampled) can be synthesized and are left for a
  later version. Adding one is a new row in the case table.

## Cases

All signals are stereo, the same samples on both channels, synthesized at the AudioContext's
sample rate. Levels are the sine's peak in dBFS.

| Group | Id | Signal | Judged | Expected | Tolerance |
|---|---|---|---|---|---|
| loudness | `3341-1` | 1 kHz, −23.0, 20 s | I, max M, max S | −23.0 LUFS | ±0.1 LU |
| loudness | `3341-2` | 1 kHz, −33.0, 20 s | I, max M, max S | −33.0 LUFS | ±0.1 LU |
| loudness | `3341-3` | 1 kHz: −36 for 10 s, −23 for 60 s, −36 for 10 s | I | −23.0 LUFS | ±0.1 LU |
| loudness | `3341-4` | 1 kHz: −72 10 s, −36 10 s, −23 60 s, −36 10 s, −72 10 s | I | −23.0 LUFS | ±0.1 LU |
| loudness | `3341-5` | 1 kHz: −26 20 s, −20 20.1 s, −26 20 s | I | −23.0 LUFS | ±0.1 LU |
| range | `3342-1` | 1 kHz: −20 20 s, −30 20 s | LRA | 10 LU | ±1 LU |
| range | `3342-2` | 1 kHz: −20 20 s, −15 20 s | LRA | 5 LU | ±1 LU |
| range | `3342-3` | 1 kHz: −40 20 s, −20 20 s | LRA | 20 LU | ±1 LU |
| range | `3342-4` | 1 kHz: −50, −35, −20, −35, −50, 20 s each | LRA | 15 LU | ±1 LU |
| peak | `3341-15` | fs/4, 0.50 FS, phase 0°, 5 s, 10 ms fades | peak | −6.0 dBTP | +0.2 / −0.4 dB |
| peak | `3341-16` | fs/4, 0.50 FS, phase 45°, 5 s, 10 ms fades | peak | −6.0 dBTP | +0.2 / −0.4 dB |
| peak | `3341-17` | fs/6, 0.50 FS, phase 60°, 5 s, 10 ms fades | peak | −6.0 dBTP | +0.2 / −0.4 dB |
| peak | `3341-18` | fs/8, 0.50 FS, phase 67.5°, 5 s, 10 ms fades | peak | −6.0 dBTP | +0.2 / −0.4 dB |
| weighting | `kweight` | −20 dBFS sine at 25, 40, 60, 100, 250, 500, 1000, 1500, 2000, 3000, 5000, 8000, 12000, 16000, 20000 Hz, 6 s each | S at the end of each tone | −20.691 + K(f) LUFS | ±0.1 LU |

The EBU rows were checked on 2026-10-02 against Table 1 of EBU Tech 3341 (2023 edition) and
Table 1 of EBU Tech 3342 (2023 edition). Tech 3341 leaves the duration of the peak tones open
and asks for a 10 ms fade-in and fade-out; 5 s is this harness's choice. Both documents state:
"The loudness meter shall be reset before each measurement."

The `kweight` group is this harness's own, not an EBU case. K(f) is the BS.1770 K-weighting
gain in dB at f, computed from the standard's two filter stages (shelf: 1681.97 Hz, +3.9998 dB,
Q 0.70718; high-pass: 38.135 Hz, Q 0.50033, numerator 1, −2, 1) transformed at the running
sample rate. Its ±0.1 LU tolerance is chosen to match the loudness cases.

## Files

| File | Purpose |
|---|---|
| `loudness-meter-audit-debug-demo.html` | Unlisted entry (noindex), added to `vite.config.ts` inputs only |
| `src/demos/engine/loudness-meter-audit-debug-demo.tsx` | The page: run loop, tap wiring, table |
| `src/demos/engine/loudnessSession.ts` | The engine side of a case: tape region, worklet restart, tap wiring, play and capture |
| `src/lib/audit/loudnessCases.ts` | The case table as data, and group and id lookup |
| `src/lib/audit/loudnessSignals.ts` | Segments → `Float32Array` at a rate; `kWeightingDb(sampleRate, hz)` |
| `src/lib/audit/loudnessTap.ts` | The output tap: its worklet source, and delivered level, peak and signal span from its chunks |
| `src/lib/audit/loudnessVerdict.ts` | Reading series + delivered level → row verdict |
| `src/lib/audit/loudness*.test.ts` | Node unit tests for the four modules |
| `debug/2026-10-02-loudness-meter/note.md` | Write-up and the per-SDK-version result register |

The four `src/lib/audit/` modules hold no SDK or DOM code, so they test in Node. The page and
`loudnessSession.ts` own everything that touches the engine.

## One case, start to finish

1. **Build.** One Tape unit with one audio region holding the case's signal, registered through
   `localAudioBuffers` the way `auditBuilders.ts` registers its synthetic buffers. Unit and
   master volume 0 dB, pan centre, region gain 0 dB, no fades, no stretch, metronome off.
2. **Fresh meter.** Restart the worklet through the SDK's recovery path: give the project a new
   `LiveStreamReceiver`, call `project.startAudioWorklet()`, wait for ready. A new processor
   means an empty meter, which is the reset the EBU documents require and the meter does not
   offer. Attach the output tap to the new node and disconnect the previous one. A first
   reading that is not empty (integrated above −119) makes the row `invalid`.
3. **Subscribe** to `EngineAddresses.LOUDNESS` on the new receiver and keep every reading with
   its arrival time. The subscription is what switches the meter on, so it comes before play.
4. **Play** from position 0.
5. **End-of-signal reading.** The tap, not the transport, says when the signal started and
   ended. The first reading that arrives at least 200 ms after the tap sees the end gives
   integrated, loudness range and peak. Maximum momentary and short-term come from the whole
   series.
6. **Late reading.** Five seconds after the end, read again. The meter cannot be stopped, so
   this shows whether its numbers move once the programme is over. It is reported, not judged.
7. **Stop,** judge, add the row, go to the next case.

The `kweight` group is one case with fifteen tones back to back in one worklet. Short-term is a
3 s ring, so each 6 s tone has fully replaced the previous one by its end. The reading for a
tone is the last one that arrives before the tap sees that tone end.

## Keeping the signal path honest

A wrong reading must be attributable to the meter. The page gets the engine node through the
`engineTap` option of `initializeOpenDAW` (and directly from `startAudioWorklet()` after a
restart) and connects output 0 to a small tap worklet. The tap posts, per 100 ms, each
channel's sum of squares, sample peak and frame count.

The engine node is disconnected from the speakers and reaches the destination only through the
tap, which outputs silence, so a run is silent: the tones last ten minutes and Tech 3341 warns
that the peak signals are very loud. `?audible=1` connects the engine to the destination as
well. The meter sits inside the engine processor, so what it reads is the same either way.

From the tap the page derives:

- **Delivered level per segment:** RMS over the segment's interior (edges excluded), stated as
  the sine peak in dBFS. More than 0.02 dB from the intended level makes the row `invalid`.
- **Delivered sample peak** for the peak group, shown beside the SDK's reading. More than
  0.05 dB from the analytic sample peak of the synthesized signal makes the row `invalid`: the
  path resampled or interpolated, and the case no longer tests what it claims.

## Verdicts

| Verdict | Meaning |
|---|---|
| `pass` | Every judged metric within the case's tolerance |
| `fail` | A judged metric outside tolerance; the row shows each error |
| `invalid` | Signal not delivered as intended, or the tab was hidden during the case |
| `error` | The case threw or passed its deadline (signal duration + 30 s) |

A hidden tab stops the main thread from receiving the stream, so the page records
`document.visibilityState` through the case and refuses to judge a case that saw `hidden`.

## Page and output

- **Parameters:** `?case=all`, one id (`3341-3`), or one group (`loudness`, `range`, `peak`,
  `weighting`). `?rate=48000` (default) or `44100`, passed as `audioContextSampleRate`.
  `?audible=1` to hear the run.
- **Start:** one Run button, because the AudioContext needs a real click.
- **State line:** `idle`, `setup`, `running:<id>`, `done`, `error:<message>`, readable by a
  browser driver.
- **Table:** one row per case (one per tone for `kweight`): expected, tolerance, SDK reading,
  error, delivered level, late reading, verdict.
- **Summary:** all rows as JSON via `PUT /__verify/loudness-audit-<timestamp>.json`, the sink the
  other audits use. The envelope carries the SDK version, sample rate and user agent. A failed
  upload (the deployed site has no sink) is shown beside the state and does not fail the run.
- **Duration:** about twelve minutes for `all` (signals 610 s, plus the late reading and a
  restart per case).

The page follows the other unlisted debug pages: not in `src/index.tsx`, not in the sitemap, no
README row.

## Tests

Node unit tests, written before the code they cover:

- **Signals:** segment lengths in frames, level of each segment, phase continuity across a
  level change, the analytic sample peak of the fs/4, fs/6 and fs/8 tones.
- **K-weighting formula:** against known points of the standard's response (near +0.7 dB at
  1 kHz, +4.0 dB at high frequencies, strongly negative below 40 Hz) and against the published
  48 kHz coefficients.
- **Case table:** unique ids, every group resolvable, durations sum to the documented total.
- **Verdicts:** each of the four outcomes, asymmetric tolerance (+0.2 / −0.4), a reading exactly
  on the limit, an `invalid` that would otherwise have been a `pass`. Each test starts from a
  state the code must change.

The page itself is verified in the browser with a real click, on a fresh load, with the tab
visible.

## Risks, probed first

Two things are unproven in a browser. An early task in the plan probes both with a throwaway
page, as soon as the signal and tap modules exist and before the cases, verdicts and page are
built:

1. **A worklet restart gives a fresh meter and working playback.** Check: play a tone, restart,
   and confirm integrated reads empty (−120) before the next play. Fallback if it fails: one
   case per page load, selected by `?case=`, with a driver stepping through the ids.
2. **The tone reaches the output at unity and sample-exact.** Check with the tap on case
   `3341-1` and case `3341-16`. If the path is not transparent, find which stage changes the
   signal before any meter reading is trusted.

## What the first run should show

From the Node measurements: the five loudness cases `fail` at about −0.25 LU, the four range
cases `pass`, peak cases 16–18 `fail` (15 passes), and the weighting sweep fails between 1 and
3 kHz. A first run that differs from this is a finding about the engine path or the harness,
and is resolved before the result is registered.

The debug note registers the result per SDK version. The standing sweep after an upgrade
compares against the register; it does not expect every row to pass.

## Documentation changes in the same PR

- `debug/2026-10-02-loudness-meter/note.md` and its row in `debug/README.md`.
- `CLAUDE.md`, Build & Verification: the sweep URL and where the register lives.
- `src/demos/engine/CLAUDE.md`: the loudness stream (address, value order, subscription
  gating, no reset, live only).
- This spec and its plan are deleted in the PR that completes the work.
