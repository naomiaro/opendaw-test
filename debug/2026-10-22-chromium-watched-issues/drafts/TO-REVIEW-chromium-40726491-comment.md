# Draft — comment on Chromium 40726491 (WebAudio currentTime and synchronisation issue)

Status: TO-REVIEW. Nothing posted. Target: a comment on https://issues.chromium.org/issues/40726491 (open, P3,
WebAudio-timeline), into which 40693959 ("getOutputTimestamp doesn't accurately represent the output audio
stream position") was merged. Figures from `debug/2026-10-22-chromium-watched-issues/note.md`, "clock-drift".
A measured signature on current Chrome, not a new report. The user decides whether and when it goes.

---

A current-Chrome measurement of the behaviour 40693959 describes, with a page that has no audio library on it:
https://opendaw-test.pages.dev/chromium-watched-issues-debug-demo.html?issue=clock-drift&rate=48000&hidden=0
(a running context with an AudioWorklet tone and an OscillatorNode; `getOutputTimestamp()` and `outputLatency`
read on a Worker tick every 10 ms for 20 s per phase; the figure is `(Δ contextTime − Δ performanceTime) × rate`
in frames from the first sample). Chrome 155.0.8059.85, macOS 15.6.1, a MacBook whose output device runs at
44.1 kHz.

- A 48 kHz AudioContext (resampled to the 44.1 kHz device): the relation is a sawtooth. It ramps at about 62
  frames per second (0.13 %) and snaps back by exactly 278 frames every 4.49 s, 35 of 35 snaps the same size over
  three minutes, the same whether the main thread is idle, blocked for 80 ms every 500 ms, changing the graph
  every 50 ms, or the window is hidden.
- A 44.1 kHz AudioContext (the device's rate): one step of −229 frames 12 s in with nothing happening on the
  page, otherwise a slope of about 5.7 ppm, which is the clock skew one expects.
- `outputLatency` read 28.00 ms on every sample of every run, so a page that corrects a schedule by it cannot see
  the change.

Where it shows: anything that bridges the context clock to `performance.now()` through this pair, Web MIDI
scheduling here. A pair read once drifts away from the output by up to 5.8 ms within five seconds on the
resampled context; reading it every frame keeps a page within one frame of the relation. Envelopes with every
figure are in the write-up linked from the page.
