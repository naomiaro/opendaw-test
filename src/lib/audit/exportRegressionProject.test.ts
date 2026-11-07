import { afterEach, describe, expect, it, vi } from "vitest";
import { Option, UUID } from "@opendaw/lib-std";
import { AudioFileBox, AudioRegionBox, TrackBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import { transact, type Graph } from "@/lib/testing/boxGraphFixtures";
import { bedRow, distinctSources, lateRemoval, latencyDevices, placeSourceRegions, rowTakesReverb, settleLateRemovals, sourceKey, sourceSamples, sourceUuid } from "./exportRegressionProject";
import { LATENCY_CASES, buildRows, type ExportRow } from "./exportRegressionRows";
import { probeSource } from "./exportRegressionSignals";

// The package index needs AudioWorkletNode, which Node has not. Nothing tested here inserts a device.
vi.mock("@opendaw/studio-core", () => ({ EffectFactories: { AudioNamed: {} } }));

const hex = (uuid: UUID.Bytes): string => UUID.toString(uuid);

describe("a late insert's removal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("takes off what the insert finishes with, and waits for the insert to do so", async () => {
    let finish: (remove: () => void) => void = () => {};
    const remove = vi.fn();
    const pending = [lateRemoval(new Promise<() => void>((resolve) => { finish = resolve; }), "several")];
    let settled = false;
    const settling = settleLateRemovals(pending, 1000).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(remove);
    await settling;
    expect(remove).toHaveBeenCalledOnce();
  });
  it("has nothing to take off an insert that failed: it rolled itself back", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await settleLateRemovals([lateRemoval(Promise.reject(new Error("no compile")), "several")], 1000);
    expect(String(error.mock.calls[0][0])).toContain("several: the late insert failed: Error: no compile");
  });
  it("ends the run when a removal failed: every copy starts from the live project", async () => {
    const stuck = lateRemoval(Promise.resolve(() => { throw new Error("no box"); }), "several");
    await expect(settleLateRemovals([stuck], 1000)).rejects.toThrow("several: removing the late devices failed: Error: no box");
  });
  it("ends the run when an insert never finishes: its devices could still land on a copy", async () => {
    vi.useFakeTimers();
    const hung = lateRemoval(new Promise<() => void>(() => {}), "several");
    const settling = expect(settleLateRemovals([hung], 1000)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1000);
    await settling;
  });
  it("settles at once with none pending", async () => {
    await expect(settleLateRemovals([], 1000)).resolves.toBeUndefined();
  });
});

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

  it("places a bed once, for as long as the row's bed lasts, under a source with two short regions", () => {
    const { regions, files } = place(bedRow(rowOf("gap-none-stem-step")));
    expect(files.map((file) => file.endInSeconds.getValue())).toEqual([18]);
    expect(regions.map((region) => [region.position.getValue(), region.duration.getValue(), region.loopDuration.getValue()]))
      .toEqual([[0, 34560, 34560]]);
  });

  it("keeps a bed as long as its source on a row that names no length of its own", () => {
    const { regions } = place(bedRow(rowOf("mix-none-step-one")));
    expect(regions.map((region) => region.duration.getValue())).toEqual([7680]);
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
    expect(of("gap-none-stem-step")).toBe(false);
    expect(of("gap-none-stem-start")).toBe(false);
    expect(of("gap-none-stem-mix")).toBe(false);
    expect(of("gap-none-stem-mix-start")).toBe(false);
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

  it("adds a bed at the row's own bed length when it names one", () => {
    expect(distinctSources([row({ seconds: 0.2, withBed: true, bedSeconds: 18 })]).map(sourceKey)).toEqual([
      sourceKey({ signal: "probe", sourceRate: 48000, seconds: 0.2 }),
      sourceKey({ signal: "bed", sourceRate: 48000, seconds: 18 })]);
  });

  it("covers the catalogue: six probes, two tails, a sweep, a hot signal, a bed and the gap rows' longer one", () => {
    const sources = distinctSources(buildRows(48000));
    expect(new Set(sources.map(sourceKey)).size).toBe(sources.length);
    expect(sources.filter(({ signal }) => signal === "probe")).toHaveLength(6);
    expect(sources.filter(({ signal }) => signal === "tail").map(({ seconds }) => seconds).sort()).toEqual([0.2, 4]);
    for (const signal of ["sweep", "hot"] as const) {
      expect(sources.filter((source) => source.signal === signal))
        .toEqual([{ signal, sourceRate: 48000, seconds: 4 }]);
    }
    expect(sources.filter(({ signal }) => signal === "bed").map(({ seconds }) => seconds).sort((a, b) => a - b)).toEqual([4, 18]);
  });
});
