// src/demos/recording/input-latency-calibration-debug-demo.tsx
// Unlisted ground-truth page for the SDK's input-latency calibration. What was
// measured, on which SDK head, and what it does not settle:
// `debug/recording-start-alignment-audit.md`, section "Input-latency calibration
// (2026-09-02)". The design spec and plan this page was built from are deleted
// with the work — recover them with
// `git log --all --oneline -- 'docs/superpowers/*/2026-09-02-input-latency-calibration*'`.
//
// What it proves: the SDK's `CaptureAudio.calibrateInputLatency` measures a
// KNOWN delay. The synthetic loopback (src/lib/audit/loopbackInjection.ts)
// carries a `DelayNode` in its return path; the page sweeps that delay over
// `?delays=`, calibrates at each value, and fits `inputLatencySeconds` against
// it by least squares. A calibration that measures what it claims to measure
// has slope 1.00 and an intercept equal to the input chain's own delay at
// zero injected delay. On SDK `f0c44b06c` the chain's delay moved between calls
// (sd 3.17 ms over 26 steady-state points), so the slope was only resolvable
// over a long span: 1σ was ±0.084 over 0-50 ms and ±0.0095 over 0-400 ms. From
// `ac1c15ea8` a chain's delay is constant for its life and the short span
// resolves the slope on its own (within-run residuals ≤ 0.003 ms).
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
// The field names mirror `InputLatencyCalibration.Result` at the branch head;
// members that later branch commits added (`probe`, the second-anchor fields,
// `reason`) are optional here so the earlier override builds still run. When
// the installed SDK ships the API, delete the interfaces and the check and
// import the real types.
// ---------------------------------------------------------------------------
//
// What the cell verdict can and cannot show. `classifyCell` fails a repeat whose
// `tailMissingMs` exceeds 2 ms, and that quantity is `hop − postStopCapture`.
// On SDK `f0c44b06c` (before the keep-alive sink) that gate fired on this page:
// the SDK's stop path keeps whatever frames happen to have been delivered when
// the stop lands (29-67 ms on that build, an artifact of message and quantum
// latency, not a margin sized against input latency), and input still in
// flight beyond that is truncated. It does not depend on the applied
// calibration — the same deficits appeared uncalibrated on the same stream — so
// it is an SDK stop-path effect that calibration EXPOSES rather than causes:
// uncalibrated, the missing tail was hidden under a placement that was ~64 ms
// late on that build anyway. From `ac1c15ea8` every applied cell has read head
// and tail deficits of 0; the gate is unchanged and still stands in the path.
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
// Two rules on what enters the answer. A requested delay whose round trip would
// pass the SDK's searchable lag window is REFUSED with a stated reason, at parse
// time against the static ceiling and again per point against the round trip this
// run actually measures — the alternative is a `no-signal` row that looks like a
// failed measurement. And the headline fit uses `ok` rows only: a `noisy` verdict
// is the SDK reporting that its own spread bound was exceeded on that call, so
// those rows are excluded and counted, with the all-rows fit persisted beside it
// so the exclusion's effect is visible rather than assumed.
//
// `?defaultInput=1` arms the tape on the SDK's default input (the capture box
// names no device) instead of naming the synthetic loopback. On THIS page both
// modes reuse one chain across the sweep, the applied calibration and the cell:
// the loopback reports the device id back (`reportDeviceId`, below), so the
// named box's reuse test passes and `#updateStream` returns early before every
// recording — persisted as `getUserMediaOpens: 1` in either mode. What
// `?defaultInput=1` changes is WHICH reuse rule is exercised: the unnamed-box
// rule `546b5bfaa` added (the box names nothing and the stream was requested
// unconstrained) instead of the named-device rule (the box names the id the
// open track reports). "Default input is the only configuration that reuses
// the chain" holds for the alignment harness only, whose loopback leaves
// `reportDeviceId` off so its named synthetic device never matches.
//
// `?repeat=N` runs N further calibrations back to back on the same armed chain
// after the sweep, cycling the delays `?delays=` names (call k at
// `delays[k mod delays.length]`), and reports how many came back exactly one render quantum off
// the run's modal round trip — the miss the campaign saw once at 44.1 kHz, with
// all three bursts agreeing and a verdict of `ok`. On a build that reports a
// second capture anchor it also says, per miss, which anchor still agreed with
// the mode, which is what would identify the offending one. Pair it with
// `delays=0`; the phase is about repetition, not about the delay.
//
// `?armState=steady|fresh` (default steady) selects which SDK input-chain state
// the applied cell records in: `steady` records on the chain the sweep and the
// applied calibration ran on; `fresh` disarms and re-arms first, so take 1 is
// the first pull on a rebuilt chain while the stored calibration still describes
// the old one. That is the state pair the ~45 ms step of SDK `f0c44b06c` lived
// in (see the priming comment in `runCalibrationAudit` for what `ac1c15ea8`
// changed), and `fresh` is how the second state gets measured instead of
// predicted.
//
// DOM contract: #audit-state carries data-audit-state walking setup ->
// priming -> sweep:<delay> -> [repeat:<k>/<n> ->] applying -> [rearm ->]
// cell:<repeat> -> uploading -> done (or error:<message>); #cell-verdict
// carries data-verdict={cell status}, which is `error` when the applied
// calibration stored no entry — the rearm/cell stages are then skipped and the
// run still reaches `done` with the sweep persisted (see the gate after
// `apply` in `runCalibrationAudit`).
//
// ---------------------------------------------------------------------------
// `?input=real` — REAL-INPUT MODE. Everything above is the synthetic loopback
// (`?input=loopback`, the default). Real mode runs the SAME SDK routine
// against a physical input — the laptop mic acoustically (probe out of the
// speakers, back through the room) or an interface with a physical cable
// loopback — and persists what the loopback can never show: whether the
// routine's MLS detector hits on a real device (`identifiedBursts`, ratio dB,
// verdict counts), how repeatable its answer is across N back-to-back calls,
// and how the browser's own `MediaTrackSettings.latency` compares.
//
// What real mode CANNOT do, by construction: there is no injected delay, so
// no slope (nothing is swept — `sweep: []`, `fit: null`); and there is no
// applied take cell, because the cell's reference clicks and low/high band
// split assume the loopback tap (`cell.status = "skipped"`). None of the
// loopback's machinery is installed in real mode: no `getUserMedia` override,
// no DelayNode, no destination tee. The probe reaches the device through the
// real output device, so the harness-path bias term the synthetic path needs
// (`harnessPathBiasSec`) is 0 here, and a 0 `audioContext.outputLatency` read
// is recorded rather than refused (the refusal is a loopback-only guard).
//
// Real-mode flow: `setup` (boot the engine — on page load, so the device list
// can be shown before Start) -> `device` (one `getUserMedia({audio: true})` to
// unlock labels, then `enumerateDevices`; the select and the run-label input
// render, Start stays disabled until a device is chosen) -> `arming` (set the
// capture box's deviceId, arm, wait for the stream, persist the track's
// settings) -> `repeat:<i>/<n>` (N direct `calibrateInputLatency({})` calls;
// `?armState=fresh` walks `rearming` after call ⌈N/2⌉ — disarm, re-arm, wait
// for the new stream, re-read its track settings — so two chains are
// measured, `chainIndex` 0/1 per call) -> `applying` (one `{apply: true}` call,
// stored entry read back) -> `uploading` -> `done`. `#real-verdict` carries
// data-verdict = the `realSummary.verdict` (`src/lib/audit/realInputSummary.ts`).
// Every arm compares the stream's reported device id with the REQUESTED one:
// the SDK falls back to the default input when `{exact: deviceId}` fails
// (console.warn only), so a mismatch is persisted as `deviceFallback` and
// shown, never thrown on — the run stays evidence, labelled. A re-arm that
// fails is persisted as an `error` row, the envelope is still uploaded, and
// the run ends `error:<message>`.
// ---------------------------------------------------------------------------
//
// Run it with a REAL click (the AudioContext resumes on the gesture) on a
// visible window, one fresh navigation per run — same discipline as the
// alignment harness (src/demos/recording/CLAUDE.md).
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Flex, Heading, Table, Text, Theme, Container } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { CaptureAudio, type Project } from "@opendaw/studio-core";
import { InstrumentFactories, type AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { detectBuildFeatures } from "@/lib/audit/buildFeatures";
import { installLoopbackCapture, LOOPBACK_DEVICE_ID, type LoopbackHandle } from "@/lib/audit/loopbackInjection";
import { median, modeAtFrameResolution, summarizeRealInput, type RealInputSummary } from "@/lib/audit/realInputSummary";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { classifyCell, type CellClassification, type TakeAlignment } from "@/lib/audit/recordingAlignment";
import {
  ALIGNED_TOLERANCE_MS,
  REPEATS_PER_CELL,
  signatureBandsFor,
  type AuditBuildFeature,
} from "@/lib/audit/recordingAuditCalibration";
import type { AuditRow, CaptureMode, SdkBuildProbe } from "@/lib/audit/recordingAuditArtifacts";
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
  {
    label: "Upstream PR: openDAW#380 (the calibration routine this page measures)",
    href: "https://github.com/andremichelle/openDAW/pull/380",
    kind: "note",
  },
];

/** The scenario the applied cell runs — the campaign's cleanest single-tape provocation. */
const CELL_SCENARIO = "nominal-start" as const;
/** Settle time after moving the return delay before a calibration is started. */
const DELAY_SETTLE_MS = 200;
const CALIBRATION_DEADLINE_MS = 60_000;
/**
 * Mirrors `InputLatencyCalibration.MaxRoundTripSeconds` — part of the branch API
 * shim above, since the installed types do not declare the namespace. The
 * analysis correlates lags 1…`ceil(MaxRoundTripSeconds × sampleRate)` only
 * (`analyzeBursts` in lib-dsp), so a round trip past it is simply not searched
 * and the call returns `no-signal` with nothing to say why. The MLS length does
 * NOT come off this budget: the per-burst window is `mlsLength + maxLag` and only
 * the probe itself must fit inside the capture.
 */
const SDK_MAX_ROUND_TRIP_SEC = 0.6;
/** Margin kept below the ceiling so a point near it cannot fail on run-to-run chain-delay drift. */
const ROUND_TRIP_HEADROOM_SEC = 0.05;
/** Same outer per-repeat deadline the alignment harness uses for a single-tape cell. */
const REPEAT_DEADLINE_MS = 180_000;
const STREAM_DEADLINE_MS = 15_000;

// --- branch API shim (see the header) --------------------------------------

type CalibrationVerdict =
  | "ok" | "noisy" | "no-signal" | "context-not-running" | "no-stream" | "transport-running"
  /** Page-local, real mode only: the call threw or timed out — see `errorResult`. */
  | "error";

/** Mirrors `InputLatencyCalibration.Result` at the branch head; see the shim note in the header for which members are optional and why. */
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
  /**
   * Name of the probe the bursts carried (`"mls"` on the configurable-probe
   * builds). Since branch commit `3484e3265`; absent on the two builds before
   * it, so it is optional for the same reason the second-anchor fields are.
   */
  probe?: string;
  // --- second capture anchor (branch commit 660213857 and later) -------------
  // `measure` opens a SECOND capture node mid-run, at the end of the first
  // burst's emission (`firstBurst + min(referenceSeconds, spacing)`, so the
  // node's construction cannot fall inside the burst while it is still
  // playing), and analyses both buffers: the reported round
  // trip is node A's, `roundTripSecondsSecondary` is node B's, and the verdict
  // becomes `noisy` with `reason` "capture anchors disagree" when the two differ
  // by more than half a render quantum. It exists because a capture node's
  // first-frame time can be one quantum off on some chains (observed once at
  // 44.1 kHz; cause not identified) — the case `?repeat=` below measures.
  //
  // OPTIONAL on purpose: a build before that commit returns none of them, and
  // the page must still run there. Read every one defensively.
  /** Node B's round trip. Absent on builds with a single capture anchor. */
  roundTripSecondsSecondary?: number;
  /** Context time of each capture node's first frame, `[A, B]`. */
  captureStartTimes?: number[];
  /** Per node, per burst, the located delay: `[[A…], [B…]]`. */
  burstDelays?: number[][];
  /** Why a verdict is what it is, when the verdict alone does not say. */
  reason?: string;
}

interface CalibratingCapture {
  calibrateInputLatency(options?: { apply?: boolean; burstCount?: number; gainDb?: number }): Promise<CalibrationResult>;
  clearInputLatencyCalibration(): void;
}

/**
 * Which SDK input-chain state the applied cell records in.
 *  - `steady`: record on the chain the sweep and the applied calibration ran on.
 *  - `fresh`: disarm and re-arm first, so `#updateStream` rebuilds the chain and
 *    take 1 records on a chain the stored calibration never measured. On SDK
 *    `f0c44b06c` (before the keep-alive sink) that meant take 1 was the chain's
 *    FIRST pull (13-21 ms) while the stored value described the reused state
 *    (58-69 ms), with takes 2-3 back on the reused state; from `ac1c15ea8`
 *    every pull reads ~21 ms, and what `fresh` exposes is the rebuilt chain
 *    landing in the other of two states ~8 ms apart — in either direction — or
 *    in the same one.
 */
type ArmState = "steady" | "fresh";

/**
 * Which pull of its chain a take was. On SDK `f0c44b06c` (before the keep-alive
 * sink) only the first pull after a rebuild was fast; from `ac1c15ea8` the pull
 * index no longer moves the delay, and the label only says whether the take ran
 * on the chain the re-arm rebuilt.
 */
type ChainPull = "first-after-arm" | "reused";

/** Per applied-cell row: the chain delay it measured and which pull of its chain it was. */
interface CellRowState {
  repeat: number;
  takeIndex: number;
  hopSec: number | null;
  chainPull: ChainPull;
}

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

/** One call of the `?repeat=` phase, with every field the build returned plus this
 *  call's relation to the run's modal round trip. */
interface RepeatCall extends CalibrationResult {
  index: number;
  /** The injected return delay THIS call ran at — the cycle repeats over `?delays=`. */
  delayMs: number;
  /** The delay of the call before it, null for the first: the correlation this phase tests. */
  previousDelayMs: number | null;
  /** True when this call is the first at a delay different from the one before it. */
  isFirstAfterDelayChange: boolean;
  /** Primary round trip with this call's own delay removed — the chain's own round
   *  trip, and the quantity every call is compared on once the delay varies. */
  normalizedRoundTripSec: number;
  /** Input part with the delay removed, in ms: the ~21.6 ms constant. */
  normalizedInputMs: number;
  /** Normalized primary round trip minus the run's mode, in seconds. */
  deltaFromModeSec: number;
  /** That delta in render quanta (128 frames at the run's rate) — 1.00 is the miss. */
  deltaQuanta: number;
  /** |delta| within 25 % of exactly one quantum: the signature being counted. */
  isOneQuantumMiss: boolean;
  /** Whether the build's own second-anchor check flagged this call. */
  flaggedByAnchorCheck: boolean;
  /**
   * Which capture anchor agrees with the run's mode, on a miss: `"A"` (the
   * reported one is right and B drifted), `"B"` (the reported one is the one
   * that is off — the case that would identify the culprit), `"both"`, `"neither"`,
   * or `null` when the build reports no second anchor.
   */
  anchorMatchingMode: "A" | "B" | "both" | "neither" | null;
}

interface RepeatSummary {
  calls: number;
  /**
   * Calls that returned a finite round trip — the population the mode is taken
   * over. 0 means every call was non-ok and NOTHING below is meaningful: the
   * mode is NaN, no call can be a miss, and the phase must be read as unusable
   * rather than as "0 misses".
   */
  usableCalls: number;
  /** The delays the phase cycled through, in call order; one entry means a fixed
   *  delay. (Artifacts from before the cycle carry a scalar `delayMs` instead.) */
  delayCycleMs: number[];
  /** Modal round trip with each call's own delay removed, the value a call is
   *  judged against — normalized, because with a cycling delay the raw round
   *  trips differ by design. */
  modeRoundTripSec: number;
  /** The same mode as an input part in ms: the constant the phase is testing. */
  modeNormalizedInputMs: number;
  /** How many calls share the mode. */
  modeCount: number;
  renderQuantumSec: number;
  /** Calls one quantum off the mode (±25 %). */
  oneQuantumMisses: number;
  /** Of those, how many the build's second-anchor check flagged. */
  missesFlaggedByAnchorCheck: number;
  /** Calls the anchor check flagged that were NOT one quantum off the mode. */
  flaggedWithoutMiss: number;
  /** Per miss, which anchor matched the mode — the observation Part 3 needs. */
  missAnchorVerdicts: {
    index: number; delayMs: number; previousDelayMs: number | null; isFirstAfterDelayChange: boolean;
    deltaQuanta: number; anchorMatchingMode: RepeatCall["anchorMatchingMode"]; reason: string | null;
  }[];
  /**
   * Does a miss follow a CHANGE of injected delay? A miss confined to the first
   * call after a change would point at the loopback's own `DelayNode` settling,
   * i.e. the harness, rather than at anything in the SDK. Both base rates are
   * given so the comparison is possible rather than implied.
   */
  callsAfterDelayChange: number;
  callsAfterSameDelay: number;
  missesAfterDelayChange: number;
  missesAfterSameDelay: number;
  /** False when the served build returns no `roundTripSecondsSecondary` at all. */
  secondAnchorAvailable: boolean;
}

/** A sweep point that was never run because its predicted round trip exceeded the SDK's search window. */
interface SkippedDelay {
  requestedDelayMs: number;
  predictedRoundTripSec: number;
  ceilingSec: number;
  reason: string;
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

/** Which input the run calibrates against — see the header. */
type InputMode = "loopback" | "real";

/** The input device a real-mode run chose, as `enumerateDevices` described it. */
interface RealDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

/**
 * `MediaStreamTrack.getSettings()` of the armed capture's track — the proof of
 * the processing state the SDK asked for (`echoCancellation` etc. all false)
 * and the browser's own latency figure for the device. `latency` is not in the
 * TS DOM lib any more, so it is read defensively; null when absent.
 */
interface TrackSettingsRecord {
  deviceId: string | null;
  groupId: string | null;
  latency: number | null;
  sampleRate: number | null;
  channelCount: number | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
}

/** A real-mode repeat call: the loopback rows' analysis fields plus which chain it ran on. */
/**
 * A real-mode repeat call: the SDK `Result` verbatim plus its position and
 * chain. NOTHING loopback-derived is on it — the pooled-mode `deltaQuanta` /
 * `isOneQuantumMiss` fields of `RepeatCall` read a fresh run's second chain as
 * fifteen misses of the first chain's value; `realSummary` (per chain) is the
 * authority on what a call was.
 */
interface RealRepeatCall extends CalibrationResult {
  index: number;
  /** 0 for the chain armed at the start; 1 for the chain `?armState=fresh` rebuilt mid-run. */
  chainIndex: number;
}

/** One arm of the real-mode run: what was asked for, what the stream reported, and its track. */
interface RealArmInfo {
  chainIndex: number;
  requestedDeviceId: string;
  /** The device id the armed stream reported (`capture.streamDeviceId`). */
  streamDeviceId: string;
  /** True when the stream's id is not the requested one — the SDK fell back to another input. */
  fallback: boolean;
  settings: TrackSettingsRecord | null;
}

interface CellOutcome {
  scenario: string;
  /**
   * The runner's verdict; `error` when the cell was NOT run because the
   * applied calibration stored nothing (see the gate after `apply` in
   * `runCalibrationAudit`) — a cell that recorded uncalibrated would otherwise
   * carry an ordinary verdict for a calibration it never tested; `skipped` in
   * real-input mode, where the cell cannot run at all (see the header).
   */
  status: CellClassification["status"] | "error" | "skipped";
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
  /** Which SDK surfaces this build exposes — see src/lib/audit/buildFeatures.ts. */
  buildFeatures: AuditBuildFeature[];
  /** `named` (the box names the loopback device) or `default` (`?defaultInput=1`). */
  captureMode: CaptureMode;
  /** Streams the SDK opened during the run — one means every take reused one chain. */
  getUserMediaOpens: number;
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
  /** `?repeat=` phase: every call verbatim, empty when the phase was skipped. */
  repeats: RepeatCall[] | RealRepeatCall[];
  /** null when the phase was skipped. */
  repeatSummary: RepeatSummary | null;
  /** Points refused before running — see `SkippedDelay` and the ceiling constants. */
  skipped: SkippedDelay[];
  /**
   * Least squares over the `ok` rows ONLY. A `noisy` verdict means the SDK's own
   * spread bound was exceeded, so those rows are excluded from the headline fit
   * rather than entering it silently; `fitIncludingNoisy` keeps the all-rows
   * answer so the exclusion's effect is visible instead of assumed.
   */
  fit: LeastSquaresFit | null;
  fitIncludingNoisy: LeastSquaresFit | null;
  /** How many sweep rows the headline fit dropped, and at which delays. */
  fitExcludedNoisy: { count: number; delaysMs: number[]; verdicts: string[] };
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
  cellRowStates: CellRowState[];
  /** Which input the run calibrated against — `loopback` (the default) or `real`. Additive: envelopes before it are loopback. */
  inputMode: InputMode;
  // --- real-input mode only; absent on loopback envelopes -------------------
  /** Free text the user typed to say what was plugged in ("cable loopback", "laptop mic + speakers"). */
  runLabel?: string;
  device?: RealDevice;
  /** The id each armed stream reported, in arm order (two entries on `?armState=fresh`). */
  armedStreamDeviceIds?: string[];
  /** True when a re-armed stream reported an id different from the first arm's; `deviceId` is then the last one. */
  streamDeviceIdChanged?: boolean;
  /** The device the user chose — what every arm asked the SDK for. */
  requestedDeviceId?: string;
  /** True when ANY armed stream reported an id other than `requestedDeviceId`: the SDK fell back to another input. */
  deviceFallback?: boolean;
  /** Every arm in order (index = chainIndex): requested vs reported id, fallback flag, the track's settings. */
  arms?: RealArmInfo[];
  /** The first chain's track settings (kept for readers of the earlier envelopes); all chains are in `trackSettingsPerChain`. */
  trackSettings?: TrackSettingsRecord | null;
  trackSettingsPerChain?: (TrackSettingsRecord | null)[];
  /** `audioContext.outputLatency` at run start, before any probe played — may be 0 (recorded, not refused). */
  outputLatencyAtStartSec?: number;
  /** The same property re-read after the first calibration call returned. */
  outputLatencyAfterFirstCallSec?: number | null;
  baseLatencySec?: number;
  /** The descriptive shape summary — see `src/lib/audit/realInputSummary.ts`. */
  realSummary?: RealInputSummary;
}

// --- run -------------------------------------------------------------------

// `reportDeviceId: true` — the SDK stores a calibration under the stream's own
// device id and refuses to store one under the empty id a
// MediaStreamAudioDestinationNode track reports. It also makes the SDK reuse
// one stream across recordings instead of opening a fresh one per take (see
// `stampDeviceId`), which is the configuration this measurement needs: a
// calibration only describes the stream it ran on, and the applied cell has to
// record on that same stream. The alignment harness deliberately leaves it off.
/**
 * `?defaultInput=1` — leave the capture box's `deviceId` unset so the SDK opens
 * its DEFAULT input, and have the loopback serve that unconstrained request
 * (`serveDefault` in loopbackInjection.ts). Not a reuse-versus-rebuild switch
 * on this page — with `reportDeviceId` on, the named mode reuses its chain too
 * (see the header) — but a choice of WHICH reuse rule runs: the unnamed-box
 * rule from `546b5bfaa` instead of the named-device one. The served clone still
 * reports a concrete device id, so a calibration is stored and resolved exactly
 * as it is when a device is named.
 */
const DEFAULT_INPUT = params.get("defaultInput") === "1";
/** Persisted per run so an envelope says which `#updateStream` path it took. */
const CAPTURE_MODE: CaptureMode = DEFAULT_INPUT ? "default" : "named";

/**
 * MODE GATE. `?input=real` is decided at module level because the loopback
 * install below overrides `getUserMedia` for the whole page: in real mode it
 * must never be installed, or the "real" device would be the synthetic one.
 * Only the exact string selects real mode here; anything else leaves the
 * loopback installed and is then REJECTED by `resolveInputMode` at run time
 * (a throw during module evaluation would never reach the state badge).
 */
const REAL_INPUT = params.get("input") === "real";

/**
 * Real mode counts the page's ACTUAL `getUserMedia` opens — the label unlock in
 * the `device` stage plus every stream the SDK opens at arm — by wrapping the
 * method with a pass-through counter (no behaviour is changed; the loopback's
 * override is what real mode must not install). Cumulative per page load, like
 * the loopback handle's counter: a Re-run persists the total since load.
 */
let realGetUserMediaOpens = 0;
if (REAL_INPUT) {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (constraints?: MediaStreamConstraints) => {
    realGetUserMediaOpens++;
    return original(constraints);
  };
}

function resolveInputMode(param: string | null): InputMode {
  const raw = param ?? "loopback";
  if (raw !== "loopback" && raw !== "real") throw new Error(`invalid ?input= "${raw}" — loopback|real`);
  return raw;
}

/**
 * null in real mode. Every loopback-only path goes through `requireLoopback()`
 * so a real-mode run that strays into one fails loudly instead of touching a
 * handle that was never installed.
 */
const loopback: LoopbackHandle | null = REAL_INPUT
  ? null
  : installLoopbackCapture(1, { reportDeviceId: true, serveDefault: DEFAULT_INPUT });

function requireLoopback(where: string): LoopbackHandle {
  if (loopback === null) {
    throw new Error(`${where}: loopback-only path entered in ?input=real mode — the synthetic loopback is not installed`);
  }
  return loopback;
}

/** Same marker the alignment harness probes — see its `detectSdkBuildProbe`. */
function detectSdkBuildProbe(engine: unknown): SdkBuildProbe {
  const facade = engine as { recordingStart?: { isEmpty?: unknown } };
  return typeof facade?.recordingStart?.isEmpty === "function" ? "candidate" : "upstream";
}

/**
 * Hard ceiling on a requested delay: even with a zero-latency chain, a round trip
 * at or above `SDK_MAX_ROUND_TRIP_SEC` is outside the correlation's search window.
 * The real ceiling is lower by the chain's own delay and the virtual output leg,
 * and that part is enforced at run time once those are measured (see
 * `predictedRoundTripSec` in `runCalibrationAudit`) — a static bound cannot know
 * them. Refusing here turns "the page silently reported no-signal" into a stated
 * reason on the state badge.
 */
const MAX_REQUESTED_DELAY_MS = (SDK_MAX_ROUND_TRIP_SEC - ROUND_TRIP_HEADROOM_SEC) * 1000;

function resolveDelaysMs(param: string | null): number[] {
  const raw = param ?? "0,10,25,50";
  const values = raw.split(",").map((part) => Number(part.trim()));
  if (values.length === 0 || values.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error(`invalid ?delays= "${raw}" — comma-separated milliseconds, each ≥ 0`);
  }
  const overCeiling = values.filter((v) => v > MAX_REQUESTED_DELAY_MS);
  if (overCeiling.length > 0) {
    throw new Error(
      `?delays= refused: ${overCeiling.join(", ")} ms exceed the ${MAX_REQUESTED_DELAY_MS.toFixed(0)} ms ceiling ` +
      `(the SDK correlates round trips up to ${(SDK_MAX_ROUND_TRIP_SEC * 1000).toFixed(0)} ms only, less ` +
      `${(ROUND_TRIP_HEADROOM_SEC * 1000).toFixed(0)} ms headroom; the output leg and the chain's own delay ` +
      `come off it too, so the effective ceiling is lower still and is enforced per point at run time)`
    );
  }
  return values;
}

/**
 * `?repeat=N` — after the sweep, run N further calibrations back to back on the
 * SAME armed chain (no re-arm, the return delay left where the sweep put it).
 * The point is the miss the campaign saw once: a call whose round trip came back
 * exactly one render quantum short with all three bursts agreeing and a verdict
 * of `ok`. One call cannot show that; N in a row measure how often it happens
 * and whether the second capture anchor catches it. 0 (the default) skips the
 * phase entirely, so every other run is unaffected. Pair it with `delays=0`:
 * the phase is about repetition at one delay, not about the delay.
 */
function resolveRepeatCount(param: string | null, mode: InputMode = "loopback"): number {
  // Real mode IS the repeat phase, so it defaults to 10 and needs at least one call.
  const min = mode === "real" ? 1 : 0;
  if (param === null) return mode === "real" ? 10 : 0;
  const n = Number(param);
  if (!Number.isInteger(n) || n < min || n > 200) {
    throw new Error(`invalid ?repeat= "${param}" — a whole number of calibrations in [${min}, 200]`);
  }
  return n;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Judge each repeat call against the run's modal round trip.
 *
 * "One quantum off" is |delta| within 25 % of exactly one 128-frame quantum, as
 * the brief defines it — wide enough to catch a miss that also carries the
 * ordinary sub-millisecond wobble, narrow enough not to swallow a half- or
 * double-quantum excursion, which would be a different finding.
 *
 * `anchorMatchingMode` is the observation that decides whether the offending
 * anchor is identifiable: on a miss, the anchor within half a quantum of the
 * mode is the one that stayed right. "B" would mean the REPORTED round trip is
 * the one that drifted.
 */
function summarizeRepeats(
  calls: { result: CalibrationResult; delayMs: number }[],
  sampleRate: number,
  delayCycleMs: number[]
): { rows: RepeatCall[]; summary: RepeatSummary } {
  const renderQuantumSec = 128 / sampleRate;
  // With a cycling delay the raw round trips differ by design, so every call is
  // compared on its round trip with its OWN delay removed — the chain's own
  // round trip, which is what should be constant.
  const normalized = (call: { result: CalibrationResult; delayMs: number }) =>
    call.result.roundTripSeconds - call.delayMs / 1000;
  const usable = calls.filter((call) => Number.isFinite(call.result.roundTripSeconds));
  const mode = usable.length > 0
    ? modeAtFrameResolution(usable.map(normalized), sampleRate)
    : { value: Number.NaN, count: 0 };
  const matchesMode = (value: number | undefined, delaySec: number) =>
    value !== undefined && Number.isFinite(value) && Math.abs(value - delaySec - mode.value) <= 0.5 * renderQuantumSec;

  const rows: RepeatCall[] = calls.map((call, index) => {
    const { result, delayMs } = call;
    const delaySec = delayMs / 1000;
    const previousDelayMs = index === 0 ? null : calls[index - 1].delayMs;
    const normalizedRoundTripSec = normalized(call);
    const deltaFromModeSec = normalizedRoundTripSec - mode.value;
    const deltaQuanta = deltaFromModeSec / renderQuantumSec;
    const isOneQuantumMiss = Math.abs(Math.abs(deltaQuanta) - 1) <= 0.25;
    const flaggedByAnchorCheck = (result.reason ?? "").includes("capture anchors disagree");
    const hasSecondary = result.roundTripSecondsSecondary !== undefined;
    const anchorMatchingMode: RepeatCall["anchorMatchingMode"] = !hasSecondary
      ? null
      : matchesMode(result.roundTripSeconds, delaySec)
        ? (matchesMode(result.roundTripSecondsSecondary, delaySec) ? "both" : "A")
        : (matchesMode(result.roundTripSecondsSecondary, delaySec) ? "B" : "neither");
    return {
      ...result, index, delayMs, previousDelayMs,
      isFirstAfterDelayChange: previousDelayMs !== null && previousDelayMs !== delayMs,
      normalizedRoundTripSec,
      normalizedInputMs: result.inputLatencySeconds * 1000 - delayMs,
      deltaFromModeSec, deltaQuanta, isOneQuantumMiss, flaggedByAnchorCheck, anchorMatchingMode,
    };
  });

  const misses = rows.filter((row) => row.isOneQuantumMiss);
  const afterChange = rows.filter((row) => row.isFirstAfterDelayChange);
  const afterSame = rows.filter((row) => row.previousDelayMs !== null && !row.isFirstAfterDelayChange);
  return {
    rows,
    summary: {
      calls: rows.length,
      usableCalls: usable.length,
      delayCycleMs,
      modeRoundTripSec: mode.value,
      // The output leg of the first USABLE call: call 1 can be an error row in real mode.
      modeNormalizedInputMs: mode.value * 1000 - (usable[0]?.result.outputLatencySeconds ?? 0) * 1000,
      modeCount: mode.count,
      renderQuantumSec,
      oneQuantumMisses: misses.length,
      missesFlaggedByAnchorCheck: misses.filter((row) => row.flaggedByAnchorCheck).length,
      flaggedWithoutMiss: rows.filter((row) => row.flaggedByAnchorCheck && !row.isOneQuantumMiss).length,
      missAnchorVerdicts: misses.map((row) => ({
        index: row.index,
        delayMs: row.delayMs,
        previousDelayMs: row.previousDelayMs,
        isFirstAfterDelayChange: row.isFirstAfterDelayChange,
        deltaQuanta: row.deltaQuanta,
        anchorMatchingMode: row.anchorMatchingMode,
        reason: row.reason ?? null,
      })),
      callsAfterDelayChange: afterChange.length,
      callsAfterSameDelay: afterSame.length,
      missesAfterDelayChange: afterChange.filter((row) => row.isOneQuantumMiss).length,
      missesAfterSameDelay: afterSame.filter((row) => row.isOneQuantumMiss).length,
      secondAnchorAvailable: rows.some((row) => row.roundTripSecondsSecondary !== undefined),
    },
  };
}

interface CalibrationContext {
  project: Project;
  audioContext: AudioContext;
  capture: CaptureAudio;
  calibrating: CalibratingCapture;
  unitAdapter: AudioUnitBoxAdapter;
  deviceId: string;
  sdkBuildProbe: SdkBuildProbe;
  buildFeatures: AuditBuildFeature[];
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

/** Boot the engine and create the one Tape whose capture the run calibrates. Shared by both modes;
 *  only the loopback mode passes an engine tap (real mode has nothing to route the engine into). */
async function bootProject(rate: number, bpm: number): Promise<Omit<CalibrationContext, "deviceId" | "bias">> {
  const { project, audioContext } = await initializeOpenDAW({
    bpm,
    audioContextSampleRate: rate,
    engineTap: loopback === null ? undefined : (node) => loopback.engineTap(node),
  });
  const sdkBuildProbe = detectSdkBuildProbe(project.engine);
  const buildFeatures = detectBuildFeatures(project.engine);
  console.log("[input-latency-calibration] buildFeatures=[" + buildFeatures.join(",") + "]");

  let audioUnitBox: AudioUnitBox | null = null;
  project.editing.modify(() => {
    audioUnitBox = project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox;
  });
  if (audioUnitBox === null) throw new Error("createInstrument did not return audioUnitBox");
  const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
  if (!(capture instanceof CaptureAudio)) throw new Error("capture is not CaptureAudio");
  const calibrating = calibratingCaptureOf(capture);
  const unitAdapter = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBox);
  if (!unitAdapter) throw new Error("no audio unit adapter for tape");
  return { project, audioContext, capture, calibrating, unitAdapter, sdkBuildProbe, buildFeatures };
}

async function createContext(rate: number, bpm: number): Promise<CalibrationContext> {
  const loopback = requireLoopback("createContext");
  const { project, audioContext, capture, calibrating, unitAdapter, sdkBuildProbe, buildFeatures } =
    await bootProject(rate, bpm);
  loopback.attach(audioContext);
  const bias = await resolveHarnessPathBias(audioContext);

  project.editing.modify(() => {
    // `defaultInput` leaves the box's deviceId unset — see DEFAULT_INPUT.
    if (!DEFAULT_INPUT) capture.captureBox.deviceId.setValue(LOOPBACK_DEVICE_ID);
    capture.requestChannels = 1;
  });
  capture.armed.setValue(true);
  const deviceId = await waitForStream(capture, STREAM_DEADLINE_MS);
  console.log("[input-latency-calibration] stream open on deviceId=" + deviceId + " defaultInput=" + String(DEFAULT_INPUT));
  return { project, audioContext, capture, calibrating, unitAdapter, deviceId, sdkBuildProbe, buildFeatures, bias };
}

/**
 * Real mode: boot only. Arming waits for the user's device choice
 * (`armRealDevice`), and the bias is 0 by construction — the probe traverses
 * the real output device, so there is no missing leg to model. `deviceId` is
 * filled in per run from the stream the arm opens.
 */
async function createRealContext(rate: number, bpm: number): Promise<CalibrationContext> {
  if (loopback !== null) throw new Error("createRealContext: the loopback is installed — not in ?input=real mode");
  const booted = await bootProject(rate, bpm);
  return { ...booted, deviceId: "", bias: { valueSec: 0, settleMs: 0 } };
}

// Booted once per page load (`Workers.install` asserts on a second
// `initializeOpenDAW`) — "Re-run" reuses it under a fresh run token.
let contextPromise: Promise<CalibrationContext> | null = null;
function getContext(rate: number, bpm: number): Promise<CalibrationContext> {
  if (contextPromise === null) contextPromise = REAL_INPUT ? createRealContext(rate, bpm) : createContext(rate, bpm);
  return contextPromise;
}

/**
 * One calibration call, with the destination teed into the loopback for its
 * duration. The deadline is handed to the tee rather than wrapped around it, so
 * a timeout restores `AudioNode.prototype.connect` instead of leaving the tee
 * armed for the next call (see `captureDestinationDuring`).
 */
function calibrateThroughLoopback(
  calibrating: CalibratingCapture,
  virtualOutputLegSec: number,
  apply: boolean
): Promise<CalibrationResult> {
  return requireLoopback("calibrateThroughLoopback").captureDestinationDuring(
    virtualOutputLegSec,
    () => calibrating.calibrateInputLatency(apply ? { apply: true } : {}),
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
  onFit: (
    fit: LeastSquaresFit | null,
    fitIncludingNoisy: LeastSquaresFit | null,
    excluded: { count: number; delaysMs: number[]; verdicts: string[] }
  ) => void;
  onSkipped: (skipped: SkippedDelay) => void;
  onRepeatCall: (result: CalibrationResult, index: number) => void;
  onRepeatSummary: (summary: RepeatSummary) => void;
  onWarmup: (result: CalibrationResult) => void;
  onApplied: (result: CalibrationResult, entry: CalibrationEntry | null) => void;
  onCell: (
    cell: CellOutcome,
    hopSec: number | null,
    rowStates: CellRowState[]
  ) => void;
  onBuildProbe: (probe: SdkBuildProbe) => void;
}

async function runCalibrationAudit(cb: RunCallbacks): Promise<void> {
  cb.setState("setup");
  // Validates `?input=` for the loopback run too, so a misspelt value is a
  // stated error rather than a silent loopback run.
  resolveInputMode(params.get("input"));
  const loopback = requireLoopback("runCalibrationAudit");
  const delaysMs = resolveDelaysMs(params.get("delays"));
  const bpm = resolveNumber(params.get("bpm"), 120, "bpm");
  const rate = resolveNumber(params.get("rate"), 48000, "rate");
  const armState = resolveArmState(params.get("armState"));
  const repeatCount = resolveRepeatCount(params.get("repeat"));
  const runToken = Date.now();

  const { project, audioContext, capture, calibrating, unitAdapter, deviceId, sdkBuildProbe, buildFeatures, bias } =
    await getContext(rate, bpm);
  cb.onBuildProbe(sdkBuildProbe);
  // `resolveHarnessPathBias` returns 0 with only a console warning when
  // `outputLatency` never became readable. On the alignment harness that only
  // mis-adjusts rows; here the same number is ALSO the virtual output leg the
  // probe traverses, so a 0 would make every calibration measure a round trip
  // short by the real output leg and the applied cell land that much late —
  // a wrong answer that would look like a finding. Refuse instead.
  if (!(bias.valueSec > 0)) {
    throw new Error(
      `audioContext.outputLatency read ${String(bias.valueSec)} after ${bias.settleMs.toFixed(0)} ms — the virtual ` +
      "output leg would be 0 and every calibration would measure short; the value is read once per page load, " +
      "so navigate fresh and re-run"
    );
  }
  console.log(
    "[input-latency-calibration] run " + String(runToken) +
    " rate=" + String(rate) + " bpm=" + String(bpm) +
    " delaysMs=[" + delaysMs.join(",") + "]" +
    " armState=" + armState +
    " repeat=" + String(repeatCount) +
    " harnessPathBiasSec=" + bias.valueSec.toFixed(6)
  );

  // A stale entry from an earlier run on this page would be applied to the
  // sweep cells too — the sweep must measure the raw path.
  calibrating.clearInputLatencyCalibration();

  // STEADY-STATE PRIMING — one calibration, discarded from the fit. It is not
  // "warming up the loopback": it moves the SDK's input chain out of its
  // fresh-chain state and into the state every later use of that chain runs in.
  //
  // ON SDK `f0c44b06c` (calibration routine, no keep-alive sink) and with the
  // stream reused (`reportDeviceId`), the first pull on a chain reads 13-21 ms of
  // input delay and every later pull on the same chain reads 58-69 ms —
  // permanently, until `#updateStream` rebuilds it. That held for takes as well
  // as calibrations: uncalibrated `nominal-start` runs on the reused stream
  // measured take 1 at 17.0 / 13.0 ms and takes 2-3 at 63.6-67.6 ms. From
  // `ac1c15ea8` the sink keeps the source pulled and that ratchet is gone (every
  // pull ~21 ms); priming stays useful because a chain's delay is still fixed
  // when the chain is built, so the calibration must run on the chain the take
  // will use. Between uses the reused `MediaStreamAudioSourceNode` is
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
  const skipped: SkippedDelay[] = [];
  // Round trip this chain would show at D = 0, i.e. output leg + chain delay.
  // Seeded from the priming call and re-anchored after every measured row, so the
  // per-point ceiling below is checked against what this run actually measures
  // rather than a guess. On SDK `f0c44b06c` (before the keep-alive sink) the
  // priming value was the fresh-chain one and understated the steady state by
  // the ~45 ms step, which the headroom absorbs until the first row re-anchors
  // it; from `ac1c15ea8` the two agree to within the ~8 ms two-state step.
  // Only an `ok` row re-anchors: a `noisy` or `no-signal` round trip is the
  // SDK saying it could not trust that number, so it must not set the ceiling.
  let roundTripAtZeroSec = Number.isFinite(warmup.roundTripSeconds) ? warmup.roundTripSeconds : 0;
  for (const delayMs of delaysMs) {
    const predictedRoundTripSec = roundTripAtZeroSec + delayMs / 1000;
    const ceilingSec = SDK_MAX_ROUND_TRIP_SEC - ROUND_TRIP_HEADROOM_SEC;
    if (predictedRoundTripSec > ceilingSec) {
      const reason =
        `predicted round trip ${(predictedRoundTripSec * 1000).toFixed(1)} ms exceeds the ` +
        `${(ceilingSec * 1000).toFixed(0)} ms searchable ceiling ` +
        `(chain + output leg measures ${(roundTripAtZeroSec * 1000).toFixed(1)} ms at D = 0)`;
      skipped.push({ requestedDelayMs: delayMs, predictedRoundTripSec, ceilingSec, reason });
      cb.onSkipped({ requestedDelayMs: delayMs, predictedRoundTripSec, ceilingSec, reason });
      console.warn("[input-latency-calibration] D=" + String(delayMs) + "ms SKIPPED: " + reason);
      continue;
    }
    cb.setState(`sweep:${delayMs}ms`);
    loopback.setReturnDelay(delayMs / 1000);
    await sleep(DELAY_SETTLE_MS);
    const result = await calibrateThroughLoopback(calibrating, bias.valueSec, false);
    const row: SweepRow = { requestedDelayMs: delayMs, requestedDelaySec: delayMs / 1000, ...result };
    sweep.push(row);
    if (result.verdict === "ok" && Number.isFinite(result.roundTripSeconds)) {
      roundTripAtZeroSec = result.roundTripSeconds - delayMs / 1000;
    }
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

  // M2: a `noisy` verdict is the SDK saying its own spread bound was exceeded on
  // that call. Those rows are EXCLUDED from the headline fit; the all-rows fit is
  // computed too, so the exclusion's effect is visible rather than assumed.
  const okRows = sweep.filter((row) => row.verdict === "ok");
  const excludedRows = sweep.filter((row) => row.verdict !== "ok");
  const asPoint = (row: SweepRow) => ({ x: row.requestedDelaySec, y: row.inputLatencySeconds });
  const fit = leastSquares(okRows.map(asPoint));
  const fitIncludingNoisy = leastSquares(sweep.map(asPoint));
  const fitExcludedNoisy = {
    count: excludedRows.length,
    delaysMs: excludedRows.map((row) => row.requestedDelayMs),
    verdicts: excludedRows.map((row) => row.verdict),
  };
  cb.onFit(fit, fitIncludingNoisy, fitExcludedNoisy);
  if (fit !== null) {
    console.log(
      "[input-latency-calibration] fit(ok-only) slope=" + fit.slope.toFixed(4) +
      " interceptMs=" + (fit.interceptSec * 1000).toFixed(3) +
      " points=" + String(fit.points) +
      " maxAbsResidualMs=" + fit.maxAbsResidualMs.toFixed(3) +
      " excludedNonOkRows=" + String(fitExcludedNoisy.count) +
      (fitIncludingNoisy === null
        ? ""
        : " fit(all rows) slope=" + fitIncludingNoisy.slope.toFixed(4) +
          " interceptMs=" + (fitIncludingNoisy.interceptSec * 1000).toFixed(3))
    );
  }

  // `?repeat=N`: N more calibrations back to back on the same chain, before the
  // apply so the stored value is still measured the way every other run measures
  // it. Nothing is re-armed.
  //
  // The phase CYCLES the delays `?delays=` names: call k runs at
  // `delays[k % delays.length]`, with `setReturnDelay` and the same 200 ms settle
  // before each call, exactly as the sweep does. One delay in the list means a
  // fixed delay, which is what the earlier batches ran.
  //
  // Cycling is the point of this variant: the run that showed the one-quantum
  // miss had a delay that CHANGED between calls, and a miss confined to the first
  // call after a change would be the loopback's own `DelayNode` settling — the
  // harness — rather than anything in the SDK. `isFirstAfterDelayChange` on each
  // call is what makes that separable.
  const delayCycleMs = delaysMs.length > 0 ? delaysMs : [0];
  const repeatCalls: { result: CalibrationResult; delayMs: number }[] = [];
  if (repeatCount > 0) {
    console.log(
      "[input-latency-calibration] repeat phase cycling D=[" + delayCycleMs.join(",") + "]ms, " +
      String(repeatCount) + " calls"
    );
  }
  for (let index = 0; index < repeatCount; index++) {
    const delayMs = delayCycleMs[index % delayCycleMs.length];
    cb.setState(`repeat:${index + 1}/${repeatCount}`);
    loopback.setReturnDelay(delayMs / 1000);
    await sleep(DELAY_SETTLE_MS);
    const result = await calibrateThroughLoopback(calibrating, bias.valueSec, false);
    repeatCalls.push({ result, delayMs });
    cb.onRepeatCall(result, index);
    console.log(
      "[input-latency-calibration] repeat " + String(index + 1) + "/" + String(repeatCount) +
      " D=" + String(delayMs) + "ms" +
      " inputMinusDelayMs=" + (result.inputLatencySeconds * 1000 - delayMs).toFixed(4) +
      " verdict=" + result.verdict +
      " roundTripSec=" + String(result.roundTripSeconds) +
      " secondarySec=" + String(result.roundTripSecondsSecondary) +
      " captureStartTimes=[" + (result.captureStartTimes ?? []).join(",") + "]" +
      " spreadSec=" + String(result.spreadSeconds) +
      " reason=" + String(result.reason ?? "(none)")
    );
  }
  const repeatAnalysis = repeatCount > 0 ? summarizeRepeats(repeatCalls, rate, delayCycleMs) : null;
  if (repeatAnalysis !== null) {
    const { summary } = repeatAnalysis;
    if (summary.usableCalls === 0) {
      console.warn(
        "[input-latency-calibration] repeat phase UNUSABLE: none of " + String(summary.calls) +
        " calls returned a finite round trip (verdicts: " + repeatCalls.map((c) => c.result.verdict).join(",") + ")"
      );
    }
    console.log(
      "[input-latency-calibration] repeat summary calls=" + String(summary.calls) +
      " usableCalls=" + String(summary.usableCalls) +
      " delayCycleMs=[" + summary.delayCycleMs.join(",") + "]" +
      " modeNormalizedRoundTripMs=" + (summary.modeRoundTripSec * 1000).toFixed(4) +
      " modeNormalizedInputMs=" + summary.modeNormalizedInputMs.toFixed(4) +
      " missesAfterDelayChange=" + String(summary.missesAfterDelayChange) + "/" + String(summary.callsAfterDelayChange) +
      " missesAfterSameDelay=" + String(summary.missesAfterSameDelay) + "/" + String(summary.callsAfterSameDelay) +
      " modeCount=" + String(summary.modeCount) +
      " quantumMs=" + (summary.renderQuantumSec * 1000).toFixed(4) +
      " oneQuantumMisses=" + String(summary.oneQuantumMisses) +
      " flaggedMisses=" + String(summary.missesFlaggedByAnchorCheck) +
      " flaggedWithoutMiss=" + String(summary.flaggedWithoutMiss) +
      " secondAnchorAvailable=" + String(summary.secondAnchorAvailable) +
      " missAnchors=[" + summary.missAnchorVerdicts.map((m) => "#" + String(m.index) + ":" + String(m.anchorMatchingMode)).join(",") + "]"
    );
    cb.onRepeatSummary(summary);
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

  // GATE ON THE APPLIED OUTCOME. The SDK stores an entry only for an `ok` or
  // `noisy` result with finite numbers; on `no-signal`, `transport-running`,
  // `no-stream` or `context-not-running` it stores nothing, and a cell run now would record UNCALIBRATED
  // and still reach `done` with an ordinary verdict — on the candidate profile a
  // keep-alive chain lands in band F, so the page would report
  // `matches-known-defect` for a calibration it never tested. So the cell is
  // NOT run: the envelope is still persisted (the sweep is evidence on its
  // own), with `cell.status = "error"`, no rows and the apply verdict in the
  // detail. An empty row list is what the offline scripts already handle for
  // an all-failed cell, so the envelope stays parseable.
  //
  // A `noisy` applied verdict IS stored and used by the SDK, although the
  // sweep fit excludes noisy rows; the cell runs, and its detail says so.
  const appliedNote = applied.verdict === "noisy"
    ? "applied verdict noisy (the SDK stored and uses it, though the sweep fit excludes noisy rows) — "
    : "";
  let cell: CellOutcome;
  let hopSec: number | null = null;
  let hopPerRow: number[] = [];
  let cellRowStates: CellRowState[] = [];
  if (storedEntry === null) {
    const detail =
      `calibration not stored for "${deviceId}": apply verdict ${applied.verdict}` +
      (applied.reason !== undefined ? ` (${applied.reason})` : "") +
      " — the cell was NOT run, it would have recorded uncalibrated";
    console.error("[input-latency-calibration] " + detail);
    cell = {
      scenario: CELL_SCENARIO,
      status: "error",
      matchedSignature: null,
      detail,
      successfulRepeats: 0,
      errorRepeats: REPEATS_PER_CELL,
      errors: [detail],
      rows: [],
    };
  } else {
    // `?armState=fresh`: rebuild the SDK's input chain AFTER storing the
    // calibration, so take 1 records on a chain the stored value never measured
    // (on SDK `f0c44b06c`, before the keep-alive sink, ~45 ms below it; from
    // `ac1c15ea8` the same delay, or ~8 ms above or below it, depending on
    // which of the two states the rebuild draws). Disarming runs `#stopStream`
    // synchronously; re-arming runs the stream generator, and `waitForStream`
    // blocks until the new track reports its id. The stored entry is keyed by
    // device id, which does not change, so it still resolves — that is exactly
    // the hazard being measured.
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
        ? classifyCell(alignments, signatureBandsFor(CELL_SCENARIO, sdkBuildProbe, runToken, buildFeatures), ALIGNED_TOLERANCE_MS)
        : { status: "investigate", matchedSignature: null, detail: "no successful repeats to classify" };
    const detail = appliedNote + classification.detail;
    const cellRows = repeats.flatMap((r) => r.rows);
    for (const row of cellRows) {
      row.status = classification.status;
      row.matchedSignature = classification.matchedSignature;
      row.detail = detail;
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
    hopPerRow = cellRows.map(rowHopSec).filter((value): value is number => value !== null);
    hopSec = median(hopPerRow);
    // In `fresh` mode repeat 1 is the first pull on the rebuilt chain; in `steady`
    // mode the priming/sweep/applied calls already pulled it, so every repeat is a
    // reused pull.
    cellRowStates = cellRows.map((row) => ({
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
    cell = {
      scenario: CELL_SCENARIO,
      status: classification.status,
      matchedSignature: classification.matchedSignature,
      detail,
      successfulRepeats: repeats.length,
      errorRepeats: REPEATS_PER_CELL - repeats.length,
      errors: cellErrors,
      rows: cellRows,
    };
  }
  cb.onCell(cell, hopSec, cellRowStates);
  console.log(
    "[input-latency-calibration] cell status=" + cell.status +
    " repeats=" + String(cell.successfulRepeats) + "/" + String(REPEATS_PER_CELL) +
    " harnessLoopbackHopMs=" + (hopSec === null ? "n/a" : (hopSec * 1000).toFixed(3)) +
    " detail=" + cell.detail
  );

  cb.setState("uploading");
  await uploadSummary({
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    kind: "input-latency-calibration-ground-truth",
    runToken, rate, bpm, sdkBuildProbe, buildFeatures, deviceId,
    captureMode: CAPTURE_MODE,
    getUserMediaOpens: loopback.getUserMediaOpens(),
    outputLatency: bias.valueSec,
    baseLatency: audioContext.baseLatency,
    harnessPathBiasSec: bias.valueSec,
    harnessPathBiasSettleMs: bias.settleMs,
    virtualOutputLegSec: bias.valueSec,
    armState,
    warmup, sweep, skipped, fit, fitIncludingNoisy, fitExcludedNoisy, applied, storedEntry, cell,
    repeats: repeatAnalysis?.rows ?? [],
    repeatSummary: repeatAnalysis?.summary ?? null,
    harnessLoopbackHopSec: hopSec,
    harnessLoopbackHopPerRowSec: hopPerRow,
    cellRowStates,
    harnessLoopbackHopSource:
      "applied-cell rows: firstQuantumTimeSec − anchorT0Sec (only a recorded take exposes firstQuantumTime, so this is one value per run, not one per swept delay)",
    inputMode: "loopback",
  });
  cb.setState("done");
}

// --- real-input mode ---------------------------------------------------------

/**
 * `device` stage. One `getUserMedia({audio: true})` unlocks device labels (a
 * browser hands out empty labels until a capture permission has been granted);
 * its tracks are stopped at once — the SDK opens its own stream at arm. Then
 * every `audioinput` with a non-empty id, in enumeration order.
 */
async function enumerateRealInputs(): Promise<RealDevice[]> {
  // If the deadline fires first (a permission prompt left open), the browser
  // may still hand the stream out later — stop its tracks then, so no capture
  // is left running behind the page.
  let timedOut = false;
  const pending = navigator.mediaDevices.getUserMedia({ audio: true });
  pending.then((late) => {
    if (timedOut) {
      for (const track of late.getTracks()) track.stop();
      console.warn("[input-latency-calibration] label-unlock getUserMedia resolved after its deadline; tracks stopped");
    }
  }).catch(() => { /* the awaited branch below reports it */ });
  let unlock: MediaStream;
  try {
    unlock = await withDeadline(pending, STREAM_DEADLINE_MS, "getUserMedia({audio: true}) to unlock device labels");
  } catch (err) {
    timedOut = true;
    throw err;
  }
  for (const track of unlock.getTracks()) track.stop();
  const all = await navigator.mediaDevices.enumerateDevices();
  const inputs = all
    .filter((d) => d.kind === "audioinput" && d.deviceId !== "")
    .map((d) => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }));
  console.log("[input-latency-calibration] real inputs: " +
    (inputs.length === 0 ? "(none)" : inputs.map((d) => `"${d.label}" [${d.deviceId}]`).join(" · ")));
  if (inputs.length === 0) throw new Error("no audio input device with a non-empty id — nothing to calibrate against");
  return inputs;
}

function readTrackSettings(capture: CaptureAudio): TrackSettingsRecord | null {
  const trackOption = capture.streamMediaTrack;
  if (trackOption.isEmpty()) return null;
  const settings = trackOption.unwrap().getSettings() as MediaTrackSettings & { latency?: number };
  const orNull = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
  return {
    deviceId: orNull(settings.deviceId),
    groupId: orNull(settings.groupId),
    latency: typeof settings.latency === "number" && Number.isFinite(settings.latency) ? settings.latency : null,
    sampleRate: orNull(settings.sampleRate),
    channelCount: orNull(settings.channelCount),
    echoCancellation: orNull(settings.echoCancellation),
    noiseSuppression: orNull(settings.noiseSuppression),
    autoGainControl: orNull(settings.autoGainControl),
  };
}

/**
 * Point the capture box at `deviceId` and arm. A capture left armed by an
 * earlier run on this page (Re-run, possibly on another device) is disarmed
 * first, so the SDK rebuilds its chain on the device now chosen rather than
 * reusing the old one. Returns the device id the opened stream reports —
 * the key the SDK stores the calibration under.
 */
async function armRealDevice(project: Project, capture: CaptureAudio, deviceId: string): Promise<string> {
  if (capture.armed.getValue()) {
    capture.armed.setValue(false);
    await sleep(DELAY_SETTLE_MS);
  }
  project.editing.modify(() => {
    capture.captureBox.deviceId.setValue(deviceId);
    capture.requestChannels = 1;
  });
  capture.armed.setValue(true);
  return waitForStream(capture, STREAM_DEADLINE_MS);
}

/** The row persisted for a call that threw or timed out, so the run keeps going and
 *  the envelope keeps every earlier call. NaN figures (null in JSON) and a verdict
 *  outside the SDK's set make it unusable to `summarizeRealInput`. */
function errorResult(message: string, sampleRate: number): CalibrationResult {
  return {
    verdict: "error",
    roundTripSeconds: Number.NaN,
    outputLatencySeconds: Number.NaN,
    outputLatencyReported: false,
    inputLatencySeconds: Number.NaN,
    spreadSeconds: Number.NaN,
    correlationRatioDb: Number.NaN,
    identifiedBursts: 0,
    scheduledBursts: 0,
    sampleRate,
    measuredAt: Date.now(),
    reason: message,
  };
}

/**
 * One direct call, raced against the deadline. A throw or timeout is returned
 * as an `error` row rather than propagated: a deadline on call 17 of 30 must
 * not lose the sixteen calls before it, which is what an exception out of
 * `runRealInputAudit` before `uploadSummary` did.
 */
async function calibrateReal(calibrating: CalibratingCapture, apply: boolean, sampleRate: number, label: string): Promise<CalibrationResult> {
  try {
    return await withDeadline(
      calibrating.calibrateInputLatency(apply ? { apply: true } : {}),
      CALIBRATION_DEADLINE_MS,
      `calibrateInputLatency(apply=${String(apply)})`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[input-latency-calibration] " + label + " FAILED: " + message + " — persisted as an error row, continuing");
    return errorResult(message, sampleRate);
  }
}

function logCalibrationCall(prefix: string, result: CalibrationResult): void {
  console.log(
    "[input-latency-calibration] " + prefix +
    " verdict=" + result.verdict +
    " inputLatencySec=" + String(result.inputLatencySeconds) +
    " roundTripSec=" + String(result.roundTripSeconds) +
    " secondarySec=" + String(result.roundTripSecondsSecondary) +
    " outputLatencySec=" + String(result.outputLatencySeconds) +
    " reported=" + String(result.outputLatencyReported) +
    " spreadSec=" + String(result.spreadSeconds) +
    " ratioDb=" + String(result.correlationRatioDb) +
    " bursts=" + String(result.identifiedBursts) + "/" + String(result.scheduledBursts) +
    " captureStartTimes=[" + (result.captureStartTimes ?? []).join(",") + "]" +
    " reason=" + String(result.reason ?? "(none)")
  );
}

interface RealRunInput {
  device: RealDevice;
  runLabel: string;
}

interface RealRunCallbacks {
  setState: (state: string) => void;
  onBuildProbe: (probe: SdkBuildProbe) => void;
  /** Once per arm (chain 0 at `arming`, chain 1 at `rearming`). */
  onArm: (arm: RealArmInfo) => void;
  onRepeatCall: (result: CalibrationResult, index: number, chainIndex: number) => void;
  onRealSummary: (summary: RealInputSummary) => void;
  onApplied: (result: CalibrationResult | null, entry: CalibrationEntry | null) => void;
}

/** Arm the capture on `requestedDeviceId` (or re-arm it) and describe what the SDK actually opened. */
async function armAndDescribe(
  project: Project, capture: CaptureAudio, requestedDeviceId: string, chainIndex: number, rearm: boolean
): Promise<RealArmInfo> {
  let streamDeviceId: string;
  if (rearm) {
    capture.armed.setValue(false);
    await sleep(DELAY_SETTLE_MS);
    capture.armed.setValue(true);
    streamDeviceId = await waitForStream(capture, STREAM_DEADLINE_MS);
  } else {
    streamDeviceId = await armRealDevice(project, capture, requestedDeviceId);
  }
  const arm: RealArmInfo = {
    chainIndex, requestedDeviceId, streamDeviceId,
    fallback: streamDeviceId !== requestedDeviceId,
    settings: readTrackSettings(capture),
  };
  console.log("[input-latency-calibration] " + (rearm ? "re-armed" : "armed") + " chain " + String(chainIndex) +
    " on stream deviceId=" + streamDeviceId + " trackSettings=" + JSON.stringify(arm.settings));
  if (arm.fallback) {
    console.warn("[input-latency-calibration] DEVICE FALLBACK on chain " + String(chainIndex) + ": requested " +
      requestedDeviceId + " but the stream reports " + streamDeviceId +
      " — the SDK opened another input (its #updateStream falls back to the default when {exact} fails); persisted, not thrown");
  }
  return arm;
}

async function runRealInputAudit(input: RealRunInput, cb: RealRunCallbacks): Promise<void> {
  cb.setState("setup");
  const mode = resolveInputMode(params.get("input"));
  if (mode !== "real") throw new Error("runRealInputAudit called outside ?input=real mode");
  if (params.has("delays")) throw new Error("?delays= is rejected in ?input=real mode — there is no injected delay to sweep");
  if (params.has("defaultInput")) throw new Error("?defaultInput= is rejected in ?input=real mode — choose the device in the select instead");
  const bpm = resolveNumber(params.get("bpm"), 120, "bpm");
  const rate = resolveNumber(params.get("rate"), 48000, "rate");
  const armState = resolveArmState(params.get("armState"));
  const repeatCount = resolveRepeatCount(params.get("repeat"), "real");
  const runToken = Date.now();

  const { project, audioContext, capture, calibrating, sdkBuildProbe, buildFeatures } = await getContext(rate, bpm);
  cb.onBuildProbe(sdkBuildProbe);
  // The click that started the run is the gesture; resume explicitly rather
  // than rely on the document-level listener, which fires after this handler.
  if (audioContext.state !== "running") await audioContext.resume();
  const outputLatencyAtStartSec = audioContext.outputLatency;
  const baseLatencySec = audioContext.baseLatency;
  console.log(
    "[input-latency-calibration] REAL run " + String(runToken) +
    " rate=" + String(rate) + " bpm=" + String(bpm) +
    " armState=" + armState + " repeat=" + String(repeatCount) +
    " device=\"" + input.device.label + "\" [" + input.device.deviceId + "]" +
    " label=\"" + input.runLabel + "\"" +
    " outputLatencyAtStartSec=" + String(outputLatencyAtStartSec) +
    " baseLatencySec=" + String(baseLatencySec)
  );

  cb.setState("arming");
  calibrating.clearInputLatencyCalibration();
  const requestedDeviceId = input.device.deviceId;
  const arms: RealArmInfo[] = [await armAndDescribe(project, capture, requestedDeviceId, 0, false)];
  cb.onArm(arms[0]);
  const deviceId = arms[0].streamDeviceId;

  // N direct calls — no tee, no delay, nothing between the SDK and the device.
  // `fresh`: after call ⌈N/2⌉ the chain is rebuilt, so the second half measures
  // a chain the first half never saw; `chainIndex` says which.
  const rearmAfter = armState === "fresh" ? Math.ceil(repeatCount / 2) : Number.POSITIVE_INFINITY;
  const calls: { result: CalibrationResult; chainIndex: number }[] = [];
  let outputLatencyAfterFirstCallSec: number | null = null;
  let chainIndex = 0;
  // A re-arm that fails (the new stream never reports an id) ends the run —
  // but AFTER the envelope is uploaded with every call measured so far and an
  // `error` row standing in for the re-arm; see the end of this function.
  let rearmFailure: string | null = null;
  for (let index = 0; index < repeatCount; index++) {
    if (index === rearmAfter) {
      cb.setState("rearming");
      try {
        const arm = await armAndDescribe(project, capture, requestedDeviceId, 1, true);
        arms.push(arm);
        cb.onArm(arm);
        chainIndex = 1;
        if (arm.streamDeviceId !== deviceId) {
          console.warn("[input-latency-calibration] re-armed stream reports a DIFFERENT device id than the first arm (" +
            deviceId + " → " + arm.streamDeviceId + "); the stored entry is looked up under the new one");
        }
      } catch (err) {
        rearmFailure = err instanceof Error ? err.message : String(err);
        console.error("[input-latency-calibration] re-arm FAILED after call " + String(index) + ": " + rearmFailure +
          " — persisting an error row for it and uploading what was measured");
        const row = errorResult(`re-arm: ${rearmFailure}`, rate);
        calls.push({ result: row, chainIndex: 1 });
        cb.onRepeatCall(row, index, 1);
        break;
      }
    }
    cb.setState(`repeat:${index + 1}/${repeatCount}`);
    const result = await calibrateReal(calibrating, false, rate, `repeat ${index + 1}/${repeatCount}`);
    if (outputLatencyAfterFirstCallSec === null) outputLatencyAfterFirstCallSec = audioContext.outputLatency;
    calls.push({ result, chainIndex });
    cb.onRepeatCall(result, index, chainIndex);
    logCalibrationCall(`repeat ${index + 1}/${repeatCount} chain=${chainIndex}`, result);
  }
  // The id each armed stream reported, in arm order. The SDK keys the stored
  // entry on the stream the apply ran on, so the lookup below uses the LAST
  // one; a re-arm that reports a different id is recorded, not assumed away.
  const armedStreamDeviceIds = arms.map((arm) => arm.streamDeviceId);
  const deviceFallback = arms.some((arm) => arm.fallback);

  // Persisted verbatim: the SDK Result plus index and chain, nothing derived
  // from the loopback page's pooled-mode rules (see `RealRepeatCall`).
  const repeatRows: RealRepeatCall[] = calls.map((c, index) => ({ ...c.result, index, chainIndex: c.chainIndex }));
  const realSummary = summarizeRealInput(
    calls.map((c) => ({ ...c.result, chainIndex: c.chainIndex })),
    rate,
    // Each chain's own track reported its own latency.
    arms.map((arm) => arm.settings?.latency ?? null)
  );
  cb.onRealSummary(realSummary);
  console.log(
    "[input-latency-calibration] real summary verdict=" + realSummary.verdict +
    " usable=" + String(realSummary.usableCalls) + "/" + String(realSummary.calls) +
    " verdicts=" + JSON.stringify(realSummary.verdictCounts) +
    " medianInputMs=" + (realSummary.inputLatencySec === null ? "n/a" : (realSummary.inputLatencySec.median * 1000).toFixed(3)) +
    " basis=" + realSummary.verdictBasis +
    " stateTransitions=" + String(realSummary.stateTransitions.count) + " (oneQuantumSteps " + String(realSummary.stateTransitions.oneQuantumSteps) + ")" +
    " isolatedDeviations=" + String(realSummary.isolatedDeviations.count) +
    " anchorDisagreements=" + String(realSummary.anchorDisagreements.flaggedBySdk) + "/" + String(realSummary.anchorDisagreements.rederived) +
    " perChainModesMs=[" + realSummary.perChain.map((c) => String(c.chainIndex) + ":" + (c.modeInputLatencySec === null ? "n/a" : (c.modeInputLatencySec * 1000).toFixed(3))).join(",") + "]" +
    " reportedLatencySec=" + String(realSummary.reportedLatencySec) +
    " deviceFallback=" + String(deviceFallback) +
    " detail=" + realSummary.detail
  );

  // The apply is skipped when the re-arm failed: there is no chain to apply on.
  const appliedStreamDeviceId = armedStreamDeviceIds[armedStreamDeviceIds.length - 1];
  let applied: CalibrationResult | null = null;
  let storedEntry: CalibrationEntry | null = null;
  if (rearmFailure === null) {
    cb.setState("applying");
    applied = await calibrateReal(calibrating, true, rate, "applied");
    storedEntry = storedCalibrations(project).find((entry) => entry.deviceId === appliedStreamDeviceId) ?? null;
    logCalibrationCall("applied", applied);
  }
  const streamDeviceIdChanged = armedStreamDeviceIds.some((id) => id !== deviceId);
  cb.onApplied(applied, storedEntry);
  console.log("[input-latency-calibration] storedEntry(" + appliedStreamDeviceId + ")=" +
    (storedEntry === null ? "none" : JSON.stringify(storedEntry)) +
    " armedStreamDeviceIds=[" + armedStreamDeviceIds.join(",") + "] changed=" + String(streamDeviceIdChanged) +
    (rearmFailure === null ? "" : " (apply skipped: re-arm failed)"));

  const cell: CellOutcome = {
    scenario: CELL_SCENARIO,
    status: "skipped",
    matchedSignature: null,
    detail: "real input: the applied take cell is not run — its reference clicks and band split assume the loopback tap",
    successfulRepeats: 0,
    errorRepeats: 0,
    errors: [],
    rows: [],
  };

  cb.setState("uploading");
  await uploadSummary({
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    kind: "input-latency-calibration-ground-truth",
    runToken, rate, bpm, sdkBuildProbe, buildFeatures,
    // The id the stored entry is keyed on: the stream the apply ran on.
    deviceId: appliedStreamDeviceId,
    captureMode: "named",
    // Actual opens since page load, the label unlock included — see `realGetUserMediaOpens`.
    getUserMediaOpens: realGetUserMediaOpens,
    outputLatency: outputLatencyAtStartSec,
    baseLatency: baseLatencySec,
    harnessPathBiasSec: 0,
    harnessPathBiasSettleMs: 0,
    virtualOutputLegSec: 0,
    armState,
    warmup: null,
    sweep: [],
    skipped: [],
    fit: null,
    fitIncludingNoisy: null,
    fitExcludedNoisy: { count: 0, delaysMs: [], verdicts: [] },
    applied, storedEntry, cell,
    repeats: repeatRows,
    // Never the loopback page's pooled-mode summary: judged per chain in `realSummary`.
    repeatSummary: null,
    harnessLoopbackHopSec: null,
    harnessLoopbackHopPerRowSec: [],
    harnessLoopbackHopSource: "not measured: real input, no applied cell",
    cellRowStates: [],
    inputMode: "real",
    runLabel: input.runLabel,
    device: input.device,
    armedStreamDeviceIds,
    streamDeviceIdChanged,
    requestedDeviceId,
    deviceFallback,
    arms,
    trackSettings: arms[0].settings,
    trackSettingsPerChain: arms.map((arm) => arm.settings),
    outputLatencyAtStartSec,
    outputLatencyAfterFirstCallSec,
    baseLatencySec,
    realSummary,
  });
  if (rearmFailure !== null) {
    throw new Error(`re-arm failed after ${String(rearmAfter)} call(s): ${rearmFailure} — envelope uploaded with the calls measured before it`);
  }
  cb.setState("done");
}

/** What `realSummary` says about one call: its offset from ITS chain's modal round trip, and the event kind if any. */
function annotateRealCall(
  summary: RealInputSummary | null, index: number, chainIndex: number, roundTripSeconds: number, sampleRate: number
): { text: string; kind: string } {
  const chain = summary?.perChain.find((c) => c.chainIndex === chainIndex);
  if (summary === null || chain === undefined || chain.modeRoundTripSec === null || !Number.isFinite(roundTripSeconds)) {
    return { text: "—", kind: "" };
  }
  const deltaSec = roundTripSeconds - chain.modeRoundTripSec;
  const frames = deltaSec * sampleRate;
  const quanta = deltaSec / summary.renderQuantumSec;
  const transition = chain.transitions.find((t) => t.index === index);
  const kind = summary.anchorDisagreements.indices.includes(index)
    ? "disagreement"
    : transition !== undefined
      ? (transition.confirmedByFollowingCall ? "transition" : "transition (unconfirmed)")
      : chain.isolatedDeviations.some((d) => d.index === index)
        ? "isolated"
        : chain.firstCallOff?.index === index
          ? "first call off"
          : "";
  return { text: `${frames >= 0 ? "+" : ""}${frames.toFixed(1)} fr / ${quanta >= 0 ? "+" : ""}${quanta.toFixed(3)} q`, kind };
}

// --- UI --------------------------------------------------------------------

function verdictColor(verdict: CalibrationVerdict): "green" | "amber" | "red" {
  if (verdict === "ok") return "green";
  if (verdict === "noisy") return "amber";
  return "red";
}

function statusColor(status: CellOutcome["status"]): "green" | "amber" | "red" | "gray" {
  if (status === "aligned") return "green";
  if (status === "matches-known-defect") return "amber";
  if (status === "investigate" || status === "error") return "red";
  return "gray";
}

const ms = (seconds: number): string => (Number.isFinite(seconds) ? (seconds * 1000).toFixed(3) : "—");

function realVerdictColor(verdict: RealInputSummary["verdict"]): "green" | "amber" | "red" | "gray" {
  if (verdict === "repeatable") return "green";
  if (verdict === "two-state") return "amber";
  if (verdict === "scattered") return "red";
  return "gray";
}

const statsLine = (label: string, s: { median: number; min: number; max: number; stdev: number | null; count: number } | null, unit: "ms" | "dB") => {
  if (s === null) return `${label.padEnd(19)}—`;
  const f = (v: number) => (unit === "ms" ? (v * 1000).toFixed(3) : v.toFixed(2));
  return `${label.padEnd(19)}median ${f(s.median)} ${unit} · min ${f(s.min)} · max ${f(s.max)} · sd ${s.stdev === null ? "—" : f(s.stdev)} (n=${s.count})`;
};

function RealInputResults(props: {
  calls: { result: CalibrationResult; index: number; chainIndex: number }[];
  summary: RealInputSummary | null;
  applied: CalibrationResult | null;
  storedEntry: CalibrationEntry | null;
  arms: RealArmInfo[];
  runLabel: string;
  device: RealDevice | null;
  sampleRate: number;
}) {
  const { calls, summary, applied, storedEntry, arms, runLabel, device, sampleRate } = props;
  const deviceFallback = arms.some((arm) => arm.fallback);
  return (
    <>
      <Card>
        <Heading size="4" style={{ marginBottom: "0.5rem" }}>Calibration calls</Heading>
        <div style={{ overflowX: "auto" }}>
          <Table.Root size="1">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>#</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>chain</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>round trip (ms)</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>anchor B (ms)</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>input part (ms)</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>output latency (ms)</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>reported</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>spread (ms)</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>ratio (dB)</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>identified/scheduled</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Δ chain mode</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>event</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>verdict</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>reason</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {calls.map((call) => {
                const r = call.result;
                const note = annotateRealCall(summary, call.index, call.chainIndex, r.roundTripSeconds, sampleRate);
                return (
                  <Table.Row key={call.index}>
                    <Table.Cell>{call.index + 1}</Table.Cell>
                    <Table.Cell>{call.chainIndex}</Table.Cell>
                    <Table.Cell>{ms(r.roundTripSeconds)}</Table.Cell>
                    <Table.Cell>{r.roundTripSecondsSecondary === undefined ? "—" : ms(r.roundTripSecondsSecondary)}</Table.Cell>
                    <Table.Cell>{ms(r.inputLatencySeconds)}</Table.Cell>
                    <Table.Cell>{ms(r.outputLatencySeconds)}</Table.Cell>
                    <Table.Cell>{String(r.outputLatencyReported)}</Table.Cell>
                    <Table.Cell>{ms(r.spreadSeconds)}</Table.Cell>
                    <Table.Cell>{Number.isFinite(r.correlationRatioDb) ? r.correlationRatioDb.toFixed(2) : "—"}</Table.Cell>
                    <Table.Cell>{r.identifiedBursts}/{r.scheduledBursts}</Table.Cell>
                    <Table.Cell>{note.text}</Table.Cell>
                    <Table.Cell>{note.kind === "" ? "" : <Badge color={note.kind === "disagreement" ? "red" : "amber"}>{note.kind}</Badge>}</Table.Cell>
                    <Table.Cell><Badge color={verdictColor(r.verdict)}>{r.verdict}</Badge></Table.Cell>
                    <Table.Cell>{r.reason ?? "—"}</Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </div>
        {calls.length === 0 && <Text size="2" color="gray" as="p" style={{ marginTop: "0.5rem" }}>no calls yet</Text>}
      </Card>

      <Card>
        <Heading size="4" style={{ marginBottom: "0.5rem" }}>Summary (descriptive — no band, no pass/fail)</Heading>
        <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {summary === null
            ? "summary: pending (written after the last call)"
            : `verdict:           ${summary.verdict} (on ${summary.verdictBasis}, ${summary.verdictSeries === "inputLatency" ? "input part" : "round trip"})
detail:            ${summary.detail}${deviceFallback ? `; DEVICE FALLBACK on chain(s) ${arms.filter((a) => a.fallback).map((a) => `${a.chainIndex} (requested ${a.requestedDeviceId}, stream reports ${a.streamDeviceId})`).join(", ")} — the SDK opened another input` : ""}
run label:         ${runLabel || "(none)"}
device:            ${device === null ? "—" : `"${device.label}" [${device.deviceId}]`}
device fallback:   ${arms.length === 0 ? "—" : deviceFallback ? "YES — see detail; the run is evidence about whichever input the stream reports" : "none (every armed stream reports the requested id)"}
calls:             ${summary.calls} (${summary.usableCalls} usable) · verdicts ${Object.entries(summary.verdictCounts).map(([k, v]) => `${k}×${v}`).join(", ")}
${statsLine("input part:", summary.inputLatencySec, "ms")}
${statsLine("round trip:", summary.roundTripSec, "ms")}
${statsLine("spread:", summary.spreadSec, "ms")}
${statsLine("ratio:", summary.correlationRatioDb, "dB")}
render quantum:    ${ms(summary.renderQuantumSec)} ms
per chain:
${summary.perChain.map((c) => `  chain ${c.chainIndex}: ${c.usableCalls}/${c.calls} usable · mode (input part) ${c.modeInputLatencySec === null ? "—" : `${ms(c.modeInputLatencySec)} ms on ${c.modeCount}`} · mode (round trip) ${c.modeRoundTripSec === null ? "—" : ms(c.modeRoundTripSec) + " ms"} · median ${c.medianInputLatencySec === null ? "—" : ms(c.medianInputLatencySec) + " ms"} · ${c.withinHalfQuantum ? "within ½ quantum" : "NOT within ½ quantum"}${c.firstCallOff === null ? "" : ` · first call off (${c.firstCallOff.deltaQuanta.toFixed(3)} quanta)`}
    clusters (${c.clusterSeries === "inputLatency" ? "input part" : "round trip"}): ${c.clusters.length === 0 ? "—" : c.clusters.map((k) => `${ms(k.centerSec)} ms ×${k.calls} [${ms(k.minSec)}–${ms(k.maxSec)}]`).join(" · ")}
    states:   ${c.states.length === 0 ? "—" : c.states.map((s) => `calls ${s.firstIndex + 1}–${s.lastIndex + 1} (${s.calls}) at ${ms(s.roundTripSec)} ms`).join(" → ")}
    track latency: ${c.reportedLatencySec === null ? "not reported" : `${ms(c.reportedLatencySec)} ms reported · median input part − reported = ${c.medianInputMinusReportedSec === null ? "—" : ms(c.medianInputMinusReportedSec) + " ms"}`}`).join("\n")}${summary.chainMedianDifferenceQuanta === null ? "" : `\n  chain 1 − chain 0 = ${summary.chainMedianDifferenceQuanta.toFixed(3)} quanta`}${summary.stateSeparationQuanta === null ? "" : `\n  state separation: ${summary.stateSeparationQuanta.toFixed(3)} quanta (${summary.verdictBasis})`}
state transitions: ${summary.stateTransitions.count} (${summary.stateTransitions.oneQuantumSteps} one-quantum step(s), ${summary.stateTransitions.unconfirmedSteps} unconfirmed — no further agreeing call in the state opened)${summary.stateTransitions.count === 0 ? "" : " — " + summary.stateTransitions.transitions.map((t) => `call ${t.index + 1} chain ${t.chainIndex} ${t.stepQuanta >= 0 ? "+" : ""}${t.stepQuanta.toFixed(3)} quanta${t.confirmedByFollowingCall ? "" : " (unconfirmed)"}`).join(" · ")}
isolated deviations: ${summary.isolatedDeviations.count}${summary.isolatedDeviations.count === 0 ? " (expected 0 — the single-call case no anchor check can catch)" : " — " + summary.isolatedDeviations.deviations.map((d) => `call ${d.index + 1} chain ${d.chainIndex} ${d.deltaQuanta >= 0 ? "+" : ""}${d.deltaQuanta.toFixed(3)} quanta`).join(" · ")}
anchor disagreements: ${summary.anchorDisagreements.secondAnchorAvailable ? `flagged by the SDK ${summary.anchorDisagreements.flaggedBySdk} · re-derived > ½ quantum ${summary.anchorDisagreements.rederived}${summary.anchorDisagreements.rederived === 0 ? "" : ` (calls ${summary.anchorDisagreements.indices.map((i) => i + 1).join(", ")})`}` : "second anchor NOT reported by this build"}
output latency:    reported on ${summary.outputLatencyReportedCount}/${summary.calls} calls
track latency:     ${summary.reportedLatencySec === null ? "not reported by the browser" : `${ms(summary.reportedLatencySec)} ms reported · pooled median input part − reported = ${summary.medianInputMinusReportedSec === null ? "—" : ms(summary.medianInputMinusReportedSec) + " ms"}`}`}
        </pre>
      </Card>

      <Card>
        <Heading size="4" style={{ marginBottom: "0.5rem" }}>Applied calibration + stored entry</Heading>
        <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {applied === null
            ? "applied: pending"
            : `applied verdict:   ${applied.verdict}${applied.reason !== undefined ? ` (${applied.reason})` : ""}
probe:             ${applied.probe ?? "(not reported — build predates the configurable probe)"}
input part:        ${ms(applied.inputLatencySeconds)} ms
round trip:        ${ms(applied.roundTripSeconds)} ms${applied.roundTripSecondsSecondary === undefined ? "" : ` (anchor B ${ms(applied.roundTripSecondsSecondary)} ms)`}
output latency:    ${ms(applied.outputLatencySeconds)} ms (reported: ${String(applied.outputLatencyReported)})
spread:            ${ms(applied.spreadSeconds)} ms · ratio ${Number.isFinite(applied.correlationRatioDb) ? applied.correlationRatioDb.toFixed(2) : "—"} dB · bursts ${applied.identifiedBursts}/${applied.scheduledBursts}
stored entry:      ${storedEntry === null ? "NONE (not stored)" : JSON.stringify(storedEntry)}
cell:              skipped (real input — no applied take cell in this mode)`}
        </pre>
      </Card>

      <Card>
        <Heading size="4" style={{ marginBottom: "0.5rem" }}>Track settings (one block per armed chain)</Heading>
        <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {arms.length === 0
            ? "track settings: pending (read after arming)"
            : arms.map((arm) => `chain ${arm.chainIndex}:
  requested deviceId: ${arm.requestedDeviceId}
  stream deviceId:    ${arm.streamDeviceId}${arm.fallback ? "   ← DEVICE FALLBACK (not the requested input)" : ""}
${arm.settings === null
  ? "  settings:           (no media track on the capture)"
  : Object.entries(arm.settings).map(([k, v]) => `  ${(k + ":").padEnd(19)}${v === null ? "(not reported)" : String(v)}`).join("\n")}`).join("\n")}
        </pre>
      </Card>
    </>
  );
}

function CalibrationHarness() {
  const [auditState, setAuditState] = useState("idle");
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [buildProbe, setBuildProbe] = useState<SdkBuildProbe>("unknown");
  const [sweep, setSweep] = useState<SweepRow[]>([]);
  const [fit, setFit] = useState<LeastSquaresFit | null>(null);
  const [fitAll, setFitAll] = useState<LeastSquaresFit | null>(null);
  const [excluded, setExcluded] = useState<{ count: number; delaysMs: number[]; verdicts: string[] }>({
    count: 0, delaysMs: [], verdicts: [],
  });
  const [skipped, setSkipped] = useState<SkippedDelay[]>([]);
  const [repeatCalls, setRepeatCalls] = useState<{ result: CalibrationResult; index: number }[]>([]);
  const [repeatSummary, setRepeatSummary] = useState<RepeatSummary | null>(null);
  const [warmup, setWarmup] = useState<CalibrationResult | null>(null);
  const [applied, setApplied] = useState<CalibrationResult | null>(null);
  const [storedEntry, setStoredEntry] = useState<CalibrationEntry | null>(null);
  const [cell, setCell] = useState<CellOutcome | null>(null);
  const [hopSec, setHopSec] = useState<number | null>(null);
  const [rowStates, setRowStates] = useState<CellRowState[]>([]);
  // Display only — NOT validated here. `resolveArmState` throws on a bad value,
  // and a throw during render would unmount the root before `#audit-state`
  // exists; the run validates it (with every other param) inside
  // `runCalibrationAudit`, where a rejection lands on the state badge.
  const armStateLabel = params.get("armState") ?? "steady";
  const inputModeLabel = params.get("input") ?? "loopback";

  // --- real-input mode state (unused in loopback mode) ---------------------
  const [devices, setDevices] = useState<RealDevice[] | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(params.get("deviceId") ?? "");
  const [runLabel, setRunLabel] = useState<string>(params.get("label") ?? "");
  /** Every state the badge walked, in order — the trail the brief asks for. */
  const [trail, setTrail] = useState<string[]>([]);
  const [realCalls, setRealCalls] = useState<{ result: CalibrationResult; index: number; chainIndex: number }[]>([]);
  const [realSummary, setRealSummary] = useState<RealInputSummary | null>(null);
  const [arms, setArms] = useState<RealArmInfo[]>([]);
  // Display only — the run validates `?rate=` itself; the table's frame column needs the number,
  // and takes the summary's validated rate as soon as one exists.
  const realSampleRate = realSummary !== null ? 128 / realSummary.renderQuantumSec : Number(params.get("rate") ?? "48000");

  const walk = useCallback((state: string) => {
    setAuditState(state);
    setTrail((prev) => [...prev, state]);
  }, []);

  // Real mode boots the engine and lists the inputs on load, so the device can
  // be chosen before Start. `getContext` caches the boot; the run reuses it.
  useEffect(() => {
    if (!REAL_INPUT) return undefined;
    let cancelled = false;
    (async () => {
      walk("setup");
      const bpm = resolveNumber(params.get("bpm"), 120, "bpm");
      const rate = resolveNumber(params.get("rate"), 48000, "rate");
      const context = await getContext(rate, bpm);
      if (cancelled) return;
      setBuildProbe(context.sdkBuildProbe);
      walk("device");
      const inputs = await enumerateRealInputs();
      if (cancelled) return;
      setDevices(inputs);
      const preselected = params.get("deviceId");
      if (preselected !== null && !inputs.some((d) => d.deviceId === preselected)) {
        console.warn("[input-latency-calibration] ?deviceId=" + preselected + " is not an enumerated audio input — choose one in the select");
        setSelectedDeviceId("");
      }
    })().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[input-latency-calibration] real-input setup error: " + message);
      setAuditState(`error:${message}`);
    });
    return () => { cancelled = true; };
  }, [walk]);

  const selectedDevice = devices?.find((d) => d.deviceId === selectedDeviceId) ?? null;

  const handleRunReal = useCallback(() => {
    if (running || selectedDevice === null) return;
    setRunning(true);
    setStarted(true);
    // The trail is NOT reset: it keeps the setup/device stages walked at load,
    // so it reads as the header's documented walk (and, on a Re-run, as the
    // page's whole history since load).
    setRealCalls([]);
    setRealSummary(null);
    setArms([]);
    setApplied(null);
    setStoredEntry(null);
    runRealInputAudit({ device: selectedDevice, runLabel }, {
      setState: walk,
      onBuildProbe: setBuildProbe,
      onArm: (arm) => setArms((prev) => [...prev, arm]),
      onRepeatCall: (result, index, chainIndex) => setRealCalls((prev) => [...prev, { result, index, chainIndex }]),
      onRealSummary: setRealSummary,
      onApplied: (result, entry) => { setApplied(result); setStoredEntry(entry); },
    })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[input-latency-calibration] real-input run error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running, selectedDevice, runLabel, walk]);

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    setStarted(true);
    setSweep([]);
    setFit(null);
    setFitAll(null);
    setExcluded({ count: 0, delaysMs: [], verdicts: [] });
    setSkipped([]);
    setRepeatCalls([]);
    setRepeatSummary(null);
    setWarmup(null);
    setApplied(null);
    setStoredEntry(null);
    setCell(null);
    setHopSec(null);
    setRowStates([]);
    runCalibrationAudit({
      setState: setAuditState,
      onSweepRow: (row) => setSweep((prev) => [...prev, row]),
      onFit: (primary, all, drops) => { setFit(primary); setFitAll(all); setExcluded(drops); },
      onSkipped: (entry) => setSkipped((prev) => [...prev, entry]),
      onRepeatCall: (result, index) => setRepeatCalls((prev) => [...prev, { result, index }]),
      onRepeatSummary: setRepeatSummary,
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
            build: {buildProbe} · input: {inputModeLabel} · armState: {armStateLabel}
          </Text>

          {REAL_INPUT && (
            <Card>
              <Heading size="4" style={{ marginBottom: "0.5rem" }}>Real input device</Heading>
              <Flex direction="column" gap="2">
                <label htmlFor="input-device">
                  <Text size="2">Input device (labels unlock after the capture permission; pick the mic or the interface's cable-loopback input)</Text>
                </label>
                <select
                  id="input-device"
                  value={selectedDeviceId}
                  disabled={running || devices === null}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  style={{ padding: "0.4rem", fontSize: "0.9rem", maxWidth: "100%" }}
                >
                  <option value="">{devices === null ? "(enumerating…)" : "— choose an input —"}</option>
                  {(devices ?? []).map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{`${d.label || "(unlabelled)"} [${d.deviceId}]`}</option>
                  ))}
                </select>
                <label htmlFor="run-label">
                  <Text size="2">Run label (what is plugged in, e.g. "cable loopback" or "laptop mic + speakers")</Text>
                </label>
                <input
                  id="run-label"
                  type="text"
                  value={runLabel}
                  disabled={running}
                  onChange={(e) => setRunLabel(e.target.value)}
                  style={{ padding: "0.4rem", fontSize: "0.9rem", maxWidth: "100%" }}
                />
              </Flex>
            </Card>
          )}

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
              {REAL_INPUT ? (
                <Button onClick={handleRunReal} disabled={running || selectedDevice === null}>
                  {started ? "Re-run" : "Start"}
                </Button>
              ) : (
                <Button onClick={handleRun} disabled={running}>
                  {started ? "Re-run" : "Run calibration"}
                </Button>
              )}
              {cell !== null && (
                <Badge id="cell-verdict" data-verdict={cell.status} color={statusColor(cell.status)}>
                  cell: {cell.status}
                </Badge>
              )}
              {realSummary !== null && (
                <Badge id="real-verdict" data-verdict={realSummary.verdict} color={realVerdictColor(realSummary.verdict)}>
                  real: {realSummary.verdict}
                </Badge>
              )}
            </Flex>
            {REAL_INPUT && trail.length > 0 && (
              <Flex align="center" gap="1" wrap="wrap" style={{ marginTop: "0.5rem" }}>
                <Text size="1" color="gray">trail:</Text>
                {trail.map((state, index) => (
                  <Badge key={`${state}-${index}`} size="1" color="gray" variant="soft">{state}</Badge>
                ))}
              </Flex>
            )}
          </Card>

          {REAL_INPUT && (
            <RealInputResults
              calls={realCalls}
              summary={realSummary}
              applied={applied}
              storedEntry={storedEntry}
              arms={arms}
              runLabel={runLabel}
              device={selectedDevice}
              sampleRate={realSampleRate}
            />
          )}

          {!REAL_INPUT && (<>
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
                : `fit (ok rows only): slope ${fit.slope.toFixed(4)} · intercept ${(fit.interceptSec * 1000).toFixed(3)} ms · ` +
                  `max residual ${fit.maxAbsResidualMs.toFixed(3)} ms · ${fit.points} points`}
            </Text>
            {excluded.count > 0 && (
              <Text size="2" color="amber" as="p">
                {`excluded ${excluded.count} non-ok row(s) from the fit at D = ${excluded.delaysMs.join(", ")} ms ` +
                  `(${excluded.verdicts.join(", ")})` +
                  (fitAll === null
                    ? ""
                    : ` · including them: slope ${fitAll.slope.toFixed(4)}, intercept ${(fitAll.interceptSec * 1000).toFixed(3)} ms`)}
              </Text>
            )}
            {skipped.length > 0 && (
              <Text size="2" color="red" as="p">
                {`refused ${skipped.length} point(s) above the searchable round-trip ceiling: ` +
                  skipped.map((entry) => `${entry.requestedDelayMs} ms (${entry.reason})`).join(" · ")}
              </Text>
            )}
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
                : `priming (fresh):   ${warmup === null ? "—" : ms(warmup.inputLatencySeconds)} ms (discarded from the fit)
applied verdict:   ${applied.verdict}${applied.reason !== undefined ? ` (${applied.reason})` : ""}
probe:             ${applied.probe ?? "(not reported — build predates the configurable probe)"}
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

          {repeatSummary === null && repeatCalls.length > 0 && (
            <Card>
              <Text size="2" color="gray">
                {`repeat phase running — ${repeatCalls.length} call(s) done, last round trip ` +
                  `${ms(repeatCalls[repeatCalls.length - 1].result.roundTripSeconds)} ms ` +
                  `(${repeatCalls[repeatCalls.length - 1].result.verdict})`}
              </Text>
            </Card>
          )}

          {repeatSummary !== null && (
            <Card>
              <Heading size="4" style={{ marginBottom: "0.5rem" }}>
                Repeat phase — one-quantum miss rate
              </Heading>
              <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {repeatSummary.usableCalls === 0
                  ? `calls:              ${repeatSummary.calls}, delay cycle [${repeatSummary.delayCycleMs.join(", ")}] ms
PHASE UNUSABLE:     no call returned a finite round trip (every verdict non-ok) — no mode, no miss count`
                  : `calls:              ${repeatSummary.calls} (${repeatSummary.usableCalls} usable), delay cycle [${repeatSummary.delayCycleMs.join(", ")}] ms
modal round trip:   ${ms(repeatSummary.modeRoundTripSec)} ms (delay removed) on ${repeatSummary.modeCount}/${repeatSummary.usableCalls} usable calls
input minus delay:  ${repeatSummary.modeNormalizedInputMs.toFixed(4)} ms
after a delay change: ${repeatSummary.missesAfterDelayChange}/${repeatSummary.callsAfterDelayChange} missed · same delay: ${repeatSummary.missesAfterSameDelay}/${repeatSummary.callsAfterSameDelay}
render quantum:     ${ms(repeatSummary.renderQuantumSec)} ms
one-quantum misses: ${repeatSummary.oneQuantumMisses}
  flagged by the second anchor: ${repeatSummary.missesFlaggedByAnchorCheck}/${repeatSummary.oneQuantumMisses}
flagged, not a miss: ${repeatSummary.flaggedWithoutMiss}
second anchor:      ${repeatSummary.secondAnchorAvailable ? "reported by this build" : "NOT reported — build predates it"}
anchor matching the mode, per miss:
${repeatSummary.missAnchorVerdicts.length === 0
  ? "  (no misses)"
  : repeatSummary.missAnchorVerdicts
      .map((m) => `  #${m.index} D=${m.delayMs} (prev ${m.previousDelayMs ?? "—"}${m.isFirstAfterDelayChange ? ", CHANGED" : ""}) delta ${m.deltaQuanta.toFixed(3)} quanta -> ${m.anchorMatchingMode ?? "n/a"}${m.reason ? ` (${m.reason})` : ""}`)
      .join("\n")}`}
              </pre>
            </Card>
          )}

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>Configuration</Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {`?delays=<ms,ms,...>   default 0,10,25,50 — injected loopback return delays
?bpm=<number>         default 120
?rate=<number>        default 48000 — sets the AudioContext at init, never "all"
?armState=steady|fresh default steady — "fresh" re-arms before the cell, so take 1
                      is the first pull on a rebuilt SDK input chain
?defaultInput=1       arm on the SDK's default input (box names no device): exercises
                      the SDK's unnamed-box chain-reuse rule; the named mode reuses its
                      chain on this page too, since the loopback reports the id back
?repeat=<n>           default 0 — after the sweep, run n more calibrations back to
                      back on the same chain, CYCLING the delays ?delays= names,
                      and report the one-quantum miss rate
Cell:                 ${CELL_SCENARIO}, ${REPEATS_PER_CELL} repeats, calibration applied
Delay ceiling:        ${MAX_REQUESTED_DELAY_MS.toFixed(0)} ms at parse time; per point the run
                      refuses any D whose predicted round trip passes
                      ${((SDK_MAX_ROUND_TRIP_SEC - ROUND_TRIP_HEADROOM_SEC) * 1000).toFixed(0)} ms (the SDK searches ${(SDK_MAX_ROUND_TRIP_SEC * 1000).toFixed(0)} ms of lag)
Fit:                  ok rows only; non-ok rows are excluded and counted
Uploads:              calib-summary-<runToken>.json via PUT /__verify
Needs the calibration-branch SDK (SDK_DIST_OVERRIDE); the page says so if it is missing.
Click "Run calibration" with a real click — resumes the AudioContext.
?input=real            switch to REAL-INPUT mode (a physical device; see that mode's help block)`}
            </pre>
          </Card>
          </>)}

          {REAL_INPUT && (
            <Card>
              <Heading size="4" style={{ marginBottom: "0.5rem" }}>Configuration — real-input mode</Heading>
              <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {`?input=real           calibrate against a REAL input device — no synthetic loopback is installed
?rate=<number>        default 48000 — sets the AudioContext at init, never "all"
?bpm=<number>         default 120 (the project tempo; the calibration does not depend on it)
?repeat=<n>           default 10, max 200 — back-to-back calibrateInputLatency calls on the chosen device
?armState=steady|fresh default steady — "fresh" disarms and re-arms HALFWAY through the calls, so the
                      second half measures a chain the SDK rebuilt (chainIndex 1 in the table)
?deviceId=<id>        preselect an input (must be one of the enumerated ids)
?label=<text>         prefill the run label, persisted as runLabel
?delays= / ?defaultInput=  REJECTED in this mode — nothing is injected, the device is chosen above
What it measures:     the SDK's own probe, out of the real output device, back through the chosen input:
                      per-call verdict, detector hits (identified/scheduled bursts, ratio dB), input part,
                      spread, second-anchor agreement, plus the track's own reported latency
What it cannot:       no injected-delay slope (nothing is swept), no applied take cell (its reference
                      clicks and band split assume the loopback tap) — cell.status is "skipped"
Acoustic case:        keep the room quiet; every call plays three audible bursts out of the speakers
Uploads:              calib-summary-<runToken>.json via PUT /__verify, inputMode "real"
Needs the calibration-branch SDK (SDK_DIST_OVERRIDE); the page says so if it is missing.
Click "Start" with a real click — resumes the AudioContext.`}
              </pre>
            </Card>
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<CalibrationHarness />);
