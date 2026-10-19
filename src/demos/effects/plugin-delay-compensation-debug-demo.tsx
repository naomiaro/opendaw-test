import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { EffectFactories, type Project } from "@opendaw/studio-core";
import {
  AudioFileBox,
  AudioRegionBox,
  type CompressorDeviceBox,
  type MaximizerDeviceBox,
  ValueEventCollectionBox,
} from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TestStep, type TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { audioEffectsFieldOf } from "@/lib/adapterUtils";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { firstOnsetIndex } from "@/lib/audit/clickHead";
import { bestLag } from "@/lib/audit/lagEstimate";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Callout, Button, Code } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Repro for `debug/2026-10-19-plugin-delay-compensation/note.md`.
//
// One Tape track plays a single-sample impulse at IMPULSE_SECONDS. The same slice is rendered
// offline five times: dry, then with a Compressor and a Maximizer inserted on the track, each with
// its look-ahead off and on, at settings that apply no gain reduction (ratio 1, threshold 0 dB; the
// Maximizer keeps its fixed -0.001 dB headroom). Each render is compared with the dry one by
// normalized cross-correlation (the dry render with itself); the lag is the frames by which the
// device shifted the track. A delay-compensating engine would read 0 in every row.
const SAMPLE_RATE = 48000;
const BPM = 120;
const IMPULSE_SECONDS = 0.25;
const SOURCE_SECONDS = 1.0;
const RENDER_SECONDS = 0.5;
const MAX_LAG_FRAMES = 2400; // 50 ms
const ONSET_THRESHOLD = 0.05;

type ScenarioId = "dry" | "compressor-off" | "compressor-on" | "maximizer-off" | "maximizer-on";

interface Scenario {
  id: ScenarioId;
  label: string;
  device: "none" | "compressor" | "maximizer";
  lookahead: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  { id: "dry", label: "dry (no device)", device: "none", lookahead: false },
  { id: "compressor-off", label: "Compressor, look-ahead off", device: "compressor", lookahead: false },
  { id: "compressor-on", label: "Compressor, look-ahead on", device: "compressor", lookahead: true },
  { id: "maximizer-off", label: "Maximizer, look-ahead off", device: "maximizer", lookahead: false },
  { id: "maximizer-on", label: "Maximizer, look-ahead on", device: "maximizer", lookahead: true },
];

interface Measurement {
  onset: number;
  peak: number;
  lag: number;
  score: number;
  left: Float32Array;
}

const impulseBuffer = (context: BaseAudioContext): AudioBuffer => {
  const buffer = context.createBuffer(2, Math.round(SOURCE_SECONDS * SAMPLE_RATE), SAMPLE_RATE);
  const at = Math.round(IMPULSE_SECONDS * SAMPLE_RATE);
  buffer.getChannelData(0)[at] = 0.5;
  buffer.getChannelData(1)[at] = 0.5;
  return buffer;
};

const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
};

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [running, setRunning] = useState(false);
  const [got, setGot] = useState<TestStepRow[] | null>(null);
  const audioUnitRef = useRef<AudioUnitBox | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { project: newProject, audioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          bpm: BPM,
          audioContextSampleRate: SAMPLE_RATE,
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;
        const buffer = impulseBuffer(audioContext);
        const uuid = UUID.generate();
        localAudioBuffersRef.current.set(UUID.toString(uuid), buffer);
        const durationPpqn = Math.round(PPQN.secondsToPulses(SOURCE_SECONDS, BPM));
        const { audioUnitBox, trackBox } = newProject.editing
          .modify(() => newProject.api.createInstrument(InstrumentFactories.Tape))
          .unwrap("tape");
        newProject.editing.modify(() => {
          const fileBox = AudioFileBox.create(newProject.boxGraph, uuid, (box) => {
            box.fileName.setValue("impulse.wav");
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
            box.label.setValue("impulse");
          });
          newProject.timelineBox.loopArea.enabled.setValue(false);
        });
        audioUnitRef.current = audioUnitBox;
        setProject(newProject);
        setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize: " + String(error));
        if (mounted) setStatus(`Error: ${String(error)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const measure = useCallback(async (scenario: Scenario, reference: Float32Array | null): Promise<Measurement> => {
    if (!project || !audioUnitRef.current) throw new Error("not ready");
    const effectsField = audioEffectsFieldOf(project, audioUnitRef.current);
    let effectBox: CompressorDeviceBox | MaximizerDeviceBox | null = null;
    if (scenario.device === "compressor") {
      effectBox = project.editing
        .modify(() => {
          const box = project.api.insertEffect(effectsField, EffectFactories.AudioNamed.Compressor, 0) as CompressorDeviceBox;
          box.threshold.setValue(0);
          box.ratio.setValue(1);
          box.knee.setValue(0);
          box.inputgain.setValue(0);
          box.makeup.setValue(0);
          box.automakeup.setValue(false);
          box.mix.setValue(1);
          box.lookahead.setValue(scenario.lookahead);
          return box;
        })
        .unwrap("compressor");
    } else if (scenario.device === "maximizer") {
      effectBox = project.editing
        .modify(() => {
          const box = project.api.insertEffect(effectsField, EffectFactories.AudioNamed.Maximizer, 0) as MaximizerDeviceBox;
          box.threshold.setValue(0);
          box.lookahead.setValue(scenario.lookahead);
          return box;
        })
        .unwrap("maximizer");
    }
    try {
      const { channels } = await renderOfflineSlice(project, 0, RENDER_SECONDS, SAMPLE_RATE);
      const left = channels[0];
      const peak = peakOf(left);
      const onset = firstOnsetIndex(left, ONSET_THRESHOLD);
      const { lag, score } = bestLag(reference ?? left, left, MAX_LAG_FRAMES);
      return { onset, peak, lag, score, left };
    } finally {
      const box = effectBox;
      if (box !== null) project.editing.modify(() => box.delete());
    }
  }, [project]);

  const handleRun = useCallback(async () => {
    if (!project || running) return;
    setRunning(true);
    setGot(null);
    const rows: TestStepRow[] = [];
    try {
      let reference: Float32Array | null = null;
      for (const scenario of SCENARIOS) {
        setStatus(`Rendering: ${scenario.label}`);
        const result = await measure(scenario, reference);
        if (scenario.id === "dry") reference = result.left;
        const ms = (result.lag / SAMPLE_RATE) * 1000;
        rows.push({
          label: scenario.label,
          value: `onset ${result.onset} (${((result.onset / SAMPLE_RATE) * 1000).toFixed(2)} ms), peak ${result.peak.toFixed(3)}, ` +
            `lag ${result.lag} frames (${ms.toFixed(2)} ms), score ${result.score.toFixed(3)}`,
        });
        setGot([...rows]);
      }
      setStatus("Done");
    } catch (error) {
      console.error("Run failed: " + String(error));
      rows.push({ label: "error", value: String(error) });
      setGot([...rows]);
      setStatus(`Error: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }, [project, running, measure]);

  const expectedOnset = Math.round(IMPULSE_SECONDS * SAMPLE_RATE);
  const lookaheadFrames = Math.round(0.005 * SAMPLE_RATE);
  const expected: TestStepRow[] = [
    { label: "dry (no device)", value: `onset ${expectedOnset}, lag 0` },
    { label: "Compressor, look-ahead off", value: "lag 0" },
    { label: "Compressor, look-ahead on", value: `lag ${lookaheadFrames} frames (5.00 ms) uncompensated; 0 if the engine compensated` },
    { label: "Maximizer, look-ahead off", value: "lag 0" },
    { label: "Maximizer, look-ahead on", value: `lag ${lookaheadFrames} frames (5.00 ms) uncompensated; 0 if the engine compensated` },
  ];

  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" p="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Flex align="center" gap="3">
            <MoisesLogo />
            <Heading size="7">Plug-in delay compensation</Heading>
          </Flex>
          <DebugLinkBar
            links={[
              { label: "Investigation note", href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-19-plugin-delay-compensation/note.md", kind: "note" },
            ]}
          />
          <Text size="2" color="gray">
            A device with look-ahead (the Compressor and the Maximizer buffer 5 ms) delays its track by that
            amount; nothing in the engine delays the other tracks to match. This page renders one impulse
            dry and through each device, look-ahead off and on, at settings that apply no gain reduction,
            and reads the shift by cross-correlation against the dry render. Offline render at 48 kHz.
          </Text>
          <Callout.Root color="gray">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>Status: {status}</Callout.Text>
          </Callout.Root>
          <TestStep
            index={1}
            title="Shift of an impulse through a look-ahead device"
            description={
              <>
                Five offline renders of the same half second. <Code>lag</Code> is the cross-correlation
                maximum against the dry render (positive = later; the dry row against itself);
                <Code>onset</Code> is the first frame above {ONSET_THRESHOLD} absolute.
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
          <Card>
            <Text size="1" color="gray">
              Device settings: Compressor threshold 0 dB, ratio 1, knee 0, input gain 0, makeup 0, auto-makeup off,
              mix 1; Maximizer threshold 0 dB (its fixed -0.001 dB headroom stays). The look-ahead toggle is set
              before the offline renderer starts, so its 15 ms crossfade does not run inside the render.
            </Text>
          </Card>
        </Flex>
      </Container>
    </Theme>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
