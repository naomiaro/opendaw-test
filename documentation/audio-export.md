# Audio Export in OpenDAW

Comprehensive guide to exporting audio from OpenDAW projects, including full mix exports and individual stems with effects.

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

// Render full mix
const audioBuffer = await AudioOfflineRenderer.start(
  project,
  undefined, // No stem config = full mix
  48000      // Sample rate
);

// Render stems
const audioBuffer = await AudioOfflineRenderer.start(
  project,
  stemsConfiguration,
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

WAV file encoding/decoding from `@opendaw/studio-core`:

```typescript
import { WavFile } from "@opendaw/studio-core";

// Convert AudioBuffer to WAV ArrayBuffer
const wavArrayBuffer = WavFile.encodeFloats(audioBuffer);

// Decode WAV to float arrays
const audio = WavFile.decodeFloats(arrayBuffer);
// Returns: { channels: Float32Array[], sampleRate: number, numFrames: number }
```

**Supported Format:**
- 32-bit IEEE float
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

const regionBox = AudioRegionBox.create(boxGraph, UUID.generate(), box => {
  box.regions.refer(trackBox.regions);
  box.file.refer(audioFileBox);
  box.timeBase.setValue(TimeBase.Seconds);  // ← Allow overlaps
  box.playback.setValue(AudioPlayback.NoSync);
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

const regionBox = AudioRegionBox.create(boxGraph, UUID.generate(), box => {
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
- **WAV Encoding:** `@opendaw/studio-core/WavFile.ts`
- **Mixdowns Service:** `@opendaw/studio/service/Mixdowns.ts`
- **Engine Integration:** `@opendaw/studio-core-processors/EngineProcessor.ts`

### Documentation

- [Effects Documentation](./effects-research/README.md)
- [Project Setup](./02-project-structure.md)
- [Box System](./04-box-system.md)

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
