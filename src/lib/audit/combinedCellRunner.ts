/**
 * One repeat of the combined MIDI + audio audit: the MIDI sweep's repeat with the speaker
 * clicks scheduled from its anchor, then the Tape's take read back, its clicks placed and
 * paired with the recorded keys. The input-latency state is written to the Tape capture
 * box's own field, never to the engine preference (which persists across pages).
 */
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { CaptureAudio, Project } from "@opendaw/studio-core";
import type { AudioRegionBoxAdapter, AudioUnitBoxAdapter, SampleLoader } from "@opendaw/studio-adapters";
import { waitForLoaderTerminal, type RepeatToken } from "./recordingCellRunner";
import { bandSplit } from "./recordingAlignment";
import { detectOnsets } from "./onsetDetection";
import {
  resetForNextMidiCell, runMidiCellRepeat, type FrameWatch, type MidiCellRepeatResult, type ScheduleContext,
} from "./midiInputCellRunner";
import type { MidiScenario } from "./midiInputCalibration";
import type { PatternNote } from "./midiInputPattern";
import type { MidiAuditNoteRow } from "./midiInputArtifacts";
import type { MidiLoopbackSender } from "./midiLoopback";
import { clickContextTimes, inputLatencySecondsFor, playClicks, type ClickPlayer, type InputLatencyState } from "./combinedClicks";
import type { MicRoundTrip } from "./combinedCalibration";
import { matchClicks, measureCombined, onsetsToTimelineSec, withinSpan, type CombinedFigures, type CombinedPair } from "./combinedAudio";

/** Silent at any level, and valid JSON in the persisted preferences (−Infinity is not). */
export const METRONOME_SILENT_DB = -120;

export interface CombinedRepeatOptions {
  project: Project;
  audioContext: AudioContext;
  loopback: MidiLoopbackSender;
  frameWatch: FrameWatch;
  midiUnitBox: AudioUnitBox;
  tapeAdapter: AudioUnitBoxAdapter;
  tapeCapture: CaptureAudio;
  scenario: MidiScenario;
  state: InputLatencyState;
  bpm: number;
  repeat: number;
  micRoundTrip: MicRoundTrip;
  onStage: (stage: string) => void;
  token: RepeatToken;
}

export interface CombinedRepeatResult {
  midi: MidiCellRepeatResult;
  figures: CombinedFigures;
  pairs: CombinedPair[];
  takeRegionStartSec: number;
  waveformOffsetSec: number;
  inputLatencyAppliedMs: number;
}

interface TempoSeconds { ppqnToSeconds(ppqn: number): number }
interface TempoPulses { secondsToPPQN(seconds: number): number }

/** An early audio side (a calibrated state that over-corrects) may put the first click before the origin. */
export const SPAN_SLACK_BEFORE_SEC = 0.1;
/** A late audio side (the uncalibrated built-in path read 65 ms) puts the last click past its release. */
export const SPAN_SLACK_AFTER_SEC = 0.25;

/** Where a click is expected: the pattern's span with slack at both ends; onsets outside it are reported, not matched. */
export function takeSpanSec(originPpqn: number, pattern: readonly PatternNote[], tempoMap: TempoSeconds): { startSec: number; endSec: number } {
  const last = pattern[pattern.length - 1];
  return {
    startSec: tempoMap.ppqnToSeconds(originPpqn) - SPAN_SLACK_BEFORE_SEC,
    endSec: tempoMap.ppqnToSeconds(last.onPpqn + last.durationPpqn) + SPAN_SLACK_AFTER_SEC,
  };
}

export function audioFiguresFrom(input: {
  mono: Float32Array;
  sampleRate: number;
  regionStartSec: number;
  waveformOffsetSec: number;
  span: { startSec: number; endSec: number };
  pattern: readonly PatternNote[];
  bpm: number;
  tempoMap: TempoPulses;
  midiNotes: readonly MidiAuditNoteRow[];
}): { figures: CombinedFigures; pairs: CombinedPair[] } {
  const { high } = bandSplit(input.mono, input.sampleRate);
  const onsets = detectOnsets(high, input.sampleRate, { refractorySec: 0.03 });
  const timeline = onsetsToTimelineSec(onsets, input.regionStartSec, input.waveformOffsetSec);
  const { inside, outside } = withinSpan(timeline, input.span.startSec, input.span.endSec);
  const match = matchClicks(input.pattern, inside.map((sec) => input.tempoMap.secondsToPPQN(sec)), input.bpm);
  return measureCombined(match, input.midiNotes, input.bpm, outside);
}

/** Writes the state to the Tape capture box's own `inputLatency` field (seconds); returns the ms applied. */
export function applyInputLatencyState(project: Project, tapeCapture: CaptureAudio, state: InputLatencyState, micInputPartMs: number): number {
  const seconds = inputLatencySecondsFor(state, micInputPartMs);
  project.editing.modify(() => tapeCapture.captureBox.inputLatency.setValue(seconds));
  return seconds * 1000;
}

const audioRegionsOf = (tapeAdapter: AudioUnitBoxAdapter): AudioRegionBoxAdapter[] =>
  tapeAdapter.tracks.values().flatMap((t) => [...t.regions.adapters.values()]).filter((r) => r.isAudioRegion());

export async function runCombinedRepeat(options: CombinedRepeatOptions): Promise<CombinedRepeatResult> {
  const { project, audioContext, tapeAdapter, tapeCapture, scenario, state, bpm, micRoundTrip, onStage } = options;
  const leftover = audioRegionsOf(tapeAdapter).length;
  if (leftover > 0) throw new Error(`${leftover} audio region(s) left on the Tape from the repeat before`);
  if (!tapeCapture.armed.getValue()) throw new Error("the Tape's capture is not armed");
  const inputLatencyAppliedMs = applyInputLatencyState(project, tapeCapture, state, micRoundTrip.inputPartMs);

  let player: ClickPlayer | null = null;
  let scheduleCtx: ScheduleContext | null = null;
  let take: { region: AudioRegionBoxAdapter; loader: SampleLoader } | null = null;
  let midi: MidiCellRepeatResult;
  try {
    midi = await runMidiCellRepeat({
      project, audioContext, loopback: options.loopback, audioUnitBox: options.midiUnitBox, scenario, bpm,
      repeat: options.repeat, onStage, token: options.token, frameWatch: options.frameWatch,
      // A finite floor: −Infinity would serialise as null in the persisted preferences and void the metronome section on a crash.
      metronome: { enabled: false, gainDb: scenario === "countin-start" ? METRONOME_SILENT_DB : undefined },
      onScheduled: (context) => {
        scheduleCtx = context;
        player = playClicks(audioContext, audioContext.destination, clickContextTimes(context.pattern, context.anchor, context.bpm));
      },
      beforeStop: () => {
        const region = audioRegionsOf(tapeAdapter)[0];
        if (region !== undefined) take = { region, loader: region.file.getOrCreateLoader() };
      },
    });
  } catch (err) {
    (player as ClickPlayer | null)?.cancel();
    throw err;
  }
  if (take === null) throw new Error("the Tape recorded no region");
  if (scheduleCtx === null) throw new Error("the pattern was never scheduled");
  const { region, loader } = take as { region: AudioRegionBoxAdapter; loader: SampleLoader };
  const ctx = scheduleCtx as ScheduleContext;

  onStage("audio");
  await waitForLoaderTerminal(loader, 30_000, "take finalization");
  const dataOpt = loader.data;
  if (dataOpt.isEmpty()) throw new Error("the take's loader is terminal but holds no data");
  const data = dataOpt.unwrap();
  const regionStartSec = project.tempoMap.ppqnToSeconds(region.position);
  const waveformOffsetSec = region.box.waveformOffset.getValue();
  const { figures, pairs } = audioFiguresFrom({
    mono: data.frames[0], sampleRate: data.sampleRate, regionStartSec, waveformOffsetSec,
    span: takeSpanSec(ctx.originPpqn, ctx.pattern, project.tempoMap), pattern: ctx.pattern, bpm,
    tempoMap: project.tempoMap, midiNotes: midi.notes,
  });
  return { midi, figures, pairs, takeRegionStartSec: regionStartSec, waveformOffsetSec, inputLatencyAppliedMs };
}

/** The MIDI reset, then the Tape's: wait for the take's file, delete its regions and file box, the field back to 0. */
export async function resetForNextCombinedCell(
  project: Project,
  midiUnitBox: AudioUnitBox,
  tapeAdapter: AudioUnitBoxAdapter,
  tapeCapture: CaptureAudio,
  loopback: MidiLoopbackSender,
): Promise<string | null> {
  const warnings: string[] = [];
  const midiWarning = await resetForNextMidiCell(project, midiUnitBox, loopback);
  if (midiWarning !== null) warnings.push(midiWarning);
  const regions = audioRegionsOf(tapeAdapter);
  if (regions.length > 0) {
    const loader = regions[0].file.getOrCreateLoader();
    if (loader.state.type !== "loaded" && loader.state.type !== "error") {
      try {
        await waitForLoaderTerminal(loader, 10_000, "cleanup finalization grace");
      } catch (err) {
        warnings.push(`finalization grace timed out before deleting the Tape's regions: ${String(err)}`);
      }
    }
    const fileBox = regions[0].file.box;
    project.editing.modify(() => {
      regions.forEach((r) => r.box.delete());
      fileBox.delete();
    });
  }
  project.editing.modify(() => tapeCapture.captureBox.inputLatency.setValue(0));
  return warnings.length === 0 ? null : warnings.join("; ");
}
