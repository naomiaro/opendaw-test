import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID, Option } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import {
  Project,
  AudioWorklets,
  AudioOfflineRenderer,
  OfflineEngineRenderer,
} from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { TestStep, TestStepRow } from "@/components/TestStep";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile } from "@/lib/audioUtils";
import { ensureWasmReady } from "@/lib/wasmEngine";
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

// Repro for `debug/wasm-ensure-ready-second-context.md`.
//
// `WasmEngine.ensureReady(context)` registers the wasm processor module only
// on the FIRST BaseAudioContext it is ever called with — once the modules are
// compiled it short-circuits (`if (modules.nonEmpty()) return true`) WITHOUT
// calling `context.audioWorklet.addModule(...)` for the new context. Booting
// a WASM EngineWorklet on any SECOND context therefore throws
// `InvalidStateError: The node name 'engine-wasm-processor' is not defined in
// AudioWorkletGlobalScope` — after ensureReady reported `true` for that very
// context. The deprecated — but still exported — `AudioOfflineRenderer.start`
// hits the same wall (its internal OfflineAudioContext is never registered).
// `OfflineEngineRenderer` with `variant: true` (a dedicated Worker that
// self-loads the wasm artifacts) is immune.
//
// Each step reports the last stage reached, the outcome (OK / HUNG / THREW),
// elapsed wall time, and — for successful renders — frames + peak amplitude
// to prove the output is real signal, not silence.
const BPM = 120;
const AUDIO_FILE = "/audio/test-440hz.wav";
const REGION_SECONDS = 2;
const SAMPLE_RATE = 48000;
// A hung await is indistinguishable from a slow one except by ceiling; every
// step below settles (OK or THREW) well under this, so a 15 s timeout is a
// safe verdict.
const HANG_TIMEOUT_MS = 15_000;

type Outcome = "OK" | "HUNG" | "THREW";

interface RunReport {
  outcome: Outcome;
  stages: string;
  elapsedMs: number;
  detail: string;
}

class HangError extends Error {
  constructor(readonly lastStage: string, timeoutMs: number) {
    super(`hung: no settle within ${timeoutMs / 1000}s (last stage: ${lastStage})`);
  }
}

/** Race a promise against the hang ceiling; report the last stage on timeout. */
function raceHang<T>(promise: Promise<T>, stages: () => string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new HangError(stages(), HANG_TIMEOUT_MS)),
      HANG_TIMEOUT_MS
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function peakOf(channel: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < channel.length; i++) {
    const abs = Math.abs(channel[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

function reportRows(report: RunReport): TestStepRow[] {
  return [
    { label: "outcome", value: report.outcome },
    { label: "stages reached", value: report.stages },
    { label: "elapsed", value: `${(report.elapsedMs / 1000).toFixed(2)} s` },
    { label: "detail", value: report.detail },
  ];
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [gotByStep, setGotByStep] = useState<Record<number, TestStepRow[]>>({});
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        // initializeOpenDAW boots the live WASM (Rust) engine centrally (or throws) —
        // its AudioContext is the FIRST context WasmEngine.ensureReady ever sees, so it
        // consumes the one-and-only processor registration right here. Every step below
        // that builds its own context (step 2's OfflineAudioContext, step 3's throwaway
        // + AudioOfflineRenderer's internal context) is therefore always a SECOND
        // context — the bug reproduces on the first click, not just later ones.
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;

        setStatus("Loading test-440hz.wav...");
        const audioBuffer = await loadAudioFile(newAudioContext, AUDIO_FILE);
        if (!mounted) return;

        const bpm = newProject.timelineBox.bpm.getValue();
        const regionPPQN = Math.round(PPQN.secondsToPulses(REGION_SECONDS, bpm));
        const fullDurationPPQN = PPQN.secondsToPulses(audioBuffer.duration, bpm);
        const fileUuid = UUID.generate();
        localAudioBuffersRef.current.set(UUID.toString(fileUuid), audioBuffer);

        newProject.editing.modify(() => {
          const { trackBox } = newProject.api.createInstrument(InstrumentFactories.Tape);
          const fileBox = AudioFileBox.create(newProject.boxGraph, fileUuid, (box) => {
            box.fileName.setValue("test-440hz.wav");
            box.endInSeconds.setValue(audioBuffer.duration);
          });
          const events = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
          AudioRegionBox.create(newProject.boxGraph, UUID.generate(), (box) => {
            box.regions.refer(trackBox.regions);
            box.file.refer(fileBox);
            box.events.refer(events.owners);
            box.position.setValue(0);
            box.duration.setValue(regionPPQN);
            box.loopOffset.setValue(0);
            box.loopDuration.setValue(fullDurationPPQN);
            box.label.setValue("2 s sine");
          });
          // AudioOfflineRenderer.start renders [0, timelineBox.durationInPulses]
          // — pin it to the region so the deprecated-path render stays small.
          newProject.timelineBox.durationInPulses.setValue(regionPPQN);
        });

        setProject(newProject);
        setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${String(error)}`);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const runStep = useCallback(
    async (stepIndex: number, body: (stage: (s: string) => void) => Promise<string>) => {
      if (!project || running !== null) return;
      setRunning(stepIndex);
      setGotByStep((prev) => {
        const next = { ...prev };
        delete next[stepIndex];
        return next;
      });
      const stages: string[] = [];
      const stage = (s: string) => { stages.push(s); };
      const startedAt = performance.now();
      let report: RunReport;
      try {
        const detail = await raceHang(
          body(stage),
          () => stages[stages.length - 1] ?? "(none)"
        );
        report = {
          outcome: "OK",
          stages: stages.join(" → "),
          elapsedMs: performance.now() - startedAt,
          detail,
        };
      } catch (error) {
        console.error(`step ${stepIndex} failed:`, error);
        report = {
          outcome: error instanceof HangError ? "HUNG" : "THREW",
          stages: stages.join(" → "),
          elapsedMs: performance.now() - startedAt,
          detail: String(error),
        };
      } finally {
        setRunning(null);
      }
      setGotByStep((prev) => ({ ...prev, [stepIndex]: reportRows(report) }));
    },
    [project, running]
  );

  const numSamples = REGION_SECONDS * SAMPLE_RATE;

  // Manual OfflineAudioContext render used by step 2. Registers the WASM processor
  // module on the offline context first, so EngineWorklet boots the WASM variant —
  // and throws, since the live engine's boot already consumed the one-and-only
  // registration on a different context (see the init comment above).
  const manualOfflineRender = useCallback(
    async (stage: (s: string) => void): Promise<string> => {
      if (!project) throw new Error("no project");
      const projectCopy = project.copy();
      try {
        stage("copy");
        const context = new OfflineAudioContext(2, numSamples, SAMPLE_RATE);
        const ok = await ensureWasmReady(context);
        stage(`ensureWasmReady=${ok}`);
        const worklets = await AudioWorklets.createFor(context);
        stage("worklets");
        const engineWorklet = worklets.createEngine({ project: projectCopy });
        engineWorklet.connect(context.destination, 0);
        engineWorklet.setPosition(0);
        stage("engine created");
        stage("awaiting isReady");
        await engineWorklet.isReady();
        stage("isReady");
        engineWorklet.play();
        while (!(await engineWorklet.queryLoadingComplete())) {
          await new Promise((r) => setTimeout(r, 100));
        }
        stage("loading complete");
        const buffer = await context.startRendering();
        stage("rendered");
        const peak = peakOf(buffer.getChannelData(0));
        return `${buffer.length} frames, peak |sample| = ${peak.toFixed(4)}`;
      } finally {
        projectCopy.terminate();
      }
    },
    [project, numSamples]
  );

  const runStep2 = useCallback(
    () => void runStep(2, (stage) => manualOfflineRender(stage)),
    [runStep, manualOfflineRender]
  );

  const runStep3 = useCallback(
    () =>
      void runStep(3, async (stage) => {
        if (!project) throw new Error("no project");
        // Compile the wasm modules globally (throwaway context) WITHOUT
        // registering them on the context AudioOfflineRenderer creates
        // internally — exactly the state a consumer is in after booting the
        // live WASM engine and then calling the deprecated export API.
        const throwaway = new OfflineAudioContext(2, 128, SAMPLE_RATE);
        const ok = await ensureWasmReady(throwaway);
        stage(`ensureWasmReady(throwaway)=${ok}`);
        stage("awaiting AudioOfflineRenderer.start");
        const buffer = await AudioOfflineRenderer.start(project, Option.None, () => {});
        stage("rendered");
        const peak = peakOf(buffer.getChannelData(0));
        return `${buffer.length} frames, peak |sample| = ${peak.toFixed(4)}`;
      }),
    [runStep, project]
  );

  const runStep4 = useCallback(
    () =>
      void runStep(4, async (stage) => {
        if (!project) throw new Error("no project");
        const projectCopy = project.copy();
        try {
          stage("copy");
          const renderer = await OfflineEngineRenderer.create(
            projectCopy,
            Option.None,
            SAMPLE_RATE,
            true
          );
          stage("renderer created");
          try {
            renderer.setPosition(0);
            await renderer.play();
            await renderer.waitForLoading();
            stage("loading complete");
            const channels = await renderer.step(numSamples);
            stage("stepped");
            const peak = peakOf(channels[0]);
            return `${channels[0].length} frames, peak |sample| = ${peak.toFixed(4)}`;
          } finally {
            try { renderer.stop(); } catch (e) { console.error("renderer.stop() failed: " + String(e)); }
            try { renderer.terminate(); } catch (e) { console.error("renderer.terminate() failed: " + String(e)); }
          }
        } finally {
          projectCopy.terminate();
        }
      }),
    [runStep, project, numSamples]
  );

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
            {
              label: "WASM engine demo",
              href: "/wasm-engine-demo.html",
              kind: "demo",
            },
            {
              label: "debug/wasm-ensure-ready-second-context.md",
              href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/wasm-ensure-ready-second-context.md",
              kind: "note",
            },
            {
              label: "Upstream issue: openDAW#315",
              href: "https://github.com/andremichelle/openDAW/issues/315",
              kind: "note",
            },
          ]}
        />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            WasmEngine.ensureReady: Second-Context Registration Bug
          </Heading>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              <Code>WasmEngine.ensureReady(context)</Code> registers the wasm processor module
              only on the <strong>first</strong> context it is ever called with — once the
              modules are compiled it returns <Code>true</Code> without calling{" "}
              <Code>addModule</Code> on the new context (
              <Code>if (modules.nonEmpty()) return true</Code> in{" "}
              <Code>WasmEngine.ensureReady</Code>). Booting a WASM{" "}
              <Code>EngineWorklet</Code> on any <em>second</em> BaseAudioContext then throws{" "}
              <Code>InvalidStateError: 'engine-wasm-processor' is not defined in
              AudioWorkletGlobalScope</Code> — right after <Code>ensureReady</Code> reported
              ready for that very context. Step 2 demonstrates it: this page always boots a
              live WASM engine on init, which consumes the one-and-only registration on its
              own AudioContext, so step 2's OfflineAudioContext is already a{" "}
              <em>second</em> context — it throws on every run, including the first. The
              deprecated but still-exported{" "}
              <Code>AudioOfflineRenderer.start</Code> hits the same wall;{" "}
              <Code>OfflineEngineRenderer</Code> (<Code>variant: true</Code>, a Worker) is
              immune. Each step is bounded by a {HANG_TIMEOUT_MS / 1000} s ceiling.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">Status:</Text>
              <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
                {status}
              </Badge>
              {running !== null && <Badge color="amber">Running step {running}…</Badge>}
              <Badge color="amber" size="2">WASM (Rust)</Badge>
            </Flex>
          </Card>

          <TestStep
            index={2}
            title="WASM variant on an OfflineAudioContext"
            description={
              <>
                <Code>ensureWasmReady(offlineCtx)</Code> first, so <Code>createEngine</Code>{" "}
                boots the WASM variant. The live engine booted during page init already
                registered the wasm processor on its own AudioContext — the one-and-only
                registration <Code>WasmEngine.ensureReady</Code> ever grants — so this
                OfflineAudioContext is always a <em>second</em> context:{" "}
                <Code>ensureWasmReady</Code> short-circuits to <Code>true</Code> without
                registering, and <Code>createEngine</Code> throws. This reproduces on every
                click, including the very first.
              </>
            }
            actions={runButton("Run (WASM variant)", runStep2)}
            expected={[
              {
                label: "outcome",
                value:
                  "THREW on every run — the live WASM boot consumed the one-and-only processor registration (ensureWasmReady still returns true)",
              },
              { label: "stages reached", value: "copy → ensureWasmReady=true → worklets" },
              { label: "detail", value: "InvalidStateError — 'engine-wasm-processor' is not defined in AudioWorkletGlobalScope" },
            ]}
            got={gotByStep[2] ?? null}
          />

          <TestStep
            index={3}
            title="Public API: deprecated AudioOfflineRenderer.start with WASM enabled"
            description={
              <>
                The wasm modules are compiled globally (as they always are after the live
                WASM boot at page init), and the consumer calls the deprecated-but-exported{" "}
                <Code>AudioOfflineRenderer.start</Code>. Its internal OfflineAudioContext is a
                second context — <Code>ensureReady</Code>'s one-and-only registration went
                elsewhere — so the same <Code>InvalidStateError</Code> surfaces through a
                public API.
              </>
            }
            actions={runButton("Run (deprecated API)", runStep3)}
            expected={[
              { label: "outcome", value: "THREW" },
              { label: "stages reached", value: "… → awaiting AudioOfflineRenderer.start" },
              { label: "detail", value: "InvalidStateError — 'engine-wasm-processor' is not defined in AudioWorkletGlobalScope" },
            ]}
            got={gotByStep[3] ?? null}
          />

          <TestStep
            index={4}
            title="Workaround: OfflineEngineRenderer with variant: true"
            description={
              <>
                The supported WASM offline path — a dedicated Worker that self-loads the wasm
                artifacts, so <Code>ensureReady</Code>'s registration bookkeeping never
                applies. <Code>create → setPosition → play → waitForLoading → step</Code>.
                Works regardless of how many engines booted before it.
              </>
            }
            actions={runButton("Run (OfflineEngineRenderer)", runStep4)}
            expected={[
              { label: "outcome", value: "OK" },
              { label: "stages reached", value: "copy → renderer created → loading complete → stepped" },
              { label: "detail", value: `${numSamples} frames, peak ≈ 0.5` },
            ]}
            got={gotByStep[4] ?? null}
          />

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>Configuration</Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6 }}>
              {`BPM:            ${BPM}
File:           test-440hz.wav (60 s, 440 Hz sine), one 2 s region on one Tape track
Render:         ${REGION_SECONDS} s at ${SAMPLE_RATE} Hz = ${numSamples} frames
Hang ceiling:   ${HANG_TIMEOUT_MS / 1000} s
Live engine:    WASM (always — the only engine)
                (its boot consumes ensureReady's one-and-only registration,
                so step 2 throws on its first run)`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
