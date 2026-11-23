import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { removeMasterMaximizer } from "@/lib/audit/midiEffectChain";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Button, Code, Table } from "@radix-ui/themes";

// Repro for `debug/2026-11-23-fx-monitor-mono-return/note.md` (openDAW#575).
//
// A 440 Hz oscillator is registered as an EFFECTS-monitoring source of a Tape unit through
// `engine.registerMonitoringSource(uuid, node, numChannels, destination)`, the call the SDK's own
// `BrowserMonitor` makes in "effects" mode. The destination is a gain node this page owns, connected to
// nothing but two analysers (left, right), so the monitored tone is never heard. For each of the unit's pan
// positions −1, 0, +1 the page reads the RMS of both return channels, first with the source registered as
// stereo (the control), then as mono.
//
// The unit's strip pans the signal in the engine, so the return of a source panned hard right should be
// silent on the left and carry the signal on the right, whatever the source's channel count. A mono
// source's return that is silent on BOTH sides at pan +1, and carries the signal on both sides at pan −1
// and at pan 0, is the strip's left channel alone on both sides.
//
// Verdict, once the stereo rows read as a pan (every channel judged against the stereo row's right channel
// at pan +1: the loud side within LEVEL_TOLERANCE of it, the other under SILENT of it, both sides alike at
// pan 0): BUG PRESENT when the mono rows show the WHOLE signature above (silent on both sides at +1, the
// signal on both sides at −1 and at 0), FIXED when all three mono rows follow the pan like the stereo rows,
// INCONCLUSIVE otherwise: a mono return that is silent at every pan is some other failure, not this defect.
// One run per page load.
//
// The page also guards openDAW#528 (fixed): a unit monitored with effects returns through the monitor
// output only. The engine's MAIN output is tapped (the engine keeps its connection to the speakers) and its
// peak is read at every pan position; it must stay under MAIN_SILENT. Its positive control is the row after
// them: the metronome playing for 1.6 s with nothing monitored must show on the same tap. That control is
// the one thing the page plays through the speakers.
//
// Then the SDK's own capture path: a second Tape's `CaptureAudio` is monitored. Its input is a one-channel
// stream carrying the tone (through a patched `getUserMedia`: no microphone, no permission), or with
// `?input=mic` the real default microphone (the browser asks; make some steady noise). Every figure of this arm
// is a ratio between two taps read at the same moment (what reaches the monitor's pan node, what leaves it),
// so it does not depend on the signal. Outcomes on the verdict:
//  - `data-capture-default`: with the capture's default `requestChannels` (2), does the effects return follow
//    the strip's pan? ("follows" / "left-only" / "inconclusive")
//  - `data-capture-mono`: the same with `requestChannels = 1`, where the capture registers one channel and
//    openDAW#575 applies ("left-only" while the defect stands, "follows" when fixed)
//  - `data-monitor-pan` (requestChannels 2) and `data-monitor-pan-mono` (requestChannels 1): the law of the
//    monitor's OWN pan (`capture.monitorPan`, a StereoPannerNode) in direct mode, as gains through it:
//    "doubles" (centre ×1, hard left or right ×2), "equal-power" (centre ×0.71, hard ×1), "unity" (×1 and ×1,
//    the strip's balance) or "other". The rows also say whether one or two channels reach the pan node, which
//    is what selects the node's law. A measurement, not a judgement: these rows carry no ok / FAIL.
// The monitor is muted while its input opens and taken off the speakers before it is unmuted, so this arm is
// silent and a microphone cannot feed back.
//
// Last, the engine worklet is replaced the way an app restarts a failed engine (`engine.releaseWorklet()`,
// `project.startAudioWorklet()`) while the stereo source is monitored
// (`debug/2026-11-23-fx-monitor-lost-on-engine-restart/note.md`, openDAW#576). The return is read before, for
// RESTART_WATCH_MS after the new engine has loaded, and after registering the source again on the new
// worklet (the control: the new worklet monitors). These rows have their own outcome in `data-restart` on
// the verdict: "lost" (quiet for the whole watch), "kept", "inconclusive", "failed" (the restart itself
// threw or hung; the row names the step) or "not-run" (the run ended before it).
const PANS = [-1, 0, 1] as const;
const SETTLE_MS = 600;
const SILENT = 0.02; // a channel under this fraction of the reference level counts as silent
const LEVEL_TOLERANCE = 1.5;
const SIGNAL_MIN = 0.01;
const MAIN_SILENT = 1e-4;
const CLICK_READS = 40;
const CLICK_READ_MS = 40;
const RESTART_WATCH_MS = 3000;
// `?input=mic`: the capture arm opens the real default microphone (the browser asks) in place of the synthetic stream
const USE_MICROPHONE = new URLSearchParams(location.search).get("input") === "mic";

type Levels = { left: number; right: number };
type Row = { step: string; expected: string; got: string; ok: boolean | null };
type Verdict = "BUG PRESENT" | "FIXED" | "INCONCLUSIVE" | "HUNG" | "THREW";
type Restart = "lost" | "kept" | "inconclusive" | "failed" | "not-run";
type CaptureReturn = "follows" | "left-only" | "inconclusive" | "failed" | "not-run";
type MonitorPan = "doubles" | "unity" | "equal-power" | "other" | "failed" | "not-run";
type Outcome = { verdict: Verdict; rows: Row[]; message: string; restart: Restart; captureDefault: CaptureReturn; captureMono: CaptureReturn; monitorPan: MonitorPan; monitorPanMono: MonitorPan };
type RunState = { kind: "idle" } | { kind: "running"; stage: string; rows: Row[] } | ({ kind: "done" } & Outcome);

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
const peakOf = (analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number => {
  analyser.getFloatTimeDomainData(buffer);
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]));
  return peak;
};
const show = ({ left, right }: Levels) => `L ${left.toFixed(4)}, R ${right.toFixed(4)}`;
const panLabel = (pan: number) => (pan < 0 ? "pan −1 (left)" : pan > 0 ? "pan +1 (right)" : "pan 0 (centre)");
const failureOf = (error: unknown) => (error instanceof Hung ? `deadline passed in ${error.stage}` : String(error));

async function run(onStage: (stage: string, rows: Row[]) => void): Promise<Outcome> {
  const rows: Row[] = [];
  let stage = "init";
  let restart: Restart = "not-run";
  let captureDefault: CaptureReturn = "not-run";
  let captureMono: CaptureReturn = "not-run";
  let monitorPan: MonitorPan = "not-run";
  let monitorPanMono: MonitorPan = "not-run";
  const cleanup: Array<() => void> = [];
  const enter = (name: string) => { stage = name; onStage(stage, [...rows]); };
  const row = (r: Row) => { rows.push(r); onStage(stage, [...rows]); console.log(`[monitor-mono-return] ${r.step}: ${r.got}`); };
  try {
    enter("init");
    let mainTap: AnalyserNode | null = null;
    const { project, audioContext } = await race(stage, initializeOpenDAW({
      bpm: 120,
      engineTap: (node) => { mainTap = node.context.createAnalyser(); mainTap.fftSize = 4096; node.connect(mainTap, 0); },
    }), 90_000);
    if (mainTap === null) throw new Error("engineTap never ran");
    const main: AnalyserNode = mainTap;
    if (audioContext.state !== "running") await race("resume (needs a real click)", audioContext.resume(), 10_000);
    if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} after resume`);
    enter("build");
    const master = project.rootBoxAdapter.audioUnits.adapters().find((unit) => unit.isOutput);
    if (master === undefined) throw new Error("no output unit");
    const removed = removeMasterMaximizer(project.editing, master.audioEffects.unwrap("the master hosts no audio-effect chain").adapters());
    if (removed !== 1) throw new Error(`expected one Maximizer on the master, removed ${removed}`);
    const { audioUnitBox } = project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Tape)).unwrap("createInstrument");
    const captureUnit = project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Tape)).unwrap("createInstrument").audioUnitBox;
    const loaded = await race(stage, project.engine.queryLoadingComplete(), 30_000);
    if (!loaded) throw new Error("queryLoadingComplete returned false (no worklet)");

    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 440;
    const level = audioContext.createGain();
    level.gain.value = 0.25;
    oscillator.connect(level);
    // one node per channel count, each with an explicit count, so what the engine is handed is not left to up-mixing rules
    const sourceOf = (channels: 1 | 2): AudioNode => {
      const node = audioContext.createGain();
      node.channelCount = channels;
      node.channelCountMode = "explicit";
      node.channelInterpretation = "speakers";
      level.connect(node);
      return node;
    };
    const sources = { 1: sourceOf(1), 2: sourceOf(2) } as const;
    const destination = audioContext.createGain();
    destination.channelCount = 2;
    destination.channelCountMode = "explicit";
    const splitter = audioContext.createChannelSplitter(2);
    destination.connect(splitter);
    const analysers = [0, 1].map((channel) => {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      splitter.connect(analyser, channel);
      return analyser;
    });
    oscillator.start();
    const uuid = audioUnitBox.address.uuid;
    cleanup.push(() => oscillator.stop(), () => project.engine.unregisterMonitoringSource(uuid));
    const buffer = new Float32Array(4096);
    // an analyser on a context that is not running keeps its last buffer: a stale read is not a reading
    const assertRunning = () => { if (audioContext.state !== "running") throw new Error(`AudioContext is ${audioContext.state} in "${stage}" (document ${document.visibilityState})`); };
    const read = (): Levels => { assertRunning(); return { left: rmsOf(analysers[0], buffer), right: rmsOf(analysers[1], buffer) }; };
    const readMain = (): number => { assertRunning(); return peakOf(main, buffer); };

    const mainPeaks: Record<string, number> = {};
    const measure = async (channels: 1 | 2): Promise<Record<number, Levels>> => {
      const kind = channels === 1 ? "mono" : "stereo";
      enter(`${kind} source`);
      project.engine.registerMonitoringSource(uuid, sources[channels], channels, destination);
      const result: Record<number, Levels> = {};
      for (const pan of PANS) {
        project.editing.modify(() => audioUnitBox.panning.setValue(pan));
        await sleep(SETTLE_MS);
        result[pan] = read();
        mainPeaks[kind] = Math.max(mainPeaks[kind] ?? 0, readMain());
      }
      project.engine.unregisterMonitoringSource(uuid);
      await sleep(SETTLE_MS);
      const after = read();
      if (after.left > SIGNAL_MIN * SILENT || after.right > SIGNAL_MIN * SILENT) throw new Error(`the return did not fall silent after unregistering the ${kind} source (${show(after)})`);
      return result;
    };

    const stereo = await measure(2);
    const reference = stereo[1].right;
    const silent = (value: number) => value < reference * SILENT;
    const near = (value: number) => value > reference / LEVEL_TOLERANCE && value < reference * LEVEL_TOLERANCE;
    const pansRight = (l: Levels) => silent(l.left) && near(l.right);
    const pansLeft = (l: Levels) => silent(l.right) && near(l.left);
    const centred = (l: Levels) => !silent(l.left) && !silent(l.right) && l.left / l.right > 1 / LEVEL_TOLERANCE && l.left / l.right < LEVEL_TOLERANCE;
    const quiet = (l: Levels) => silent(l.left) && silent(l.right);
    const expectedOf = (pan: number) => (pan < 0 ? "signal on the left, right silent" : pan > 0 ? "left silent, signal on the right" : "the same signal on both sides");
    const judge = (pan: number, l: Levels) => (pan < 0 ? pansLeft(l) : pan > 0 ? pansRight(l) : centred(l));
    for (const pan of PANS) row({ step: `stereo source, ${panLabel(pan)} (control)`, expected: expectedOf(pan), got: show(stereo[pan]), ok: reference > SIGNAL_MIN && judge(pan, stereo[pan]) });
    const controlsOk = reference > SIGNAL_MIN && PANS.every((pan) => judge(pan, stereo[pan]));

    const mono = await measure(1);
    for (const pan of PANS) row({ step: `mono source, ${panLabel(pan)}`, expected: expectedOf(pan), got: show(mono[pan]), ok: controlsOk ? judge(pan, mono[pan]) : null });

    // the verdict is settled here: nothing the later arms do can change or lose it
    const right = mono[1];
    const leftOnBothSides = quiet(right) && near(mono[-1].left) && near(mono[-1].right) && centred(mono[0]);
    const verdict: Verdict = !controlsOk ? "INCONCLUSIVE"
      : leftOnBothSides ? "BUG PRESENT"
      : PANS.every((pan) => judge(pan, mono[pan])) ? "FIXED" : "INCONCLUSIVE";
    const monoRows = `−1: ${show(mono[-1])}; 0: ${show(mono[0])}; +1: ${show(right)}`;
    const message = verdict === "BUG PRESENT"
      ? `a mono source panned hard right returns silence on both sides (${show(right)}) where the stereo source returns ${show(stereo[1])}; panned hard left it returns ${show(mono[-1])}, at the centre ${show(mono[0])}`
      : verdict === "FIXED" ? `the mono source's return follows the pan like the stereo source's (pan +1: ${show(right)})`
      : !controlsOk ? `the stereo control does not read as a pan (−1: ${show(stereo[-1])}; 0: ${show(stereo[0])}; +1: ${show(stereo[1])})`
      : PANS.every((pan) => quiet(mono[pan])) ? `the mono source returned nothing at any pan (${monoRows}): not the left-channel signature`
      : `mono rows read neither way (${monoRows})`;

    let mainNote: string;
    try {
      enter("main output");
      const metronome = project.engine.preferences.settings.metronome;
      const metronomeWas = metronome.enabled;
      cleanup.push(() => { project.engine.stop(true); metronome.enabled = metronomeWas; });
      metronome.enabled = true;
      project.engine.play();
      let clickPeak = 0;
      const started = performance.now();
      for (let i = 0; i < CLICK_READS; i++) { await sleep(CLICK_READ_MS); clickPeak = Math.max(clickPeak, readMain()); }
      const elapsed = performance.now() - started;
      project.engine.stop(true);
      metronome.enabled = metronomeWas;
      if (elapsed > CLICK_READS * CLICK_READ_MS * 1.5) throw new Error(`reading the metronome took ${Math.round(elapsed)} ms for ${CLICK_READS * CLICK_READ_MS} ms (document ${document.visibilityState}): timers throttled`);
      const tapWorks = clickPeak > SIGNAL_MIN;
      const leak = (["stereo", "mono"] as const).filter((kind) => mainPeaks[kind] >= MAIN_SILENT);
      for (const kind of ["stereo", "mono"] as const) row({ step: `main output while the ${kind} source is monitored (openDAW#528)`, expected: `silent (peak under ${MAIN_SILENT})`, got: `peak ${mainPeaks[kind].toFixed(5)}`, ok: tapWorks ? mainPeaks[kind] < MAIN_SILENT : null });
      row({ step: "main output, metronome playing, nothing monitored (control for the tap)", expected: `peak over ${SIGNAL_MIN}`, got: `peak ${clickPeak.toFixed(4)}`, ok: tapWorks });
      mainNote = !tapWorks ? "; the main-output tap read no metronome, so the main-output rows prove nothing"
        : leak.length > 0 ? `; the MAIN output carried the monitored signal (${leak.join(", ")}): openDAW#528 is back` : "; the main output stayed silent while monitoring";
    } catch (error) {
      row({ step: `main output: ${stage}`, expected: "", got: failureOf(error), ok: false });
      mainNote = `; the main-output check failed (${failureOf(error)})`;
    }

    let captureNote: string;
    try {
      enter("capture: setup");
      const capture = project.captureDevices.audio(captureUnit.address.uuid).unwrap("no CaptureAudio for the second Tape");
      const speakers = audioContext.destination;
      // the SDK's monitor disconnects its pan node from the speakers on a mode change and throws if it is not connected
      const close = () => { capture.monitorPanNode.connect(speakers); capture.monitoringMode = "off"; capture.armed.setValue(false); capture.monitorMuted = false; };
      if (USE_MICROPHONE) {
        cleanup.push(close);
      } else {
        const input = audioContext.createMediaStreamDestination();
        input.channelCount = 1;
        input.channelCountMode = "explicit";
        input.channelInterpretation = "speakers";
        level.connect(input);
        const mediaDevices = navigator.mediaDevices;
        const originalGetUserMedia = mediaDevices.getUserMedia;
        mediaDevices.getUserMedia = async () => input.stream.clone();
        cleanup.push(() => { mediaDevices.getUserMedia = originalGetUserMedia; }, close);
      }
      // two taps read in the same task, so they hold the same 4096 frames: what reaches the monitor's pan (the
      // monitor's gain node through a discrete splitter, whose second output is silent for a one-channel signal)
      // and what leaves it. Every figure of this arm is a ratio of the two, so it holds for any input signal.
      const preSplitter = audioContext.createChannelSplitter(2);
      capture.monitorGainNode.connect(preSplitter);
      const preAnalysers = [0, 1].map((channel) => {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        preSplitter.connect(analyser, channel);
        return analyser;
      });
      capture.monitorPanNode.connect(destination);
      cleanup.push(() => { capture.monitorGainNode.disconnect(preSplitter); capture.monitorPanNode.disconnect(destination); });
      const readPre = (): Levels => { assertRunning(); return { left: rmsOf(preAnalysers[0], buffer), right: rmsOf(preAnalysers[1], buffer) }; };
      const FLOOR = 1e-5;
      const open = async (request: 1 | 2, mode: "direct" | "effects") => {
        enter(`capture: requestChannels ${request}, ${mode}`);
        close();
        await sleep(300);
        project.editing.modify(() => { capture.requestChannels = request; captureUnit.panning.setValue(0); });
        capture.monitorPan = 0;
        capture.monitorMuted = true; // nothing reaches the speakers while the input opens
        capture.monitoringMode = mode;
        for (let waited = 0; capture.stream.isEmpty(); waited += 100) {
          if (waited >= (USE_MICROPHONE ? 60_000 : 10_000)) throw new Hung(USE_MICROPHONE ? "the microphone opening (allow it in the browser's prompt)" : "the capture's input opening");
          await sleep(100);
        }
        capture.monitorPanNode.disconnect(speakers);
        capture.monitorMuted = false;
        await sleep(SETTLE_MS);
        if (capture.effectiveChannelCount !== request) throw new Error(`the capture reports ${capture.effectiveChannelCount} channels for requestChannels ${request}`);
      };
      // the effects return as it reaches the monitor, per strip pan; `centre` is the level both are judged against
      type Sweep = { centre: Levels; left: Levels; right: Levels };
      const stripSweep = async (): Promise<Sweep> => {
        const at = async (pan: number) => { project.editing.modify(() => captureUnit.panning.setValue(pan)); await sleep(SETTLE_MS); return readPre(); };
        const centre = await at(0);
        if (!(centre.left > FLOOR)) throw new Error(`no signal reaches the monitor (${show(centre)})${USE_MICROPHONE ? ": make some noise at the microphone" : ""}`);
        return { centre, left: await at(-1), right: await at(1) };
      };
      const gone = (value: number, sweep: Sweep) => value < sweep.centre.left * 0.05;
      const alike = (a: number, b: number) => a / b > 1 / LEVEL_TOLERANCE && a / b < LEVEL_TOLERANCE;
      const followsLeft = (sweep: Sweep) => !gone(sweep.left.left, sweep) && gone(sweep.left.right, sweep);
      const followsRight = (sweep: Sweep) => gone(sweep.right.left, sweep) && !gone(sweep.right.right, sweep);
      const classify = (sweep: Sweep): CaptureReturn => followsLeft(sweep) && followsRight(sweep) ? "follows"
        : !gone(sweep.left.left, sweep) && alike(sweep.left.left, sweep.left.right) && gone(sweep.right.left, sweep) && gone(sweep.right.right, sweep) ? "left-only" : "inconclusive";
      const returnRows = (label: string, sweep: Sweep) => {
        row({ step: `capture, ${label}, effects, strip pan −1`, expected: expectedOf(-1), got: show(sweep.left), ok: followsLeft(sweep) });
        row({ step: `capture, ${label}, effects, strip pan +1`, expected: expectedOf(1), got: `${show(sweep.right)} (centre ${show(sweep.centre)})`, ok: followsRight(sweep) });
      };
      const inputLabel = USE_MICROPHONE ? "microphone" : "one-channel synthetic input";
      await open(2, "effects");
      const track = capture.stream.unwrap().getAudioTracks()[0];
      const streamChannels = String(track?.getSettings().channelCount);
      const defaultSweep = await stripSweep();
      captureDefault = classify(defaultSweep);
      returnRows(`${inputLabel}, default requestChannels (2)`, defaultSweep);
      await open(1, "effects");
      const monoSweep = await stripSweep();
      captureMono = classify(monoSweep);
      returnRows(`${inputLabel}, requestChannels 1 (openDAW#575)`, monoSweep);

      // the monitor's own pan, as gains from what reaches the pan node to what leaves it, per requested channel count
      const panGains = async (request: 1 | 2) => {
        await open(request, "direct");
        const gains: Record<number, Levels> = {};
        let reaching = 0;
        for (const pan of PANS) {
          capture.monitorPan = pan;
          await sleep(SETTLE_MS);
          const pre = readPre();
          const post = read();
          if (!(pre.left > FLOOR)) throw new Error(`no signal reaches the monitor (${show(pre)})${USE_MICROPHONE ? ": make some noise at the microphone" : ""}`);
          if (pan === 0) reaching = pre.right < pre.left * 0.05 ? 1 : 2;
          gains[pan] = { left: post.left / pre.left, right: post.right / pre.left };
        }
        capture.monitorPan = 0;
        const about = (value: number, target: number) => Math.abs(value - target) < 0.1 * Math.max(1, target);
        const centre = [gains[0].left, gains[0].right];
        const hard = [gains[-1].left, gains[1].right];
        const offSide = [gains[-1].right, gains[1].left].every((value) => value < 0.05);
        const law: MonitorPan = !offSide ? "other"
          : centre.every((value) => about(value, 1)) && hard.every((value) => about(value, 2)) ? "doubles"
          : centre.every((value) => about(value, Math.SQRT1_2)) && hard.every((value) => about(value, 1)) ? "equal-power"
          : centre.every((value) => about(value, 1)) && hard.every((value) => about(value, 1)) ? "unity" : "other";
        const gain = (l: Levels) => `L ×${l.left.toFixed(2)}, R ×${l.right.toFixed(2)}`;
        for (const pan of PANS) row({ step: `capture, ${inputLabel}, requestChannels ${request}, direct, monitor ${panLabel(pan)} (measurement: gain through the pan)`, expected: "", got: `${gain(gains[pan])}${pan === 0 ? `; ${reaching === 1 ? "one channel reaches" : "two channels reach"} the pan` : ""}`, ok: null });
        return { law, reaching, summary: `${reaching === 1 ? "one channel" : "two channels"} at the pan, centre ×${centre[0].toFixed(2)}, hard left / right ×${hard[0].toFixed(2)} / ×${hard[1].toFixed(2)} (${law})` };
      };
      const stereoRequest = await panGains(2);
      const monoRequest = await panGains(1);
      close();
      monitorPan = stereoRequest.law;
      monitorPanMono = monoRequest.law;
      captureNote = `; through CaptureAudio (${inputLabel}, the stream reports ${streamChannels} channel(s)) the effects return ${captureDefault === "follows" ? "follows the strip pan" : `reads ${captureDefault}`} at the default requestChannels and ${captureMono === "left-only" ? "is the strip's left channel on both sides" : captureMono === "follows" ? "follows the strip pan" : `reads ${captureMono}`} at requestChannels 1; the monitor's own pan in direct mode: requestChannels 2, ${stereoRequest.summary}; requestChannels 1, ${monoRequest.summary}`;
    } catch (error) {
      if (captureDefault === "not-run") captureDefault = "failed";
      if (captureMono === "not-run") captureMono = "failed";
      if (monitorPan === "not-run") monitorPan = "failed";
      if (monitorPanMono === "not-run") monitorPanMono = "failed";
      row({ step: stage, expected: "", got: failureOf(error), ok: false });
      captureNote = `; the capture arm failed (${failureOf(error)})`;
    }

    let restartNote: string;
    try {
      enter("engine restart");
      const centre = stereo[0]; // the same pan, measured in the stereo block
      const carries = (l: Levels) => [l.left / centre.left, l.right / centre.right].every((ratio) => ratio > 1 / LEVEL_TOLERANCE && ratio < LEVEL_TOLERANCE);
      project.editing.modify(() => audioUnitBox.panning.setValue(0));
      project.engine.registerMonitoringSource(uuid, sources[2], 2, destination);
      await sleep(SETTLE_MS);
      const beforeRestart = read();
      enter("engine restart: releaseWorklet + startAudioWorklet");
      project.engine.releaseWorklet();
      const replacement = project.startAudioWorklet();
      await race("the new worklet's isReady", replacement.isReady(), 30_000);
      const reloaded = await race("the new worklet's queryLoadingComplete", project.engine.queryLoadingComplete(), 30_000);
      if (!reloaded) throw new Error("queryLoadingComplete returned false on the new worklet");
      enter("engine restart: watching the return");
      let afterRestart: Levels = { left: 0, right: 0 };
      for (let waited = 0; waited < RESTART_WATCH_MS; waited += 250) {
        await sleep(250);
        const now = read();
        if (now.left + now.right >= afterRestart.left + afterRestart.right) afterRestart = now;
      }
      enter("engine restart: registering again");
      project.engine.unregisterMonitoringSource(uuid);
      project.engine.registerMonitoringSource(uuid, sources[2], 2, destination);
      await sleep(SETTLE_MS);
      const registeredAgain = read();
      project.engine.unregisterMonitoringSource(uuid);
      const restartControls = controlsOk && carries(beforeRestart) && carries(registeredAgain);
      restart = !restartControls ? "inconclusive" : quiet(afterRestart) ? "lost" : carries(afterRestart) ? "kept" : "inconclusive";
      row({ step: "stereo source monitored, before the engine restart (control)", expected: "signal on both sides", got: show(beforeRestart), ok: carries(beforeRestart) });
      row({ step: `the same source after releaseWorklet + startAudioWorklet (loudest read in ${RESTART_WATCH_MS / 1000} s)`, expected: "signal on both sides", got: show(afterRestart), ok: restartControls ? carries(afterRestart) : null });
      row({ step: "registered again on the new worklet (control)", expected: "signal on both sides", got: show(registeredAgain), ok: carries(registeredAgain) });
      restartNote = restart === "lost" ? "; after an engine restart the monitored source returns silence until it is registered again"
        : restart === "kept" ? "; the monitored source survives an engine restart" : "; the engine-restart rows are inconclusive";
    } catch (error) {
      restart = "failed";
      row({ step: stage, expected: "", got: failureOf(error), ok: false });
      restartNote = `; the engine restart failed (${failureOf(error)})`;
    }
    return { verdict, rows, message: message + mainNote + captureNote + restartNote, restart, captureDefault, captureMono, monitorPan, monitorPanMono };
  } catch (error) {
    rows.push({ step: stage, expected: "", got: failureOf(error), ok: false });
    if (error instanceof Hung) return { verdict: "HUNG", rows, message: failureOf(error), restart, captureDefault, captureMono, monitorPan, monitorPanMono };
    console.error(`[monitor-mono-return] ${stage}: ${String(error)}`);
    return { verdict: "THREW", rows, message: `${stage}: ${String(error)}`, restart, captureDefault, captureMono, monitorPan, monitorPanMono };
  } finally {
    for (const undo of cleanup.reverse()) { try { undo(); } catch (error) { console.warn(`[monitor-mono-return] cleanup: ${String(error)}`); } }
  }
}

function App() {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const start = useCallback(() => {
    setState({ kind: "running", stage: "init", rows: [] });
    run((stage, rows) => setState({ kind: "running", stage, rows }))
      .then((done) => setState({ kind: "done", ...done }), (error) => setState({ kind: "done", verdict: "THREW", rows: [], message: String(error), restart: "not-run", captureDefault: "not-run", captureMono: "not-run", monitorPan: "not-run", monitorPanMono: "not-run" }));
  }, []);
  const rows = state.kind === "idle" ? [] : state.rows;
  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" py="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Heading size="6">Effects monitoring: the return of a mono source (debug)</Heading>
          <Text size="2" color="gray">
            A 440 Hz tone is registered as an effects-monitoring source of a Tape unit with{" "}
            <Code>engine.registerMonitoringSource</Code>, first as a stereo source, then as a mono one. For the unit's pan at −1,
            0 and +1 the page reads the level of the return's left and right channels. The return goes to analysers only, so the
            tone is never heard; the one thing played is a 1.6 s metronome check. Then a capture is monitored with a synthetic
            one-channel input, and last the engine worklet is replaced under a monitored source. A real click starts it; one run per page load.
          </Text>
          <Flex gap="3" align="center">
            <Button id="run" size="3" onClick={start} disabled={state.kind !== "idle"}>Run</Button>
            {state.kind === "running" && <Badge color="amber">running: {state.stage}</Badge>}
            {state.kind === "done" && (
              <Badge id="verdict" data-verdict={state.verdict} data-restart={state.restart} data-capture-default={state.captureDefault} data-capture-mono={state.captureMono} data-monitor-pan={state.monitorPan} data-monitor-pan-mono={state.monitorPanMono} color={state.verdict === "FIXED" ? "green" : state.verdict === "BUG PRESENT" ? "red" : "gray"} size="2">
                {state.verdict} — {state.message}
              </Badge>
            )}
          </Flex>
          {rows.length > 0 && (
            <Card>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>return RMS</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>ok</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((r, i) => (
                    <Table.Row key={i} data-ok={String(r.ok)}>
                      <Table.Cell><Text size="1">{r.step}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.expected}</Text></Table.Cell>
                      <Table.Cell><Text size="1">{r.got}</Text></Table.Cell>
                      <Table.Cell>{r.ok === null ? <Badge color="gray">?</Badge> : r.ok ? <Badge color="green">ok</Badge> : <Badge color="red">FAIL</Badge>}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          )}
          <DebugLinkBar
            links={[
              { label: "debug/2026-11-23-fx-monitor-mono-return/note.md", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-fx-monitor-mono-return/note.md", kind: "note" },
              { label: "Upstream, open: openDAW#575 (mono return)", href: "https://github.com/andremichelle/openDAW/issues/575", kind: "note" },
              { label: "debug/2026-11-23-fx-monitor-lost-on-engine-restart/note.md", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-fx-monitor-lost-on-engine-restart/note.md", kind: "note" },
              { label: "Upstream, open: openDAW#576 (engine restart)", href: "https://github.com/andremichelle/openDAW/issues/576", kind: "note" },
            ]}
          />
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
