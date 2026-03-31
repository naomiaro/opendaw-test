import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, EffectFactories } from "@opendaw/studio-core";
import { AudioRegionBox, AudioUnitBox, WerkstattDeviceBox } from "@opendaw/studio-boxes";
import type { Peaks } from "@opendaw/lib-fusion";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";
import { useTransportControls } from "./hooks/useTransportControls";
import {
  SHOWCASE_EFFECTS,
  SINE_GENERATOR_SCRIPT,
  NOISE_GENERATOR_SCRIPT,
  API_EXAMPLES,
} from "./lib/werkstattScripts";
import type { ShowcaseEffect } from "./lib/werkstattScripts";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Button,
  Callout, Badge, Separator, Slider, Code, SegmentedControl,
  Box as RadixBox,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon, PauseIcon, StopIcon } from "@radix-ui/react-icons";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840
const CONTENT_START = BAR * 24; // bar 25 — where full drum pattern starts

type AudioSource = "drums" | "sine" | "noise";

const App: React.FC = () => {
  // Core state
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [status, setStatus] = useState("Click Start to initialize audio...");
  const [isInitialized, setIsInitialized] = useState(false);

  // Audio source
  const [audioSource, setAudioSource] = useState<AudioSource>("drums");

  // Showcase state
  const [activeEffect, setActiveEffect] = useState<string | null>(null);
  const [effectParams, setEffectParams] = useState<Record<string, number>>({});

  // Refs for SDK objects (not in React state to avoid unnecessary re-renders)
  const audioBoxRef = useRef<AudioUnitBox | null>(null);
  const regionBoxRef = useRef<AudioRegionBox | null>(null);
  const werkstattBoxRef = useRef<WerkstattDeviceBox | null>(null);
  const generatorBoxRef = useRef<WerkstattDeviceBox | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [fullAudioPpqn, setFullAudioPpqn] = useState(0);

  // Transport hooks
  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  // --- Initialization ---
  const handleInit = useCallback(async () => {
    if (isInitialized) return;
    setStatus("Initializing audio engine...");

    try {
      const localAudioBuffers = new Map<string, AudioBuffer>();
      localAudioBuffersRef.current = localAudioBuffers;

      const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
        localAudioBuffers,
        bpm: BPM,
        onStatusUpdate: setStatus,
      });

      setAudioContext(newAudioContext);
      setProject(newProject);

      const settings = newProject.engine.preferences.settings;
      settings.metronome.enabled = false;

      const ext = getAudioExtension();
      setStatus("Loading drums...");
      const tracks = await loadTracksFromFiles(
        newProject,
        newAudioContext,
        [{ name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` }],
        localAudioBuffers,
        { onProgress: (c, t, name) => setStatus(`Loading ${name}...`) }
      );

      if (tracks.length === 0) {
        setStatus("Failed to load audio.");
        return;
      }

      // Find the audio region and audio unit
      const boxes = newProject.boxGraph.boxes();
      let foundRegion: AudioRegionBox | null = null;
      for (const box of boxes) {
        if (box instanceof AudioRegionBox) {
          foundRegion = box;
          break;
        }
      }

      if (!foundRegion) {
        setStatus("No audio region found.");
        return;
      }

      const audioPpqn = foundRegion.duration.getValue();
      setFullAudioPpqn(audioPpqn);
      regionBoxRef.current = foundRegion;
      audioBoxRef.current = tracks[0].audioUnitBox;

      // Apply waveformOffset to skip silence (bar 25)
      const waveformOffsetSeconds = PPQN.pulsesToSeconds(CONTENT_START, BPM);
      const playbackDuration = BAR * 16; // 16 bars of drums
      newProject.editing.modify(() => {
        foundRegion!.position.setValue(0);
        foundRegion!.loopOffset.setValue(0);
        foundRegion!.duration.setValue(playbackDuration);
        foundRegion!.loopDuration.setValue(playbackDuration);
        foundRegion!.waveformOffset.setValue(waveformOffsetSeconds);
      });

      // Timeline loop
      newProject.editing.modify(() => {
        newProject.timelineBox.loopArea.from.setValue(0);
        newProject.timelineBox.loopArea.to.setValue(playbackDuration);
        newProject.timelineBox.loopArea.enabled.setValue(true);
        newProject.timelineBox.durationInPulses.setValue(playbackDuration);
      });

      // Subscribe for peaks
      const track = tracks[0];
      const sampleLoader = newProject.sampleManager.getOrCreate(track.uuid);
      const sub = sampleLoader.subscribe((state: any) => {
        if (state.type === "loaded") {
          const peaksOpt = sampleLoader.peaks;
          if (!peaksOpt.isEmpty()) {
            setPeaks(peaksOpt.unwrap());
          }
          sub.terminate();
        }
      });
      // Check if already loaded
      const peaksOpt = sampleLoader.peaks;
      if (!peaksOpt.isEmpty()) {
        setPeaks(peaksOpt.unwrap());
        sub.terminate();
      }

      setIsInitialized(true);
      setStatus("Ready");
    } catch (err) {
      console.error("Init failed:", err);
      setStatus(`Error: ${err}`);
    }
  }, [isInitialized]);

  // --- Render ---
  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <BackLink />

          <Flex direction="column" gap="2">
            <Heading size="8">Werkstatt &mdash; Scriptable Audio Effects</Heading>
            <Text size="3" color="gray">
              Write custom audio effects in JavaScript that run in the AudioWorklet thread.
              Browse pre-built effects or explore the API with runnable code examples.
            </Text>
          </Flex>

          {!isInitialized ? (
            <Card>
              <Flex direction="column" align="center" gap="3" p="6">
                <Text size="3">{status}</Text>
                <Button size="3" onClick={handleInit}>
                  Start Audio Engine
                </Button>
              </Flex>
            </Card>
          ) : (
            <>
              {/* Transport */}
              <Flex gap="2" align="center">
                <Button
                  variant={isPlaying ? "soft" : "solid"}
                  onClick={isPlaying ? handlePause : handlePlay}
                >
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  {isPlaying ? "Pause" : "Play"}
                </Button>
                <Button variant="soft" onClick={handleStop}>
                  <StopIcon /> Stop
                </Button>
                <Text size="2" color="gray" ml="3">
                  Bar {Math.floor(currentPosition / BAR) + 1}, Beat{" "}
                  {Math.floor((currentPosition % BAR) / (BAR / 4)) + 1}
                </Text>
              </Flex>

              {/* Placeholder for showcase and API ref sections */}
              <Text size="2" color="gray">Effect showcase and API reference sections coming next...</Text>
            </>
          )}

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
