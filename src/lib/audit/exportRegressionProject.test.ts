import { describe, expect, it, vi } from "vitest";
import { Option, UUID } from "@opendaw/lib-std";
import { AudioFileBox, AudioRegionBox, TrackBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import { transact, type Graph } from "@/lib/testing/boxGraphFixtures";
import { distinctSources, latencyDevices, placeSourceRegions, rowTakesReverb, sourceKey, sourceSamples, sourceUuid } from "./exportRegressionProject";
import { LATENCY_CASES, buildRows, type ExportRow } from "./exportRegressionRows";
import { probeSource } from "./exportRegressionSignals";

// The package index needs AudioWorkletNode, which Node has not. Nothing tested here inserts a device.
vi.mock("@opendaw/studio-core", () => ({ EffectFactories: { AudioNamed: {} } }));

const hex = (uuid: UUID.Bytes): string => UUID.toString(uuid);

describe("latencyDevices", () => {
  it("places each case's devices", () => {
    expect(latencyDevices("none")).toEqual([]);
    expect(latencyDevices("autotune-muted")).toEqual([{ host: "holder", device: "Autotune" }]);
    expect(latencyDevices("compressor-track")).toEqual([{ host: "source", device: "Compressor" }]);
    expect(latencyDevices("compressor-muted")).toEqual([{ host: "holder", device: "Compressor" }]);
    expect(latencyDevices("maximizer-muted")).toEqual([{ host: "holder", device: "Maximizer" }]);
    expect(latencyDevices("fold-muted")).toEqual([{ host: "holder", device: "Fold" }]);
    expect(latencyDevices("compressor-bus")).toEqual([{ host: "bus", device: "Compressor" }]);
    expect(latencyDevices("compressor-aux")).toEqual([{ host: "aux", device: "Compressor" }]);
    expect(latencyDevices("several")).toEqual([
      { host: "source", device: "Compressor" }, { host: "source", device: "Fold" }, { host: "holder", device: "Compressor" }]);
  });

  it("declares each script's latency on the muted holder", () => {
    const [ten] = latencyDevices("script-10ms-muted");
    expect(ten).toMatchObject({ host: "holder", device: "Werkstatt" });
    expect(ten.script).toContain("// @latency 10\n");
    const [capped] = latencyDevices("script-150ms-parallel");
    expect(capped).toMatchObject({ host: "holder", device: "Werkstatt" });
    expect(capped.script).toContain("// @latency 150\n");
  });

  it("gives a script only to a Werkstatt", () => {
    for (const latencyCase of LATENCY_CASES) {
      for (const { device, script } of latencyDevices(latencyCase)) {
        expect(script !== undefined).toBe(device === "Werkstatt");
      }
    }
  });
});

describe("placeSourceRegions", () => {
  const rowOf = (id: string): ExportRow => buildRows(48000).find((row) => row.id === id)!;

  const place = (row: ExportRow): { regions: AudioRegionBox[]; files: AudioFileBox[] } => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
    const boxGraph = skeleton.boxGraph as Graph;
    const uuid = UUID.generate();
    transact(boxGraph, () => {
      const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
      const track = TrackBox.create(boxGraph, UUID.generate(), (box) => {
        box.tracks.refer(unit.tracks);
        box.target.refer(unit);
      });
      placeSourceRegions(boxGraph, track, uuid, row, row.signal);
    });
    return {
      regions: boxGraph.boxes().filter((box): box is AudioRegionBox => box instanceof AudioRegionBox),
      files: boxGraph.boxes().filter((box): box is AudioFileBox => box instanceof AudioFileBox),
    };
  };

  it("places one region at 0 for a row with no second region", () => {
    const { regions, files } = place(rowOf("tail-none-step-one"));
    expect(regions.map((region) => region.position.getValue())).toEqual([0]);
    expect(files).toHaveLength(1);
  });

  it("places the second region of a gap row at its position, the same length, on the same file", () => {
    const { regions, files } = place(rowOf("gap-none-step-one"));
    expect(files).toHaveLength(1);
    expect(regions.map((region) => region.position.getValue()).sort((a, b) => a - b)).toEqual([0, 30720]);
    for (const region of regions) {
      expect(region.duration.getValue()).toBe(384);
      expect(region.loopDuration.getValue()).toBe(384);
      expect(region.file.targetVertex.unwrap().box).toBe(files[0]);
    }
  });
});

describe("rowTakesReverb", () => {
  it("gives a tail row its Reverb, and a gap row none: its gap must be exact silence", () => {
    const rows = buildRows(48000);
    const of = (id: string): boolean => rowTakesReverb(rows.find((row) => row.id === id)!);
    expect(of("tail-none-step-one")).toBe(true);
    expect(of("tail-none-start-long")).toBe(true);
    expect(of("core-none-step-one")).toBe(false);
    expect(of("gap-none-step-one")).toBe(false);
    expect(of("gap-none-start")).toBe(false);
    expect(of("gap-none-section-entire")).toBe(false);
  });
});

describe("source identity", () => {
  const stereo = (left: number[], right: number[]): [Float32Array, Float32Array] =>
    [Float32Array.from(left), Float32Array.from(right)];

  it("gives the same samples at the same rate the same uuid", async () => {
    expect(hex(await sourceUuid(48000, probeSource(48000, 1)))).toBe(hex(await sourceUuid(48000, probeSource(48000, 1))));
  });

  it("gives a different signal, length or rate a different uuid", async () => {
    const reference = hex(await sourceUuid(48000, sourceSamples({ signal: "probe", sourceRate: 48000, seconds: 1 })));
    expect(hex(await sourceUuid(48000, sourceSamples({ signal: "sweep", sourceRate: 48000, seconds: 1 })))).not.toBe(reference);
    expect(hex(await sourceUuid(48000, sourceSamples({ signal: "probe", sourceRate: 48000, seconds: 2 })))).not.toBe(reference);
    expect(hex(await sourceUuid(44100, sourceSamples({ signal: "probe", sourceRate: 44100, seconds: 1 })))).not.toBe(reference);
  });

  it("reads both channels", async () => {
    const reference = hex(await sourceUuid(48000, stereo([0, 0.5], [0, 0.5])));
    expect(hex(await sourceUuid(48000, stereo([0, 0.25], [0, 0.5])))).not.toBe(reference);
    expect(hex(await sourceUuid(48000, stereo([0, 0.5], [0, 0.25])))).not.toBe(reference);
  });

  it("does not let the same samples at another rate share a file", async () => {
    const samples = stereo([0, 0.5], [0, 0.5]);
    expect(hex(await sourceUuid(44100, samples))).not.toBe(hex(await sourceUuid(48000, samples)));
  });

  it("generates each signal the catalogue names", () => {
    for (const signal of ["probe", "sweep", "tail", "hot", "bed"] as const) {
      const [left, right] = sourceSamples({ signal, sourceRate: 48000, seconds: 0.5 });
      expect(left.length).toBe(24000);
      expect(right.length).toBe(24000);
      expect(left.some((sample) => sample !== 0)).toBe(true);
    }
  });
});

describe("distinctSources", () => {
  const row = (spec: Partial<ExportRow>): ExportRow =>
    ({ signal: "probe", sourceRate: 48000, seconds: 4, withBed: false, withThird: false, ...spec }) as ExportRow;

  it("lists a source once however many rows use it", () => {
    expect(distinctSources([row({}), row({})]).map(sourceKey)).toEqual([
      sourceKey({ signal: "probe", sourceRate: 48000, seconds: 4 })]);
  });

  it("adds a bed only for a row that has one, at that row's rate and length", () => {
    expect(distinctSources([row({ sourceRate: 44100, seconds: 2, withBed: true })]).map(sourceKey)).toEqual([
      sourceKey({ signal: "probe", sourceRate: 44100, seconds: 2 }),
      sourceKey({ signal: "bed", sourceRate: 44100, seconds: 2 })]);
  });

  it("adds the sweep for a third unit, at that row's rate and length", () => {
    expect(distinctSources([row({ sourceRate: 44100, seconds: 2, withThird: true })]).map(sourceKey)).toEqual([
      sourceKey({ signal: "probe", sourceRate: 44100, seconds: 2 }),
      sourceKey({ signal: "sweep", sourceRate: 44100, seconds: 2 })]);
  });

  it("covers the catalogue: six probes, two tails, a sweep, a hot signal, a bed", () => {
    const sources = distinctSources(buildRows(48000));
    expect(new Set(sources.map(sourceKey)).size).toBe(sources.length);
    expect(sources.filter(({ signal }) => signal === "probe")).toHaveLength(6);
    expect(sources.filter(({ signal }) => signal === "tail").map(({ seconds }) => seconds).sort()).toEqual([0.2, 4]);
    for (const signal of ["sweep", "hot", "bed"] as const) {
      expect(sources.filter((source) => source.signal === signal))
        .toEqual([{ signal, sourceRate: 48000, seconds: 4 }]);
    }
  });
});
