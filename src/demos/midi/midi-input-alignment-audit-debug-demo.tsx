// MIDI Input Alignment Audit — unlisted sweep page.
//
//   midi-input-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>[&repeats=<n>][&bus=<substring>][&audible=1][&effect=none|pitch|arpeggio]
//
// Sends a pre-scheduled note pattern through a virtual MIDI bus (the macOS IAC Driver),
// lets the SDK record it, and measures where every note landed against the HEARD beat.
// Nothing is netted out of the verdict figure; the SDK's latency term and the display
// frame interval ride along on every row for attribution. `&effect=` inserts a MIDI effect on
// the recorded unit: the recorder reads the capture's raw note signals before the chain, so
// every figure is expected unchanged. Register and reading recipe:
// debug/2026-10-20-midi-input-alignment/note.md. DOM contract: #audit-state carries
// data-audit-state walking setup → running:<cell> → done | error:<message>.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { CaptureMidi, EffectFactories, MidiDevices, type Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { ArpeggioDeviceBox, AudioUnitBox, PitchDeviceBox } from "@opendaw/studio-boxes";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import { detectBuildFeatures } from "@/lib/audit/buildFeatures";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { midiEffectsFieldOf } from "@/lib/adapterUtils";
import { withDeadline } from "@/lib/deadline";
import { runRepeatWithDeadline } from "@/lib/audit/recordingCellRunner";
import { JANK_MS, type AuditBuildFeature } from "@/lib/audit/recordingAuditCalibration";
import {
  isMidiScenario, MIDI_AUDIT_BPMS, MIDI_AUDIT_SCENARIOS, MIDI_BUS_DEFAULT, MIDI_REPEATS_PER_CELL, MIDI_TOLERANCES, resolveEffectArm,
  type MidiEffectArm, type MidiScenario,
} from "@/lib/audit/midiInputCalibration";
import {
  classifyMidiCell, clampJitterBoundMs, expectedLateMedianMs, LATE_MEDIAN_MARGIN_MS, median, MIDI_KNOWN_DEFECTS,
  type BandContext, type RepeatFigures,
} from "@/lib/audit/midiInputAlignment";
import {
  MIDI_AUDIT_SCHEMA_VERSION, summaryFileName, type MidiAuditRow, type MidiAuditSummary, type MidiCellVerdictRecord,
} from "@/lib/audit/midiInputArtifacts";
import { MidiLoopbackSender, pickIacPorts } from "@/lib/audit/midiLoopback";
import {
  cellLabel, FrameWatch, resetForNextMidiCell, runMidiCellRepeat, type MidiCellRepeatResult,
} from "@/lib/audit/midiInputCellRunner";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar, type DebugLink } from "@/components/DebugLinkBar";

const params = new URLSearchParams(window.location.search);

const AUDIT_LINKS: DebugLink[] = [
  {
    label: "debug/2026-10-20-midi-input-alignment/note.md",
    href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-20-midi-input-alignment/note.md",
    kind: "note",
  },
];

const BUS = params.get("bus") ?? MIDI_BUS_DEFAULT;
const AUDIBLE = params.get("audible") === "1";
/** Resolved at the run, with the other parameters, so an unknown value lands in the error state. */
const resolveEffect = (): MidiEffectArm => resolveEffectArm(params.get("effect"));
/** A gap between animation frames past this is a stalled page, not a slow one. */
const FRAME_STALL_MS = 1000;
/** The master unit's volume while the sweep is silent (the schema's floor, in dB). */
const SILENT_VOLUME_DB = -96;

function resolveScenarios(param: string | null): MidiScenario[] {
  if (!param || param === "all") return [...MIDI_AUDIT_SCENARIOS];
  if (!isMidiScenario(param)) throw new Error(`unknown scenario "${param}" — use ?scenario=all|${MIDI_AUDIT_SCENARIOS.join("|")}`);
  return [param];
}

function resolveBpms(param: string | null): number[] {
  if (!param || param === "all") return [...MIDI_AUDIT_BPMS];
  const n = Number(param);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid ?bpm= "${param}"`);
  return [n];
}

function resolveRepeats(param: string | null): number {
  if (param === null) return MIDI_REPEATS_PER_CELL;
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid ?repeats= "${param}" — an integer of 1 or more`);
  return n;
}

interface MatrixContext {
  project: Project;
  audioContext: AudioContext;
  audioUnitBox: AudioUnitBox;
  loopback: MidiLoopbackSender;
  busName: string;
  inputId: string;
  outputId: string;
  buildFeatures: AuditBuildFeature[];
}

/** The effect arm's device on the recorded unit: the insert in one transaction, its settings in the next
 *  (repo rule on pointers created in the same transaction). Pitch at zero shift; Arpeggio at the factory
 *  values (Up, 1 octave, 1/16, gate 1, repeat 1). The device lives for the page. */
function insertEffectArm(project: Project, audioUnitBox: AudioUnitBox, effect: MidiEffectArm): void {
  if (effect === "none") return;
  const field = midiEffectsFieldOf(project, audioUnitBox);
  const factory = effect === "pitch" ? EffectFactories.Pitch : EffectFactories.Arpeggio;
  const box = project.editing.modify(() => project.api.insertEffect(field, factory)).unwrap("insertEffect");
  project.editing.modify(() => {
    if (effect === "pitch") {
      const pitch = box as PitchDeviceBox;
      pitch.semiTones.setValue(0);
      pitch.cents.setValue(0);
      pitch.octaves.setValue(0);
    } else {
      const arpeggio = box as ArpeggioDeviceBox;
      arpeggio.modeIndex.setValue(0);
      arpeggio.numOctaves.setValue(1);
      arpeggio.rateIndex.setValue(9);
      arpeggio.gate.setValue(1);
      arpeggio.repeat.setValue(1);
      arpeggio.velocity.setValue(0);
    }
  });
}

async function createMatrixContext(effect: MidiEffectArm): Promise<MatrixContext> {
  const { project, audioContext } = await initializeOpenDAW({ bpm: 120 });
  const buildFeatures = detectBuildFeatures(project.engine);
  if (!buildFeatures.includes("recordingStart")) {
    throw new Error("this build has no engine.recordingStart; the MIDI audit cannot anchor a repeat");
  }
  await withDeadline(MidiDevices.requestPermission(), 30_000, "MIDI access");
  const picked = pickIacPorts(MidiDevices.inputDevices(), MidiDevices.outputDevices(), BUS);
  if ("error" in picked) throw new Error(picked.error);
  const input = MidiDevices.findInputDeviceById(picked.inputId).unwrap("IAC input vanished");
  const output = MidiDevices.findOutputDeviceById(picked.outputId).unwrap("IAC output vanished");
  const loopback = new MidiLoopbackSender(output, input);

  // Synth + capture: createInstrument, then the capture's box fields in a second
  // transaction (CLAUDE.md "Pointer Re-Routing"); armed is not a box field.
  const audioUnitBox: AudioUnitBox = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Vaporisateur).audioUnitBox)
    .unwrap("createInstrument did not return audioUnitBox");
  const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap("no capture for the synth");
  if (!(capture instanceof CaptureMidi)) throw new Error("capture is not CaptureMidi");
  project.editing.modify(() => {
    // Pinned to the bus: a connected keyboard stays out of the sweep.
    capture.captureBox.deviceId.setValue(picked.inputId);
    capture.captureBox.channel.setValue(-1);
  });
  capture.armed.setValue(true);
  insertEffectArm(project, audioUnitBox, effect);

  if (!AUDIBLE) {
    const output = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.isOutput);
    if (output !== undefined) project.editing.modify(() => output.box.volume.setValue(SILENT_VOLUME_DB));
  }
  console.log(`[midi-input-audit] bus="${picked.name}" input=${picked.inputId} armed, effect=${effect}, buildFeatures=[${buildFeatures.join(",")}]`);
  return { project, audioContext, audioUnitBox, loopback, busName: picked.name, inputId: picked.inputId, outputId: picked.outputId, buildFeatures };
}

// Booted once per page load (`Workers.install` asserts on a second call); a failed
// boot stays failed — reload the page.
let matrixContextPromise: Promise<MatrixContext> | null = null;
function getMatrixContext(effect: MidiEffectArm): Promise<MatrixContext> {
  if (matrixContextPromise === null) matrixContextPromise = createMatrixContext(effect);
  return matrixContextPromise;
}

function errorRow(scenario: MidiScenario, bpm: number, repeat: number, effect: MidiEffectArm, detail: string): MidiAuditRow {
  return {
    scenario, bpm, repeat, effect, status: "error", detail,
    notesSent: 0, notesRecorded: 0, judgedNotes: 0, missing: 0, receiptsMissing: 0, extra: 0, stuck: 0, velocityMismatches: 0, collapsed: 0,
    placementMedianMs: null, placementMaxAbsDevMs: null, placementP5P95Ms: null, durationErrorMedianMs: null, durationErrorMaxMs: null,
    loopbackDelayMedianMs: null, loopbackDelayMaxMs: null, wrapAdjacent: 0, countInNotes: 0, countInRecorded: 0,
    jankMs: null, takeCount: 0, takeIndexSource: null, anchorContextTime: null, anchorPosition: null, originPpqn: null,
    sampleRate: null, frameIntervalMs: null, frameGapMaxMs: null, outputLatencyMs: null, baseLatencyMs: null, compensationLatencyMs: null,
    sdkLatencyTermMs: null, heardLagMs: null, cleanupWarning: null, notes: [],
  };
}

function resultRow(scenario: MidiScenario, bpm: number, repeat: number, effect: MidiEffectArm, r: MidiCellRepeatResult, jank: boolean, sampleRate: number): MidiAuditRow {
  return {
    sampleRate,
    ...r.figures,
    scenario, bpm, repeat, effect, status: "pending", detail: null,
    jankMs: jank ? r.jankMs ?? JANK_MS : r.jankMs,
    takeCount: r.takeCount, takeIndexSource: r.takeIndexSource,
    anchorContextTime: r.anchor.contextTime, anchorPosition: r.anchor.position, originPpqn: r.originPpqn,
    frameIntervalMs: r.frameIntervalMs, frameGapMaxMs: r.frameGapMaxMs, outputLatencyMs: r.outputLatencyMs, baseLatencyMs: r.baseLatencyMs,
    compensationLatencyMs: r.compensationLatencyMs, sdkLatencyTermMs: r.sdkLatencyTermMs, heardLagMs: r.heardLagMs,
    cleanupWarning: null, notes: r.notes,
  };
}

async function runAudit(setAuditState: (s: string) => void, onRows: (rows: MidiAuditRow[]) => void): Promise<void> {
  setAuditState("setup");
  const scenarios = resolveScenarios(params.get("scenario"));
  const bpms = resolveBpms(params.get("bpm"));
  const repeatsPerCell = resolveRepeats(params.get("repeats"));
  const effect = resolveEffect();
  const runToken = Date.now();
  const { project, audioContext, audioUnitBox, loopback, busName, inputId, outputId, buildFeatures } = await getMatrixContext(effect);

  // An occluded or hidden window stalls the animation frames the SDK's main-thread sync and
  // this runner's waits ride on (root CLAUDE.md); an error row says whether that happened.
  let hiddenCount = 0;
  const onVisibility = (): void => { if (document.visibilityState !== "visible") hiddenCount++; };
  document.addEventListener("visibilitychange", onVisibility);
  // The run's original metronome preference, restored once at the end (a repeat the outer deadline abandoned
  // skips its own restore); engine preferences persist in localStorage for every page on the origin.
  const metronomeSettings = project.engine.preferences.settings.metronome;
  const originalMetronome = { enabled: metronomeSettings.enabled, gain: metronomeSettings.gain };
  const allRows: MidiAuditRow[] = [];
  const cellVerdicts: MidiCellVerdictRecord[] = [];
  try {
  for (const scenario of scenarios) {
    for (const bpm of bpms) {
      const cellRows: MidiAuditRow[] = [];
      const figures: RepeatFigures[] = [];
      const contexts: Array<BandContext | null> = [];
      for (let repeat = 1; repeat <= repeatsPerCell; repeat++) {
        const label = cellLabel(scenario, bpm, repeat);
        setAuditState(`running:${label}`);
        let stage = "prefs";
        let row: MidiAuditRow;
        const hiddenBefore = hiddenCount;
        const frameWatch = new FrameWatch();
        try {
          const result = await runRepeatWithDeadline(
            (token) => runMidiCellRepeat({
              project, audioContext, loopback, audioUnitBox, scenario, bpm, repeat, token, frameWatch,
              onStage: (s) => { stage = s; },
            }),
            120_000,
            label,
          );
          row = resultRow(scenario, bpm, repeat, effect, result, scenario === "janked-start", audioContext.sampleRate);
          figures.push(result.figures);
          contexts.push(result.frameIntervalMs === null ? null : {
            outputLatencyMs: result.outputLatencyMs, compensationLatencyMs: result.compensationLatencyMs,
            frameIntervalMs: result.frameIntervalMs, sampleRate: audioContext.sampleRate,
          });
        } catch (err) {
          const hidden = hiddenCount > hiddenBefore || document.visibilityState !== "visible";
          const gaps = frameWatch.stop();
          const stalled = gaps.maxGapMs !== null && gaps.maxGapMs > FRAME_STALL_MS;
          const message = `${stage}: ${err instanceof Error ? err.message : String(err)}`
            + (hidden ? " [the page was hidden during this repeat — not an SDK finding]" : "")
            + (stalled ? ` [animation frames stalled: longest gap ${(gaps.maxGapMs as number).toFixed(0)} ms — a covered or hidden window, not an SDK finding]` : "");
          console.error(`[midi-input-audit] cell ${label} failed: ${message}`);
          row = errorRow(scenario, bpm, repeat, effect, message);
          row.frameGapMaxMs = gaps.maxGapMs;
        }
        try {
          row.cleanupWarning = await resetForNextMidiCell(project, audioUnitBox, loopback);
        } catch (cleanupErr) {
          row.cleanupWarning = `cleanup itself threw: ${String(cleanupErr)}`;
          console.warn(`[midi-input-audit] cell ${label} cleanup failed: ${row.cleanupWarning}`);
        }
        cellRows.push(row);
        allRows.push(row);
        onRows([...allRows]);
      }
      const verdict = figures.length === repeatsPerCell
        ? classifyMidiCell(scenario, figures, MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, contexts)
        : { status: "investigate" as const, detail: `${repeatsPerCell - figures.length} of ${repeatsPerCell} repeats failed` };
      for (const row of cellRows) {
        if (row.status === "error") continue;
        row.status = verdict.status;
        row.detail = verdict.detail;
      }
      cellVerdicts.push({ scenario, bpm, status: verdict.status, detail: verdict.detail });
      console.log(`[midi-input-audit] cell ${scenario}/${bpm}: ${verdict.status} — ${verdict.detail}`);
      onRows([...allRows]);
    }
  }
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
    metronomeSettings.enabled = originalMetronome.enabled;
    metronomeSettings.gain = originalMetronome.gain;
  }

  const frameIntervals = allRows.map((r) => r.frameIntervalMs).filter((v): v is number => v !== null && v > 0);
  const frameMedian = median(frameIntervals);
  const summary: MidiAuditSummary = {
    schemaVersion: MIDI_AUDIT_SCHEMA_VERSION,
    runToken,
    userAgent: navigator.userAgent,
    sdkVersion: OPENDAW_SDK_VERSION,
    buildFeatures,
    busName, inputId, outputId,
    sampleRate: audioContext.sampleRate,
    displayRefreshHz: frameMedian === null ? null : 1000 / frameMedian,
    repeatsPerCell,
    effect,
    tolerances: MIDI_TOLERANCES,
    scenarios, bpms,
    cellVerdicts,
    rows: allRows,
  };
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/${summaryFileName(runToken)}`, { method: "PUT", body: JSON.stringify(summary, null, 2) });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "summary upload",
  );
  console.log(`[midi-input-audit] summary ${summaryFileName(runToken)} uploaded, ${allRows.length} rows`);
  setAuditState("done");
}

const ms = (v: number | null): string => (v === null ? "—" : v.toFixed(2));

function Harness() {
  const [auditState, setAuditState] = useState("idle");
  const [rows, setRows] = useState<MidiAuditRow[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    setStarted(true);
    setRows([]);
    runAudit(setAuditState, setRows)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[midi-input-audit] run error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running]);

  const count = (status: MidiAuditRow["status"]): number => rows.filter((r) => r.status === status).length;
  const last = [...rows].reverse().find((r) => r.outputLatencyMs !== null && r.frameIntervalMs !== null && r.sampleRate !== null);
  const device: BandContext | null = last === undefined ? null : {
    outputLatencyMs: last.outputLatencyMs as number, compensationLatencyMs: last.compensationLatencyMs ?? 0,
    frameIntervalMs: last.frameIntervalMs as number, sampleRate: last.sampleRate as number,
  };

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar links={AUDIT_LINKS} />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">MIDI Input Alignment Audit</Heading>
          <Text size="1" color="gray" align="center">
            Judged against the heard beat; nothing netted. Expect a known-defect band, not <code>aligned</code>, until the recorder changes.
            {params.get("effect") !== null && params.get("effect") !== "none"
              ? ` Effect: ${params.get("effect")} on the recorded unit — the recorder reads before the chain, so every figure is expected unchanged.`
              : ""}
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
              <Button onClick={handleRun} disabled={running}>{started ? "Re-run" : "Run audit"}</Button>
              <Text size="2" color="gray">
                {rows.length} row{rows.length === 1 ? "" : "s"} — {count("aligned")} aligned, {count("matches-known-defect")} known-defect,{" "}
                {count("investigate")} investigate{count("error") > 0 && `, ${count("error")} error`}
              </Text>
            </Flex>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    {["scenario", "bpm", "rep", "status", "rec/sent", "miss", "no rcpt", "extra", "stuck", "vel", "median ms", "max dev ms",
                      "collapsed", "p5–p95 ms", "dur max ms", "loopback ms", "frame ms", "frame gap max ms", "sdk term ms", "heard lag ms", "takes", "cin rec/sent", "detail"]
                      .map((h) => <Table.ColumnHeaderCell key={h}>{h}</Table.ColumnHeaderCell>)}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r) => (
                    <Table.Row key={cellLabel(r.scenario, r.bpm, r.repeat)}>
                      <Table.Cell>{r.scenario}</Table.Cell>
                      <Table.Cell>{r.bpm}</Table.Cell>
                      <Table.Cell>{r.repeat}</Table.Cell>
                      <Table.Cell>
                        <Badge color={r.status === "aligned" ? "green" : r.status === "matches-known-defect" ? "blue" : r.status === "error" ? "red" : r.status === "pending" ? "gray" : "amber"}>
                          {r.status}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{r.notesRecorded}/{r.notesSent}</Table.Cell>
                      <Table.Cell>{r.missing}</Table.Cell>
                      <Table.Cell>{r.receiptsMissing}</Table.Cell>
                      <Table.Cell>{r.extra}</Table.Cell>
                      <Table.Cell>{r.stuck}</Table.Cell>
                      <Table.Cell>{r.velocityMismatches}</Table.Cell>
                      <Table.Cell>{ms(r.placementMedianMs)}</Table.Cell>
                      <Table.Cell>{ms(r.placementMaxAbsDevMs)}</Table.Cell>
                      <Table.Cell>{r.collapsed}</Table.Cell>
                      <Table.Cell>{ms(r.placementP5P95Ms)}</Table.Cell>
                      <Table.Cell>{ms(r.durationErrorMaxMs)}</Table.Cell>
                      <Table.Cell>{ms(r.loopbackDelayMedianMs)}</Table.Cell>
                      <Table.Cell>{ms(r.frameIntervalMs)}</Table.Cell>
                      <Table.Cell>{ms(r.frameGapMaxMs)}</Table.Cell>
                      <Table.Cell>{ms(r.sdkLatencyTermMs)}</Table.Cell>
                      <Table.Cell>{ms(r.heardLagMs)}</Table.Cell>
                      <Table.Cell>{r.takeCount}</Table.Cell>
                      <Table.Cell>{r.countInNotes > 0 ? `${r.countInRecorded}/${r.countInNotes}` : "—"}</Table.Cell>
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
              {`?scenario=<name|all>  ${MIDI_AUDIT_SCENARIOS.join(" | ")}
?bpm=<n|all>          default all = ${MIDI_AUDIT_BPMS.join(", ")}
?repeats=<n>          default ${MIDI_REPEATS_PER_CELL}
?bus=<substring>      default "${MIDI_BUS_DEFAULT}" — the IAC Driver bus (Audio MIDI Setup → MIDI Studio → IAC Driver → Device is online)
?audible=1            hear the synth (the metronome is off: the engine mixes it after the master, so a silenced master would not have silenced it)
Tolerances (ms)       placement ±${MIDI_TOLERANCES.placementMs} (one render quantum: 2.67 at 48 kHz, 2.90 at 44.1 kHz), spread ${MIDI_TOLERANCES.spreadMs}, duration ${MIDI_TOLERANCES.durationMs}; match window ${MIDI_TOLERANCES.matchWindowPpqn} pulses
Jank                  ${JANK_MS} ms main-thread block (janked-start: on the isRecording flip; janked-mid: a timer task mid pattern)
Reference             a note's expected position is the HEARD position at its Web MIDI receipt stamp; nothing is netted out.
                      The SDK's latency term, the output and base latency and the frame interval are on every row.
Known-defect band     computed from each row's OWN figures, so it holds on any device or display:
                      median within ±${LATE_MEDIAN_MARGIN_MS} ms of 2 × (output + compensation latency) − (frame − quantum);
                      jitter and duration error within one frame + one quantum; janked-mid may lose one release per repeat.
                      A median that tracks the formula on a new machine is the same defect; one that does not is a finding.${device === null ? "" : `
This device           output latency ${device.outputLatencyMs.toFixed(1)} ms, frame ${device.frameIntervalMs.toFixed(2)} ms → expected median ${expectedLateMedianMs(device).toFixed(1)} ms, jitter bound ${clampJitterBoundMs(device).toFixed(1)} ms`}
Keep this window uncovered for the whole run: a covered window stalls the animation frames the SDK's
                      main-thread sync and this page's waits ride on (a row's "frame gap max" says if it happened).
Click "Run audit" with a real click — it requests MIDI access and resumes the AudioContext.`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
