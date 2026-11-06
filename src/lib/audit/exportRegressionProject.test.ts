import { describe, expect, it, vi } from "vitest";
import { UUID } from "@opendaw/lib-std";
import { distinctSources, latencyDevices, sourceKey, sourceSamples, sourceUuid } from "./exportRegressionProject";
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
    ({ signal: "probe", sourceRate: 48000, seconds: 4, withBed: false, ...spec }) as ExportRow;

  it("lists a source once however many rows use it", () => {
    expect(distinctSources([row({}), row({})]).map(sourceKey)).toEqual([
      sourceKey({ signal: "probe", sourceRate: 48000, seconds: 4 })]);
  });

  it("adds a bed only for a row that has one, at that row's rate and length", () => {
    expect(distinctSources([row({ sourceRate: 44100, seconds: 2, withBed: true })]).map(sourceKey)).toEqual([
      sourceKey({ signal: "probe", sourceRate: 44100, seconds: 2 }),
      sourceKey({ signal: "bed", sourceRate: 44100, seconds: 2 })]);
  });

  it("covers the catalogue: six probes, a sweep, a tail, a hot signal, a bed", () => {
    const sources = distinctSources(buildRows(48000));
    expect(new Set(sources.map(sourceKey)).size).toBe(sources.length);
    expect(sources.filter(({ signal }) => signal === "probe")).toHaveLength(6);
    for (const signal of ["sweep", "tail", "hot", "bed"] as const) {
      expect(sources.filter((source) => source.signal === signal))
        .toEqual([{ signal, sourceRate: 48000, seconds: 4 }]);
    }
  });
});
