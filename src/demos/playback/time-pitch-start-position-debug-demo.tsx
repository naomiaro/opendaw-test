import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { Project } from "@opendaw/studio-core";
import { TransientPlayMode } from "@opendaw/studio-enums";
import {
  AudioFileBox,
  AudioRegionBox,
  AudioTimeStretchBox,
  ValueEventCollectionBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile, getAudioExtension } from "@/lib/audioUtils";
import { ensureTransientMarkers } from "@/lib/transientDetection";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Flex, Card, Text, Badge, Button, Slider, Code, Separator, Callout, SegmentedControl } from "@radix-ui/themes";
import { PlayIcon, StopIcon, InfoCircledIcon } from "@radix-ui/react-icons";

const PROJECT_BPM = 124;
const AUDIO_FILE = `/audio/DarkRide/06_Vox.${getAudioExtension()}`;
const AUDIO_LABEL = "06_Vox";

const WAVEFORM_HEIGHT = 140;
const CHANNEL_PADDING = 4;
const WAVEFORM_COLOR = "#4a9eff";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [transientCount, setTransientCount] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cents, setCents] = useState(0);
  const [playMode, setPlayMode] = useState<"none" | "time">("time");
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const audioFileBoxRef = useRef<AudioFileBox | null>(null);
  const regionRef = useRef<AudioRegionBox | null>(null);
  const stretchBoxRef = useRef<AudioTimeStretchBox | null>(null);
  const fileUuidRef = useRef<ReturnType<typeof UUID.generate> | null>(null);
  const durationSecondsRef = useRef(0);
  const durationPpqnRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<Peaks | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const [peaksReady, setPeaksReady] = useState(false);
  const [startSeconds, setStartSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        const { project: newProject, audioContext: newAudioContext } =
          await initializeOpenDAW({
            localAudioBuffers: localAudioBuffersRef.current,
            bpm: PROJECT_BPM,
            onStatusUpdate: setStatus,
          });
        if (cancelled) return;

        setStatus(`Loading ${AUDIO_LABEL}...`);
        const audioBuffer = await loadAudioFile(newAudioContext, AUDIO_FILE);
        if (cancelled) return;
        audioBufferRef.current = audioBuffer;

        const fileUuid = UUID.generate();
        fileUuidRef.current = fileUuid;
        localAudioBuffersRef.current.set(UUID.toString(fileUuid), audioBuffer);

        const durationSeconds = audioBuffer.duration;
        const durationPpqn = Math.round(
          PPQN.secondsToPulses(durationSeconds, PROJECT_BPM)
        );
        durationSecondsRef.current = durationSeconds;
        durationPpqnRef.current = durationPpqn;

        // Create Tape track + AudioFileBox + full-file AudioRegionBox (no playMode yet)
        newProject.editing.modify(() => {
          const { trackBox } = newProject.api.createInstrument(
            InstrumentFactories.Tape
          );

          const audioFileBox = AudioFileBox.create(
            newProject.boxGraph,
            fileUuid,
            (box) => {
              box.fileName.setValue(AUDIO_LABEL);
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
              box.duration.setValue(durationPpqn);
              box.loopOffset.setValue(0);
              box.loopDuration.setValue(durationPpqn);
              box.timeBase.setValue(TimeBase.Musical);
              box.label.setValue(AUDIO_LABEL);
            }
          );
          regionRef.current = region;

          // Disable loop, extend its range past region end
          newProject.timelineBox.loopArea.enabled.setValue(false);
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(durationPpqn);
        });

        // Detect transients (required before attaching TimeStretch, or the
        // engine renders silence — see playback CLAUDE.md). May take a few
        // seconds on a 230s file.
        setStatus("Detecting transients...");
        const positions = await ensureTransientMarkers(
          newProject,
          audioFileBoxRef.current!,
          audioBuffer
        );
        if (cancelled) return;
        setTransientCount(positions.length);

        // Attach AudioTimeStretchBox in a separate transaction (transient
        // markers were written in their own transaction by ensureTransientMarkers).
        setStatus("Attaching TimeStretch...");
        newProject.editing.modify(() => {
          const region = regionRef.current!;
          const stretchBox = AudioTimeStretchBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (b) => {
              b.transientPlayMode.setValue(TransientPlayMode.Pingpong);
              b.playbackRate.setValue(1.0);
            }
          );
          stretchBoxRef.current = stretchBox;

          WarpMarkerBox.create(newProject.boxGraph, UUID.generate(), (m) => {
            m.owner.refer(stretchBox.warpMarkers);
            m.position.setValue(0);
            m.seconds.setValue(0);
          });
          WarpMarkerBox.create(newProject.boxGraph, UUID.generate(), (m) => {
            m.owner.refer(stretchBox.warpMarkers);
            m.position.setValue(durationPpqnRef.current);
            m.seconds.setValue(durationSecondsRef.current);
          });

          region.playMode.refer(stretchBox);
        });

        await newProject.engine.queryLoadingComplete();
        if (cancelled) return;

        setProject(newProject);
        setAudioContext(newAudioContext);
        setStatus("Ready");
      } catch (err) {
        console.error("[time-pitch-debug] init failed", err);
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setStatus("Failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One-shot: wait for peaks. sampleLoader.peaks is Option<Peaks> and lags
  // queryLoadingComplete (peaks compute in a worker). Same pattern as
  // useWaveformRendering and drum-scheduling-demo.
  useEffect(() => {
    if (!project) return;
    const fileUuid = fileUuidRef.current;
    if (!fileUuid) return;

    const sampleLoader = project.sampleManager.getOrCreate(fileUuid);

    // Peaks may already be present — promote synchronously and bail.
    const peaksOpt = sampleLoader.peaks;
    if (peaksOpt.nonEmpty()) {
      peaksRef.current = peaksOpt.unwrap();
      setPeaksReady(true);
      return;
    }

    const sub = sampleLoader.subscribe((state: any) => {
      if (state.type === "loaded") {
        const opt = sampleLoader.peaks;
        if (opt.nonEmpty()) {
          peaksRef.current = opt.unwrap();
          setPeaksReady(true);
        }
        sub.terminate();
      } else if (state.type === "error") {
        const reason = state.reason ?? "unknown error";
        console.error("[time-pitch-debug] sample loader error", state);
        setError(`Peaks failed to load: ${reason}`);
        sub.terminate();
      }
    });
    return () => sub.terminate();
  }, [project]);

  useEffect(() => {
    if (!project) return;
    const sub = project.engine.isPlaying.catchupAndSubscribe((obs) => {
      setIsPlaying(obs.getValue());
    });
    return () => sub.terminate();
  }, [project]);

  // Render waveform when peaks are ready, or when the canvas remounts.
  useEffect(() => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    const audioBuffer = audioBufferRef.current;
    if (!canvas || !peaks || !audioBuffer) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = WAVEFORM_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, WAVEFORM_HEIGHT);

    const channels = audioBuffer.numberOfChannels;
    const numberOfFrames = audioBuffer.length;
    const channelHeight =
      (WAVEFORM_HEIGHT - CHANNEL_PADDING * (channels - 1)) / channels;

    ctx.fillStyle = WAVEFORM_COLOR;
    for (let ch = 0; ch < channels; ch++) {
      const y0 = ch * (channelHeight + CHANNEL_PADDING);
      const y1 = y0 + channelHeight;
      // Float16 unpack quirk: ±1.001 not ±1.0 (see playback CLAUDE.md).
      PeaksPainter.renderPixelStrips(ctx, peaks, ch, {
        x0: 0,
        x1: width,
        y0,
        y1,
        u0: 0,
        u1: numberOfFrames,
        v0: -1.001,
        v1: 1.001,
      });
    }

    // Start-position marker (static — moves only on click)
    const x = (startSeconds / audioBuffer.duration) * width;
    ctx.fillStyle = "#ffb020"; // amber
    ctx.fillRect(x - 1, 0, 2, WAVEFORM_HEIGHT);
  }, [peaksReady, startSeconds]);

  // Playback bar overlay. Visible only while playing, hidden at rest (the
  // static amber start-position bar drawn on the canvas marks the rest state).
  // Writing directly to div.style bypasses React re-renders — a 60Hz setState
  // would re-trigger the expensive canvas-repaint render effect.
  useEffect(() => {
    if (!project) return;
    const tempoMap = project.tempoMap;
    const sub = AnimationFrame.add(() => {
      const playheadEl = playheadRef.current;
      const canvas = canvasRef.current;
      const audioBuffer = audioBufferRef.current;
      if (!playheadEl || !canvas || !audioBuffer) return;

      if (!project.engine.isPlaying.getValue()) {
        if (playheadEl.style.display !== "none") {
          playheadEl.style.display = "none";
        }
        return;
      }

      // engine.position is absolute PPQN on the timeline; the region sits at
      // position 0, so timeline-seconds == region-content-seconds (at rate=1.0
      // with linear warp markers in TimeStretch, or directly in NoStretch).
      const ppqn = project.engine.position.getValue();
      const seconds = tempoMap.ppqnToSeconds(ppqn);
      const fraction = Math.max(0, Math.min(1, seconds / audioBuffer.duration));
      const x = fraction * canvas.clientWidth;
      if (playheadEl.style.display === "none") {
        playheadEl.style.display = "block";
      }
      playheadEl.style.left = `${x - 1}px`;
    });
    return () => sub.terminate();
  }, [project]);

  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!project || !audioBufferRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    const seconds = fraction * audioBufferRef.current.duration;
    setStartSeconds(seconds);
    const bpm = project.timelineBox.bpm.getValue();
    const ppqn = Math.round(PPQN.secondsToPulses(seconds, bpm));
    project.engine.setPosition(ppqn);
  };

  const handlePlay = async () => {
    if (!project || !audioContext) return;
    if (audioContext.state !== "running") {
      try {
        await audioContext.resume();
      } catch (err) {
        console.error("[time-pitch-debug] audioContext.resume failed", err);
        setError(`Audio context resume failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    if (audioContext.state !== "running") {
      setError("Audio context did not reach 'running' after resume");
      return;
    }
    // Position already set by handleWaveformClick; no need to set again.
    project.engine.play();
  };

  const handleStop = () => {
    if (!project) return;
    project.engine.stop(true);
  };

  const handleCentsChange = (value: number) => {
    if (!project) return;
    const box = stretchBoxRef.current;
    if (!box) return;
    const clamped = Math.max(-1200, Math.min(1200, value));
    const rate = Math.max(0.5, Math.min(2.0, Math.pow(2, clamped / 1200)));
    project.editing.modify(() => {
      box.playbackRate.setValue(rate);
    });
    setCents(clamped);

    // playbackRate write resets engine.position to 0 — re-establish the
    // playhead at startSeconds so the amber bar and engine agree, and the
    // next Play resumes from the click. Skip if currently playing so we
    // don't interrupt live audio with a position jump.
    if (!isPlaying) {
      const bpm = project.timelineBox.bpm.getValue();
      const ppqn = Math.round(PPQN.secondsToPulses(startSeconds, bpm));
      project.engine.setPosition(ppqn);
    }
  };

  // NoStretch ↔ TimeStretch swap. Single editing.modify per the SDK's
  // AudioContentModifier pattern: create-then-refer (or defer for none),
  // then delete the previous box. region.timeBase + duration/loopOffset/
  // loopDuration are rewritten in the same transaction so the engine sees
  // a consistent (timeBase, duration-units) pair.
  const switchMode = useCallback(
    (next: "none" | "time") => {
      if (!project || !regionRef.current) return;
      if (switchingRef.current) return;
      if (next === playMode) return;

      switchingRef.current = true;
      setSwitching(true);
      try {
        project.editing.modify(() => {
          const region = regionRef.current!;
          const prev = stretchBoxRef.current;

          if (next === "none") {
            region.playMode.defer();
            if (prev) prev.delete();
            stretchBoxRef.current = null;
            region.timeBase.setValue(TimeBase.Seconds);
            region.duration.setValue(durationSecondsRef.current);
            region.loopOffset.setValue(0);
            region.loopDuration.setValue(durationSecondsRef.current);
            return;
          }

          // next === "time": atomic refer to new box, then delete prev.
          const newBox = AudioTimeStretchBox.create(
            project.boxGraph,
            UUID.generate(),
            (b) => {
              b.transientPlayMode.setValue(TransientPlayMode.Pingpong);
              b.playbackRate.setValue(1.0);
            }
          );
          WarpMarkerBox.create(project.boxGraph, UUID.generate(), (m) => {
            m.owner.refer(newBox.warpMarkers);
            m.position.setValue(0);
            m.seconds.setValue(0);
          });
          WarpMarkerBox.create(project.boxGraph, UUID.generate(), (m) => {
            m.owner.refer(newBox.warpMarkers);
            m.position.setValue(durationPpqnRef.current);
            m.seconds.setValue(durationSecondsRef.current);
          });
          region.playMode.refer(newBox);
          if (prev) prev.delete();
          stretchBoxRef.current = newBox;
          region.timeBase.setValue(TimeBase.Musical);
          region.duration.setValue(durationPpqnRef.current);
          region.loopOffset.setValue(0);
          region.loopDuration.setValue(durationPpqnRef.current);
        });
        setPlayMode(next);
        setCents(0);

        // The box-graph rewrite (timeBase + duration + playMode swap) invalidates
        // the engine's prior playback position — it resets to 0. Re-establish
        // the playhead at the user's chosen start so the amber start-bar and
        // the engine agree, and pressing Play resumes from the click.
        const bpm = project.timelineBox.bpm.getValue();
        const ppqn = Math.round(PPQN.secondsToPulses(startSeconds, bpm));
        project.engine.setPosition(ppqn);
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [project, playMode, startSeconds]
  );

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Time/Pitch Start-Position Pop
          </Heading>
          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              Hunting for a reported pop when starting playback inside a silent
              section of <Code>06_Vox.opus</Code> with{" "}
              <Code>AudioTimeStretchBox</Code> attached at{" "}
              <Code>playbackRate = 1.0</Code>. Click anywhere on the waveform to
              set the start position, then press Play. Look for a click/pop at
              the moment playback begins.
            </Callout.Text>
          </Callout.Root>
          <Card>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">Status:</Text>
              <Badge
                color={status === "Failed" ? "red" : status === "Ready" ? "green" : "blue"}
              >
                {status}
              </Badge>
              {audioBufferRef.current && (
                <Text size="2" color="gray">
                  {audioBufferRef.current.duration.toFixed(2)} s,{" "}
                  {audioBufferRef.current.numberOfChannels} ch,{" "}
                  {audioBufferRef.current.sampleRate} Hz
                </Text>
              )}
              {transientCount !== null && (
                <Text size="2" color="gray">
                  · {transientCount} transients
                </Text>
              )}
            </Flex>
            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}
          </Card>
          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">Waveform</Text>
              <div style={{ position: "relative", width: "100%", height: WAVEFORM_HEIGHT }}>
                <canvas
                  ref={canvasRef}
                  onClick={handleWaveformClick}
                  style={{
                    width: "100%",
                    height: WAVEFORM_HEIGHT,
                    display: "block",
                    background: "#111",
                    borderRadius: 4,
                    cursor: project ? "crosshair" : "default",
                  }}
                />
                <div
                  ref={playheadRef}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    height: WAVEFORM_HEIGHT,
                    width: 2,
                    background: "#4dd0e1",
                    pointerEvents: "none",
                    display: "none",
                  }}
                />
              </div>
              <Flex gap="3" align="center">
                <Text size="2" color="gray">
                  Start: {startSeconds.toFixed(3)} s
                </Text>
                <Text size="1" color="gray">
                  <span style={{ color: "#ffb020" }}>■</span> start position
                  {" "}·{" "}
                  <span style={{ color: "#4dd0e1" }}>■</span> playback (visible while playing)
                </Text>
              </Flex>
              {!peaksReady && (
                <Text size="1" color="gray">
                  Waiting for peaks...
                </Text>
              )}
            </Flex>
          </Card>
          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">Controls</Text>
              <Separator size="4" />
              <div
                style={{
                  opacity: switching ? 0.5 : 1,
                  pointerEvents: switching ? "none" : "auto",
                }}
              >
                <SegmentedControl.Root
                  value={playMode}
                  onValueChange={(v) => {
                    if (switchingRef.current) return;
                    switchMode(v as "none" | "time");
                  }}
                  size="2"
                >
                  <SegmentedControl.Item value="none">NoStretch</SegmentedControl.Item>
                  <SegmentedControl.Item value="time">TimeStretch</SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>
              <Text size="1" color="gray">
                {playMode === "none"
                  ? "No playMode box attached. timeBase = Seconds. Cents slider disabled."
                  : "AudioTimeStretchBox attached, playbackRate = 1.0. Cents slider active."}
              </Text>
              <Flex gap="3" align="center">
                <Button
                  onClick={handlePlay}
                  disabled={!project || status !== "Ready" || isPlaying}
                  color="green"
                  size="3"
                >
                  <PlayIcon /> Play
                </Button>
                <Button
                  onClick={handleStop}
                  disabled={!isPlaying}
                  variant="soft"
                  size="3"
                >
                  <StopIcon /> Stop
                </Button>
                {isPlaying && (
                  <Badge color="amber">Playing from {startSeconds.toFixed(3)} s</Badge>
                )}
              </Flex>

              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2">Cents (pitch offset)</Text>
                  <Code size="2">
                    {cents.toFixed(0)} c (rate{" "}
                    {Math.pow(2, cents / 1200).toFixed(4)})
                  </Code>
                </Flex>
                <Slider
                  value={[cents]}
                  onValueChange={([v]) => handleCentsChange(v)}
                  min={-1200}
                  max={1200}
                  step={1}
                  disabled={!project || status !== "Ready" || playMode !== "time"}
                />
              </Flex>
            </Flex>
          </Card>
          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">Configuration</Text>
              <Separator size="4" />
              <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                {`BPM:             ${PROJECT_BPM}
File:            ${AUDIO_FILE}
Duration:        ${
                  audioBufferRef.current
                    ? `${audioBufferRef.current.duration.toFixed(6)} s (${
                        audioBufferRef.current.numberOfChannels
                      } ch, ${audioBufferRef.current.sampleRate} Hz)`
                    : "..."
                }
Play mode:       ${playMode === "time" ? "AudioTimeStretchBox" : "NoStretch (no playMode box)"}
Transients:      ${transientCount ?? "..."}
Playback rate:   ${playMode === "time" ? `${Math.pow(2, cents / 1200).toFixed(6)} (cents=${cents.toFixed(0)})` : "n/a (NoStretch)"}
Start position:  ${startSeconds.toFixed(3)} s`}
              </Code>
            </Flex>
          </Card>
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
