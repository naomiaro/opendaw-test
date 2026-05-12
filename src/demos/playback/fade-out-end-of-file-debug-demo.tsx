import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { AudioRegionBoxAdapter, InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile } from "@/lib/audioUtils";
import { getAllAudioRegions } from "@/lib/adapterUtils";
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

// Mirror the original Studio repro that surfaced this:
//   BPM 120, single Vocals30.mp3 region playing the full file, fade-out
//   that ends exactly at the file's end. The fade math itself is clean
//   (endProgress reaches 1.0, gain reaches 0 at region end), but a pop
//   is audible at the end of playback.
//
// VOICE_FADE_DURATION in @opendaw/studio-core is 20 ms. PitchVoice triggers
// its own end-of-file fade-out when `readPosition >= numberOfFrames -
// VOICE_FADE_DURATION * sampleRate`. The old voice is moved to
// `lane.fadingVoices`, which is processed with `#unitGainBuffer` (1.0) —
// the region's fading gain buffer is NOT applied to it. So the loud audio
// in the last 20 ms of the file plays at full level over the user's fade.
const BPM = 120;
const AUDIO_FILE = "/audio/Vocals30.mp3";
const FADE_OUT_SECONDS = 0.7766286581569116; // matches original repro
const VOICE_FADE_DURATION_SECONDS = 0.020; // SDK constant in core-processors/Tape/constants.ts
// 21 ms of headroom: 20 ms VOICE_FADE_DURATION + 1 ms safety margin.
const WORKAROUND_HEADROOM_SECONDS = 0.021;

type Scenario = "bug" | "workaround";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [scenario, setScenario] = useState<Scenario>("bug");
  const [isPlaying, setIsPlaying] = useState(false);

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

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

        setStatus("Loading Vocals30.mp3...");
        const audioBuffer = await loadAudioFile(newAudioContext, AUDIO_FILE);
        if (!mounted) return;
        audioBufferRef.current = audioBuffer;

        // Create a Tape track with one region playing the full file.
        const bpm = newProject.timelineBox.bpm.getValue();
        const fileUUID = UUID.generate();
        const fileUUIDString = UUID.toString(fileUUID);
        localAudioBuffersRef.current.set(fileUUIDString, audioBuffer);

        const fullDurationPPQN = PPQN.secondsToPulses(audioBuffer.duration, bpm);
        const fadeOutPPQN = PPQN.secondsToPulses(FADE_OUT_SECONDS, bpm);

        newProject.editing.modify(() => {
          const { trackBox } = newProject.api.createInstrument(InstrumentFactories.Tape);
          const audioFileBox = AudioFileBox.create(newProject.boxGraph, fileUUID, (box) => {
            box.fileName.setValue("Vocals30.mp3");
            box.endInSeconds.setValue(audioBuffer.duration);
          });
          const eventsCollectionBox = ValueEventCollectionBox.create(
            newProject.boxGraph,
            UUID.generate()
          );
          AudioRegionBox.create(newProject.boxGraph, UUID.generate(), (box) => {
            box.regions.refer(trackBox.regions);
            box.file.refer(audioFileBox);
            box.events.refer(eventsCollectionBox.owners);
            box.position.setValue(0);
            box.duration.setValue(fullDurationPPQN);
            box.loopOffset.setValue(0);
            box.loopDuration.setValue(fullDurationPPQN);
            box.label.setValue("Vocals30");
            box.mute.setValue(false);
            // Linear fade-out (slope 0.5) ending exactly at region/file end.
            box.fading.in.setValue(0);
            box.fading.out.setValue(fadeOutPPQN);
            box.fading.inSlope.setValue(0.5);
            box.fading.outSlope.setValue(0.5);
          });
          // Disable the timeline loop and extend its range past the region end so
          // playback runs continuously from 0 to the fade-out (no wrap-around).
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

  // Adjust the region's duration to match the selected scenario, then play.
  // - bug:        region end coincides with audio file end -> voice's internal
  //               end-of-file fade triggers in the last 20 ms, bypassing the
  //               region fade. Loud burst -> pop on playback end.
  // - workaround: shorten region by 21 ms so playback stops before the voice
  //               crosses its internal threshold. Region fade applies cleanly.
  const applyScenarioAndPlay = useCallback(
    async (next: Scenario) => {
      if (!project || !audioContext || !audioBufferRef.current) return;

      if (audioContext.state !== "running") {
        await audioContext.resume();
      }

      const bpm = project.timelineBox.bpm.getValue();
      const fullDurationSeconds = audioBufferRef.current.duration;
      const effectiveDurationSeconds =
        next === "bug"
          ? fullDurationSeconds
          : fullDurationSeconds - WORKAROUND_HEADROOM_SECONDS;

      const fullDurationPPQN = PPQN.secondsToPulses(effectiveDurationSeconds, bpm);
      const fadeOutPPQN = PPQN.secondsToPulses(FADE_OUT_SECONDS, bpm);

      const [region] = getAllAudioRegions(project) as AudioRegionBoxAdapter[];
      if (!region) return;

      project.editing.modify(() => {
        region.box.duration.setValue(fullDurationPPQN);
        region.box.fading.out.setValue(fadeOutPPQN);
      });

      setScenario(next);
      project.engine.setPosition(0);
      project.engine.play();
    },
    [project, audioContext]
  );

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
  }, [project]);

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Fade-Out End-of-File Pop
          </Heading>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              An audible pop fires at the end of a clip whose fade-out ends exactly at the audio
              file's end. The fade math is clean (gain reaches 0 at region end), but{" "}
              <Code>PitchVoice</Code>'s internal end-of-file fade-out kicks in during the last 20 ms
              and bypasses the region's fade gain — the old voice plays at full level into{" "}
              <Code>lane.fadingVoices</Code>, which is processed with a unit gain buffer.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">
                Status:
              </Text>
              <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
                {status}
              </Badge>
              {isPlaying && (
                <Badge color="amber">Playing: {scenario === "bug" ? "BUG" : "WORKAROUND"}</Badge>
              )}
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
                  <strong>Bug:</strong> region duration = full file duration (
                  {audioBufferRef.current
                    ? audioBufferRef.current.duration.toFixed(6)
                    : "..."}{" "}
                  s). Fade-out of {FADE_OUT_SECONDS.toFixed(4)} s ends at region end. Play and
                  listen for a click at the end.
                </Text>
                <Text size="2">
                  <strong>Workaround:</strong> region duration trimmed by{" "}
                  {(WORKAROUND_HEADROOM_SECONDS * 1000).toFixed(0)} ms (
                  {VOICE_FADE_DURATION_SECONDS * 1000}
                  &nbsp;ms <Code>VOICE_FADE_DURATION</Code> + 1 ms safety). Voice's internal
                  end-of-file fade never triggers. No click.
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
                {`BPM:               ${BPM}
File:              Vocals30.mp3 (${
                  audioBufferRef.current ? audioBufferRef.current.duration.toFixed(6) : "?"
                } s)
Fade-out duration: ${FADE_OUT_SECONDS.toFixed(10)} s (${PPQN.secondsToPulses(
                  FADE_OUT_SECONDS,
                  BPM
                ).toFixed(4)} PPQN)
Fade-out slope:    0.5 (linear)
Region position:   0
Region duration:   bug=fileDuration | workaround=fileDuration − ${(
                  WORKAROUND_HEADROOM_SECONDS * 1000
                ).toFixed(0)} ms`}
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
                Render the project to an <Code>AudioBuffer</Code> and scan the last 20 ms with a
                sample-to-sample delta detector. In the bug case, you'll find a one-sample step on
                the order of 0.1 around sample{" "}
                <Code>numberOfFrames − VOICE_FADE_DURATION × sampleRate</Code>, followed by
                near-full-amplitude audio until region end. In the workaround case, the same window
                is monotonically descending to ~0.
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
