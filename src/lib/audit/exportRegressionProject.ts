/**
 * The project every export regression render starts from, and what a row changes on its copy.
 * The live project holds the units, the bus and the aux and no audio: they exist before any copy, so their UUIDs,
 * and with them the summing order, are the same in every render. A row's regions and devices go on its copy.
 * A copy has new box instances under the same uuids, so nothing here holds a box across one: a box in
 * `HarnessProject` is read for its address and resolved on the project at hand.
 */
import { asInstanceOf, UUID, type Class } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import type { Box, BoxGraph } from "@opendaw/lib-box";
import { EffectFactories, type Project } from "@opendaw/studio-core";
import { AudioBusFactory, InstrumentFactories, ScriptCompiler } from "@opendaw/studio-adapters";
import {
  AudioBusBox, AudioFileBox, AudioRegionBox, AudioUnitBox, AuxSendBox, CompressorDeviceBox, MarkerBox, MaximizerDeviceBox,
  TrackBox, ValueEventCollectionBox, WerkstattDeviceBox,
} from "@opendaw/studio-boxes";
import { AudioUnitType, Colors, IconSymbol } from "@opendaw/studio-enums";
import { audioEffectsFieldOf } from "@/lib/adapterUtils";
import { assertUuidOrder } from "./ascendingUuids";
import { removeMasterMaximizer } from "./midiEffectChain";
import type { ExportRow, LatencyCaseId } from "./exportRegressionRows";
import { bedSource, hotSource, probeSource, sweepSource, tailSource } from "./exportRegressionSignals";

export type HarnessProject = {
  project: Project;
  units: { source: AudioUnitBox; bed: AudioUnitBox; holder: AudioUnitBox };
  tracks: { source: TrackBox; bed: TrackBox; holder: TrackBox };
  bus: AudioBusBox;
  aux: AudioBusBox;
  sources: Map<string, UUID.Bytes>;
};

type LatencyDevice = {
  host: "source" | "holder" | "bus" | "aux";
  device: "Autotune" | "Compressor" | "Maximizer" | "Fold" | "Werkstatt";
  script?: string;
};

// The script's host is muted, so only its declaration reaches the mix: it has no need to delay what it passes.
const passThroughScript = (latencyMs: number): string => `// @latency ${latencyMs}
class Processor {
  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      outL[i] = srcL[i]
      outR[i] = srcR[i]
    }
  }
}`;

const LATENCY_DEVICES: Record<LatencyCaseId, readonly LatencyDevice[]> = {
  "none": [],
  "autotune-muted": [{ host: "holder", device: "Autotune" }],
  "compressor-track": [{ host: "source", device: "Compressor" }],
  "compressor-muted": [{ host: "holder", device: "Compressor" }],
  "maximizer-muted": [{ host: "holder", device: "Maximizer" }],
  "fold-muted": [{ host: "holder", device: "Fold" }],
  "script-10ms-muted": [{ host: "holder", device: "Werkstatt", script: passThroughScript(10) }],
  // On the muted holder the source is the parallel path the 100 ms cap applies to; with nothing parallel it would read 150 ms.
  "script-150ms-parallel": [{ host: "holder", device: "Werkstatt", script: passThroughScript(150) }],
  "compressor-bus": [{ host: "bus", device: "Compressor" }],
  "compressor-aux": [{ host: "aux", device: "Compressor" }],
  "several": [
    { host: "source", device: "Compressor" },
    { host: "source", device: "Fold" },
    { host: "holder", device: "Compressor" },
  ],
};

export const latencyDevices = (latencyCase: LatencyCaseId): LatencyDevice[] => [...LATENCY_DEVICES[latencyCase]];

export type SourceId = { signal: ExportRow["signal"] | "bed"; sourceRate: number; seconds: number };

export const sourceKey = ({ signal, sourceRate, seconds }: SourceId): string => `${signal}-${sourceRate}-${seconds}`;

export const sourceSamples = ({ signal, sourceRate, seconds }: SourceId): [Float32Array, Float32Array] => {
  switch (signal) {
    case "probe": return probeSource(sourceRate, seconds);
    case "sweep": return sweepSource(sourceRate, seconds);
    case "tail": return tailSource(sourceRate, seconds);
    case "hot": return hotSource(sourceRate, seconds);
    case "bed": return bedSource(sourceRate, seconds);
  }
};

/** One per signal, rate and length the rows use, and a bed or a third unit's sweep per rate and length a row with one uses. */
export const distinctSources = (rows: readonly ExportRow[]): SourceId[] => {
  const sources = new Map<string, SourceId>();
  const add = (id: SourceId): void => void sources.set(sourceKey(id), id);
  for (const { signal, sourceRate, seconds, withBed, withThird } of rows) {
    add({ signal, sourceRate, seconds });
    if (withBed) add({ signal: "bed", sourceRate, seconds });
    if (withThird) add({ signal: "sweep", sourceRate, seconds });
  }
  return [...sources.values()];
};

/** The rate is hashed with the samples: it is part of what the file plays back as. */
export const sourceUuid = (sourceRate: number, [left, right]: readonly [Float32Array, Float32Array]): Promise<UUID.Bytes> => {
  const bytes = new Uint8Array(8 + left.byteLength + right.byteLength);
  new DataView(bytes.buffer).setFloat64(0, sourceRate);
  bytes.set(new Uint8Array(left.buffer, left.byteOffset, left.byteLength), 8);
  bytes.set(new Uint8Array(right.buffer, right.byteOffset, right.byteLength), 8 + left.byteLength);
  return UUID.sha256(bytes.buffer);
};

/** Content-addressed: a fixed uuid could find a stale sample in OPFS when another page has stopped the sweep. */
export const prepareSources = async (
  harness: HarnessProject, rows: readonly ExportRow[], audioContext: BaseAudioContext, buffers: Map<string, AudioBuffer>,
): Promise<void> => {
  for (const id of distinctSources(rows)) {
    const samples = sourceSamples(id);
    const uuid = await sourceUuid(id.sourceRate, samples);
    const buffer = audioContext.createBuffer(2, samples[0].length, id.sourceRate);
    buffer.getChannelData(0).set(samples[0]);
    buffer.getChannelData(1).set(samples[1]);
    buffers.set(UUID.toString(uuid), buffer);
    harness.sources.set(sourceKey(id), uuid);
  }
};

export const buildHarnessProject = (project: Project, order: "ascending" | "descending"): HarnessProject => {
  const { editing, api, skeleton, timelineBox } = project;
  const createTape = () => editing.modify(() => api.createInstrument(InstrumentFactories.Tape)).unwrap("no tape was created");
  const source = createTape();
  const bed = createTape();
  const holder = createTape();
  assertUuidOrder([source, bed, holder].map(({ audioUnitBox }) => audioUnitBox.address.uuid), order);
  const bus = editing
    .modify(() => AudioBusFactory.create(skeleton, "Bus", IconSymbol.AudioBus, AudioUnitType.Bus, Colors.blue))
    .unwrap("no bus was created");
  const aux = editing
    .modify(() => AudioBusFactory.create(skeleton, "Aux", IconSymbol.AudioBus, AudioUnitType.Aux, Colors.green))
    .unwrap("no aux was created");
  editing.modify(() => {
    bed.audioUnitBox.mute.setValue(true);
    holder.audioUnitBox.mute.setValue(true);
    timelineBox.loopArea.enabled.setValue(false);
  });
  return {
    project,
    units: { source: source.audioUnitBox, bed: bed.audioUnitBox, holder: holder.audioUnitBox },
    tracks: { source: source.trackBox, bed: bed.trackBox, holder: holder.trackBox },
    bus,
    aux,
    sources: new Map(),
  };
};

const resolve = <T>(project: Project, { address }: Box, clazz: Class<T>): T =>
  asInstanceOf(project.boxGraph.findBox(address.uuid).unwrap(`no box ${UUID.toString(address.uuid)} on this project`), clazz);

/** A bus's devices sit on the audio unit its output points at. */
const hostUnit = (project: Project, harness: HarnessProject, host: LatencyDevice["host"]): AudioUnitBox => {
  if (host === "source" || host === "holder") return resolve(project, harness.units[host], AudioUnitBox);
  const { box } = resolve(project, harness[host], AudioBusBox).output.targetVertex.unwrap(`the ${host} has no audio unit`);
  return asInstanceOf(box, AudioUnitBox);
};

const FACTORIES = {
  Autotune: EffectFactories.AudioNamed.Autotune,
  Compressor: EffectFactories.AudioNamed.Compressor,
  Maximizer: EffectFactories.AudioNamed.Maximizer,
  Fold: EffectFactories.AudioNamed.Fold,
  Werkstatt: EffectFactories.AudioNamed.Werkstatt,
};

/** Well into the probe's 0.5 tone, for the one row that shows the Compressor still processes. */
const engage = (box: CompressorDeviceBox): void => {
  neutralise(box);
  box.threshold.setValue(-24);
  box.ratio.setValue(4);
};

const werkstattCompiler = ScriptCompiler.create({
  headerTag: "werkstatt",
  registryName: "werkstattProcessors",
  functionName: "werkstatt",
});

/** Applies no gain reduction, so the look-ahead is the only thing it adds. */
const neutralise = (box: CompressorDeviceBox): void => {
  box.threshold.setValue(0);
  box.ratio.setValue(1);
  box.knee.setValue(0);
  box.inputgain.setValue(0);
  box.makeup.setValue(0);
  box.automakeup.setValue(false);
  box.mix.setValue(1);
  box.lookahead.setValue(true);
};

/**
 * Puts a case's devices and routing on `project`, the live one or a copy, and returns what takes them off again.
 * `enabled` false leaves the devices present and switched off. Each device has a transaction of its own: a chain's
 * next index is read from pointers that resolve when the transaction ends, so two in one would share an index.
 */
export const insertLatencyDevices = async (
  project: Project, harness: HarnessProject, latencyCase: LatencyCaseId, enabled: boolean = true, engaged: boolean = false,
): Promise<() => void> => {
  const { api, boxGraph, editing, skeleton } = project;
  const inserted: UUID.Bytes[] = [];
  const source = (): AudioUnitBox => resolve(project, harness.units.source, AudioUnitBox);

  const remove = (): void => {
    const unit = source();
    editing.modify(() => {
      for (const uuid of inserted) boxGraph.findBox(uuid).unwrap(`no box ${UUID.toString(uuid)} to remove`).delete();
      if (latencyCase === "compressor-bus") unit.output.refer(skeleton.mandatoryBoxes.primaryAudioBusBox.input);
    });
    for (const uuid of inserted) {
      if (boxGraph.findBox(uuid).nonEmpty()) throw new Error(`box ${UUID.toString(uuid)} is still there after its delete`);
    }
  };

  try {
    if (latencyCase === "compressor-bus") {
      const unit = source();
      const bus = resolve(project, harness.bus, AudioBusBox);
      editing.modify(() => unit.output.refer(bus.input));
    }
    if (latencyCase === "compressor-aux") {
      const unit = source();
      const aux = resolve(project, harness.aux, AudioBusBox);
      const send = editing
        .modify(() => AuxSendBox.create(boxGraph, UUID.generate(), (box) => {
          box.audioUnit.refer(unit.auxSends);
          box.targetBus.refer(aux.input);
          box.index.setValue(0);
          box.sendGain.setValue(0);
          box.sendPan.setValue(0);
        }))
        .unwrap("no aux send was created");
      inserted.push(send.address.uuid);
    }
    for (const { host, device, script } of latencyDevices(latencyCase)) {
      const field = audioEffectsFieldOf(project, hostUnit(project, harness, host));
      const box = editing
        .modify(() => {
          const effect = api.insertEffect(field, FACTORIES[device]);
          if (device === "Compressor") (engaged ? engage : neutralise)(asInstanceOf(effect, CompressorDeviceBox));
          effect.enabled.setValue(enabled);
          return effect;
        })
        .unwrap(`no ${device} was created`);
      inserted.push(box.address.uuid);
      if (script !== undefined) {
        await werkstattCompiler.compile(project.env.audioContext, editing, asInstanceOf(box, WerkstattDeviceBox), script);
      }
    }
  } catch (cause) {
    // The live project outlives the row: a half-inserted case must not reach the next copy.
    remove();
    throw cause;
  }
  return remove;
};

const placeRegion = (boxGraph: BoxGraph, track: TrackBox, file: AudioFileBox, position: number, row: ExportRow, name: string): void => {
  const duration = Math.round(PPQN.secondsToPulses(row.seconds, row.bpm));
  const events = ValueEventCollectionBox.create(boxGraph, UUID.generate());
  AudioRegionBox.create(boxGraph, UUID.generate(), (box) => {
    box.regions.refer(track.regions);
    box.file.refer(file);
    box.events.refer(events.owners);
    box.position.setValue(position);
    box.duration.setValue(duration);
    box.loopOffset.setValue(0);
    box.loopDuration.setValue(duration);
    box.label.setValue(name);
  });
};

/** One file, and a region at 0, and a second region of that file where the row asks for one. */
export const placeSourceRegions = (boxGraph: BoxGraph, track: TrackBox, uuid: UUID.Bytes, row: ExportRow, name: string): void => {
  const file = AudioFileBox.create(boxGraph, uuid, (box) => {
    box.fileName.setValue(name);
    box.endInSeconds.setValue(row.seconds);
  });
  placeRegion(boxGraph, track, file, 0, row, name);
  if (row.secondRegionSeconds !== null) {
    placeRegion(boxGraph, track, file, Math.round(PPQN.secondsToPulses(row.secondRegionSeconds, row.bpm)), row, name);
  }
};

/** Other units' tracks hold one region whatever the row: a second region is the source's. */
const placeSource = (project: Project, track: TrackBox, uuid: UUID.Bytes, row: ExportRow, name: string): void => {
  placeSourceRegions(project.boxGraph, track, uuid, name === row.signal ? row : { ...row, secondRegionSeconds: null }, name);
};

/** A tail row's Reverb gives it something to ring. A gap row's silence must be exact, so it has none. */
export const rowTakesReverb = ({ signal, secondRegionSeconds }: ExportRow): boolean => signal === "tail" && secondRegionSeconds === null;

const MARKER_SECONDS: readonly number[] = [1, 3];

const placeMarkers = (project: Project, bpm: number): void => {
  const { boxGraph, timelineBox: { markerTrack } } = project;
  markerTrack.enabled.setValue(true);
  MARKER_SECONDS.forEach((seconds, index) => {
    MarkerBox.create(boxGraph, UUID.generate(), (box) => {
      box.track.refer(markerTrack.markers);
      box.position.setValue(Math.round(PPQN.secondsToPulses(seconds, bpm)));
      box.label.setValue(`Marker ${index + 1}`);
    });
  });
};

const settleMasterMaximizer = (project: Project, keep: boolean): void => {
  const master = project.rootBoxAdapter.audioUnits.adapters().find((unit) => unit.isOutput);
  if (master === undefined) throw new Error("the project has no output unit");
  const effects = master.audioEffects.unwrap("the output unit hosts no audio-effect chain").adapters();
  const count = keep
    ? effects.filter(({ box }) => box instanceof MaximizerDeviceBox).length
    : removeMasterMaximizer(project.editing, effects);
  if (count !== 1) throw new Error(`the master carries ${count} Maximizers, a new project carries 1`);
};

/** Runs on the row's own copy, before a renderer exists. The caller owns the copy and awaits this. */
export const applyRow = async (copy: Project, harness: HarnessProject, row: ExportRow): Promise<void> => {
  const { editing, timelineBox } = copy;
  const sourceId = { signal: row.signal, sourceRate: row.sourceRate, seconds: row.seconds };
  const bedId = { signal: "bed" as const, sourceRate: row.sourceRate, seconds: row.seconds };
  const sampleOf = (id: SourceId): UUID.Bytes => {
    const uuid = harness.sources.get(sourceKey(id));
    if (uuid === undefined) throw new Error(`${row.id}: prepareSources did not prepare ${sourceKey(id)}`);
    return uuid;
  };
  const source = resolve(copy, harness.units.source, AudioUnitBox);
  const bed = resolve(copy, harness.units.bed, AudioUnitBox);
  const holder = resolve(copy, harness.units.holder, AudioUnitBox);
  const sourceTrack = resolve(copy, harness.tracks.source, TrackBox);
  const bedTrack = resolve(copy, harness.tracks.bed, TrackBox);
  const sourceSample = sampleOf(sourceId);
  const bedSample = row.withBed ? sampleOf(bedId) : null;
  const thirdSample = row.withThird ? sampleOf({ signal: "sweep", sourceRate: row.sourceRate, seconds: row.seconds }) : null;
  const holderTrack = resolve(copy, harness.tracks.holder, TrackBox);

  editing.modify(() => {
    timelineBox.bpm.setValue(row.bpm);
    placeSource(copy, sourceTrack, sourceSample, row, row.signal);
    if (bedSample !== null) placeSource(copy, bedTrack, bedSample, row, "bed");
    if (thirdSample !== null) placeSource(copy, holderTrack, thirdSample, row, "third");
    bed.mute.setValue(!row.withBed);
    holder.mute.setValue(!row.withThird);
    if (row.nudgeVolume) source.volume.setValue(0.0001);
    if (row.volumeDb !== 0) source.volume.setValue(row.volumeDb);
    if (row.path.startsWith("section-marker")) placeMarkers(copy, row.bpm);
  });
  settleMasterMaximizer(copy, row.masterMaximizer);
  if (rowTakesReverb(row)) {
    const field = audioEffectsFieldOf(copy, source);
    editing.modify(() => copy.api.insertEffect(field, EffectFactories.AudioNamed.Reverb));
  }
  await insertLatencyDevices(copy, harness, row.latencyCase, !row.disabledDevice, row.engagedCompressor);
};
