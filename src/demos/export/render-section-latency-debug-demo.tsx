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
  CHUNK_FRAMES,
  findHits,
  largestStep,
  predictedDroppedFrames,
  readRow,
  uniformEarly,
  type RowReading,
  type Step,
} from "@/lib/audit/sectionRenderGap";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Callout, Button, Code } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Repro for `debug/2026-11-05-render-section-latency-gap/note.md`.
//
// `OfflineEngineRenderer.renderSection` renders in chunks of 375 quanta and says why they must be
// quantum multiples: a step discards the rest of its last quantum. The worker also drops the settled
// delay compensation from the start of the output, so when the latency is not a whole number of
// quanta the first chunk ends part way through one. Each row renders the same section twice: through
// `renderSection`, and in one `step` over the same frames (`renderOfflineSlice`, the reference). Bursts
// give the shift in frames and a tone gives the jump. Controls that must read clean: no latency, a
// latency that is a whole number of quanta, and a section shorter than one chunk.
const SOURCE_RATE = 48000;
// The page's context and every render follow `?rate=`. The renders are offline, so the device rate
// should not matter; each run records it so a note can say so.
const PAGE_RATE = new URLSearchParams(location.search).get("rate") === "44100" ? 44100 : 48000;
const LOOKAHEAD_FRAMES = Math.floor(0.005 * PAGE_RATE);
const BPM = 120;
const SOURCE_SECONDS = 4;
const BURST_SECONDS = [0.5, 1.5, 2.5, 3.5];
const BURST_LENGTH_SECONDS = 0.02;
const BURST_HZ = 1000;
// 997 Hz has no period that divides a frame count of interest, so no shift can land back in phase.
const TONE_HZ = 997;
const LEVEL = 0.5;
const HIT_THRESHOLD = 0.05;
const HIT_MIN_GAP_SECONDS = 0.25;
// Start and end of a render hold the look-ahead device's start-up, not the join.
const STEP_MARGIN_SECONDS = 0.1;
const RENDER_DEADLINE_MS = 60_000;

const TWO_PASS_BASELINE_ID = "two-passes-none";

type Device = "none" | "compressor" | "fold" | "autotune";
type Host = "playing" | "muted";

interface Scenario {
  id: string;
  label: string;
  device: Device;
  host: Host;
  /** Read from the crates: 5 ms floored for look-ahead, 15 for Fold's factor 2, 1280 for Autotune. */
  latencyFrames: number;
  seconds: number;
  passes: 1 | 2;
}

const SCENARIOS: readonly Scenario[] = [
  { id: "none", label: "No latent device", device: "none", host: "playing", latencyFrames: 0, seconds: 4, passes: 1 },
  { id: "compressor", label: "Compressor look-ahead on the track", device: "compressor", host: "playing", latencyFrames: LOOKAHEAD_FRAMES, seconds: 4, passes: 1 },
  { id: "compressor-muted", label: "Compressor look-ahead on a muted track", device: "compressor", host: "muted", latencyFrames: LOOKAHEAD_FRAMES, seconds: 4, passes: 1 },
  { id: "fold", label: "Fold on a muted track", device: "fold", host: "muted", latencyFrames: 15, seconds: 4, passes: 1 },
  { id: "autotune", label: "Autotune on a muted track (whole quanta)", device: "autotune", host: "muted", latencyFrames: 1280, seconds: 4, passes: 1 },
  { id: "short", label: "Compressor look-ahead, section under one chunk", device: "compressor", host: "playing", latencyFrames: LOOKAHEAD_FRAMES, seconds: 0.9, passes: 1 },
  // Reads the shift a two-pass render shows with no latency, which the rows after it build on.
  { id: TWO_PASS_BASELINE_ID, label: "No latent device, two passes", device: "none", host: "playing", latencyFrames: 0, seconds: 4, passes: 2 },
  { id: "two-passes-autotune", label: "Autotune on a muted track, two passes (whole quanta)", device: "autotune", host: "muted", latencyFrames: 1280, seconds: 4, passes: 2 },
  { id: "two-passes", label: "Compressor look-ahead, two passes", device: "compressor", host: "playing", latencyFrames: LOOKAHEAD_FRAMES, seconds: 4, passes: 2 },
];

// A context left at its default takes the output device's rate; closed at once, it plays nothing.
const readDeviceRate = async (): Promise<number> => {
  const probe = new AudioContext();
  const rate = probe.sampleRate;
  await probe.close();
  return rate;
};

interface Row {
  id: string;
  label: string;
  latencyFrames: number;
  predicted: number;
  baseline: number;
  sliceHits: number[];
  sectionHits: number[];
  sliceStep: Step;
  sectionStep: Step;
  reading: RowReading;
}

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

const rowText = (row: Row): string => {
  const { earlyBefore, earlyAfter, stepAtBoundary, verdict } = row.reading;
  const list = (values: number[]): string => (values.length > 0 ? values.join(", ") : "none");
  return [
    `${verdict}: early before the boundary ${list(earlyBefore)}, after it ${list(earlyAfter)} frames`,
    row.baseline === 0 ? `predicted ${row.predicted}` : `predicted ${row.predicted} + ${row.baseline} without latency`,
    `tone step ${row.sectionStep.step.toFixed(3)} at frame ${row.sectionStep.frame} (reference ${row.sliceStep.step.toFixed(3)})`,
    stepAtBoundary ? "jump on the boundary" : "no jump",
  ].join("; ");
};

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [running, setRunning] = useState(false);
  const [auditState, setAuditState] = useState<"loading" | "ready" | "running" | "done" | "error">("loading");
  const [got, setGot] = useState<TestStepRow[] | null>(null);
  const [envelope, setEnvelope] = useState<string>("");
  const unitsRef = useRef<{ hits: AudioUnitBox; tone: AudioUnitBox; holder: AudioUnitBox } | null>(null);
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

  const renderBoth = useCallback(async (scenario: Scenario): Promise<{ slice: Float32Array; section: Float32Array }> => {
    if (!project) throw new Error("not ready");
    const { channels } = await renderOfflineSlice(project, 0, scenario.seconds, PAGE_RATE);
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

  const measure = useCallback(async (scenario: Scenario, twoPassBaseline: number): Promise<Row> => {
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
      const minGap = Math.round(HIT_MIN_GAP_SECONDS * PAGE_RATE);
      solo(true);
      const burst = await renderBoth(scenario);
      const sliceHits = findHits(burst.slice, HIT_THRESHOLD, minGap);
      const sectionHits = findHits(burst.section, HIT_THRESHOLD, minGap);
      // The offline worker swallows a failed sample fetch and renders zeros; a silent render must not print numbers.
      if (sliceHits.length === 0) throw new Error(`render of "${scenario.label}" is silent: the sample did not load`);
      solo(false);
      const steady = await renderBoth(scenario);
      const margin = Math.round(STEP_MARGIN_SECONDS * PAGE_RATE);
      const sliceStep = largestStep(steady.slice, margin, steady.slice.length - margin);
      const sectionStep = largestStep(steady.section, margin, steady.section.length - margin);
      const frames = Math.round(scenario.seconds * PAGE_RATE);
      const predicted = predictedDroppedFrames(scenario.latencyFrames, frames, scenario.passes);
      // Hits that disagree leave the baseline at 0, so the row reads changed instead of hiding them.
      const baseline = scenario.id === TWO_PASS_BASELINE_ID
        ? (uniformEarly(sliceHits, sectionHits) ?? 0)
        : scenario.passes === 2 ? twoPassBaseline : 0;
      const reading = readRow({
        boundaryFrame: CHUNK_FRAMES,
        predicted,
        passes: scenario.passes,
        baseline,
        sliceHits,
        sectionHits,
        sliceStep,
        sectionStep,
      });
      return {
        id: scenario.id,
        label: scenario.label,
        latencyFrames: scenario.latencyFrames,
        predicted,
        baseline,
        sliceHits,
        sectionHits,
        sliceStep,
        sectionStep,
        reading,
      };
    } finally {
      removeDevices();
    }
  }, [project, insertDevices, renderBoth]);

  const handleRun = useCallback(async () => {
    if (!project || running) return;
    setRunning(true);
    setGot(null);
    setEnvelope("");
    setAuditState("running");
    const rows: TestStepRow[] = [];
    const results: Row[] = [];
    let current: Scenario = SCENARIOS[0];
    try {
      const deviceRateHz = await readDeviceRate();
      let twoPassBaseline = 0;
      for (const scenario of SCENARIOS) {
        current = scenario;
        setStatus(`Rendering: ${scenario.label}`);
        const row = await measure(scenario, twoPassBaseline);
        if (scenario.id === TWO_PASS_BASELINE_ID) twoPassBaseline = row.baseline;
        results.push(row);
        rows.push({ label: scenario.label, value: rowText(row) });
        setGot([...rows]);
      }
      setEnvelope(JSON.stringify({ pageRateHz: PAGE_RATE, deviceRateHz, chunkFrames: CHUNK_FRAMES, rows: results }, null, 1));
      setAuditState("done");
      setStatus("Done");
    } catch (error) {
      console.error("Run failed: " + String(error));
      // TestStep shows a row only under an expected label, so the failure lands on the scenario that threw
      rows.push({ label: current.label, value: `error: ${String(error)}` });
      setGot([...rows]);
      setAuditState("error");
      setStatus(`Error: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }, [project, running, measure]);

  const expected: TestStepRow[] = SCENARIOS.map((scenario) => {
    const frames = Math.round(scenario.seconds * PAGE_RATE);
    const predicted = predictedDroppedFrames(scenario.latencyFrames, frames, scenario.passes);
    const onTwoPasses = scenario.passes === 2 ? ", on top of the first two-pass row's shift" : "";
    if (scenario.id === TWO_PASS_BASELINE_ID) {
      return { label: scenario.label, value: "latency 0 frames: the same shift on every hit, the baseline for the two-pass rows" };
    }
    return {
      label: scenario.label,
      value: predicted === 0
        ? `latency ${scenario.latencyFrames} frames: clean, no jump${onTwoPasses}`
        : `latency ${scenario.latencyFrames} frames: ${predicted} frames early after frame ${CHUNK_FRAMES}${scenario.passes === 2 ? ` (all kept frames)${onTwoPasses}` : ", with a jump on it"}`,
    };
  });

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
            <Code>OfflineEngineRenderer.renderSection</Code> renders in chunks of {CHUNK_FRAMES} frames. When the
            project's delay compensation is not a whole number of 128-frame quanta, the render loses frames at the
            first chunk boundary: what follows comes out early and a sustained sound jumps. Each row renders the same
            section through <Code>renderSection</Code> and in a single step, and compares them. Offline render at{" "}
            {PAGE_RATE} Hz (<Code>?rate=44100</Code> for the other rate), no audio plays.
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
                <Code>early</Code> is the single-step hit minus the <Code>renderSection</Code> hit, on four tone bursts
                at 0.5, 1.5, 2.5 and 3.5 s. The tone step is the largest move between neighbouring samples on a steady
                997 Hz tone. Expected values come from{" "}
                <Code>(128 − (latency mod 128)) mod 128</Code>.
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
