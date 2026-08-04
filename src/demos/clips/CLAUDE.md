# Clips Demos — OpenDAW SDK Reference

### Minimal audible AudioClipBox recipe
A launcher clip needs exactly four things wired up inside one `editing.modify()`:
```typescript
const eventsBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());
const clip = AudioClipBox.create(boxGraph, UUID.generate(), clip => {
  clip.clips.refer(trackBox.clips);       // membership: which track's launcher column
  clip.file.refer(fileBox);               // source audio
  clip.events.refer(eventsBox.owners);     // mandatory pointer, even if never populated
  clip.duration.setValue(bars * PPQN.Bar); // loop length in PPQN
  clip.index.setValue(column);             // launcher grid column (0-based)
});
```
`timeBase` is left unset — clips default to Musical (PPQN) timing, matching the
project's `AudioClipBox` schema default. No `AudioRegionBox`, no timeline position:
a clip has no place on the timeline until it's converted to a region (see Commit,
below).

### Engine reads only `loop` of ClipPlaybackFields
`AudioClipBox.triggerMode` (a `ClipPlaybackFields`) also exposes `reverse`, `speed`,
`quantise`, and `trigger`, but the WASM engine's clip playback path (verified against
SDK 0.0.164) only consults `.loop`. Leaving it at its schema default plays the clip
once and stops — the launcher clips in this demo never set it, and instead rely on
the demo re-launching the same clip to keep it going. Don't spend time wiring
`quantise`/`trigger` per-clip expecting them to change playback — they're schema
surface, not yet read.

### Quantization rules
Clip launches quantize to a grid, not to an absolute time:
- With nothing else playing, a launch quantizes to the next **bar** boundary.
- With another clip already playing, a launch quantizes to that **playing clip's own
  duration** grid (its loop length), so a newly-launched 1-bar clip on another track
  locks to the 4-bar clip already running, not to the next raw bar.
This is why `useClipStates`' "waiting" state can span more than one bar before the
engine confirms "sequencing" — the wait is until the next multiple of whatever's
already playing, not until the next bar tick.

### scheduleClipPlay / scheduleClipStop: different UUID kinds
```typescript
project.engine.scheduleClipPlay([clip.box.address.uuid]);            // CLIP uuids
project.engine.scheduleClipStop([track.trackBox.address.uuid]);      // TRACK uuids
```
`scheduleClipPlay` takes the UUIDs of the `AudioClipBox`(es) to launch.
`scheduleClipStop` takes the UUIDs of the `TrackBox`(es) whose currently-playing clip
should stop — there's no "stop this specific clip" call, because only one clip can
play per track at a time (see takeover, below).

### Launching starts the transport; stopping it resets the sequencer — only with reset=true
`scheduleClipPlay` resumes the AudioContext and starts the engine transport if it
isn't already running — there's no separate "arm" step before a clip can play.
`project.engine.stop(reset?: boolean)` only resets the clip sequencer (every
playing clip stops, state forgotten, no "resume where the clips left off" on the
next `play()`) when `reset` is `true`, or when the transport wasn't already
playing/recording. A bare `stop()` (reset defaults to `false`) while the engine is
transporting is pause-only — the sequencer's "playing" clips stay marked playing,
so a later `play()` resumes them instead of leaving them stopped (verified against
the installed `EngineWorklet` stop-command handler, SDK 0.0.164: it always calls
`pause()`, but only calls the hard `stop()` — the one that resets the clip
sequencer — when passed `reset` or when the engine wasn't already transporting).
The demo's `playArrangement()`, `stopTransport()`, and `clearArrangement()` all
call `stop(true)` specifically to guarantee no jam-mode clip keeps sounding under
linear arrangement playback.

### subscribeClipNotification: payload shapes and partial catchup
```typescript
const sub = project.engine.subscribeClipNotification(notification => {
  if (notification.type === "waiting") {
    notification.clips.forEach(uuid => /* optimistic — scheduled, not yet confirmed */);
  } else { // "sequencing"
    const { started, stopped, obsolete } = notification.changes;
    // engine-confirmed at the quantize boundary
  }
});
```
- `"waiting"` fires on the main thread the moment a clip is scheduled — optimistic,
  before the engine has actually reached the quantize boundary.
- `"sequencing"` fires from the engine once the boundary is crossed and carries the
  authoritative `started`/`stopped`/`obsolete` UUID lists.
- **Partial catchup**: unlike a `catchupAndSubscribe` naming, but not "future only"
  either. `subscribeClipNotification` synchronously invokes the observer once, at
  subscribe time, with a `"sequencing"` notification whose `started` list holds every
  clip currently playing (`obsolete`/`stopped` empty) — verified against the
  installed `EngineWorklet` (SDK 0.0.164). Only the **"waiting"** state is not
  replayed: subscribe before the first launch, or you'll miss "waiting" for any clip
  already scheduled (but not yet confirmed) by the time you subscribe.

### One clip plays per track; takeover silences only that track's regions
A `TrackBox` can hold many `AudioClipBox`es (one per launcher column), but at most one
plays at a time. Launching a second clip on a track that already has one playing
doesn't stop-then-start — the new clip takes over at the quantize boundary and the old
one stops the same instant. While any clip is active on a track, that track's timeline
regions go silent for as long as the clip owns it; other tracks' regions are
unaffected — a clip playing on Drums has no bearing on Bass, Guitars, or Vox.

### AudioClipBox cascade delete
`clips`, `file`, and `events` pointers on `AudioClipBox` are all `mandatory: true`.
Calling `audioUnitBox.delete()` cascades: `TrackBox` (mandatory `tracks` pointer) →
the Tape instrument box (mandatory `host` pointer) → every `AudioClipBox` on that
track (mandatory `clips` pointer into `trackBox.clips`) → each clip's private
`ValueEventCollectionBox` (mandatory `events` pointer) → and, once the last
referencing clip is swept, the shared `AudioFileBox` too (`AudioFileBox` itself
declares `pointerRules.mandatory`). One `.delete()` on the audio unit is enough to
unwind an entire stem's clips and file — used for boot-failure rollback in
`jamSetup.ts` when a later stem's fetch fails after earlier stems already committed.

### Commit: converting playing clips to regions
There is no SDK "convert clip to region" call — the demo hand-builds the equivalent.
For each track with a clip currently playing, in one `editing.modify()`:
```typescript
AudioRegionBox.create(project.boxGraph, UUID.generate(), box => {
  box.regions.refer(track.trackBox.regions);
  box.file.refer(track.fileBox);
  box.events.refer(eventsBox.owners);        // fresh ValueEventCollectionBox, not the clip's
  box.position.setValue(start);              // next open section boundary
  box.duration.setValue(SECTION_PPQN);        // region spans a fixed 4-bar section
  box.loopOffset.setValue(0);
  box.loopDuration.setValue(clip.bars * PPQN.Bar); // clip's own loop length tiles the section
});
```
A region built this way — `duration` set to the section length, `loopDuration` set to
the clip's own loop length, default (Musical/PPQN) `timeBase` — tiles the clip's loop
correctly across the whole section with no gaps or seams. This mirrors the full
OpenDAW studio's clip context-menu **Convert to Region** action, applied to every
playing clip at once.

### Raw stems need waveformOffset to skip the silent lead-in
Cambridge-MT multitrack stems (this demo's Dark Ride source) share a session start
well before the song's first note — Drums/Bass/Guitars start at file offset 0 but
carry no signal above noise floor until ~9.7s in, and Vox not until ~24.6s (verified
via `AudioBuffer.getChannelData(0)` scan, SDK 0.0.164). A clip or region built from
file offset 0 therefore loops pure studio silence — audibly silent despite the engine
reporting `"playing"`/`"sequencing"` correctly (verified via RMS: analyser tap showed
noise floor for both clip AND committed-region playback until this was fixed). Both
`AudioClipBox.waveformOffset` and `AudioRegionBox.waveformOffset` (seconds, field 7 on
each — see `documentation/05-samples-peaks-and-looping.md`) shift the engine's read
position within the file and must be set to the stem's actual content start. This
demo computes it once per stem with `findContentStart()` (`waveform.ts`, first sample
past a 0.01 amplitude threshold) and stores it on `JamTrack.contentStartSeconds`,
applied to every launcher clip (`jamSetup.ts`) and every committed region
(`commit()` in `jam-arrangement-demo.tsx`) — and to the waveform preview draws in
`ClipGrid.tsx`/`ArrangementPanel.tsx` so what's drawn matches what plays.

### Gotchas hit during implementation
- `flatMap` over a `SortedSet` doesn't flatten (see root CLAUDE.md) — region traversal
  in `ArrangementPanel.tsx` goes through `getAllAudioRegions()` / adapter `.values()`,
  never a raw `SortedSet` in a `flatMap`.
- `CanvasPainter` debounces; the arrangement panel's `editing.subscribe(() =>
  painter.requestUpdate())` is what repaints region blocks after Commit — without it
  the canvas would only redraw on resize.
- The clip grid's per-frame progress bar reads `project.engine.position.getValue()`
  directly inside `AnimationFrame.add()` and writes `--progress` via
  `style.setProperty` — no `setState` in the frame loop (repo rule: AnimationFrame
  overlays use direct DOM).
