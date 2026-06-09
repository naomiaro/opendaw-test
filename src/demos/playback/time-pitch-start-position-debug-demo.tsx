import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
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
import { Theme, Container, Heading, Flex, Card, Text, Badge } from "@radix-ui/themes";

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

          // Default warp markers: 0 -> 0, durationPpqn -> durationSeconds.
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
        setStatus("Ready");
      } catch (err) {
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

  // One-shot: wait for peaks. sampleLoader.peaks is Option<Peaks> and may
  // lag queryLoadingComplete by ~120 ms (peaks worker). Same pattern as
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
      }
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

    // Playhead marker
    const x = (startSeconds / audioBuffer.duration) * width;
    ctx.fillStyle = "#ffb020"; // amber
    ctx.fillRect(x - 1, 0, 2, WAVEFORM_HEIGHT);
  }, [peaksReady, startSeconds]);

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

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Time/Pitch Start-Position Pop
          </Heading>
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
              <Text size="2" color="gray">
                Start: {startSeconds.toFixed(3)} s
              </Text>
              {!peaksReady && (
                <Text size="1" color="gray">
                  Waiting for peaks...
                </Text>
              )}
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
