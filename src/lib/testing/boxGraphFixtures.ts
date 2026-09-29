/**
 * Test fixtures: a real box graph with sampler instruments on it, built in
 * Node without an AudioContext. For unit tests only — nothing in the app
 * imports this file.
 */
import { Option } from "@opendaw/lib-std";
import { BoxEditing, type BoxGraph } from "@opendaw/lib-box";
import type { BoxIO, NanoDeviceBox } from "@opendaw/studio-boxes";
import {
  AudioUnitFactory, InstrumentFactories, NanoDeviceBoxAdapter, ParameterFieldAdapters, ProjectSkeleton,
  type BoxAdaptersContext,
} from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol } from "@opendaw/studio-enums";

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
