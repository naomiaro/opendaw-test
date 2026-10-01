# A worklet's clock stands still while the main thread changes the audio graph

**Verified against:** `@opendaw/studio-sdk@0.0.173` (the same stamping code on 0.0.172);
Chrome 154 on macOS 15.6.1 (Apple M4 Pro), 48 kHz; Chromium `main` at commit
`4b38af96d95350e04e831d18f6ba91a2a0cca5d2` (2026-10-01) for the source lines. Firefox and
Safari: not measured.

**Status (2026-10-01):** the stale clock is measured, and watched through three natural events
on the recording harness; why it stands still is read from Chromium's source. The browser
defect is already reported: [Chromium issue 442866743](https://issues.chromium.org/issues/442866743),
"currentTime and currentFrame sometimes freeze for a render quantum" (filed 2025-09-03, open,
reproduced by Chromium triage on 142 to 144 and back to M-132; reproduced there by suspending
and resuming the context on repeat; no cause given). Nothing is posted upstream from here. Two
drafts wait for a read:
[`drafts/issue-recording-start-stale-worklet-clock.md`](./drafts/issue-recording-start-stale-worklet-clock.md)
(an openDAW issue) and
[`drafts/chromium-bug-worklet-current-frame-stale.md`](./drafts/chromium-bug-worklet-current-frame-stale.md)
(a comment for the Chromium issue: the cause and a quicker trigger).

Campaign history, run by run:
[`recording-start-alignment-audit.md`](./recording-start-alignment-audit.md), sections "The
cause of the one-quantum event" and "The one-quantum event, resolved to the worklet clock".

## Symptom

On a rare recording, a time stamp the SDK takes at the start of the take is one render quantum
(128 frames: 2.667 ms at 48 kHz, 2.902 ms at 44.1 kHz) EARLIER than the audio it describes.
The SDK takes two such stamps and places the take by their difference:

| which stamp is early | where the take lands |
|---|---|
| the engine's recording start only | one quantum late |
| the recording worklet's first quantum only | one quantum early |
| both | in place: the two cancel |

With two tapes armed, each tape has its own recording worklet and all share the engine's
stamp, so one take can be off while the other is in place.

On the recording harness (a synthetic loopback, a fresh audio chain per take): 6 events in 1020
repeats over both releases (1 in 416 on 0.0.172, 5 in 604 on 0.0.173; Fisher one-sided
p = 0.22, so not shown to differ). 789 of the repeats have two tapes (5 events), 231 one tape
(1 event; a single-tape row has no first-frame check, so it sees only the engine's stamp); 124
are at 44.1 kHz. Of the five two-tape events, two left one tape really one quantum late; in
three the stamps cancelled on both tapes. The single-tape event cannot tell. This is the
harness's rate, not an application's: see "What is established, and what is not".

A user hears nothing of one quantum on a single take. It matters where takes are compared
with each other or with a reference at sample accuracy: two microphones on one source (a
one-quantum skew between tapes is a comb filter with its first notch at 187.5 Hz at 48 kHz),
phase-aligned overdubs, loopback calibration.

## Mechanism

### What the browser does

In Chrome the worklet scope's clock is a copy, and the copy is skipped when a lock is busy.

- `RealtimeAudioDestinationHandler::Render` renders a quantum, then advances the context's
  frame and asks for the worklet scope to be updated
  (`realtime_audio_destination_handler.cc:291–293`):
  `AdvanceCurrentSampleFrame(number_of_frames); context->UpdateWorkletGlobalScopeOnRenderingThread();`
- `BaseAudioContext::UpdateWorkletGlobalScopeOnRenderingThread` (`base_audio_context.cc:983–998`)
  takes a `DeferredTaskHandler::GraphAutoTryLocker` and calls
  `global_scope->SetCurrentFrame(CurrentSampleFrame())` only `if (try_locker.IsAcquired())`
  (and only when the render thread is the worklet thread).
- `AudioWorkletGlobalScope::currentTime()` is `current_frame_ / sample_rate_`
  (`audio_worklet_global_scope.cc:296–299`); `currentFrame` is `current_frame_`.
- The main thread holds that lock (`DeferredTaskHandler::GraphAutoLocker`) in
  `AudioNode::connect` (`audio_node.cc:157`, `:236`), in every `AudioNode::disconnect`
  overload (`:310`–`:538`), in `AudioNode::Dispose` (`:74`), when an `AudioWorkletNode` is
  made (`audio_worklet_node.cc:200`), and in `MediaStreamAudioSourceHandler`
  (`media_stream_audio_source_handler.cc:88`).

So when the main thread is inside one of those at the instant a quantum ends, the worklet
scope keeps the previous quantum's frame. Every `process()` call of the next quantum, in every
processor of the context, reads a `currentFrame` and `currentTime` one quantum old. The quantum
after reads true again (a step of two quanta), unless the lock was held again. The clock is
never ahead.

The Web Audio specification says of `AudioWorkletGlobalScope.currentFrame`: "The current frame
of the block of audio being processed. This must be equal to the value of the
`[[current frame]]` internal slot of the `BaseAudioContext`", and of `currentTime`: "The context
time of the block of audio being processed."

*Corrected from the register's first write-up:* that section named the `AudioNode` constructor
among the lock holders. At the commit above the constructor does not take the lock. Creating
gain nodes in a loop does stall the clock (measured, below); the lock holder there is most
likely `AudioNode::Dispose`, called when the garbage collector frees the nodes. That last step
is inferred from the source, not observed.

### What the SDK reads

Both start-of-take stamps are one read of that clock inside one `process()` call (checkout at
`@opendaw/studio-sdk@0.0.173`):

- the engine's recording start — `packages/studio/core-wasm/src/processor.ts`,
  `#announceRecordingStart`: `currentTime + RenderQuantum / sampleRate`, on the first render
  that leaves the recording flag set;
- the recording worklet's first quantum — `packages/studio/core-processors/src/RecordingProcessor.ts`,
  `process`: `currentTime`, on the first call whose input has the expected channel count;
- placement — `packages/studio/core/src/capture/RecordAudio.ts`:
  `startOffset = contextTime − firstQuantumTime + outputLatency + inputLatency`.

Both are taken in the quanta right after `CaptureAudio.prepareRecording` has made the take's
recording worklet and connected the record gain to it, and, when the stream is opened at that
moment, made and connected its source node. That is graph work on the main thread, a few
quanta before and while the stamps are read.

## Evidence

### 1. The clock, without the SDK

`worklet-clock-debug-demo.html` (measuring code `src/lib/audit/workletClockProbe.ts`). A buffer
source plays a ramp in which every sample names its own frame, started at a known context
frame. A worklet notes for each call the `currentFrame` it read and the first sample of its
input; the stamp less the frame the sample names is 0 when the stamp is true. The main thread
meanwhile does one kind of work, 8 ms at a stretch with 2 ms between.

Run `graph-lock-clock-1790885449275.json`, 12 s per condition:

| the main thread | quanta checked | stamp true | stamp behind | by |
|---|---|---|---|---|
| does nothing | 4443 | 4443 | 0 | |
| runs a loop that touches no audio object | 4443 | 4443 | 0 | |
| connects and disconnects two gain nodes that are in nobody's path | 4444 | 2631 | 1813 | 1 to 4 quanta |
| creates gain nodes | 4443 | 3641 | 802 | 1 to 10 quanta |
| builds a `MediaStreamAudioSourceNode` and connects it to a fresh worklet node, once per stretch | 4443 | 4422 | 21 | 1 to 4 quanta |

In the last condition each fresh worklet reports the `currentFrame` of its first call with the
sample it was handed, which is the read a recorder makes once: **15 of 2210 read it early**
(14 by one quantum, 1 by two). Earlier runs: 44 of 12003 (`…1790878967602`, 60 s), 17 of 1900
(`…1790885347933`, 10 s). No stamp was ever ahead, in any run. A busy main thread alone does
nothing to the clock.

### 2. Forced, with the SDK in the loop

`recording-alignment-audit-debug-demo.html?scenario=multitrack-start&bpm=120&rate=48000&graphChurn=on`
(dev server): from each record request on, the main thread connects and disconnects two gain
nodes that are in nobody's path for 150 ms. The harness's taps attach 32 to 83 ms after the
request in this scenario, so the churn runs over their first 70 to 120 ms; the windows a node
delay is read from open 0.3 s into a tap, clear of it. Three runs
(`recaudit-mt-summary-1790880251689`, `…0319988`, `…0388326`), 46 rows measured, a node delay
read on every one (each tap has 2 to 11 quanta misplaced by stale stamps at its start: these
runs predate the repair of the harness's stamps):

| netted median / first-frame check, in quanta off the usual | rows | where the take sits |
|---|---|---|
| 0 / 0 | 22 | in place |
| 0 / −1 | 8 | one quantum early |
| 0 / −3 | 4 | three quanta early |
| +1 / 0 | 4 | one quantum late |
| +1 / −1, +2 / −2 | 4 | in place (both stamps off, cancelling) |
| +1 / −2, +2 / −3 | 4 | one quantum early |

24 of 46 rows carry a stamp that is off; 20 takes are misplaced, by −3 to +1 quanta. The
first-frame check is never positive and the netted median never negative: a stamp is only ever
early. 190 to 233 clock discontinuities per run on the harness's reference recorder.

### 3. Natural events, with the clock watched

The harness's reference recorder stamps every quantum with `currentFrame`; the calls whose
stamp did not advance by one quantum go on the envelope (`clockDiscontinuities`). 50 runs of
`multitrack-janked` and `multitrack-all` (run ids `1790879970235` to `1790884463919`), 405
repeats, 3 events:

| run | repeat | netted / check (quanta) | take | the reference recorder's clock |
|---|---|---|---|---|
| `…1789067` | r2, both tapes | +1 / −1 | in place | read 388608 twice: the frame both tapes' recorders and the engine stamped |
| `…3239303` | r2, both tapes | +1 / −1 | in place | read 390528 twice: the frame all three stamped |
| `…4327239` | r5, tape a | +1 / 0 | **one quantum late** | read 1541248 twice: the frame the engine stamped; tape a stamped 1541120, one call earlier, truly |
| | r5, tape b | +1 / −1 | in place | the same read: the frame tape b's recorder stamped |

In every event each stamp that is off reads exactly the frame the clock stood on. The control:
of the 804 rows of ordinary repeats in those runs, none has a stamp that reads a frame the
clock stood on. One ordinary repeat is a near miss (`…1857425`, r3, both tapes): the clock
stood on 771968, the frame of its record request, and both recorders and the engine stamped
in the very next quantum, truly (netted 1.146, check 0.000). So 4 stalls fell among the
stamping quanta in 405 repeats; 3 hit the quantum a stamp was taken in and are the events,
1 missed it by one quantum and left an ordinary take.

The clock stood still 67 times in 37 of the 50 runs. 40 of those are in the 150 ms before a
record request, where the harness schedules its 60 reference clicks (120 nodes made and
connected); 3 are the events and 1 the near miss; 23 are elsewhere (one of them at the time
the request of a repeat that ended as an error row would be; such a row carries no request
time). So the harness's own graph work stalls the clock about once per ten takes, a few
quanta before the stamps are read, and the event is the rarer case of a stall while they are
read.

A recorder cannot have run on a node before the node existed, and yet over the 810 rows of
these runs `firstQuantumTimeSec − nodeSourceCreatedAtSec` is 0 on 677, +128 on 122, +256 on 8
and −128 on 3: both tapes of the first event and tape b of the second (and both tapes of the
0.0.172 event). On those the main thread was making that take's source node during the stale
quantum: the stall is the take's own chain being built.

### What is established, and what is not

- **Measured:** in Chrome a worklet's `currentTime` / `currentFrame` are one or more whole
  quanta behind, never ahead, in some quanta while the main thread connects, disconnects or
  creates nodes or builds a stream source with a worklet; never while it is idle or merely
  busy. The harness's one-quantum events are that clock (three of three watched: each stamp
  that is off reads the frame the clock stood on; no ordinary row's does). Under forced graph
  work the SDK misplaces takes by whole quanta.
- **Read from source, not observed:** that the reason is the try-lock in
  `UpdateWorkletGlobalScopeOnRenderingThread`, and which main-thread call held the lock at a
  given stall. The source says so and every measurement fits; no run logged the lock. That
  the SDK's two stamps are single reads of the worklet clock is read from the SDK's source and
  shows in every row's arithmetic.
- **Not measured:** Firefox, Safari (the Chromium issue's reporter says the freeze is Chrome
  only); other machines; the rate in a real session. The harness
  rebuilds the audio chain on every take (its synthetic device reports no id) and schedules
  its clicks just before each take, so it does more graph work around a take's start than an
  application recording from one named device, which reuses its chain. Any application UI that
  builds or connects nodes at the moment recording starts adds to it.
- **Open, possibly the same cause, not re-read:** the calibration call that read one quantum
  short with verdict `ok`; the second anchor one quantum off (1 in 152 calls); the stamps that
  repeated or skipped in the two-tap spike (24 recorders of 750).
- **A second finding, not this one:** in 3 of 51 cells of these runs (and 1 of 3 forced runs)
  the LAST repeat of a cell ended as an error: one tape's `RecordingWorklet.#finalize` was
  entered (frames delivered equal to the limit, reader stopped) and its loader was still in
  `record` 40 s later, with nothing on the console. 0 of 45 comparable cells before this
  campaign. Not followed up; see the register.

## Repro

- **The clock:** `worklet-clock-debug-demo.html`, press "Run the probe" (about 50 s) with the
  page in a visible window. The page reads
  `STALE CLOCK: <n> of <N> fresh worklets read their first currentFrame early; …`,
  `CLOCK TRUE`, `NOT CHECKED` (a run that watched or worked too little to vouch for a true
  clock: a background tab does one stretch of work a second), or `THREW <stage>`, with the
  table of conditions under it. `?seconds=60&conditions=stream`
  watches the take-start condition alone for longer. Through Playwright:
  `scripts/audit/recording-alignment/one-quantum/run-graph-lock-clock.playwright.js`.
- **The SDK under forced graph work:** dev server, then
  `recording-alignment-audit-debug-demo.html?scenario=multitrack-start&bpm=120&rate=48000&graphChurn=on`.
  Rows off by whole quanta in the netted median or the first-frame check. Such a run carries
  `graphChurn: true` and no count includes it.
- **Natural events:** loop `?scenario=multitrack-janked&bpm=120&rate=48000`
  (`one-quantum/run-loop.playwright.js`), then
  `node scripts/audit/recording-alignment/one-quantum-events.ts`: each event tape's line says
  whether the clock stood still at one of its stamps.

## Fix idea (internal — does not go in an issue)

The clock is only ever behind, and by whole quanta. That makes a stamp repairable wherever a
processor has a call history, and it is what the harness now does for its own stamps
(`repairFrames` in `src/lib/audit/nodeTap.ts`: a stamp less than one quantum after the call
before it is moved to exactly that).

**The engine's stamp.** The engine processor is called every quantum for the life of the
context. It can keep the frame of its previous call and take, per call,
`frame = max(currentFrame, previousFrame + RenderQuantum)`, then report
`(frame + RenderQuantum) / sampleRate`. When the context was suspended, or the processor was
not called for a while, `currentFrame` is the larger and wins. Cost: one comparison per
quantum. This removes the "one quantum late" case entirely, and with it the engine's half of
every cancelling pair.

**The recorder's stamp.** A recorder is new at each take and has no history at its first call,
which is the one it stamps. Three ways, weighed:

1. *Hold the report back for N calls and send the largest `stamp − 128 × callIndex` among
   them.* A stale stamp is too small, a true one gives exactly the first call's frame, so the
   largest is right as soon as one of the N calls read a true clock. It rests on the calls
   being consecutive quanta, which the ring buffer already assumes (frame 0 of the ring is
   call 0). It is never worse than the single read, and it is right when N is longer than
   what is left of the stall the first call fell into. Stalls measured: 2 quanta at most on
   natural harness runs; 5 under forced connect / disconnect on the harness; one fresh
   worklet's first read 7 quanta early in the probe's take-start condition; 41 while nodes
   were being created in a loop. So N = 8 has no margin; N = 32 (85 ms at 48 kHz) covers
   everything seen at a take's start. Cost: the first-quantum time arrives that much later
   on the main thread, which reads it when it places the take; a placement that comes sooner
   takes the fallback path it already has.
2. *Report at once, and send a correction if a later call within N shows the first stamp was
   early.* No delay in the common case; the main thread must take the latest value at
   placement, and a take placed before the correction arrives keeps the early stamp.
3. *Read a clock the engine processor keeps for the scope.* It does not work as it stands:
   both processors run in the same scope, but in an order the graph decides, and in a stale
   quantum the recorder cannot tell whether the engine has already been called for this
   quantum (the raw `currentFrame` is the same before and after). Only with a guaranteed
   order.

Way 1 is the smallest change, and way 2 the one without a delay; either needs N chosen
against the stall lengths above. Both repairs are local to the two processors and change
nothing for a browser whose clock is true.

**Upstream context.** The user's open PRs on this code are openDAW #378, #380 and #418; none
touches either stamping site. Whether this becomes another PR, and on top of which, is the
user's decision.

**The browser.** The Chromium draft adds the try-lock and the trigger to the existing issue
and leaves the remedy to the maintainers. Until it changes, any worklet code that reads `currentTime` once and treats it as
the time of its block is exposed whenever the page builds or connects nodes; the same holds
for this repo's worklet recorders that stamp quanta with `currentFrame` / `currentTime`
(repaired in the recording harness; the metronome regression page's `OutputRecorder` slices by
`currentTime` and is not repaired).
