# OpenDAW SDK Changelog: 0.0.128 → 0.0.129

## Breaking Changes for SDK Consumers

1. **`WavFile` moved from `studio-core` to `lib-dsp`**: Import path changed — `import { WavFile } from "@opendaw/studio-core"` → `import { WavFile } from "@opendaw/lib-dsp"`
2. **`EffectFactory` interface now requires `external: boolean`**: New required field on `EffectFactory`. Built-in effects use `false`; `NeuralAmp` uses `true`.
3. **`DeviceFactory` interface now requires `briefDescription: string`**: Both `EffectFactory` and `DeviceFactory` now require this field.
4. **`EffectFactories.Reverb` renamed**: `defaultName` changed from `"Cheap Reverb"` to `"Free Reverb"`.
5. **`EffectFactories.NeuralAmp` renamed to Tone3000**: `defaultName` → `"Tone3000"`, `defaultIcon` → `IconSymbol.Tone3000`.
6. **`EffectFactories.AudioNamed` reordered alphabetically**: Order of effects changed; `NeuralAmp` is now always included (the `includeNeuralAmp` flag was removed).
7. **`InstrumentFactories.Named` reordered alphabetically**: Changed from `{Vaporisateur, Playfield, Nano, Tape, Soundfont, MIDIOutput}` to `{Apparat, MIDIOutput, Nano, Playfield, Soundfont, Tape, Vaporisateur}`.
8. **`YService.getOrCreateRoom()` return type changed**: Now returns `Promise<{ project: Project, provider: WebsocketProvider }>` instead of `Promise<Project>`.
9. **`Editing` interface gains `append()` method**: `Editing.append<R>(modifier: SyncProvider<Maybe<R>>): Option<R>` — new method added.

## New Features — Scriptable Devices

Three new scriptable device types, powered by a new `ScriptCompiler` infrastructure:

### Apparat (Scriptable Instrument)
- `InstrumentFactories.Apparat` — accepts MIDI, runs user-written JavaScript DSP code
- Box type: `ApparatDeviceBox`
- Adapter: `ApparatDeviceBoxAdapter`
- Added to `InstrumentBox` union type

### Werkstatt (Scriptable Audio Effect)
- `EffectFactories.Werkstatt` — runs user-written audio DSP code
- Box type: `WerkstattDeviceBox`
- Adapter: `WerkstattDeviceBoxAdapter`
- Added to `EffectBox` union type

### Spielwerk (Scriptable MIDI Effect)
- `EffectFactories.Spielwerk` — processes MIDI events via user scripts
- Box type: `SpielwerkDeviceBox`
- Adapter: `SpielwerkDeviceBoxAdapter`
- Added to `EffectBox` union type

All three use `// @param` and `// @sample` comment declarations in code for parameters/samples.

### ScriptCompiler API (studio-adapters)
```typescript
// Create a script compiler
ScriptCompiler.create(config) // returns { stripHeader, load, compile }

// Parse declarations from script code
ScriptParamDeclaration.parseParams(code)
ScriptParamDeclaration.parseSamples(code)
ScriptParamDeclaration.parseDeclarationOrder(code)

// Resolve mappings
ScriptParamDeclaration.resolveValueMapping()
ScriptParamDeclaration.resolveStringMapping()

// Reactive parameter binding
ScriptParamDeclaration.subscribeScriptParams()
```

## New APIs

### Automation Recording Support
- `AutomatableParameterFieldAdapter` new methods: `registerTracks()`, `touchStart()`, `touchEnd()`, `updateMappings()`
- `ParameterFieldAdapters` automation recording:
  - New type: `AutomationMode = "read" | "touch" | "latch"`
  - `registerTracks(address, tracks)`, `getTracks(address)`, `setMode(address, mode)`, `getMode(address)`
  - `touchStart(address)`, `touchEnd(address)`, `isTouched(address)`, `subscribeTouchEnd(observer)`

### Engine Device Messaging
- `Engine.subscribeDeviceMessage(uuid, listener)` — subscribe to messages from audio worklet devices (e.g., console output from scriptable devices)
- `EngineToClient` protocol gains `deviceMessage()` method
- `OfflineEngineProtocol` gains `addModule()` for loading script device code into offline renderer

### Other New APIs
- `AudioUnitTracks.audioUnitBox` getter — public accessor to get the underlying `AudioUnitBox`
- `Clipboard` namespace (`lib-dom`) — `Clipboard.writeText()`, `Clipboard.readText()` with error notifications
- `Browser.isMobile()` (`lib-dom`) — detect mobile devices
- `Shortcut.resolveCode(event)` (`lib-dom`) — layout-independent keyboard code resolution
- New `IconSymbol` values: `ChatEmpty`, `ChatMessage`, `Copy`, `Code`, `Paste`, `Tone3000`
- `TimeGrid.Options` gains `snapInterval?: ppqn` for fixed snap intervals
- `WavFile` now supports 24-bit PCM WAV decoding (in addition to 16-bit PCM and 32-bit float)

## Bug Fixes

1. **Recording: zero-duration region cleanup** — Short recordings (only count-in) could leave zero-duration regions. Now deletes them with safety checks for `isAttached()` and `pointerHub.isEmpty()`.
2. **Recording: nested `editing.modify()` in `onSaved`** — Removed problematic nested transactions. Now snapshots incoming pointers before mutation.
3. **MIDI recording: region duration regression** — Region duration now uses `Math.max()` to prevent shrinking during loop recording.
4. **Automation recording: complete rewrite** — Now uses touch-based recording model instead of always-on. Only records when a parameter is "touched".
5. **Migration: orphan regions/clips** — `MigrateAudioRegionBox` and `MigrateAudioClipBox` now check for missing `AudioFileBox` and delete orphaned regions instead of crashing.
6. **`VertexSelection.deleteSelected()` crash fix** — Safe handling when selectable was already removed.
7. **Dragging: ChromeOS multi-touch fix** — Added `cancelActive` mechanism for stale drags. Fixed `isPrimary` issue with simultaneous touchpoints.
8. **File save: NotAllowed fallback** — Falls back to blob download when `showSaveFilePicker` throws in cross-origin iframes.
9. **Browser.id(): localStorage guard** — Prevents crashes in environments without localStorage.
10. **MidiDevices: null check on requestMIDIAccess** — Added null check with clear panic message.
11. **Software keyboard: layout-independent key matching** — Consolidated through `Shortcut.resolveCode()`.
12. **Clipboard: skip events in text inputs** — Native text field copy/paste no longer intercepted.

## Other Changes

- `Colors.bright` lightness changed from `95` to `90`
- Offline renderer now supports scriptable devices and passes `maxDurationSeconds` to prevent infinite render
- `Project.startAudioWorklet()` auto-loads scriptable device code
- `Recovery` uses `Project.loadAnyVersion()` for more robust recovery
- `TrackBoxAdapter` resolves owner device box labels for scriptable devices
- Recording debug logging added for start, createTakeRegion, finalizeTake, abort, and stop events

## Impact Assessment for opendaw-test

### Action Required

1. **WavFile import** (`src/lib/audioExport.ts`): Change `import { WavFile } from "@opendaw/studio-core"` → `import { WavFile } from "@opendaw/lib-dsp"`. Remove `WavFile` from the studio-core import line.
2. **Clear Vite dep cache**: `rm -rf node_modules/.vite` after upgrading.

### Verify After Upgrade

- `EffectFactories.Reverb` — still exported with same API, just renamed display name to "Free Reverb". No code change needed (we reference `EffectFactories.Reverb` not the display name).
- `EffectFactory` interface — we import the type in `useDynamicEffect.ts` but don't implement custom factories. No change needed.
- `InstrumentFactories.Named` reorder — we don't iterate `Named`. No change needed.

### No Action Needed

- Scriptable devices (Apparat, Werkstatt, Spielwerk) — new features, not used in current demos
- Automation recording support — new API, not used
- Engine device messaging — new API, not used
- YService changes — not used in headless demos
- All bug fixes — automatic improvements
- Clipboard/Browser.isMobile — new APIs, not used
