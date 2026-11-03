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
import type { EffectBox } from "@opendaw/studio-core";
import type { UnitParameter } from "@/lib/parameterBinding";

export type DeviceId = "arpeggio" | "pitch" | "velocity" | "zeitgeist";

/** Tab order on the page. */
export const DEVICE_IDS: readonly DeviceId[] = ["arpeggio", "pitch", "velocity", "zeitgeist"];

/** The entry's name in `EffectFactories`. Kept as a key, not the factory: a value import of
 *  `@opendaw/studio-core` pulls the engine worklet in, which Node (the tests) cannot load. The page
 *  resolves `EffectFactories[factoryKey]`. */
export type FactoryKey = "Arpeggio" | "Pitch" | "Velocity" | "Zeitgeist";

export interface DeviceSpec {
  id: DeviceId;
  label: string;
  factoryKey: FactoryKey;
  /** What the device does, one or two sentences. */
  what: string;
  /** What to listen for on the patterns, one or two sentences. */
  listenFor: string;
  /** The insert and one parameter write, as a visitor would code it. */
  snippet: string;
}

const insert = (name: string) =>
  `const field = midiEffectsFieldOf(project, audioUnitBox); // resolve outside the transaction
const box = project.editing
  .modify(() => project.api.insertEffect(field, EffectFactories.${name}))
  .unwrap("insertEffect");`;

export const DEVICES: Readonly<Record<DeviceId, DeviceSpec>> = {
  arpeggio: {
    id: "arpeggio",
    label: "Arpeggio",
    factoryKey: "Arpeggio",
    what: "Holds the notes that are down and plays them one at a time on a grid: up, down or up-and-down, over one to five octaves, at a rate from whole notes to 1/64.",
    listenFor: "On Chords, the held triads become running sixteenths. Raise the octaves and the run climbs; drop the gate and the steps get short.",
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
    snippet: `${insert("Pitch")}
const pitch = project.boxAdapters.adapterFor(box, PitchDeviceBoxAdapter);
project.editing.modify(() => pitch.namedParameter.semiTones.setValue(7));`,
  },
  velocity: {
    id: "velocity",
    label: "Velocity",
    factoryKey: "Velocity",
    what: "Reshapes each note's velocity: a magnet pulls velocities toward a target, random scatters them, offset shifts them, and mix blends the result with the original.",
    listenFor: "On Sixteenths, a strong magnet flattens the loud-soft alternation. On Melody, random breaks the ramp. The emitted lane cannot show this: velocity is heard, not seen.",
    snippet: `${insert("Velocity")}
const vel = project.boxAdapters.adapterFor(box, VelocityDeviceBoxAdapter);
project.editing.modify(() => vel.namedParameter.magnetStrength.setValue(1));`,
  },
  zeitgeist: {
    id: "zeitgeist",
    label: "Zeitgeist",
    factoryKey: "Zeitgeist",
    what: "Applies a shuffle groove to note timing: notes on the groove's grid stay put, notes between grid lines move toward the cell's eased midpoint by the amount.",
    listenFor: "On Sixteenths, every other note drags late. The shift is about 24 ms at amount 60%, one and a half display frames, so the emitted lane shows it only roughly; the placement audit measures it to the frame.",
    snippet: `${insert("Zeitgeist")}
const zeit = project.boxAdapters.adapterFor(box, ZeitgeistDeviceBoxAdapter);
const groove = zeit.groove(); // the device's own groove box
project.editing.modify(() => groove.namedParameter.amount.setValue(0.6));`,
  },
};

export interface DeviceParameter {
  key: string;
  label: string;
  parameter: UnitParameter;
  /** Number of whole values of an integer parameter, so a slider steps over them. */
  positions?: number;
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
