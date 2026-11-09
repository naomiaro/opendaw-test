# Recording on displays that do not run at 60 Hz

**SDK:** 0.0.183 (installed release; source read at the `@opendaw/studio-sdk@0.0.183` tag).
**Browser:** Playwright's Chrome 156, macOS, built-in display at 120 Hz, output device at 44.1 kHz.
**Question (2026-11-09):** a tip said recording could misbehave when openDAW runs on a device, a TV for
example, whose refresh rate is not 60 Hz. Does it, on 0.0.183?

**Answer:** audio and MIDI recording do not depend on the frame rate, and measure the same at 24 Hz as
at 60. Automation recording does: each recorded point lands one to two SDK updates early, and writes
closer together than one update are merged into one point. On a 24 Hz screen that is 41–82 ms early and
about 24 points a second, against 12–41 ms and about 57 a second at 60. Upstream's capture plan
already says `RecordAutomation` was not moved onto the audio clock (below).

## How the frame rate reaches the SDK

- The engine's main-thread state (position, `isPlaying`, `isRecording`, …) is read once per SDK
  `AnimationFrame` tick (`EngineWorklet.ts:342`, `AnimationFrame.add(() => reader.tryRead())`). The
  `SyncStream` holds one state; the worklet writes the next one in the first quantum after a read
  (`lib/std/src/sync-stream.ts`), so the state a tick reads was written just after the previous tick.
- The tick is the window's animation frame with a clamp: `lib/dom/src/frames.ts` skips a frame that
  comes less than 16 ms after the last one it ran (`clampTo60fps`, default true). So the SDK runs
  at most one tick per 16 ms (62.5 Hz; 60 on a 60 or 120 Hz panel), and several fast displays come out slower:

  | Display | SDK updates | Interval |
  |---|---|---|
  | 24 / 25 / 30 Hz (TV film / PAL / NTSC modes) | 24 / 25 / 30 | 41.7 / 40 / 33.3 ms |
  | 50 Hz | 50 | 20 ms |
  | 60 Hz | 60 | 16.7 ms |
  | 75 Hz | 37.5 | 26.7 ms |
  | 90 Hz | 45 | 22.2 ms |
  | 100 Hz | 50 | 20 ms |
  | 120 Hz | 60 (58.4 measured) | 16.7, 5 % at 25 ms (measured) |
  | 144 Hz | 48 | 20.8 ms |
  | 165 Hz | 55 | 18.2 ms |

  Computed from the clamp on an even frame cadence; only the 120 Hz row is measured. On this 120 Hz panel the
  frames came 7.3–9.3 ms apart; when two gaps added up to less than 16 ms the clamp waited for a third
  frame, so 15 of 300 ticks were 25 ms apart and the mean rate was 58.4 Hz.

## What reads the frame-driven state while recording

- **Audio (`RecordAudio`)**: placed from `engine.recordingStart` and the processor's
  `firstQuantumTime`, takes split at `transportAnchors` jump stamps, ended at the engine's
  `recordingStop`. All three arrive by message (`EngineWorklet.ts:321-331`), not by frame. The audio
  itself drains from the ring buffer on a worker blocked in `Atomics.wait`
  (`studio/adapters/src/RingBuffer.ts`). The per-frame `engine.position` subscription only grows the
  live region for display; the stop rewrites the length from the stop stamp.
- **MIDI (`RecordMidi`, `CaptureMidi`)**: each note is placed from its `MIDIMessageEvent.timeStamp`
  mapped to the audible context time, on a `TransportLog` built from the anchors. Frames only grow the
  take for display.
- **Automation (`RecordAutomation.ts:294-311`)**: `handleWrite` stamps every parameter write with
  `engine.position.getValue()`, the position read on the last tick. A write at the same truncated
  pulse as the previous point overwrites that point's value (`handleWriteUpdate`, the
  `relativePosition === state.lastRelativePosition` branch). Every write between two ticks reads the
  same position, so only the last one survives. Loop wraps are detected by the position going
  backwards between ticks, and the take ends at the position of the last tick before the stop.
- Upstream's `plans/capture.md` (0.0.183 tag) section 7.1, item 8: "`RecordAutomation` records a parameter at the rendered
  position of the write, without any latency term … It stays as it is"; section 8, "Not done" item 1:
  "`RecordAutomation` unchanged (7.1.8)". The same plan verified audio and MIDI recording with animation
  frames stopped altogether (section 8, "Verified in Chrome" item 3).

## Measurements

### Automation (probe: `automation-probe.js`)

`live-automation-recording-demo.html`, Loop off, 122 bpm. The probe clicks Record, waits 300 ms, then
writes the audio unit's volume with `editing.modify(() => volume.setUnitValue(v), false)`: phase A
every 37 ms for 4 s, then phase B every 4 ms for 1 s (a fast knob or a MIDI controller). Each value is
distinct (golden-ratio sequence, three decimals), so each recorded point is matched to its write by
value. The reference is the transport position rendering when the write was made,
`recordingStart.position + (audioContext.currentTime − recordingStart.contextTime) × 1952 ppqn/s`
(±1 render quantum, 2.9 ms). A negative error is a point placed before that position. The first
point (at the take start) and the last (the stop's hold) are not counted. The SDK tick rate was measured in the same run by
an `AnimationFrame.add` counter. Throttled rows use `?frameDriver=throttled&frameEvery=N` on the
120 Hz display. To rerun: paste the probe into `browser_evaluate` (or DevTools) on the dev server. It
finds the SDK's `AnimationFrame` by the dev server's pre-bundled module URL
(`@opendaw_lib-dom.js`), so it will not find it on a production build. It clicks Record from script,
so the AudioContext must already be running (it was in Playwright's Chrome; in a normal Chrome, click
the page once first). It returns "context suspended" otherwise.

| SDK updates (measured) | Phase A error, median (min…max) | A points kept | B points kept (1 s) |
|---|---|---|---|
| 56.6 Hz, unthrottled | −23.4 ms (−41.0 … −11.7) | 103 / 105 | 44 / 172 |
| 39.9 Hz, `frameEvery=3` | −34.9 ms (−55.4 … −23.2) | 103 / 105 | 26 / 188 |
| 29.9 Hz, `frameEvery=4` | −49.6 ms (−64.2 … −29.1) | 101 / 105 | 30 / 194 |
| 24.0 Hz, `frameEvery=5` | −52.6 ms (−81.7 … −40.9) | 80 / 102 | 20 / 187 |

A first unthrottled run without phase B read −23.3 ms (−38.2 … −14.6), 102 of 105 matched.

Reading: the error runs from about one update interval to about two (the position was written just after the
previous tick and is read by the write after the current one). A point that is missing was merged into the next
write of the same tick; at 24 Hz the 37 ms writes lose about one in five. Phase B keeps roughly one
point per tick. The simplifier (ε = 0.01) can drop a point too; with these non-collinear values it
dropped few. Not separated from merging here.

Not measured: the error against what the player heard. The heard position is behind the rendered one
by the output latency, so against the ear the early placement is partly offset by the output latency,
by an amount that changes with the display's update rate.

### Audio and MIDI at 24 Hz

- `recording-alignment-audit-debug-demo.html?scenario=all&bpm=120&rate=48000&frameDriver=throttled&frameEvery=5`
  (envelope `.verify-output/recaudit-summary-1794256681286.json`, page tick measured 24.0 Hz):
  every cell `aligned`, netted medians 1.15 ms (loop-wrap 1.10–1.16 over 12 takes), head and tail
  missing 0 on every row. The unthrottled 0.0.183 sweep read 1.16.
- `midi-input-alignment-audit-debug-demo.html?scenario=all&bpm=120&frameDriver=throttled&frameEvery=5`
  (run token 1794256886463, IAC Driver Bus 1, `displayRefreshHz` 24.0): every cell `aligned`, 48 of
  48 notes on all 12 repeats, placement medians under 0.005 ms, loop-wrap three takes, nothing
  missing, extra, stuck or merged. Count-in pickups recorded 1 of 3: openDAW#493, open, unrelated.

Not run: the 48 kHz device pass, the multitrack scenarios, a real display at 24/50/75/144 Hz (the
throttle sets the interval; a real display's frame timing jitter is not reproduced by it).

## Open

- Draft for upstream: `drafts/TO-REVIEW-openDAW-automation-recording-frame-rate.md`. Upstream already
  records the cause (above), so the draft's only new content is the frame-rate dependence and its
  figures; posting is the user's call.
