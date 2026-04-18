# Export & Offline Rendering

> **Skip if:** you're not implementing audio export
> **Prerequisites:** Chapter 07 (Building a Complete App)

Comprehensive guide to exporting audio from OpenDAW projects, including full mix exports and individual stems with effects, plus advanced offline rendering patterns.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core API](#core-api)
- [Export Utility Functions](#export-utility-functions)
- [React Hook (Recommended)](#react-hook-recommended)
- [Full Mix Export](#full-mix-export)
- [Stems Export](#stems-export)
- [Export Options](#export-options)
- [Effects Rendering](#effects-rendering)
- [File Formats](#file-formats)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Advanced: Offline Rendering Patterns](#advanced-offline-rendering-patterns)
  - [Background: Two Offline Render Paths in OpenDAW](#background-two-offline-render-paths-in-opendaw)
  - [The OfflineAudioContext Approach](#the-offlineaudiocontext-approach)
  - [Key Concepts](#key-concepts)
  - [Export Modes](#export-modes)
  - [Range Selection: Bars to PPQN](#range-selection-bars-to-ppqn)
  - [Encoding and Download](#encoding-and-download)
  - [In-Browser Preview](#in-browser-preview)
  - [Future: Worker-Based Rendering with Mixdown Support](#future-worker-based-rendering-with-mixdown-support)
  - [Reference](#reference)

---

## Overview

OpenDAW provides powerful audio export capabilities through its offline rendering engine. You can export:

- **Full Mix** - All tracks mixed down to a single stereo file
- **Individual Stems** - Separate files for each track
- **With Effects** - All audio effects fully rendered in the export
- **High Quality** - 48kHz sample rate, 32-bit float WAV files

**Key Features:**
- Offline rendering (non-real-time, accurate processing)
- Progress tracking and cancellation support
- Per-stem control of effects inclusion
- Automatic browser downloads
- WAV, MP3, and FLAC format support (WAV built-in, others require FFmpeg)

---

## Quick Start

### Basic Full Mix Export

```typescript
import { exportFullMix } from "./lib/audioExport";

// Export entire project to a single WAV file
await exportFullMix(project, {
  fileName: "my-mix",
  onStatus: (s) => console.log(s)
});
```

### Basic Stems Export

```typescript
import { exportStems } from "./lib/audioExport";

// Export individual tracks with effects
const stemsConfig = {
  [drumsUUID]: {
    includeAudioEffects: true,
    includeSends: false,
    fileName: "drums"
  },
  [bassUUID]: {
    includeAudioEffects: true,
    includeSends: false,
    fileName: "bass"
  }
};

await exportStems(project, stemsConfig);
```

---

## Core API

### AudioOfflineRenderer

The core offline rendering engine from `@opendaw/studio-core`:

```typescript
import { AudioOfflineRenderer } from "@opendaw/studio-core";
import { Progress } from "@opendaw/lib-std";

// Progress handler (required in 0.0.87+)
const progressHandler: Progress.Handler = (value) => {
  console.log(`${Math.round(value * 100)}%`);
};

// Render full mix (API changed in 0.0.87)
const audioBuffer = await AudioOfflineRenderer.start(
  project,
  undefined,        // No stem config = full mix
  progressHandler,  // Progress.Handler (0.0 - 1.0)
  undefined,        // AbortSignal (optional)
  48000             // Sample rate
);

// Render stems
const audioBuffer = await AudioOfflineRenderer.start(
  project,
  stemsConfiguration,
  progressHandler,
  undefined,
  48000
);
```

**How it works:**
1. Creates an `OfflineAudioContext` with the specified sample rate
2. Copies the project and disables looping
3. Creates audio worklets for offline processing
4. Renders all audio with effects
5. Returns an `AudioBuffer` with the rendered audio

**For stems export:**
- Each stem is rendered to separate channels in the AudioBuffer
- Channel layout: `[stem1_L, stem1_R, stem2_L, stem2_R, ...]`
- Effects are optionally included per stem

### WavFile

WAV file encoding/decoding from `@opendaw/lib-dsp` (moved from `studio-core` in SDK 0.0.129):

```typescript
import { WavFile } from "@opendaw/lib-dsp";

// Convert AudioBuffer to WAV ArrayBuffer
const wavArrayBuffer = WavFile.encodeFloats(audioBuffer);

// Decode WAV to float arrays
const audio = WavFile.decodeFloats(arrayBuffer);
// Returns: { channels: Float32Array[], sampleRate: number, numFrames: number }
```

**Supported Formats:**
- 32-bit IEEE float
- 24-bit PCM (SDK 0.0.129+)
- 16-bit PCM
- Stereo or mono
- Lossless quality

---

## Export Utility Functions

The `src/lib/audioExport.ts` utility provides high-level export functions:

### exportFullMix()

Export the entire project to a single stereo WAV file.

```typescript
export async function exportFullMix(
  project: Project,
  options?: ExportOptions
): Promise<void>
```

**Parameters:**
- `project` - The OpenDAW project to export
- `options` - Optional export configuration

**Options:**
```typescript
interface ExportOptions {
  sampleRate?: number;      // Default: 48000
  fileName?: string;         // Default: "mix"
  onProgress?: (p: number) => void;  // Limited milestone updates (not recommended)
  onStatus?: (s: string) => void;    // Status messages (recommended)
}
```

**Example:**
```typescript
await exportFullMix(project, {
  fileName: "my-song-master",
  sampleRate: 48000,
  onStatus: (status) => {
    setStatusText(status);
  }
});
```

**What gets exported:**
- All tracks mixed together
- All audio effects rendered
- All automation applied
- Master output effects included
- Final stereo mixdown

### exportStems()

Export individual tracks as separate WAV files.

```typescript
export async function exportStems(
  project: Project,
  stemsConfig: Record<string, StemExportConfig>,
  options?: ExportOptions
): Promise<void>
```

**Parameters:**
- `project` - The OpenDAW project
- `stemsConfig` - Configuration for each stem (keyed by track UUID)
- `options` - Optional export configuration

**Stem Configuration:**
```typescript
interface StemExportConfig {
  includeAudioEffects: boolean;  // Include effects on this stem
  includeSends: boolean;          // Include send/aux effects
  fileName: string;               // Output filename (without extension)
}
```

**Example:**
```typescript
const stemsConfig = {
  [vocalsUUID]: {
    includeAudioEffects: true,  // Export with Reverb, Compressor, etc.
    includeSends: false,
    fileName: "vocals"
  },
  [drumsUUID]: {
    includeAudioEffects: true,  // Export with compression
    includeSends: false,
    fileName: "drums"
  },
  [guitarUUID]: {
    includeAudioEffects: false, // Export dry (no effects)
    includeSends: false,
    fileName: "guitar-dry"
  }
};

await exportStems(project, stemsConfig, {
  sampleRate: 48000,
  onStatus: setStatus
});
```

**What gets exported:**
- One WAV file per stem
- Individual stereo files automatically downloaded
- Effects optionally included per stem
- Each file named according to `fileName`

---

## React Hook (Recommended)

### useAudioExport()

For React applications, the `useAudioExport` hook provides a convenient way to manage export state and handlers.

**Location:** `src/hooks/useAudioExport.ts`

```typescript
import { useAudioExport } from "./hooks/useAudioExport";

const {
  isExporting,
  exportStatus,
  handleExportMix,
  handleExportStems
} = useAudioExport(project, {
  sampleRate: 48000,
  mixFileName: "my-mix"
});
```

**Parameters:**
- `project` - The OpenDAW project instance (or `null`)
- `options` - Optional configuration:
  - `sampleRate?: number` - Sample rate for export (default: 48000)
  - `mixFileName?: string` - Base filename for full mix export (default: "mix")

**Returns:**
- `isExporting: boolean` - Whether an export is currently in progress
- `exportStatus: string` - Current status message
- `handleExportMix: () => Promise<void>` - Export full mix handler
- `handleExportStems: (config: StemConfigBuilder) => Promise<void>` - Export stems handler

**Note:** Progress tracking is not available because OpenDAW's offline renderer doesn't provide progress callbacks. The export will show status messages and a note that it may take time for long tracks.

**Stem Configuration:**
```typescript
interface StemConfigBuilder {
  includeAudioEffects: boolean;  // Include effects in stems
  includeSends: boolean;          // Include send/aux effects
}
```

**Complete Example:**

```typescript
import { useAudioExport } from "./hooks/useAudioExport";
import { Button, Progress, Text } from "@radix-ui/themes";

const ExportControls = ({ project }: { project: Project | null }) => {
  const {
    isExporting,
    exportStatus,
    handleExportMix,
    handleExportStems
  } = useAudioExport(project, {
    sampleRate: 48000,
    mixFileName: "my-song"
  });

  // Wrapper for stems with specific configuration
  const handleStemsWithEffects = useCallback(async () => {
    await handleExportStems({
      includeAudioEffects: true,
      includeSends: false
    });
  }, [handleExportStems]);

  return (
    <div>
      <Button onClick={handleExportMix} disabled={!project || isExporting}>
        Export Mix
      </Button>

      <Button onClick={handleStemsWithEffects} disabled={!project || isExporting}>
        Export Stems (with FX)
      </Button>

      {(exportStatus || isExporting) && (
        <div>
          <Text>{exportStatus}</Text>
          {isExporting && (
            <Text size="1" color="gray">
              Rendering offline (may take a moment for long tracks)
            </Text>
          )}
        </div>
      )}
    </div>
  );
};
```

**Benefits:**
- ✅ Automatic state management (status, isExporting flag)
- ✅ Built-in error handling
- ✅ Consistent API across demos
- ✅ Less boilerplate code
- ✅ Type-safe stem configuration

**When to use:**
- React applications
- Multiple export buttons/features
- Consistent export UI patterns
- Reduced boilerplate

**When to use raw functions instead:**
- Non-React applications
- Custom state management needs
- Special error handling requirements

---

## Full Mix Export

### Use Cases

**When to use full mix export:**
- Final master for distribution
- Sharing your complete mix
- Archiving finished projects
- Creating reference mixes
- Testing mix decisions

### Example Integration

**Recommended:** Use the `useAudioExport` hook (see [React Hook section](#react-hook-recommended))

```typescript
import { useAudioExport } from "./hooks/useAudioExport";

const App = () => {
  const [project, setProject] = useState<Project | null>(null);

  const { isExporting, exportStatus, handleExportMix } = useAudioExport(project, {
    sampleRate: 48000,
    mixFileName: "final-mix"
  });

  return (
    <div>
      <button onClick={handleExportMix} disabled={isExporting}>
        {isExporting ? "Exporting..." : "Export Mix"}
      </button>
      {exportStatus && <p>{exportStatus}</p>}
    </div>
  );
};
```

---

## Stems Export

### Use Cases

**When to use stems export:**
- Sharing individual tracks for collaboration
- Sending to mixing/mastering engineer
- Remixing or rearranging
- Creating sample packs
- Archiving project components
- A/B testing with and without effects

### Effect Inclusion Control

The key feature of stems export is **per-stem control** of effects inclusion:

```typescript
// Export with different effect settings per track
const stemsConfig = {
  // Vocals: Include all effects (Reverb + Compressor)
  [vocalsUUID]: {
    includeAudioEffects: true,
    includeSends: false,
    fileName: "vocals-wet"
  },

  // Drums: Include compression, export tight sound
  [drumsUUID]: {
    includeAudioEffects: true,
    includeSends: false,
    fileName: "drums-compressed"
  },

  // Guitar: Export dry for re-amping later
  [guitarUUID]: {
    includeAudioEffects: false,
    includeSends: false,
    fileName: "guitar-dry"
  }
};
```

### Example Integration

**Recommended:** Use the `useAudioExport` hook (see [React Hook section](#react-hook-recommended))

```typescript
import { useAudioExport } from "./hooks/useAudioExport";

const App = () => {
  const [project, setProject] = useState<Project | null>(null);

  const { isExporting, exportStatus, handleExportStems } = useAudioExport(project, {
    sampleRate: 48000
  });

  // Wrapper with your desired configuration
  const handleStemsWithEffects = useCallback(async () => {
    await handleExportStems({
      includeAudioEffects: true,
      includeSends: false
    });
  }, [handleExportStems]);

  return (
    <div>
      <button onClick={handleStemsWithEffects} disabled={isExporting}>
        {isExporting ? "Exporting..." : "Export Stems"}
      </button>
      {exportStatus && <p>{exportStatus}</p>}
    </div>
  );
};
```

---

## Export Options

### Sample Rate

**Default:** 48000 Hz (48 kHz)

**Options:**
- `44100` - CD quality
- `48000` - Professional standard (recommended)
- `96000` - High resolution (larger files)

```typescript
await exportFullMix(project, {
  sampleRate: 48000  // 48 kHz
});
```

### Progress Tracking

**Note:** Real-time progress tracking is not available during the offline rendering phase because OpenDAW's `AudioOfflineRenderer` doesn't provide progress callbacks. The export functions support an `onProgress` callback parameter for compatibility, but progress updates are limited to milestone events rather than continuous progress.

**Milestone events:**
- `50` - Rendering complete, encoding started
- `75` - Encoding complete, preparing download (full mix only)
- `100` - Export complete

**Recommendation:** Use status messages (`onStatus`) and show an indeterminate loading indicator rather than a progress bar, with a note that export may take time for long tracks.

### Status Messages

Receive detailed status messages during export:

```typescript
await exportFullMix(project, {
  onStatus: (status) => {
    console.log(status);
    setStatusText(status);
  }
});
```

**Example status messages:**
- "Preparing offline render..."
- "Rendering audio..."
- "Encoding WAV file..."
- "Preparing download..."
- "Export complete!"

### Filename Customization

Specify custom filenames (without extension):

```typescript
// Full mix
await exportFullMix(project, {
  fileName: "my-song-final-v3"
  // Downloads as: my-song-final-v3.wav
});

// Stems
const stemsConfig = {
  [uuid1]: {
    includeAudioEffects: true,
    includeSends: false,
    fileName: "Lead_Vocals_with_FX"
    // Downloads as: Lead_Vocals_with_FX.wav
  }
};
```

**Filename sanitization:**
- Invalid characters automatically replaced with underscores
- Use `sanitizeFileName()` helper for manual sanitization

---

## Effects Rendering

### How Effects Are Rendered

When exporting, OpenDAW renders all effects **offline** (non-real-time):

**Advantages:**
- **Accurate processing** - No real-time constraints
- **High quality** - All effects rendered at full precision
- **Automation included** - Parameter changes over time preserved
- **Consistent results** - Same output every time

**What gets rendered:**
- ✓ Audio effects (Reverb, Delay, Compressor, EQ, etc.)
- ✓ Audio effect automation
- ✓ Volume and pan automation
- ✓ Master output effects
- ✗ Send effects (optional, controlled via `includeSends`)

### Hearing Your Effects in Exports

**Full Mix Export:**
```typescript
// All effects are automatically included
await exportFullMix(project, {
  fileName: "mix-with-all-effects"
});
// Result: Single stereo file with all effects rendered
```

**Stems Export with Effects:**
```typescript
const stemsConfig = {
  [vocalsUUID]: {
    includeAudioEffects: true,  // ← Include Reverb, Compressor, etc.
    includeSends: false,
    fileName: "vocals-processed"
  }
};

await exportStems(project, stemsConfig);
// Result: vocals-processed.wav with all effects baked in
```

**Stems Export without Effects (Dry):**
```typescript
const stemsConfig = {
  [vocalsUUID]: {
    includeAudioEffects: false,  // ← Export dry signal
    includeSends: false,
    fileName: "vocals-dry"
  }
};

await exportStems(project, stemsConfig);
// Result: vocals-dry.wav with no effects
```

### Effect Chain Example

```typescript
// Setup: Vocals track with Compressor → Reverb → EQ
vocalsEffects.addEffect("Compressor");
vocalsEffects.addEffect("Reverb");
vocalsEffects.addEffect("EQ");

// Export with effects
const stemsConfig = {
  [vocalsUUID]: {
    includeAudioEffects: true,  // All 3 effects rendered in order
    includeSends: false,
    fileName: "vocals-with-chain"
  }
};

await exportStems(project, stemsConfig);
// Result: vocals-with-chain.wav has Compressor → Reverb → EQ applied
```

---

## File Formats

### WAV (Built-in)

**Format:** 32-bit IEEE float, WAV container
**Quality:** Lossless
**Use case:** Default, highest quality
**File size:** Large (~10 MB/minute stereo)

```typescript
// WAV export (automatic via exportFullMix/exportStems)
await exportFullMix(project, { fileName: "mix" });
// Downloads: mix.wav
```

### MP3 and FLAC (Via OpenDAW Studio)

**Note:** The demo utilities (`exportFullMix`, `exportStems`) only support WAV. For MP3/FLAC, use OpenDAW Studio's `Mixdowns` service:

```typescript
import { Mixdowns } from "@opendaw/studio/service/Mixdowns";

// MP3 export (requires FFmpeg)
await Mixdowns.exportMixdown({ project, meta });
// User selects format in dialog: WAV, MP3, or FLAC
```

**MP3:**
- Lossy compression
- Smaller files (~1 MB/minute)
- Requires FFmpeg (lazy-loaded)

**FLAC:**
- Lossless compression
- Medium files (~5 MB/minute)
- Requires FFmpeg (lazy-loaded)

---

## Examples

### Example 1: Drum Scheduling Demo

Export a programmatic drum pattern using the `useAudioExport` hook:

```typescript
import { useAudioExport } from "./hooks/useAudioExport";

// Use the hook (automatically names file based on BPM)
const { handleExportMix, handleExportStems } = useAudioExport(project, {
  sampleRate: 48000,
  mixFileName: `drum-pattern-${bpm}bpm`
});

// Export full drum pattern (just call it!)
await handleExportMix();

// Export individual drum sounds (no effects for dry samples)
const handleDrumStems = useCallback(async () => {
  await handleExportStems({
    includeAudioEffects: false,  // Drums are dry samples
    includeSends: false
  });
  // Result: Separate files for "Kick", "Snare", "Hi-Hat Closed", etc.
}, [handleExportStems]);
```

### Example 2: Effects Demo

Export with audio effects rendered using the `useAudioExport` hook:

```typescript
import { useAudioExport } from "./hooks/useAudioExport";

// Use the hook
const { handleExportMix, handleExportStems } = useAudioExport(project, {
  sampleRate: 48000,
  mixFileName: "dark-ride-mix"
});

// Export full mix with all effects (just call it!)
await handleExportMix();
// Result: All track effects + master effects rendered

// Export stems with effects
const handleEffectsStems = useCallback(async () => {
  await handleExportStems({
    includeAudioEffects: true,  // ← Export with effects!
    includeSends: false
  });
  // Result: 7 WAV files (Intro, Vocals, Guitar Lead, Guitar, Drums, Bass, Effect Returns)
  // Each with their effects baked in!
}, [handleExportStems]);
```

### Example 3: Custom UI Integration

Complete React component with export UI using the hook:

```typescript
import { useAudioExport } from "./hooks/useAudioExport";
import { Button, Text } from "@radix-ui/themes";

const ExportPanel = ({ project }: { project: Project | null }) => {
  const { isExporting, exportStatus, handleExportMix } = useAudioExport(project, {
    sampleRate: 48000,
    mixFileName: "my-export"
  });

  return (
    <div>
      <Button onClick={handleExportMix} disabled={!project || isExporting}>
        {isExporting ? "Exporting..." : "Export Mix"}
      </Button>

      {(exportStatus || isExporting) && (
        <div>
          <Text>{exportStatus}</Text>
          {isExporting && (
            <Text size="1" color="gray">
              Rendering offline (may take a moment for long tracks)
            </Text>
          )}
        </div>
      )}
    </div>
  );
};
```

---

## Best Practices

### 1. Disable Playback During Export

```typescript
const handleExport = async () => {
  // Stop playback before exporting
  if (project.engine.isPlaying.getValue()) {
    project.engine.stop();
  }

  await exportFullMix(project, {
    fileName: "mix"
  });
};
```

### 2. Provide User Feedback

**Recommended:** Use the `useAudioExport` hook which handles feedback automatically:

```typescript
const { isExporting, exportStatus, handleExportMix } = useAudioExport(project);

// Display status to user
{exportStatus && <Text>{exportStatus}</Text>}
{isExporting && <Text>Rendering offline (may take a moment)...</Text>}
```

**Alternative (low-level API):** Use status callbacks:

```typescript
await exportFullMix(project, {
  onStatus: (s) => {
    setStatusMessage(s);
    console.log(s);
  }
});
```

### 3. Handle Errors Gracefully

```typescript
try {
  await exportFullMix(project, { fileName: "mix" });
} catch (error) {
  console.error("Export failed:", error);
  alert("Export failed. Please try again.");
}
```

### 4. Sanitize Filenames

```typescript
import { sanitizeFileName } from "./lib/audioExport";

const safeName = sanitizeFileName("My Song (Final) v2.3");
// Result: "My_Song__Final__v2_3"

await exportFullMix(project, { fileName: safeName });
```

### 5. Use Descriptive Names

```typescript
// Good
fileName: "darkride-master-v3-with-compression"
fileName: "vocals-dry-for-reamping"

// Less helpful
fileName: "mix"
fileName: "export1"
```

### 6. Consider File Sizes

**WAV files are large:**
- Stereo, 48kHz, 32-bit: ~10 MB per minute
- 3-minute song: ~30 MB
- 7 stems × 3 minutes: ~210 MB total

**Recommendations:**
- Use WAV for archival and processing
- Convert to MP3/FLAC for sharing (use OpenDAW Studio's Mixdowns service)
- Warn users about file sizes for long exports

---

## Troubleshooting

### Export Fails with "undefined is not a function"

**Problem:** Missing imports or undefined project

**Solution:**
```typescript
// Ensure correct imports
import { exportFullMix } from "./lib/audioExport";
import { Project } from "@opendaw/studio-core";

// Check project is defined
if (!project) {
  console.error("Project is not initialized");
  return;
}

await exportFullMix(project, { fileName: "mix" });
```

### No Download Triggered

**Problem:** Browser blocked download

**Solution:**
- User gesture required (must be in response to button click)
- Check browser console for errors
- Verify popup blocker isn't blocking downloads

```typescript
// Ensure export is triggered from user interaction
<button onClick={handleExport}>Export</button>
```

### Effects Not Rendered in Export

**Problem:** `includeAudioEffects` set to `false`

**Solution:**
```typescript
// For stems with effects
const stemsConfig = {
  [uuid]: {
    includeAudioEffects: true,  // ← Make sure this is true
    includeSends: false,
    fileName: "stem-with-fx"
  }
};
```

### Export Takes Too Long

**Problem:** Long audio files or many effects

**Explanation:**
- Offline rendering is slower than real-time
- Multiple effects increase processing time
- This is normal and ensures quality

**Solution:**
- Use the `useAudioExport` hook to show status messages
- Display a note that export may take time for long tracks
- Consider exporting shorter sections for testing

```typescript
const { isExporting, exportStatus, handleExportMix } = useAudioExport(project);

// Show status to user
{exportStatus && <Text>{exportStatus}</Text>}
{isExporting && <Text>Rendering offline (may take a moment for long tracks)</Text>}
```

### Volume Too Low/High in Export

**Problem:** Gain staging or effect parameters

**Solution:**
- Check master volume level
- Verify effect parameters (especially Crushers and Compressors)
- Adjust levels before exporting
- Test with a short export first

### "Overlapping regions" Warning and Incomplete Export

**Problem:** Console shows warnings like "Overlapping regions" followed by "Deleting 16 invalid boxes", and export is incomplete (missing some tracks)

**Cause:** OpenDAW has strict validation rules for AudioRegionBox instances depending on their `timeBase` setting:

- **Musical TimeBase (default):** Overlapping regions are **forbidden** and will be automatically deleted
- **Seconds TimeBase:** Overlapping regions are **allowed** and supported

**Background:**

OpenDAW's `ProjectValidation.ts` validates regions when loading/exporting projects. For regions using `TimeBase.Musical` (the default), overlapping is treated as data corruption because:
- Musical time regions recalculate duration when tempo changes
- Overlapping regions would create ambiguity during tempo adjustments
- The validation automatically deletes overlapping regions as "invalid boxes"

From OpenDAW's `RegionClipResolver.ts`:
```typescript
// AudioRegions in absolute time-domain are allowed to overlap.
const allowOverlap = (region: AnyRegionBoxAdapter) =>
    region instanceof AudioRegionBoxAdapter && region.timeBase !== TimeBase.Musical
```

**Solution 1: Use Seconds TimeBase (Recommended for one-shot samples)**

For audio that doesn't need tempo sync (drums, sound effects, ambience), use `TimeBase.Seconds`:

```typescript
import { TimeBase } from "@opendaw/studio-core";
import { ValueEventCollectionBox } from "@opendaw/studio-boxes";

// Create events collection (required in 0.0.87+)
const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

const regionBox = AudioRegionBox.create(boxGraph, UUID.generate(), box => {
  box.regions.refer(trackBox.regions);
  box.file.refer(audioFileBox);
  box.events.refer(eventsCollectionBox.owners); // Required in 0.0.87+
  box.timeBase.setValue(TimeBase.Seconds);  // ← Allow overlaps
  box.position.setValue(position);
  box.duration.setValue(clipDurationInPPQN);  // Full natural duration OK
  // ... other settings
});
```

**Benefits:**
- Natural audio decay tails can overlap
- Full sample duration preserved
- No artificial truncation
- Perfect for drums, percussion, sound effects

**Solution 2: Keep Musical TimeBase + Prevent Overlaps**

If you need tempo-synced regions, ensure they don't overlap by limiting duration:

```typescript
// Calculate spacing between hits
const spacing = Quarter * 2; // e.g., every 2 quarter notes

// Limit duration to prevent overlaps
const safeDuration = Math.min(
  PPQN.secondsToPulses(audioBuffer.duration, bpm),
  spacing  // Cap at spacing to prevent overlap
);

// Create events collection (required in 0.0.87+)
const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

const regionBox = AudioRegionBox.create(boxGraph, UUID.generate(), box => {
  box.regions.refer(trackBox.regions);
  box.file.refer(audioFileBox);
  box.events.refer(eventsCollectionBox.owners); // Required in 0.0.87+
  box.timeBase.setValue(TimeBase.Musical);  // Default, tempo-aware
  box.duration.setValue(safeDuration);  // ← Capped duration
  // ... other settings
});
```

**Solution 3: Use Separate Tracks**

Create individual tracks for each audio source to avoid overlaps entirely:

```typescript
// Instead of multiple regions on one track:
samples.forEach(sample => {
  const { audioUnitBox, trackBox } = api.createInstrument(InstrumentFactories.Tape);
  // Each sample gets its own track - no overlaps possible
});
```

**When to Use Each Approach:**

| Use Case | Recommended TimeBase | Overlaps? |
|----------|---------------------|-----------|
| Drums, percussion | `TimeBase.Seconds` | Allowed |
| Sound effects, ambience | `TimeBase.Seconds` | Allowed |
| Loops that need tempo sync | `TimeBase.Musical` | Must prevent |
| Melodic/harmonic content | `TimeBase.Musical` | Must prevent |
| Vocal recordings | Either (depends on workflow) | Varies |

**Validation Details:**

OpenDAW runs validation at these points:
1. Project load (`ProjectValidation.validate()`)
2. Before export (`AudioOfflineRenderer.start()`)
3. During editing (`RegionClipResolver.validateTrack()`)

When overlapping Musical regions are detected:
- Console warnings appear for each overlap
- All overlapping regions are marked invalid
- Invalid boxes are deleted
- User sees: "Some data is corrupt" message

This is **not a bug** - it's intentional data integrity checking to prevent tempo-related issues.

---

## Additional Resources

### Related Files

- **Export Utility:** `src/lib/audioExport.ts`
- **React Hook:** `src/hooks/useAudioExport.ts`
- **Drum Demo Integration:** `src/drum-scheduling-demo.tsx`
- **Effects Demo Integration:** `src/effects-demo.tsx`

### OpenDAW Core Files

- **Offline Renderer:** `@opendaw/studio-core/AudioOfflineRenderer.ts`
- **WAV Encoding:** `@opendaw/lib-dsp/WavFile.ts`
- **Mixdowns Service:** `@opendaw/studio/service/Mixdowns.ts`
- **Engine Integration:** `@opendaw/studio-core-processors/EngineProcessor.ts`

### Documentation

- [Effects Documentation](./11-effects.md)
- [Project Setup](./02-project-structure.md)
- [Box System & Reactivity](./04-box-system-and-reactivity.md)

---

## Summary

OpenDAW's export system provides:

✅ **Full Mix Export** - Complete stereo mixdown
✅ **Stems Export** - Individual track files
✅ **Effects Rendering** - All effects fully processed
✅ **High Quality** - 48kHz, 32-bit float WAV
✅ **Progress Tracking** - Real-time status updates
✅ **Easy Integration** - Simple API for demos
✅ **React Hook** - Convenient `useAudioExport` hook for React apps

Perfect for:
- Final masters
- Collaboration
- Effect testing
- Archival
- Sample creation

**Ready to export!** Check out the demos at:
- `http://localhost:5174/drum-scheduling-demo.html`
- `http://localhost:5174/effects-demo.html`

---

## Advanced: Offline Rendering Patterns

> **Skip if:** the basic export API meets your needs

Range-bounded export, metronome rendering, and the OfflineAudioContext approach.

### Background: Two Offline Render Paths in OpenDAW

OpenDAW has two offline renderers, but both have limitations when used from a live project:

| Renderer | Status | Limitation |
|----------|--------|------------|
| `AudioOfflineRenderer` | Deprecated | Uses `OfflineAudioContext` on main thread. `Option.None` → `countStems` returns 1, routing through stem path (no metronome). No range support (always renders 0 to last region). |
| `OfflineEngineRenderer` | Current | Worker-based custom render loop. `Option.None` → same `countStems=1` stem routing. Throws "Already connected" on live project's `liveStreamReceiver`. |

**Key clarification:** `ExportStemsConfiguration.countStems(Option.None)` returns **1** (not 0). The `numStems === 0` panic guard only fires for `Option.Some({})` (empty config object). With `Option.None`, the renderer creates 2 channels (`1 * 2`) and routes through the **stem export branch** — which excludes metronome. This is the fundamental reason neither renderer supports mixdown-with-metronome, not the panic guard.

Neither renderer supports:
- Rendering the **mixdown path** (which includes metronome) — `Option.None` routes through the stem branch
- **Range-bounded** export (start position + exact sample count) via the `start()` convenience method
- Both rely on silence detection or `maxDurationSeconds` for end bounds

### The OfflineAudioContext Approach

The working approach bypasses both renderers and uses the same building blocks they use internally: `project.copy()`, `OfflineAudioContext`, and `AudioWorklets.createEngine()`.

```typescript
import { Project, AudioWorklets } from "@opendaw/studio-core";
import { ppqn } from "@opendaw/lib-dsp";
import { TimeSpan } from "@opendaw/lib-std";
import { Wait } from "@opendaw/lib-runtime";

async function renderRange(
  project: Project,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number,
  exportConfiguration?: ExportStemsConfiguration,
  mutateBeforeCopy?: () => void,
  restoreAfterCopy?: () => void,
  metronomeEnabled: boolean = false,
  metronomeGain: number = -6
): Promise<Float32Array[]> {
  // 1. Calculate exact sample count from PPQN range
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const numChannels = exportConfiguration
    ? Object.keys(exportConfiguration).length * 2
    : 2;
  const numSamples = Math.ceil(durationSeconds * sampleRate);

  // 2. Mutate original (e.g., mute tracks), copy synchronously, restore immediately
  if (mutateBeforeCopy) mutateBeforeCopy();
  const projectCopy = project.copy();
  if (restoreAfterCopy) restoreAfterCopy();

  try {
    projectCopy.boxGraph.beginTransaction();
    projectCopy.timelineBox.loopArea.enabled.setValue(false);
    projectCopy.boxGraph.endTransaction();

    // 3. Create OfflineAudioContext with exact bounds
    const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
    const worklets = await AudioWorklets.createFor(context);
    const engineWorklet = worklets.createEngine({
      project: projectCopy,
      exportConfiguration, // undefined = mixdown (metronome included), config = stems
    });
    engineWorklet.connect(context.destination, 0); // output 0 = main audio (worklet has 2 outputs since SDK 0.0.133)

    // 4. Set preferences on the worklet (not the project copy)
    engineWorklet.preferences.settings.metronome.enabled = metronomeEnabled;
    engineWorklet.preferences.settings.metronome.gain = metronomeGain;

    // 5. Set position and render
    engineWorklet.setPosition(startPpqn);
    await engineWorklet.isReady();
    engineWorklet.play();

    const startTime = Date.now();
    while (!(await engineWorklet.queryLoadingComplete())) {
      if (Date.now() - startTime > 30_000) {
        throw new Error("Sample loading timed out after 30s");
      }
      await Wait.timeSpan(TimeSpan.millis(100));
    }

    const audioBuffer = await context.startRendering();

    // 6. Extract channels
    const channels: Float32Array[] = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      channels.push(audioBuffer.getChannelData(i));
    }
    return channels;
  } finally {
    projectCopy.terminate();
  }
}
```

### Key Concepts

#### Mixdown vs Stem Path

The `EngineProcessor.render()` method has a hard branch:

```typescript
if (this.#stemExports.length === 0) {
  // Mixdown path: primary output + metronome
  this.#primaryOutput.unwrap().audioOutput().replaceInto(output)
  if (metronomeEnabled) { this.#metronome.output.mixInto(output) }
} else {
  // Stem path: individual AudioUnit outputs, NO metronome
  this.#stemExports.forEach((unit, index) => {
    const [l, r] = unit.audioOutput().channels()
    output[index * 2].set(l)
    output[index * 2 + 1].set(r)
  })
}
```

- **No `exportConfiguration`** passed to `createEngine()` → `stemExports.length === 0` → mixdown path → metronome included
- **With `exportConfiguration`** → per-track channels → metronome excluded

There is no way to get metronome in the stem path or individual stems in the mixdown path. This is a fundamental SDK design decision.

**Note:** This is different from passing `Option.None` to `OfflineEngineRenderer.create()`. The renderer's `countStems(Option.None)` returns 1, which still populates `stemExports` — routing through the stem branch. Our approach bypasses the renderer entirely and passes `undefined` to `createEngine()`, which leaves `stemExports` empty.

#### Mutate-Copy-Restore Pattern

`project.copy()` creates **new box instances** from the serialized box graph. You cannot modify the original project's boxes through the copy's `editing.modify()` — this throws "Modification only prohibited in transaction mode."

To capture muted state in a copy, mutate the **original** project, copy synchronously, then restore:

```typescript
// Save original state
const originalMutes = new Map<TrackData, boolean>();
for (const track of tracks) {
  originalMutes.set(track, track.audioUnitBox.mute.getValue());
}

// Mutate → copy (synchronous) → restore
project.editing.modify(() => {
  for (const track of tracks) {
    track.audioUnitBox.mute.setValue(true);
  }
});
const projectCopy = project.copy(); // synchronous — captures muted state
project.editing.modify(() => {
  for (const [track, wasMuted] of originalMutes) {
    track.audioUnitBox.mute.setValue(wasMuted);
  }
});

// projectCopy has muted state baked in, original is restored
```

The mute window is a single synchronous JS task — no audio blocks process in between, so there is no audible glitch during live playback.

#### project.copy() Behavior

`project.copy()` serializes the box graph via `toArrayBuffer()` and creates a new `Project` instance.

**What transfers:**
- Box graph state (track structure, regions, audio file references, mute/solo states)
- Sample manager reference (samples stay loaded — same `sampleManager` instance)

**What does NOT transfer:**
- Engine preferences (metronome enabled/gain, recording settings)
- Engine state (playback position, playing/recording flags)
- Live stream receiver connections
- Box instances (the copy has new instances with the same UUIDs)

Preferences must be set on `engineWorklet.preferences` after `createEngine()`.

#### Metronome Preferences

Metronome settings are stored in `EnginePreferences`, not the box graph:

```typescript
// Schema from EnginePreferencesSchema.ts
metronome: {
  enabled: boolean,          // default: false
  beatSubDivision: 1|2|4|8, // default: 1 (quarter notes)
  gain: number,              // default: -6 dB, range: -Infinity to 0
  monophonic: boolean        // default: true
}
```

The gain max is **0 dB** (unity), not +6 dB like track volume. There is no boost available.

Click sounds are built into the processor — no `loadClickSound()` call is needed for default clicks.

#### Why OfflineEngineRenderer Doesn't Work for Mixdown

1. **Stem-path routing with `Option.None`**: `countStems(Option.None)` returns 1, creating 2 channels routed through the stem export branch. The metronome lives in the mixdown branch (`stemExports.length === 0`), which is never reached.

2. **`liveStreamReceiver` conflict**: `create()` calls `source.liveStreamReceiver.connect()` on the source project. If the live engine already has it connected, this throws "Already connected". Using `project.copy()` avoids this, but introduces issue #3.

3. **Worker sample fetching with `project.copy()`**: The worker's `fetchAudio` callbacks use `source.sampleManager.getOrCreate(uuid)`. While `project.copy()` shares the same `sampleManager` reference, the worker communicates via `MessageChannel` — the sample loading callbacks need to resolve through the message passing layer, which may not work correctly with the copy's context.

### Export Modes

#### Export Mixdown (selected tracks + optional metronome)

Mute unselected tracks on the original, copy, restore, render via mixdown path.

```typescript
const channels = await renderRange(
  project, startPpqn, endPpqn, 48000,
  undefined,  // mixdown path
  () => {
    project.editing.modify(() => {
      for (const track of tracks) {
        const uuid = UUID.toString(track.audioUnitBox.address.uuid);
        track.audioUnitBox.mute.setValue(!selectedUuids.includes(uuid));
      }
    });
  },
  () => {
    project.editing.modify(() => {
      for (const [track, wasMuted] of savedMutes) {
        track.audioUnitBox.mute.setValue(wasMuted);
      }
    });
  },
  true,  // metronome enabled
  -6     // metronome gain dB
);
// Result: stereo mixdown of selected tracks + metronome
```

This replaces the original Mode 1 (metronome only) and Mode 3 (single stem + metronome) — select any combination of tracks and metronome.

#### Export Stems (individual files + optional metronome stem)

Render via stem path for per-track files. If metronome is requested, run a second render pass via mixdown path with all tracks muted.

```typescript
// Pass 1: Stem export (per-track channels, no metronome)
const exportConfig: ExportStemsConfiguration = {};
for (const track of selectedTracks) {
  const uuid = UUID.toString(track.audioUnitBox.address.uuid);
  exportConfig[uuid] = {
    includeAudioEffects: true,
    includeSends: true,
    useInstrumentOutput: true,
    fileName: track.name,
  };
}

const channels = await renderRange(
  project, startPpqn, endPpqn, 48000,
  exportConfig,  // stem path
  undefined, undefined,
  false  // no metronome in stem path
);
// Split interleaved channels: [stem1_L, stem1_R, stem2_L, stem2_R, ...]

// Pass 2 (optional): Metronome-only stem via mixdown path
if (includeMetronome) {
  const metronomeChannels = await renderRange(
    project, startPpqn, endPpqn, 48000,
    undefined,  // mixdown path
    () => { /* mute all tracks */ },
    () => { /* restore mutes */ },
    true, -6    // metronome enabled
  );
  // Append as additional "Metronome" stem
}
```

### Range Selection: Bars to PPQN

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// Assumes constant 4/4 time — for variable time signatures, accumulate per-bar
const BAR = PPQN.fromSignature(4, 4); // 3840 PPQN per bar in 4/4

// Bar numbers are 1-indexed
const startPpqn = ((startBar - 1) * BAR) as ppqn;  // bar 1 = position 0
const endPpqn = (endBar * BAR) as ppqn;              // bar 4 = position 15360

// Duration via tempo map (handles tempo changes)
const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
const numSamples = Math.ceil(durationSeconds * sampleRate);
```

For projects with time signature changes, compute bar positions by accumulating `PPQN.fromSignature(nom, denom)` per bar (see `src/time-signature-demo.tsx` for reference).

### Encoding and Download

```typescript
import { WavFile } from "@opendaw/lib-dsp";

// Channels → AudioBuffer → WAV (32-bit float)
const audioBuffer = new AudioBuffer({
  length: channels[0].length,
  numberOfChannels: channels.length,
  sampleRate,
});
channels.forEach((ch, i) => audioBuffer.copyToChannel(ch, i));

const wavArrayBuffer = WavFile.encodeFloats(audioBuffer);

// Trigger download
const blob = new Blob([wavArrayBuffer], { type: "audio/wav" });
const url = URL.createObjectURL(blob);
const link = document.createElement("a");
link.href = url;
link.download = "export.wav";
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
URL.revokeObjectURL(url);
```

### In-Browser Preview

Play exported audio without the engine using a plain `AudioBufferSourceNode`:

```typescript
const source = audioContext.createBufferSource();
source.buffer = audioBuffer;
source.connect(audioContext.destination);
source.onended = () => {
  source.disconnect();
  // update UI state
};
source.start();

// Stop (guard against already-ended source):
try { source.stop(); } catch { /* already ended */ }
source.disconnect();
```

This is completely separate from the OpenDAW engine — no interference with live playback.

### Future: Worker-Based Rendering with Mixdown Support

#### Current Limitation

Our `OfflineAudioContext` approach works but runs on the main thread. The SDK's `OfflineEngineRenderer` runs in a dedicated Web Worker using a custom render loop (no Web Audio API), which is faster and non-blocking.

#### How the SDK Worker Actually Renders

The offline engine worker does **not** use `OfflineAudioContext`. It polyfills AudioWorklet globals and calls `processor.process()` directly in a tight loop:

```typescript
// offline-engine-main.ts (simplified)
while (offset < numSamples) {
  updateFrameTime(engine.totalFrames, engine.sampleRate)
  engine.processor.process([[]], outputs)
  engine.totalFrames += RenderQuantum
  offset += RenderQuantum
}
```

The metronome is already wired into `EngineProcessor.process()` — it runs in the mixdown branch (`stemExports.length === 0`) and would produce audio if the engine were configured for mixdown. Sample fetching, script device loading, and preference syncing all work over MessageChannel between main thread and worker.

#### SDK Changes Requested

**1. Support mixdown path in `OfflineEngineRenderer`**

Currently, `Option.None` → `countStems` returns 1 → stem path (no metronome). To enable the mixdown path, the renderer needs a way to set `stemExports` to empty while still creating 2 output channels. Options:
- Add an explicit `mixdown: boolean` flag to the config
- Treat `Option.None` differently (set `numberOfChannels = 2` without populating `stemExports`)
- Add a new `ExportStemsConfiguration` variant that means "mixdown"

**2. Accept engine preferences in `OfflineEngineInitializeConfig`**

`project.toArrayBuffer()` serializes the box graph but not engine preferences. The offline worker creates fresh `EnginePreferences` with defaults (metronome disabled). Adding an optional `engineSettings` field would let the caller pass metronome state:

```typescript
export interface OfflineEngineInitializeConfig {
  // ... existing fields ...
  engineSettings?: Partial<EngineSettings>  // metronome, playback, recording prefs
}
```

**3. Support `setPosition()` before `play()` for range rendering**

`OfflineEngineRenderer` already exposes `setPosition(ppqn)` and `step(numSamples)` for precise range rendering. However, the `start()` convenience method always renders from position 0. Adding optional range parameters would make this a first-class feature:

```typescript
static async start(
  source, optExportConfiguration, progress, abortSignal?, sampleRate?,
  startPosition?: ppqn,  // default: 0
  endPosition?: ppqn     // default: source.lastRegionAction()
): Promise<AudioData>
```

**4. Resolve `liveStreamReceiver` conflict**

`OfflineEngineRenderer.create()` calls `source.liveStreamReceiver.connect()` on the passed project, which throws "Already connected" if the live engine is running. Either:
- Use `project.copy()` internally (like `AudioOfflineRenderer` does), or
- Guard the connect call, or
- Allow multiple connections on `liveStreamReceiver`

#### Workaround: Custom Worker Fork

Until SDK changes land, a custom worker could be created by forking `offline-engine-main.ts` (~120 lines). The main thread coordinator (`OfflineEngineRenderer.create()` setup — MessageChannel, Communicator, fetchAudio, script device loading) would need to be replicated (~60 lines), but the EngineProcessor, Metronome, and all DSP code are reused as-is from the SDK.

This is a meaningful chunk of work (~200 lines + worker bundling) and probably warrants a separate PR if pursued.

### Reference

- Export demo: `src/export-demo.tsx`
- Range export utility: `src/lib/rangeExport.ts`
- OpenDAW source repo paths (not this project):
  - SDK offline renderer: `packages/studio/core/src/OfflineEngineRenderer.ts`
  - SDK deprecated renderer: `packages/studio/core/src/AudioOfflineRenderer.ts`
  - Engine processor render method: `packages/studio/core-processors/src/EngineProcessor.ts`
  - Engine preferences schema: `packages/studio/adapters/src/engine/EnginePreferencesSchema.ts`
  - Metronome processor: `packages/studio/core-processors/src/Metronome.ts`
  - Offline engine worker: `packages/studio/core-workers/src/offline-engine-main.ts`
  - Worklet environment polyfill: `packages/studio/core-workers/src/worklet-env.ts`
