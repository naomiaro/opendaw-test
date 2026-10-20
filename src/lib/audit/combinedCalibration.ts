/**
 * The speaker-to-microphone round trip, measured once per run of the combined audit, through
 * the very node the Tape records from. One worklet emits three clicks into its output and
 * records its input; both ends are stamped by its own process-call frame counter, never by
 * `currentTime` or `currentFrame` (Chromium 442866743: those stand still for a quantum while
 * the main thread holds the graph lock). The main thread then finds each click in the
 * recording with the audio harness's band split and onset detector.
 */
import { withDeadline } from "@/lib/deadline";
import { bandSplit } from "./recordingAlignment";
import { detectOnsets } from "./onsetDetection";
import { median } from "./midiInputAlignment";

export const CALIBRATION_CLICKS = 3;
export const CALIBRATION_GAP_SEC = 1.0;
/** Input recorded before the first click: the noise floor. */
export const CALIBRATION_LEAD_SEC = 1.0;
export const CALIBRATION_TAIL_SEC = 0.5;
/** A click's peak over the floor, else it was not found. */
export const CALIBRATION_MIN_RATIO_DB = 20;
/** How long after its emit a click is looked for. */
export const CALIBRATION_SEARCH_SEC = 0.5;
export const CALIBRATION_PROCESSOR = "combined-calibration";

export const CALIBRATION_PROCESSOR_SOURCE = `
class CombinedCalibration extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { lead, gap, tail, clicks, clickFrames, clickHz, gain } = options.processorOptions;
    this.frame = 0;
    this.total = lead + clicks * gap + tail;
    this.input = new Float32Array(this.total);
    this.emitFrames = Array.from({ length: clicks }, (_, i) => Math.round((lead + i * gap) / 128) * 128);
    this.clickFrames = clickFrames;
    this.clickHz = clickHz;
    this.gain = gain;
    this.done = false;
  }
  process(inputs, outputs) {
    if (this.done) return false;
    const inChannel = inputs[0] && inputs[0][0];
    const out = outputs[0][0];
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const f = this.frame + i;
      if (f < this.total) this.input[f] = inChannel ? inChannel[i] : 0;
      let sample = 0;
      for (const emit of this.emitFrames) {
        const k = f - emit;
        if (k >= 0 && k < this.clickFrames) sample += this.gain * Math.sin((2 * Math.PI * this.clickHz * k) / sampleRate);
      }
      out[i] = sample;
    }
    this.frame += n;
    if (this.frame >= this.total) {
      this.done = true;
      this.port.postMessage({ input: this.input, emitFrames: this.emitFrames, sampleRate }, [this.input.buffer]);
      return false;
    }
    return true;
  }
}
registerProcessor("${CALIBRATION_PROCESSOR}", CombinedCalibration);
`;

export interface CalibrationCapture {
  sampleRate: number;
  /** Indexed by the worklet's own frame counter from its first process call. */
  input: Float32Array;
  emitFrames: number[];
}

export interface RoundTrip {
  emitFrame: number;
  detectFrame: number | null;
  roundTripMs: number | null;
  peakOverFloorDb: number | null;
}

const rms = (samples: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
};
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
};
const db = (value: number): number => 20 * Math.log10(Math.max(value, 1e-9));

/** The high band's noise floor (RMS over the lead) and its peak over the whole capture, in dBFS. */
export function captureLevels(capture: CalibrationCapture): { floorDb: number; peakDb: number } {
  const { high } = bandSplit(capture.input, capture.sampleRate);
  const lead = high.subarray(0, Math.max(1, capture.emitFrames[0] ?? high.length));
  return { floorDb: db(rms(lead)), peakDb: db(peakOf(high)) };
}

export function roundTripsFrom(capture: CalibrationCapture): RoundTrip[] {
  const { sampleRate, input, emitFrames } = capture;
  const { high } = bandSplit(input, sampleRate);
  const floor = rms(high.subarray(0, Math.max(1, emitFrames[0] ?? high.length)));
  const search = Math.round(CALIBRATION_SEARCH_SEC * sampleRate);
  return emitFrames.map((emitFrame) => {
    const window = high.subarray(emitFrame, Math.min(high.length, emitFrame + search));
    const peakOverFloorDb = db(peakOf(window)) - db(floor);
    if (peakOverFloorDb < CALIBRATION_MIN_RATIO_DB) return { emitFrame, detectFrame: null, roundTripMs: null, peakOverFloorDb };
    const onsets = detectOnsets(window, sampleRate, { refractorySec: 0.05 });
    if (onsets.length === 0) return { emitFrame, detectFrame: null, roundTripMs: null, peakOverFloorDb };
    const detectFrame = emitFrame + Math.round(onsets[0] * sampleRate);
    return { emitFrame, detectFrame, roundTripMs: ((detectFrame - emitFrame) / sampleRate) * 1000, peakOverFloorDb };
  });
}

export interface MicRoundTrip {
  roundTripMs: number;
  roundTripSpreadMs: number;
  inputPartMs: number;
  clicksFound: number;
  floorDb: number;
  peakDb: number;
  perClick: RoundTrip[];
}

export function summarizeRoundTrips(
  trips: readonly RoundTrip[],
  outputLatencyMs: number,
  floorDb: number,
  peakDb: number,
): MicRoundTrip | { error: string } {
  const found = trips.map((t) => t.roundTripMs).filter((ms): ms is number => ms !== null);
  if (found.length < CALIBRATION_CLICKS) {
    return {
      error: `calibration found ${found.length} of ${CALIBRATION_CLICKS} clicks (floor ${floorDb.toFixed(1)} dBFS, peak ${peakDb.toFixed(1)} dBFS): `
        + "check the output device, headphones, volume and the room",
    };
  }
  const roundTripMs = median(found) as number;
  return {
    roundTripMs,
    roundTripSpreadMs: Math.max(...found) - Math.min(...found),
    inputPartMs: roundTripMs - outputLatencyMs,
    clicksFound: found.length,
    floorDb,
    peakDb,
    perClick: [...trips],
  };
}

/** Builds the worklet on `source`, measures, disconnects. Throws the refusal text when a click is not found. */
export async function measureMicRoundTrip(audioContext: AudioContext, source: AudioNode, outputLatencyMs: number): Promise<MicRoundTrip> {
  const moduleUrl = URL.createObjectURL(new Blob([CALIBRATION_PROCESSOR_SOURCE], { type: "application/javascript" }));
  try {
    await withDeadline(audioContext.audioWorklet.addModule(moduleUrl), 10_000, "the calibration worklet module");
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const rate = audioContext.sampleRate;
  const node = new AudioWorkletNode(audioContext, CALIBRATION_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      lead: Math.round(CALIBRATION_LEAD_SEC * rate),
      gap: Math.round(CALIBRATION_GAP_SEC * rate),
      tail: Math.round(CALIBRATION_TAIL_SEC * rate),
      clicks: CALIBRATION_CLICKS,
      clickFrames: Math.round(0.008 * rate),
      clickHz: 6000,
      gain: 0.5,
    },
  });
  const captured = new Promise<CalibrationCapture>((resolve) => {
    node.port.onmessage = (event: MessageEvent<CalibrationCapture>) => resolve(event.data);
  });
  source.connect(node);
  node.connect(audioContext.destination);
  let capture: CalibrationCapture;
  try {
    const total = CALIBRATION_LEAD_SEC + CALIBRATION_CLICKS * CALIBRATION_GAP_SEC + CALIBRATION_TAIL_SEC;
    capture = await withDeadline(captured, (total + 5) * 1000, "the calibration capture");
  } finally {
    source.disconnect(node);
    node.disconnect();
    node.port.onmessage = null;
  }
  const levels = captureLevels(capture);
  const summary = summarizeRoundTrips(roundTripsFrom(capture), outputLatencyMs, levels.floorDb, levels.peakDb);
  if ("error" in summary) throw new Error(summary.error);
  return summary;
}
