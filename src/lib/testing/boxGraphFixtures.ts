/**
 * Test fixtures: a real box graph with sampler instruments on it, built in
 * Node without an AudioContext. For unit tests only — nothing in the app
 * imports this file.
 */
import { Option } from "@opendaw/lib-std";
import { BoxEditing, type BoxGraph, type Int32Field, type PointerField, type StringField } from "@opendaw/lib-box";
import {
  ArpeggioDeviceBox, GrooveShuffleBox, NoteFilterDeviceBox, PitchDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox,
  type AudioUnitBox, type BoxIO, type NanoDeviceBox,
} from "@opendaw/studio-boxes";
import {
  ArpeggioDeviceBoxAdapter, AudioUnitFactory, BoxAdapters, InstrumentFactories, NanoDeviceBoxAdapter,
  NoteFilterDeviceBoxAdapter, ParameterFieldAdapters, PitchDeviceBoxAdapter, ProjectSkeleton, VelocityDeviceBoxAdapter, ZeitgeistDeviceBoxAdapter,
  type BoxAdaptersContext, type MidiEffectDeviceAdapter,
} from "@opendaw/studio-adapters";
import type { EffectBox } from "@opendaw/studio-core";
import type { DeviceId } from "@/lib/midiEffects/devices";
import { AudioUnitType, IconSymbol, type Pointers } from "@opendaw/studio-enums";
import { UUID } from "@opendaw/lib-std";

export type Graph = BoxGraph<BoxIO.TypeMap>;

/** Run `work` as one committed transaction */
export function transact<T>(boxGraph: Graph, work: () => T): T {
  boxGraph.beginTransaction();
  const result = work();
  boxGraph.endTransaction();
  return result;
}

export interface SamplerGraph {
  readonly boxGraph: Graph;
  readonly samplers: NanoDeviceBox[];
}

/** An empty project skeleton with `count` Nano samplers, each on its own audio unit, no sample attached */
export function graphWithSamplers(count: number): SamplerGraph {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph } = skeleton;
  const samplers = transact(boxGraph, () =>
    Array.from({ length: count }, (_, index) => {
      const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
      return InstrumentFactories.Nano.create(boxGraph, unit.input, `Sampler ${index}`, IconSymbol.NanoWave);
    })
  );
  return { boxGraph, samplers };
}

export interface SamplerFixture {
  readonly boxGraph: Graph;
  readonly box: NanoDeviceBox;
  /** The SDK's own adapter, so parameters carry their real value and string mappings */
  readonly adapter: NanoDeviceBoxAdapter;
  /** What the binding helpers take in place of a whole Project */
  readonly project: { readonly editing: BoxEditing };
}

/**
 * One sampler with the SDK's real parameter adapters. The adapter context is
 * the minimum those adapters touch off the main thread: the parameter registry.
 */
export function samplerFixture(): SamplerFixture {
  const { boxGraph, samplers: [box] } = graphWithSamplers(1);
  const context = {
    parameterFieldAdapters: new ParameterFieldAdapters(),
    isMainThread: false,
  } as unknown as BoxAdaptersContext;
  const adapter = new NanoDeviceBoxAdapter(context, box);
  return { boxGraph, box, adapter, project: { editing: new BoxEditing(boxGraph) } };
}

/** The skeleton's Global Shuffle, the groove `EffectFactories.Zeitgeist` points a new device at. */
function globalShuffleOf(skeleton: ProjectSkeleton): GrooveShuffleBox {
  const groove = skeleton.mandatoryBoxes.rootBox.groove.targetVertex.unwrap("the project has no global groove").box;
  if (!(groove instanceof GrooveShuffleBox)) throw new Error(`the global groove is a ${groove.constructor.name}, not a GrooveShuffleBox`);
  return groove;
}

export interface ZeitgeistGraph {
  readonly boxGraph: Graph;
  readonly unit: AudioUnitBox;
  readonly device: ZeitgeistDeviceBox;
  readonly groove: GrooveShuffleBox;
}

/**
 * One instrument unit with a Zeitgeist on its MIDI chain, pointing at the project's Global Shuffle as the factory
 * does (duration 480 and amount 0.6, the schema's defaults).
 */
export function graphWithZeitgeist(): ZeitgeistGraph {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph } = skeleton;
  return transact(boxGraph, () => {
    const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    const groove = globalShuffleOf(skeleton);
    const device = ZeitgeistDeviceBox.create(boxGraph, UUID.generate(), (box) => {
      box.label.setValue("Zeitgeist");
      box.index.setValue(0);
      box.groove.refer(groove);
      box.host.refer(unit.midiEffects);
    });
    return { boxGraph, unit, device, groove };
  });
}

/** What every stock MIDI effect box has, typed structurally: calling `host.refer` through the `EffectBox` union wants a target typed for both pointer kinds. */
interface MidiEffectBoxFields {
  readonly label: StringField;
  readonly index: Int32Field;
  readonly host: PointerField<Pointers.MIDIEffectHost>;
}

export interface MidiEffectFixture {
  readonly boxGraph: Graph;
  readonly unit: AudioUnitBox;
  readonly box: EffectBox;
  /** The SDK's own adapter, so parameters carry their real value and string mappings */
  readonly adapter: MidiEffectDeviceAdapter;
  /** A registry on the same context for code that resolves adapters itself (`project.boxAdapters.adapterFor`); it makes its own adapter for `box`, not `adapter`, so assert on the box, never on adapter identity */
  readonly boxAdapters: BoxAdapters;
  readonly editing: BoxEditing;
}

/**
 * One instrument unit with one stock MIDI effect on its chain, created by hand the way the factories do
 * (a Zeitgeist points at the project's Global Shuffle). The adapter context is the minimum the device adapters touch
 * off the main thread: the parameter registry, plus a `BoxAdapters` for the Zeitgeist's groove adapter.
 */
export function midiEffectFixture(id: DeviceId): MidiEffectFixture {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph } = skeleton;
  const { unit, box } = transact(boxGraph, () => {
    const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    const common = (label: string) => (box: MidiEffectBoxFields) => {
      box.label.setValue(label);
      box.index.setValue(0);
      box.host.refer(unit.midiEffects);
    };
    switch (id) {
      case "arpeggio": return { unit, box: ArpeggioDeviceBox.create(boxGraph, UUID.generate(), common("Arpeggio")) };
      case "note-filter": return { unit, box: NoteFilterDeviceBox.create(boxGraph, UUID.generate(), common("Note Filter")) };
      case "pitch": return { unit, box: PitchDeviceBox.create(boxGraph, UUID.generate(), common("Pitch")) };
      case "velocity": return { unit, box: VelocityDeviceBox.create(boxGraph, UUID.generate(), common("Velocity")) };
      case "zeitgeist": {
        return {
          unit,
          box: ZeitgeistDeviceBox.create(boxGraph, UUID.generate(), (box) => {
            common("Zeitgeist")(box);
            box.groove.refer(globalShuffleOf(skeleton));
          }),
        };
      }
    }
  });
  const context = { boxGraph, parameterFieldAdapters: new ParameterFieldAdapters(), isMainThread: false } as unknown as {
    -readonly [K in keyof BoxAdaptersContext]: BoxAdaptersContext[K];
  };
  context.boxAdapters = new BoxAdapters(context as BoxAdaptersContext);
  const adapter: MidiEffectDeviceAdapter =
    box instanceof ArpeggioDeviceBox ? new ArpeggioDeviceBoxAdapter(context, box)
    : box instanceof NoteFilterDeviceBox ? new NoteFilterDeviceBoxAdapter(context, box)
    : box instanceof PitchDeviceBox ? new PitchDeviceBoxAdapter(context, box)
    : box instanceof VelocityDeviceBox ? new VelocityDeviceBoxAdapter(context, box)
    : new ZeitgeistDeviceBoxAdapter(context, box as ZeitgeistDeviceBox);
  return { boxGraph, unit, box, adapter, boxAdapters: context.boxAdapters, editing: new BoxEditing(boxGraph) };
}
