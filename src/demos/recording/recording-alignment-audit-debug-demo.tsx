// src/demos/recording/recording-alignment-audit-debug-demo.tsx
// Unlisted harness for the recording start-alignment audit
// (`.superpowers/sdd/2026-09-01-recording-start-alignment-audit/`).
//
// TWO modes, selected by `?scenario=`:
//
// `?scenario=probe` — the HARD GATE that decided whether the same-context
// loopback injection topology (see src/lib/audit/loopbackInjection.ts)
// actually reaches CaptureAudio with signal, before the rest of the campaign
// was built on top of it (Task 1; kept working unchanged).
//
// Probe procedure: boot the engine with the loopback device installed,
// arm a Tape onto it, schedule reference clicks, record ~4s (no count-in —
// startRecording(false) — with the metronome routed into the loopback's low
// band), then measure the RMS of the resulting take region. PASS (rms > 0.005) proves the
// SAME-context MediaStreamAudioDestinationNode topology is viable; FAIL
// means the cross-context silent-capture failure mode also affects this
// topology, and the campaign cannot proceed without a real-mic or
// virtual-audio-device fallback (see the "Don't Synthesize Input" rule in
// src/demos/recording/CLAUDE.md).
//
// `?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>` — the full matrix
// runner (Task 4). One page load boots ONE engine at ONE rate (rate is
// never "all" — it sets the AudioContext at init) and drives a single Tape,
// reused across every cell, through RECORDING_AUDIT_SCENARIOS x
// RECORDING_AUDIT_BPMS x REPEATS_PER_CELL start/stop sequences. Each
// repeat's take region(s) are measured against the beat grid + reference
// clicks (src/lib/audit/recordingAlignment.ts), classified per cell
// (`classifyCell`), streamed into a results table, and uploaded (WAV per
// repeat + one JSON summary) to the dev server's /__verify sink.
//
// DOM contract (both modes): #audit-state carries data-audit-state walking
// setup -> running:<cell> -> [uploading ->] done (or error:<message>).
// Probe mode additionally carries #probe-verdict with data-verdict={verdict}.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Flex, Heading, Table, Text, Theme, Container } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { CaptureAudio, type Project } from "@opendaw/studio-core";
import { InstrumentFactories, type AudioUnitBoxAdapter, type SampleLoader } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { WavFile } from "@opendaw/lib-dsp";
import { Terminable } from "@opendaw/lib-std";
import { installLoopbackCapture, LOOPBACK_DEVICE_ID, loopbackDeviceId } from "@/lib/audit/loopbackInjection";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { detectOnsets } from "@/lib/audit/onsetDetection";
import {
  buildReferenceSchedule,
  bandSplit,
  identifyReferenceClicks,
  estimateAnchorT0,
  measureTakeAlignment,
  classifyCell,
  measureCrossTrackSkew,
  type TakeAlignment,
  type CellClassification,
  type CellStatus,
  type ReferenceSchedule,
  type CrossTrackSkew,
} from "@/lib/audit/recordingAlignment";
import {
  RECORDING_AUDIT_BPMS,
  RECORDING_AUDIT_SCENARIOS,
  REPEATS_PER_CELL,
  JANK_MS,
  LOOP_WRAP_TAKES,
  ALIGNED_TOLERANCE_MS,
  HEAD_MISSING_BASELINE_MS,
  SIGNATURE_BANDS,
  type RecordingScenario,
} from "@/lib/audit/recordingAuditCalibration";
import { BAR_PPQN } from "@/lib/audit/auditExpectations";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";

const params = new URLSearchParams(window.location.search);
const rate = Number(params.get("rate") ?? "48000");
/** RMS floor above which capture is judged non-silent — see module header. */
const RMS_PASS_THRESHOLD = 0.005;
/** How long to record before stopping (no count-in — startRecording(false)). */
const RECORD_WINDOW_MS = 4000;
const FINALIZE_DEADLINE_MS = 30_000;

// Build probe: identifies which SDK build is live, for A/B runs against an
// alternate dist tree (see SDK_DIST_OVERRIDE in vite.config.ts). A module-surface
// check (e.g. a static import of an internal class) isn't reliable here — the
// capability under test isn't guaranteed to be a class member every build exposes
// the same way — so this probes the LIVE `project.engine` instance returned by
// `initializeOpenDAW()` instead: a fixed build's EngineFacade exposes a numeric
// `syncContextTime` getter, the installed build does not. Call once init has
// resolved; "unknown" is reserved for the case where the probe never ran at all
// (init itself failed), never as a steady-state verdict once the engine is up.
type SdkBuildProbe = "candidate" | "upstream" | "unknown";

function detectSdkBuildProbe(engine: unknown): SdkBuildProbe {
  const facade = engine as { syncContextTime?: unknown };
  return typeof facade?.syncContextTime === "number" ? "candidate" : "upstream";
}

// Installed at module scope, BEFORE any SDK code can touch mediaDevices.
// deviceCount=2: the single-tape scenarios below only ever use device 1
// (LOOPBACK_DEVICE_ID); the second synthetic device exists for the
// multi-mic scenarios' second tape (see "Multi-mic simultaneous recording"
// section below) — advertising it unconditionally costs nothing for the
// single-tape modes.
const loopback = installLoopbackCapture(2);

type ProbeRow = { label: string; value: string };

async function runProbe(onRow: (row: ProbeRow) => void, onBuildProbe: (probe: SdkBuildProbe) => void): Promise<string> {
  console.log("[recording-alignment-audit] probe: booting engine, rate=" + rate);
  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  onBuildProbe(detectSdkBuildProbe(project.engine));
  loopback.attach(audioContext);
  onRow({ label: "context rate", value: String(audioContext.sampleRate) });
  console.log("[recording-alignment-audit] outputLatency=" + String(audioContext.outputLatency) + " baseLatency=" + String(audioContext.baseLatency));

  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;

  // Tape + capture (three transactions — createInstrument, then capture fields; armed is not a box field)
  let audioUnitBox: AudioUnitBox | null = null;
  project.editing.modify(() => {
    audioUnitBox = project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox;
  });
  if (audioUnitBox === null) throw new Error("probe: createInstrument did not return audioUnitBox");
  const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
  if (!(capture instanceof CaptureAudio)) throw new Error("probe: capture is not CaptureAudio");
  project.editing.modify(() => {
    capture.captureBox.deviceId.setValue(LOOPBACK_DEVICE_ID);
    capture.requestChannels = 1;
  });
  capture.armed.setValue(true);
  console.log("[recording-alignment-audit] probe: tape armed on loopback device");

  // Schedule reference clicks covering the whole probe window.
  const now = audioContext.currentTime;
  loopback.scheduleReferenceClicks(Array.from({ length: 30 }, (_, i) => now + 0.5 + i * 0.25));

  project.engine.setPosition(0);
  project.startRecording(false);
  console.log("[recording-alignment-audit] probe: recording started");
  // DIAGNOSTIC (temporary): poll transport state during the record window to
  // distinguish "position never advanced" (known WASM transport-start quirk,
  // see src/demos/engine/CLAUDE.md) from a loopback-routing failure.
  const pollStart = Date.now();
  const pollTimer = setInterval(() => {
    console.log(
      "[recording-alignment-audit] probe: t=" + (Date.now() - pollStart) +
      "ms position=" + project.engine.position.getValue().toFixed(1) +
      " isRecording=" + project.engine.isRecording.getValue() +
      " isCountingIn=" + project.engine.isCountingIn.getValue()
    );
  }, 500);
  await new Promise((r) => setTimeout(r, RECORD_WINDOW_MS));
  clearInterval(pollTimer);
  project.engine.stopRecording();
  console.log("[recording-alignment-audit] probe: recording stopped, waiting for finalization");

  // Find the take region and wait for its loader.
  const unitAdapter = project.rootBoxAdapter.audioUnits.adapters()
    .find((u) => u.box === capture.audioUnitBox);
  if (!unitAdapter) throw new Error("probe: no audio unit adapter");
  const regions = unitAdapter.tracks.values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion());
  onRow({ label: "regions", value: String(regions.length) });
  if (regions.length === 0) return "FAIL: no take region created";

  const loader = regions[0].file.getOrCreateLoader();
  if (loader.state.type !== "loaded") {
    await withDeadline(new Promise<void>((resolvePromise, reject) => {
      let subscribed = false;
      const sub = loader.subscribe((state) => {
        if (state.type === "loaded") { resolvePromise(); if (subscribed) sub.terminate(); }
        if (state.type === "error") { reject(new Error(String(state.reason))); if (subscribed) sub.terminate(); }
      });
      subscribed = true;
    }), FINALIZE_DEADLINE_MS, "probe finalization");
  }
  const dataOpt = loader.data;
  if (dataOpt.isEmpty()) return "FAIL: loader loaded but data empty";
  const data = dataOpt.unwrap();
  const ch0 = data.frames[0];
  let sumSq = 0;
  for (let i = 0; i < ch0.length; i++) sumSq += ch0[i] * ch0[i];
  const rms = Math.sqrt(sumSq / ch0.length);
  onRow({ label: "frames", value: String(data.numberOfFrames) });
  onRow({ label: "rms", value: rms.toFixed(6) });
  project.engine.stop(true);
  console.log("[recording-alignment-audit] probe: measured rms=" + rms.toFixed(6));
  // GATE: cross-context failure mode reads as silence. Same-context must not.
  return rms > RMS_PASS_THRESHOLD ? "PASS" : `FAIL: silent capture (rms=${rms.toFixed(6)})`;
}

function ProbeHarness() {
  const [auditState, setAuditState] = useState("idle");
  const [rows, setRows] = useState<ProbeRow[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [buildProbe, setBuildProbe] = useState<SdkBuildProbe>("unknown");

  const handleRunProbe = useCallback(() => {
    if (running) return;
    setRunning(true);
    setRows([]);
    setVerdict(null);
    setAuditState("setup");
    setAuditState("running:probe");
    runProbe(
      (row) => setRows((prev) => [...prev, row]),
      (probe) => setBuildProbe(probe)
    )
      .then((result) => {
        console.log("[recording-alignment-audit] verdict: " + result);
        setVerdict(result);
        setAuditState("done");
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[recording-alignment-audit] probe error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running]);

  const verdictIsPass = verdict === "PASS";

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Recording Start-Alignment Audit — Feasibility Probe
          </Heading>
          <Text size="1" color="gray" align="center">
            build: {buildProbe}
          </Text>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">
                State:
              </Text>
              <Badge
                id="audit-state"
                data-audit-state={auditState}
                color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}
              >
                {auditState}
              </Badge>
              <Button onClick={handleRunProbe} disabled={running}>
                Run probe
              </Button>
              {verdict !== null && (
                <Badge id="probe-verdict" data-verdict={verdict} color={verdictIsPass ? "green" : "red"}>
                  {verdict}
                </Badge>
              )}
            </Flex>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>metric</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>value</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => (
                    <Table.Row key={row.label}>
                      <Table.Cell>{row.label}</Table.Cell>
                      <Table.Cell>{row.value}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>
              Configuration
            </Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {`?rate=<number>   default 48000 — forced AudioContext sample rate
Record window:    ${RECORD_WINDOW_MS / 1000}s (no count-in — startRecording(false))
Pass threshold:    rms > ${RMS_PASS_THRESHOLD}
Click "Run probe" with a real click — resumes the AudioContext.`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

// ============================================================================
// Scenario runner (Task 4) — ?scenario=<name|all>&bpm=<n|all>&rate=<n>
// ============================================================================

const ALL_SCENARIOS = [...RECORDING_AUDIT_SCENARIOS];

interface AuditRow {
  scenario: RecordingScenario;
  bpm: number;
  rate: number;
  repeat: number;
  takeIndex: number;
  medianBeatErrorMs: number | null;
  // Task 7 recast: raw + harnessPathBiasSec*1000 (audioContext.outputLatency) —
  // classifyCell's verdict runs on this field; the raw field above is unmodified
  // and always persisted alongside it (see recordingAlignment.ts measureTakeAlignment).
  medianBeatErrorMsAdjusted: number | null;
  matchedBeats: number;
  missingBeats: number;
  headMissingMs: number | null; // baseline-corrected (HEAD_MISSING_BASELINE_MS already subtracted)
  headMissingRawMs: number | null; // uncorrected — see Task 6 fix-round C3/I3
  // Task 7 fix round 1 (I1): tailMissingMs was computed by measureTakeAlignment but
  // never persisted — classifyCell's tail-deficit gate is auditable via headMissingMs
  // but not via this field. Persisted alongside the raw values it's derived from
  // (stopRequestContextTime, bufferDurationSec) so a tail-deficit verdict is traceable
  // the same way a head-deficit one already is.
  tailMissingMs?: number | null;
  stopRequestContextTime?: number | null;
  bufferDurationSec?: number;
  status: CellStatus | "pending" | "error";
  matchedSignature: string | null;
  detail: string;
  errorMessage?: string;
  // Fix round 1 (C3/I3): raw box-graph values behind the placement math, persisted
  // per-take (previously console-only "diag" logging) so the bring-up
  // decomposition is backed by a committed artifact, not just console output.
  regionPositionPpqn?: number;
  regionStartSec?: number;
  waveformOffsetSec?: number;
  anchorT0Sec?: number | null;
  recordRequestContextTime?: number | null;
  // Detector/graph-path noise for this repeat's reference-click schedule match —
  // previously console-only "clockNoise" logging.
  clockNoiseIdentifiedClicks?: number;
  clockNoiseMaxAbsResidualMs?: number;
  // Fix round 2 (cheap add): time from `stopRecording()` to the loader
  // reaching a terminal state — the C2 finalization-timeout evidence
  // (fast-success-or-never split) as a committed artifact, not console memory.
  finalizeMs?: number;
}

interface CapturedBuffer {
  channels: Float32Array[];
  sampleRate: number;
}

interface CellRepeatResult {
  rows: AuditRow[];
  alignments: { takeIndex: number; alignment: TakeAlignment }[];
  buffer: CapturedBuffer;
}

/** Filename-safe token for a bpm that may carry a decimal (97.3 -> "97p3") —
 *  the /__verify sink's name regex only accepts [a-z0-9-]+ before the extension. */
function bpmToken(bpm: number): string {
  return String(bpm).replace(".", "p");
}

function cellLabel(scenario: RecordingScenario, bpm: number, repeat: number): string {
  return `${scenario}/${bpmToken(bpm)}/r${repeat}`;
}

function isRecordingScenario(value: string): value is RecordingScenario {
  return (ALL_SCENARIOS as string[]).includes(value);
}

function resolveScenarios(param: string | null): RecordingScenario[] {
  if (!param || param === "all") return ALL_SCENARIOS;
  if (!isRecordingScenario(param)) {
    throw new Error(`unknown scenario "${param}" — use ?scenario=probe|all|${ALL_SCENARIOS.join("|")}`);
  }
  return [param];
}

function resolveBpms(param: string | null): number[] {
  if (!param || param === "all") return [...RECORDING_AUDIT_BPMS];
  const n = Number(param);
  if (!Number.isFinite(n)) throw new Error(`invalid ?bpm= "${param}"`);
  return [n];
}

/** rate is per-page-load (sets the AudioContext at init) — NEVER "all". */
function resolveRate(param: string | null): number {
  const raw = param ?? "48000";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid ?rate= "${raw}" — a single sample rate (e.g. 44100 or 48000), never "all"`);
  }
  return n;
}

/** withDeadline-wrapped poll of engine.position, per the brief's spec — catches
 *  the documented WASM transport-start-delay flakiness (position never advances)
 *  as a timeout instead of hanging the whole campaign. */
function waitForPosition(project: Project, targetPpqn: number, deadlineMs: number): Promise<void> {
  return withDeadline(
    new Promise<void>((resolve) => {
      const check = () => {
        if (project.engine.position.getValue() >= targetPpqn) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    }),
    deadlineMs,
    `waitForPosition(${targetPpqn})`
  );
}

/**
 * Poll until engine.position reads back within one beat of `expectedPpqn`.
 * Required after every `setPosition()` call, before trusting any later
 * `waitForPosition(..., target)` check: `position.getValue()` can still
 * return the PREVIOUS repeat's stale value for one or more polls
 * immediately after `setPosition()` (the reset is applied on the audio
 * thread and only reflected back asynchronously). Without this settle,
 * a repeat targeting the same musical span as the one before it can read
 * that stale (already-past-target) value on `waitForPosition`'s very
 * first, synchronous check and resolve instantly — stopping the recording
 * before any audio was captured (observed: two consecutive repeats both
 * finalizing with zero take regions, no timeout, right after a prior
 * repeat had ended near the same position). The first check is deferred
 * via setTimeout so it can never resolve on a synchronous stale read.
 */
function waitForPositionSettled(project: Project, expectedPpqn: number, deadlineMs: number): Promise<void> {
  const tolerancePpqn = BAR_PPQN / 4; // one beat's worth of slack
  return withDeadline(
    new Promise<void>((resolve) => {
      const check = () => {
        if (Math.abs(project.engine.position.getValue() - expectedPpqn) <= tolerancePpqn) {
          resolve();
          return;
        }
        setTimeout(check, 20);
      };
      setTimeout(check, 20);
    }),
    deadlineMs,
    `waitForPositionSettled(${expectedPpqn})`
  );
}

/**
 * Resolves once EVERY one of `unitAdapters` holds >= targetCountEach audio
 * take regions — used by loop-wrap (a single adapter, LOOP_WRAP_TAKES + 1 —
 * the 5 finalized takes plus the in-progress 6th) and by the multi-mic
 * scenarios (two adapters, target 1 each: confirms BOTH tapes' independent
 * RecordingWorklets have actually created their take region before the
 * caller trusts the recording is genuinely underway on both — skipping this
 * check would race exactly the inter-track skew this scenario measures,
 * since each tape's region-creation timing is independent).
 *
 * Watches each adapter's `.tracks` itself (not just a one-time snapshot of
 * `.values()`) — the SDK can land later takes on a newly-created TrackBox
 * (`RecordTrack.findOrCreate` per CLAUDE.md's "Take-to-Track Matching"),
 * which would otherwise be invisible to a fixed set of `regions`
 * subscriptions and stall the cell out to the deadline.
 *
 * Manages its own deadline (rather than wrapping withDeadline around the
 * promise) so every subscription — on every adapter's tracks collection AND
 * on each track's regions — is guaranteed to terminate on every exit path
 * (resolve, or timeout); an external withDeadline wrapper has no way to
 * reach into this promise to clean up subs it never sees.
 */
function waitForTakeCount(unitAdapters: AudioUnitBoxAdapter[], targetCountEach: number, deadlineMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const subs: Terminable[] = [];
    let settled = false;
    const cleanup = () => subs.forEach((s) => s.terminate());
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`waitForTakeCount(${targetCountEach}x${unitAdapters.length}) timed out after ${deadlineMs / 1000}s`));
    }, deadlineMs);
    const countRegions = (unitAdapter: AudioUnitBoxAdapter) =>
      unitAdapter.tracks
        .values()
        .flatMap((t) => [...t.regions.adapters.values()])
        .filter((r) => r.isAudioRegion()).length;
    const checkAndMaybeResolve = () => {
      if (settled) return;
      if (unitAdapters.every((u) => countRegions(u) >= targetCountEach)) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve();
      }
    };
    for (const unitAdapter of unitAdapters) {
      subs.push(
        unitAdapter.tracks.catchupAndSubscribe({
          onAdd: (track) => {
            subs.push(track.regions.catchupAndSubscribe({ onAdded: checkAndMaybeResolve, onRemoved: () => {} }));
          },
          onRemove: () => {},
          onReorder: () => {},
        })
      );
    }
  });
}

/**
 * Resolves once `loader.state.type` reaches a terminal state ("loaded" or
 * "error"); rejects with the loader's error reason if it errors, or with a
 * timeout error after `deadlineMs`. Pre-checks the already-terminal case
 * (avoids the `subscribe()`-fires-synchronously TDZ hazard — see CLAUDE.md's
 * SampleLoader section) and manages its own deadline so the subscription is
 * guaranteed to terminate on every exit path — resolve, error, or timeout.
 * Shared by the finalization barrier and the between-cells cleanup grace
 * wait so both close the same leak the same way.
 */
function waitForLoaderTerminal(loader: SampleLoader, deadlineMs: number, label: string): Promise<void> {
  if (loader.state.type === "loaded") return Promise.resolve();
  if (loader.state.type === "error") return Promise.reject(new Error(String(loader.state.reason)));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscribed = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (subscribed) sub.terminate();
      reject(new Error(`${label} timed out after ${deadlineMs / 1000}s`));
    }, deadlineMs);
    const sub = loader.subscribe((state) => {
      if (settled) return;
      if (state.type === "loaded") {
        settled = true;
        clearTimeout(timer);
        resolve();
        if (subscribed) sub.terminate();
      } else if (state.type === "error") {
        settled = true;
        clearTimeout(timer);
        reject(new Error(String(state.reason)));
        if (subscribed) sub.terminate();
      }
    });
    subscribed = true;
  });
}

/**
 * Fix round 2 (N3): subscribes to `engine.isRecording` and, once it first
 * flips true, blocks the main thread for `jankMs` (the `janked-start`
 * provocation — see the C1 fix comment at its call site). Manages its own
 * deadline and guaranteed subscription termination on every exit path
 * (jank-fired, timeout) — same shape as `waitForLoaderTerminal` above and
 * for the same reason: the original inline version had no internal
 * deadline (a never-flipping `isRecording`, e.g. the documented WASM
 * transport-start-delay quirk, left the subscription live past the outer
 * 120s cell deadline, so it could fire the spin during a LATER repeat that
 * reuses the same tape/capture — silent cross-repeat contamination) and
 * used a bare `jankSub!.terminate()` that would null-deref if `isRecording`
 * were already true at subscribe time (catchup fires synchronously, before
 * the assignment to `jankSub` completes) — the same TDZ-shaped hazard
 * CLAUDE.md's SampleLoader section warns about, fixed here with the same
 * `subscribed` boolean guard pattern.
 */
function armJankOnRecordingFlip(project: Project, jankMs: number, deadlineMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscribed = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (subscribed) sub.terminate();
      reject(new Error(`armJankOnRecordingFlip: isRecording never flipped true within ${deadlineMs / 1000}s`));
    }, deadlineMs);
    const sub = project.engine.isRecording.catchupAndSubscribe((obs) => {
      if (settled || !obs.getValue()) return;
      settled = true;
      clearTimeout(timer);
      const until = performance.now() + jankMs;
      while (performance.now() < until) {
        /* spin */
      }
      if (subscribed) sub.terminate();
      resolve();
    });
    subscribed = true;
  });
}

/**
 * Common per-repeat sequence (task-4-brief.md Steps 2-5): set bpm/prefs,
 * schedule reference clicks, run the scenario-specific start, wait for the
 * scenario-specific stop condition, wait for finalization, then measure
 * every take region against the beat grid + reference schedule.
 *
 * Does NOT clean up take regions — that is the outer cell loop's job
 * (`resetForNextCell`, called unconditionally after every repeat attempt,
 * success or failure, so a mid-recording error never leaves stale regions
 * for the next repeat).
 */
async function runCellRepeat(
  project: Project,
  audioContext: AudioContext,
  unitAdapter: AudioUnitBoxAdapter,
  scenario: RecordingScenario,
  bpm: number,
  rate: number,
  repeat: number,
  onStage: (stage: string) => void,
  // Task 7 recast: audioContext.outputLatency — the register's "term 1" harness-path
  // bias (see debug/recording-start-alignment-audit.md "Bring-up calibration"),
  // passed through to measureTakeAlignment so classifyCell's verdicts run on the
  // adjusted median rather than the raw one. The VALUE is read once per page load
  // (identical at both sample rates per the register, since outputLatency doesn't
  // change mid-session) and passed unchanged into every repeat's runCellRepeat call
  // — this parameter itself IS supplied per repeat, not just once.
  harnessPathBiasSec: number
): Promise<CellRepeatResult> {
  onStage("prefs");
  project.editing.modify(() => {
    project.timelineBox.bpm.setValue(bpm);
  });
  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;
  settings.recording.allowTakes = true;
  settings.recording.olderTakeAction = "mute-region";
  settings.recording.inputLatency = 0;

  // Loop area only for loop-wrap; disabled otherwise (same editing.modify).
  const { loopArea } = project.timelineBox;
  project.editing.modify(() => {
    loopArea.from.setValue(0);
    loopArea.to.setValue(2 * BAR_PPQN);
    loopArea.enabled.setValue(scenario === "loop-wrap");
  });

  // Reference clicks: start before recording, cover the longest cell
  // (loop-wrap 5 takes @97.3bpm ~= 25s) + margin.
  const schedule: ReferenceSchedule = buildReferenceSchedule(audioContext.currentTime + 0.2, 120, 0.25, 0.005);
  loopback.scheduleReferenceClicks(schedule.times);

  const usedCountIn = scenario === "countin-start" || scenario === "loop-wrap";
  let recordRequestContextTime: number | null = null;
  let stopRequestContextTime: number | null = null;
  let startPpqn = 0;

  onStage("start");
  switch (scenario) {
    case "nominal-start": {
      project.engine.setPosition(0);
      await waitForPositionSettled(project, 0, 30_000);
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(false);
      break;
    }
    case "countin-start":
    case "loop-wrap": {
      project.engine.setPosition(0);
      await waitForPositionSettled(project, 0, 30_000);
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(true); // 1-bar count-in
      break;
    }
    case "janked-start": {
      project.engine.setPosition(0);
      await waitForPositionSettled(project, 0, 30_000);
      recordRequestContextTime = audioContext.currentTime;
      // Fix round 1 (C1): `project.startRecording()` is fire-and-forget over an
      // ASYNC chain (`Recording.start` AWAITS `capture.prepareRecording()` — the
      // worklet-connect — before `engine.prepareRecordingState()` actually starts
      // the transport). Spinning immediately after the call, as this scenario
      // used to, blocks that continuation too: it defers capture-connect AND
      // transport-start together, which just delays when recording genuinely
      // begins (measured: raw headMissingMs tracked JANK_MS almost exactly,
      // 168.89ms jank mean − 18.58ms nominal baseline ≈ 150.3ms ≈ JANK_MS) —
      // not C's intended provocation (a main thread busy AFTER an audio-thread
      // anchor already exists, before the SDK reads/accepts it). Fix: key the
      // spin off our OWN subscription to `engine.isRecording` actually flipping
      // true (see `armJankOnRecordingFlip` above; fix round 2 rewrote this from
      // an inline, undeadlined Promise to that shared, self-terminating helper)
      // — by definition, everything up to and including
      // `engine.prepareRecordingState()` has already run by then, so capture is
      // genuinely live; only the SDK's post-flip position-tick handling (which
      // creates the take) is still pending and gets blocked by the spin.
      const jankArmed = armJankOnRecordingFlip(project, JANK_MS, 30_000);
      project.startRecording(false);
      await jankArmed;
      break;
    }
    case "midtimeline-start": {
      project.engine.setPosition(0);
      await waitForPositionSettled(project, 0, 30_000);
      project.engine.play();
      startPpqn = 2 * BAR_PPQN;
      await waitForPosition(project, startPpqn, 20_000);
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(false);
      break;
    }
  }

  onStage("recording");
  if (scenario === "loop-wrap") {
    await waitForTakeCount([unitAdapter], LOOP_WRAP_TAKES + 1, 90_000);
  } else {
    await waitForPosition(project, startPpqn + 4 * BAR_PPQN, 60_000);
  }

  onStage("stopping");
  stopRequestContextTime = audioContext.currentTime;
  project.engine.stopRecording();

  onStage("finalizing");
  // All takes on the tape share one file (see CLAUDE.md "Loop Take Buffer
  // Layout") — wait on any one region's loader.
  const anyTake = unitAdapter.tracks
    .values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion())[0];
  if (!anyTake) throw new Error("no take regions created");
  const loader = anyTake.file.getOrCreateLoader();
  // Fix round 1 (C2): loop-wrap repeats were failing with
  // `finalizing: finalization timed out after 30s` (NOT the `waitForPosition`
  // transport-start quirk this scenario's error rows were previously
  // mis-attributed to). Diagnostic: widened to 90s to test "genuinely needs
  // more time" (harness deadline miscalibration) vs a real hang. Result: 4 of
  // 6 repeats STILL timed out at 90s (3x the original deadline) while the
  // other 2 finalized in under 5s — a binary fast-or-never split, not a slow
  // gradient — refuting the miscalibration hypothesis. Reverted to 30s (a
  // longer deadline bought nothing but wall-clock time); the timing itself
  // is kept as a diagnostic since it's cheap and helps future triage.
  const finalizeDeadlineMs = 30_000;
  const finalizeStart = performance.now();
  await waitForLoaderTerminal(loader, finalizeDeadlineMs, "finalization");
  // Fix round 2 (cheap add): persisted per row below (`finalizeMs`) so the C2
  // fast-or-never finalization-timeout evidence is a committed artifact, not
  // console-only.
  const finalizeMs = performance.now() - finalizeStart;
  console.log(
    "[recording-alignment-audit] finalize " + cellLabel(scenario, bpm, repeat) +
    " took " + finalizeMs.toFixed(0) + "ms" +
    " (deadline " + finalizeDeadlineMs + "ms)"
  );

  onStage("measuring");
  const takeRegions = unitAdapter.tracks
    .values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion())
    .sort((a, b) => a.position - b.position);
  const dataOpt = loader.data;
  if (dataOpt.isEmpty()) throw new Error("loader loaded but data empty");
  const data = dataOpt.unwrap();
  const mono = data.frames[0]; // requestChannels = 1
  const { low, high } = bandSplit(mono, data.sampleRate);
  const lowOnsets = detectOnsets(low, data.sampleRate, { refractorySec: 0.1 });
  const highOnsets = detectOnsets(high, data.sampleRate, { refractorySec: 0.05 });

  // Bring-up diagnostic (Task 6, ALIGNED_TOLERANCE_MS calibration): pure
  // detector/graph-path noise, independent of any SDK placement math — each
  // identified reference click's residual against its OWN schedule entry,
  // relative to the median anchor. This isolates onset-detection + zero-phase
  // band-split jitter from everything RecordAudio.ts computes. Fix round 1
  // (I3): captured into variables and persisted on every row below (was
  // console-only), so this evidence lives in a committed artifact.
  let clockNoiseIdentifiedClicks: number | undefined;
  let clockNoiseMaxAbsResidualMs: number | undefined;
  {
    const identified = identifyReferenceClicks(highOnsets, schedule);
    const anchor = estimateAnchorT0(identified, schedule);
    if (anchor !== null && identified.length > 1) {
      const residualsMs = identified.map((c) => (schedule.times[c.index] - c.fileTimeSec - anchor) * 1000);
      const maxAbs = Math.max(...residualsMs.map((r) => Math.abs(r)));
      clockNoiseIdentifiedClicks = identified.length;
      clockNoiseMaxAbsResidualMs = maxAbs;
      console.log(
        "[recording-alignment-audit] clockNoise " + cellLabel(scenario, bpm, repeat) +
        " identifiedClicks=" + identified.length +
        " maxAbsResidualMs=" + maxAbs.toFixed(4) +
        " residualsMs=[" + residualsMs.map((r) => r.toFixed(3)).join(",") + "]"
      );
    }
  }

  const rows: AuditRow[] = [];
  const alignments: { takeIndex: number; alignment: TakeAlignment }[] = [];
  for (const [takeIndex, region] of takeRegions.entries()) {
    const regionStartSec = project.tempoMap.ppqnToSeconds(region.position);
    const waveformOffsetSec = region.box.waveformOffset.getValue();
    const regionDurationSec = project.tempoMap.intervalToSeconds(region.position, region.position + region.duration);
    const bufferDurationSec = data.numberOfFrames / data.sampleRate;
    const alignment = measureTakeAlignment({
      lowOnsets,
      highOnsets,
      regionStartSec,
      waveformOffsetSec,
      regionDurationSec,
      bufferDurationSec,
      bpm,
      countInBeats: usedCountIn ? 4 : 0,
      schedule,
      recordRequestContextTime,
      stopRequestContextTime,
      headMissingBaselineMs: HEAD_MISSING_BASELINE_MS,
      harnessPathBiasSec,
    });
    alignments.push({ takeIndex, alignment });
    // Fix round 1 (I3): raw (uncorrected) head-missing, so both the corrected
    // and raw figures are available in the persisted row (was only derivable
    // by reversing HEAD_MISSING_BASELINE_MS by hand from console output).
    const headMissingRawMs =
      alignment.anchorT0Sec !== null && recordRequestContextTime !== null
        ? Math.max(0, (alignment.anchorT0Sec - recordRequestContextTime) * 1000)
        : null;
    // Bring-up diagnostic (Task 6): raw box-graph values behind every alignment
    // number, so a calibration bias can be traced to its source term instead of
    // inferred from the final medianBeatErrorMs alone. Fix round 1 (C3/I3):
    // also persisted on the row itself (was console-only).
    console.log(
      "[recording-alignment-audit] diag " + cellLabel(scenario, bpm, repeat) + "/take" + takeIndex +
      " position=" + String(region.position) +
      " regionStartSec=" + String(regionStartSec) +
      " waveformOffsetSec=" + String(waveformOffsetSec) +
      " anchorT0Sec=" + String(alignment.anchorT0Sec) +
      " recordRequestContextTime=" + String(recordRequestContextTime) +
      " medianBeatErrorMs=" + String(alignment.medianBeatErrorMs) +
      " medianBeatErrorMsAdjusted=" + String(alignment.medianBeatErrorMsAdjusted) +
      " headMissingMs=" + String(alignment.headMissingMs) +
      " headMissingRawMs=" + String(headMissingRawMs)
    );
    rows.push({
      scenario,
      bpm,
      rate,
      repeat,
      takeIndex,
      medianBeatErrorMs: alignment.medianBeatErrorMs,
      medianBeatErrorMsAdjusted: alignment.medianBeatErrorMsAdjusted,
      matchedBeats: alignment.matchedBeats,
      missingBeats: alignment.missingBeats,
      headMissingMs: alignment.headMissingMs,
      headMissingRawMs,
      tailMissingMs: alignment.tailMissingMs,
      stopRequestContextTime,
      bufferDurationSec,
      regionPositionPpqn: region.position,
      regionStartSec,
      waveformOffsetSec,
      anchorT0Sec: alignment.anchorT0Sec,
      recordRequestContextTime,
      finalizeMs,
      clockNoiseIdentifiedClicks,
      clockNoiseMaxAbsResidualMs,
      status: "pending",
      matchedSignature: null,
      detail: "",
    });
  }

  return { rows, alignments, buffer: { channels: [mono], sampleRate: data.sampleRate } };
}

/**
 * Between-cells reset (task-4-brief.md Step 1): cancel any still-pending
 * reference clicks from this repeat's schedule (otherwise a stray onset from
 * an earlier repeat's ~65s schedule can leak into the NEXT repeat's captured
 * buffer and break `identifyReferenceClicks`' gap adjacency), stop any
 * lingering recording state, delete every take region on the tape's tracks
 * AND the shared AudioFileBox they point at (`region.box.delete()`
 * cascade-deletes the region's OWN mandatory dependents, but the file is an
 * outgoing pointer the region merely refers to — the SDK's own
 * `restartRecording()` cleanup path deletes regions the same way and leaves
 * the file box orphaned, verified by reading Project.js — so it must be
 * deleted here explicitly), then reset position.
 *
 * Runs unconditionally (success or failure) so a mid-recording error never
 * leaves stale regions for the next repeat/cell. Per CLAUDE.md's "Never Call
 * stop(true) During Recording Finalization" rule, an error mid-recording
 * (most commonly a `waitForPosition`/`waitForTakeCount` timeout — EXPECTED
 * in this campaign, see the WASM transport-start-delay note) can land here
 * while a take is still finalizing; `stop(true)` racing that finalization is
 * exactly what the rule warns against. So: if a take region exists whose
 * loader hasn't reached a terminal state yet, wait up to a bounded grace
 * period for it before deleting boxes / calling stop(true). If the grace
 * period also expires, proceed anyway (the campaign must not hang on one
 * bad cell) but return a warning string — the caller attaches it to the
 * affected row's `detail` so a human (or Task 6) can spot a cell whose
 * predecessor's cleanup may not have fully settled before it started.
 */
async function resetForNextCell(project: Project, unitAdapter: AudioUnitBoxAdapter): Promise<string | null> {
  loopback.cancelReferenceClicks();
  if (project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue()) {
    project.engine.stopRecording();
  }
  const takeRegions = unitAdapter.tracks
    .values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion());
  let warning: string | null = null;
  if (takeRegions.length > 0) {
    const loader = takeRegions[0].file.getOrCreateLoader();
    if (loader.state.type !== "loaded" && loader.state.type !== "error") {
      try {
        await waitForLoaderTerminal(loader, 10_000, "cleanup finalization grace");
      } catch (err) {
        warning = `finalization grace timed out before deleting take regions: ${String(err)}`;
        console.warn(`[recording-alignment-audit] ${warning}`);
      }
    }
    const fileBox = takeRegions[0].file.box;
    project.editing.modify(() => {
      takeRegions.forEach((r) => r.box.delete());
      fileBox.delete();
    });
  }
  project.engine.stop(true);
  project.engine.setPosition(0);
  return warning;
}

/** Upload a single repeat's full capture buffer (all takes share it). Non-fatal
 *  on failure — logs and lets the run continue (matches samplerate-audit's convention). */
async function uploadRepeatWav(
  scenario: RecordingScenario,
  bpm: number,
  rate: number,
  repeat: number,
  buffer: CapturedBuffer
): Promise<void> {
  const wavBuffer = WavFile.encodeInts16({
    sampleRate: buffer.sampleRate,
    length: buffer.channels[0].length,
    numberOfChannels: buffer.channels.length,
    getChannelData: (i: number) => buffer.channels[i],
  });
  const name = `recaudit-${scenario}-${bpmToken(bpm)}-${rate}-r${repeat}.wav`;
  try {
    await withDeadline(
      (async () => {
        const res = await fetch(`/__verify/${name}`, { method: "PUT", body: wavBuffer });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })(),
      30_000,
      `WAV upload ${name}`
    );
  } catch (err) {
    console.warn(`[recording-alignment-audit] WAV upload failed for ${name}: ${String(err)}`);
  }
}

/** Upload the JSON summary. Throws on failure (run-level, fatal -> error state). */
async function uploadSummary(
  rows: AuditRow[],
  rate: number,
  sdkBuildProbe: SdkBuildProbe,
  outputLatency: number,
  baseLatency: number
): Promise<void> {
  const timestamp = Date.now();
  const summary = {
    rate,
    sdkBuildProbe,
    // Fix round 1 (C3/I3): persisted so the loopback-path-bias decomposition
    // doesn't depend on console output — logged once per run, same value on
    // every row this run produced.
    outputLatency,
    baseLatency,
    // Task 7 recast: the value actually wired into every row's harnessPathBiasSec
    // this run (== outputLatency, captured once at run start) — recorded explicitly
    // so a register/offline reader never has to assume outputLatency was the value
    // live rows were adjusted by.
    harnessPathBiasSec: outputLatency,
    headMissingBaselineMs: HEAD_MISSING_BASELINE_MS,
    repeatsPerCell: REPEATS_PER_CELL,
    jankMs: JANK_MS,
    loopWrapTakes: LOOP_WRAP_TAKES,
    alignedToleranceMs: ALIGNED_TOLERANCE_MS,
    referenceSchedule: { count: 120, baseGapSec: 0.25, gapIncrementSec: 0.005 },
    rows,
  };
  const jsonBody = JSON.stringify(summary, null, 2);
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/recaudit-summary-${timestamp}.json`, { method: "PUT", body: jsonBody });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "summary upload"
  );
}

async function runAudit(
  setAuditState: (s: string) => void,
  onRow: (row: AuditRow) => void,
  onBuildProbe: (probe: SdkBuildProbe) => void
): Promise<void> {
  setAuditState("setup");
  const scenarios = resolveScenarios(params.get("scenario"));
  const bpms = resolveBpms(params.get("bpm"));
  const rate = resolveRate(params.get("rate"));

  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  const sdkBuildProbe = detectSdkBuildProbe(project.engine);
  onBuildProbe(sdkBuildProbe);
  loopback.attach(audioContext);
  console.log("[recording-alignment-audit] outputLatency=" + String(audioContext.outputLatency) + " baseLatency=" + String(audioContext.baseLatency));

  // ONE tape, created once, reused across every cell.
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

  const unitAdapter = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBox);
  if (!unitAdapter) throw new Error("no audio unit adapter for tape");

  const allRows: AuditRow[] = [];

  for (const scenario of scenarios) {
    for (const bpm of bpms) {
      const repeats: {
        repeat: number;
        rows: AuditRow[];
        alignments: CellRepeatResult["alignments"];
        buffer: CapturedBuffer;
        cleanupWarning: string | null;
      }[] = [];

      for (let repeat = 1; repeat <= REPEATS_PER_CELL; repeat++) {
        const label = cellLabel(scenario, bpm, repeat);
        setAuditState(`running:${label}`);
        let stage = "prefs";
        let result: CellRepeatResult | null = null;
        let errorMessage: string | null = null;
        try {
          result = await withDeadline(
            runCellRepeat(project, audioContext, unitAdapter, scenario, bpm, rate, repeat, (s) => {
              stage = s;
            }, audioContext.outputLatency),
            120_000,
            label
          );
        } catch (err) {
          errorMessage = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[recording-alignment-audit] cell ${label} failed: ${errorMessage}`);
        }

        // Unconditional (success or failure) — a mid-recording error must
        // not leave stale regions for the next repeat/cell. Guarded so a
        // cleanup failure itself can never abort the whole campaign.
        let cleanupWarning: string | null = null;
        try {
          cleanupWarning = await resetForNextCell(project, unitAdapter);
        } catch (cleanupErr) {
          cleanupWarning = `cleanup itself threw: ${String(cleanupErr)}`;
          console.warn(`[recording-alignment-audit] cell ${label} cleanup failed: ${cleanupWarning}`);
        }

        if (result) {
          repeats.push({ repeat, ...result, cleanupWarning });
        } else {
          const errorRow: AuditRow = {
            scenario,
            bpm,
            rate,
            repeat,
            takeIndex: 0,
            medianBeatErrorMs: null,
            medianBeatErrorMsAdjusted: null,
            matchedBeats: 0,
            missingBeats: 0,
            headMissingMs: null,
            headMissingRawMs: null,
            status: "error",
            matchedSignature: null,
            detail: cleanupWarning ? `cleanup warning: ${cleanupWarning}` : "",
            errorMessage: errorMessage ?? "unknown error",
          };
          allRows.push(errorRow);
          onRow(errorRow);
        }
      }

      // loop-wrap classifies over wrap takes 2..5 (0-based indices 1..4) —
      // take 1 isn't loop-scoped and the final in-progress take's duration
      // is RenderQuantum-granular by design (see CLAUDE.md take-durations rule).
      const alignmentsForClassification =
        scenario === "loop-wrap"
          ? repeats.flatMap((r) => r.alignments.filter((a) => a.takeIndex >= 1 && a.takeIndex <= LOOP_WRAP_TAKES - 1).map((a) => a.alignment))
          : repeats.flatMap((r) => r.alignments.map((a) => a.alignment));

      const classification: CellClassification =
        alignmentsForClassification.length > 0
          ? classifyCell(alignmentsForClassification, SIGNATURE_BANDS[scenario], ALIGNED_TOLERANCE_MS)
          : { status: "investigate", matchedSignature: null, detail: "no successful repeats to classify" };

      for (const r of repeats) {
        for (const row of r.rows) {
          row.status = classification.status;
          row.matchedSignature = classification.matchedSignature;
          // A cleanup-grace warning marks a row whose PREDECESSOR's cleanup
          // may not have fully settled before this repeat started — surfaced
          // here (not just logged) so Task 6 can spot potentially-poisoned
          // successor cells directly from the summary JSON/table.
          row.detail = r.cleanupWarning
            ? `${classification.detail} | cleanup warning: ${r.cleanupWarning}`
            : classification.detail;
          allRows.push(row);
          onRow(row);
        }
        await uploadRepeatWav(scenario, bpm, rate, r.repeat, r.buffer);
      }
    }
  }

  setAuditState("uploading");
  await uploadSummary(allRows, rate, sdkBuildProbe, audioContext.outputLatency, audioContext.baseLatency);
  setAuditState("done");
}

function statusColor(status: AuditRow["status"]): "green" | "amber" | "red" | "gray" {
  if (status === "aligned") return "green";
  if (status === "matches-known-defect") return "amber";
  if (status === "investigate" || status === "error") return "red";
  return "gray";
}

function ScenarioRunnerHarness() {
  const [auditState, setAuditState] = useState("idle");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [buildProbe, setBuildProbe] = useState<SdkBuildProbe>("unknown");

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    setStarted(true);
    setRows([]);
    runAudit(
      setAuditState,
      (row) => setRows((prev) => [...prev, row]),
      (probe) => setBuildProbe(probe)
    )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[recording-alignment-audit] run error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running]);

  const alignedCount = rows.filter((r) => r.status === "aligned").length;
  const defectCount = rows.filter((r) => r.status === "matches-known-defect").length;
  const investigateCount = rows.filter((r) => r.status === "investigate").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Recording Start-Alignment Audit — Scenario Matrix
          </Heading>
          <Text size="1" color="gray" align="center">
            build: {buildProbe}
          </Text>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">
                State:
              </Text>
              <Badge
                id="audit-state"
                data-audit-state={auditState}
                color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}
              >
                {auditState}
              </Badge>
              <Button onClick={handleRun} disabled={running}>
                {started ? "Re-run" : "Run audit"}
              </Button>
              <Text size="2" color="gray">
                {rows.length} row{rows.length === 1 ? "" : "s"} — {alignedCount} aligned, {defectCount} known-defect,{" "}
                {investigateCount} investigate
                {errorCount > 0 && `, ${errorCount} error`}
              </Text>
            </Flex>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>scenario</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>bpm</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>repeat</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>take</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>medianErr (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>adjErr (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>matched</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>missing</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>headMiss (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>signature</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>status</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row, i) => (
                    <Table.Row key={`${row.scenario}-${bpmToken(row.bpm)}-${row.repeat}-${row.takeIndex}-${i}`}>
                      <Table.Cell>{row.scenario}</Table.Cell>
                      <Table.Cell>{row.bpm}</Table.Cell>
                      <Table.Cell>{row.repeat}</Table.Cell>
                      <Table.Cell>{row.takeIndex}</Table.Cell>
                      <Table.Cell>{row.medianBeatErrorMs === null ? "—" : row.medianBeatErrorMs.toFixed(2)}</Table.Cell>
                      <Table.Cell>{row.medianBeatErrorMsAdjusted === null ? "—" : row.medianBeatErrorMsAdjusted.toFixed(2)}</Table.Cell>
                      <Table.Cell>{row.matchedBeats}</Table.Cell>
                      <Table.Cell>{row.missingBeats}</Table.Cell>
                      <Table.Cell>{row.headMissingMs === null ? "—" : row.headMissingMs.toFixed(2)}</Table.Cell>
                      <Table.Cell>{row.matchedSignature ?? "—"}</Table.Cell>
                      <Table.Cell>
                        <Badge color={statusColor(row.status)} title={row.errorMessage ?? row.detail}>
                          {row.status}
                        </Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>
              Configuration
            </Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {`?scenario=<name|all>   default "all" (${ALL_SCENARIOS.join(", ")})
?bpm=<number|all>     default "all" (${RECORDING_AUDIT_BPMS.join(", ")})
?rate=<number>        default 48000 — sets the AudioContext at init, never "all"
Repeats per cell:       ${REPEATS_PER_CELL}
Uploads:                recaudit-summary-<timestamp>.json (all rows) via PUT /__verify
                        recaudit-<scenario>-<bpm>-<rate>-r<repeat>.wav per repeat
Click "Run audit" with a real click — resumes the AudioContext.`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

// ============================================================================
// Multi-mic simultaneous recording (Task 7b) — ?scenario=multitrack-start|
// multitrack-janked|multitrack-all&bpm=<n|all>&rate=<n>
// ============================================================================
//
// Every scenario above is single-tape. Simultaneous multi-capture has a
// failure mode single-tape cells cannot see: each armed tape gets its own
// RecordingWorklet and places its take using that worklet's OWN frame
// counter + the position observed at ITS OWN creation — two tracks
// recording the SAME instant can still land at different timeline
// positions ("inter-track skew"). Measurement design: feed every tape a
// CLONE of the SAME loopback signal (loopbackDeviceId(1)/(2) — see
// loopbackInjection.ts) so every common bias (loopback-path latency, the
// harness-path/outputLatency term, the metronome content itself) cancels
// out of the DIFFERENCE between the two tapes' beat errors
// (measureCrossTrackSkew) — no calibration term needed here, unlike the
// single-tape sections above.

type MultitrackScenario = "multitrack-start" | "multitrack-janked";
const ALL_MULTITRACK_SCENARIOS: MultitrackScenario[] = ["multitrack-start", "multitrack-janked"];
const MULTITRACK_RECORD_BARS = 4; // matches nominal-start/janked-start's own 4-bar window

/** Reuse the equivalent single-tape scenario's SIGNATURE_BANDS to judge "did
 *  each tape individually place its take the way a single-tape recording of
 *  the same provocation would?" — multitrack-start mirrors nominal-start's
 *  no-jank/no-count-in provocation, multitrack-janked mirrors janked-start's
 *  busy-loop-on-flip provocation (armJankOnRecordingFlip, reused unchanged —
 *  isRecording is engine-wide, so one jank jams BOTH captures' post-flip
 *  handling at once). */
const MULTITRACK_BASE_SCENARIO: Record<MultitrackScenario, RecordingScenario> = {
  "multitrack-start": "nominal-start",
  "multitrack-janked": "janked-start",
};

function isMultitrackScenario(value: string): value is MultitrackScenario {
  return (ALL_MULTITRACK_SCENARIOS as string[]).includes(value);
}

function resolveMultitrackScenarios(param: string | null): MultitrackScenario[] {
  if (param === "multitrack-all") return ALL_MULTITRACK_SCENARIOS;
  if (param !== null && isMultitrackScenario(param)) return [param];
  throw new Error(`unknown multitrack scenario "${param}" — use ?scenario=multitrack-all|${ALL_MULTITRACK_SCENARIOS.join("|")}`);
}

/** Multitrack matrix runs bpm 120 only (spec: "2 scenarios × 2 rates × bpm
 *  120 × 3 repeats") — defaults to [120] rather than the single-tape "all"
 *  default of every RECORDING_AUDIT_BPMS entry; ?bpm=<n|all> still overrides. */
function resolveMultitrackBpms(param: string | null): number[] {
  if (!param) return [120];
  if (param === "all") return [...RECORDING_AUDIT_BPMS];
  const n = Number(param);
  if (!Number.isFinite(n)) throw new Error(`invalid ?bpm= "${param}"`);
  return [n];
}

function multitrackCellLabel(scenario: MultitrackScenario, bpm: number, repeat: number): string {
  return `${scenario}/${bpmToken(bpm)}/r${repeat}`;
}

interface MultitrackAuditRow {
  scenario: MultitrackScenario;
  bpm: number;
  rate: number;
  repeat: number;
  tape: "a" | "b";
  medianBeatErrorMs: number | null;
  medianBeatErrorMsAdjusted: number | null;
  matchedBeats: number;
  missingBeats: number;
  headMissingMs: number | null;
  headMissingRawMs: number | null;
  tailMissingMs: number | null;
  // Cross-track measurement, not per-tape — repeated on BOTH tapes' rows for
  // the same repeat so every existing single-tape column stays meaningful
  // side by side with these in one table/JSON.
  medianSkewMs: number | null;
  maxAbsSkewMs: number | null;
  pairedSkewBeats: number;
  status: CellStatus | "pending" | "error";
  detail: string;
  errorMessage?: string;
  finalizeMs?: number;
}

interface MultitrackTapes {
  audioUnitBoxA: AudioUnitBox;
  audioUnitBoxB: AudioUnitBox;
  unitAdapterA: AudioUnitBoxAdapter;
  unitAdapterB: AudioUnitBoxAdapter;
}

/** Create two Tape instruments, one per loopback device — mirrors runAudit's
 *  single-tape setup, capture field writes in a SEPARATE transaction from
 *  createInstrument per CLAUDE.md's "Pointer Re-Routing" rule. */
function createMultitrackTapes(project: Project): MultitrackTapes {
  let audioUnitBoxA: AudioUnitBox | null = null;
  let audioUnitBoxB: AudioUnitBox | null = null;
  project.editing.modify(() => {
    audioUnitBoxA = project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox;
  });
  project.editing.modify(() => {
    audioUnitBoxB = project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox;
  });
  if (audioUnitBoxA === null || audioUnitBoxB === null) {
    throw new Error("createMultitrackTapes: createInstrument did not return both audioUnitBoxes");
  }
  const captureA = project.captureDevices.get(audioUnitBoxA.address.uuid).unwrap();
  const captureB = project.captureDevices.get(audioUnitBoxB.address.uuid).unwrap();
  if (!(captureA instanceof CaptureAudio) || !(captureB instanceof CaptureAudio)) {
    throw new Error("createMultitrackTapes: capture is not CaptureAudio");
  }
  project.editing.modify(() => {
    captureA.captureBox.deviceId.setValue(loopbackDeviceId(1));
    captureA.requestChannels = 1;
    captureB.captureBox.deviceId.setValue(loopbackDeviceId(2));
    captureB.requestChannels = 1;
  });
  captureA.armed.setValue(true);
  captureB.armed.setValue(true);

  const unitAdapterA = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBoxA);
  const unitAdapterB = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBoxB);
  if (!unitAdapterA || !unitAdapterB) throw new Error("createMultitrackTapes: missing audio unit adapter");
  return { audioUnitBoxA, audioUnitBoxB, unitAdapterA, unitAdapterB };
}

interface MultitrackCellVerdict {
  status: CellStatus;
  detail: string;
}

/**
 * Cell verdict for a multitrack scenario: `aligned` when every repeat's
 * skew magnitude is within `ALIGNED_TOLERANCE_MS` AND both tapes' own
 * per-take alignment independently classifies as clean (not `investigate`)
 * against the equivalent single-tape scenario's SIGNATURE_BANDS —
 * otherwise `investigate`. There is no `matches-known-defect` outcome for
 * skew itself: no signature band predicts it (the single-tape sections
 * never provoked or measured simultaneous capture), so any measured skew
 * beyond tolerance is a candidate finding, named directly in the detail
 * string rather than mapped onto a band.
 */
function classifyMultitrackCell(
  tapeAClass: CellClassification,
  tapeBClass: CellClassification,
  repeatSkews: CrossTrackSkew[]
): MultitrackCellVerdict {
  if (repeatSkews.length === 0) {
    return {
      status: "investigate",
      detail: `no successful repeats to measure skew (tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status})`,
    };
  }
  const usable = repeatSkews.filter((s) => s.medianSkewMs !== null);
  if (usable.length !== repeatSkews.length) {
    return {
      status: "investigate",
      detail: `skew unusable (0 paired beats) on ${repeatSkews.length - usable.length}/${repeatSkews.length} successful repeat(s) — tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status}`,
    };
  }
  const medians = usable.map((s) => s.medianSkewMs!);
  const skewDetail = `medianSkewMs per repeat=[${medians.map((m) => m.toFixed(2)).join(", ")}] maxAbsMedianSkewMs=${Math.max(...medians.map(Math.abs)).toFixed(2)}`;
  const tapesClean = tapeAClass.status !== "investigate" && tapeBClass.status !== "investigate";
  const skewClean = medians.every((m) => Math.abs(m) <= ALIGNED_TOLERANCE_MS);
  if (skewClean && tapesClean) {
    return {
      status: "aligned",
      detail: `skew within ${ALIGNED_TOLERANCE_MS}ms tolerance on every repeat and both tapes individually clean (tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status}) — ${skewDetail}`,
    };
  }
  if (!tapesClean) {
    return {
      status: "investigate",
      detail: `at least one tape's own per-take alignment did not classify clean (tapeA=${tapeAClass.status}: ${tapeAClass.detail}; tapeB=${tapeBClass.status}: ${tapeBClass.detail}) — ${skewDetail}`,
    };
  }
  return {
    status: "investigate",
    detail: `skew exceeds ${ALIGNED_TOLERANCE_MS}ms tolerance with both tapes otherwise clean (candidate finding — no predicted band for inter-track skew) — ${skewDetail}`,
  };
}

interface MultitrackRepeatResult {
  rowA: MultitrackAuditRow;
  rowB: MultitrackAuditRow;
  alignmentA: TakeAlignment;
  alignmentB: TakeAlignment;
  skew: CrossTrackSkew;
  bufferA: CapturedBuffer;
  bufferB: CapturedBuffer;
}

async function runMultitrackCellRepeat(
  project: Project,
  audioContext: AudioContext,
  tapes: MultitrackTapes,
  scenario: MultitrackScenario,
  bpm: number,
  rate: number,
  repeat: number,
  onStage: (stage: string) => void,
  harnessPathBiasSec: number
): Promise<MultitrackRepeatResult> {
  const { unitAdapterA, unitAdapterB } = tapes;

  onStage("prefs");
  project.editing.modify(() => {
    project.timelineBox.bpm.setValue(bpm);
  });
  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;
  settings.recording.allowTakes = true;
  settings.recording.olderTakeAction = "mute-region";
  settings.recording.inputLatency = 0;
  const { loopArea } = project.timelineBox;
  project.editing.modify(() => {
    loopArea.from.setValue(0);
    loopArea.to.setValue(2 * BAR_PPQN);
    loopArea.enabled.setValue(false); // neither multitrack scenario loops
  });

  // One schedule, one injection call — both tapes' loopback streams are
  // clones of the SAME MediaStreamAudioDestinationNode, so both capture the
  // identical click sequence (see loopbackInjection.ts).
  const schedule: ReferenceSchedule = buildReferenceSchedule(audioContext.currentTime + 0.2, 60, 0.25, 0.005);
  loopback.scheduleReferenceClicks(schedule.times);

  let recordRequestContextTime: number | null = null;
  let stopRequestContextTime: number | null = null;

  onStage("start");
  project.engine.setPosition(0);
  await waitForPositionSettled(project, 0, 30_000);
  recordRequestContextTime = audioContext.currentTime;
  if (scenario === "multitrack-janked") {
    const jankArmed = armJankOnRecordingFlip(project, JANK_MS, 30_000);
    project.startRecording(false);
    await jankArmed;
  } else {
    project.startRecording(false);
  }

  onStage("recording");
  // Confirm BOTH tapes' independent RecordingWorklets have actually created
  // their take region before trusting the duration wait — see
  // waitForTakeCount's doc comment for why this must not be skipped here
  // (skipping it would race exactly the inter-track skew this scenario
  // measures).
  await waitForTakeCount([unitAdapterA, unitAdapterB], 1, 20_000);
  await waitForPosition(project, MULTITRACK_RECORD_BARS * BAR_PPQN, 60_000);

  onStage("stopping");
  stopRequestContextTime = audioContext.currentTime;
  project.engine.stopRecording();

  onStage("finalizing");
  const firstTakeOf = (u: AudioUnitBoxAdapter) =>
    u.tracks.values().flatMap((t) => [...t.regions.adapters.values()]).filter((r) => r.isAudioRegion())[0];
  const takeA = firstTakeOf(unitAdapterA);
  const takeB = firstTakeOf(unitAdapterB);
  if (!takeA || !takeB) {
    throw new Error(`no take regions created (tapeA=${takeA ? "ok" : "missing"}, tapeB=${takeB ? "ok" : "missing"})`);
  }
  const loaderA = takeA.file.getOrCreateLoader();
  const loaderB = takeB.file.getOrCreateLoader();
  const finalizeStart = performance.now();
  // Two independent RecordingWorklets -> two independent loaders — the
  // barrier must wait for BOTH, same terminal-state contract per loader as
  // the single-tape finalization above (waitForLoaderTerminal).
  await Promise.all([
    waitForLoaderTerminal(loaderA, FINALIZE_DEADLINE_MS, "finalization tapeA"),
    waitForLoaderTerminal(loaderB, FINALIZE_DEADLINE_MS, "finalization tapeB"),
  ]);
  const finalizeMs = performance.now() - finalizeStart;
  console.log(
    "[recording-alignment-audit] multitrack finalize " + multitrackCellLabel(scenario, bpm, repeat) +
    " took " + finalizeMs.toFixed(0) + "ms (deadline " + FINALIZE_DEADLINE_MS + "ms)"
  );

  onStage("measuring");
  type TakeRegionAdapter = NonNullable<ReturnType<typeof firstTakeOf>>;
  const measureTape = (
    take: TakeRegionAdapter,
    loader: SampleLoader,
    tapeLabel: "a" | "b"
  ): { alignment: TakeAlignment; buffer: CapturedBuffer; row: MultitrackAuditRow } => {
    const dataOpt = loader.data;
    if (dataOpt.isEmpty()) throw new Error(`tape ${tapeLabel}: loader loaded but data empty`);
    const data = dataOpt.unwrap();
    const mono = data.frames[0];
    const { low, high } = bandSplit(mono, data.sampleRate);
    const lowOnsets = detectOnsets(low, data.sampleRate, { refractorySec: 0.1 });
    const highOnsets = detectOnsets(high, data.sampleRate, { refractorySec: 0.05 });
    const regionStartSec = project.tempoMap.ppqnToSeconds(take.position);
    const waveformOffsetSec = take.box.waveformOffset.getValue();
    const regionDurationSec = project.tempoMap.intervalToSeconds(take.position, take.position + take.duration);
    const bufferDurationSec = data.numberOfFrames / data.sampleRate;
    const alignment = measureTakeAlignment({
      lowOnsets, highOnsets, regionStartSec, waveformOffsetSec, regionDurationSec,
      bufferDurationSec, bpm, countInBeats: 0, schedule,
      recordRequestContextTime, stopRequestContextTime,
      headMissingBaselineMs: HEAD_MISSING_BASELINE_MS, harnessPathBiasSec,
    });
    const headMissingRawMs =
      alignment.anchorT0Sec !== null && recordRequestContextTime !== null
        ? Math.max(0, (alignment.anchorT0Sec - recordRequestContextTime) * 1000)
        : null;
    const row: MultitrackAuditRow = {
      scenario, bpm, rate, repeat, tape: tapeLabel,
      medianBeatErrorMs: alignment.medianBeatErrorMs,
      medianBeatErrorMsAdjusted: alignment.medianBeatErrorMsAdjusted,
      matchedBeats: alignment.matchedBeats,
      missingBeats: alignment.missingBeats,
      headMissingMs: alignment.headMissingMs,
      headMissingRawMs,
      tailMissingMs: alignment.tailMissingMs,
      medianSkewMs: null, maxAbsSkewMs: null, pairedSkewBeats: 0, // filled in once both tapes are measured
      status: "pending", detail: "", finalizeMs,
    };
    return { alignment, buffer: { channels: [mono], sampleRate: data.sampleRate }, row };
  };

  const a = measureTape(takeA, loaderA, "a");
  const b = measureTape(takeB, loaderB, "b");
  const skew = measureCrossTrackSkew(a.alignment, b.alignment);
  a.row.medianSkewMs = skew.medianSkewMs;
  a.row.maxAbsSkewMs = skew.maxAbsSkewMs;
  a.row.pairedSkewBeats = skew.pairedBeats;
  b.row.medianSkewMs = skew.medianSkewMs;
  b.row.maxAbsSkewMs = skew.maxAbsSkewMs;
  b.row.pairedSkewBeats = skew.pairedBeats;

  return { rowA: a.row, rowB: b.row, alignmentA: a.alignment, alignmentB: b.alignment, skew, bufferA: a.buffer, bufferB: b.buffer };
}

/** Between-cells reset for the multitrack scenarios — same contract as
 *  resetForNextCell, extended to clear BOTH tapes' take regions/file boxes.
 *  Each tape has its OWN AudioFileBox (each has its own RecordingWorklet/
 *  buffer — unlike loop-wrap's single shared file across takes on ONE
 *  tape), so cleanup runs the same per-tape sequence twice. */
async function resetForNextMultitrackCell(project: Project, tapes: MultitrackTapes): Promise<string | null> {
  loopback.cancelReferenceClicks();
  if (project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue()) {
    project.engine.stopRecording();
  }
  const warnings: string[] = [];
  for (const { label, unitAdapter } of [
    { label: "a" as const, unitAdapter: tapes.unitAdapterA },
    { label: "b" as const, unitAdapter: tapes.unitAdapterB },
  ]) {
    const takeRegions = unitAdapter.tracks
      .values()
      .flatMap((t) => [...t.regions.adapters.values()])
      .filter((r) => r.isAudioRegion());
    if (takeRegions.length === 0) continue;
    const loader = takeRegions[0].file.getOrCreateLoader();
    if (loader.state.type !== "loaded" && loader.state.type !== "error") {
      try {
        await waitForLoaderTerminal(loader, 10_000, `cleanup finalization grace (tape ${label})`);
      } catch (err) {
        const warning = `tape ${label}: finalization grace timed out before deleting take regions: ${String(err)}`;
        warnings.push(warning);
        console.warn(`[recording-alignment-audit] ${warning}`);
      }
    }
    const fileBox = takeRegions[0].file.box;
    project.editing.modify(() => {
      takeRegions.forEach((r) => r.box.delete());
      fileBox.delete();
    });
  }
  project.engine.stop(true);
  project.engine.setPosition(0);
  return warnings.length > 0 ? warnings.join(" | ") : null;
}

/** Upload one tape's WAV for one repeat — non-fatal on failure, matches
 *  uploadRepeatWav's convention. */
async function uploadMultitrackRepeatWav(
  scenario: MultitrackScenario,
  bpm: number,
  rate: number,
  repeat: number,
  tape: "a" | "b",
  buffer: CapturedBuffer
): Promise<void> {
  const wavBuffer = WavFile.encodeInts16({
    sampleRate: buffer.sampleRate,
    length: buffer.channels[0].length,
    numberOfChannels: buffer.channels.length,
    getChannelData: (i: number) => buffer.channels[i],
  });
  const name = `recaudit-mt-${scenario}-${bpmToken(bpm)}-${rate}-r${repeat}-tape${tape}.wav`;
  try {
    await withDeadline(
      (async () => {
        const res = await fetch(`/__verify/${name}`, { method: "PUT", body: wavBuffer });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })(),
      30_000,
      `WAV upload ${name}`
    );
  } catch (err) {
    console.warn(`[recording-alignment-audit] WAV upload failed for ${name}: ${String(err)}`);
  }
}

/** Upload the multitrack JSON summary — rows (both tapes) plus one
 *  cellSkews entry per successful repeat, so the per-repeat CrossTrackSkew
 *  (including its full perBeatSkewMs breakdown) is a committed artifact,
 *  not just what the row columns can show flattened. Throws on failure
 *  (run-level, fatal -> error state), matching uploadSummary. */
async function uploadMultitrackSummary(
  rows: MultitrackAuditRow[],
  rate: number,
  sdkBuildProbe: SdkBuildProbe,
  outputLatency: number,
  baseLatency: number,
  cellSkews: { scenario: MultitrackScenario; bpm: number; repeat: number; skew: CrossTrackSkew }[]
): Promise<void> {
  const timestamp = Date.now();
  const summary = {
    rate, sdkBuildProbe, outputLatency, baseLatency, harnessPathBiasSec: outputLatency,
    headMissingBaselineMs: HEAD_MISSING_BASELINE_MS,
    repeatsPerCell: REPEATS_PER_CELL,
    jankMs: JANK_MS,
    alignedToleranceMs: ALIGNED_TOLERANCE_MS,
    skewToleranceMs: ALIGNED_TOLERANCE_MS,
    referenceSchedule: { count: 60, baseGapSec: 0.25, gapIncrementSec: 0.005 },
    rows,
    cellSkews,
  };
  const jsonBody = JSON.stringify(summary, null, 2);
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/recaudit-mt-summary-${timestamp}.json`, { method: "PUT", body: jsonBody });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "multitrack summary upload"
  );
}

async function runMultitrackAudit(
  setAuditState: (s: string) => void,
  onRow: (row: MultitrackAuditRow) => void,
  onBuildProbe: (probe: SdkBuildProbe) => void
): Promise<void> {
  setAuditState("setup");
  const scenarios = resolveMultitrackScenarios(params.get("scenario"));
  const bpms = resolveMultitrackBpms(params.get("bpm"));
  const rate = resolveRate(params.get("rate"));

  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  const sdkBuildProbe = detectSdkBuildProbe(project.engine);
  onBuildProbe(sdkBuildProbe);
  loopback.attach(audioContext);
  console.log("[recording-alignment-audit] multitrack outputLatency=" + String(audioContext.outputLatency) + " baseLatency=" + String(audioContext.baseLatency));

  const tapes = createMultitrackTapes(project);

  const allRows: MultitrackAuditRow[] = [];
  const cellSkews: { scenario: MultitrackScenario; bpm: number; repeat: number; skew: CrossTrackSkew }[] = [];

  for (const scenario of scenarios) {
    for (const bpm of bpms) {
      const repeats: {
        repeat: number;
        rowA: MultitrackAuditRow;
        rowB: MultitrackAuditRow;
        alignmentA: TakeAlignment;
        alignmentB: TakeAlignment;
        skew: CrossTrackSkew;
        bufferA: CapturedBuffer;
        bufferB: CapturedBuffer;
        cleanupWarning: string | null;
      }[] = [];

      for (let repeat = 1; repeat <= REPEATS_PER_CELL; repeat++) {
        const label = multitrackCellLabel(scenario, bpm, repeat);
        setAuditState(`running:${label}`);
        let stage = "prefs";
        let result: MultitrackRepeatResult | null = null;
        let errorMessage: string | null = null;
        try {
          result = await withDeadline(
            runMultitrackCellRepeat(project, audioContext, tapes, scenario, bpm, rate, repeat, (s) => {
              stage = s;
            }, audioContext.outputLatency),
            120_000,
            label
          );
        } catch (err) {
          errorMessage = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[recording-alignment-audit] multitrack cell ${label} failed: ${errorMessage}`);
        }

        let cleanupWarning: string | null = null;
        try {
          cleanupWarning = await resetForNextMultitrackCell(project, tapes);
        } catch (cleanupErr) {
          cleanupWarning = `cleanup itself threw: ${String(cleanupErr)}`;
          console.warn(`[recording-alignment-audit] multitrack cell ${label} cleanup failed: ${cleanupWarning}`);
        }

        if (result) {
          repeats.push({ repeat, ...result, cleanupWarning });
          cellSkews.push({ scenario, bpm, repeat, skew: result.skew });
        } else {
          const errRow = (tape: "a" | "b"): MultitrackAuditRow => ({
            scenario, bpm, rate, repeat, tape,
            medianBeatErrorMs: null, medianBeatErrorMsAdjusted: null,
            matchedBeats: 0, missingBeats: 0,
            headMissingMs: null, headMissingRawMs: null, tailMissingMs: null,
            medianSkewMs: null, maxAbsSkewMs: null, pairedSkewBeats: 0,
            status: "error",
            detail: cleanupWarning ? `cleanup warning: ${cleanupWarning}` : "",
            errorMessage: errorMessage ?? "unknown error",
          });
          const rowA = errRow("a");
          const rowB = errRow("b");
          allRows.push(rowA, rowB);
          onRow(rowA);
          onRow(rowB);
        }
      }

      const baseScenario = MULTITRACK_BASE_SCENARIO[scenario];
      const tapeAClass: CellClassification =
        repeats.length > 0
          ? classifyCell(repeats.map((r) => r.alignmentA), SIGNATURE_BANDS[baseScenario], ALIGNED_TOLERANCE_MS)
          : { status: "investigate", matchedSignature: null, detail: "no successful repeats to classify (tape a)" };
      const tapeBClass: CellClassification =
        repeats.length > 0
          ? classifyCell(repeats.map((r) => r.alignmentB), SIGNATURE_BANDS[baseScenario], ALIGNED_TOLERANCE_MS)
          : { status: "investigate", matchedSignature: null, detail: "no successful repeats to classify (tape b)" };
      const verdict = classifyMultitrackCell(tapeAClass, tapeBClass, repeats.map((r) => r.skew));

      for (const r of repeats) {
        for (const row of [r.rowA, r.rowB]) {
          row.status = verdict.status;
          row.detail = r.cleanupWarning ? `${verdict.detail} | cleanup warning: ${r.cleanupWarning}` : verdict.detail;
          allRows.push(row);
          onRow(row);
        }
        await uploadMultitrackRepeatWav(scenario, bpm, rate, r.repeat, "a", r.bufferA);
        await uploadMultitrackRepeatWav(scenario, bpm, rate, r.repeat, "b", r.bufferB);
      }
    }
  }

  setAuditState("uploading");
  await uploadMultitrackSummary(allRows, rate, sdkBuildProbe, audioContext.outputLatency, audioContext.baseLatency, cellSkews);
  setAuditState("done");
}

function multitrackStatusColor(status: MultitrackAuditRow["status"]): "green" | "amber" | "red" | "gray" {
  if (status === "aligned") return "green";
  if (status === "matches-known-defect") return "amber";
  if (status === "investigate" || status === "error") return "red";
  return "gray";
}

function MultitrackRunnerHarness() {
  const [auditState, setAuditState] = useState("idle");
  const [rows, setRows] = useState<MultitrackAuditRow[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [buildProbe, setBuildProbe] = useState<SdkBuildProbe>("unknown");

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    setStarted(true);
    setRows([]);
    runMultitrackAudit(
      setAuditState,
      (row) => setRows((prev) => [...prev, row]),
      (probe) => setBuildProbe(probe)
    )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[recording-alignment-audit] multitrack run error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running]);

  const alignedCount = rows.filter((r) => r.status === "aligned").length;
  const investigateCount = rows.filter((r) => r.status === "investigate").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Recording Start-Alignment Audit — Multi-Mic Simultaneous Recording
          </Heading>
          <Text size="1" color="gray" align="center">
            build: {buildProbe}
          </Text>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">
                State:
              </Text>
              <Badge
                id="audit-state"
                data-audit-state={auditState}
                color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}
              >
                {auditState}
              </Badge>
              <Button onClick={handleRun} disabled={running}>
                {started ? "Re-run" : "Run audit"}
              </Button>
              <Text size="2" color="gray">
                {rows.length} row{rows.length === 1 ? "" : "s"} — {alignedCount} aligned, {investigateCount} investigate
                {errorCount > 0 && `, ${errorCount} error`}
              </Text>
            </Flex>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>scenario</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>bpm</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>repeat</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>tape</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>medianErr (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>adjErr (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>matched</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>missing</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>headMiss (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>medianSkew (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>maxAbsSkew (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>pairedBeats</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>status</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row, i) => (
                    <Table.Row key={`${row.scenario}-${bpmToken(row.bpm)}-${row.repeat}-${row.tape}-${i}`}>
                      <Table.Cell>{row.scenario}</Table.Cell>
                      <Table.Cell>{row.bpm}</Table.Cell>
                      <Table.Cell>{row.repeat}</Table.Cell>
                      <Table.Cell>{row.tape}</Table.Cell>
                      <Table.Cell>{row.medianBeatErrorMs === null ? "—" : row.medianBeatErrorMs.toFixed(2)}</Table.Cell>
                      <Table.Cell>{row.medianBeatErrorMsAdjusted === null ? "—" : row.medianBeatErrorMsAdjusted.toFixed(2)}</Table.Cell>
                      <Table.Cell>{row.matchedBeats}</Table.Cell>
                      <Table.Cell>{row.missingBeats}</Table.Cell>
                      <Table.Cell>{row.headMissingMs === null ? "—" : row.headMissingMs.toFixed(2)}</Table.Cell>
                      <Table.Cell>{row.medianSkewMs === null ? "—" : row.medianSkewMs.toFixed(2)}</Table.Cell>
                      <Table.Cell>{row.maxAbsSkewMs === null ? "—" : row.maxAbsSkewMs.toFixed(2)}</Table.Cell>
                      <Table.Cell>{row.pairedSkewBeats}</Table.Cell>
                      <Table.Cell>
                        <Badge color={multitrackStatusColor(row.status)} title={row.errorMessage ?? row.detail}>
                          {row.status}
                        </Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>
              Configuration
            </Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {`?scenario=<multitrack-start|multitrack-janked|multitrack-all>
?bpm=<number|all>     default 120 (matrix spec: bpm 120 only)
?rate=<number>        default 48000 — sets the AudioContext at init, never "all"
Repeats per cell:       ${REPEATS_PER_CELL}
Two tapes armed on loopbackDeviceId(1)/(2) — clones of the SAME loopback signal.
Uploads:                recaudit-mt-summary-<timestamp>.json (all rows + per-repeat skew) via PUT /__verify
                        recaudit-mt-<scenario>-<bpm>-<rate>-r<repeat>-tape<a|b>.wav per repeat
Click "Run audit" with a real click — resumes the AudioContext.`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

const scenarioParam = params.get("scenario");
if (scenarioParam === "probe") {
  createRoot(document.getElementById("root")!).render(<ProbeHarness />);
} else if (scenarioParam === "multitrack-all" || (scenarioParam !== null && isMultitrackScenario(scenarioParam))) {
  createRoot(document.getElementById("root")!).render(<MultitrackRunnerHarness />);
} else {
  createRoot(document.getElementById("root")!).render(<ScenarioRunnerHarness />);
}
