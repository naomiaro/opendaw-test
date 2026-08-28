// src/demos/engine/samplerate-audit-debug-demo.tsx
// Unlisted offline-render harness for the sample-rate alignment audit
// (`.superpowers/sdd/2026-08-27-samplerate-alignment-audit/`). Runs the
// selected AuditFamily x bpm x rate cells sequentially:
//   buildAuditScenario -> renderOfflineSlice -> detectOnsets (+ maxStepAround
//   for seam) -> judgeCell -> per-cell WAV upload (if investigate, deadline-bounded) ->
//   table row.
// Completes even if individual cells error; at run end uploads a JSON summary
// (all rows including errors) to the dev server's /__verify sink.
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
// setup -> running:<cell> -> running:<next> -> done (or error:<message>).
// Batch continues on per-cell errors; error rows carry status "error" and errorMessage.
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
import { detectOnsets, maxStepAround, type OnsetOptions } from "@/lib/audit/onsetDetection";
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
/**
 * Families whose content keeps generating audible events past the scenario's
 * last *listed* onset, into `auditBuilders.ts`'s `TAIL_PADDING_SEC` render
 * tail (added so a real click/note's own decay isn't cut off):
 *  - `needsMetronome: true` families (metronome, tempo-ramp, signature,
 *    transport-pos) get a continuous per-beat metronome click that isn't
 *    bounded to the content window at all.
 *  - `loop-wrap`'s timeline loop keeps wrapping through the tail too (one
 *    more note-on at the start of pass 9).
 * At bpm >= 120 (beat <= 500ms, well under `TAIL_PADDING_SEC`=0.5s), that
 * tail is long enough to contain one more full beat/loop, so `detectOnsets`
 * picks up an event `expectedOnsets` never lists — an "extra" onset that
 * fails `judgeCell`'s `missing === 0 && extra === 0` pass condition
 * unconditionally, regardless of tolerance (Task 6 finding, 2026-08-27:
 * reproduced on metronome@120/44100, metronome@120/48000, and
 * loop-wrap@120/48000 — see task-6-report.md). Fix: drop detected onsets
 * beyond the last *unshifted* expected onset (i.e. ignoring
 * `shiftExpectedMs`, a validation-only knob — see module header) plus this
 * guard — comfortably above onset-detector jitter (~1-4 ms measured) and
 * comfortably below the shortest audit beat interval (60/133 bpm =~
 * 451 ms) or loop period (4s at bpm 120), so it only ever strips the
 * tail-padding event, never a real one.
 */
const TAIL_ARTIFACT_FAMILIES: ReadonlySet<AuditFamily> = new Set([
  "metronome",
  "tempo-ramp",
  "signature",
  "transport-pos",
  "loop-wrap",
]);
const TAIL_GUARD_SEC = 0.15;

/**
 * Per-family `detectOnsets` option overrides, empirically tuned in Task 6
 * (2026-08-27, run id 1787877170546) against the plain WASM-engine WAVs —
 * see task-6-report.md for the parameter sweeps.
 *
 * - `loop-wrap`: Vaporisateur's note voice isn't a clean percussive
 *   transient — its envelope keeps rippling above the default `0.05`s
 *   refractory window for ~350-400ms after the true attack (measured on
 *   the note-onsets/loop-wrap content, same instrument/pitch/velocity),
 *   so the default detector re-triggers ~6-7 spurious onsets per real
 *   note. loop-wrap's own onsets are always >= 4s apart (`LOOP_WRAP_BARS`
 *   loop period), so a 0.2s refractory has enormous margin and cleanly
 *   removes every spurious onset without risking a merged real one
 *   (verified: 0.2-2.0s refractory all give the same clean 8/8 match).
 * - `note-onsets`: same ripple issue, but the tightest REAL inter-onset
 *   gap is only 250ms (`NOTE_ONSET_POSITIONS` 1920->2400 PPQN at bpm>=120),
 *   which is inside the ripple's ~350-400ms decay tail — refractory alone
 *   can't separate them without risking a missed close-together pair.
 *   Raising `thresholdRatio` to ignore the (lower-amplitude) ripple rises
 *   works instead: verified clean 10/10 matches, 0 extra, across
 *   thresholdRatio in [0.5, 0.8] x refractorySec in [0.15, 0.2] — 0.6/0.15
 *   is comfortably centered in that working range.
 */
const ONSET_OPTIONS_BY_FAMILY: Partial<Record<AuditFamily, OnsetOptions>> = {
  "loop-wrap": { refractorySec: 0.2 },
  "note-onsets": { thresholdRatio: 0.6, refractorySec: 0.15 },
};

interface AuditRow {
  family: AuditFamily;
  bpm: number;
  rate: number;
  /** "pass" | "investigate" on success, "error" on per-cell failure. */
  status: "pass" | "investigate" | "error";
  expected?: number[];
  onsets?: number[];
  calibrationSec?: number;
  seamStep?: number;
  toleranceSec?: number;
  verdict?: CellVerdict;
  /** Signature family only — recorded for future use, not judged (design ruling). */
  downbeatIndices?: number[];
  /** Error message if status === "error". */
  errorMessage?: string;
  /** True if this cell's WAV was successfully uploaded (investigate cells only). */
  wavUploaded?: boolean;
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
  shiftExpectedMs: number
): Promise<{ row: AuditRow; rendered?: RenderedCell }> {
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
    const rawExpected = expectedOnsets(family, bpm);
    const detected = detectOnsets(channel0, rendered.sampleRate, ONSET_OPTIONS_BY_FAMILY[family]);
    // Drop the tail-padding event for TAIL_ARTIFACT_FAMILIES — see comment
    // above. Bound is the unshifted schedule so the shiftExpectedMs
    // validation knob can't move the cutoff.
    const onsets = TAIL_ARTIFACT_FAMILIES.has(family)
      ? detected.filter((t) => t <= Math.max(...rawExpected) + TAIL_GUARD_SEC)
      : detected;
    const expected = rawExpected.map((t) => t + shiftExpectedMs / 1000);
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

    const row: AuditRow = {
      family,
      bpm,
      rate,
      status: verdict.status,
      expected,
      onsets,
      calibrationSec,
      seamStep,
      toleranceSec,
      verdict,
      downbeatIndices,
    };

    // Return rendered channels for investigate cells so caller can upload WAV
    return {
      row,
      rendered: verdict.status === "investigate" ? rendered : undefined,
    };
  } finally {
    // renderOfflineSlice copies scenarioProject again internally and
    // terminates ITS copy — this terminates the outer copy we made here.
    scenarioProject.terminate();
  }
}

/** Upload a single investigate cell's WAV with a 30s deadline. On failure, records the
 *  error in the row's wavUploaded field but does NOT throw — the run continues. */
async function uploadCellWav(row: AuditRow, rendered: RenderedCell): Promise<void> {
  if (row.status !== "investigate") return; // should not happen, but guard
  const wavBuffer = WavFile.encodeInts16({
    sampleRate: rendered.sampleRate,
    length: rendered.channels[0].length,
    numberOfChannels: rendered.channels.length,
    getChannelData: (i: number) => rendered.channels[i],
  });
  const name = `audit-${row.family}-${bpmToken(row.bpm)}-${row.rate}.wav`;
  try {
    await withDeadline(
      (async () => {
        const res = await fetch(`/__verify/${name}`, { method: "PUT", body: wavBuffer });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      })(),
      30_000,
      `audit WAV upload ${name}`
    );
    row.wavUploaded = true;
  } catch (err) {
    // Record the failure on the row but don't abort the run
    row.wavUploaded = false;
    console.warn(`[audit] WAV upload failed for ${name}:`, err);
  }
}

/** Upload the JSON summary with a 30s deadline. Throws on failure — this is run-level. */
async function uploadSummary(rows: AuditRow[]): Promise<void> {
  const timestamp = Date.now();
  const jsonBody = JSON.stringify(rows, null, 2);
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/audit-${timestamp}.json`, { method: "PUT", body: jsonBody });
      if (!res.ok) {
        throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
      }
    })(),
    30_000,
    "audit JSON summary upload"
  );
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

  const rows: AuditRow[] = [];

  for (const family of families) {
    for (const bpm of bpms) {
      for (const rate of rates) {
        const label = cellKey(family, bpm, rate);
        setAuditState(`running:${label}`);
        try {
          const { row, rendered } = await withDeadline(
            runCell(
              baseProject,
              localAudioBuffers,
              audioContext,
              family,
              bpm,
              rate,
              calibrationMap,
              shiftExpectedMs
            ),
            CELL_DEADLINE_MS,
            `audit cell ${label}`
          );
          rows.push(row);
          onRow(row);

          // Immediately upload investigate cell's WAV (with deadline, non-fatal on failure)
          if (rendered) {
            await uploadCellWav(row, rendered);
          }
        } catch (err) {
          // Cell failed: create an error row and continue to next cell
          const errorRow: AuditRow = {
            family,
            bpm,
            rate,
            status: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
          };
          rows.push(errorRow);
          onRow(errorRow);
          console.error(`[audit] Cell ${label} failed:`, err);
        }
      }
    }
  }

  // Upload the complete summary (with deadline, fatal on failure)
  setAuditState("uploading");
  try {
    await uploadSummary(rows);
  } catch (err) {
    // Summary upload failed — throw to set error:<message> state
    throw new Error(`Summary upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
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

  const passCount = rows.filter((r) => r.verdict?.status === "pass").length;
  const investigateCount = rows.filter((r) => r.verdict?.status === "investigate").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

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
                {errorCount > 0 && `, ${errorCount} error`}
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
                      <Table.Cell>{row.status === "error" ? "—" : row.verdict?.matched}</Table.Cell>
                      <Table.Cell>{row.status === "error" ? "—" : row.verdict?.missing}</Table.Cell>
                      <Table.Cell>{row.status === "error" ? "—" : row.verdict?.extra}</Table.Cell>
                      <Table.Cell>
                        {row.status === "error" ? "—" : ((row.verdict?.maxDeviationSec ?? 0) * 1000).toFixed(2)}
                      </Table.Cell>
                      <Table.Cell>
                        {row.status === "error" ? (
                          <Badge color="red" title={row.errorMessage}>
                            error
                          </Badge>
                        ) : (
                          <Badge color={row.verdict?.status === "pass" ? "green" : "amber"}>{row.verdict?.status}</Badge>
                        )}
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
