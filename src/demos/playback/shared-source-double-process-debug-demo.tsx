import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile } from "@/lib/audioUtils";
import { maxDeltaInWindow, peakInWindow, renderOfflineSlice } from "@/lib/offlineScan";
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
  Code,
  Separator,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon, StopIcon, ActivityLogIcon } from "@radix-ui/react-icons";

// Repro for `debug/shared-source-double-process.md`.
//
// One Tape track. Two AudioRegionBoxes, each covering ~30 s of the same
// 60 s 440 Hz sine. The bug case has both regions reference the SAME
// AudioFileBox (one UUID, one entry in lane.pitchVoices). The workaround
// has each region reference its OWN AudioFileBox (two UUIDs, two
// independent voices) — same on-disk audio, no shared-voice path.
//
// On the bug case TapeDeviceProcessor calls voice.process() once per
// adapter in any block that contains both. PitchVoice.process advances
// readPosition each call, so for blocks straddling the seam at 30 s the
// voice ends up reading two consecutive bpn-sample windows from source
// and summing them with their per-region gain weights. For a 440 Hz tone
// and a 128-sample render quantum that lands at ~−1.3 × the input — one
// block of inverted-and-amplified waveform, audible as a "snap" at the
// seam. With the workaround (separate AudioFileBoxes), the seam is clean.
const BPM = 120;
const AUDIO_FILE = "/audio/test-440hz.wav";
// Start playback 28 s in so the listener only needs to wait ~2 s for the
// seam.
const PLAYBACK_START_SECONDS = 28;
// Seam at 30.5 s is deliberately NOT block-aligned: at 48 kHz / 128-sample
// render quantum, 30.5 × 48000 = 1,464,000 = 64 samples into a block; at
// 44.1 kHz, 64-byte offset is 26 samples into a block. The shared-voice
// double-process artifact only fires when both region adapters land in the
// SAME block, which requires the seam to fall strictly inside a quantum
// (a block-aligned seam puts exactly one region per block — no
// double-process, no audible artifact). The original 30.0 s seam was a
// block boundary at 48 kHz and rendered without artifact, masking the bug.
const SEAM_SECONDS = 30.5;
const TOTAL_DURATION_SECONDS = 60;

type Scenario = "bug" | "workaround";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [scenario, setScenario] = useState<Scenario>("bug");
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  // We track the currently-installed AudioFileBox(es) so toggle can delete
  // them after re-routing the regions. The box graph rejects boxes with
  // no incoming edge at transaction commit, so we cannot keep both
  // configurations alive at once — every `AudioFileBox` must be referenced
  // by at least one region's `file` pointer.
  const installedFileBoxesRef = useRef<AudioFileBox[]>([]);
  const regionsRef = useRef<{ a: AudioRegionBox | null; b: AudioRegionBox | null }>({
    a: null,
    b: null,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;
        setProject(newProject);
        setAudioContext(newAudioContext);

        newProject.engine.isPlaying.catchupAndSubscribe((obs) => {
          if (mounted) setIsPlaying(obs.getValue());
        });

        setStatus("Loading test-440hz.wav...");
        const audioBuffer = await loadAudioFile(newAudioContext, AUDIO_FILE);
        if (!mounted) return;
        audioBufferRef.current = audioBuffer;

        const bpm = newProject.timelineBox.bpm.getValue();
        const fullDurationPPQN = PPQN.secondsToPulses(audioBuffer.duration, bpm);
        const seamPPQN = PPQN.secondsToPulses(SEAM_SECONDS, bpm);

        // Initial setup uses the BUG layout: one shared AudioFileBox that
        // both regions reference. Toggling to WORKAROUND swaps it for two
        // distinct AudioFileBoxes inside applyScenarioAndPlay.
        const initialSharedUuid = UUID.generate();
        localAudioBuffersRef.current.set(UUID.toString(initialSharedUuid), audioBuffer);

        newProject.editing.modify(() => {
          const { trackBox } = newProject.api.createInstrument(InstrumentFactories.Tape);

          const sharedFileBox = AudioFileBox.create(
            newProject.boxGraph,
            initialSharedUuid,
            (box) => {
              box.fileName.setValue("test-440hz.wav (shared)");
              box.endInSeconds.setValue(audioBuffer.duration);
            }
          );
          installedFileBoxesRef.current = [sharedFileBox];

          // Region A: [0 s, 30 s), reads source[0..30 s].
          const eventsA = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
          const regionA = AudioRegionBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (box) => {
              box.regions.refer(trackBox.regions);
              box.file.refer(sharedFileBox);
              box.events.refer(eventsA.owners);
              box.position.setValue(0);
              box.duration.setValue(seamPPQN);
              box.loopOffset.setValue(0);
              box.loopDuration.setValue(fullDurationPPQN);
              box.label.setValue("A: 0–30 s");
              box.mute.setValue(false);
              box.fading.in.setValue(0);
              box.fading.out.setValue(0);
            }
          );
          // Region B: [30 s, 60 s), reads source[30..60 s].
          // loopOffset = seamPPQN so the source position at timeline 30 s is
          // exactly source[30 s] — i.e. mathematically continuous with A.
          const eventsB = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
          const regionB = AudioRegionBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (box) => {
              box.regions.refer(trackBox.regions);
              box.file.refer(sharedFileBox);
              box.events.refer(eventsB.owners);
              box.position.setValue(seamPPQN);
              box.duration.setValue(fullDurationPPQN - seamPPQN);
              box.loopOffset.setValue(seamPPQN);
              box.loopDuration.setValue(fullDurationPPQN);
              box.label.setValue("B: 30–60 s");
              box.mute.setValue(false);
              box.fading.in.setValue(0);
              box.fading.out.setValue(0);
            }
          );

          regionsRef.current = { a: regionA, b: regionB };

          newProject.timelineBox.loopArea.enabled.setValue(false);
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(fullDurationPPQN);
        });

        if (mounted) setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${String(error)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const applyScenarioAndPlay = useCallback(
    async (next: Scenario) => {
      if (!project || !audioContext || !audioBufferRef.current) return;
      const regionA = regionsRef.current.a;
      const regionB = regionsRef.current.b;
      if (!regionA || !regionB) return;

      if (audioContext.state !== "running") {
        await audioContext.resume();
      }

      const oldBoxes = installedFileBoxesRef.current;
      const newBoxes: AudioFileBox[] = [];
      const audioBuffer = audioBufferRef.current;

      // Pre-create the new AudioFileBoxes (registering their UUIDs in the
      // SampleManager's lookup map) BEFORE the editing.modify, so the box
      // graph commit doesn't have to fetch audio data for boxes that don't
      // resolve. Each box's UUID maps to the same on-disk audio.
      const newUuids =
        next === "bug" ? [UUID.generate()] : [UUID.generate(), UUID.generate()];
      for (const uuid of newUuids) {
        localAudioBuffersRef.current.set(UUID.toString(uuid), audioBuffer);
      }

      project.editing.modify(() => {
        if (next === "bug") {
          const sharedBox = AudioFileBox.create(project.boxGraph, newUuids[0], (box) => {
            box.fileName.setValue("test-440hz.wav (shared)");
            box.endInSeconds.setValue(audioBuffer.duration);
          });
          newBoxes.push(sharedBox);
          regionA.file.refer(sharedBox);
          regionB.file.refer(sharedBox);
        } else {
          const fileBoxA = AudioFileBox.create(project.boxGraph, newUuids[0], (box) => {
            box.fileName.setValue("test-440hz.wav (A)");
            box.endInSeconds.setValue(audioBuffer.duration);
          });
          const fileBoxB = AudioFileBox.create(project.boxGraph, newUuids[1], (box) => {
            box.fileName.setValue("test-440hz.wav (B)");
            box.endInSeconds.setValue(audioBuffer.duration);
          });
          newBoxes.push(fileBoxA, fileBoxB);
          regionA.file.refer(fileBoxA);
          regionB.file.refer(fileBoxB);
        }
        // Delete the previous AudioFileBox(es) — they're no longer
        // referenced after the .refer() calls above. Doing this in the
        // same transaction keeps the graph consistent at commit time.
        for (const oldBox of oldBoxes) {
          oldBox.delete();
        }
      });

      installedFileBoxesRef.current = newBoxes;
      setScenario(next);
      const bpm = project.timelineBox.bpm.getValue();
      project.engine.setPosition(PPQN.secondsToPulses(PLAYBACK_START_SECONDS, bpm));
      project.engine.play();
    },
    [project, audioContext]
  );

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
  }, [project]);

  // Render the current scenario offline and look for the inversion-and-
  // amplification artifact in a tight window around the seam. The signal is
  // a 0.5-amplitude sine, so any |sample| > 0.5 in the seam-spanning block
  // is a clear sign that the shared voice was processed twice.
  const handleScan = useCallback(async () => {
    if (!project || scanning) return;
    if (project.engine.isPlaying.getValue()) project.engine.stop(true);
    setScanning(true);
    setScanResult(null);
    try {
      const sliceStart = SEAM_SECONDS - 0.1;
      const sliceEnd = SEAM_SECONDS + 0.1;
      const { channels, sampleRate: sr } = await renderOfflineSlice(
        project,
        sliceStart,
        sliceEnd
      );
      // Mono sine duplicated to both channels; left is sufficient.
      const left = channels[0];
      const preWindow = peakInWindow(left, sliceStart, SEAM_SECONDS - 0.05, SEAM_SECONDS - 0.02, sr);
      const transitionWindow = peakInWindow(
        left,
        sliceStart,
        SEAM_SECONDS - 0.001,
        SEAM_SECONDS + 0.025,
        sr
      );
      // For a 440 Hz sine at amplitude 0.5 sampled at 48 kHz, the maximum
      // sample-to-sample delta of clean output is ~0.029 (at zero crossings).
      // Any larger delta indicates a waveform discontinuity — a click,
      // phase jump, or an impulse to zero from a missed-sample gap. This
      // catches what the ear perceives as a "click" even when peak
      // amplitude is unchanged.
      const expectedDelta = (2 * Math.PI * 440 * 0.5) / sr;
      const preDelta = maxDeltaInWindow(left, sliceStart, SEAM_SECONDS - 0.05, SEAM_SECONDS - 0.02, sr);
      const seamDelta = maxDeltaInWindow(left, sliceStart, SEAM_SECONDS - 0.005, SEAM_SECONDS + 0.005, sr);
      const ratio = preWindow.peak > 1e-6 ? transitionWindow.peak / preWindow.peak : 0;
      const deltaRatio = preDelta.maxDelta > 1e-9 ? seamDelta.maxDelta / preDelta.maxDelta : 0;
      setScanResult(
        [
          `scenario             : ${scenario.toUpperCase()}`,
          `sample rate          : ${sr} Hz`,
          ``,
          `── peak amplitude ──`,
          `pre-seam peak        : ${preWindow.peak.toFixed(4)}  (in [${(SEAM_SECONDS - 0.05).toFixed(3)} s, ${(SEAM_SECONDS - 0.02).toFixed(3)} s])`,
          `voice-fade window    : ${transitionWindow.peak.toFixed(4)}  (in [${(SEAM_SECONDS - 0.001).toFixed(3)} s, ${(SEAM_SECONDS + 0.025).toFixed(3)} s])`,
          `transition / pre     : ${ratio.toFixed(3)}  (≥1.0 expected — peak unchanged ≠ no click)`,
          ``,
          `── sample-to-sample Δ (clicks/discontinuities) ──`,
          `expected clean max Δ : ${expectedDelta.toFixed(5)}  (= 2π·440·0.5/SR for a 440 Hz, 0.5-amplitude sine)`,
          `pre-seam max Δ       : ${preDelta.maxDelta.toFixed(5)}  (in [${(SEAM_SECONDS - 0.05).toFixed(3)} s, ${(SEAM_SECONDS - 0.02).toFixed(3)} s])`,
          `seam-band max Δ      : ${seamDelta.maxDelta.toFixed(5)}  (in [${(SEAM_SECONDS - 0.005).toFixed(3)} s, ${(SEAM_SECONDS + 0.005).toFixed(3)} s])`,
          `seam-Δ / pre-Δ       : ${deltaRatio.toFixed(2)}  (>>1 indicates a waveform discontinuity)`,
          `largest jump at      : ${(sliceStart + seamDelta.atSecondsFromStart).toFixed(6)} s  (τ = ${((sliceStart + seamDelta.atSecondsFromStart - SEAM_SECONDS) * 1000).toFixed(3)} ms relative to seam)`,
        ].join("\n")
      );
    } catch (error) {
      setScanResult(`Error: ${String(error)}`);
    } finally {
      setScanning(false);
    }
  }, [project, scenario, scanning]);

  // Live playhead readout: convert engine PPQN to seconds via the timeline's
  // BPM each frame. Lets the listener visually correlate any audio artifact
  // with the seam at SEAM_SECONDS.
  useEffect(() => {
    if (!project) return;
    const sub = AnimationFrame.add(() => {
      const bpm = project.timelineBox.bpm.getValue();
      const positionPpqn = project.engine.position.getValue();
      setPositionSec(PPQN.pulsesToSeconds(positionPpqn, bpm));
    });
    return () => sub.terminate();
  }, [project]);

  const atSeam = Math.abs(positionSec - SEAM_SECONDS) < 0.1;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Shared-Source Double-Process
          </Heading>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              Two adjacent same-track regions that reference the <strong>same</strong>{" "}
              <Code>AudioFileBox</Code> produce an audible artifact at the seam, even though the
              source positions at the seam are mathematically continuous.{" "}
              <Code>TapeDeviceProcessor</Code> keys <Code>PitchVoice</Code>s by{" "}
              <Code>sourceUuid</Code>, so both regions share one voice; the voice's{" "}
              <Code>readPosition</Code> advances <strong>2× bpn</strong> in the seam-spanning
              block.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">
                Status:
              </Text>
              <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
                {status}
              </Badge>
              {isPlaying && (
                <Badge color="amber">Playing: {scenario === "bug" ? "BUG" : "WORKAROUND"}</Badge>
              )}
              <Text size="2" weight="bold">
                Position:
              </Text>
              <Badge color={atSeam ? "red" : isPlaying ? "amber" : "gray"} size="2">
                <Code>
                  {positionSec.toFixed(3)} s
                  {atSeam ? " ← SEAM" : ""}
                </Code>
              </Badge>
              <Text size="2" color="gray">
                (seam at {SEAM_SECONDS}.000 s)
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">
                Reproduce
              </Text>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2">
                  Playback starts at <Code>{PLAYBACK_START_SECONDS}</Code> s, so you only wait ~2 s
                  for the seam at <Code>{SEAM_SECONDS}</Code> s.
                </Text>
                <Text size="2">
                  <strong>Bug:</strong> both regions reference one <Code>AudioFileBox</Code>. Same{" "}
                  <Code>sourceUuid</Code> ⇒ shared voice ⇒ <Code>voice.process</Code> called twice
                  in the seam-spanning block. Listen for a brief snap at <Code>{SEAM_SECONDS}</Code>{" "}
                  s.
                </Text>
                <Text size="2">
                  <strong>Workaround:</strong> each region references its own{" "}
                  <Code>AudioFileBox</Code> (same on-disk audio, different UUIDs). Different{" "}
                  <Code>sourceUuid</Code>s ⇒ two independent voices ⇒ no shared-voice path.{" "}
                  <em>Note:</em> this exposes a smaller, pre-existing artifact at the same boundary
                  — the cross-file splice click documented in{" "}
                  <Code>debug/splice-click-cross-file.md</Code>. Loud snap → quiet click.
                </Text>
              </Flex>
              <Flex gap="3" wrap="wrap">
                <Button
                  onClick={() => applyScenarioAndPlay("bug")}
                  disabled={!project || status !== "Ready" || scanning}
                  color="red"
                  size="3"
                >
                  <PlayIcon /> Play (BUG)
                </Button>
                <Button
                  onClick={() => applyScenarioAndPlay("workaround")}
                  disabled={!project || status !== "Ready" || scanning}
                  color="green"
                  size="3"
                >
                  <PlayIcon /> Play (WORKAROUND)
                </Button>
                <Button onClick={handleStop} disabled={!isPlaying} variant="soft" size="3">
                  <StopIcon /> Stop
                </Button>
                <Button
                  onClick={handleScan}
                  disabled={!project || status !== "Ready" || scanning}
                  variant="soft"
                  color="amber"
                  size="3"
                >
                  <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan current scenario"}
                </Button>
              </Flex>
              {scanResult && (
                <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                  {scanResult}
                </Code>
              )}
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">
                Configuration
              </Text>
              <Separator size="4" />
              <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                {`BPM:                 ${BPM}
File:                test-440hz.wav (${TOTAL_DURATION_SECONDS} s, 440 Hz sine)
Region A:            position=0,  duration=${SEAM_SECONDS}s, loopOffset=0
Region B:            position=${SEAM_SECONDS}s, duration=${TOTAL_DURATION_SECONDS - SEAM_SECONDS}s, loopOffset=${SEAM_SECONDS}s
Fades:               in=0, out=0 (touching seam, no crossfade)
Bug:                 A.file === B.file (one AudioFileBox)
Workaround:          A.file !== B.file (two AudioFileBoxes, same content)
Playback start:      ${PLAYBACK_START_SECONDS} s (≈2 s before seam)
Seam:                ${SEAM_SECONDS} s`}
              </Code>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">
                What to inspect
              </Text>
              <Separator size="4" />
              <Text size="2">
                Render to an <Code>AudioBuffer</Code> offline and compare the seam blocks across
                scenarios. In the bug case, the single 128-sample block straddling the seam at{" "}
                <Code>{SEAM_SECONDS}</Code> s contains samples of the form{" "}
                <Code>sample[N + i] + sample[N + bpn + i]</Code>. For a 440 Hz sine and 44.1 kHz
                render that's amplitude ~<Code>1.3 × sample</Code> with ~99° phase shift — one
                block of inverted-and-amplified waveform. In the workaround case, the same block
                is a clean continuation of the sine.
              </Text>
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
