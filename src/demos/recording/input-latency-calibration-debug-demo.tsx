// src/demos/recording/input-latency-calibration-debug-demo.tsx
// Unlisted ground-truth page for the SDK's input-latency calibration
// (`.superpowers/sdd/2026-09-02-input-latency-calibration/`, design spec
// `docs/superpowers/specs/2026-09-02-input-latency-calibration-design.md` §5).
//
// What it proves: the SDK's `CaptureAudio.calibrateInputLatency` measures a
// KNOWN delay. The synthetic loopback (src/lib/audit/loopbackInjection.ts)
// carries a `DelayNode` in its return path; the page sweeps that delay over
// `?delays=`, calibrates at each value, and fits `inputLatencySeconds` against
// it by least squares. A calibration that measures what it claims to measure
// has slope 1.00 and an intercept equal to the input chain's own delay at
// zero injected delay. The chain's delay moves between calls (sd 3.17 ms over
// 26 steady-state points), so the slope is only resolvable over a long span:
// 1σ on the slope is ±0.084 over a 0-50 ms span and ±0.0095 over 0-400 ms.
// Then it applies the calibration (`apply: true`, delay back to 0) and runs ONE
// `nominal-start` cell through the recording start-alignment harness's own
// runner (`src/lib/audit/recordingCellRunner.ts`) so the verdict is the same
// metric the campaign register reports, not a look-alike.
//
// ---------------------------------------------------------------------------
// BRANCH API SHIM — REMOVE AFTER THE SDK RELEASE SHIPS IT.
// `calibrateInputLatency` / `clearInputLatencyCalibration` /
// `recording.inputLatencyCalibrations` exist only on the upstream calibration
// branch. This repo's tsc resolves @opendaw/* types from node_modules (the
// installed release), which does not declare them, so they are reached here
// through the local structural interfaces below plus a runtime feature check.
// The field names mirror `InputLatencyCalibration.Result` exactly. When the
// installed SDK ships the API, delete the interfaces and the check and import
// the real types.
// ---------------------------------------------------------------------------
//
// What the cell verdict can and cannot show. `classifyCell` fails a repeat whose
// `tailMissingMs` exceeds 2 ms, and that quantity is `hop − postStopCapture`:
// the SDK's stop path keeps whatever frames happen to have been delivered when
// the stop lands (29-67 ms here, an artifact of message and quantum latency, not
// a margin sized against input latency), and input still in flight beyond that
// is truncated. It does not depend on the applied calibration — the same
// deficits appear uncalibrated on the same stream — so it is an SDK stop-path
// effect that calibration EXPOSES rather than causes: uncalibrated, the missing
// tail was hidden under a placement that was ~64 ms late anyway.
//
// Two probe-path notes, both deliberate and both persisted in the JSON:
//  - The probe is played out through `audioContext.destination`, which has no
//    outputs to tap, so the loopback tees destination connections into its
//    return path for the duration of each calibration call
//    (`captureDestinationDuring`).
//  - That tee carries a virtual output-device leg of `audioContext.outputLatency`
//    seconds. The harness already models the output leg its digital loopback
//    never traverses, adding the same term back as `harnessPathBiasSec` before
//    judging a take; a probe that skipped the leg would measure an input
//    latency short by exactly that term, and the applied cell would then land
//    `outputLatency` late. Both the raw round trip and the leg are persisted,
//    so either space can be recomputed offline.
//
// `?armState=steady|fresh` (default steady) selects which SDK input-chain state
// the applied cell records in: `steady` records on the chain the sweep and the
// applied calibration ran on; `fresh` disarms and re-arms first, so take 1 is
// the first pull on a rebuilt chain while the stored calibration still describes
// the old one. That is the state pair the ~45 ms step lives in (see the priming
// comment in `runCalibrationAudit`), and `fresh` is how the second half of it
// gets measured instead of predicted.
//
// DOM contract: #audit-state carries data-audit-state walking setup ->
// priming -> sweep:<delay> -> applying -> [rearm ->] cell:<repeat> ->
// uploading -> done (or error:<message>); #cell-verdict carries
// data-verdict={cell status}.
//
// Run it with a REAL click (the AudioContext resumes on the gesture) on a
// visible window, one fresh navigation per run — same discipline as the
// alignment harness (src/demos/recording/CLAUDE.md).
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Flex, Heading, Table, Text, Theme, Container } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { CaptureAudio, type Project } from "@opendaw/studio-core";
import { InstrumentFactories, type AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { installLoopbackCapture, LOOPBACK_DEVICE_ID } from "@/lib/audit/loopbackInjection";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { classifyCell, type CellClassification, type TakeAlignment } from "@/lib/audit/recordingAlignment";
import {
  ALIGNED_TOLERANCE_MS,
  REPEATS_PER_CELL,
  SIGNATURE_BANDS,
} from "@/lib/audit/recordingAuditCalibration";
import type { AuditRow, SdkBuildProbe } from "@/lib/audit/recordingAuditArtifacts";
import {
  clearLastFinalizeProbe,
  resetForNextCell,
  resolveHarnessPathBias,
  runCellRepeat,
  runRepeatWithDeadline,
  takeLastFinalizeProbe,
  type CellRepeatResult,
  type HarnessPathBias,
} from "@/lib/audit/recordingCellRunner";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar, type DebugLink } from "@/components/DebugLinkBar";

const params = new URLSearchParams(window.location.search);

const CALIBRATION_LINKS: DebugLink[] = [
  {
    label: "debug/recording-start-alignment-audit.md",
    href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md",
    kind: "note",
  },
  {
    label: "Recording start-alignment harness (same cell runner)",
    href: "/recording-alignment-audit-debug-demo.html?scenario=nominal-start&bpm=120&rate=48000",
    kind: "demo",
  },
  {
    label: "Upstream issue: openDAW#374 (residual start-placement bias)",
    href: "https://github.com/andremichelle/openDAW/issues/374",
    kind: "note",
  },
];

/** The scenario the applied cell runs — the campaign's cleanest single-tape provocation. */
const CELL_SCENARIO = "nominal-start" as const;
/** Settle time after moving the return delay before a calibration is started. */
const DELAY_SETTLE_MS = 200;
const CALIBRATION_DEADLINE_MS = 60_000;
/** Same outer per-repeat deadline the alignment harness uses for a single-tape cell. */
const REPEAT_DEADLINE_MS = 180_000;
const STREAM_DEADLINE_MS = 15_000;

// --- branch API shim (see the header) --------------------------------------

type CalibrationVerdict =
  | "ok" | "noisy" | "no-signal" | "context-not-running" | "no-stream" | "transport-running";

/** Mirrors `InputLatencyCalibration.Result` field for field. */
interface CalibrationResult {
  verdict: CalibrationVerdict;
  roundTripSeconds: number;
  outputLatencySeconds: number;
  outputLatencyReported: boolean;
  inputLatencySeconds: number;
  spreadSeconds: number;
  correlationRatioDb: number;
  identifiedBursts: number;
  scheduledBursts: number;
  sampleRate: number;
  measuredAt: number;
}

interface CalibratingCapture {
  calibrateInputLatency(options?: { apply?: boolean; burstCount?: number; gainDb?: number }): Promise<CalibrationResult>;
  clearInputLatencyCalibration(): void;
}

/**
 * Which SDK input-chain state the applied cell records in.
 *  - `steady`: record on the chain the sweep and the applied calibration ran on.
 *  - `fresh`: disarm and re-arm first, so `#updateStream` rebuilds the chain and
 *    take 1 is its FIRST pull (13-21 ms) while the stored calibration describes
 *    the reused state (58-69 ms). Takes 2-3 are back on the reused state.
 */
type ArmState = "steady" | "fresh";

/** Which pull of its chain a take was: only the first one after a rebuild is fast. */
type ChainPull = "first-after-arm" | "reused";

/** Mirrors the `recording.inputLatencyCalibrations` preference entry. */
interface CalibrationEntry {
  deviceId: string;
  inputLatency: number;
  outputLatencyAtCalibration: number;
  spread: number;
  measuredAt: number;
}

function calibratingCaptureOf(capture: CaptureAudio): CalibratingCapture {
  const candidate = capture as unknown as Partial<CalibratingCapture>;
  if (typeof candidate.calibrateInputLatency !== "function" || typeof candidate.clearInputLatencyCalibration !== "function") {
    throw new Error(
      "branch API not available — this build of @opendaw/studio-core has no CaptureAudio.calibrateInputLatency; " +
      "serve the calibration branch's dist through SDK_DIST_OVERRIDE"
    );
  }
  return candidate as CalibratingCapture;
}

function storedCalibrations(project: Project): CalibrationEntry[] {
  const recording = project.engine.preferences.settings.recording as unknown as {
    inputLatencyCalibrations?: CalibrationEntry[];
  };
  return recording.inputLatencyCalibrations ?? [];
}

// --- persisted artifact ----------------------------------------------------

export const CALIBRATION_SCHEMA_VERSION = 1;

interface SweepRow extends CalibrationResult {
  requestedDelayMs: number;
  requestedDelaySec: number;
}

interface LeastSquaresFit {
  /** d(inputLatencySeconds)/d(requestedDelaySec) — 1.00 when the calibration tracks the injected delay. */
  slope: number;
  /** inputLatencySeconds at zero injected delay — the SDK input chain's own delay. */
  interceptSec: number;
  points: number;
  /** Max |residual| of the fit, in ms — how straight the line actually is. */
  maxAbsResidualMs: number;
}

interface CellOutcome {
  scenario: string;
  status: CellClassification["status"];
  matchedSignature: string | null;
  detail: string;
  successfulRepeats: number;
  errorRepeats: number;
  errors: string[];
  rows: AuditRow[];
}

interface CalibrationSummary {
  schemaVersion: number;
  kind: "input-latency-calibration-ground-truth";
  runToken: number;
  rate: number;
  bpm: number;
  sdkBuildProbe: SdkBuildProbe;
  deviceId: string;
  /** audioContext.outputLatency, read once after output started (resolveHarnessPathBias). */
  outputLatency: number;
  baseLatency: number;
  harnessPathBiasSec: number;
  harnessPathBiasSettleMs: number;
  /** The virtual output-device leg the destination tee carried (= harnessPathBiasSec). */
  virtualOutputLegSec: number;
  /** Which chain state the applied cell recorded in — see `ArmState`. */
  armState: ArmState;
  /** The discarded first calibration — see the warm-up comment in `runCalibrationAudit`. */
  warmup: CalibrationResult | null;
  sweep: SweepRow[];
  fit: LeastSquaresFit | null;
  applied: CalibrationResult | null;
  storedEntry: CalibrationEntry | null;
  cell: CellOutcome;
  /**
   * The harness's own, independent measure of the input chain's delay for this
   * stream: `firstQuantumTimeSec − anchorT0Sec` per applied-cell row (the
   * register's Task 9 definition). Only a RECORDED cell yields it — the SDK
   * exposes `firstQuantumTime` on the take's RecordingWorklet — so it comes
   * from the applied cell's rows, not from the sweep, and there is therefore
   * one value per run rather than one per swept delay.
   */
  harnessLoopbackHopSec: number | null;
  harnessLoopbackHopPerRowSec: number[];
  harnessLoopbackHopSource: string;
  /**
   * Per applied-cell row: the chain delay it measured and which pull of its
   * chain it was. In `fresh` mode repeat 1 is the first pull after the re-arm;
   * everything else is a reused pull. Persisted so the two states are legible
   * from the artifact without re-deriving them from the run's structure.
   */
  cellRowStates: { repeat: number; takeIndex: number; hopSec: number | null; chainPull: ChainPull }[];
}

// --- run -------------------------------------------------------------------

// `reportDeviceId: true` — the SDK stores a calibration under the stream's own
// device id and refuses to store one under the empty id a
// MediaStreamAudioDestinationNode track reports. It also makes the SDK reuse
// one stream across recordings instead of opening a fresh one per take (see
// `stampDeviceId`), which is the configuration this measurement needs: a
// calibration only describes the stream it ran on, and the applied cell has to
// record on that same stream. The alignment harness deliberately leaves it off.
const loopback = installLoopbackCapture(1, { reportDeviceId: true });

/** Same marker the alignment harness probes — see its `detectSdkBuildProbe`. */
function detectSdkBuildProbe(engine: unknown): SdkBuildProbe {
  const facade = engine as { recordingStart?: { isEmpty?: unknown } };
  return typeof facade?.recordingStart?.isEmpty === "function" ? "candidate" : "upstream";
}

function resolveDelaysMs(param: string | null): number[] {
  const raw = param ?? "0,10,25,50";
  const values = raw.split(",").map((part) => Number(part.trim()));
  if (values.length === 0 || values.some((v) => !Number.isFinite(v) || v < 0 || v > 1000)) {
    throw new Error(`invalid ?delays= "${raw}" — comma-separated milliseconds in [0, 1000]`);
  }
  return values;
}

function resolveArmState(param: string | null): ArmState {
  const raw = param ?? "steady";
  if (raw !== "steady" && raw !== "fresh") {
    throw new Error(`invalid ?armState= "${raw}" — steady|fresh`);
  }
  return raw;
}

function resolveNumber(param: string | null, fallback: number, label: string): number {
  const raw = param ?? String(fallback);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid ?${label}= "${raw}"`);
  return n;
}

/** Ordinary least squares of y on x, plus the largest residual it leaves. */
function leastSquares(points: { x: number; y: number }[]): LeastSquaresFit | null {
  const usable = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (usable.length < 2) return null;
  const meanX = usable.reduce((sum, p) => sum + p.x, 0) / usable.length;
  const meanY = usable.reduce((sum, p) => sum + p.y, 0) / usable.length;
  const varianceX = usable.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  if (varianceX === 0) return null;
  const covariance = usable.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0);
  const slope = covariance / varianceX;
  const interceptSec = meanY - slope * meanX;
  const maxAbsResidualMs = Math.max(...usable.map((p) => Math.abs(p.y - (slope * p.x + interceptSec)) * 1000));
  return { slope, interceptSec, points: usable.length, maxAbsResidualMs };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CalibrationContext {
  project: Project;
  audioContext: AudioContext;
  capture: CaptureAudio;
  calibrating: CalibratingCapture;
  unitAdapter: AudioUnitBoxAdapter;
  deviceId: string;
  sdkBuildProbe: SdkBuildProbe;
  bias: HarnessPathBias;
}

/** Wait until the armed capture has actually opened its stream (the calibration
 *  needs the audio chain, and reports `no-stream` without it). */
async function waitForStream(capture: CaptureAudio, deadlineMs: number): Promise<string> {
  const start = performance.now();
  for (;;) {
    const deviceIdOption = capture.streamDeviceId;
    if (!deviceIdOption.isEmpty()) {
      const deviceId = deviceIdOption.unwrap();
      if (deviceId !== "") return deviceId;
    }
    if (performance.now() - start > deadlineMs) {
      throw new Error(`capture stream did not report a device id within ${deadlineMs / 1000}s`);
    }
    await sleep(50);
  }
}

async function createContext(rate: number, bpm: number): Promise<CalibrationContext> {
  const { project, audioContext } = await initializeOpenDAW({
    bpm,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  const sdkBuildProbe = detectSdkBuildProbe(project.engine);
  loopback.attach(audioContext);
  const bias = await resolveHarnessPathBias(audioContext);

  let audioUnitBox: AudioUnitBox | null = null;
  project.editing.modify(() => {
    audioUnitBox = project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox;
  });
  if (audioUnitBox === null) throw new Error("createInstrument did not return audioUnitBox");
  const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
  if (!(capture instanceof CaptureAudio)) throw new Error("capture is not CaptureAudio");
  project.editing.modify(() => {
    capture.captureBox.deviceId.setValue(LOOPBACK_DEVICE_ID);
    capture.requestChannels = 1;
  });
  capture.armed.setValue(true);
  const calibrating = calibratingCaptureOf(capture);
  const deviceId = await waitForStream(capture, STREAM_DEADLINE_MS);
  console.log("[input-latency-calibration] stream open on deviceId=" + deviceId);

  const unitAdapter = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBox);
  if (!unitAdapter) throw new Error("no audio unit adapter for tape");
  return { project, audioContext, capture, calibrating, unitAdapter, deviceId, sdkBuildProbe, bias };
}

// Booted once per page load (`Workers.install` asserts on a second
// `initializeOpenDAW`) — "Re-run" reuses it under a fresh run token.
let contextPromise: Promise<CalibrationContext> | null = null;
function getContext(rate: number, bpm: number): Promise<CalibrationContext> {
  if (contextPromise === null) contextPromise = createContext(rate, bpm);
  return contextPromise;
}

/** One calibration call, with the destination teed into the loopback for its duration. */
function calibrateThroughLoopback(
  calibrating: CalibratingCapture,
  virtualOutputLegSec: number,
  apply: boolean
): Promise<CalibrationResult> {
  return withDeadline(
    loopback.captureDestinationDuring(virtualOutputLegSec, () =>
      calibrating.calibrateInputLatency(apply ? { apply: true } : {})
    ),
    CALIBRATION_DEADLINE_MS,
    `calibrateInputLatency(apply=${String(apply)})`
  );
}

async function uploadSummary(summary: CalibrationSummary): Promise<void> {
  const body = JSON.stringify(summary, null, 2);
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/calib-summary-${summary.runToken}.json`, { method: "PUT", body });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "summary upload"
  );
}

interface RunCallbacks {
  setState: (state: string) => void;
  onSweepRow: (row: SweepRow) => void;
  onFit: (fit: LeastSquaresFit | null) => void;
  onWarmup: (result: CalibrationResult) => void;
  onApplied: (result: CalibrationResult, entry: CalibrationEntry | null) => void;
  onCell: (
    cell: CellOutcome,
    hopSec: number | null,
    rowStates: { repeat: number; takeIndex: number; hopSec: number | null; chainPull: ChainPull }[]
  ) => void;
  onBuildProbe: (probe: SdkBuildProbe) => void;
}

async function runCalibrationAudit(cb: RunCallbacks): Promise<void> {
  cb.setState("setup");
  const delaysMs = resolveDelaysMs(params.get("delays"));
  const bpm = resolveNumber(params.get("bpm"), 120, "bpm");
  const rate = resolveNumber(params.get("rate"), 48000, "rate");
  const armState = resolveArmState(params.get("armState"));
  const runToken = Date.now();

  const { project, audioContext, capture, calibrating, unitAdapter, deviceId, sdkBuildProbe, bias } =
    await getContext(rate, bpm);
  cb.onBuildProbe(sdkBuildProbe);
  console.log(
    "[input-latency-calibration] run " + String(runToken) +
    " rate=" + String(rate) + " bpm=" + String(bpm) +
    " delaysMs=[" + delaysMs.join(",") + "]" +
    " armState=" + armState +
    " harnessPathBiasSec=" + bias.valueSec.toFixed(6)
  );

  // A stale entry from an earlier run on this page would be applied to the
  // sweep cells too — the sweep must measure the raw path.
  calibrating.clearInputLatencyCalibration();

  // STEADY-STATE PRIMING — one calibration, discarded from the fit. It is not
  // "warming up the loopback": it moves the SDK's input chain out of its
  // fresh-chain state and into the state every later use of that chain runs in.
  //
  // With the stream reused (`reportDeviceId`), the first pull on a chain reads
  // 13-21 ms of input delay and every later pull on the same chain reads
  // 58-69 ms — permanently, until `#updateStream` rebuilds it. That holds for
  // takes as well as calibrations: uncalibrated `nominal-start` runs on the
  // reused stream measured take 1 at 17.0 / 13.0 ms and takes 2-3 at
  // 63.6-67.6 ms. Between uses the reused `MediaStreamAudioSourceNode` is
  // connected only to `recordGainNode`, which with monitoring off reaches no
  // destination, so nobody drains its browser-side buffer (see `stampDeviceId`
  // in loopbackInjection.ts — the buffer SIZE is inferred, the state dependence
  // measured).
  //
  // Consequence for this page: without priming, the sweep fits one fresh-chain
  // point against N steady ones and reports a slope that is an artifact of the
  // step (the un-primed first run fitted 18.7 ms against 62.7-68.7 and read
  // slope 1.77), and it applies a value that does not describe the chain the
  // take then runs on. The result is persisted so the step stays visible in the
  // artifact rather than being hidden by the fix, and `?armState=fresh`
  // (below) re-arms before the cell so the OTHER state can be measured too.
  cb.setState("priming");
  loopback.setReturnDelay(0);
  await sleep(DELAY_SETTLE_MS);
  const warmup = await calibrateThroughLoopback(calibrating, bias.valueSec, false);
  console.log(
    "[input-latency-calibration] priming calibration verdict=" + warmup.verdict +
    " inputLatencySec=" + String(warmup.inputLatencySeconds) +
    " (fresh-chain state; discarded from the fit — see the priming comment)"
  );
  cb.onWarmup(warmup);

  const sweep: SweepRow[] = [];
  for (const delayMs of delaysMs) {
    cb.setState(`sweep:${delayMs}ms`);
    loopback.setReturnDelay(delayMs / 1000);
    await sleep(DELAY_SETTLE_MS);
    const result = await calibrateThroughLoopback(calibrating, bias.valueSec, false);
    const row: SweepRow = { requestedDelayMs: delayMs, requestedDelaySec: delayMs / 1000, ...result };
    sweep.push(row);
    cb.onSweepRow(row);
    console.log(
      "[input-latency-calibration] D=" + String(delayMs) + "ms verdict=" + result.verdict +
      " roundTripSec=" + String(result.roundTripSeconds) +
      " inputLatencySec=" + String(result.inputLatencySeconds) +
      " outputLatencySec=" + String(result.outputLatencySeconds) +
      " reported=" + String(result.outputLatencyReported) +
      " spreadSec=" + String(result.spreadSeconds) +
      " ratioDb=" + String(result.correlationRatioDb) +
      " bursts=" + String(result.identifiedBursts) + "/" + String(result.scheduledBursts)
    );
  }

  const fit = leastSquares(sweep.map((row) => ({ x: row.requestedDelaySec, y: row.inputLatencySeconds })));
  cb.onFit(fit);
  if (fit !== null) {
    console.log(
      "[input-latency-calibration] fit slope=" + fit.slope.toFixed(4) +
      " interceptMs=" + (fit.interceptSec * 1000).toFixed(3) +
      " points=" + String(fit.points) +
      " maxAbsResidualMs=" + fit.maxAbsResidualMs.toFixed(3)
    );
  }

  cb.setState("applying");
  loopback.setReturnDelay(0);
  await sleep(DELAY_SETTLE_MS);
  const applied = await calibrateThroughLoopback(calibrating, bias.valueSec, true);
  const storedEntry = storedCalibrations(project).find((entry) => entry.deviceId === deviceId) ?? null;
  cb.onApplied(applied, storedEntry);
  console.log(
    "[input-latency-calibration] applied verdict=" + applied.verdict +
    " inputLatencySec=" + String(applied.inputLatencySeconds) +
    " storedEntry=" + (storedEntry === null ? "none" : JSON.stringify(storedEntry))
  );

  // `?armState=fresh`: rebuild the SDK's input chain AFTER storing the
  // calibration, so take 1 records on a chain whose delay is ~45 ms below the
  // value just stored. Disarming runs `#stopStream` synchronously; re-arming
  // runs the stream generator, and `waitForStream` blocks until the new track
  // reports its id. The stored entry is keyed by device id, which does not
  // change, so it still resolves — that is exactly the hazard being measured.
  if (armState === "fresh") {
    cb.setState("rearm");
    capture.armed.setValue(false);
    await sleep(DELAY_SETTLE_MS);
    capture.armed.setValue(true);
    const rearmedDeviceId = await waitForStream(capture, STREAM_DEADLINE_MS);
    console.log("[input-latency-calibration] re-armed before the cell, chain rebuilt, deviceId=" + rearmedDeviceId);
  }

  // One nominal-start cell through the alignment harness's own runner, so the
  // verdict is the campaign metric (classifyCell on the adjusted median plus
  // the head/tail integrity gates), not a look-alike.
  const repeats: { rows: AuditRow[]; alignments: CellRepeatResult["alignments"] }[] = [];
  const cellErrors: string[] = [];
  for (let repeat = 1; repeat <= REPEATS_PER_CELL; repeat++) {
    cb.setState(`cell:${CELL_SCENARIO}/r${repeat}`);
    let stage = "prefs";
    let result: CellRepeatResult | null = null;
    clearLastFinalizeProbe();
    try {
      result = await runRepeatWithDeadline(
        (token) => runCellRepeat({
          project, audioContext, loopback, unitAdapter,
          scenario: CELL_SCENARIO, bpm, rate, repeat,
          onStage: (s) => { stage = s; },
          harnessPathBiasSec: bias.valueSec,
          token,
        }),
        REPEAT_DEADLINE_MS,
        `${CELL_SCENARIO}/r${repeat}`
      );
    } catch (err) {
      const message = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
      cellErrors.push(`r${repeat} ${message}`);
      console.error("[input-latency-calibration] cell repeat " + String(repeat) + " failed: " + message);
    }
    let cleanupWarning: string | null = null;
    try {
      cleanupWarning = await resetForNextCell(project, loopback, unitAdapter);
    } catch (cleanupErr) {
      cleanupWarning = `cleanup itself threw: ${String(cleanupErr)}`;
    }
    if (cleanupWarning !== null) {
      cellErrors.push(`r${repeat} cleanup warning: ${cleanupWarning}`);
      console.warn("[input-latency-calibration] cleanup warning: " + cleanupWarning);
    }
    if (result !== null) {
      repeats.push({ rows: result.rows, alignments: result.alignments });
    }
  }

  const alignments: TakeAlignment[] = repeats.flatMap((r) => r.alignments.map((a) => a.alignment));
  const classification: CellClassification =
    alignments.length > 0
      ? classifyCell(alignments, SIGNATURE_BANDS[CELL_SCENARIO], ALIGNED_TOLERANCE_MS)
      : { status: "investigate", matchedSignature: null, detail: "no successful repeats to classify" };
  const cellRows = repeats.flatMap((r) => r.rows);
  for (const row of cellRows) {
    row.status = classification.status;
    row.matchedSignature = classification.matchedSignature;
    row.detail = classification.detail;
  }
  if (repeats.length === 0) {
    // No rows exist to carry it, so the finalize probe of the last failed
    // attempt is reported here — a hung finalization is exactly the case a
    // fully-failed cell needs explained.
    console.warn("[input-latency-calibration] cell produced no rows; last finalize probe: " +
      JSON.stringify(takeLastFinalizeProbe()));
  }

  const rowHopSec = (row: AuditRow): number | null => {
    if (row.firstQuantumTimeSec === undefined || row.anchorT0Sec === null || row.anchorT0Sec === undefined) return null;
    const hop = row.firstQuantumTimeSec - row.anchorT0Sec;
    return Number.isFinite(hop) ? hop : null;
  };
  const hopPerRow = cellRows.map(rowHopSec).filter((value): value is number => value !== null);
  const hopSec = median(hopPerRow);
  // In `fresh` mode repeat 1 is the first pull on the rebuilt chain; in `steady`
  // mode the priming/sweep/applied calls already pulled it, so every repeat is a
  // reused pull.
  const cellRowStates = cellRows.map((row) => ({
    repeat: row.repeat,
    takeIndex: row.takeIndex,
    hopSec: rowHopSec(row),
    chainPull: (armState === "fresh" && row.repeat === 1 ? "first-after-arm" : "reused") as ChainPull,
  }));
  console.log(
    "[input-latency-calibration] cellRowStates armState=" + armState + " " +
    cellRowStates
      .map((r) => "r" + String(r.repeat) + ":" + r.chainPull + ":" +
        (r.hopSec === null ? "n/a" : (r.hopSec * 1000).toFixed(3) + "ms"))
      .join(" ")
  );
  const cell: CellOutcome = {
    scenario: CELL_SCENARIO,
    status: classification.status,
    matchedSignature: classification.matchedSignature,
    detail: classification.detail,
    successfulRepeats: repeats.length,
    errorRepeats: REPEATS_PER_CELL - repeats.length,
    errors: cellErrors,
    rows: cellRows,
  };
  cb.onCell(cell, hopSec, cellRowStates);
  console.log(
    "[input-latency-calibration] cell status=" + classification.status +
    " repeats=" + String(repeats.length) + "/" + String(REPEATS_PER_CELL) +
    " harnessLoopbackHopMs=" + (hopSec === null ? "n/a" : (hopSec * 1000).toFixed(3)) +
    " detail=" + classification.detail
  );

  cb.setState("uploading");
  await uploadSummary({
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    kind: "input-latency-calibration-ground-truth",
    runToken, rate, bpm, sdkBuildProbe, deviceId,
    outputLatency: bias.valueSec,
    baseLatency: audioContext.baseLatency,
    harnessPathBiasSec: bias.valueSec,
    harnessPathBiasSettleMs: bias.settleMs,
    virtualOutputLegSec: bias.valueSec,
    armState,
    warmup, sweep, fit, applied, storedEntry, cell,
    harnessLoopbackHopSec: hopSec,
    harnessLoopbackHopPerRowSec: hopPerRow,
    cellRowStates,
    harnessLoopbackHopSource:
      "applied-cell rows: firstQuantumTimeSec − anchorT0Sec (only a recorded take exposes firstQuantumTime, so this is one value per run, not one per swept delay)",
  });
  cb.setState("done");
}

// --- UI --------------------------------------------------------------------

function verdictColor(verdict: CalibrationVerdict): "green" | "amber" | "red" {
  if (verdict === "ok") return "green";
  if (verdict === "noisy") return "amber";
  return "red";
}

function statusColor(status: CellClassification["status"]): "green" | "amber" | "red" | "gray" {
  if (status === "aligned") return "green";
  if (status === "matches-known-defect") return "amber";
  if (status === "investigate" || status === "error") return "red";
  return "gray";
}

const ms = (seconds: number): string => (Number.isFinite(seconds) ? (seconds * 1000).toFixed(3) : "—");

function CalibrationHarness() {
  const [auditState, setAuditState] = useState("idle");
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [buildProbe, setBuildProbe] = useState<SdkBuildProbe>("unknown");
  const [sweep, setSweep] = useState<SweepRow[]>([]);
  const [fit, setFit] = useState<LeastSquaresFit | null>(null);
  const [warmup, setWarmup] = useState<CalibrationResult | null>(null);
  const [applied, setApplied] = useState<CalibrationResult | null>(null);
  const [storedEntry, setStoredEntry] = useState<CalibrationEntry | null>(null);
  const [cell, setCell] = useState<CellOutcome | null>(null);
  const [hopSec, setHopSec] = useState<number | null>(null);
  const [rowStates, setRowStates] = useState<
    { repeat: number; takeIndex: number; hopSec: number | null; chainPull: ChainPull }[]
  >([]);
  const armState = resolveArmState(params.get("armState"));

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    setStarted(true);
    setSweep([]);
    setFit(null);
    setWarmup(null);
    setApplied(null);
    setStoredEntry(null);
    setCell(null);
    setHopSec(null);
    setRowStates([]);
    runCalibrationAudit({
      setState: setAuditState,
      onSweepRow: (row) => setSweep((prev) => [...prev, row]),
      onFit: setFit,
      onWarmup: setWarmup,
      onApplied: (result, entry) => { setApplied(result); setStoredEntry(entry); },
      onCell: (outcome, hop, states) => { setCell(outcome); setHopSec(hop); setRowStates(states); },
      onBuildProbe: setBuildProbe,
    })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[input-latency-calibration] run error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running]);

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar links={CALIBRATION_LINKS} />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Input-Latency Calibration — Ground Truth
          </Heading>
          <Text size="1" color="gray" align="center">
            build: {buildProbe} · armState: {armState}
          </Text>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">State:</Text>
              <Badge
                id="audit-state"
                data-audit-state={auditState}
                color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}
              >
                {auditState}
              </Badge>
              <Button onClick={handleRun} disabled={running}>
                {started ? "Re-run" : "Run calibration"}
              </Button>
              {cell !== null && (
                <Badge id="cell-verdict" data-verdict={cell.status} color={statusColor(cell.status)}>
                  cell: {cell.status}
                </Badge>
              )}
            </Flex>
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>Delay sweep</Heading>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>D (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>round trip (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>input part (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>output latency (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>reported</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>spread (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>ratio (dB)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>bursts</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>verdict</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {sweep.map((row, index) => (
                    <Table.Row key={`${row.requestedDelayMs}-${index}`}>
                      <Table.Cell>{row.requestedDelayMs}</Table.Cell>
                      <Table.Cell>{ms(row.roundTripSeconds)}</Table.Cell>
                      <Table.Cell>{ms(row.inputLatencySeconds)}</Table.Cell>
                      <Table.Cell>{ms(row.outputLatencySeconds)}</Table.Cell>
                      <Table.Cell>{String(row.outputLatencyReported)}</Table.Cell>
                      <Table.Cell>{ms(row.spreadSeconds)}</Table.Cell>
                      <Table.Cell>{Number.isFinite(row.correlationRatioDb) ? row.correlationRatioDb.toFixed(2) : "—"}</Table.Cell>
                      <Table.Cell>{row.identifiedBursts}/{row.scheduledBursts}</Table.Cell>
                      <Table.Cell>
                        <Badge color={verdictColor(row.verdict)}>{row.verdict}</Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
            <Text size="2" color="gray" as="p" style={{ marginTop: "0.75rem" }}>
              {fit === null
                ? "fit: pending"
                : `fit: slope ${fit.slope.toFixed(4)} · intercept ${(fit.interceptSec * 1000).toFixed(3)} ms · ` +
                  `max residual ${fit.maxAbsResidualMs.toFixed(3)} ms · ${fit.points} points`}
            </Text>
            <Text size="2" color="gray" as="p">
              {hopSec === null
                ? "input chain delay: pending (measured from the applied cell's rows)"
                : `input chain delay (firstQuantumTimeSec − anchorT0Sec), applied-cell median: ${(hopSec * 1000).toFixed(3)} ms`}
            </Text>
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>Applied calibration + cell</Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {applied === null
                ? "applied: pending"
                : `warm-up input:     ${warmup === null ? "—" : ms(warmup.inputLatencySeconds)} ms (discarded)
applied verdict:   ${applied.verdict}
input part:        ${ms(applied.inputLatencySeconds)} ms
round trip:        ${ms(applied.roundTripSeconds)} ms
output latency:    ${ms(applied.outputLatencySeconds)} ms (reported: ${String(applied.outputLatencyReported)})
spread:            ${ms(applied.spreadSeconds)} ms
stored entry:      ${storedEntry === null ? "NONE (not stored)" : `inputLatency ${(storedEntry.inputLatency * 1000).toFixed(3)} ms on "${storedEntry.deviceId}"`}`}
            </pre>
            {cell !== null && (
              <pre style={{ margin: "0.75rem 0 0", fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {`cell:              ${cell.scenario} — ${cell.status}
repeats:           ${cell.successfulRepeats} ok, ${cell.errorRepeats} error
detail:            ${cell.detail}
adjusted medians:  ${cell.rows.map((r) => (r.medianBeatErrorMsAdjusted === null ? "—" : r.medianBeatErrorMsAdjusted.toFixed(2))).join(", ")} ms
chain state:       ${rowStates.map((r) => `r${r.repeat} ${r.chainPull} ${r.hopSec === null ? "—" : `${(r.hopSec * 1000).toFixed(2)} ms`}`).join(" · ")}${cell.errors.length > 0 ? `\nerrors:            ${cell.errors.join(" | ")}` : ""}`}
              </pre>
            )}
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>Configuration</Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {`?delays=<ms,ms,...>   default 0,10,25,50 — injected loopback return delays
?bpm=<number>         default 120
?rate=<number>        default 48000 — sets the AudioContext at init, never "all"
?armState=steady|fresh default steady — "fresh" re-arms before the cell, so take 1
                      is the first pull on a rebuilt SDK input chain
Cell:                 ${CELL_SCENARIO}, ${REPEATS_PER_CELL} repeats, calibration applied
Uploads:              calib-summary-<runToken>.json via PUT /__verify
Needs the calibration-branch SDK (SDK_DIST_OVERRIDE); the page says so if it is missing.
Click "Run calibration" with a real click — resumes the AudioContext.`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<CalibrationHarness />);
