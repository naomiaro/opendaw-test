import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";
import { UUID } from "@opendaw/lib-std";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Button,
  Callout, Badge, Separator, Slider, Code, SegmentedControl
} from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840
const BEAT = BAR / 4; // 960

// All Dark Ride stems have silence/buildup at the beginning.
// Full drum pattern kicks in around bar 25.
const CONTENT_START = BAR * 24; // bar 25 (0-indexed)

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
    loopOffset: CONTENT_START,
    duration: BAR * 8,
  },
  {
    name: "1-Bar Loop",
    description: "Tight 1-bar pattern tiled 8x",
    loopDuration: BAR * 1,
    loopOffset: CONTENT_START,
    duration: BAR * 8,
  },
  {
    name: "Half-Bar Loop",
    description: "Rapid half-bar repeat",
    loopDuration: BEAT * 2,
    loopOffset: CONTENT_START,
    duration: BAR * 4,
  },
  {
    name: "Offset Start",
    description: "Loop from bar 29 of the audio (different drum pattern)",
    loopDuration: BAR * 2,
    loopOffset: CONTENT_START + BAR * 4,
    duration: BAR * 8,
  },
  {
    name: "Long Loop",
    description: "4-bar phrase tiled 4x",
    loopDuration: BAR * 4,
    loopOffset: CONTENT_START,
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

function formatSeconds(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  return `${seconds.toFixed(2)} s`;
}

function applyLoopSettings(
  project: Project,
  regionBox: AudioRegionBox,
  loopDuration: number,
  loopOffset: number,
  duration: number,
  fullAudioPpqn: number,
  timeBase: TimeBase
): void {
  const ld = loopDuration === -1 ? fullAudioPpqn : loopDuration;
  const d = duration === -1 ? fullAudioPpqn : duration;

  // waveformOffset (seconds) shifts where the engine reads in the audio file.
  // The loopOffset parameter here is a PPQN offset used to compute waveformOffset
  // and the peaks frame range for rendering — it is NOT set on regionBox.loopOffset
  // (which stays 0, since it only controls loop cycle alignment, not audio position).
  const bpm = project.timelineBox.bpm.getValue();
  const waveformOffsetSeconds = PPQN.pulsesToSeconds(loopOffset, bpm);

  if (timeBase === TimeBase.Seconds) {
    // Seconds mode: convert PPQN values to seconds for storage
    const ldSeconds = PPQN.pulsesToSeconds(ld, bpm);
    const dSeconds = PPQN.pulsesToSeconds(d, bpm);
    project.editing.modify(() => {
      regionBox.timeBase.setValue(TimeBase.Seconds);
      regionBox.position.setValue(0);
      regionBox.loopOffset.setValue(0);
      regionBox.loopDuration.setValue(ldSeconds);
      regionBox.duration.setValue(dSeconds);
      regionBox.waveformOffset.setValue(waveformOffsetSeconds);
    });
  } else {
    // Musical mode: store PPQN directly
    project.editing.modify(() => {
      regionBox.timeBase.setValue(TimeBase.Musical);
      regionBox.position.setValue(0);
      regionBox.loopOffset.setValue(0);
      regionBox.loopDuration.setValue(ld);
      regionBox.duration.setValue(d);
      regionBox.waveformOffset.setValue(waveformOffsetSeconds);
    });
  }

  // Timeline loop area is always in PPQN
  project.editing.modify(() => {
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(d);
    project.timelineBox.loopArea.enabled.setValue(true);
    project.timelineBox.durationInPulses.setValue(d);
  });

  project.engine.setPosition(0);
}

const CANVAS_HEIGHT = 120;

const LoopedWaveformCanvas: React.FC<{
  peaks: Peaks | null;
  loopDuration: number;
  loopOffset: number;
  duration: number;
  fullAudioPpqn: number;
  playheadPosition: number;
  isPlaying: boolean;
}> = ({ peaks, loopDuration, loopOffset, duration, fullAudioPpqn, playheadPosition, isPlaying }) => {
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement>(null);
  // Store mutable values in refs so the AnimationFrame callback reads live data
  const playheadRef = useRef(playheadPosition);
  const isPlayingRef = useRef(isPlaying);
  const durationRef = useRef(duration);
  playheadRef.current = playheadPosition;
  isPlayingRef.current = isPlaying;
  durationRef.current = duration;

  // Waveform rendering — only re-renders when loop params or peaks change
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !peaks || duration <= 0 || loopDuration <= 0 || fullAudioPpqn <= 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    if (width === 0) return;
    const height = CANVAS_HEIGHT;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    const numFrames = peaks.numFrames;
    const tileCount = Math.ceil(duration / loopDuration);

    // Compute frame ranges for loop content
    const u0 = Math.floor((loopOffset / fullAudioPpqn) * numFrames);
    const u1 = u0 + Math.floor((loopDuration / fullAudioPpqn) * numFrames);

    // Draw each tile
    for (let tile = 0; tile < tileCount; tile++) {
      const tileStartX = (tile * loopDuration / duration) * width;
      const tileEndX = Math.min(((tile + 1) * loopDuration / duration) * width, width);

      if (tileEndX <= tileStartX) continue;

      // Alternate tile backgrounds
      if (tile % 2 === 1) {
        ctx.fillStyle = "rgba(255, 160, 60, 0.06)";
        ctx.fillRect(tileStartX, 0, tileEndX - tileStartX, height);
      }

      // Set waveform color before rendering — PeaksPainter uses the current fillStyle
      ctx.fillStyle = "#f59e0b";

      PeaksPainter.renderPixelStrips(ctx, peaks, 0, {
        x0: tileStartX,
        x1: tileEndX,
        y0: 0,
        y1: height,
        u0: Math.max(0, Math.min(numFrames, u0)),
        u1: Math.max(0, Math.min(numFrames, u1)),
        v0: -1,
        v1: 1
      });
    }

    // Bar grid lines
    const barsInDuration = duration / BAR;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let bar = 1; bar < barsInDuration; bar++) {
      const x = (bar / barsInDuration) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Bar number labels
    ctx.fillStyle = "#666";
    ctx.font = "10px sans-serif";
    for (let bar = 0; bar < barsInDuration; bar++) {
      const x = (bar / barsInDuration) * width;
      ctx.fillText(`${bar + 1}`, x + 4, height - 4);
    }

    // Loop boundary lines (dashed, brighter)
    ctx.strokeStyle = "rgba(255, 180, 80, 0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (let tile = 1; tile < tileCount; tile++) {
      const x = (tile * loopDuration / duration) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }, [peaks, loopDuration, loopOffset, duration, fullAudioPpqn]);

  // Playhead overlay — uses AnimationFrame to avoid redrawing waveform every frame
  useEffect(() => {
    const canvas = playheadCanvasRef.current;
    if (!canvas) return;

    let prevWidth = 0;
    let prevHeight = 0;

    const af = AnimationFrame.add(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      if (width === 0) return;
      const height = CANVAS_HEIGHT;

      // Only resize canvas when dimensions actually change
      const targetWidth = width * dpr;
      const targetHeight = height * dpr;
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        prevWidth = width;
        prevHeight = height;
      }

      // Reset transform and clear (clearRect is cheap, no reflow)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const d = durationRef.current;
      const pos = playheadRef.current;
      if (isPlayingRef.current && pos >= 0 && pos < d && d > 0) {
        const px = (pos / d) * width;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
      }
    });

    return () => af.terminate();
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: CANVAS_HEIGHT }}>
      <canvas
        ref={waveformCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: CANVAS_HEIGHT,
          borderRadius: "var(--radius-3)",
          border: "1px solid var(--gray-6)",
        }}
      />
      <canvas
        ref={playheadCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: CANVAS_HEIGHT,
          pointerEvents: "none",
        }}
      />
    </div>
  );
};

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [regionBox, setRegionBox] = useState<AudioRegionBox | null>(null);
  const [fullAudioPpqn, setFullAudioPpqn] = useState(0);
  const [activePresetIndex, setActivePresetIndex] = useState(0);

  const [loopDuration, setLoopDuration] = useState(BAR * 2);
  const [loopOffset, setLoopOffset] = useState(CONTENT_START);
  const [duration, setDuration] = useState(BAR * 8);

  const [timeBase, setTimeBase] = useState<TimeBase>(TimeBase.Musical);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  useEffect(() => {
    let mounted = true;
    let sampleSub: { terminate(): void } | null = null;
    let localProject: Project | null = null;
    let localAudioContext: AudioContext | null = null;

    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        localAudioBuffersRef.current = localAudioBuffers;

        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });

        localProject = newProject;
        localAudioContext = newAudioContext;

        if (!mounted) return;
        setAudioContext(newAudioContext);
        setProject(newProject);

        const settings = newProject.engine.preferences.settings;
        settings.metronome.enabled = false;

        const ext = getAudioExtension();
        const tracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [{ name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` }],
          localAudioBuffers,
          { onProgress: (c, t, name) => { if (mounted) setStatus(`Loading ${name}...`); } }
        );

        if (!mounted) return;

        if (tracks.length === 0) {
          setStatus("Failed to load audio. Check browser console for details.");
          return;
        }

        const boxes = newProject.boxGraph.boxes();
        let foundRegion: AudioRegionBox | null = null;
        for (const box of boxes) {
          if (box instanceof AudioRegionBox) {
            foundRegion = box;
            break;
          }
        }

        if (!foundRegion) {
          setStatus("Failed to load audio. No audio region was created.");
          return;
        }

        const audioPpqn = foundRegion.duration.getValue();
        setFullAudioPpqn(audioPpqn);
        setRegionBox(foundRegion);

        // Subscribe for peaks (peaks worker runs async ~120ms after queryLoadingComplete)
        const track = tracks[0];
        if (track) {
          const sampleLoader = newProject.sampleManager.getOrCreate(track.uuid);
          sampleSub = sampleLoader.subscribe((state: any) => {
            if (state.type === "loaded") {
              const peaksOpt = sampleLoader.peaks;
              if (!peaksOpt.isEmpty() && mounted) {
                setPeaks(peaksOpt.unwrap());
              }
              sampleSub?.terminate();
              sampleSub = null;
            } else if (state.type === "error" || state.type === "failed") {
              console.error("Sample loader failed:", state);
              if (mounted) setStatus("Waveform peaks failed to load.");
              sampleSub?.terminate();
              sampleSub = null;
            }
          });
          // Also check if already loaded
          const peaksOpt = sampleLoader.peaks;
          if (!peaksOpt.isEmpty()) {
            setPeaks(peaksOpt.unwrap());
            sampleSub?.terminate();
            sampleSub = null;
          }
        }

        const preset = PRESETS[0];
        const ld = preset.loopDuration === -1 ? audioPpqn : preset.loopDuration;
        const d = preset.duration === -1 ? audioPpqn : preset.duration;
        applyLoopSettings(newProject, foundRegion, ld, preset.loopOffset, d, audioPpqn, TimeBase.Musical);
        setLoopDuration(ld);
        setLoopOffset(preset.loopOffset);
        setDuration(d);

        if (mounted) setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (mounted) setStatus(`Initialization failed: ${message}`);
      }
    })();

    return () => {
      mounted = false;
      sampleSub?.terminate();
      if (localProject) localProject.engine.stop(true);
      if (localAudioContext && localAudioContext.state !== "closed") {
        localAudioContext.close();
      }
    };
  }, []);

  const handlePreset = useCallback((index: number) => {
    if (!project || !regionBox) return;
    if (isPlaying) project.engine.stop(true);

    const preset = PRESETS[index];
    const ld = preset.loopDuration === -1 ? fullAudioPpqn : preset.loopDuration;
    const lo = preset.loopOffset;
    const d = preset.duration === -1 ? fullAudioPpqn : preset.duration;

    applyLoopSettings(project, regionBox, ld, lo, d, fullAudioPpqn, timeBase);
    setActivePresetIndex(index);
    setLoopDuration(ld);
    setLoopOffset(lo);
    setDuration(d);
  }, [project, regionBox, isPlaying, fullAudioPpqn, timeBase]);

  const handleLoopDurationCommit = useCallback((value: number[]) => {
    setLoopDuration(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, value[0], loopOffset, duration, fullAudioPpqn, timeBase);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopOffset, duration, fullAudioPpqn, timeBase]);

  const handleLoopOffsetCommit = useCallback((value: number[]) => {
    setLoopOffset(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, loopDuration, value[0], duration, fullAudioPpqn, timeBase);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopDuration, duration, fullAudioPpqn, timeBase]);

  const handleDurationCommit = useCallback((value: number[]) => {
    setDuration(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, loopDuration, loopOffset, value[0], fullAudioPpqn, timeBase);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopDuration, loopOffset, fullAudioPpqn, timeBase]);

  const handleMetronomeToggle = useCallback(() => {
    if (!project) return;
    const next = !metronomeEnabled;
    setMetronomeEnabled(next);
    project.engine.preferences.settings.metronome.enabled = next;
  }, [project, metronomeEnabled]);

  const handleTimeBaseChange = useCallback((value: string) => {
    if (!project || !regionBox) return;
    if (isPlaying) project.engine.stop(true);

    const newTimeBase = value === "seconds" ? TimeBase.Seconds : TimeBase.Musical;
    setTimeBase(newTimeBase);
    // Re-apply current settings with new timebase — values stay in PPQN internally
    applyLoopSettings(project, regionBox, loopDuration, loopOffset, duration, fullAudioPpqn, newTimeBase);
  }, [project, regionBox, isPlaying, loopDuration, loopOffset, duration, fullAudioPpqn]);

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
              Use <Code>waveformOffset</Code> (seconds) to shift which part of the audio file plays.
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

                  <Separator size="4" />

                  {/* TimeBase toggle */}
                  <Flex align="center" gap="3">
                    <Text size="2" weight="bold" color="gray">TimeBase</Text>
                    <SegmentedControl.Root
                      value={timeBase}
                      onValueChange={handleTimeBaseChange}
                      size="1"
                    >
                      <SegmentedControl.Item value="musical">Musical (PPQN)</SegmentedControl.Item>
                      <SegmentedControl.Item value="seconds">Seconds</SegmentedControl.Item>
                    </SegmentedControl.Root>
                    <Text size="1" color="gray">
                      {timeBase === TimeBase.Musical
                        ? "Loop values scale with BPM changes"
                        : "Loop values stay constant regardless of BPM"}
                    </Text>
                  </Flex>
                </Flex>
              </Card>

              {/* Waveform */}
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold" color="gray">Waveform</Text>
                  <LoopedWaveformCanvas
                    peaks={peaks}
                    loopDuration={loopDuration}
                    loopOffset={loopOffset}
                    duration={duration}
                    fullAudioPpqn={fullAudioPpqn}
                    playheadPosition={currentPosition}
                    isPlaying={isPlaying}
                  />
                </Flex>
              </Card>

              {/* Sliders + Info */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">Loop Controls</Text>

                  {(() => {
                    // Display helpers: internal state is always PPQN, convert for display in Seconds mode
                    const bpm = BPM;
                    const fmt = (ppqn: number) => timeBase === TimeBase.Seconds
                      ? formatSeconds(PPQN.pulsesToSeconds(ppqn, bpm))
                      : formatPpqn(ppqn);
                    return (
                      <>
                        <Flex direction="column" gap="1">
                          <Flex justify="between">
                            <Text size="2">Loop Duration</Text>
                            <Text size="2" color="gray">{fmt(loopDuration)}</Text>
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
                            <Text size="2" color="gray">{fmt(loopOffset)}</Text>
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
                            <Text size="2" color="gray">{fmt(duration)}</Text>
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
                      </>
                    );
                  })()}

                  <Separator size="4" />

                  <Flex gap="4" wrap="wrap">
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Tiles</Text>
                      <Badge size="2" color="orange">{tileCount} repetition{tileCount !== 1 ? "s" : ""}</Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Loop Duration</Text>
                      <Badge size="2" variant="outline">
                        {timeBase === TimeBase.Seconds
                          ? formatSeconds(PPQN.pulsesToSeconds(loopDuration, BPM))
                          : `${loopDuration} PPQN`}
                      </Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Region Duration</Text>
                      <Badge size="2" variant="outline">
                        {timeBase === TimeBase.Seconds
                          ? formatSeconds(PPQN.pulsesToSeconds(duration, BPM))
                          : `${duration} PPQN`}
                      </Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">TimeBase</Text>
                      <Badge size="2" variant="outline" color={timeBase === TimeBase.Seconds ? "blue" : "orange"}>
                        {timeBase === TimeBase.Musical ? "Musical" : "Seconds"}
                      </Badge>
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

  // Total region length (e.g., 8 bars = 4 repetitions)
  regionBox.duration.setValue(PPQN.fromSignature(4, 4) * 8);

  // Skip into the audio file (e.g., 30s to skip silence)
  // waveformOffset (seconds) shifts the audio read position
  // loopOffset (PPQN) only controls loop cycle alignment
  regionBox.waveformOffset.setValue(30.0);
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
