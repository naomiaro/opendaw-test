// Export Regression Audit: unlisted page.
//
//   export-regression-audit-debug-demo.html[?rate=48000|44100][&uuid=descending][&fill=1][&rows=<id,id>|&group=<group>][&failAt=<rowId>]
//
// Each row renders a copy of one project through one SDK export path, is held to its invariants, and is compared
// with the accepted register. The page converts and uploads; the rows, the reader, the verdict and the artifacts are
// in `src/lib/audit/exportRegression*.ts`. DOM contract: #audit-state carries data-audit-state walking
// setup → ready → running:<row> → done | error:<message>, and data-standing-counts with clean,known,failing,errored.
// A row that fails on its own is an errored row under `done`; only a broken harness ends in `error:`.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import { GitHubCorner } from "@/components/GitHubCorner";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { installUuidOrder, type UuidNamespace } from "@/lib/audit/ascendingUuids";
import { uploadSummary } from "@/lib/audit/midiEffectBootstrap";
import { resolveRate } from "@/lib/audit/midiEffectScenarios";
import {
  EXPORT_REGRESSION_SCHEMA_VERSION, parseExportRegister, summaryFileName, wavFileName, type ExportRegister, type ExportSummary, type LatencyRead, type RowRecord,
} from "@/lib/audit/exportRegressionArtifacts";
import { renderPath } from "@/lib/audit/exportRegressionPaths";
import { buildHarnessProject, insertLatencyDevices, prepareSources, type HarnessProject } from "@/lib/audit/exportRegressionProject";
import { readRender, sha256OfSamples, type RenderRead } from "@/lib/audit/exportRegressionReader";
import { buildRows, expectedLatencyFrames, lastReaders, selectRows, type ExportRow, type LatencyCaseId } from "@/lib/audit/exportRegressionRows";
import {
  compareRegister, judgeInvariants, parseRegisterResponse, rowStanding, type InvariantResult, type RegisterVerdict, type RenderedRow,
} from "@/lib/audit/exportRegressionVerdict";
import { encodeFloatWav } from "@/lib/audit/exportRegressionWav";
import "@radix-ui/themes/styles.css";
import { Badge, Button, Callout, Card, Code, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Before anything can make a unit: their UUIDs set the summing order, and with it a mixdown's last bits.
installUuidOrder(UUID as unknown as UuidNamespace, new URLSearchParams(window.location.search).get("uuid") === "descending" ? "descending" : "ascending");

const params = new URLSearchParams(window.location.search);
const UUID_ORDER = params.get("uuid") === "descending" ? "descending" : "ascending";
const FILL = params.get("fill") === "1";
const FAIL_AT = params.get("failAt");

let PARAM_ERROR: string | null = null;
let RATE = 48000;
let ROWS: ExportRow[] = [];
try {
  const uuid = params.get("uuid");
  if (uuid !== null && uuid !== "descending" && uuid !== "ascending") throw new Error(`invalid ?uuid= "${uuid}": ascending or descending`);
  RATE = resolveRate(params.get("rate"));
  ROWS = selectRows(buildRows(RATE), { rows: params.get("rows"), group: params.get("group") });
  if (FAIL_AT !== null && !ROWS.some((row) => row.id === FAIL_AT)) throw new Error(`?failAt= names a row this run does not render: ${FAIL_AT}`);
} catch (error) {
  PARAM_ERROR = error instanceof Error ? error.message : String(error);
}

const rowsParamOf = (): string => {
  const rows = params.get("rows");
  if (rows !== null) return `rows=${rows}`;
  const group = params.get("group");
  return group !== null ? `group=${group}` : "all";
};

const NOTE_URL = "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md";
const REGISTER_PATH = `/debug/2026-11-06-export-regression/register/${RATE}.json`;
const ENGINE_WASM_PATH = "/wasm-engine/wasm/engine.wasm";
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const BOOT_BPM = 120;
const FETCH_DEADLINE_MS = 30_000;
const UPLOAD_DEADLINE_MS = 30_000;
const LATENCY_DEADLINE_MS = 5_000;
const LATENCY_POLL_MS = 50;

type Boot = {
  harness: HarnessProject;
  audioContext: AudioContext;
  register: ExportRegister | null;
  engineWasmSha256: string;
};

/** Only a 404 or the host's HTML fallback means there is none: anything else that is not this rate's register ends the run. */
const fetchRegister = async (): Promise<ExportRegister | null> => {
  const response = await withDeadline(fetch(REGISTER_PATH), FETCH_DEADLINE_MS, "fetching the register");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`register: ${REGISTER_PATH} answers HTTP ${response.status}`);
  const body = await withDeadline(response.text(), FETCH_DEADLINE_MS, "reading the register");
  try {
    const parsed = parseRegisterResponse(response.headers.get("content-type"), body);
    if (parsed === null) return null;
    const register = parseExportRegister(parsed);
    if (register.sampleRate !== RATE) throw new Error(`it is at ${register.sampleRate} Hz, this run at ${RATE} Hz`);
    return register;
  } catch (error) {
    throw new Error(`register ${REGISTER_PATH}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

/** The fallback page answers 200 too, and its hash would name no engine. */
const hashEngineWasm = async (): Promise<string> => {
  const response = await withDeadline(fetch(ENGINE_WASM_PATH), FETCH_DEADLINE_MS, "fetching the engine");
  if (!response.ok) throw new Error(`${ENGINE_WASM_PATH} answers HTTP ${response.status}`);
  const bytes = await withDeadline(response.arrayBuffer(), FETCH_DEADLINE_MS, "reading the engine");
  const head = new Uint8Array(bytes, 0, Math.min(WASM_MAGIC.length, bytes.byteLength));
  if (!WASM_MAGIC.every((byte, i) => head[i] === byte)) throw new Error(`${ENGINE_WASM_PATH} is not a WebAssembly file`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// A context left at its default takes the output device's rate; closed at once, it plays nothing.
// Null when it cannot be read: the renders do not depend on it, so it must not cost the run.
const readDeviceRate = async (): Promise<number | null> => {
  try {
    const probe = new AudioContext();
    const rate = probe.sampleRate;
    await withDeadline(probe.close(), LATENCY_DEADLINE_MS, "closing the device-rate probe");
    return rate;
  } catch (error) {
    console.warn("Could not read the device rate: " + String(error));
    return null;
  }
};

const framesReported = ({ project }: HarnessProject): number => Math.round(project.engine.compensationLatency.getValue() * RATE);

/** What the engine reports once it reads `expected`, or at the deadline whatever it reads then. */
const waitForFrames = async (harness: HarnessProject, expected: number): Promise<number> => {
  const started = performance.now();
  while (performance.now() - started < LATENCY_DEADLINE_MS) {
    if (framesReported(harness) === expected) return expected;
    await new Promise((resolve) => setTimeout(resolve, LATENCY_POLL_MS));
  }
  return framesReported(harness);
};

/**
 * The figure of one case on the live engine, NaN when none could be read; a figure off its expectation is what
 * `latency-as-expected` reads on the case's rows, and neither ends the run. The engine must first read 0: two cases
 * can expect the same figure, and the case before this one's would otherwise pass for this one's.
 */
const readCaseLatency = async (harness: HarnessProject, latencyCase: LatencyCaseId): Promise<number> => {
  const unsettled = await waitForFrames(harness, 0);
  if (unsettled !== 0) {
    console.error(`[export-regression] ${latencyCase}: no reading, the engine still reports ${unsettled} frames with no latent device`);
    return NaN;
  }
  const inserting = insertLatencyDevices(harness.project, harness, latencyCase);
  let remove: () => void;
  try {
    remove = await withDeadline(inserting, LATENCY_DEADLINE_MS, `inserting the devices of ${latencyCase}`);
  } catch (error) {
    console.error(`[export-regression] ${latencyCase}: no reading: ${String(error)}`);
    // Past the deadline the insert is still running: the devices it finishes with must not stay on the live project.
    inserting.then((late) => late(), () => {});
    return NaN;
  }
  try {
    return await waitForFrames(harness, expectedLatencyFrames(latencyCase, RATE));
  } finally {
    remove();
  }
};

/** A failed upload is on the row, `wavUploaded: false`: it says nothing about the render and must not stop a run. */
const uploadWav = async (fileName: string, channels: readonly Float32Array[]): Promise<boolean> => {
  try {
    const put = fetch(`/__verify/${fileName}`, { method: "PUT", body: encodeFloatWav(channels, RATE) });
    const response = await withDeadline(put, UPLOAD_DEADLINE_MS, `uploading ${fileName}`);
    if (response.ok) return true;
    if (response.status === 404 || response.status === 405) console.warn(`[export-regression] ${fileName} not uploaded: no /__verify sink on this host (HTTP ${response.status})`);
    else console.error(`[export-regression] ${fileName} not uploaded: HTTP ${response.status}`);
  } catch (error) {
    console.error(`[export-regression] ${fileName} not uploaded: ${String(error)}`);
  }
  return false;
};

const STANDING_COLOR: Record<RowRecord["standing"], "green" | "amber" | "red"> = {
  clean: "green",
  "known-finding": "amber",
  failing: "red",
  errored: "red",
};

const standingCounts = (records: readonly RowRecord[]): number[] =>
  (["clean", "known-finding", "failing", "errored"] as const).map((standing) => records.filter((row) => row.standing === standing).length);

const failingText = ({ invariant, finding, detail }: InvariantResult): string =>
  `${invariant}${finding === null ? "" : ` (${finding})`}: ${detail}`;

const recordFigure = (record: RowRecord): string => {
  if (record.error !== null) return record.error;
  const failing = record.invariants.filter((result) => !result.holds).map(failingText);
  return failing.length > 0 ? failing.join("; ") : "—";
};

const App: React.FC = () => {
  const [status, setStatus] = useState(PARAM_ERROR === null ? "Loading..." : `Error: ${PARAM_ERROR}`);
  const [auditState, setAuditState] = useState(PARAM_ERROR === null ? "setup" : `error:${PARAM_ERROR}`);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [running, setRunning] = useState(false);
  const [records, setRecords] = useState<RowRecord[]>([]);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  useEffect(() => {
    if (PARAM_ERROR !== null) return;
    let mounted = true;
    (async () => {
      const { project, audioContext } = await initializeOpenDAW({
        localAudioBuffers: buffersRef.current,
        bpm: BOOT_BPM,
        audioContextSampleRate: RATE,
        onStatusUpdate: setStatus,
      });
      const [register, engineWasmSha256] = await Promise.all([fetchRegister(), hashEngineWasm()]);
      return { harness: buildHarnessProject(project, UUID_ORDER), audioContext, register, engineWasmSha256 };
    })()
      .then((booted) => {
        if (!mounted) return;
        setBoot(booted);
        setAuditState("ready");
        setStatus("Ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to initialize: " + message);
        if (mounted) {
          setStatus(`Error: ${message}`);
          setAuditState(`error:${message}`);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const runAudit = useCallback(async ({ harness, audioContext, register, engineWasmSha256 }: Boot): Promise<void> => {
    const runToken = Date.now();
    const out: RowRecord[] = [];
    const deviceRateHz = await readDeviceRate();
    // The live engine reports latency only while its context runs. Nothing plays.
    await withDeadline(audioContext.resume(), FETCH_DEADLINE_MS, "resuming the context");
    await prepareSources(harness, ROWS, audioContext, buffersRef.current);

    // Read once per case, not per row: a row adds a bed or a Reverb, or takes the master Maximizer off, and none of
    // that changes the routing a case's figure comes from. A disabled row is not read: its hash is what it proves.
    const latencies = new Map<LatencyCaseId, number>();
    const latencyReads: LatencyRead[] = [];
    for (const { latencyCase } of ROWS.filter((row) => row.invariants.includes("latency-as-expected"))) {
      if (latencies.has(latencyCase)) continue;
      setAuditState(`running:latency-${latencyCase}`);
      setStatus(`Reading the latency of ${latencyCase}`);
      const frames = await readCaseLatency(harness, latencyCase);
      latencies.set(latencyCase, frames);
      latencyReads.push({ latencyCase, frames: Number.isFinite(frames) ? frames : null, visibility: document.visibilityState });
    }
    // The devices came off the live project, which every copy starts from: a figure that stays up says they did not.
    const lastRead = latencyReads.at(-1);
    if (lastRead !== undefined) {
      const left = await waitForFrames(harness, 0);
      if (left !== 0) throw new Error(`the engine still reports ${left} frames after the devices of ${lastRead.latencyCase} came off the live project`);
    }

    const readers = lastReaders(ROWS);
    const rendered = new Map<string, RenderedRow>();
    for (const [index, row] of ROWS.entries()) {
      setAuditState(`running:${row.id}`);
      setStatus(`Rendering: ${row.label}`);
      const reported = row.invariants.includes("latency-as-expected") ? latencies.get(row.latencyCase) ?? NaN : NaN;
      const started = performance.now();
      let renderMs = 0;
      let read: RenderRead | null = null;
      let invariants: InvariantResult[] = [];
      let registerVerdict: RegisterVerdict | null = null;
      let shiftFrames: number | null = null;
      let wavUploaded = false;
      let error: string | null = null;
      try {
        if (row.id === FAIL_AT) throw new Error(`?failAt= names this row`);
        const channels = await renderPath(harness, row, RATE);
        renderMs = performance.now() - started;
        read = await readRender(channels, { rangeFrames: Math.round(row.rangeSeconds * RATE), pageRate: RATE });
        const repeatHash = row.repeat ? await sha256OfSamples(await renderPath(harness, row, RATE)) : null;
        const thisRow: RenderedRow = { read, samples: channels, reportedLatencyFrames: reported, repeatHash };
        const refOf = (id: string | null): RenderedRow | null => (id === null ? null : rendered.get(id) ?? null);
        invariants = judgeInvariants(row, thisRow, { reference: refOf(row.referenceId), noLatency: refOf(row.noLatencyReferenceId), warm: refOf(row.warmReferenceId) }, RATE);
        const compared = compareRegister(read, register?.rows[row.id] ?? null);
        registerVerdict = compared.verdict;
        shiftFrames = compared.shiftFrames;
        if (compared.verdict !== "identical" || FILL) wavUploaded = await uploadWav(wavFileName(runToken, row.id), channels);
        if (readers.has(row.id)) rendered.set(row.id, thisRow);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        renderMs = performance.now() - started;
        console.error(`[export-regression] ${row.id} failed: ${error}`);
      }
      for (const [id, last] of readers) {
        if (last <= index) rendered.delete(id);
      }
      const record: RowRecord = {
        id: row.id, label: row.label, group: row.group, read,
        reportedLatencyFrames: Number.isFinite(reported) ? reported : null,
        invariants, register: registerVerdict, shiftFrames, standing: rowStanding(invariants, error), wavUploaded, error, renderMs,
      };
      out.push(record);
      console.log(`[export-regression] ${record.id}: ${record.standing} ${recordFigure(record)}`);
      setRecords([...out]);
    }

    const summary: ExportSummary = {
      schemaVersion: EXPORT_REGRESSION_SCHEMA_VERSION,
      runToken,
      userAgent: navigator.userAgent,
      sdkVersion: OPENDAW_SDK_VERSION,
      engineWasmSha256,
      sampleRate: RATE,
      uuidOrder: UUID_ORDER,
      rowsParam: rowsParamOf(),
      fill: FILL,
      registerSdkVersion: register === null ? null : register.sdkVersion,
      latencyReads,
      deviceRateHz,
      rows: out,
    };
    // The sink exists on the dev server only: on the public host the verdicts stay on the page, a warning and no error.
    try {
      await uploadSummary(summaryFileName(runToken), summary);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/HTTP 40[45]\b/.test(message)) throw cause;
      console.warn(`[export-regression] summary not uploaded: no /__verify sink on this host (${message})`);
    }
  }, []);

  const handleRun = useCallback(() => {
    if (boot === null || running) return;
    // The engine's figures refresh on animation frames, which stop on a hidden page: its reads could be stale.
    if (document.visibilityState !== "visible") {
      const message = `the page is ${document.visibilityState}: the engine's latency figures only refresh on a visible page, so show it and click Run again`;
      setAuditState(`error:${message}`);
      setStatus(`Error: ${message}`);
      return;
    }
    setRunning(true);
    setRecords([]);
    // At once, so a poller cannot read the last run's `done` as this run's.
    setAuditState("running:setup");
    runAudit(boot)
      .then(() => {
        setAuditState("done");
        setStatus("Done");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Run failed: " + message);
        setAuditState(`error:${message}`);
        setStatus(`Error: ${message}`);
      })
      .finally(() => setRunning(false));
  }, [boot, running, runAudit]);

  const [clean, known, failing, errored] = standingCounts(records);

  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="4" p="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Heading size="7">Export Regression Audit</Heading>
          <DebugLinkBar
            links={[
              { label: "Register: debug/2026-11-06-export-regression/note.md", href: NOTE_URL, kind: "note" },
              { label: "openDAW#530", href: "https://github.com/andremichelle/openDAW/issues/530", kind: "note" },
            ]}
          />
          <Text size="2" color="gray">
            Each row renders a copy of one project through one SDK export path, offline at {RATE} Hz, with no audio playing and
            no hardware. It is held to the invariants that need no accepted run, then compared bit for bit with the accepted
            register. {rowsParamOf() === "all" ? "" : `This is a partial run (${rowsParamOf()}): it also renders the rows its rows read against.`}
          </Text>
          <Callout.Root color="gray">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              Status: {status}{" "}
              <Badge
                id="audit-state"
                data-audit-state={auditState}
                data-standing-counts={[clean, known, failing, errored].join(",")}
                color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}
              >
                {auditState}
              </Badge>
            </Callout.Text>
          </Callout.Root>
          <Flex align="center" gap="3" wrap="wrap">
            <Button onClick={handleRun} disabled={boot === null || running} data-testid="run">
              <PlayIcon /> {running ? "Rendering…" : "Run audit"}
            </Button>
            <Text size="2" color="gray">
              {records.length} of {ROWS.length} rows: {clean} clean, {known} known finding, {failing} failing, {errored} errored.
              UUIDs {UUID_ORDER}, register {boot === null ? "—" : boot.register === null ? "none" : boot.register.sdkVersion}.
            </Text>
          </Flex>
          {records.length > 0 && (
            <Card>
              <Table.Root size="1" variant="surface">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>standing</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>register</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>frames</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>latency</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>render ms</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>failing</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {records.map((record) => (
                    <Table.Row key={record.id}>
                      <Table.Cell><Code size="1">{record.id}</Code></Table.Cell>
                      <Table.Cell><Badge color={STANDING_COLOR[record.standing]}>{record.standing}</Badge></Table.Cell>
                      <Table.Cell>{record.register ?? "—"}{record.shiftFrames === null ? "" : ` shift ${record.shiftFrames}`}</Table.Cell>
                      <Table.Cell>{record.read === null ? "—" : record.read.frames}</Table.Cell>
                      <Table.Cell>{record.reportedLatencyFrames ?? "—"}</Table.Cell>
                      <Table.Cell>{record.renderMs.toFixed(0)}</Table.Cell>
                      <Table.Cell style={{ wordBreak: "break-word" }}>{recordFigure(record)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          )}
        </Flex>
      </Container>
    </Theme>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
