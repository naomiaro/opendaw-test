import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import {
  CLOCK_CONDITION_LABELS, behindRangeQuanta, classifyClockProbe, clockProbeConfigFrom, countOffs, runWorkletClockProbe,
  type ClockConditionResult, type ClockProbeConfig, type ClockProbeReport, type ClockProbeVerdict,
} from "@/lib/audit/workletClockProbe";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Callout, Badge, Button, Code, Table } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Repro for `debug/worklet-clock-stale-under-graph-work.md`. No SDK is loaded.
//
// A worklet's `currentFrame` is watched against the audio it is handed while the main
// thread does one kind of work at a time. The page says what it found in one line
// (`#clock-verdict`, `data-verdict`): STALE CLOCK, CLOCK TRUE, CLOCK AHEAD, NOT CHECKED (a
// run that watched or worked too little to vouch for anything, as in a background tab), or
// THREW with the stage it was in. The measuring code is `src/lib/audit/workletClockProbe.ts`.
//
//   worklet-clock-debug-demo.html?seconds=10&rate=48000&burstMs=8&gapMs=2&conditions=idle,busy,connect,stream
//
// `create` (gain nodes made for the whole stretch) runs only when `?conditions=` names it:
// Firefox stops rendering under that many nodes (`DEFAULT_CLOCK_CONDITIONS`).

type Config = { cfg: ClockProbeConfig; error: null } | { cfg: null; error: string };

function readConfig(): Config {
  try {
    return { cfg: clockProbeConfigFrom(new URLSearchParams(window.location.search)), error: null };
  } catch (error) {
    return { cfg: null, error: String(error) };
  }
}
const CONFIG = readConfig();

type RunState =
  | { kind: "idle" }
  | { kind: "running"; stage: string }
  | { kind: "done"; report: ClockProbeReport; verdict: ClockProbeVerdict; saved: Saved | null }
  | { kind: "threw"; stage: string; message: string };

/** What became of writing the result to disk: the file's name, or why there is none. */
type Saved = { name: string; failed: null } | { name: null; failed: string };

/** On the dev server the result is also written to `.verify-output/`; anywhere else it stays on the page. */
async function saveOnDevServer(report: ClockProbeReport, verdict: ClockProbeVerdict): Promise<Saved | null> {
  if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return null;
  const name = "graph-lock-clock-" + String(Date.now()) + ".json";
  const notSaved = (why: string): Saved => {
    console.error("[worklet-clock] the result was not saved: " + why);
    return { name: null, failed: why };
  };
  try {
    const put = await fetch("/__verify/" + name, { method: "PUT", body: JSON.stringify({ ...report, verdict }, null, 1) });
    // A local preview of the built site has no sink: nothing to report.
    if (put.status === 404 || put.status === 405) return null;
    return put.ok ? { name, failed: null } : notSaved(`the dev server answered ${put.status}`);
  } catch (error) {
    return notSaved(String(error));
  }
}

function behindBy(offs: Record<string, number>): string {
  const range = behindRangeQuanta(offs);
  if (range === null) return "";
  if (range[0] !== range[1]) return `${range[0]} to ${range[1]} quanta`;
  return range[0] === 1 ? "1 quantum" : `${range[0]} quanta`;
}

const ResultRow: React.FC<{ result: ClockConditionResult }> = ({ result }) => {
  const behind = countOffs(result.offs, (off) => off < 0);
  const ahead = countOffs(result.offs, (off) => off > 0);
  const fresh = result.freshRecorders;
  return (
    <Table.Row>
      <Table.RowHeaderCell>{CLOCK_CONDITION_LABELS[result.condition]}</Table.RowHeaderCell>
      <Table.Cell>{result.bursts}</Table.Cell>
      <Table.Cell>{result.checked}</Table.Cell>
      <Table.Cell>{countOffs(result.offs, (off) => off === 0)}</Table.Cell>
      <Table.Cell>
        {behind > 0 ? <Badge color="red">{behind}</Badge> : "0"}
        {ahead > 0 && <Badge color="purple" ml="2">{ahead} ahead</Badge>}
      </Table.Cell>
      <Table.Cell>{behindBy(result.offs)}</Table.Cell>
      <Table.Cell>
        {fresh === undefined
          ? ""
          : `${countOffs(fresh.offs, (off) => off < 0)} of ${fresh.answered} read their first currentFrame early` +
            (countOffs(fresh.offs, (off) => off > 0) > 0 ? `, ${countOffs(fresh.offs, (off) => off > 0)} ahead` : "")}
      </Table.Cell>
    </Table.Row>
  );
};

const App: React.FC = () => {
  const [state, setState] = useState<RunState>({ kind: "idle" });

  const run = useCallback(async () => {
    if (CONFIG.cfg === null) return;
    let stage = "start";
    setState({ kind: "running", stage });
    try {
      const report = await runWorkletClockProbe(CONFIG.cfg, (next) => {
        stage = next;
        setState({ kind: "running", stage: next });
      });
      const verdict = classifyClockProbe(report.results, CONFIG.cfg);
      console.log("[worklet-clock] " + verdict.headline);
      stage = "save";
      const saved = await saveOnDevServer(report, verdict);
      setState({ kind: "done", report, verdict, saved });
    } catch (error) {
      console.error("[worklet-clock] threw in stage " + stage + ": " + String(error));
      setState({ kind: "threw", stage, message: String(error) });
    }
  }, []);

  const verdictWord =
    state.kind === "done" ? state.verdict.verdict
    : state.kind === "threw" ? "THREW"
    : state.kind === "running" ? "RUNNING"
    : "NOT RUN";
  const verdictLine =
    state.kind === "done" ? state.verdict.headline
    : state.kind === "threw" ? `THREW ${state.stage}: ${state.message}`
    : state.kind === "running" ? `Running: ${state.stage}…`
    : "Not run yet.";
  const verdictColor =
    state.kind === "done"
      ? (state.verdict.verdict === "CLOCK TRUE" ? "green" : state.verdict.verdict === "NOT CHECKED" ? "amber" : "red")
    : state.kind === "threw" ? "red"
    : "gray";
  const totalSeconds = CONFIG.cfg === null ? 0 : CONFIG.cfg.seconds * CONFIG.cfg.conditions.length;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar
          links={[
            {
              label: "debug/worklet-clock-stale-under-graph-work.md",
              href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/worklet-clock-stale-under-graph-work.md",
              kind: "note",
            },
          ]}
        />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            A Worklet's Clock While the Main Thread Changes the Graph
          </Heading>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              Inside an <Code>AudioWorkletProcessor</Code>, <Code>currentFrame</Code> and{" "}
              <Code>currentTime</Code> are the frame and the time of the render quantum being processed. This
              page checks that. A buffer source plays a ramp in which every sample names its own frame, started
              at a known context frame; a worklet notes, for every <Code>process()</Code> call, the{" "}
              <Code>currentFrame</Code> it read and the first sample it was handed. The stamp less the frame the
              sample names is 0 when the clock is true. Meanwhile the main thread does one kind of work at a
              time, in stretches. In the last condition every freshly built worklet also reports the{" "}
              <Code>currentFrame</Code> of its first call that carries the ramp: the read a recorder makes
              once, when a recording starts. Nothing is played through the speakers and no microphone is opened.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex direction="column" gap="3">
              <Flex align="center" gap="3" wrap="wrap">
                <Button onClick={() => void run()} disabled={CONFIG.cfg === null || state.kind === "running"} size="3">
                  <PlayIcon /> Run the probe{totalSeconds > 0 ? ` (about ${totalSeconds} s)` : ""}
                </Button>
                <Badge color={verdictColor} size="2">{verdictWord}</Badge>
              </Flex>
              {CONFIG.error !== null && <Text size="2" color="red">{CONFIG.error}</Text>}
              <Text id="clock-verdict" data-verdict={verdictWord} size="3" weight="bold">
                {verdictLine}
              </Text>
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
                      <Table.ColumnHeaderCell>the main thread</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>stretches of work</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>quanta checked</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>stamp true</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>stamp behind</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>by</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>fresh worklets</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {state.report.results.map((result) => <ResultRow key={result.condition} result={result} />)}
                  </Table.Body>
                </Table.Root>
              </div>
              <Text size="1" color="gray" style={{ display: "block", marginTop: "0.75rem" }}>
                {state.report.userAgent}
              </Text>
            </Card>
          )}

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>Configuration</Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {CONFIG.cfg === null
                ? CONFIG.error
                : `Sample rate:   ${CONFIG.cfg.sampleRate} Hz        (?rate=)
Per condition: ${CONFIG.cfg.seconds} s               (?seconds=, 1 to 120; the last condition finds more with more time)
Stretches:     ${CONFIG.cfg.burstMs} ms of work, ${CONFIG.cfg.gapMs} ms pause   (?burstMs=, ?gapMs=)
Conditions:    ${CONFIG.cfg.conditions.join(", ")}   (?conditions=; create only when named: Firefox stops rendering under it)`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
