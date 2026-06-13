import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import type {
  SampleLoader,
  AudioRegionBoxAdapter,
} from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN } from "@opendaw/lib-dsp";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { useAudioDevicePermission } from "@/hooks/useAudioDevicePermission";
import { useRecordingTapes } from "@/hooks/useRecordingTapes";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Flex, Text, Button, Card, Badge } from "@radix-ui/themes";

/*
 * Unlisted debug repro for the recording-finalization "no terminal state" flake.
 *
 * Symptom (observed on loop-recording-demo): the first record→stop cycle in a
 * fresh browser sometimes leaves the RecordingWorklet loader in state
 * {type: "record"} forever — no "loaded", no "error". Subsequent Play hangs.
 *
 * Mechanism candidate (studio-core 0.0.152, re-verified against the installed
 * dist): on stop, RecordAudio calls `recordingWorklet.limit(ceil((waveformOffset
 * + duration) * sampleRate))`. `limit()` only calls `#finalize()` when
 * `numberOfFrames >= limitSamples` AT THAT INSTANT; otherwise it waits for the
 * RingBuffer reader to drain more frames — but the source node is already
 * disconnected, so those frames may never arrive. `#finalize()` is the ONLY
 * path that sets {type: "loaded"}, and its rejections are swallowed by
 * `.catch(console.warn)`. There is no {type: "error"} terminal state anywhere.
 *
 * This page mirrors loop-recording's config (loop 0→2 bars, takes, metronome,
 * count-in), records one cycle, then polls `loader.state.type` and
 * `loader.numberOfFrames` through finalization while intercepting the SDK's own
 * console output. The verdict (FINALIZED / STUCK / ERROR) plus the raw numbers
 * are written to `window.__finalizeDebug` so a Playwright fresh-context loop can
 * fish for the first-cycle race.
 */

const BAR_PPQN = PPQN.Quarter * 4; // one bar in 4/4
const LOOP_LENGTH_BARS = 2;
const DEBUG_FINALIZE_TIMEOUT_MS = 8_000; // shorter than the 30s prod barrier — verdict shows fast
const POLL_INTERVAL_MS = 100;
// Count-in is 1 bar @ 120bpm = 2.0s; record well past it so a take region is
// actually created (otherwise RecordAudio takes the abort path — no loader, no
// finalize — which is NOT the flake).
const AUTO_CYCLE_RECORD_MS = 4_000;

type Verdict = "FINALIZED" | "STUCK" | "ERROR" | null;

interface LogEntry {
  tMs: number;
  kind: string;
  text: string;
}

interface FinalizeResult {
  verdict: Exclude<Verdict, null>;
  elapsedMs: number;
  numberOfFrames: number | null;
  limitSamples: number | null;
  deficit: number | null;
  sawWarn: boolean;
  stopPayload: unknown;
}

// SampleLoader doesn't declare numberOfFrames, but the RecordingWorklet (the
// loader during recording) does. Read it defensively.
function readNumberOfFrames(loader: SampleLoader | null): number | null {
  const n = (loader as unknown as { numberOfFrames?: unknown })?.numberOfFrames;
  return typeof n === "number" ? n : null;
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === "string") return arg;
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [phase, setPhase] = useState<"idle" | "recording" | "finalizing" | "done">("idle");
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [result, setResult] = useState<FinalizeResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [tapeArmed, setTapeArmed] = useState(false);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [liveReadout, setLiveReadout] = useState("");

  const { audioInputDevices, hasPermission, requestPermission } =
    useAudioDevicePermission();
  const { recordingTapes, addTape } = useRecordingTapes({
    project,
    audioInputDevices,
    maxTapes: 1,
  });

  // --- Instrumentation refs ---
  const recordT0Ref = useRef<number>(0);
  const loaderRef = useRef<SampleLoader | null>(null);
  const regionAdapterRef = useRef<AudioRegionBoxAdapter | null>(null);
  const discoverySubsRef = useRef<Terminable[]>([]);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchActiveRef = useRef<boolean>(false);
  const finalizeStartRef = useRef<number>(0);
  const sawWarnRef = useRef<boolean>(false);
  const stopPayloadRef = useRef<unknown>(null);
  const lastPollKeyRef = useRef<string>("");
  const lastLiveUpdateRef = useRef<number>(0);

  const appendLog = useCallback((kind: string, text: string) => {
    const tMs = recordT0Ref.current ? performance.now() - recordT0Ref.current : 0;
    setLog((prev) => [...prev, { tMs, kind, text }]);
  }, []);

  // --- Intercept the SDK's console output (proven probe per debug/README) ---
  useEffect(() => {
    const orig = {
      debug: console.debug,
      warn: console.warn,
      error: console.error,
    };
    const make =
      (level: "debug" | "warn" | "error") =>
      (...args: unknown[]) => {
        orig[level](...args);
        // Capture the RecordAudio stop payload: it carries duration +
        // numberOfFrames at the exact moment limit() is called.
        if (args[0] === "[RecordAudio] stop" && typeof args[1] === "object") {
          stopPayloadRef.current = args[1];
        }
        if (level === "warn" || level === "error") sawWarnRef.current = true;
        // Debug is noisy — keep only the SDK's RecordAudio breadcrumbs.
        if (
          level === "debug" &&
          !(typeof args[0] === "string" && args[0].startsWith("[RecordAudio]"))
        ) {
          return;
        }
        appendLog(level, args.map(stringifyArg).join(" "));
      };
    console.debug = make("debug");
    console.warn = make("warn");
    console.error = make("error");
    return () => {
      console.debug = orig.debug;
      console.warn = orig.warn;
      console.error = orig.error;
    };
  }, [appendLog]);

  // --- Initialize OpenDAW, mirroring loop-recording config ---
  useEffect(() => {
    let mounted = true;
    const subs: Terminable[] = [];

    (async () => {
      try {
        const { project: newProject, audioContext: ctx } =
          await initializeOpenDAW({ onStatusUpdate: setStatus });
        if (!mounted) return;

        setAudioContext(ctx);
        setProject(newProject);
        setStatus("Ready!");

        newProject.editing.modify(() => {
          newProject.timelineBox.bpm.setValue(120);
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(BAR_PPQN * LOOP_LENGTH_BARS);
          newProject.timelineBox.loopArea.enabled.setValue(true);
        });

        const settings = newProject.engine.preferences.settings;
        settings.recording.allowTakes = true;
        settings.recording.olderTakeAction = "mute-region";
        settings.recording.olderTakeScope = "previous-only";
        settings.recording.countInBars = 1;
        settings.metronome.enabled = true;

        subs.push(
          newProject.engine.isRecording.catchupAndSubscribe((obs) => {
            if (mounted) setIsRecording(obs.getValue());
          })
        );
        subs.push(
          newProject.engine.isCountingIn.catchupAndSubscribe((obs) => {
            if (mounted) setIsCountingIn(obs.getValue());
          })
        );
      } catch (error) {
        console.error("Init error:", error);
        if (mounted)
          setInitError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      mounted = false;
      subs.forEach((s) => s.terminate());
    };
  }, []);

  // --- Discover the RecordingWorklet loader while recording ---
  useEffect(() => {
    if (!project || !isRecording || recordingTapes.length === 0) return;

    const subs: Terminable[] = [];
    const tape = recordingTapes[0];
    const audioUnitAdapter = project.rootBoxAdapter.audioUnits
      .adapters()
      .find((au) => au.box === tape.capture.audioUnitBox);

    if (audioUnitAdapter) {
      const tracksSub = audioUnitAdapter.tracks.catchupAndSubscribe({
        onAdd: (trackAdapter) => {
          const regionsSub = trackAdapter.regions.catchupAndSubscribe({
            onAdded: (regionAdapter) => {
              if (!regionAdapter.isAudioRegion()) return;
              if (!regionAdapter.label.startsWith("Take ")) return;
              if (loaderRef.current) return; // first take only
              loaderRef.current = regionAdapter.file.getOrCreateLoader();
              regionAdapterRef.current = regionAdapter;
              appendLog("page", `discovered loader for ${regionAdapter.label}`);
            },
            onRemoved: () => {},
          });
          subs.push(regionsSub);
        },
        onRemove: () => {},
        onReorder: () => {},
      });
      subs.push(tracksSub);
    }

    discoverySubsRef.current = subs;
    return () => {
      subs.forEach((s) => s.terminate());
      discoverySubsRef.current = [];
    };
  }, [project, isRecording, recordingTapes, appendLog]);

  // --- Live readout of loader.numberOfFrames + state while recording ---
  useEffect(() => {
    if (!project) return;
    const frame = AnimationFrame.add(() => {
      const loader = loaderRef.current;
      if (!loader) return;
      const now = performance.now();
      if (now - lastLiveUpdateRef.current < 150) return;
      lastLiveUpdateRef.current = now;
      const nf = readNumberOfFrames(loader);
      setLiveReadout(`state=${loader.state.type} numberOfFrames=${nf ?? "?"}`);
    });
    return () => frame.terminate();
  }, [project]);

  const armTape = useCallback(async () => {
    if (!project) return;
    if (!hasPermission) await requestPermission();
    if (recordingTapes.length === 0) addTape(); // addTape() auto-arms the capture
    setTapeArmed(true);
  }, [project, hasPermission, requestPermission, recordingTapes.length, addTape]);

  const finishWatch = useCallback(
    (v: Exclude<Verdict, null>) => {
      if (!watchActiveRef.current) return; // idempotent — only the first call wins
      watchActiveRef.current = false;
      if (pollTimerRef.current !== null) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      const elapsedMs = performance.now() - finalizeStartRef.current;
      const loader = loaderRef.current;
      const numberOfFrames = readNumberOfFrames(loader);

      let limitSamples: number | null = null;
      let deficit: number | null = null;
      const region = regionAdapterRef.current;
      if (region && audioContext) {
        const waveformOffset = region.waveformOffset.getValue();
        const duration = region.box.duration.getValue();
        limitSamples = Math.ceil(
          (waveformOffset + duration) * audioContext.sampleRate
        );
        if (numberOfFrames !== null) deficit = limitSamples - numberOfFrames;
      }

      const res: FinalizeResult = {
        verdict: v,
        elapsedMs: Math.round(elapsedMs),
        numberOfFrames,
        limitSamples,
        deficit,
        sawWarn: sawWarnRef.current,
        stopPayload: stopPayloadRef.current,
      };
      setVerdict(v);
      setResult(res);
      setPhase("done");
      appendLog(
        "verdict",
        `${v} after ${res.elapsedMs}ms — numberOfFrames=${numberOfFrames} ` +
          `limitSamples=${limitSamples} deficit=${deficit} sawWarn=${res.sawWarn}`
      );

      // Expose for the Playwright fresh-context fishing loop.
      (window as unknown as { __finalizeDebug?: FinalizeResult }).__finalizeDebug =
        res;

      // Reset the engine like the production barrier does after a terminal/timeout.
      project?.engine.stop(true);
    },
    [project, audioContext, appendLog]
  );

  const beginFinalizationWatch = useCallback(() => {
    finalizeStartRef.current = performance.now();
    lastPollKeyRef.current = "";
    watchActiveRef.current = true;
    setPhase("finalizing");
    appendLog("page", "stopRecording() called — watching loader state");

    pollTimerRef.current = setInterval(() => {
      if (!watchActiveRef.current) return;
      const loader = loaderRef.current;
      if (!loader) {
        if (performance.now() - finalizeStartRef.current > DEBUG_FINALIZE_TIMEOUT_MS) {
          appendLog("page", "no loader was ever discovered");
          finishWatch("STUCK");
        }
        return;
      }
      const st = loader.state.type;
      const nf = readNumberOfFrames(loader);
      const key = `${st}:${nf}`;
      // Log on change, else a ~1s heartbeat — enough to prove state stays "record".
      const elapsed = performance.now() - finalizeStartRef.current;
      if (key !== lastPollKeyRef.current || elapsed % 1000 < POLL_INTERVAL_MS) {
        lastPollKeyRef.current = key;
        appendLog("poll", `t+${Math.round(elapsed)}ms state=${st} numberOfFrames=${nf}`);
      }
      if (st === "loaded") finishWatch("FINALIZED");
      else if (st === "error") finishWatch("ERROR");
      else if (elapsed > DEBUG_FINALIZE_TIMEOUT_MS) finishWatch("STUCK");
    }, POLL_INTERVAL_MS);
  }, [appendLog, finishWatch]);

  const startRecording = useCallback(async () => {
    if (!project || !audioContext || !tapeArmed) return;
    // Fresh state for this cycle
    loaderRef.current = null;
    regionAdapterRef.current = null;
    sawWarnRef.current = false;
    stopPayloadRef.current = null;
    setVerdict(null);
    setResult(null);
    setLog([]);
    recordT0Ref.current = performance.now();

    if (audioContext.state === "suspended") await audioContext.resume();
    setPhase("recording");
    appendLog("page", "startRecording(useCountIn=true)");
    project.engine.setPosition(0);
    project.startRecording(true);
  }, [project, audioContext, tapeArmed, appendLog]);

  const stopRecording = useCallback(() => {
    if (!project) return;
    // Terminate discovery subs before stopRecording (loop-demo ordering).
    discoverySubsRef.current.forEach((s) => s.terminate());
    discoverySubsRef.current = [];
    project.engine.stopRecording();
    beginFinalizationWatch();
  }, [project, beginFinalizationWatch]);

  // Deterministic single cycle for the fishing loop: record, then stop after a
  // fixed delay. Exposed on window so Playwright can trigger it per fresh context.
  const runAutoCycle = useCallback(async () => {
    await startRecording();
    window.setTimeout(stopRecording, AUTO_CYCLE_RECORD_MS);
    setAttempts((n) => n + 1);
  }, [startRecording, stopRecording]);

  useEffect(() => {
    (window as unknown as { __runAutoCycle?: () => void }).__runAutoCycle =
      runAutoCycle;
  }, [runAutoCycle]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) clearInterval(pollTimerRef.current);
    };
  }, []);

  const verdictColor =
    verdict === "FINALIZED" ? "green" : verdict === "STUCK" ? "red" : verdict === "ERROR" ? "amber" : "gray";

  return (
    <Theme appearance="dark" accentColor="amber" radius="large">
      <Container size="2" px="4" py="6">
        <Flex direction="column" gap="4" style={{ maxWidth: 760, margin: "0 auto" }}>
          <div>
            <Text size="1" color="gray" style={{ letterSpacing: "0.08em" }}>
              UNLISTED DEBUG · studio-core 0.0.152
            </Text>
            <h1 style={{ margin: "4px 0", fontSize: 26 }}>
              Recording Finalize — no-terminal-state
            </h1>
            <Text size="2" color="gray">
              Mirrors loop-recording (loop 0→2 bars, takes, metronome, count-in).
              Records one cycle, then polls the RecordingWorklet loader through
              finalization. STUCK = state stayed <code>"record"</code> with no
              terminal event. The flake hits the <strong>first cycle in a fresh
              browser context</strong> — re-running in the same session usually
              finalizes (the control), so fish with fresh Playwright contexts.
            </Text>
          </div>

          {initError ? (
            <Card>
              <Text color="red">Initialization failed: {initError}</Text>
            </Card>
          ) : !project ? (
            <Text color="gray">{status}</Text>
          ) : (
            <>
              <Card>
                <Flex direction="column" gap="3">
                  <Flex gap="3" align="center" wrap="wrap">
                    <Button onClick={armTape} disabled={tapeArmed} color="amber" variant="soft">
                      {tapeArmed ? "Tape armed ✓" : "Arm Tape (mic)"}
                    </Button>
                    <Button
                      onClick={startRecording}
                      disabled={!tapeArmed || isRecording || isCountingIn || phase === "finalizing"}
                      color="red"
                    >
                      Record
                    </Button>
                    <Button
                      onClick={stopRecording}
                      disabled={!isRecording}
                      color="gray"
                    >
                      Stop
                    </Button>
                    <Button
                      onClick={runAutoCycle}
                      disabled={!tapeArmed || isRecording || isCountingIn || phase === "finalizing"}
                      variant="outline"
                    >
                      Auto cycle ({AUTO_CYCLE_RECORD_MS / 1000}s)
                    </Button>
                  </Flex>

                  <Flex gap="2" align="center" wrap="wrap">
                    {isCountingIn && <Badge color="amber">Count-in</Badge>}
                    {isRecording && <Badge color="red">Recording</Badge>}
                    {phase === "finalizing" && <Badge color="amber">Finalizing</Badge>}
                    <Badge color="gray">attempts: {attempts}</Badge>
                    {verdict && <Badge color={verdictColor}>{verdict}</Badge>}
                    <Text size="1" color="gray" style={{ fontFamily: "monospace" }}>
                      {liveReadout}
                    </Text>
                  </Flex>

                  {result && (
                    <pre
                      data-testid="finalize-result"
                      style={{
                        margin: 0,
                        fontSize: 12,
                        color: verdict === "STUCK" ? "var(--red-11)" : "var(--gray-11)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  )}
                </Flex>
              </Card>

              <Card>
                <Text size="1" color="gray">Event log (t relative to record start)</Text>
                <pre
                  data-testid="event-log"
                  style={{
                    marginTop: 8,
                    maxHeight: 360,
                    overflow: "auto",
                    fontSize: 11,
                    lineHeight: 1.5,
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {log
                    .map((e) => `[${e.tMs.toFixed(0).padStart(6)}ms] ${e.kind.padEnd(7)} ${e.text}`)
                    .join("\n")}
                </pre>
              </Card>
            </>
          )}
        </Flex>
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
