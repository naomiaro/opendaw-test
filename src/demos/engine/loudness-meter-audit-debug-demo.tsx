// src/demos/engine/loudness-meter-audit-debug-demo.tsx
// Unlisted harness for the engine's loudness meter. Plays test tones whose loudness is
// known (EBU Tech 3341 and Tech 3342, plus a K-weighting sweep) through the live engine,
// reads the engine's loudness stream, and judges each reading against its tolerance.
// Per case:
//   synthesize -> loadSignal -> freshMeter (worklet restart) -> playAndCapture ->
//   judgeCapture -> table rows.
// A case that throws becomes error rows and the run goes on. At the end the rows are
// uploaded as JSON to the dev server's /__verify sink; without a sink the run still ends
// "done" and says the summary was not saved.
//
// URL contract:
//   ?case=<all|group|id>   default "all". Groups: loudness, range, peak, weighting.
//   ?rate=<48000|44100>    default 48000. The AudioContext's sample rate.
//   ?audible=1             also send the engine to the speakers (silent by default).
//
// DOM contract: #run starts the run (it needs a real click). #audit-state carries
// data-audit-state walking idle -> setup -> running:<caseId> -> uploading -> done, or
// error:<message>. Each result row carries data-row-id and data-row-status.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import { withDeadline } from "@/lib/deadline";
import {
  LOUDNESS_CASES,
  LOUDNESS_GROUPS,
  LOUDNESS_RATES,
  caseSeconds,
  parseRate,
  rowSpecs,
  selectCases,
  type LoudnessGroup,
} from "@/lib/audit/loudnessCases";
import { synthesize } from "@/lib/audit/loudnessSignals";
import { judgeCapture, type JudgedRow, type MetricValues } from "@/lib/audit/loudnessVerdict";
import { freshMeter, loadSignal, openSession, playAndCapture } from "./loudnessSession";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Button, Table } from "@radix-ui/themes";

interface ErrorRow {
  rowId: string;
  caseId: string;
  group: LoudnessGroup;
  status: "error";
  errorMessage: string;
}
type AuditRow = JudgedRow | ErrorRow;

interface AuditEnvelope {
  sdkVersion: string;
  sampleRate: number;
  userAgent: string;
  selector: string;
  startedAt: string;
  rows: AuditRow[];
}

const STATUS_COLOR = { pass: "green", fail: "amber", invalid: "gray", error: "red" } as const;

const dash = "—";
const fixed = (value: number | null | undefined, digits: number = 2): string =>
  value === null || value === undefined || !Number.isFinite(value) ? dash : value.toFixed(digits);
const signed = (value: number | null): string =>
  value === null ? dash : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
const lateText = (late: MetricValues): string =>
  `I ${fixed(late.integrated)} · LRA ${fixed(late.range)} · peak ${fixed(late.peak)}`;

/** Uploads the summary. Returns what to show beside the state; never throws. */
async function uploadSummary(envelope: AuditEnvelope): Promise<string> {
  const name = `loudness-audit-${Date.now()}.json`;
  try {
    await withDeadline(
      (async () => {
        const response = await fetch(`/__verify/${name}`, { method: "PUT", body: JSON.stringify(envelope, null, 2) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      })(),
      30_000,
      "the summary upload"
    );
    return `summary saved as ${name}`;
  } catch (error) {
    console.warn(`[loudness-audit] summary not saved: ${String(error)}`);
    return `summary not saved (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function runAudit(setState: (state: string) => void, onRow: (row: AuditRow) => void): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const selector = params.get("case");
  // Both throw for a bad parameter, before any audio starts.
  const cases = selectCases(selector);
  const rate = parseRate(params.get("rate"));
  const startedAt = new Date().toISOString();

  setState("setup");
  const session = await openSession(rate, params.get("audible") === "1");
  const sampleRate = session.audioContext.sampleRate;
  const rows: AuditRow[] = [];
  const add = (row: AuditRow) => {
    rows.push(row);
    onRow(row);
  };

  for (const testCase of cases) {
    setState(`running:${testCase.id}`);
    try {
      loadSignal(session, synthesize(testCase.segments, sampleRate, testCase.taperMs), testCase.id);
      await freshMeter(session);
      const capture = await playAndCapture(session, caseSeconds(testCase));
      judgeCapture(testCase, sampleRate, capture).forEach(add);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[loudness-audit] case ${testCase.id} failed: ${errorMessage}`);
      for (const spec of rowSpecs(testCase, sampleRate)) {
        add({ rowId: spec.rowId, caseId: testCase.id, group: testCase.group, status: "error", errorMessage });
      }
    }
  }

  setState("uploading");
  const note = await uploadSummary({
    sdkVersion: OPENDAW_SDK_VERSION,
    sampleRate,
    userAgent: navigator.userAgent,
    selector: selector ?? "all",
    startedAt,
    rows,
  });
  setState("done");
  return note;
}

function ResultRow({ row }: { row: AuditRow }) {
  if (row.status === "error") {
    return (
      <Table.Row data-row-id={row.rowId} data-row-status="error">
        <Table.Cell>{row.rowId}</Table.Cell>
        <Table.Cell colSpan={5}>{row.errorMessage}</Table.Cell>
        <Table.Cell>
          <Badge color="red">error</Badge>
        </Table.Cell>
      </Table.Row>
    );
  }
  const lines = (text: (index: number) => string) =>
    row.metrics.map((metric, index) => <div key={metric.metric}>{text(index)}</div>);
  const worst = row.delivered.reduce(
    (highest, check) =>
      check.deliveredDb === null ? highest : Math.max(highest, Math.abs(check.deliveredDb - check.intendedDb)),
    0
  );
  return (
    <Table.Row data-row-id={row.rowId} data-row-status={row.status}>
      <Table.Cell>{row.rowId}</Table.Cell>
      <Table.Cell>
        {lines((i) => {
          const metric = row.metrics[i];
          return `${metric.metric} ${metric.expected.toFixed(2)} ${metric.unit} +${metric.tolerancePlus}/−${metric.toleranceMinus}`;
        })}
      </Table.Cell>
      <Table.Cell>{lines((i) => fixed(row.metrics[i].got))}</Table.Cell>
      <Table.Cell>{lines((i) => signed(row.metrics[i].error))}</Table.Cell>
      <Table.Cell title={row.delivered.map((check) => `${check.label} ${fixed(check.deliveredDb, 3)}`).join("\n")}>
        {row.delivered.length} checks, worst {worst.toFixed(3)} dB
      </Table.Cell>
      <Table.Cell>{lateText(row.late)}</Table.Cell>
      <Table.Cell>
        <Badge color={STATUS_COLOR[row.status]} title={row.reasons.join("\n")}>
          {row.status}
        </Badge>
        {row.reasons.map((reason) => (
          <div key={reason}>
            <Text size="1" color="gray">
              {reason}
            </Text>
          </div>
        ))}
      </Table.Cell>
    </Table.Row>
  );
}

function LoudnessAudit() {
  const [auditState, setAuditState] = useState("idle");
  const [summaryNote, setSummaryNote] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);

  const run = () => {
    setRows([]);
    runAudit(setAuditState, (row) => setRows((previous) => [...previous, row]))
      .then(setSummaryNote)
      .catch((error) => {
        console.error(`[loudness-audit] ${String(error)}`);
        setAuditState(`error:${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const count = (status: AuditRow["status"]) => rows.filter((row) => row.status === status).length;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar
          links={[
            {
              label: "debug/2026-10-02-loudness-meter/note.md",
              href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-02-loudness-meter/note.md",
              kind: "note",
            },
            {
              label: "Upstream, all four fixed: openDAW#426 (weighting)",
              href: "https://github.com/andremichelle/openDAW/issues/426",
              kind: "note",
            },
            {
              label: "openDAW#427 (true peak)",
              href: "https://github.com/andremichelle/openDAW/issues/427",
              kind: "note",
            },
            {
              label: "openDAW#428 (no reset)",
              href: "https://github.com/andremichelle/openDAW/issues/428",
              kind: "note",
            },
            {
              label: "openDAW#429 (first packet)",
              href: "https://github.com/andremichelle/openDAW/issues/429",
              kind: "note",
            },
            {
              label: "PR #430 (EBU test suite, imported upstream)",
              href: "https://github.com/andremichelle/openDAW/pull/430",
              kind: "note",
            },
          ]}
        />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Loudness Meter Audit Harness
          </Heading>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Button id="run" onClick={run} disabled={auditState !== "idle"}>
                Run
              </Button>
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
                {rows.length} row{rows.length === 1 ? "" : "s"} — {count("pass")} pass, {count("fail")} fail,{" "}
                {count("invalid")} invalid, {count("error")} error
              </Text>
              <Text id="summary-note" size="2" color="gray">
                {summaryNote}
              </Text>
            </Flex>
            <Text as="p" size="2" color="gray" style={{ marginTop: "0.5rem" }}>
              A run of every case takes about twelve minutes and is silent unless ?audible=1. Keep this tab
              visible: a hidden tab stops receiving the meter's readings and its cases are marked invalid.
            </Text>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>meter</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>error</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>delivered signal</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>5 s after the end</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>verdict</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => (
                    <ResultRow key={row.rowId} row={row} />
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
              {`?case=<all|group|id>   default "all"
                       groups: ${LOUDNESS_GROUPS.join(", ")}
                       ids:    ${LOUDNESS_CASES.map((testCase) => testCase.id).join(", ")}
?rate=<${LOUDNESS_RATES.join("|")}>    default ${LOUDNESS_RATES[0]}
?audible=1             also play the run through the speakers
pass     every judged reading within its tolerance
fail     a judged reading outside its tolerance
invalid  the measurement cannot be trusted: the signal did not reach the meter as synthesized,
         readings were missing, the meter was not empty at the start, or the tab was hidden
error    the case threw or timed out
Uploads: loudness-audit-<timestamp>.json (all rows) via PUT /__verify`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<LoudnessAudit />);
