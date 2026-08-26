# Automation Demos — OpenDAW SDK Reference

### Time Signature Events
```typescript
// Access signature track
const signatureTrack = project.timelineBoxAdapter.signatureTrack;

// Create event at PPQN position
signatureTrack.createEvent(position, nominator, denominator);

// Iterate all events (index -1 is storage signature)
const events = Array.from(signatureTrack.iterateAll());

// Delete event — prefer the adapter-level helper over reaching into the box
signatureTrack.adapterAt(event.index).ifSome(a => signatureTrack.deleteAdapter(a));

// PPQN per bar: PPQN.fromSignature(nom, denom) = Math.floor(3840/denom) * nom
```

### SignatureTrack: One editing.modify() Per Event
`SignatureTrackAdapter.createEvent()` calls `iterateAll()` internally. Inside a single
`editing.modify()` transaction, adapter collection notifications are deferred, so subsequent
calls see stale state. Use separate `editing.modify()` per `createEvent` and per deletion.

### Tempo Automation Events
```typescript
// Access tempo track events
project.timelineBoxAdapter.tempoTrackEvents.ifSome(collection => {
  // Clear existing
  collection.events.asArray().forEach(event => event.box.delete());
  // Create event
  collection.createEvent({ position, index: 0, value: bpm, interpolation });
});
// Interpolation: Interpolation.None, Interpolation.Linear, Interpolation.Curve(slope) from @opendaw/lib-dsp
```

The engine honors `Interpolation.Curve` on tempo events — `VaryingTempoMap` (from
`@opendaw/studio-adapters`) evaluates curve segments via `Curve.valueAt`. Curve BPM
values are exact at any position. PPQN↔seconds integration is quantized to the
80-PPQN `TempoChangeGrid` (`PPQN.fromSignature(1, 48)`), so seconds-domain
conversions are stepwise between grid points.

Delete + create of tempo/value events in a single `editing.modify()` is safe:
`ValueEventCollectionBoxAdapter.createEvent` guards stale cached adapters with
`existing.box.isAttached()`. The one-modify-per-event rule applies to the
signature track only.

### Track Automation (Volume, Pan, Effects)
```typescript
// Create automation track targeting a parameter field
let trackBox: TrackBox;
project.editing.modify(() => {
  trackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume);
});

// Create a region, then add events in a SECOND commit (see rule below).
// modify<R> forwards the modifier's return as Option<R>; the inner Option is
// createTrackRegion's own result.
const regionBox = project.editing
  .modify(() => project.api.createTrackRegion(trackBox, position, duration))
  .unwrap()
  .unwrap() as ValueRegionBox;
project.editing.append(() => {  // append: separate commit, SAME undo entry
  const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
  const collection = adapter.optCollection.unwrap();
  // createTrackRegion seeds one inherited node at position 0 — clear it before
  // writing your own position-0 event (duplicate (position, index) keys panic)
  collection.events.asArray().forEach(evt => evt.box.delete());
  collection.createEvent({ position: 0 as ppqn, index: 0, value: 0.5, interpolation: Interpolation.Linear });
});
```

### createTrackRegion: Seed Node + Overlap Resolution
`createTrackRegion` on a Value track seeds the new region with one inherited node at
region-local position 0 (preceding region's outgoing value, else following region's
incoming value, else the parameter's dial value; skipped only when the track's target
parameter can't be resolved — always present in practice), and resolves overlaps against
existing regions (default behaviour clips: fully-covered regions are DELETED, then
validateTrack asserts). Consequences:
- Clear the seed in a **separate follow-up commit** — inside the creating transaction
  the adapter's event collection doesn't see the seed box yet, so `events.asArray()`
  misses it and the clear is a silent no-op (createEvent's own de-dup guard checks
  `isAttached()` and can't see it either). Use `project.editing.append()` for the
  follow-up: it commits separately but folds into the previous transaction's undo
  entry, so one `editing.undo()` reverts both steps atomically.
- Don't delete "replaced" regions yourself after creating over them — guard with
  `project.boxGraph.findBox(box.address.uuid).nonEmpty()` (the resolver may have
  deleted them already).
- When a rebuild deletes old regions and creates replacements in ONE transaction,
  THROW on a creation failure — only a throw aborts the transaction; an early return
  commits the deletion with no replacement.

**Automation event positions are REGION-LOCAL, not absolute.**
`ValueRegionBoxAdapter.valueAt()` calls `LoopableRegion.globalToLocal(region, ppqn)` =
`mod(ppqn - region.position + region.loopOffset, region.loopDuration)` before looking up events.
Events at absolute positions will fall outside the region duration and never trigger.

### Automation Events at Same Position Must Have Different Index
The SDK uses `(position, index)` as composite key. Two events at the same PPQN with
the same index cause a panic: "are identical in terms of comparison". When building
automation events that may land on the same position (e.g., crossfade boundaries),
assign incrementing `index` values per position.

### Curve Rendering Must Use SDK's Curve.normalizedAt
Canvas rendering of automation curves must use `Curve.normalizedAt(t, slope)` from `@opendaw/lib-std`,
not quadratic bezier approximations. The SDK uses an exponential formula:
`(p²)/(1-2p) * (((1-p)/p)^(2x) - 1)` (Möbius-Ease) — visually different from bezier.
Slope semantics: 0.75 = steep start, flat end (logarithmic feel); 0.25 = flat start, steep end.
For a round swell: use Curve(0.75) rising, Curve(0.25) falling.

### Effects Parameter Architecture
Effects use a 3-layer chain: Box (raw storage) → Adapter (UI mapping) → Processor (DSP).
`box.field.setValue()` stores raw values that the processor reads directly via `getValue()`.
`ValueMapping` in adapters only affects UI display/automation — NOT audio processing.

**Gotchas discovered during SDK 0.0.115 audit:**
- Delay has its own 21-entry `Fractions` array (Off→1/1) — different from Tidal's 17-entry `RateFractions` (1/1→1/128)
- Crusher processor inverts crush: `setCrush(1.0 - value)` — higher box value = MORE crushing
- DattorroReverb `preDelay` is in milliseconds (0-1000), standard Reverb is in seconds (0.001-0.5)
- DattorroReverb `dry` uses `DefaultDecibel` mapping (-72 to 0 dB), not -60 to 0
- StereoTool `stereo` (width) is bipolar (-1..1), not unipolar — 0 = normal, not center of 0-2 range
- `DefaultDecibel` mapping: `decibel(-72, -12, 0)` — unitValue 0.0 = -inf, 0.5 = -12 dB, 1.0 = 0 dB
- AudioUnit `VolumeMapper`: `decibel(-96, -9, +6)` — different range, unitValue 0.0 = -inf, 1.0 = +6 dB
- Automation values (unitValue 0-1) go through ValueMapping before reaching the processor:
  `AutomatableParameterFieldAdapter.valueAt()` calls `valueMapping.y(unitValue)` to convert to dB/raw
- Convert dB ↔ unitValue: `AudioUnitBoxAdapter.VolumeMapper.x(0)` → unitValue for 0 dB (~0.734);
  `.y(0.5)` → -9 dB. Import `AudioUnitBoxAdapter` from `@opendaw/studio-adapters`.
  For effects: `ValueMapping.DefaultDecibel` from `@opendaw/lib-std`.
- To verify parameter ranges, audit all 3 layers: schema (Box), adapter (ValueMapping), and processor (how value is consumed)

### AutomatableParameterFieldAdapter Full API
Each automatable parameter (volume, pan, effect wet/dry, etc.) is wrapped by an adapter:
```typescript
import { AutomatableParameterFieldAdapter } from "@opendaw/studio-adapters";

// Identity / mapping
parameter.name           // string — display name
parameter.address        // Address — box graph location
parameter.anchor         // unitValue — default/rest position
parameter.type           // PrimitiveType — underlying field type
parameter.field          // PrimitiveField<T, Pointers.Automation>
parameter.valueMapping   // ValueMapping<T>
parameter.stringMapping  // StringMapping<T>
parameter.track          // Option<TrackBoxAdapter> — automation track if any

// Read / write
parameter.getValue()           // T — current raw value
parameter.setValue(value)      // write raw value
parameter.getUnitValue()       // unitValue (0-1) via valueMapping.x()
parameter.setUnitValue(unit)   // write from unitValue
parameter.getControlledValue() // T — value after MIDI/automation control sources
parameter.getControlledUnitValue()
parameter.getPrintValue()           // StringResult — formatted for display
parameter.getControlledPrintValue()
parameter.setPrintValue(text)       // parse + write display string
parameter.reset()                   // restore to resetValue (or the field's initValue)
parameter.valueAt(position)         // T — automation value at a PPQN

// Subscriptions / lifecycle
parameter.subscribe(observer)            // future changes only
parameter.catchupAndSubscribe(observer)  // current value + future changes
parameter.catchupAndSubscribeControlSources(observer)
parameter.registerMidiControl()          // returns Terminable
parameter.registerTracks(tracks)         // wire to a ParameterTracks (e.g. AudioUnitTracks)
parameter.optTracks()                    // Option<ParameterTracks> — lane owner (registered, else audio unit)
parameter.updateMappings(value, string)  // swap mappings (e.g. on schema change)
parameter.terminate()
```

### Latch Recording Lifecycle (touch API removed in SDK 0.0.170)
Real-time automation recording is latch-based: while `engine.isRecording`, ANY
parameter write (`setUnitValue`, MIDI, checkbox) opens or extends the automation take —
no touch gate. Only the transport (stop) or a loop wrap closes it. The former touch API
(`touchStart/End`, `isTouched`, `subscribeTouchEnd` on both the adapter and the
registry) no longer exists.
```typescript
import { ParameterFieldAdapters } from "@opendaw/studio-adapters";
// project.parameterFieldAdapters: ParameterFieldAdapters

// Per-adapter — UI fader/knob handlers just write
adapter.setUnitValue(0.5);  // unitValue 0-1, mapped through ValueMapping

// Registry-level
parameterFieldAdapters.getMode(adapter.address)             // "read" | "touch" | "latch"
parameterFieldAdapters.setMode(adapter.address, "touch")
parameterFieldAdapters.subscribeWrites(observer)            // every parameter write
parameterFieldAdapters.registerTracks(address, tracks)      // ParameterTracks lane owner
parameterFieldAdapters.getTracks(address)                   // Option<ParameterTracks>
```
During playback (not recording), a manual/MIDI write suspends that lane's automation
until the transport stops (`AutomationSuspension`, auto-started per Project; engine-side
`engine.suspendAutomation(uuid)`; cleared on pause/stop). Runtime-only — no box graph
writes.

### ParameterAdapterSet (Device Parameters)
Access all automatable parameters on a device:
```typescript
const paramSet = deviceAdapter.parameters;
paramSet.parameters()             // ReadonlyArray<AutomatableParameterFieldAdapter>
paramSet.parameterAt(address)     // lookup by Address (NOT a numeric index)
```
Use this for building generic device UIs that enumerate all knobs/sliders.

### ValueRegionBoxAdapter Full API
Beyond `.optCollection`:
- `.events` — `Option<EventCollection<ValueEventBoxAdapter>>` (empty if no collection)
- `.hasCollection` — boolean guard before reading events
- `.valueAt(position, fallback)` — unitValue at a GLOBAL timeline PPQN (converted to
  region-local via `LoopableRegion.globalToLocal` internally; compare `.position` on
  events, which is region-local); `fallback` is returned when the region has no
  events (no implicit default)
- `.incomingValue(fallback)` — value entering the region
- `.outgoingValue(fallback)` — value leaving the region

### ValueEventBoxAdapter Full API
Each automation point:
- `.position` — PPQN position (region-local)
- `.value` — number (raw field value; combine with the adapter's `ValueMapping` for UI)
- `.index` — `int` ordering index (composite key with position)
- `.interpolation` — `Interpolation.None`, `.Linear`, or `.Curve(slope)` (settable)
- `.collection` — `Option<ValueEventCollectionBoxAdapter>` (back-reference)
- `.isSelected` — selection state
- `.type` — event type discriminator (`"value-event"`)
- `.copyTo({ position?, index?, value?, interpolation?, events? })` — copy with overrides
- `.copyFrom({...})` — write overrides into this event from a partial

Move via `box.position.setValue()` in `editing.modify()`. Delete via
`adapter.box.delete()` — `Interpolation.Curve(slope)` is persisted as a separate
`ValueEventCurveBox` with a mandatory back-pointer, and only `box.delete()`
cascade-deletes it; bare `unstageBox` strands the curve box.

### Live Automation Recording (`live-automation-recording-demo.tsx`)

**Lane auto-creation, no pre-creation needed.** `RecordAutomation` resolves the lane owner via
`adapter.optTracks()`, which falls back to the parameter's audio unit when nothing was registered.
The first `setUnitValue` while `engine.isRecording` creates the value `TrackBox` *and* its
`ValueRegionBox` on demand — verified per-parameter: in a three-fader take each lane's track
appeared independently, and each region started at *that* lane's own first write, not a shared
start time.

**`LoopArea.enabled` schema-defaults to `true`.** `LoopArea.initializeFields()`
(`node_modules/@opendaw/studio-boxes/dist/LoopArea.js`) sets `enabled: true`, `from: 0`,
`to: 15360` (4 bars) on a fresh box. A demo with a Loop control must explicitly set it `false` at
boot, or the UI and the engine disagree from the first frame — every "non-looping" first take
silently splits at the invisible wrap otherwise.

**Wrap-finalized regions carry non-zero `loopOffset`; event positions are loop-cycle-relative.**
A take split by a loop wrap gets `loopOffset == its position` and `loopDuration == the loop
length`, and its event collection is stored relative to the *loop cycle*, not the region — events
can fall outside the region's own `[position, position+duration)` window entirely. Measured: a
region `{position 4560, duration 10800, loopOffset 4560, loopDuration 15360}` held events at
local positions `0, 3837, 9452, 15360` — spanning the whole 0–15360 cycle even though the
region's visible span is only 4560–15360. Rendering (or otherwise interpreting) these positions
must invert `LoopableRegion.globalToLocal` (`global = position − loopOffset + local +
k·loopDuration`) rather than assume `position + local` — `buildRegionRender` in
`laneRenderModel.ts` is the reference implementation, and it also clips the polyline to
`[x0, x1]` since nothing else bounds it. Only the **wrap-truncated** region's end is pinned to
the loop boundary (`position + duration == loopDuration`); the region that opens after the wrap
just keeps growing until the take closes, so its end is wherever **Stop** happened — not
necessarily the boundary again. The newer pass's region clips the older pass where they overlap
(trimmed, not duplicated).

**Gesture writes skip the undo mark, and the gesture guard must span the whole drag.**
`project.editing.modify(() => adapter.setUnitValue(v), false)` — the `false` means a fader drag
commits as one gesture instead of one undo entry per sample. A `gestureRef`-style guard that a
slider's change handler raises and lowers in the same synchronous callback never actually
suppresses anything, because the guard needs to be read by code that runs on a later tick (e.g.
an `AnimationFrame` follow loop) — raise it on the first change and clear it from Radix's
`onValueCommit` (fires once, on pointer-up/key-up), not from the per-tick change handler.

**Fader-follow needs polling, not a field subscription.** During playback, an automated
parameter's stored field value doesn't change — only `getControlledUnitValue()` reflects where
automation currently has it. Follow the curve by polling that getter from an `AnimationFrame`
loop, gated per-lane by the gesture guard so a manual drag isn't fought. Print the fader's label
from the same source the thumb rides: `getPrintValue()` reads the raw field (frozen during
playback) and `getControlledPrintValue()` evaluates automation **at the current playhead** (so
it can read "6.00db" while the transport is stopped at position 0, contradicting a fader parked
at −∞) — neither matches the thumb in every transport state. Format the displayed value directly
from the same `unitValue` the thumb uses (`valueMapping.y` + `stringMapping.x`).

**`subscribeWrites` and suspension inference.** `parameterFieldAdapters.subscribeWrites(observer)`
delivers `{ adapter, previousUnitValue }` for every write; match against known adapters by
reference (adapters are cached per address, not recreated). `AutomationSuspension` has no public
observable — infer an "overridden" badge locally from a write arriving while playing-not-recording
on a lane that already has a track, and clear it on the transport's falling edge (suspensions drop
on pause, stop, and `stopRecording`, matching the engine's own behavior).

**Boot must push the initial automation mode into the registry.** `ParameterFieldAdapters`
defaults every address's mode to `"read"` regardless of what a UI control displays; if a page's
mode selector defaults to e.g. `"latch"` in React state alone, `getMode()` returns `"read"` for
every lane until something calls `setMode()` at setup time to match.

**Analyser-tap gotcha when verifying audio in-browser.** An `AnalyserNode` teed off a monkeypatched
destination `connect()` reads all zeros if it dead-ends at a dangling node — it must stay inside
the pull graph, e.g. `analyser.connect(zeroGain); zeroGain.connect(ctx.destination)`. Without the
onward connection this looks exactly like silence even when the mix is healthy.

## Reference Files
- Track automation demo: `src/demos/automation/track-automation-demo.tsx`
- Tempo automation demo: `src/demos/automation/tempo-automation-demo.tsx`
- Time signature demo: `src/demos/automation/time-signature-demo.tsx`
- Live automation recording demo: `src/demos/automation/live-automation-recording-demo.tsx`
- Track automation docs: `documentation/09-editing-fades-and-automation.md#advanced-track-automation`
