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
import { getAudioExtension, loadAudioFile } from "@/lib/audioUtils";
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
  Button,
  Box as RadixBox
} from "@radix-ui/themes";

const BPM = 124;
const FADE_SAMPLES = 128;
const FADE_SLOPE = 0.5; // linear

const App: React.FC = () => {
  const [status, setStatus] = useState("Initializing...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [sliceCount, setSliceCount] = useState(0);
  const [updateTrigger, setUpdateTrigger] = useState({});
  const [isDragOver, setIsDragOver] = useState(false);

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get sorted regions for the track
  const getRegions = useCallback((track: TrackData) => {
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
  }, []);

  // Apply micro-fades to all regions on the track
  const applyFades = useCallback((project: Project, track: TrackData) => {
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

      adapters.sort((a, b) => a.position - b.position);

      adapters.forEach((adapter, index) => {
        adapter.fading.inField.setValue(index === 0 ? 0 : fadePPQN);
        adapter.fading.inSlopeField.setValue(FADE_SLOPE);
        adapter.fading.outField.setValue(
          index === adapters.length - 1 ? 0 : fadePPQN
        );
        adapter.fading.outSlopeField.setValue(FADE_SLOPE);
      });
    });
  }, []);

  // Handle waveform click to slice
  const handleSlice = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!project || tracks.length === 0 || isPlaying || !e.shiftKey) return;
      e.stopPropagation();

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
        applyFades(project, track);
        setSliceCount((prev) => prev + 1);
        setUpdateTrigger({});
      }
    },
    [project, tracks, isPlaying, applyFades]
  );

  // Load an AudioBuffer into the project as a single track
  const loadAudioBuffer = useCallback(
    async (name: string, audioBuffer: AudioBuffer) => {
      if (!project || !audioContext) return;

      setStatus(`Loading ${name}...`);
      const localAudioBuffers = localAudioBuffersRef.current;
      const fileUUID = UUID.generate();
      const uuidString = UUID.toString(fileUUID);
      localAudioBuffers.set(uuidString, audioBuffer);

      const { AudioFileBox, AudioRegionBox: ARBox, ValueEventCollectionBox } = await import("@opendaw/studio-boxes");
      const { InstrumentFactories } = await import("@opendaw/studio-adapters");
      const { setLoopEndFromTracks } = await import("@/lib/projectSetup");

      const bpm = project.timelineBox.bpm.getValue();
      const boxGraph = project.boxGraph;
      let trackData: TrackData | null = null;

      project.editing.modify(() => {
        const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Tape);
        audioUnitBox.volume.setValue(0);

        const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, (box: any) => {
          box.fileName.setValue(name);
          box.endInSeconds.setValue(audioBuffer.duration);
        });

        const clipDurationInPPQN = PPQN.secondsToPulses(audioBuffer.duration, bpm);
        const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

        ARBox.create(boxGraph, UUID.generate(), (box: any) => {
          box.regions.refer(trackBox.regions);
          box.file.refer(audioFileBox);
          box.events.refer(eventsCollectionBox.owners);
          box.position.setValue(0);
          box.duration.setValue(clipDurationInPPQN);
          box.loopOffset.setValue(0);
          box.loopDuration.setValue(clipDurationInPPQN);
          box.label.setValue(name);
          box.mute.setValue(false);
        });

        trackData = { name, trackBox, audioUnitBox, uuid: fileUUID };
      });

      if (trackData) {
        setLoopEndFromTracks(project, localAudioBuffers, bpm);
        await project.engine.queryLoadingComplete();
        project.engine.setPosition(0);
        setTracks([trackData]);
        setStatus("Loading waveforms...");
      }
    },
    [project, audioContext]
  );

  // Handle dropped or selected file
  const handleFile = useCallback(
    async (file: File) => {
      if (!audioContext) return;
      try {
        setStatus(`Decoding ${file.name}...`);
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        await loadAudioBuffer(file.name, audioBuffer);
      } catch (error) {
        console.error("Failed to decode audio file:", error);
        setStatus(`Error: Could not decode "${file.name}". Try a different audio file.`);
      }
    },
    [audioContext, loadAudioBuffer]
  );

  // Load demo vocals
  const handleLoadDemo = useCallback(async () => {
    if (!project || !audioContext) return;
    try {
      setStatus("Loading demo vocals...");
      const ext = getAudioExtension();
      const audioBuffer = await loadAudioFile(audioContext, `/audio/DarkRide/06_Vox.${ext}`);
      await loadAudioBuffer("Dark Ride - Vocals", audioBuffer);
    } catch (error) {
      console.error("Failed to load demo vocals:", error);
      setStatus(`Error: ${error}`);
    }
  }, [project, audioContext, loadAudioBuffer]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("audio/")) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  // Waveform rendering
  useWaveformRendering(
    project,
    tracks,
    canvasRefs.current,
    localAudioBuffersRef.current,
    {
      onAllRendered: () => setStatus("Ready — Shift+Click to slice!"),
      maxDuration: Math.max(
        ...Array.from(localAudioBuffersRef.current.values()).map(
          (buf) => buf.duration
        ),
        30
      ),
      updateTrigger
    }
  );

  // Initialize OpenDAW (no audio loading — wait for user choice)
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
          setStatus("ready-for-audio");
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

  // Show init spinner before engine is ready
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

  const hasAudio = tracks.length > 0;
  const isLoading = hasAudio && !status.startsWith("Ready");
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
          {/* Loading Overlay (only after audio is chosen) */}
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
              Shift+Click anywhere on the waveform to split the region. Each
              cut applies a 128-sample (~3ms) linear fade to prevent clicks.
              Click to position the playhead, then play to verify seamless
              audio across all splice points.
            </Text>
          </Flex>

          {/* Audio source selection — shown before audio is loaded */}
          {!hasAudio && (
            <Card>
              <Flex direction="column" gap="4" align="center">
                <Heading size="4">Choose Audio</Heading>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: "100%",
                    padding: "48px 24px",
                    border: `2px dashed ${isDragOver ? "var(--green-9)" : "var(--gray-7)"}`,
                    borderRadius: "var(--radius-3)",
                    backgroundColor: isDragOver ? "var(--green-2)" : "var(--gray-2)",
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 0.2s ease"
                  }}
                >
                  <Flex direction="column" gap="2" align="center">
                    <Text size="6">
                      {isDragOver ? "Drop it!" : "Drop an audio file here"}
                    </Text>
                    <Text size="2" color="gray">
                      or click to browse (mp3, wav, m4a, ogg, flac)
                    </Text>
                  </Flex>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                  />
                </div>
                <Flex align="center" gap="3" style={{ width: "100%" }}>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--gray-6)" }} />
                  <Text size="2" color="gray">or</Text>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--gray-6)" }} />
                </Flex>
                <Button size="3" variant="soft" onClick={handleLoadDemo}>
                  Use demo vocals (Dark Ride)
                </Button>
              </Flex>
            </Card>
          )}

          {/* Instructions — shown after audio is loaded */}
          {hasAudio && (
            <Card>
              <Flex direction="column" gap="3">
                <Heading size="4">How to Use</Heading>
                <Flex direction="column" gap="2">
                  <Text size="2">
                    <strong>1. Shift+Click on the waveform</strong> to split the
                    region at that point (only when stopped/paused)
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
          )}

          {/* Transport — shown after audio is loaded */}
          {hasAudio && (
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
          )}

          {/* Waveform — shown after audio is loaded */}
          {hasAudio && (
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
          )}

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
