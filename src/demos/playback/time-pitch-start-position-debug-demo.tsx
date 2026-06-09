import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { InstrumentFactories } from "@opendaw/studio-adapters";
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

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [transientCount, setTransientCount] = useState<number | null>(null);

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const audioFileBoxRef = useRef<AudioFileBox | null>(null);
  const regionRef = useRef<AudioRegionBox | null>(null);
  const stretchBoxRef = useRef<AudioTimeStretchBox | null>(null);
  const fileUuidRef = useRef<ReturnType<typeof UUID.generate> | null>(null);
  const durationSecondsRef = useRef(0);
  const durationPpqnRef = useRef(0);

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
