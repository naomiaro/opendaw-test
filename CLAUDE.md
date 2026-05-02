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

// ALSO WRONG - ?. and ?? skip Option emptiness checks; data is the Option
// object itself (truthy), and `.numberOfFrames` silently returns undefined
const data = loader?.data ?? null;
const frames = data?.numberOfFrames; // undefined even when state is "loaded"

// CORRECT
const peaksOption = sampleLoader.peaks;
if (peaksOption.isEmpty()) { return; }
const peaks = peaksOption.unwrap();
```
API: `.isEmpty()`, `.nonEmpty()`, `.unwrap()`, `.unwrapOrNull()`, `.unwrapOrUndefined()`
**Rule:** if it's typed `Option<T>`, never use `?.` or `??` on it. Always `.isEmpty()` / `.unwrap()`.

### Tape vs Track Terminology
- **Track** = SDK timeline concept (`TrackBox`, `TrackBoxAdapter`, `audioUnit.tracks`,
  timeline lanes that hold regions). Use this term anywhere referring to box-graph structure.
- **Tape** = app-level recording input (a `Tape` instrument + `CaptureAudio` device that
  captures into a TrackBox). UI labels say "Tape N", code identifiers use `recordingTape`,
  `useRecordingTapes`, `RecordingTapeCard`. Use this term for anything user-arms-and-records-onto.
- The `disable-track` SDK preference value and "Multi-track loop recording" feature term are
  exceptions — they describe SDK behaviour and industry concept respectively.

### Box Graph API Names
- Delete box: `project.boxGraph.unstageBox(box)` — takes box object, NOT UUID
- Find box: `project.boxGraph.findBox(uuid)` — returns `Option<Box>`, NOT raw box
- AudioRegionBox gain: field is `gain` (dB, decibel constraint), NOT `volume`, NOT a 0-1 range
- Option API: `isEmpty()` / `nonEmpty()` — NOT `isSome()` / `isNone()`
- Disconnect pointer: `pointerField.defer()` — NOT `unrefer()` (doesn't exist)
- Copy region: `adapter.copyTo({ target: field })` — parameter is `target`, NOT `track`
- CompressorDeviceBox makeup gain: field is `makeup`, NOT `gain`

### Sample Manager Setup
- Class: `GlobalSampleLoaderManager` (NOT `DefaultSampleLoaderManager`)
- AudioBuffer → AudioData: use `AudioData.create(sampleRate, length, channels)` + manual
  channel copy. `OpenSampleAPI.fromAudioBuffer()` does not exist.
- Progress callback type: `Progress.Handler` (alias for `Procedure<unitValue>`)
- SampleLoaderState error field: `state.reason` (NOT `state.error`)
- SampleLoader has `subscribe()` only — NO `catchupAndSubscribe()`. Check `state.type`
  before subscribing, or use adapter layer + CanvasPainter to avoid subscribing entirely.

### Adapter Layer for Peaks (Preferred)
`regionAdapter.file.peaks` is a synchronous `Option<Peaks>` read — no subscribe needed.
Combined with CanvasPainter (repaints every frame), peaks render automatically when ready.
Use raw `sampleLoader.subscribe()` only when you need state change callbacks without a painter.

### RootBoxAdapter: Project Entry Point
`project.rootBoxAdapter` is the top-level adapter — use it to traverse the project:
- `.audioUnits` — `IndexedBoxAdapterCollection<AudioUnitBoxAdapter>` (all channels)
- `.audioBusses` — `BoxAdapterCollection<AudioBusBoxAdapter>` (aux/group buses)
- `.clips` — clip pool
- `.groove` — `GrooveBoxAdapter` (groove/shuffle quantization)
- `.timeline` — `TimelineBoxAdapter` (signature, tempo, markers)
- `.pianoMode` — piano mode state
- `.midiOutputDevices` — external MIDI output devices
- `.labeledAudioOutputs()` — named audio outputs

### AudioUnitBoxAdapter Full API
Beyond `.volume`, `.panning`, `.mute`, `.solo`, `.tracks`:
- `.input` — audio input routing
- `.output` — pointer to routing target (master, bus, etc.)
- `.midiEffects` — `IndexedBoxAdapterCollection` of MIDI effect adapters
- `.audioEffects` — `IndexedBoxAdapterCollection` of audio effect adapters
- `.auxSends` — `BoxAdapterCollection<AuxSendBoxAdapter>` (sends to buses)
- `.isBus`, `.isInstrument`, `.isOutput` — type checks
- `.label` — display name
- `.move(delta)` — reorder in mixer
- `.moveTrack(track, delta)` — reorder track lanes
- `.deleteTrack(track)` — remove a track
- `.labeledAudioOutputs()` — named outputs for this unit

### TrackBoxAdapter Full API
Beyond `.regions`:
- `.audioUnit` — parent `AudioUnitBoxAdapter`
- `.target` — automation target (parameter field pointer)
- `.clips` — `TrackClips` collection
- `.enabled` — track enabled state
- `.type` — `TrackType` (audio, note, value)
- `.listIndex` — position in track list
- `.accepts(region)` — check if track accepts a region type
- `.valueAt(ppqn)` — read automation value at position
- `.catchupAndSubscribePath()` — subscribe to automation path changes

### Adapter Collection APIs
Two collection types for typed child access:
```typescript
// BoxAdapterCollection<T> — unordered
collection.adapters()       // T[] snapshot
collection.size()
collection.isEmpty()
collection.catchupAndSubscribe({ onAdd, onRemove })
collection.subscribe({ onAdd, onRemove })

// IndexedBoxAdapterCollection<T> — ordered, supports reorder
collection.adapters()       // T[] sorted by index
collection.getAdapterByIndex(0)
collection.move(adapter, delta)
collection.catchupAndSubscribe({ onAdd, onRemove, onReorder })
```
Both return `Terminable` from subscribe methods — always clean up.

### AudioUnitTracks: .values() Not .adapters()
`audioUnitAdapter.tracks` is an `AudioUnitTracks` object, NOT an `IndexedBoxAdapterCollection`.
Use `.values()` for the track array, `.collection` for the underlying collection:
- `unit.tracks.values()` → `ReadonlyArray<TrackBoxAdapter>`
- `unit.tracks.collection.adapters()` → same data via the collection API
- `unit.tracks.adapters()` → **DOES NOT EXIST** — runtime error

### SortedSet.values() for Region Collections
`trackAdapter.regions.adapters` returns `SortedSet`, not `Array`. Call `.values()` before
`.filter()`/`.map()`. `isAudioRegion()` is a type guard on the base interface — no cast needed:
```typescript
// Typed narrowing — returns AudioRegionBoxAdapter[]
trackAdapter.regions.adapters.values().filter(r => r.isAudioRegion())
```
**Critical:** `flatMap` does NOT flatten `SortedSet` — it only flattens arrays. Writing
`.flatMap(track => track.regions.adapters)` produces `SortedSet[]`, not region adapters.
Always use `.flatMap(track => [...track.regions.adapters.values()])` or the `getAllRegions()`
utility from `src/lib/adapterUtils.ts`.

### Shared Adapter Utilities
`src/lib/adapterUtils.ts` provides `getAllRegions(project)` and `getAllAudioRegions(project)`
for full project traversal. Use these instead of inline `rootBoxAdapter.audioUnits.adapters()
.flatMap(u => u.tracks.values()).flatMap(t => t.regions.adapters.values())` chains.

### Master Bus Access (Adapter Layer)
Use `project.rootBoxAdapter.audioUnits.adapters().find(u => u.isOutput)?.box` instead of
`project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box`. The adapter approach
is typed and doesn't require `as AudioUnitBox` cast.

### Avoid boxGraph.boxes() for Region Discovery
Never scan `project.boxGraph.boxes()` with `instanceof` checks. Use adapter traversal
(`getAllRegions()`, `trackAdapter.regions.adapters.values()`) or reactive subscriptions
(`catchupAndSubscribe`). Only legitimate low-level usages: `sampleManager.getOrCreate()`
during bootstrap (before regions exist), Werkstatt dynamic parameters via `pointerHub`.

### Adapter .box Is Already Typed — No Casts Needed
`AudioRegionBoxAdapter.box` returns `AudioRegionBox` (not generic `Box`), and
`AudioUnitBoxAdapter.box` returns `AudioUnitBox`. After `isAudioRegion()` narrows the
union type, `.box` is fully typed — never write `adapter.box as AudioRegionBox`.
Adapters also provide typed setters: use `adapter.position = value` instead of
`adapter.box.position.setValue(value)` where available.

### Never Call editing.modify() Inside editing.subscribe()
`editing.subscribe()` fires after every `editing.modify()`. Calling `editing.modify()` inside
the callback causes infinite recursion. If you need to trigger a side-effect modification
(e.g., rebuilding splice regions after comp state changes), use a separate `useEffect` that
reacts to the derived state, and guard with a ref (`isRebuildingRef`) to skip re-derivation
when the side-effect triggers the subscribe callback.

### Region Type Guards: isAudioRegion, isValueRegion, isNoteRegion
All three are type guards on the base `RegionBoxAdapter` interface:
`isAudioRegion(): this is AudioRegionBoxAdapter`,
`isValueRegion(): this is ValueRegionBoxAdapter`,
`isNoteRegion(): this is NoteRegionBoxAdapter`.
Use the positive guard (e.g., `r.isValueRegion()`) instead of negation
(`!r.isAudioRegion() as ValueRegionBoxAdapter[]`) — avoids casts entirely.

### Storing Custom Metadata in Box Labels
The box graph has no generic metadata/annotation system, but every box has a `label`
string field that participates in transactions and undo/redo. Use a prefixed JSON string
to piggyback structured data: `box.label.setValue("comp:" + JSON.stringify(state))`.
Read back with `label.startsWith("comp:") ? JSON.parse(label.slice(5)) : null`.
See `compLaneUtils.ts` `encodeCompStateToLabel()` for a working example.

### Region Visitor Pattern (Type-Safe Discrimination)
Prefer visitor over casting for region type handling:
```typescript
region.accept({
  visitAudioRegionBoxAdapter: (adapter) => { /* AudioRegionBoxAdapter */ },
  visitNoteRegionBoxAdapter: (adapter) => { /* NoteRegionBoxAdapter */ },
  visitValueRegionBoxAdapter: (adapter) => { /* ValueRegionBoxAdapter */ },
});
```
Also available: `UnionAdapterTypes.isRegion(adapter)`, `.isLoopableRegion(adapter)`.

### Device Type Discriminators
Type-safe checks for device adapters (import from `@opendaw/studio-adapters`):
- `Devices.isAudioEffect(adapter)` — narrows to `AudioEffectDeviceAdapter`
- `Devices.isMidiEffect(adapter)` — narrows to `MidiEffectDeviceAdapter`
- `Devices.isInstrument(adapter)` — narrows to `InstrumentDeviceBoxAdapter`
- `Devices.isHost(adapter)` — narrows to `DeviceHost`
Use these instead of `instanceof` checks for union device types.

### VaryingTempoMap Methods
`project.tempoMap` (or via `BoxAdaptersContext`) for tempo-aware time conversion:
- `getTempoAt(ppqn)` — BPM at position
- `ppqnToSeconds(ppqn)` — absolute PPQN → seconds
- `secondsToPPQN(seconds)` — seconds → absolute PPQN
- `intervalToSeconds(from, to)` — PPQN range → duration in seconds
- `intervalToPPQN(from, to)` — seconds range → PPQN duration
- `subscribe()` — react to tempo automation changes
Essential for tempo-aware waveform rendering and position display.

### FadingAdapter API
`AudioRegionBoxAdapter.fading` provides the full fade envelope:
- `.in` / `.out` — current fade values (PPQN)
- `.inSlope` / `.outSlope` — curve shape (0.25=log, 0.5=linear, 0.75=exp)
- `.inField` / `.outField` / `.inSlopeField` / `.outSlopeField` — settable fields
- `.hasFading` — boolean, true if any fade is non-zero
- `.copyTo(targetAdapter)` — copy fade settings to another region
- `.reset()` — clear all fades to zero

### BoxAdaptersContext (Dependency Injection)
All adapters receive a `BoxAdaptersContext` that provides access to shared infrastructure:
- `boxGraph` — the document's box graph
- `boxAdapters` — central adapter factory/registry (`BoxAdapters`)
- `sampleManager` — `SampleLoaderManager` for audio loading
- `soundfontManager` — `SoundfontLoaderManager` for soundfont loading
- `rootBoxAdapter` — project root adapter
- `timelineBoxAdapter` — timeline adapter
- `parameterFieldAdapters` — `ParameterFieldAdapters` for automation touch recording
- `tempoMap` — `TempoMap` for tempo-aware conversions
- `clipSequencing` — clip sequencing logic
- `isMainThread` / `isAudioContext` — threading context checks

Access adapters via `project.boxAdapters.adapterFor(box, TypeAdapter)` or
`project.boxAdapters.optAdapter(box)` (returns `Option<BoxAdapter>`).
Adapters are lazily created and cached by box UUID.

### GrooveBoxAdapter (Swing/Shuffle)
`project.rootBoxAdapter.groove` wraps a `GrooveShuffleBoxAdapter` for swing quantization:
```typescript
const groove = project.rootBoxAdapter.groove; // GrooveBoxAdapter

// GrooveShuffleBoxAdapter provides:
groove.namedParameter.duration  // musical duration selection (1/8, 1/4, etc.)
groove.namedParameter.amount    // shuffle amount (0-1, unitValue)

// Timing warp/unwarp for swing
groove.warp(ppqn)    // apply groove timing
groove.unwarp(ppqn)  // reverse groove timing
```
Static data: `GrooveShuffleBoxAdapter.Durations` (ratio pairs),
`.DurationPPQNs` (PPQN values), `.DurationStrings` (labels like "1/8", "1/4").
Uses Möbius-Ease easing for smooth swing transitions between on/off-beat timing.

### MarkerTrackAdapter (Cue Points)
`project.timelineBoxAdapter.markerTrack` manages cue point markers:
- `.enabled` — marker track visibility
- `.events` — `EventCollection` of `MarkerBoxAdapter`
Each `MarkerBoxAdapter` has `.position` (PPQN) and `.label` (string).
Subscribe via `.subscribe()` for marker changes. Use for navigation points,
arrangement sections, or loop boundaries.

### Import Locations
- `AnimationFrame` → `@opendaw/lib-dom` (NOT `@opendaw/lib-fusion`)
- `PeaksPainter` → `@opendaw/lib-fusion`
- `SampleMetaData` → `@opendaw/studio-adapters`
- `AudioData` → `@opendaw/lib-dsp`

### SignatureTrack Bar Layout
`signatureTrack.iterateAll()` yields `{ index, accumulatedPpqn, accumulatedBars, nominator, denominator }`
per section. Expand sections into bars instead of manual PPQN accumulation — see
`computeBarsFromSDK()` in `src/lib/barLayout.ts` (used by time-signature and drum-scheduling demos).

### Prefer catchupAndSubscribe Over subscribe
`subscribe()` fires only for FUTURE changes — misses current state. Use `catchupAndSubscribe()`
for engine state (isPlaying, isRecording, BPM) and box field observations. Only use `subscribe()`
when initial state is already known (e.g., mute sync after take creation).
Exception: `SampleLoader` only has `subscribe()` — check `state.type` before subscribing.

### DefaultDecibel Value Mapping
`ValueMapping.DefaultDecibel` = `decibel(-72.0, -12.0, 0.0)` — range -72 to 0 dB,
midpoint -12 dB. Used by Reverb wet/dry, Dattorro wet/dry, and other effect dB fields.
AudioUnit volume uses a different mapping: `decibel(-96, -9, +6)`.

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

### monitoringMode Is Not a Box Graph Field
`capture.monitoringMode` is a plain getter/setter on `CaptureAudio`, not a box graph field.
It manipulates Web Audio nodes directly. Do NOT set it inside `editing.modify()`.
Type: `MonitoringMode = "off" | "direct" | "effects"`.

### UUID.Bytes Is Not a String
`audioUnitBox.address.uuid` is `UUID.Bytes`, not `string`. Use `UUID.toString(uuid)` for
React keys, Map keys, or any string context. Import: `import { UUID } from "@opendaw/lib-std"`.

### Safari Audio Format Compatibility
Safari can't decode Ogg Opus via `decodeAudioData` (even though `canPlayType` returns
`"maybe"`). Provide m4a (AAC) fallback. Detect Safari via UA string, not feature detection.
See `src/lib/audioUtils.ts` `getAudioExtension()`.

### PPQN Values Must Be Integer
`position` on AudioRegionBox is Int32. `duration`, `loopDuration`, `loopOffset` are Float32
with `unit: "mixed"` (PPQN in Musical timeBase, seconds in Seconds timeBase).
`PPQN.secondsToPulses()` returns float — always wrap with `Math.round()` before passing
to Int32 fields like `position`, or to `RegionEditing.cut()` / `createTrackRegion()`.

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
- After **any** `package.json` change (SDK upgrade, devDep add/remove, version bump), **regenerate
  the lockfile cleanly**: `rm -rf node_modules package-lock.json && npm install`, then verify with
  `npm ci` (not just `npm run build`) before pushing. In-place `npm install`/`uninstall` can leave
  stale transitive entries that local `npm@11+` tolerates but Cloudflare's older `npm ci` rejects
  with "package.json and package-lock.json … are in sync". This has bitten the project on both an
  SDK upgrade (PR #25) and a devDep churn (PR #26) — same failure mode, same fix.
- SDK upgrades specifically: bump `@opendaw/studio-sdk` only — sub-packages resolve transitively
  from the registry. NEVER install sub-packages as local `file:` references (breaks Cloudflare CI).
- After an SDK upgrade, audit `documentation/*.md` chapter docs for stale API signatures: grep
  each renamed/changed identifier from the changelog and update method signatures, return
  types, and code examples. Chapter docs describe current contracts — leaving stale
  signatures is worse than no doc at all.
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
- SDK investigations & open questions: `debug/` (see `debug/README.md` for convention)
- Unlisted debug demo pages: HTML at repo root with `<meta name="robots" content="noindex">`,
  not added to `src/index.tsx` or `public/sitemap.xml`. See `comp-lanes-debug-demo.tsx` as reference.
- OpenDAW source code locations: see `.claude/local.md`
