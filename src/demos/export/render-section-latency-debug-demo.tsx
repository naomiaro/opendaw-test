import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DefaultObservableValue, Option, UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { EffectFactories, OfflineEngineRenderer, type Project } from "@opendaw/studio-core";
import {
  AudioFileBox,
  AudioRegionBox,
  type AudioUnitBox,
  type CompressorDeviceBox,
  type TrackBox,
  ValueEventCollectionBox,
} from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { BackLink } from "@/components/BackLink";
import { TestStep, type TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { audioEffectsFieldOf } from "@/lib/adapterUtils";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { withDeadline } from "@/lib/deadline";
import {
  boundaryInOutput,
  CHUNK_FRAMES,
  findHits,
  jumpIsReadable,
  largestStep,
  measurementProblem,
  predictedDroppedFrames,
  readBaseline,
  readRow,
  toneStep,
  type RowReading,
  type Step,
} from "@/lib/audit/sectionRenderGap";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Callout, Button, Code } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Repro for `debug/2026-11-05-render-section-latency-gap/note.md`.
//
// With `tail: false`, `OfflineEngineRenderer.renderSection` renders in chunks of 375 quanta and says why
// they must be quantum multiples: a step discards the rest of its last quantum. The worker also drops
// the settled delay compensation from the start of the output, so when the latency is not a whole
// number of quanta the first chunk ends part way through one.
//
// Each row renders the section through `renderSection` and in one `step` over the same frames
// (`renderOfflineSlice`, the reference), once with bursts for the shift in frames and once with a tone
// for the jump. Each row's latency is read back from the engine before it renders. One-pass controls that
// must read clean: no latency, whole quanta, a section under one chunk. Two-pass rows are read against
// a no-latency two-pass row of the same length, which must show one shift on every hit.
const SOURCE_RATE = 48000;
// The page's context and every render follow `?rate=`. The renders are offline, so the device rate
// plays no part; each run records it so a note can say so.
const PAGE_RATE = new URLSearchParams(location.search).get("rate") === "44100" ? 44100 : 48000;
// 5 ms of look-ahead, which the Compressor floors and the Maximizer rounds up.
const COMPRESSOR_FRAMES = PAGE_RATE === 44100 ? 220 : 240;
const MAXIMIZER_FRAMES = PAGE_RATE === 44100 ? 221 : 240;
const BPM = 120;
const SOURCE_SECONDS = 4;
const BURST_SECONDS = [0.5, 1.5, 2.5, 3.5];
const BURST_LENGTH_SECONDS = 0.02;
const BURST_HZ = 1000;
// 997 Hz is coprime to both page rates, so no shift of 1..127 frames is exactly in phase. What a join
// moves still depends on the tone's phase there, so a row expects a jump only when `jumpIsReadable`.
const TONE_HZ = 997;
const LEVEL = 0.5;
const HIT_THRESHOLD = 0.05;
const HIT_MIN_GAP_SECONDS = 0.25;
// Keeps the reading on steady tone: a shifted render reads past the region's end, and a two-pass render
// wraps at its start and end. A join at this frame still counts, since the step arrives on it.
const STEP_MARGIN_SECONDS = 0.1;
const RENDER_DEADLINE_MS = 60_000;
const LATENCY_DEADLINE_MS = 5_000;
const LATENCY_POLL_MS = 50;

type Device = "none" | "compressor" | "maximizer" | "fold" | "autotune";
type Host = "playing" | "muted";

interface Scenario {
  id: string;
  label: string;
  device: Device;
  host: Host;
  /** Read from the crates, and checked against what the engine reports before the row renders. */
  latencyFrames: number;
  seconds: number;
  passes: 1 | 2;
  /** Reads the shift the two-pass rows of this length build on. */
  isBaseline?: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  { id: "none", label: "No latent device", device: "none", host: "playing", latencyFrames: 0, seconds: 4, passes: 1 },
  { id: "compressor", label: "Compressor look-ahead on the track", device: "compressor", host: "playing", latencyFrames: COMPRESSOR_FRAMES, seconds: 4, passes: 1 },
  { id: "compressor-muted", label: "Compressor look-ahead on a muted track", device: "compressor", host: "muted", latencyFrames: COMPRESSOR_FRAMES, seconds: 4, passes: 1 },
  { id: "maximizer", label: "Maximizer, default settings, on a muted track", device: "maximizer", host: "muted", latencyFrames: MAXIMIZER_FRAMES, seconds: 4, passes: 1 },
  { id: "fold", label: "Fold on a muted track", device: "fold", host: "muted", latencyFrames: 15, seconds: 4, passes: 1 },
  { id: "autotune", label: "Autotune on a muted track (whole quanta)", device: "autotune", host: "muted", latencyFrames: 1280, seconds: 4, passes: 1 },
  { id: "short", label: "Compressor look-ahead, 0.9 s section", device: "compressor", host: "playing", latencyFrames: COMPRESSOR_FRAMES, seconds: 0.9, passes: 1 },
  { id: "two-passes-none", label: "No latent device, two passes", device: "none", host: "playing", latencyFrames: 0, seconds: 4, passes: 2, isBaseline: true },
  { id: "two-passes-autotune", label: "Autotune on a muted track, two passes (whole quanta)", device: "autotune", host: "muted", latencyFrames: 1280, seconds: 4, passes: 2 },
  { id: "two-passes", label: "Compressor look-ahead, two passes", device: "compressor", host: "playing", latencyFrames: COMPRESSOR_FRAMES, seconds: 4, passes: 2 },
  { id: "two-passes-short-none", label: "No latent device, two passes, 0.9 s section", device: "none", host: "playing", latencyFrames: 0, seconds: 0.9, passes: 2, isBaseline: true },
  { id: "two-passes-short", label: "Compressor look-ahead, two passes, 0.9 s section", device: "compressor", host: "playing", latencyFrames: COMPRESSOR_FRAMES, seconds: 0.9, passes: 2 },
];

// A context left at its default takes the output device's rate; closed at once, it plays nothing.
// Null when it cannot be read: the renders do not depend on it, so it must not cost the run.
const readDeviceRate = async (): Promise<number | null> => {
  try {
    const probe = new AudioContext();
    const rate = probe.sampleRate;
    await withDeadline(probe.close(), LATENCY_DEADLINE_MS, "closing the device-rate probe");
    return rate;
  } catch (error) {
    console.warn("Could not read the device rate: " + String(error));
    return null;
  }
};

interface Row {
  id: string;
  label: string;
  latencyFrames: number;
  reportedLatencyFrames: number;
  predicted: number;
  baseline: number;
  boundaryFrame: number | null;
  jumpReadable: boolean;
  sliceHits: number[];
  sectionHits: number[];
  sliceStep: Step;
  sectionStep: Step;
  reading: RowReading;
}

const framesOf = (scenario: Scenario): number => Math.round(scenario.seconds * PAGE_RATE);
const readableAt = (boundary: number, dropped: number): boolean => jumpIsReadable(LEVEL, TONE_HZ, PAGE_RATE, boundary, dropped);

const sourceBuffer = (context: BaseAudioContext, signal: "hits" | "tone"): AudioBuffer => {
  const length = Math.round(SOURCE_SECONDS * SOURCE_RATE);
  const buffer = context.createBuffer(2, length, SOURCE_RATE);
  const samples = new Float32Array(length);
  if (signal === "tone") {
    for (let i = 0; i < length; i++) samples[i] = LEVEL * Math.sin((2 * Math.PI * TONE_HZ * i) / SOURCE_RATE);
  } else {
    const burstFrames = Math.round(BURST_LENGTH_SECONDS * SOURCE_RATE);
    for (const seconds of BURST_SECONDS) {
      const start = Math.round(seconds * SOURCE_RATE);
      for (let i = 0; i < burstFrames; i++) {
        samples[start + i] = LEVEL * Math.sin((2 * Math.PI * BURST_HZ * i) / SOURCE_RATE) * Math.sin((Math.PI * i) / burstFrames);
      }
    }
  }
  buffer.copyToChannel(samples, 0);
  buffer.copyToChannel(samples, 1);
  return buffer;
};

const JUMP_TEXT: Record<RowReading["jump"], string> = {
  none: "no jump",
  "on-boundary": "jump on the boundary",
  "off-boundary": "JUMP AWAY FROM THE BOUNDARY",
};

const rowText = (row: Row): string => {
  const { earlyBefore, earlyAfter, jump, verdict } = row.reading;
  const list = (values: number[]): string => (values.length > 0 ? values.join(", ") : "none");
  return [
    `${verdict}: latency ${row.reportedLatencyFrames} frames as reported`,
    `early before the boundary ${list(earlyBefore)}, from it on ${list(earlyAfter)} frames`,
    row.baseline === 0 ? `predicted ${row.predicted}` : `predicted ${row.predicted} + ${row.baseline} without latency`,
    `tone step ${row.sectionStep.step.toFixed(3)} at frame ${row.sectionStep.frame} (reference ${row.sliceStep.step.toFixed(3)})`,
    JUMP_TEXT[jump],
  ].join("; ");
};

const expectedText = (scenario: Scenario): string => {
  const latency = `latency ${scenario.latencyFrames} frames`;
  if (scenario.isBaseline) return `${latency}: at most 1 frame early, the same on every hit, the baseline for this length`;
  const frames = framesOf(scenario);
  const predicted = predictedDroppedFrames(scenario.latencyFrames, frames, scenario.passes);
  const boundary = boundaryInOutput(frames, scenario.passes);
  const plusBaseline = scenario.passes === 2 ? ", plus this length's two-pass baseline" : "";
  if (predicted === 0) return `${latency}: no shift of its own, no jump${plusBaseline}`;
  if (boundary === null) return `${latency}: every kept frame ${predicted} early, no jump${plusBaseline}`;
  const jump = readableAt(boundary, predicted) ? "with a jump on it" : "the tone too level across the join to show a jump";
  return `${latency}: ${predicted} frames early from frame ${boundary} on, ${jump}${plusBaseline}`;
};

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [running, setRunning] = useState(false);
  const [auditState, setAuditState] = useState<"loading" | "ready" | "running" | "done" | "error">("loading");
  const [got, setGot] = useState<TestStepRow[] | null>(null);
  const [envelope, setEnvelope] = useState<string>("");
  const unitsRef = useRef<{ hits: AudioUnitBox; tone: AudioUnitBox; holder: AudioUnitBox } | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { project: newProject, audioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          bpm: BPM,
          audioContextSampleRate: PAGE_RATE,
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;
        const durationPpqn = Math.round(PPQN.secondsToPulses(SOURCE_SECONDS, BPM));
        const createTape = (): { audioUnitBox: AudioUnitBox; trackBox: TrackBox } =>
          newProject.editing.modify(() => newProject.api.createInstrument(InstrumentFactories.Tape)).unwrap("tape");
        const place = (signal: "hits" | "tone", trackBox: TrackBox): void => {
          const buffer = sourceBuffer(audioContext, signal);
          const uuid = UUID.generate();
          localAudioBuffersRef.current.set(UUID.toString(uuid), buffer);
          newProject.editing.modify(() => {
            const fileBox = AudioFileBox.create(newProject.boxGraph, uuid, (box) => {
              box.fileName.setValue(`${signal}.wav`);
              box.endInSeconds.setValue(buffer.duration);
            });
            const events = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
            AudioRegionBox.create(newProject.boxGraph, UUID.generate(), (box) => {
              box.regions.refer(trackBox.regions);
              box.file.refer(fileBox);
              box.events.refer(events.owners);
              box.position.setValue(0);
              box.duration.setValue(durationPpqn);
              box.loopOffset.setValue(0);
              box.loopDuration.setValue(durationPpqn);
              box.label.setValue(signal);
            });
          });
        };
        const hits = createTape();
        place("hits", hits.trackBox);
        const tone = createTape();
        place("tone", tone.trackBox);
        const holder = createTape();
        newProject.editing.modify(() => {
          holder.audioUnitBox.mute.setValue(true);
          newProject.timelineBox.loopArea.enabled.setValue(false);
        });
        unitsRef.current = { hits: hits.audioUnitBox, tone: tone.audioUnitBox, holder: holder.audioUnitBox };
        contextRef.current = audioContext;
        setProject(newProject);
        setAuditState("ready");
        setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize: " + String(error));
        if (mounted) {
          setAuditState("error");
          setStatus(`Error: ${String(error)}`);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const insertDevices = useCallback((scenario: Scenario): (() => void) => {
    if (!project || !unitsRef.current) throw new Error("not ready");
    const { hits, tone, holder } = unitsRef.current;
    if (scenario.device === "none") return () => {};
    const hosts = scenario.host === "muted" ? [holder] : [hits, tone];
    const fields = hosts.map((unit) => audioEffectsFieldOf(project, unit));
    const boxes = project.editing
      .modify(() =>
        fields.map((field) => {
          if (scenario.device === "fold") return project.api.insertEffect(field, EffectFactories.AudioNamed.Fold, 0);
          if (scenario.device === "autotune") return project.api.insertEffect(field, EffectFactories.AudioNamed.Autotune, 0);
          if (scenario.device === "maximizer") return project.api.insertEffect(field, EffectFactories.AudioNamed.Maximizer, 0);
          // Settings that apply no gain reduction, so the look-ahead is the only thing it adds.
          const box = project.api.insertEffect(field, EffectFactories.AudioNamed.Compressor, 0) as CompressorDeviceBox;
          box.threshold.setValue(0);
          box.ratio.setValue(1);
          box.knee.setValue(0);
          box.inputgain.setValue(0);
          box.makeup.setValue(0);
          box.automakeup.setValue(false);
          box.mix.setValue(1);
          box.lookahead.setValue(true);
          return box;
        }),
      )
      .unwrap("device");
    return () => project.editing.modify(() => boxes.forEach((box) => box.delete()));
  }, [project]);

  // The page's context runs at the render rate, so the live engine's figure is the render's. A row's
  // whole-quanta control reads the same with its latency present or absent: this is what tells them apart.
  const waitForReportedLatency = useCallback(async (expectedFrames: number): Promise<number> => {
    if (!project) throw new Error("not ready");
    const started = performance.now();
    let frames = NaN;
    while (performance.now() - started < LATENCY_DEADLINE_MS) {
      frames = Math.round(project.engine.compensationLatency.getValue() * PAGE_RATE);
      if (frames === expectedFrames) return frames;
      await new Promise((resolve) => setTimeout(resolve, LATENCY_POLL_MS));
    }
    throw new Error(`the engine reports ${frames} frames of latency, the row expects ${expectedFrames}`);
  }, [project]);

  const renderBoth = useCallback(async (scenario: Scenario): Promise<{ slice: Float32Array; section: Float32Array }> => {
    if (!project) throw new Error("not ready");
    const { channels } = await withDeadline(
      renderOfflineSlice(project, 0, scenario.seconds, PAGE_RATE),
      RENDER_DEADLINE_MS,
      "single step",
    );
    const end = Math.round(PPQN.secondsToPulses(scenario.seconds, BPM));
    const copy = project.copy();
    try {
      const audio = await withDeadline(
        OfflineEngineRenderer.renderSection(
          copy,
          Option.None,
          { type: "loop", key: "loop", label: "Loop Area", start: 0, end, passes: scenario.passes, tail: false },
          new DefaultObservableValue(0),
          undefined,
          PAGE_RATE,
        ),
        RENDER_DEADLINE_MS,
        "renderSection",
      );
      return { slice: channels[0], section: audio.frames[0] };
    } finally {
      copy.terminate();
    }
  }, [project]);

  const measure = useCallback(async (scenario: Scenario, baselines: Map<number, number>): Promise<Row> => {
    if (!project || !unitsRef.current) throw new Error("not ready");
    const { hits, tone } = unitsRef.current;
    const solo = (hitsAudible: boolean): void => {
      project.editing.modify(() => {
        hits.mute.setValue(!hitsAudible);
        tone.mute.setValue(hitsAudible);
      });
    };
    const removeDevices = insertDevices(scenario);
    try {
      const reportedLatencyFrames = await waitForReportedLatency(scenario.latencyFrames);
      const minGap = Math.round(HIT_MIN_GAP_SECONDS * PAGE_RATE);
      solo(true);
      const burst = await renderBoth(scenario);
      const sliceHits = findHits(burst.slice, HIT_THRESHOLD, minGap);
      const sectionHits = findHits(burst.section, HIT_THRESHOLD, minGap);
      solo(false);
      const steady = await renderBoth(scenario);
      const margin = Math.round(STEP_MARGIN_SECONDS * PAGE_RATE);
      const sliceStep = largestStep(steady.slice, margin, steady.slice.length - margin);
      const sectionStep = largestStep(steady.section, margin, steady.section.length - margin);

      const frames = framesOf(scenario);
      const problem = measurementProblem({
        expectedHits: BURST_SECONDS.filter((seconds) => seconds < scenario.seconds).length,
        expectedFrames: frames,
        expectedStep: toneStep(LEVEL, TONE_HZ, PAGE_RATE),
        burst: { sliceHits, sectionHits, sectionFrames: burst.section.length },
        tone: { sliceStep: sliceStep.step, sectionStep: sectionStep.step, sectionFrames: steady.section.length },
      });
      if (problem !== null) throw new Error(problem);

      let baseline = 0;
      if (scenario.isBaseline) {
        const read = readBaseline(sliceHits, sectionHits);
        if (read === null) {
          throw new Error(`no two-pass baseline: reference ${sliceHits.join(" ")}, renderSection ${sectionHits.join(" ")}`);
        }
        baseline = read;
        baselines.set(scenario.seconds, read);
      } else if (scenario.passes === 2) {
        const known = baselines.get(scenario.seconds);
        if (known === undefined) throw new Error(`no two-pass baseline measured for a ${scenario.seconds} s section`);
        baseline = known;
      }

      const predicted = predictedDroppedFrames(scenario.latencyFrames, frames, scenario.passes);
      const boundaryFrame = boundaryInOutput(frames, scenario.passes);
      const jumpReadable = boundaryFrame === null || predicted === 0 || readableAt(boundaryFrame, predicted);
      const reading = readRow({ boundaryFrame, predicted, baseline, jumpReadable, sliceHits, sectionHits, sliceStep, sectionStep });
      return {
        id: scenario.id,
        label: scenario.label,
        latencyFrames: scenario.latencyFrames,
        reportedLatencyFrames,
        predicted,
        baseline,
        boundaryFrame,
        jumpReadable,
        sliceHits,
        sectionHits,
        sliceStep,
        sectionStep,
        reading,
      };
    } finally {
      removeDevices();
    }
  }, [project, insertDevices, renderBoth, waitForReportedLatency]);

  const handleRun = useCallback(async () => {
    if (!project || running) return;
    setRunning(true);
    setGot(null);
    setEnvelope("");
    setAuditState("running");
    const rows: TestStepRow[] = [];
    const results: Row[] = [];
    let current: Scenario = SCENARIOS[0];
    let deviceRateHz: number | null = null;
    let failure: string | null = null;
    try {
      // The live engine reports latency only while its context runs. Nothing plays.
      await contextRef.current?.resume();
      deviceRateHz = await readDeviceRate();
      const baselines = new Map<number, number>();
      for (const scenario of SCENARIOS) {
        current = scenario;
        setStatus(`Rendering: ${scenario.label}`);
        const row = await measure(scenario, baselines);
        results.push(row);
        rows.push({ label: scenario.label, value: rowText(row) });
        setGot([...rows]);
      }
      const changed = results.filter((row) => row.reading.verdict === "changed").length;
      setAuditState("done");
      setStatus(changed === 0 ? `Done: all ${results.length} rows as predicted` : `Done: ${changed} of ${results.length} rows changed`);
    } catch (error) {
      failure = `${current.label}: ${String(error)}`;
      console.error("Run failed: " + failure);
      // TestStep shows a row only under an expected label, so the failure lands on the scenario that threw
      rows.push({ label: current.label, value: `the measurement failed, no verdict: ${String(error)}` });
      setGot([...rows]);
      setAuditState("error");
      setStatus(`Error: ${failure}`);
    } finally {
      setEnvelope(JSON.stringify({ pageRateHz: PAGE_RATE, deviceRateHz, chunkFrames: CHUNK_FRAMES, failure, rows: results }, null, 1));
      setRunning(false);
    }
  }, [project, running, measure]);

  const expected: TestStepRow[] = SCENARIOS.map((scenario) => ({ label: scenario.label, value: expectedText(scenario) }));

  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" p="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Heading size="7">renderSection and delay compensation</Heading>
          <DebugLinkBar
            links={[
              { label: "Investigation note", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-05-render-section-latency-gap/note.md", kind: "note" },
            ]}
          />
          <Text size="2" color="gray">
            With <Code>tail: false</Code>, <Code>OfflineEngineRenderer.renderSection</Code> renders in chunks of{" "}
            {CHUNK_FRAMES} frames. When the project's delay compensation is not a whole number of 128-frame quanta, the
            render loses frames at the first chunk boundary: what follows comes out early and a sustained sound jumps. A
            two-pass section of at least one chunk has that boundary in its discarded first pass, so it shows no jump
            and every kept frame is early. Each row renders the same section through <Code>renderSection</Code> and in a
            single step, and compares them. Offline render at {PAGE_RATE} Hz (<Code>?rate=44100</Code> for the other
            rate), no audio plays.
          </Text>
          <Callout.Root color="gray">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>Status: {status}</Callout.Text>
          </Callout.Root>
          <div id="audit-state" data-audit-state={auditState} hidden />
          <TestStep
            index={1}
            title="renderSection against a single step"
            description={
              <>
                <Code>early</Code> is the single-step hit minus the <Code>renderSection</Code> hit, on tone bursts at
                0.5, 1.5, 2.5 and 3.5 s. The tone step is the largest move between neighbouring samples on a steady 997
                Hz tone. Expected values come from <Code>(128 − (latency mod 128)) mod 128</Code> when the render passes
                one chunk, and two-pass rows add the no-latency two-pass row's shift.
              </>
            }
            actions={
              <Button onClick={handleRun} disabled={!project || running} data-testid="run">
                <PlayIcon /> {running ? "Rendering…" : "Run"}
              </Button>
            }
            expected={expected}
            got={got}
          />
          {envelope !== "" && (
            <Card>
              <Text size="1" color="gray">Every figure of the run</Text>
              <pre id="envelope" style={{ fontSize: 11, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{envelope}</pre>
            </Card>
          )}
          <Card>
            <Text size="1" color="gray">
              The Compressor is set to apply no gain reduction (threshold 0 dB, ratio 1, knee 0, gain 0, makeup 0,
              auto-makeup off, mix 1, look-ahead on). A muted track holding a device keeps its latency, so those rows
              leave the signal itself dry.
            </Text>
          </Card>
        </Flex>
      </Container>
    </Theme>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
