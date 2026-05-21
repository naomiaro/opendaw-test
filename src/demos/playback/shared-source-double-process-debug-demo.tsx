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
import { TestStep, TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
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

// Two seam positions to A/B. Both are exact integer PPQN values at BPM
// 120 — they have to be, because `AudioRegionBox.position` is an
// Int32Field that silently truncates non-integer PPQN values (while
// `duration` is a Float32Field that preserves them), so assigning a
// fractional PPQN to both fields creates a sub-PPQN overlap that
// `project.copy()` deletes. See `debug/project-copy-deletes-overlapping-
// regions.md` for the schema-mismatch mechanism.
//
// At 48 kHz the in-block sample offsets work out to 0 (block-aligned)
// and 64 (off-boundary, mid-block); at other AudioContext rates the
// offsets fall wherever they fall — see the live readout. PPQN stays
// integer at any SR because PPQN is BPM-derived, not SR-derived.
const RENDER_QUANTUM = 128;
type SeamPosition = "block-aligned" | "off-boundary";
const SEAM_SECONDS_BY_POSITION: Record<SeamPosition, number> = {
  "block-aligned": 30.0, // PPQN 57600 at BPM 120
  "off-boundary": 30.5, // PPQN 58560 at BPM 120
};
const INITIAL_SEAM_POSITION: SeamPosition = "off-boundary";

function inBlockOffsetSamples(seamSeconds: number, sampleRate: number): number {
  const samples = seamSeconds * sampleRate;
  return Math.round(samples - Math.floor(samples / RENDER_QUANTUM) * RENDER_QUANTUM);
}

type Scenario = "shared" | "distinct";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [scenario, setScenario] = useState<Scenario>("shared");
  const [seamPosition, setSeamPosition] = useState<SeamPosition>(INITIAL_SEAM_POSITION);
  const [isPlaying, setIsPlaying] = useState(false);
  // Seam in seconds is BPM-derived (PPQN integer for both positions), not
  // SR-derived. The in-block offset for display IS SR-derived.
  const seamSeconds = SEAM_SECONDS_BY_POSITION[seamPosition];
  const [positionSec, setPositionSec] = useState(0);
  const [gotByStep, setGotByStep] = useState<Record<number, TestStepRow[]>>({});
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
        const initialSeamSeconds = SEAM_SECONDS_BY_POSITION[INITIAL_SEAM_POSITION];
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
      if (!project) return;
      const regionA = regionsRef.current.a;
      const regionB = regionsRef.current.b;
      if (!regionA || !regionB) return;
      if (project.engine.isPlaying.getValue()) project.engine.stop(true);
      const bpm = project.timelineBox.bpm.getValue();
      const nextSeamSeconds = SEAM_SECONDS_BY_POSITION[next];
      const seamPPQN = PPQN.secondsToPulses(nextSeamSeconds, bpm);
      const fullDurationPPQN = PPQN.secondsToPulses(TOTAL_DURATION_SECONDS, bpm);
      project.editing.modify(() => {
        regionA.duration.setValue(seamPPQN);
        regionB.position.setValue(seamPPQN);
        regionB.duration.setValue(fullDurationPPQN - seamPPQN);
        regionB.loopOffset.setValue(seamPPQN);
      });
      setGotByStep({});
      setSeamPosition(next);
    },
    [project]
  );

  // Render the current scenario offline and look for the inversion-and-
  // amplification artifact in a tight window around the seam. The signal is
  // a 0.5-amplitude sine, so any |sample| > 0.5 in the seam-spanning block
  // is a clear sign that the shared voice was processed twice.
  const handleScan = useCallback(async () => {
    if (!project || scanning) return;
    if (project.engine.isPlaying.getValue()) project.engine.stop(true);
    const stepIndex =
      seamPosition === "block-aligned"
        ? scenario === "shared"
          ? 1
          : 2
        : scenario === "shared"
          ? 3
          : 4;
    setScanning(true);
    setGotByStep((prev) => {
      const next = { ...prev };
      delete next[stepIndex];
      return next;
    });
    try {
      const sliceStart = seamSeconds - 0.1;
      const sliceEnd = seamSeconds + 0.1;
      const { channels, sampleRate: sr } = await renderOfflineSlice(
        project,
        sliceStart,
        sliceEnd
      );
      const left = channels[0];
      const preDelta = maxDeltaInWindow(
        left,
        sliceStart,
        seamSeconds - 0.05,
        seamSeconds - 0.02,
        sr
      );
      const seamDelta = maxDeltaInWindow(
        left,
        sliceStart,
        seamSeconds - 0.005,
        seamSeconds + 0.005,
        sr
      );
      const preWindow = peakInWindow(
        left,
        sliceStart,
        seamSeconds - 0.05,
        seamSeconds - 0.02,
        sr
      );
      const expectedDelta = (2 * Math.PI * 440 * 0.5) / sr;
      const deltaRatio =
        preDelta.maxDelta > 1e-9 ? seamDelta.maxDelta / preDelta.maxDelta : 0;
      const jumpTauMs =
        (sliceStart + seamDelta.atSecondsFromStart - seamSeconds) * 1000;
      const offsetInBlock = inBlockOffsetSamples(seamSeconds, sr);
      const rows: TestStepRow[] = [
        { label: "pre-seam peak", value: preWindow.peak.toFixed(4) },
        {
          label: "expected clean max |Δ| (= 2π·440·0.5/SR)",
          value: expectedDelta.toFixed(5),
        },
        { label: "seam-band max |Δ|", value: seamDelta.maxDelta.toFixed(5) },
        { label: "seam-Δ / pre-Δ", value: deltaRatio.toFixed(2) },
        { label: "largest jump τ (ms relative to seam)", value: `${jumpTauMs.toFixed(3)} ms` },
        {
          label: "seam in-block offset (samples / 128 at SR)",
          value: `${offsetInBlock} / ${RENDER_QUANTUM} at SR ${sr}`,
        },
      ];
      setGotByStep((prev) => ({ ...prev, [stepIndex]: rows }));
    } catch (error) {
      setGotByStep((prev) => ({
        ...prev,
        [stepIndex]: [{ label: "error", value: String(error) }],
      }));
    } finally {
      setScanning(false);
    }
  }, [project, scanning, seamPosition, scenario, seamSeconds]);

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

  const renderPlaybackHud = () => (
    <>
      <Badge color={atSeam ? "red" : isPlaying ? "amber" : "gray"} size="2">
        <Code>
          {positionSec.toFixed(3)} s
          {atSeam ? " ← SEAM" : ""}
        </Code>
      </Badge>
      <Text size="1" color="gray">
        seam {seamSeconds.toFixed(3)} s · offset{" "}
        {audioContext ? inBlockOffsetSamples(seamSeconds, audioContext.sampleRate) : "—"}/
        {RENDER_QUANTUM} at SR {audioContext?.sampleRate ?? "—"} Hz
      </Text>
      <Button
        onClick={() => {
          handleStop();
          void handleScan();
        }}
        disabled={!isPlaying}
        variant="soft"
        size="2"
      >
        <StopIcon /> Stop &amp; scan
      </Button>
    </>
  );

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar
          links={[
            {
              label: "Voice-fade × clip-fade product demo",
              href: "/voice-fadein-clip-fadein-product-debug-demo.html",
              kind: "demo",
            },
            {
              label: "Pure-Web-Audio target demo",
              href: "/pure-webaudio-target-debug-demo.html",
              kind: "demo",
            },
            {
              label: "debug/shared-source-double-process.md",
              href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/shared-source-double-process.md",
              kind: "note",
            },
          ]}
        />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Touching-Seam Sample Discontinuity
          </Heading>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              Two adjacent same-track regions touching at a seam produce a sample-level
              discontinuity 2 samples before the seam, where <Code>max |Δsample|</Code> measures
              ≈ 2× the clean-sine baseline of <Code>2π·440·0.5/SR</Code>. The discontinuity is
              independent of mediaId (SHARED vs DISTINCT <Code>AudioFileBox</Code>) AND
              independent of where the seam falls within the 128-sample render quantum — all four
              scenarios below produce bit-identical offline output. Live playback sometimes sounds
              different across seam positions; the offline scan does not reproduce that.
              Mechanism: open.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">Status:</Text>
              <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
                {status}
              </Badge>
              {isPlaying && (
                <Badge color="amber">
                  Playing: {scenario === "shared" ? "SHARED" : "DISTINCT"}
                </Badge>
              )}
              <Badge color={seamPosition === "block-aligned" ? "green" : "amber"}>
                Seam: {seamPosition === "block-aligned" ? "block-aligned" : "off-boundary"}
              </Badge>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">Seam position (global config)</Text>
              <Separator size="4" />
              <Text size="2">
                The Web Audio render quantum is 128 samples wide. We test two seam positions to
                check whether the touching-seam discontinuity depends on where the seam lands
                inside a quantum. Both positions are exact integer PPQN at BPM 120 (required —
                <Code>position</Code> is <Code>Int32</Code> and would truncate a fractional
                PPQN, creating a sub-PPQN overlap that <Code>project.copy()</Code> deletes).
              </Text>
              <Text size="2">
                <strong>30.000 s</strong> = PPQN 57600 = sample 1,440,000 at 48 kHz =
                exactly on a 128-sample block boundary (offset 0).{" "}
                <strong>30.500 s</strong> = PPQN 58560 = sample 1,464,000 at 48 kHz =
                64 samples into a block. Live playback sometimes sounds different across the
                two; the offline scan does not reproduce that (numbers are bit-identical).
              </Text>
              <Text size="2" color="gray">
                Steps 1–2 use 30.000 s. Steps 3–4 use 30.500 s. Use this toggle to switch
                between them — switching also clears any previously-recorded Got rows so you
                can re-walk the matrix from a clean slate.
              </Text>
              <Flex gap="3" wrap="wrap">
                <Button
                  onClick={() => applySeamPosition("block-aligned")}
                  disabled={!project || status !== "Ready" || scanning}
                  variant={seamPosition === "block-aligned" ? "solid" : "outline"}
                  color="green"
                  size="3"
                >
                  Set seam: 30.000 s (block-aligned, offset 0/128 at 48 kHz)
                </Button>
                <Button
                  onClick={() => applySeamPosition("off-boundary")}
                  disabled={!project || status !== "Ready" || scanning}
                  variant={seamPosition === "off-boundary" ? "solid" : "outline"}
                  color="amber"
                  size="3"
                >
                  Set seam: 30.500 s (off-boundary, offset 64/128 at 48 kHz)
                </Button>
              </Flex>
            </Flex>
          </Card>

          <TestStep
            index={1}
            title="Block-aligned seam + SHARED AudioFileBox"
            description={
              <>
                <strong>Requires:</strong> seam toggle above set to{" "}
                <strong>30.000 s (block-aligned)</strong>. Both regions reference one{" "}
                <Code>AudioFileBox</Code>. <strong>Listen for:</strong> a brief sample-level
                snap at the seam; peak amplitude is unchanged.
              </>
            }
            actions={
              <>
                <Button
                  onClick={() => applyScenarioAndPlay("shared")}
                  disabled={
                    !project ||
                    status !== "Ready" ||
                    scanning ||
                    seamPosition !== "block-aligned"
                  }
                  color="amber"
                  size="3"
                >
                  <PlayIcon /> Play (SHARED file)
                </Button>
                {renderPlaybackHud()}
              </>
            }
            expected={[
              { label: "pre-seam peak", value: "≈ 0.5000" },
              { label: "expected clean max |Δ| (= 2π·440·0.5/SR)", value: "≈ 0.02880 at SR 48000" },
              { label: "seam-band max |Δ|", value: "≈ 0.05747" },
              { label: "seam-Δ / pre-Δ", value: "≈ 1.99 (~2× clean baseline)" },
              { label: "largest jump τ (ms relative to seam)", value: "≈ −0.042 ms (2 samples before seam)" },
              { label: "seam in-block offset (samples / 128 at SR)", value: "0 / 128 at SR 48000" },
            ]}
            got={gotByStep[1] ?? null}
          />

          <TestStep
            index={2}
            title="Block-aligned seam + DISTINCT AudioFileBoxes"
            description={
              <>
                <strong>Requires:</strong> seam toggle still at{" "}
                <strong>30.000 s (block-aligned)</strong>. Two distinct{" "}
                <Code>AudioFileBox</Code>es with identical on-disk content (rules out the
                shared-voice mechanism — voices are keyed per region, so SHARED and DISTINCT
                yield independent voices either way). <strong>Listen for:</strong> the same
                snap as step 1.
              </>
            }
            actions={
              <>
                <Button
                  onClick={() => applyScenarioAndPlay("distinct")}
                  disabled={
                    !project ||
                    status !== "Ready" ||
                    scanning ||
                    seamPosition !== "block-aligned"
                  }
                  color="amber"
                  size="3"
                >
                  <PlayIcon /> Play (DISTINCT files)
                </Button>
                {renderPlaybackHud()}
              </>
            }
            expected={[
              { label: "pre-seam peak", value: "≈ 0.5000" },
              { label: "expected clean max |Δ| (= 2π·440·0.5/SR)", value: "≈ 0.02880 at SR 48000" },
              { label: "seam-band max |Δ|", value: "≈ 0.05747" },
              { label: "seam-Δ / pre-Δ", value: "≈ 1.99 (bit-identical to step 1)" },
              { label: "largest jump τ (ms relative to seam)", value: "≈ −0.042 ms" },
              { label: "seam in-block offset (samples / 128 at SR)", value: "0 / 128 at SR 48000" },
            ]}
            got={gotByStep[2] ?? null}
          />

          <TestStep
            index={3}
            title="Off-boundary seam + SHARED AudioFileBox"
            description={
              <>
                <strong>Requires:</strong> seam toggle above set to{" "}
                <strong>30.500 s (off-boundary)</strong>. Both regions reference one{" "}
                <Code>AudioFileBox</Code>. <strong>Listen for:</strong> live, the off-boundary
                snap sometimes sounds louder than block-aligned (subjective). Offline scan:
                same numbers.
              </>
            }
            actions={
              <>
                <Button
                  onClick={() => applyScenarioAndPlay("shared")}
                  disabled={
                    !project ||
                    status !== "Ready" ||
                    scanning ||
                    seamPosition !== "off-boundary"
                  }
                  color="amber"
                  size="3"
                >
                  <PlayIcon /> Play (SHARED file)
                </Button>
                {renderPlaybackHud()}
              </>
            }
            expected={[
              { label: "pre-seam peak", value: "≈ 0.5000" },
              { label: "expected clean max |Δ| (= 2π·440·0.5/SR)", value: "≈ 0.02880 at SR 48000" },
              { label: "seam-band max |Δ|", value: "≈ 0.05747 (same as block-aligned offline)" },
              { label: "seam-Δ / pre-Δ", value: "≈ 1.99" },
              { label: "largest jump τ (ms relative to seam)", value: "≈ −0.042 ms" },
              { label: "seam in-block offset (samples / 128 at SR)", value: "64 / 128 at SR 48000" },
            ]}
            got={gotByStep[3] ?? null}
          />

          <TestStep
            index={4}
            title="Off-boundary seam + DISTINCT (confirms all four equivalent)"
            description={
              <>
                <strong>Requires:</strong> seam toggle still at{" "}
                <strong>30.500 s (off-boundary)</strong>. Two distinct{" "}
                <Code>AudioFileBox</Code>es with identical on-disk content. Closes the 2×2
                matrix — all four offline scans return bit-identical numbers, confirming the
                artifact is independent of both mediaId and seam-position-in-block.
              </>
            }
            actions={
              <>
                <Button
                  onClick={() => applyScenarioAndPlay("distinct")}
                  disabled={
                    !project ||
                    status !== "Ready" ||
                    scanning ||
                    seamPosition !== "off-boundary"
                  }
                  color="amber"
                  size="3"
                >
                  <PlayIcon /> Play (DISTINCT files)
                </Button>
                {renderPlaybackHud()}
              </>
            }
            expected={[
              { label: "pre-seam peak", value: "≈ 0.5000" },
              { label: "expected clean max |Δ| (= 2π·440·0.5/SR)", value: "≈ 0.02880 at SR 48000" },
              { label: "seam-band max |Δ|", value: "≈ 0.05747" },
              { label: "seam-Δ / pre-Δ", value: "≈ 1.99 (bit-identical to steps 1–3)" },
              { label: "largest jump τ (ms relative to seam)", value: "≈ −0.042 ms" },
              { label: "seam in-block offset (samples / 128 at SR)", value: "64 / 128 at SR 48000" },
            ]}
            got={gotByStep[4] ?? null}
          />

          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">Configuration</Text>
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
Seam (current):      ${seamSeconds.toFixed(3)} s (${seamPosition}, PPQN ${seamSeconds * BPM * 16}, offset ${audioContext ? inBlockOffsetSamples(seamSeconds, audioContext.sampleRate) : "—"}/${RENDER_QUANTUM} in block)`}
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
