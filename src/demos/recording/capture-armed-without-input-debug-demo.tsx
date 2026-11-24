import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Errors, RuntimeNotifier } from "@opendaw/lib-std";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioDevices } from "@opendaw/studio-core";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { SDK_NOTICES_ID } from "@/lib/runtimeNotifier";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Button, Code, Table } from "@radix-ui/themes";

// Repro for `debug/2026-11-23-capture-armed-without-input/note.md` (openDAW#579).
//
// A Tape's `CaptureAudio` is armed (`capture.armed.setValue(true)`) while `navigator.mediaDevices.getUserMedia`
// refuses (patched to reject with a NotAllowedError, as a denied microphone permission does). The page records
// what an app can observe afterwards: the capture's `armed` value, its `stream`, the unhandled promise
// rejections the window saw, and the notices the SDK sent to the `RuntimeNotifier` this site installs.
// No microphone is opened and nothing is played.
//
// Rows, in order:
//  0. control: a notice sent through `RuntimeNotifier.notify` is counted (the "notices shown" reading works).
//  1. control: arming with an input that opens (a synthetic stream): the stream opens, no rejection.
//  2. arming with the input refused.
//  3. the same capture, still armed, once the input would open again: does anything retry? (2 s)
//  4. control: disarm, arm again with the input available: the capture is not broken by the refusal.
//  5. `capture.monitoringMode = "direct"` with the input refused (the setter arms the capture).
//  6. `project.startRecording(false)` with the capture armed and the input refused.
//
// Verdict: BUG PRESENT on the whole signature of row 2 with every control good: `getUserMedia` was called and
// refused, the capture reads armed with no stream, the window saw an unhandled rejection whose reason is the
// SDK's `Errors.Warning`, and no notice was shown. FIXED when after the refusal no unhandled rejection reached
// the window and the app was told another way (the capture reads disarmed, or a notice was shown).
// INCONCLUSIVE otherwise. One run per page load.
type Row = { step: string; expected: string; got: string; ok: boolean | null };
type Verdict = "BUG PRESENT" | "FIXED" | "INCONCLUSIVE" | "HUNG" | "THREW";
type Outcomes = { afterRefusal: string; signal: string; retry: string; monitoring: string; recordingStart: string };
type Outcome = { verdict: Verdict; rows: Row[]; message: string } & Outcomes;
type RunState = { kind: "idle" } | { kind: "running"; stage: string; rows: Row[] } | ({ kind: "done" } & Outcome);
const NOT_RUN: Outcomes = { afterRefusal: "not-run", signal: "not-run", retry: "not-run", monitoring: "not-run", recordingStart: "not-run" };
const WATCH_MS = 2000;

class Hung extends Error { constructor(readonly stage: string) { super(`hung in ${stage}`); } }
const race = <T,>(stage: string, promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Hung(stage)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const failureOf = (error: unknown) => (error instanceof Hung ? `deadline passed in ${error.stage}` : String(error));

async function run(onStage: (stage: string, rows: Row[]) => void): Promise<Outcome> {
  const rows: Row[] = [];
  const outcomes: Outcomes = { ...NOT_RUN };
  let stage = "init";
  const cleanup: Array<() => void> = [];
  const enter = (name: string) => { stage = name; onStage(stage, [...rows]); };
  const row = (r: Row) => { rows.push(r); onStage(stage, [...rows]); console.log(`[capture-armed-without-input] ${r.step}: ${r.got}`); };
  try {
    enter("init");
    const { project, audioContext } = await race(stage, initializeOpenDAW({ bpm: 120 }), 90_000);
    if (audioContext.state !== "running") await race("resume (needs a real click)", audioContext.resume(), 10_000);
    if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} after resume`);
    const unit = project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Tape)).unwrap("createInstrument").audioUnitBox;
    const loaded = await race(stage, project.engine.queryLoadingComplete(), 30_000);
    if (!loaded) throw new Error("queryLoadingComplete returned false (no worklet)");
    const capture = project.captureDevices.audio(unit.address.uuid).unwrap("no CaptureAudio for the Tape");

    // the input: a silent synthetic stream, or a refusal
    const synthetic = audioContext.createMediaStreamDestination();
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    let refuse = false;
    let calls = 0;
    mediaDevices.getUserMedia = async () => {
      calls++;
      if (refuse) throw new DOMException("Permission denied", "NotAllowedError");
      return synthetic.stream.clone();
    };
    cleanup.push(() => { mediaDevices.getUserMedia = originalGetUserMedia; });

    // what the window sees
    type Rejection = { warning: boolean; text: string };
    const rejections: Rejection[] = [];
    const onRejection = (event: PromiseRejectionEvent) => rejections.push({ warning: event.reason instanceof Errors.Warning, text: String(event.reason) });
    window.addEventListener("unhandledrejection", onRejection);
    cleanup.push(() => window.removeEventListener("unhandledrejection", onRejection));
    // notices ADDED to the notifier's stack since the run began (a notice goes away by itself, so a count of what is showing would fall)
    const noticesSeen = new Set<Node>();
    const noticeObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof Element && record.target.id === SDK_NOTICES_ID) record.addedNodes.forEach((node) => noticesSeen.add(node));
        else for (const node of record.addedNodes) if (node instanceof Element && node.id === SDK_NOTICES_ID) Array.from(node.children).forEach((child) => noticesSeen.add(child));
      }
    });
    noticeObserver.observe(document.body, { childList: true, subtree: true });
    cleanup.push(() => noticeObserver.disconnect());
    const notices = () => noticesSeen.size;
    const disarm = async () => { capture.monitoringMode = "off"; capture.armed.setValue(false); await sleep(300); };
    cleanup.push(() => { capture.monitoringMode = "off"; capture.armed.setValue(false); });

    type Seen = { armed: boolean; stream: boolean; calls: number; rejections: Rejection[]; notices: number };
    // run `act`, watch for WATCH_MS, report what changed
    const watch = async (act: () => void): Promise<Seen> => {
      const callsBefore = calls;
      const noticesBefore = notices();
      rejections.length = 0;
      const started = performance.now();
      act();
      await sleep(WATCH_MS);
      if (performance.now() - started > WATCH_MS * 3) throw new Error(`a ${WATCH_MS} ms watch took ${Math.round(performance.now() - started)} ms (document ${document.visibilityState}): timers throttled`);
      if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} in "${stage}" (document ${document.visibilityState})`);
      return { armed: capture.armed.getValue(), stream: capture.stream.nonEmpty(), calls: calls - callsBefore, rejections: [...rejections], notices: notices() - noticesBefore };
    };
    const tell = (seen: Seen) => `armed ${seen.armed}; stream ${seen.stream ? "open" : "none"}; getUserMedia called ${seen.calls}×; unhandled rejections ${seen.rejections.length}${seen.rejections.length > 0 ? ` (${seen.rejections.map((r) => `${r.warning ? "Errors.Warning" : "other"}: "${r.text}"`).join("; ")})` : ""}; notices shown ${seen.notices}`;
    const opened = (seen: Seen) => seen.armed && seen.stream && seen.calls === 1 && seen.rejections.length === 0;
    const signalOf = (seen: Seen) => seen.notices > 0 ? "notice" : seen.rejections.length > 0 ? (seen.rejections.every((r) => r.warning) ? "unhandled-rejection-only" : "unhandled-rejection-other") : "none";

    // control for the notice count: a notice the page sends itself through the SDK's notifier must be counted
    enter("control: the notice count");
    const noticesBefore = notices();
    RuntimeNotifier.notify({ message: "capture-armed-without-input: control notice" });
    await sleep(100);
    const noticeCounted = notices() - noticesBefore === 1;
    row({ step: "control: a notice sent through RuntimeNotifier.notify is counted", expected: "1 notice", got: `${notices() - noticesBefore} notice(s)`, ok: noticeCounted });

    enter("control: arming with an input that opens");
    refuse = false;
    const control = await watch(() => capture.armed.setValue(true));
    row({ step: "control: capture.armed.setValue(true), the input opens", expected: "armed, stream open, no rejection", got: tell(control), ok: opened(control) });
    await disarm();

    enter("arming with the input refused");
    refuse = true;
    const refused = await watch(() => capture.armed.setValue(true));
    outcomes.afterRefusal = refused.stream ? "stream-open" : refused.armed ? "armed-no-stream" : "disarmed";
    outcomes.signal = signalOf(refused);
    const signature = refused.calls >= 1 && outcomes.afterRefusal === "armed-no-stream" && outcomes.signal === "unhandled-rejection-only";
    const told = refused.calls >= 1 && !refused.stream && refused.rejections.length === 0 && (!refused.armed || refused.notices > 0);
    // with a default input known, the SDK asks for it by id and then once more without a device: two calls
    const defaultKnown = AudioDevices.defaultInput !== undefined;
    row({ step: "capture.armed.setValue(true), getUserMedia refuses (NotAllowedError)", expected: "the app is told: the capture not armed or a notice, and no unhandled rejection", got: `${tell(refused)}; a default input device is ${defaultKnown ? "known" : "not known"} to the SDK`, ok: told });

    enter("still armed, the input available again");
    refuse = false;
    const later = await watch(() => {});
    outcomes.retry = later.stream ? "opened" : later.calls > 0 ? "retried-no-stream" : "no-retry";
    row({ step: `the same capture, still armed, the input would open again (${WATCH_MS / 1000} s, measurement)`, expected: "", got: tell(later), ok: null });

    enter("control: disarm and arm again");
    await disarm();
    const again = await watch(() => capture.armed.setValue(true));
    row({ step: "control: disarmed, armed again, the input opens", expected: "armed, stream open, no rejection", got: tell(again), ok: opened(again) });
    await disarm();

    // the verdict is settled here
    const controlsOk = noticeCounted && opened(control) && opened(again);
    const verdict: Verdict = !controlsOk ? "INCONCLUSIVE" : signature ? "BUG PRESENT" : told ? "FIXED" : "INCONCLUSIVE";
    let message = !controlsOk ? "a control failed (the notice count, or an input that should have opened), so the refusal rows prove nothing"
      : `after a refused input the capture reads ${outcomes.afterRefusal}; signal: ${outcomes.signal}${refused.rejections.length > 0 ? ` ("${refused.rejections[0].text}")` : ""}; while it stays armed: ${outcomes.retry}`;

    try {
      enter("monitoring with the input refused");
      refuse = true;
      const monitoring = await watch(() => { capture.monitoringMode = "direct"; });
      outcomes.monitoring = `${monitoring.stream ? "stream-open" : monitoring.armed ? "armed-no-stream" : "disarmed"}, ${signalOf(monitoring)}`;
      row({ step: `capture.monitoringMode = "direct", getUserMedia refuses (measurement)`, expected: "", got: `monitoringMode ${capture.monitoringMode}; ${tell(monitoring)}`, ok: null });
      await disarm();
    } catch (error) {
      outcomes.monitoring = "failed";
      row({ step: stage, expected: "", got: failureOf(error), ok: false });
    }
    message += `; monitoring: ${outcomes.monitoring}`;

    try {
      enter("recording start with the input refused");
      refuse = true;
      capture.armed.setValue(true);
      await sleep(500);
      cleanup.push(() => { if (project.isRecording()) project.stopRecording(); project.engine.stop(true); });
      const recording = await watch(() => project.startRecording(false));
      const isRecording = project.isRecording() || project.engine.isRecording.getValue();
      outcomes.recordingStart = `${isRecording ? "recording" : "not-recording"}, ${signalOf(recording)}`;
      row({ step: "project.startRecording(false), the capture armed, getUserMedia refuses (measurement)", expected: "", got: `recording ${isRecording}; ${tell(recording)}`, ok: null });
      if (isRecording) project.stopRecording();
      project.engine.stop(true);
      await disarm();
    } catch (error) {
      outcomes.recordingStart = "failed";
      row({ step: stage, expected: "", got: failureOf(error), ok: false });
    }
    message += `; recording start: ${outcomes.recordingStart}`;
    return { verdict, rows, message, ...outcomes };
  } catch (error) {
    rows.push({ step: stage, expected: "", got: failureOf(error), ok: false });
    if (error instanceof Hung) return { verdict: "HUNG", rows, message: failureOf(error), ...outcomes };
    console.error(`[capture-armed-without-input] ${stage}: ${String(error)}`);
    return { verdict: "THREW", rows, message: `${stage}: ${String(error)}`, ...outcomes };
  } finally {
    for (const undo of cleanup.reverse()) { try { undo(); } catch (error) { console.warn(`[capture-armed-without-input] cleanup: ${String(error)}`); } }
  }
}

function App() {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const start = useCallback(() => {
    setState({ kind: "running", stage: "init", rows: [] });
    run((stage, rows) => setState({ kind: "running", stage, rows }))
      .then((done) => setState({ kind: "done", ...done }), (error) => setState({ kind: "done", verdict: "THREW", rows: [], message: String(error), ...NOT_RUN }));
  }, []);
  const rows = state.kind === "idle" ? [] : state.rows;
  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" py="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Heading size="6">Arming a capture whose input is refused (debug)</Heading>
          <Text size="2" color="gray">
            A Tape's capture is armed with <Code>capture.armed.setValue(true)</Code> while <Code>getUserMedia</Code> is patched to
            refuse, as a denied microphone permission does. The page reports what an app can see afterwards: the capture's armed
            value and stream, the unhandled rejections the window saw, and the notices the SDK asked for. No microphone is opened
            and nothing is played. A real click starts it; one run per page load, about twenty seconds.
          </Text>
          <Flex gap="3" align="center">
            <Button id="run" size="3" onClick={start} disabled={state.kind !== "idle"}>Run</Button>
            {state.kind === "running" && <Badge color="amber">running: {state.stage}</Badge>}
          </Flex>
          {state.kind === "done" && (
            <Card>
              <Text
                id="verdict" size="2" weight="bold" color={state.verdict === "FIXED" ? "green" : state.verdict === "BUG PRESENT" ? "red" : "gray"}
                data-verdict={state.verdict} data-after-refusal={state.afterRefusal} data-signal={state.signal} data-retry={state.retry}
                data-monitoring={state.monitoring} data-recording-start={state.recordingStart}
              >
                {state.verdict} — {state.message}
              </Text>
            </Card>
          )}
          {rows.length > 0 && (
            <Card>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>seen</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>ok</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r, i) => (
                    <Table.Row key={i} data-ok={String(r.ok)}>
                      <Table.Cell><Text size="1">{r.step}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.expected}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.got}</Text></Table.Cell>
                      <Table.Cell>{r.ok === null ? <Badge color="gray">measured</Badge> : r.ok ? <Badge color="green">ok</Badge> : <Badge color="red">FAIL</Badge>}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          )}
          <DebugLinkBar
            links={[
              { label: "debug/2026-11-23-capture-armed-without-input/note.md", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-capture-armed-without-input/note.md", kind: "note" },
              { label: "Upstream, open: openDAW#579", href: "https://github.com/andremichelle/openDAW/issues/579", kind: "note" },
            ]}
          />
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
