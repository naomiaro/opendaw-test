import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { browserOf, envelopeName, issueFrom, type ProbeEnvelope, type WatchedIssue } from "@/lib/audit/chromiumWatched";
import { runFirstReadProbe } from "@/lib/audit/chromiumFirstReadProbe";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Callout, Badge, Button, Code, Table } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Probes for the Chromium issues `docs/known-vendor-issues.md` watches, one per page load:
//
//   chromium-watched-issues-debug-demo.html?issue=first-read|bfcache|suspend-resume|capture-gaps|opfs-usage|opfs-flush
//
// No SDK is loaded: a probe says what Chrome does, not what the SDK repairs. Each probe
// self-classifies into a verdict word (`#verdict`, `data-verdict`) with the figures it was
// judged on; the run's progress is `#audit-state[data-audit-state]`: idle, running:<step>,
// then done or error. On the dev server the envelope is also written to `.verify-output/`.
// Note: `debug/2026-10-23-chromium-watched-issues/note.md`.

const NOTE_URL =
  "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-23-chromium-watched-issues/note.md";

interface IssueInfo {
  tracker: string;
  title: string;
}

const ISSUE_INFO: Record<WatchedIssue, IssueInfo> = {
  "first-read": {
    tracker: "571344687",
    title: "AudioWorklet: currentTime is stale in the constructor and first process() after slow module loading",
  },
  bfcache: {
    tracker: "575891839",
    title: "AudioWorklet clock slows to ~0.5× after BFCache restoration, causing distorted playback",
  },
  "suspend-resume": {
    tracker: "560233271",
    title: "AudioWorklet playback becomes persistently distorted after AudioContext suspend/resume",
  },
  "capture-gaps": {
    tracker: "40103985",
    title: "Webaudio inserts zero filled parts into buffers supplied by getUserMedia",
  },
  "opfs-usage": {
    tracker: "436552046",
    title: "OPFS data cannot be deleted",
  },
  "opfs-flush": {
    tracker: "40909520",
    title: "FileSystemSyncAccessHandle.flush() is very slow on Mac compared with other browsers",
  },
};

type Probe = (signal: AbortSignal, report: (step: string) => void) => Promise<ProbeEnvelope>;

/** The probe for an issue; each task of the measurement plan fills its case. */
function probeFor(issue: WatchedIssue): Probe {
  switch (issue) {
    case "first-read":
      return runFirstReadProbe;
    case "bfcache":
    case "suspend-resume":
    case "capture-gaps":
    case "opfs-usage":
    case "opfs-flush":
      return async () => {
        throw new Error(`the ${issue} probe is not implemented`);
      };
  }
}

/**
 * A probe that judges on a later page load (after a back/forward-cache restore, after a
 * browser restart) returns its envelope here, from what an earlier run stored; null when
 * there is nothing to judge yet. Called once when the page mounts.
 */
function judgeStoredOnLoad(_issue: WatchedIssue): ProbeEnvelope | null {
  return null;
}

type Config = { issue: WatchedIssue; error: null } | { issue: null; error: string };

function readConfig(): Config {
  try {
    return { issue: issueFrom(new URLSearchParams(window.location.search)), error: null };
  } catch (error) {
    return { issue: null, error: String(error) };
  }
}
const CONFIG = readConfig();

/** What became of writing the envelope to disk: the file's name, or why there is none. */
type Saved = { name: string; failed: null } | { name: null; failed: string };

type RunState =
  | { kind: "idle" }
  | { kind: "running"; step: string }
  | { kind: "done"; envelope: ProbeEnvelope; saved: Saved | null }
  | { kind: "error"; step: string; message: string };

/** On the dev server the envelope is also written to `.verify-output/`; anywhere else it stays on the page. */
async function saveOnDevServer(envelope: ProbeEnvelope): Promise<Saved | null> {
  if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return null;
  const name = envelopeName(envelope.issue, envelope.runToken);
  const notSaved = (why: string): Saved => {
    console.error("[chromium-watched] the envelope was not saved: " + why);
    return { name: null, failed: why };
  };
  try {
    const put = await fetch("/__verify/" + name, { method: "PUT", body: JSON.stringify(envelope, null, 1) });
    // A local preview of the built site has no sink: nothing to report.
    if (put.status === 404 || put.status === 405) return null;
    return put.ok ? { name, failed: null } : notSaved(`the dev server answered ${put.status}`);
  } catch (error) {
    return notSaved(String(error));
  }
}

function auditStateOf(state: RunState): string {
  switch (state.kind) {
    case "idle":
      return "idle";
    case "running":
      return "running:" + state.step;
    case "done":
      return "done";
    case "error":
      return "error";
  }
}

const App: React.FC<{ issue: WatchedIssue }> = ({ issue }) => {
  const [state, setState] = useState<RunState>({ kind: "idle" });

  const finish = useCallback(async (envelope: ProbeEnvelope) => {
    console.log("[chromium-watched] " + envelope.issue + ": " + envelope.verdict);
    setState({ kind: "running", step: "save" });
    const saved = await saveOnDevServer(envelope);
    setState({ kind: "done", envelope, saved });
  }, []);

  useEffect(() => {
    const stored = judgeStoredOnLoad(issue);
    if (stored !== null) void finish(stored);
  }, [issue, finish]);

  const run = useCallback(async () => {
    const controller = new AbortController();
    let step = "start";
    setState({ kind: "running", step });
    try {
      const envelope = await probeFor(issue)(controller.signal, (next) => {
        step = next;
        setState({ kind: "running", step: next });
      });
      await finish(envelope);
    } catch (error) {
      controller.abort();
      console.error("[chromium-watched] threw in step " + step + ": " + String(error));
      setState({ kind: "error", step, message: String(error) });
    }
  }, [issue, finish]);

  const info = ISSUE_INFO[issue];
  const verdictWord =
    state.kind === "done" ? state.envelope.verdict
    : state.kind === "error" ? "THREW"
    : state.kind === "running" ? "RUNNING"
    : "NOT RUN";
  const verdictLine =
    state.kind === "done" ? state.envelope.verdict
    : state.kind === "error" ? `THREW ${state.step}: ${state.message}`
    : state.kind === "running" ? `Running: ${state.step}…`
    : "Not run yet.";
  const verdictColor = state.kind === "error" ? "red" : state.kind === "done" ? "amber" : "gray";

  return (
    <Flex direction="column" gap="4">
      <DebugLinkBar
        links={[
          { label: "debug/2026-10-23-chromium-watched-issues/note.md", href: NOTE_URL, kind: "note" },
          {
            label: `Chromium issue ${info.tracker}`,
            href: `https://issues.chromium.org/issues/${info.tracker}`,
            kind: "note",
          },
        ]}
      />

      <Heading size="7" align="center">
        Chromium {info.tracker}: {info.title}
      </Heading>

      <Callout.Root color="blue">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          One probe per page load, chosen by <Code>?issue={issue}</Code>. No SDK is loaded: the probe says what
          this browser does. It ends in a verdict word and the figures it was judged on, or{" "}
          <Code>NOT CHECKED</Code> when the run could not exercise the condition.
        </Callout.Text>
      </Callout.Root>

      <Card>
        <Flex direction="column" gap="3">
          <Flex align="center" gap="3" wrap="wrap">
            <Button onClick={() => void run()} disabled={state.kind === "running"} size="3">
              <PlayIcon /> Run
            </Button>
            <Badge color={verdictColor} size="2">{verdictWord}</Badge>
            <Text id="audit-state" data-audit-state={auditStateOf(state)} size="1" color="gray">
              {auditStateOf(state)}
            </Text>
          </Flex>
          <Text id="verdict" data-verdict={verdictWord} size="3" weight="bold">
            {verdictLine}
          </Text>
          <Text size="1" color="gray">{browserOf(navigator)}</Text>
          {state.kind === "done" && state.saved !== null && (
            state.saved.failed === null
              ? <Text size="1" color="gray">saved: {state.saved.name}</Text>
              : <Text size="1" color="red">not saved: {state.saved.failed}</Text>
          )}
        </Flex>
      </Card>

      {state.kind === "done" && (
        <Card>
          <div style={{ overflowX: "auto" }}>
            <Table.Root size="1">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>figure</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>value</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {Object.entries(state.envelope.figures).map(([name, value]) => (
                  <Table.Row key={name}>
                    <Table.RowHeaderCell>{name}</Table.RowHeaderCell>
                    <Table.Cell>{value === null ? "—" : String(value)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </div>
          <Text size="1" color="gray" style={{ display: "block", marginTop: "0.75rem" }}>
            {state.envelope.chrome} · {state.envelope.date} · run {state.envelope.runToken}
          </Text>
        </Card>
      )}
    </Flex>
  );
};

const Page: React.FC = () => (
  <Theme appearance="dark" accentColor="amber">
    <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
      <GitHubCorner />
      <BackLink />
      {CONFIG.issue === null ? (
        <Flex direction="column" gap="3">
          <Heading size="7" align="center">Chromium Watched Issues</Heading>
          <Text id="audit-state" data-audit-state="error" size="2" color="red">{CONFIG.error}</Text>
        </Flex>
      ) : (
        <App issue={CONFIG.issue} />
      )}
      <MoisesLogo />
    </Container>
  </Theme>
);

const root = createRoot(document.getElementById("root")!);
root.render(<Page />);
