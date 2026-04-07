# CLAUDE.md Split via Demo Folder Reorganization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 870-line root CLAUDE.md into 7 scoped files by reorganizing 16 demo TSX files into 6 categorical folders under `src/demos/`.

**Architecture:** Move TSX files into `src/demos/{recording,midi,playback,automation,effects,export}/`, update HTML script tags and TSX imports to use `@/` alias, write scoped CLAUDE.md files per folder, slim down root CLAUDE.md to universal patterns only.

**Tech Stack:** Vite, React, TypeScript

---

### Task 1: Add TypeScript path alias for `@/`

The `@` alias exists in `vite.config.ts` but not in `tsconfig.json`. TypeScript needs it too for IDE support.

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Add baseUrl and paths to tsconfig.json**

Add inside `compilerOptions`:

```json
"baseUrl": ".",
"paths": {
  "@/*": ["./src/*"]
}
```

The full `compilerOptions` should look like:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
    "jsx": "react-jsx",
    "sourceMap": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: Build succeeds (no functional changes yet)

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add TypeScript path alias @/ matching vite.config.ts"
```

---

### Task 2: Create demo folders and move recording demos

**Files:**
- Move: `src/recording-api-react-demo.tsx` → `src/demos/recording/recording-api-react-demo.tsx`
- Move: `src/loop-recording-demo.tsx` → `src/demos/recording/loop-recording-demo.tsx`
- Modify: `recording-api-react-demo.html` (script src)
- Modify: `loop-recording-demo.html` (script src)

- [ ] **Step 1: Create directory and move files**

```bash
mkdir -p src/demos/recording
git mv src/recording-api-react-demo.tsx src/demos/recording/
git mv src/loop-recording-demo.tsx src/demos/recording/
```

- [ ] **Step 2: Update imports in recording-api-react-demo.tsx**

Replace all `./` relative imports with `@/` alias imports:

```typescript
// Before
import { CanvasPainter } from "./lib/CanvasPainter";
import { initializeOpenDAW } from "./lib/projectSetup";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "./hooks/useEnginePreference";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { BpmControl } from "./components/BpmControl";
import { TimeSignatureControl } from "./components/TimeSignatureControl";
import { RecordingPreferences } from "./components/RecordingPreferences";
import { RecordingTrackCard } from "./components/RecordingTrackCard";
import type { RecordingTrack } from "./components/RecordingTrackCard";

// After
import { CanvasPainter } from "@/lib/CanvasPainter";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "@/hooks/useEnginePreference";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { TimeSignatureControl } from "@/components/TimeSignatureControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
import { RecordingTrackCard } from "@/components/RecordingTrackCard";
import type { RecordingTrack } from "@/components/RecordingTrackCard";
```

- [ ] **Step 3: Update imports in loop-recording-demo.tsx**

```typescript
// Before
import { initializeOpenDAW } from "./lib/projectSetup";
import { useEnginePreference } from "./hooks/useEnginePreference";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { BpmControl } from "./components/BpmControl";
import { RecordingPreferences } from "./components/RecordingPreferences";
import { RecordingTrackCard } from "./components/RecordingTrackCard";
import { TakeTimeline } from "./components/TakeTimeline";
import type { TakeRegion, TakeIteration } from "./components/TakeTimeline";

// After
import { initializeOpenDAW } from "@/lib/projectSetup";
import { useEnginePreference } from "@/hooks/useEnginePreference";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
import { RecordingTrackCard } from "@/components/RecordingTrackCard";
import { TakeTimeline } from "@/components/TakeTimeline";
import type { TakeRegion, TakeIteration } from "@/components/TakeTimeline";
```

- [ ] **Step 4: Update HTML script tags**

In `recording-api-react-demo.html`, change:
```html
<script type="module" src="/src/recording-api-react-demo.tsx"></script>
```
to:
```html
<script type="module" src="/src/demos/recording/recording-api-react-demo.tsx"></script>
```

In `loop-recording-demo.html`, change:
```html
<script type="module" src="/src/loop-recording-demo.tsx"></script>
```
to:
```html
<script type="module" src="/src/demos/recording/loop-recording-demo.tsx"></script>
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move recording demos to src/demos/recording/"
```

---

### Task 3: Move MIDI demo

**Files:**
- Move: `src/midi-recording-demo.tsx` → `src/demos/midi/midi-recording-demo.tsx`
- Modify: `midi-recording-demo.html` (script src)

- [ ] **Step 1: Create directory and move file**

```bash
mkdir -p src/demos/midi
git mv src/midi-recording-demo.tsx src/demos/midi/
```

- [ ] **Step 2: Update imports in midi-recording-demo.tsx**

```typescript
// Before
import { initializeOpenDAW } from "./lib/projectSetup";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "./hooks/useEnginePreference";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { BpmControl } from "./components/BpmControl";
import { RecordingPreferences } from "./components/RecordingPreferences";

// After
import { initializeOpenDAW } from "@/lib/projectSetup";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "@/hooks/useEnginePreference";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
```

- [ ] **Step 3: Update HTML script tag**

In `midi-recording-demo.html`, change:
```html
<script type="module" src="/src/midi-recording-demo.tsx"></script>
```
to:
```html
<script type="module" src="/src/demos/midi/midi-recording-demo.tsx"></script>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move MIDI demo to src/demos/midi/"
```

---

### Task 4: Move playback demos

**Files:**
- Move: `src/looping-demo.tsx` → `src/demos/playback/looping-demo.tsx`
- Move: `src/clip-looping-demo.tsx` → `src/demos/playback/clip-looping-demo.tsx`
- Move: `src/clip-fades-demo.tsx` → `src/demos/playback/clip-fades-demo.tsx`
- Move: `src/track-editing-demo.tsx` → `src/demos/playback/track-editing-demo.tsx`
- Move: `src/timebase-demo.tsx` → `src/demos/playback/timebase-demo.tsx`
- Move: `src/mixer-groups-demo.tsx` → `src/demos/playback/mixer-groups-demo.tsx`
- Move: `src/drum-scheduling-demo.tsx` → `src/demos/playback/drum-scheduling-demo.tsx`
- Modify: 7 HTML files (script src)

- [ ] **Step 1: Create directory and move files**

```bash
mkdir -p src/demos/playback
git mv src/looping-demo.tsx src/demos/playback/
git mv src/clip-looping-demo.tsx src/demos/playback/
git mv src/clip-fades-demo.tsx src/demos/playback/
git mv src/track-editing-demo.tsx src/demos/playback/
git mv src/timebase-demo.tsx src/demos/playback/
git mv src/mixer-groups-demo.tsx src/demos/playback/
git mv src/drum-scheduling-demo.tsx src/demos/playback/
```

- [ ] **Step 2: Update imports in all 7 playback demo files**

In every file, replace `from "./components/` with `from "@/components/`, `from "./lib/` with `from "@/lib/`, and `from "./hooks/` with `from "@/hooks/`.

**looping-demo.tsx** — 15 relative imports to update (components: GitHubCorner, MoisesLogo, BackLink, TrackRow, TransportControls, TimelineRuler, TracksContainer, Playhead; lib: projectSetup, trackLoading, audioUtils, types; hooks: useWaveformRendering, usePlaybackPosition)

**clip-looping-demo.tsx** — 8 relative imports (components: GitHubCorner, MoisesLogo, BackLink; lib: projectSetup, trackLoading, audioUtils; hooks: usePlaybackPosition, useTransportControls)

**clip-fades-demo.tsx** — 6 relative imports (components: GitHubCorner, MoisesLogo, BackLink; lib: projectSetup, trackLoading, audioUtils)

**track-editing-demo.tsx** — 14 relative imports (components: GitHubCorner, MoisesLogo, BackLink, TrackRow, TransportControls, TimelineRuler, TracksContainer; lib: projectSetup, trackLoading, audioUtils, types; hooks: useWaveformRendering, usePlaybackPosition, useTransportControls)

**timebase-demo.tsx** — 7 relative imports (components: GitHubCorner, MoisesLogo, BackLink; lib: audioUtils, projectSetup; hooks: usePlaybackPosition, useTransportControls)

**mixer-groups-demo.tsx** — 10 relative imports (components: GitHubCorner, MoisesLogo, BackLink, TransportControls; lib: projectSetup, groupTrackLoading, audioUtils, types; hooks: usePlaybackPosition, useTransportControls)

**drum-scheduling-demo.tsx** — 8 relative imports (components: GitHubCorner, MoisesLogo, BackLink, ExportProgress; lib: audioUtils, projectSetup; hooks: useAudioExport, usePlaybackPosition)

All follow the same pattern: `"./X"` → `"@/X"`.

- [ ] **Step 3: Update 7 HTML script tags**

In each HTML file, update the `<script>` src:

| HTML file | New src |
|---|---|
| `looping-demo.html` | `/src/demos/playback/looping-demo.tsx` |
| `clip-looping-demo.html` | `/src/demos/playback/clip-looping-demo.tsx` |
| `clip-fades-demo.html` | `/src/demos/playback/clip-fades-demo.tsx` |
| `track-editing-demo.html` | `/src/demos/playback/track-editing-demo.tsx` |
| `timebase-demo.html` | `/src/demos/playback/timebase-demo.tsx` |
| `mixer-groups-demo.html` | `/src/demos/playback/mixer-groups-demo.tsx` |
| `drum-scheduling-demo.html` | `/src/demos/playback/drum-scheduling-demo.tsx` |

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move playback demos to src/demos/playback/"
```

---

### Task 5: Move automation demos

**Files:**
- Move: `src/track-automation-demo.tsx` → `src/demos/automation/track-automation-demo.tsx`
- Move: `src/tempo-automation-demo.tsx` → `src/demos/automation/tempo-automation-demo.tsx`
- Move: `src/time-signature-demo.tsx` → `src/demos/automation/time-signature-demo.tsx`
- Modify: 3 HTML files (script src)

- [ ] **Step 1: Create directory and move files**

```bash
mkdir -p src/demos/automation
git mv src/track-automation-demo.tsx src/demos/automation/
git mv src/tempo-automation-demo.tsx src/demos/automation/
git mv src/time-signature-demo.tsx src/demos/automation/
```

- [ ] **Step 2: Update imports in all 3 automation demo files**

**track-automation-demo.tsx** — 7 relative imports (components: GitHubCorner, MoisesLogo, BackLink; lib: projectSetup, trackLoading, audioUtils; hooks: usePlaybackPosition)

**tempo-automation-demo.tsx** — 5 relative imports (components: GitHubCorner, MoisesLogo, BackLink; lib: projectSetup; hooks: usePlaybackPosition)

**time-signature-demo.tsx** — 5 relative imports (components: GitHubCorner, MoisesLogo, BackLink; lib: projectSetup; hooks: usePlaybackPosition)

All follow the same pattern: `"./X"` → `"@/X"`.

- [ ] **Step 3: Update 3 HTML script tags**

| HTML file | New src |
|---|---|
| `track-automation-demo.html` | `/src/demos/automation/track-automation-demo.tsx` |
| `tempo-automation-demo.html` | `/src/demos/automation/tempo-automation-demo.tsx` |
| `time-signature-demo.html` | `/src/demos/automation/time-signature-demo.tsx` |

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move automation demos to src/demos/automation/"
```

---

### Task 6: Move effects demos

**Files:**
- Move: `src/effects-demo.tsx` → `src/demos/effects/effects-demo.tsx`
- Move: `src/werkstatt-demo.tsx` → `src/demos/effects/werkstatt-demo.tsx`
- Modify: 2 HTML files (script src)

- [ ] **Step 1: Create directory and move files**

```bash
mkdir -p src/demos/effects
git mv src/effects-demo.tsx src/demos/effects/
git mv src/werkstatt-demo.tsx src/demos/effects/
```

- [ ] **Step 2: Update imports in both effects demo files**

**effects-demo.tsx** — 19 relative imports (components: GitHubCorner, MoisesLogo, BackLink, TrackRow, TransportControls, TimelineRuler, TracksContainer, EffectPanel, EffectChain; lib: projectSetup, trackLoading, audioUtils, types; hooks: useWaveformRendering, useEffectChain, useDynamicEffect, useAudioExport, usePlaybackPosition, useTransportControls)

**werkstatt-demo.tsx** — 10 relative imports (components: GitHubCorner, MoisesLogo, BackLink; lib: projectSetup, trackLoading, audioUtils, werkstattScripts (2 imports); hooks: usePlaybackPosition, useTransportControls)

All follow the same pattern: `"./X"` → `"@/X"`.

- [ ] **Step 3: Update 2 HTML script tags**

| HTML file | New src |
|---|---|
| `effects-demo.html` | `/src/demos/effects/effects-demo.tsx` |
| `werkstatt-demo.html` | `/src/demos/effects/werkstatt-demo.tsx` |

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move effects demos to src/demos/effects/"
```

---

### Task 7: Move export demo

**Files:**
- Move: `src/export-demo.tsx` → `src/demos/export/export-demo.tsx`
- Modify: `export-demo.html` (script src)

- [ ] **Step 1: Create directory and move file**

```bash
mkdir -p src/demos/export
git mv src/export-demo.tsx src/demos/export/
```

- [ ] **Step 2: Update imports in export-demo.tsx**

```typescript
// Before
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { TransportControls } from "./components/TransportControls";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";
import { useTransportControls } from "./hooks/useTransportControls";
// ... later in imports
} from "./lib/rangeExport";
import type { TrackData } from "./lib/types";

// After
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TransportControls } from "@/components/TransportControls";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
// ... later in imports
} from "@/lib/rangeExport";
import type { TrackData } from "@/lib/types";
```

- [ ] **Step 3: Update HTML script tag**

In `export-demo.html`, change:
```html
<script type="module" src="/src/export-demo.tsx"></script>
```
to:
```html
<script type="module" src="/src/demos/export/export-demo.tsx"></script>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move export demo to src/demos/export/"
```

---

### Task 8: Write scoped CLAUDE.md for recording demos

**Files:**
- Create: `src/demos/recording/CLAUDE.md`

- [ ] **Step 1: Write src/demos/recording/CLAUDE.md**

This file should contain the following sections extracted from the root CLAUDE.md (copy the full content with code blocks from the root file, lines referenced below):

1. **Recording** section (root lines 8-32) — `startRecording`, `stopRecording` vs `stop(true)`, `stop(false)`
2. **Audio Input & Capture** section (root lines 34-65) — AudioDevices, CaptureAudio, deviceId, gainDb, requestChannels, track arming, multi-device
3. **Recording Preferences (Takes)** section (root lines 94-113) — allowTakes, olderTakeAction, countInBars, how takes work
4. **capture.armed Is Not a Box Graph Field** section (root lines 175-178)
5. **Finding Recording Regions** section (root lines 232-243)
6. **Accessing Live Peaks During Recording** section (root lines 245-274)
7. **Capture Settings Require editing.modify()** section (root lines 534-537)
8. **Recording Peaks Include Count-In Frames** section (root lines 561-568)
9. **Take Waveform Rendering: Shared Buffer Gotcha** section (root lines 570-576)
10. **Take-to-Track Matching** section (root lines 578-581)
11. **Loop Take Buffer Layout and Offsets** section (root lines 583-611)
12. **Proper Recording to Playback Flow** section (root lines 639-648)
13. **Stop Button Behavior** section (root lines 701-705)
14. **Monitoring Peaks Across Recording Lifecycle** section (root lines 729-752) — React pattern specific to recording

Add a header: `# Recording Demos — OpenDAW SDK Reference`

Add a reference files section at the bottom pointing to:
- `src/demos/recording/recording-api-react-demo.tsx`
- `src/demos/recording/loop-recording-demo.tsx`
- `src/components/RecordingTrackCard.tsx`
- `src/components/TakeTimeline.tsx`
- `src/hooks/useEnginePreference.ts`

- [ ] **Step 2: Commit**

```bash
git add src/demos/recording/CLAUDE.md
git commit -m "docs: add scoped CLAUDE.md for recording demos"
```

---

### Task 9: Write scoped CLAUDE.md for MIDI demo

**Files:**
- Create: `src/demos/midi/CLAUDE.md`

- [ ] **Step 1: Write src/demos/midi/CLAUDE.md**

Extract from root CLAUDE.md:

1. **MIDI Devices & Recording** section (root lines 67-92) — MidiDevices, softwareMIDIInput, subscribeMessageEvents, CaptureMidi arming, channel filter
2. **MIDI Recording Requires a Synth Instrument** section (root lines 539-548) — Tape limitation, Vaporisateur, available MIDI instruments list

Add a header: `# MIDI Demo — OpenDAW SDK Reference`

Add a cross-reference note: "For recording preferences (takes, count-in), see `src/demos/recording/CLAUDE.md`."

Add reference files:
- `src/demos/midi/midi-recording-demo.tsx`

- [ ] **Step 2: Commit**

```bash
git add src/demos/midi/CLAUDE.md
git commit -m "docs: add scoped CLAUDE.md for MIDI demo"
```

---

### Task 10: Write scoped CLAUDE.md for playback demos

**Files:**
- Create: `src/demos/playback/CLAUDE.md`

- [ ] **Step 1: Write src/demos/playback/CLAUDE.md**

Extract from root CLAUDE.md:

1. **Playback** section (root lines 180-196) — setPosition, play, queryLoadingComplete
2. **Timeline and Loop Area** section (root lines 420-432) — loopArea, BPM, time signature
3. **Clip Fades** section (root lines 434-461) — region-relative fades, fillGainBuffer, slopes
4. **Fades Can Share a Transaction with Region Changes** section (root lines 510-512)
5. **waveformOffset vs loopOffset** section (root lines 555-559)
6. **Waveform Rendering** section (root lines 152-163) — PeaksPainter.renderPixelStrips, fillStyle
7. **Mixer Groups (Sub-Mixing)** section (root lines 797-822) — AudioBusFactory, routing, separate transactions
8. **Dark Ride Audio** section (root lines 613-621)
9. **localAudioBuffers Must Be Passed to initializeOpenDAW** section (root lines 623-632)
10. **Region Sorting When Positions Match** section (root lines 550-553)
11. **Demo Layout Structure** section (root line 824-826)

Add a header: `# Playback Demos — OpenDAW SDK Reference`

Add reference files:
- All 7 demo TSX files in `src/demos/playback/`
- `src/lib/trackLoading.ts`
- `src/lib/groupTrackLoading.ts`
- `src/lib/audioUtils.ts`

- [ ] **Step 2: Commit**

```bash
git add src/demos/playback/CLAUDE.md
git commit -m "docs: add scoped CLAUDE.md for playback demos"
```

---

### Task 11: Write scoped CLAUDE.md for automation demos

**Files:**
- Create: `src/demos/automation/CLAUDE.md`

- [ ] **Step 1: Write src/demos/automation/CLAUDE.md**

Extract from root CLAUDE.md:

1. **Time Signature Events** section (root lines 276-291)
2. **SignatureTrack: One editing.modify() Per Event** section (root lines 497-500)
3. **Tempo Automation Events** section (root lines 293-303)
4. **Track Automation (Volume, Pan, Effects)** section (root lines 305-326) — createAutomationTrack, region-local positions
5. **Curve Rendering Must Use SDK's Curve.normalizedAt** section (root lines 328-333)
6. **Effects Parameter Architecture** section (root lines 707-725) — 3-layer chain, ValueMapping, dB conversion, gotchas

Add a header: `# Automation Demos — OpenDAW SDK Reference`

Add reference files:
- `src/demos/automation/track-automation-demo.tsx`
- `src/demos/automation/tempo-automation-demo.tsx`
- `src/demos/automation/time-signature-demo.tsx`
- `documentation/19-track-automation.md`

- [ ] **Step 2: Commit**

```bash
git add src/demos/automation/CLAUDE.md
git commit -m "docs: add scoped CLAUDE.md for automation demos"
```

---

### Task 12: Write scoped CLAUDE.md for effects demos

**Files:**
- Create: `src/demos/effects/CLAUDE.md`

- [ ] **Step 1: Write src/demos/effects/CLAUDE.md**

Extract from root CLAUDE.md:

1. **EffectBox Is a Union Type** section (root lines 335-339)
2. **WavFile Moved to lib-dsp** section (root lines 341-349)
3. **Scriptable Devices** section (root lines 351-359) — Apparat, Werkstatt, Spielwerk
4. **Scriptable Device Code: Must Use ScriptCompiler.compile()** section (root lines 361-386)
5. **Werkstatt Parameter Access** section (root lines 388-391)
6. **Werkstatt Generator Scripts Must Check Transport** section (root lines 393-407)
7. **Parsing Werkstatt Script Declarations** section (root lines 409-413)
8. **Effect Display Name Changes** section (root lines 415-418)

Add a header: `# Effects Demos — OpenDAW SDK Reference`

Add reference files:
- `src/demos/effects/effects-demo.tsx`
- `src/demos/effects/werkstatt-demo.tsx`
- `src/hooks/useDynamicEffect.ts`
- `src/hooks/useEffectChain.ts`
- `src/lib/effectPresets.ts`
- `src/lib/werkstattScripts.ts`
- `documentation/effects-research/`

- [ ] **Step 2: Commit**

```bash
git add src/demos/effects/CLAUDE.md
git commit -m "docs: add scoped CLAUDE.md for effects demos"
```

---

### Task 13: Write scoped CLAUDE.md for export demo

**Files:**
- Create: `src/demos/export/CLAUDE.md`

- [ ] **Step 1: Write src/demos/export/CLAUDE.md**

Extract from root CLAUDE.md:

1. **Offline Audio Rendering (Export)** section (root lines 650-685)
2. **Mutate-Copy-Restore Pattern for Offline Rendering** section (root lines 687-699)

Add a header: `# Export Demo — OpenDAW SDK Reference`

Add reference files:
- `src/demos/export/export-demo.tsx`
- `src/lib/rangeExport.ts`
- `src/hooks/useAudioExport.ts`

- [ ] **Step 2: Commit**

```bash
git add src/demos/export/CLAUDE.md
git commit -m "docs: add scoped CLAUDE.md for export demo"
```

---

### Task 14: Slim down root CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite root CLAUDE.md with universal-only content**

The new root CLAUDE.md should contain ONLY these sections (keeping their full code examples and explanations from the original):

1. **Project Overview** (root line 1-4)
2. **Key OpenDAW APIs** header, then only:
   - **Reactive Box Graph Subscriptions (pointerHub)** (root lines 115-150)
   - **SoundfontService (Disabled via Proxy Guard)** (root lines 165-169)
   - **SampleService** (root lines 171-173)
   - **Engine State Observables** (root lines 198-216)
   - **Engine Preferences** (root lines 218-230)
   - **AudioContext Suspension** (root lines 463-472)
3. **Important Patterns** header, then only:
   - **Option Types Are Always Truthy** (root lines 476-487)
   - **Always Use editing.modify() for State Changes** (root lines 489-495)
   - **Pointer Re-Routing: Separate Transaction from Creation** (root lines 502-508)
   - **createInstrument Must Be Destructured Inside editing.modify()** (root lines 514-524)
   - **monitoringMode Not in Type Declarations** (root lines 526-528)
   - **UUID.Bytes Is Not a String** (root lines 530-532)
   - **Safari Audio Format Compatibility** (root lines 634-637)
4. **React Integration Tips** header, then only:
   - **Using AnimationFrame from OpenDAW** (root lines 754-764)
   - **Always Terminate Observable Subscriptions** (root lines 766-779)
   - **CanvasPainter in React: Use Refs** (root lines 781-787)
   - **AnimationFrame Scanning: Use Structural Fingerprints** (root lines 789-795)
5. **Build & Verification** (root lines 828-832)
6. **Adding a New Demo** — updated for new folder structure:
   ```
   1. Create `<name>-demo.html` at project root (copy existing HTML, update meta tags and script src to point at `src/demos/<category>/`)
   2. Create `src/demos/<category>/<name>-demo.tsx` (use Radix UI Theme, GitHubCorner, BackLink, MoisesLogo; import shared code via `@/` alias)
   3. Add build entry in `vite.config.ts` → `rollupOptions.input`
   4. Add card in `src/index.tsx`
   ```
7. **Reference Files** — updated paths for all moved demo files, pointing to their new `src/demos/` locations

Remove all sections that now live in scoped CLAUDE.md files. Do NOT duplicate content.

- [ ] **Step 2: Verify no content was lost**

Check that every section from the original CLAUDE.md exists in exactly one place: either the new root CLAUDE.md or one of the 6 scoped CLAUDE.md files.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: slim root CLAUDE.md to universal patterns, demo-specific content in scoped files"
```

---

### Task 15: Final verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Verify dev server**

Run: `npm run dev` (briefly, then Ctrl+C)
Expected: Server starts without errors on port 5173

- [ ] **Step 3: Verify file structure**

```bash
ls src/demos/recording/ src/demos/midi/ src/demos/playback/ src/demos/automation/ src/demos/effects/ src/demos/export/
```

Expected: Each folder contains its demo TSX files and a CLAUDE.md

- [ ] **Step 4: Verify no demos left in src/ root**

```bash
ls src/*-demo.tsx 2>/dev/null
```

Expected: No output (all demos moved)

- [ ] **Step 5: Verify no broken imports**

```bash
grep -r 'from "\.\/' src/demos/ --include="*.tsx"
```

Expected: No output (all relative imports converted to `@/`)

- [ ] **Step 6: Count root CLAUDE.md lines**

```bash
wc -l CLAUDE.md
```

Expected: ~250-350 lines (down from 870)
