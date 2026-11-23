import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Button, Code, Table } from "@radix-ui/themes";

// Repro for `debug/2026-11-23-fx-monitor-mono-return/note.md`.
//
// A 440 Hz oscillator is registered as an EFFECTS-monitoring source of a Tape unit through
// `engine.registerMonitoringSource(uuid, node, numChannels, destination)`, the call the SDK's own
// `BrowserMonitor` makes in "effects" mode. The destination is a gain node this page owns, connected to
// nothing but two analysers (left, right), so the page is silent. For each of the unit's pan positions
// −1, 0, +1 the page reads the RMS of both return channels, first with the source registered as stereo
// (the control), then as mono.
//
// The unit's strip pans the signal in the engine, so the return of a source panned hard right should be
// silent on the left and carry the signal on the right, whatever the source's channel count. A mono
// source's return that is silent on BOTH sides at pan +1, and equal on both sides at pan −1, is the
// strip's left channel alone on both sides.
//
// Verdict, once the stereo rows read as a pan (signal at pan 0 on both sides, left under SILENT of right
// at pan +1 and the reverse at pan −1): BUG PRESENT when the mono row at pan +1 is under SILENT of the
// stereo row's right channel on both sides, FIXED when it carries the right channel like the stereo row
// (within LEVEL_TOLERANCE) with the left silent, INCONCLUSIVE otherwise. One run per page load.
//
// The page also guards openDAW#528 (fixed): a unit monitored with effects returns through the monitor
// output only. The engine's MAIN output is tapped (the engine keeps its connection to the speakers) and its
// peak is read at every pan position; it must stay under MAIN_SILENT. Its positive control is the last
// row: the metronome playing with nothing monitored must show on the same tap.
const PANS = [-1, 0, 1] as const;
const SETTLE_MS = 600;
const SILENT = 0.02; // a channel under this fraction of the reference level counts as silent
const LEVEL_TOLERANCE = 1.5;
const SIGNAL_MIN = 0.01;
const MAIN_SILENT = 1e-4;

type Levels = { left: number; right: number };
type Row = { step: string; expected: string; got: string; ok: boolean | null };
type Verdict = "BUG PRESENT" | "FIXED" | "INCONCLUSIVE" | "HUNG" | "THREW";
type RunState = { kind: "idle" } | { kind: "running"; stage: string; rows: Row[] } | { kind: "done"; verdict: Verdict; rows: Row[]; message: string };

class Hung extends Error { constructor(readonly stage: string) { super(`hung in ${stage}`); } }
const race = <T,>(stage: string, promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Hung(stage)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rmsOf = (analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number => {
  analyser.getFloatTimeDomainData(buffer);
  let acc = 0;
  for (let i = 0; i < buffer.length; i++) acc += buffer[i] * buffer[i];
  return Math.sqrt(acc / buffer.length);
};
const peakOf = (analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number => {
  analyser.getFloatTimeDomainData(buffer);
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]));
  return peak;
};
const show = ({ left, right }: Levels) => `L ${left.toFixed(4)}, R ${right.toFixed(4)}`;
const panLabel = (pan: number) => (pan < 0 ? "pan −1 (left)" : pan > 0 ? "pan +1 (right)" : "pan 0 (centre)");

async function run(onStage: (stage: string, rows: Row[]) => void): Promise<{ verdict: Verdict; rows: Row[]; message: string }> {
  const rows: Row[] = [];
  let stage = "init";
  const enter = (name: string) => { stage = name; onStage(stage, [...rows]); };
  const row = (r: Row) => { rows.push(r); onStage(stage, [...rows]); console.log(`[monitor-mono-return] ${r.step}: ${r.got}`); };
  try {
    enter("init");
    let mainTap: AnalyserNode | null = null;
    const { project, audioContext } = await race(stage, initializeOpenDAW({
      bpm: 120,
      engineTap: (node) => { mainTap = node.context.createAnalyser(); mainTap.fftSize = 4096; node.connect(mainTap, 0); },
    }), 90_000);
    if (mainTap === null) throw new Error("engineTap never ran");
    const main: AnalyserNode = mainTap;
    if (audioContext.state !== "running") await race("resume (needs a real click)", audioContext.resume(), 10_000);
    if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} after resume`);
    enter("build");
    const { audioUnitBox } = project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Tape)).unwrap("createInstrument");
    const loaded = await race(stage, project.engine.queryLoadingComplete(), 30_000);
    if (!loaded) throw new Error("queryLoadingComplete returned false (no worklet)");

    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 440;
    const level = audioContext.createGain();
    level.gain.value = 0.25;
    oscillator.connect(level);
    // one node per channel count, each with an explicit count, so what the engine is handed is not left to up-mixing rules
    const sourceOf = (channels: 1 | 2): AudioNode => {
      const node = audioContext.createGain();
      node.channelCount = channels;
      node.channelCountMode = "explicit";
      node.channelInterpretation = "speakers";
      level.connect(node);
      return node;
    };
    const sources = { 1: sourceOf(1), 2: sourceOf(2) } as const;
    const destination = audioContext.createGain();
    destination.channelCount = 2;
    destination.channelCountMode = "explicit";
    const splitter = audioContext.createChannelSplitter(2);
    destination.connect(splitter);
    const analysers = [0, 1].map((channel) => {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      splitter.connect(analyser, channel);
      return analyser;
    });
    oscillator.start();
    const buffer = new Float32Array(4096);
    const read = (): Levels => ({ left: rmsOf(analysers[0], buffer), right: rmsOf(analysers[1], buffer) });

    const uuid = audioUnitBox.address.uuid;
    const mainPeaks: Record<string, number> = {};
    const measure = async (channels: 1 | 2): Promise<Record<number, Levels>> => {
      const kind = channels === 1 ? "mono" : "stereo";
      enter(`${kind} source`);
      project.engine.registerMonitoringSource(uuid, sources[channels], channels, destination);
      const result: Record<number, Levels> = {};
      for (const pan of PANS) {
        project.editing.modify(() => audioUnitBox.panning.setValue(pan));
        await sleep(SETTLE_MS);
        result[pan] = read();
        mainPeaks[kind] = Math.max(mainPeaks[kind] ?? 0, peakOf(main, buffer));
      }
      project.engine.unregisterMonitoringSource(uuid);
      await sleep(SETTLE_MS);
      const after = read();
      if (after.left > SIGNAL_MIN * SILENT || after.right > SIGNAL_MIN * SILENT) throw new Error(`the return did not fall silent after unregistering the ${kind} source (${show(after)})`);
      return result;
    };

    const stereo = await measure(2);
    const reference = stereo[1].right;
    const silent = (value: number) => value < reference * SILENT;
    const near = (value: number) => value > reference / LEVEL_TOLERANCE && value < reference * LEVEL_TOLERANCE;
    const pansRight = (l: Levels) => silent(l.left) && near(l.right);
    const pansLeft = (l: Levels) => silent(l.right) && near(l.left);
    const centred = (l: Levels) => !silent(l.left) && !silent(l.right) && l.left / l.right > 1 / LEVEL_TOLERANCE && l.left / l.right < LEVEL_TOLERANCE;
    const expectedOf = (pan: number) => (pan < 0 ? "signal on the left, right silent" : pan > 0 ? "left silent, signal on the right" : "the same signal on both sides");
    const judge = (pan: number, l: Levels) => (pan < 0 ? pansLeft(l) : pan > 0 ? pansRight(l) : centred(l));
    for (const pan of PANS) row({ step: `stereo source, ${panLabel(pan)} (control)`, expected: expectedOf(pan), got: show(stereo[pan]), ok: reference > SIGNAL_MIN && judge(pan, stereo[pan]) });
    const controlsOk = reference > SIGNAL_MIN && PANS.every((pan) => judge(pan, stereo[pan]));

    const mono = await measure(1);
    for (const pan of PANS) row({ step: `mono source, ${panLabel(pan)}`, expected: expectedOf(pan), got: show(mono[pan]), ok: controlsOk ? judge(pan, mono[pan]) : null });

    enter("main output");
    const settings = project.engine.preferences.settings;
    settings.metronome.enabled = true;
    project.engine.play();
    let clickPeak = 0;
    for (let i = 0; i < 40; i++) { await sleep(40); clickPeak = Math.max(clickPeak, peakOf(main, buffer)); }
    project.engine.stop(true);
    settings.metronome.enabled = false;
    const tapWorks = clickPeak > SIGNAL_MIN;
    const leak = (["stereo", "mono"] as const).filter((kind) => mainPeaks[kind] >= MAIN_SILENT);
    for (const kind of ["stereo", "mono"] as const) row({ step: `main output while the ${kind} source is monitored (openDAW#528)`, expected: `silent (peak under ${MAIN_SILENT})`, got: `peak ${mainPeaks[kind].toFixed(5)}`, ok: tapWorks ? mainPeaks[kind] < MAIN_SILENT : null });
    row({ step: "main output, metronome playing, nothing monitored (control for the tap)", expected: `peak over ${SIGNAL_MIN}`, got: `peak ${clickPeak.toFixed(4)}`, ok: tapWorks });
    const mainNote = !tapWorks ? "; the main-output tap read no metronome, so the main-output rows prove nothing"
      : leak.length > 0 ? `; the MAIN output carried the monitored signal (${leak.join(", ")}): openDAW#528 is back` : "; the main output stayed silent while monitoring";

    const right = mono[1];
    const verdict: Verdict = !controlsOk ? "INCONCLUSIVE"
      : silent(right.left) && silent(right.right) ? "BUG PRESENT"
      : PANS.every((pan) => judge(pan, mono[pan])) ? "FIXED" : "INCONCLUSIVE";
    const message = verdict === "BUG PRESENT"
      ? `a mono source panned hard right returns silence on both sides (${show(right)}) where the stereo source returns ${show(stereo[1])}; panned hard left it returns ${show(mono[-1])}, at the centre ${show(mono[0])}`
      : verdict === "FIXED" ? `the mono source's return follows the pan like the stereo source's (pan +1: ${show(right)})`
      : !controlsOk ? `the stereo control does not read as a pan (−1: ${show(stereo[-1])}; 0: ${show(stereo[0])}; +1: ${show(stereo[1])})`
      : `mono rows read neither way (−1: ${show(mono[-1])}; 0: ${show(mono[0])}; +1: ${show(right)})`;
    return { verdict, rows, message: message + mainNote };
  } catch (error) {
    if (error instanceof Hung) {
      rows.push({ step: stage, expected: "", got: `deadline passed in ${error.stage}`, ok: false });
      return { verdict: "HUNG", rows, message: `deadline passed in ${error.stage}` };
    }
    rows.push({ step: stage, expected: "", got: String(error), ok: false });
    console.error(`[monitor-mono-return] ${stage}: ${String(error)}`);
    return { verdict: "THREW", rows, message: `${stage}: ${String(error)}` };
  }
}

function App() {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const start = useCallback(() => {
    setState({ kind: "running", stage: "init", rows: [] });
    run((stage, rows) => setState({ kind: "running", stage, rows }))
      .then((done) => setState({ kind: "done", ...done }), (error) => setState({ kind: "done", verdict: "THREW", rows: [], message: String(error) }));
  }, []);
  const rows = state.kind === "idle" ? [] : state.rows;
  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" py="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Heading size="6">Effects monitoring: the return of a mono source (debug)</Heading>
          <Text size="2" color="gray">
            A 440 Hz tone is registered as an effects-monitoring source of a Tape unit with{" "}
            <Code>engine.registerMonitoringSource</Code>, first as a stereo source, then as a mono one. For the unit's pan at −1,
            0 and +1 the page reads the level of the return's left and right channels. The return goes to analysers only, so the
            page is silent. A real click starts it; one run per page load.
          </Text>
          <Flex gap="3" align="center">
            <Button id="run" size="3" onClick={start} disabled={state.kind !== "idle"}>Run</Button>
            {state.kind === "running" && <Badge color="amber">running: {state.stage}</Badge>}
            {state.kind === "done" && (
              <Badge id="verdict" data-verdict={state.verdict} color={state.verdict === "FIXED" ? "green" : state.verdict === "BUG PRESENT" ? "red" : "gray"} size="2">
                {state.verdict} — {state.message}
              </Badge>
            )}
          </Flex>
          {rows.length > 0 && (
            <Card>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>return RMS</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>ok</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r, i) => (
                    <Table.Row key={i} data-ok={String(r.ok)}>
                      <Table.Cell><Text size="1">{r.step}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.expected}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.got}</Text></Table.Cell>
                      <Table.Cell>{r.ok === null ? <Badge color="gray">?</Badge> : r.ok ? <Badge color="green">ok</Badge> : <Badge color="red">FAIL</Badge>}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          )}
          <DebugLinkBar
            links={[
              { label: "debug/2026-11-23-fx-monitor-mono-return/note.md", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-fx-monitor-mono-return/note.md", kind: "note" },
            ]}
          />
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
