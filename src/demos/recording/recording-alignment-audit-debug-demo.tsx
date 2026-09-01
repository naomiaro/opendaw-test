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
import { InstrumentFactories, type AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { WavFile } from "@opendaw/lib-dsp";
import { Terminable } from "@opendaw/lib-std";
import { installLoopbackCapture, LOOPBACK_DEVICE_ID } from "@/lib/audit/loopbackInjection";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { detectOnsets } from "@/lib/audit/onsetDetection";
import {
  buildReferenceSchedule,
  bandSplit,
  measureTakeAlignment,
  classifyCell,
  type TakeAlignment,
  type CellClassification,
  type CellStatus,
  type ReferenceSchedule,
} from "@/lib/audit/recordingAlignment";
import {
  RECORDING_AUDIT_BPMS,
  RECORDING_AUDIT_SCENARIOS,
  REPEATS_PER_CELL,
  JANK_MS,
  LOOP_WRAP_TAKES,
  ALIGNED_TOLERANCE_MS,
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

// Installed at module scope, BEFORE any SDK code can touch mediaDevices.
const loopback = installLoopbackCapture();

type ProbeRow = { label: string; value: string };

async function runProbe(onRow: (row: ProbeRow) => void): Promise<string> {
  console.log("[recording-alignment-audit] probe: booting engine, rate=" + rate);
  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  loopback.attach(audioContext);
  onRow({ label: "context rate", value: String(audioContext.sampleRate) });

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

  const handleRunProbe = useCallback(() => {
    if (running) return;
    setRunning(true);
    setRows([]);
    setVerdict(null);
    setAuditState("setup");
    setAuditState("running:probe");
    runProbe((row) => setRows((prev) => [...prev, row]))
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
  matchedBeats: number;
  missingBeats: number;
  headMissingMs: number | null;
  status: CellStatus | "pending" | "error";
  matchedSignature: string | null;
  detail: string;
  errorMessage?: string;
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

/** Resolves once the tape's tracks hold >= targetCount audio take regions —
 *  used by loop-wrap to detect the 5th wrap (LOOP_WRAP_TAKES + 1 regions:
 *  the 5 finalized takes plus the in-progress 6th). */
function waitForTakeCount(unitAdapter: AudioUnitBoxAdapter, targetCount: number, deadlineMs: number): Promise<void> {
  return withDeadline(
    new Promise<void>((resolve) => {
      const subs: Terminable[] = [];
      const countRegions = () =>
        unitAdapter.tracks
          .values()
          .flatMap((t) => [...t.regions.adapters.values()])
          .filter((r) => r.isAudioRegion()).length;
      const checkAndMaybeResolve = () => {
        if (countRegions() >= targetCount) {
          subs.forEach((s) => s.terminate());
          resolve();
        }
      };
      for (const track of unitAdapter.tracks.values()) {
        subs.push(
          track.regions.catchupAndSubscribe({
            onAdded: checkAndMaybeResolve,
            onRemoved: () => {},
          })
        );
      }
    }),
    deadlineMs,
    `waitForTakeCount(${targetCount})`
  );
}

/**
 * Common per-repeat sequence (task-4-brief.md Steps 2-5): set bpm/prefs,
 * schedule reference clicks, run the scenario-specific start, wait for the
 * scenario-specific stop condition, wait for finalization, then measure
 * every take region against the beat grid + reference schedule.
 *
 * Does NOT clean up take regions — that is the outer cell loop's job (runs
 * unconditionally, success or failure, so a mid-recording error never
 * leaves stale regions for the next repeat).
 */
async function runCellRepeat(
  project: Project,
  audioContext: AudioContext,
  unitAdapter: AudioUnitBoxAdapter,
  scenario: RecordingScenario,
  bpm: number,
  rate: number,
  repeat: number,
  onStage: (stage: string) => void
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
      project.startRecording(false);
      // Block the main thread THROUGH the first isRecording observation window.
      const until = performance.now() + JANK_MS;
      while (performance.now() < until) {
        /* spin */
      }
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
    await waitForTakeCount(unitAdapter, LOOP_WRAP_TAKES + 1, 90_000);
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
  if (loader.state.type !== "loaded") {
    await withDeadline(
      new Promise<void>((resolvePromise, reject) => {
        let subscribed = false;
        const sub = loader.subscribe((state) => {
          if (state.type === "loaded") {
            resolvePromise();
            if (subscribed) sub.terminate();
          }
          if (state.type === "error") {
            reject(new Error(String(state.reason)));
            if (subscribed) sub.terminate();
          }
        });
        subscribed = true;
      }),
      30_000,
      "finalization"
    );
  }

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

  const rows: AuditRow[] = [];
  const alignments: { takeIndex: number; alignment: TakeAlignment }[] = [];
  for (const [takeIndex, region] of takeRegions.entries()) {
    const regionStartSec = project.tempoMap.ppqnToSeconds(region.position);
    const waveformOffsetSec = region.box.waveformOffset.getValue();
    const regionDurationSec = project.tempoMap.intervalToSeconds(region.position, region.position + region.duration);
    const alignment = measureTakeAlignment({
      lowOnsets,
      highOnsets,
      regionStartSec,
      waveformOffsetSec,
      regionDurationSec,
      bufferDurationSec: data.numberOfFrames / data.sampleRate,
      bpm,
      countInBeats: usedCountIn ? 4 : 0,
      schedule,
      recordRequestContextTime,
      stopRequestContextTime,
    });
    alignments.push({ takeIndex, alignment });
    rows.push({
      scenario,
      bpm,
      rate,
      repeat,
      takeIndex,
      medianBeatErrorMs: alignment.medianBeatErrorMs,
      matchedBeats: alignment.matchedBeats,
      missingBeats: alignment.missingBeats,
      headMissingMs: alignment.headMissingMs,
      status: "pending",
      matchedSignature: null,
      detail: "",
    });
  }

  return { rows, alignments, buffer: { channels: [mono], sampleRate: data.sampleRate } };
}

/**
 * Between-cells reset (task-4-brief.md Step 1): stop any lingering
 * recording state, delete every take region on the tape's tracks AND the
 * shared AudioFileBox they point at (`region.box.delete()` cascade-deletes
 * the region's OWN mandatory dependents, but the file is an outgoing
 * pointer the region merely refers to — the SDK's own `restartRecording()`
 * cleanup path deletes regions the same way and leaves the file box
 * orphaned, verified by reading Project.js — so it must be deleted here
 * explicitly), then reset position. Runs unconditionally (success or
 * failure) so a mid-recording error never leaves stale regions for the
 * next repeat/cell.
 */
function resetForNextCell(project: Project, unitAdapter: AudioUnitBoxAdapter): void {
  if (project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue()) {
    project.engine.stopRecording();
  }
  const takeRegions = unitAdapter.tracks
    .values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion());
  if (takeRegions.length > 0) {
    const fileBox = takeRegions[0].file.box;
    project.editing.modify(() => {
      takeRegions.forEach((r) => r.box.delete());
      fileBox.delete();
    });
  }
  project.engine.stop(true);
  project.engine.setPosition(0);
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
async function uploadSummary(rows: AuditRow[], rate: number): Promise<void> {
  const timestamp = Date.now();
  const summary = {
    rate,
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

async function runAudit(setAuditState: (s: string) => void, onRow: (row: AuditRow) => void): Promise<void> {
  setAuditState("setup");
  const scenarios = resolveScenarios(params.get("scenario"));
  const bpms = resolveBpms(params.get("bpm"));
  const rate = resolveRate(params.get("rate"));

  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  loopback.attach(audioContext);

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
      const repeats: { repeat: number; rows: AuditRow[]; alignments: CellRepeatResult["alignments"]; buffer: CapturedBuffer }[] =
        [];

      for (let repeat = 1; repeat <= REPEATS_PER_CELL; repeat++) {
        const label = cellLabel(scenario, bpm, repeat);
        setAuditState(`running:${label}`);
        let stage = "prefs";
        try {
          const result = await withDeadline(
            runCellRepeat(project, audioContext, unitAdapter, scenario, bpm, rate, repeat, (s) => {
              stage = s;
            }),
            120_000,
            label
          );
          repeats.push({ repeat, ...result });
        } catch (err) {
          const errorMessage = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
          const errorRow: AuditRow = {
            scenario,
            bpm,
            rate,
            repeat,
            takeIndex: 0,
            medianBeatErrorMs: null,
            matchedBeats: 0,
            missingBeats: 0,
            headMissingMs: null,
            status: "error",
            matchedSignature: null,
            detail: "",
            errorMessage,
          };
          allRows.push(errorRow);
          onRow(errorRow);
          console.error(`[recording-alignment-audit] cell ${label} failed: ${errorMessage}`);
        } finally {
          // Unconditional — a mid-recording error must not leave stale
          // regions for the next repeat/cell.
          resetForNextCell(project, unitAdapter);
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
          row.detail = classification.detail;
          allRows.push(row);
          onRow(row);
        }
        await uploadRepeatWav(scenario, bpm, rate, r.repeat, r.buffer);
      }
    }
  }

  setAuditState("uploading");
  await uploadSummary(allRows, rate);
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

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    setStarted(true);
    setRows([]);
    runAudit(setAuditState, (row) => setRows((prev) => [...prev, row]))
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

const scenarioParam = params.get("scenario");
if (scenarioParam === "probe") {
  createRoot(document.getElementById("root")!).render(<ProbeHarness />);
} else {
  createRoot(document.getElementById("root")!).render(<ScenarioRunnerHarness />);
}
