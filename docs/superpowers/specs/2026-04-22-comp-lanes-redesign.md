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

## Out of Scope

- Waveform rendering with PeaksPainter (current demo uses raw AudioBuffer rendering — keeping that)
- Export functionality
- Undo/redo of comp decisions
- More than 4 takes
