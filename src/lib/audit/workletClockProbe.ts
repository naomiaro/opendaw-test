/**
 * Does a worklet's `currentFrame` name the quantum it is handed while the main thread
 * changes the audio graph? No SDK.
 *
 * A buffer source plays a ramp whose every sample says which frame of the buffer it is,
 * started at a known context frame. A worklet records, for each `process` call, the
 * `currentFrame` it read and the first sample of its input: the frame the quantum really
 * is comes from the sample, and the stamp less that frame is 0 when the stamp is true.
 * Meanwhile the main thread does one kind of work in bursts (`ClockCondition`).
 *
 * The summaries and the verdict are plain functions and run in Node; `runWorkletClockProbe`
 * needs a browser.
 */

const QUANTUM = 128;
/** How many stale calls a condition keeps as examples. */
const EXAMPLES = 12;

/**
 * What the main thread does while the clock is watched:
 * - `idle`: nothing
 * - `busy`: a loop that touches no audio object
 * - `connect`: connect and disconnect two gain nodes that are in nobody's path
 * - `create`: create gain nodes
 * - `stream`: build a MediaStreamAudioSourceNode on a stream and connect it to a fresh
 *   worklet node, once per burst, as the start of a recording does. The fresh worklet also
 *   gets the ramp, and reports the `currentFrame` of its FIRST call with the sample it was
 *   handed: the read a recorder makes once, at the start of a take.
 */
export type ClockCondition = "idle" | "busy" | "connect" | "create" | "stream";

export const CLOCK_CONDITIONS: readonly ClockCondition[] = ["idle", "busy", "connect", "create", "stream"];

export const CLOCK_CONDITION_LABELS: Record<ClockCondition, string> = {
  idle: "does nothing",
  busy: "runs a loop that touches no audio object",
  connect: "connects and disconnects two gain nodes that are in nobody's path",
  create: "creates gain nodes",
  stream: "builds a MediaStreamAudioSourceNode and connects it to a fresh worklet node, once per burst",
};

export interface ClockProbeConfig {
  sampleRate: number;
  /** How long each condition is watched. */
  seconds: number;
  /** How long the main thread works at a stretch. `stream` does one build per stretch whatever this is. */
  burstMs: number;
  /** The pause between stretches. */
  gapMs: number;
  conditions: ClockCondition[];
}

/** A whole number from the query within [min, max], or the default when the parameter is absent. */
function wholeParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`invalid ?${name}= "${raw}" — a whole number from ${min} to ${max}`);
  }
  return value;
}

/**
 * The probe's configuration from a page's query: `?seconds=` per condition (10),
 * `?rate=` (48000), `?burstMs=` (8), `?gapMs=` (2), `?conditions=` as a comma list (all
 * five). A value it does not know is refused. The ramp names each frame by a float32,
 * which holds to about 340 s at 48 kHz; `seconds` stops at 120.
 */
export function clockProbeConfigFrom(params: URLSearchParams): ClockProbeConfig {
  const rawConditions = params.get("conditions");
  const conditions = rawConditions === null ? [...CLOCK_CONDITIONS] : rawConditions.split(",");
  const known = (name: string): name is ClockCondition => (CLOCK_CONDITIONS as readonly string[]).includes(name);
  if (conditions.length === 0 || !conditions.every(known)) {
    throw new Error(`invalid ?conditions= "${rawConditions ?? ""}" — a comma list of ${CLOCK_CONDITIONS.join(", ")}`);
  }
  return {
    sampleRate: wholeParam(params, "rate", 48000, 8000, 96000),
    seconds: wholeParam(params, "seconds", 10, 1, 120),
    burstMs: wholeParam(params, "burstMs", 8, 1, 100),
    gapMs: wholeParam(params, "gapMs", 2, 0, 100),
    conditions,
  };
}

/** The least and the most a stamp was behind its quantum, in quanta; null when none was. */
export function behindRangeQuanta(offs: Record<string, number>): [number, number] | null {
  const behind = Object.keys(offs).map(Number).filter((off) => off < 0).map((off) => -off / QUANTUM);
  return behind.length === 0 ? null : [Math.min(...behind), Math.max(...behind)];
}

/** A call whose stamp was not the frame its sample names. */
export interface StaleCall {
  call: number;
  stamp: number;
  trueFrame: number;
  /** `stamp − trueFrame`: negative when the clock was behind. */
  off: number;
}

export interface ClockWatchSummary {
  /** Calls whose input carried the ramp: the ones whose true frame is known. */
  checked: number;
  /** `stamp − trueFrame` → how many calls read it. */
  offs: Record<string, number>;
  /** `stamp − previous stamp` → how many calls, over every call. */
  steps: Record<string, number>;
  /** The first few calls that were off. */
  firstOffs: StaleCall[];
}

export interface FreshRecorderSummary {
  built: number;
  /** Those that told their first call before the condition ended. */
  answered: number;
  offs: Record<string, number>;
}

export interface ClockConditionResult extends ClockWatchSummary {
  condition: ClockCondition;
  quanta: number;
  bursts: number;
  operations: number;
  /** `stream` only. */
  freshRecorders?: FreshRecorderSummary;
}

export interface ClockProbeReport {
  userAgent: string;
  sampleRate: number;
  cfg: ClockProbeConfig;
  results: ClockConditionResult[];
}

/** The context frame a ramp sample names: sample i of the ramp holds (i + 1) / length. */
function frameNamedBy(sample: number, startFrame: number, rampLength: number): number {
  return startFrame + Math.round(sample * rampLength) - 1;
}

const bump = (counts: Record<string, number>, key: number): void => {
  counts[String(key)] = (counts[String(key)] ?? 0) + 1;
};

/** One condition's watch: each call's stamp against the frame its first sample names. */
export function summarizeClockWatch(
  frames: ArrayLike<number>,
  firstSamples: ArrayLike<number>,
  startFrame: number,
  rampLength: number
): ClockWatchSummary {
  const offs: Record<string, number> = {};
  const steps: Record<string, number> = {};
  const firstOffs: StaleCall[] = [];
  let checked = 0;
  for (let call = 0; call < frames.length; call++) {
    if (call > 0) bump(steps, frames[call] - frames[call - 1]);
    const sample = firstSamples[call];
    if (!(sample > 0)) continue; // before the ramp started, or no input
    const trueFrame = frameNamedBy(sample, startFrame, rampLength);
    const off = frames[call] - trueFrame;
    bump(offs, off);
    checked++;
    if (off !== 0 && firstOffs.length < EXAMPLES) firstOffs.push({ call, stamp: frames[call], trueFrame, off });
  }
  return { checked, offs, steps, firstOffs };
}

/** The first call of each fresh recorder: the stamp it read against the frame it was handed. */
export function summarizeFreshRecorders(
  calls: ReadonlyArray<{ frame: number; first: number }>,
  built: number,
  startFrame: number,
  rampLength: number
): FreshRecorderSummary {
  const offs: Record<string, number> = {};
  for (const call of calls) bump(offs, call.frame - frameNamedBy(call.first, startFrame, rampLength));
  return { built, answered: calls.length, offs };
}

export interface ClockProbeVerdict {
  verdict: "CLOCK TRUE" | "STALE CLOCK" | "CLOCK AHEAD" | "NOT CHECKED";
  headline: string;
  /** Quanta, over every condition, whose stamp was behind their own frame. */
  staleQuanta: number;
  checkedQuanta: number;
  /** Fresh worklets whose first stamp was behind the frame they were handed. */
  freshEarly: number;
  freshAnswered: number;
  /** Stamps ahead of their own quantum, watched and fresh together. A stale clock cannot make one. */
  late: number;
}

/** A condition counts as watched when at least this share of its quanta carried the ramp. */
const MIN_CHECKED_SHARE = 0.5;
/** …and as worked when the main thread did at least this share of the stretches that were due. */
const MIN_BURST_SHARE = 0.25;

/** Why a run cannot vouch for a true clock: conditions that checked or worked too little. */
function shortfallsOf(
  results: readonly ClockConditionResult[],
  cfg?: Pick<ClockProbeConfig, "seconds" | "burstMs" | "gapMs">
): string[] {
  if (results.length === 0) return ["no condition was watched"];
  const shortfalls: string[] = [];
  for (const result of results) {
    if (result.checked < result.quanta * MIN_CHECKED_SHARE) {
      shortfalls.push(`${result.condition} checked ${result.checked} of ${result.quanta} quanta`);
    }
    if (result.freshRecorders !== undefined && result.freshRecorders.answered === 0) {
      shortfalls.push(`${result.condition} built 0 fresh worklets that answered`);
    }
  }
  if (cfg !== undefined) {
    // A page that is not in a visible, focused window has its timers throttled to about one a second.
    const due = Math.round((cfg.seconds * 1000) / (cfg.burstMs + cfg.gapMs));
    const throttled = results.filter((result) => result.bursts < due * MIN_BURST_SHARE);
    if (throttled.length > 0) {
      const least = Math.min(...throttled.map((result) => result.bursts));
      const most = Math.max(...throttled.map((result) => result.bursts));
      shortfalls.push(
        `${throttled.map((result) => result.condition).join(", ")} did ${least === most ? least : `${least} to ${most}`} ` +
        `stretches of work where about ${due} were due: keep the page in a visible, focused window`
      );
    }
  }
  return shortfalls;
}

/**
 * What a run of the probe shows, in one line. A stamp found behind is STALE CLOCK however
 * little else was checked; a run that found none says CLOCK TRUE only when every condition
 * was watched and worked (`cfg` given: the stretches of work that were due are checked too),
 * and NOT CHECKED otherwise.
 */
export function classifyClockProbe(
  results: readonly ClockConditionResult[],
  cfg?: Pick<ClockProbeConfig, "seconds" | "burstMs" | "gapMs">
): ClockProbeVerdict {
  let staleQuanta = 0;
  let checkedQuanta = 0;
  let freshEarly = 0;
  let freshAnswered = 0;
  let late = 0;
  const count = (offs: Record<string, number>): { behind: number; ahead: number } => {
    let behind = 0;
    let ahead = 0;
    for (const [off, calls] of Object.entries(offs)) {
      if (Number(off) < 0) behind += calls;
      if (Number(off) > 0) ahead += calls;
    }
    return { behind, ahead };
  };
  for (const result of results) {
    const watched = count(result.offs);
    staleQuanta += watched.behind;
    late += watched.ahead;
    checkedQuanta += result.checked;
    if (result.freshRecorders !== undefined) {
      const fresh = count(result.freshRecorders.offs);
      freshEarly += fresh.behind;
      late += fresh.ahead;
      freshAnswered += result.freshRecorders.answered;
    }
  }
  const figures = { staleQuanta, checkedQuanta, freshEarly, freshAnswered, late };
  const shortfalls = shortfallsOf(results, cfg);
  if (staleQuanta > 0 || freshEarly > 0) {
    const parts: string[] = [];
    if (freshAnswered > 0) parts.push(`${freshEarly} of ${freshAnswered} fresh worklets read their first currentFrame early`);
    parts.push(`${staleQuanta} of ${checkedQuanta} quanta read a currentFrame behind their own`);
    if (late > 0) parts.push(`${late} stamp(s) AHEAD of their own quantum`);
    const caveat = shortfalls.length > 0 ? ` (the rates are not this browser's: ${shortfalls.join("; ")})` : "";
    return { verdict: "STALE CLOCK", headline: "STALE CLOCK: " + parts.join("; ") + caveat, ...figures };
  }
  if (shortfalls.length > 0 && late === 0) {
    return { verdict: "NOT CHECKED", headline: "NOT CHECKED: " + shortfalls.join("; "), ...figures };
  }
  if (late > 0) {
    return {
      verdict: "CLOCK AHEAD",
      headline: `CLOCK AHEAD: ${late} stamp(s) read a currentFrame AHEAD of their own quantum, of ${checkedQuanta} quanta`,
      ...figures,
    };
  }
  return {
    verdict: "CLOCK TRUE",
    headline: `CLOCK TRUE: ${checkedQuanta} quanta` + (freshAnswered > 0 ? ` and ${freshAnswered} fresh worklets` : "") +
      ", every currentFrame named its own quantum",
    ...figures,
  };
}

const CLOCK_WATCH_SOURCE = `
class ClockWatch extends AudioWorkletProcessor {
  constructor(o) { super(); this.n = o.processorOptions.quanta; this.frames = new Float64Array(this.n); this.first = new Float32Array(this.n); this.i = 0; }
  process(inputs) {
    if (this.i >= this.n) return false;
    const input = inputs[0];
    this.frames[this.i] = currentFrame;
    this.first[this.i] = input.length > 0 ? input[0][0] : NaN;
    this.i++;
    if (this.i === this.n) this.port.postMessage({ frames: this.frames, first: this.first });
    return true;
  }
}
registerProcessor("clock-watch", ClockWatch);
class FreshRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.told = false; }
  process(inputs) {
    const input = inputs[0];
    if (!this.told && input.length > 0 && input[0][0] > 0) {
      this.told = true;
      this.port.postMessage({ frame: currentFrame, first: input[0][0] });
    }
    // done once it has told: thousands of live processors would overload the render thread
    return !this.told;
  }
}
registerProcessor("fresh-recorder", FreshRecorder);`;

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not come within ${ms} ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * Run the conditions one after another on a context of its own and report each one's
 * stamps. The page needs a user gesture first: the context has to be allowed to run.
 * `onStage` is told what the probe is about to do, so a caller can name the stage a
 * failure happened in. Every wait has a deadline.
 */
export async function runWorkletClockProbe(
  cfg: ClockProbeConfig,
  onStage: (stage: string) => void = () => {}
): Promise<ClockProbeReport> {
  onStage("context");
  const ctx = new AudioContext({ latencyHint: 0, sampleRate: cfg.sampleRate });
  try {
    await within(ctx.resume(), 5000, "the context's resume");
    if (ctx.state !== "running") throw new Error(`the context is ${ctx.state}: the page needs a real click first`);
    onStage("worklet module");
    const moduleUrl = URL.createObjectURL(new Blob([CLOCK_WATCH_SOURCE], { type: "application/javascript" }));
    try {
      await within(ctx.audioWorklet.addModule(moduleUrl), 10_000, "the worklet module");
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const rate = ctx.sampleRate;
    const length = Math.round((cfg.seconds + 2) * rate);
    const ramp = ctx.createBuffer(1, length, rate);
    const samples = ramp.getChannelData(0);
    // sample i holds (i + 1) / length: never 0, so silence before the start is told apart
    for (let i = 0; i < length; i++) samples[i] = (i + 1) / length;

    // gain nodes in nobody's path, and a stream to build source nodes on
    const loose = [ctx.createGain(), ctx.createGain()];
    const streamOut = ctx.createMediaStreamDestination();
    const kept: [MediaStreamAudioSourceNode, AudioWorkletNode][] = [];
    interface Take { player: AudioBufferSourceNode; firstCalls: { frame: number; first: number }[] }
    const work: Record<ClockCondition, (until: number, take: Take) => number> = {
      idle: () => 0,
      busy: (until) => { let n = 0; while (performance.now() < until) n++; return n; },
      connect: (until) => {
        let n = 0;
        while (performance.now() < until) { loose[0].connect(loose[1]); loose[0].disconnect(loose[1]); n++; }
        return n;
      },
      create: (until) => { let n = 0; while (performance.now() < until) { ctx.createGain(); n++; } return n; },
      stream: (_until, take) => {
        const node = ctx.createMediaStreamSource(streamOut.stream);
        const recorder = new AudioWorkletNode(ctx, "fresh-recorder", {
          numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit",
        });
        recorder.port.onmessage = (event: MessageEvent<{ frame: number; first: number }>) => take.firstCalls.push(event.data);
        node.connect(recorder);
        take.player.connect(recorder);
        kept.push([node, recorder]);
        if (kept.length > 8) {
          const [oldNode, oldRecorder] = kept.shift() as [MediaStreamAudioSourceNode, AudioWorkletNode];
          oldNode.disconnect(oldRecorder);
          try { take.player.disconnect(oldRecorder); } catch { /* a recorder of an earlier condition: its player is gone */ }
        }
        return 1;
      },
    };

    const results: ClockConditionResult[] = [];
    for (const condition of cfg.conditions) {
      onStage(condition);
      const quanta = Math.round((cfg.seconds * rate) / QUANTUM);
      const player = ctx.createBufferSource();
      player.buffer = ramp;
      const watch = new AudioWorkletNode(ctx, "clock-watch", {
        numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit",
        processorOptions: { quanta },
      });
      player.connect(watch);
      const done = new Promise<{ frames: Float64Array; first: Float32Array }>((resolve) => {
        watch.port.onmessage = (event: MessageEvent<{ frames: Float64Array; first: Float32Array }>) => resolve(event.data);
      });
      const startFrame = Math.ceil(((ctx.currentTime + 0.15) * rate) / QUANTUM) * QUANTUM;
      player.start(startFrame / rate);
      let running = true;
      let operations = 0;
      let bursts = 0;
      const take: Take = { player, firstCalls: [] };
      const burst = (): void => {
        if (!running) return;
        operations += work[condition](performance.now() + cfg.burstMs, take);
        bursts++;
        setTimeout(burst, cfg.gapMs);
      };
      setTimeout(burst, 0);
      let data: { frames: Float64Array; first: Float32Array };
      try {
        data = await within(done, (cfg.seconds + 10) * 1000, `the watch of ${condition}`);
      } finally {
        running = false;
        player.stop();
        player.disconnect();
      }
      const result: ClockConditionResult = {
        condition, quanta, bursts, operations,
        ...summarizeClockWatch(data.frames, data.first, startFrame, length),
      };
      if (condition === "stream") {
        result.freshRecorders = summarizeFreshRecorders(take.firstCalls, operations, startFrame, length);
      }
      results.push(result);
    }
    return { userAgent: navigator.userAgent, sampleRate: rate, cfg, results };
  } finally {
    await ctx.close();
  }
}
