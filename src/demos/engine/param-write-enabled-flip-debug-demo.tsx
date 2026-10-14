import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { PPQN, type ppqn } from "@opendaw/lib-dsp";
import { EffectFactories } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { StereoToolDeviceBox, VaporisateurDeviceBox } from "@opendaw/studio-boxes";
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
// chain, bypassed to begin with (`enabled` false). The synth's `release` sets how long the note rings
// after note-off, and this page reads that off the engine output: RMS every 50 ms, the note's onset is
// the first sample above a tenth of the capture's peak, note-off is 0.5 s later, and the tail is the time
// from note-off until the level STAYS under a tenth of the note's own level. The tail reads at roughly
// 0.8 × the release value (the −20 dB point of the envelope), so the steps are judged as short (under
// SHORT_MAX_S) or long (over LONG_MIN_S, or still ringing when the capture ends).
//
//  1. `release = 0.5` alone (StereoTool off)                                      → short      control
//  2. StereoTool `enabled` false→true AND `release = 2.5`, ONE transaction          → long (about 2 s, inside the capture) if the write arrives
//  2b. `release = 2.5` alone (same value, StereoTool on)                           → unchanged: a write of the
//      value the box already holds emits no update (lib-box `PrimitiveField.setValue`)
//  2c. `release = 3.0` alone (StereoTool on)                                        → long       control: the enabled
//      chain takes a parameter write
//  3. StereoTool `enabled` true→false AND `release = 0.5`, ONE transaction          → short if the write arrives
//  4. `release = 0.6` alone (StereoTool off)                                        → short      control
//  5. StereoTool `enabled` false→true, THEN `release = 2.0`, SEPARATE transactions  → long       control
//
// With the defect, step 2 reads like step 1 (the box holds 2.5, the engine keeps 0.5) and step 3 reads
// like step 2c (the engine keeps 3.0). Verdict, once every control reads as expected and the judged steps'
// note level is within a factor of two of step 1's: BUG PRESENT when step 2 is short and step 3 long,
// FIXED when step 2 is long and step 3 short, INCONCLUSIVE otherwise; HUNG names the stage whose deadline
// passed, THREW carries the error (also when the output does not fall silent before a step, the context is
// not running, or the sampling clock drifted: a throttled tab). One run per page load (the engine boots once).
const BPM = 120;
const LOOP = (PPQN.Quarter * 8) as ppqn; // 4 s at 120 bpm: no wrap inside the longest tail
const NOTE_AT = (PPQN.Quarter / 2) as ppqn; // 0.25 s
const NOTE_LEN = PPQN.Quarter as ppqn; // 0.5 s
const NOTE_LEN_S = 0.5;
const SAMPLE_MS = 50;
const CAPTURE_S = 3.6;
const ONSET_FRACTION = 0.1;
const TAIL_FRACTION = 0.1;
const SHORT_MAX_S = 1.0;
const LONG_MIN_S = 1.2;
const LEVEL_TOLERANCE = 2; // a judged step's note level must be within this factor of step 1's
const ONSET_MIN = 0.01; // a capture whose peak RMS stays under this holds no note (the note plays at about 0.18)
const QUIET = 1e-3; // a capture starts once the output is under this

type Row = { step: string; expected: string; got: string; ok: boolean | null };
type Verdict = "BUG PRESENT" | "FIXED" | "INCONCLUSIVE" | "HUNG" | "THREW";
type RunState = { kind: "idle" } | { kind: "running"; stage: string; rows: Row[] } | { kind: "done"; verdict: Verdict; rows: Row[]; message: string };
type Tail = { tailS: number | null; noteLevel: number; onsetS: number | null; profile: string };

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
/** The note's onset, level and tail from one capture. `tailS` null = still ringing when the capture ended; `onsetS` null = no note. */
const tailOf = (levels: number[]): Tail => {
  const profile = levels.filter((_, i) => i % 4 === 0).map((v) => (v < 0.0005 ? "0" : v.toFixed(3))).join(" ");
  const peak = Math.max(...levels);
  const onset = levels.findIndex((v) => v > peak * ONSET_FRACTION);
  if (peak < ONSET_MIN || onset < 0) return { tailS: null, noteLevel: peak, onsetS: null, profile };
  const noteOff = onset + Math.round((NOTE_LEN_S * 1000) / SAMPLE_MS);
  const noteLevel = Math.max(...levels.slice(onset, noteOff));
  let last = -1;
  for (let i = noteOff; i < levels.length; i++) if (levels[i] > noteLevel * TAIL_FRACTION) last = i;
  const tailS = last < 0 ? 0 : last + 1 >= levels.length ? null : ((last + 1 - noteOff) * SAMPLE_MS) / 1000;
  return { tailS, noteLevel, onsetS: (onset * SAMPLE_MS) / 1000, profile };
};
const fmt = (tailS: number | null) => (tailS === null ? "beyond the capture" : `${Math.round(tailS * 1000)} ms`);
const isShort = (t: Tail) => t.onsetS !== null && t.tailS !== null && t.tailS < SHORT_MAX_S;
const isLong = (t: Tail) => t.onsetS !== null && (t.tailS === null || t.tailS > LONG_MIN_S);
const SHORT = `short (under ${SHORT_MAX_S} s)`;
const LONG = `long (over ${LONG_MIN_S} s, or beyond the capture)`;

async function run(onStage: (stage: string, rows: Row[]) => void): Promise<{ verdict: Verdict; rows: Row[]; message: string }> {
  const rows: Row[] = [];
  let stage = "init";
  let stopTransport: (() => void) | null = null;
  const enter = (name: string) => { stage = name; onStage(stage, [...rows]); };
  const row = (r: Row) => { rows.push(r); onStage(stage, [...rows]); console.log(`[param-write-page] ${r.step}: ${r.got}`); };
  try {
    enter("init");
    let analyser: AnalyserNode | null = null;
    const { project, audioContext } = await race(stage, initializeOpenDAW({
      bpm: BPM,
      engineTap: (node) => { analyser = node.context.createAnalyser(); analyser.fftSize = 2048; node.connect(analyser, 0); },
    }), 90_000);
    if (analyser === null) throw new Error("engineTap never ran");
    const tap: AnalyserNode = analyser;
    stopTransport = () => project.engine.stop(true);
    if (audioContext.state !== "running") await race("resume (needs a real click)", audioContext.resume(), 10_000);
    if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} after resume`);
    enter("build");
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
    const tool = project.editing.modify(() => project.api.insertEffect(effectsField, EffectFactories.StereoTool)).unwrap("insertEffect");
    if (!(tool instanceof StereoToolDeviceBox)) throw new Error("insertEffect did not produce a StereoToolDeviceBox");
    project.editing.modify(() => tool.enabled.setValue(false));
    const loaded = await race(stage, project.engine.queryLoadingComplete(), 30_000);
    if (!loaded) throw new Error("queryLoadingComplete returned false (no worklet)");
    await sleep(500);
    const buffer = new Float32Array(tap.fftSize);
    // hard stop (rewinds to 0, resets every device), wait for silence, play, sample the output on a 50 ms grid;
    // a precondition that fails throws, so no verdict is built on a contaminated or throttled capture
    const capture = async (): Promise<number[]> => {
      project.engine.stop(true);
      for (let i = 0; i < 60 && rmsOf(tap, buffer) > QUIET; i++) await sleep(50);
      const residue = rmsOf(tap, buffer);
      if (residue > QUIET) throw new Error(`output did not fall silent within 3 s after stop(true) before "${stage}" (RMS ${residue.toFixed(4)})`);
      await sleep(300);
      if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} before "${stage}"`);
      project.engine.play(); // the repo's facade wrapper resumes the context first when needed; the call itself returns void
      const levels: number[] = [];
      const started = performance.now();
      for (let i = 0; i * SAMPLE_MS < CAPTURE_S * 1000; i++) {
        const due = started + (i + 1) * SAMPLE_MS;
        while (performance.now() < due) await sleep(2);
        levels.push(rmsOf(tap, buffer));
      }
      const elapsed = performance.now() - started;
      project.engine.stop(true);
      if (Math.abs(elapsed - CAPTURE_S * 1000) > CAPTURE_S * 100) throw new Error(`sampling took ${Math.round(elapsed)} ms for a ${CAPTURE_S * 1000} ms capture (document ${document.visibilityState}): timers throttled`);
      return levels;
    };
    const measure = async (step: string, expected: string, judge: (t: Tail) => boolean | null): Promise<Tail> => {
      enter(step);
      const t = tailOf(await capture());
      row({ step, expected, got: `${t.onsetS === null ? "no note" : `onset ${Math.round(t.onsetS * 1000)} ms, tail ${fmt(t.tailS)}`} (note level ${t.noteLevel.toFixed(3)}, box release ${synth.release.getValue().toFixed(2)} s, StereoTool enabled ${tool.enabled.getValue()}); RMS/200 ms: ${t.profile}`, ok: judge(t) });
      return t;
    };
    const finiteLong = (t: Tail) => t.onsetS !== null && t.tailS !== null && t.tailS > LONG_MIN_S;

    project.editing.modify(() => synth.release.setValue(0.5));
    await sleep(300);
    const t1 = await measure("1. release 0.5 alone (StereoTool off)", SHORT, isShort);
    project.editing.modify(() => { tool.enabled.setValue(true); synth.release.setValue(2.5); });
    await sleep(300);
    const t2 = await measure("2. StereoTool enabled false→true + release 2.5, ONE transaction", `about 2 s if the write arrives (a tail past the capture is not accepted here)`, (t) => (finiteLong(t) ? true : isShort(t) ? false : null));
    project.editing.modify(() => synth.release.setValue(2.5));
    await sleep(300);
    const t2b = await measure("2b. release 2.5 alone (the value the box already holds; StereoTool on)", "same as step 2: a write of the held value emits no update", (t) => (isLong(t) === isLong(t2) && isShort(t) === isShort(t2) ? true : false));
    project.editing.modify(() => synth.release.setValue(3.0));
    await sleep(300);
    const t2c = await measure("2c. release 3.0 alone (StereoTool on)", LONG, isLong);
    project.editing.modify(() => { tool.enabled.setValue(false); synth.release.setValue(0.5); });
    await sleep(300);
    const t3 = await measure("3. StereoTool enabled true→false + release 0.5, ONE transaction", `${SHORT} if the write arrives (long, or past the capture, when the engine still holds 3.0)`, (t) => (isShort(t) ? true : isLong(t) ? false : null));
    project.editing.modify(() => synth.release.setValue(0.6));
    await sleep(300);
    const t4 = await measure("4. release 0.6 alone (StereoTool off)", SHORT, isShort);
    project.editing.modify(() => tool.enabled.setValue(true));
    project.editing.modify(() => synth.release.setValue(2.0));
    await sleep(300);
    const t5 = await measure("5. StereoTool enabled false→true, THEN release 2.0, SEPARATE transactions", LONG, isLong);

    const levelOk = (t: Tail) => t.noteLevel > t1.noteLevel / LEVEL_TOLERANCE && t.noteLevel < t1.noteLevel * LEVEL_TOLERANCE;
    const controlsOk = isShort(t1) && isLong(t2c) && isShort(t4) && isLong(t5) && levelOk(t2) && levelOk(t3);
    const verdict: Verdict = !controlsOk ? "INCONCLUSIVE"
      : isShort(t2) && isLong(t3) ? "BUG PRESENT"
      : finiteLong(t2) && isShort(t3) ? "FIXED" : "INCONCLUSIVE";
    const message = verdict === "BUG PRESENT"
      ? `step 2 reads ${fmt(t2.tailS)} like step 1 (${fmt(t1.tailS)}) although the box holds 2.5, and step 3 reads ${fmt(t3.tailS)} like step 2c although the box holds 0.5: the release written next to the enabled flip never reached the engine; written alone it did (2c ${fmt(t2c.tailS)}, 4 ${fmt(t4.tailS)}, 5 ${fmt(t5.tailS)}); the same-value write (2b ${fmt(t2b.tailS)}) changed nothing`
      : verdict === "FIXED" ? `step 2 reads ${fmt(t2.tailS)} and step 3 ${fmt(t3.tailS)}: both writes arrived`
      : `controls or levels off (1 ${fmt(t1.tailS)}, 2 ${fmt(t2.tailS)}, 2c ${fmt(t2c.tailS)}, 3 ${fmt(t3.tailS)}, 4 ${fmt(t4.tailS)}, 5 ${fmt(t5.tailS)}; levels 1 ${t1.noteLevel.toFixed(3)}, 2 ${t2.noteLevel.toFixed(3)}, 3 ${t3.noteLevel.toFixed(3)})`;
    return { verdict, rows, message };
  } catch (error) {
    stopTransport?.();
    if (error instanceof Hung) {
      rows.push({ step: stage, expected: "", got: `deadline passed in ${error.stage}`, ok: false });
      return { verdict: "HUNG", rows, message: `deadline passed in ${error.stage}` };
    }
    rows.push({ step: stage, expected: "", got: String(error), ok: false });
    console.error(`[param-write-page] ${stage}: ${String(error)}`);
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
          <Heading size="6">Parameter write lost on an effect's enabled flip (debug)</Heading>
          <Text size="2" color="gray">
            A Vaporisateur plays one quarter note in a 4 s loop with a StereoTool in its chain. Each step writes the synth's{" "}
            <Code>release</Code> and reads the note's tail off the engine output. Steps 2 and 3 write it in the same{" "}
            <Code>editing.modify</Code> as the StereoTool's <Code>enabled</Code> flip; the other steps are controls. A real click
            starts it; one run per page load (the engine boots once).
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
                    <Table.ColumnHeaderCell>step</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>got</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>ok</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r, i) => (
                    <Table.Row key={i} data-step={r.step.split(".")[0]} data-ok={String(r.ok)}>
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
