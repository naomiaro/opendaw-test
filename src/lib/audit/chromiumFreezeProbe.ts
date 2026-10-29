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
import { judgeFreeze, judgeInterruptedRun, parsePendingFreezeRun } from "./chromiumFreeze";

/** The step the page shows the freeze instructions on. */
export const AWAITING_FREEZE = "awaiting-freeze";

const PROCESSOR_NAME = "chromium-freeze-pass";
/** The waiting run's note: a later load of the same tab finds it and says the run was discarded or reloaded. */
const PENDING_KEY = "chromium-watched:freeze-pending";
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

/**
 * What the wait saw. A freeze is observed two ways: the document's `freeze` → `resume` events, or a
 * gap in a 250 ms heartbeat (a frozen page runs no timers): a freeze forced from the DevTools
 * protocol was seen to stop the page without the events reaching it. `signal` names which one
 * ended the wait.
 */
interface FreezeWait {
  froze: boolean;
  resumed: boolean;
  frozenMs: number | null;
  signal: "events" | "timer-gap" | null;
  /** The longest gap between two heartbeat ticks over the wait, in ms. */
  maxGapMs: number;
  visibilityAtResume: string | null;
}

const HEARTBEAT_MS = 250;
/** A gap this long is a stopped page: a hidden tab's timers still run once a second (until five minutes hidden). */
const GAP_MS = 3000;

function waitForFreezeAndResume(signal: AbortSignal): Promise<FreezeWait> {
  return new Promise((resolve, reject) => {
    let frozeAt: number | null = null;
    let lastTick = performance.now();
    let maxGapMs = 0;
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
    };
    const finish = (value: Omit<FreezeWait, "maxGapMs" | "visibilityAtResume">) => {
      cleanup();
      resolve({ ...value, maxGapMs, visibilityAtResume: value.resumed ? document.visibilityState : null });
    };
    const onFreeze = () => {
      frozeAt = performance.now();
    };
    const onResume = () => {
      if (frozeAt === null) return;
      finish({ froze: true, resumed: true, frozenMs: performance.now() - frozeAt, signal: "events" });
    };
    const heartbeat = setInterval(() => {
      const now = performance.now();
      const gap = now - lastTick;
      lastTick = now;
      maxGapMs = Math.max(maxGapMs, gap);
      if (gap >= GAP_MS && frozeAt === null) finish({ froze: true, resumed: true, frozenMs: gap, signal: "timer-gap" });
    }, HEARTBEAT_MS);
    const timer = setTimeout(() => finish({ froze: frozeAt !== null, resumed: false, frozenMs: null, signal: null }), FREEZE_WAIT_MS);
    document.addEventListener("freeze", onFreeze);
    document.addEventListener("resume", onResume);
    signal.addEventListener("abort", () => {
      cleanup();
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
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      runToken: head.runToken,
      chrome: head.chrome,
      date: head.date,
      workletRatioBefore: before.worklet.contextAdvanceSec / before.worklet.wallAdvanceSec,
      controlRatioBefore: before.control.contextAdvanceSec / before.control.wallAdvanceSec,
    }));
    let freeze: Awaited<ReturnType<typeof waitForFreezeAndResume>>;
    try {
      freeze = await waitForFreezeAndResume(signal);
    } finally {
      sessionStorage.removeItem(PENDING_KEY);
    }
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
      freezeSignal: freeze.signal,
      maxTimerGapMs: round(freeze.maxGapMs, 0),
      visibilityAtResume: freeze.visibilityAtResume,
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

/**
 * Called when the page mounts: a run that was waiting for the freeze when the tab was discarded or
 * reloaded left its note; judge it `NOT CHECKED` with what happened instead, so the attempt is on
 * record. Null when no run was waiting.
 */
export function judgeStoredFreezeOnLoad(): ProbeEnvelope | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (raw === null) return null;
  sessionStorage.removeItem(PENDING_KEY);
  const pending = parsePendingFreezeRun(raw);
  if (pending === null) {
    console.warn("[chromium-watched] freeze: the waiting run's note did not parse and was cleared");
    return null;
  }
  const wasDiscarded = (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return makeEnvelope({ issue: "freeze", chrome: pending.chrome, date: pending.date, runToken: pending.runToken }, judgeInterruptedRun(wasDiscarded), {
    workletRatioBefore: round(pending.workletRatioBefore, 4),
    controlRatioBefore: round(pending.controlRatioBefore, 4),
    wasDiscarded: wasDiscarded ? "true" : "false",
    navigationType: navigation?.type ?? null,
  });
}
