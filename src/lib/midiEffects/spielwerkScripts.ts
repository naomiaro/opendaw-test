/**
 * The Spielwerk demo's pre-built scripts and its API reference, as data. Every script is a plain
 * `class Processor` with a `* process(block, events)` generator, the shape the SDK's script header
 * wraps; `// @param` lines declare knobs (`// @param <name> <default> <min> <max> [type] [unit]`),
 * `// @no-pass` stops the device from forwarding its input. The runtime's rules the scripts obey:
 * a yielded note needs pitch 0..127, velocity 0..1, a positive duration, and a position at or after
 * `block.from` (a position in the past silences the device); a position past `block.to` is kept and
 * played in a later block. The runtime is the SDK's `script-spielwerk` bridge; the reference text here
 * is this repo's own wording.
 */

export type ScriptId = "echo" | "chord" | "humanize" | "octave-jump" | "strum" | "note-filter" | "blank";

export interface SpielwerkScript {
  id: ScriptId;
  label: string;
  blurb: string;
  source: string;
  /** The `@param` labels, in declaration order. */
  params: readonly string[];
}

const ECHO = `// @param delay 240 60 960 int pulses
// @param repeats 3 1 8 int
// @param decay 0.6
// The original is forwarded (no @no-pass); the copies are added on top.
class Processor {
    delay = 240
    repeats = 3
    decay = 0.6
    paramChanged(label, value) { this[label] = value }
    * process(block, events) {
        for (const event of events) {
            if (!event.gate) continue
            for (let i = 1; i <= this.repeats; i++) {
                yield {
                    position: event.position + i * this.delay,
                    duration: Math.min(event.duration, this.delay),
                    pitch: event.pitch,
                    velocity: Math.max(0.02, event.velocity * Math.pow(this.decay, i)),
                    cent: event.cent
                }
            }
        }
    }
}
`;

const CHORD = `// @param interval1 4 1 12 int st
// @param interval2 7 1 12 int st
// The root is forwarded; two more notes are yielded above it.
class Processor {
    interval1 = 4
    interval2 = 7
    paramChanged(label, value) { this[label] = value }
    * process(block, events) {
        for (const event of events) {
            if (!event.gate) continue
            for (const interval of [this.interval1, this.interval2]) {
                const pitch = event.pitch + interval
                if (pitch > 127) continue
                yield { position: event.position, duration: event.duration, pitch, velocity: event.velocity, cent: event.cent }
            }
        }
    }
}
`;

const HUMANIZE = `// @no-pass
// @param timing 30 0 120 int pulses
// @param velocity 0.2
// Every note-on is re-yielded a little late (never early: a position before the
// block's start silences the device) and a little louder or softer.
class Processor {
    timing = 30
    velocity = 0.2
    paramChanged(label, value) { this[label] = value }
    * process(block, events) {
        for (const event of events) {
            if (!event.gate) continue
            const nudge = Math.random() * this.timing
            const scatter = (Math.random() - 0.5) * this.velocity
            yield {
                position: event.position + nudge,
                duration: event.duration,
                pitch: event.pitch,
                velocity: Math.min(1, Math.max(0.05, event.velocity + scatter)),
                cent: event.cent
            }
        }
    }
}
`;

const OCTAVE_JUMP = `// @no-pass
// @param every 3 2 8 int
// Counts note-ons; every Nth goes up an octave. reset() runs on a transport
// jump or stop, so the count starts over with the pattern.
class Processor {
    every = 3
    count = 0
    paramChanged(label, value) { this[label] = value }
    reset() { this.count = 0 }
    * process(block, events) {
        for (const event of events) {
            if (!event.gate) continue
            this.count++
            const jump = this.count % this.every === 0 && event.pitch + 12 <= 127
            yield {
                position: event.position,
                duration: event.duration,
                pitch: jump ? event.pitch + 12 : event.pitch,
                velocity: event.velocity,
                cent: event.cent
            }
        }
    }
}
`;

const STRUM = `// @no-pass
// @param spread 60 0 240 int pulses
// Note-ons that share a position are a chord: they are spread low to high,
// each one \`spread\` pulses after the last, and shortened so they still end together.
class Processor {
    spread = 60
    paramChanged(label, value) { this[label] = value }
    * process(block, events) {
        const chords = new Map()
        for (const event of events) {
            if (!event.gate) continue
            if (!chords.has(event.position)) chords.set(event.position, [])
            chords.get(event.position).push(event)
        }
        for (const [position, notes] of chords) {
            notes.sort((a, b) => a.pitch - b.pitch)
            for (let k = 0; k < notes.length; k++) {
                const note = notes[k]
                const offset = k * this.spread
                yield {
                    position: position + offset,
                    duration: Math.max(30, note.duration - offset),
                    pitch: note.pitch,
                    velocity: note.velocity,
                    cent: note.cent
                }
            }
        }
    }
}
`;

const NOTE_FILTER = `// @no-pass
// @param root 0 0 11 int
// Only the notes of the major scale on \`root\` get through (0 = C).
class Processor {
    root = 0
    scale = [0, 2, 4, 5, 7, 9, 11]
    paramChanged(label, value) { this[label] = value }
    * process(block, events) {
        for (const event of events) {
            if (!event.gate) continue
            const degree = ((event.pitch - this.root) % 12 + 12) % 12
            if (!this.scale.includes(degree)) continue
            yield { position: event.position, duration: event.duration, pitch: event.pitch, velocity: event.velocity, cent: event.cent }
        }
    }
}
`;

const BLANK = `// Without @no-pass the device forwards every note it receives, and whatever
// process() yields is added on top. Yield nothing and the device is transparent.
//
// Declare a knob:   // @param name default min max [int|exp|bool] [unit]
// A note-on event:  { gate: true, id, position, duration, pitch, velocity, cent }
// A note-off event: { gate: false, id, position, pitch }
// A yielded note:   { position, duration, pitch, velocity, cent }
//                   position >= block.from (never in the past), may be past block.to
class Processor {
    paramChanged(label, value) {}
    reset() {}
    * process(block, events) {
        for (const event of events) {
            // yield { ...event }
        }
    }
}
`;

export const SPIELWERK_SCRIPTS: readonly SpielwerkScript[] = [
  {
    id: "echo",
    label: "Echo",
    blurb: "Forwards each note and yields copies after it, each a step later and quieter. Repeats at 1/16 give a delay line; at 1/4 a canon.",
    source: ECHO,
    params: ["delay", "repeats", "decay"],
  },
  {
    id: "chord",
    label: "Chord",
    blurb: "Yields two notes above every note-on at the intervals set, the root forwarded as written. 4 and 7 is a major triad; 3 and 7 minor.",
    source: CHORD,
    params: ["interval1", "interval2"],
  },
  {
    id: "humanize",
    label: "Humanize",
    blurb: "Takes the notes over and re-yields each one a random few pulses late and a random amount louder or softer. The melody stops sounding sequenced.",
    source: HUMANIZE,
    params: ["timing", "velocity"],
  },
  {
    id: "octave-jump",
    label: "Octave jump",
    blurb: "Counts note-ons and sends every Nth one up an octave. Shows reset(): the count restarts with the loop.",
    source: OCTAVE_JUMP,
    params: ["every"],
  },
  {
    id: "strum",
    label: "Strum",
    blurb: "Notes that start together are a chord: they are spread low to high a few pulses apart, as a guitar would. Try it on the Chords pattern.",
    source: STRUM,
    params: ["spread"],
  },
  {
    id: "note-filter",
    label: "Note filter",
    blurb: "Lets through only the notes of a major scale and drops the rest. Set the root away from C to hear the melody thin out.",
    source: NOTE_FILTER,
    params: ["root"],
  },
  {
    id: "blank",
    label: "Blank",
    blurb: "The forwarding shell with the event shapes in comments. Start here for a script of your own.",
    source: BLANK,
    params: [],
  },
];

export function scriptById(id: ScriptId): SpielwerkScript {
  const script = SPIELWERK_SCRIPTS.find((s) => s.id === id);
  if (script === undefined) throw new Error(`unknown script "${id}"`);
  return script;
}

export interface ReferenceEntry {
  name: string;
  signature: string;
  doc: string;
  /** A complete Processor the editor can load. */
  example: string;
}

const example = (body: string) => `${body.trim()}\n`;

export const SPIELWERK_REFERENCE: readonly ReferenceEntry[] = [
  {
    name: "process",
    signature: "* process(block, events)",
    doc: "Required, and a generator. Called once per render block with the block's note events; every note it yields is sent to the instrument.",
    example: example(`
class Processor {
    * process(block, events) {
        for (const event of events) {
            if (event.gate) yield { position: event.position, duration: event.duration, pitch: event.pitch + 12, velocity: event.velocity, cent: event.cent }
        }
    }
}`),
  },
  {
    name: "block",
    signature: "block.from · block.to · block.bpm · block.flags",
    doc: "The block's position range in pulses (to is exclusive), the tempo, and flags: 1 transporting, 2 discontinuous (a seek or a loop wrap).",
    example: example(`
// Yields one note on every beat the block crosses, from the block's own range.
class Processor {
    * process(block, events) {
        const beat = 960
        for (let p = Math.ceil(block.from / beat) * beat; p < block.to; p += beat) {
            yield { position: p, duration: beat / 2, pitch: 60, velocity: 0.7, cent: 0 }
        }
    }
}`),
  },
  {
    name: "events",
    signature: "{ gate: true, id, position, duration, pitch, velocity, cent } · { gate: false, id, position, pitch }",
    doc: "Note-ons and note-offs inside the block, in time order. A note-on carries its full duration. Match a note-off to its note-on by id, not by pitch.",
    example: example(`
// Holds a note's velocity by id so the note-off can log it.
class Processor {
    held = new Map()
    reset() { this.held.clear() }
    * process(block, events) {
        for (const event of events) {
            if (event.gate) this.held.set(event.id, event.velocity)
            else this.held.delete(event.id)
        }
    }
}`),
  },
  {
    name: "yield",
    signature: "yield { position, duration, pitch, velocity, cent }",
    doc: "Pitch 0 to 127, velocity 0 to 1, a positive duration in pulses. The position may lie past the block's end (the note is kept and played when its block comes) but never before the block's start: a note in the past silences the device.",
    example: example(`
// A copy of every note a beat later.
class Processor {
    * process(block, events) {
        for (const event of events) {
            if (event.gate) yield { position: event.position + 960, duration: event.duration, pitch: event.pitch, velocity: event.velocity, cent: event.cent }
        }
    }
}`),
  },
  {
    name: "@no-pass",
    signature: "// @no-pass",
    doc: "By default the device forwards every incoming note and adds the yields on top. With this line it emits only what the script yields; a script that yields nothing is then silent.",
    example: example(`
// @no-pass
// Only the top note of a chord gets through.
class Processor {
    * process(block, events) {
        let top = null
        for (const event of events) {
            if (event.gate && (top === null || event.pitch > top.pitch)) top = event
        }
        if (top) yield { position: top.position, duration: top.duration, pitch: top.pitch, velocity: top.velocity, cent: top.cent }
    }
}`),
  },
  {
    name: "@param",
    signature: "// @param <name> <default> <min> <max> [int|exp|bool] [unit]",
    doc: "Declares a knob. With only a name it is unipolar 0 to 1; with a default and a range it is linear, or integer, exponential or boolean by the flag. The page shows a slider per declaration.",
    example: example(`
// @param semitones 7 -24 24 int st
class Processor {
    semitones = 7
    paramChanged(label, value) { this[label] = value }
    * process(block, events) {
        for (const event of events) {
            if (!event.gate) continue
            const pitch = Math.min(127, Math.max(0, event.pitch + this.semitones))
            yield { position: event.position, duration: event.duration, pitch, velocity: event.velocity, cent: event.cent }
        }
    }
}`),
  },
  {
    name: "paramChanged",
    signature: "paramChanged(label, value)",
    doc: "Called when a knob moves, with the declared name and the mapped value (0 to 1 for unipolar, min to max for a ranged one, an integer for int, 0 or 1 for bool). Store it on the instance.",
    example: example(`
// @param gain
class Processor {
    gain = 0.5
    paramChanged(label, value) { if (label === "gain") this.gain = value }
    * process(block, events) {
        for (const event of events) {
            if (event.gate) yield { position: event.position, duration: event.duration, pitch: event.pitch, velocity: event.velocity * this.gain, cent: event.cent }
        }
    }
}`),
  },
  {
    name: "reset",
    signature: "reset()",
    doc: "Called when the transport stops or jumps (a seek, a loop wrap). Clear counters and anything held, so the pattern starts over clean.",
    example: example(`
// @no-pass
// Every other note-on is dropped; the alternation restarts with the loop.
class Processor {
    odd = false
    reset() { this.odd = false }
    * process(block, events) {
        for (const event of events) {
            if (!event.gate) continue
            this.odd = !this.odd
            if (this.odd) yield { position: event.position, duration: event.duration, pitch: event.pitch, velocity: event.velocity, cent: event.cent }
        }
    }
}`),
  },
  {
    name: "pulses",
    signature: "960 per quarter note",
    doc: "Positions and durations are in pulses, 960 to a quarter note at any tempo: a sixteenth is 240, an eighth 480, a bar of 4/4 is 3840. Seconds come from block.bpm: pulses × 60 / (bpm × 960).",
    example: example(`
// Rounds every note-on to the nearest sixteenth.
class Processor {
    * process(block, events) {
        for (const event of events) {
            if (!event.gate) continue
            const position = Math.max(block.from, Math.round(event.position / 240) * 240)
            yield { position, duration: event.duration, pitch: event.pitch, velocity: event.velocity, cent: event.cent }
        }
    }
}`),
  },
];
