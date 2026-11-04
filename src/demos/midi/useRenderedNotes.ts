/**
 * The Rendered page's engine room: watches the chain's device parameters, coalesces every change through a
 * `RenderScheduler`, renders the live project offline on a copy (the master Maximizer removed there, so levels are
 * true), reads the render back with the semantics audit's reader and hands the page the rows to draw. The device rules
 * only window and mark the read figures (`renderedRows`); every drawn value comes from the render.
 */
import { useEffect, useRef, useState } from "react";
import { PPQN } from "@opendaw/lib-dsp";
import type { Terminable } from "@opendaw/lib-std";
import { Devices, VelocityDeviceBoxAdapter, ZeitgeistDeviceBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox, VelocityDeviceBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { removeMasterMaximizer } from "@/lib/audit/midiEffectChain";
import {
  calibrationFrom, READER_DEFAULTS, readFigureAt, readNotes, toFigure, type Calibration, type NoteFigure,
} from "@/lib/audit/midiEffectSemanticsReader";
import type { RuleContext } from "@/lib/audit/midiEffectSemanticsRules";
import {
  NANO_ATTACK_SECONDS, NANO_RELEASE_SECONDS, REGION_POSITION_PPQN, renderRange, renderSeconds, settingsOf,
} from "@/lib/audit/midiEffectSemanticsRows";
import { deviceParameters } from "@/lib/midiEffects/devices";
import type { Pattern } from "@/lib/midiEffects/patterns";
import { RenderScheduler, type SchedulerStatus } from "@/lib/midiEffects/renderScheduler";
import { predictChain, renderedRows, type ChainSetting, type MarkOptions, type RenderedRows } from "@/lib/midiEffects/renderedNotes";
import type { ChainEntry } from "./useMidiChain";

export interface RenderedState {
  status: "calibrating" | "idle" | "stale" | "rendering" | "error";
  rows: RenderedRows | null;
  error: string | null;
  renderMs: number | null;
}

export interface RenderedNotesOptions {
  project: Project | null;
  audioUnitBox: AudioUnitBox | null;
  /** compared by identity: a new array is a changed chain (`useMidiChain` makes one per change) */
  entries: readonly ChainEntry[];
  /** already gapped */
  pattern: Pattern;
  bpm: number;
  rate: number;
  calibration: Calibration | null;
  calibrationError?: string | null;
  /** test seam */
  render?: RenderFn;
}

/** The left channel of an offline render of `project` from 0 over `seconds`. */
export type RenderFn = (project: Project, seconds: number, rate: number) => Promise<Float32Array>;

export const SETTLE_MS = 300;
const CALIBRATION_NOTES = 32;

export const MARK: MarkOptions = {
  attackMs: NANO_ATTACK_SECONDS * 1000,
  releaseMs: NANO_RELEASE_SECONDS * 1000,
  gapMs: READER_DEFAULTS.gapMs,
  minCycles: READER_DEFAULTS.minCycles,
  minVelocity: 0.01,
};

/** The default render: the live project on a copy with the master Maximizer removed (the skeleton builds exactly one). */
export const renderChannel: RenderFn = async (project, seconds, rate) => {
  const { channels } = await renderOfflineSlice(project, 0, seconds, rate, {
    mutateCopy: (copy) => {
      const master = copy.rootBoxAdapter.audioUnits.adapters().find((unit) => unit.isOutput);
      if (master === undefined) throw new Error("the project has no master unit");
      const effects = master.audioEffects.unwrap("the master hosts no audio-effect chain").adapters();
      const removed = removeMasterMaximizer(copy.editing, effects);
      if (removed !== 1) throw new Error(`expected one Maximizer on the master, removed ${removed}`);
    },
  });
  return channels[0];
};

/** Renders the region as it stands (the caller has written the gapped Sixteenths) and calibrates on its 32 notes. */
export async function calibrateRendered(project: Project, bpm: number, rate: number, render: RenderFn = renderChannel): Promise<Calibration> {
  const channel = await render(project, renderSeconds(bpm), rate);
  return calibrationFrom(readNotes(channel, rate), rate, PPQN.pulsesToSeconds(REGION_POSITION_PPQN, bpm), CALIBRATION_NOTES);
}

/** The rules' velocity and warp from the live adapters of the enabled devices, as the audit page builds it. */
function ruleContext(project: Project, entries: readonly ChainEntry[], bpm: number): RuleContext {
  const context: RuleContext = { range: renderRange(bpm), computeVelocity: (_position, original) => original, warp: (position) => position };
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const adapter = project.boxAdapters.adapterFor(entry.box, Devices.isMidiEffect);
    if (adapter instanceof VelocityDeviceBoxAdapter) {
      context.computeVelocity = (position, original) => adapter.computeVelocity(position as never, original);
    } else if (adapter instanceof ZeitgeistDeviceBoxAdapter) {
      const groove = adapter.groove();
      context.warp = (position) => groove.warp(position as never);
    }
  }
  return context;
}

interface RenderState {
  scheduler: SchedulerStatus;
  rows: RenderedRows | null;
  error: string | null;
  renderMs: number | null;
}

export function useRenderedNotes(options: RenderedNotesOptions): RenderedState {
  const { project, audioUnitBox, entries, pattern, bpm, rate, calibration, calibrationError = null } = options;
  const active = calibrationError === null && calibration !== null && project !== null && audioUnitBox !== null;
  const [state, setState] = useState<RenderState>({ scheduler: "stale", rows: null, error: null, renderMs: null });
  const latest = useRef(options);
  latest.current = options;
  const schedulerRef = useRef<RenderScheduler | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const run = async (): Promise<void> => {
      const { project, entries, pattern, bpm, rate, calibration, render = renderChannel } = latest.current;
      if (project === null || calibration === null) throw new Error("render requested without a project or a calibration");
      const chain: ChainSetting[] = entries.map((entry) => ({ setting: settingsOf(entry.box), enabled: entry.enabled }));
      const prediction = predictChain(chain, ruleContext(project, entries, bpm), pattern, bpm, MARK);
      const started = performance.now();
      const channel = await render(project, renderSeconds(bpm), rate);
      const renderMs = performance.now() - started;
      const read = readNotes(channel, rate).map((note) => toFigure(note, rate, calibration.referencePeak, calibration.instrumentOffsetFrames));
      const readAt = (onsetMs: number, endMs: number): NoteFigure => readFigureAt(channel, rate, onsetMs, endMs, calibration);
      const rows = renderedRows(read, prediction, pattern, bpm, readAt);
      // a scheduler disposed while this render ran (unmount, calibration lost) owns no state any more
      if (schedulerRef.current !== scheduler) return;
      setState((previous) => ({ ...previous, rows, renderMs, error: null }));
    };
    const scheduler = new RenderScheduler(run, {
      settleMs: SETTLE_MS,
      onStatus: (status) => setState((previous) => ({ ...previous, scheduler: status })),
      onError: (message) => {
        console.error("[midi-rendered] render failed: " + message);
        setState((previous) => ({ ...previous, error: message }));
      },
    });
    schedulerRef.current = scheduler;
    return () => {
      schedulerRef.current = null;
      scheduler.dispose();
    };
  }, [active]);

  // a change to what is rendered or how it is read asks for a render; the first one comes with the scheduler
  useEffect(() => {
    if (active) schedulerRef.current?.request();
  }, [active, entries, pattern, bpm, rate, calibration]);

  // every device parameter (and the Velocity's seed) asks for a render; the catch-up's request is absorbed by the settle
  useEffect(() => {
    if (!active || project === null) return undefined;
    const request = () => schedulerRef.current?.request();
    const subscriptions: Terminable[] = [];
    try {
      for (const entry of entries) {
        const adapter = project.boxAdapters.adapterFor(entry.box, Devices.isMidiEffect);
        for (const { parameter } of deviceParameters(adapter)) subscriptions.push(parameter.catchupAndSubscribe(request));
        if (entry.id === "velocity") subscriptions.push((entry.box as VelocityDeviceBox).randomSeed.subscribe(request));
      }
    } catch (error) {
      subscriptions.forEach((subscription) => subscription.terminate());
      throw error;
    }
    return () => subscriptions.forEach((subscription) => subscription.terminate());
  }, [active, project, entries]);

  if (calibrationError !== null) return { status: "error", rows: state.rows, error: calibrationError, renderMs: state.renderMs };
  if (!active) return { status: "calibrating", rows: state.rows, error: null, renderMs: state.renderMs };
  // an error stands until the next render succeeds; a render under way or due reads as such
  const status = state.scheduler === "idle" && state.error !== null ? "error" : state.scheduler;
  return { status, rows: state.rows, error: state.error, renderMs: state.renderMs };
}
