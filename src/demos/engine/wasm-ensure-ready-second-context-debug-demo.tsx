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
import { ensureWasmReady, setWasmEnabled } from "@/lib/wasmEngine";
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
// A hung await is indistinguishable from a slow one except by ceiling; the TS
// control completes in well under this, so a 15 s timeout is a safe verdict.
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
  const [engineActive, setEngineActive] = useState<"wasm" | "ts">("ts");
  const [engineFellBack, setEngineFellBack] = useState(false);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        // initializeOpenDAW now boots the WASM (Rust) engine centrally (or throws) —
        // the live engine is always WASM here. Step 2's FIRST offline run is still the
        // first-ever ensureReady call for its own OfflineAudioContext, so it still works;
        // later runs (or steps 3/4) still exercise the second-context registration bug
        // on THEIR contexts, independent of the live engine's boot.
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;
        setEngineActive("wasm");
        setEngineFellBack(false);

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

  // Manual OfflineAudioContext render, shared by steps 1 and 2. The wasm flag
  // is what differs: step 2 registers the WASM processor module on the offline
  // context first, so EngineWorklet boots the WASM variant.
  const manualOfflineRender = useCallback(
    async (stage: (s: string) => void, wasm: boolean): Promise<string> => {
      if (!project) throw new Error("no project");
      setWasmEnabled(wasm);
      const projectCopy = project.copy();
      try {
        stage("copy");
        const context = new OfflineAudioContext(2, numSamples, SAMPLE_RATE);
        if (wasm) {
          const ok = await ensureWasmReady(context);
          stage(`ensureWasmReady=${ok}`);
        }
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

  const runStep1 = useCallback(
    () => void runStep(1, (stage) => manualOfflineRender(stage, false)),
    [runStep, manualOfflineRender]
  );

  const runStep2 = useCallback(
    () => void runStep(2, (stage) => manualOfflineRender(stage, true)),
    [runStep, manualOfflineRender]
  );

  const runStep3 = useCallback(
    () =>
      void runStep(3, async (stage) => {
        if (!project) throw new Error("no project");
        setWasmEnabled(true);
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
        setWasmEnabled(true);
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
              ready for that very context. Step 2 demonstrates it: the first run on a fresh
              page works, the second run (new OfflineAudioContext) throws. Load with{" "}
              <Code>?engine=wasm</Code> and even the first run throws — the live engine boot
              consumed the one-and-only registration. The deprecated but still-exported{" "}
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
              <Badge color={engineFellBack ? "red" : engineActive === "wasm" ? "purple" : "gray"}>
                Live engine:{" "}
                {engineFellBack
                  ? "WASM unavailable — using TypeScript"
                  : engineActive === "wasm"
                    ? "WASM (Rust)"
                    : "TypeScript"}
              </Badge>
            </Flex>
          </Card>

          <TestStep
            index={1}
            title="Control: TS engine renders the slice"
            description={
              <>
                <Code>setWasmEnabled(false)</Code>, then the manual pattern on a 2 s slice.
                Establishes that the project, the pattern, and the timeout harness are all
                sound.
              </>
            }
            actions={runButton("Run (TS engine)", runStep1)}
            expected={[
              { label: "outcome", value: "OK (well under the ceiling)" },
              { label: "stages reached", value: "copy → … → rendered" },
              { label: "detail", value: `${numSamples} frames, peak ≈ 0.5` },
            ]}
            got={gotByStep[1] ?? null}
          />

          <TestStep
            index={2}
            title="WASM variant on an OfflineAudioContext — run it twice"
            description={
              <>
                Same pattern, but <Code>ensureWasmReady(offlineCtx)</Code> first, so{" "}
                <Code>createEngine</Code> boots the WASM variant.{" "}
                <strong>Run this twice on a fresh page load (TypeScript live engine):</strong>{" "}
                the first run is the first-ever <Code>ensureReady</Code> call, registers the
                processor on its context, and renders fine; the second run gets a{" "}
                <em>new</em> OfflineAudioContext, <Code>ensureWasmReady</Code> short-circuits
                to <Code>true</Code> without registering, and <Code>createEngine</Code>{" "}
                throws. With <Code>?engine=wasm</Code> the live boot already consumed the
                registration, so even the first run throws.
              </>
            }
            actions={runButton("Run (WASM variant)", runStep2)}
            expected={[
              { label: "outcome", value: "1st run on fresh page: OK · any later run (or with ?engine=wasm): THREW" },
              { label: "stages reached", value: "OK run: … → rendered · THREW run: … → ensureWasmReady=true → worklets" },
              { label: "detail", value: "THREW run: InvalidStateError — 'engine-wasm-processor' is not defined in AudioWorkletGlobalScope" },
            ]}
            got={gotByStep[2] ?? null}
          />

          <TestStep
            index={3}
            title="Public API: deprecated AudioOfflineRenderer.start with WASM enabled"
            description={
              <>
                The wasm modules are compiled globally (as they are after any live WASM boot),
                the flag is on, and the consumer calls the deprecated-but-exported{" "}
                <Code>AudioOfflineRenderer.start</Code>. Its internal OfflineAudioContext is a
                second context — <Code>ensureReady</Code>'s one-and-only registration went
                elsewhere — so the same <Code>InvalidStateError</Code> surfaces through a
                public API. (Note: this step compiles the global modules, so running it
                BEFORE step 2 pre-arms the bug and makes step 2's first run throw too.)
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
Live engine:    TypeScript by default; ?engine=wasm boots a live WASM engine
                (consumes ensureReady's one-and-only registration, so step 2
                throws on its first run)`}
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
