/**
 * One repeat of one cell of the MIDI output timing audit: reset, switch the arm, write the pattern,
 * start a recording with NOTHING armed (the engine stamps its start and records nothing), take the
 * anchor and ONE `getOutputTimestamp` pair, schedule the pattern from the page (page arm) or let the
 * engine play it (engine arm), run the jank blocks, stop a bar after the pattern, measure the IAC
 * receipts. Every wait is deadlined and token-guarded; a throw at any stage yields an error row that
 * names the stage. Browser-only; no unit tests by repo convention.
 */
import { BAR_PPQN } from "./auditExpectations";
import { contextSecAtPosition, perfMsAtHeardContextSec, pulsesToMs, type OutputStampPair, type RecordingAnchor } from "./midiClockMap";
import { quantumMs } from "./midiInputAlignment";
import { FrameWatch, waitForNotRecording, waitForRecordingStart, waitUntilPerf } from "./midiInputCellRunner";
import type { MidiLoopbackSender } from "./midiLoopback";
import type { OutputCellKey, OutputRepeatRow } from "./midiOutputArtifacts";
import type { MidiOutputParams } from "./midiOutputParams";
import { buildOutputPattern, jankSchedule, patternEndPpqnOf, type JankBlock } from "./midiOutputPattern";
import { resetOutputTransport, setOutputArm, writeOutputPattern, type OutputProjectState } from "./midiOutputProject";
import { anchorTooLate, expectedSchedule, measureOutputRepeat, ORIGIN_LEAD_MS, pairDriftSummary, type PairSample } from "./midiOutputTiming";
import { AnimationFrame } from "@opendaw/lib-dom";
import { assertCurrent, waitForPositionSettled, type RepeatToken } from "./recordingCellRunner";
import type { Project } from "@opendaw/studio-core";

export interface OutputRepeatOptions {
  project: Project;
  audioContext: AudioContext;
  loopback: MidiLoopbackSender;
  state: OutputProjectState;
  portId: string;
  key: OutputCellKey;
  params: MidiOutputParams;
  repeat: number;
  token: RepeatToken;
  frameWatch: FrameWatch;
  onStage: (stage: string) => void;
}

const ANCHOR_DEADLINE_MS = 30_000;
const STOP_DEADLINE_MS = 10_000;

/** Reads `getOutputTimestamp()` and `outputLatency` on every animation frame between `start()` and `stop()`: the drift witness. */
class PairWatch {
  #samples: PairSample[] = [];
  #sub: { terminate(): void } | null = null;

  start(audioContext: AudioContext): void {
    this.#sub?.terminate();
    this.#samples = [];
    this.#sub = AnimationFrame.add(() => {
      const raw = audioContext.getOutputTimestamp();
      if (raw.contextTime === undefined || raw.performanceTime === undefined) return;
      this.#samples.push({ perfMs: performance.now(), contextTime: raw.contextTime, performanceTime: raw.performanceTime, outputLatencyMs: audioContext.outputLatency * 1000 });
    });
  }

  stop(): PairSample[] {
    this.#sub?.terminate();
    this.#sub = null;
    return this.#samples;
  }
}

/** A row with no figures: the shape an error row and the runner's starting point share. */
export function emptyRepeatRow(repeat: number, originPpqn: number, notesInPattern: number, delayInMs: number, sampleRate: number, jankMs: number | null): OutputRepeatRow {
  return {
    repeat, error: null, notes: [], anchor: null, originPpqn,
    medianErrorMs: null, maxAbsDevMs: null, p5p95WidthMs: null, lateTailMs: null, medianErrorLiveMs: null, maxAbsDevLiveMs: null,
    missing: notesInPattern, extra: 0, stuck: 0, velocityMismatches: 0, transportMessages: 0,
    notesInsideBlocks: 0, medianErrorInsideBlocksMs: null,
    heardLagMs: null, outputLatencyMs: null, compensationLatencyMs: null, delayInMs,
    quantumMs: quantumMs(sampleRate), frameIntervalMs: null, frameGapMaxMs: null,
    jankBlocks: [], jankMs, pairDrift: null,
  };
}

/** A synchronous block on the main thread from `startPerfMs` for `jankMs`; the measured span is what the row keeps. */
async function runJankBlocks(planned: readonly JankBlock[], jankMs: number, token: RepeatToken): Promise<JankBlock[]> {
  const measured: JankBlock[] = [];
  for (const block of planned) {
    await waitUntilPerf(block.startPerfMs, token, "jank");
    const started = performance.now();
    const until = started + jankMs;
    while (performance.now() < until) {
      /* spin */
    }
    measured.push({ startPerfMs: started, endPerfMs: performance.now() });
  }
  return measured;
}

export async function runOutputRepeat(options: OutputRepeatOptions): Promise<OutputRepeatRow> {
  const { project, audioContext, loopback, state, portId, key, params, repeat, token, frameWatch, onStage } = options;
  const originPpqn = (params.originBar - 1) * BAR_PPQN;
  const pattern = buildOutputPattern(key.density, params.bars, originPpqn);
  const jankMs = key.jank === "mid" ? params.jankMs : null;
  const row = emptyRepeatRow(repeat, originPpqn, pattern.length, params.delayInMs, audioContext.sampleRate, jankMs);
  const pairWatch = new PairWatch();
  let stage = "reset";
  const at = (name: string): void => {
    stage = name;
    assertCurrent(token, name);
    onStage(name);
  };
  let watching = false;
  try {
    at("reset");
    const warning = await resetOutputTransport(project);
    if (warning !== null) console.warn(`[midi-output-audit] ${warning}`);
    loopback.clear();

    at("arm");
    setOutputArm(project, state, key.arm, portId, params.delayInMs, key.transport);
    writeOutputPattern(project, state, pattern, originPpqn);
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(key.bpm);
      project.timelineBox.loopArea.enabled.setValue(false);
    });

    at("armed-check");
    const armed = project.captureDevices.filterArmed().length;
    if (armed > 0) throw new Error(`${armed} capture(s) armed: the anchor recording must record nothing`);

    at("record");
    frameWatch.start();
    pairWatch.start(audioContext);
    watching = true;
    project.engine.setPosition(0);
    await waitForPositionSettled(project, 0, ANCHOR_DEADLINE_MS);
    assertCurrent(token, "record");
    const recordRequestContextTime = audioContext.currentTime;
    project.startRecording(false);

    at("anchor");
    const anchor: RecordingAnchor = await waitForRecordingStart(project, recordRequestContextTime, ANCHOR_DEADLINE_MS);
    row.anchor = anchor;

    at("pair");
    const rawPair = audioContext.getOutputTimestamp();
    if (rawPair.contextTime === undefined || rawPair.performanceTime === undefined
      || !Number.isFinite(rawPair.contextTime) || !Number.isFinite(rawPair.performanceTime) || rawPair.performanceTime === 0) {
      throw new Error(`getOutputTimestamp gave no usable pair (${JSON.stringify(rawPair)}; AudioContext ${audioContext.state})`);
    }
    const pair: OutputStampPair = { contextTime: rawPair.contextTime, performanceTime: rawPair.performanceTime };
    row.heardLagMs = (audioContext.currentTime - pair.contextTime) * 1000 - (performance.now() - pair.performanceTime);
    row.outputLatencyMs = audioContext.outputLatency * 1000;
    row.compensationLatencyMs = project.engine.compensationLatency.getValue() * 1000;

    at("origin-check");
    if (anchorTooLate(anchor, originPpqn, key.bpm, audioContext.currentTime)) {
      const aheadMs = (contextSecAtPosition(anchor, key.bpm, originPpqn) - audioContext.currentTime) * 1000;
      throw new Error(`anchor-too-late: the origin is ${aheadMs.toFixed(0)} ms ahead, under the ${ORIGIN_LEAD_MS} ms lead`);
    }

    at("schedule");
    const scheduled = expectedSchedule(pattern, anchor, pair, key.bpm);
    if (key.arm === "page") loopback.schedule(scheduled);
    const perfAt = (ppqn: number): number => perfMsAtHeardContextSec(pair, contextSecAtPosition(anchor, key.bpm, ppqn));
    const endPpqn = patternEndPpqnOf(pattern);
    const endPerfMs = perfAt(endPpqn);
    const midPerfMs = perfAt(originPpqn + (endPpqn - originPpqn) / 2);

    at("jank");
    const jankDone = jankMs === null ? Promise.resolve<JankBlock[]>([]) : runJankBlocks(jankSchedule(midPerfMs, endPerfMs, jankMs), jankMs, token);

    at("play");
    await waitUntilPerf(endPerfMs + pulsesToMs(BAR_PPQN, key.bpm), token, "play");
    row.jankBlocks = await jankDone;

    at("stop");
    project.stopRecording();
    await waitForNotRecording(project, STOP_DEADLINE_MS);
    project.engine.stop(true);

    at("measure");
    const frames = frameWatch.stop();
    const pairSamples = pairWatch.stop();
    watching = false;
    row.frameIntervalMs = frames.medianMs;
    row.frameGapMaxMs = frames.maxGapMs;
    row.pairDrift = pairDriftSummary(pairSamples, pair);
    const { notes, figures } = measureOutputRepeat({
      pattern, receipts: loopback.receipts(), transportMessages: loopback.transportCount(), anchor, pair, bpm: key.bpm,
      delayInMs: params.delayInMs, jankMs: jankMs ?? 0, blocks: row.jankBlocks, outputLatencyMs: row.outputLatencyMs, sampleRate: audioContext.sampleRate,
      pairSamples,
    });
    return { ...row, ...figures, notes };
  } catch (err) {
    if (watching) {
      const frames = frameWatch.stop();
      pairWatch.stop();
      row.frameIntervalMs = frames.medianMs;
      row.frameGapMaxMs = frames.maxGapMs;
    }
    row.error = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
    return row;
  }
}
