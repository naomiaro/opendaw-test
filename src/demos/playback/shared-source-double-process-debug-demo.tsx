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
// 60 s 440 Hz sine. Two toggleable configurations:
//
//   SHARED   — both regions reference ONE AudioFileBox (same UUID).
//   DISTINCT — each region references its OWN AudioFileBox (different
//              UUIDs but identical on-disk content).
//
// The original report framed the artifact as caused by voice sharing
// (one PitchVoice keyed by AudioFileBox UUID, processed twice per block
// at a seam). That mechanism was wrong: voices are keyed by region UUID
// (AudioRegionBoxAdapter.uuid → box.address.uuid), so SHARED and
// DISTINCT yield two independent voices either way.
//
// Empirically the two configurations produce BIT-IDENTICAL offline
// output — same peak amplitudes, same max |Δsample|, same time-of-peak.
// They sound the same live, too (within the precision of human
// listening). Neither configuration is a "workaround" for the other;
// both demonstrate the seam artifact identically. The toggle is kept
// because it lets the report author confirm the equivalence empirically.
const BPM = 120;
const AUDIO_FILE = "/audio/test-440hz.wav";
// Start playback 28 s in so the listener only needs to wait ~2 s for the
// seam.
const PLAYBACK_START_SECONDS = 28;
const TOTAL_DURATION_SECONDS = 60;

// Two seam positions to A/B the dependency on block alignment, computed
// from the AudioContext's actual sample rate at runtime (Web Audio's
// render quantum is 128 samples regardless of rate). For each position
// we pick a block near 30 s:
//   block-aligned — exactly on a 128-sample block boundary.
//   mid-block     — 64 samples into the block (deliberately not aligned).
const RENDER_QUANTUM = 128;
const APPROX_SEAM_SECONDS = 30;
type SeamPosition = "block-aligned" | "mid-block";
const INITIAL_SEAM_POSITION: SeamPosition = "mid-block";

function computeSeamSeconds(sampleRate: number, position: SeamPosition): number {
  const blockIndex = Math.round((APPROX_SEAM_SECONDS * sampleRate) / RENDER_QUANTUM);
  const offsetSamples = position === "block-aligned" ? 0 : RENDER_QUANTUM / 2;
  return (blockIndex * RENDER_QUANTUM + offsetSamples) / sampleRate;
}

type Scenario = "shared" | "distinct";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [scenario, setScenario] = useState<Scenario>("shared");
  const [seamPosition, setSeamPosition] = useState<SeamPosition>(INITIAL_SEAM_POSITION);
  const [isPlaying, setIsPlaying] = useState(false);
  // Seam in seconds derived from the AudioContext's actual sample rate
  // (computed once initialised, then updated when seamPosition changes).
  // 0 means "audio context not ready yet" — callers gate on `project`.
  const seamSeconds = audioContext
    ? computeSeamSeconds(audioContext.sampleRate, seamPosition)
    : 0;
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
        const initialSeamSeconds = computeSeamSeconds(
          newAudioContext.sampleRate,
          INITIAL_SEAM_POSITION
        );
        const seamPPQN = PPQN.secondsToPulses(initialSeamSeconds, bpm);

        // Initial setup uses the SHARED layout (one AudioFileBox referenced
        // by both regions). Switching to DISTINCT inside applyScenarioAndPlay
        // swaps in two distinct AudioFileBoxes with identical content.
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

          // Region A: [0 s, seam), reads source[0..seam].
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
              box.label.setValue("A: pre-seam");
              box.mute.setValue(false);
              box.fading.in.setValue(0);
              box.fading.out.setValue(0);
            }
          );
          // Region B: [seam, eof), reads source[seam..eof].
          // loopOffset = seamPPQN so the source position at timeline seam is
          // exactly source[seam] — i.e. mathematically continuous with A.
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
              box.label.setValue("B: post-seam");
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
        next === "shared" ? [UUID.generate()] : [UUID.generate(), UUID.generate()];
      for (const uuid of newUuids) {
        localAudioBuffersRef.current.set(UUID.toString(uuid), audioBuffer);
      }

      project.editing.modify(() => {
        if (next === "shared") {
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

  // Move the seam to the chosen in-block position by editing region A's
  // duration and region B's position / duration / loopOffset. The two
  // regions remain touching (no overlap, no gap) — only the seam time
  // changes. Stops playback first because moving regions mid-stream is
  // disorienting to listen to and out of scope.
  const applySeamPosition = useCallback(
    (next: SeamPosition) => {
      if (!project || !audioContext) return;
      const regionA = regionsRef.current.a;
      const regionB = regionsRef.current.b;
      if (!regionA || !regionB) return;
      if (project.engine.isPlaying.getValue()) project.engine.stop(true);
      const bpm = project.timelineBox.bpm.getValue();
      const nextSeamSeconds = computeSeamSeconds(audioContext.sampleRate, next);
      const seamPPQN = PPQN.secondsToPulses(nextSeamSeconds, bpm);
      const fullDurationPPQN = PPQN.secondsToPulses(TOTAL_DURATION_SECONDS, bpm);
      project.editing.modify(() => {
        regionA.duration.setValue(seamPPQN);
        regionB.position.setValue(seamPPQN);
        regionB.duration.setValue(fullDurationPPQN - seamPPQN);
        regionB.loopOffset.setValue(seamPPQN);
      });
      setSeamPosition(next);
      setScanResult(null);
    },
    [project, audioContext]
  );

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
      const sliceStart = seamSeconds - 0.1;
      const sliceEnd = seamSeconds + 0.1;
      const { channels, sampleRate: sr } = await renderOfflineSlice(
        project,
        sliceStart,
        sliceEnd
      );
      // Mono sine duplicated to both channels; left is sufficient.
      const left = channels[0];
      const preWindow = peakInWindow(left, sliceStart, seamSeconds - 0.05, seamSeconds - 0.02, sr);
      const transitionWindow = peakInWindow(
        left,
        sliceStart,
        seamSeconds - 0.001,
        seamSeconds + 0.025,
        sr
      );
      // For a 440 Hz sine at amplitude 0.5, the maximum sample-to-sample
      // delta of clean output is `2π·440·0.5/SR` (at zero crossings) —
      // depends on the AudioContext's sample rate. Any larger delta
      // indicates a waveform discontinuity — a click, phase jump, or an
      // impulse to zero from a missed-sample gap. This catches what the
      // ear perceives as a "click" even when peak amplitude is unchanged.
      const expectedDelta = (2 * Math.PI * 440 * 0.5) / sr;
      const preDelta = maxDeltaInWindow(left, sliceStart, seamSeconds - 0.05, seamSeconds - 0.02, sr);
      const seamDelta = maxDeltaInWindow(left, sliceStart, seamSeconds - 0.005, seamSeconds + 0.005, sr);
      const ratio = preWindow.peak > 1e-6 ? transitionWindow.peak / preWindow.peak : 0;
      const deltaRatio = preDelta.maxDelta > 1e-9 ? seamDelta.maxDelta / preDelta.maxDelta : 0;
      const seamSamples = seamSeconds * sr;
      const offsetInBlock = Math.round(seamSamples - Math.floor(seamSamples / RENDER_QUANTUM) * RENDER_QUANTUM);
      setScanResult(
        [
          `scenario             : ${scenario.toUpperCase()}`,
          `seam position        : ${seamPosition.toUpperCase()}  (${seamSeconds.toFixed(6)} s, offset ${offsetInBlock}/${RENDER_QUANTUM} samples into block)`,
          `sample rate          : ${sr} Hz`,
          ``,
          `── peak amplitude ──`,
          `pre-seam peak        : ${preWindow.peak.toFixed(4)}  (in [${(seamSeconds - 0.05).toFixed(3)} s, ${(seamSeconds - 0.02).toFixed(3)} s])`,
          `voice-fade window    : ${transitionWindow.peak.toFixed(4)}  (in [${(seamSeconds - 0.001).toFixed(3)} s, ${(seamSeconds + 0.025).toFixed(3)} s])`,
          `transition / pre     : ${ratio.toFixed(3)}  (≥1.0 expected — peak unchanged ≠ no click)`,
          ``,
          `── sample-to-sample Δ (clicks/discontinuities) ──`,
          `expected clean max Δ : ${expectedDelta.toFixed(5)}  (= 2π·440·0.5/SR for a 440 Hz, 0.5-amplitude sine)`,
          `pre-seam max Δ       : ${preDelta.maxDelta.toFixed(5)}  (in [${(seamSeconds - 0.05).toFixed(3)} s, ${(seamSeconds - 0.02).toFixed(3)} s])`,
          `seam-band max Δ      : ${seamDelta.maxDelta.toFixed(5)}  (in [${(seamSeconds - 0.005).toFixed(3)} s, ${(seamSeconds + 0.005).toFixed(3)} s])`,
          `seam-Δ / pre-Δ       : ${deltaRatio.toFixed(2)}  (>>1 indicates a waveform discontinuity)`,
          `largest jump at      : ${(sliceStart + seamDelta.atSecondsFromStart).toFixed(6)} s  (τ = ${((sliceStart + seamDelta.atSecondsFromStart - seamSeconds) * 1000).toFixed(3)} ms relative to seam)`,
        ].join("\n")
      );
    } catch (error) {
      setScanResult(`Error: ${String(error)}`);
    } finally {
      setScanning(false);
    }
  }, [project, scenario, scanning, seamPosition, seamSeconds]);

  // Live playhead readout: convert engine PPQN to seconds via the timeline's
  // BPM each frame. Lets the listener visually correlate any audio artifact
  // with the seam.
  useEffect(() => {
    if (!project) return;
    const sub = AnimationFrame.add(() => {
      const bpm = project.timelineBox.bpm.getValue();
      const positionPpqn = project.engine.position.getValue();
      setPositionSec(PPQN.pulsesToSeconds(positionPpqn, bpm));
    });
    return () => sub.terminate();
  }, [project]);

  const atSeam = Math.abs(positionSec - seamSeconds) < 0.1;

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
              Two adjacent same-track <Code>AudioRegionBox</Code>es touching at a seam that falls
              strictly inside a render quantum produce an audible sample-level discontinuity
              (≈ 2× the clean-sine <Code>max |Δsample|</Code>) at the seam. Peak amplitude is
              unchanged — only the sample-to-sample first difference reveals it. Toggle the seam
              position to A/B block-aligned vs mid-block, and the scenario to confirm the artifact
              is <strong>independent of mediaId</strong>: SHARED (one <Code>AudioFileBox</Code>)
              and DISTINCT (two distinct <Code>AudioFileBox</Code>es with identical content) produce
              bit-identical offline output. Mechanism for the discontinuity is currently open —
              see the markdown note.
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
                <Badge color="amber">Playing: {scenario === "shared" ? "SHARED" : "DISTINCT"}</Badge>
              )}
              <Badge color={seamPosition === "block-aligned" ? "green" : "amber"}>
                Seam: {seamPosition === "block-aligned" ? "block-aligned" : "mid-block"}
              </Badge>
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
                (seam at {seamSeconds.toFixed(6)} s • SR {audioContext?.sampleRate ?? "—"} Hz)
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">
                Seam position
              </Text>
              <Separator size="4" />
              <Text size="2">
                The Web Audio render quantum is 128 samples regardless of sample rate. Choose where
                the seam lands inside a block — these times are computed from the current
                AudioContext rate ({audioContext?.sampleRate ?? "—"} Hz):
              </Text>
              <Flex gap="3" wrap="wrap">
                <Button
                  onClick={() => applySeamPosition("block-aligned")}
                  disabled={!project || status !== "Ready" || scanning}
                  variant={seamPosition === "block-aligned" ? "solid" : "outline"}
                  color="green"
                  size="3"
                >
                  Block-aligned ({audioContext ? computeSeamSeconds(audioContext.sampleRate, "block-aligned").toFixed(6) : "—"} s)
                </Button>
                <Button
                  onClick={() => applySeamPosition("mid-block")}
                  disabled={!project || status !== "Ready" || scanning}
                  variant={seamPosition === "mid-block" ? "solid" : "outline"}
                  color="amber"
                  size="3"
                >
                  Mid-block ({audioContext ? computeSeamSeconds(audioContext.sampleRate, "mid-block").toFixed(6) : "—"} s)
                </Button>
              </Flex>
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
                  for the seam.
                </Text>
                <Text size="2">
                  <strong>SHARED:</strong> both regions reference one <Code>AudioFileBox</Code>{" "}
                  (one UUID).
                </Text>
                <Text size="2">
                  <strong>DISTINCT:</strong> each region references its own{" "}
                  <Code>AudioFileBox</Code> (two UUIDs, same on-disk audio). Offline scan confirms
                  SHARED and DISTINCT produce bit-identical output, so the artifact is independent
                  of mediaId.
                </Text>
              </Flex>
              <Flex gap="3" wrap="wrap">
                <Button
                  onClick={() => applyScenarioAndPlay("shared")}
                  disabled={!project || status !== "Ready" || scanning}
                  color="amber"
                  size="3"
                >
                  <PlayIcon /> Play (SHARED file)
                </Button>
                <Button
                  onClick={() => applyScenarioAndPlay("distinct")}
                  disabled={!project || status !== "Ready" || scanning}
                  color="amber"
                  size="3"
                >
                  <PlayIcon /> Play (DISTINCT files)
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
AudioContext SR:     ${audioContext?.sampleRate ?? "—"} Hz
Render quantum:      ${RENDER_QUANTUM} samples
Region A:            position=0,  duration=seam, loopOffset=0
Region B:            position=seam, duration=eof−seam, loopOffset=seam
Fades:               in=0, out=0 (touching seam, no crossfade)
SHARED:              A.file === B.file (one AudioFileBox)
DISTINCT:            A.file !== B.file (two AudioFileBoxes, same content)
Playback start:      ${PLAYBACK_START_SECONDS} s (≈2 s before seam)
Seam (current):      ${seamSeconds.toFixed(6)} s (${seamPosition})`}
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
                Click <strong>Scan current scenario</strong> after each Play. The peak-amplitude
                metric stays at ~0.5 (the artifact does not change the envelope). The interesting
                quantity is <Code>seam-band max |Δ|</Code> vs <Code>pre-seam max |Δ|</Code> (a
                clean-sine baseline of <Code>2π·440·0.5/SR</Code>). In the mid-block configuration
                the seam-band Δ is ~2× the baseline; the block-aligned configuration's seam-band Δ
                matches the baseline. SHARED and DISTINCT produce identical numbers, confirming
                the artifact is independent of mediaId.
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
