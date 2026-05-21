import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TestStep, TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile } from "@/lib/audioUtils";
import { minEnvelopeInWindow, peakInWindow, renderOfflineSlice } from "@/lib/offlineScan";
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
  Separator,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon, StopIcon, ActivityLogIcon } from "@radix-ui/react-icons";

// Repro for `debug/voice-fadein-clip-fadein-product.md`.
//
// Two distinct AudioFileBoxes (different UUIDs) on the same Tape track so
// the shared-source path in `shared-source-double-process.md` does NOT
// apply. They reference two on-disk WAVs that are the same 440 Hz sine
// shifted in time by 30 samples (~0.680 ms ~24° at 440 Hz); we
// compensate via loopOffset on Region B so both regions play
// phase-aligned audio through the crossfade region.
//
// Two toggleable configurations:
//
//   CROSSFADE — 40 ms linear crossfade centered on the seam
//               (region A: fading.out=40ms, region B: fading.in=40ms,
//                slope 0.5). Region positions extended by half-fade so
//                the overlap window is symmetric across the seam.
//
//   HARD-CUT  — no clip fades, regions touch at the seam.
//               OpenDAW's voice-level fade (VOICE_FADE_DURATION=20ms)
//               applies on its own to the outgoing/incoming voices via
//               lane.fadingVoices + #unitGainBuffer.
//
// Working hypothesis for the audible dip on a sustained tone in the
// CROSSFADE configuration: PitchVoice puts every new voice in
// `Fading`/`fadeDirection=1` for 20 ms, and process() multiplies that
// internal voice-fade by the region's clip-fade gain buffer — so the
// incoming voice's effective gain over the first 20 ms of the
// crossfade is `voice_fadeIn × clip_fadeIn`, a quadratic ramp rather
// than the linear ramp the crossfade math assumes. Sum at τ = −10 ms
// ≈ 0.875 ⇒ ~−1.16 dB dip predicted.
//
// Empirical verification: click "Scan current scenario" after each
// Play to render the seam region offline and report the min envelope
// peak across the crossfade window. Mechanism is treated as suspected
// until the scan confirms; this is a debug investigation, not a
// solved bug.
const BPM = 120;
const FILE_A = "/audio/test-440hz.wav";
const FILE_B = "/audio/test-440hz-offset30.wav";
// FILE_B is FILE_A delayed by 30 samples at the WAV's authored sample rate
// (44.1 kHz). In time, that's a fixed 0.680 ms offset preserved through
// decodeAudioData's resample to AudioContext rate — at 48 kHz the same
// content lands ~32.65 samples late, but the TIME offset is unchanged.
// We use the time-offset (in seconds) for loopOffset compensation, not a
// sample count tied to the playback rate.
const SOURCE_OFFSET_SECONDS = 30 / 44100; // ≈ 0.000680 s, ~24° at 440 Hz
const SEAM_SECONDS = 30;
const TOTAL_DURATION_SECONDS = 60;
const PLAYBACK_START_SECONDS = 28;
const CROSSFADE_MS = 40; // total overlap; symmetric 20 ms each side

type Scenario = "crossfade" | "hardcut";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [scenario, setScenario] = useState<Scenario>("crossfade");
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [gotByStep, setGotByStep] = useState<Record<number, TestStepRow[]>>({});
  const [scanning, setScanning] = useState(false);

  const audioBuffersRef = useRef<{ a: AudioBuffer | null; b: AudioBuffer | null }>({
    a: null,
    b: null,
  });
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const regionsRef = useRef<{ a: AudioRegionBox | null; b: AudioRegionBox | null }>({
    a: null,
    b: null,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;
        setProject(newProject);
        setAudioContext(newAudioContext);

        newProject.engine.isPlaying.catchupAndSubscribe((obs) => {
          if (mounted) setIsPlaying(obs.getValue());
        });

        setStatus("Loading test-440hz files...");
        const [bufferA, bufferB] = await Promise.all([
          loadAudioFile(newAudioContext, FILE_A),
          loadAudioFile(newAudioContext, FILE_B),
        ]);
        if (!mounted) return;
        audioBuffersRef.current = { a: bufferA, b: bufferB };

        const uuidA = UUID.generate();
        const uuidB = UUID.generate();
        localAudioBuffersRef.current.set(UUID.toString(uuidA), bufferA);
        localAudioBuffersRef.current.set(UUID.toString(uuidB), bufferB);

        const bpm = newProject.timelineBox.bpm.getValue();
        const fullDurationPPQN = PPQN.secondsToPulses(bufferA.duration, bpm);
        const seamPPQN = PPQN.secondsToPulses(SEAM_SECONDS, bpm);
        // FILE_B is delayed by 30 samples in source (B[N] = A[N-30]) — to
        // play the same musical moment as File A at any timeline position,
        // read File B at a position 30 samples LATER in its source. Apply
        // via loopOffset on Region B.
        const seamPlusOffsetPPQN = PPQN.secondsToPulses(
          SEAM_SECONDS + SOURCE_OFFSET_SECONDS,
          bpm
        );

        let trackBoxA: { regions: unknown };
        let trackBoxB: { regions: unknown };
        newProject.editing.modify(() => {
          trackBoxA = newProject.api.createInstrument(InstrumentFactories.Tape)
            .trackBox as { regions: unknown };
        });
        newProject.editing.modify(() => {
          trackBoxB = newProject.api.createInstrument(InstrumentFactories.Tape)
            .trackBox as { regions: unknown };
        });
        newProject.editing.modify(() => {
          const fileBoxA = AudioFileBox.create(newProject.boxGraph, uuidA, (box) => {
            box.fileName.setValue("test-440hz.wav");
            box.endInSeconds.setValue(bufferA.duration);
          });
          const fileBoxB = AudioFileBox.create(newProject.boxGraph, uuidB, (box) => {
            box.fileName.setValue("test-440hz-offset30.wav");
            box.endInSeconds.setValue(bufferB.duration);
          });

          const eventsA = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
          const regionA = AudioRegionBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (box) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              box.regions.refer((trackBoxA as any).regions);
              box.file.refer(fileBoxA);
              box.events.refer(eventsA.owners);
              box.position.setValue(0);
              box.duration.setValue(seamPPQN);
              box.loopOffset.setValue(0);
              box.loopDuration.setValue(fullDurationPPQN);
              box.label.setValue("A (file A)");
              box.mute.setValue(false);
              box.fading.in.setValue(0);
              box.fading.out.setValue(0);
              box.fading.inSlope.setValue(0.5);
              box.fading.outSlope.setValue(0.5);
            }
          );
          const eventsB = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
          const regionB = AudioRegionBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (box) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              box.regions.refer((trackBoxB as any).regions);
              box.file.refer(fileBoxB);
              box.events.refer(eventsB.owners);
              box.position.setValue(seamPPQN);
              box.duration.setValue(fullDurationPPQN - seamPPQN);
              box.loopOffset.setValue(seamPlusOffsetPPQN);
              box.loopDuration.setValue(fullDurationPPQN);
              box.label.setValue("B (file B, loopOffset −30 samples)");
              box.mute.setValue(false);
              box.fading.in.setValue(0);
              box.fading.out.setValue(0);
              box.fading.inSlope.setValue(0.5);
              box.fading.outSlope.setValue(0.5);
            }
          );

          regionsRef.current = { a: regionA, b: regionB };

          newProject.timelineBox.loopArea.enabled.setValue(false);
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(fullDurationPPQN);
        });

        if (mounted) setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${String(error)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const applyScenarioAndPlay = useCallback(
    async (next: Scenario) => {
      if (!project || !audioContext) return;
      const regionA = regionsRef.current.a;
      const regionB = regionsRef.current.b;
      if (!regionA || !regionB) return;

      if (audioContext.state !== "running") {
        await audioContext.resume();
      }

      const bpm = project.timelineBox.bpm.getValue();
      // Crossfade is centered on the seam: 20 ms past A's nominal end and
      // 20 ms before B's nominal start. Implement by extending A's duration
      // forward 20 ms and shifting B's position back 20 ms, then setting
      // fading.out / fading.in to 40 ms.
      const seamPPQN = PPQN.secondsToPulses(SEAM_SECONDS, bpm);
      const fullDurationPPQN = PPQN.secondsToPulses(TOTAL_DURATION_SECONDS, bpm);
      const halfFadePPQN = PPQN.secondsToPulses(CROSSFADE_MS / 2000, bpm);
      const fadePPQN = PPQN.secondsToPulses(CROSSFADE_MS / 1000, bpm);

      project.editing.modify(() => {
        if (next === "crossfade") {
          regionA.duration.setValue(seamPPQN + halfFadePPQN);
          regionA.fading.out.setValue(fadePPQN);
          regionB.position.setValue(seamPPQN - halfFadePPQN);
          regionB.duration.setValue(fullDurationPPQN - seamPPQN + halfFadePPQN);
          // loopOffset on B compensates for (1) the ~0.680 ms source delay
          // (read File B at a position 0.680 ms LATER in source) AND (2)
          // the 20 ms backward position shift (read 20 ms EARLIER in
          // source). Net: +0.680 ms − 20 ms.
          const newLoopOffsetPPQN = PPQN.secondsToPulses(
            SEAM_SECONDS + SOURCE_OFFSET_SECONDS - CROSSFADE_MS / 2000,
            bpm
          );
          regionB.loopOffset.setValue(newLoopOffsetPPQN);
          regionB.fading.in.setValue(fadePPQN);
        } else {
          // Hard cut — no overlap, no fades.
          regionA.duration.setValue(seamPPQN);
          regionA.fading.out.setValue(0);
          regionB.position.setValue(seamPPQN);
          regionB.duration.setValue(fullDurationPPQN - seamPPQN);
          const newLoopOffsetPPQN = PPQN.secondsToPulses(
            SEAM_SECONDS + SOURCE_OFFSET_SECONDS,
            bpm
          );
          regionB.loopOffset.setValue(newLoopOffsetPPQN);
          regionB.fading.in.setValue(0);
        }
      });

      setScenario(next);
      project.engine.setPosition(PPQN.secondsToPulses(PLAYBACK_START_SECONDS, bpm));
      project.engine.play();
    },
    [project, audioContext]
  );

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
  }, [project]);

  const handleScan = useCallback(async () => {
    if (!project || scanning) return;
    if (project.engine.isPlaying.getValue()) project.engine.stop(true);
    const stepIndex = scenario === "hardcut" ? 1 : 3;
    setScanning(true);
    setGotByStep((prev) => {
      const next = { ...prev };
      delete next[stepIndex];
      return next;
    });
    try {
      const sliceStart = SEAM_SECONDS - 0.1;
      const sliceEnd = SEAM_SECONDS + 0.1;
      const { channels, sampleRate: sr } = await renderOfflineSlice(
        project,
        sliceStart,
        sliceEnd
      );
      const left = channels[0];
      const halfFadeSec = CROSSFADE_MS / 2000;
      const refWindow = peakInWindow(
        left,
        sliceStart,
        SEAM_SECONDS - 0.08,
        SEAM_SECONDS - halfFadeSec - 0.005,
        sr
      );
      const dip = minEnvelopeInWindow(
        left,
        sliceStart,
        SEAM_SECONDS - halfFadeSec,
        SEAM_SECONDS + halfFadeSec,
        sr,
        2.5
      );
      const ratio = refWindow.peak > 1e-6 ? dip.minPeak / refWindow.peak : 0;
      const dipDb = ratio > 1e-6 ? 20 * Math.log10(ratio) : -Infinity;
      const tauMs = (sliceStart + dip.atSecondsFromStart - SEAM_SECONDS) * 1000;
      const rows: TestStepRow[] = [
        { label: "reference peak", value: refWindow.peak.toFixed(4) },
        { label: "min envelope peak", value: dip.minPeak.toFixed(4) },
        {
          label: "min / reference",
          value: `${ratio.toFixed(4)}  (${dipDb.toFixed(2)} dB)`,
        },
        { label: "dip τ (ms relative to seam)", value: `${tauMs.toFixed(2)} ms` },
        { label: "sample rate", value: `${sr} Hz` },
      ];
      setGotByStep((prev) => ({ ...prev, [stepIndex]: rows }));
    } catch (error) {
      setGotByStep((prev) => ({
        ...prev,
        [stepIndex]: [{ label: "error", value: String(error) }],
      }));
    } finally {
      setScanning(false);
    }
  }, [project, scanning, scenario]);

  // Live playhead readout: convert engine PPQN to seconds via the timeline's
  // BPM each frame. Helps the listener time the dip relative to the seam.
  useEffect(() => {
    if (!project) return;
    const sub = AnimationFrame.add(() => {
      const bpm = project.timelineBox.bpm.getValue();
      const positionPpqn = project.engine.position.getValue();
      setPositionSec(PPQN.pulsesToSeconds(positionPpqn, bpm));
    });
    return () => sub.terminate();
  }, [project]);

  // The predicted dip in CROSSFADE mode is centered ~10 ms before the seam
  // (in the first half of the 40 ms crossfade), so highlight the whole
  // crossfade overlap window.
  const inCrossfadeRegion =
    positionSec > SEAM_SECONDS - CROSSFADE_MS / 2000 - 0.005 &&
    positionSec < SEAM_SECONDS + CROSSFADE_MS / 2000 + 0.005;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar
          links={[
            {
              label: "Pure-Web-Audio target demo",
              href: "/pure-webaudio-target-debug-demo.html",
              kind: "demo",
            },
            {
              label: "Shared-source double-process demo",
              href: "/shared-source-double-process-debug-demo.html",
              kind: "demo",
            },
            {
              label: "debug/voice-fadein-clip-fadein-product.md",
              href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/voice-fadein-clip-fadein-product.md",
              kind: "note",
            },
          ]}
        />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Voice-Fade × Clip-Fade Product
          </Heading>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              A 40 ms linear clip crossfade between two regions with different{" "}
              <Code>sourceUuid</Code>s — placed on <strong>separate</strong> Tape tracks so the
              mix happens at the master (overlapping regions on a single track are disallowed by
              design and get deleted by <Code>project.copy()</Code>) — produces a measurable dip
              on the incoming voice's fade-in side. Cause: <Code>PitchVoice</Code> starts every
              new voice in <Code>Fading</Code>/<Code>fadeDirection=1</Code> for{" "}
              <Code>VOICE_FADE_DURATION</Code> (20 ms), and <Code>process()</Code> multiplies
              that voice-fade by the region's clip-fade gain buffer — turning a linear clip
              fade-in into a quadratic ramp over the first 20 ms.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">Status:</Text>
              <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
                {status}
              </Badge>
              {isPlaying && (
                <Badge color="amber">
                  Playing: {scenario === "crossfade" ? "CROSSFADE" : "HARD-CUT"}
                </Badge>
              )}
              <Text size="2" weight="bold">Position:</Text>
              <Badge color={inCrossfadeRegion ? "red" : isPlaying ? "amber" : "gray"} size="2">
                <Code>
                  {positionSec.toFixed(3)} s
                  {inCrossfadeRegion ? " ← CROSSFADE" : ""}
                </Code>
              </Badge>
              <Text size="2" color="gray">
                (seam at {SEAM_SECONDS}.000 s, crossfade ±{CROSSFADE_MS / 2} ms)
              </Text>
              <Button onClick={handleStop} disabled={!isPlaying} variant="soft" size="2">
                <StopIcon /> Stop
              </Button>
            </Flex>
          </Card>

          <TestStep
            index={1}
            title="Baseline: HARD-CUT (no clip fades, regions touch)"
            description={
              <>
                Regions touch at the seam, no <Code>fading.in</Code> / <Code>fading.out</Code>.
                OpenDAW's per-voice 20 ms fade (<Code>VOICE_FADE_DURATION</Code>) handles click
                prevention on its own. <strong>Listen for:</strong> a clean transition at the
                {" "}{SEAM_SECONDS} s seam.
              </>
            }
            actions={
              <>
                <Button
                  onClick={() => applyScenarioAndPlay("hardcut")}
                  disabled={!project || status !== "Ready" || scanning}
                  color="amber"
                  size="3"
                >
                  <PlayIcon /> Play (HARD-CUT)
                </Button>
                <Button
                  onClick={handleScan}
                  disabled={!project || status !== "Ready" || scanning || scenario !== "hardcut"}
                  variant="soft"
                  color="amber"
                  size="3"
                >
                  <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan HARD-CUT"}
                </Button>
              </>
            }
            expected={[
              { label: "reference peak", value: "≈ 0.5000" },
              { label: "min envelope peak", value: "≈ 0.5000 (no dip)" },
              { label: "min / reference", value: "≈ 1.0000  (−0.00 dB)" },
              { label: "dip τ (ms relative to seam)", value: "n/a (no dip)" },
              { label: "sample rate", value: `${audioContext?.sampleRate ?? "—"} Hz` },
            ]}
            got={gotByStep[1] ?? null}
          />

          <TestStep
            index={2}
            title="CROSSFADE — live listening test"
            description={
              <>
                40 ms linear clip crossfade (slope 0.5), regions extended symmetrically across
                the seam on their separate tracks. <strong>Listen for:</strong> an amplitude dip
                ~10 ms BEFORE the {SEAM_SECONDS} s seam — subtle on this sustained tone but
                audible. The dip happens because the new voice's <em>voice-fade-in</em> and the
                region's <em>clip-fade-in</em> multiply over the first 20 ms.
              </>
            }
            actions={
              <Button
                onClick={() => applyScenarioAndPlay("crossfade")}
                disabled={!project || status !== "Ready" || scanning}
                color="amber"
                size="3"
              >
                <PlayIcon /> Play (CROSSFADE)
              </Button>
            }
            expected={[]}
            got={null}
          />

          <TestStep
            index={3}
            title="CROSSFADE — offline scan measures the dip"
            description={
              <>
                With CROSSFADE active and playback stopped, click <strong>Scan CROSSFADE</strong>{" "}
                to render the seam ±100 ms slice offline and locate the minimum envelope peak
                across the crossfade window. The Target page's OPENDAW scenario (same engine
                configuration) measures <Code>min / reference ≈ 0.8352</Code> (−1.56 dB) at{" "}
                <Code>τ ≈ −7.5 ms</Code> — this page should match.
              </>
            }
            actions={
              <Button
                onClick={handleScan}
                disabled={!project || status !== "Ready" || scanning || scenario !== "crossfade"}
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan CROSSFADE"}
              </Button>
            }
            expected={[
              { label: "reference peak", value: "≈ 0.5000" },
              { label: "min envelope peak", value: "≈ 0.418 (dipped)" },
              { label: "min / reference", value: "≈ 0.8352  (−1.56 dB)" },
              { label: "dip τ (ms relative to seam)", value: "≈ −7.5 ms (before seam)" },
              { label: "sample rate", value: `${audioContext?.sampleRate ?? "—"} Hz` },
            ]}
            got={gotByStep[3] ?? null}
          />

          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">Configuration</Text>
              <Separator size="4" />
              <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                {`BPM:                 ${BPM}
File A:              test-440hz.wav
File B:              test-440hz-offset30.wav (delayed by ${(SOURCE_OFFSET_SECONDS * 1000).toFixed(3)} ms = ~24° at 440 Hz; preserved through any decode resample)
Track layout:        2 Tape tracks, 1 AudioRegionBox each (mix at master)
Region A:            position=0, duration=${SEAM_SECONDS}s (+20ms in CROSSFADE)
Region B:            position=${SEAM_SECONDS}s (−20ms in CROSSFADE), loopOffset compensates source delay
Crossfade duration:  ${CROSSFADE_MS} ms (slope 0.5 linear, both sides)
CROSSFADE:           fading.out on A = ${CROSSFADE_MS} ms, fading.in on B = ${CROSSFADE_MS} ms
HARD-CUT:            fading.out=0, fading.in=0 (regions touch, voice-fade handles boundary)
Playback start:      ${PLAYBACK_START_SECONDS} s (≈2 s before seam)
Seam:                ${SEAM_SECONDS} s`}
              </Code>
            </Flex>
          </Card>
        </Flex>

        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
