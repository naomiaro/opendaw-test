// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { RegionEditing, TrackBoxAdapter } from "@opendaw/studio-adapters";
import { AudioRegionBox } from "@opendaw/studio-boxes";
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
  Button,
  Callout,
  Badge,
  Box as RadixBox
} from "@radix-ui/themes";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

/**
 * Track Editing Demo App Component
 *
 * Demonstrates interactive track editing capabilities:
 * - Splitting regions at playhead position
 * - Moving regions forward/backward
 * - Real-time waveform display
 * - Multi-track playback
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null);
  const [selectedRegionUuid, setSelectedRegionUuid] = useState<string | null>(null);
  const [updateTrigger, setUpdateTrigger] = useState({});
  const [moveNotice, setMoveNotice] = useState<string | null>(null);

  // Playback position and transport hooks
  const { currentPosition, setCurrentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({ project, audioContext, pausedPositionRef });

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const bpmRef = useRef<number>(124);

  const BPM = 124; // Dark Ride BPM

  // Helper function to get regions from a track via the adapter layer
  const getRegionsForTrack = useCallback((track: TrackData) => {
    if (!project) return [];
    const trackAdapter = project.boxAdapters.adapterFor(track.trackBox, TrackBoxAdapter);
    return trackAdapter.regions.adapters.values()
      .filter(r => r.isAudioRegion())
      .map(r => ({
        uuid: UUID.toString(r.box.address.uuid),
        position: r.box.position.getValue(),
        duration: r.box.duration.getValue(),
        loopOffset: r.box.loopOffset.getValue(),
        loopDuration: r.box.loopDuration.getValue(),
        label: r.box.label.getValue()
      }));
  }, [project]);

  // Use waveform rendering hook with region-aware rendering
  useWaveformRendering(project, tracks, canvasRefs.current, localAudioBuffersRef.current, {
    onAllRendered: () => setStatus("Ready to play!"),
    maxDuration: Math.max(...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration), 30),
    updateTrigger
  });

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setStatus("Initializing OpenDAW...");

        const localAudioBuffers = localAudioBuffersRef.current;

        // Initialize OpenDAW with custom BPM
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: status => {
            if (mounted) setStatus(status);
          }
        });

        if (mounted) {
          setProject(newProject);
          setAudioContext(newAudioContext);
          bpmRef.current = BPM;
        }

        // Load audio files and create tracks
        const ext = getAudioExtension();
        const loadedTracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [
            { name: "Vocals", file: `/audio/DarkRide/06_Vox.${ext}` },
            { name: "Guitar", file: `/audio/DarkRide/04_ElecGtrs.${ext}` },
            { name: "Bass", file: `/audio/DarkRide/03_Bass.${ext}` },
            { name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` }
          ],
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
        console.error("Failed to initialize:", JSON.stringify(String(error)));
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Editing operations
  const handleSplitAtPlayhead = useCallback(() => {
    if (!project || selectedTrackIndex === null) return;

    const track = tracks[selectedTrackIndex];
    // Use currentPosition state which is updated when clicking on waveform
    const playheadPosition = currentPosition;

    console.debug(`Splitting track "${track.name}" at position ${playheadPosition}`);

    project.editing.modify(() => {
      // Get all audio region adapters from this track
      const trackAdapter = project.boxAdapters.adapterFor(track.trackBox, TrackBoxAdapter);
      const regionAdapters = trackAdapter.regions.adapters.values().filter(r => r.isAudioRegion());

      // Find region that contains the playhead
      regionAdapters.forEach(regionAdapter => {
        const regionStart = regionAdapter.position;
        const regionEnd = regionStart + regionAdapter.duration;

        // Check if playhead is within this region
        if (playheadPosition > regionStart && playheadPosition < regionEnd) {
          console.debug(`Splitting region "${regionAdapter.box.label.getValue()}" at ${playheadPosition}`);
          RegionEditing.cut(regionAdapter, playheadPosition, true);
        }
      });
    });

    // Force re-render to show updated regions
    setUpdateTrigger({});
  }, [project, selectedTrackIndex, tracks, currentPosition]);

  const handleMoveRegionForward = useCallback(() => {
    if (!project || selectedTrackIndex === null) return;

    const track = tracks[selectedTrackIndex];
    // PPQN.secondsToPulses returns float; position is Int32 — must round.
    const moveAmount = Math.round(PPQN.secondsToPulses(1, BPM));

    const regionDesc = selectedRegionUuid ? "selected region" : "all regions";
    console.debug(`Moving ${regionDesc} in track "${track.name}" forward by ${moveAmount} PPQN`);

    // Overlap guard: when moving a single selected region, check it won't collide
    // with a sibling. Read from box graph (synchronous snapshot) not React state
    // so rapid clicks see the already-committed position.
    if (selectedRegionUuid) {
      const existingRegions = track.trackBox.regions.pointerHub
        .incoming()
        .map(p => p.box as AudioRegionBox);
      const movingBox = existingRegions.find(
        b => UUID.toString(b.address.uuid) === selectedRegionUuid
      );
      if (movingBox) {
        const newStart = movingBox.position.getValue() + moveAmount;
        const newEnd = newStart + movingBox.duration.getValue();
        const collision = existingRegions.find(b => {
          if (UUID.toString(b.address.uuid) === selectedRegionUuid) return false;
          const s = b.position.getValue();
          const e = s + b.duration.getValue();
          return newStart < e && newEnd > s;
        });
        if (collision) {
          const collisionSec = PPQN.pulsesToSeconds(collision.position.getValue(), BPM).toFixed(1);
          setMoveNotice(
            `Skipped: would overlap the region at ${collisionSec}s — ` +
            `overlapping regions on one track are invalid by design and project.copy() deletes them.`
          );
          return;
        }
      }
    }
    setMoveNotice(null);

    project.editing.modify(() => {
      const trackAdapter = project.boxAdapters.adapterFor(track.trackBox, TrackBoxAdapter);
      const regionAdapters = trackAdapter.regions.adapters.values().filter(r => r.isAudioRegion());

      regionAdapters.forEach(regionAdapter => {
        const regionUuid = UUID.toString(regionAdapter.box.address.uuid);
        if (selectedRegionUuid && regionUuid !== selectedRegionUuid) return;

        const currentPos = regionAdapter.box.position.getValue();
        regionAdapter.box.position.setValue(currentPos + moveAmount);
      });
    });

    // Force re-render to show updated regions
    setUpdateTrigger({});
  }, [project, selectedTrackIndex, tracks, selectedRegionUuid]);

  const handleMoveRegionBackward = useCallback(() => {
    if (!project || selectedTrackIndex === null) return;

    const track = tracks[selectedTrackIndex];
    // PPQN.secondsToPulses returns float; position is Int32 — must round.
    const moveAmount = Math.round(PPQN.secondsToPulses(1, BPM));

    const regionDesc = selectedRegionUuid ? "selected region" : "all regions";
    console.debug(`Moving ${regionDesc} in track "${track.name}" backward by ${moveAmount} PPQN`);

    // Overlap guard: when moving a single selected region, check it won't collide
    // with a sibling. Read from box graph (synchronous snapshot) not React state.
    if (selectedRegionUuid) {
      const existingRegions = track.trackBox.regions.pointerHub
        .incoming()
        .map(p => p.box as AudioRegionBox);
      const movingBox = existingRegions.find(
        b => UUID.toString(b.address.uuid) === selectedRegionUuid
      );
      if (movingBox) {
        const newStart = Math.max(0, movingBox.position.getValue() - moveAmount);
        const newEnd = newStart + movingBox.duration.getValue();
        const collision = existingRegions.find(b => {
          if (UUID.toString(b.address.uuid) === selectedRegionUuid) return false;
          const s = b.position.getValue();
          const e = s + b.duration.getValue();
          return newStart < e && newEnd > s;
        });
        if (collision) {
          const collisionSec = PPQN.pulsesToSeconds(collision.position.getValue(), BPM).toFixed(1);
          setMoveNotice(
            `Skipped: would overlap the region at ${collisionSec}s — ` +
            `overlapping regions on one track are invalid by design and project.copy() deletes them.`
          );
          return;
        }
      }
    }
    setMoveNotice(null);

    project.editing.modify(() => {
      const trackAdapter = project.boxAdapters.adapterFor(track.trackBox, TrackBoxAdapter);
      const regionAdapters = trackAdapter.regions.adapters.values().filter(r => r.isAudioRegion());

      // All-regions move: clamp the DELTA to the leftmost region's position so
      // every region translates uniformly. Per-region Math.max(0, ...) clamping
      // would compress the leftmost region into its neighbour — a reachable
      // overlap, which is invalid by design (project.copy() deletes the pair).
      let effectiveDelta = moveAmount;
      if (!selectedRegionUuid) {
        const minPos = Math.min(
          ...regionAdapters.map(r => r.box.position.getValue())
        );
        effectiveDelta = Math.min(moveAmount, minPos);
        if (effectiveDelta <= 0) return;
      }

      regionAdapters.forEach(regionAdapter => {
        const regionUuid = UUID.toString(regionAdapter.box.address.uuid);
        if (selectedRegionUuid && regionUuid !== selectedRegionUuid) return;

        const currentPos = regionAdapter.box.position.getValue();
        const newPosition = Math.max(0, currentPos - effectiveDelta);
        regionAdapter.box.position.setValue(newPosition);
      });
    });

    // Force re-render to show updated regions
    setUpdateTrigger({});
  }, [project, selectedTrackIndex, tracks, selectedRegionUuid]);

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
        <style>{CONSOLE_STYLES}</style>
        <Container size="4" style={{ padding: "32px" }}>
          <Text size="4">{status}</Text>
        </Container>
      </Theme>
    );
  }

  // Show loading overlay while status is not "Ready to play!"
  const isLoading = status !== "Ready to play!";

  // Calculate max duration for ruler
  const maxDuration = Math.max(...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration), 30);

  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          {/* Loading Overlay */}
          {isLoading && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(13, 12, 10, 0.92)",
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
                  border: "4px solid var(--mc-line)",
                  borderTop: `4px solid var(--mc-amber)`,
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite"
                }}
              />
              <Text size="5" weight="bold" style={{ color: "var(--mc-text)" }}>
                {status}
              </Text>
              <style>
                {`
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}
              </style>
            </div>
          )}

          {/* Header */}
          <div>
            <BackLink />
            <div className="mc-kicker">Playback — Track Editing · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>TRACK EDITING</h1>
            <p className="mc-intro">
              Non-destructive region editing with Dark Ride stems at 124 BPM.{" "}
              <strong>Split</strong> regions at the playhead via{" "}
              <code>RegionEditing.cut()</code>, <strong>move</strong> them forward or backward
              in 1-second steps. Each track holds one region per lane — overlapping regions on
              a single track are invalid by design and removed by{" "}
              <code>project.copy()</code> (export / offline render).
            </p>
          </div>

          {/* Transport Controls */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Transport</Heading>
              <TransportControls
                isPlaying={isPlaying}
                currentPosition={currentPosition}
                bpm={BPM}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
              />
              <Text size="2" color="gray">
                Position: {PPQN.pulsesToSeconds(currentPosition, BPM).toFixed(2)}s ({currentPosition} PPQN)
              </Text>
            </Flex>
          </Card>

          {/* Editing Controls */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Editing Tools</Heading>
              {selectedTrackIndex === null ? (
                <Callout.Root size="1" color="gray">
                  <Callout.Text>Select a track below to enable editing controls</Callout.Text>
                </Callout.Root>
              ) : (
                <>
                  <Flex direction="column" gap="2">
                    <Text size="2" color="gray">
                      Selected track: <strong>{tracks[selectedTrackIndex]?.name}</strong>
                    </Text>
                    {selectedRegionUuid && (
                      <Text size="2" color="amber">
                        Selected region:{" "}
                        <strong>
                          Region{" "}
                          {(() => {
                            const regions = getRegionsForTrack(tracks[selectedTrackIndex]);
                            const idx = regions.findIndex(r => r.uuid === selectedRegionUuid);
                            return idx + 1;
                          })()}
                        </strong>{" "}
                        (Click region badge to deselect)
                      </Text>
                    )}
                  </Flex>
                  <Flex gap="2" wrap="wrap">
                    <Button onClick={handleSplitAtPlayhead} variant="soft" size="2">
                      Split at Playhead
                    </Button>
                    <Button onClick={handleMoveRegionBackward} variant="soft" size="2">
                      ← Move {selectedRegionUuid ? "Selected" : "All"} Backward (1s)
                    </Button>
                    <Button onClick={handleMoveRegionForward} variant="soft" size="2">
                      Move {selectedRegionUuid ? "Selected" : "All"} Forward (1s) →
                    </Button>
                  </Flex>
                  {moveNotice && (
                    <Callout.Root size="1" color="amber">
                      <Callout.Text>{moveNotice}</Callout.Text>
                    </Callout.Root>
                  )}
                </>
              )}
            </Flex>
          </Card>

          {/* Tracks */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Tracks</Heading>

              {/* Timeline + Tracks container with playhead overlay */}
              <TracksContainer currentPosition={currentPosition} bpm={BPM} maxDuration={maxDuration} leftOffset={200}>
                {/* Timeline Ruler */}
                <TimelineRuler maxDuration={maxDuration} />

                {/* Track List */}
                <div>
                  {tracks.map((track, index) => {
                    const uuidString = UUID.toString(track.uuid);
                    const regions = getRegionsForTrack(track);

                    return (
                      <div
                        key={uuidString}
                        onClick={() => setSelectedTrackIndex(index)}
                        style={{
                          cursor: "pointer",
                          boxShadow: selectedTrackIndex === index ? "0 0 0 2px var(--mc-amber)" : "none",
                          borderRadius: "4px",
                          marginBottom: "8px",
                          backgroundColor: selectedTrackIndex === index ? "var(--mc-panel)" : "transparent",
                          transition: "all 0.2s ease"
                        }}
                      >
                        <TrackRow
                          track={track}
                          project={project}
                          allTracks={tracks}
                          canvasRef={canvas => {
                            if (canvas) canvasRefs.current.set(uuidString, canvas);
                          }}
                          currentPosition={currentPosition}
                          isPlaying={isPlaying}
                          bpm={BPM}
                          audioBuffer={localAudioBuffersRef.current.get(uuidString)}
                          setCurrentPosition={setCurrentPosition}
                          pausedPositionRef={pausedPositionRef}
                          maxDuration={maxDuration}
                        />

                        {/* Region info - clickable to select */}
                        {regions.length > 0 && (
                          <RadixBox px="4" pb="2">
                            <Flex gap="2" wrap="wrap">
                              {regions.map((region, idx) => {
                                const isSelected = selectedRegionUuid === region.uuid;
                                return (
                                  <Badge
                                    key={region.uuid}
                                    size="1"
                                    color={isSelected ? "amber" : "gray"}
                                    variant={isSelected ? "solid" : "soft"}
                                    style={{ cursor: "pointer" }}
                                    onClick={e => {
                                      e.stopPropagation();
                                      setSelectedRegionUuid(isSelected ? null : region.uuid);
                                      setSelectedTrackIndex(index);
                                    }}
                                  >
                                    Region {idx + 1}: {PPQN.pulsesToSeconds(region.position, BPM).toFixed(1)}s -{" "}
                                    {PPQN.pulsesToSeconds(region.position + region.duration, BPM).toFixed(1)}s
                                  </Badge>
                                );
                              })}
                            </Flex>
                          </RadixBox>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TracksContainer>
            </Flex>
          </Card>

          {/* SDK reference */}
          <section className="mc-anchors">
            <h2 className="mc-anchors-head">SDK reference</h2>
            <p>
              <code>RegionEditing.cut(regionAdapter, ppqn, true)</code> splits a region at the
              given PPQN position and creates a new voice per region with a 20 ms crossfade
              (<code>VOICE_FADE_DURATION</code>). The second argument must be an integer PPQN
              value — use <code>Math.round(PPQN.secondsToPulses(seconds, bpm))</code> at every
              call site; the underlying <code>position</code> field is{" "}
              <code>Int32</code>. Overlapping regions on one track are invalid by design:{" "}
              the live engine tolerates them, but <code>project.copy()</code> (export,
              offline render) deletes both regions with &ldquo;Overlapping regions&rdquo; in
              the console and no error thrown. Move operations guard against this by reading
              sibling positions from the box graph directly before committing.
            </p>
            <p>
              SDK docs:{" "}
              <a href="/docs/09-editing-fades-and-automation.html">Editing, fades &amp; automation</a>
              {" · "}
              <a href="/docs/04-box-system-and-reactivity.html">Box system &amp; reactivity</a>
            </p>
          </section>

          {/* Footer */}
          <Flex justify="center" pt="6">
            <MoisesLogo />
          </Flex>
        </Flex>
      </Container>
    </Theme>
  );
};

// Render the app
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(<App />);
