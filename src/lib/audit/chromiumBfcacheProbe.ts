/**
 * The browser half of the Chromium 575891839 probe (`?issue=bfcache`). The click starts a
 * running context with a sine the worklet processor renders itself and an OscillatorNode
 * control, each into its own analyser, and measures the context clock against the wall
 * clock for two seconds. The figures go to `sessionStorage`; the page then offers a link
 * away. Back again, one of two things happens:
 * - the page comes out of the back/forward cache (`pageshow` with `persisted`): the same
 *   context and nodes are still alive, the probe measures three one-second windows and judges
 *   on all but the first;
 * - the page was not cached and loads afresh: `judgeStoredBfcacheOnLoad` finds the stored
 *   figures, reads the navigation's `notRestoredReasons`, and judges `NOT CHECKED`. The
 *   promise of the first run never settles in that case; the new document carries the run.
 * The judgement is `chromiumBfcache.ts`.
 *
 * With `&midi=1` (Chromium 40635109) the click first requests Web MIDI access and holds the
 * `MIDIAccess` for the document's life; the rest is the same, and the way back is judged by
 * `judgeMidiArm`: restored from the cache (`CACHED WITH MIDI`, the clock verdict then rides
 * in the figures), or not, with the reasons naming MIDI or not.
 */

import { browserOf, makeEnvelope, newRunToken, notChecked, runDate, type Figures, type ProbeEnvelope, type Verdict } from "./chromiumWatched";
import {
  RESTORE_WINDOW_SECONDS,
  RESTORE_WINDOWS,
  STORED_BFCACHE_RUN_VERSION,
  clockRatio,
  judgeBfcache,
  judgeMidiArm,
  parseStoredBfcacheRun,
  type BfcacheJudgement,
  type BfcacheOptions,
  type ClockRatioSample,
  type Pitches,
  type StoredBfcacheRun,
} from "./chromiumBfcache";

/** The step the page shows the "Navigate away" link on. */
export const AWAITING_NAVIGATION = "awaiting-navigation";

/** Where the link goes: a same-origin static page that only links back. */
export const BLANK_RETURN_URL = "/blank-return.html";

const STORAGE_KEY = "chromium-watched:bfcache";
const PROCESSOR_NAME = "chromium-bfcache-tone";
const WORKLET_HZ = 440;
const CONTROL_HZ = 660;
const BEFORE_SECONDS = 2;
const OUTPUT_GAIN = 0.02;
const FFT_SIZE = 32768;
const DEADLINE_MS = 5000;

/** The worklet's tone: a sine it renders from its own phase at the context rate. */
export const BFCACHE_PROCESSOR_SOURCE = `
class BfcacheTone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    const step = (2 * Math.PI * ${WORKLET_HZ}) / sampleRate;
    for (let i = 0; i < channels[0].length; i++) {
      const value = 0.5 * Math.sin(this.phase);
      this.phase += step;
      for (const channel of channels) channel[i] = value;
    }
    this.phase %= 2 * Math.PI;
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", BfcacheTone);
`;

interface Live {
  context: AudioContext;
  controlAnalyser: AnalyserNode;
  workletAnalyser: AnalyserNode;
}

/** What the MIDI arm got: the access, or why the arm cannot judge in this browser. */
type MidiRequest = { access: MIDIAccess; failed: null } | { access: null; failed: string };

async function requestMidi(): Promise<MidiRequest> {
  if (typeof navigator.requestMIDIAccess !== "function") return { access: null, failed: "no-web-midi" };
  try {
    // The run's closure holds the access until the page is judged, so the document has it when it is navigated away from.
    const access = await deadline(navigator.requestMIDIAccess(), DEADLINE_MS * 12, "requestMIDIAccess");
    return { access, failed: null };
  } catch (error) {
    return { access: null, failed: `midi-refused: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function midiFigures(access: MIDIAccess | null): Figures {
  return {
    midiRequested: access === null ? "false" : "true",
    midiInputs: access === null ? null : access.inputs.size,
    midiOutputs: access === null ? null : access.outputs.size,
  };
}

function deadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

/** The context clock's and the wall clock's advance over `seconds` of wall time. */
async function measureClock(context: AudioContext, seconds: number, signal: AbortSignal): Promise<ClockRatioSample> {
  const contextStart = context.currentTime;
  const wallStart = performance.now();
  await wait(seconds * 1000, signal);
  return {
    contextAdvanceSec: context.currentTime - contextStart,
    wallAdvanceSec: (performance.now() - wallStart) / 1000,
  };
}

/** The loudest bin's frequency, refined by a parabola through it and its neighbours. */
function peakHz(analyser: AnalyserNode, sampleRate: number): number {
  const bins = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(bins);
  let peak = 1;
  for (let i = 2; i < bins.length - 1; i++) if (bins[i] > bins[peak]) peak = i;
  const [a, b, c] = [bins[peak - 1], bins[peak], bins[peak + 1]];
  const denominator = a - 2 * b + c;
  const offset = denominator === 0 ? 0 : (0.5 * (a - c)) / denominator;
  return ((peak + offset) * sampleRate) / analyser.fftSize;
}

function pitchesOf(live: Live): Pitches {
  const rate = live.context.sampleRate;
  return { control: peakHz(live.controlAnalyser, rate), worklet: peakHz(live.workletAnalyser, rate) };
}

async function startLive(): Promise<Live> {
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    await deadline(context.resume(), DEADLINE_MS, "resume");
    const url = URL.createObjectURL(new Blob([BFCACHE_PROCESSOR_SOURCE], { type: "text/javascript" }));
    try {
      await deadline(context.audioWorklet.addModule(url), DEADLINE_MS, "addModule");
    } finally {
      URL.revokeObjectURL(url);
    }
    const output = new GainNode(context, { gain: OUTPUT_GAIN });
    output.connect(context.destination);
    const analyser = () => new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 });
    const controlAnalyser = analyser();
    const workletAnalyser = analyser();
    const control = new OscillatorNode(context, { frequency: CONTROL_HZ });
    const tone = new AudioWorkletNode(context, PROCESSOR_NAME, { outputChannelCount: [1] });
    control.connect(controlAnalyser).connect(output);
    tone.connect(workletAnalyser).connect(output);
    control.start();
    return { context, controlAnalyser, workletAnalyser };
  } catch (error) {
    await context.close();
    throw error;
  }
}

function waitForRestore(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      window.removeEventListener("pageshow", onShow);
      resolve();
    };
    window.addEventListener("pageshow", onShow);
    signal.addEventListener("abort", () => {
      window.removeEventListener("pageshow", onShow);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

function round(value: number | null, digits: number): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function envelopeFrom(
  run: StoredBfcacheRun,
  judged: BfcacheJudgement,
  verdict: Verdict,
  extra: Figures
): ProbeEnvelope {
  const figures: Figures = {
    ratioBefore: round(judged.ratioBefore, 4),
    ratioAfter: round(judged.ratioAfter, 4),
    windowRatiosAfter: judged.windowRatios.length === 0 ? null : judged.windowRatios.map((r) => r.toFixed(4)).join(" "),
    contextAdvanceBeforeSec: round(run.before.contextAdvanceSec, 4),
    wallAdvanceBeforeSec: round(run.before.wallAdvanceSec, 4),
    controlHzBefore: round(run.pitchBefore.control, 2),
    workletHzBefore: round(run.pitchBefore.worklet, 2),
    sampleRate: run.sampleRate,
    reason: judged.reason,
    ...extra,
  };
  return makeEnvelope({ issue: "bfcache", chrome: run.chrome, date: run.date, runToken: run.runToken }, verdict, figures);
}

/** The click: baseline, store, wait for a restore from the cache, re-measure, judge. With `&midi=1`, a MIDI access request first. */
export async function runBfcacheProbe(
  signal: AbortSignal,
  report: (step: string) => void,
  options: BfcacheOptions = { midi: false }
): Promise<ProbeEnvelope> {
  sessionStorage.removeItem(STORAGE_KEY);
  let midi: MidiRequest = { access: null, failed: null as never };
  if (options.midi) {
    report("request-midi");
    midi = await requestMidi();
    if (midi.failed !== null) {
      const head = { issue: "bfcache" as const, chrome: browserOf(navigator), date: runDate(), runToken: newRunToken() };
      return makeEnvelope(head, notChecked(midi.failed), midiFigures(null));
    }
  }
  const midiRequested = midi.access !== null;
  report("start-audio");
  const live = await startLive();
  try {
    if (live.context.state !== "running") throw new Error(`the context is ${live.context.state} after resume`);
    report("measure-before");
    const before = await measureClock(live.context, BEFORE_SECONDS, signal);
    const run: StoredBfcacheRun = {
      version: STORED_BFCACHE_RUN_VERSION,
      runToken: newRunToken(),
      chrome: browserOf(navigator),
      date: runDate(),
      before,
      pitchBefore: pitchesOf(live),
      sampleRate: live.context.sampleRate,
      startedAt: Date.now(),
      midiRequested,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(run));
    console.log("[chromium-watched] bfcache baseline ratio " + clockRatio(before).toFixed(4) + (midiRequested ? ", MIDI access held" : "") + ", stored; awaiting navigation");
    report(AWAITING_NAVIGATION);
    await waitForRestore(signal);
    sessionStorage.removeItem(STORAGE_KEY);
    const stateAfterRestore = live.context.state;
    report("measure-after");
    const extra: Record<string, number | string | null> = {
      persisted: "true",
      notRestoredReasons: null,
      contextStateAfterRestore: stateAfterRestore,
      ...midiFigures(midi.access),
    };
    // On the MIDI arm the restore itself is the verdict; the clock's reads as a figure.
    const armVerdict = (clockVerdict: Verdict): Verdict => (midiRequested ? judgeMidiArm(true, null) : clockVerdict);
    const withClock = (figures: Figures, clockVerdict: Verdict): Figures =>
      midiRequested ? { ...figures, clockVerdict } : figures;
    if (stateAfterRestore !== "running") {
      const judged = judgeBfcache(before, null, true, null);
      const clockVerdict = notChecked(`context-${stateAfterRestore}`);
      return envelopeFrom(run, judged, armVerdict(clockVerdict), withClock(extra, clockVerdict));
    }
    const after: ClockRatioSample[] = [];
    for (let window = 0; window < RESTORE_WINDOWS; window++) {
      after.push(await measureClock(live.context, RESTORE_WINDOW_SECONDS, signal));
    }
    const pitchAfter = pitchesOf(live);
    const judged = judgeBfcache(before, after, true, null);
    const clockVerdict = judged.verdict === "NOT CHECKED" ? notChecked(judged.reason ?? "unjudged") : judged.verdict;
    return envelopeFrom(run, judged, armVerdict(clockVerdict), {
      ...withClock(extra, clockVerdict),
      // Each window's advance after the restore, context / wall in seconds, one window per `;`.
      advancesAfterContextWallSec: after
        .map((w) => w.contextAdvanceSec.toFixed(4) + "/" + w.wallAdvanceSec.toFixed(4))
        .join("; "),
      controlHzAfter: round(pitchAfter.control, 2),
      workletHzAfter: round(pitchAfter.worklet, 2),
      secondsAway: round((Date.now() - run.startedAt) / 1000, 1),
    });
  } finally {
    await live.context.close();
  }
}

/**
 * The navigation entry's not-restored reasons, serialized; null when this browser has no such
 * API or reports none (Chrome reports none when the cache is switched off, as Playwright's is).
 */
function notRestoredReasons(entry: PerformanceNavigationTiming | undefined): string | null {
  if (entry === undefined || !("notRestoredReasons" in entry)) return null;
  const reasons = (entry as { notRestoredReasons: unknown }).notRestoredReasons;
  return reasons === null || reasons === undefined ? null : JSON.stringify(reasons);
}

/**
 * On a fresh load: a baseline stored by an earlier document means the page was not
 * restored from the cache. Judges it `NOT CHECKED` with the reasons, and clears it. An entry
 * that does not parse as this schema's (corrupt, or an older page's) is cleared with a warning
 * and judged as nothing stored.
 */
export function judgeStoredBfcacheOnLoad(): ProbeEnvelope | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  sessionStorage.removeItem(STORAGE_KEY);
  const run = parseStoredBfcacheRun(raw);
  if (run === null) {
    console.warn("[chromium-watched] bfcache: the stored baseline did not parse and was cleared");
    return null;
  }
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const reasons = notRestoredReasons(entry);
  const navigationType = entry?.type ?? null;
  const judged = judgeBfcache(run.before, null, false, reasons);
  const verdict =
    navigationType !== "back_forward" ? notChecked(`not-back-forward-${navigationType}`)
    : run.midiRequested ? judgeMidiArm(false, reasons)
    : notChecked("not-cached");
  return envelopeFrom(run, judged, verdict, {
    persisted: "false",
    midiRequested: run.midiRequested ? "true" : "false",
    navigationType,
    notRestoredReasons: reasons,
    secondsAway: round((Date.now() - run.startedAt) / 1000, 1),
  });
}
