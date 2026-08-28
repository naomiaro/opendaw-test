// src/demos/engine/samplerate-audit-debug-demo.tsx
// Unlisted offline-render harness for the sample-rate alignment audit
// (`.superpowers/sdd/2026-08-27-samplerate-alignment-audit/`). Runs the
// selected AuditFamily x bpm x rate cells sequentially:
//   buildAuditScenario -> renderOfflineSlice -> detectOnsets (+ maxStepAround
//   for seam) -> judgeCell -> table row.
// Renders a verdict table and uploads a JSON summary (all rows) plus one WAV
// per "investigate" cell to the dev server's /__verify sink.
//
// URL contract:
//   ?family=<AuditFamily|all>   default "all" — runs every family in
//                                AUDIT_SCENARIOS
//   ?bpm=<number|all>           default "all" — runs every AUDIT_BPMS entry
//   ?rate=<number|all>          default "all" — runs every AUDIT_RATES entry
//   ?calibration=<json>         {family: seconds} bias override, applied via
//                                CellMeasurement.calibrationSec. Overrides the
//                                AUDIT_CALIBRATION defaults imported from
//                                src/lib/audit/auditCalibration.ts.
//   ?shiftExpectedMs=<n>        VALIDATION-ONLY test knob (Task 6): shifts
//                                every expected onset by n ms before judging.
//                                Not a calibration — leave unset for a real
//                                audit run.
//
// DOM contract: #audit-state carries data-audit-state walking
// setup -> running:<cell> -> uploading -> done (or error:<message>).
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Option } from "@opendaw/lib-std";
import { WavFile } from "@opendaw/lib-dsp";
import type { ExportConfiguration } from "@opendaw/studio-adapters";
import type { Project } from "@opendaw/studio-core";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { withDeadline } from "@/lib/deadline";
import {
  AUDIT_SCENARIOS,
  AUDIT_RATES,
  AUDIT_BPMS,
  expectedOnsets,
  expectedDownbeatIndices,
  type AuditFamily,
} from "@/lib/audit/auditExpectations";
import { buildAuditScenario } from "@/lib/audit/auditBuilders";
import { detectOnsets, maxStepAround } from "@/lib/audit/onsetDetection";
import { judgeCell, type CellMeasurement, type CellVerdict } from "@/lib/audit/auditVerdict";
import { AUDIT_CALIBRATION, AUDIT_TOLERANCES, SEAM_THRESHOLDS } from "@/lib/audit/auditCalibration";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Table } from "@radix-ui/themes";

const ALL_FAMILIES = Object.keys(AUDIT_SCENARIOS) as AuditFamily[];
/** Per-cell hang ceiling (see root CLAUDE.md's raceHang pattern) — a wedged
 *  offline render yields `error:<cell>`, not a frozen page. */
const CELL_DEADLINE_MS = 90_000;
/** Seam-family amplitude threshold when SEAM_THRESHOLDS has no entry for the
 *  cell's rate — generous placeholder, tightened by Task 6. */
const SEAM_THRESHOLD_FALLBACK = 0.05;

interface AuditRow {
  family: AuditFamily;
  bpm: number;
  rate: number;
  expected: number[];
  onsets: number[];
  calibrationSec: number;
  seamStep?: number;
  toleranceSec: number;
  verdict: CellVerdict;
  /** Signature family only — recorded for future use, not judged (design ruling). */
  downbeatIndices?: number[];
}

interface RenderedCell {
  channels: Float32Array[];
  sampleRate: number;
}

function isAuditFamily(value: string): value is AuditFamily {
  return (ALL_FAMILIES as string[]).includes(value);
}

function resolveFamilies(param: string | null): AuditFamily[] {
  if (!param || param === "all") return ALL_FAMILIES;
  if (!isAuditFamily(param)) {
    throw new Error(`unknown family "${param}" — use ?family=all|${ALL_FAMILIES.join("|")}`);
  }
  return [param];
}

function resolveNumbers(param: string | null, catalog: readonly number[], name: string): number[] {
  if (!param || param === "all") return [...catalog];
  const n = Number(param);
  if (!Number.isFinite(n)) throw new Error(`invalid ?${name}= "${param}"`);
  return [n];
}

function parseCalibrationOverride(param: string | null): Partial<Record<AuditFamily, number>> {
  if (!param) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(param);
  } catch (e) {
    throw new Error(`invalid ?calibration= JSON: ${String(e)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("?calibration= must decode to a JSON object of {family: seconds}");
  }
  return parsed as Partial<Record<AuditFamily, number>>;
}

/** Filename-safe token for a bpm that may carry a decimal (97.3 -> "97p3") —
 *  the /__verify sink's name regex only accepts [a-z0-9-]+ before the extension. */
function bpmToken(bpm: number): string {
  return String(bpm).replace(".", "p");
}

function cellKey(family: AuditFamily, bpm: number, rate: number): string {
  return `${family}/${bpm}/${rate}`;
}

async function runCell(
  baseProject: Project,
  localAudioBuffers: Map<string, AudioBuffer>,
  audioContext: AudioContext,
  family: AuditFamily,
  bpm: number,
  rate: number,
  calibrationMap: Partial<Record<AuditFamily, number>>,
  shiftExpectedMs: number,
  wavStash: Map<string, RenderedCell>
): Promise<AuditRow> {
  // Fresh scenario project per cell, built on a copy of the pristine base
  // project (never mutated itself) — see task-5-brief.md's cell-execution
  // order. localAudioBuffers is the page-lifetime map initializeOpenDAW was
  // booted with; buildAuditScenario registers fresh-UUID buffers into it so
  // cells never collide.
  const scenarioProject = baseProject.copy();
  try {
    const built = buildAuditScenario(scenarioProject, family, bpm, localAudioBuffers, audioContext);
    const exportConfig = built.needsMetronome
      ? Option.wrap<ExportConfiguration>({ metronome: { includeInMixdown: true } })
      : Option.None;

    const rendered = await renderOfflineSlice(scenarioProject, 0, built.renderSeconds, rate, {
      exportConfig,
      keepLoopEnabled: family === "loop-wrap",
      startPositionPpqn: built.startPositionPpqn,
    });

    // Mono analysis: channel 0 only (design ruling).
    const channel0 = rendered.channels[0];
    const onsets = detectOnsets(channel0, rendered.sampleRate);
    const expected = expectedOnsets(family, bpm).map((t) => t + shiftExpectedMs / 1000);
    const calibrationSec = calibrationMap[family] ?? 0;

    let seamStep: number | undefined;
    let toleranceSec: number;
    if (family === "seam") {
      // The seam sits at bar 1 — the region A/B boundary, 4 quarters at this bpm.
      const seamTimeSec = (4 * 60) / bpm;
      seamStep = maxStepAround(channel0, rendered.sampleRate, seamTimeSec);
      toleranceSec = SEAM_THRESHOLDS[rate] ?? SEAM_THRESHOLD_FALLBACK;
    } else {
      toleranceSec = AUDIT_TOLERANCES[family];
    }

    const measurement: CellMeasurement = { family, bpm, rate, onsets, expected, seamStep, calibrationSec };
    const verdict = judgeCell(measurement, toleranceSec);
    const downbeatIndices = family === "signature" ? expectedDownbeatIndices("signature") : undefined;

    if (verdict.status === "investigate") {
      wavStash.set(cellKey(family, bpm, rate), rendered);
    }

    return { family, bpm, rate, expected, onsets, calibrationSec, seamStep, toleranceSec, verdict, downbeatIndices };
  } finally {
    // renderOfflineSlice copies scenarioProject again internally and
    // terminates ITS copy — this terminates the outer copy we made here.
    scenarioProject.terminate();
  }
}

async function uploadResults(rows: AuditRow[], wavStash: Map<string, RenderedCell>): Promise<void> {
  const timestamp = Date.now();
  const jsonBody = JSON.stringify(rows, null, 2);
  const jsonRes = await fetch(`/__verify/audit-${timestamp}.json`, { method: "PUT", body: jsonBody });
  if (!jsonRes.ok) {
    throw new Error(`verify sink rejected JSON upload: HTTP ${jsonRes.status}`);
  }

  for (const row of rows) {
    if (row.verdict.status !== "investigate") continue;
    const rendered = wavStash.get(cellKey(row.family, row.bpm, row.rate));
    if (!rendered) continue; // stashed at judge time in runCell — should always be present
    const wavBuffer = WavFile.encodeInts16({
      sampleRate: rendered.sampleRate,
      length: rendered.channels[0].length,
      numberOfChannels: rendered.channels.length,
      getChannelData: (i: number) => rendered.channels[i],
    });
    const name = `audit-${row.family}-${bpmToken(row.bpm)}-${row.rate}.wav`;
    const res = await fetch(`/__verify/${name}`, { method: "PUT", body: wavBuffer });
    if (!res.ok) {
      throw new Error(`verify sink rejected wav upload (${name}): HTTP ${res.status}`);
    }
  }
}

async function runAudit(
  setAuditState: (s: string) => void,
  onRow: (row: AuditRow) => void
): Promise<void> {
  setAuditState("setup");
  const localAudioBuffers = new Map<string, AudioBuffer>();
  const { project: baseProject, audioContext } = await initializeOpenDAW({ localAudioBuffers, bpm: 120 });

  const params = new URLSearchParams(window.location.search);
  const families = resolveFamilies(params.get("family"));
  const bpms = resolveNumbers(params.get("bpm"), AUDIT_BPMS, "bpm");
  const rates = resolveNumbers(params.get("rate"), AUDIT_RATES, "rate");
  const calibrationOverride = parseCalibrationOverride(params.get("calibration"));
  const calibrationMap: Partial<Record<AuditFamily, number>> = { ...AUDIT_CALIBRATION, ...calibrationOverride };
  const shiftExpectedMsParam = params.get("shiftExpectedMs");
  const shiftExpectedMs = shiftExpectedMsParam ? Number(shiftExpectedMsParam) : 0;
  if (!Number.isFinite(shiftExpectedMs)) {
    throw new Error(`invalid ?shiftExpectedMs= "${shiftExpectedMsParam}"`);
  }

  const wavStash = new Map<string, RenderedCell>();
  const rows: AuditRow[] = [];

  for (const family of families) {
    for (const bpm of bpms) {
      for (const rate of rates) {
        const label = cellKey(family, bpm, rate);
        setAuditState(`running:${label}`);
        const row = await withDeadline(
          runCell(
            baseProject,
            localAudioBuffers,
            audioContext,
            family,
            bpm,
            rate,
            calibrationMap,
            shiftExpectedMs,
            wavStash
          ),
          CELL_DEADLINE_MS,
          `audit cell ${label}`
        );
        rows.push(row);
        onRow(row);
      }
    }
  }

  setAuditState("uploading");
  await uploadResults(rows, wavStash);
  setAuditState("done");
}

function AuditHarness() {
  const [auditState, setAuditState] = useState("idle");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runAudit(setAuditState, (row) => setRows((prev) => [...prev, row])).catch((err) => {
      console.error("[samplerate-audit]", err);
      setAuditState(`error:${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);

  const passCount = rows.filter((r) => r.verdict.status === "pass").length;
  const investigateCount = rows.length - passCount;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Sample-Rate Alignment Audit Harness
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
              <Text size="2" color="gray">
                {rows.length} cell{rows.length === 1 ? "" : "s"} — {passCount} pass, {investigateCount} investigate
              </Text>
            </Flex>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>family</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>bpm</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>rate</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>matched</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>missing</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>extra</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>maxDev (ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>status</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => (
                    <Table.Row key={cellKey(row.family, row.bpm, row.rate)}>
                      <Table.Cell>{row.family}</Table.Cell>
                      <Table.Cell>{row.bpm}</Table.Cell>
                      <Table.Cell>{row.rate}</Table.Cell>
                      <Table.Cell>{row.verdict.matched}</Table.Cell>
                      <Table.Cell>{row.verdict.missing}</Table.Cell>
                      <Table.Cell>{row.verdict.extra}</Table.Cell>
                      <Table.Cell>{(row.verdict.maxDeviationSec * 1000).toFixed(2)}</Table.Cell>
                      <Table.Cell>
                        <Badge color={row.verdict.status === "pass" ? "green" : "amber"}>{row.verdict.status}</Badge>
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
              {`?family=<AuditFamily|all>   default "all" (${ALL_FAMILIES.join(", ")})
?bpm=<number|all>          default "all" (${AUDIT_BPMS.join(", ")})
?rate=<number|all>         default "all" (${AUDIT_RATES.join(", ")})
?calibration=<json>        {family: seconds} bias override (default: AUDIT_CALIBRATION)
?shiftExpectedMs=<n>       validation-only: shifts every expected onset by n ms
Cell deadline:              ${CELL_DEADLINE_MS / 1000}s
Uploads:                     audit-<timestamp>.json (all rows) via PUT /__verify
                              audit-<family>-<bpm>-<rate>.wav for every "investigate" cell`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<AuditHarness />);
