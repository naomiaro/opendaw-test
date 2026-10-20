/**
 * The sound half of the combined MIDI + audio audit: a short click out of the speakers at
 * the same heard instant as each MIDI note. A click scheduled at the render context time of
 * a position leaves the device when the heard clock reaches that time, which is the
 * performance instant the MIDI note is scheduled for through the same clock pair.
 */
import { contextSecAtPosition, type RecordingAnchor } from "./midiClockMap";
import type { PatternNote } from "./midiInputPattern";

export const CLICK_HZ = 6000;
export const CLICK_DURATION_SEC = 0.008;
/** −6 dBFS. */
export const CLICK_GAIN = 0.5;

export interface ClickSchedule {
  index: number;
  contextSec: number;
}

export function clickContextTimes(pattern: readonly PatternNote[], anchor: RecordingAnchor, bpm: number): ClickSchedule[] {
  return pattern.map((note) => ({ index: note.index, contextSec: contextSecAtPosition(anchor, bpm, note.onPpqn) }));
}

export type InputLatencyState = "default" | "calibrated";

/** What the Tape's capture box `inputLatency` field (seconds) is set to in each state. */
export function inputLatencySecondsFor(state: InputLatencyState, micInputPartMs: number): number {
  return state === "calibrated" ? micInputPartMs / 1000 : 0;
}

export interface ClickPlayer {
  cancel(): void;
}

/** The whole click train as one buffer, starting at the first click: a sine burst of CLICK_HZ at CLICK_GAIN per click. */
export function renderClickTrain(schedule: readonly ClickSchedule[], sampleRate: number): { startSec: number; samples: Float32Array<ArrayBuffer> } {
  if (schedule.length === 0) return { startSec: 0, samples: new Float32Array(0) };
  const startSec = Math.min(...schedule.map((c) => c.contextSec));
  const endSec = Math.max(...schedule.map((c) => c.contextSec)) + CLICK_DURATION_SEC;
  const samples = new Float32Array(Math.ceil((endSec - startSec) * sampleRate));
  const clickFrames = Math.round(CLICK_DURATION_SEC * sampleRate);
  for (const { contextSec } of schedule) {
    const at = Math.round((contextSec - startSec) * sampleRate);
    for (let k = 0; k < clickFrames && at + k < samples.length; k++) {
      samples[at + k] += CLICK_GAIN * Math.sin((2 * Math.PI * CLICK_HZ * k) / sampleRate);
    }
  }
  return { startSec, samples };
}

/**
 * One AudioBufferSourceNode for the whole train, created and connected before the pattern starts
 * and left alone until the repeat is over: no graph change during the measured span (a main-thread
 * graph change is the trigger of Chromium 442866743, the worklet clock stall). Straight to
 * `destination`, not through the master.
 */
export function playClicks(audioContext: BaseAudioContext, destination: AudioNode, schedule: readonly ClickSchedule[]): ClickPlayer {
  const { startSec, samples } = renderClickTrain(schedule, audioContext.sampleRate);
  if (samples.length === 0) return { cancel: () => undefined };
  if (startSec <= audioContext.currentTime) {
    throw new Error(`click train starts ${(audioContext.currentTime - startSec).toFixed(3)} s in the past (context ${audioContext.currentTime.toFixed(3)})`);
  }
  const buffer = audioContext.createBuffer(1, samples.length, audioContext.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(destination);
  source.start(startSec);
  let ended = false;
  source.onended = () => { ended = true; };
  return {
    cancel: () => {
      if (ended) return;
      try { source.stop(); } catch { /* not started or already stopped */ }
    },
  };
}
