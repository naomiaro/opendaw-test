import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";
import { useTransportControls } from "./hooks/useTransportControls";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Button,
  Callout, Badge, Separator, Slider, Code
} from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840
const BEAT = BAR / 4; // 960

type LoopPreset = {
  name: string;
  description: string;
  loopDuration: number;
  loopOffset: number;
  duration: number;
};

const PRESETS: LoopPreset[] = [
  {
    name: "2-Bar Loop",
    description: "Classic 2-bar drum loop tiled 4x",
    loopDuration: BAR * 2,
    loopOffset: 0,
    duration: BAR * 8,
  },
  {
    name: "1-Bar Loop",
    description: "Tight 1-bar pattern tiled 8x",
    loopDuration: BAR * 1,
    loopOffset: 0,
    duration: BAR * 8,
  },
  {
    name: "Half-Bar Loop",
    description: "Rapid half-bar repeat",
    loopDuration: BEAT * 2,
    loopOffset: 0,
    duration: BAR * 4,
  },
  {
    name: "Offset Start",
    description: "Loop from bar 3 of the audio",
    loopDuration: BAR * 2,
    loopOffset: BAR * 2,
    duration: BAR * 8,
  },
  {
    name: "Long Loop",
    description: "4-bar phrase tiled 4x",
    loopDuration: BAR * 4,
    loopOffset: 0,
    duration: BAR * 16,
  },
  {
    name: "Full (No Loop)",
    description: "Plays the full stem once",
    loopDuration: -1,
    loopOffset: 0,
    duration: -1,
  },
];

function formatPpqn(ppqn: number): string {
  const bars = Math.floor(ppqn / BAR);
  const beats = Math.floor((ppqn % BAR) / BEAT);
  if (beats === 0) return `${bars} bar${bars !== 1 ? "s" : ""}`;
  return `${bars} bar${bars !== 1 ? "s" : ""} ${beats} beat${beats !== 1 ? "s" : ""}`;
}

function applyLoopSettings(
  project: Project,
  regionBox: AudioRegionBox,
  loopDuration: number,
  loopOffset: number,
  duration: number,
  fullAudioPpqn: number
): void {
  const ld = loopDuration === -1 ? fullAudioPpqn : loopDuration;
  const d = duration === -1 ? fullAudioPpqn : duration;

  project.editing.modify(() => {
    regionBox.loopDuration.setValue(ld);
    regionBox.loopOffset.setValue(loopOffset);
    regionBox.duration.setValue(d);
  });

  project.editing.modify(() => {
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(d);
    project.timelineBox.loopArea.enabled.setValue(true);
    project.timelineBox.durationInPulses.setValue(d);
  });
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [regionBox, setRegionBox] = useState<AudioRegionBox | null>(null);
  const [fullAudioPpqn, setFullAudioPpqn] = useState(0);
  const [activePresetIndex, setActivePresetIndex] = useState(0);

  const [loopDuration, setLoopDuration] = useState(BAR * 2);
  const [loopOffset, setLoopOffset] = useState(0);
  const [duration, setDuration] = useState(BAR * 8);

  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        localAudioBuffersRef.current = localAudioBuffers;

        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });

        if (!mounted) return;
        setAudioContext(newAudioContext);
        setProject(newProject);

        const settings = newProject.engine.preferences.settings;
        settings.metronome.enabled = true;
        settings.metronome.gain = -6;

        const ext = getAudioExtension();
        const tracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [{ name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` }],
          localAudioBuffers,
          { onProgress: (c, t, name) => { if (mounted) setStatus(`Loading ${name}...`); } }
        );

        if (!mounted) return;

        const boxes = newProject.boxGraph.boxes();
        let foundRegion: AudioRegionBox | null = null;
        for (const box of boxes) {
          if (box instanceof AudioRegionBox) {
            foundRegion = box;
            break;
          }
        }

        if (!foundRegion) {
          setStatus("Error: no region found");
          return;
        }

        const audioPpqn = foundRegion.duration.getValue();
        setFullAudioPpqn(audioPpqn);
        setRegionBox(foundRegion);

        const preset = PRESETS[0];
        const ld = preset.loopDuration === -1 ? audioPpqn : preset.loopDuration;
        const d = preset.duration === -1 ? audioPpqn : preset.duration;
        applyLoopSettings(newProject, foundRegion, ld, preset.loopOffset, d, audioPpqn);
        setLoopDuration(ld);
        setLoopOffset(preset.loopOffset);
        setDuration(d);

        if (mounted) setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => { mounted = false; };
  }, []);

  const handlePreset = useCallback((index: number) => {
    if (!project || !regionBox) return;
    if (isPlaying) project.engine.stop(true);

    const preset = PRESETS[index];
    const ld = preset.loopDuration === -1 ? fullAudioPpqn : preset.loopDuration;
    const lo = preset.loopOffset;
    const d = preset.duration === -1 ? fullAudioPpqn : preset.duration;

    applyLoopSettings(project, regionBox, ld, lo, d, fullAudioPpqn);
    setActivePresetIndex(index);
    setLoopDuration(ld);
    setLoopOffset(lo);
    setDuration(d);
  }, [project, regionBox, isPlaying, fullAudioPpqn]);

  const handleLoopDurationCommit = useCallback((value: number[]) => {
    setLoopDuration(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, value[0], loopOffset, duration, fullAudioPpqn);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopOffset, duration, fullAudioPpqn]);

  const handleLoopOffsetCommit = useCallback((value: number[]) => {
    setLoopOffset(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, loopDuration, value[0], duration, fullAudioPpqn);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopDuration, duration, fullAudioPpqn]);

  const handleDurationCommit = useCallback((value: number[]) => {
    setDuration(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, loopDuration, loopOffset, value[0], fullAudioPpqn);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopDuration, loopOffset, fullAudioPpqn]);

  const handleMetronomeToggle = useCallback(() => {
    if (!project) return;
    const next = !metronomeEnabled;
    setMetronomeEnabled(next);
    project.engine.preferences.settings.metronome.enabled = next;
  }, [project, metronomeEnabled]);

  const tileCount = loopDuration > 0 ? Math.ceil(duration / loopDuration) : 1;
  const isReady = status === "Ready";

  return (
    <Theme appearance="dark" accentColor="orange" radius="large">
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Clip Looping</Heading>
            <Text size="3" color="gray">
              Set a loop region within a clip and extend it to tile automatically
            </Text>
          </Flex>

          <Callout.Root color="blue">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              Every region has a <Code>loopDuration</Code> (content that repeats) and a <Code>duration</Code> (total
              visible length). When duration exceeds loopDuration, the content tiles automatically.
              Use <Code>loopOffset</Code> to shift which part of the audio loops.
            </Callout.Text>
          </Callout.Root>

          {!isReady ? (
            <Text align="center">{status}</Text>
          ) : (
            <>
              {/* Presets */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">Presets</Text>
                  <Flex gap="2" wrap="wrap">
                    {PRESETS.map((preset, index) => (
                      <Button
                        key={preset.name}
                        variant={activePresetIndex === index ? "solid" : "outline"}
                        onClick={() => handlePreset(index)}
                      >
                        {preset.name}
                      </Button>
                    ))}
                  </Flex>
                  {activePresetIndex >= 0 && (
                    <Text size="2" color="gray">{PRESETS[activePresetIndex].description}</Text>
                  )}
                </Flex>
              </Card>

              {/* Waveform canvas placeholder — replaced in Task 3 */}
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold" color="gray">Waveform</Text>
                  <div style={{
                    width: "100%",
                    height: 120,
                    backgroundColor: "#1a1a2e",
                    borderRadius: "var(--radius-3)",
                    border: "1px solid var(--gray-6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <Text size="2" color="gray">Waveform canvas (coming next)</Text>
                  </div>
                </Flex>
              </Card>

              {/* Sliders + Info */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">Loop Controls</Text>

                  <Flex direction="column" gap="1">
                    <Flex justify="between">
                      <Text size="2">Loop Duration</Text>
                      <Text size="2" color="gray">{formatPpqn(loopDuration)}</Text>
                    </Flex>
                    <Slider
                      value={[loopDuration]}
                      onValueChange={(v) => setLoopDuration(v[0])}
                      onValueCommit={handleLoopDurationCommit}
                      min={BEAT}
                      max={BAR * 8}
                      step={BEAT}
                    />
                  </Flex>

                  <Flex direction="column" gap="1">
                    <Flex justify="between">
                      <Text size="2">Loop Offset</Text>
                      <Text size="2" color="gray">{formatPpqn(loopOffset)}</Text>
                    </Flex>
                    <Slider
                      value={[loopOffset]}
                      onValueChange={(v) => setLoopOffset(v[0])}
                      onValueCommit={handleLoopOffsetCommit}
                      min={0}
                      max={Math.max(BAR * 8, fullAudioPpqn - loopDuration)}
                      step={BEAT}
                    />
                  </Flex>

                  <Flex direction="column" gap="1">
                    <Flex justify="between">
                      <Text size="2">Region Duration</Text>
                      <Text size="2" color="gray">{formatPpqn(duration)}</Text>
                    </Flex>
                    <Slider
                      value={[duration]}
                      onValueChange={(v) => setDuration(v[0])}
                      onValueCommit={handleDurationCommit}
                      min={BAR}
                      max={BAR * 16}
                      step={BAR}
                    />
                  </Flex>

                  <Separator size="4" />

                  <Flex gap="4" wrap="wrap">
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Tiles</Text>
                      <Badge size="2" color="orange">{tileCount} repetition{tileCount !== 1 ? "s" : ""}</Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Loop Duration</Text>
                      <Badge size="2" variant="outline">{loopDuration} PPQN</Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Region Duration</Text>
                      <Badge size="2" variant="outline">{duration} PPQN</Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Source Audio</Text>
                      <Badge size="2" variant="outline">{formatPpqn(fullAudioPpqn)}</Badge>
                    </Flex>
                  </Flex>
                </Flex>
              </Card>

              {/* Transport */}
              <Card>
                <Flex gap="3" align="center">
                  {!isPlaying ? (
                    <Button size="3" onClick={handlePlay}>Play</Button>
                  ) : (
                    <Button size="3" color="red" onClick={handleStop}>Stop</Button>
                  )}
                  <Button
                    variant={metronomeEnabled ? "solid" : "outline"}
                    onClick={handleMetronomeToggle}
                  >
                    Metronome {metronomeEnabled ? "On" : "Off"}
                  </Button>
                  {isPlaying && (
                    <Text size="2" color="gray">
                      Bar {Math.floor(currentPosition / BAR) + 1}, Beat {Math.floor((currentPosition % BAR) / BEAT) + 1}
                    </Text>
                  )}
                </Flex>
              </Card>

              {/* API Reference */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="4" weight="bold">API Reference</Text>
                  <Separator size="4" />
                  <Code
                    size="2"
                    style={{
                      display: "block",
                      padding: "12px",
                      backgroundColor: "var(--gray-3)",
                      borderRadius: "4px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
{`// Region looping: when duration > loopDuration, content tiles
project.editing.modify(() => {
  // Content that repeats (e.g., 2 bars of drums)
  regionBox.loopDuration.setValue(PPQN.fromSignature(4, 4) * 2);

  // Where in the source audio the loop starts
  regionBox.loopOffset.setValue(0);

  // Total region length (e.g., 8 bars = 4 repetitions)
  regionBox.duration.setValue(PPQN.fromSignature(4, 4) * 8);
});`}
                  </Code>
                </Flex>
              </Card>

              {/* Attribution */}
              <Card>
                <Text size="2" color="gray">
                  Drum stems from Dark Ride's 'Deny Control'. Provided for educational purposes. See{" "}
                  <a href="https://www.cambridge-mt.com" target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent-9)" }}>cambridge-mt.com</a> for details.
                </Text>
              </Card>
            </>
          )}
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
