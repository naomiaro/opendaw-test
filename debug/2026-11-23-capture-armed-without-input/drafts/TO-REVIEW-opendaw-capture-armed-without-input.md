**Not posted.** Target: `andremichelle/openDAW` issues. Waiting for the user's read.
**Title:** Arming a capture whose input is refused leaves it armed with no stream; the only signal is an unhandled rejection

---

Hi, Naomi's Claude here.

SDK 0.0.189. When `getUserMedia` rejects (a denied microphone permission), `capture.armed.setValue(true)` on a
`CaptureAudio` leaves the capture armed with no stream. No notice reaches the `RuntimeNotifier` and `armed`
does not change; the window gets an unhandled promise rejection whose reason is an `Errors.Warning`.
`capture.monitoringMode = "direct"` and `project.startRecording()` end the same way.

**Measured**

Chrome 158, macOS, 44.1 kHz, one run. `navigator.mediaDevices.getUserMedia` is patched to return a silent
synthetic stream, or to reject with `new DOMException("Permission denied", "NotAllowedError")`. Each row is
read 2 s after the action. "Notices" counts what the SDK sent to the installed `RuntimeNotifier`.

| Row | armed | stream | `getUserMedia` calls | unhandled rejections | notices |
|---|---|---|---|---|---|
| control: a notice sent through `RuntimeNotifier.notify` | | | | | 1 counted |
| control: `armed.setValue(true)`, the input opens | true | open | 1 | 0 | 0 |
| `armed.setValue(true)`, refused | true | none | 2 | 1: `Errors.Warning`, "Error: NotAllowedError: Permission denied" | 0 |
| the same capture left armed, the input available again, 2 s | true | none | 0 | 0 | 0 |
| control: disarmed and armed again, the input opens | true | open | 1 | 0 | 0 |
| `monitoringMode = "direct"`, refused | true | none | 2 | 1: `Errors.Warning`, "Error: NotAllowedError: Permission denied" | 0 |
| `project.startRecording(false)`, the capture armed, refused | true | none | 2 | 1: `Errors.Warning`, "Error: Error: NotAllowedError: Permission denied" | 0 |

After the refused `startRecording`, `project.isRecording()` and `engine.isRecording` read false.

Page: https://opendaw-test.pages.dev/capture-armed-without-input-debug-demo (a click on Run, about twenty
seconds, silent, no microphone opened).
Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-capture-armed-without-input/note.md

**Read from the source (0.0.189, not measured)**

- `AudioDevices.requestStream` turns the rejected `getUserMedia` into a thrown `Errors.Warning`
  (`packages/studio/core/src/AudioDevices.ts:21-30`). `BrowserAudioInput.#requestStream` asks for the default
  device by id and then once without a device (`io/browser/BrowserAudioInput.ts:323-338`), which is the two
  calls; `open()` awaits it with nothing around it (`:119-155`).
- `CaptureAudio` calls `open()` from the observer of `armed`, an `async` function whose promise is not held
  (`capture/CaptureAudio.ts:61-68`), so the rejection is unhandled and `armed` keeps its value. The observers
  of `deviceId` and of the input mapping are written the same way (`:34-42`, `:56-60`).
- The `monitoringMode` setter sets the mode and then arms (`:75-81`).
- `RecordingSession.start` catches the failed `prepareRecording`, clears its recording flag and throws
  `Errors.warn(String(error))` (`capture/RecordingSession.ts:109-115`); `Project.startRecording` calls
  `Recording.start(this, countIn).finally()` without a handler (`project/Project.ts:388-392`).
- `open()` runs when `armed`, `deviceId` or the mapping changes, at a recording start and in
  `measureRoundTrip` (searched `packages/studio/core/src`: `CaptureAudio.ts:33-136` holds every caller). Nothing
  calls it for a capture that sits armed without a stream.

**Not run**

- A browser's own denial (the refusal was the patched call), and other rejections such as `NotFoundError`.
- An app without a `RuntimeNotifier` installed.
- Firefox and Safari.

**Tracker search:** "arm", "armed getUserMedia", "permission", "getUserMedia", "unhandled rejection",
"arm permission denied microphone" on this repository, open and closed: no matching issue. `plans/capture.md`
and `plans/done/advanced-monitoring.md` do not describe a refused input.
