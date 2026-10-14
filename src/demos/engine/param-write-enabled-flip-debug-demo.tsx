import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { PPQN, type ppqn } from "@opendaw/lib-dsp";
import { EffectFactories } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { VaporisateurDeviceBox, type StereoToolDeviceBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { audioEffectsFieldOf } from "@/lib/adapterUtils";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Button, Code, Table } from "@radix-ui/themes";

// Repro for `debug/2026-10-14-param-write-lost-on-enabled-flip/note.md`.
//
// A Vaporisateur plays one quarter note (0.25–0.75 s) in a 4 s loop; a StereoTool sits in its effect
// chain (bypassed to begin with: `enabled` false). The synth's `release` field sets how long the note
// rings after 0.75 s, which this page reads off the engine output: RMS every 50 ms, the tail is the time
// from note-off until the level falls under a tenth of the note's own level.
//
//  1. `release = 0.5` written alone                                  → tail about 0.5 s
//  2. StereoTool `enabled` false→true AND `release = 2.0`, ONE transaction → expected about 2 s
//  3. StereoTool `enabled` true→false, THEN `release = 2.5`, separate transactions → about 2.5 s
//  4. `release = 0.5` written alone                                  → about 0.5 s
//
// With the defect, step 2's tail stays at step 1's length: the box holds 2.0 and the engine keeps 0.5
// until the field changes again (step 3). The verdict is BUG PRESENT when step 2 reads like step 1
// while step 3 reads long, FIXED when step 2 reads long, INCONCLUSIVE otherwise.
const BPM = 120;
const LOOP = (PPQN.Quarter * 8) as ppqn; // 4 s at 120 bpm: no wrap inside the longest tail
const NOTE_AT = (PPQN.Quarter / 2) as ppqn; // 0.25 s
const NOTE_LEN = PPQN.Quarter as ppqn; // 0.5 s
const NOTE_OFF_S = 0.75;
const SAMPLE_MS = 50;
const CAPTURE_S = 3.6;
const TAIL_FRACTION = 0.1;
const SHORT_MAX_S = 1.0;
const LONG_MIN_S = 1.5;

type Row = { step: string; expected: string; got: string; ok: boolean | null };
type Verdict = "BUG PRESENT" | "FIXED" | "INCONCLUSIVE" | "THREW";
type RunState = { kind: "idle" } | { kind: "running"; rows: Row[] } | { kind: "done"; verdict: Verdict; rows: Row[]; message: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rmsOf = (analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number => {
  analyser.getFloatTimeDomainData(buffer);
  let acc = 0;
  for (let i = 0; i < buffer.length; i++) acc += buffer[i] * buffer[i];
  return Math.sqrt(acc / buffer.length);
};
/** Seconds from note-off until the level stays under a tenth of the note's own level; null = never within the capture. */
const tailOf = (levels: number[]): { tailS: number | null; noteLevel: number; profile: string } => {
  const noteOffIndex = Math.round((NOTE_OFF_S * 1000) / SAMPLE_MS);
  const noteLevel = Math.max(...levels.slice(0, noteOffIndex));
  let last = -1;
  for (let i = noteOffIndex; i < levels.length; i++) if (levels[i] > noteLevel * TAIL_FRACTION) last = i;
  const profile = levels.filter((_, i) => i % 4 === 0).map((v) => (v < 0.0005 ? "0" : v.toFixed(3))).join(" ");
  return { tailS: last < 0 ? 0 : last + 1 >= levels.length ? null : ((last + 1) * SAMPLE_MS) / 1000 - NOTE_OFF_S, noteLevel, profile };
};
const fmt = (tailS: number | null) => (tailS === null ? "beyond the capture" : `${Math.round(tailS * 1000)} ms`);

async function run(onRows: (rows: Row[]) => void): Promise<{ verdict: Verdict; rows: Row[]; message: string }> {
  const rows: Row[] = [];
  const row = (r: Row) => { rows.push(r); onRows([...rows]); console.log(`[param-write-page] ${r.step}: ${r.got}`); };
  try {
    let analyser: AnalyserNode | null = null;
    const { project, audioContext } = await initializeOpenDAW({
      bpm: BPM,
      engineTap: (node) => { analyser = node.context.createAnalyser(); analyser.fftSize = 2048; node.connect(analyser, 0); },
    });
    if (analyser === null) throw new Error("engineTap never ran");
    const tap: AnalyserNode = analyser;
    if (audioContext.state !== "running") await audioContext.resume();
    const built = project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Vaporisateur, { name: "Synth" })).unwrap("createInstrument");
    const synth = built.instrumentBox;
    if (!(synth instanceof VaporisateurDeviceBox)) throw new Error("not a VaporisateurDeviceBox");
    project.editing.modify(() => {
      const region = project.api.createNoteRegion({ trackBox: built.trackBox, position: 0 as ppqn, duration: LOOP, loopDuration: LOOP });
      project.api.createNoteEvent({ owner: region, position: NOTE_AT, duration: NOTE_LEN, pitch: 55, velocity: 0.8 });
      project.timelineBox.loopArea.from.setValue(0);
      project.timelineBox.loopArea.to.setValue(LOOP);
      project.timelineBox.loopArea.enabled.setValue(true);
    });
    const effectsField = audioEffectsFieldOf(project, built.audioUnitBox);
    const tool = project.editing.modify(() => project.api.insertEffect(effectsField, EffectFactories.StereoTool)).unwrap("insertEffect") as StereoToolDeviceBox;
    project.editing.modify(() => tool.enabled.setValue(false));
    await project.engine.queryLoadingComplete();
    await sleep(500);
    const buffer = new Float32Array(tap.fftSize);
    // hard stop, wait for silence, play from 0, sample the output
    const capture = async (): Promise<number[]> => {
      project.engine.stop(true);
      for (let i = 0; i < 60 && rmsOf(tap, buffer) > 1e-3; i++) await sleep(50);
      await sleep(300);
      await project.engine.play();
      const levels: number[] = [];
      const started = performance.now();
      for (let i = 0; i * SAMPLE_MS < CAPTURE_S * 1000; i++) {
        const due = started + (i + 1) * SAMPLE_MS;
        while (performance.now() < due) await sleep(2);
        levels.push(rmsOf(tap, buffer));
      }
      project.engine.stop(true);
      return levels;
    };
    const measure = async (step: string, expected: string, judge: (tailS: number | null) => boolean | null) => {
      const { tailS, noteLevel, profile } = tailOf(await capture());
      row({ step, expected, got: `tail ${fmt(tailS)} (note level ${noteLevel.toFixed(3)}, box release ${synth.release.getValue().toFixed(2)} s, StereoTool enabled ${tool.enabled.getValue()}); RMS/200 ms: ${profile}`, ok: judge(tailS) });
      return tailS;
    };
    const isShort = (t: number | null) => t !== null && t < SHORT_MAX_S;
    const isLong = (t: number | null) => t === null || t > LONG_MIN_S;

    project.editing.modify(() => synth.release.setValue(0.5));
    await sleep(300);
    const t1 = await measure("1. release 0.5 alone", "about 500 ms", isShort);
    project.editing.modify(() => { tool.enabled.setValue(true); synth.release.setValue(2.0); });
    await sleep(300);
    const t2 = await measure("2. StereoTool enabled false→true + release 2.0, ONE transaction", "about 2000 ms if the write arrives", (t) => isLong(t) ? true : isShort(t) ? false : null);
    project.editing.modify(() => tool.enabled.setValue(false));
    project.editing.modify(() => synth.release.setValue(2.5));
    await sleep(300);
    const t3 = await measure("3. StereoTool enabled true→false, THEN release 2.5, separate transactions", "about 2500 ms", isLong);
    project.editing.modify(() => synth.release.setValue(0.5));
    await sleep(300);
    const t4 = await measure("4. release 0.5 alone", "about 500 ms", isShort);

    const verdict: Verdict = !isShort(t1) || !isLong(t3) || !isShort(t4) ? "INCONCLUSIVE" : isLong(t2) ? "FIXED" : isShort(t2) ? "BUG PRESENT" : "INCONCLUSIVE";
    const message = verdict === "BUG PRESENT"
      ? `step 2's tail (${fmt(t2)}) is step 1's (${fmt(t1)}): the release written next to the enabled flip never reached the engine; written alone (step 3) it did (${fmt(t3)})`
      : verdict === "FIXED" ? `step 2's tail ${fmt(t2)} follows the write` : `the controls did not read as expected (1: ${fmt(t1)}, 3: ${fmt(t3)}, 4: ${fmt(t4)})`;
    return { verdict, rows, message };
  } catch (error) {
    rows.push({ step: "error", expected: "", got: String(error), ok: false });
    console.error(`[param-write-page] ${String(error)}`);
    return { verdict: "THREW", rows, message: String(error) };
  }
}

function App() {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const start = useCallback(() => {
    setState({ kind: "running", rows: [] });
    run((rows) => setState({ kind: "running", rows })).then((done) => setState({ kind: "done", ...done }));
  }, []);
  const rows = state.kind === "idle" ? [] : state.rows;
  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" py="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Heading size="6">Parameter write lost on an effect's enabled flip (debug)</Heading>
          <Text size="2" color="gray">
            A Vaporisateur plays one quarter note in a 4 s loop with a bypassed StereoTool in its chain. Each step writes the
            synth's <Code>release</Code> and reads the note's tail off the engine output. Step 2 writes it in the same{" "}
            <Code>editing.modify</Code> as the StereoTool's <Code>enabled</Code> flip. A real click starts it; one run per page load (the engine boots once).
          </Text>
          <Flex gap="3" align="center">
            <Button id="run" size="3" onClick={start} disabled={state.kind !== "idle"}>Run</Button>
            {state.kind === "running" && <Badge color="amber">running</Badge>}
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
                    <Table.ColumnHeaderCell>step</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>got</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>ok</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r, i) => (
                    <Table.Row key={i} data-step={i + 1} data-ok={String(r.ok)}>
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
              { label: "debug/2026-10-14-param-write-lost-on-enabled-flip/note.md", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-14-param-write-lost-on-enabled-flip/note.md", kind: "note" },
            ]}
          />
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
