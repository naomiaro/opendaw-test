/**
 * The browser half of the freeze probe (`?issue=freeze`, Chromium 575891839 comment #3). The
 * click starts two silent contexts, as in the tracker's repro: one with a ConstantSource →
 * AudioWorkletNode → destination graph, one with a GainNode in the worklet's place. It measures
 * both clocks against the wall clock for two seconds, then waits for the document to be frozen
 * and resumed: by hand (`chrome://discards`, the tab's Freeze action, with the tab in the
 * background). The DevTools protocol's `Page.setWebLifecycleState` (frozen, then active) was
 * accepted but froze nothing on a visible page in Playwright's Chrome: no `freeze` event, and the
 * run reads `NOT CHECKED no-freeze`. After `resume` it measures three one-second windows and judges on all but
 * the first. The judgement is `chromiumFreeze.ts`.
 */
import { browserOf, makeEnvelope, newRunToken, notChecked, platformOf, runDate, type ProbeEnvelope } from "./chromiumWatched";
import { RESTORE_WINDOW_SECONDS, RESTORE_WINDOWS, type ClockRatioSample } from "./chromiumBfcache";
import { judgeFreeze } from "./chromiumFreeze";

/** The step the page shows the freeze instructions on. */
export const AWAITING_FREEZE = "awaiting-freeze";

const PROCESSOR_NAME = "chromium-freeze-pass";
const BEFORE_SECONDS = 2;
const DEADLINE_MS = 5000;
/** How long the page waits for a freeze it cannot cause itself. */
const FREEZE_WAIT_MS = 120_000;

const PASS_PROCESSOR_SOURCE = `
class FreezePass extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (let c = 0; c < output.length; c++) {
      if (input[c] !== undefined) output[c].set(input[c]);
    }
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", FreezePass);
`;

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

/** Close a context without letting a close that hangs or throws hide what happened before it. */
async function closeSafely(context: AudioContext, what: string): Promise<void> {
  try {
    await deadline(context.close(), DEADLINE_MS, `close (${what})`);
  } catch (error) {
    console.warn(`[freeze-probe] ${error instanceof Error ? error.message : String(error)}`);
  }
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

/** Both contexts' clocks against one wall-clock interval. */
async function measureBoth(
  worklet: AudioContext,
  control: AudioContext,
  seconds: number,
  signal: AbortSignal
): Promise<{ worklet: ClockRatioSample; control: ClockRatioSample }> {
  const w0 = worklet.currentTime;
  const c0 = control.currentTime;
  const wall0 = performance.now();
  await wait(seconds * 1000, signal);
  const wallAdvanceSec = (performance.now() - wall0) / 1000;
  return {
    worklet: { contextAdvanceSec: worklet.currentTime - w0, wallAdvanceSec },
    control: { contextAdvanceSec: control.currentTime - c0, wallAdvanceSec },
  };
}

async function startWorkletContext(): Promise<AudioContext> {
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    await deadline(context.resume(), DEADLINE_MS, "resume (worklet context)");
    const url = URL.createObjectURL(new Blob([PASS_PROCESSOR_SOURCE], { type: "text/javascript" }));
    try {
      await deadline(context.audioWorklet.addModule(url), DEADLINE_MS, "addModule");
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = new ConstantSourceNode(context, { offset: 0 });
    source.connect(new AudioWorkletNode(context, PROCESSOR_NAME)).connect(context.destination);
    source.start();
    return context;
  } catch (error) {
    await closeSafely(context, "worklet context");
    throw error;
  }
}

async function startControlContext(): Promise<AudioContext> {
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    await deadline(context.resume(), DEADLINE_MS, "resume (control context)");
    const source = new ConstantSourceNode(context, { offset: 0 });
    source.connect(new GainNode(context)).connect(context.destination);
    source.start();
    return context;
  } catch (error) {
    await closeSafely(context, "control context");
    throw error;
  }
}

/** Resolves on `resume` after a `freeze`; `froze` false when the wait ran out without one. */
function waitForFreezeAndResume(signal: AbortSignal): Promise<{ froze: boolean; resumed: boolean; frozenMs: number | null }> {
  return new Promise((resolve, reject) => {
    let frozeAt: number | null = null;
    const finish = (value: { froze: boolean; resumed: boolean; frozenMs: number | null }) => {
      clearTimeout(timer);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
      resolve(value);
    };
    const onFreeze = () => {
      frozeAt = performance.now();
    };
    const onResume = () => {
      if (frozeAt === null) return;
      finish({ froze: true, resumed: true, frozenMs: performance.now() - frozeAt });
    };
    const timer = setTimeout(() => finish({ froze: frozeAt !== null, resumed: false, frozenMs: null }), FREEZE_WAIT_MS);
    document.addEventListener("freeze", onFreeze);
    document.addEventListener("resume", onResume);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

const round = (value: number | null, digits: number): number | null => (value === null ? null : Number(value.toFixed(digits)));

/** The click: baseline both clocks, wait for a freeze and a resume, measure again, judge. */
export async function runFreezeProbe(signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  const head = { issue: "freeze" as const, chrome: browserOf(navigator), date: runDate(), runToken: newRunToken() };
  const platform = await platformOf(navigator);
  report("start-audio");
  const worklet = await startWorkletContext();
  let control: AudioContext | null = null;
  try {
    control = await startControlContext();
    report("measure-before");
    const before = await measureBoth(worklet, control, BEFORE_SECONDS, signal);
    report(AWAITING_FREEZE);
    const freeze = await waitForFreezeAndResume(signal);
    const states = `${worklet.state}/${control.state}`;
    const workletAfter: ClockRatioSample[] = [];
    const controlAfter: ClockRatioSample[] = [];
    // A second freeze during the windows would put frozen time in them; a context leaving `running` would read as slow.
    let refroze = false;
    const onRefreeze = () => {
      refroze = true;
    };
    let statesAfterWindows = states;
    if (freeze.resumed && states === "running/running") {
      report("measure-after");
      document.addEventListener("freeze", onRefreeze);
      try {
        for (let i = 0; i < RESTORE_WINDOWS; i++) {
          const pair = await measureBoth(worklet, control, RESTORE_WINDOW_SECONDS, signal);
          workletAfter.push(pair.worklet);
          controlAfter.push(pair.control);
        }
      } finally {
        document.removeEventListener("freeze", onRefreeze);
      }
      statesAfterWindows = `${worklet.state}/${control.state}`;
    }
    const judged = judgeFreeze({
      workletBefore: before.worklet,
      controlBefore: before.control,
      froze: freeze.froze,
      resumed: freeze.resumed,
      workletAfter,
      controlAfter,
    });
    const notRunning = freeze.resumed && (states !== "running/running" || statesAfterWindows !== "running/running");
    const verdict = refroze
      ? notChecked("refrozen-during-windows")
      : notRunning
        ? notChecked(`context-${(states !== "running/running" ? states : statesAfterWindows).replace("/", "-")}`)
        : judged.verdict;
    return makeEnvelope(head, verdict, {
      workletRatioBefore: round(judged.workletRatioBefore, 4),
      controlRatioBefore: round(judged.controlRatioBefore, 4),
      workletRatioAfter: round(judged.workletRatioAfter, 4),
      controlRatioAfter: round(judged.controlRatioAfter, 4),
      workletWindowsAfter: workletAfter.length === 0 ? null : workletAfter.map((w) => (w.contextAdvanceSec / w.wallAdvanceSec).toFixed(4)).join(" "),
      controlWindowsAfter: controlAfter.length === 0 ? null : controlAfter.map((w) => (w.contextAdvanceSec / w.wallAdvanceSec).toFixed(4)).join(" "),
      froze: freeze.froze ? "true" : "false",
      resumed: freeze.resumed ? "true" : "false",
      frozenMs: round(freeze.frozenMs, 0),
      statesAfterResume: states,
      statesAfterWindows,
      refrozeDuringWindows: refroze ? "true" : "false",
      sampleRate: worklet.sampleRate,
      chromeFullVersion: platform.uaFullVersion,
      osVersion: platform.platformVersion,
    });
  } finally {
    await closeSafely(worklet, "worklet context");
    if (control !== null) await closeSafely(control, "control context");
  }
}
