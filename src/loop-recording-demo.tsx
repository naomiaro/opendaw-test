import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { Project, AudioDevices } from "@opendaw/studio-core";
import type { SampleLoader } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { PPQN } from "@opendaw/lib-dsp";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import type { TrackBox } from "@opendaw/studio-boxes";
import { CanvasPainter } from "./lib/CanvasPainter";
import { initializeOpenDAW } from "./lib/projectSetup";
import { useEnginePreference, CountInBarsValue } from "./hooks/useEnginePreference";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { BpmControl } from "./components/BpmControl";
import { RecordingPreferences } from "./components/RecordingPreferences";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Button,
  Flex,
  Card,
  Checkbox,
  Select,
  Callout,
  Separator,
  Badge,
  Code,
  Slider,
  TextField,
} from "@radix-ui/themes";

type TakeInfo = {
  label: string;
  regionBox: AudioRegionBox;
  trackBox: TrackBox | null;
  isMuted: boolean;
  peaks: null;
  sampleLoader: SampleLoader | null;
  waveformOffsetFrames: number; // frames to skip (count-in + prior takes)
  durationFrames: number; // take duration in frames
};

/**
 * TakeWaveform - renders a mini waveform for a single take
 */
const TakeWaveform: React.FC<{
  take: TakeInfo;
  width: number;
  height: number;
}> = ({ take, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const painterRef = useRef<CanvasPainter | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const painter = new CanvasPainter(canvas, (_, context) => {
      context.fillStyle = take.isMuted ? "#1a1a2e" : "#0a0a1a";
      context.fillRect(0, 0, width, height);

      if (!take.sampleLoader) return;

      const peaksOption = take.sampleLoader.peaks;
      if (!peaksOption || peaksOption.isEmpty()) return;

      const peaks = peaksOption.unwrap();
      const isPeaksWriter = "dataIndex" in peaks;

      // u0 = skip count-in + prior takes' frames in the shared recording buffer
      const u0 = take.waveformOffsetFrames;
      // u1 = end of this take's audio in the buffer
      const u1 = isPeaksWriter
        ? peaks.dataIndex[0] * peaks.unitsEachPeak()
        : u0 + take.durationFrames;

      if (u1 <= u0) return; // nothing to render yet

      context.fillStyle = take.isMuted ? "#555577" : "#4a9eff";
      const numChannels = peaks.numChannels;
      const channelHeight = height / numChannels;

      for (let ch = 0; ch < numChannels; ch++) {
        PeaksPainter.renderBlocks(context, peaks, ch, {
          x0: 0, x1: width,
          y0: ch * channelHeight + 1,
          y1: (ch + 1) * channelHeight - 1,
          u0, u1,
          v0: -1, v1: 1,
        });
      }
    });

    painterRef.current = painter;

    // Refresh periodically during recording
    const animSub = AnimationFrame.add(() => painter.requestUpdate());

    return () => {
      animSub.terminate();
      painter.terminate();
    };
  }, [take, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width, height, display: "block",
        borderRadius: 4,
        opacity: take.isMuted ? 0.5 : 1,
      }}
    />
  );
};

/**
 * TakeCard - displays a single take with waveform and controls
 */
const TakeCard: React.FC<{
  take: TakeInfo;
  project: Project;
  isActive: boolean;
  onToggleMute: () => void;
}> = ({ take, project, isActive, onToggleMute }) => {
  return (
    <Flex
      align="center"
      gap="3"
      style={{
        padding: "8px 12px",
        borderLeft: isActive ? "3px solid var(--accent-9)" : "3px solid transparent",
        background: isActive ? "var(--accent-2)" : "transparent",
      }}
    >
      <Flex direction="column" gap="1" style={{ minWidth: 80 }}>
        <Text size="2" weight={isActive ? "bold" : "medium"}>
          {take.label}
        </Text>
        <Badge color={take.isMuted ? "gray" : "green"} size="1">
          {take.isMuted ? "Muted" : "Active"}
        </Badge>
      </Flex>

      <div style={{ flex: 1 }}>
        <TakeWaveform take={take} width={400} height={50} />
      </div>

      <Button
        size="1"
        color={take.isMuted ? "gray" : "red"}
        variant={take.isMuted ? "soft" : "solid"}
        onClick={onToggleMute}
        style={{ width: 32, height: 24, padding: 0, fontSize: 12, fontWeight: "bold" }}
      >
        M
      </Button>
    </Flex>
  );
};

/**
 * Main Loop Recording & Takes Demo App
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);

  // Takes
  const [takes, setTakes] = useState<TakeInfo[]>([]);
  const [takeCount, setTakeCount] = useState(0);
  const [loopIteration, setLoopIteration] = useState(0);

  // Settings
  const [useCountIn, setUseCountIn] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [loopBars, setLoopBars] = useState(2);

  // Takes preferences
  const [allowTakes, setAllowTakes] = useState(true);
  const [olderTakeAction, setOlderTakeAction] = useState<"mute-region" | "disable-track">("mute-region");
  const [olderTakeScope, setOlderTakeScope] = useState<"all" | "previous-only">("previous-only");

  // Engine preferences
  const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(project, ["metronome", "enabled"]);
  const [countInBars, setCountInBars] = useEnginePreference(project, ["recording", "countInBars"]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;
    let animSub: Terminable | null = null;

    (async () => {
      try {
        const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
          onStatusUpdate: setStatus,
        });

        if (!mounted) return;

        setAudioContext(ctx);
        setProject(newProject);
        setStatus("Ready!");

        // Set up loop area for recording
        const loopEnd = PPQN.Quarter * 4 * 2; // 2 bars in 4/4
        newProject.editing.modify(() => {
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(loopEnd);
          newProject.timelineBox.loopArea.enabled.setValue(true);
        });

        // Enable takes by default
        const settings = newProject.engine.preferences.settings;
        settings.recording.allowTakes = true;
        settings.recording.olderTakeAction = "mute-region";
        settings.recording.olderTakeScope = "previous-only";

        // Subscribe to engine state
        newProject.engine.isRecording.catchupAndSubscribe(obs => {
          if (mounted) setIsRecording(obs.getValue());
        });
        newProject.engine.isPlaying.catchupAndSubscribe(obs => {
          if (mounted) setIsPlaying(obs.getValue());
        });
        newProject.engine.isCountingIn.catchupAndSubscribe(obs => {
          if (mounted) setIsCountingIn(obs.getValue());
        });

        animSub = AnimationFrame.add(() => {
          if (mounted) setCurrentPosition(newProject.engine.position.getValue());
        });

        // Enable metronome by default for loop recording
        setMetronomeEnabled(true);
      } catch (error) {
        console.error("Init error:", error);
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => { mounted = false; animSub?.terminate(); };
  }, []);

  // Sync settings to project
  useEffect(() => {
    if (!project) return;
    project.editing.modify(() => { project.timelineBox.bpm.setValue(bpm); });
  }, [project, bpm]);

  // Update loop area when loopBars changes
  useEffect(() => {
    if (!project) return;
    const loopEnd = PPQN.Quarter * 4 * loopBars; // Assuming 4/4 time
    project.editing.modify(() => {
      project.timelineBox.loopArea.from.setValue(0);
      project.timelineBox.loopArea.to.setValue(loopEnd);
    });
  }, [project, loopBars]);

  // Sync takes preferences
  useEffect(() => {
    if (!project) return;
    const settings = project.engine.preferences.settings;
    settings.recording.allowTakes = allowTakes;
    settings.recording.olderTakeAction = olderTakeAction;
    settings.recording.olderTakeScope = olderTakeScope;
  }, [project, allowTakes, olderTakeAction, olderTakeScope]);

  // Scan for takes in the box graph
  const scanTakes = useCallback(() => {
    if (!project || !audioContext) return;

    const sampleRate = audioContext.sampleRate;
    const allBoxes = project.boxGraph.boxes();
    const foundTakes: TakeInfo[] = [];

    for (const box of allBoxes) {
      if (box.name === "AudioRegionBox") {
        const regionBox = box as AudioRegionBox;
        const label = regionBox.label.getValue();
        if (label.startsWith("Take ")) {
          const isMuted = regionBox.mute.getValue();

          // waveformOffset (seconds) tells us where this take starts in the shared buffer
          const waveformOffsetSec = regionBox.waveformOffset.getValue();
          const waveformOffsetFrames = Math.round(waveformOffsetSec * sampleRate);

          // duration (seconds, since TimeBase is Seconds for recordings)
          const durationSec = regionBox.duration.getValue();
          const durationFrames = Math.round(durationSec * sampleRate);

          // Get sample loader for peaks
          let loader: SampleLoader | null = null;
          const fileVertex = regionBox.file.targetVertex;
          if (!fileVertex.isEmpty()) {
            const vertex = fileVertex.unwrap();
            loader = project.sampleManager.getOrCreate(vertex.address.uuid);
          }

          // Find the track this region belongs to
          const trackVertex = regionBox.regions.targetVertex;
          const trackBox = !trackVertex.isEmpty() ? trackVertex.unwrap().box as TrackBox : null;

          foundTakes.push({
            label,
            regionBox,
            trackBox,
            isMuted,
            peaks: null,
            sampleLoader: loader,
            waveformOffsetFrames,
            durationFrames,
          });
        }
      }
    }

    // Sort by take number
    foundTakes.sort((a, b) => {
      const numA = parseInt(a.label.replace("Take ", ""));
      const numB = parseInt(b.label.replace("Take ", ""));
      return numA - numB;
    });

    setTakes(foundTakes);
    setTakeCount(foundTakes.length);
  }, [project, audioContext]);

  // Monitor for new takes during recording
  useEffect(() => {
    if (!project) return;

    const sub = AnimationFrame.add(() => {
      if (isRecording || !isPlaying) {
        scanTakes();
      }
    });

    return () => sub.terminate();
  }, [project, isRecording, isPlaying, scanTakes]);

  // Recording handlers
  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();

    // Request microphone
    try {
      await AudioDevices.requestPermission();
    } catch (error) {
      console.error("Mic error:", error);
      return;
    }

    // Enable loop for takes recording
    project.editing.modify(() => {
      project.timelineBox.loopArea.enabled.setValue(true);
    });

    project.engine.setPosition(0);
    project.startRecording(useCountIn);
  }, [project, audioContext, useCountIn]);

  const handleStopRecording = useCallback(() => {
    if (!project) return;
    // Use stopRecording() instead of stop(true). stop(true) kills the audio graph
    // (preventing the last take from finalizing) and resets position to 0 (which
    // triggers spurious loop-wrap detection, muting the last take).
    project.engine.stopRecording();

    // Find the recording's sampleLoader via any Take region so we can wait
    // for finalization (all takes share one AudioFileBox / sampleLoader).
    let loader: SampleLoader | null = null;
    for (const box of project.boxGraph.boxes()) {
      if (box.name === "AudioRegionBox") {
        const regionBox = box as AudioRegionBox;
        const label = regionBox.label.getValue();
        if (label.startsWith("Take ")) {
          const fileVertex = regionBox.file.targetVertex;
          if (!fileVertex.isEmpty()) {
            const vertex = fileVertex.unwrap();
            loader = project.sampleManager.getOrCreate(vertex.address.uuid);
            break;
          }
        }
      }
    }

    if (loader) {
      // Subscribe to loaded state — fires when recording data is finalized.
      // If already loaded (e.g., short recording), fires immediately.
      const sub = loader.subscribe((state) => {
        if (state.type === "loaded") {
          sub.terminate();
          project.engine.stop(true);
          scanTakes();
        }
      });
    } else {
      // No take regions found (edge case) — stop engine directly
      project.engine.stop(true);
      scanTakes();
    }
  }, [project, scanTakes]);

  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();
    await project.engine.queryLoadingComplete();
    project.engine.stop(true);
    project.engine.play();
  }, [project, audioContext]);

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
  }, [project]);

  const handleToggleTakeMute = useCallback((take: TakeInfo) => {
    if (!project) return;
    project.editing.modify(() => {
      const currentMute = take.regionBox.mute.getValue();
      take.regionBox.mute.setValue(!currentMute);
    });
    scanTakes();
  }, [project, scanTakes]);

  const handleClearTakes = useCallback(() => {
    if (!project) return;
    project.editing.modify(() => {
      const allBoxes = project.boxGraph.boxes();
      for (const box of allBoxes) {
        if (box.name === "AudioRegionBox") {
          const regionBox = box as AudioRegionBox;
          const label = regionBox.label.getValue();
          if (label.startsWith("Take ")) {
            regionBox.delete();
          }
        }
      }
    });
    setTakes([]);
    setTakeCount(0);
  }, [project]);

  const loopEnd = PPQN.Quarter * 4 * loopBars;
  const timeInSeconds = PPQN.pulsesToSeconds(currentPosition, bpm);
  const loopProgress = loopEnd > 0 ? (currentPosition % loopEnd) / loopEnd : 0;

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="amber" radius="large">
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <Heading size="8">Loop Recording & Takes</Heading>
            <Text size="3" color="gray">{status}</Text>
          </Flex>
        </Container>
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="amber" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <BackLink />

          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Loop Recording & Takes</Heading>
            <Text size="3" color="gray">
              Record multiple takes over a loop region with automatic take management
            </Text>
          </Flex>

          <Callout.Root color="amber">
            <Callout.Text>
              This demo shows <strong>loop recording with takes</strong>. When loop mode is enabled and
              <Code size="1">allowTakes</Code> is true, each loop iteration creates a new take
              (labeled "Take N") on a separate track. Previous takes are automatically handled
              based on the <Code size="1">olderTakeAction</Code> (mute or disable) and <Code size="1">olderTakeScope</Code> (which takes are affected) preferences.
            </Callout.Text>
          </Callout.Root>

          {/* Loop & Recording Setup */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Setup</Heading>
              <Flex gap="4" wrap="wrap" align="center">
                <BpmControl value={bpm} onChange={setBpm} disabled={isRecording} />
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">Loop Length:</Text>
                  <Select.Root
                    value={loopBars.toString()}
                    onValueChange={v => setLoopBars(Number(v))}
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 100 }} />
                    <Select.Content>
                      <Select.Item value="1">1 bar</Select.Item>
                      <Select.Item value="2">2 bars</Select.Item>
                      <Select.Item value="4">4 bars</Select.Item>
                      <Select.Item value="8">8 bars</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <RecordingPreferences
                  useCountIn={useCountIn}
                  onUseCountInChange={setUseCountIn}
                  metronomeEnabled={metronomeEnabled}
                  onMetronomeEnabledChange={setMetronomeEnabled}
                />
              </Flex>
            </Flex>
          </Card>

          {/* Takes Preferences */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Takes Preferences</Heading>
              <Flex gap="4" wrap="wrap" align="center">
                <Flex asChild align="center" gap="2">
                  <Text as="label" size="2">
                    <Checkbox
                      checked={allowTakes}
                      onCheckedChange={c => setAllowTakes(c === true)}
                      disabled={isRecording}
                    />
                    Allow takes (loop recording)
                  </Text>
                </Flex>
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">Older Take Action:</Text>
                  <Select.Root
                    value={olderTakeAction}
                    onValueChange={v => setOlderTakeAction(v as "mute-region" | "disable-track")}
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 150 }} />
                    <Select.Content>
                      <Select.Item value="mute-region">Mute Region</Select.Item>
                      <Select.Item value="disable-track">Disable Track</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">Scope:</Text>
                  <Select.Root
                    value={olderTakeScope}
                    onValueChange={v => setOlderTakeScope(v as "all" | "previous-only")}
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 150 }} />
                    <Select.Content>
                      <Select.Item value="previous-only">Previous Only</Select.Item>
                      <Select.Item value="all">All Previous</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
              </Flex>
              <Text size="1" color="gray">
                {olderTakeScope === "previous-only"
                  ? "Only the most recent take is affected when a new take is recorded. Use this for layering — unmute an older take and it will stay audible through subsequent recordings (e.g., stacking vocal harmonies or guitar parts)."
                  : "All older takes are affected each time a new take is recorded. Use this for comping — keeps a clean slate so you only hear the latest take, even if you unmuted older ones."}
              </Text>
            </Flex>
          </Card>

          {/* Transport & Loop Progress */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Transport</Heading>

              <Callout.Root color="orange">
                <Callout.Text>
                  Press <strong>Record</strong> and perform over the loop. Each time the loop wraps,
                  a new take is created. Stop recording when satisfied and compare takes below.
                </Callout.Text>
              </Callout.Root>

              <Flex gap="3" wrap="wrap" justify="center">
                <Button
                  onClick={handleStartRecording}
                  color="red"
                  size="3"
                  variant="solid"
                  disabled={isRecording || isCountingIn || isPlaying}
                >
                  Record
                </Button>
                <Button
                  onClick={handlePlay}
                  disabled={isRecording || isCountingIn || isPlaying || takes.length === 0}
                  color="green"
                  size="3"
                  variant="solid"
                >
                  Play
                </Button>
                <Button
                  onClick={isRecording ? handleStopRecording : handleStop}
                  color="gray"
                  size="3"
                  variant="solid"
                >
                  Stop
                </Button>
                <Button
                  onClick={handleClearTakes}
                  color="red"
                  size="1"
                  variant="ghost"
                  disabled={isRecording || takes.length === 0}
                >
                  Clear All Takes
                </Button>
              </Flex>

              <Flex justify="center" gap="3" align="center">
                {isRecording && <Badge color="red" size="2">Recording</Badge>}
                {isCountingIn && <Badge color="amber" size="2">Count-in</Badge>}
                {isPlaying && !isRecording && <Badge color="green" size="2">Playing</Badge>}
                <Badge color="blue" size="1">
                  {takeCount} take{takeCount !== 1 ? "s" : ""}
                </Badge>
                <Text size="2" style={{ fontFamily: "monospace" }}>
                  {timeInSeconds.toFixed(2)}s
                </Text>
              </Flex>

              {/* Loop progress bar */}
              {(isRecording || isPlaying) && (
                <div style={{
                  width: "100%", height: 6,
                  background: "var(--gray-4)", borderRadius: 3,
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${loopProgress * 100}%`, height: "100%",
                    background: isRecording ? "var(--red-9)" : "var(--green-9)",
                    transition: "width 0.05s linear",
                  }} />
                </div>
              )}
            </Flex>
          </Card>

          {/* Takes List */}
          {takes.length > 0 && (
            <Card>
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center">
                  <Heading size="5">Takes</Heading>
                  <Text size="2" color="gray">
                    Mute/unmute takes to compare performances
                  </Text>
                </Flex>
                <Separator size="4" />
                {takes.map((take, i) => (
                  <div key={take.label} style={{ borderTop: i > 0 ? "1px solid var(--gray-5)" : undefined }}>
                    <TakeCard
                      take={take}
                      project={project}
                      isActive={!take.isMuted}
                      onToggleMute={() => handleToggleTakeMute(take)}
                    />
                  </div>
                ))}
              </Flex>
            </Card>
          )}

          {/* API Reference */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="5">API Reference</Heading>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">Enable Takes:</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`const settings = project.engine.preferences.settings;
settings.recording.allowTakes = true;
settings.recording.olderTakeAction = "mute-region";
settings.recording.olderTakeScope = "previous-only";`}
                </Code>

                <Text size="2" weight="bold" style={{ marginTop: 8 }}>Loop Area Setup:</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`project.editing.modify(() => {
  project.timelineBox.loopArea.from.setValue(0);
  project.timelineBox.loopArea.to.setValue(
    PPQN.Quarter * 4 * numBars
  );
  project.timelineBox.loopArea.enabled.setValue(true);
});`}
                </Code>

                <Text size="2" weight="bold" style={{ marginTop: 8 }}>Finding Takes:</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`// Takes are labeled "Take 1", "Take 2", etc.
const takes = project.boxGraph.boxes()
  .filter(box => box.name === "AudioRegionBox")
  .filter(box => box.label?.getValue()
    ?.startsWith("Take "));

// Toggle mute on a take
project.editing.modify(() => {
  takeRegionBox.mute.setValue(!isMuted);
});`}
                </Code>
              </Flex>
            </Flex>
          </Card>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
