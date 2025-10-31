# Adding Effects to Individual Tracks

This document explains how to add audio effects to individual track channels.

## Overview

In OpenDAW, effects are added to tracks by attaching them to the track's **AudioUnitBox**. Each AudioUnit has an `audioDevices` field that stores the chain of audio effects.

## Track Structure

When you create a track with an instrument, you get:

```typescript
type InstrumentProduct = {
    audioUnitBox: AudioUnitBox;  // The audio unit (contains effect chain)
    instrumentBox: any;           // The instrument (Tape, Soundfont, etc.)
    trackBox: TrackBox;           // The UI track representation
};
```

The **AudioUnitBox** is where effects are added.

## Adding Effects to Tracks

### Basic Example

```typescript
import { Project, EffectFactories, InstrumentFactories } from "@opendaw/studio-core";

const project = /* ... */;

project.editing.modify(() => {
    // Create a track with an instrument
    const { audioUnitBox, trackBox } = project.api.createInstrument(
        InstrumentFactories.Tape
    );
    
    // Add a reverb effect to the track
    const reverb = project.api.insertEffect(
        audioUnitBox.audioDevices,
        EffectFactories.AudioNamed.Reverb
    );
    
    // The effect is now in the track's effect chain
});
```

## Effect Chain Ordering

Effects are processed in index order, from 0 to N. You can control insertion position:

```typescript
project.editing.modify(() => {
    // Add effects in specific order
    const compressor = project.api.insertEffect(
        audioUnitBox.audioDevices,
        EffectFactories.AudioNamed.Compressor,
        0  // First position
    );
    
    const delay = project.api.insertEffect(
        audioUnitBox.audioDevices,
        EffectFactories.AudioNamed.Delay,
        1  // Second position
    );
    
    const reverb = project.api.insertEffect(
        audioUnitBox.audioDevices,
        EffectFactories.AudioNamed.Reverb,
        2  // Third position
    );
    
    // Chain order: Compressor -> Delay -> Reverb -> Output
});
```

## Accessing Track Effects

### Get All Effects on a Track

```typescript
// Get the adapter for the audio unit
const audioUnitAdapter = project.boxAdapters.adapterFor(
    audioUnitBox,
    AudioUnitBoxAdapter
);

// Get all audio effect adapters
const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);

effectAdapters.forEach(effectAdapter => {
    console.log("Effect:", effectAdapter.labelField.getValue());
    console.log("Type:", effectAdapter.type);
    console.log("Enabled:", effectAdapter.enabledField.getValue());
});
```

### Get Specific Effect

```typescript
// Access effect box directly if you have the reference
const reverbBox = reverb;  // From creation above
const reverbValue = reverbBox.wet.getValue();

// Or find by label
const allEffects = project.boxAdapters.audioEffects(audioUnitBox);
const delayEffect = allEffects.find(
    e => e.labelField.getValue() === "Delay"
);
```

## Modifying Track Effects

### Change Effect Parameters

```typescript
project.editing.modify(() => {
    // Access the effect and change parameters
    const delay = /* ... */;
    
    delay.wet.setValue(-12.0);      // Quieter wet signal
    delay.feedback.setValue(0.3);   // Less repetition
    delay.delay.setValue(4);        // Quarter note delay
});
```

### Enable/Disable Effects

```typescript
project.editing.modify(() => {
    const reverb = /* ... */;
    
    // Disable (bypass) the effect
    reverb.enabled.setValue(false);
    
    // Re-enable
    reverb.enabled.setValue(true);
});
```

### Reorder Effects

```typescript
project.editing.modify(() => {
    const compressor = /* ... */;
    const delay = /* ... */;
    
    // Change indices to reorder
    compressor.index.setValue(1);  // Move to second position
    delay.index.setValue(0);       // Move to first position
    
    // New order: Delay -> Compressor
});
```

### Rename Effects

```typescript
project.editing.modify(() => {
    const reverb = /* ... */;
    
    reverb.label.setValue("Plate Reverb");
});
```

## Observable Pattern for Track Effects

Subscribe to effect changes:

```typescript
const { audioUnitBox } = /* ... */;

// Subscribe to effect chain changes
const subscription = project.boxAdapters.audioEffects(audioUnitBox)
    .catchupAndSubscribe({
        onAdd: (effectAdapter) => {
            console.log("Effect added:", effectAdapter.labelField.getValue());
        },
        onRemove: (effectAdapter) => {
            console.log("Effect removed:", effectAdapter.labelField.getValue());
        },
        onReorder: (effectAdapter) => {
            console.log("Effect reordered:", effectAdapter.labelField.getValue());
        }
    });

// Later, cleanup
subscription.terminate();
```

## Complete Track Effect Example

```typescript
import { Project, EffectFactories, InstrumentFactories } from "@opendaw/studio-core";

async function setupTrackWithEffects(project: Project) {
    project.editing.modify(() => {
        // Create a Tape instrument
        const { audioUnitBox, trackBox } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        
        // Set track volume
        audioUnitBox.volume.setValue(-3.0);
        
        // Add a compressor for tone shaping
        const compressor = project.api.insertEffect(
            audioUnitBox.audioDevices,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        compressor.label.setValue("Compressor");
        compressor.threshold.setValue(-15.0);
        compressor.ratio.setValue(4.0);
        compressor.attack.setValue(10.0);
        
        // Add a delay for space
        const delay = project.api.insertEffect(
            audioUnitBox.audioDevices,
            EffectFactories.AudioNamed.Delay,
            1
        );
        delay.label.setValue("Delay");
        delay.wet.setValue(-12.0);
        delay.feedback.setValue(0.4);
        delay.delay.setValue(4);  // Quarter note
        
        // Add reverb at the end
        const reverb = project.api.insertEffect(
            audioUnitBox.audioDevices,
            EffectFactories.AudioNamed.Reverb,
            2
        );
        reverb.label.setValue("Room Reverb");
        reverb.wet.setValue(-6.0);
        reverb.decay.setValue(0.6);
        
        console.log("Track effects setup complete");
        console.log("Chain: Compressor -> Delay -> Reverb");
    });
}
```

## Effect Chain Signal Flow

```
Audio Input from Instrument
         ↓
Compressor (enabled? no → bypass)
         ↓
Delay (enabled? no → bypass)
         ↓
Reverb (enabled? no → bypass)
         ↓
Volume control (audioUnitBox.volume)
         ↓
Mute check (audioUnitBox.mute)
         ↓
Solo check (audioUnitBox.solo)
         ↓
Audio Output
```

## Key Points

1. **AudioUnitBox Contains Effects**
   - Each AudioUnit has an `audioDevices` field
   - This field points to the effect chain

2. **Index-Based Ordering**
   - Effects are processed in index order
   - Reorder by changing `index` field

3. **Enable/Disable Bypassing**
   - `enabled` field controls bypass
   - Disabled effects are not processed

4. **Transactional Updates**
   - All changes must occur in `editing.modify()` transaction
   - Changes apply atomically

5. **Adapters for Observation**
   - Use project.boxAdapters to get adapters
   - Subscribe to changes on adapters

## Performance Considerations

- Effects are chained in order through InsertReturnAudioChain
- Disabled effects don't consume CPU (wiring is invalidated)
- Adding/removing effects invalidates and rebuilds the chain
- Reordering rebuilds the chain at next process phase

## Removing Effects

```typescript
project.editing.modify(() => {
    // Remove effect by setting enabled to false (soft remove/bypass)
    effectBox.enabled.setValue(false);
    
    // Or actually remove from chain (hard remove)
    const audioDevices = audioUnitBox.audioDevices;
    // ... use BoxGraph methods to remove the box
});
```

