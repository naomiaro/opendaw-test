# Combined MIDI + audio audit: the SDK's round trip, several Tapes, a rebuild step

**Date:** 2026-10-30. **Page:** `midi-audio-combined-audit-debug-demo.html` (extended, not a new page).
**Register:** `debug/2026-10-20-midi-audio-combined/note.md`.

## Why

SDK 0.0.180 added `CaptureAudio.measureRoundTrip()`, a built-in latency calibration (three
maximum-length-sequence noise bursts, found by cross-correlation; the median stored in
`localStorage["opendaw:round-trips"]` per output device name, input label and sample rate). On a
Tape whose own `captureBox.inputLatency` is Inherit (−2), the stored figure replaces both
reported latencies: `outputLatency = roundTrip`, `inputLatency = 0`. This is the calibration path
users of the SDK will reach for now.

The combined page already calibrates by its own method (three 6 kHz clicks through the Tape's input
chain, onsets, `measureMicRoundTrip` in `src/lib/audit/combinedCalibration.ts`) and on 0.0.180 its
`calibrated` state reads `together` (key and sound 0.00 ms apart on the built-in microphone).

The user wants to know:

1. **Does the SDK's measured figure agree with the page's?** (Two independent methods on the same
   chain.)
2. **Does a Tape relying on the SDK's stored figure record where the calibrated Tape does?**
   (The `sdk-roundtrip` state, judged like the other two.)
3. **On several USB microphones at once**, and with **Bluetooth headphones** as the output (the case
   the SDK's measurement exists for: Chrome misreports Bluetooth `outputLatency`), then a
   **Focusrite Scarlett cabled output-to-input** (an absolute reference: no room in the path).
4. **What the SDK's input-chain rebuild does to both calibrations.** Since 0.0.180,
   `BrowserAudioInput` rebuilds a live input's `MediaStreamAudioSourceNode` on the same stream
   250 ms after another stream opens or closes (`AudioDevices.notifyStreamsChanged`), the device
   list changes (`devicechange`) or the context resumes (`statechange` to running), deferred while
   a recording is prepared or a take records (the maintainer's workaround for a Chromium source
   reading ~24 ms late for good after such an event). Two possible upstream issues hang on this,
   neither measured: (a) `CaptureAudio.outputNode` is a public getter and nothing tells its users
   the node was replaced (a tap on the old node goes silent); (b) a stored round trip measured on
   one node may not hold on the next (this repo's vendor register measures source nodes 9–23 ms
   apart from one node to the next); (c) `BrowserRoundTrips` keys an entry by the output device's
   label and the input track's label (plus the sample rate), never by a device id, so two inputs with
   the same label (two units of one USB model) share one entry and the last measurement wins for
   both — certain from the code, not yet shown on a page.

## Goals

- A third input-latency state, `sdk-roundtrip`, judged by the same cell verdict as `default` and
  `calibrated`.
- A per-Tape comparison line: SDK round trip − page round trip, with a verdict.
- Several Tapes recording at once, each on its own input, against one IAC MIDI capture.
- A rebuild step that forces every Tape's chain to be rebuilt, confirms it, and re-measures both
  calibrations per Tape, so the run carries a before → after figure for each method per Tape.
- Evidence fit for an issue draft (debug-note numbers, not an issue: drafting is a later step and
  the user's read comes first).
- For candidate (c): the user's two USB microphones have different labels, so the hardware runs do
  not hit it. Show it instead with two Tapes on two synthetic inputs that report the same label (the
  recording audit's `loopbackInjection.ts` clones all report `MediaStreamAudioDestinationNode`):
  measure the first, then the second, and read both Tapes' `roundTrip` — expected to be the second's
  figure for both. A small separate check on the page or a unit test against the SDK's
  `BrowserRoundTrips` with a fake `localStorage`; the builder picks.

## Non-goals

- No Bluetooth- or Scarlett-specific code: devices are picked by label (`?inputs=`, `?output=`) and
  the user handles the hardware (holding an earbud to the microphones, plugging the cable).
- No change to how the SDK measures or applies the round trip. The page measures what the SDK does.
- No upstream issue or post in this work.
- No new demo card, sitemap entry or og image: the page stays an unlisted debug page.

## Anti-goals (would make it a failure even if it runs)

- **Leaving a stored entry behind.** The recording-alignment and hidden-page audits refuse to run
  while ANY entry is stored (`src/lib/audit/storedRoundTrips.ts`). The page must refuse to start if
  an entry already exists, and drop every entry it stored when the run ends, including after an
  error or a thrown stage (`finally`).
- **Calibrating a chain the takes do not record through.** A calibration taken before a rebuild
  and applied after it would make the verdict judge a stale figure. Each pass must be tied to the
  chain it measured (record the node identity), and the cells must use the pass measured on the
  chain they record through.
- **A comparison verdict that hides which side moved.** Report both figures and both passes raw,
  not only a difference.
- **Breaking the single-Tape run.** With no `?inputs=`, the page behaves as today (one Tape on
  `?input=` or the built-in microphone), plus the new state and comparison.
- **Identical labels in the multi-Tape page:** refuse a run whose `?inputs=` resolve to two inputs
  with the same label (the SDK would give them one stored entry), naming candidate (c).
- **Changing `buildFeatures`.** The one-quantum tally counts a recording run as a release build only
  when that list is exactly `["recordingStart"]`; new probes go elsewhere (as
  `midiPlacesAtHeardTime` does).

## The run, as decided

1. **Setup.** Engine, MIDI (IAC, as today), then one Tape per input. `?inputs=<label>,<label>,…`
   (substring match, as `?input=` today; the existing `?input=` keeps working as a one-element
   list). Each Tape mono, monitoring off, its own `inputLatency` set per state. Refuse if any SDK
   round-trip entry is stored (reuse `storedRoundTripRefusal`).
2. **Settle.** After every Tape's stream is open, wait past the SDK's 250 ms rebuild window (the
   user's choice of order: open everything, then wait). Log each Tape's `outputNode` identity over
   the wait; a change is a rebuild event (Tape, context time, reason if known).
3. **First calibration pass.**
   - The page's click calibration, **one pass heard by every microphone**: the same three clicks
     out of the speakers, a capture tap on every Tape's `outputNode`, one `MicRoundTrip` per Tape.
   - The SDK's `measureRoundTrip()` **once per Tape, one after another** (each plays its own
     bursts; never two at once). Record its full `RoundTrip.Result` (`verdict`, `seconds`,
     `spreadSeconds`, `heard`, `bursts`) and the stored `RoundTrip.Entry` (`capture.roundTrip`).
   - Per Tape: **SDK round trip − page round trip**, with the node identity each was measured on.
4. **Rebuild step (the user's).** Force a rebuild of every Tape's chain, confirm each Tape's
   `outputNode` changed, then run both calibrations again exactly as in step 3. Per Tape, report:
   the page figure before / after, the SDK figure before / after, whether the stored SDK entry
   still equals the new chain's SDK measurement, and whether a capture tap left on the OLD node
   still hears the clicks (the missing-notification question).
5. **Cells.** Three states — `default` (own value 0), `calibrated` (own value = the page's input
   part from the pass on the current chain), `sdk-roundtrip` (own value Inherit; the SDK applies
   its stored entry) — for the existing scenarios. Each repeat: one MIDI pattern, every Tape
   records the speaker clicks; the key is judged once, each Tape's sound against it with the
   existing per-Tape figures, and a Tape-versus-Tape line (sound A − sound B per state).
6. **Cleanup.** `forgetRoundTrip()` on every Tape, then confirm `localStorage["opendaw:round-trips"]`
   is empty; put back anything the page changed (metronome preferences, master volume), as today.

## Verdicts

- **Cell verdict:** unchanged rules (`classifyCombinedCell`), extended so `sdk-roundtrip` has an
  expected audio position: the SDK subtracts `roundTrip` as the output latency, applies no input
  part, and subtracts `engine.compensationLatency` as in the other states, so the expected audio
  median is `pageRoundTrip − sdkRoundTrip − compensationLatency` (≈ 0 when the two agree and nothing
  is compensated). The "audio median disagrees with the calibration" attribution must name which
  calibration (page or SDK) the cell was judged against.
- **Comparison verdict (per Tape, per pass):** `agrees` when |SDK − page| ≤ one render quantum
  (2.9 ms at 44.1 kHz, `quantumMs`); otherwise `differs` with the signed difference. A non-`ok`
  SDK verdict (`unsteady`, `no-signal`) is reported as such, not compared.
- **Rebuild verdict (per Tape):** `rebuilt` / `not-rebuilt`; the shift of each method; `dead-tap`
  when a capture tap left on the old node goes silent. On 0.0.180 that is certain by reading the code
  (`#destroyAudioChain` calls `recordGainNode.disconnect()` with no argument, which drops every outgoing
  connection, the page's tap included; `outputNode` is not observable and `capture.stream` does not
  change on a rebuild), so the step is a cheap confirmation for the issue evidence, kept small; a
  `stale-tap` reading would mean the SDK changed.

## Failure and drift policy (settled after the builder check)

- **A Tape's calibration fails** (page method: clicks missed, or a round trip smaller than the
  reported `outputLatency`, which `summarizeRoundTrips` rejects as a negative input part; SDK method:
  a non-`ok` verdict): the Tape stays in the run and only the state that depends on the failed figure
  is turned off for it — `calibrated` for a failed page figure (the round trip, when there is one,
  still serves the comparison), `sdk-roundtrip` for a non-`ok` SDK result, and then the page calls
  `forgetRoundTrip()` on that Tape at once so no first-pass entry can serve the second pass's cells.
  The run aborts only when no Tape has a usable state. *(Claude's call.)*
- **A chain is rebuilt during the cells** (a `devicechange`, or a rebuild deferred during a take that
  fires 250 ms after it): the page checks each Tape's `outputNode` identity before and after every
  repeat; a repeat whose Tape's node is not the node its calibration pass was measured on is marked
  `calibration-stale` (its own verdict outcome, ahead of the band) and the run carries on without
  re-calibrating. Every row records the pass and node identity it was judged against. *(Claude's
  call; the event itself is evidence for issue (b).)*
- **The rebuild step and the second pass** run by default when the run has more than one Tape, and
  not by default with one (so single-Tape envelopes stay comparable with the register's);
  `?rebuild=on|off` overrides either way. Without the step, the cells use the first pass.
  *(Claude's call.)*

## Outputs

- The envelope (`combined-summary-<runToken>.json`, `src/lib/audit/combinedArtifacts.ts`) gains a
  per-Tape section: input label, both calibration passes (page and SDK figures, node identities),
  rebuild events, the comparison and rebuild verdicts; rows gain the Tape they belong to. Bump
  `COMBINED_SCHEMA_VERSION` and keep the parser able to read the current single-Tape envelopes
  (the register cites them).
- `node scripts/audit/midi-audio-combined/table.ts` prints the comparison and rebuild lines first,
  then the cells per Tape.
- Register section in `debug/2026-10-20-midi-audio-combined/note.md` per run the user makes; the
  page's usage notes in `src/demos/midi/CLAUDE.md` ("MIDI + audio combined" section).

## Constraints

- Node tests for every pure function (comparison, rebuild classification, expected audio for
  `sdk-roundtrip`, envelope parsing old and new); each new test shown to fail with its rule broken
  (repo rule). Logic out of the component (repo rule).
- Never write the engine preference `recording.inputLatency`; refuse if it is not 0 (as today).
- A real click starts the run (AudioContext resume, mic and MIDI permission).
- The page must not hold the audio graph lock busy in ways that disturb the SDK's stamps more than
  today (one capture tap per Tape during calibration only).
- Separately clocked USB inputs drift tens of ppm against each other; per-Tape onset detection (as
  today) is fine over a take, a cross-Tape correlation is not (root CLAUDE.md, `bestLag`).

## Left to the builder

- How to force the rebuild: opening and closing a real extra stream through the SDK's
  `AudioDevices.requestStream` (which notifies) is the realistic trigger; record which trigger ran.
- How to tap several `outputNode`s in one calibration pass (one worklet per Tape, or one with N
  inputs), and how to detect a node change (polling `outputNode` identity is fine).
- UI layout of the extra lines; envelope field names; the table's column order.
- Repeats per cell and scenarios per run (default: today's three scenarios, three repeats).

## Calls made by Claude, not the user

- Extend the existing page rather than a new one.
- One IAC MIDI capture shared by all Tapes; the key judged once.
- "Agrees" within one render quantum.
- Cells judged after the rebuild step, on the second pass (when the step runs).
- The failure and drift policy above, and `?rebuild=` defaulting on for several Tapes, off for one.
- Refuse-on-existing-entry and forget-on-exit for the stored round trips.
