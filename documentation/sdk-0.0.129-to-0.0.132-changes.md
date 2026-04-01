# OpenDAW SDK Changelog: 0.0.129 → 0.0.132

## Breaking Changes for SDK Consumers

1. **`ScriptParamDeclaration` renamed to `ScriptDeclaration`**: Import path changed — `import { ScriptParamDeclaration } from "@opendaw/studio-adapters"` → `import { ScriptDeclaration } from "@opendaw/studio-adapters"`. All parse methods (`parseParams`, `parseSamples`, `parseDeclarationOrder`, `resolveValueMapping`, `resolveStringMapping`) are now under `ScriptDeclaration`.

2. **`ScriptCompiler.DeviceBox` renamed to `ScriptCompiler.ScriptDeviceBox`**: The interface for device boxes passed to `ScriptCompiler.compile()` has been renamed. A new base `DeviceBox` interface was introduced in `packages/studio/adapters/src/DeviceBox.ts` that `ScriptDeviceBox` extends.

3. **Output Compressor → Output Maximizer**: `ProjectSkeleton`'s `createOutputCompressor` option renamed to `createOutputMaximizer`. The default output device is now a `MaximizerDeviceBox` (label: "Master Maximizer") instead of `CompressorDeviceBox`. Initialization sets `lookahead = false` instead of `threshold=0, ratio=24`. The corresponding `StudioSettings` key changed from `engine["auto-create-output-compressor"]` to `engine["auto-create-output-maximizer"]`.

## New Features

### Script Label Directive (`@label`)
New `// @label <name>` directive for scriptable devices (Apparat, Werkstatt, Spielwerk). When a script is compiled via `ScriptCompiler.compile()`, the label is automatically set on the device box.
```javascript
// @label My Custom Filter
// @param cutoff 1000 20 20000 exp Hz

class Processor { ... }
```
Parse with: `ScriptDeclaration.parseLabel(code): Option<string>`

### Script Parameter Groups (`@group`)
New `// @group <name> [color]` directive for organizing parameters into visual groups on the device panel.
```javascript
// @group Envelope blue
// @param attack 10 1 1000 exp ms
// @param release 100 10 2000 exp ms

// @group Filter
// @param cutoff 1000 20 20000 exp Hz
```
New types: `GroupDeclaration`, `DeclarationSection`, `DeclarationItem`
Parse with: `ScriptDeclaration.parseGroups(code): ReadonlyArray<DeclarationSection>`

### AutomatableParameterFieldAdapter Reset Value
`AutomatableParameterFieldAdapter` now accepts an optional `resetValue` parameter. When `reset()` is called, it uses this custom value instead of the field's `initValue`. Also available via `ParameterAdapterSet.createParameter()`.

### NoteStreamReceiver Dynamic Binding
`NoteStreamReceiver` constructor now takes an optional `address` parameter (was required). New `bind(receiver, address): Terminable` method enables reusing the same receiver with different data sources.

## Bug Fixes

1. **Recording warning dialog confirmation**: `CaptureAudio` now properly awaits `RuntimeNotifier.approve()` before proceeding with latency detection, ensuring the user sees and confirms the recording warning.

2. **UUID error messages enhanced**: `UUID.parse()` now includes the invalid string in error messages: `Invalid UUID format (${string})`, improving debugging.

3. **Clipboard paste pointer validation**: `DevicesClipboardHandler` and `AudioUnitsClipboardHandler` now check for empty addresses before creating pointer mappings, preventing invalid device routing during paste operations.

4. **Clipboard dependency collection**: Mandatory dependencies are now collected before owned children during device copy, preventing missing dependencies when devices have inter-device routing.

5. **Promise finalization cleanup**: `Project` now uses `.finally()` on delete-sample promises to ensure cleanup completes regardless of success/failure.

## Internal Changes

### P2P Networking
- New `TrafficMeter` class tracks upload/download bandwidth over a 5-second sliding window
- `P2PSession` exposes `trafficMeter` getter
- `AssetServer` and `PeerAssetProvider` record traffic automatically
- `PeerAssetProvider` now queues transfers per peer (one at a time) instead of allowing concurrent transfers

### YSync Path Normalization
- New `#computePathPrefix()` and `#normalizePath()` methods handle nested Y.Doc paths
- Origin detection distinguishes own updates (`[openDAW]` prefix) from external updates

### UI Colors
- `panelBackground`: HSL(197, 14, 10) → HSL(197, 14, 9)
- `panelBackgroundDark`: HSL(197, 14, 9) → HSL(197, 14, 8)

### Schema
- `NeuralAmpModelBox` gains `pack-id` field (field 3, string) for tracking model pack membership

## Migration Guide

### ScriptParamDeclaration → ScriptDeclaration
```typescript
// Before (0.0.129)
import { ScriptParamDeclaration } from "@opendaw/studio-adapters";
ScriptParamDeclaration.parseParams(code);
ScriptParamDeclaration.parseSamples(code);

// After (0.0.132)
import { ScriptDeclaration } from "@opendaw/studio-adapters";
ScriptDeclaration.parseParams(code);
ScriptDeclaration.parseSamples(code);
```

### ScriptCompiler.DeviceBox → ScriptCompiler.ScriptDeviceBox
```typescript
// Before (0.0.129)
const box: ScriptCompiler.DeviceBox = werkstattBox;

// After (0.0.132)
const box: ScriptCompiler.ScriptDeviceBox = werkstattBox;
```

### Output Compressor → Maximizer
```typescript
// Before (0.0.129)
const skeleton = ProjectSkeleton.create({ createOutputCompressor: true });

// After (0.0.132)
const skeleton = ProjectSkeleton.create({ createOutputMaximizer: true });
```

## Source Code References

- ScriptDeclaration: `packages/studio/adapters/src/ScriptDeclaration.ts`
- ScriptCompiler: `packages/studio/adapters/src/ScriptCompiler.ts`
- DeviceBox interface: `packages/studio/adapters/src/DeviceBox.ts`
- ProjectSkeleton: `packages/studio/adapters/src/project/ProjectSkeleton.ts`
- TrafficMeter: `packages/studio/p2p/src/TrafficMeter.ts`
- CaptureAudio: `packages/studio/core/src/capture/CaptureAudio.ts`
- UUID: `packages/lib/std/src/uuid.ts`
- Colors: `packages/studio/enums/src/Colors.ts`
