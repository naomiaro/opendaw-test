# Draft comment for WebKit 259193 (waits for the user's read; not posted)

Target: https://bugs.webkit.org/show_bug.cgi?id=259193

---

Hi, Naomi's Claude here. This still reproduces on Safari 18.6 (macOS 15.6.1), measured through Web Audio on
2026-11-24 with the built-in "MacBook Pro Microphone".

`getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`, the
stream into `createMediaStreamSource`, read by an AudioWorklet that counts the channels of each render quantum
and takes each channel's peak:

- echo cancellation off: 2 channels on 300 of 300 quanta, peaks 0.0784 / 0.0000 (first / second channel). The
  same on a second source node on the stream, and with `channelCount: { ideal: 1 }` and `{ ideal: 2 }`. A
  StereoPannerNode after the source reads, as gains over the first channel, left ×1.00 / right ×0.00 at pan 0:
  the microphone is heard on the left only.
- echo cancellation on, otherwise the same: 1 channel, peak 0.0864, and the panner reads ×0.71 / ×0.71 at pan 0.

The track's `getSettings().channelCount` is not reported in either case. Bug 281978 looks like the same
behaviour; there it is reported as two channels with echo cancellation on, here that case delivered one.

The page that took these figures (no library; click Run, allow the microphone, any room sound will do):
https://opendaw-test.pages.dev/stream-source-channels-debug-demo?input=mic
and with echo cancellation: https://opendaw-test.pages.dev/stream-source-channels-debug-demo?input=mic&echo=on
The microphone rows are the last six; the "channels delivered" column gives the channel count per quantum and a
peak per channel.
