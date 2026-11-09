import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Interpolation, PPQN, type ppqn } from "@opendaw/lib-dsp";
import type { Field } from "@opendaw/lib-box";
import type { Pointers } from "@opendaw/studio-enums";
import { AudioUnitBoxAdapter, InstrumentFactories, ValueRegionBoxAdapter } from "@opendaw/studio-adapters";
import { ValueRegionBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { audioUnitAdapterFor } from "@/lib/adapterUtils";
import { removeMasterMaximizer } from "@/lib/audit/midiEffectChain";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Button, Code, Table } from "@radix-ui/themes";

// Repro for `debug/2026-11-09-frame-clock-consumers/note.md`.
//
// A Vaporisateur holds one note through a 4 s loop. Its unit's volume has an automation lane that is flat at
// 0 dB, and the volume's own field also sits at 0 dB, so the lane and the field sound the same until the
// field is written. Each row plays, stops with `engine.stop(true)`, then writes the volume field to unit 0
// (−∞ dB, silence) — at once (same task), after a delay, or (control) once `engine.isPlaying` reads false — and
// plays again. A lane that follows its curve plays at 0 dB; a lane left suspended (`AutomationSuspension`, #347)
// plays the field and the output falls by more than SUSPENDED_DB. The level is the RMS of the engine's output
// (`engineTap`) over 1 s, starting 0.5 s after `isPlaying` reads true. The master Maximizer is removed first so
// the levels are the mix's own. The positive control writes the field DURING playback, which suspends the lane
// by design: its level must fall by more than SUSPENDED_DB.
//
// Verdict once the positive control fires, the first "before" level is above MIN_LEVEL_DB and every "before"
// level is within LEVEL_TOLERANCE_DB of it: BUG PRESENT when the rows split exactly by `isPlaying` at the write
// (suspended where it read true, the curve where it read false); FIXED when every row follows the curve AND at
// least one write saw `isPlaying` true (the gap was exercised); INCONCLUSIVE otherwise. HUNG / THREW as on the
// other pages. With the SDK as measured the 0 ms row, written in the same task as `stop()`, sees `isPlaying` true.
// `?frameDriver=throttled&frameEvery=5` keeps every fifth display frame (24 a second on a 120 Hz panel, 12 on a
// 60 Hz one) and widens the gap.
const BPM = 120;
const LOOP = (PPQN.Quarter * 8) as ppqn; // 4 s at 120 bpm
const DELAYS_MS: ReadonlyArray<number | null> = [null, 0, 10, 20, 40, 80, 160]; // null = control
const SETTLE_MS = 500;
const SAMPLE_MS = 1000;
const SUSPENDED_DB = 30;
const LEVEL_TOLERANCE_DB = 3;
const MIN_LEVEL_DB = -40; // the held note measured about −20 dB RMS

type Row = { step: string; playingAtWrite: string; got: string; result: string; ok: boolean | null };
type Verdict = "BUG PRESENT" | "FIXED" | "INCONCLUSIVE" | "HUNG" | "THREW";
type RunState = { kind: "idle" } | { kind: "running"; stage: string; rows: Row[] } | { kind: "done"; verdict: Verdict; rows: Row[]; message: string };

class Hung extends Error { constructor(readonly stage: string) { super(`hung in ${stage}`); } }
const race = <T,>(stage: string, promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Hung(stage)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const until = async (stage: string, condition: () => boolean, ms = 3000): Promise<void> => {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > ms) throw new Hung(stage);
    await sleep(1);
  }
};
const db = (rms: number) => (rms > 0 ? 20 * Math.log10(rms) : -Infinity);
const fmtDb = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)} dB` : "silent");

async function run(onStage: (stage: string, rows: Row[]) => void): Promise<{ verdict: Verdict; rows: Row[]; message: string }> {
  const rows: Row[] = [];
  let stage = "init";
  let stopTransport: (() => void) | null = null;
  const enter = (name: string) => { stage = name; onStage(stage, [...rows]); };
  const row = (r: Row) => { rows.push(r); onStage(stage, [...rows]); console.log(`[suspension-page] ${r.step}: ${r.got} -> ${r.result}`); };
  try {
    let analyser: AnalyserNode | null = null;
    const { project, audioContext } = await race(stage, initializeOpenDAW({
      bpm: BPM,
      engineTap: (node) => { analyser = node.context.createAnalyser(); analyser.fftSize = 2048; node.connect(analyser, 0); },
    }), 90_000);
    if (analyser === null) throw new Error("engineTap never ran");
    const tap: AnalyserNode = analyser;
    const { engine, editing } = project;
    stopTransport = () => engine.stop(true);
    if (audioContext.state !== "running") await race("resume (needs a real click)", audioContext.resume(), 10_000);
    if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} after resume`);

    enter("build");
    const master = project.rootBoxAdapter.audioUnits.adapters().find((unit) => unit.isOutput);
    if (master === undefined) throw new Error("the project has no master unit");
    const removed = removeMasterMaximizer(editing, master.audioEffects.unwrap("the master hosts no audio-effect chain").adapters());
    if (removed !== 1) throw new Error(`expected one Maximizer on the master, removed ${removed}`);
    const built =editing.modify(() => project.api.createInstrument(InstrumentFactories.Vaporisateur, { name: "Synth" })).unwrap("createInstrument");
    const unitBox = built.audioUnitBox;
    editing.modify(() => {
      const region = project.api.createNoteRegion({ trackBox: built.trackBox, position: 0 as ppqn, duration: LOOP, loopDuration: LOOP });
      project.api.createNoteEvent({ owner: region, position: 0 as ppqn, duration: LOOP, pitch: 57, velocity: 0.8 });
      project.timelineBox.loopArea.from.setValue(0);
      project.timelineBox.loopArea.to.setValue(LOOP);
      project.timelineBox.loopArea.enabled.setValue(true);
    });
    // The volume field's pointer union includes MIDIControl/Modulation; the API takes the Automation-typed field.
    const laneTrack = editing.modify(() =>
      project.api.createAutomationTrack(unitBox, unitBox.volume as unknown as Field<Pointers.Automation>)).unwrap("createAutomationTrack");
    const laneRegion = editing.modify(() => project.api.createTrackRegion(laneTrack, 0 as ppqn, LOOP)).unwrap("createTrackRegion").unwrap("no lane region");
    if (!(laneRegion instanceof ValueRegionBox)) throw new Error("the lane region is not a ValueRegionBox");
    const zeroDb = AudioUnitBoxAdapter.VolumeMapper.x(0);
    // createTrackRegion seeds one node at 0 that the adapter sees only after the creating commit: clear it in append
    editing.append(() => {
      const collection = project.boxAdapters.adapterFor(laneRegion, ValueRegionBoxAdapter).optCollection.unwrap("no event collection");
      collection.events.asArray().forEach((event) => event.box.delete());
      collection.createEvent({ position: 0 as ppqn, index: 0, value: zeroDb, interpolation: Interpolation.Linear });
      collection.createEvent({ position: LOOP, index: 0, value: zeroDb, interpolation: Interpolation.None });
    });
    const volume = audioUnitAdapterFor(project, unitBox).namedParameter.volume;
    const fieldAtZeroDb = volume.getUnitValue();
    const loaded = await race(stage, engine.queryLoadingComplete(), 30_000);
    if (!loaded) throw new Error("queryLoadingComplete returned false (no worklet)");

    const buffer = new Float32Array(tap.fftSize);
    const level = async (): Promise<number> => {
      await sleep(SETTLE_MS);
      let sum = 0;
      let count = 0;
      const end = performance.now() + SAMPLE_MS;
      while (performance.now() < end) {
        tap.getFloatTimeDomainData(buffer);
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        count += buffer.length;
        await sleep(20);
      }
      return db(Math.sqrt(sum / Math.max(1, count)));
    };
    const play = async (name: string) => {
      engine.setPosition(0 as ppqn);
      engine.play();
      await until(`${name}: isPlaying`, () => engine.isPlaying.getValue());
    };
    const stopAndSettle = async (name: string) => {
      engine.stop(true);
      await until(`${name}: stop`, () => !engine.isPlaying.getValue());
      await sleep(300);
    };
    const restoreField = () => editing.modify(() => volume.setUnitValue(fieldAtZeroDb), false);

    enter("positive control");
    restoreField();
    await play("positive control");
    const controlBefore = await level();
    editing.modify(() => volume.setUnitValue(0), false);
    const controlAfter = await level();
    await stopAndSettle("positive control");
    const controlFired = controlAfter < controlBefore - SUSPENDED_DB;
    row({
      step: "positive control: field to 0 DURING playback",
      playingAtWrite: "true",
      got: `${fmtDb(controlBefore)} → ${fmtDb(controlAfter)}`,
      result: controlFired ? "lane suspended (by design)" : "no drop: the measurement cannot see a suspension",
      ok: controlFired,
    });

    const results: Array<{ playingAtWrite: boolean; before: number; after: number }> = [];
    for (const delay of DELAYS_MS) {
      const name = delay === null ? "control: write once isPlaying reads false" : `write ${delay} ms after stop`;
      enter(name);
      restoreField();
      await play(name);
      const before = await level();
      const stoppedAt = performance.now();
      engine.stop(true);
      if (delay === null) await until(`${name}: flag`, () => !engine.isPlaying.getValue());
      else if (delay > 0) await sleep(delay);
      const playingAtWrite = engine.isPlaying.getValue();
      const writtenAt = performance.now() - stoppedAt;
      editing.modify(() => volume.setUnitValue(0), false);
      await until(`${name}: flag after write`, () => !engine.isPlaying.getValue());
      const flagFalseAt = performance.now() - stoppedAt;
      await sleep(300);
      await play(name);
      const after = await level();
      await stopAndSettle(name);
      const suspended = after < before - SUSPENDED_DB;
      results.push({ playingAtWrite, before, after });
      row({
        step: name,
        playingAtWrite: `${playingAtWrite} (written ${writtenAt.toFixed(1)} ms after stop; false after ${flagFalseAt.toFixed(1)} ms)`,
        got: `${fmtDb(before)}, next play ${fmtDb(after)}`,
        result: suspended ? "curve ignored on the next play" : "curve followed",
        ok: null, // a row is data; the verdict reads the rows together
      });
    }
    restoreField();

    const reference = results[0].before;
    const levelsOk = reference > MIN_LEVEL_DB && results.every((r) => Math.abs(r.before - reference) < LEVEL_TOLERANCE_DB);
    const suspendedRows = results.filter((r) => r.after < r.before - SUSPENDED_DB);
    const splitByFlag = results.every((r) => (r.after < r.before - SUSPENDED_DB) === r.playingAtWrite);
    const gap = results.filter((r) => r.playingAtWrite).length;
    const verdict: Verdict = !controlFired || !levelsOk ? "INCONCLUSIVE"
      : suspendedRows.length === 0 ? (gap > 0 ? "FIXED" : "INCONCLUSIVE")
      : splitByFlag ? "BUG PRESENT" : "INCONCLUSIVE";
    const message = verdict === "BUG PRESENT"
      ? `${suspendedRows.length} of ${results.length} rows played the next pass at the field value (curve ignored); each was written while isPlaying still read true after stop (${gap} rows), and every row written after the flag flipped followed the curve`
      : verdict === "FIXED" ? `every row followed the curve on the next play, including the ${gap} writes that saw isPlaying true after stop`
      : gap === 0 && suspendedRows.length === 0 && controlFired && levelsOk
        ? "no write saw isPlaying true after stop, so the gap was not exercised (did stop() start clearing the flag at once?)"
        : `controls or levels off (positive control ${fmtDb(controlBefore)} → ${fmtDb(controlAfter)}; first level ${fmtDb(reference)}; rows split by the flag: ${splitByFlag})`;
    return { verdict, rows, message };
  } catch (error) {
    let stopFailure = "";
    try { stopTransport?.(); } catch (stopError) { stopFailure = `; stopping the transport also failed: ${String(stopError)}`; }
    if (error instanceof Hung) {
      const message = `deadline passed in ${error.stage} (document ${document.visibilityState})${stopFailure}`;
      rows.push({ step: stage, playingAtWrite: "", got: message, result: "", ok: false });
      console.error(`[suspension-page] HUNG: ${message}`);
      return { verdict: "HUNG", rows, message };
    }
    rows.push({ step: stage, playingAtWrite: "", got: `${String(error)}${stopFailure}`, result: "", ok: false });
    console.error(`[suspension-page] ${stage}: ${String(error)}${stopFailure}`);
    return { verdict: "THREW", rows, message: `${stage}: ${String(error)}${stopFailure}` };
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
          <Heading size="6">Automation lane left suspended by a write just after Stop (debug)</Heading>
          <Text size="2" color="gray">
            A synth holds one note under a volume lane that is flat at 0 dB. Each row stops the transport, writes the
            volume's own field to silence (unit 0, −∞ dB) at once, after a delay, or once <Code>engine.isPlaying</Code>{" "}
            reads false, and plays again. A lane that follows its curve plays at 0 dB; a lane left suspended plays the field
            and goes silent. About a minute; a real click starts it; one run per page load. Add{" "}
            <Code>?frameDriver=throttled&amp;frameEvery=5</Code> to keep every fifth display frame (24 updates a second on a
            120 Hz panel).
          </Text>
          <Flex gap="3" align="center">
            <Button id="run" size="3" onClick={start} disabled={state.kind !== "idle"}>Run</Button>
            {state.kind === "running" && <Badge color="amber">running: {state.stage}</Badge>}
            {state.kind === "done" && (
              <Badge id="verdict" data-verdict={state.verdict} color={state.verdict === "FIXED" ? "green" : state.verdict === "BUG PRESENT" ? "red" : "gray"} size="2" style={{ whiteSpace: "normal" }}>
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
                    <Table.ColumnHeaderCell>isPlaying at the write</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>level</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>result</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r, i) => (
                    <Table.Row key={i} data-ok={String(r.ok)}>
                      <Table.Cell><Text size="1">{r.step}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.playingAtWrite}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.got}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.result}</Text></Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          )}
          <DebugLinkBar
            links={[
              { label: "debug/2026-11-09-frame-clock-consumers/note.md", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-09-frame-clock-consumers/note.md", kind: "note" },
            ]}
          />
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
