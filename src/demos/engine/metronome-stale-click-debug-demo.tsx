import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import type { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { TestStep, TestStepRow } from "@/components/TestStep";
import { initializeOpenDAW } from "@/lib/projectSetup";
import {
  CLEAN_HEAD_RATIO_MAX, CUT_BODY_MAX_MS, CUT_BODY_MIN_MS, HEAD_WINDOW_MS, STALE_HEAD_RATIO_MIN,
  analyzeRestart, cutInsideBody, type RestartAnalysis,
} from "@/lib/audit/clickHead";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Callout,
  Badge,
  Button,
  Code,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Repro for `debug/metronome-click-survives-pause.md`.
//
// `Metronome::process` (crates/engine/src/metronome.rs) is called from `render`
// only while the transport plays; it keeps its active clicks in `self.clicks`
// and advances them at the end of every call. `Engine::pause` / `stop` /
// `stop_recording` reset the transport and re-apply the metronome's enabled
// state but never clear that list. A click that has started within its body
// (the default click: 2 ms attack + 50 ms release) when the transport stops is
// therefore frozen and resumes at the first render after play — on top of
// whatever the new position plays. In the default monophonic mode the new click
// fades the stale one over 5 ms; it still hits full level at the restart.
//
// Both steps below stop the transport and restart it from 0 with the metronome
// on, recording the engine's output through `initializeOpenDAW`'s `engineTap`
// (an AudioWorklet recorder on output 0). The metric is the restart's HEAD RATIO:
// the peak of the first `HEAD_WINDOW_MS` (0.5 ms) after the restart's first
// non-silent sample over the interrupted click's own peak (see clickHead.ts).
//  - CONTROL stops a quarter beat AFTER the beat-2 click, between clicks. The
//    restart's head is the new downbeat's own 2 ms attack ramp, ≤ ~29 % of the
//    beat click's level (measured 0.14) — under `CLEAN_HEAD_RATIO_MAX`.
//  - STALE sends the stop with a lead BEFORE beat 2 (adapted per attempt from
//    the recording) so the transport halts `CUT_BODY_MIN_MS`–`CUT_BODY_MAX_MS`
//    into that click: attack complete, release still ≥ 80 %. With the defect
//    the stale body resumes at that level under the new downbeat, ≥
//    `STALE_HEAD_RATIO_MIN` whatever the 440 Hz sine's phase (measured
//    0.47–0.80). On a fixed engine it reads like the control.
//
// Every stage is raced against a hang ceiling and the verdict names the last
// stage reached, so the page self-classifies as BUG PRESENT / FIXED /
// INCONCLUSIVE without a listener.
const BPM = 120;
const BEAT = PPQN.Quarter;
/** Control: stop a quarter beat after the beat-2 click, well past its 52 ms body. */
const CONTROL_STOP_PPQN = 2 * BEAT + BEAT / 4;
/** Stale: stop so that the transport halts INSIDE the beat-2 click. The position
 *  observable ticks per animation frame (~16 ms) and the stop command round-trips
 *  through the worklet (~5–30 ms), so the stop request goes out a lead BEFORE the
 *  beat. The lead adapts per attempt from the recording: a stop that landed
 *  before the click (the previous click's full body rendered) shortens it, one
 *  that landed too deep lengthens it by the overshoot. */
const STALE_LEAD_START_MS = 40;
const STALE_LEAD_STEP_MS = 8;
const STALE_ATTEMPTS = 7;
const stalePpqnForLead = (leadMs: number) => 2 * BEAT - (leadMs / 1000) * ((BPM / 60) * BEAT);
/** Next lead from the last attempt's rendered cut: landed before the click (the previous
 *  click's whole body rendered) → shorter; landed inside but off target (too deep, or in
 *  the attack) → shift by the distance to the middle of the accepted window. */
const nextLeadMs = (leadMs: number, cutBodyMs: number): number =>
  cutBodyMs >= 40 ? Math.max(0, leadMs - STALE_LEAD_STEP_MS) : leadMs + (cutBodyMs - (CUT_BODY_MIN_MS + CUT_BODY_MAX_MS) / 2);
// The accepted cut window and the two head-ratio bounds live in clickHead.ts next
// to the measurement, so the unit tests and this page cannot drift apart.
/** 7 attempts × ~2.5 s plus the control; a hang is a stage that never settles. */
const HANG_TIMEOUT_MS = 40_000;
const SILENCE_THRESHOLD = 0.01;

type Outcome = "OK" | "HUNG" | "THREW";

interface RunReport {
  outcome: Outcome;
  stages: string;
  elapsedMs: number;
  detail: string;
  analysis: RestartAnalysis | null;
  attempts: number;
}

class HangError extends Error {
  constructor(readonly lastStage: string, timeoutMs: number) {
    super(`hung: no settle within ${timeoutMs / 1000}s (last stage: ${lastStage})`);
  }
}

class CancelledError extends Error {
  constructor() { super("cancelled: the hang ceiling fired while a stage was pending"); }
}

/** A run's cancellation token: the hang ceiling flips it, and every stage checks
 *  it so a timed-out run stops driving the engine instead of interleaving with
 *  the next click's run. */
class RunToken {
  cancelled = false;
  private readonly listeners: (() => void)[] = [];
  cancel(): void { this.cancelled = true; this.listeners.splice(0).forEach((l) => l()); }
  onCancel(listener: () => void): void { if (this.cancelled) listener(); else this.listeners.push(listener); }
  check(): void { if (this.cancelled) throw new CancelledError(); }
}

function raceHang<T>(promise: Promise<T>, stages: () => string, token: RunToken): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { token.cancel(); reject(new HangError(stages(), HANG_TIMEOUT_MS)); }, HANG_TIMEOUT_MS);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

const sleep = (ms: number, token: RunToken) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  token.onCancel(() => { clearTimeout(timer); reject(new CancelledError()); });
});

/** Resolve once `test()` holds: checked now, then on every notification from
 *  `subscribe` (a plain `subscribe`, so the callback never fires synchronously
 *  inside the `const` binding — the TDZ hazard root CLAUDE.md warns about).
 *  Rejects and terminates the subscription when the run is cancelled. */
function waitUntil(test: () => boolean, subscribe: (cb: () => void) => { terminate(): void }, token: RunToken): Promise<void> {
  token.check();
  if (test()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const sub = subscribe(() => {
      if (test()) { sub.terminate(); resolve(); }
    });
    token.onCancel(() => { sub.terminate(); reject(new CancelledError()); });
  });
}

// ---- output recorder: an AudioWorklet fed from the engine's output 0, posting
// every render quantum with its context time so segments can be sliced by time.
const RECORDER_NAME = "stale-click-recorder";
const RECORDER_SOURCE = `class R extends AudioWorkletProcessor {
  process(inputs) {
    const c = inputs[0] && inputs[0][0];
    if (c) this.port.postMessage({ t: currentTime, data: new Float32Array(c) });
    return true;
  }
}
registerProcessor(${JSON.stringify(RECORDER_NAME)}, R);`;

interface Chunk { t: number; data: Float32Array }

class OutputRecorder {
  readonly chunks: Chunk[] = [];
  private node: AudioWorkletNode | null = null;
  private pending: AudioNode | null = null;

  constructor(private readonly context: AudioContext) {}

  async install(): Promise<void> {
    const url = URL.createObjectURL(new Blob([RECORDER_SOURCE], { type: "application/javascript" }));
    await this.context.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(this.context, RECORDER_NAME, {
      numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit",
    });
    this.node.port.onmessage = (e: MessageEvent<Chunk>) => {
      this.chunks.push(e.data);
      // keep ~10 s
      if (this.chunks.length > 4000) this.chunks.splice(0, this.chunks.length - 4000);
    };
    if (this.pending !== null) this.attach(this.pending);
  }

  /** `engineTap` callback: the engine worklet's output 0 feeds the recorder. */
  attach(engineNode: AudioNode): void {
    if (this.node === null) { this.pending = engineNode; return; }
    engineNode.connect(this.node, 0);
  }

  /** Mono samples covering `[from, to)` context seconds (missing quanta read as zeros). */
  slice(from: number, to: number): Float32Array {
    const rate = this.context.sampleRate;
    const out = new Float32Array(Math.max(0, Math.round((to - from) * rate)));
    for (const { t, data } of this.chunks) {
      if (t + data.length / rate <= from || t >= to) continue;
      const offset = Math.round((t - from) * rate);
      for (let i = 0; i < data.length; i++) {
        const j = offset + i;
        if (j >= 0 && j < out.length) out[j] = data[i];
      }
    }
    return out;
  }
}

function reportRows(report: RunReport): TestStepRow[] {
  const a = report.analysis;
  return [
    { label: "outcome", value: report.outcome },
    { label: "stages reached", value: report.stages },
    { label: "attempts", value: String(report.attempts) },
    { label: "cut click body before the stop", value: a ? `${a.cutBodyMs.toFixed(1)} ms` : "—" },
    { label: "interrupted click's level", value: a ? a.fullLevel.toFixed(3) : "—" },
    { label: `restart head ratio (first ${HEAD_WINDOW_MS} ms / interrupted click's level)`, value: a ? a.headRatio.toFixed(2) : "—" },
    { label: "elapsed", value: `${(report.elapsedMs / 1000).toFixed(2)} s` },
    { label: "detail", value: report.detail },
  ];
}

type Verdict = "BUG PRESENT" | "FIXED" | "INCONCLUSIVE";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [gotByStep, setGotByStep] = useState<Record<number, TestStepRow[]>>({});
  const [reports, setReports] = useState<Record<number, RunReport>>({});
  const recorderRef = useRef<OutputRecorder | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        let recorder: OutputRecorder | null = null;
        const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
          localAudioBuffers: new Map(),
          bpm: BPM,
          onStatusUpdate: setStatus,
          engineTap: (engineNode) => {
            // initializeOpenDAW hands us the node right after its destination
            // connect; the recorder attaches once its module is registered.
            recorder ??= new OutputRecorder(engineNode.context as AudioContext);
            recorder.attach(engineNode);
          },
        });
        if (!mounted) return;
        recorder ??= new OutputRecorder(ctx);
        await recorder.install();
        recorderRef.current = recorder;
        newProject.engine.preferences.settings.metronome.enabled = true;
        setProject(newProject);
        setAudioContext(ctx);
        setStatus("Ready");
      } catch (error) {
        console.error("Init error: " + String(error));
        if (mounted) setStatus(`Error: ${String(error)}`);
      }
    })();
    return () => { mounted = false; };
  }, []);

  /** Play from 0, stop once the position passes `stopPpqn`, restart from 0, record both edges. */
  const stopAndRestart = useCallback(
    async (stopPpqn: number, stage: (s: string) => void, token: RunToken): Promise<RestartAnalysis> => {
      if (!project || !audioContext || !recorderRef.current) throw new Error("not initialized");
      const recorder = recorderRef.current;
      const { engine } = project;
      stage("arm");
      token.check();
      if (audioContext.state !== "running") await audioContext.resume();
      engine.stop();
      await sleep(150, token);
      engine.setPosition(0);
      await sleep(100, token);
      stage("play");
      engine.play();
      await waitUntil(() => engine.position.getValue() >= stopPpqn, (cb) => engine.position.subscribe(cb), token);
      const stopAt = audioContext.currentTime;
      stage(`stop@${stopAt.toFixed(3)}`);
      engine.stop();
      await waitUntil(() => !engine.isPlaying.getValue(), (cb) => engine.isPlaying.subscribe(cb), token);
      await sleep(350, token);
      stage("rewind");
      engine.setPosition(0);
      await sleep(150, token);
      const playAt = audioContext.currentTime;
      stage(`restart@${playAt.toFixed(3)}`);
      engine.play();
      await sleep(450, token);
      engine.stop();
      await sleep(200, token);
      stage("analyze");
      const pre = recorder.slice(stopAt - 0.7, stopAt + 0.3);
      const post = recorder.slice(playAt - 0.02, playAt + 0.45);
      return analyzeRestart(pre, post, audioContext.sampleRate, SILENCE_THRESHOLD);
    },
    [project, audioContext]
  );

  const runStep = useCallback(
    async (stepIndex: number, body: (stage: (s: string) => void, token: RunToken) => Promise<{ analysis: RestartAnalysis; attempts: number; detail: string }>) => {
      if (!project || running !== null) return;
      setRunning(stepIndex);
      setGotByStep((prev) => { const next = { ...prev }; delete next[stepIndex]; return next; });
      const stages: string[] = [];
      const stage = (s: string) => { stages.push(s); };
      const startedAt = performance.now();
      const token = new RunToken();
      let report: RunReport;
      try {
        const { analysis, attempts, detail } = await raceHang(body(stage, token), () => stages[stages.length - 1] ?? "(none)", token);
        report = { outcome: "OK", stages: stages.join(" → "), elapsedMs: performance.now() - startedAt, detail, analysis, attempts };
      } catch (error) {
        console.error(`step ${stepIndex} failed: ${String(error)}`);
        report = {
          outcome: error instanceof HangError ? "HUNG" : "THREW",
          stages: stages.join(" → "), elapsedMs: performance.now() - startedAt, detail: String(error), analysis: null, attempts: 0,
        };
      } finally {
        setRunning(null);
      }
      setGotByStep((prev) => ({ ...prev, [stepIndex]: reportRows(report) }));
      setReports((prev) => ({ ...prev, [stepIndex]: report }));
    },
    [project, running]
  );

  const runControl = useCallback(() => runStep(1, async (stage, token) => {
    const analysis = await stopAndRestart(CONTROL_STOP_PPQN, stage, token);
    if (analysis.restartOnset < 0) {
      return { analysis, attempts: 1, detail: "the recorder saw no signal after the restart — tap or transport failed, control INCONCLUSIVE" };
    }
    const clean = analysis.headRatio <= CLEAN_HEAD_RATIO_MAX;
    return {
      analysis, attempts: 1,
      detail: clean
        ? `restart head ratio ${analysis.headRatio.toFixed(2)} ≤ ${CLEAN_HEAD_RATIO_MAX}: the new downbeat ramps from silence`
        : `restart head ratio ${analysis.headRatio.toFixed(2)} > ${CLEAN_HEAD_RATIO_MAX} on a stop BETWEEN clicks — control failed, check the tap`,
    };
  }), [runStep, stopAndRestart]);

  const runStale = useCallback(() => runStep(2, async (stage, token) => {
    let last: RestartAnalysis | null = null;
    let leadMs = STALE_LEAD_START_MS;
    for (let attempt = 1; attempt <= STALE_ATTEMPTS; attempt++) {
      stage(`attempt ${attempt} (lead ${leadMs.toFixed(0)} ms)`);
      const analysis = await stopAndRestart(stalePpqnForLead(leadMs), stage, token);
      last = analysis;
      if (analysis.restartOnset < 0) {
        stage("restart not captured");
        return { analysis, attempts: attempt, detail: "the recorder saw no signal after the restart — tap or transport failed, INCONCLUSIVE" };
      }
      const cutInside = cutInsideBody(analysis.cutBodyMs);
      if (!cutInside) {
        stage(`${analysis.cutBodyMs >= 40 ? "stop landed before the click" : analysis.cutBodyMs < CUT_BODY_MIN_MS ? "stop landed in the attack" : "stop landed too deep"} (${analysis.cutBodyMs.toFixed(1)} ms rendered)`);
        leadMs = nextLeadMs(leadMs, analysis.cutBodyMs);
        continue;
      }
      const stale = analysis.headRatio >= STALE_HEAD_RATIO_MIN;
      const clean = analysis.headRatio <= CLEAN_HEAD_RATIO_MAX;
      return {
        analysis, attempts: attempt,
        detail: stale
          ? `stop landed ${analysis.cutBodyMs.toFixed(1)} ms into the click; restart head ratio ${analysis.headRatio.toFixed(2)} ≥ ${STALE_HEAD_RATIO_MIN}: the stale click body resumed at its release level — BUG PRESENT`
          : clean
            ? `stop landed ${analysis.cutBodyMs.toFixed(1)} ms into the click; restart head ratio ${analysis.headRatio.toFixed(2)} ≤ ${CLEAN_HEAD_RATIO_MAX}: the restart ramps from silence — FIXED`
            : `stop landed ${analysis.cutBodyMs.toFixed(1)} ms into the click; restart head ratio ${analysis.headRatio.toFixed(2)} sits between the clean and stale bands — INCONCLUSIVE`,
      };
    }
    return {
      analysis: last!, attempts: STALE_ATTEMPTS,
      detail: `no attempt stopped inside a click (last rendered body ${last!.cutBodyMs.toFixed(1)} ms) — INCONCLUSIVE, re-run`,
    };
  }), [runStep, stopAndRestart]);

  const verdict = ((): Verdict | null => {
    const stale = reports[2];
    if (!stale || stale.outcome !== "OK" || !stale.analysis) return stale ? "INCONCLUSIVE" : null;
    const a = stale.analysis;
    if (a.restartOnset < 0 || !cutInsideBody(a.cutBodyMs)) return "INCONCLUSIVE";
    if (a.headRatio >= STALE_HEAD_RATIO_MIN) return "BUG PRESENT";
    if (a.headRatio <= CLEAN_HEAD_RATIO_MAX) return "FIXED";
    return "INCONCLUSIVE";
  })();

  const ready = project !== null && status === "Ready";
  const runButton = (label: string, onClick: () => void) => (
    <Button onClick={onClick} disabled={!ready || running !== null} size="3">
      <PlayIcon /> {label}
    </Button>
  );

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar
          links={[
            { label: "Swipe comping demo (count-in metronome)", href: "/swipe-comping-demo.html", kind: "demo" },
            {
              label: "debug/metronome-click-survives-pause.md",
              href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/metronome-click-survives-pause.md",
              kind: "note",
            },
            {
              label: "Upstream issue: openDAW#419",
              href: "https://github.com/andremichelle/openDAW/issues/419",
              kind: "note",
            },
          ]}
        />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">Metronome: a click in flight at a stop resumes at the next play</Heading>

          <Callout.Root color="blue">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              <Code>Metronome::process</Code> runs only while the transport plays and keeps its
              active clicks in a list that <Code>pause</Code>, <Code>stop</Code> and{" "}
              <Code>stop_recording</Code> never clear. Stop the transport inside a click's 52 ms
              body and press play: the rest of that click renders on top of the new position's
              first quantum. Both steps stop and restart from 0 with the metronome on and record
              the engine's output (a tap on its destination connect). The <strong>control</strong>{" "}
              stops between clicks; the <strong>stale</strong> step stops as the position crosses
              beat 2 so the transport halts inside that click, and compares the restart's first
              0.5 ms with the interrupted click's own level. A click starting from silence ramps
              for 2 ms, so 0.5 ms in it sits under a third of that level; a stale body resumes at
              its release level, 80 % or more when cut within 12 ms — and any 0.5 ms window of the
              440 Hz beat click sees at least 64 % of the sine's peak whatever its phase.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex direction="column" gap="2">
              <Text size="2">
                <strong>Protocol</strong>: {BPM} BPM, metronome on, default monophonic mode (the new
                click fades the stale one over 5 ms — it still hits full level at the restart).
                Position ticks per animation frame and the stop command round-trips through the
                worklet, so the stale step sends its stop with a lead before the beat and confirms
                from the recording that the click was cut early in its body, adapting the lead
                over up to {STALE_ATTEMPTS} attempts.
              </Text>
              <Flex gap="2" align="center" wrap="wrap">
                <Text size="2" color="gray">Status:</Text>
                <Badge color={status.startsWith("Error") ? "red" : ready ? "green" : "amber"}>{status}</Badge>
                {running !== null && <Badge color="amber">Running step {running}…</Badge>}
                {verdict !== null && (
                  <Badge size="2" color={verdict === "BUG PRESENT" ? "red" : verdict === "FIXED" ? "green" : "amber"}>
                    {verdict}
                  </Badge>
                )}
                {audioContext && <Badge color="gray">{audioContext.sampleRate} Hz</Badge>}
              </Flex>
            </Flex>
          </Card>

          <TestStep
            index={1}
            title="Control: stop between clicks, restart"
            description={
              <>
                Play from 0, stop a quarter beat after the beat-2 click (its body is over), restart
                from 0. The restart's first half millisecond is the new downbeat's own attack ramp.
              </>
            }
            actions={runButton("Run control", runControl)}
            expected={[
              { label: "outcome", value: "OK" },
              { label: "cut click body before the stop", value: "≥ 40 ms (the last click ran its full body)" },
              { label: `restart head ratio (first ${HEAD_WINDOW_MS} ms / interrupted click's level)`, value: `≤ ${CLEAN_HEAD_RATIO_MAX}` },
            ]}
            got={gotByStep[1] ?? null}
          />

          <TestStep
            index={2}
            title="Stale: stop inside a click, restart"
            description={
              <>
                Play from 0, send the stop a little before beat 2 so the transport halts inside
                that click (the lead starts at {STALE_LEAD_START_MS} ms and adapts from each
                attempt's recording until the click is cut {CUT_BODY_MIN_MS}–{CUT_BODY_MAX_MS} ms in),
                restart from 0. With
                the defect the stale click's body resumes at its release level under the new
                downbeat; on a fixed engine the restart reads like the control.
              </>
            }
            actions={runButton("Run stale-click step", runStale)}
            expected={[
              { label: "outcome", value: "OK" },
              { label: "cut click body before the stop", value: `${CUT_BODY_MIN_MS}–${CUT_BODY_MAX_MS} ms (attack complete, stopped early in the body; the lead adapts otherwise)` },
              { label: `restart head ratio (first ${HEAD_WINDOW_MS} ms / interrupted click's level)`, value: `≥ ${STALE_HEAD_RATIO_MIN} while the defect is present (BUG PRESENT); ≤ ${CLEAN_HEAD_RATIO_MAX} once fixed` },
            ]}
            got={gotByStep[2] ?? null}
          />
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
