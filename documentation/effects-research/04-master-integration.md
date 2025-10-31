# Adding Effects to Master Output

This document explains how to add audio effects to the master output bus (global master effects).

## Overview

Master effects are global effects applied to the entire mix after all tracks have been combined. In OpenDAW, these are added to the root audio bus or master channel.

## Master Bus Structure

The master bus is accessed through the root box's output device:

```typescript
// Access the root box
const rootBox = project.rootBox;

// The master audio unit is the first AudioUnitBox connected to the output device
const masterAudioUnit = rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

if (!masterAudioUnit) {
    console.error("Could not find master audio unit");
}
```

## Adding Effects to Master

### Basic Example

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

const project = /* ... */;

project.editing.modify(() => {
    // Get the master audio unit from output device
    const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

    if (!masterAudioUnit) {
        console.error("Could not find master audio unit");
        return;
    }

    // Add a reverb effect to the master
    const masterReverb = project.api.insertEffect(
        masterAudioUnit.audioEffects,  // Master effect chain
        EffectFactories.AudioNamed.Reverb
    );

    masterReverb.label.setValue("Master Reverb");
    masterReverb.wet.setValue(-12.0);  // Subtle master reverb
});
```

## Master Effect Chain Ordering

Like track effects, master effects are ordered by index:

```typescript
project.editing.modify(() => {
    const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

    if (!masterAudioUnit) {
        console.error("Could not find master audio unit");
        return;
    }

    // Add EQ first
    const eq = project.api.insertEffect(
        masterAudioUnit.audioEffects,
        EffectFactories.AudioNamed.Revamp,
        0
    );
    eq.label.setValue("Master EQ");

    // Add compressor for limiting
    const limiter = project.api.insertEffect(
        masterAudioUnit.audioEffects,
        EffectFactories.AudioNamed.Compressor,
        1
    );
    limiter.label.setValue("Master Limiter");
    limiter.threshold.setValue(-3.0);
    limiter.ratio.setValue(20.0);  // Near hard limit

    // Add final reverb for glue
    const reverb = project.api.insertEffect(
        masterAudioUnit.audioEffects,
        EffectFactories.AudioNamed.Reverb,
        2
    );
    reverb.label.setValue("Master Reverb");

    // Chain: Master EQ -> Limiter -> Reverb
});
```

## Accessing Master Effects

### Get All Master Effects

```typescript
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";

const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

if (!masterAudioUnit) {
    console.error("Could not find master audio unit");
    return;
}

// Get the adapter for the master audio unit
const masterAdapter = project.boxAdapters.adapterFor(
    masterAudioUnit,
    AudioUnitBoxAdapter
);

// Get all audio effect adapters
const masterEffects = project.boxAdapters.audioEffects(masterAudioUnit);

masterEffects.forEach(effectAdapter => {
    console.log("Master Effect:", effectAdapter.labelField.getValue());
    console.log("Enabled:", effectAdapter.enabledField.getValue());
});
```

### Get Specific Master Effect

```typescript
const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

if (!masterAudioUnit) {
    console.error("Could not find master audio unit");
    return;
}

const masterEffects = project.boxAdapters.audioEffects(masterAudioUnit);

const masterLimiter = masterEffects.find(
    e => e.labelField.getValue() === "Master Limiter"
);

if (masterLimiter) {
    console.log("Limiter threshold:", masterLimiter.namedParameter.threshold.getValue());
}
```

## Modifying Master Effects

### Change Master Effect Parameters

```typescript
project.editing.modify(() => {
    const masterReverb = /* ... */;
    
    // Adjust reverb parameters
    masterReverb.wet.setValue(-6.0);   // More reverb
    masterReverb.decay.setValue(0.7);  // Longer decay
    masterReverb.damp.setValue(0.4);   // More damping
});
```

### Master Volume Control

The master audio unit also has volume and mute controls:

```typescript
project.editing.modify(() => {
    const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

    if (!masterAudioUnit) {
        console.error("Could not find master audio unit");
        return;
    }

    // Set master volume
    masterAudioUnit.volume.setValue(-3.0);  // -3dB

    // Mute master (mutes entire mix)
    masterAudioUnit.mute.setValue(true);

    // Unmute
    masterAudioUnit.mute.setValue(false);
});
```

## Complete Master Effect Example

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

async function setupMasterBus(project: Project) {
    project.editing.modify(() => {
        const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

        if (!masterAudioUnit) {
            console.error("Could not find master audio unit");
            return;
        }

        // Set overall master volume
        masterAudioUnit.volume.setValue(-6.0);

        // Add professional mastering chain

        // 1. Parametric EQ for tone shaping
        const eq = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Revamp,
            0
        );
        eq.label.setValue("Master EQ");
        // Apply professional default curve

        // 2. Compressor for glue
        const compressor = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            1
        );
        compressor.label.setValue("Master Glue");
        compressor.threshold.setValue(-12.0);
        compressor.ratio.setValue(2.0);
        compressor.attack.setValue(20.0);
        compressor.release.setValue(200.0);
        compressor.makeup.setValue(2.0);

        // 3. Limiter for peak protection
        const limiter = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            2
        );
        limiter.label.setValue("Master Limiter");
        limiter.threshold.setValue(-1.0);  // Just below 0dB
        limiter.ratio.setValue(20.0);      // Hard limiting
        limiter.attack.setValue(1.0);      // Fast attack
        limiter.release.setValue(100.0);

        // 4. Stereo enhancement
        const stereoTool = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.StereoTool,
            3
        );
        stereoTool.label.setValue("Master Stereo");

        console.log("Master mastering chain created:");
        console.log("1. Master EQ");
        console.log("2. Master Glue (Compressor)");
        console.log("3. Master Limiter");
        console.log("4. Master Stereo Tool");
    });
}
```

## Master Effect Use Cases

### Mastering Chain
A professional mastering setup:
1. Parametric EQ (tone correction)
2. Multiband Compressor (dynamic control per frequency)
3. Limiter (peak protection)
4. Metering (visualization only)

### Mixing Polish
Common mixing master effects:
1. Compressor (glue tracks together)
2. Reverb (cohesive space)
3. Stereo Tool (width and balance)
4. Limiter (safety)

### Creative Master Effects
Artistic master processing:
1. Delay (space/echo)
2. Reverb (atmosphere)
3. Crusher (lo-fi color)
4. Fold (saturation)

## Master Bus Signal Flow

```
All Track Outputs (summed)
         ↓
Master EQ
         ↓
Master Compressor
         ↓
Master Limiter
         ↓
Master Volume Control
         ↓
Master Mute Check
         ↓
Audio Interface Output
```

## Observable Pattern for Master Effects

Subscribe to master effect changes:

```typescript
const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

if (!masterAudioUnit) {
    console.error("Could not find master audio unit");
    return;
}

// Subscribe to master effect chain changes
const subscription = project.boxAdapters.audioEffects(masterAudioUnit)
    .catchupAndSubscribe({
        onAdd: (effectAdapter) => {
            console.log("Master effect added:", effectAdapter.labelField.getValue());
        },
        onRemove: (effectAdapter) => {
            console.log("Master effect removed:", effectAdapter.labelField.getValue());
        }
    });

// Also subscribe to master volume changes
const volumeSubscription = masterAudioUnit.volume.catchupAndSubscribe(
    obs => console.log("Master volume:", obs.getValue())
);

// Cleanup
subscription.terminate();
volumeSubscription.terminate();
```

## Key Points

1. **Master Audio Unit Contains Effects**
   - Access via `project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box`
   - Has its own effect chain in `audioEffects`

2. **Master Affects All Output**
   - Every track must pass through master
   - Master effects process the final mix
   - Master volume/mute affects entire output

3. **Order Matters**
   - Effects are processed in index order
   - Typical order: EQ -> Compressor -> Limiter

4. **Master vs Track Effects**
   - Track effects: individual channel processing
   - Master effects: mix processing
   - Both use same EffectFactory system

5. **Use for Safety**
   - Master limiter prevents clipping
   - Master volume gives final control
   - Standard in professional mixing

## Performance Considerations

- Master effects process after all tracks sum
- Disabled master effects still compute (but bypassed)
- Master limiter critical for digital audio (prevents clipping)
- Keep master chain efficient (quality over quantity)

## Common Master Effect Settings

### Safety Limiter
```typescript
limiter.threshold.setValue(-0.5);  // Just below maximum
limiter.ratio.setValue(20.0);      // Hard limiting
limiter.attack.setValue(0.5);      // Very fast
limiter.release.setValue(100.0);   // Natural release
```

### Glue Compressor
```typescript
compressor.threshold.setValue(-12.0);  // Moderate threshold
compressor.ratio.setValue(2.0);        // Subtle compression
compressor.attack.setValue(30.0);      // Musical attack
compressor.release.setValue(300.0);    // Slow release
```

### Room Reverb
```typescript
reverb.wet.setValue(-12.0);   // Subtle blend
reverb.decay.setValue(0.5);   // Medium room
reverb.damp.setValue(0.5);    // Natural damping
```

