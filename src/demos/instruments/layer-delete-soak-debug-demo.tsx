import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import type { Project } from "@opendaw/studio-core";
import { EffectFactories, NestedHostExit } from "@opendaw/studio-core";
import {
  InstrumentCompositeBoxAdapter,
  InstrumentCompositeCellBoxAdapter,
  InstrumentFactories,
  Modulators,
  TrackType,
} from "@opendaw/studio-adapters";
import type {
  AudioUnitBox,
  CompressorDeviceBox,
  InstrumentCompositeBox,
  InstrumentCompositeCellBox,
  VaporisateurDeviceBox,
} from "@opendaw/studio-boxes";
import {
  DelayDeviceBox,
  NoteEventBox,
  NoteEventCollectionBox,
  NoteRegionBox,
  PitchDeviceBox,
  TrackBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { audioEffectsFieldOf } from "@/lib/adapterUtils";
import "@radix-ui/themes/styles.css";
import {
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Container,
  Flex,
  Heading,
  Table,
  Text,
  Theme,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Repro surface for `debug/2026-10-13-layer-delete-hang-report/note.md`: a Discord user
// reports that "deleting a layer" makes openDAW hang or crash and loses their work. The
// report names no steps. This page drives every deletion the SDK offers for a Composite
// layer and for the audio unit around it, through the real WASM engine while it plays,
// and races each step against a hang ceiling so the page says OK / HUNG / THREW on its
// own, with the last stage reached. The default engine sound is heard; keep the volume low.
//
// The scenario is what a user who "layers" sounds would have: a Composite with two synth
// layers (one carrying a midi and an audio effect) and a nested Composite as a third
// layer, a note region on the unit, a value lane automating the first layer's gain, a
// modulator on the first layer's synth, and a second unit whose Compressor side-chains
// from the Composite unit's output.
//
// Steps: delete the edited layer the way the layer row's icon does (no pointer move, the
// SDK's NestedHostExit moves the editing pointer after the transaction) and undo; delete
// it the way the layer's context menu does (pointer moved inside the transaction) with
// undo, redo, undo; delete the nested layer from inside it; delete the side-chain source
// unit while playing; then a soak of random deletes and undos. After every deletion the
// page checks the layer count, `verifyPointers`, that the engine position still
// advances, and that the output is not silent.

const HANG_TIMEOUT_MS = 10_000;
const BUILD_TIMEOUT_MS = 30_000; // the first play after a cold engine boot has taken longer than 10 s once
const SOAK_CYCLES = 24;
const RMS_SOUNDING = 0.002;
const BPM = 120;

class HangError extends Error {
  constructor(readonly stage: string, timeoutMs: number) {
    super(`hung for ${timeoutMs} ms at stage "${stage}"`);
  }
}

function raceHang<T>(promise: Promise<T>, stages: () => string, timeoutMs = HANG_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new HangError(stages(), timeoutMs)),
      timeoutMs
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Outcome = "OK" | "HUNG" | "THREW" | "FAILED";

interface StepReport {
  outcome: Outcome;
  stages: string;
  elapsedMs: number;
  detail: string;
}

interface StepDef {
  key: string;
  title: string;
  description: string;
}

const STEPS: StepDef[] = [
  { key: "build", title: "Build and play", description: "Composite (2 synth layers + nested layer), notes, value lane, modulator, side-chained second unit. Transport runs; output must sound." },
  { key: "row", title: "Row-icon delete of the edited layer, then undo", description: "deleteCompositeLayer alone; NestedHostExit moves the editing pointer afterwards. Counts how many undos restore the layer." },
  { key: "menu", title: "Menu delete, undo, redo, undo", description: "Editing pointer moved to the parent inside the same transaction, as the layer's context menu does." },
  { key: "nested", title: "Delete the nested layer from inside it, undo", description: "Editing pointer on the inner layer; the outer layer (a Composite itself) is deleted." },
  { key: "unit", title: "Delete the side-chain source unit while playing, undo", description: "deleteAudioUnit on the Composite's unit while the second unit's Compressor side-chains from it." },
  { key: "soak", title: `Soak: ${SOAK_CYCLES} random delete/undo cycles`, description: "Random layer, random path, engine liveness and pointer integrity checked each cycle." },
];

interface Scenario {
  compositeUnit: AudioUnitBox;
  composite: InstrumentCompositeBox;
  layerA: InstrumentCompositeCellBox;
  layerB: InstrumentCompositeCellBox;
  outer: InstrumentCompositeCellBox;
  inner: InstrumentCompositeCellBox;
  secondUnit: AudioUnitBox;
  compressor: CompressorDeviceBox;
}

class OutputTap {
  readonly analyser: AnalyserNode;
  readonly #buffer: Float32Array<ArrayBuffer>;

  constructor(context: AudioContext) {
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.#buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
  }

  attach(engineNode: AudioNode): void {
    engineNode.connect(this.analyser, 0);
  }

  rms(): number {
    const data = this.#buffer;
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }

  async peakRms(ms: number): Promise<number> {
    let peak = 0;
    const until = performance.now() + ms;
    while (performance.now() < until) {
      peak = Math.max(peak, this.rms());
      await sleep(40);
    }
    return peak;
  }
}

const layersOf = (project: Project, composite: InstrumentCompositeBox) =>
  project.boxAdapters.adapterFor(composite, InstrumentCompositeBoxAdapter).cells.adapters();

const cellAdapter = (project: Project, cell: InstrumentCompositeCellBox) =>
  project.boxAdapters.adapterFor(cell, InstrumentCompositeCellBoxAdapter);

const editingTarget = (project: Project): string =>
  project.userEditingManager.audioUnit.get().mapOr((vertex) => vertex.box.constructor.name, "none");

async function engineAdvances(project: Project): Promise<boolean> {
  const before = project.engine.position.getValue();
  await sleep(400);
  return project.engine.position.getValue() !== before;
}

function undoUntil(project: Project, satisfied: () => boolean, max = 3): number {
  let count = 0;
  while (!satisfied() && count < max) {
    project.editing.undo();
    count++;
  }
  return count;
}

function buildScenario(project: Project): Scenario {
  const { audioUnitBox: compositeUnit, instrumentBox: composite, trackBox } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.InstrumentComposite))
    .unwrap("composite");
  const { layerA, layerB, outer } = project.editing.modify(() => {
    const layerA = project.api.createCompositeLayer(composite, InstrumentFactories.Vaporisateur).result();
    const layerB = project.api.createCompositeLayer(composite, InstrumentFactories.Vaporisateur).result();
    const outer = project.api.createCompositeLayer(composite, InstrumentFactories.InstrumentComposite).result();
    DelayDeviceBox.create(project.boxGraph, UUID.generate(), (box) => {
      box.host.refer(layerA.cellBox.audioEffects);
      box.index.setValue(0);
    });
    PitchDeviceBox.create(project.boxGraph, UUID.generate(), (box) => {
      box.host.refer(layerA.cellBox.midiEffects);
      box.index.setValue(0);
    });
    return { layerA, layerB, outer };
  }).unwrap("layers");
  const inner = project.editing.modify(() =>
    project.api.createCompositeLayer(outer.instrumentBox as InstrumentCompositeBox, InstrumentFactories.Vaporisateur).result()
  ).unwrap("inner");
  // notes: one bar of quarter notes, the region loops them for 64 bars
  project.editing.modify(() => {
    const events = NoteEventCollectionBox.create(project.boxGraph, UUID.generate());
    [48, 55, 60, 64].forEach((pitch, index) => {
      NoteEventBox.create(project.boxGraph, UUID.generate(), (box) => {
        box.events.refer(events.events);
        box.position.setValue(index * PPQN.Quarter);
        box.duration.setValue(Math.round(PPQN.Quarter * 0.9));
        box.pitch.setValue(pitch);
        box.velocity.setValue(0.8);
        box.cent.setValue(0);
      });
    });
    NoteRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
      box.regions.refer(trackBox.regions);
      box.events.refer(events.owners);
      box.position.setValue(0);
      box.duration.setValue(PPQN.Quarter * 4 * 64);
      box.loopDuration.setValue(PPQN.Quarter * 4);
    });
  });
  // a value lane automating layer A's gain (a track the cascade must take with the layer)
  const lane = project.editing.modify(() =>
    TrackBox.create(project.boxGraph, UUID.generate(), (box) => {
      box.tracks.refer(compositeUnit.tracks);
      box.target.refer(layerA.cellBox.gain);
      box.type.setValue(TrackType.Value);
      box.index.setValue(1);
    })
  ).unwrap("lane");
  project.editing.append(() => project.api.createTrackRegion(lane, 0, PPQN.Quarter * 4));
  // a modulator on layer A's synth volume
  project.editing.modify(() => {
    const modulator = project.api.modulation.create(Modulators.Kinds[0]);
    const synth = layerA.instrumentBox as VaporisateurDeviceBox;
    project.api.modulation.assign(modulator, synth.volume as never, 0.5);
  });
  // a second unit whose compressor side-chains from the composite unit
  const { audioUnitBox: secondUnit } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Vaporisateur))
    .unwrap("second unit");
  const effectsField = audioEffectsFieldOf(project, secondUnit);
  const compressor = project.editing
    .modify(() => project.api.insertEffect(effectsField, EffectFactories.AudioNamed.Compressor, 0) as CompressorDeviceBox)
    .unwrap("compressor");
  project.editing.modify(() => compressor.sideChain.refer(compositeUnit));
  project.editing.mark();
  return { compositeUnit, composite, layerA: layerA.cellBox, layerB: layerB.cellBox, outer: outer.cellBox, inner: inner.cellBox, secondUnit, compressor };
}

type StepBody = (stage: (name: string) => void, log: (line: string) => void) => Promise<string>;

function makeSteps(project: Project, tap: OutputTap, scenarioRef: { current: Scenario | null }): Record<string, StepBody> {
  const scenario = () => {
    if (scenarioRef.current === null) throw new Error("scenario not built");
    return scenarioRef.current;
  };
  const check = async (stage: (name: string) => void, label: string): Promise<string> => {
    stage(`${label}: verifyPointers`);
    const { count } = project.boxGraph.verifyPointers();
    stage(`${label}: engine position`);
    const alive = await engineAdvances(project);
    if (!alive) throw new Error(`${label}: engine position stopped advancing`);
    return `${count} pointers fine, engine advancing`;
  };
  const layers = () => layersOf(project, scenario().composite);
  return {
    build: async (stage, log) => {
      stage("build boxes");
      scenarioRef.current = buildScenario(project);
      stage("play");
      project.engine.play();
      stage("wait for position");
      for (let i = 0; i < 80 && project.engine.position.getValue() === 0; i++) {
        if (i % 10 === 9) log(`waiting: context ${tap.analyser.context.state}, visibility ${document.visibilityState}, isPlaying ${project.engine.isPlaying.getValue()}, position ${project.engine.position.getValue()}`);
        await sleep(100);
      }
      if (project.engine.position.getValue() === 0) throw new Error(`transport never advanced (context ${tap.analyser.context.state}, visibility ${document.visibilityState})`);
      stage("measure output");
      const rms = await tap.peakRms(1500);
      log(`output peak rms ${rms.toFixed(4)}, ${layers().length} layers, editing ${editingTarget(project)}`);
      if (rms < RMS_SOUNDING) throw new Error(`output silent (rms ${rms.toFixed(5)})`);
      return `${layers().length} layers, rms ${rms.toFixed(3)}`;
    },
    row: async (stage, log) => {
      const { layerA } = scenario();
      const ui = project.userEditingManager.audioUnit;
      stage("edit layer A");
      ui.edit(layerA);
      stage("deleteCompositeLayer (row path)");
      const t0 = performance.now();
      project.editing.modify(() => project.api.deleteCompositeLayer(layerA));
      const ms = performance.now() - t0;
      await Promise.resolve();
      log(`deleted in ${ms.toFixed(1)} ms, ${layers().length} layers, editing ${editingTarget(project)}`);
      if (layers().length !== 2) throw new Error(`expected 2 layers, got ${layers().length}`);
      const after = await check(stage, "after delete");
      stage("measure output");
      const rms = await tap.peakRms(800);
      stage("undo until restored");
      const undos = undoUntil(project, () => layers().length === 3);
      log(`undos needed to restore the layer: ${undos}, editing ${editingTarget(project)}`);
      if (layers().length !== 3) throw new Error(`layer not restored after ${undos} undos`);
      await check(stage, "after undo");
      scenarioRef.current = { ...scenario(), layerA: layers()[0].box };
      return `${after}; rms ${rms.toFixed(3)}; undos to restore: ${undos}`;
    },
    menu: async (stage, log) => {
      const { layerA } = scenario();
      const ui = project.userEditingManager.audioUnit;
      stage("edit layer A");
      ui.edit(layerA);
      stage("delete (menu path)");
      project.editing.modify(() => {
        ui.edit(NestedHostExit.targetsOf(cellAdapter(project, layerA))[0]);
        project.api.deleteCompositeLayer(layerA);
      });
      await Promise.resolve();
      if (layers().length !== 2) throw new Error(`expected 2 layers, got ${layers().length}`);
      stage("undo");
      project.editing.undo();
      await Promise.resolve();
      if (layers().length !== 3) throw new Error(`undo did not restore, ${layers().length} layers`);
      stage("redo");
      project.editing.redo();
      await Promise.resolve();
      if (layers().length !== 2) throw new Error(`redo did not delete, ${layers().length} layers`);
      stage("undo again");
      const undos = undoUntil(project, () => layers().length === 3);
      log(`undo, redo, then ${undos} undo(s) to restore; editing ${editingTarget(project)}`);
      if (layers().length !== 3) throw new Error(`layer not restored after redo + ${undos} undos`);
      const result = await check(stage, "after undo/redo/undo");
      scenarioRef.current = { ...scenario(), layerA: layers()[0].box };
      return `${result}; undos after redo: ${undos}`;
    },
    nested: async (stage, log) => {
      const { outer, inner } = scenario();
      const ui = project.userEditingManager.audioUnit;
      stage("edit inner layer");
      ui.edit(inner);
      stage("delete outer layer");
      project.editing.modify(() => project.api.deleteCompositeLayer(outer));
      await Promise.resolve();
      log(`${layers().length} layers, editing ${editingTarget(project)}`);
      if (layers().length !== 2) throw new Error(`expected 2 layers, got ${layers().length}`);
      await check(stage, "after delete");
      stage("undo until restored");
      const undos = undoUntil(project, () => layers().length === 3);
      if (layers().length !== 3) throw new Error(`outer layer not restored after ${undos} undos`);
      const result = await check(stage, "after undo");
      const restoredOuter = layers()[2].box;
      const innerLayers = layersOf(project, project.boxGraph.findBox(outer.address.uuid).isEmpty() ? scenario().composite : (cellAdapter(project, restoredOuter).input.adapter().unwrap().box as InstrumentCompositeBox));
      scenarioRef.current = { ...scenario(), outer: restoredOuter, inner: innerLayers[0]?.box ?? inner };
      return `${result}; undos to restore: ${undos}`;
    },
    unit: async (stage, log) => {
      const { compositeUnit, compressor } = scenario();
      stage("deleteAudioUnit (side-chain source)");
      const t0 = performance.now();
      project.editing.modify(() => project.api.deleteAudioUnit(compositeUnit));
      const ms = performance.now() - t0;
      await Promise.resolve();
      const sideChain = compressor.sideChain.targetAddress.isEmpty() ? "cleared" : "still set";
      log(`deleted in ${ms.toFixed(1)} ms, side-chain pointer ${sideChain}`);
      await check(stage, "after delete");
      stage("undo");
      project.editing.undo();
      await Promise.resolve();
      const restored = project.boxGraph.findBox(compositeUnit.address.uuid);
      if (restored.isEmpty()) throw new Error("unit not restored by undo");
      const result = await check(stage, "after undo");
      stage("measure output");
      const rms = await tap.peakRms(1500);
      if (rms < RMS_SOUNDING) throw new Error(`output silent after undo (rms ${rms.toFixed(5)})`);
      const unit = restored.unwrap() as AudioUnitBox;
      const composite = project.boxGraph.findBox(scenario().composite.address.uuid).unwrap("composite") as InstrumentCompositeBox;
      const cells = layersOf(project, composite);
      scenarioRef.current = { ...scenario(), compositeUnit: unit, composite, layerA: cells[0].box, layerB: cells[1].box, outer: cells[2].box };
      return `${result}; side-chain ${sideChain} on delete; rms ${rms.toFixed(3)} after undo`;
    },
    soak: async (stage, log) => {
      const ui = project.userEditingManager.audioUnit;
      let maxMs = 0;
      let maxUndos = 0;
      for (let cycle = 0; cycle < SOAK_CYCLES; cycle++) {
        const current = layers();
        const pick = current[Math.floor(Math.random() * current.length)];
        const menuPath = Math.random() < 0.5;
        stage(`cycle ${cycle + 1}: delete layer ${pick.indexField.getValue() + 1} (${menuPath ? "menu" : "row"})`);
        ui.edit(pick.box);
        const t0 = performance.now();
        project.editing.modify(() => {
          if (menuPath) ui.edit(NestedHostExit.targetsOf(pick)[0]);
          project.api.deleteCompositeLayer(pick.box);
        });
        maxMs = Math.max(maxMs, performance.now() - t0);
        await Promise.resolve();
        if (layers().length !== current.length - 1) throw new Error(`cycle ${cycle + 1}: delete left ${layers().length} layers`);
        stage(`cycle ${cycle + 1}: undo`);
        const undos = undoUntil(project, () => layers().length === current.length);
        maxUndos = Math.max(maxUndos, undos);
        if (layers().length !== current.length) throw new Error(`cycle ${cycle + 1}: not restored after ${undos} undos`);
        if (cycle % 6 === 5) {
          await check(stage, `cycle ${cycle + 1}`);
          log(`cycle ${cycle + 1}: max modify ${maxMs.toFixed(1)} ms, max undos ${maxUndos}`);
        }
      }
      const result = await check(stage, "end");
      stage("measure output");
      const rms = await tap.peakRms(1000);
      return `${result}; max modify ${maxMs.toFixed(1)} ms; max undos ${maxUndos}; rms ${rms.toFixed(3)}`;
    },
  };
}

const outcomeColor: Record<Outcome, "green" | "red" | "orange"> = { OK: "green", HUNG: "red", THREW: "red", FAILED: "orange" };

function App() {
  const [status, setStatus] = useState("Initializing...");
  const [project, setProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<Record<string, StepReport | "running">>({});
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const tapRef = useRef<OutputTap | null>(null);
  const scenarioRef = useRef<Scenario | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        let tap: OutputTap | null = null;
        const { project: newProject, audioContext } = await initializeOpenDAW({
          localAudioBuffers: new Map(),
          bpm: BPM,
          onStatusUpdate: setStatus,
          engineTap: (engineNode) => {
            tap ??= new OutputTap(engineNode.context as AudioContext);
            tap.attach(engineNode);
          },
        });
        if (!mounted) return;
        tap ??= new OutputTap(audioContext);
        tapRef.current = tap;
        // a probe handle for the browser console
        (window as unknown as { soak: unknown }).soak = { project: newProject, audioContext };
        setProject(newProject);
        setStatus("Ready");
      } catch (error) {
        console.error("Init error: " + String(error));
        if (mounted) setStatus(`Error: ${String(error)}`);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const appendLog = (line: string) => {
    console.log("[layer-delete-soak] " + line);
    setLog((prev) => [...prev, line]);
  };

  const run = async () => {
    if (project === null || tapRef.current === null || running) return;
    setRunning(true);
    setReports({});
    setLog([]);
    const bodies = makeSteps(project, tapRef.current, scenarioRef);
    for (const step of STEPS) {
      setReports((prev) => ({ ...prev, [step.key]: "running" }));
      const stages: string[] = [];
      const startedAt = performance.now();
      let report: StepReport;
      try {
        const detail = await raceHang(
          bodies[step.key]((name) => stages.push(name), (line) => appendLog(`${step.key}: ${line}`)),
          () => stages[stages.length - 1] ?? "(none)",
          step.key === "build" ? BUILD_TIMEOUT_MS : HANG_TIMEOUT_MS
        );
        report = { outcome: "OK", stages: stages.join(" → "), elapsedMs: performance.now() - startedAt, detail };
      } catch (error) {
        console.error(`step ${step.key} failed: ` + String(error));
        const outcome: Outcome = error instanceof HangError ? "HUNG" : error instanceof Error && error.message.startsWith("expected") ? "FAILED" : "THREW";
        report = { outcome, stages: stages.join(" → "), elapsedMs: performance.now() - startedAt, detail: String(error instanceof Error ? error.message : error) };
      }
      setReports((prev) => ({ ...prev, [step.key]: report }));
      if (report.outcome !== "OK") break;
    }
    project.engine.stop();
    setRunning(false);
  };

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem 1rem" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar links={[
          { label: "Investigation note", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-13-layer-delete-hang-report/note.md", kind: "note" },
        ]} />
        <Heading size="7" style={{ marginTop: "1rem" }}>Layer Delete Soak</Heading>
        <Text as="p" size="3" color="gray" style={{ marginBottom: "1rem" }}>
          Deleting Composite layers and the unit around them while the WASM engine plays, every step raced
          against a {HANG_TIMEOUT_MS / 1000} s hang ceiling. The page reports OK, HUNG, THREW or FAILED per step
          with the last stage reached.
        </Text>
        <Callout.Root color="blue" style={{ marginBottom: "1rem" }}>
          <Callout.Icon><InfoCircledIcon /></Callout.Icon>
          <Callout.Text>
            A Discord report says "deleting a layer" hangs or crashes openDAW and loses work, without steps.
            This page exercises every deletion the SDK offers on that path. Audio is audible: keep the volume low.
            Status: <Code>{status}</Code>
          </Callout.Text>
        </Callout.Root>
        <Flex gap="3" style={{ marginBottom: "1rem" }}>
          <Button size="3" disabled={project === null || running} onClick={run}>
            <PlayIcon /> {running ? "Running..." : "Run all steps"}
          </Button>
        </Flex>
        <Card>
          <Table.Root size="1">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Step</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Outcome</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Detail</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {STEPS.map((step, index) => {
                const report = reports[step.key];
                return (
                  <Table.Row key={step.key}>
                    <Table.Cell>
                      <Text weight="bold">{index + 1}. {step.title}</Text>
                      <br />
                      <Text size="1" color="gray">{step.description}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      {report === undefined ? <Badge color="gray">pending</Badge>
                        : report === "running" ? <Badge color="blue">running</Badge>
                        : <Badge color={outcomeColor[report.outcome]}>{report.outcome}</Badge>}
                    </Table.Cell>
                    <Table.Cell>
                      {report !== undefined && report !== "running" && (
                        <Text size="1">
                          {report.detail} ({report.elapsedMs.toFixed(0)} ms)
                          {report.outcome !== "OK" && <><br />last stage: <Code>{report.stages}</Code></>}
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Card>
        {log.length > 0 && (
          <Card style={{ marginTop: "1rem" }}>
            <Text size="1" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{log.join("\n")}</Text>
          </Card>
        )}
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
