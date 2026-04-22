# Comp Lanes Demo Redesign

## Goal

Enhance the comp-lanes demo with two comparison modes (automation crossfade vs region splice) and support for multi-file drops, making it both an educational tool and a practical comp workflow demo.

## Changes from Current Demo

### 1. Comp Mode Toggle

Two modes, toggled via `SegmentedControl`:

- **Automation Crossfade** (default): Current multi-track approach. Each take is a separate instrument track with volume automation crossfades at zone boundaries. Crossfade duration is configurable (slider, 0-200ms).
- **Region Splice**: Single track with consecutive regions. Each zone is an `AudioRegionBox` pointing to the assigned take's `AudioFileBox` with the correct `loopOffset`. The SDK's built-in 20ms voice crossfade handles transitions. No configurable crossfade — the slider is hidden in this mode.

### 2. Track Architecture

- **Tracks 1-N** (N = number of takes, 2-4): Automation mode tracks. Each has the audio loaded + a volume automation track targeting its `audioUnitBox.volume`.
- **Track N+1**: Splice mode track. One Tape instrument created at init with no audio. Regions are created dynamically by `rebuildSpliceRegions()` referencing the `AudioFileBox` from the appropriate take track.

Mode switching mutes/unmutes the appropriate tracks:
- Automation mode: tracks 1-N unmuted, splice track muted
- Splice mode: tracks 1-N muted, splice track unmuted

### 3. Multi-File Support

**Single file dropped/loaded:**
- Creates up to 4 takes from the same file with staggered offsets: `[0, BEAT, BEAT*2, BEAT*3]`
- Labels: "Take 1 (original)", "Take 2 (+1 beat)", "Take 3 (+2 beats)", "Take 4 (+3 beats)"
- For the demo button (Dark Ride vocals), loads 3 takes with stagger

**Multiple files dropped (2-4):**
- Each file becomes its own take, no stagger (all offsets = 0)
- Labels: derived from filenames
- Files beyond 4 are ignored

**File input changes:**
- `<input>` gets `multiple` attribute
- Drop zone accepts multiple files
- UI shows file count feedback

### 4. Take Offset Changes

Stagger offsets increase from `[0, 1/4 beat, 1/2 beat]` to `[0, 1 beat, 2 beats, 3 beats]` to make take differences more audible in single-file mode.

### 5. Dynamic Take Count

- `NUM_TAKES` is no longer a constant — derived from loaded takes
- `MAX_TAKES = 4`
- Take lanes, zone selectors, and colors scale to 2-4 takes
- `TAKE_COLORS = ["#4ade80", "#f59e0b", "#ef4444", "#a78bfa"]`

### 6. Splice Region Rebuilding

`rebuildSpliceRegions(project, takes, boundaries, assignments)`:

1. Delete all existing regions on the splice track (via adapter layer)
2. For each zone in `compAssignments`:
   - Resolve the assigned take's `AudioFileBox` from `take.trackData`
   - Create an `AudioRegionBox` on the splice track:
     - `file` → take's AudioFileBox
     - `position` = zone start PPQN
     - `duration` = zone length PPQN
     - `loopOffset` = playbackStart + take's offset
     - `loopDuration` = full audio duration in PPQN
3. All region creation happens inside `editing.modify()`

### 7. UI Changes

- Mode toggle: `SegmentedControl` with "Automation Crossfade" and "Region Splice" in the transport card
- Crossfade slider: visible only in automation mode
- Splice mode note: "(SDK manages 20ms voice crossfade)" shown when in splice mode
- Drop zone: "Drop audio file(s) here" — accepts multiple
- Take lanes: dynamic height (2-4 rows)
- Zone selectors: dynamic button count per zone

## Files Modified

- `src/demos/playback/comp-lanes-demo.tsx` — all changes in this single file

### 8. Waveform Rendering with PeaksPainter

Replace the current raw `AudioBuffer.getChannelData()` waveform rendering with `PeaksPainter.renderPixelStrips()` using the adapter layer for peaks access:

- Each take lane renders its full audio range using `regionAdapter.file.peaks`
- Use `CanvasPainter` for automatic AnimationFrame-driven repainting
- Peaks frame range (`u0`/`u1`) derived from the take's playback offset into the audio file
- Active zone highlights overlay on top of the rendered waveform (existing behavior)

This matches the pattern used in the other playback demos (clip-fades, track-editing) and produces smoother, resolution-independent waveforms.

### 9. Undo/Redo via Box Graph (Single Source of Truth)

Comp state (boundaries + zone assignments) is **not stored in React state**. Instead, it is derived from the automation regions in the box graph. This makes OpenDAW's built-in `editing.undo()` / `editing.redo()` work natively — no parallel history stack needed.

#### How it works

1. **User actions** (add boundary, change zone assignment) call `rebuildAutomation()`, which creates/deletes automation regions inside a **single** `editing.modify()` transaction. This creates one undo point per comp change.

2. **`deriveCompState(takes)`** reads the automation events from each take's volume automation track and reconstructs `{ boundaries, assignments }`:
   - For each take, find positions where volume transitions between silent and 0dB
   - The union of all transition positions = zone boundaries
   - For each zone, the take with 0dB volume = the active assignment

3. **`editing.subscribe()`** fires after every undo/redo/modify. The callback calls `deriveCompState()` to update the UI.

4. **Undo/Redo** calls `editing.undo()` / `editing.redo()`. The box graph reverts the automation regions. The `editing.subscribe()` callback fires, `deriveCompState()` re-reads the box graph, and React state updates to match.

#### Key implementation details

- **Single transaction per comp change**: `rebuildAutomation()` must batch all per-take automation updates (delete old regions + create new regions for ALL takes) into one `editing.modify()` call. Currently it uses multiple `editing.modify()` calls — this must be consolidated so undo reverses the entire comp change atomically.

- **Crossfade slider changes**: Also wrapped in a single `editing.modify()` so changing crossfade duration from 20ms to 50ms is one undo point.

- **Splice mode**: When in splice mode, `rebuildSpliceRegions()` also uses `editing.modify()` — undo/redo works the same way, with `deriveCompState()` reading from the splice track's regions instead of automation events.

- **Mode switching**: Toggling between automation/splice mutes/unmutes tracks inside `editing.modify()`, so the mode switch itself is undoable.

#### `deriveCompState()` algorithm

```
For each take's automation track:
  Read all value events from the automation region
  Find positions where value transitions to/from VOL_0DB
  Record active ranges: [{start, end}, ...]

Boundaries = sorted unique set of all active range start/end positions
             (excluding 0 and TOTAL_PPQN)

Assignments = for each zone between boundaries,
              find which take has VOL_0DB in that zone
```

#### UI

- Undo/Redo buttons in transport card, disabled when `!editing.canUndo()` / `!editing.canRedo()`
- Keyboard: Cmd+Z / Cmd+Shift+Z
- Button state updates via `editing.subscribe()`

#### What this demonstrates

This is a practical example of using the box graph as the single source of truth for UI state — a pattern that scales to more complex applications. The comp decisions are encoded in automation data, not in parallel React state, so the SDK's transaction system handles undo/redo, persistence, and collaboration for free.

## Out of Scope

- Export functionality
- More than 4 takes
