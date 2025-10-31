# Complete Code Examples for Adding Effects

This document provides complete, copy-paste ready code examples for adding effects to the demo.

## Example 1: Simple Single Effect on a Track

```typescript
import { Project, EffectFactories, InstrumentFactories } from "@opendaw/studio-core";

async function addReverbToTrack(project: Project) {
    project.editing.modify(() => {
        // Create a track with an instrument
        const { audioUnitBox } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        
        // Add reverb to the track
        const reverb = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Reverb
        );

        // Customize the reverb
        reverb.label.setValue("Room Reverb");
        reverb.wet.setValue(-6.0);  // Subtle effect
        reverb.decay.setValue(0.5);
    });
}
```

## Example 2: Effect Chain on Single Track

```typescript
import { Project, EffectFactories, InstrumentFactories } from "@opendaw/studio-core";

async function createTrackWithEffectChain(project: Project) {
    project.editing.modify(() => {
        // Create track
        const { audioUnitBox } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        
        // Add compressor at start of chain
        const compressor = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        compressor.label.setValue("Compressor");
        compressor.threshold.setValue(-15.0);
        compressor.ratio.setValue(4.0);

        // Add delay in middle
        const delay = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Delay,
            1
        );
        delay.label.setValue("Delay");
        delay.wet.setValue(-12.0);
        delay.feedback.setValue(0.4);

        // Add reverb at end
        const reverb = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Reverb,
            2
        );
        reverb.label.setValue("Reverb");
        reverb.wet.setValue(-6.0);
        
        console.log("Effect chain created: Compressor -> Delay -> Reverb");
    });
}
```

## Example 3: Master Bus Effects (Global Processing)

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

async function setupMasterEffects(project: Project) {
    project.editing.modify(() => {
        const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

        if (!masterAudioUnit) {
            console.error("Could not find master audio unit");
            return;
        }

        // Set master volume
        masterAudioUnit.volume.setValue(-6.0);

        // Add mastering chain

        // 1. Parametric EQ for tone shaping
        const eq = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Revamp,
            0
        );
        eq.label.setValue("Master EQ");

        // 2. Compression for glue
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

        // 3. Limiter for safety
        const limiter = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            2
        );
        limiter.label.setValue("Master Limiter");
        limiter.threshold.setValue(-0.5);
        limiter.ratio.setValue(20.0);
        limiter.attack.setValue(0.5);
        
        console.log("Master mastering chain created");
    });
}
```

## Example 4: Multiple Tracks with Different Effects

```typescript
import { 
    Project, 
    EffectFactories, 
    InstrumentFactories 
} from "@opendaw/studio-core";

async function createMultiTrackSetup(project: Project) {
    project.editing.modify(() => {
        // Track 1: Drums with compression and reverb
        const { audioUnitBox: drumsUnit } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        drumsUnit.volume.setValue(-3.0);
        
        const drumsCompressor = project.api.insertEffect(
            drumsUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        drumsCompressor.label.setValue("Drums Compressor");
        drumsCompressor.threshold.setValue(-20.0);
        drumsCompressor.ratio.setValue(6.0);

        const drumsReverb = project.api.insertEffect(
            drumsUnit.audioEffects,
            EffectFactories.AudioNamed.Reverb,
            1
        );
        drumsReverb.label.setValue("Drums Reverb");
        drumsReverb.wet.setValue(-12.0);

        // Track 2: Bass with compression only
        const { audioUnitBox: bassUnit } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        bassUnit.volume.setValue(-6.0);

        const bassCompressor = project.api.insertEffect(
            bassUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        bassCompressor.label.setValue("Bass Compressor");
        bassCompressor.threshold.setValue(-12.0);
        bassCompressor.ratio.setValue(4.0);

        // Track 3: Vocals with delay and reverb
        const { audioUnitBox: vocalsUnit } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        vocalsUnit.volume.setValue(-3.0);

        const vocalsDelay = project.api.insertEffect(
            vocalsUnit.audioEffects,
            EffectFactories.AudioNamed.Delay,
            0
        );
        vocalsDelay.label.setValue("Vocals Delay");
        vocalsDelay.wet.setValue(-18.0);
        vocalsDelay.feedback.setValue(0.3);

        const vocalsReverb = project.api.insertEffect(
            vocalsUnit.audioEffects,
            EffectFactories.AudioNamed.Reverb,
            1
        );
        vocalsReverb.label.setValue("Vocals Reverb");
        vocalsReverb.wet.setValue(-6.0);
        vocalsReverb.decay.setValue(0.7);
        
        console.log("Multi-track setup complete");
    });
}
```

## Example 5: Interactive Effect Control with Subscriptions

```typescript
import { Project, EffectFactories, InstrumentFactories } from "@opendaw/studio-core";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";

async function createInteractiveEffects(
    project: Project,
    onEffectAdded?: (name: string) => void
) {
    // Create track with delay
    const { audioUnitBox } = await new Promise<any>(resolve => {
        project.editing.modify(() => {
            const result = project.api.createInstrument(InstrumentFactories.Tape);
            resolve(result);
        });
    });
    
    // Subscribe to effect chain changes
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    const chainSubscription = effectAdapters.catchupAndSubscribe({
        onAdd: (effectAdapter) => {
            const effectName = effectAdapter.labelField.getValue();
            console.log("Effect added to track:", effectName);
            onEffectAdded?.(effectName);
            
            // Subscribe to this effect's enable state
            const enableSubscription = effectAdapter.enabledField.catchupAndSubscribe(obs => {
                console.log(`${effectName} ${obs.getValue() ? "enabled" : "disabled"}`);
            });
        },
        onRemove: (effectAdapter) => {
            console.log("Effect removed:", effectAdapter.labelField.getValue());
        },
        onReorder: (effectAdapter) => {
            console.log("Effect reordered:", effectAdapter.labelField.getValue());
        }
    });
    
    // Add an effect
    project.editing.modify(() => {
        const delay = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Delay
        );
        delay.label.setValue("Interactive Delay");
    });
    
    return {
        audioUnitBox,
        cleanup: () => chainSubscription.terminate()
    };
}
```

## Example 6: Dynamic Effect Creation Based on User Input

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

async function addEffectByName(
    project: Project,
    audioUnitBox: any,
    effectType: string,
    position: number = -1
): Promise<boolean> {
    const factoryMap = {
        "compressor": EffectFactories.AudioNamed.Compressor,
        "delay": EffectFactories.AudioNamed.Delay,
        "reverb": EffectFactories.AudioNamed.Reverb,
        "eq": EffectFactories.AudioNamed.Revamp,
        "crusher": EffectFactories.AudioNamed.Crusher,
        "fold": EffectFactories.AudioNamed.Fold,
        "stereo": EffectFactories.AudioNamed.StereoTool
    };
    
    const factory = factoryMap[effectType.toLowerCase()];
    if (!factory) {
        console.error(`Unknown effect type: ${effectType}`);
        return false;
    }
    
    let success = false;
    project.editing.modify(() => {
        try {
            const effect = position >= 0
                ? project.api.insertEffect(audioUnitBox.audioEffects, factory, position)
                : project.api.insertEffect(audioUnitBox.audioEffects, factory);
            
            effect.label.setValue(`${factory.defaultName}`);
            console.log(`Added ${effectType} effect`);
            success = true;
        } catch (error) {
            console.error(`Failed to add effect: ${error}`);
        }
    });
    
    return success;
}

// Usage example
async function demoEffectCreation(project: Project, audioUnitBox: any) {
    await addEffectByName(project, audioUnitBox, "compressor", 0);
    await addEffectByName(project, audioUnitBox, "delay", 1);
    await addEffectByName(project, audioUnitBox, "reverb", 2);
}
```

## Example 7: Effect Preset Configuration

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

interface EffectPreset {
    name: string;
    type: string;
    parameters: Record<string, number | boolean>;
}

const presets: Record<string, EffectPreset> = {
    "vocal_enhancement": {
        name: "Vocal Enhancement",
        type: "compressor",
        parameters: {
            threshold: -15.0,
            ratio: 3.0,
            attack: 10.0,
            release: 100.0,
            makeup: 6.0
        }
    },
    "spacious_reverb": {
        name: "Spacious Reverb",
        type: "reverb",
        parameters: {
            wet: -6.0,
            decay: 0.8,
            preDelay: 0.05,
            damp: 0.3
        }
    },
    "rhythmic_delay": {
        name: "Rhythmic Delay",
        type: "delay",
        parameters: {
            wet: -12.0,
            feedback: 0.5,
            cross: 0.0,
            delay: 4  // Quarter note
        }
    }
};

async function applyPreset(
    project: Project,
    audioUnitBox: any,
    presetName: string
): Promise<boolean> {
    const preset = presets[presetName];
    if (!preset) {
        console.error(`Unknown preset: ${presetName}`);
        return false;
    }
    
    const factoryMap = {
        "compressor": EffectFactories.AudioNamed.Compressor,
        "delay": EffectFactories.AudioNamed.Delay,
        "reverb": EffectFactories.AudioNamed.Reverb,
        "eq": EffectFactories.AudioNamed.Revamp
    };
    
    const factory = factoryMap[preset.type];
    if (!factory) return false;
    
    let success = false;
    project.editing.modify(() => {
        try {
            const effect = project.api.insertEffect(
                audioUnitBox.audioEffects,
                factory
            );
            effect.label.setValue(preset.name);
            
            // Apply preset parameters
            Object.entries(preset.parameters).forEach(([paramName, value]) => {
                if (paramName in effect) {
                    (effect as any)[paramName].setValue(value);
                }
            });
            
            console.log(`Applied preset: ${presetName}`);
            success = true;
        } catch (error) {
            console.error(`Failed to apply preset: ${error}`);
        }
    });
    
    return success;
}

// Usage
async function demoPresets(project: Project, audioUnitBox: any) {
    await applyPreset(project, audioUnitBox, "vocal_enhancement");
    await applyPreset(project, audioUnitBox, "spacious_reverb");
    await applyPreset(project, audioUnitBox, "rhythmic_delay");
}
```

## Example 8: Real-Time Parameter Automation

```typescript
import { Project, EffectFactories, InstrumentFactories } from "@opendaw/studio-core";

async function demonstrateParameterAutomation(project: Project) {
    const { audioUnitBox } = project.api.createInstrument(
        InstrumentFactories.Tape
    );
    
    // Add reverb
    const reverb = project.api.insertEffect(
        audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Reverb
    );
    
    // Subscribe to wet parameter changes
    const wetSubscription = reverb.wet.catchupAndSubscribe(obs => {
        console.log("Reverb wet level:", obs.getValue(), "dB");
    });
    
    // Simulate parameter changes over time
    const automationSequence = [
        { delay: 0, wet: -24.0 },
        { delay: 1000, wet: -12.0 },
        { delay: 2000, wet: -6.0 },
        { delay: 3000, wet: -12.0 },
        { delay: 4000, wet: -24.0 }
    ];
    
    for (const step of automationSequence) {
        await new Promise(resolve => setTimeout(resolve, step.delay));
        
        project.editing.modify(() => {
            reverb.wet.setValue(step.wet);
        });
    }
    
    // Cleanup
    wetSubscription.terminate();
}
```

## Example 9: Effect Chain Analysis and Control

```typescript
import { Project } from "@opendaw/studio-core";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";

function analyzeEffectChain(project: Project, audioUnitBox: any) {
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    
    console.log("=== Effect Chain Analysis ===");
    console.log(`Total effects: ${effectAdapters.length}`);
    
    effectAdapters.forEach((adapter, index) => {
        const label = adapter.labelField.getValue();
        const enabled = adapter.enabledField.getValue();
        const type = adapter.type;
        
        console.log(`[${index}] ${label} (${type}) - ${enabled ? "ON" : "OFF"}`);
    });
}

function disableAllEffects(project: Project, audioUnitBox: any) {
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    
    project.editing.modify(() => {
        effectAdapters.forEach(adapter => {
            adapter.enabledField.setValue(false);
        });
    });
    
    console.log("All effects disabled");
}

function enableAllEffects(project: Project, audioUnitBox: any) {
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    
    project.editing.modify(() => {
        effectAdapters.forEach(adapter => {
            adapter.enabledField.setValue(true);
        });
    });
    
    console.log("All effects enabled");
}

function reorderEffectChain(
    project: Project,
    audioUnitBox: any,
    newOrder: number[]  // Array of current indices in new order
) {
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    
    project.editing.modify(() => {
        newOrder.forEach((currentIndex, newIndex) => {
            const adapter = effectAdapters[currentIndex];
            adapter.indexField.setValue(newIndex);
        });
    });
    
    console.log("Effect chain reordered");
}
```

## Example 10: Effects Demo Integration (Complete Example)

```typescript
import React, { useEffect, useState } from "react";
import { Project, EffectFactories, InstrumentFactories } from "@opendaw/studio-core";

interface EffectsDemo {
    project: Project;
    addEffect: (effectType: string) => void;
    removeEffect: (effectName: string) => void;
    analyzeChain: () => void;
}

export function useEffectsDemo(project: Project | null): EffectsDemo {
    const [audioUnitBox, setAudioUnitBox] = useState<any>(null);
    
    // Initialize demo on mount
    useEffect(() => {
        if (!project) return;
        
        project.editing.modify(() => {
            const { audioUnitBox: unit } = project.api.createInstrument(
                InstrumentFactories.Tape
            );
            setAudioUnitBox(unit);
        });
    }, [project]);
    
    const addEffect = (effectType: string) => {
        if (!project || !audioUnitBox) return;
        
        const effectMap = {
            "compressor": EffectFactories.AudioNamed.Compressor,
            "delay": EffectFactories.AudioNamed.Delay,
            "reverb": EffectFactories.AudioNamed.Reverb,
            "eq": EffectFactories.AudioNamed.Revamp
        };
        
        const factory = effectMap[effectType as keyof typeof effectMap];
        if (!factory) return;
        
        project.editing.modify(() => {
            const effect = project.api.insertEffect(
                audioUnitBox.audioEffects,
                factory
            );
            effect.label.setValue(factory.defaultName);
        });
    };
    
    const removeEffect = (effectName: string) => {
        if (!project || !audioUnitBox) return;
        
        const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
        const targetAdapter = effectAdapters.find(
            a => a.labelField.getValue() === effectName
        );
        
        if (targetAdapter) {
            project.editing.modify(() => {
                targetAdapter.enabledField.setValue(false);
            });
        }
    };
    
    const analyzeChain = () => {
        if (!project || !audioUnitBox) return;
        
        const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
        console.log(`Current effect chain has ${effectAdapters.length} effects`);
        
        effectAdapters.forEach((adapter, i) => {
            console.log(
                `  [${i}] ${adapter.labelField.getValue()} (${adapter.enabledField.getValue() ? "on" : "off"})`
            );
        });
    };
    
    return {
        project: project!,
        addEffect,
        removeEffect,
        analyzeChain
    };
}

// Usage in component
function EffectsDemo() {
    const [project, setProject] = useState<Project | null>(null);
    const effects = useEffectsDemo(project);
    
    return (
        <div>
            <button onClick={() => effects.addEffect("compressor")}>
                Add Compressor
            </button>
            <button onClick={() => effects.addEffect("delay")}>
                Add Delay
            </button>
            <button onClick={() => effects.addEffect("reverb")}>
                Add Reverb
            </button>
            <button onClick={() => effects.analyzeChain()}>
                Show Chain
            </button>
        </div>
    );
}
```

## Common Patterns

### Getting Current Parameter Value
```typescript
const compressor = /* ... */;
const currentThreshold = compressor.threshold.getValue();
```

### Changing Parameter with Bound Checking
```typescript
project.editing.modify(() => {
    const min = -60.0, max = 0.0;
    const newValue = Math.max(min, Math.min(max, userValue));
    compressor.threshold.setValue(newValue);
});
```

### Getting All Effects of Specific Type
```typescript
const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
const compressors = effectAdapters.filter(
    a => a.box instanceof CompressorDeviceBox
);
```

### Applying Same Settings to Multiple Effects
```typescript
project.editing.modify(() => {
    const compression = {
        threshold: -15.0,
        ratio: 4.0,
        attack: 10.0
    };
    
    effectAdapters.forEach(adapter => {
        if (adapter.type === "compressor") {
            adapter.namedParameter.threshold.setValue(compression.threshold);
            adapter.namedParameter.ratio.setValue(compression.ratio);
            adapter.namedParameter.attack.setValue(compression.attack);
        }
    });
});
```

## Best Practices

1. Always wrap changes in `project.editing.modify()` transaction
2. Use factory references instead of hardcoding effect creation
3. Subscribe to changes for real-time updates
4. Unsubscribe/terminate when done
5. Use adapter pattern for UI binding
6. Keep effect chain order logical (EQ -> Compression -> Reverb)
7. Test with actual audio for parameter ranges
8. Document custom effect presets

