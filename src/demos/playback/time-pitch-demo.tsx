import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { TransientPlayMode } from "@opendaw/studio-enums";
import {
  AudioFileBox,
  AudioRegionBox,
  AudioPitchStretchBox,
  AudioTimeStretchBox,
  TransientMarkerBox,
  ValueEventCollectionBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { loadAudioFile } from "@/lib/audioUtils";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Button,
  Callout,
  Badge,
  Separator,
  Slider,
  Code,
  SegmentedControl,
} from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";

type PlayMode = "none" | "pitch" | "time";

const SAMPLE_PATH = "/audio/BassDrums30.mp3";
const SAMPLE_NAME = "BassDrums30";
const PROJECT_BPM = 120;

function TimePitchDemo() {
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);

  const [playMode, setPlayMode] = useState<PlayMode>("none");
  const [cents, setCents] = useState(0);
  const [transientMode, setTransientMode] = useState<TransientPlayMode>(
    TransientPlayMode.Pingpong
  );

  const regionRef = useRef<AudioRegionBox | null>(null);
  const audioFileBoxRef = useRef<AudioFileBox | null>(null);
  const stretchBoxRef = useRef<
    AudioPitchStretchBox | AudioTimeStretchBox | null
  >(null);
  const durationSecondsRef = useRef(0);
  const durationPpqnRef = useRef(0);

  const { isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  const [localAudioBuffers] = useState(() => new Map<string, AudioBuffer>());

  // ---- Init project + load sample + create region (NoStretch by default)
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        setStatus("Booting OpenDAW...");
        const { project: newProject, audioContext: newAudioContext } =
          await initializeOpenDAW({ localAudioBuffers, bpm: PROJECT_BPM });
        if (cancelled) return;

        setStatus("Loading audio file...");
        const audioBuffer = await loadAudioFile(newAudioContext, SAMPLE_PATH);
        const fileUuid = UUID.generate();
        localAudioBuffers.set(UUID.toString(fileUuid), audioBuffer);

        const durationSeconds = audioBuffer.duration;
        const durationPpqn = Math.round(
          PPQN.secondsToPulses(durationSeconds, PROJECT_BPM)
        );
        durationSecondsRef.current = durationSeconds;
        durationPpqnRef.current = durationPpqn;

        newProject.editing.modify(() => {
          const { trackBox } = newProject.api.createInstrument(
            InstrumentFactories.Tape
          );

          const audioFileBox = AudioFileBox.create(
            newProject.boxGraph,
            fileUuid,
            (box) => {
              box.fileName.setValue(SAMPLE_NAME);
              box.endInSeconds.setValue(durationSeconds);
            }
          );
          audioFileBoxRef.current = audioFileBox;

          const events = ValueEventCollectionBox.create(
            newProject.boxGraph,
            UUID.generate()
          );

          const region = AudioRegionBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (box) => {
              box.regions.refer(trackBox.regions);
              box.file.refer(audioFileBox);
              box.events.refer(events.owners);
              box.position.setValue(0);
              box.duration.setValue(durationSeconds);
              box.loopDuration.setValue(durationSeconds);
              box.timeBase.setValue(TimeBase.Seconds);
              box.label.setValue(SAMPLE_NAME);
            }
          );
          regionRef.current = region;
        });

        await newProject.engine.queryLoadingComplete();
        if (cancelled) return;

        setProject(newProject);
        setAudioContext(newAudioContext);
        setStatus("Ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("Failed");
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [localAudioBuffers]);

  // ---- Mode switch: tears down old stretch box, builds new one with default warp markers
  const switchMode = useCallback(
    (nextMode: PlayMode) => {
      if (!project || !regionRef.current) return;

      const region = regionRef.current;
      const audioFileBox = audioFileBoxRef.current!;
      const durationPpqn = durationPpqnRef.current;
      const durationSeconds = durationSecondsRef.current;

      // Transaction 1: detach old play-mode (if any) and flip timebase if needed.
      project.editing.modify(() => {
        const prev = stretchBoxRef.current;
        if (prev) {
          region.playMode.defer();
          prev.delete();
          stretchBoxRef.current = null;
        }

        if (nextMode === "none") {
          region.timeBase.setValue(TimeBase.Seconds);
          region.duration.setValue(durationSeconds);
          region.loopOffset.setValue(0);
          region.loopDuration.setValue(durationSeconds);
        } else {
          region.timeBase.setValue(TimeBase.Musical);
          region.duration.setValue(durationPpqn);
          region.loopOffset.setValue(0);
          region.loopDuration.setValue(durationPpqn);
        }
      });

      if (nextMode === "none") {
        setPlayMode("none");
        setCents(0);
        return;
      }

      // Transaction 2: create the new stretch box + warp markers + attach.
      // Split from transaction 1 so the previous play-mode pointer is fully
      // disconnected before we route the new one (see Ch. 18 caveat).
      project.editing.modify(() => {
        const boxGraph = project.boxGraph;
        let nextBox: AudioPitchStretchBox | AudioTimeStretchBox;

        if (nextMode === "pitch") {
          nextBox = AudioPitchStretchBox.create(boxGraph, UUID.generate());
        } else {
          nextBox = AudioTimeStretchBox.create(boxGraph, UUID.generate(), (b) => {
            b.transientPlayMode.setValue(transientMode);
            b.playbackRate.setValue(1.0);
          });
        }
        stretchBoxRef.current = nextBox;

        // Two warp markers: 0 → 0, durationPpqn → durationSeconds.
        WarpMarkerBox.create(boxGraph, UUID.generate(), (m) => {
          m.owner.refer(nextBox.warpMarkers);
          m.position.setValue(0);
          m.seconds.setValue(0);
        });
        WarpMarkerBox.create(boxGraph, UUID.generate(), (m) => {
          m.owner.refer(nextBox.warpMarkers);
          m.position.setValue(durationPpqn);
          m.seconds.setValue(durationSeconds);
        });

        // TimeStretch needs transient markers on the file.
        if (nextMode === "time" && audioFileBox.transientMarkers.pointerHub.incoming().length === 0) {
          // Sparse fallback markers — one per beat at PROJECT_BPM.
          // In a real app, run onset detection (see Ch. 18).
          const beatSeconds = 60 / PROJECT_BPM;
          for (let t = 0; t < durationSeconds; t += beatSeconds) {
            TransientMarkerBox.create(boxGraph, UUID.generate(), (m) => {
              m.owner.refer(audioFileBox.transientMarkers);
              m.position.setValue(t);
            });
          }
        }

        region.playMode.refer(nextBox);
      });

      setPlayMode(nextMode);
      setCents(0);
    },
    [project, transientMode]
  );

  // ---- Cents slider (TimeStretch only)
  const onCentsChange = useCallback(
    (value: number) => {
      setCents(value);
      if (!project) return;
      const box = stretchBoxRef.current;
      if (!box || !(box instanceof AudioTimeStretchBox)) return;
      project.editing.modify(() => {
        const rate = Math.min(2.0, Math.max(0.5, Math.pow(2, value / 1200)));
        box.playbackRate.setValue(rate);
      });
    },
    [project]
  );

  // ---- Transient play mode (TimeStretch only)
  const onTransientModeChange = useCallback(
    (mode: TransientPlayMode) => {
      setTransientMode(mode);
      if (!project) return;
      const box = stretchBoxRef.current;
      if (!box || !(box instanceof AudioTimeStretchBox)) return;
      project.editing.modify(() => {
        box.transientPlayMode.setValue(mode);
      });
    },
    [project]
  );

  const playbackRate = Math.pow(2, cents / 1200);

  return (
    <Theme appearance="dark" accentColor="iris" radius="medium">
      <Container size="3" px={{ initial: "4", sm: "6" }} py="6">
        <GitHubCorner />
        <Flex direction="column" gap="5">
          <Flex direction="column" gap="2">
            <BackLink />
            <Heading size="7">Time &amp; Pitch Demo</Heading>
            <Text color="gray">
              Switch a region between the three audio play modes and hear what
              changes. Source for the chapter at{" "}
              <a href="https://opendaw-test.pages.dev/docs/18-time-and-pitch.html">
                docs/18-time-and-pitch
              </a>
              .
            </Text>
          </Flex>

          {error && (
            <Callout.Root color="red">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}

          <Card>
            <Flex direction="column" gap="4" p="3">
              <Flex justify="between" align="center">
                <Heading size="4">Play Mode</Heading>
                <Badge color={status === "Ready" ? "green" : "gray"}>{status}</Badge>
              </Flex>

              <SegmentedControl.Root
                value={playMode}
                onValueChange={(v) => switchMode(v as PlayMode)}
                size="3"
              >
                <SegmentedControl.Item value="none">NoStretch</SegmentedControl.Item>
                <SegmentedControl.Item value="pitch">PitchStretch</SegmentedControl.Item>
                <SegmentedControl.Item value="time">TimeStretch</SegmentedControl.Item>
              </SegmentedControl.Root>

              <Text size="2" color="gray">
                {playMode === "none" && (
                  <>
                    Default playback. No play-mode box attached, <Code>timeBase = Seconds</Code>.
                    BPM changes leave the audio alone.
                  </>
                )}
                {playMode === "pitch" && (
                  <>
                    <Code>AudioPitchStretchBox</Code> attached with two warp markers.
                    Change the BPM and the audio follows — pitch tracks tempo (varispeed).
                  </>
                )}
                {playMode === "time" && (
                  <>
                    <Code>AudioTimeStretchBox</Code> with transient markers. Pitch is
                    independent — drag the cents slider. Tempo changes don't shift pitch.
                  </>
                )}
              </Text>

              {playMode === "time" && (
                <>
                  <Separator size="4" />
                  <Flex direction="column" gap="2">
                    <Flex justify="between">
                      <Text weight="medium">Pitch (cents)</Text>
                      <Text color="gray">
                        {cents > 0 ? "+" : ""}
                        {cents} cents · rate {playbackRate.toFixed(3)}×
                      </Text>
                    </Flex>
                    <Slider
                      value={[cents]}
                      onValueChange={([v]) => onCentsChange(v)}
                      min={-1200}
                      max={1200}
                      step={50}
                    />
                    <Text size="1" color="gray">
                      Range ±1200 cents (±1 octave). The setter clamps <Code>playbackRate</Code>
                      to <Code>[0.5, 2.0]</Code>.
                    </Text>
                  </Flex>

                  <Flex direction="column" gap="2">
                    <Text weight="medium">Transient play mode</Text>
                    <SegmentedControl.Root
                      value={String(transientMode)}
                      onValueChange={(v) =>
                        onTransientModeChange(Number(v) as TransientPlayMode)
                      }
                    >
                      <SegmentedControl.Item value={String(TransientPlayMode.Once)}>
                        Once
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value={String(TransientPlayMode.Repeat)}>
                        Repeat
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value={String(TransientPlayMode.Pingpong)}>
                        Pingpong
                      </SegmentedControl.Item>
                    </SegmentedControl.Root>
                  </Flex>
                </>
              )}
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3" p="3">
              <Heading size="4">Transport</Heading>
              <Flex gap="2">
                <Button
                  onClick={handlePlay}
                  disabled={!project || isPlaying}
                  color="green"
                >
                  Play
                </Button>
                <Button onClick={handlePause} disabled={!project || !isPlaying}>
                  Pause
                </Button>
                <Button
                  onClick={handleStop}
                  disabled={!project}
                  variant="soft"
                  color="gray"
                >
                  Stop
                </Button>
              </Flex>
              <Text size="2" color="gray">
                Sample: <Code>{SAMPLE_PATH}</Code> · Project BPM {PROJECT_BPM}.
                The drum loop is the easiest material to hear the difference
                between PitchStretch and TimeStretch.
              </Text>
            </Flex>
          </Card>

          <Callout.Root>
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              This demo uses a sparse 1-beat fallback grid for transient markers
              instead of real onset detection. It works for the included drum
              loop but for music material you should run OpenDAW's transient
              worker. See{" "}
              <a href="https://opendaw-test.pages.dev/docs/18-time-and-pitch.html#timestretch-transient-aware-independent-pitch">
                Ch. 18 → Transient Markers Are Required
              </a>
              .
            </Callout.Text>
          </Callout.Root>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<TimePitchDemo />);
