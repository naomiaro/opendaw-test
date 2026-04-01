# Spielwerk - Scriptable MIDI Effect

Spielwerk is a scriptable MIDI effect where users write a JavaScript `Processor` class that receives incoming note events and yields transformed or new notes. It sits in the MIDI effect chain before the instrument (e.g., Vaporisateur). Parameters declared via `// @param` comments appear as automatable knobs.

## Factory Reference

```typescript
import { EffectFactories } from "@opendaw/studio-core";

const effectBox = project.api.insertEffect(audioUnitBox.midiEffects, EffectFactories.Spielwerk);
const spielwerkBox = effectBox as SpielwerkDeviceBox;
```

- `defaultName`: "Spielwerk"
- `defaultIcon`: `IconSymbol.Code`
- `briefDescription`: "Scriptable FX"
- `external`: false
- `type`: "midi"

Listed in `EffectFactories.MidiNamed` alongside Arpeggio, Pitch, Velocity, and Zeitgeist.

## Box Fields

| Field | Type | Description |
|-------|------|-------------|
| code | string | JavaScript source code (with compiled header prepended) |
| parameters | pointer collection | `WerkstattParameterBox` instances from `// @param` declarations |
| samples | pointer collection | `WerkstattSampleBox` instances from `// @sample` declarations |

Parameters are fully automatable (same automation system as built-in effects).

## User Processor API

The user must define a `class Processor` with a generator `* process()` method:

```javascript
class Processor {
    // REQUIRED: Generator function called every audio block
    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield event  // pass through note-ons
            }
        }
    }

    // OPTIONAL: Called when a @param knob changes
    paramChanged(label, value) { }

    // OPTIONAL: Called on transport jump or play->pause
    reset() { }
}
```

### `block` Object

| Property | Type | Description |
|----------|------|-------------|
| `from` | number | Start position in ppqn (inclusive), 480 ppqn = 1 quarter note |
| `to` | number | End position in ppqn (exclusive) |
| `bpm` | number | Current tempo |
| `flags` | number | Bitmask: 1=transporting, 2=discontinuous, 4=playing |

### `events` Iterator

A unified stream of note-ons and note-offs:

**Note-on** (`gate: true`):

| Property | Type | Description |
|----------|------|-------------|
| `gate` | true | Note-on indicator |
| `id` | number | Unique note instance identifier |
| `position` | number | Position in ppqn |
| `duration` | number | Duration in ppqn |
| `pitch` | number | MIDI pitch 0-127 |
| `velocity` | number | 0.0-1.0 |
| `cent` | number | Fine pitch offset in cents |

**Note-off** (`gate: false`):

| Property | Type | Description |
|----------|------|-------------|
| `gate` | false | Note-off indicator |
| `id` | number | Matches the note-on id |
| `position` | number | Position in ppqn |
| `pitch` | number | MIDI pitch 0-127 |

### Yielded Output Notes

Output notes do not need `gate` or `id` — the engine manages note lifecycle:

```javascript
yield { position, duration, pitch, velocity, cent }
```

**Position rules:**
- `position >= block.from` and `< block.to` — emitted immediately
- `position >= block.to` — held in internal scheduler, emitted in future block
- `position < block.from` — **ERROR**, processor silenced

## Parameter Declarations (`// @param`)

Same syntax as Werkstatt. See [07-werkstatt.md](./07-werkstatt.md#parameter-declarations--param) for full reference.

### Quick Reference

```
// @param <name> [default] [min max type [unit]]
```

| Declaration | Result |
|---|---|
| `// @param amount` | Unipolar 0-1, default 0 |
| `// @param amount 0.5` | Unipolar 0-1, default 0.5 |
| `// @param delay 120 24 480 int ppqn` | Integer 24-480, default 120, unit "ppqn" |
| `// @param freq 440 20 20000 exp Hz` | Exponential 20-20000, default 440 |
| `// @param bypass false` | Boolean, default Off |

Types: `linear`, `exp`, `int`, `bool` (or omit for unipolar 0-1).

## Safety Constraints

- Code runs in the AudioWorklet thread — no DOM, no fetch, no setTimeout, no imports
- `MAX_NOTES_PER_BLOCK = 128` — silences processor if exceeded
- `MAX_SCHEDULED_NOTES = 128` — silences if scheduler queue overflows
- All yielded notes validated: pitch 0-127, velocity 0.0-1.0, positive duration, position not in past, NaN detection
- Runtime errors caught and reported via `engine.subscribeDeviceMessage(uuid, listener)`
- On transport discontinuity or play-to-pause: all retained notes released, scheduler cleared, `reset()` called

## Examples

### Default — Passthrough

```javascript
class Processor {
    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield event
            }
        }
    }
}
```

### Chord Generator

```javascript
// @param mode 0 0 3 int

class Processor {
    mode = 0

    paramChanged(label, value) {
        if (label === "mode") this.mode = value
    }

    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield event  // root note
                const intervals = [
                    [4, 7],       // major
                    [3, 7],       // minor
                    [4, 7, 11],   // major 7th
                    [3, 7, 10],   // minor 7th
                ][this.mode]
                for (const interval of intervals) {
                    yield {
                        position: event.position,
                        duration: event.duration,
                        pitch: event.pitch + interval,
                        velocity: event.velocity * 0.8,
                        cent: 0
                    }
                }
            }
        }
    }
}
```

### Probability Gate

```javascript
// @param chance 0.5

class Processor {
    chance = 0.5

    paramChanged(label, value) {
        if (label === "chance") this.chance = value
    }

    * process(block, events) {
        for (const event of events) {
            if (event.gate && Math.random() < this.chance) {
                yield event
            }
        }
    }
}
```

### Echo / Note Delay

```javascript
// @param repeats 3 1 8 int
// @param delay 240 60 960 int ppqn
// @param decay 0.7

class Processor {
    repeats = 3
    delay = 240
    decay = 0.7

    paramChanged(label, value) {
        if (label === "repeats") this.repeats = value
        if (label === "delay") this.delay = value
        if (label === "decay") this.decay = value
    }

    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield event  // original note
                let vel = event.velocity
                for (let r = 1; r <= this.repeats; r++) {
                    vel *= this.decay
                    if (vel < 0.01) break
                    yield {
                        position: event.position + this.delay * r,
                        duration: event.duration,
                        pitch: event.pitch,
                        velocity: vel,
                        cent: 0
                    }
                }
            }
        }
    }
}
```

## Built-in Example Scripts (in SDK app)

1. **Chord Generator** — generates major/minor/7th chords from single notes
2. **Velocity** — target-based velocity mapping with strength, random, offset, dry/wet
3. **Pitch** — transpose by octaves, semitones, and cents
4. **Random Humanizer** — random timing jitter and velocity variation
5. **Probability Gate** — randomly filters notes based on chance parameter
6. **Echo / Note Delay** — repeated delayed copies with decaying velocity
7. **Pitch Range Filter** — only passes notes within a pitch range
8. **303 Sequencer** — autonomous step sequencer with deterministic pseudo-random patterns

## Source Code

- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/midi-effects/SpielwerkDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/midi-effects/SpielwerkDeviceBoxAdapter.ts`
- Processor: `/openDAW/packages/studio/core-processors/src/devices/midi-effects/SpielwerkDeviceProcessor.ts`
- Compiler: `/openDAW/packages/studio/adapters/src/ScriptCompiler.ts` (shared with Werkstatt)
- Declarations: `/openDAW/packages/studio/adapters/src/ScriptDeclaration.ts` (shared)
- Default Code: `/openDAW/packages/app/studio/src/ui/devices/midi-effects/spielwerk-default.js`
- Examples: `/openDAW/packages/app/studio/src/ui/devices/midi-effects/examples/`
- AI Starter Prompt: `/openDAW/packages/app/studio/src/ui/devices/midi-effects/spielwerk-starter-prompt.txt`
