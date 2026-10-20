// Combined MIDI + Audio Audit — unlisted page.
//
//   midi-audio-combined-audit-debug-demo.html?scenario=<nominal-start|countin-start|janked-mid|all>&bpm=<n>
//     [&repeats=<n>][&state=<default|calibrated|both>][&bus=<substring>][&input=<substring>][&output=<substring>][&audible=1]
//
// A player's two parts: for every note of the MIDI sweep's pattern the page sends the key on the
// IAC bus and plays a click out of the speakers at the same heard instant; the SDK records the keys
// through the Vaporisateur's MIDI capture and the clicks through a Tape on the microphone. The figure
// is where the key landed minus where the sound landed, `partsApartMs`, in two input-latency states
// of the Tape's capture box (the engine preference is never written). The speaker-to-microphone
// round trip is measured inside every run, through the capture's own node. Register:
// debug/2026-10-20-midi-audio-combined/note.md. DOM contract: #audit-state[data-audit-state]
// walks setup → running:<cell> → done | error:<message>.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { CaptureAudio, CaptureMidi, MidiDevices, type Project } from "@opendaw/studio-core";
import { InstrumentFactories, type AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import { detectBuildFeatures } from "@/lib/audit/buildFeatures";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { runRepeatWithDeadline } from "@/lib/audit/recordingCellRunner";
import { type AuditBuildFeature } from "@/lib/audit/recordingAuditCalibration";
import { isMidiScenario, MIDI_BUS_DEFAULT, type MidiScenario } from "@/lib/audit/midiInputCalibration";
import { FrameWatch } from "@/lib/audit/midiInputCellRunner";
import { MidiLoopbackSender, pickIacPorts } from "@/lib/audit/midiLoopback";
import { pickAudioDevice } from "@/lib/audit/combinedDevices";
import { inputLatencySecondsFor, type InputLatencyState } from "@/lib/audit/combinedClicks";
import { measureMicRoundTrip, type MicRoundTrip } from "@/lib/audit/combinedCalibration";
import { classifyCombinedCell, expectedPartsApartMs, type CombinedContext, type CombinedRepeatInput } from "@/lib/audit/combinedVerdict";
import {
  COMBINED_SCHEMA_VERSION, combinedSummaryFileName, type CombinedCellVerdict, type CombinedRow, type CombinedSummary,
} from "@/lib/audit/combinedArtifacts";
import { resetForNextCombinedCell, runCombinedRepeat, type CombinedRepeatResult } from "@/lib/audit/combinedCellRunner";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar, type DebugLink } from "@/components/DebugLinkBar";

const params = new URLSearchParams(window.location.search);

const AUDIT_LINKS: DebugLink[] = [
  {
    label: "debug/2026-10-20-midi-audio-combined/note.md",
    href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-20-midi-audio-combined/note.md",
    kind: "note",
  },
  {
    label: "debug/2026-10-20-midi-input-alignment/note.md (the MIDI side)",
    href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-20-midi-input-alignment/note.md",
    kind: "note",
  },
];

const COMBINED_SCENARIOS: MidiScenario[] = ["nominal-start", "countin-start", "janked-mid"];
const BUS = params.get("bus") ?? MIDI_BUS_DEFAULT;
const INPUT = params.get("input");
const OUTPUT = params.get("output");
const AUDIBLE = params.get("audible") === "1";
const SILENT_VOLUME_DB = -96;
const FRAME_STALL_MS = 1000;
const DEFAULT_REPEATS = 3;

function resolveScenarios(param: string | null): MidiScenario[] {
  if (!param || param === "all") return [...COMBINED_SCENARIOS];
  if (!isMidiScenario(param) || !COMBINED_SCENARIOS.includes(param)) {
    throw new Error(`unknown scenario "${param}" — use ?scenario=all|${COMBINED_SCENARIOS.join("|")}`);
  }
  return [param];
}
function resolveBpm(param: string | null): number {
  const n = Number(param ?? "120");
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid ?bpm= "${param}"`);
  return n;
}
function resolveRepeats(param: string | null): number {
  if (param === null) return DEFAULT_REPEATS;
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid ?repeats= "${param}"`);
  return n;
}
function resolveStates(param: string | null): InputLatencyState[] {
  if (param === null || param === "both") return ["default", "calibrated"];
  if (param === "default" || param === "calibrated") return [param];
  throw new Error(`invalid ?state= "${param}" — default | calibrated | both`);
}

interface MatrixContext {
  project: Project;
  audioContext: AudioContext;
  midiUnitBox: AudioUnitBox;
  tapeAdapter: AudioUnitBoxAdapter;
  tapeCapture: CaptureAudio;
  loopback: MidiLoopbackSender;
  busName: string;
  inputDevice: string;
  outputDevice: string;
  buildFeatures: AuditBuildFeature[];
}

async function waitFor(predicate: () => boolean, deadlineMs: number, label: string): Promise<void> {
  const until = performance.now() + deadlineMs;
  while (!predicate()) {
    if (performance.now() > until) throw new Error(`${label} not ready within ${deadlineMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function createMatrixContext(onStatus: (s: string) => void): Promise<MatrixContext> {
  onStatus("setup: engine");
  const { project, audioContext } = await initializeOpenDAW({ bpm: 120 });
  const buildFeatures = detectBuildFeatures(project.engine);
  if (!buildFeatures.includes("recordingStart")) throw new Error("this build has no engine.recordingStart; the audit cannot anchor a repeat");
  const prefInputLatency = project.engine.preferences.settings.recording.inputLatency;
  if (prefInputLatency !== 0) {
    throw new Error(`the engine preference recording.inputLatency is ${prefInputLatency}, not 0 — another page left it; this page does not change it, reset it there first`);
  }

  onStatus("setup: devices");
  const probe = await withDeadline(navigator.mediaDevices.getUserMedia({ audio: true }), 30_000, "microphone permission");
  probe.getTracks().forEach((t) => t.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  const input = pickAudioDevice(devices, "audioinput", INPUT);
  if ("error" in input) throw new Error(input.error);
  const output = pickAudioDevice(devices, "audiooutput", OUTPUT);
  if ("error" in output) throw new Error(output.error);
  const sinkable = audioContext as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (OUTPUT !== null) {
    if (typeof sinkable.setSinkId !== "function") throw new Error("this browser cannot choose the output device (no AudioContext.setSinkId); leave ?output= out");
    await withDeadline(sinkable.setSinkId(output.deviceId), 10_000, "setSinkId");
  }

  onStatus("setup: MIDI");
  await withDeadline(MidiDevices.requestPermission(), 30_000, "MIDI access");
  const picked = pickIacPorts(MidiDevices.inputDevices(), MidiDevices.outputDevices(), BUS);
  if ("error" in picked) throw new Error(picked.error);
  const midiIn = MidiDevices.findInputDeviceById(picked.inputId).unwrap("IAC input vanished");
  const midiOut = MidiDevices.findOutputDeviceById(picked.outputId).unwrap("IAC output vanished");
  const loopback = new MidiLoopbackSender(midiOut, midiIn);

  const midiUnitBox: AudioUnitBox = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Vaporisateur).audioUnitBox)
    .unwrap("createInstrument (Vaporisateur) did not return audioUnitBox");
  const midiCapture = project.captureDevices.get(midiUnitBox.address.uuid).unwrap("no capture for the synth");
  if (!(midiCapture instanceof CaptureMidi)) throw new Error("the synth's capture is not CaptureMidi");
  project.editing.modify(() => {
    midiCapture.captureBox.deviceId.setValue(picked.inputId);
    midiCapture.captureBox.channel.setValue(-1);
  });
  midiCapture.armed.setValue(true);

  onStatus("setup: Tape");
  const tapeUnitBox: AudioUnitBox = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox)
    .unwrap("createInstrument (Tape) did not return audioUnitBox");
  const tapeCapture = project.captureDevices.get(tapeUnitBox.address.uuid).unwrap("no capture for the Tape");
  if (!(tapeCapture instanceof CaptureAudio)) throw new Error("the Tape's capture is not CaptureAudio");
  project.editing.modify(() => {
    tapeCapture.captureBox.deviceId.setValue(input.deviceId);
    tapeCapture.requestChannels = 1;
    tapeCapture.captureBox.inputLatency.setValue(0);
  });
  tapeCapture.monitoringMode = "off";
  tapeCapture.armed.setValue(true);
  await waitFor(() => tapeCapture.outputNode.nonEmpty(), 10_000, "the Tape's input chain");
  // The SDK falls back to a stream without the device constraint when the device is refused: check what it opened.
  const opened = tapeCapture.streamDeviceId.unwrapOrNull();
  if (opened !== null && opened !== input.deviceId) {
    throw new Error(`the Tape opened "${tapeCapture.deviceLabel.unwrapOrNull() ?? opened}" instead of "${input.label}"`);
  }
  const tapeAdapter = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === tapeUnitBox);
  if (tapeAdapter === undefined) throw new Error("no adapter for the Tape");

  if (!AUDIBLE) {
    const master = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.isOutput);
    if (master !== undefined) project.editing.modify(() => master.box.volume.setValue(SILENT_VOLUME_DB));
  }

  const inputDevice = tapeCapture.deviceLabel.unwrapOrNull() ?? input.label;
  console.log(`[combined-audit] in="${inputDevice}" out="${output.label}" bus="${picked.name}"`);
  return {
    project, audioContext, midiUnitBox, tapeAdapter, tapeCapture, loopback,
    busName: picked.name, inputDevice, outputDevice: output.label, buildFeatures,
  };
}

/** Every run measures its own round trip (the built-in path has sat at 64 ms on some runs and 88 ms on others). */
async function calibrate(ctx: MatrixContext, onStatus: (s: string) => void): Promise<MicRoundTrip> {
  onStatus("setup: calibration (three clicks, keep quiet)");
  if (ctx.audioContext.state !== "running") throw new Error(`AudioContext is ${ctx.audioContext.state} — click Run with a real click`);
  const mic = await measureMicRoundTrip(ctx.audioContext, ctx.tapeCapture.outputNode.unwrap());
  console.log(`[combined-audit] mic round trip ${mic.roundTripMs.toFixed(2)} ms (spread ${mic.roundTripSpreadMs.toFixed(2)}), `
    + `input part ${mic.inputPartMs.toFixed(2)} ms (output latency ${mic.outputLatencyMs.toFixed(1)} after the clicks), floor ${mic.floorDb.toFixed(1)} peak ${mic.peakDb.toFixed(1)} dBFS`);
  return mic;
}

let matrixContextPromise: Promise<MatrixContext> | null = null;
function getMatrixContext(onStatus: (s: string) => void): Promise<MatrixContext> {
  if (matrixContextPromise === null) {
    let stage = "setup";
    matrixContextPromise = createMatrixContext((s) => { stage = s; onStatus(s); })
      .catch((err: unknown) => {
        // Not retried: a setup that failed after creating units would leave them armed beside a second pair.
        const message = `${stage} — ${err instanceof Error ? err.message : String(err)} (reload the page to try again)`;
        matrixContextPromise = Promise.reject(new Error(message));
        matrixContextPromise.catch(() => undefined);
        throw new Error(message);
      });
  }
  return matrixContextPromise;
}

const emptyFigures = {
  clicksFound: 0, clicksMissing: 0, clicksExtra: 0, onsetsOutsideSpan: 0, audioMedianMs: null, audioMaxAbsDevMs: null,
  pairs: 0, partsApartMedianMs: null, partsApartMaxAbsDevMs: null, partsApartP5P95Ms: null, anchorOffsetMs: null,
};

function errorRow(scenario: MidiScenario, state: InputLatencyState, bpm: number, repeat: number, detail: string, mic: MicRoundTrip): CombinedRow {
  return {
    ...emptyFigures, scenario, state, bpm, repeat, status: "error", detail, midi: null, midiNotes: [], pairsDetail: [],
    micRoundTripMs: mic.roundTripMs, micRoundTripSpreadMs: mic.roundTripSpreadMs, micOutputLatencyMs: mic.outputLatencyMs, micInputPartMs: mic.inputPartMs, inputLatencyAppliedMs: null,
    outputLatencyMs: null, compensationLatencyMs: null, heardLagMs: null, frameIntervalMs: null, frameGapMaxMs: null, sampleRate: null,
    anchorContextTime: null, originPpqn: null, takeRegionStartSec: null, waveformOffsetSec: null, cleanupWarning: null,
  };
}

function resultRow(scenario: MidiScenario, state: InputLatencyState, bpm: number, repeat: number, r: CombinedRepeatResult, mic: MicRoundTrip, sampleRate: number): CombinedRow {
  return {
    ...r.figures, scenario, state, bpm, repeat, status: "pending", detail: null, midi: r.midi.figures, midiNotes: r.midi.notes, pairsDetail: r.pairs,
    micRoundTripMs: mic.roundTripMs, micRoundTripSpreadMs: mic.roundTripSpreadMs, micOutputLatencyMs: mic.outputLatencyMs, micInputPartMs: mic.inputPartMs, inputLatencyAppliedMs: r.inputLatencyAppliedMs,
    outputLatencyMs: r.midi.outputLatencyMs, compensationLatencyMs: r.midi.compensationLatencyMs, heardLagMs: r.midi.heardLagMs,
    frameIntervalMs: r.midi.frameIntervalMs, frameGapMaxMs: r.midi.frameGapMaxMs, sampleRate,
    anchorContextTime: r.midi.anchor.contextTime, originPpqn: r.midi.originPpqn, takeRegionStartSec: r.takeRegionStartSec, waveformOffsetSec: r.waveformOffsetSec,
    cleanupWarning: null,
  };
}

async function runAudit(setAuditState: (s: string) => void, onRows: (rows: CombinedRow[]) => void, onMic: (m: MicRoundTrip) => void): Promise<void> {
  setAuditState("setup");
  const scenarios = resolveScenarios(params.get("scenario"));
  const bpm = resolveBpm(params.get("bpm"));
  const repeatsPerCell = resolveRepeats(params.get("repeats"));
  const states = resolveStates(params.get("state"));
  const runToken = Date.now();
  const ctx = await getMatrixContext(setAuditState);
  const micRoundTrip = await calibrate(ctx, setAuditState);
  onMic(micRoundTrip);
  const { project, audioContext, midiUnitBox, tapeAdapter, tapeCapture, loopback } = ctx;

  let hiddenCount = 0;
  const onVisibility = (): void => { if (document.visibilityState !== "visible") hiddenCount++; };
  document.addEventListener("visibilitychange", onVisibility);
  // The run's original metronome preference, restored once at the end: a repeat the outer deadline abandoned
  // skips its own restore, so the run-level one is what leaves localStorage as it was found.
  const metronomeSettings = project.engine.preferences.settings.metronome;
  const originalMetronome = { enabled: metronomeSettings.enabled, gain: metronomeSettings.gain };
  const allRows: CombinedRow[] = [];
  const cellVerdicts: CombinedCellVerdict[] = [];
  try {
    for (const scenario of scenarios) {
      for (const state of states) {
        const cellRows: CombinedRow[] = [];
        const inputs: CombinedRepeatInput[] = [];
        for (let repeat = 1; repeat <= repeatsPerCell; repeat++) {
          const label = `${scenario}/${state}/${bpm}/r${repeat}`;
          setAuditState(`running:${label}`);
          let stage = "prefs";
          let row: CombinedRow;
          const hiddenBefore = hiddenCount;
          const frameWatch = new FrameWatch();
          try {
            const result = await runRepeatWithDeadline(
              (token) => runCombinedRepeat({
                project, audioContext, loopback, frameWatch, midiUnitBox, tapeAdapter, tapeCapture, scenario, state, bpm, repeat, micRoundTrip, token,
                onStage: (s) => { stage = s; },
              }),
              150_000,
              label,
            );
            row = resultRow(scenario, state, bpm, repeat, result, micRoundTrip, audioContext.sampleRate);
            const context: CombinedContext | null = result.midi.frameIntervalMs === null ? null : {
              outputLatencyMs: result.midi.outputLatencyMs, compensationLatencyMs: result.midi.compensationLatencyMs,
              frameIntervalMs: result.midi.frameIntervalMs, sampleRate: audioContext.sampleRate,
              state, micRoundTripMs: micRoundTrip.roundTripMs, micInputPartMs: micRoundTrip.inputPartMs, inputLatencyAppliedMs: result.inputLatencyAppliedMs,
            };
            inputs.push({ midi: result.midi.figures, combined: result.figures, context });
          } catch (err) {
            const gaps = frameWatch.stop();
            const hidden = hiddenCount > hiddenBefore || document.visibilityState !== "visible";
            const stalled = gaps.maxGapMs !== null && gaps.maxGapMs > FRAME_STALL_MS;
            const message = `${stage}: ${err instanceof Error ? err.message : String(err)}`
              + (hidden ? " [the page was hidden during this repeat — not an SDK finding]" : "")
              + (stalled ? ` [animation frames stalled: longest gap ${(gaps.maxGapMs as number).toFixed(0)} ms — a covered or hidden window, not an SDK finding]` : "");
            console.error(`[combined-audit] cell ${label} failed: ${message}`);
            row = errorRow(scenario, state, bpm, repeat, message, micRoundTrip);
            row.frameGapMaxMs = gaps.maxGapMs;
          }
          try {
            row.cleanupWarning = await resetForNextCombinedCell(project, midiUnitBox, tapeAdapter, tapeCapture, loopback);
          } catch (cleanupErr) {
            row.cleanupWarning = `cleanup itself threw: ${String(cleanupErr)}`;
          }
          cellRows.push(row);
          allRows.push(row);
          onRows([...allRows]);
        }
        const verdict = inputs.length === repeatsPerCell
          ? classifyCombinedCell(scenario, inputs)
          : { status: "investigate" as const, detail: `${repeatsPerCell - inputs.length} of ${repeatsPerCell} repeats failed` };
        for (const row of cellRows) {
          if (row.status === "error") continue;
          row.status = verdict.status;
          row.detail = verdict.detail;
        }
        cellVerdicts.push({ scenario, state, status: verdict.status, detail: verdict.detail });
        console.log(`[combined-audit] cell ${scenario}/${state}: ${verdict.status} — ${verdict.detail}`);
        onRows([...allRows]);
      }
    }
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
    metronomeSettings.enabled = originalMetronome.enabled;
    metronomeSettings.gain = originalMetronome.gain;
  }

  const summary: CombinedSummary = {
    schemaVersion: COMBINED_SCHEMA_VERSION, runToken, userAgent: navigator.userAgent, sdkVersion: OPENDAW_SDK_VERSION,
    buildFeatures: ctx.buildFeatures, busName: ctx.busName, inputDevice: ctx.inputDevice, outputDevice: ctx.outputDevice,
    sampleRate: audioContext.sampleRate, micRoundTrip, repeatsPerCell, scenarios, states, cellVerdicts, rows: allRows,
  };
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/${combinedSummaryFileName(runToken)}`, { method: "PUT", body: JSON.stringify(summary, null, 2) });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "summary upload",
  );
  console.log(`[combined-audit] summary ${combinedSummaryFileName(runToken)} uploaded, ${allRows.length} rows`);
  setAuditState("done");
}

const ms = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : v.toFixed(2));

function Harness() {
  const [auditState, setAuditState] = useState("idle");
  const [rows, setRows] = useState<CombinedRow[]>([]);
  const [mic, setMic] = useState<MicRoundTrip | null>(null);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    setStarted(true);
    setRows([]);
    runAudit(setAuditState, setRows, setMic)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[combined-audit] run error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running]);

  const count = (status: CombinedRow["status"]): number => rows.filter((r) => r.status === status).length;
  const last = [...rows].reverse().find((r) => r.outputLatencyMs !== null && r.compensationLatencyMs !== null && r.frameIntervalMs !== null
    && r.sampleRate !== null && r.micInputPartMs !== null && r.micRoundTripMs !== null);
  const predict = (state: InputLatencyState): string => {
    if (last === undefined) return "—";
    const ctx: CombinedContext = {
      outputLatencyMs: last.outputLatencyMs as number, compensationLatencyMs: last.compensationLatencyMs as number, frameIntervalMs: last.frameIntervalMs as number,
      sampleRate: last.sampleRate as number, state, micRoundTripMs: last.micRoundTripMs as number, micInputPartMs: last.micInputPartMs as number,
      inputLatencyAppliedMs: inputLatencySecondsFor(state, last.micInputPartMs as number) * 1000,
    };
    return expectedPartsApartMs(ctx).toFixed(1);
  };

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar links={AUDIT_LINKS} />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">Combined MIDI + Audio Audit</Heading>
          <Text size="1" color="gray" align="center">
            A key on the IAC bus and a click out of the speakers at the same heard instant; where did the two parts land?
          </Text>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">State:</Text>
              <Badge id="audit-state" data-audit-state={auditState} color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}>
                {auditState}
              </Badge>
              <Button onClick={handleRun} disabled={running}>{started ? "Re-run" : "Run audit"}</Button>
              <Text size="2" color="gray">
                {rows.length} row{rows.length === 1 ? "" : "s"} — {count("together")} together, {count("matches-known-defect")} known-defect,{" "}
                {count("investigate")} investigate{count("error") > 0 && `, ${count("error")} error`}
              </Text>
              {mic !== null && (
                <Text size="2" color="gray">
                  mic round trip {mic.roundTripMs.toFixed(1)} ms (spread {mic.roundTripSpreadMs.toFixed(1)}), input part {mic.inputPartMs.toFixed(1)} ms
                  (output latency {mic.outputLatencyMs.toFixed(1)} ms after the clicks),
                  floor {mic.floorDb.toFixed(0)} / peak {mic.peakDb.toFixed(0)} dBFS
                </Text>
              )}
            </Flex>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    {["scenario", "state", "rep", "status", "pairs", "clicks found/miss/extra", "apart median ms", "apart max dev ms", "apart p5–p95 ms",
                      "midi median ms", "audio median ms", "mic rt / part / applied ms", "frame ms", "heard lag ms", "detail"]
                      .map((h) => <Table.ColumnHeaderCell key={h}>{h}</Table.ColumnHeaderCell>)}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r) => (
                    <Table.Row key={`${r.scenario}/${r.state}/${r.repeat}`}>
                      <Table.Cell>{r.scenario}</Table.Cell>
                      <Table.Cell>{r.state}</Table.Cell>
                      <Table.Cell>{r.repeat}</Table.Cell>
                      <Table.Cell>
                        <Badge color={r.status === "together" ? "green" : r.status === "matches-known-defect" ? "blue" : r.status === "error" ? "red" : r.status === "pending" ? "gray" : "amber"}>
                          {r.status}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{r.pairs}</Table.Cell>
                      <Table.Cell>{r.clicksFound}/{r.clicksMissing}/{r.clicksExtra}</Table.Cell>
                      <Table.Cell>{ms(r.partsApartMedianMs)}</Table.Cell>
                      <Table.Cell>{ms(r.partsApartMaxAbsDevMs)}</Table.Cell>
                      <Table.Cell>{ms(r.partsApartP5P95Ms)}</Table.Cell>
                      <Table.Cell>{ms(r.midi?.placementMedianMs)}</Table.Cell>
                      <Table.Cell>{ms(r.audioMedianMs)}</Table.Cell>
                      <Table.Cell>{ms(r.micRoundTripMs)} / {ms(r.micInputPartMs)} / {ms(r.inputLatencyAppliedMs)}</Table.Cell>
                      <Table.Cell>{ms(r.frameIntervalMs)}</Table.Cell>
                      <Table.Cell>{ms(r.heardLagMs)}</Table.Cell>
                      <Table.Cell style={{ maxWidth: 360, whiteSpace: "pre-wrap" }}>
                        {r.detail ?? ""}{r.cleanupWarning ? ` [cleanup: ${r.cleanupWarning}]` : ""}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>Configuration</Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {`?scenario=<name|all>  ${COMBINED_SCENARIOS.join(" | ")}
?bpm=<n>              default 120
?repeats=<n>          default ${DEFAULT_REPEATS}
?state=<s>            default | calibrated | both (default both): the Tape capture box's own inputLatency field, 0 or this run's measured input part.
                      The engine preference recording.inputLatency is never written; the page refuses to run if another page left it non-zero.
?bus=<substring>      default "${MIDI_BUS_DEFAULT}" — the IAC Driver bus
?input= / ?output=    substrings of the microphone / speaker labels; default the laptop's built-in pair (an interface later is a parameter)
?audible=1            hear the synth (the metronome is off in every scenario; the count-in forces it on, so that run sets its gain to a finite −120 dB floor and restores it)
Calibration           three 6 kHz clicks out of the speakers before the first repeat, measured through the Tape capture's own node in the worklet's
                      own frame count (no worklet clock read); written on every row. Keep the room quiet and the window uncovered.
Prediction            partsApartMs ≈ 2 × (output + compensation latency) − (frame − quantum) − (round trip − this repeat's output latency − applied):
                      about −9 ms uncalibrated (the audio lands later than the key), about +32 ms calibrated, at 60 Hz with 23 ms output latency and a 41 ms input part.
This machine          default ${predict("default")} ms, calibrated ${predict("calibrated")} ms (from the latest row's figures)
Verdict               together = |median| ≤ a quantum and max dev ≤ a frame + a quantum; matches-known-defect = the two recorders' known shapes from the row's own figures;
                      an audio median that disagrees with the calibration, in either state, names the microphone path, not the SDK.
Click "Run audit" with a real click — it asks for the microphone, MIDI access and resumes the AudioContext.`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
