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
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile } from "@/lib/audioUtils";
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
import { InfoCircledIcon, PlayIcon, StopIcon } from "@radix-ui/react-icons";

// Repro for `debug/voice-fadein-clip-fadein-product.md`.
//
// Two distinct AudioFileBoxes (different UUIDs) on the same Tape track so
// the shared-source path in `shared-source-double-process.md` does NOT
// apply. They reference two on-disk WAVs that are the same 440 Hz sine
// shifted in time by 30 samples; we read the offset file 30 samples
// earlier (via loopOffset) so both regions play phase-aligned audio
// through the crossfade region.
//
// BUG case: 40 ms linear crossfade (slope 0.5). The incoming voice
// enters in VoiceState.Fading / fadeDirection=1 for the first 20 ms
// (VOICE_FADE_DURATION). PitchVoice.process multiplies that internal
// voice-fade amplitude by the region's clip-fade gain buffer — so V2's
// effective gain over the first 20 ms of the crossfade is
//   voice_fadeIn × clip_fadeIn  =  ((τ+20ms)/20ms) × ((τ+20ms)/40ms)
//                              =  (τ+20ms)² / 0.0008
// — quadratic. V1's outgoing voice is Active so its effective gain is
// just clip_fadeOut (linear). Sum at τ = −10 ms ≈ 0.875 ⇒ ~−1.16 dB dip.
//
// WORKAROUND: drop the crossfade entirely and do a hard cut. With no
// region fade on either side, the voice-fade is the only attenuation
// applied to each voice individually — V1's outgoing voice fades out
// over 20 ms (added to lane.fadingVoices) while V2's incoming voice
// fades in over 20 ms. Each is processed with #unitGainBuffer, so the
// fades aren't multiplied by anything authored. No dip.
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

type Scenario = "bug" | "workaround";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [scenario, setScenario] = useState<Scenario>("bug");
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);

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

        newProject.editing.modify(() => {
          const { trackBox } = newProject.api.createInstrument(InstrumentFactories.Tape);

          const fileBoxA = AudioFileBox.create(newProject.boxGraph, uuidA, (box) => {
            box.fileName.setValue("test-440hz.wav");
            box.endInSeconds.setValue(bufferA.duration);
          });
          const fileBoxB = AudioFileBox.create(newProject.boxGraph, uuidB, (box) => {
            box.fileName.setValue("test-440hz-offset30.wav");
            box.endInSeconds.setValue(bufferB.duration);
          });

          // Region A: 0 → SEAM. fading.out set in applyScenarioAndPlay.
          const eventsA = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
          const regionA = AudioRegionBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (box) => {
              box.regions.refer(trackBox.regions);
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
          // Region B: SEAM → end. loopOffset = SEAM − 30samples so source
          // playback is phase-aligned with A at the seam moment.
          const eventsB = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
          const regionB = AudioRegionBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (box) => {
              box.regions.refer(trackBox.regions);
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
        if (next === "bug") {
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

  // The dip in BUG mode is centered ~10 ms before the seam (in the first half
  // of the 40 ms crossfade), so highlight the whole crossfade overlap window.
  const inCrossfadeRegion =
    positionSec > SEAM_SECONDS - CROSSFADE_MS / 2000 - 0.005 &&
    positionSec < SEAM_SECONDS + CROSSFADE_MS / 2000 + 0.005;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Voice-Fade × Clip-Fade Product
          </Heading>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              A crossfade between two regions with <strong>different</strong>{" "}
              <Code>sourceUuid</Code>s (so the shared-source path doesn't apply) still produces an
              audible amplitude dip on the incoming voice's fade-in side. Cause:{" "}
              <Code>PitchVoice</Code> starts every new voice in <Code>Fading</Code>/
              <Code>fadeDirection=1</Code> for <Code>VOICE_FADE_DURATION</Code> (20 ms), and{" "}
              <Code>process()</Code> multiplies that voice-fade by the region's clip-fade gain
              buffer — turning a linear clip fade-in into a quadratic ramp over the first 20 ms.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">
                Status:
              </Text>
              <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
                {status}
              </Badge>
              {isPlaying && (
                <Badge color="amber">Playing: {scenario === "bug" ? "BUG" : "WORKAROUND"}</Badge>
              )}
              <Text size="2" weight="bold">
                Position:
              </Text>
              <Badge color={inCrossfadeRegion ? "red" : isPlaying ? "amber" : "gray"} size="2">
                <Code>
                  {positionSec.toFixed(3)} s
                  {inCrossfadeRegion ? " ← CROSSFADE" : ""}
                </Code>
              </Badge>
              <Text size="2" color="gray">
                (seam at {SEAM_SECONDS}.000 s, crossfade ±{CROSSFADE_MS / 2} ms)
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">
                Reproduce
              </Text>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2">
                  Playback starts at <Code>{PLAYBACK_START_SECONDS}</Code> s, so you only wait ~2 s
                  for the seam at <Code>{SEAM_SECONDS}</Code> s.
                </Text>
                <Text size="2">
                  <strong>Bug:</strong> 40 ms linear crossfade centered on the seam. New voice
                  enters in voice-fadeIn state for 20 ms; voice fade × clip fade = quadratic ramp
                  on the incoming voice. Listen for a brief dip ~10 ms before the seam.
                </Text>
                <Text size="2">
                  <strong>Workaround:</strong> drop the crossfade and let voice-fade alone handle
                  click prevention. Voice-fade is applied via{" "}
                  <Code>#unitGainBuffer</Code> on <Code>lane.fadingVoices</Code>, so it isn't
                  multiplied by an authored region fade. No dip — the seam is smooth.
                </Text>
              </Flex>
              <Flex gap="3">
                <Button
                  onClick={() => applyScenarioAndPlay("bug")}
                  disabled={!project || status !== "Ready"}
                  color="red"
                  size="3"
                >
                  <PlayIcon /> Play (BUG)
                </Button>
                <Button
                  onClick={() => applyScenarioAndPlay("workaround")}
                  disabled={!project || status !== "Ready"}
                  color="green"
                  size="3"
                >
                  <PlayIcon /> Play (WORKAROUND)
                </Button>
                <Button onClick={handleStop} disabled={!isPlaying} variant="soft" size="3">
                  <StopIcon /> Stop
                </Button>
              </Flex>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">
                Configuration
              </Text>
              <Separator size="4" />
              <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                {`BPM:                 ${BPM}
File A:              test-440hz.wav
File B:              test-440hz-offset30.wav (delayed by ${(SOURCE_OFFSET_SECONDS * 1000).toFixed(3)} ms = ~24° at 440 Hz; preserved through any decode resample)
Region A:            position=0, duration=${SEAM_SECONDS}s (+20ms in bug)
Region B:            position=${SEAM_SECONDS}s (−20ms in bug), loopOffset compensates source delay
Crossfade duration:  ${CROSSFADE_MS} ms (slope 0.5 linear, both sides)
Bug:                 fading.out on A = ${CROSSFADE_MS} ms, fading.in on B = ${CROSSFADE_MS} ms
Workaround:          fading.out=0, fading.in=0 (hard cut, voice-fade handles boundary)
Playback start:      ${PLAYBACK_START_SECONDS} s (≈2 s before seam)
Seam:                ${SEAM_SECONDS} s`}
              </Code>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">
                What to inspect
              </Text>
              <Separator size="4" />
              <Text size="2">
                Render to an <Code>AudioBuffer</Code> offline. In the bug case, scan the
                output amplitude across the crossfade region as
                <Code>output[i] / source[i]</Code>: it should be 1.0 outside the crossfade, then dip
                to ~0.875 (−1.16 dB) at ~10 ms before the seam, then return to 1.0 at the seam
                moment. Past the seam the sum stays at 1.0 (V2's voice fade has completed). The dip
                is concentrated on the incoming voice's fade-in side only.
              </Text>
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
