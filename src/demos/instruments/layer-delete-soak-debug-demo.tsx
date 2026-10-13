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
import type { Box } from "@opendaw/lib-box";
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
// report names no steps. This page drives both studio gestures that delete a Composite
// layer (`deleteCompositeLayer`, with and without the editing-pointer move the context
// menu makes) and the unit delete (`deleteAudioUnit`), through the real WASM engine while
// it plays, and races each step against a hang ceiling (30 s for the build, 20 s for the
// soak, 10 s otherwise). The default engine sound is heard; keep the volume low.
//
// Verdicts: OK; FAILED when one of the page's own checks fails (a `CheckFailed`); THREW
// when the SDK threw; HUNG when a step overran its ceiling, or when the engine position
// stopped advancing. The ceiling only catches a step that is waiting: a synchronous
// main-thread loop freezes the tab itself, which is why every stage is also logged to the
// console on entry, so a frozen tab still names the last stage reached.
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
// undo, redo, undo; delete the nested layer from inside it and undo; delete the
// side-chain source unit while playing and undo; then a soak of random deletes and
// undos. After each layer delete the page asserts the box is gone and the count dropped,
// runs `verifyPointers`, confirms the engine position still advances, and that the
// output still sounds; after each undo it asserts the box is back, runs `verifyPointers`
// and the position check. Every `undo()` / `redo()` return value is checked: `false`
// means the SDK rolled the step back. After the unit delete the output is expected to be
// silent (the second unit has no notes), so there the checks are the pointer, the
// cleared side-chain and the engine position, and the sound check comes after the undo.
// The soak asserts the delete and the restore every cycle and runs the pointer, position
// and sound checks every sixth cycle.

const HANG_TIMEOUT_MS = 10_000;
const BUILD_TIMEOUT_MS = 30_000; // the first play after a cold engine boot has taken longer than 10 s once
const SOAK_TIMEOUT_MS = 20_000;
const SOAK_CYCLES = 24;
const RMS_SOUNDING = 0.002;
const BPM = 120;

class HangError extends Error {
  constructor(readonly stage: string, timeoutMs: number) {
    super(`hung for ${timeoutMs} ms at stage "${stage}"`);
  }
}

// one of the page's own assertions failed (reported as FAILED, distinct from an SDK throw)
class CheckFailed extends Error {}

// the engine position stopped advancing (reported as HUNG)
class EngineStall extends Error {}

function raceHang<T>(promise: Promise<T>, stages: () => string, timeoutMs: number): Promise<T> {
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
  timeoutMs: number;
}

const STEPS: StepDef[] = [
  { key: "build", title: "Build and play", description: "Composite (2 synth layers + nested layer), notes, value lane, modulator, side-chained second unit. Transport runs; output must sound.", timeoutMs: BUILD_TIMEOUT_MS },
  { key: "row", title: "Row-icon delete of the edited layer, then undo", description: "deleteCompositeLayer alone; NestedHostExit moves the editing pointer afterwards. Box gone, pointers, position and sound checked after the delete; counts how many undos restore the layer.", timeoutMs: HANG_TIMEOUT_MS },
  { key: "menu", title: "Menu delete, undo, redo, undo", description: "Editing pointer moved to the parent inside the same transaction, as the layer's context menu does. Same checks after the delete and after the last undo.", timeoutMs: HANG_TIMEOUT_MS },
  { key: "nested", title: "Delete the nested layer from inside it, undo", description: "Editing pointer on the inner layer; the outer layer (a Composite itself) is deleted. Same checks.", timeoutMs: HANG_TIMEOUT_MS },
  { key: "unit", title: "Delete the side-chain source unit while playing, undo", description: "deleteAudioUnit on the Composite's unit while the second unit's Compressor side-chains from it. Unit gone, side-chain cleared, pointers and position checked; sound checked after the undo.", timeoutMs: HANG_TIMEOUT_MS },
  { key: "soak", title: `Soak: ${SOAK_CYCLES} random delete/undo cycles`, description: "Random layer, random path. Delete and restore asserted by uuid every cycle; pointers, position and sound every sixth cycle.", timeoutMs: SOAK_TIMEOUT_MS },
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
  attached = false;

  constructor(context: AudioContext) {
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.#buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
  }

  attach(engineNode: AudioNode): void {
    engineNode.connect(this.analyser, 0);
    this.attached = true;
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
  project.userEditingManager.audioUnit.get().mapOr((vertex) => vertex.box.name, "none");

const isAttached = (project: Project, box: Box): boolean => project.boxGraph.findBox(box.address.uuid).nonEmpty();

// an occluded Chrome window suspends requestAnimationFrame, which is what feeds the main thread's view of the
// engine (position, isPlaying): the engine keeps running, the page just cannot see it (CLAUDE.md, browser
// verification notes). Named in the stall message so that case is not read as an SDK hang.
const visibilityHint = (): string =>
  document.visibilityState === "hidden" ? "; the window is hidden or occluded, so the main thread does not observe the engine: bring it to the front and reload" : "";

function assertGone(project: Project, box: Box, label: string): void {
  if (isAttached(project, box)) throw new CheckFailed(`${label}: ${box.name} is still in the graph`);
}

function assertBack(project: Project, box: Box, label: string): void {
  if (!isAttached(project, box)) throw new CheckFailed(`${label}: ${box.name} is not back in the graph`);
}

function undoOrFail(project: Project, label: string): void {
  if (!project.editing.undo()) throw new CheckFailed(`${label}: undo() returned false (the SDK rolled the step back, see the console)`);
}

function redoOrFail(project: Project, label: string): void {
  if (!project.editing.redo()) throw new CheckFailed(`${label}: redo() returned false (the SDK rolled the step back, see the console)`);
}

// undo until `satisfied`, at most `max` times; the count is the finding, a false return a failure
function undoUntil(project: Project, satisfied: () => boolean, label: string, max = 3): number {
  let count = 0;
  while (!satisfied() && count < max) {
    undoOrFail(project, `${label} (undo ${count + 1})`);
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

type Stage = (name: string) => void;
type StepBody = (stage: Stage, log: (line: string) => void) => Promise<string>;

function makeSteps(project: Project, tap: OutputTap, scenarioRef: { current: Scenario | null }): Record<string, StepBody> {
  const scenario = () => {
    if (scenarioRef.current === null) throw new Error("scenario not built");
    return scenarioRef.current;
  };
  const check = async (stage: Stage, label: string): Promise<string> => {
    stage(`${label}: verifyPointers`);
    const { count } = project.boxGraph.verifyPointers();
    stage(`${label}: engine position`);
    const before = project.engine.position.getValue();
    await sleep(400);
    if (project.engine.position.getValue() === before) {
      throw new EngineStall(`${label}: engine position stopped advancing at ${before.toFixed(0)} (context ${tap.analyser.context.state}, visibility ${document.visibilityState}, isPlaying ${project.engine.isPlaying.getValue()})${visibilityHint()}`);
    }
    return `${count} pointers fine, engine advancing`;
  };
  const sounding = async (stage: Stage, label: string, ms = 800): Promise<number> => {
    stage(`${label}: measure output`);
    if (!tap.attached) throw new CheckFailed(`${label}: the output tap never attached to the engine node`);
    const rms = await tap.peakRms(ms);
    if (rms < RMS_SOUNDING) throw new CheckFailed(`${label}: output silent (peak rms ${rms.toFixed(5)})`);
    return rms;
  };
  const layers = () => layersOf(project, scenario().composite);
  const expectLayers = (n: number, label: string) => {
    if (layers().length !== n) throw new CheckFailed(`${label}: expected ${n} layers, got ${layers().length}`);
  };
  return {
    build: async (stage, log) => {
      stage("build boxes");
      scenarioRef.current = buildScenario(project);
      stage("play");
      const positionBefore = project.engine.position.getValue();
      project.engine.play();
      stage("wait for position");
      for (let i = 0; i < 250 && project.engine.position.getValue() === positionBefore; i++) {
        if (i % 10 === 9) log(`waiting: context ${tap.analyser.context.state}, visibility ${document.visibilityState}, isPlaying ${project.engine.isPlaying.getValue()}, position ${project.engine.position.getValue()}`);
        await sleep(100);
      }
      if (project.engine.position.getValue() === positionBefore) throw new EngineStall(`transport never advanced (context ${tap.analyser.context.state}, visibility ${document.visibilityState})${visibilityHint()}`);
      const rms = await sounding(stage, "build", 1500);
      log(`output peak rms ${rms.toFixed(4)}, ${layers().length} layers, editing ${editingTarget(project)}`);
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
      assertGone(project, layerA, "after delete");
      expectLayers(2, "after delete");
      const after = await check(stage, "after delete");
      const rms = await sounding(stage, "after delete");
      stage("undo until restored");
      const undos = undoUntil(project, () => layers().length === 3, "row undo");
      log(`undos needed to restore the layer: ${undos}, editing ${editingTarget(project)}`);
      assertBack(project, layerA, `after ${undos} undo(s)`);
      expectLayers(3, `after ${undos} undo(s)`);
      await check(stage, "after undo");
      scenarioRef.current = { ...scenario(), layerA: layers()[0].box };
      return `${after}; rms ${rms.toFixed(3)} after delete; undos to restore: ${undos}`;
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
      assertGone(project, layerA, "after delete");
      expectLayers(2, "after delete");
      const after = await check(stage, "after delete");
      const rms = await sounding(stage, "after delete");
      stage("undo");
      undoOrFail(project, "menu undo");
      await Promise.resolve();
      assertBack(project, layerA, "after undo");
      expectLayers(3, "after undo");
      stage("redo");
      redoOrFail(project, "menu redo");
      await Promise.resolve();
      assertGone(project, layerA, "after redo");
      expectLayers(2, "after redo");
      stage("undo again");
      const undos = undoUntil(project, () => layers().length === 3, "menu undo after redo");
      log(`undo, redo, then ${undos} undo(s) to restore; editing ${editingTarget(project)}`);
      assertBack(project, layerA, `after redo + ${undos} undo(s)`);
      expectLayers(3, `after redo + ${undos} undo(s)`);
      const result = await check(stage, "after undo/redo/undo");
      scenarioRef.current = { ...scenario(), layerA: layers()[0].box };
      return `${after}; rms ${rms.toFixed(3)} after delete; ${result}; undos after redo: ${undos}`;
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
      assertGone(project, outer, "after delete");
      assertGone(project, inner, "after delete");
      expectLayers(2, "after delete");
      const after = await check(stage, "after delete");
      const rms = await sounding(stage, "after delete");
      stage("undo until restored");
      const undos = undoUntil(project, () => layers().length === 3, "nested undo");
      assertBack(project, outer, `after ${undos} undo(s)`);
      assertBack(project, inner, `after ${undos} undo(s)`);
      expectLayers(3, `after ${undos} undo(s)`);
      const result = await check(stage, "after undo");
      const restoredOuter = project.boxGraph.findBox(outer.address.uuid).unwrap("outer") as InstrumentCompositeCellBox;
      const restoredInner = project.boxGraph.findBox(inner.address.uuid).unwrap("inner") as InstrumentCompositeCellBox;
      scenarioRef.current = { ...scenario(), outer: restoredOuter, inner: restoredInner };
      return `${after}; rms ${rms.toFixed(3)} after delete; ${result}; undos to restore: ${undos}`;
    },
    unit: async (stage, log) => {
      const { compositeUnit, compressor } = scenario();
      stage("deleteAudioUnit (side-chain source)");
      const t0 = performance.now();
      project.editing.modify(() => project.api.deleteAudioUnit(compositeUnit));
      const ms = performance.now() - t0;
      await Promise.resolve();
      assertGone(project, compositeUnit, "after delete");
      if (compressor.sideChain.targetAddress.nonEmpty()) throw new CheckFailed("after delete: the compressor's side-chain pointer still has a target");
      log(`deleted in ${ms.toFixed(1)} ms, side-chain pointer cleared`);
      await check(stage, "after delete");
      stage("undo");
      undoOrFail(project, "unit undo");
      await Promise.resolve();
      assertBack(project, compositeUnit, "after undo");
      if (compressor.sideChain.targetAddress.isEmpty()) throw new CheckFailed("after undo: the compressor's side-chain pointer was not restored");
      const result = await check(stage, "after undo");
      const rms = await sounding(stage, "after undo", 1500);
      const unit = project.boxGraph.findBox(compositeUnit.address.uuid).unwrap("unit") as AudioUnitBox;
      const composite = project.boxGraph.findBox(scenario().composite.address.uuid).unwrap("composite") as InstrumentCompositeBox;
      const cells = layersOf(project, composite);
      if (cells.length !== 3) throw new CheckFailed(`after undo: expected 3 layers, got ${cells.length}`);
      scenarioRef.current = { ...scenario(), compositeUnit: unit, composite, layerA: cells[0].box, layerB: cells[1].box, outer: cells[2].box };
      return `${result}; side-chain cleared on delete and restored by undo; rms ${rms.toFixed(3)} after undo`;
    },
    soak: async (stage, log) => {
      const ui = project.userEditingManager.audioUnit;
      let maxMs = 0;
      let maxUndos = 0;
      let rms = 0;
      for (let cycle = 0; cycle < SOAK_CYCLES; cycle++) {
        const current = layers();
        const pick = current[Math.floor(Math.random() * current.length)];
        const menuPath = Math.random() < 0.5;
        const label = `cycle ${cycle + 1}`;
        stage(`${label}: delete layer ${pick.indexField.getValue() + 1} (${menuPath ? "menu" : "row"})`);
        ui.edit(pick.box);
        const t0 = performance.now();
        project.editing.modify(() => {
          if (menuPath) ui.edit(NestedHostExit.targetsOf(pick)[0]);
          project.api.deleteCompositeLayer(pick.box);
        });
        maxMs = Math.max(maxMs, performance.now() - t0);
        await Promise.resolve();
        assertGone(project, pick.box, label);
        expectLayers(current.length - 1, `${label} after delete`);
        stage(`${label}: undo`);
        const undos = undoUntil(project, () => layers().length === current.length, label);
        maxUndos = Math.max(maxUndos, undos);
        assertBack(project, pick.box, `${label} after ${undos} undo(s)`);
        expectLayers(current.length, `${label} after ${undos} undo(s)`);
        if (cycle % 6 === 5) {
          await check(stage, label);
          rms = await sounding(stage, label);
          log(`${label}: max modify ${maxMs.toFixed(1)} ms, max undos ${maxUndos}, rms ${rms.toFixed(3)}`);
        }
      }
      const result = await check(stage, "end");
      return `${result}; max modify ${maxMs.toFixed(1)} ms; max undos ${maxUndos}; last rms ${rms.toFixed(3)}`;
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
  const [ran, setRan] = useState(false);
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

  // one run per page load: a second run would build beside the first scenario and on top of its history
  const run = async () => {
    if (project === null || tapRef.current === null || running || ran) return;
    setRunning(true);
    setRan(true);
    setReports({});
    setLog([]);
    const bodies = makeSteps(project, tapRef.current, scenarioRef);
    for (const step of STEPS) {
      setReports((prev) => ({ ...prev, [step.key]: "running" }));
      const stages: string[] = [];
      let settled = false;
      // logged on entry so a frozen tab still names the last stage; throws once the verdict is in, so a
      // body that overran its ceiling stops at its next stage instead of editing under the next step
      const stage: Stage = (name) => {
        if (settled) throw new Error(`step ${step.key} already settled, stage "${name}" abandoned`);
        stages.push(name);
        console.log(`[layer-delete-soak] ${step.key}: stage ${name}`);
      };
      const startedAt = performance.now();
      let report: StepReport;
      try {
        const detail = await raceHang(
          bodies[step.key](stage, (line) => appendLog(`${step.key}: ${line}`)),
          () => stages[stages.length - 1] ?? "(none)",
          step.timeoutMs
        );
        report = { outcome: "OK", stages: stages.join(" → "), elapsedMs: performance.now() - startedAt, detail };
      } catch (error) {
        console.error(`step ${step.key} failed: ` + String(error));
        const outcome: Outcome = error instanceof HangError || error instanceof EngineStall ? "HUNG"
          : error instanceof CheckFailed ? "FAILED" : "THREW";
        report = { outcome, stages: stages.join(" → "), elapsedMs: performance.now() - startedAt, detail: String(error instanceof Error ? error.message : error) };
      }
      settled = true;
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
          Deleting Composite layers and the unit around them while the WASM engine plays. Each step is raced
          against a hang ceiling ({BUILD_TIMEOUT_MS / 1000} s for the build, {SOAK_TIMEOUT_MS / 1000} s for the soak,
          {HANG_TIMEOUT_MS / 1000} s otherwise) and reports OK, FAILED (a check of this page), THREW (the SDK threw)
          or HUNG (ceiling overrun or engine position stalled) with the last stage reached. A tab that freezes
          is a synchronous hang: the console names the last stage.
        </Text>
        <Callout.Root color="blue" style={{ marginBottom: "1rem" }}>
          <Callout.Icon><InfoCircledIcon /></Callout.Icon>
          <Callout.Text>
            A Discord report says "deleting a layer" hangs or crashes openDAW and loses work, without steps.
            This page exercises both studio gestures that delete a layer and the unit delete. Audio is audible:
            keep the volume low. One run per page load. Status: <Code>{status}</Code>
          </Callout.Text>
        </Callout.Root>
        <Flex gap="3" style={{ marginBottom: "1rem" }}>
          <Button size="3" disabled={project === null || running || ran} onClick={run}>
            <PlayIcon /> {running ? "Running..." : ran ? "Reload the page to run again" : "Run all steps"}
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
