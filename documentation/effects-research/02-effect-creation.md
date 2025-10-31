# Effect Creation and Instantiation

This document explains how effects are created and instantiated in OpenDAW.

## Overview

Effects are created through the **EffectFactory** pattern, which provides:
1. Standardized creation process
2. Default parameters and naming
3. Box Graph integration
4. Optional initialization hooks

## Factory Pattern

### EffectFactory Interface

```typescript
interface EffectFactory {
    readonly defaultName: string
    readonly defaultIcon: IconSymbol
    readonly description: string
    readonly manualPage?: string
    readonly separatorBefore: boolean
    readonly type: "audio" | "midi"
    
    create(project: Project, unit: Field<EffectPointerType>, index: int): EffectBox
}
```

### Accessing Effect Factories

```typescript
import { EffectFactories } from "@opendaw/studio-core";

// Get a specific effect factory
const compressorFactory = EffectFactories.AudioNamed.Compressor;
const delayFactory = EffectFactories.AudioNamed.Delay;
const reverbFactory = EffectFactories.AudioNamed.Reverb;

// Get all audio effects as array
const allAudioEffects = EffectFactories.AudioList;

// Get all MIDI effects as array
const allMidiEffects = EffectFactories.MidiList;

// Access by key
const effectsByName = EffectFactories.MergedNamed;
```

## Creating Effects

### Method 1: Using ProjectApi.insertEffect()

The recommended approach using the ProjectAPI:

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

// Assuming you have a project and audioUnitBox
const project: Project = /* ... */;
const audioUnitBox = /* ... */;

// Add an effect to the audio unit's effect chain
project.editing.modify(() => {
    const effectBox = project.api.insertEffect(
        audioUnitBox.audioEffects,  // Field<EffectPointerType>
        EffectFactories.AudioNamed.Delay,
        0  // Insert at beginning (optional, defaults to end)
    );
    
    // Access the effect box if needed
    console.log("Created effect:", effectBox);
});
```

### Method 2: Direct Factory Call

For more control over parameters during creation:

```typescript
const factory = EffectFactories.AudioNamed.Compressor;

project.editing.modify(() => {
    const effectBox = factory.create(project, audioUnitBox.audioEffects, 0);
    
    // Customize after creation
    effectBox.label.setValue("My Compressor");
    effectBox.threshold.setValue(-15.0);
    effectBox.ratio.setValue(4.0);
});
```

## Effect Box Creation Process

When `factory.create()` is called, the following happens:

1. **Box Creation** - Factory creates a new effect box
2. **Box Wiring** - Box is connected to the Box Graph
3. **Default Values** - Parameters are set to factory defaults
4. **Host Reference** - Effect is linked to its device host
5. **Index Assignment** - Effect is assigned position in chain

### Example Factory Implementation (Delay)

```typescript
export const Delay: EffectFactory = {
    defaultName: "Delay",
    defaultIcon: IconSymbol.Time,
    description: "Echoes the input signal with time-based repeats",
    separatorBefore: false,
    type: "audio",
    create: ({boxGraph}, unit, index): DelayDeviceBox =>
        DelayDeviceBox.create(boxGraph, UUID.generate(), box => {
            box.label.setValue("Delay")
            box.index.setValue(index)
            box.host.refer(unit)
        })
}
```

## Parameter Initialization

Effects can have custom initialization after creation:

### EffectParameterDefaults

Some effects have specialized default initialization:

```typescript
import { EffectParameterDefaults } from "@opendaw/studio-core";

project.editing.modify(() => {
    const revampBox = factory.create(project, audioUnitBox.audioEffects, 0);
    
    // Apply professional default EQ curve
    EffectParameterDefaults.defaultRevampDeviceBox(revampBox);
});
```

### Manual Parameter Setting

```typescript
project.editing.modify(() => {
    const compressorBox = EffectFactories.AudioNamed.Compressor
        .create(project, audioUnitBox.audioEffects, 0);
    
    // Customize parameters
    compressorBox.threshold.setInitValue(-20.0);
    compressorBox.ratio.setInitValue(4.0);
    compressorBox.attack.setInitValue(10.0);
    compressorBox.release.setInitValue(100.0);
    compressorBox.makeup.setInitValue(12.0);
});
```

## Effect Box Types

Each effect type has its own Box class:

```typescript
// All importable from @opendaw/studio-boxes
import {
    CompressorDeviceBox,
    DelayDeviceBox,
    ReverbDeviceBox,
    RevampDeviceBox,
    CrusherDeviceBox,
    FoldDeviceBox,
    StereoToolDeviceBox,
    ModularDeviceBox
} from "@opendaw/studio-boxes";
```

### Box Structure

Each box contains:
- **Common Fields** (on all devices)
  - `label` (StringField) - Display name
  - `index` (Int32Field) - Position in chain
  - `enabled` (BooleanField) - Active/bypass state
  - `minimized` (BooleanField) - UI collapsed state
  - `host` (PointerField) - Reference to device host

- **Effect-Specific Fields**
  - Named parameters specific to the effect
  - Float32, Int32, Boolean, or nested Object fields
  - Default values defined in box schema

## Effect Chain Integration

Effects belong to a device host and form a chain:

```typescript
// Effects are stored in the audioEffects field of AudioUnitBox
const audioDevices = audioUnitBox.audioEffects;  // Field<EffectPointerType>

// Insert effect into chain
const effectBox = project.api.insertEffect(audioDevices, factory);

// Access effects in order
const adapters = project.boxAdapters.audioEffects(audioUnitBox);
adapters.forEach(adapter => {
    console.log("Effect:", adapter.labelField.getValue());
    console.log("Enabled:", adapter.enabledField.getValue());
    console.log("Index:", adapter.indexField.getValue());
});
```

## Transactional Creation

All effect creation must occur within an `editing.modify()` transaction:

```typescript
// Correct: Transaction wraps all modifications
project.editing.modify(() => {
    const effect1 = project.api.insertEffect(audioDevices, factory1);
    const effect2 = project.api.insertEffect(audioDevices, factory2);
    effect1.label.setValue("First Effect");
    effect2.label.setValue("Second Effect");
    // All changes applied atomically when modify() completes
});

// Incorrect: Changes outside transaction may not propagate correctly
const effect = project.api.insertEffect(audioDevices, factory);
effect.label.setValue("Effect");  // May not work as expected
```

## Complete Example: Creating an Effect Chain

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-core";

async function createInstrumentWithEffects(project: Project) {
    project.editing.modify(() => {
        // Create instrument
        const { audioUnitBox } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        
        // Add reverb (3rd position)
        const reverb = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Reverb,
            2
        );
        reverb.wet.setValue(-3.0);  // Subtle wet signal
        
        // Add delay (2nd position)
        const delay = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Delay,
            1
        );
        delay.wet.setValue(-12.0);
        delay.feedback.setValue(0.4);
        
        // Add compressor (1st position)
        const compressor = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        compressor.threshold.setValue(-15.0);
        compressor.ratio.setValue(4.0);
        
        // Chain order: Compressor -> Delay -> Reverb -> Output
    });
}
```

## Effect Instantiation Flow

```
User/Code calls project.api.insertEffect()
         ↓
ProjectApi.insertEffect() called with Factory
         ↓
Factory.create(project, field, index) invoked
         ↓
Box created via BoxType.create()
         ↓
UUID generated for effect
         ↓
Box attached to BoxGraph
         ↓
Parameters initialized with defaults
         ↓
Host reference set via field.refer()
         ↓
Index assigned via indexField.setValue()
         ↓
Box returned to caller
         ↓
(Optional) Further customization of parameters
         ↓
Editing transaction completes
         ↓
Observers notified of new effect
         ↓
Adapters created for UI binding
         ↓
Runtime DSP processor created
         ↓
Effect active in audio chain
```

## Key Patterns

### 1. Always Use Transactions
```typescript
project.editing.modify(() => {
    // All effect creation and modification here
});
```

### 2. Set Defaults Immediately
```typescript
factory.create(project, host, index);  // Returns box with defaults

// Or customize before returning
const custom = factory.create(project, host, index);
custom.someParameter.setValue(customValue);
```

### 3. Use ProjectApi for Track/Master Effects
```typescript
// For track effects
project.api.insertEffect(audioUnitBox.audioEffects, factory);

// For master effects
const masterAudioUnit = rootBox.outputDevice.pointerHub.incoming().at(0)?.box;
if (masterAudioUnit) {
    project.api.insertEffect(masterAudioUnit.audioEffects, factory);
}
```

### 4. Access Factories Consistently
```typescript
// Don't hardcode - use factory references
const factory = EffectFactories.AudioNamed.Compressor;
const effect = project.api.insertEffect(host, factory);
```

