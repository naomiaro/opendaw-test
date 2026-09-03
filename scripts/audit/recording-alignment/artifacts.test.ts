/**
 * `loadCalibrationSummary` is the one gate between a `calib-summary-*.json`
 * envelope and every offline table; what it accepts and what it refuses is
 * pinned here against fixtures written to a temp directory, so a change to
 * the page's envelope (or to the loader) cannot silently pass a malformed
 * artifact into a figure the register quotes.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCalibrationSummary } from "./artifacts.ts";

let dir = "";
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "recaudit-loader-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

let nextRun = 1000;
/** Write `body` as the next run's envelope and return a loader for it. */
function envelope(body: Record<string, unknown>): () => ReturnType<typeof loadCalibrationSummary> {
  const runId = String(nextRun++);
  writeFileSync(join(dir, `calib-summary-${runId}.json`), JSON.stringify({ runToken: Number(runId), ...body }));
  return () => loadCalibrationSummary(runId, dir);
}

const okCall = {
  verdict: "ok", roundTripSeconds: 0.05, roundTripSecondsSecondary: 0.05, inputLatencySeconds: 0.027,
  outputLatencySeconds: 0.023, outputLatencyReported: true, spreadSeconds: 0.0001, correlationRatioDb: 25,
  identifiedBursts: 3, scheduledBursts: 3, sampleRate: 48000, measuredAt: 1,
};
/** The page's `error` row: NaN throughout, which JSON persists as null. */
const errorCall = {
  verdict: "error", roundTripSeconds: null, inputLatencySeconds: null, outputLatencySeconds: null,
  outputLatencyReported: false, spreadSeconds: null, correlationRatioDb: null, identifiedBursts: 0,
  scheduledBursts: 0, sampleRate: 48000, measuredAt: 1, reason: "calibrateInputLatency(apply=false) timed out",
};

/** A loopback envelope as the first runs wrote it: none of the later fields. */
const oldEnvelope = {
  rate: 48000, sdkBuildProbe: "candidate", deviceId: "loopback-injection",
  sweep: [{ ...okCall, requestedDelayMs: 10, requestedDelaySec: 0.01 }], applied: okCall,
  fit: { slope: 1, interceptSec: 0.02, points: 4, maxAbsResidualMs: 0.001 },
  cell: { status: "aligned", rows: [{ medianBeatErrorMsAdjusted: 0.1, headMissingMs: 0, tailMissingMs: 0 }] },
  harnessLoopbackHopPerRowSec: [0.021],
};

/** A real-input envelope as the page writes it after the review round. */
const realEnvelope = {
  rate: 44100, sdkBuildProbe: "candidate", deviceId: "abc", inputMode: "real", runLabel: "cable loopback",
  device: { deviceId: "abc", label: "Scarlett", groupId: "g" },
  sweep: [], applied: okCall, warmup: null, fit: null, fitExcludedNoisy: null,
  repeats: [{ ...okCall, index: 0, chainIndex: 0 }, { ...errorCall, index: 1, chainIndex: 0 }],
  repeatSummary: null,
  cell: { scenario: "nominal-start", status: "skipped", rows: [] },
  harnessLoopbackHopPerRowSec: [],
  trackSettings: { deviceId: "abc", latency: 0.002666 }, trackSettingsPerChain: [{ deviceId: "abc", latency: 0.002666 }],
  realSummary: { verdict: "repeatable" },
};

describe("loadCalibrationSummary", () => {
  it("accepts an envelope from before every later field and reads the later fields as null or empty", () => {
    const s = envelope(oldEnvelope)();
    expect(s.inputMode).toBeNull();
    expect(s.runLabel).toBeNull();
    expect(s.device).toBeNull();
    expect(s.trackSettings).toBeNull();
    expect(s.realSummary).toBeNull();
    expect(s.warmup).toBeNull();
    expect(s.repeats).toEqual([]);
    expect(s.repeatSummary).toBeNull();
    expect(s.buildFeatures).toBeNull();
    expect(s.cell.status).toBe("aligned");
  });

  it("accepts a real-input envelope: cell.status skipped, null spread and ratio on an error row, the real fields", () => {
    const s = envelope(realEnvelope)();
    expect(s.inputMode).toBe("real");
    expect(s.cell.status).toBe("skipped");
    expect(s.repeats).toHaveLength(2);
    expect(s.repeats[1].spreadSeconds).toBeNull();
    expect(s.repeats[1].correlationRatioDb).toBeNull();
    expect(s.device?.label).toBe("Scarlett");
    expect(s.runLabel).toBe("cable loopback");
    expect(s.realSummary?.verdict).toBe("repeatable");
    expect(s.fit).toBeNull();
    expect(s.sweep).toEqual([]);
  });

  it("refuses a runToken that does not match the file name", () => {
    const runId = String(nextRun++);
    writeFileSync(join(dir, `calib-summary-${runId}.json`), JSON.stringify({ ...oldEnvelope, runToken: 42 }));
    expect(() => loadCalibrationSummary(runId, dir)).toThrow(/carries runToken 42/);
  });

  it("refuses an inputMode other than loopback|real", () => {
    expect(envelope({ ...realEnvelope, inputMode: "synthetic" })).toThrow(/"inputMode" is "synthetic"/);
  });

  it("refuses a device without deviceId, label and groupId strings", () => {
    expect(envelope({ ...realEnvelope, device: { deviceId: "abc", label: "x" } })).toThrow(/"device" is neither absent nor/);
    expect(envelope({ ...realEnvelope, device: "abc" })).toThrow(/"device" is neither absent nor/);
    expect(envelope({ ...realEnvelope, device: null })().device).toBeNull();
  });

  it("refuses a non-object trackSettings or realSummary (null is fine)", () => {
    expect(envelope({ ...realEnvelope, trackSettings: "none" })).toThrow(/"trackSettings" is neither null nor an object/);
    expect(envelope({ ...realEnvelope, realSummary: [1] })).toThrow(/"realSummary" is neither null nor an object/);
    const s = envelope({ ...realEnvelope, trackSettings: null, realSummary: null })();
    expect(s.trackSettings).toBeNull();
    expect(s.realSummary).toBeNull();
  });

  it("validates correlationRatioDb as number | null on every call", () => {
    expect(envelope({ ...realEnvelope, repeats: [{ ...okCall, correlationRatioDb: "25", index: 0, chainIndex: 0 }] }))
      .toThrow(/"repeats" is not a list of calibration calls/);
    expect(envelope({ ...realEnvelope, applied: { ...okCall, correlationRatioDb: undefined } }))
      .toThrow(/"applied" is neither null nor a calibration call/);
    expect(envelope({ ...oldEnvelope, sweep: [{ ...okCall, correlationRatioDb: null }] })().sweep[0].correlationRatioDb).toBeNull();
  });

  it("refuses a cell without a status string or a rows list, and a hop list with a non-finite entry", () => {
    expect(envelope({ ...oldEnvelope, cell: { status: "aligned" } })).toThrow(/"cell" lacks a status string or a rows list/);
    expect(envelope({ ...oldEnvelope, harnessLoopbackHopPerRowSec: [null] })).toThrow(/"harnessLoopbackHopPerRowSec" is not a list of finite numbers/);
  });
});
