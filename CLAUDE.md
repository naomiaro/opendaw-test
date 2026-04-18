# OpenDAW Headless Development Guide

## Project Overview
This project demonstrates headless usage of the OpenDAW SDK for browser-based audio recording and playback.

## Key OpenDAW APIs

### Reactive Box Graph Subscriptions (pointerHub)
```typescript
// Prefer pointerHub subscriptions over AnimationFrame polling for structural changes.
// Use AnimationFrame ONLY for continuous rendering (e.g., waveform peaks at 60fps).

// Reactive subscription chain: audioUnit → tracks → regions → field changes
const subs: Terminable[] = [];
const trackSub = audioUnitBox.tracks.pointerHub.catchupAndSubscribe({
  onAdded: (pointer) => {
    const trackBox = pointer.box;
    const regionSub = (trackBox as any).regions.pointerHub.catchupAndSubscribe({
      onAdded: (regionPointer: any) => {
        const regionBox = regionPointer.box as AudioRegionBox;
        // Subscribe to scalar field changes (e.g., mute)
        const muteSub = regionBox.mute.subscribe((obs: any) => {
          const isMuted = obs.getValue();
        });
        subs.push(muteSub);
      },
      onRemoved: () => {},
    });
    subs.push(regionSub);
  },
  onRemoved: () => {},
});
subs.push(trackSub);
// Cleanup: terminate all subs (outer first to prevent cascading callbacks)
```

**Key rules:**
- `catchupAndSubscribe` fires immediately for existing data + future changes (preferred)
- `subscribe` fires only for future changes (use when initial state already known)
- `pointerHub.incoming()` is a snapshot read, NOT reactive
- Pointer callbacks receive `PointerField` — access box via `pointer.box`
- Terminate pointer hub subs BEFORE engine cleanup when stopping recording
- After recording stops, reactive subscriptions are terminated — update React state directly for user-initiated changes (e.g., mute toggle)

### SoundfontService (Disabled via Proxy Guard)
- `SoundfontService` constructor auto-fetches `api.opendaw.studio/soundfonts/list.json` (CORS error in dev)
- SDK declares `soundfontService` in `ProjectEnv` but never reads it (verified in 0.0.129)
- We pass a Proxy that throws a clear error if a future SDK version accesses it
- None of the demos use soundfont instruments (MIDI demo uses Vaporisateur built-in synth)

### SampleService (SDK 0.0.124+)
- `new SampleService(audioContext)` required in `ProjectEnv` for recording finalization
- `CaptureAudio.prepareRecording()` injects it into `RecordingWorklet` automatically

### Engine State Observables
```typescript
// Subscribe to engine state changes
project.engine.isRecording.catchupAndSubscribe(obs => {
  const recording = obs.getValue();
});

project.engine.isPlaying.catchupAndSubscribe(obs => {
  const playing = obs.getValue();
});

project.engine.isCountingIn.catchupAndSubscribe(obs => {
  const countingIn = obs.getValue();
});

project.engine.countInBeatsRemaining.catchupAndSubscribe(obs => {
  const beats = Math.ceil(obs.getValue());
});
```

### Engine Preferences (SDK 0.0.87+)
```typescript
// Access via project.engine.preferences.settings
const settings = project.engine.preferences.settings;

// Metronome
settings.metronome.enabled = true;
settings.metronome.gain = -6; // dB
settings.metronome.beatSubDivision = 1; // 1=quarter, 2=eighth, 4=16th, 8=32nd

// Recording
settings.recording.countInBars = 1; // 1-8 bars
```

### AudioContext Suspension
Browser autoplay policy means `AudioContext` starts suspended until a user gesture.
`initializeOpenDAW()` registers click/keydown listeners to auto-resume it (one-shot).
iOS Safari can re-suspend after backgrounding/locking. Before calling `play()`:
```typescript
if (audioContext.state !== "running") {
  await audioContext.resume();
  // iOS Safari may not be "running" yet — wait for statechange event
}
```

### Engine Worklet Has 2 Outputs (SDK 0.0.133+)
The engine worklet outputs main audio on output 0 and monitoring on output 1.
Always use `engineWorklet.connect(destination, 0)` — bare `.connect(destination)`
routes both outputs, causing unexpected channels in offline renders.

### Output Device Enumeration
`AudioDevices` only handles inputs. For output devices:
```typescript
const allDevices = await navigator.mediaDevices.enumerateDevices();
const outputs = allDevices.filter(d => d.kind === "audiooutput" && d.deviceId !== "");
```
`setSinkId` is Chrome/Edge only — gate with `"setSinkId" in AudioContext.prototype`.

## Important Patterns

### Option Types Are Always Truthy
OpenDAW uses Option types that are **always truthy** (even `Option.None`):
```typescript
// WRONG - Option.None is truthy, this never triggers
if (!sampleLoader.peaks) { ... }

// CORRECT
const peaksOption = sampleLoader.peaks;
if (peaksOption.isEmpty()) { return; }
const peaks = peaksOption.unwrap();
```
API: `.isEmpty()`, `.nonEmpty()`, `.unwrap()`, `.unwrapOrNull()`, `.unwrapOrUndefined()`

### Always Use editing.modify() for State Changes
```typescript
project.editing.modify(() => {
  // All box graph modifications go here
  project.timelineBox.bpm.setValue(120);
});
```

### Pointer Re-Routing: Separate Transaction from Creation
`createInstrument()` internally routes `audioUnitBox.output` to master. Re-routing with
`output.refer(newTarget)` in the same `editing.modify()` may not disconnect the old
connection, causing dual routing. Always re-route in a separate transaction. Similarly,
`targetVertex` traversal on pointers created in the same transaction may return stale data.
This also applies to `captureDevices.get(uuid)` — resolve captures and set their fields
(deviceId, requestChannels) in a **separate** transaction after `createInstrument` commits.

### createInstrument Must Be Destructured Inside editing.modify()
`project.api.createInstrument()` returns `{ audioUnitBox, trackBox }` directly — no `.unwrap()`.
But `editing.modify()` does NOT forward return values, so capture via outer variable:
```typescript
let audioUnitBox: any = null;
project.editing.modify(() => {
  const result = project.api.createInstrument(InstrumentFactories.Tape);
  audioUnitBox = result.audioUnitBox;
});
// audioUnitBox is now available outside the transaction
```

### monitoringMode Not in Type Declarations
`capture.monitoringMode` exists at runtime but isn't in `.d.ts` files.
Use `(capture as any).monitoringMode = "direct"` when TypeScript complains.

### UUID.Bytes Is Not a String
`audioUnitBox.address.uuid` is `UUID.Bytes`, not `string`. Use `UUID.toString(uuid)` for
React keys, Map keys, or any string context. Import: `import { UUID } from "@opendaw/lib-std"`.

### Safari Audio Format Compatibility
Safari can't decode Ogg Opus via `decodeAudioData` (even though `canPlayType` returns
`"maybe"`). Provide m4a (AAC) fallback. Detect Safari via UA string, not feature detection.
See `src/lib/audioUtils.ts` `getAudioExtension()`.

### PPQN Values Must Be Integer
`position`, `loopOffset`, `loopDuration`, `duration` on AudioRegionBox are Int32 fields.
`PPQN.secondsToPulses()` returns float — always wrap with `Math.round()` before passing
to `setValue()`, `RegionEditing.cut()`, or `createTrackRegion()`. Float values cause
truncation misalignment between region boundaries.

### Loading User-Dropped Audio Files
`loadTracksFromFiles` uses `fetch()` internally via `loadAudioFile()`. For drag-and-drop
files, create a blob URL: `const url = URL.createObjectURL(file)`, pass to
`loadTracksFromFiles`, then `URL.revokeObjectURL(url)` after loading completes.

## React Integration Tips

### Using AnimationFrame from OpenDAW
```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

const terminable = AnimationFrame.add(() => {
  // Called every frame
});

// Cleanup
terminable.terminate();
```

### Always Terminate Observable Subscriptions
`catchupAndSubscribe()` and `subscribe()` return `Terminable` objects. Store them and call
`.terminate()` in the React `useEffect` cleanup. Discarding the return value leaks the
subscription — callbacks continue firing after unmount.
For one-shot subscriptions (e.g., waiting for `sampleLoader` "loaded"), terminate
inside the callback on success AND on error — don't rely solely on effect cleanup:
```typescript
const sub = sampleLoader.subscribe((state: any) => {
  if (state.type === "loaded") {
    // ... handle data
    sub.terminate(); // terminate immediately, don't wait for unmount
  }
});
```

### CanvasPainter in React: Use Refs to Avoid Per-Frame Recreation
`CanvasPainter` creates a `ResizeObserver` + `AnimationFrame` subscription — expensive to
teardown/recreate. If a `useEffect` depends on an object prop (e.g., `region`) that gets
recreated each frame, the painter is destroyed and rebuilt every frame (150ms+ per frame → crash).
**Fix:** Store frequently-changing props in refs, read them inside the painter's render callback,
and limit `useEffect` deps to stable values like `height` or `sampleRate`. For live data
(e.g., recording duration), read directly from the box graph: `regionBox.duration.getValue()`.

### AnimationFrame Scanning: Use Structural Fingerprints
When scanning box graph state every frame (e.g., `scanAndGroupTakes`), avoid calling
`setState()` unless structure actually changed. Build a fingerprint string from stable
identifiers (take numbers, mute states, track IDs) and compare to previous. Duration
growth doesn't need re-renders when painters read live values from the box graph via refs.
Also limit AnimationFrame scanning to active recording — idle scanning is redundant when
direct calls handle mute toggles, finalization, and clear.

## Build & Verification
- `npm run build` runs Vite then VitePress — demos go to `dist/`, docs go to `dist/docs/` for `/docs/` on Cloudflare Pages
- `npm run docs:dev` — local VitePress dev server for documentation
- COOP/COEP headers in `public/_headers` exclude `/docs/*` — VitePress assets break under `require-corp`
- Vite handles TypeScript transpilation (no standalone `tsc` available)
- After SDK upgrades, clear Vite dep cache: `rm -rf node_modules/.vite` (dev server pre-bundles old SDK)
- SDK upgrades: bump `@opendaw/studio-sdk` version in `package.json` and `npm install` — sub-packages
  resolve transitively from the registry. NEVER install sub-packages as local `file:` references
  (breaks Cloudflare CI).
- Verify SDK exports: check `node_modules/@opendaw/<package>/dist/*.d.ts` before writing imports
- SDK version lives in `node_modules/@opendaw/studio-sdk/package.json`, NOT in individual sub-packages (studio-core, studio-boxes, etc.) which have their own independent version numbers

### Adding a New Demo
1. Create `<name>-demo.html` at project root (copy existing HTML entry point, update meta tags and script src to point at `src/demos/<category>/`)
2. Create `src/demos/<category>/<name>-demo.tsx` (use Radix UI Theme, GitHubCorner, BackLink, MoisesLogo; import shared code via `@/` alias)
3. Add build entry in `vite.config.ts` → `rollupOptions.input`
4. Add card in `src/index.tsx`
5. Add URL to `public/sitemap.xml`
6. Take 1200x630 screenshot, save as `public/og-image-<name>.png`, add `og:image` + `twitter:image` tags to the HTML
7. Add GoatCounter script before `</body>` (copy from any existing demo HTML)

## Demo-Specific SDK Knowledge

Each demo category folder has its own CLAUDE.md with SDK knowledge scoped to those demos:

- `src/demos/recording/CLAUDE.md` — recording API, capture devices, takes, peaks, buffer layout
- `src/demos/midi/CLAUDE.md` — MIDI devices, CaptureMidi, synth instruments
- `src/demos/playback/CLAUDE.md` — playback, timeline, fades, waveforms, mixer groups, Dark Ride
- `src/demos/automation/CLAUDE.md` — time signatures, tempo, track automation, curves, effects params
- `src/demos/effects/CLAUDE.md` — EffectBox, scriptable devices, ScriptCompiler, Werkstatt
- `src/demos/export/CLAUDE.md` — offline rendering, mutate-copy-restore pattern

## Reference Files
- Project setup: `src/lib/projectSetup.ts`
- Track loading: `src/lib/trackLoading.ts` (handles queryLoadingComplete automatically)
- Audio utilities: `src/lib/audioUtils.ts` (format detection, file loading)
- Engine preferences hook: `src/hooks/useEnginePreference.ts`
- Canvas painter: `src/lib/CanvasPainter.ts`
- Types: `src/lib/types.ts`
- Recording demos: `src/demos/recording/`
- MIDI demo: `src/demos/midi/`
- Playback demos: `src/demos/playback/`
- Automation demos: `src/demos/automation/`
- Effects demos: `src/demos/effects/`
- Export demo: `src/demos/export/`
- Effects docs: `documentation/11-effects.md`
- Box system & reactivity: `documentation/04-box-system-and-reactivity.md`
- Editing, fades & automation: `documentation/09-editing-fades-and-automation.md`
- Export & offline rendering: `documentation/10-export.md`
- SDK changelogs: `changelogs/`
- OpenDAW source code locations: see `.claude/local.md`
