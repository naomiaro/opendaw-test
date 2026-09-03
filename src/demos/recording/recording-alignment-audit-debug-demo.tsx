// src/demos/recording/recording-alignment-audit-debug-demo.tsx
// Unlisted harness for the recording start-alignment audit
// (`.superpowers/sdd/2026-09-01-recording-start-alignment-audit/`).
//
// THREE roots, selected by `?scenario=`:
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
// `&defaultInput=1` (single-tape scenarios) arms the tape on the SDK's DEFAULT
// input — the capture box names no device — instead of naming the synthetic
// loopback device. It is the only configuration in which `CaptureAudio` reuses
// its audio chain across takes rather than rebuilding it before each one, so it
// is how the sweep measures the reuse path. See `DEFAULT_INPUT` below.
//
// `?scenario=multitrack-start|multitrack-janked|multitrack-all&bpm=<n|all>&rate=<n>`
// — the multi-mic simultaneous-recording harness (Task 7b): two tapes armed on
// clones of the same loopback signal, measured for inter-track skew (see the
// section banner further down).
//
// Persisted contract (row/envelope types, schema generations):
// src/lib/audit/recordingAuditArtifacts.ts.
//
// DOM contract (all three roots): #audit-state carries data-audit-state walking
// setup -> running:<cell> -> [uploading ->] done (or error:<message>).
// Probe mode additionally carries #probe-verdict with data-verdict={verdict}.
//
// The engine is booted ONCE per page load (`Workers.install` asserts on a
// second call): each root caches its initialized context, so "Re-run" on the
// matrix/multitrack pages re-runs the matrix on the same project and tape(s)
// under a fresh run token; the probe is one-shot.
import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Flex, Heading, Table, Text, Theme, Container } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { CaptureAudio, type Project } from "@opendaw/studio-core";
import { InstrumentFactories, type AudioUnitBoxAdapter, type SampleLoader } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { WavFile } from "@opendaw/lib-dsp";
import { detectBuildFeatures } from "@/lib/audit/buildFeatures";
import { installLoopbackCapture, LOOPBACK_DEVICE_ID, loopbackDeviceId } from "@/lib/audit/loopbackInjection";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { detectOnsets } from "@/lib/audit/onsetDetection";
import {
  buildReferenceSchedule,
  bandSplit,
  measureTakeAlignment,
  classifyCell,
  measureCrossTrackSkew,
  classifyMultitrackCell,
  type TakeAlignment,
  type CellClassification,
  type ReferenceSchedule,
  type CrossTrackSkew,
} from "@/lib/audit/recordingAlignment";
import {
  RECORDING_AUDIT_BPMS,
  RECORDING_AUDIT_SCENARIOS,
  MULTITRACK_SCENARIOS,
  MULTITRACK_BASE_SCENARIO,
  REPEATS_PER_CELL,
  JANK_MS,
  LOOP_WRAP_TAKES,
  ALIGNED_TOLERANCE_MS,
  HEAD_MISSING_BASELINE_MS,
  signatureBandsFor,
  isRecordingScenario,
  isMultitrackScenario,
  type AuditBuildFeature,
  type RecordingScenario,
  type MultitrackScenario,
} from "@/lib/audit/recordingAuditCalibration";
import {
  AUDIT_SCHEMA_VERSION,
  type AuditRow,
  type AuditSummary,
  type CellVerdictRecord,
  type FinalizeProbe,
  type MultitrackAuditRow,
  type MultitrackAuditSummary,
  type CaptureMode,
  type SdkBuildProbe,
} from "@/lib/audit/recordingAuditArtifacts";
import { BAR_PPQN } from "@/lib/audit/auditExpectations";
// Single-tape per-repeat runner and its waits, shared with the input-latency
// calibration page (src/demos/recording/input-latency-calibration-debug-demo.tsx)
// so both measure and classify a cell exactly the same way.
import {
  FINALIZE_DEADLINE_MS,
  armJankOnRecordingFlip,
  bpmToken,
  cellLabel,
  clearLastFinalizeProbe,
  instrumentFinalize,
  resetForNextCell,
  readFirstQuantumTimeSec,
  resolveHarnessPathBias,
  runCellRepeat,
  runRepeatWithDeadline,
  settleFinalizeProbe,
  takeLastFinalizeProbe,
  assertCurrent,
  waitForLoaderTerminal,
  waitForPosition,
  waitForPositionSettled,
  waitForTakeCount,
  type CapturedBuffer,
  type CellRepeatResult,
  type HarnessPathBias,
  type RepeatToken,
} from "@/lib/audit/recordingCellRunner";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar, type DebugLink } from "@/components/DebugLinkBar";

const params = new URLSearchParams(window.location.search);

/** Campaign register and the upstream outcome, shown on all three roots. */
const AUDIT_LINKS: DebugLink[] = [
  {
    label: "debug/recording-start-alignment-audit.md",
    href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md",
    kind: "note",
  },
  {
    label: "Upstream PR: openDAW#376 (recording start-alignment fix)",
    href: "https://github.com/andremichelle/openDAW/pull/376",
    kind: "note",
  },
  {
    label: "Upstream issue: openDAW#374 (residual start-placement bias)",
    href: "https://github.com/andremichelle/openDAW/issues/374",
    kind: "note",
  },
  {
    label: "Upstream issue: openDAW#375 (simultaneous-take collision)",
    href: "https://github.com/andremichelle/openDAW/issues/375",
    kind: "note",
  },
];
const rate = Number(params.get("rate") ?? "48000");
/** RMS floor above which capture is judged non-silent — see module header. */
const RMS_PASS_THRESHOLD = 0.005;
/** How long to record before stopping (no count-in — startRecording(false)). */
const RECORD_WINDOW_MS = 4000;

// Build probe: identifies which SDK build is live, for A/B runs against an
// alternate dist tree (see SDK_DIST_OVERRIDE in vite.config.ts). A module-surface
// check (e.g. a static import of an internal class) isn't reliable here — the
// capability under test isn't guaranteed to be a class member every build exposes
// the same way — so this probes the LIVE `project.engine` instance returned by
// `initializeOpenDAW()` instead: a fixed build's EngineFacade exposes a
// `recordingStart` observable option (the engine's one-shot audio-thread report of
// where and when the transport began recording); the installed build does not.
// Earlier fix candidates exposed a numeric `syncContextTime` getter instead — that
// marker is retired, so a build carrying only it now reads "upstream". Call once
// init has resolved; "unknown" is reserved for the case where the probe never ran
// at all (init itself failed), never as a steady-state verdict once the engine is
// up. Once the installed SDK ships `recordingStart`, this reads "candidate" on the
// plain server too — re-target the marker at that upgrade.
function detectSdkBuildProbe(engine: unknown): SdkBuildProbe {
  const facade = engine as { recordingStart?: { isEmpty?: unknown } };
  return typeof facade?.recordingStart?.isEmpty === "function" ? "candidate" : "upstream";
}

// Installed at module scope, BEFORE any SDK code can touch mediaDevices.
// deviceCount=2: the single-tape scenarios below only ever use device 1
// (LOOPBACK_DEVICE_ID); the second synthetic device exists for the
// multi-mic scenarios' second tape (see "Multi-mic simultaneous recording"
// section below) — advertising it unconditionally costs nothing for the
// single-tape modes.
/**
 * `?defaultInput=1` — arm the tape on the SDK's DEFAULT input instead of naming
 * the synthetic device: the capture box's `deviceId` is left unset and the
 * loopback serves the resulting unconstrained request (see `serveDefault` in
 * loopbackInjection.ts). That is the only configuration in which
 * `CaptureAudio.#updateStream` can reuse its audio chain across takes, because
 * its reuse test asks whether the BOX names a device; naming one that the
 * synthetic stream does not report back forces a rebuild before every
 * recording. Single-tape scenarios only — the multi-mic ones need two distinct
 * named devices by construction.
 */
const DEFAULT_INPUT = params.get("defaultInput") === "1";
/** Persisted per run so an envelope says which `#updateStream` path it took. */
const CAPTURE_MODE: CaptureMode = DEFAULT_INPUT ? "default" : "named";

const loopback = installLoopbackCapture(2, { serveDefault: DEFAULT_INPUT });

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
  // Same self-terminating wait as the matrix paths (terminal-state pre-check,
  // subscription terminated on resolve, error AND timeout).
  await waitForLoaderTerminal(loader, FINALIZE_DEADLINE_MS, "probe finalization");
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
  // One-shot: the probe boots its own engine (`Workers.install` asserts on a
  // second call) and arms a fresh tape each time — reload to run it again.
  const startedRef = useRef(false);

  const handleRunProbe = useCallback(() => {
    if (running || startedRef.current) return;
    startedRef.current = true;
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
        <DebugLinkBar links={AUDIT_LINKS} />
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
              <Button onClick={handleRunProbe} disabled={running || startedRef.current}>
                {startedRef.current && !running ? "Probe ran — reload to run again" : "Run probe"}
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

// The multi-mic finalize probes of the repeat currently running, so a repeat
// that fails (a hung finalization is exactly the case of interest) still
// persists them on its error rows. The single-tape equivalent lives with the
// shared runner (`takeLastFinalizeProbe` in recordingCellRunner.ts).
let lastMultitrackFinalizeProbes: { a: FinalizeProbe; b: FinalizeProbe } | null = null;

// Row contract: `AuditRow` in recordingAuditArtifacts.ts (every field annotated
// with the fix round / schema generation that introduced it).


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



/** Outcome of one capture-WAV upload: the name the rows should carry and the
 *  failure reason, null on success. */
interface WavUploadResult {
  wavName: string;
  wavUploadError: string | null;
}

/** PUT an encoded WAV to the /__verify sink. Non-fatal on failure — warns and
 *  returns the error so the rows can persist it (a run continues; matches
 *  samplerate-audit's convention). */
async function putWav(name: string, buffer: CapturedBuffer): Promise<WavUploadResult> {
  const wavBuffer = WavFile.encodeInts16({
    sampleRate: buffer.sampleRate,
    length: buffer.channels[0].length,
    numberOfChannels: buffer.channels.length,
    getChannelData: (i: number) => buffer.channels[i],
  });
  try {
    await withDeadline(
      (async () => {
        const res = await fetch(`/__verify/${name}`, { method: "PUT", body: wavBuffer });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })(),
      30_000,
      `WAV upload ${name}`
    );
    return { wavName: name, wavUploadError: null };
  } catch (err) {
    const wavUploadError = err instanceof Error ? err.message : String(err);
    console.warn(`[recording-alignment-audit] WAV upload failed for ${name}: ${wavUploadError}`);
    return { wavName: name, wavUploadError };
  }
}

/** Upload a single repeat's full capture buffer (all takes share it).
 *
 *  Task 7c fix round 1 (review M12/I4): the name carries the build probe and the
 *  run's own token, the convention the multi-mic path already uses. Without them
 *  every run overwrote the previous run's capture of the same cell, so an offline
 *  re-analysis silently read one run's geometry against another run's audio and
 *  no artifact on disk could contradict it. The result is stamped on every row
 *  of the repeat (`wavName`, `wavUploadError`) so "WAV absent" offline can be
 *  told apart from "never uploaded". */
function uploadRepeatWav(
  scenario: RecordingScenario,
  bpm: number,
  rate: number,
  repeat: number,
  buffer: CapturedBuffer,
  sdkBuildProbe: SdkBuildProbe,
  runToken: number
): Promise<WavUploadResult> {
  return putWav(`recaudit-${scenario}-${bpmToken(bpm)}-${rate}-r${repeat}-${sdkBuildProbe}-${runToken}.wav`, buffer);
}

function stampWavResult(rows: { wavName?: string; wavUploadError?: string | null }[], result: WavUploadResult): void {
  for (const row of rows) {
    row.wavName = result.wavName;
    row.wavUploadError = result.wavUploadError;
  }
}

/** Upload the JSON summary. Throws on failure (run-level, fatal -> error state). */
async function uploadSummary(
  rows: AuditRow[],
  rate: number,
  sdkBuildProbe: SdkBuildProbe,
  buildFeatures: AuditBuildFeature[],
  bias: HarnessPathBias,
  baseLatency: number,
  cellVerdicts: CellVerdictRecord[],
  wavUploadFailures: number,
  runToken: number
): Promise<void> {
  const summary: AuditSummary = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    beatGrid: "absolute",
    rate,
    sdkBuildProbe,
    buildFeatures,
    captureMode: CAPTURE_MODE,
    getUserMediaOpens: loopback.getUserMediaOpens(),
    // Fix round 1 (C3/I3): persisted so the loopback-path-bias decomposition
    // doesn't depend on console output. Read once per page load by
    // `resolveHarnessPathBias`, after output started — the same number every
    // row of this run was adjusted with.
    outputLatency: bias.valueSec,
    baseLatency,
    harnessPathBiasSec: bias.valueSec,
    harnessPathBiasSettleMs: bias.settleMs,
    headMissingBaselineMs: HEAD_MISSING_BASELINE_MS,
    repeatsPerCell: REPEATS_PER_CELL,
    jankMs: JANK_MS,
    loopWrapTakes: LOOP_WRAP_TAKES,
    alignedToleranceMs: ALIGNED_TOLERANCE_MS,
    referenceSchedule: { count: 120, baseGapSec: 0.25, gapIncrementSec: 0.005 },
    wavUploadFailures,
    // One record per attempted cell, all-error cells included — the only place
    // such a cell's verdict exists.
    cellVerdicts,
    rows,
  };
  const jsonBody = JSON.stringify(summary, null, 2);
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/recaudit-summary-${runToken}.json`, { method: "PUT", body: jsonBody });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "summary upload"
  );
}

/** Everything a matrix run needs that is created ONCE per page load: the booted
 *  engine, the single armed tape, the build probe and the harness-path bias. */
interface MatrixContext {
  project: Project;
  audioContext: AudioContext;
  unitAdapter: AudioUnitBoxAdapter;
  sdkBuildProbe: SdkBuildProbe;
  /** Which SDK surfaces this build exposes — persisted so the offline classifier
   *  can pick the band profile from what the build does, not when it ran. */
  buildFeatures: AuditBuildFeature[];
  bias: HarnessPathBias;
}

async function createMatrixContext(rate: number): Promise<MatrixContext> {
  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  const sdkBuildProbe = detectSdkBuildProbe(project.engine);
  const buildFeatures = detectBuildFeatures(project.engine);
  console.log("[recording-alignment-audit] buildFeatures=[" + buildFeatures.join(",") + "]");
  loopback.attach(audioContext);
  const bias = await resolveHarnessPathBias(audioContext);

  // ONE tape, created once, reused across every cell (and every re-run).
  let audioUnitBox: AudioUnitBox | null = null;
  project.editing.modify(() => {
    audioUnitBox = project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox;
  });
  if (audioUnitBox === null) throw new Error("createInstrument did not return audioUnitBox");
  const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
  if (!(capture instanceof CaptureAudio)) throw new Error("capture is not CaptureAudio");
  project.editing.modify(() => {
    // `defaultInput` leaves the box's deviceId unset — see DEFAULT_INPUT.
    if (!DEFAULT_INPUT) capture.captureBox.deviceId.setValue(LOOPBACK_DEVICE_ID);
    capture.requestChannels = 1;
  });
  capture.armed.setValue(true);
  console.log("[recording-alignment-audit] tape armed, defaultInput=" + String(DEFAULT_INPUT));

  const unitAdapter = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBox);
  if (!unitAdapter) throw new Error("no audio unit adapter for tape");
  return { project, audioContext, unitAdapter, sdkBuildProbe, buildFeatures, bias };
}

// Booted once per page load: `initializeOpenDAW` → `Workers.install` asserts
// "Workers are already installed" on a second call, so "Re-run" reuses this
// context (a failed boot stays failed — reload the page).
let matrixContextPromise: Promise<MatrixContext> | null = null;
function getMatrixContext(rate: number): Promise<MatrixContext> {
  if (matrixContextPromise === null) matrixContextPromise = createMatrixContext(rate);
  return matrixContextPromise;
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
  // One token per run, stamped into BOTH the summary name and every capture
  // WAV name, so a summary row and the audio it was measured from can always be
  // joined without guessing (Task 7c fix round 1, review M12).
  const runToken = Date.now();

  const { project, audioContext, unitAdapter, sdkBuildProbe, buildFeatures, bias } = await getMatrixContext(rate);
  onBuildProbe(sdkBuildProbe);

  const allRows: AuditRow[] = [];
  const cellVerdicts: CellVerdictRecord[] = [];
  let wavUploadFailures = 0;

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
        clearLastFinalizeProbe();
        try {
          result = await runRepeatWithDeadline(
            (token) => runCellRepeat({
              project, audioContext, loopback, unitAdapter, scenario, bpm, rate, repeat,
              onStage: (s) => { stage = s; },
              harnessPathBiasSec: bias.valueSec,
              token,
            }),
            // Outer deadline ABOVE the inner stages' worst-case sum, so the
            // stage that is actually slow is the one that names itself:
            // loop-wrap 30 (settle) + 90 (take count) + 30 (finalize) = 150 s;
            // janked-start 30 + 30 (jank arm) + 60 (position) + 30 = 150 s;
            // midtimeline 30 + 20 + 60 + 30 = 140 s. 180 s keeps 30 s of margin.
            // Should it still fire first, the token makes the abandoned repeat
            // inert (see `runRepeatWithDeadline`).
            180_000,
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
          cleanupWarning = await resetForNextCell(project, loopback, unitAdapter);
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
            ...(takeLastFinalizeProbe() ?? {}),
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

      // classifyCell itself returns "investigate" for an empty repeat list; the
      // explicit detail here names the reason (every repeat errored).
      const classification: CellClassification =
        alignmentsForClassification.length > 0
          ? classifyCell(alignmentsForClassification, signatureBandsFor(scenario, sdkBuildProbe, runToken, buildFeatures), ALIGNED_TOLERANCE_MS)
          : { status: "investigate", matchedSignature: null, detail: "no successful repeats to classify" };
      // Persisted for EVERY cell, so an all-error cell's verdict exists on disk
      // (rows only carry the verdict of successful repeats).
      cellVerdicts.push({
        scenario, bpm, rate,
        status: classification.status,
        matchedSignature: classification.matchedSignature,
        detail: classification.detail,
        successfulRepeats: repeats.length,
        errorRepeats: REPEATS_PER_CELL - repeats.length,
      });

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
        }
        const wav = await uploadRepeatWav(scenario, bpm, rate, r.repeat, r.buffer, sdkBuildProbe, runToken);
        if (wav.wavUploadError !== null) wavUploadFailures++;
        stampWavResult(r.rows, wav);
        for (const row of r.rows) {
          allRows.push(row);
          onRow(row);
        }
      }
    }
  }

  setAuditState("uploading");
  await uploadSummary(allRows, rate, sdkBuildProbe, buildFeatures, bias, audioContext.baseLatency, cellVerdicts, wavUploadFailures, runToken);
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
        <DebugLinkBar links={AUDIT_LINKS} />
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
?defaultInput=1       arm on the SDK's default input (the box names no device), the
                      only configuration in which one audio chain serves every take
Repeats per cell:       ${REPEATS_PER_CELL}
Uploads:                recaudit-summary-<runToken>.json (all rows) via PUT /__verify
                        recaudit-<scenario>-<bpm>-<rate>-r<repeat>-<build>-<runToken>.wav per repeat
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

const ALL_MULTITRACK_SCENARIOS = [...MULTITRACK_SCENARIOS];
const MULTITRACK_RECORD_BARS = 4; // matches nominal-start/janked-start's own 4-bar window

// `MULTITRACK_BASE_SCENARIO` (recordingAuditCalibration.ts) reuses the
// equivalent single-tape scenario's SIGNATURE_BANDS to judge "did each tape
// individually place its take the way a single-tape recording of the same
// provocation would?" — multitrack-start mirrors nominal-start's no-jank/
// no-count-in provocation, multitrack-janked mirrors janked-start's
// busy-loop-on-flip provocation (armJankOnRecordingFlip, reused unchanged —
// isRecording is engine-wide, so one jank jams BOTH captures' post-flip
// handling at once).

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

// Row contract: `MultitrackAuditRow` in recordingAuditArtifacts.ts. The
// cross-track skew fields are repeated on BOTH tapes' rows for the same repeat
// so every single-tape column stays meaningful side by side with them; the
// per-tape geometry is persisted (Task 7c fix round 1, Ruling B) because
// `measureCrossTrackSkew` pairs by ABSOLUTE beat index, so a skew carries the
// two tapes' region-position difference and that is only checkable from disk
// with the geometry beside it; `anchorT0Sec`/`recordRequestContextTime` per
// tape (Task 9) make each capture's loopback delay recoverable, which is what
// separates an SDK-side inter-track skew from a difference between the two
// loopback streams' delays.

interface MultitrackTapes {
  audioUnitBoxA: AudioUnitBox;
  audioUnitBoxB: AudioUnitBox;
  unitAdapterA: AudioUnitBoxAdapter;
  unitAdapterB: AudioUnitBoxAdapter;
}

/**
 * Create two Tape instruments, one per loopback device — mirrors runAudit's
 * single-tape setup, capture field writes in a SEPARATE transaction from
 * createInstrument per CLAUDE.md's "Pointer Re-Routing" rule.
 *
 * Fix round 1 (C1 confirmation): `sameDeviceB`, when true, arms tape B on
 * `loopbackDeviceId(1)` too — the SAME device as tape A, not `(2)` — so both
 * captures are driven by literally the same `getUserMedia` deviceId. Used
 * ONLY by the dedicated `AudioFileBox`-collision confirmation cell (see
 * `?confirmCollision=1` in `runMultitrackAudit`); the official matrix always
 * uses two distinct devices (default `sameDeviceB=false`).
 */
function createMultitrackTapes(project: Project, sameDeviceB: boolean = false): MultitrackTapes {
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
    captureB.captureBox.deviceId.setValue(loopbackDeviceId(sameDeviceB ? 1 : 2));
    captureB.requestChannels = 1;
  });
  captureA.armed.setValue(true);
  captureB.armed.setValue(true);

  const unitAdapterA = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBoxA);
  const unitAdapterB = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBoxB);
  if (!unitAdapterA || !unitAdapterB) throw new Error("createMultitrackTapes: missing audio unit adapter");
  return { audioUnitBoxA, audioUnitBoxB, unitAdapterA, unitAdapterB };
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
  harnessPathBiasSec: number,
  token: RepeatToken
): Promise<MultitrackRepeatResult> {
  const { unitAdapterA, unitAdapterB } = tapes;

  // Fix round 1 (I3): assert both tapes start this repeat with ZERO take
  // regions. `firstTakeOf` (below, at measurement time) takes the FIRST
  // audio region found on each adapter with no way to tell a fresh region
  // from a stale one a prior repeat's cleanup failed to delete (e.g. the
  // documented "finalization grace timed out before deleting take regions"
  // warning path in resetForNextMultitrackCell) — a leftover region would
  // silently be measured as THIS repeat's take instead. Fail loudly instead.
  const countAudioRegions = (u: AudioUnitBoxAdapter) =>
    u.tracks.values().flatMap((t) => [...t.regions.adapters.values()]).filter((r) => r.isAudioRegion()).length;
  const staleA = countAudioRegions(unitAdapterA);
  const staleB = countAudioRegions(unitAdapterB);
  if (staleA > 0 || staleB > 0) {
    throw new Error(`runMultitrackCellRepeat: expected 0 take regions at repeat start, found tapeA=${staleA} tapeB=${staleB} (prior repeat's cleanup did not fully complete)`);
  }

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
  assertCurrent(token, "startRecording");
  recordRequestContextTime = audioContext.currentTime;
  if (scenario === "multitrack-janked") {
    const jankArmed = armJankOnRecordingFlip(project, JANK_MS, 30_000);
    project.startRecording(false);
    await jankArmed;
  } else {
    project.startRecording(false);
  }

  onStage("recording");
  assertCurrent(token, "recording wait");
  // Confirm BOTH tapes' independent RecordingWorklets have actually created
  // their take region before trusting the duration wait — see
  // waitForTakeCount's doc comment for why this must not be skipped here
  // (skipping it would race exactly the inter-track skew this scenario
  // measures).
  await waitForTakeCount([unitAdapterA, unitAdapterB], 1, 20_000);
  assertCurrent(token, "position wait");
  await waitForPosition(project, MULTITRACK_RECORD_BARS * BAR_PPQN, 60_000);

  onStage("stopping");
  // Side effects below (loader patches, lastMultitrackFinalizeProbes,
  // stopRecording) must never run for an abandoned repeat.
  assertCurrent(token, "stopping");
  const firstTakeOf = (u: AudioUnitBoxAdapter) =>
    u.tracks.values().flatMap((t) => [...t.regions.adapters.values()]).filter((r) => r.isAudioRegion())[0];
  const takeA = firstTakeOf(unitAdapterA);
  const takeB = firstTakeOf(unitAdapterB);
  if (!takeA || !takeB) {
    throw new Error(`no take regions created (tapeA=${takeA ? "ok" : "missing"}, tapeB=${takeB ? "ok" : "missing"})`);
  }
  // Loaders looked up BEFORE the stop so both finalization probes are armed
  // before the SDK's stop path can call limit() (see instrumentFinalize).
  const loaderA = takeA.file.getOrCreateLoader();
  const loaderB = takeB.file.getOrCreateLoader();
  const probeA = instrumentFinalize(loaderA);
  const probeB = instrumentFinalize(loaderB);
  lastMultitrackFinalizeProbes = { a: probeA, b: probeB };
  probeA.finalizeNumberOfFramesAtStop = (loaderA as unknown as { numberOfFrames?: number }).numberOfFrames;
  probeB.finalizeNumberOfFramesAtStop = (loaderB as unknown as { numberOfFrames?: number }).numberOfFrames;
  stopRequestContextTime = audioContext.currentTime;
  project.engine.stopRecording();

  onStage("finalizing");
  const finalizeStart = performance.now();
  // Two independent RecordingWorklets -> two independent loaders — the
  // barrier must wait for BOTH, same terminal-state contract per loader as
  // the single-tape finalization above (waitForLoaderTerminal).
  try {
    await Promise.all([
      waitForLoaderTerminal(loaderA, FINALIZE_DEADLINE_MS, "finalization tapeA"),
      waitForLoaderTerminal(loaderB, FINALIZE_DEADLINE_MS, "finalization tapeB"),
    ]);
  } finally {
    settleFinalizeProbe(probeA, loaderA);
    settleFinalizeProbe(probeB, loaderB);
  }
  assertCurrent(token, "measuring");
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
      bufferDurationSec, bpm, schedule,
      recordRequestContextTime, stopRequestContextTime,
      headMissingBaselineMs: HEAD_MISSING_BASELINE_MS, harnessPathBiasSec,
    });
    if (alignment.anchorT0Sec === null) {
      console.warn("[recording-alignment-audit] " + multitrackCellLabel(scenario, bpm, repeat) + "/tape" + tapeLabel + ": no reference-click anchor — head/tail integrity unmeasured for this tape");
    }
    const headMissingRawMs =
      alignment.anchorT0Sec !== null && recordRequestContextTime !== null
        ? Math.max(0, (alignment.anchorT0Sec - recordRequestContextTime) * 1000)
        : null;
    const row: MultitrackAuditRow = {
      scenario, bpm, rate, repeat, tape: tapeLabel,
      harnessPathBiasSec,
      medianBeatErrorMs: alignment.medianBeatErrorMs,
      medianBeatErrorMsAdjusted: alignment.medianBeatErrorMsAdjusted,
      matchedBeats: alignment.matchedBeats,
      missingBeats: alignment.missingBeats,
      headMissingMs: alignment.headMissingMs,
      headMissingRawMs,
      tailMissingMs: alignment.tailMissingMs,
      medianSkewMs: null, maxAbsSkewMs: null, pairedSkewBeats: 0, // filled in once both tapes are measured
      regionPositionPpqn: take.position,
      regionStartSec,
      waveformOffsetSec,
      regionDurationSec,
      bufferDurationSec,
      status: "pending", detail: "", finalizeMs,
      firstQuantumTimeSec: readFirstQuantumTimeSec(loader),
      anchorT0Sec: alignment.anchorT0Sec,
      recordRequestContextTime,
      ...(tapeLabel === "a" ? probeA : probeB),
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

/**
 * Upload one tape's WAV for one repeat — non-fatal on failure, matches
 * uploadRepeatWav's convention; the result is stamped on that tape's row.
 *
 * Fix round 1 (M6): the WAV filename carries a `runToken` (the run's own
 * `Date.now()`, shared with its summary JSON's filename — see
 * `runMultitrackAudit`) and `sdkBuildProbe`. Without either, re-running the
 * SAME scenario/bpm/rate/repeat cell — which this task's session did
 * repeatedly, across BOTH builds and a later restore-verification smoke —
 * silently overwrites an earlier run's saved audio under the identical
 * name; the disambiguated name makes every WAV on disk traceable to the
 * summary JSON that produced it instead.
 */
function uploadMultitrackRepeatWav(
  scenario: MultitrackScenario,
  bpm: number,
  rate: number,
  repeat: number,
  tape: "a" | "b",
  buffer: CapturedBuffer,
  sdkBuildProbe: SdkBuildProbe,
  runToken: number
): Promise<WavUploadResult> {
  return putWav(`recaudit-mt-${scenario}-${bpmToken(bpm)}-${rate}-r${repeat}-tape${tape}-${sdkBuildProbe}-${runToken}.wav`, buffer);
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
  buildFeatures: AuditBuildFeature[],
  bias: HarnessPathBias,
  baseLatency: number,
  cellSkews: { scenario: MultitrackScenario; bpm: number; repeat: number; skew: CrossTrackSkew }[],
  cellVerdicts: CellVerdictRecord[],
  wavUploadFailures: number,
  runToken: number,
  confirmCollision: boolean
): Promise<void> {
  const summary: MultitrackAuditSummary = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    beatGrid: "absolute",
    rate, sdkBuildProbe, buildFeatures,
    captureMode: CAPTURE_MODE,
    getUserMediaOpens: loopback.getUserMediaOpens(),
    // Read once per page load after output started (`resolveHarnessPathBias`)
    // — the value every row of this run was adjusted with.
    outputLatency: bias.valueSec, baseLatency,
    harnessPathBiasSec: bias.valueSec, harnessPathBiasSettleMs: bias.settleMs,
    headMissingBaselineMs: HEAD_MISSING_BASELINE_MS,
    repeatsPerCell: REPEATS_PER_CELL,
    jankMs: JANK_MS,
    alignedToleranceMs: ALIGNED_TOLERANCE_MS,
    skewToleranceMs: ALIGNED_TOLERANCE_MS,
    referenceSchedule: { count: 60, baseGapSec: 0.25, gapIncrementSec: 0.005 },
    // Fix round 1 (C1 confirmation): when true, tape B was armed on the SAME
    // loopbackDeviceId as tape A (see createMultitrackTapes's sameDeviceB) —
    // this run is the dedicated collision-confirmation cell, not part of the
    // official matrix. false on every official-matrix run.
    confirmCollision,
    wavUploadFailures,
    cellVerdicts,
    rows,
    cellSkews,
  };
  const jsonBody = JSON.stringify(summary, null, 2);
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/recaudit-mt-summary-${runToken}.json`, { method: "PUT", body: jsonBody });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "multitrack summary upload"
  );
}

/** The multi-mic page's once-per-page-load context — same contract as
 *  `MatrixContext`, with two tapes. */
interface MultitrackContext {
  project: Project;
  audioContext: AudioContext;
  tapes: MultitrackTapes;
  sdkBuildProbe: SdkBuildProbe;
  /** Which SDK surfaces this build exposes — persisted so the offline classifier
   *  can pick the band profile from what the build does, not when it ran. */
  buildFeatures: AuditBuildFeature[];
  bias: HarnessPathBias;
}

async function createMultitrackContext(rate: number, confirmCollision: boolean): Promise<MultitrackContext> {
  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  const sdkBuildProbe = detectSdkBuildProbe(project.engine);
  const buildFeatures = detectBuildFeatures(project.engine);
  console.log("[recording-alignment-audit] buildFeatures=[" + buildFeatures.join(",") + "]");
  loopback.attach(audioContext);
  const bias = await resolveHarnessPathBias(audioContext);
  const tapes = createMultitrackTapes(project, confirmCollision);
  return { project, audioContext, tapes, sdkBuildProbe, buildFeatures, bias };
}

let multitrackContextPromise: Promise<MultitrackContext> | null = null;
function getMultitrackContext(rate: number, confirmCollision: boolean): Promise<MultitrackContext> {
  if (multitrackContextPromise === null) multitrackContextPromise = createMultitrackContext(rate, confirmCollision);
  return multitrackContextPromise;
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
  // Fix round 1 (C1 confirmation): `?confirmCollision=1` arms tape B on the
  // SAME loopback device as tape A (see createMultitrackTapes's
  // `sameDeviceB`) — a dedicated, deliberately-abnormal cell that tests
  // whether two simultaneous takes of BYTE-IDENTICAL audio always collide
  // on `AudioFileBox`'s content-derived uuid (Finding 1's corrected
  // mechanism), as opposed to the official matrix's two distinct devices
  // (whose captures differ slightly in length/timing and only SOMETIMES
  // produce identical bytes). Combine with `?scenario=multitrack-start` —
  // this flag changes tape wiring only, not the scenario/provocation logic.
  const confirmCollision = params.get("confirmCollision") === "1";
  // Fix round 1 (M6): shared by every WAV this run uploads AND the summary
  // JSON's own filename, so a WAV on disk is always traceable to the exact
  // summary that produced it, even after this cell/scenario/bpm/rate/repeat
  // combination is re-run under a different build later in the same session.
  const runToken = Date.now();

  const { project, audioContext, tapes, sdkBuildProbe, buildFeatures, bias } = await getMultitrackContext(rate, confirmCollision);
  onBuildProbe(sdkBuildProbe);
  console.log("[recording-alignment-audit] multitrack confirmCollision=" + String(confirmCollision));

  const allRows: MultitrackAuditRow[] = [];
  const cellSkews: { scenario: MultitrackScenario; bpm: number; repeat: number; skew: CrossTrackSkew }[] = [];
  const cellVerdicts: CellVerdictRecord[] = [];
  let wavUploadFailures = 0;

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
        lastMultitrackFinalizeProbes = null;
        try {
          result = await runRepeatWithDeadline(
            (token) => runMultitrackCellRepeat(project, audioContext, tapes, scenario, bpm, rate, repeat, (s) => {
              stage = s;
            }, bias.valueSec, token),
            // Fix round 1 (M5): the outer deadline must sit ABOVE the inner
            // waits' worst-case sum, or an unlucky repeat where several stages
            // each run close to their own max produces a generic "label timed
            // out" that masks which stage was slow (each inner helper names
            // its own). Worst case: waitForPositionSettled 30 s +
            // armJankOnRecordingFlip 30 s (janked only) + waitForTakeCount
            // 20 s + waitForPosition 60 s + the finalization Promise.all's
            // longer side 30 s = 170 s. 200 s keeps 30 s of margin; the token
            // makes an abandoned repeat inert should it still fire first.
            200_000,
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
            ...(lastMultitrackFinalizeProbes ? lastMultitrackFinalizeProbes[tape] : {}),
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
          ? classifyCell(repeats.map((r) => r.alignmentA), signatureBandsFor(baseScenario, sdkBuildProbe, runToken, buildFeatures), ALIGNED_TOLERANCE_MS)
          : { status: "investigate", matchedSignature: null, detail: "no successful repeats to classify (tape a)" };
      const tapeBClass: CellClassification =
        repeats.length > 0
          ? classifyCell(repeats.map((r) => r.alignmentB), signatureBandsFor(baseScenario, sdkBuildProbe, runToken, buildFeatures), ALIGNED_TOLERANCE_MS)
          : { status: "investigate", matchedSignature: null, detail: "no successful repeats to classify (tape b)" };
      const verdict = classifyMultitrackCell(tapeAClass, tapeBClass, repeats.map((r) => r.skew), ALIGNED_TOLERANCE_MS);
      // Persisted for EVERY cell, all-error cells included (no skew signature
      // band exists, so matchedSignature is always null here).
      cellVerdicts.push({
        scenario, bpm, rate, status: verdict.status, matchedSignature: null, detail: verdict.detail,
        successfulRepeats: repeats.length, errorRepeats: REPEATS_PER_CELL - repeats.length,
      });

      for (const r of repeats) {
        for (const row of [r.rowA, r.rowB]) {
          row.status = verdict.status;
          row.detail = r.cleanupWarning ? `${verdict.detail} | cleanup warning: ${r.cleanupWarning}` : verdict.detail;
        }
        const wavA = await uploadMultitrackRepeatWav(scenario, bpm, rate, r.repeat, "a", r.bufferA, sdkBuildProbe, runToken);
        const wavB = await uploadMultitrackRepeatWav(scenario, bpm, rate, r.repeat, "b", r.bufferB, sdkBuildProbe, runToken);
        if (wavA.wavUploadError !== null) wavUploadFailures++;
        if (wavB.wavUploadError !== null) wavUploadFailures++;
        stampWavResult([r.rowA], wavA);
        stampWavResult([r.rowB], wavB);
        for (const row of [r.rowA, r.rowB]) {
          allRows.push(row);
          onRow(row);
        }
      }
    }
  }

  setAuditState("uploading");
  await uploadMultitrackSummary(allRows, rate, sdkBuildProbe, buildFeatures, bias, audioContext.baseLatency, cellSkews, cellVerdicts, wavUploadFailures, runToken, confirmCollision);
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
        <DebugLinkBar links={AUDIT_LINKS} />
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
Uploads:                recaudit-mt-summary-<runToken>.json (all rows + per-repeat skew) via PUT /__verify
                        recaudit-mt-<scenario>-<bpm>-<rate>-r<repeat>-tape<a|b>-<build>-<runToken>.wav per repeat
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
