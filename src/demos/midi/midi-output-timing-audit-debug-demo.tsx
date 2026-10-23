// Unlisted audit page: WHEN the SDK asks a hardware MIDI output to deliver each note, judged on
// the AudioContext clock over the macOS IAC Driver. Two arms per cell: the ENGINE arm (the SDK's
// MIDI Output instrument playing a note region through the installed path) and the PAGE arm (the
// same pattern sent by the page at the heard times, the control that proves the bus and the clock
// mapping). Per note: receipt stamp mapped to the heard context clock minus the heard context time
// of the note's position, raw. On the IAC bus a receipt carries the time the sender ASKED for, so the
// figure is what the SDK requested, never delivery.
//
//   midi-output-timing-audit-debug-demo.html?arm=both|engine|page&bpm=<n|all>&density=32nd|8th|both
//     &bars=<1-8>&repeats=<1-10>&delay=<0-500>&jank=none|mid|both&jankMs=<10-500>&transport=1|0|both
//     &origin=<1-8>&bus=<substring>
//
// Library: src/lib/audit/midiOutput*.ts; table: node scripts/audit/midi-output-timing/table.ts;
// register: debug/2026-10-23-midi-output-timing/note.md. `#audit-state[data-audit-state]` walks
// setup → running:<cell> → done | error:<message>. A real click on Run; the IAC Driver online.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { MidiDevices, type Project } from "@opendaw/studio-core";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import { detectBuildFeatures } from "@/lib/audit/buildFeatures";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { runRepeatWithDeadline } from "@/lib/audit/recordingCellRunner";
import { FrameWatch } from "@/lib/audit/midiInputCellRunner";
import { MidiLoopbackSender, pickIacPorts } from "@/lib/audit/midiLoopback";
import { parseMidiOutputParams, repeatDeadlineMs, type MidiOutputParams, type OutputArm } from "@/lib/audit/midiOutputParams";
import { buildOutputProject, type OutputProjectState } from "@/lib/audit/midiOutputProject";
import { emptyRepeatRow, runOutputRepeat } from "@/lib/audit/midiOutputCellRunner";
import { classifyEngineCell, classifyPageCell, type OutputVerdict } from "@/lib/audit/midiOutputVerdict";
import {
  MIDI_OUTPUT_SCHEMA_VERSION, summaryFileName,
  type MidiOutputSummary, type OutputCellKey, type OutputCellRecord, type OutputRepeatRow,
} from "@/lib/audit/midiOutputArtifacts";
import { browserOf } from "@/lib/audit/chromiumWatched";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar, type DebugLink } from "@/components/DebugLinkBar";

const AUDIT_LINKS: DebugLink[] = [
  {
    label: "debug/2026-10-23-midi-output-timing/note.md",
    href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-23-midi-output-timing/note.md",
    kind: "note",
  },
  { label: "openDAW#356 (hardware MIDI output desynced)", href: "https://github.com/andremichelle/openDAW/issues/356", kind: "note" },
  {
    label: "openDAW plans/capture.md (the rewrite's clock principle)",
    href: "https://github.com/andremichelle/openDAW/blob/fe6910fae9e432759e24ebddbbe774db17249535/plans/capture.md",
    kind: "note",
  },
  { label: "MIDI input alignment audit", href: "/midi-input-alignment-audit-debug-demo.html?scenario=nominal-start&bpm=120", kind: "note" },
];

type Config = { params: MidiOutputParams; error: null } | { params: null; error: string };

function readConfig(): Config {
  try {
    return { params: parseMidiOutputParams(new URLSearchParams(window.location.search)), error: null };
  } catch (err) {
    return { params: null, error: err instanceof Error ? err.message : String(err) };
  }
}
const CONFIG = readConfig();

interface MatrixContext {
  project: Project;
  audioContext: AudioContext;
  loopback: MidiLoopbackSender;
  state: OutputProjectState;
  portId: string;
  busName: string;
}

async function createMatrixContext(params: MidiOutputParams): Promise<MatrixContext> {
  const { project, audioContext } = await initializeOpenDAW({ bpm: params.bpms[0] });
  const buildFeatures = detectBuildFeatures(project.engine);
  if (!buildFeatures.includes("recordingStart")) {
    throw new Error("this build has no engine.recordingStart; the output audit cannot anchor a repeat");
  }
  await withDeadline(MidiDevices.requestPermission(), 30_000, "MIDI access");
  const picked = pickIacPorts(MidiDevices.inputDevices(), MidiDevices.outputDevices(), params.bus);
  if ("error" in picked) throw new Error(picked.error);
  const input = MidiDevices.findInputDeviceById(picked.inputId).unwrap("IAC input vanished");
  const output = MidiDevices.findOutputDeviceById(picked.outputId).unwrap("IAC output vanished");
  const loopback = new MidiLoopbackSender(output, input);
  const state = buildOutputProject(project, { id: output.id, name: output.name }, params.delayInMs, params.transports[0]);
  console.log(`[midi-output-audit] bus="${picked.name}" output=${picked.outputId} input=${picked.inputId}, buildFeatures=[${buildFeatures.join(",")}]`);
  return { project, audioContext, loopback, state, portId: picked.outputId, busName: picked.name };
}

// Booted once per page load (`Workers.install` asserts on a second call); a failed boot stays failed — reload.
let matrixContextPromise: Promise<MatrixContext> | null = null;
function getMatrixContext(params: MidiOutputParams): Promise<MatrixContext> {
  if (matrixContextPromise === null) matrixContextPromise = createMatrixContext(params);
  return matrixContextPromise;
}

export interface PageRow extends OutputRepeatRow {
  key: OutputCellKey;
  status: OutputVerdict["status"] | "pending" | "error";
  detail: string;
}

const cellLabel = (key: OutputCellKey, repeat: number): string =>
  `${key.arm}/${key.bpm}/${key.density}/${key.jank}/${key.transport ? "transport" : "no-transport"}/r${repeat}`;

const tupleKey = (key: Omit<OutputCellKey, "arm">): string => `${key.bpm}/${key.density}/${key.jank}/${key.transport}`;

async function runAudit(params: MidiOutputParams, setAuditState: (s: string) => void, onRows: (rows: PageRow[]) => void): Promise<void> {
  setAuditState("setup");
  const runToken = Date.now();
  const { project, audioContext, loopback, state, portId, busName } = await getMatrixContext(params);
  const sampleRate = audioContext.sampleRate;
  const allRows: PageRow[] = [];
  const cells: OutputCellRecord[] = [];
  const verdictsByTuple = new Map<string, OutputVerdict>();
  const armsInOrder: OutputArm[] = (["page", "engine"] as const).filter((arm) => params.arms.includes(arm));
  let hiddenCount = 0;
  const onVisibility = (): void => { if (document.visibilityState !== "visible") hiddenCount++; };
  document.addEventListener("visibilitychange", onVisibility);
  try {
    for (const bpm of params.bpms) {
      for (const density of params.densities) {
        for (const jank of params.janks) {
          for (const transport of params.transports) {
            const tuple = { bpm, density, jank, transport };
            const rowsByArm = new Map<OutputArm, PageRow[]>(armsInOrder.map((arm) => [arm, []]));
            // The page arm runs first in each repeat, then the engine arm, so the control and the figure share conditions.
            for (let repeat = 1; repeat <= params.repeats; repeat++) {
              for (const arm of armsInOrder) {
                const key: OutputCellKey = { arm, ...tuple };
                const label = cellLabel(key, repeat);
                setAuditState(`running:${label}`);
                const frameWatch = new FrameWatch();
                const hiddenBefore = hiddenCount;
                let row: OutputRepeatRow;
                try {
                  row = await runRepeatWithDeadline(
                    (token) => runOutputRepeat({ project, audioContext, loopback, state, portId, key, params, repeat, token, frameWatch, onStage: () => {} }),
                    repeatDeadlineMs({ bpm, density, bars: params.bars, originBar: params.originBar }),
                    label,
                  );
                } catch (err) {
                  const gaps = frameWatch.stop();
                  row = emptyRepeatRow(repeat, 0, 0, params.delayInMs, sampleRate, jank === "mid" ? params.jankMs : null);
                  row.error = `deadline: ${err instanceof Error ? err.message : String(err)}`;
                  row.frameIntervalMs = gaps.medianMs;
                  row.frameGapMaxMs = gaps.maxGapMs;
                }
                if (row.error !== null && (hiddenCount > hiddenBefore || document.visibilityState !== "visible")) {
                  row.error += " [the page was hidden during this repeat — not an SDK finding]";
                }
                if (row.error !== null) console.error(`[midi-output-audit] ${label} failed: ${row.error}`);
                const pageRow: PageRow = { ...row, key, status: row.error === null ? "pending" : "error", detail: row.error ?? "" };
                rowsByArm.get(arm)?.push(pageRow);
                allRows.push(pageRow);
                onRows([...allRows]);
              }
            }
            // Verdicts per tuple: the page cell first, the engine cell against it.
            const pageRows = rowsByArm.get("page") ?? [];
            const pageFigures = pageRows.filter((r) => r.error === null);
            let pageVerdict: OutputVerdict | null = null;
            if (armsInOrder.includes("page")) {
              pageVerdict = pageFigures.length === params.repeats
                ? classifyPageCell(pageFigures)
                : { status: "investigate", detail: `${params.repeats - pageFigures.length} of ${params.repeats} page repeats failed` };
              verdictsByTuple.set(tupleKey(tuple), pageVerdict);
              finishCell(pageRows, { arm: "page", ...tuple }, pageVerdict, cells);
            }
            if (armsInOrder.includes("engine")) {
              const engineRows = rowsByArm.get("engine") ?? [];
              const engineFigures = engineRows.filter((r) => r.error === null);
              const verdict = engineFigures.length === params.repeats
                ? classifyEngineCell(engineFigures, pageVerdict, { delayInMs: params.delayInMs, jankMs: params.jankMs, jankActive: jank === "mid", sampleRate })
                : { status: "investigate" as const, detail: `${params.repeats - engineFigures.length} of ${params.repeats} engine repeats failed` };
              finishCell(engineRows, { arm: "engine", ...tuple }, verdict, cells);
            }
            onRows([...allRows]);
          }
        }
      }
    }
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
  }

  const summary: MidiOutputSummary = {
    schemaVersion: MIDI_OUTPUT_SCHEMA_VERSION,
    runToken,
    sdkVersion: OPENDAW_SDK_VERSION,
    chrome: browserOf(navigator),
    date: new Date().toISOString().slice(0, 10),
    sampleRate,
    params,
    cells,
  };
  console.log(`[midi-output-audit] bus="${busName}", ${cells.length} cells, ${allRows.length} rows`);
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/${summaryFileName(runToken)}`, { method: "PUT", body: JSON.stringify(summary, null, 2) });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "summary upload",
  );
  console.log(`[midi-output-audit] summary ${summaryFileName(runToken)} uploaded`);
  setAuditState("done");
}

function finishCell(rows: PageRow[], key: OutputCellKey, verdict: OutputVerdict, cells: OutputCellRecord[]): void {
  for (const row of rows) {
    if (row.status === "error") continue;
    row.status = verdict.status;
    row.detail = verdict.detail;
  }
  cells.push({
    ...key,
    status: verdict.status,
    detail: verdict.detail,
    repeats: rows.map(({ key: _key, status: _status, detail: _detail, ...repeat }) => repeat),
  });
  console.log(`[midi-output-audit] cell ${cellLabel(key, 0).replace(/\/r0$/, "")}: ${verdict.status} — ${verdict.detail}`);
}

const ms = (v: number | null): string => (v === null ? "—" : v.toFixed(2));

function statusColor(status: PageRow["status"]): "green" | "blue" | "red" | "gray" | "amber" {
  switch (status) {
    case "bus-true":
    case "on-time":
      return "green";
    case "matches-known-defect":
      return "blue";
    case "error":
      return "red";
    case "pending":
    case "not-judged":
      return "gray";
    case "investigate":
      return "amber";
  }
}

function Harness({ params }: { params: MidiOutputParams }) {
  const [auditState, setAuditState] = useState("idle");
  const [rows, setRows] = useState<PageRow[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    setStarted(true);
    setRows([]);
    runAudit(params, setAuditState, setRows)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[midi-output-audit] run error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running, params]);

  const count = (status: PageRow["status"]): number => rows.filter((r) => r.status === status).length;

  return (
    <Flex direction="column" gap="4">
      <Heading size="7" align="center">MIDI Output Timing Audit</Heading>
      <Text size="1" color="gray" align="center">
        Where the SDK asks a hardware MIDI output to deliver each note, against the heard context time of its position; nothing netted.
        The page arm is the control and must read <code>bus-true</code> before the engine arm's figure can be read. On the IAC bus a
        receipt carries the time the sender asked for: the figure is what the SDK requested, never physical delivery.
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
            {rows.length} row{rows.length === 1 ? "" : "s"} — {count("bus-true")} bus-true, {count("on-time")} on-time,{" "}
            {count("matches-known-defect")} known-defect, {count("investigate")} investigate, {count("not-judged")} not-judged
            {count("error") > 0 && `, ${count("error")} error`}
          </Text>
        </Flex>
        <Text size="1" color="gray" style={{ display: "block", marginTop: "0.5rem" }}>
          arms {params.arms.join("+")} · bpm {params.bpms.join(",")} · density {params.densities.join(",")} · bars {params.bars} · repeats {params.repeats} ·
          delay {params.delayInMs} ms · jank {params.janks.join(",")} {params.jankMs} ms · transport {params.transports.map((t) => (t ? "on" : "off")).join(",")} ·
          origin bar {params.originBar} · bus {params.bus}
        </Text>
      </Card>

      <Card>
        <div style={{ overflowX: "auto" }}>
          <Table.Root size="1">
            <Table.Header>
              <Table.Row>
                {["arm", "bpm", "density", "jank", "transport", "rep", "status", "median ms", "max dev ms", "late tail ms", "p5–p95 ms",
                  "inside blocks (n / median ms)", "live median ms", "live max dev ms", "pair drift ms", "miss", "extra", "stuck", "vel", "transport msgs",
                  "delay ms", "out lat ms", "heard lag ms", "frame ms", "frame gap max ms", "detail"]
                  .map((h) => <Table.ColumnHeaderCell key={h}>{h}</Table.ColumnHeaderCell>)}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={cellLabel(r.key, r.repeat)}>
                  <Table.Cell>{r.key.arm}</Table.Cell>
                  <Table.Cell>{r.key.bpm}</Table.Cell>
                  <Table.Cell>{r.key.density}</Table.Cell>
                  <Table.Cell>{r.key.jank}</Table.Cell>
                  <Table.Cell>{r.key.transport ? "on" : "off"}</Table.Cell>
                  <Table.Cell>{r.repeat}</Table.Cell>
                  <Table.Cell><Badge color={statusColor(r.status)}>{r.status}</Badge></Table.Cell>
                  <Table.Cell>{ms(r.medianErrorMs)}</Table.Cell>
                  <Table.Cell>{ms(r.maxAbsDevMs)}</Table.Cell>
                  <Table.Cell>{ms(r.lateTailMs)}</Table.Cell>
                  <Table.Cell>{ms(r.p5p95WidthMs)}</Table.Cell>
                  <Table.Cell>{r.notesInsideBlocks} / {ms(r.medianErrorInsideBlocksMs)}</Table.Cell>
                  <Table.Cell>{ms(r.medianErrorLiveMs)}</Table.Cell>
                  <Table.Cell>{ms(r.maxAbsDevLiveMs)}</Table.Cell>
                  <Table.Cell>{r.pairDrift === null ? "—" : `${ms(r.pairDrift.driftMinMs)}..${ms(r.pairDrift.driftMaxMs)}`}</Table.Cell>
                  <Table.Cell>{r.missing}</Table.Cell>
                  <Table.Cell>{r.extra}</Table.Cell>
                  <Table.Cell>{r.stuck}</Table.Cell>
                  <Table.Cell>{r.velocityMismatches}</Table.Cell>
                  <Table.Cell>{r.transportMessages}</Table.Cell>
                  <Table.Cell>{r.delayInMs}</Table.Cell>
                  <Table.Cell>{ms(r.outputLatencyMs)}</Table.Cell>
                  <Table.Cell>{ms(r.heardLagMs)}</Table.Cell>
                  <Table.Cell>{ms(r.frameIntervalMs)}</Table.Cell>
                  <Table.Cell>{ms(r.frameGapMaxMs)}</Table.Cell>
                  <Table.Cell style={{ maxWidth: 360, whiteSpace: "pre-wrap" }}>{r.detail}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </div>
      </Card>
    </Flex>
  );
}

const Page: React.FC = () => (
  <Theme appearance="dark" accentColor="amber">
    <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
      <GitHubCorner />
      <BackLink />
      <DebugLinkBar links={AUDIT_LINKS} />
      {CONFIG.params === null ? (
        <Flex direction="column" gap="3">
          <Heading size="7" align="center">MIDI Output Timing Audit</Heading>
          <Text id="audit-state" data-audit-state={`error:${CONFIG.error}`} size="2" color="red">{CONFIG.error}</Text>
        </Flex>
      ) : (
        <Harness params={CONFIG.params} />
      )}
      <MoisesLogo />
    </Container>
  </Theme>
);

const root = createRoot(document.getElementById("root")!);
root.render(<Page />);
