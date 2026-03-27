# Track Automation Demo — Design Spec

## Overview

A single-page demo that loads an audio track and demonstrates three types of parameter automation: volume, pan, and effect (reverb mix). Each section offers preset automation patterns, a canvas visualization of the automation envelope, and a collapsible JSON block showing the data a server would persist to save/restore the automation state.

## Goals

- Demonstrate the `createAutomationTrack` API for volume, panning, and effect parameters
- Show all three interpolation modes: None (step), Linear, and Curve (with slope)
- Visualize automation envelopes on a canvas with playhead tracking
- Educate on persistence: collapsible JSON blocks show exactly what data points and curve types would be stored on a server

## Architecture

### Files

| File | Purpose |
|------|---------|
| `src/track-automation-demo.tsx` | Main demo component |
| `track-automation-demo.html` | HTML entry point |
| `vite.config.ts` | Add build entry |
| `src/index.tsx` | Add demo card to home grid |

No new components, hooks, or lib files. The demo is self-contained in a single tsx file, following the pattern of `tempo-automation-demo.tsx`.

### Dependencies (all existing)

- `@opendaw/studio-core` — Project, initializeOpenDAW
- `@opendaw/studio-boxes` — AudioUnitBox, ValueEventCollectionBox
- `@opendaw/studio-adapters` — ValueEventCollectionBoxAdapter
- `@opendaw/lib-dsp` — PPQN, Interpolation
- `@radix-ui/themes` — UI components
- Shared components: GitHubCorner, BackLink, MoisesLogo
- Shared lib: initializeOpenDAW, loadTracksFromFiles
- Shared hooks: usePlaybackPosition, useTransportControls

## Page Layout (top to bottom)

1. **Header** — GitHubCorner, BackLink, title ("Track Automation"), description text
2. **Transport Controls** — Play/Stop buttons, position display. Shared across all sections. Loop enabled over the full 8-bar timeline.
3. **Volume Automation Card** — Preset buttons, canvas envelope, collapsible JSON
4. **Pan Automation Card** — Preset buttons, canvas envelope, collapsible JSON
5. **Effect Parameter Automation Card** — Preset buttons, canvas envelope, collapsible JSON (reverb mix)
6. **Full Project Data Card** — Collapsible JSON showing all automation tracks combined (the full save payload)
7. **Footer** — MoisesLogo

Theme: dark with purple accent (unused by other demos).

## Automation API Usage

### Creating automation tracks

```typescript
// Volume automation
let volumeTrackBox: TrackBox;
project.editing.modify(() => {
  volumeTrackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume);
});

// Pan automation
let panTrackBox: TrackBox;
project.editing.modify(() => {
  panTrackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.panning);
});

// Effect parameter automation — insert effect first, then automate
let effectBox: EffectBox;
project.editing.modify(() => {
  effectBox = project.api.insertEffect(audioUnitBox.preEffects, effectFactory);
});
// Separate transaction (pointer re-routing rule)
let effectTrackBox: TrackBox;
project.editing.modify(() => {
  effectTrackBox = project.api.createAutomationTrack(audioUnitBox, effectDeviceBox.mix);
});
```

### Creating automation events

```typescript
function applyAutomationPattern(
  project: Project,
  trackBoxAdapter: TrackBoxAdapter,
  events: AutomationEvent[]
): void {
  project.editing.modify(() => {
    // Clear existing events
    const regions = trackBoxAdapter.regions;
    // Access the value event collection and clear/recreate events
    // Pattern matches tempo-automation-demo.tsx
  });
}
```

### Resolving the ValueEventCollectionBoxAdapter

The automation track's events are accessed through the TrackBoxAdapter's regions or through the AudioUnitTracks adapter. The exact access pattern will be determined during implementation by inspecting how `createAutomationTrack` structures the track — it may create a region with a ValueEventCollectionBox, or the events may be accessible via the track's target pointer. The tempo automation demo accesses events via `timelineBoxAdapter.tempoTrackEvents` which is a special accessor; for generic automation tracks, we'll trace the adapter chain.

## Preset Patterns

### Volume Automation (8 bars, values 0.0–1.0)

**Fade In (logarithmic):**
- Bar 0: value 0.0, Curve(slope: 0.25) (slow start, fast finish — logarithmic)
- Bar 4: value 1.0, None

**Fade Out (exponential):**
- Bar 0: value 1.0, Curve(slope: 0.75) (fast drop, long tail — exponential)
- Bar 8: value 0.0, None

**Swell (round Möbius-Ease):**
- Bar 0: value 0.2, Curve(slope: 0.75) (logarithmic rise)
- Bar 4: value 1.0, Curve(slope: 0.25) (logarithmic fall)
- Bar 8: value 0.2, None

**Ducking:**
- Bar 0: value 1.0, Linear
- Bar 2: value 1.0, Curve(slope: 0.75) (fast duck down)
- Bar 3: value 0.2, None (hold low)
- Bar 5: value 0.2, Curve(slope: 0.25) (slow rise back up)
- Bar 6: value 1.0, Linear
- Bar 8: value 1.0, None

### Pan Automation (8 bars, values 0.0=L, 0.5=center, 1.0=R)

**L-R Sweep:**
- Bar 0: value 0.0, Linear
- Bar 8: value 1.0, Linear

**Ping-Pong:**
- Bar 0: value 0.0, Linear
- Bar 2: value 1.0, Linear
- Bar 4: value 0.0, Linear
- Bar 6: value 1.0, Linear
- Bar 8: value 0.0, Linear

**Center Hold:**
- Bar 0: value 0.5, None
- Bar 8: value 0.5, None

### Effect (Reverb Mix) Automation (8 bars, values 0.0=dry, 1.0=wet)

**Dry to Wet:**
- Bar 0: value 0.0, Curve(slope: 0.25) (logarithmic ramp)
- Bar 8: value 1.0, Linear

**Wet to Dry:**
- Bar 0: value 1.0, Curve(slope: 0.75) (exponential ramp)
- Bar 8: value 0.0, Linear

**Pulse:**
- Bar 0: value 0.0, None
- Bar 2: value 0.8, None
- Bar 4: value 0.0, None
- Bar 6: value 0.8, None
- Bar 8: value 0.0, None

## Canvas Visualization

Each section has a canvas (full card width, 150px height) showing:

- **Background:** Dark with subtle grid lines at each bar
- **Curve:** Colored line drawing the automation envelope
  - `None` interpolation: horizontal line, then vertical jump
  - `Linear` interpolation: straight diagonal line
  - `Curve` interpolation: bezier curve approximation using the slope value
- **Event dots:** Small circles at each automation point
- **Playhead:** Vertical line at current position during playback
- **Y-axis labels:** Parameter-specific (e.g., "0 dB" / "-inf" for volume, "L" / "C" / "R" for pan, "Dry" / "Wet" for reverb)

Rendered via `requestAnimationFrame` during playback for smooth playhead movement, with static redraw on preset change.

## Collapsible JSON Blocks

Each automation section includes a `<details>` element:

```html
<details>
  <summary>Server Data (JSON)</summary>
  <pre><code>{JSON content}</code></pre>
</details>
```

### JSON Structure Per Automation Track

```json
{
  "automationTrack": {
    "targetParameter": "volume",
    "targetUnitId": "abc-123-def",
    "enabled": true,
    "events": [
      {
        "position": 0,
        "value": 0.0,
        "index": 0,
        "interpolation": { "type": "linear" }
      },
      {
        "position": 15360,
        "value": 1.0,
        "index": 0,
        "interpolation": { "type": "linear" }
      }
    ]
  }
}
```

### Interpolation Types in JSON

```json
// Step (hold value until next event)
{ "type": "none" }

// Linear ramp between events
{ "type": "linear" }

// Curved ramp with slope control
{ "type": "curve", "slope": 0.25 }
// slope: 0.0 = logarithmic, 0.5 = linear, 1.0 = exponential
```

### Full Project JSON (bottom section)

Combines all automation tracks into one payload:

```json
{
  "projectAutomation": {
    "tracks": [
      {
        "targetParameter": "volume",
        "targetUnitId": "abc-123",
        "enabled": true,
        "events": [...]
      },
      {
        "targetParameter": "panning",
        "targetUnitId": "abc-123",
        "enabled": true,
        "events": [...]
      },
      {
        "targetParameter": "mix",
        "targetUnitId": "abc-123",
        "targetDevice": "reverb",
        "enabled": true,
        "events": [...]
      }
    ],
    "timeline": {
      "bpm": 120,
      "timeSignature": { "numerator": 4, "denominator": 4 },
      "durationPpqn": 30720,
      "loopEnabled": true,
      "loopFrom": 0,
      "loopTo": 30720
    }
  }
}
```

## Loading State

Full-screen overlay with spinner while project initializes and audio loads (same pattern as effects-demo).

## Error Handling

- If audio file fails to load, show error text in the transport area
- If automation track creation fails, disable that section's preset buttons

## What This Demo Does NOT Cover

- Live recording of automation (writing parameter changes during playback)
- Automation regions with looping (all events are in a single continuous region)
- MIDI CC mapping to automation parameters
- Undo/redo of automation changes
