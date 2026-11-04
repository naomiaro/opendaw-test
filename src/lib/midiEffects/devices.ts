/**
 * The MIDI effects demo's device registry: the four stock MIDI effects, their copy, and the
 * parameters each card renders, read through the SDK's device adapters so the sliders print the
 * SDK's own strings ("Up", "1/16", "+7 st") instead of raw field values.
 */
import {
  ArpeggioDeviceBox, PitchDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox,
} from "@opendaw/studio-boxes";
import {
  ArpeggioDeviceBoxAdapter, GrooveShuffleBoxAdapter, PitchDeviceBoxAdapter, VelocityDeviceBoxAdapter,
  ZeitgeistDeviceBoxAdapter, type MidiEffectDeviceAdapter,
} from "@opendaw/studio-adapters";
import type { EffectBox, EffectFactories } from "@opendaw/studio-core";
import type { Editing } from "@opendaw/lib-std";
import type { UnitParameter } from "@/lib/parameterBinding";

export type DeviceId = "arpeggio" | "pitch" | "velocity" | "zeitgeist";

/** The two pages whose lanes a device card describes: the MIDI Effects page and the Rendered page. */
export type LanePage = "effects" | "rendered";

/** Tab order on the page. */
export const DEVICE_IDS: readonly DeviceId[] = ["arpeggio", "pitch", "velocity", "zeitgeist"];

/** The entry's name in `EffectFactories`. Kept as a key, not the factory: a value import of
 *  `@opendaw/studio-core` pulls the engine worklet in, which Node (the tests) cannot load. The page
 *  resolves `EffectFactories[factoryKey]`. */
export type FactoryKey = Extract<EffectFactories.MidiEffectKeys, "Arpeggio" | "Pitch" | "Velocity" | "Zeitgeist">;

export interface DeviceSpec {
  readonly id: DeviceId;
  readonly label: string;
  readonly factoryKey: FactoryKey;
  /** What the device does, one or two sentences. */
  readonly what: string;
  /** What to listen for on the patterns, one or two sentences. */
  readonly listenFor: string;
  /** What the page's lower lanes show of the device, per page; null where there is nothing to add. */
  readonly laneNote: Readonly<Record<LanePage, string | null>>;
  /** The insert and one parameter write, as a visitor would code it. */
  readonly snippet: string;
}

const insert = (name: string) =>
  `const field = midiEffectsFieldOf(project, audioUnitBox); // resolve outside the transaction
const box = project.editing
  .modify(() => project.api.insertEffect(field, EffectFactories.${name}))
  .unwrap("insertEffect");`;

export const DEVICES: { readonly [K in DeviceId]: DeviceSpec & { readonly id: K } } = {
  arpeggio: {
    id: "arpeggio",
    label: "Arpeggio",
    factoryKey: "Arpeggio",
    what: "Holds the notes that are down and plays them one at a time on a grid: up, down or up-and-down, over one to five octaves, at a rate from whole notes to 1/128.",
    listenFor: "On Chords, the held triads become running sixteenths. Raise the octaves and the run climbs; drop the gate and the steps get short.",
    laneNote: {
      effects: null,
      rendered: "A gate under 100 % makes every step's timing measured; at 100 % the steps touch and their boundaries come from the device rule, drawn dashed.",
    },
    snippet: `${insert("Arpeggio")}
const arp = project.boxAdapters.adapterFor(box, ArpeggioDeviceBoxAdapter);
project.editing.modify(() => arp.namedParameter.numOctaves.setValue(2));`,
  },
  pitch: {
    id: "pitch",
    label: "Pitch",
    factoryKey: "Pitch",
    what: "Transposes every note before the instrument: whole octaves, semitones and cents. It changes which note the synth plays, not the recording of the audio.",
    listenFor: "On Melody, the tune moves as a block. Cents detune it against the dry version; octaves jump it.",
    laneNote: { effects: null, rendered: null },
    snippet: `${insert("Pitch")}
const pitch = project.boxAdapters.adapterFor(box, PitchDeviceBoxAdapter);
project.editing.modify(() => pitch.namedParameter.semiTones.setValue(7));`,
  },
  velocity: {
    id: "velocity",
    label: "Velocity",
    factoryKey: "Velocity",
    what: "Reshapes each note's velocity: a magnet pulls velocities toward a target, random scatters them, offset shifts them, and mix blends the result with the original.",
    listenFor: "On Sixteenths, a strong magnet flattens the loud-soft alternation. On Melody, random breaks the ramp.",
    laneNote: {
      effects: "The emitted lane here cannot show any of it: it reads which pitches are sounding, not how loud, so its bars break the velocity convention and stay one colour. The Rendered page shows every note's emitted velocity.",
      rendered: "Every note's emitted velocity is the rendered bar's colour and the strip's solid stem against the written ghost; Reseed random reshuffles the scatter.",
    },
    snippet: `${insert("Velocity")}
const vel = project.boxAdapters.adapterFor(box, VelocityDeviceBoxAdapter);
project.editing.modify(() => vel.namedParameter.magnetStrength.setValue(1));`,
  },
  zeitgeist: {
    id: "zeitgeist",
    label: "Zeitgeist",
    factoryKey: "Zeitgeist",
    what: "Applies a shuffle groove to note timing through a Möbius ease: at 50% nothing moves; above it every note between grid lines lands later, below it earlier, and the grid lines themselves stay put.",
    listenFor: "On Sixteenths at 60%, every other note drags late by about 24 ms (47 pulses at 120 bpm). Below 50% the off-beats rush instead.",
    laneNote: {
      effects: "The 24 ms drag is one and a half frames on a 60 Hz display, so the emitted lane shows it only roughly; the placement audit (debug/2026-10-21-midi-effect-placement/note.md) measures it to the frame.",
      rendered: "The rendered lane places every note to the sample: at 60 % on Sixteenths the off-beats sit 47 pulses late.",
    },
    snippet: `${insert("Zeitgeist")}
const zeit = project.boxAdapters.adapterFor(box, ZeitgeistDeviceBoxAdapter);
const groove = zeit.groove(); // the device's own groove box, a GrooveAdapter
if (!(groove instanceof GrooveShuffleBoxAdapter)) throw new Error("not a shuffle groove");
project.editing.modify(() => groove.namedParameter.amount.setValue(0.6));`,
  },
};

export interface DeviceParameter {
  readonly key: string;
  readonly label: string;
  readonly parameter: UnitParameter;
  /** Number of whole values of an integer parameter, so a slider steps over them. */
  readonly positions?: number;
}

/** Which registry entry a box on the chain is, or null for a device the demo does not handle. */
export function deviceIdOf(box: EffectBox): DeviceId | null {
  if (box instanceof ArpeggioDeviceBox) return "arpeggio";
  if (box instanceof PitchDeviceBox) return "pitch";
  if (box instanceof VelocityDeviceBox) return "velocity";
  if (box instanceof ZeitgeistDeviceBox) return "zeitgeist";
  return null;
}

/** The parameters a device's card renders, in card order. */
export function deviceParameters(adapter: MidiEffectDeviceAdapter): DeviceParameter[] {
  if (adapter instanceof ArpeggioDeviceBoxAdapter) {
    const p = adapter.namedParameter;
    return [
      { key: "modeIndex", label: "Mode", parameter: p.modeIndex, positions: 3 },
      { key: "rate", label: "Rate", parameter: p.rate, positions: ArpeggioDeviceBoxAdapter.RateFractions.length },
      { key: "numOctaves", label: "Octaves", parameter: p.numOctaves, positions: 5 },
      { key: "gate", label: "Gate", parameter: p.gate },
      { key: "repeat", label: "Repeat", parameter: p.repeat, positions: 16 },
      { key: "velocity", label: "Velocity", parameter: p.velocity },
    ];
  }
  if (adapter instanceof PitchDeviceBoxAdapter) {
    const p = adapter.namedParameter;
    return [
      { key: "semiTones", label: "Semitones", parameter: p.semiTones, positions: 73 },
      { key: "cent", label: "Cents", parameter: p.cent },
      { key: "octaves", label: "Octaves", parameter: p.octaves, positions: 15 },
    ];
  }
  if (adapter instanceof VelocityDeviceBoxAdapter) {
    const p = adapter.namedParameter;
    return [
      { key: "magnetPosition", label: "Magnet position", parameter: p.magnetPosition },
      { key: "magnetStrength", label: "Magnet strength", parameter: p.magnetStrength },
      { key: "randomAmount", label: "Random", parameter: p.randomAmount },
      { key: "offset", label: "Offset", parameter: p.offset },
      { key: "mix", label: "Mix", parameter: p.mix },
    ];
  }
  if (adapter instanceof ZeitgeistDeviceBoxAdapter) {
    const groove = adapter.groove();
    if (!(groove instanceof GrooveShuffleBoxAdapter)) {
      throw new Error(`Zeitgeist groove is a ${groove.constructor.name}, not a GrooveShuffleBoxAdapter`);
    }
    const p = groove.namedParameter;
    return [
      { key: "amount", label: "Amount", parameter: p.amount },
      { key: "duration", label: "Duration", parameter: p.duration, positions: GrooveShuffleBoxAdapter.DurationStrings.length },
    ];
  }
  throw new Error(`no parameters for ${adapter.constructor.name}`);
}

/** A new random seed for the Velocity device's scatter, never the one it has (the adapter maps 0..0xFFFF). */
export function reseedVelocity(editing: Editing, adapter: VelocityDeviceBoxAdapter): void {
  const current = adapter.box.randomSeed.getValue();
  let next = Math.floor(Math.random() * 0x10000);
  if (next === current) next = (next + 1) & 0xffff;
  editing.modify(() => adapter.box.randomSeed.setValue(next));
}
