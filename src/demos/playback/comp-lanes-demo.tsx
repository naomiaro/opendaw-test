import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";
import { InstrumentFactories, TrackBoxAdapter } from "@opendaw/studio-adapters";
import {
  BPM, BAR, TOTAL_PPQN, MAX_TAKES,
  TAKE_COLORS,
  generateTakeLabels, computeTakeOffsets,
  deriveCompState, rebuildAutomation, rebuildSpliceRegions,
  type CompMode, type CrossfadeCurve, type TakeData, type CompState
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
  Button,
  SegmentedControl
} from "@radix-ui/themes";


const App: React.FC = () => {
  const [status, setStatus] = useState("Initializing...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [takes, setTakes] = useState<TakeData[]>([]);
  const [compState, setCompState] = useState<CompState>({ boundaries: [], assignments: [0] });
  const [crossfadeMs, setCrossfadeMs] = useState(20);
  const [crossfadeCurve, setCrossfadeCurve] = useState<CrossfadeCurve>("curve");
  const [compMode, setCompMode] = useState<CompMode>("automation");
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
  const spliceTrackRef = useRef<TrackBox | null>(null);
  const spliceAudioUnitRef = useRef<any>(null);
  const fullAudioPpqnRef = useRef<number>(TOTAL_PPQN);

  // ─── Playback range (set after takes are created) ───
  const playbackStartRef = useRef<number>(0);
  const isRebuildingRef = useRef(false);

  // ─── Derive comp state from box graph whenever editing commits ───
  useEffect(() => {
    if (!project) return;
    const updateUndoRedo = () => {
      setCanUndo(project.editing.canUndo());
      setCanRedo(project.editing.canRedo());
    };
    updateUndoRedo();
    // Eagerly derive comp state when takes are available (fixes stale closure on initial load)
    if (takes.length > 0) {
      setCompState(deriveCompState(project, takes, playbackStartRef.current));
    }
    const subscription = project.editing.subscribe(() => {
      // Skip re-derivation when we triggered the edit ourselves (splice rebuild)
      if (isRebuildingRef.current) return;
      if (takes.length > 0) {
        try {
          setCompState(deriveCompState(project, takes, playbackStartRef.current));
        } catch (e) {
          console.error("Failed to derive comp state after edit:", JSON.stringify(String(e)));
        }
      }
      updateUndoRedo();
    });
    return () => subscription.terminate();
  }, [project, takes]);

  // ─── Rebuild splice regions when comp state changes ───
  useEffect(() => {
    if (!project || takes.length === 0) return;
    if (compMode !== "splice" || !spliceTrackRef.current) return;
    isRebuildingRef.current = true;
    try {
      rebuildSpliceRegions(
        project, spliceTrackRef.current, takes,
        compState.boundaries, compState.assignments,
        playbackStartRef.current, fullAudioPpqnRef.current
      );
    } finally {
      isRebuildingRef.current = false;
    }
  }, [project, takes, compMode, compState]);

  // ─── Load takes from audio file(s) ───
  const loadTakes = useCallback(
    async (files: Array<{ name: string; fileUrl: string }>) => {
      if (!project || !audioContext) return;

      setStatus(`Loading ${files.length === 1 ? files[0].name : `${files.length} files`}...`);
      const localAudioBuffers = localAudioBuffersRef.current;

      const isSingleFile = files.length === 1;
      const offsets = computeTakeOffsets(files.length);
      const takeCount = isSingleFile ? MAX_TAKES : Math.min(files.length, MAX_TAKES);
      const labels = generateTakeLabels(files.length, files.map(f => f.name));

      const fileConfigs = isSingleFile
        ? Array.from({ length: takeCount }, (_, i) => ({
            name: labels[i],
            file: files[0].fileUrl,
          }))
        : files.slice(0, MAX_TAKES).map((f, i) => ({ name: labels[i] || f.name, file: f.fileUrl }));

      const loadedTracks = await loadTracksFromFiles(
        project,
        audioContext,
        fileConfigs,
        localAudioBuffers,
        { onProgress: (i, total, trackName) => setStatus(`Loading ${trackName} (${i}/${total})...`) }
      );

      if (loadedTracks.length !== takeCount) {
        setStatus("Error: failed to create all takes");
        return;
      }

      // Determine playback start (skip silence for Dark Ride, start at 0 for other files)
      const isDarkRide = files.some(f => f.name.toLowerCase().includes("dark ride"));
      const playbackStart = isDarkRide ? BAR * 16 : 0; // bar 17 for Dark Ride
      playbackStartRef.current = playbackStart;

      // Adjust each track's region offset and create automation tracks
      const takeData: TakeData[] = [];
      for (let i = 0; i < takeCount; i++) {
        const track = loadedTracks[i];
        const offset = offsets[i];

        // Adjust region position and loopOffset for the take offset
        let audioFileBox: AudioFileBox | null = null;
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
          label: labels[i]
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
      rebuildAutomation(project, takeData, [], [0], crossfadeMs, playbackStartRef.current, crossfadeCurve);

      // Create splice mode track (starts muted)
      let spliceAudioUnitBox: AudioUnitBox | null = null;
      project.editing.modify(() => {
        const result = project.api.createInstrument(InstrumentFactories.Tape);
        spliceAudioUnitBox = result.audioUnitBox;
        spliceAudioUnitBox.mute.setValue(true);
      });

      // Get the splice track's TrackBox
      const spliceTrackBox = project.rootBoxAdapter.audioUnits.adapters()
        .find(u => u.box === spliceAudioUnitBox)
        ?.tracks.values()[0]?.box ?? null;

      spliceTrackRef.current = spliceTrackBox;
      spliceAudioUnitRef.current = spliceAudioUnitBox;

      // Store full audio PPQN for splice region creation
      const firstUnit = project.rootBoxAdapter.audioUnits.adapters()[0];
      const firstTrack = firstUnit?.tracks.values()[0];
      const firstRegion = firstTrack?.regions.adapters.values().find(r => r.isAudioRegion());
      if (firstRegion) {
        fullAudioPpqnRef.current = firstRegion.loopDuration;
      }

      setTakes(takeData);
      setStatus("Ready — Shift+Click to add comp boundaries!");
    },
    [project, audioContext, crossfadeMs, setCurrentPosition, pausedPositionRef]
  );

  // ─── File handlers ───
  const handleFiles = useCallback(
    async (fileList: File[]) => {
      if (!audioContext) return;
      const configs = fileList.slice(0, MAX_TAKES).map(f => ({
        name: f.name,
        fileUrl: URL.createObjectURL(f)
      }));
      try {
        await loadTakes(configs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Error: ${message}`);
      } finally {
        configs.forEach(c => URL.revokeObjectURL(c.fileUrl));
      }
    },
    [audioContext, loadTakes]
  );

  const handleLoadDemo = useCallback(async () => {
    if (!project || !audioContext) return;
    try {
      const ext = getAudioExtension();
      await loadTakes([{ name: "Dark Ride - Vocals", fileUrl: `/audio/DarkRide/06_Vox.${ext}` }]);
    } catch (error) {
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
        rebuildAutomation(project, takes, newBoundaries, newAssignments, crossfadeMs, playbackStartRef.current, crossfadeCurve);
      } else {
        // Position playhead
        project.engine.setPosition(ppqnPos);
        setCurrentPosition(ppqnPos);
        if (pausedPositionRef) pausedPositionRef.current = ppqnPos;
      }
    },
    [project, takes, isPlaying, compState, crossfadeMs, setCurrentPosition, pausedPositionRef]
  );

  const setZoneTake = useCallback(
    (zone: number, takeIndex: number) => {
      if (!project || takes.length === 0) return;
      const newAssignments = [...compState.assignments];
      newAssignments[zone] = takeIndex;
      rebuildAutomation(project, takes, compState.boundaries, newAssignments, crossfadeMs, playbackStartRef.current, crossfadeCurve);
    },
    [project, takes, compState, crossfadeMs]
  );

  const handleCrossfadeChange = useCallback(
    (ms: number) => {
      setCrossfadeMs(ms);
      if (project && takes.length > 0) {
        rebuildAutomation(project, takes, compState.boundaries, compState.assignments, ms, playbackStartRef.current, crossfadeCurve);
      }
    },
    [project, takes, compState]
  );

  // ─── Mode toggle ───
  const handleModeChange = useCallback((mode: string) => {
    if (!project || takes.length === 0) return;
    const newMode = mode as CompMode;

    if (newMode === "splice" && (!spliceAudioUnitRef.current || !spliceTrackRef.current)) {
      console.error("handleModeChange: splice track not available");
      return;
    }

    project.editing.modify(() => {
      for (const take of takes) {
        take.trackData.audioUnitBox.mute.setValue(newMode === "splice");
      }
      if (spliceAudioUnitRef.current) {
        spliceAudioUnitRef.current.mute.setValue(newMode === "automation");
      }
    });

    setCompMode(newMode);
  }, [project, takes]);

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
      if (!project || !canvas || takes.length === 0) return;
      const take = takes[takeIndex];

      // Get peaks via the adapter layer
      const trackAdapter = project.boxAdapters.adapterFor(take.trackData.trackBox, TrackBoxAdapter);
      const regions = trackAdapter.regions.adapters.values().filter(r => r.isAudioRegion());
      if (regions.length === 0) return;
      const regionAdapter = regions[0];
      const peaksOpt = regionAdapter.file.peaks;
      if (peaksOpt.isEmpty()) return;
      const peaks = peaksOpt.unwrap();

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

      // Compute frame range for this take's offset into the audio
      const playbackStart = playbackStartRef.current;
      const startPpqn = playbackStart + take.offset;
      const totalAudioPpqn = regionAdapter.loopDuration;
      const startFraction = startPpqn / totalAudioPpqn;
      const durationFraction = TOTAL_PPQN / totalAudioPpqn;

      const u0 = Math.floor(startFraction * peaks.numFrames);
      const u1 = Math.floor((startFraction + durationFraction) * peaks.numFrames);

      ctx.fillStyle = take.color;
      const numChannels = peaks.numChannels;
      const channelHeight = h / numChannels;

      for (let ch = 0; ch < numChannels; ch++) {
        PeaksPainter.renderPixelStrips(ctx, peaks, ch, {
          x0: 0, x1: w,
          y0: ch * channelHeight, y1: (ch + 1) * channelHeight,
          u0: Math.max(0, u0), u1: Math.min(peaks.numFrames, u1),
          v0: -1, v1: 1
        });
      }
    },
    [project, takes]
  );

  // Draw waveforms when takes change
  useEffect(() => {
    if (takes.length === 0) return;
    const draw = () => {
      requestAnimationFrame(() => {
        for (let i = 0; i < takes.length; i++) {
          const canvas = canvasRefs.current.get(i);
          if (canvas) drawWaveform(canvas, i);
        }
      });
    };
    draw();
    // Retry for async peaks loading (~120ms after queryLoadingComplete)
    const t1 = setTimeout(draw, 500);
    const t2 = setTimeout(draw, 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [takes, drawWaveform]);

  // ─── Drag and drop ───
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const fileList = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith("audio/"))
      .slice(0, MAX_TAKES);
    if (fileList.length === 0) return;
    handleFiles(fileList);
  }, [handleFiles]);

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
              Compare two approaches to take comping: volume automation crossfades vs
              region splicing with SDK voice management. Drop one file for staggered
              takes, or multiple files for separate performances. Undo/redo with Cmd+Z.
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
                    <Text size="6">{isDragOver ? "Drop it!" : "Drop audio file(s) here"}</Text>
                    <Text size="2" color="gray">Drop 1 file for staggered takes, or 2-4 files for separate performances</Text>
                  </Flex>
                  <input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display: "none" }}
                    onChange={(e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      handleFiles(Array.from(files));
                    }} />
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
                  <Callout.Text>
                    {compMode === "automation"
                      ? "Crossfades use volume automation curves between parallel tracks."
                      : "Consecutive regions on a single track — SDK manages 20ms voice crossfade at boundaries."}
                    {" "}Cmd+Z to undo, Cmd+Shift+Z to redo.
                  </Callout.Text>
                </Callout.Root>
              </Flex>
            </Card>
          )}

          {/* Controls */}
          {hasTakes && (
            <Card>
              <Flex direction="column" gap="4">
                <Flex justify="between" align="center" wrap="wrap" gap="3">
                  <Heading size="4">Transport</Heading>
                  <Flex gap="3" align="center">
                    <SegmentedControl.Root value={compMode} onValueChange={handleModeChange}>
                      <SegmentedControl.Item value="automation">Automation Crossfade</SegmentedControl.Item>
                      <SegmentedControl.Item value="splice">Region Splice</SegmentedControl.Item>
                    </SegmentedControl.Root>
                    {compMode === "automation" ? (
                      <Flex gap="3" align="center">
                        <label style={{ fontSize: "14px", color: "var(--gray-11)" }}>
                          Crossfade:{" "}
                          <input type="number" value={crossfadeMs} min={0} max={200} step={5}
                            onChange={(e) => handleCrossfadeChange(Math.max(0, parseInt(e.target.value) || 0))}
                            style={{ width: "60px", background: "var(--gray-3)", color: "var(--gray-12)",
                              border: "1px solid var(--gray-7)", padding: "4px 8px", borderRadius: "4px" }}
                          /> ms
                        </label>
                        <SegmentedControl.Root value={crossfadeCurve} onValueChange={(v) => {
                          setCrossfadeCurve(v as CrossfadeCurve);
                          if (project && takes.length > 0) {
                            rebuildAutomation(project, takes, compState.boundaries, compState.assignments, crossfadeMs, playbackStartRef.current, v as CrossfadeCurve);
                          }
                        }}>
                          <SegmentedControl.Item value="curve">Curve</SegmentedControl.Item>
                          <SegmentedControl.Item value="linear">Linear</SegmentedControl.Item>
                        </SegmentedControl.Root>
                      </Flex>
                    ) : (
                      <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                        SDK manages 20ms linear voice crossfade
                      </Text>
                    )}
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
