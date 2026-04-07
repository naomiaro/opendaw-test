import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { RegionEditing, AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TrackRow } from "@/components/TrackRow";
import { TransportControls } from "@/components/TransportControls";
import { TimelineRuler } from "@/components/TimelineRuler";
import { TracksContainer } from "@/components/TracksContainer";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { useWaveformRendering } from "@/hooks/useWaveformRendering";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import type { TrackData } from "@/lib/types";
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
  Box as RadixBox
} from "@radix-ui/themes";

const BPM = 124;
const FADE_SAMPLES = 128;
const FADE_SLOPE = 0.5; // linear

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [sliceCount, setSliceCount] = useState(0);
  const [updateTrigger, setUpdateTrigger] = useState({});

  const { currentPosition, setCurrentPosition, isPlaying, pausedPositionRef } =
    usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef
  });

  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const sampleRateRef = useRef<number>(44100);

  // Get sorted regions for the track
  const getRegions = useCallback(
    (track: TrackData) => {
      const regions: {
        uuid: string;
        position: number;
        duration: number;
        label: string;
      }[] = [];
      const pointers = track.trackBox.regions.pointerHub.incoming();

      pointers.forEach(({ box }) => {
        if (!box) return;
        const regionBox = box as AudioRegionBox;
        regions.push({
          uuid: UUID.toString(regionBox.address.uuid),
          position: regionBox.position.getValue(),
          duration: regionBox.duration.getValue(),
          label: regionBox.label.getValue()
        });
      });

      return regions.sort((a, b) => a.position - b.position);
    },
    []
  );

  // Apply micro-fades to all regions on the track
  const applyFades = useCallback(
    (project: Project, track: TrackData) => {
      const fadePPQN = PPQN.secondsToPulses(
        FADE_SAMPLES / sampleRateRef.current,
        BPM
      );

      project.editing.modify(() => {
        const pointers = track.trackBox.regions.pointerHub.incoming();
        const adapters: AudioRegionBoxAdapter[] = [];

        pointers.forEach(({ box }) => {
          if (!box) return;
          const regionBox = box as AudioRegionBox;
          const adapter = project.boxAdapters.adapterFor(
            regionBox,
            AudioRegionBoxAdapter
          );
          if (adapter) adapters.push(adapter);
        });

        // Sort by position
        adapters.sort((a, b) => a.position - b.position);

        adapters.forEach((adapter, index) => {
          // Fade-in on all except the first region
          adapter.fading.inField.setValue(index === 0 ? 0 : fadePPQN);
          adapter.fading.inSlopeField.setValue(FADE_SLOPE);
          // Fade-out on all except the last region
          adapter.fading.outField.setValue(
            index === adapters.length - 1 ? 0 : fadePPQN
          );
          adapter.fading.outSlopeField.setValue(FADE_SLOPE);
        });
      });
    },
    []
  );

  // Handle waveform click to slice (overrides default seek behavior)
  const handleSlice = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!project || tracks.length === 0 || isPlaying) return;

      const track = tracks[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const maxDuration = Math.max(
        ...Array.from(localAudioBuffersRef.current.values()).map(
          (buf) => buf.duration
        ),
        30
      );
      const LEFT_OFFSET = 200;
      const waveformLeft = rect.left + LEFT_OFFSET;
      const waveformWidth = rect.width - LEFT_OFFSET;
      if (e.clientX < waveformLeft || waveformWidth <= 0) return;
      const fraction = (e.clientX - waveformLeft) / waveformWidth;
      const seconds = fraction * maxDuration;
      const cutPosition = PPQN.secondsToPulses(seconds, BPM);

      // Find and cut the region at this position
      let didCut = false;
      project.editing.modify(() => {
        const pointers = track.trackBox.regions.pointerHub.incoming();
        pointers.forEach(({ box }) => {
          if (!box || didCut) return;
          const regionBox = box as AudioRegionBox;
          const adapter = project.boxAdapters.adapterFor(
            regionBox,
            AudioRegionBoxAdapter
          );
          if (!adapter) return;

          const start = adapter.position;
          const end = start + adapter.duration;
          if (cutPosition > start && cutPosition < end) {
            RegionEditing.cut(adapter, cutPosition, true);
            didCut = true;
          }
        });
      });

      if (didCut) {
        // Apply fades in a separate transaction
        applyFades(project, track);
        setSliceCount((prev) => prev + 1);
        setUpdateTrigger({});
      }
    },
    [project, tracks, isPlaying, applyFades]
  );

  // Waveform rendering
  useWaveformRendering(
    project,
    tracks,
    canvasRefs.current,
    localAudioBuffersRef.current,
    {
      onAllRendered: () => setStatus("Ready — click on the waveform to slice!"),
      maxDuration: Math.max(
        ...Array.from(localAudioBuffersRef.current.values()).map(
          (buf) => buf.duration
        ),
        30
      ),
      updateTrigger
    }
  );

  // Initialize OpenDAW and load vocals
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setStatus("Initializing OpenDAW...");

        const localAudioBuffers = localAudioBuffersRef.current;
        const { project: newProject, audioContext: newAudioContext } =
          await initializeOpenDAW({
            localAudioBuffers,
            bpm: BPM,
            onStatusUpdate: (s) => {
              if (mounted) setStatus(s);
            }
          });

        if (mounted) {
          setProject(newProject);
          setAudioContext(newAudioContext);
          sampleRateRef.current = newAudioContext.sampleRate;
        }

        const ext = getAudioExtension();
        const loadedTracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [{ name: "Vocals", file: `/audio/DarkRide/06_Vox.${ext}` }],
          localAudioBuffers,
          {
            onProgress: (current, total, trackName) => {
              if (mounted) setStatus(`Loading ${trackName} (${current}/${total})...`);
            }
          }
        );

        if (mounted) {
          setTracks(loadedTracks);
          setStatus("Loading waveforms...");
        }
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="green" radius="medium">
        <Container size="4" style={{ padding: "32px" }}>
          <Heading size="8">OpenDAW Region Slice Demo</Heading>
          <Text size="4">{status}</Text>
        </Container>
      </Theme>
    );
  }

  const isLoading = !status.startsWith("Ready");
  const maxDuration = Math.max(
    ...Array.from(localAudioBuffersRef.current.values()).map(
      (buf) => buf.duration
    ),
    30
  );
  const track = tracks[0];
  const regions = track ? getRegions(track) : [];

  return (
    <Theme appearance="dark" accentColor="green" radius="medium">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex
          direction="column"
          gap="6"
          style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}
        >
          {/* Loading Overlay */}
          {isLoading && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.85)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                gap: "20px"
              }}
            >
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  border: "4px solid var(--gray-6)",
                  borderTop: "4px solid var(--green-9)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite"
                }}
              />
              <Text size="5" weight="bold">
                {status}
              </Text>
              <style>
                {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
              </style>
            </div>
          )}

          {/* Header */}
          <Flex direction="column" gap="4">
            <BackLink />
            <Heading size="8">Region Slice Demo</Heading>
            <Text size="4" color="gray">
              Click anywhere on the waveform to split the region. Each cut
              applies a 128-sample (~3ms) linear fade to prevent clicks. Play
              back to verify seamless audio across all splice points.
            </Text>
          </Flex>

          {/* Instructions */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">How to Use</Heading>
              <Flex direction="column" gap="2">
                <Text size="2">
                  <strong>1. Click on the waveform</strong> to split the region
                  at that point (only when stopped/paused)
                </Text>
                <Text size="2">
                  <strong>2. Repeat</strong> to create as many slices as you
                  want
                </Text>
                <Text size="2">
                  <strong>3. Press Play</strong> to hear that all splice points
                  are seamless
                </Text>
              </Flex>
              <Callout.Root size="1" color="blue">
                <Callout.Text>
                  Refresh the page to start over. Each slice auto-applies a
                  128-sample fade-out/fade-in at the cut boundary.
                </Callout.Text>
              </Callout.Root>
            </Flex>
          </Card>

          {/* Transport */}
          <Card>
            <Flex direction="column" gap="4">
              <Flex justify="between" align="center">
                <Heading size="4">Transport</Heading>
                <Badge size="2" color="green" variant="soft">
                  {regions.length} region{regions.length !== 1 ? "s" : ""} ·{" "}
                  {sliceCount} cut{sliceCount !== 1 ? "s" : ""}
                </Badge>
              </Flex>
              <TransportControls
                isPlaying={isPlaying}
                currentPosition={currentPosition}
                bpm={BPM}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
              />
              <Text size="2" color="gray">
                Position:{" "}
                {PPQN.pulsesToSeconds(currentPosition, BPM).toFixed(2)}s (
                {currentPosition} PPQN)
              </Text>
            </Flex>
          </Card>

          {/* Waveform */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Waveform</Heading>

              <TracksContainer
                currentPosition={currentPosition}
                bpm={BPM}
                maxDuration={maxDuration}
                leftOffset={200}
              >
                <TimelineRuler maxDuration={maxDuration} />

                {track && (
                  <div
                    onClick={handleSlice}
                    style={{
                      cursor: isPlaying ? "default" : "crosshair",
                      position: "relative"
                    }}
                  >
                    <TrackRow
                      track={track}
                      project={project}
                      allTracks={tracks}
                      canvasRef={(canvas) => {
                        if (canvas)
                          canvasRefs.current.set(
                            UUID.toString(track.uuid),
                            canvas
                          );
                      }}
                      currentPosition={currentPosition}
                      isPlaying={isPlaying}
                      bpm={BPM}
                      audioBuffer={localAudioBuffersRef.current.get(
                        UUID.toString(track.uuid)
                      )}
                      setCurrentPosition={setCurrentPosition}
                      pausedPositionRef={pausedPositionRef}
                      maxDuration={maxDuration}
                    />
                  </div>
                )}

                {/* Dashed vertical lines at splice points */}
                {regions.length > 1 &&
                  regions.slice(1).map((region) => {
                    const seconds = PPQN.pulsesToSeconds(region.position, BPM);
                    const fraction = Math.max(0, Math.min(1, seconds / maxDuration));
                    return (
                      <div
                        key={`split-${region.uuid}`}
                        style={{
                          position: "absolute",
                          left: `calc(200px + (100% - 200px) * ${fraction})`,
                          top: 0,
                          bottom: 0,
                          width: 0,
                          borderLeft: "1.5px dashed rgba(255, 180, 80, 0.6)",
                          pointerEvents: "none",
                          zIndex: 5
                        }}
                      />
                    );
                  })}
              </TracksContainer>

              {/* Region badges */}
              {regions.length > 1 && (
                <RadixBox>
                  <Flex gap="2" wrap="wrap">
                    {regions.map((region, idx) => (
                      <Badge key={region.uuid} size="1" color="gray" variant="soft">
                        Slice {idx + 1}:{" "}
                        {PPQN.pulsesToSeconds(region.position, BPM).toFixed(1)}s
                        {" — "}
                        {PPQN.pulsesToSeconds(
                          region.position + region.duration,
                          BPM
                        ).toFixed(1)}
                        s
                      </Badge>
                    ))}
                  </Flex>
                </RadixBox>
              )}
            </Flex>
          </Card>

          {/* Footer */}
          <Flex justify="center" pt="6">
            <MoisesLogo />
          </Flex>
        </Flex>
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");
createRoot(rootElement).render(<App />);
