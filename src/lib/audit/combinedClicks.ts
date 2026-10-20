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

/** One oscillator and gain per click, straight to `destination` (not through the master). */
export function playClicks(audioContext: BaseAudioContext, destination: AudioNode, schedule: readonly ClickSchedule[]): ClickPlayer {
  const oscillators: OscillatorNode[] = [];
  for (const { contextSec } of schedule) {
    const osc = audioContext.createOscillator();
    osc.type = "sine";
    osc.frequency.value = CLICK_HZ;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.setValueAtTime(CLICK_GAIN, contextSec);
    gain.gain.setValueAtTime(0, contextSec + CLICK_DURATION_SEC);
    osc.connect(gain).connect(destination);
    osc.start(contextSec);
    osc.stop(contextSec + CLICK_DURATION_SEC + 0.005);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    oscillators.push(osc);
  }
  return {
    cancel: () => {
      for (const osc of oscillators) {
        try { osc.stop(); } catch { /* already stopped */ }
      }
    },
  };
}
