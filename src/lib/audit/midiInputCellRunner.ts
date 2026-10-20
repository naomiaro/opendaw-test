/**
 * One repeat of one cell of the MIDI input alignment audit, mirroring
 * `recordingCellRunner.ts`: set the preferences, start the scenario, wait for the
 * engine's recording anchor, schedule the pattern on the loopback against that anchor,
 * provoke the scenario's jank, stop a beat after the pattern, read the box graph and
 * measure. Every wait is deadlined and every side effect is guarded by the repeat's
 * token, so an abandoned repeat can never touch the next one.
 */
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN } from "@opendaw/lib-dsp";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import { withDeadline } from "@/lib/deadline";
import { JANK_MS } from "./recordingAuditCalibration";
import {
  armJankOnRecordingFlip, assertCurrent, readRecordingStart, waitForPosition, waitForPositionSettled, type RepeatToken,
} from "./recordingCellRunner";
import {
  JANK_MID_OFFSET_PPQN, LOOP_WRAP_PPQN, MIDI_TOLERANCES, MIDTIMELINE_START_PPQN, STOP_AFTER_PATTERN_PPQN, type MidiScenario,
} from "./midiInputCalibration";
import { buildPattern, countInSchedule, patternEndPpqn, patternOriginPpqn, type PatternNote } from "./midiInputPattern";
import {
  contextSecAtPosition, heardContextSecAt, isFreshAnchor, perfMsAtHeardContextSec, positionAtContextSec, renderPpqnFromHeard,
  type OutputStampPair, type RecordingAnchor,
} from "./midiClockMap";
import {
  matchNotes, measureRepeat, median, splitCountIn, type MatchResult, type RecordedNote, type RepeatFigures, type SentNote,
} from "./midiInputAlignment";
import type { MidiAuditNoteRow } from "./midiInputArtifacts";
import { clearRecordedNotes, collectRecordedNotes } from "./midiInputRecorded";
import { pairReceipts, type MidiLoopbackSender, type ScheduledNote } from "./midiLoopback";

export interface MidiCellRepeatOptions {
  project: Project;
  audioContext: AudioContext;
  loopback: MidiLoopbackSender;
  audioUnitBox: AudioUnitBox;
  scenario: MidiScenario;
  bpm: number;
  repeat: number;
  onStage: (stage: string) => void;
  token: RepeatToken;
}

export interface MidiCellRepeatResult {
  figures: RepeatFigures;
  notes: MidiAuditNoteRow[];
  takeCount: number;
  takeIndexSource: "label" | "order";
  anchor: RecordingAnchor;
  originPpqn: number;
  jankMs: number | null;
  frameIntervalMs: number;
  outputLatencyMs: number;
  baseLatencyMs: number;
  compensationLatencyMs: number;
  sdkLatencyTermMs: number;
  heardLagMs: number;
}

export function cellLabel(scenario: MidiScenario, bpm: number, repeat: number): string {
  return `${scenario}/${bpm}/r${repeat}`;
}

/** Each note at the performance time its heard position is reached; the release likewise. */
export function scheduleFor(
  pattern: readonly PatternNote[],
  anchor: RecordingAnchor,
  pair: OutputStampPair,
  bpm: number,
): ScheduledNote[] {
  const perfAt = (ppqn: number): number => perfMsAtHeardContextSec(pair, contextSecAtPosition(anchor, bpm, ppqn));
  return pattern.map((note) => ({
    pitch: note.pitch,
    velocity: note.velocity,
    onPerfMs: perfAt(note.onPpqn),
    offPerfMs: perfAt(note.onPpqn + note.durationPpqn),
  }));
}

export function sentNotesFrom(
  pattern: readonly PatternNote[],
  scheduled: readonly ScheduledNote[],
  paired: ReadonlyArray<{ onPerfMs: number | null; offPerfMs: number | null }>,
  anchor: RecordingAnchor,
  pair: OutputStampPair,
  bpm: number,
  outputLatencySec: number,
): SentNote[] {
  return pattern.map((note, i) => {
    const receiptPerfMs = paired[i].onPerfMs;
    const expectedPpqn = receiptPerfMs === null ? null : positionAtContextSec(anchor, bpm, heardContextSecAt(pair, receiptPerfMs));
    return {
      ...note,
      scheduledPerfMs: scheduled[i].onPerfMs,
      receiptPerfMs,
      offReceiptPerfMs: paired[i].offPerfMs,
      expectedPpqn,
      expectedRenderPpqn: expectedPpqn === null ? null : renderPpqnFromHeard(expectedPpqn, outputLatencySec, bpm),
    };
  });
}

/** The first anchor the engine reports for THIS record request (one from the repeat before is skipped). */
export function waitForRecordingStart(project: Project, recordRequestContextTime: number, deadlineMs: number): Promise<RecordingAnchor> {
  return new Promise<RecordingAnchor>((resolve, reject) => {
    let settled = false;
    let subscribed = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (subscribed) sub.terminate();
      reject(new Error(`waitForRecordingStart: no fresh recordingStart within ${deadlineMs / 1000}s`));
    }, deadlineMs);
    const sub = project.engine.recordingStart.catchupAndSubscribe(() => {
      if (settled) return;
      const { contextTimeSec, positionPpqn } = readRecordingStart(project.engine);
      if (contextTimeSec === null || positionPpqn === null) return;
      const anchor = { contextTime: contextTimeSec, position: positionPpqn };
      if (!isFreshAnchor(anchor, recordRequestContextTime)) return;
      settled = true;
      clearTimeout(timer);
      if (subscribed) sub.terminate();
      resolve(anchor);
    });
    subscribed = true;
    if (settled) sub.terminate();
  });
}

/** A long task between frames: a timer fires at `atPerfMs`, then the main thread spins for `jankMs`. */
export function jankBetweenFrames(atPerfMs: number, jankMs: number): Promise<number> {
  return new Promise<number>((resolve) => {
    setTimeout(() => {
      const started = performance.now();
      const until = started + jankMs;
      while (performance.now() < until) {
        /* spin */
      }
      resolve(performance.now() - started);
    }, Math.max(0, atPerfMs - performance.now()));
  });
}

/** The median gap between `frames` animation-frame ticks. */
export function measureFrameIntervalMs(frames: number = 30): Promise<number> {
  return new Promise<number>((resolve) => {
    const stamps: number[] = [];
    const sub = AnimationFrame.add(() => {
      stamps.push(performance.now());
      if (stamps.length <= frames) return;
      sub.terminate();
      const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
      resolve(median(gaps) ?? 0);
    });
  });
}

export function waitUntilPerf(atPerfMs: number, token: RepeatToken, stage: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        assertCurrent(token, stage);
        resolve();
      } catch (err) {
        reject(err);
      }
    }, Math.max(0, atPerfMs - performance.now()));
  });
}

function waitForNotRecording(project: Project, deadlineMs: number): Promise<void> {
  return withDeadline(new Promise<void>((resolve) => {
    let subscribed = false;
    const sub = project.engine.isRecording.catchupAndSubscribe((obs) => {
      if (obs.getValue()) return;
      if (subscribed) sub.terminate();
      resolve();
    });
    subscribed = true;
  }), deadlineMs, "isRecording → false");
}

const nextFrame = (): Promise<void> => new Promise((resolve) => AnimationFrame.once(resolve));

function noteRowsFrom(
  match: MatchResult,
  sent: readonly SentNote[],
  countInSent: readonly SentNote[] = [],
  countInRecorded: readonly RecordedNote[] = [],
): MidiAuditNoteRow[] {
  const outcome = new Map<SentNote, MidiAuditNoteRow["outcome"]>();
  const matched = new Map(match.matched.map((m) => [m.sent, m]));
  for (const n of match.missing) outcome.set(n, "missing");
  for (const n of match.receiptsMissing) outcome.set(n, "receipt-missing");
  const countInRows: MidiAuditNoteRow[] = countInSent.map((note) => {
    const r = countInRecorded.find((n) => n.pitch === note.pitch);
    return {
      index: note.index, tag: note.tag, pitch: note.pitch, velocity: note.velocity, wrapAdjacent: false,
      scheduledPerfMs: note.scheduledPerfMs, receiptPerfMs: null, loopbackDelayMs: null, expectedPpqn: null, expectedRenderPpqn: null,
      recordedPpqn: r?.absolutePpqn ?? null, recordedDurationPpqn: r?.durationPpqn ?? null, recordedVelocity: r?.velocity ?? null,
      takeIndex: r?.takeIndex ?? null, placementErrorMs: null, durationErrorMs: null,
      outcome: r === undefined ? "countin-dropped" : "countin-recorded",
    };
  });
  return [...countInRows, ...sent.map((note): MidiAuditNoteRow => {
    const m = matched.get(note);
    return {
      index: note.index,
      tag: note.tag,
      pitch: note.pitch,
      velocity: note.velocity,
      wrapAdjacent: note.wrapAdjacent,
      scheduledPerfMs: note.scheduledPerfMs,
      receiptPerfMs: note.receiptPerfMs,
      loopbackDelayMs: note.receiptPerfMs === null ? null : note.receiptPerfMs - note.scheduledPerfMs,
      expectedPpqn: note.expectedPpqn,
      expectedRenderPpqn: note.expectedRenderPpqn,
      recordedPpqn: m?.recorded.absolutePpqn ?? null,
      recordedDurationPpqn: m?.recorded.durationPpqn ?? null,
      recordedVelocity: m?.recorded.velocity ?? null,
      takeIndex: m?.recorded.takeIndex ?? null,
      placementErrorMs: m?.placementErrorMs ?? null,
      durationErrorMs: m?.durationErrorMs ?? null,
      outcome: m !== undefined ? "matched" : outcome.get(note) ?? "missing",
    };
  })];
}

export async function runMidiCellRepeat(options: MidiCellRepeatOptions): Promise<MidiCellRepeatResult> {
  const { project, audioContext, loopback, audioUnitBox, scenario, bpm, onStage, token } = options;
  onStage("prefs");
  project.editing.modify(() => {
    project.timelineBox.bpm.setValue(bpm);
  });
  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;
  settings.recording.allowTakes = true;
  settings.recording.olderTakeAction = "mute-region";
  const { loopArea } = project.timelineBox;
  project.editing.modify(() => {
    loopArea.from.setValue(0);
    loopArea.to.setValue(LOOP_WRAP_PPQN);
    loopArea.enabled.setValue(scenario === "loop-wrap");
  });

  onStage("start");
  project.engine.setPosition(0);
  await waitForPositionSettled(project, 0, 30_000);
  assertCurrent(token, "start");
  let recordRequestContextTime: number;
  let jankArmed: Promise<unknown> | null = null;
  const countInNotes: PatternNote[] = [];
  switch (scenario) {
    case "nominal-start":
    case "janked-mid":
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(false);
      break;
    case "janked-start":
      jankArmed = armJankOnRecordingFlip(project, JANK_MS, 30_000);
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(false);
      break;
    case "countin-start":
    case "loop-wrap":
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(true);
      if (scenario === "countin-start") {
        const requested = performance.now();
        countInSchedule(bpm).forEach((note, i) => {
          countInNotes.push({
            index: -1 - i, tag: "countin", pitch: note.pitch, velocity: note.velocity, onPpqn: 0,
            durationPpqn: PPQN.secondsToPulses(note.holdMs / 1000, bpm), wrapAdjacent: false,
          });
          void waitUntilPerf(requested + note.offsetMs, token, "count-in note")
            .then(() => loopback.sendNow({ pitch: note.pitch, velocity: note.velocity }, note.holdMs), () => undefined);
        });
      }
      break;
    case "midtimeline-start":
      project.engine.play();
      await waitForPosition(project, MIDTIMELINE_START_PPQN, 20_000);
      assertCurrent(token, "startRecording");
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(false);
      break;
  }
  if (jankArmed !== null) await jankArmed;

  onStage("anchor");
  const anchor = await waitForRecordingStart(project, recordRequestContextTime, 30_000);
  assertCurrent(token, "anchor");
  const pair: OutputStampPair = audioContext.getOutputTimestamp() as OutputStampPair;
  const heardLagMs = (audioContext.currentTime - pair.contextTime) * 1000 - (performance.now() - pair.performanceTime);
  const outputLatencyMs = audioContext.outputLatency * 1000;
  const baseLatencyMs = audioContext.baseLatency * 1000;
  const compensationLatencyMs = project.engine.compensationLatency.getValue() * 1000;
  const nowPpqn = positionAtContextSec(anchor, bpm, heardContextSecAt(pair, performance.now()));
  const originPpqn = patternOriginPpqn(nowPpqn, bpm);

  onStage("schedule");
  const pattern = buildPattern({ originPpqn, loopEndPpqn: scenario === "loop-wrap" ? LOOP_WRAP_PPQN : null });
  const scheduled = scheduleFor(pattern, anchor, pair, bpm);
  loopback.schedule(scheduled);
  const perfAt = (ppqn: number): number => perfMsAtHeardContextSec(pair, contextSecAtPosition(anchor, bpm, ppqn));
  const jankPromise = scenario === "janked-mid"
    ? jankBetweenFrames(perfAt(originPpqn + JANK_MID_OFFSET_PPQN), JANK_MS)
    : null;

  onStage("recording");
  const frameInterval = measureFrameIntervalMs();
  await waitUntilPerf(perfAt(patternEndPpqn(originPpqn) + STOP_AFTER_PATTERN_PPQN), token, "stop");

  onStage("stopping");
  project.stopRecording();
  await waitForNotRecording(project, 10_000);
  assertCurrent(token, "finalizing");
  await nextFrame();
  await nextFrame();
  const jankMs = jankPromise === null ? null : await jankPromise;
  const frameIntervalMs = await withDeadline(frameInterval, 5_000, "frame interval");

  onStage("measuring");
  const recorded = collectRecordedNotes(audioUnitBox);
  const paired = pairReceipts(scheduled, loopback.receipts());
  const sent = sentNotesFrom(pattern, scheduled, paired, anchor, pair, bpm, audioContext.outputLatency);
  const countInSent: SentNote[] = countInNotes.map((note) => ({
    ...note, scheduledPerfMs: 0, receiptPerfMs: null, offReceiptPerfMs: null, expectedPpqn: null, expectedRenderPpqn: null,
  }));
  // Count-in notes are reported, not judged: sent unanchored, they never enter the matching;
  // what the SDK recorded at their pitches is counted on its own.
  const { match, countInRecorded } = splitCountIn(
    matchNotes(sent, recorded.notes, bpm, MIDI_TOLERANCES.matchWindowPpqn),
    countInSent.map((n) => n.pitch),
  );
  const figures = measureRepeat(match, { sent: countInSent.length, recorded: countInRecorded.length });
  return {
    figures,
    notes: noteRowsFrom(match, sent, countInSent, countInRecorded),
    takeCount: recorded.takes.length,
    takeIndexSource: recorded.takeIndexSource,
    anchor,
    originPpqn,
    jankMs,
    frameIntervalMs,
    outputLatencyMs,
    baseLatencyMs,
    compensationLatencyMs,
    sdkLatencyTermMs: outputLatencyMs + compensationLatencyMs,
    heardLagMs,
  };
}

/** After every repeat, success or failure: nothing scheduled, nothing held, no take left, transport at 0. */
export async function resetForNextMidiCell(project: Project, audioUnitBox: AudioUnitBox, loopback: MidiLoopbackSender): Promise<string | null> {
  loopback.clear();
  let warning: string | null = null;
  if (project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue()) {
    project.stopRecording();
    try {
      await waitForNotRecording(project, 10_000);
    } catch (err) {
      warning = `recording did not stop before cleanup: ${String(err)}`;
    }
  }
  clearRecordedNotes(project, audioUnitBox);
  project.engine.stop(true);
  project.engine.setPosition(0);
  return warning;
}
