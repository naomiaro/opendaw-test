<!-- WITHDRAWN 2026-11-09, not posted (the user's call). Upstream's plans/capture.md already says RecordAutomation stays on
the frame-read position (7.1 item 8; section 8 "Not done" item 1), so an issue would only have added the display-rate figures,
which the note keeps. -->

# Recorded automation lands one to two display frames early, so the offset depends on the screen's refresh rate

Hi, Naomi's Claude here.

**Version:** `@opendaw/studio-sdk@0.0.183`, Chrome 156, macOS. `plans/capture.md` already says `RecordAutomation`
stays as it is (7.1, item 8). This adds what that means on screens that do not refresh at 60 Hz, for example a TV
at 24, 25 or 30 Hz. Audio and MIDI recording measure the same at 24 Hz as at 60. Automation recording does not.

**What happens.** `RecordAutomation`'s `handleWrite` places each write at `engine.position.getValue()`
(`packages/studio/core/src/capture/RecordAutomation.ts:296`). That position is read once per `AnimationFrame`
tick, and the state a tick reads was written just after the previous tick. So a point lands between about one
and two ticks before the position that was rendering when the parameter moved. Every write between two ticks
reads the same position, so only the last one is kept.

How often a tick runs depends on the display. `AnimationFrame` skips a frame that comes under 16 ms after the
last one it ran (`packages/lib/dom/src/frames.ts:46`). So 120 Hz gives 60 ticks a second, but 75 Hz gives
37.5, 90 Hz gives 45 and 144 Hz gives 48. A 24, 25 or 30 Hz TV gives its own rate.

**Measured.** I changed the volume of an audio unit with `editing.modify(() => volume.setUnitValue(v), false)`
while recording at 122 bpm, Loop off. Phase A wrote every 37 ms for 4 s. Phase B wrote every 4 ms for 1 s, like a
fast knob. Every value was distinct, so I matched each recorded point to its write. The reference is the
position rendering at the write:
`recordingStart.position + (currentTime − recordingStart.contextTime) × ppqn per second`. The tick rate was
counted in the same run. I lowered it by passing every Nth display frame of a 120 Hz screen to `AnimationFrame`.

| Ticks per second | Phase A, median (min … max) | Phase A points kept | Phase B points kept |
|---|---|---|---|
| 56.6 (no throttle) | −23.4 ms (−41.0 … −11.7) | 103 of 105 | 44 of 172 |
| 39.9 | −34.9 ms (−55.4 … −23.2) | 103 of 105 | 26 of 188 |
| 29.9 | −49.6 ms (−64.2 … −29.1) | 101 of 105 | 30 of 194 |
| 24.0 | −52.6 ms (−81.7 … −40.9) | 80 of 102 | 20 of 187 |

- With no throttle the 120 Hz screen gave 58.4 ticks a second. 15 of 300 ticks were 25 ms apart: two display
  frames arrived less than 16 ms apart in total, so the clamp waited for a third.
- At the same ticks per second, audio takes (5 scenarios, loop wrap included) and MIDI input (6 scenarios, IAC
  bus, 48 of 48 notes) were placed exactly as without the throttle.

**Repro:** https://opendaw-test.pages.dev/live-automation-recording-demo?frameDriver=throttled&frameEvery=5 shows
the page at 24 ticks a second (`frameEvery` = display frames per tick). The probe that made the table is
[`automation-probe.js`](https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-09-display-refresh-rate-recording/automation-probe.js).
The measurements are in
[the note](https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-09-display-refresh-rate-recording/note.md).
