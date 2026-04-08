# Comp Lanes Demo — Design Spec

## Goal

Demonstrate take comping using multi-track volume automation crossfades. User drops an audio file, the demo creates simulated takes (same file at slightly different offsets), and the user selects which take is active per zone. Crossfades between takes use `Interpolation.Curve` for equal-power transitions. No region splitting — avoids the SDK voice pop issue entirely.

## Background

The region slice demo revealed that `RegionEditing.cut()` triggers `PitchVoice` creation/eviction with a forced 20ms fade, causing audible pops at region boundaries. A Web Audio prototype (`webaudio-comp-test.html`) proved that multi-track volume automation crossfades produce zero pops. This demo implements that approach using the SDK's automation API.

See `documentation/region-splice-findings.md` for full technical findings.

## Audio Source

User drops their own audio file (drag-and-drop or file browse). "Use demo vocals" button loads Dark Ride vocals (`06_Vox`) as fallback. Same pattern as the region slice demo.

## Simulated Takes

3 tracks loaded from the same audio file, each offset by a fraction of a beat:
- Take 1: offset 0 PPQN from a start point (e.g., bar 17 for Dark Ride, or bar 1 for dropped files)
- Take 2: offset +240 PPQN (quarter beat)
- Take 3: offset +480 PPQN (half beat)

The small offsets simulate retakes with slightly different timing — close enough that the audio content is similar but different enough to hear the comp switch.

Playback duration: 8 bars from the start point.

## Approach: Per-Track Volume Automation

Each take is a separate instrument track (Tape). Each track has a volume automation track created via `project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume)`.

Comp state is expressed as volume automation events:
- **Active take in a zone**: volume at `AudioUnitBoxAdapter.VolumeMapper.x(0)` (0dB)
- **Inactive take in a zone**: volume at `0.0` (-inf, silence)
- **Crossfade at boundaries**: `Interpolation.Curve(0.25)` for fade-out (logarithmic), `Interpolation.Curve(0.75)` for fade-in (exponential) — equal-power crossfade

All tracks play continuously. No region splitting, no voice eviction.

## Automation Rebuild

When the user changes a comp boundary or take assignment, all volume automation is rebuilt:

1. Delete existing automation regions on all tracks
2. Create new automation region per track spanning the full playback duration
3. Write events: for each zone, set volume to 0dB (active) or -inf (inactive), with curve interpolation at boundaries

Crossfade duration is configurable via UI input (default 20ms).

Event positions are **region-local** (per SDK requirement — `LoopableRegion.globalToLocal` is applied internally).

## Interaction Model

1. **Load**: User drops audio file or clicks "Use demo vocals"
2. **Takes created**: 3 tracks with stacked lane waveforms
3. **Click**: Position playhead
4. **Shift+Click**: Add comp boundary (vertical dashed line)
5. **Zone buttons**: Pick active take per zone
6. **Play/Stop**: Standard transport. All tracks play continuously.
7. **Crossfade input**: Adjust crossfade duration in ms
8. **No undo**: Refresh to reset

## UI Layout

1. Header — title, subtitle, BackLink
2. Drop zone / "Use demo vocals" button (before audio loaded)
3. Stacked lane waveforms (one per take) with comp zone highlights and boundary lines
4. Zone take selector buttons
5. Controls — crossfade ms input, Play/Stop, position display
6. Footer — MoisesLogo

## Files

| File | Action |
|------|--------|
| `comp-lanes-demo.html` | Create — HTML entry point |
| `src/demos/playback/comp-lanes-demo.tsx` | Create — demo component |
| `vite.config.ts` | Edit — add build entry |
| `src/index.tsx` | Edit — add card to index |

## Reused Components and Utilities

- `initializeOpenDAW`, `loadTracksFromFiles` from `src/lib/`
- `getAudioExtension` from `src/lib/audioUtils.ts`
- `usePlaybackPosition`, `useTransportControls` hooks
- `TransportControls`, `BackLink`, `GitHubCorner`, `MoisesLogo` components
- `AudioUnitBoxAdapter.VolumeMapper` for dB-to-unitValue conversion

## What This Demo Does NOT Include

- No recording — audio is pre-loaded
- No undo/redo — refresh to reset
- No drag-to-move comp boundaries
- No per-take mute/solo (could be added later)
- No mixer group routing (keeps it simple)
- No waveform zoom/scroll
