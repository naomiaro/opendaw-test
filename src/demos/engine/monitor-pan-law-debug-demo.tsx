import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Button, Code, Table } from "@radix-ui/themes";

// Repro for `debug/2026-11-23-monitor-pan-doubles-at-hard-pan/note.md`.
//
// A Tape's capture has a monitor with a pan of its own (`capture.monitorPan`, a StereoPannerNode in the SDK's
// `BrowserMonitor`); the Tape's audio unit has the channel strip's pan (`audioUnitBox.panning`, in the engine).
// The page reads both as GAINS: the level on each side after the pan over the level of the signal before it,
// both read together, so the input's level does not move a figure. The capture's input is synthetic (a 440 Hz
// tone through a patched `getUserMedia`: no microphone, no permission); the monitor's pan node is taken off the
// speakers while it is unmuted, so the run is silent.
//
// Arms, in order:
//  1. Controls for the instrument, without the SDK: a StereoPannerNode of the page's own, fed one channel
//     (must read "equal-power": centre ×0.71, hard ×1) and fed two identical channels (must read "doubles":
//     centre ×1, hard ×2). They show the taps can tell the laws apart.
//  2. The strip's pan: the capture monitored with effects, the monitor's pan at the centre, the strip's pan at
//     −1 / 0 / +1, read where the return reaches the monitor. `data-strip-law` (expected "unity": the side that
//     remains keeps the centre level).
//  3. The two pans stacked in effects mode: every combination of strip pan and monitor pan, read after the
//     monitor's pan. `data-stack` is "as-composed" when each cell is the strip's row put through a pan that
//     folds the far side into the near one.
//  4. The monitor's pan in DIRECT mode, a one-channel stream, at `requestChannels` 2 and 1:
//     `data-monitor-law` / `data-monitor-law-mono`, and how many channels reach the pan node
//     (`data-channels-reaching`), which is what selects a StereoPannerNode's law. On the synthetic input the
//     two requests feed the same stream down the same path (the patched `getUserMedia` ignores the requested
//     channel count), so the second row repeats the first; only a real input can differ. The verdict reads the
//     first.
//  5. A one-sided input (two channels, the signal on the left only, as from an interface with a microphone on
//     its first input): the monitor's pan in direct mode, then the strip's pan in effects mode.
//     `data-one-sided` is "monitor-moves-strip-removes" when the monitor's pan at +1 carries the signal to the
//     right while the strip's pan at +1 removes it.
//  5b. The same one-sided stream with `requestChannels` 1 (a browser that hands over two channels although one
//     was asked for): what is recorded against what is monitored. `data-mono-direct` is "not-mixed-down" when
//     the recorded signal is the mono mixdown (×0.5) while direct monitoring carries the raw left channel.
//  6. With `?input=mic` only: arm 4 on the real default microphone (the browser asks; make steady noise). The
//     capture is never in effects mode with the microphone and its pan node is off the speakers, so nothing of
//     the microphone is heard. `data-mic-law` / `data-mic-law-mono`, `data-mic-channels`.
//
// Verdict, once the controls and the strip read as expected: BUG PRESENT when the monitor's law in direct mode
// (requestChannels 2) is not the strip's ("doubles" or "equal-power" against "unity"), FIXED when it is, INCONCLUSIVE otherwise.
// It is settled after arm 4; a failure in a later arm is reported in its own outcome. One run per page load.
const PANS = [-1, 0, 1] as const;
type Pan = (typeof PANS)[number];
const SETTLE_MS = 600;
const FLOOR = 1e-5;
const GONE = 0.05; // a side under this gain counts as silent
const USE_MICROPHONE = new URLSearchParams(location.search).get("input") === "mic";

type Levels = { left: number; right: number };
type Sweep = Record<Pan, Levels>;
type Row = { step: string; expected: string; got: string; ok: boolean | null };
type Verdict = "BUG PRESENT" | "FIXED" | "INCONCLUSIVE" | "HUNG" | "THREW";
type Law = "doubles" | "unity" | "equal-power" | "other" | "not-measurable" | "failed" | "not-run";
type Stack = "as-composed" | "other" | "failed" | "not-run";
type OneSided = "monitor-moves-strip-removes" | "other" | "failed" | "not-run";
type Outcomes = {
  stripLaw: Law; monitorLaw: Law; monitorLawMono: Law; channelsReaching: string;
  stack: Stack; oneSided: OneSided; monoDirect: string; micLaw: Law; micLawMono: Law; micChannels: string;
};
type Outcome = { verdict: Verdict; rows: Row[]; message: string } & Outcomes;
type RunState = { kind: "idle" } | { kind: "running"; stage: string; rows: Row[] } | ({ kind: "done" } & Outcome);
const NOT_RUN: Outcomes = {
  stripLaw: "not-run", monitorLaw: "not-run", monitorLawMono: "not-run", channelsReaching: "not-run",
  stack: "not-run", oneSided: "not-run", monoDirect: "not-run", micLaw: "not-run", micLawMono: "not-run", micChannels: "not-run",
};

class Hung extends Error { constructor(readonly stage: string) { super(`hung in ${stage}`); } }
const race = <T,>(stage: string, promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Hung(stage)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rmsOf = (analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number => {
  analyser.getFloatTimeDomainData(buffer);
  let acc = 0;
  for (let i = 0; i < buffer.length; i++) acc += buffer[i] * buffer[i];
  return Math.sqrt(acc / buffer.length);
};
const gain = (l: Levels) => `L ×${l.left.toFixed(2)}, R ×${l.right.toFixed(2)}`;
const panLabel = (pan: number) => (pan < 0 ? "−1" : pan > 0 ? "+1" : "0");
const failureOf = (error: unknown) => (error instanceof Hung ? `deadline passed in ${error.stage}` : String(error));
const about = (value: number, target: number) => Math.abs(value - target) < 0.1 * Math.max(1, target);
const cell = (l: Levels, left: number, right: number) => about(l.left, left) && about(l.right, right);

/** The law of a pan from its gains for an input that is the same on both sides (or has one channel). */
const lawOf = (sweep: Sweep): Law => {
  const centre = [sweep[0].left, sweep[0].right];
  const hard = [sweep[-1].left, sweep[1].right];
  if (![sweep[-1].right, sweep[1].left].every((value) => value < GONE)) return "other";
  const reads = (c: number, h: number) => centre.every((value) => about(value, c)) && hard.every((value) => about(value, h));
  return reads(1, 2) ? "doubles" : reads(Math.SQRT1_2, 1) ? "equal-power" : reads(1, 1) ? "unity" : "other";
};
const lawText = (sweep: Sweep) => `centre ${gain(sweep[0])}; hard left ${gain(sweep[-1])}; hard right ${gain(sweep[1])}`;

async function run(onStage: (stage: string, rows: Row[]) => void): Promise<Outcome> {
  const rows: Row[] = [];
  const outcomes: Outcomes = { ...NOT_RUN };
  let stage = "init";
  const cleanup: Array<() => void> = [];
  const enter = (name: string) => { stage = name; onStage(stage, [...rows]); };
  const row = (r: Row) => { rows.push(r); onStage(stage, [...rows]); console.log(`[monitor-pan-law] ${r.step}: ${r.got}`); };
  try {
    enter("init");
    const { project, audioContext } = await race(stage, initializeOpenDAW({ bpm: 120 }), 90_000);
    if (audioContext.state !== "running") await race("resume (needs a real click)", audioContext.resume(), 10_000);
    if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} after resume`);
    const unit = project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Tape)).unwrap("createInstrument").audioUnitBox;
    const loaded = await race(stage, project.engine.queryLoadingComplete(), 30_000);
    if (!loaded) throw new Error("queryLoadingComplete returned false (no worklet)");

    const buffer = new Float32Array(4096);
    const assertRunning = () => { if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} in "${stage}" (document ${document.visibilityState})`); };
    // a settle that took far longer than asked means throttled timers: the reads would still be right, but the run's footing is not what the page assumes
    const settle = async () => {
      const started = performance.now();
      await sleep(SETTLE_MS);
      if (performance.now() - started > SETTLE_MS * 5) throw new Error(`a ${SETTLE_MS} ms wait took ${Math.round(performance.now() - started)} ms (document ${document.visibilityState}): timers throttled`);
      assertRunning();
    };
    const analyserOn = (node: AudioNode, output?: number): AnalyserNode => {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      if (output === undefined) node.connect(analyser); else node.connect(analyser, output);
      return analyser;
    };
    // both sides of a node, through a discrete splitter: its second output is silent for a one-channel signal
    const sidesOf = (node: AudioNode) => {
      const splitter = audioContext.createChannelSplitter(2);
      node.connect(splitter);
      const analysers = [analyserOn(splitter, 0), analyserOn(splitter, 1)];
      return { read: (): Levels => ({ left: rmsOf(analysers[0], buffer), right: rmsOf(analysers[1], buffer) }), release: () => node.disconnect(splitter) };
    };
    const over = (l: Levels, reference: number): Levels => ({ left: l.left / reference, right: l.right / reference });

    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 440;
    const level = audioContext.createGain();
    level.gain.value = 0.25;
    oscillator.connect(level);
    oscillator.start();
    cleanup.push(() => oscillator.stop());

    // ---- 1. controls: a StereoPannerNode of the page's own, one channel and two identical channels ----
    enter("controls");
    const levelTap = analyserOn(level);
    const control = async (channels: 1 | 2): Promise<Sweep> => {
      const feed = audioContext.createGain();
      feed.channelCount = channels;
      feed.channelCountMode = "explicit";
      feed.channelInterpretation = "speakers";
      level.connect(feed);
      const panner = audioContext.createStereoPanner();
      feed.connect(panner);
      const sides = sidesOf(panner);
      const sweep = {} as Sweep;
      for (const pan of PANS) {
        panner.pan.value = pan;
        await settle();
        sweep[pan] = over(sides.read(), rmsOf(levelTap, buffer));
      }
      level.disconnect(feed);
      feed.disconnect(panner);
      sides.release();
      return sweep;
    };
    const controlMono = await control(1);
    const controlStereo = await control(2);
    row({ step: "control: a StereoPannerNode of the page's own, one channel in", expected: "equal-power (centre ×0.71, hard ×1)", got: `${lawText(controlMono)} (${lawOf(controlMono)})`, ok: lawOf(controlMono) === "equal-power" });
    row({ step: "control: the same node, two identical channels in", expected: "doubles (centre ×1, hard ×2)", got: `${lawText(controlStereo)} (${lawOf(controlStereo)})`, ok: lawOf(controlStereo) === "doubles" });
    const controlsOk = lawOf(controlMono) === "equal-power" && lawOf(controlStereo) === "doubles";

    // ---- the capture and its taps ----
    enter("capture: setup");
    const capture = project.captureDevices.audio(unit.address.uuid).unwrap("no CaptureAudio for the Tape");
    const speakers = audioContext.destination;
    const monoInput = audioContext.createMediaStreamDestination();
    monoInput.channelCount = 1;
    monoInput.channelCountMode = "explicit";
    monoInput.channelInterpretation = "speakers";
    level.connect(monoInput);
    const leftOnlyInput = audioContext.createMediaStreamDestination();
    leftOnlyInput.channelCount = 2;
    leftOnlyInput.channelCountMode = "explicit";
    const leftOnly = audioContext.createChannelMerger(2);
    level.connect(leftOnly, 0, 0);
    leftOnly.connect(leftOnlyInput);
    type Input = "one-channel" | "left-only" | "microphone";
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    let current: Input = "one-channel";
    let inputFailure: unknown = null;
    mediaDevices.getUserMedia = async (constraints) => current === "microphone"
      ? originalGetUserMedia(constraints).catch((error: unknown) => { inputFailure = error; throw error; })
      : (current === "one-channel" ? monoInput : leftOnlyInput).stream.clone();
    cleanup.push(() => { mediaDevices.getUserMedia = originalGetUserMedia; });
    // With the pan node off the speakers, a rebuild of the input chain inside the SDK would throw (its monitor
    // disconnects the pan node from the speakers); a device change or an uncaught error ends the arm it hits.
    const disturbances: string[] = [];
    // the SDK rebuilds on a device change only while a stream is open (a first microphone grant fires one before that)
    const onDeviceChange = () => { if (capture.stream.nonEmpty()) disturbances.push("the input devices changed"); };
    const onPageError = (event: ErrorEvent | PromiseRejectionEvent) => disturbances.push(`an uncaught error: ${String("reason" in event ? event.reason : event.message)}`);
    mediaDevices.addEventListener("devicechange", onDeviceChange);
    window.addEventListener("error", onPageError);
    window.addEventListener("unhandledrejection", onPageError);
    const undisturbed = () => { if (disturbances.length > 0) throw new Error(`the capture was disturbed (${disturbances.splice(0).join("; ")}): its readings are not used`); };
    // muted first and put back on the speakers, because the SDK's monitor throws on a mode change otherwise
    const close = () => { capture.monitorMuted = true; capture.monitorPanNode.connect(speakers); capture.monitoringMode = "off"; capture.armed.setValue(false); capture.monitorMuted = false; };
    cleanup.push(() => {
      mediaDevices.removeEventListener("devicechange", onDeviceChange);
      window.removeEventListener("error", onPageError);
      window.removeEventListener("unhandledrejection", onPageError);
      try { close(); } catch (error) {
        // a rebuild that threw inside the SDK leaves its monitor half disconnected, and then neither the mode nor
        // disarming gets as far as stopping the tracks: stop them here so no input stays open
        console.warn(`[monitor-pan-law] closing the capture: ${String(error)}`);
        capture.stream.ifSome((stream) => stream.getTracks().forEach((track) => track.stop()));
      }
      project.editing.modify(() => { capture.requestChannels = 2; unit.panning.setValue(0); });
      capture.monitorPan = 0;
    });
    const before = sidesOf(capture.monitorGainNode); // what reaches the monitor's pan
    const after = sidesOf(capture.monitorPanNode); // what leaves it
    cleanup.push(before.release, after.release);
    let releaseInput: (() => void) | null = null;
    let readInputLeft: () => number = () => 0;
    const noSignal = (what: string) => new Error(`${what}${current === "microphone" ? ": make some steady noise at the microphone" : ""}`);
    const reference = (value: number, what: string) => { if (!(value > FLOOR)) throw noSignal(`no signal ${what} (RMS ${value.toExponential(1)})`); return value; };
    const open = async (input: Input, request: 1 | 2, mode: "direct" | "effects") => {
      enter(`capture: ${input} input, requestChannels ${request}, ${mode}`);
      undisturbed();
      releaseInput?.();
      releaseInput = null;
      close();
      await sleep(300);
      current = input;
      project.editing.modify(() => { capture.requestChannels = request; unit.panning.setValue(0); });
      capture.monitorPan = 0;
      capture.monitorMuted = true; // nothing reaches the speakers while the input opens
      inputFailure = null;
      capture.monitoringMode = mode;
      for (let waited = 0; capture.stream.isEmpty(); waited += 100) {
        if (inputFailure !== null) throw new Error(`the input did not open: ${String(inputFailure)}`);
        if (waited >= (input === "microphone" ? 60_000 : 10_000)) throw new Hung(input === "microphone" ? "the microphone opening (answer the browser's prompt)" : "the capture's input opening");
        await sleep(100);
      }
      capture.monitorPanNode.disconnect(speakers);
      capture.monitorMuted = false;
      const inputSides = sidesOf(capture.outputNode.unwrap("the open capture has no output node"));
      releaseInput = () => { try { inputSides.release(); } catch { /* the SDK already dropped the node */ } };
      readInputLeft = () => inputSides.read().left;
      await settle();
      if (capture.effectiveChannelCount !== request) throw new Error(`the capture reports ${capture.effectiveChannelCount} channels for requestChannels ${request}`);
      return String(capture.stream.unwrap().getAudioTracks()[0]?.getSettings().channelCount);
    };
    // the monitor's pan in direct mode: what leaves the pan node over the first channel reaching it
    const monitorSweep = async () => {
      const sweep = {} as Sweep;
      let reaching = 0;
      let alike = true;
      for (const pan of PANS) {
        capture.monitorPan = pan;
        await settle();
        undisturbed();
        const pre = before.read();
        const post = after.read();
        if (pan === 0) {
          reaching = pre.right < pre.left * GONE ? 1 : 2;
          alike = reaching === 1 || about(pre.right / pre.left, 1);
        }
        sweep[pan] = over(post, reference(pre.left, "reaches the monitor's pan on its first channel"));
      }
      capture.monitorPan = 0;
      return { sweep, reaching, alike };
    };
    // the strip's pan in effects mode, the monitor's pan at the centre: what reaches the monitor over the input
    const stripSweep = async (): Promise<Sweep> => {
      const sweep = {} as Sweep;
      for (const pan of [0, -1, 1] as const) {
        project.editing.modify(() => unit.panning.setValue(pan));
        await settle();
        undisturbed();
        sweep[pan] = over(before.read(), reference(readInputLeft(), "at the capture's input"));
      }
      project.editing.modify(() => unit.panning.setValue(0));
      return sweep;
    };

    // ---- 2. the strip's pan ----
    await open("one-channel", 2, "effects");
    const strip = await stripSweep();
    outcomes.stripLaw = lawOf(strip);
    row({ step: "the strip's pan (unit panning −1 / 0 / +1), capture monitored with effects, monitor pan 0, one-channel input", expected: "unity (centre ×1, hard ×1)", got: `${lawText(strip)} (${outcomes.stripLaw})`, ok: outcomes.stripLaw === "unity" });

    // ---- 3. the two pans stacked, still in effects mode ----
    try {
      enter("effects mode: strip pan × monitor pan");
      let composed = true;
      for (const stripPan of PANS) {
        project.editing.modify(() => unit.panning.setValue(stripPan));
        const cells: string[] = [];
        for (const monitorPan of PANS) {
          capture.monitorPan = monitorPan;
          await settle();
          undisturbed();
          const got = over(after.read(), reference(readInputLeft(), "at the capture's input"));
          const s = strip[stripPan];
          const expected: Levels = monitorPan < 0 ? { left: s.left + s.right, right: 0 } : monitorPan > 0 ? { left: 0, right: s.left + s.right } : s;
          if (!cell(got, expected.left, expected.right)) composed = false;
          cells.push(`monitor ${panLabel(monitorPan)}: ${gain(got)}`);
        }
        row({ step: `effects mode, strip pan ${panLabel(stripPan)}, monitor pan −1 / 0 / +1 (after both pans, over the input)`, expected: "", got: cells.join("; "), ok: null });
      }
      capture.monitorPan = 0;
      project.editing.modify(() => unit.panning.setValue(0));
      outcomes.stack = composed ? "as-composed" : "other";
    } catch (error) {
      outcomes.stack = "failed";
      row({ step: stage, expected: "", got: failureOf(error), ok: false });
    }

    // ---- 4. the monitor's pan in direct mode ----
    const direct = async (input: Input, request: 1 | 2) => {
      const trackChannels = await open(input, request, "direct");
      const { sweep, reaching, alike } = await monitorSweep();
      const law: Law = !alike ? "not-measurable" : lawOf(sweep);
      const reach = `${reaching === 1 ? "one channel reaches" : `two channels reach${alike ? "" : ", and they differ"}`} the pan node; the track reports ${trackChannels}`;
      row({ step: `the monitor's pan (capture.monitorPan −1 / 0 / +1), direct, ${input} input, requestChannels ${request}`, expected: "the strip's law: unity (centre ×1, hard ×1)", got: `${lawText(sweep)} (${law}); ${reach}`, ok: law === "not-measurable" ? null : law === "unity" });
      return { law, reaching, trackChannels, sweep };
    };
    const directStereo = await direct("one-channel", 2);
    outcomes.monitorLaw = directStereo.law;
    outcomes.channelsReaching = String(directStereo.reaching);
    const directMono = await direct("one-channel", 1);
    outcomes.monitorLawMono = directMono.law;

    // the verdict is settled here: nothing the later arms do can change or lose it
    const footing = controlsOk && outcomes.stripLaw === "unity";
    const differs = (law: Law) => law === "doubles" || law === "equal-power";
    const verdict: Verdict = !footing ? "INCONCLUSIVE"
      : differs(outcomes.monitorLaw) ? "BUG PRESENT"
      : outcomes.monitorLaw === "unity" ? "FIXED" : "INCONCLUSIVE";
    let message = !footing ? `the controls or the strip did not read as expected (page panner, one channel: ${lawOf(controlMono)}; two: ${lawOf(controlStereo)}; strip: ${outcomes.stripLaw})`
      : `the strip's pan reads ${outcomes.stripLaw} (${lawText(strip)}); the monitor's pan in direct mode reads ${outcomes.monitorLaw} at requestChannels 2 (${lawText(directStereo.sweep)}; ${directStereo.reaching} channel(s) reach the pan node, the track reports ${directStereo.trackChannels}) and ${outcomes.monitorLawMono} at requestChannels 1`;
    message += `; effects-mode stack: ${outcomes.stack}`;

    // ---- 5. a one-sided input ----
    try {
      await open("left-only", 2, "direct");
      const monitor = (await monitorSweep()).sweep;
      row({ step: "the monitor's pan, direct, input with the signal on the left only", expected: "", got: lawText(monitor), ok: null });
      await open("left-only", 2, "effects");
      const stripOneSided = await stripSweep();
      row({ step: "the strip's pan, effects, monitor pan 0, the same input", expected: "", got: lawText(stripOneSided), ok: null });
      const monitorMoves = cell(monitor[-1], 1, 0) && cell(monitor[0], 1, 0) && cell(monitor[1], 0, 1);
      const stripRemoves = cell(stripOneSided[-1], 1, 0) && cell(stripOneSided[0], 1, 0) && cell(stripOneSided[1], 0, 0);
      outcomes.oneSided = monitorMoves && stripRemoves ? "monitor-moves-strip-removes" : "other";
    } catch (error) {
      outcomes.oneSided = "failed";
      row({ step: stage, expected: "", got: failureOf(error), ok: false });
    }
    message += `; one-sided input: ${outcomes.oneSided}`;

    // ---- 5b. a mono request on the one-sided input: is the mixdown that is recorded also what is monitored? ----
    try {
      // levels over the TONE's own level here: the capture's output is the mixdown itself, so it cannot be the reference
      const tone = () => reference(rmsOf(levelTap, buffer), "from the tone");
      await open("left-only", 1, "direct");
      const recorded = readInputLeft() / tone();
      const monitoredDirect = over(before.read(), tone());
      await open("left-only", 1, "effects");
      const monitoredEffects = over(before.read(), tone());
      const mixedDown = (l: Levels) => cell(l, 0.5, 0.5);
      outcomes.monoDirect = !about(recorded, 0.5) ? "other" : mixedDown(monitoredDirect) ? "mixed-down" : cell(monitoredDirect, 1, 0) ? "not-mixed-down" : "other";
      row({ step: "requestChannels 1, a two-channel stream with the signal on the left only: what is recorded (the capture's output node) and what reaches the monitor, over the tone", expected: "the monitor carries the mono mixdown that is recorded (×0.50 on both sides)", got: `recorded ×${recorded.toFixed(2)} (one channel); direct monitoring ${gain(monitoredDirect)}; effects monitoring ${gain(monitoredEffects)}`, ok: outcomes.monoDirect === "other" ? null : outcomes.monoDirect === "mixed-down" });
    } catch (error) {
      outcomes.monoDirect = "failed";
      row({ step: stage, expected: "", got: failureOf(error), ok: false });
    }
    message += `; mono request in direct monitoring: ${outcomes.monoDirect}`;

    // ---- 6. the real microphone, direct mode only ----
    if (USE_MICROPHONE) {
      try {
        const micStereo = await direct("microphone", 2);
        outcomes.micLaw = micStereo.law;
        outcomes.micChannels = `${micStereo.reaching} reach the pan, the track reports ${micStereo.trackChannels}`;
        const micMono = await direct("microphone", 1);
        outcomes.micLawMono = micMono.law;
        outcomes.micChannels += ` (requestChannels 2); ${micMono.reaching} reach the pan, the track reports ${micMono.trackChannels} (requestChannels 1)`;
        message += `; microphone "${capture.label}": ${outcomes.micLaw} at requestChannels 2, ${outcomes.micLawMono} at requestChannels 1; ${outcomes.micChannels}`;
      } catch (error) {
        if (outcomes.micLaw === "not-run") outcomes.micLaw = "failed";
        if (outcomes.micLawMono === "not-run") outcomes.micLawMono = "failed";
        row({ step: stage, expected: "", got: failureOf(error), ok: false });
        message += `; the microphone arm failed (${failureOf(error)})`;
      }
    }
    return { verdict, rows, message, ...outcomes };
  } catch (error) {
    rows.push({ step: stage, expected: "", got: failureOf(error), ok: false });
    if (error instanceof Hung) return { verdict: "HUNG", rows, message: failureOf(error), ...outcomes };
    console.error(`[monitor-pan-law] ${stage}: ${String(error)}`);
    return { verdict: "THREW", rows, message: `${stage}: ${String(error)}`, ...outcomes };
  } finally {
    for (const undo of cleanup.reverse()) { try { undo(); } catch (error) { console.warn(`[monitor-pan-law] cleanup: ${String(error)}`); } }
  }
}

function App() {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const start = useCallback(() => {
    setState({ kind: "running", stage: "init", rows: [] });
    run((stage, rows) => setState({ kind: "running", stage, rows }))
      .then((done) => setState({ kind: "done", ...done }), (error) => setState({ kind: "done", verdict: "THREW", rows: [], message: String(error), ...NOT_RUN }));
  }, []);
  const rows = state.kind === "idle" ? [] : state.rows;
  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" py="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Heading size="6">The monitor's pan against the strip's pan (debug)</Heading>
          <Text size="2" color="gray">
            A Tape's capture is monitored with a synthetic 440 Hz input. The page reads the gain of the capture's own monitor pan
            (<Code>capture.monitorPan</Code>) and of the unit's strip pan (<Code>audioUnitBox.panning</Code>) at −1, 0 and +1,
            separately and stacked, for a one-channel input and for an input with the signal on one side. Nothing is heard: the
            monitor is read through analysers and kept off the speakers.{" "}
            {USE_MICROPHONE
              ? "With ?input=mic the last rows use the default microphone: allow it when the browser asks and make steady noise."
              : "Add ?input=mic to repeat the direct-mode rows on the default microphone."}{" "}
            A real click starts it; one run per page load, about thirty-five seconds.
          </Text>
          <Flex gap="3" align="center">
            <Button id="run" size="3" onClick={start} disabled={state.kind !== "idle"}>Run</Button>
            {state.kind === "running" && <Badge color="amber">running: {state.stage}</Badge>}
            {/* what the repo's Firefox and Safari drivers read (scripts/audit/loudness/drive-*.ts) */}
            <span id="audit-state" data-audit-state={state.kind} hidden />
            <span id="summary-note" hidden>{state.kind === "done" ? `${state.verdict}: strip ${state.stripLaw}; monitor ${state.monitorLaw} / ${state.monitorLawMono}; ${state.channelsReaching} channel(s) reach the pan; stack ${state.stack}; one-sided ${state.oneSided}; mono request ${state.monoDirect}` : ""}</span>
          </Flex>
          {state.kind === "done" && (
            <Card>
              <Text
                id="verdict" size="2" weight="bold" color={state.verdict === "FIXED" ? "green" : state.verdict === "BUG PRESENT" ? "red" : "gray"}
                data-verdict={state.verdict} data-strip-law={state.stripLaw} data-monitor-law={state.monitorLaw} data-monitor-law-mono={state.monitorLawMono}
                data-channels-reaching={state.channelsReaching} data-stack={state.stack} data-one-sided={state.oneSided} data-mono-direct={state.monoDirect}
                data-mic-law={state.micLaw} data-mic-law-mono={state.micLawMono} data-mic-channels={state.micChannels}
              >
                {state.verdict} — {state.message}
              </Text>
            </Card>
          )}
          {rows.length > 0 && (
            <Card>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>gains</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>ok</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r, i) => (
                    <Table.Row key={i} data-ok={String(r.ok)} data-row-id={r.step} data-row-status={r.ok === null ? "measured" : r.ok ? "ok" : "FAIL"}>
                      <Table.Cell><Text size="1">{r.step}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.expected}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.got}</Text></Table.Cell>
                      <Table.Cell>{r.ok === null ? <Badge color="gray">measured</Badge> : r.ok ? <Badge color="green">ok</Badge> : <Badge color="red">FAIL</Badge>}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          )}
          <DebugLinkBar
            links={[
              { label: "debug/2026-11-23-monitor-pan-doubles-at-hard-pan/note.md", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-monitor-pan-doubles-at-hard-pan/note.md", kind: "note" },
              { label: "monitoring-mono-return-debug-demo.html (the harness this came from)", href: "/monitoring-mono-return-debug-demo.html", kind: "demo" },
            ]}
          />
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
