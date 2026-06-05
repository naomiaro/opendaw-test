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
// Interpolation: Interpolation.Linear, Interpolation.None from @opendaw/lib-dsp
```

### Track Automation (Volume, Pan, Effects)
```typescript
// Create automation track targeting a parameter field
let trackBox: TrackBox;
project.editing.modify(() => {
  trackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume);
});

// Create a region and add events
project.editing.modify(() => {
  const regionOpt = project.api.createTrackRegion(trackBox, position, duration);
  const regionBox = regionOpt.unwrap() as ValueRegionBox;
  const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
  const collection = adapter.optCollection.unwrap();
  collection.createEvent({ position: 0 as ppqn, index: 0, value: 0.5, interpolation: Interpolation.Linear });
});
```

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
parameter.reset()                   // restore to resetValue (or anchor)
parameter.valueAt(position)         // T — automation value at a PPQN

// Subscriptions / lifecycle
parameter.subscribe(observer)            // future changes only
parameter.catchupAndSubscribe(observer)  // current value + future changes
parameter.catchupAndSubscribeControlSources(observer)
parameter.registerMidiControl()          // returns Terminable
parameter.registerTracks(tracks)         // wire to AudioUnitTracks
parameter.updateMappings(value, string)  // swap mappings (e.g. on schema change)
parameter.terminate()
```

### Touch Recording Lifecycle
Real-time automation recording (fader movements during playback). Per-adapter actions
on `AutomatableParameterFieldAdapter`; registry-level lookups on `ParameterFieldAdapters`
by `Address`.
```typescript
import { ParameterFieldAdapters } from "@opendaw/studio-adapters";
// project.parameterFieldAdapters: ParameterFieldAdapters

// Per-adapter — UI fader/knob handlers
adapter.touchStart();
adapter.setUnitValue(0.5);  // unitValue 0-1, mapped through ValueMapping
adapter.touchEnd();

// Registry-level — observing across all parameters
parameterFieldAdapters.isTouched(adapter.address)           // boolean
parameterFieldAdapters.touchStart(adapter.address)          // same as adapter.touchStart()
parameterFieldAdapters.touchEnd(adapter.address)
parameterFieldAdapters.getMode(adapter.address)             // "read" | "touch" | "latch"
parameterFieldAdapters.setMode(adapter.address, "touch")
parameterFieldAdapters.subscribeTouchEnd(observer)          // observer: Observer<Address>
parameterFieldAdapters.subscribeWrites(observer)            // every parameter write
```

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
- `.valueAt(position, fallback)` — unitValue at a region-local PPQN; `fallback` is
  returned when the region has no events (no implicit default)
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
`boxGraph.unstageBox(adapter.box)`.

## Reference Files
- Track automation demo: `src/demos/automation/track-automation-demo.tsx`
- Tempo automation demo: `src/demos/automation/tempo-automation-demo.tsx`
- Time signature demo: `src/demos/automation/time-signature-demo.tsx`
- Track automation docs: `documentation/09-editing-fades-and-automation.md#advanced-track-automation`
