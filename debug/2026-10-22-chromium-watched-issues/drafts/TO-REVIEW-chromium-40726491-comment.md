# Draft — comment on Chromium 40726491 (WebAudio currentTime and synchronisation issue)

Status: TO-REVIEW. Nothing posted. Target: a comment on https://issues.chromium.org/issues/40726491 (open, P3,
WebAudio-timeline), into which 40693959 ("getOutputTimestamp doesn't accurately represent the output audio
stream position") was merged. Figures from `debug/2026-10-22-chromium-watched-issues/note.md`, "clock-drift",
every number checked against its envelope. A measured signature on current Chrome, not a new report. The user
decides whether and when it goes.

---

A current-Chrome measurement of the behaviour 40693959 describes, with a page that has no audio library on it:
https://opendaw-test.pages.dev/chromium-watched-issues-debug-demo.html?issue=clock-drift&rate=48000&hidden=0
(a running context with an AudioWorklet tone and an OscillatorNode; `getOutputTimestamp()` and `outputLatency`
read on a Worker tick every 10 ms for 20 s per phase; the figure is `(Δ contextTime − Δ performanceTime) × rate`
in audio frames from the first sample). Chrome 155.0.8059.85, macOS 15.6.1, a MacBook whose output device runs at
44.1 kHz.

- A 48 kHz AudioContext (resampled to the 44.1 kHz device): the relation is a sawtooth. It ramps at about 62
  audio frames per second (0.13 %) and snaps back by 278 frames every 4.49 s: 14 of 14 snaps that size in a
  one-minute run, 34 of 35 (the first 248) over two and a half minutes in another, the same whether the main
  thread is idle, blocked for 80 ms every 500 ms, changing the graph every 50 ms, or the window is hidden. 278
  frames at 48 kHz are 255 frames at 44.1 kHz, one 256-frame device buffer, and 4.49 s × 62 ≈ 278: the snap is
  the accumulated ramp, corrected a device buffer at a time.
- A 44.1 kHz AudioContext (the device's rate): one step per 80 s run, early and with nothing happening on the
  page (−229 frames at 12 s in one run, −997 frames, 22.6 ms, at 9 s in another), otherwise a slope of about 5.7
  ppm, which is the clock skew one expects; nothing from the main-thread blocks, the graph changes, or a worklet
  burning 60 % of every render quantum.
- With the output device switched to 48 kHz the two cases swap: the 48 kHz context reads like the native one
  above, and the 44.1 kHz context gets the sawtooth, 234 frames (again one 256-frame device buffer) every
  1.58 s, 39 snaps in 60 s, ramp 149 frames per second. The amplitude is one device buffer in both directions;
  the period and slope depend on the direction of the resampling.
- `outputLatency` read 28.00 ms (27.00 with the device at 48 kHz) on every sample of every run, so a page that
  corrects a schedule by it cannot see the change.

Where it shows: anything that bridges the context clock to `performance.now()` through this pair, Web MIDI
scheduling here. A pair read once drifts away from the output by up to 5.8 ms within five seconds on the
resampled context; reading it on every display frame keeps a page within about one audio frame of the ramp and
one display frame late on a snap. Envelopes with every figure are in the write-up linked from the page.
