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
  ValueEventCollectionBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { loadAudioFile } from "@/lib/audioUtils";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { ensureTransientMarkers } from "@/lib/transientDetection";
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
  const [bpm, setBpm] = useState(PROJECT_BPM);
  const [transientMode, setTransientMode] = useState<TransientPlayMode>(
    TransientPlayMode.Pingpong
  );
  const [transientCount, setTransientCount] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);

  const regionRef = useRef<AudioRegionBox | null>(null);
  const audioFileBoxRef = useRef<AudioFileBox | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const stretchBoxRef = useRef<
    AudioPitchStretchBox | AudioTimeStretchBox | null
  >(null);
  const durationSecondsRef = useRef(0);
  const durationPpqnRef = useRef(0);
  // Re-entrancy guard: the SegmentedControl can fire onValueChange faster than
  // async transient detection completes. State-based guards have a stale closure;
  // a ref is read fresh on every invocation.
  const switchingRef = useRef(false);

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
        audioBufferRef.current = audioBuffer;

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
    async (nextMode: PlayMode) => {
      if (!project || !regionRef.current || !audioBufferRef.current) return;

      const region = regionRef.current;
      const audioFileBox = audioFileBoxRef.current!;
      const audioBuffer = audioBufferRef.current;
      const durationPpqn = durationPpqnRef.current;
      const durationSeconds = durationSecondsRef.current;

      switchingRef.current = true;
      setSwitching(true);
      try {
        // For TimeStretch, make sure the file has transient markers BEFORE we
        // attach the play-mode box. ensureTransientMarkers throws if detection
        // returns 0 positions, so the engine never silently renders nothing.
        if (nextMode === "time") {
          setStatus("Detecting transients...");
          const positions = await ensureTransientMarkers(
            project,
            audioFileBox,
            audioBuffer
          );
          setTransientCount(positions.length);
        } else {
          setTransientCount(null);
        }

        // Single transaction, matching the SDK's AudioContentModifier pattern:
        // create new → refer (replaces old pointer) → delete old → flip timeBase.
        // `refer` doesn't require a prior `defer` — it replaces atomically.
        project.editing.modify(() => {
          const prev = stretchBoxRef.current;

          if (nextMode === "none") {
            region.playMode.defer();
            if (prev) prev.delete();
            stretchBoxRef.current = null;
            region.timeBase.setValue(TimeBase.Seconds);
            region.duration.setValue(durationSeconds);
            region.loopOffset.setValue(0);
            region.loopDuration.setValue(durationSeconds);
            return;
          }

          const boxGraph = project.boxGraph;
          const nextBox =
            nextMode === "pitch"
              ? AudioPitchStretchBox.create(boxGraph, UUID.generate())
              : AudioTimeStretchBox.create(boxGraph, UUID.generate(), (b) => {
                  b.transientPlayMode.setValue(transientMode);
                  b.playbackRate.setValue(1.0);
                });

          // Default warp markers: 0 → 0, durationPpqn → durationSeconds.
          // The studio app's AudioContentModifier preserves the old box's markers
          // across swaps; this demo recreates defaults for simplicity.
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

          // Re-route the region pointer to the new box, then delete the old one.
          // `refer` replaces the existing target cleanly — no `defer` needed first.
          region.playMode.refer(nextBox);
          if (prev) prev.delete();
          stretchBoxRef.current = nextBox;

          region.timeBase.setValue(TimeBase.Musical);
          region.duration.setValue(durationPpqn);
          region.loopOffset.setValue(0);
          region.loopDuration.setValue(durationPpqn);
        });

        setPlayMode(nextMode);
        setCents(0);
        setStatus("Ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed");
        // Reconcile UI ↔ box state: the editing.modify above is atomic, so on
        // failure the box graph is unchanged. Drop UI back to the mode it was
        // actually in by reading stretchBoxRef (untouched on throw).
        const current = stretchBoxRef.current;
        if (current === null) setPlayMode("none");
        else if (current instanceof AudioTimeStretchBox) setPlayMode("time");
        else setPlayMode("pitch");
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [project, transientMode]
  );

  // ---- Cents slider (TimeStretch only)
  const onCentsChange = useCallback(
    (value: number) => {
      if (!project) return;
      const box = stretchBoxRef.current;
      if (!box || !(box instanceof AudioTimeStretchBox)) return;
      // ±1200 cents clamp lives in the adapter; we mirror it here to keep the
      // box-graph field within the adapter's expected range.
      const rate = Math.min(2.0, Math.max(0.5, Math.pow(2, value / 1200)));
      project.editing.modify(() => {
        box.playbackRate.setValue(rate);
      });
      setCents(value);
    },
    [project]
  );

  // ---- Transient play mode (TimeStretch only)
  const onTransientModeChange = useCallback(
    (mode: TransientPlayMode) => {
      if (!project) return;
      const box = stretchBoxRef.current;
      if (!box || !(box instanceof AudioTimeStretchBox)) {
        // Not in TimeStretch mode — keep the UI state in sync but no-op the box.
        setTransientMode(mode);
        return;
      }
      project.editing.modify(() => {
        box.transientPlayMode.setValue(mode);
      });
      setTransientMode(mode);
    },
    [project]
  );

  // ---- BPM (visible in all modes — this is the control that reveals what each mode does)
  const onBpmChange = useCallback(
    (value: number) => {
      if (!project) return;
      project.editing.modify(() => {
        project.timelineBox.bpm.setValue(value);
      });
      setBpm(value);
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

              <div
                style={{
                  opacity: switching || isPlaying ? 0.5 : 1,
                  pointerEvents: switching || isPlaying ? "none" : "auto",
                }}
              >
                <SegmentedControl.Root
                  value={playMode}
                  onValueChange={(v) => {
                    // Belt-and-braces: the ref guards against re-entry even if
                    // the parent's pointer-events block is bypassed.
                    if (switchingRef.current) return;
                    void switchMode(v as PlayMode);
                  }}
                  size="3"
                >
                  <SegmentedControl.Item value="none">NoStretch</SegmentedControl.Item>
                  <SegmentedControl.Item value="pitch">PitchStretch</SegmentedControl.Item>
                  <SegmentedControl.Item value="time">TimeStretch</SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>
              {isPlaying && (
                <Text size="1" color="gray">
                  Stop playback to change mode (avoids mid-stream glitches).
                </Text>
              )}

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
                    <Code>AudioTimeStretchBox</Code> with{" "}
                    {transientCount !== null ? (
                      <>
                        <strong>{transientCount}</strong> transient markers detected by{" "}
                        <Code>Workers.Transients.detect()</Code>
                      </>
                    ) : (
                      <>transient markers</>
                    )}
                    . Pitch is independent — drag the cents slider. Tempo changes
                    don't shift pitch.
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
              <Flex justify="between" align="center">
                <Heading size="4">Project BPM</Heading>
                <Text color="gray">
                  {bpm} BPM
                  {bpm !== PROJECT_BPM && (
                    <> · {((bpm / PROJECT_BPM - 1) * 100).toFixed(0)}% off source</>
                  )}
                </Text>
              </Flex>
              <Slider
                value={[bpm]}
                onValueChange={([v]) => onBpmChange(v)}
                min={60}
                max={200}
                step={1}
                disabled={!project}
              />
              <Text size="2" color="gray">
                {playMode === "none" && (
                  <>
                    <strong>NoStretch:</strong> the file plays at its source speed
                    no matter what the BPM is — the audio "drifts" off the grid.
                  </>
                )}
                {playMode === "pitch" && (
                  <>
                    <strong>PitchStretch:</strong> the file follows the BPM and
                    pitch follows tempo. Raise BPM → faster + pitched up. Drop BPM
                    → slower + pitched down. (Classic tape vari-speed.)
                  </>
                )}
                {playMode === "time" && (
                  <>
                    <strong>TimeStretch:</strong> the file follows the BPM but
                    pitch stays at whatever cents you set — transients are spliced
                    to fill the new wall-clock time.
                  </>
                )}
              </Text>
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
                Sample: <Code>{SAMPLE_PATH}</Code>. The drum loop is the easiest
                material to hear the difference between PitchStretch and TimeStretch.
              </Text>
            </Flex>
          </Card>

          <Callout.Root>
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              First TimeStretch switch runs <Code>Workers.Transients.detect()</Code>{" "}
              on the loaded <Code>AudioBuffer</Code> and writes the detected
              positions to the <Code>AudioFileBox</Code>. Reusable helper at{" "}
              <Code>src/lib/transientDetection.ts</Code> — drop it into any
              project to get a format-agnostic "any file → ready for TimeStretch"
              pipeline. See{" "}
              <a href="https://opendaw-test.pages.dev/docs/18-time-and-pitch.html#transient-markers-are-required">
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
