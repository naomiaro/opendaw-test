import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { TrackBox, ValueRegionBox } from "@opendaw/studio-boxes";
import { ValueRegionBoxAdapter, TrackBoxAdapter } from "@opendaw/studio-adapters";
import {
  BPM, BAR, BEAT, TOTAL_PPQN, MAX_TAKES, STAGGER_OFFSETS,
  TAKE_COLORS, VOL_0DB, VOL_SILENT,
  deriveCompState,
  type CompMode, type TakeData, type CompState
} from "@/lib/compLaneUtils";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TransportControls } from "@/components/TransportControls";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
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
  Callout,
  Badge,
  Button
} from "@radix-ui/themes";


const App: React.FC = () => {
  const [status, setStatus] = useState("Initializing...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [takes, setTakes] = useState<TakeData[]>([]);
  const [compState, setCompState] = useState<CompState>({ boundaries: [], assignments: [0] });
  const [crossfadeMs, setCrossfadeMs] = useState(20);
  const [isDragOver, setIsDragOver] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const { currentPosition, setCurrentPosition, isPlaying, pausedPositionRef } =
    usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef
  });

  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // ─── Playback range (set after takes are created) ───
  const playbackStartRef = useRef<number>(0);

  // ─── Derive comp state from box graph whenever editing commits ───
  useEffect(() => {
    if (!project) return;
    const updateUndoRedo = () => {
      setCanUndo(project.editing.canUndo());
      setCanRedo(project.editing.canRedo());
    };
    updateUndoRedo();
    const subscription = project.editing.subscribe(() => {
      if (takes.length > 0) {
        const derived = deriveCompState(project, takes, playbackStartRef.current);
        setCompState(derived);
      }
      updateUndoRedo();
    });
    return () => subscription.terminate();
  }, [project, takes]);

  // ─── Rebuild volume automation from current comp state ───
  const rebuildAutomation = useCallback(
    (project: Project, takes: TakeData[], boundaries: number[], assignments: number[], xfadeMs: number) => {
      const crossfadePPQN = Math.round(PPQN.secondsToPulses(xfadeMs / 1000, BPM));
      const playbackStart = playbackStartRef.current;

      // Pre-compute events for each take outside the transaction (pure logic, no SDK calls)
      const perTakeEvents: { position: number; index: number; value: number; interpolation: any }[][] = [];
      for (let t = 0; t < takes.length; t++) {
        const events: { position: number; value: number; interpolation: any }[] = [];
        const zoneBounds = [0, ...boundaries.map(b => b - playbackStart), TOTAL_PPQN];

        for (let z = 0; z < assignments.length; z++) {
          const zoneStart = zoneBounds[z];
          const zoneEnd = zoneBounds[z + 1];
          const isActive = assignments[z] === t;
          const isFirst = z === 0;
          const isLast = z === assignments.length - 1;
          // Check if adjacent zones have the same take — skip crossfade at shared boundary
          const prevSameTake = !isFirst && assignments[z - 1] === t;
          const nextSameTake = !isLast && assignments[z + 1] === t;

          if (isActive) {
            // Fade-in ramp start (only if previous zone had a different take)
            if (!isFirst && !prevSameTake && crossfadePPQN > 0) {
              events.push({ position: Math.max(0, zoneStart - crossfadePPQN), value: VOL_SILENT, interpolation: Interpolation.Curve(0.75) });
            }
            // Full volume at zone start (skip if continuing from same take)
            if (!prevSameTake) {
              events.push({ position: zoneStart, value: VOL_0DB, interpolation: Interpolation.None });
            }
            // Fade-out ramp start (only if next zone has a different take)
            if (!isLast && !nextSameTake && crossfadePPQN > 0) {
              events.push({ position: Math.max(zoneStart, zoneEnd - crossfadePPQN), value: VOL_0DB, interpolation: Interpolation.Curve(0.25) });
            }
            // Silent at zone end (only if next zone has a different take)
            if (!isLast && !nextSameTake) {
              events.push({ position: zoneEnd, value: VOL_SILENT, interpolation: Interpolation.None });
            }
          } else {
            // Inactive: silence at zone start
            events.push({ position: zoneStart, value: VOL_SILENT, interpolation: Interpolation.None });
          }
        }

        // Sort by position, assign incrementing index per position to form unique (position, index) composite keys
        events.sort((a, b) => a.position - b.position);
        const indexedEvents: { position: number; index: number; value: number; interpolation: any }[] = [];
        let prevPos = -1;
        let posIndex = 0;
        for (const evt of events) {
          if (evt.position === prevPos) {
            posIndex++;
          } else {
            posIndex = 0;
            prevPos = evt.position;
          }
          indexedEvents.push({ ...evt, index: posIndex });
        }
        perTakeEvents.push(indexedEvents);
      }

      // Single atomic transaction: delete all old regions, then create all new ones
      project.editing.modify(() => {
        // Delete existing automation regions for all takes
        for (let t = 0; t < takes.length; t++) {
          const take = takes[t];
          const trackAdapter = project.boxAdapters.adapterFor(take.automationTrackBox, TrackBoxAdapter);
          const existingAdapters = trackAdapter.regions.adapters.values()
            .filter(r => r.isValueRegion());

          for (const adapter of existingAdapters) {
            const collectionOpt = adapter.optCollection;
            if (collectionOpt.nonEmpty()) {
              collectionOpt.unwrap().events.asArray().forEach((evt: any) => evt.box.delete());
            }
            adapter.box.delete();
          }
        }

        // Create new automation regions and events for all takes
        for (let t = 0; t < takes.length; t++) {
          const take = takes[t];
          const indexedEvents = perTakeEvents[t];

          const regionOpt = project.api.createTrackRegion(
            take.automationTrackBox,
            playbackStart as ppqn,
            TOTAL_PPQN as ppqn
          );
          if (regionOpt.isEmpty()) {
            console.error(`rebuildAutomation: createTrackRegion failed for take ${t}`);
            continue;
          }
          const regionBox = regionOpt.unwrap() as ValueRegionBox;
          const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
          const collectionOpt = adapter.optCollection;
          if (collectionOpt.isEmpty()) {
            console.error(`rebuildAutomation: optCollection is empty for take ${t}`);
            continue;
          }
          const collection = collectionOpt.unwrap();

          for (const evt of indexedEvents) {
            collection.createEvent({
              position: evt.position as ppqn,
              index: evt.index,
              value: evt.value,
              interpolation: evt.interpolation
            });
          }
        }
      });
    },
    []
  );

  // ─── Load takes from audio file ───
  const loadTakes = useCallback(
    async (name: string, fileUrl: string) => {
      if (!project || !audioContext) return;

      setStatus(`Loading ${name}...`);
      const localAudioBuffers = localAudioBuffersRef.current;

      // Load the same file 3 times as separate tracks
      const takeLabels = ["Take 1", "Take 2", "Take 3"];
      const takeOffsets = STAGGER_OFFSETS.slice(0, 3);
      const fileConfigs = takeLabels.map((label) => ({ name: label, file: fileUrl }));
      const loadedTracks = await loadTracksFromFiles(
        project,
        audioContext,
        fileConfigs,
        localAudioBuffers,
        { onProgress: (i, total, trackName) => setStatus(`Loading ${trackName} (${i}/${total})...`) }
      );

      if (loadedTracks.length !== 3) {
        setStatus("Error: failed to create all takes");
        return;
      }

      // Determine playback start (skip silence for Dark Ride, start at 0 for other files)
      const isDarkRide = name.toLowerCase().includes("dark ride");
      const playbackStart = isDarkRide ? BAR * 16 : 0; // bar 17 for Dark Ride
      playbackStartRef.current = playbackStart;

      // Adjust each track's region offset and create automation tracks
      const takeData: TakeData[] = [];
      for (let i = 0; i < 3; i++) {
        const track = loadedTracks[i];
        const offset = takeOffsets[i];

        // Adjust region position and loopOffset for the take offset
        let audioFileBox: any = null;
        project.editing.modify(() => {
          const trackAdapter = project.boxAdapters.adapterFor(track.trackBox, TrackBoxAdapter);
          trackAdapter.regions.adapters.values()
            .filter(r => r.isAudioRegion())
            .forEach(r => {
              r.box.position.setValue(playbackStart);
              r.box.duration.setValue(TOTAL_PPQN);
              r.box.loopOffset.setValue(playbackStart + offset);
              if (audioFileBox === null) {
                audioFileBox = r.box.file.targetVertex.unwrap().box;
              }
            });
        });

        // Create volume automation track
        let automationTrackBox: TrackBox | null = null;
        project.editing.modify(() => {
          automationTrackBox = project.api.createAutomationTrack(
            track.audioUnitBox,
            track.audioUnitBox.volume
          );
        });

        if (!automationTrackBox) {
          setStatus("Error: failed to create automation track");
          return;
        }

        takeData.push({
          trackData: track,
          automationTrackBox,
          audioFileBox,
          offset,
          color: TAKE_COLORS[i],
          label: takeLabels[i]
        });
      }

      // Set loop area and position
      project.editing.modify(() => {
        project.timelineBox.loopArea.from.setValue(playbackStart);
        project.timelineBox.loopArea.to.setValue(playbackStart + TOTAL_PPQN);
        project.timelineBox.loopArea.enabled.setValue(false);
      });
      project.engine.setPosition(playbackStart);
      setCurrentPosition(playbackStart);
      if (pausedPositionRef) pausedPositionRef.current = playbackStart;

      // Apply initial automation (editing.subscribe will derive comp state)
      rebuildAutomation(project, takeData, [], [0], crossfadeMs);

      setTakes(takeData);
      setStatus("Ready — Shift+Click to add comp boundaries!");
    },
    [project, audioContext, crossfadeMs, rebuildAutomation, setCurrentPosition, pausedPositionRef]
  );

  // ─── File handlers ───
  const handleFile = useCallback(
    async (file: File) => {
      if (!audioContext) return;
      const blobUrl = URL.createObjectURL(file);
      try {
        await loadTakes(file.name, blobUrl);
      } catch (error) {
        console.error("Failed to load audio file:", error);
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Error: Could not load "${file.name}". ${message}`);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    },
    [audioContext, loadTakes]
  );

  const handleLoadDemo = useCallback(async () => {
    if (!project || !audioContext) return;
    try {
      const ext = getAudioExtension();
      await loadTakes("Dark Ride - Vocals", `/audio/DarkRide/06_Vox.${ext}`);
    } catch (error) {
      console.error("Failed to load demo:", error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Error loading demo audio: ${message}`);
    }
  }, [project, audioContext, loadTakes]);

  // ─── Comp interaction ───
  const handleLaneClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!project || takes.length === 0 || isPlaying) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      const ppqnPos = Math.round(playbackStartRef.current + fraction * TOTAL_PPQN);

      if (e.shiftKey) {
        // Add comp boundary — splice a new zone assignment at the insertion point,
        // copying the active take from the zone being split
        const newBoundaries = [...compState.boundaries, ppqnPos].sort((a, b) => a - b);
        const insertionIdx = newBoundaries.indexOf(ppqnPos);
        const newAssignments = [...compState.assignments];
        newAssignments.splice(insertionIdx + 1, 0, compState.assignments[insertionIdx] ?? 0);
        rebuildAutomation(project, takes, newBoundaries, newAssignments, crossfadeMs);
      } else {
        // Position playhead
        project.engine.setPosition(ppqnPos);
        setCurrentPosition(ppqnPos);
        if (pausedPositionRef) pausedPositionRef.current = ppqnPos;
      }
    },
    [project, takes, isPlaying, compState, crossfadeMs, rebuildAutomation, setCurrentPosition, pausedPositionRef]
  );

  const setZoneTake = useCallback(
    (zone: number, takeIndex: number) => {
      if (!project || takes.length === 0) return;
      const newAssignments = [...compState.assignments];
      newAssignments[zone] = takeIndex;
      rebuildAutomation(project, takes, compState.boundaries, newAssignments, crossfadeMs);
    },
    [project, takes, compState, crossfadeMs, rebuildAutomation]
  );

  const handleCrossfadeChange = useCallback(
    (ms: number) => {
      setCrossfadeMs(ms);
      if (project && takes.length > 0) {
        rebuildAutomation(project, takes, compState.boundaries, compState.assignments, ms);
      }
    },
    [project, takes, compState, rebuildAutomation]
  );

  // ─── Undo / Redo ───
  const handleUndo = useCallback(() => {
    if (!project) return;
    project.editing.undo();
  }, [project]);

  const handleRedo = useCallback(() => {
    if (!project) return;
    project.editing.redo();
  }, [project]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  // ─── Waveform rendering ───
  const drawWaveform = useCallback(
    (canvas: HTMLCanvasElement, takeIndex: number) => {
      if (!canvas || takes.length === 0) return;
      const take = takes[takeIndex];
      const uuidString = UUID.toString(take.trackData.uuid);
      const audioBuffer = localAudioBuffersRef.current.get(uuidString);
      if (!audioBuffer) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, w, h);

      const data = audioBuffer.getChannelData(0);
      const sr = audioBuffer.sampleRate;
      const playbackStart = playbackStartRef.current;
      const startSec = PPQN.pulsesToSeconds(playbackStart + take.offset, BPM);
      const durationSec = PPQN.pulsesToSeconds(TOTAL_PPQN, BPM);
      const startSample = Math.floor(startSec * sr);
      const endSample = Math.min(startSample + Math.floor(durationSec * sr), data.length);
      const totalSamples = endSample - startSample;
      const step = Math.ceil(totalSamples / w);

      ctx.fillStyle = take.color;
      for (let x = 0; x < w; x++) {
        const s = startSample + x * step;
        let min = 0, max = 0;
        for (let j = s; j < s + step && j < endSample; j++) {
          if (data[j] < min) min = data[j];
          if (data[j] > max) max = data[j];
        }
        const yMin = (1 + min) * h / 2;
        const yMax = (1 + max) * h / 2;
        ctx.fillRect(x, yMax, 1, Math.max(1, yMin - yMax));
      }
    },
    [takes]
  );

  // Draw waveforms when takes change
  useEffect(() => {
    if (takes.length === 0) return;
    requestAnimationFrame(() => {
      for (let i = 0; i < takes.length; i++) {
        const canvas = canvasRefs.current.get(i);
        if (canvas) drawWaveform(canvas, i);
      }
    });
  }, [takes, drawWaveform]);

  // ─── Drag and drop ───
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) handleFile(file);
  }, [handleFile]);

  // ─── Initialize OpenDAW ───
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        const localAudioBuffers = localAudioBuffersRef.current;
        const { project: p, audioContext: ac } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: (s) => { if (mounted) setStatus(s); }
        });
        if (mounted) {
          setProject(p);
          setAudioContext(ac);
          setStatus("ready-for-audio");
        }
      } catch (error) {
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ─── Pre-audio loading screen ───
  if (!project) {
    return (
      <Theme appearance="dark" accentColor="green" radius="medium">
        <Container size="4" style={{ padding: "32px" }}>
          <Heading size="8">OpenDAW Comp Lanes Demo</Heading>
          <Text size="4">{status}</Text>
        </Container>
      </Theme>
    );
  }

  const hasTakes = takes.length > 0;
  const isLoading = hasTakes && !status.startsWith("Ready");
  const playbackStart = playbackStartRef.current;
  const zoneBounds = [playbackStart, ...compState.boundaries, playbackStart + TOTAL_PPQN];

  return (
    <Theme appearance="dark" accentColor="green" radius="medium">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>

          {/* Loading overlay */}
          {isLoading && (
            <div style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", zIndex: 9999, gap: "20px"
            }}>
              <div style={{
                width: "50px", height: "50px", border: "4px solid var(--gray-6)",
                borderTop: "4px solid var(--green-9)", borderRadius: "50%",
                animation: "spin 1s linear infinite"
              }} />
              <Text size="5" weight="bold">{status}</Text>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* Header */}
          <Flex direction="column" gap="4">
            <BackLink />
            <Heading size="8">Comp Lanes Demo</Heading>
            <Text size="4" color="gray">
              Simulated takes from different sections of the same audio file. Shift+Click
              to add comp boundaries, select which take is active per zone. Crossfades use
              volume automation with smooth crossfade curves — no region splitting, no pops.
            </Text>
          </Flex>

          {/* Audio source selection */}
          {!hasTakes && (
            <Card>
              <Flex direction="column" gap="4" align="center">
                <Heading size="4">Choose Audio</Heading>
                <div
                  onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: "100%", padding: "48px 24px",
                    border: `2px dashed ${isDragOver ? "var(--green-9)" : "var(--gray-7)"}`,
                    borderRadius: "var(--radius-3)",
                    backgroundColor: isDragOver ? "var(--green-2)" : "var(--gray-2)",
                    cursor: "pointer", textAlign: "center", transition: "all 0.2s ease"
                  }}
                >
                  <Flex direction="column" gap="2" align="center">
                    <Text size="6">{isDragOver ? "Drop it!" : "Drop an audio file here"}</Text>
                    <Text size="2" color="gray">or click to browse</Text>
                  </Flex>
                  <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
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

          {/* Instructions */}
          {hasTakes && (
            <Card>
              <Flex direction="column" gap="3">
                <Heading size="4">How to Use</Heading>
                <Flex direction="column" gap="2">
                  <Text size="2"><strong>1. Shift+Click on the lanes</strong> to add a comp boundary</Text>
                  <Text size="2"><strong>2. Select active take</strong> per zone using the buttons below</Text>
                  <Text size="2"><strong>3. Press Play</strong> to hear the comp with crossfades</Text>
                </Flex>
                <Callout.Root size="1" color="blue">
                  <Callout.Text>Refresh to start over. Crossfades use volume automation — no region splitting.</Callout.Text>
                </Callout.Root>
              </Flex>
            </Card>
          )}

          {/* Controls */}
          {hasTakes && (
            <Card>
              <Flex direction="column" gap="4">
                <Flex justify="between" align="center">
                  <Heading size="4">Transport</Heading>
                  <Flex gap="3" align="center">
                    <label style={{ fontSize: "14px", color: "var(--gray-11)" }}>
                      Crossfade:{" "}
                      <input type="number" value={crossfadeMs} min={0} max={200} step={5}
                        onChange={(e) => handleCrossfadeChange(Math.max(0, parseInt(e.target.value) || 0))}
                        style={{ width: "60px", background: "var(--gray-3)", color: "var(--gray-12)",
                          border: "1px solid var(--gray-7)", padding: "4px 8px", borderRadius: "4px" }}
                      /> ms
                    </label>
                    <Badge size="2" color="green" variant="soft">
                      {compState.boundaries.length + 1} zone{compState.boundaries.length > 0 ? "s" : ""}
                    </Badge>
                    <Flex gap="1" align="center">
                      <Button size="1" variant="soft" disabled={!canUndo} onClick={handleUndo}>
                        Undo
                      </Button>
                      <Button size="1" variant="soft" disabled={!canRedo} onClick={handleRedo}>
                        Redo
                      </Button>
                    </Flex>
                  </Flex>
                </Flex>
                <TransportControls
                  isPlaying={isPlaying} currentPosition={currentPosition} bpm={BPM}
                  onPlay={handlePlay} onPause={handlePause} onStop={handleStop}
                />
                <Text size="2" color="gray">
                  Position: {PPQN.pulsesToSeconds(currentPosition, BPM).toFixed(2)}s ({currentPosition} PPQN)
                </Text>
              </Flex>
            </Card>
          )}

          {/* Take lanes */}
          {hasTakes && (
            <Card>
              <Flex direction="column" gap="4">
                <Heading size="4">Take Lanes</Heading>
                <div
                  onClick={handleLaneClick}
                  style={{ position: "relative", cursor: isPlaying ? "default" : "crosshair",
                    border: "1px solid var(--gray-6)", borderRadius: "var(--radius-3)", overflow: "hidden" }}
                >
                  {takes.map((take, i) => (
                    <div key={i} style={{ position: "relative", height: "60px", borderBottom: i < takes.length - 1 ? "1px solid var(--gray-6)" : "none" }}>
                      <canvas
                        ref={(el) => { if (el) canvasRefs.current.set(i, el); }}
                        style={{ width: "100%", height: "100%", display: "block" }}
                      />
                      <div style={{ position: "absolute", left: 8, top: 4, fontSize: "11px", color: "rgba(255,255,255,0.7)", pointerEvents: "none" }}>
                        {take.label}
                      </div>
                      {/* Active zone highlights */}
                      {compState.assignments.map((assignedTake, z) => {
                        if (assignedTake !== i) return null;
                        const zoneStart = zoneBounds[z];
                        const zoneEnd = zoneBounds[z + 1];
                        const left = ((zoneStart - playbackStart) / TOTAL_PPQN) * 100;
                        const width = ((zoneEnd - zoneStart) / TOTAL_PPQN) * 100;
                        return (
                          <div key={z} style={{
                            position: "absolute", top: 0, bottom: 0,
                            left: `${left}%`, width: `${width}%`,
                            background: take.color, opacity: 0.3, pointerEvents: "none"
                          }} />
                        );
                      })}
                    </div>
                  ))}

                  {/* Comp boundary lines */}
                  {compState.boundaries.map((b, i) => {
                    const frac = ((b - playbackStart) / TOTAL_PPQN) * 100;
                    return (
                      <div key={`b-${i}`} style={{
                        position: "absolute", top: 0, bottom: 0, left: `${frac}%`,
                        width: 0, borderLeft: "1.5px dashed rgba(255, 180, 80, 0.6)",
                        pointerEvents: "none", zIndex: 5
                      }} />
                    );
                  })}

                  {/* Playhead */}
                  {currentPosition >= playbackStart && (
                    <div style={{
                      position: "absolute", top: 0, bottom: 0,
                      left: `${((currentPosition - playbackStart) / TOTAL_PPQN) * 100}%`,
                      width: "2px", background: "#fff", pointerEvents: "none", zIndex: 10
                    }} />
                  )}
                </div>

                {/* Zone take selectors */}
                <Flex direction="column" gap="2">
                  {zoneBounds.slice(0, -1).map((_, z) => {
                    const startSec = PPQN.pulsesToSeconds(zoneBounds[z], BPM).toFixed(2);
                    const endSec = PPQN.pulsesToSeconds(zoneBounds[z + 1], BPM).toFixed(2);
                    return (
                      <Flex key={z} gap="2" align="center">
                        <Text size="1" color="gray" style={{ width: "140px" }}>
                          Zone {z + 1} ({startSec}s–{endSec}s)
                        </Text>
                        {takes.map((take, t) => (
                          <Button
                            key={t} size="1" variant={compState.assignments[z] === t ? "solid" : "soft"}
                            style={compState.assignments[z] === t ? { background: take.color, borderColor: take.color } : {}}
                            onClick={() => setZoneTake(z, t)}
                          >
                            {take.label}
                          </Button>
                        ))}
                      </Flex>
                    );
                  })}
                </Flex>
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
