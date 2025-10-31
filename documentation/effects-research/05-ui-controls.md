# Effect UI Components and Parameter Controls

This document explains how effect UI is built and how parameters are controlled in the user interface.

## Overview

OpenDAW effects use a reactive UI pattern where:
1. **Device Adapters** wrap effect boxes with observable properties
2. **Device Editors** render React components for the UI
3. **Parameter Controls** provide interactive knobs, sliders, and buttons
4. **Control Builders** create standardized UI components

## Device Adapter Pattern

### What is a Device Adapter?

A Device Adapter wraps an effect box with reactive properties:

```typescript
// Example: CompressorDeviceBoxAdapter
class CompressorDeviceBoxAdapter implements AudioEffectDeviceAdapter {
    readonly type = "audio-effect"
    readonly accepts = "audio"
    
    get box(): CompressorDeviceBox { /* ... */ }
    get uuid(): UUID.Bytes { /* ... */ }
    get address(): Address { /* ... */ }
    get indexField(): Int32Field { /* ... */ }
    get labelField(): StringField { /* ... */ }
    get enabledField(): BooleanField { /* ... */ }
    get minimizedField(): BooleanField { /* ... */ }
    
    readonly namedParameter // Typed parameter object
}
```

### Named Parameters

Each adapter provides typed parameters:

```typescript
// CompressorDeviceBoxAdapter.namedParameter
{
    lookahead: ParameterAdapter<boolean>,
    automakeup: ParameterAdapter<boolean>,
    autoattack: ParameterAdapter<boolean>,
    autorelease: ParameterAdapter<boolean>,
    inputgain: ParameterAdapter<number>,
    threshold: ParameterAdapter<number>,
    ratio: ParameterAdapter<number>,
    knee: ParameterAdapter<number>,
    attack: ParameterAdapter<number>,
    release: ParameterAdapter<number>,
    makeup: ParameterAdapter<number>,
    mix: ParameterAdapter<number>
}
```

## Device Editor Pattern

### Basic Device Editor Structure

```typescript
import { DeviceEditor } from "@/ui/devices/DeviceEditor.tsx";
import { EffectFactories } from "@opendaw/studio-core";

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    adapter: CompressorDeviceBoxAdapter
    deviceHost: DeviceHost
}

export const CompressorDeviceEditor = ({lifecycle, service, adapter, deviceHost}: Construct) => {
    const {project} = service
    const {editing, midiLearning} = project
    
    // Get named parameters
    const {
        lookahead, automakeup, autoattack, autorelease,
        threshold, ratio, knee, makeup,
        attack, release, inputgain, mix
    } = adapter.namedParameter
    
    return (
        <DeviceEditor
            lifecycle={lifecycle}
            project={project}
            adapter={adapter}
            populateMenu={parent => /* ... */}
            populateControls={() => (
                <div>
                    {/* Parameter controls here */}
                </div>
            )}
            populateMeter={() => (
                <DevicePeakMeter 
                    lifecycle={lifecycle}
                    receiver={project.liveStreamReceiver}
                    address={adapter.address}
                />
            )}
            icon={EffectFactories.AudioNamed.Compressor.defaultIcon}
        />
    )
}
```

## Parameter Control Components

### ControlBuilder - Knob Component

The standard way to create parameter controls:

```typescript
import { ControlBuilder } from "@/ui/devices/ControlBuilder.tsx";
import { SnapCommonDecibel } from "@/ui/configs.ts";

{ControlBuilder.createKnob({
    lifecycle,
    editing,
    midiLearning: midiLearning,
    adapter,
    parameter: delay,
    options: SnapCommonDecibel  // Optional snap points
})}
```

**Options Parameter:**
- `SnapCommonDecibel` - Common decibel values (-60, -48, -36, -24, -12, -6, 0, +6)
- Custom snap arrays for specific values
- Undefined for no snapping

### ParameterToggleButton - Boolean Controls

For boolean parameters:

```typescript
import { ParameterToggleButton } from "@/ui/devices/ParameterToggleButton";

{[automakeup, autoattack, autorelease, lookahead]
    .map((parameter) => (
        <ParameterToggleButton
            lifecycle={lifecycle}
            editing={editing}
            parameter={parameter}
        />
    ))
}
```

### ParameterLabel - Text/Numeric Display

For numeric parameters with custom rendering:

```typescript
import { ParameterLabel } from "@/ui/components/ParameterLabel";
import { RelativeUnitValueDragging } from "@/ui/wrapper/RelativeUnitValueDragging";

<Frag>
    <span>{parameter.name}</span>
    <RelativeUnitValueDragging 
        lifecycle={lifecycle}
        editing={editing}
        parameter={parameter}
    >
        <ParameterLabel 
            lifecycle={lifecycle}
            editing={editing}
            midiLearning={midiLearning}
            adapter={adapter}
            parameter={parameter}
            framed 
            standalone
        />
    </RelativeUnitValueDragging>
</Frag>
```

## Complete UI Example: Delay Effect

```typescript
import css from "./DelayDeviceEditor.sass?inline"
import {DelayDeviceBoxAdapter, DeviceHost} from "@opendaw/studio-adapters"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {DeviceEditor} from "@/ui/devices/DeviceEditor.tsx"
import {MenuItems} from "@/ui/devices/menu-items.ts"
import {ControlBuilder} from "@/ui/devices/ControlBuilder.tsx"
import {SnapCommonDecibel} from "@/ui/configs.ts"
import {DevicePeakMeter} from "@/ui/devices/panel/DevicePeakMeter.tsx"
import {Html} from "@opendaw/lib-dom"
import {StudioService} from "@/service/StudioService"
import {EffectFactories} from "@opendaw/studio-core"

const className = Html.adoptStyleSheet(css, "DelayDeviceEditor")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    adapter: DelayDeviceBoxAdapter
    deviceHost: DeviceHost
}

export const DelayDeviceEditor = ({lifecycle, service, adapter, deviceHost}: Construct) => {
    const {project} = service
    const {editing, midiLearning} = project
    const {delay, feedback, cross, filter, dry, wet} = adapter.namedParameter
    
    return (
        <DeviceEditor 
            lifecycle={lifecycle}
            project={project}
            adapter={adapter}
            populateMenu={parent => 
                MenuItems.forEffectDevice(parent, service, deviceHost, adapter)
            }
            populateControls={() => (
                <div className={className}>
                    {/* Delay time fraction selector */}
                    {ControlBuilder.createKnob({
                        lifecycle, editing, midiLearning, adapter, 
                        parameter: delay
                    })}
                    
                    {/* Feedback amount */}
                    {ControlBuilder.createKnob({
                        lifecycle, editing, midiLearning, adapter, 
                        parameter: feedback
                    })}
                    
                    {/* Stereo cross-feedback */}
                    {ControlBuilder.createKnob({
                        lifecycle, editing, midiLearning, adapter, 
                        parameter: cross,
                        anchor: 0.5  // Center at 0
                    })}
                    
                    {/* Feedback filter */}
                    {ControlBuilder.createKnob({
                        lifecycle, editing, midiLearning, adapter, 
                        parameter: filter,
                        anchor: 0.5  // Center at 0
                    })}
                    
                    {/* Dry signal level */}
                    {ControlBuilder.createKnob({
                        lifecycle, editing, midiLearning, adapter, 
                        parameter: dry,
                        options: SnapCommonDecibel
                    })}
                    
                    {/* Wet signal level */}
                    {ControlBuilder.createKnob({
                        lifecycle, editing, midiLearning, adapter, 
                        parameter: wet,
                        options: SnapCommonDecibel
                    })}
                </div>
            )}
            populateMeter={() => (
                <DevicePeakMeter 
                    lifecycle={lifecycle}
                    receiver={project.liveStreamReceiver}
                    address={adapter.address}
                />
            )}
            icon={EffectFactories.AudioNamed.Delay.defaultIcon}
        />
    )
}
```

## Parameter Control Features

### Drag-Based Input
- Mouse drag on controls adjusts values
- Hold Shift for fine control (slower)
- Double-click to reset to default
- Alt+drag for step-based changes

### MIDI Learning
- Right-click parameter to learn MIDI CC
- Map hardware controllers to effect parameters
- Persist across sessions

### Automation Support
- Click automation button to create automation track
- Record/edit parameter automation
- Playback automation while recording

### Observable Updates
All parameter changes are observable:

```typescript
// Subscribe to parameter changes
const subscription = parameter.catchupAndSubscribe((obs) => {
    const newValue = obs.getValue();
    console.log("Parameter changed:", newValue);
});

// Get current value
const currentValue = parameter.getValue();
```

## Control Builder API

### createKnob()

```typescript
ControlBuilder.createKnob({
    lifecycle: Lifecycle,        // Required: lifecycle management
    editing: Editing,            // Required: transaction management
    midiLearning: MidiLearning,  // Required: MIDI learning context
    adapter: DeviceAdapter,      // Required: device adapter
    parameter: ParameterAdapter, // Required: the parameter
    options?: SnapArray,         // Optional: snap points
    anchor?: number              // Optional: center value (0-1)
})
```

### Common Snap Options

```typescript
import { SnapCommonDecibel } from "@/ui/configs.ts";

// Decibel values: -60, -48, -36, -24, -12, -6, 0, +6
SnapCommonDecibel

// Custom snap array
[0, 0.25, 0.5, 0.75, 1.0]

// No snapping
undefined
```

## Device Editor Lifecycle

```typescript
<DeviceEditor
    lifecycle={lifecycle}        // Resource management
    project={project}            // Project context
    adapter={adapter}            // Device adapter
    
    // Menu population
    populateMenu={parent => {
        // Add menu items for effect-specific actions
        parent.addMenuItem({label: "Settings", ...})
    }}
    
    // Control rendering
    populateControls={() => (
        // Return JSX for parameter controls
    )}
    
    // Meter rendering
    populateMeter={() => (
        // Return JSX for audio level meter
    )}
    
    // Optional label factory
    createLabel={lifecycle => 
        // Return custom label element
    }
    
    // Device icon
    icon={IconSymbol.Compressor}
/>
```

## Real-Time Metering

Effects can display real-time audio level meters:

```typescript
import { DevicePeakMeter } from "@/ui/devices/panel/DevicePeakMeter.tsx";

<DevicePeakMeter
    lifecycle={lifecycle}
    receiver={project.liveStreamReceiver}
    address={adapter.address}
/>
```

The meter receives peak data from the audio thread via the live stream receiver.

## Parameter Value Mapping

Parameters use value mapping for conversion:

```typescript
// From CompressorDeviceBoxAdapter
threshold: this.#parametric.createParameter(
    box.threshold,
    ValueMapping.linear(-60.0, 0.0),      // Storage range
    StringMapping.decible,                 // Display format
    "Threshold"
)

// From DelayDeviceBoxAdapter
delay: this.#parametric.createParameter(
    box.delay,
    ValueMapping.linearInteger(0, 16),    // Storage as integer index
    DelayDeviceBoxAdapter.OffsetStringMapping,  // Display as fraction
    "delay"
)
```

### Common Value Mappings

```typescript
ValueMapping.linear(min, max)          // Linear scaling
ValueMapping.linearInteger(min, max)   // Integer linear
ValueMapping.exponential(min, max)     // Exponential (for frequency)
ValueMapping.unipolar()                // 0 to 1
ValueMapping.bipolar()                 // -1 to 1
ValueMapping.DefaultDecibel            // Decibel scaling
```

### Common String Mappings

```typescript
StringMapping.decible                  // "dB" suffix
StringMapping.percent()                // "%" suffix
StringMapping.numeric({               // Custom formatting
    unit: "ms",
    fractionDigits: 1,
    unitPrefix: true  // μ, m, k prefixes
})
StringMapping.indices(                 // Indexed values
    "",
    ["1/1", "1/2", "1/4", "1/8", ...]
)
```

## Creating Custom Effect Editors

To create a new effect editor:

1. **Create adapter wrapping class**
   - Implements `AudioEffectDeviceAdapter`
   - Provides `namedParameter` property
   - Maps box fields to typed parameters

2. **Create editor React component**
   - Accepts lifecycle, service, adapter, deviceHost
   - Uses ControlBuilder for standard controls
   - Returns DeviceEditor component

3. **Register in DeviceEditorFactory**
   - Add case for new box type
   - Import adapter and editor
   - Map box.accept() visitor

4. **Create SASS stylesheet (optional)**
   - Style parameter controls
   - Layout special visualizations
   - Adopt into className

## Performance Tips

1. **Use Memo for Complex Controls**
   - Prevent unnecessary re-renders
   - Wrap component creation functions

2. **Lazy Load Visualizations**
   - Initialize complex renders on-demand
   - Unsubscribe when component unmounts

3. **Batch Parameter Updates**
   - Group in single editing.modify() call
   - Reduces notification events

4. **Cache Adapters**
   - Get once, reuse throughout component
   - Avoid repeated lookups

