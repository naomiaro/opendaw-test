import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import {
  BaseFrequencyRange,
  InstrumentFactories,
} from "@opendaw/studio-adapters";
import { TransientPlayMode } from "@opendaw/studio-enums";
import {
  AudioFileBox,
  AudioRegionBox,
  AudioPitchStretchBox,
  AudioTimeStretchBox,
  ValueEventCollectionBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { loadAudioFile } from "@/lib/audioUtils";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { ensureTransientMarkers } from "@/lib/transientDetection";
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
  Button,
  Callout,
  Badge,
  Separator,
  Slider,
  Code,
  SegmentedControl,
} from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";

type PlayMode = "none" | "pitch" | "time";

const SAMPLE_PATH = "/audio/BassDrums30.mp3";
const SAMPLE_NAME = "BassDrums30";
const PROJECT_BPM = 120;

// Cents offset from the project's starting concert pitch. The TimeStretch
// box's playbackRate is the multiplier we need: 2^(cents/1200). The baseline
// is whatever the project loaded with (typically 440, but a project saved at
// e.g. 443 is honoured) so audio plays at source rate when the slider matches
// the baseline.
function computeTuningCents(refHz: number, baselineHz: number): number {
  return 1200 * Math.log2(refHz / baselineHz);
}
function computePlaybackRate(
  userCents: number,
  refHz: number,
  baselineHz: number
): number {
  const totalCents = userCents + computeTuningCents(refHz, baselineHz);
  return Math.min(2.0, Math.max(0.5, Math.pow(2, totalCents / 1200)));
}

function TimePitchDemo() {
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);

  const [playMode, setPlayMode] = useState<PlayMode>("none");
  const [cents, setCents] = useState(0);
  const [referencePitch, setReferencePitch] = useState(
    BaseFrequencyRange.default
  );
  const [bpm, setBpm] = useState(PROJECT_BPM);
  const [transientMode, setTransientMode] = useState<TransientPlayMode>(
    TransientPlayMode.Pingpong
  );
  const [transientCount, setTransientCount] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);

  const regionRef = useRef<AudioRegionBox | null>(null);
  const audioFileBoxRef = useRef<AudioFileBox | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const stretchBoxRef = useRef<
    AudioPitchStretchBox | AudioTimeStretchBox | null
  >(null);
  const durationSecondsRef = useRef(0);
  const durationPpqnRef = useRef(0);
  // Re-entrancy guard: the SegmentedControl can fire onValueChange faster than
  // async transient detection completes. State-based guards have a stale closure;
  // a ref is read fresh on every invocation.
  const switchingRef = useRef(false);
  // Tuning is read by both the cents slider handler and the mode-switch path;
  // keep it in a ref so those callbacks don't need to re-bind on every change.
  const referencePitchRef = useRef(referencePitch);
  referencePitchRef.current = referencePitch;
  const centsRef = useRef(cents);
  centsRef.current = cents;
  // The project's starting baseFrequency — captured once at init, used as the
  // "cents = 0" baseline so audio plays at source rate when the slider matches.
  const initialPitchRef = useRef(BaseFrequencyRange.default);

  const { isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  const [localAudioBuffers] = useState(() => new Map<string, AudioBuffer>());

  // ---- Init project + load sample + create region (NoStretch by default)
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        setStatus("Booting OpenDAW...");
        const { project: newProject, audioContext: newAudioContext } =
          await initializeOpenDAW({ localAudioBuffers, bpm: PROJECT_BPM });
        if (cancelled) return;

        setStatus("Loading audio file...");
        const audioBuffer = await loadAudioFile(newAudioContext, SAMPLE_PATH);
        const fileUuid = UUID.generate();
        localAudioBuffers.set(UUID.toString(fileUuid), audioBuffer);
        audioBufferRef.current = audioBuffer;

        const durationSeconds = audioBuffer.duration;
        const durationPpqn = Math.round(
          PPQN.secondsToPulses(durationSeconds, PROJECT_BPM)
        );
        durationSecondsRef.current = durationSeconds;
        durationPpqnRef.current = durationPpqn;

        // Honour whatever baseFrequency the project came in with — for a
        // freshly created project this is the field default (440), but a saved
        // project authored at e.g. 443 keeps that value. The captured baseline
        // is what "cents = 0" means for the rest of the session.
        const initialPitch = newProject.rootBox.baseFrequency.getValue();
        initialPitchRef.current = initialPitch;

        newProject.editing.modify(() => {
          const { trackBox } = newProject.api.createInstrument(
            InstrumentFactories.Tape
          );

          const audioFileBox = AudioFileBox.create(
            newProject.boxGraph,
            fileUuid,
            (box) => {
              box.fileName.setValue(SAMPLE_NAME);
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
              box.duration.setValue(durationSeconds);
              box.loopDuration.setValue(durationSeconds);
              box.timeBase.setValue(TimeBase.Seconds);
              box.label.setValue(SAMPLE_NAME);
            }
          );
          regionRef.current = region;
        });

        await newProject.engine.queryLoadingComplete();
        if (cancelled) return;

        setReferencePitch(initialPitch);
        referencePitchRef.current = initialPitch;
        setProject(newProject);
        setAudioContext(newAudioContext);
        setStatus("Ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("Failed");
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [localAudioBuffers]);

  // ---- Mode switch: tears down old stretch box, builds new one with default warp markers
  const switchMode = useCallback(
    async (nextMode: PlayMode) => {
      if (!project || !regionRef.current || !audioBufferRef.current) return;

      const region = regionRef.current;
      const audioFileBox = audioFileBoxRef.current!;
      const audioBuffer = audioBufferRef.current;
      const durationPpqn = durationPpqnRef.current;
      const durationSeconds = durationSecondsRef.current;

      switchingRef.current = true;
      setSwitching(true);
      try {
        // For TimeStretch, make sure the file has transient markers BEFORE we
        // attach the play-mode box. ensureTransientMarkers throws if detection
        // returns 0 positions, so the engine never silently renders nothing.
        if (nextMode === "time") {
          setStatus("Detecting transients...");
          const positions = await ensureTransientMarkers(
            project,
            audioFileBox,
            audioBuffer
          );
          setTransientCount(positions.length);
        } else {
          setTransientCount(null);
        }

        // Single transaction, matching the SDK's AudioContentModifier pattern:
        // create new → refer (replaces old pointer) → delete old → flip timeBase.
        // `refer` doesn't require a prior `defer` — it replaces atomically.
        project.editing.modify(() => {
          const prev = stretchBoxRef.current;

          if (nextMode === "none") {
            region.playMode.defer();
            if (prev) prev.delete();
            stretchBoxRef.current = null;
            region.timeBase.setValue(TimeBase.Seconds);
            region.duration.setValue(durationSeconds);
            region.loopOffset.setValue(0);
            region.loopDuration.setValue(durationSeconds);
            return;
          }

          const boxGraph = project.boxGraph;
          const nextBox =
            nextMode === "pitch"
              ? AudioPitchStretchBox.create(boxGraph, UUID.generate())
              : AudioTimeStretchBox.create(boxGraph, UUID.generate(), (b) => {
                  b.transientPlayMode.setValue(transientMode);
                  // userCents is 0 on mode switch (setCents below); only the
                  // active tuning offset contributes to the initial rate.
                  b.playbackRate.setValue(
                    computePlaybackRate(
                      0,
                      referencePitchRef.current,
                      initialPitchRef.current
                    )
                  );
                });

          // Default warp markers: 0 → 0, durationPpqn → durationSeconds.
          // The studio app's AudioContentModifier preserves the old box's markers
          // across swaps; this demo recreates defaults for simplicity.
          WarpMarkerBox.create(boxGraph, UUID.generate(), (m) => {
            m.owner.refer(nextBox.warpMarkers);
            m.position.setValue(0);
            m.seconds.setValue(0);
          });
          WarpMarkerBox.create(boxGraph, UUID.generate(), (m) => {
            m.owner.refer(nextBox.warpMarkers);
            m.position.setValue(durationPpqn);
            m.seconds.setValue(durationSeconds);
          });

          // Re-route the region pointer to the new box, then delete the old one.
          // `refer` replaces the existing target cleanly — no `defer` needed first.
          region.playMode.refer(nextBox);
          if (prev) prev.delete();
          stretchBoxRef.current = nextBox;

          region.timeBase.setValue(TimeBase.Musical);
          region.duration.setValue(durationPpqn);
          region.loopOffset.setValue(0);
          region.loopDuration.setValue(durationPpqn);
        });

        setPlayMode(nextMode);
        setCents(0);
        setStatus("Ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed");
        // Reconcile UI ↔ box state: the editing.modify above is atomic, so on
        // failure the box graph is unchanged. Drop UI back to the mode it was
        // actually in by reading stretchBoxRef (untouched on throw).
        const current = stretchBoxRef.current;
        if (current === null) setPlayMode("none");
        else if (current instanceof AudioTimeStretchBox) setPlayMode("time");
        else setPlayMode("pitch");
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [project, transientMode]
  );

  // ---- Cents slider (TimeStretch only)
  const onCentsChange = useCallback(
    (value: number) => {
      if (!project) return;
      const box = stretchBoxRef.current;
      if (!box || !(box instanceof AudioTimeStretchBox)) return;
      const rate = computePlaybackRate(
        value,
        referencePitchRef.current,
        initialPitchRef.current
      );
      project.editing.modify(() => {
        box.playbackRate.setValue(rate);
      });
      setCents(value);
    },
    [project]
  );

  // ---- Reference pitch (A4): writes baseFrequency project-wide AND auto-engages
  // TimeStretch the first time the value diverges from the loaded baseline.
  // baseFrequency itself only affects MIDI synths in the SDK — to retune an
  // audio file we need a TimeStretch box whose playbackRate can carry the
  // cents offset, so we attach one on demand.
  const onReferencePitchChange = useCallback(
    async (value: number) => {
      if (!project) return;
      const clamped = Math.min(
        BaseFrequencyRange.max,
        Math.max(BaseFrequencyRange.min, value)
      );
      referencePitchRef.current = clamped;
      setReferencePitch(clamped);

      const currentBox = stretchBoxRef.current;
      project.editing.modify(() => {
        project.rootBox.baseFrequency.setValue(clamped);
        if (currentBox instanceof AudioTimeStretchBox) {
          currentBox.playbackRate.setValue(
            computePlaybackRate(
              centsRef.current,
              clamped,
              initialPitchRef.current
            )
          );
        }
      });

      if (currentBox instanceof AudioTimeStretchBox) return;

      // Not in TimeStretch — engage it so the retune is audible.
      if (!switchingRef.current) {
        await switchMode("time");
        // If auto-engage failed (switchMode caught and surfaced its own error),
        // add A4 context so the user knows the saved tuning is silent on audio.
        if (stretchBoxRef.current === null) {
          setError((prev) =>
            prev
              ? `${prev} A4 saved as ${clamped} Hz, but TimeStretch did not engage to retune the audio.`
              : prev
          );
        }
      }
    },
    [project, switchMode]
  );

  // ---- Transient play mode (TimeStretch only)
  const onTransientModeChange = useCallback(
    (mode: TransientPlayMode) => {
      if (!project) return;
      const box = stretchBoxRef.current;
      if (!box || !(box instanceof AudioTimeStretchBox)) {
        // Not in TimeStretch mode — keep the UI state in sync but no-op the box.
        setTransientMode(mode);
        return;
      }
      project.editing.modify(() => {
        box.transientPlayMode.setValue(mode);
      });
      setTransientMode(mode);
    },
    [project]
  );

  // ---- BPM (visible in all modes — this is the control that reveals what each mode does)
  const onBpmChange = useCallback(
    (value: number) => {
      if (!project) return;
      project.editing.modify(() => {
        project.timelineBox.bpm.setValue(value);
      });
      setBpm(value);
    },
    [project]
  );

  const tuningCents = computeTuningCents(referencePitch, initialPitchRef.current);
  const playbackRate = computePlaybackRate(
    cents,
    referencePitch,
    initialPitchRef.current
  );
  // Derive displayed cents from the (clamped) rate so the readout never
  // disagrees with the audible playback at the ±1200 boundary.
  const appliedCents = 1200 * Math.log2(playbackRate);
  const isCentsClamped = Math.abs(appliedCents - (cents + tuningCents)) > 0.01;

  return (
    <Theme appearance="dark" accentColor="iris" radius="medium">
      <Container size="3" px={{ initial: "4", sm: "6" }} py="6">
        <GitHubCorner />
        <Flex direction="column" gap="5">
          <Flex direction="column" gap="2">
            <BackLink />
            <Heading size="7">Time &amp; Pitch Demo</Heading>
            <Text color="gray">
              Switch a region between the three audio play modes and hear what
              changes. Source for the chapter at{" "}
              <a href="https://opendaw-test.pages.dev/docs/18-time-and-pitch.html">
                docs/18-time-and-pitch
              </a>
              .
            </Text>
          </Flex>

          {error && (
            <Callout.Root color="red">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}

          <Card>
            <Flex direction="column" gap="4" p="3">
              <Flex justify="between" align="center">
                <Heading size="4">Play Mode</Heading>
                <Badge color={status === "Ready" ? "green" : "gray"}>{status}</Badge>
              </Flex>

              <div
                style={{
                  opacity: switching || isPlaying ? 0.5 : 1,
                  pointerEvents: switching || isPlaying ? "none" : "auto",
                }}
              >
                <SegmentedControl.Root
                  value={playMode}
                  onValueChange={(v) => {
                    // Belt-and-braces: the ref guards against re-entry even if
                    // the parent's pointer-events block is bypassed.
                    if (switchingRef.current) return;
                    void switchMode(v as PlayMode);
                  }}
                  size="3"
                >
                  <SegmentedControl.Item value="none">NoStretch</SegmentedControl.Item>
                  <SegmentedControl.Item value="pitch">PitchStretch</SegmentedControl.Item>
                  <SegmentedControl.Item value="time">TimeStretch</SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>
              {isPlaying && (
                <Text size="1" color="gray">
                  Stop playback to change mode (avoids mid-stream glitches).
                </Text>
              )}

              <Text size="2" color="gray">
                {playMode === "none" && (
                  <>
                    Default playback. No play-mode box attached, <Code>timeBase = Seconds</Code>.
                    BPM changes leave the audio alone.
                  </>
                )}
                {playMode === "pitch" && (
                  <>
                    <Code>AudioPitchStretchBox</Code> attached with two warp markers.
                    Change the BPM and the audio follows — pitch tracks tempo (varispeed).
                  </>
                )}
                {playMode === "time" && (
                  <>
                    <Code>AudioTimeStretchBox</Code> with{" "}
                    {transientCount !== null ? (
                      <>
                        <strong>{transientCount}</strong> transient markers detected by{" "}
                        <Code>Workers.Transients.detect()</Code>
                      </>
                    ) : (
                      <>transient markers</>
                    )}
                    . Pitch is independent — drag the cents slider. Tempo changes
                    don't shift pitch.
                  </>
                )}
              </Text>

              {playMode === "time" && (
                <>
                  <Separator size="4" />
                  <Flex direction="column" gap="2">
                    <Flex justify="between">
                      <Text weight="medium">Pitch (cents)</Text>
                      <Text color="gray">
                        {cents > 0 ? "+" : ""}
                        {cents} cents
                        {Math.abs(tuningCents) > 0.01 && (
                          <>
                            {" "}
                            {tuningCents > 0 ? "+" : ""}
                            {tuningCents.toFixed(2)} tuning ={" "}
                            {appliedCents > 0 ? "+" : ""}
                            {appliedCents.toFixed(2)}
                          </>
                        )}
                        {isCentsClamped && (
                          <>
                            {" "}
                            <strong>(clamped)</strong>
                          </>
                        )}{" "}
                        · rate {playbackRate.toFixed(3)}×
                      </Text>
                    </Flex>
                    <Slider
                      value={[cents]}
                      onValueChange={([v]) => onCentsChange(v)}
                      min={-1200}
                      max={1200}
                      step={50}
                    />
                    <Text size="1" color="gray">
                      Range ±1200 cents (±1 octave). The setter clamps <Code>playbackRate</Code>
                      to <Code>[0.5, 2.0]</Code>.
                    </Text>
                  </Flex>

                  <Flex direction="column" gap="2">
                    <Text weight="medium">Transient play mode</Text>
                    <SegmentedControl.Root
                      value={String(transientMode)}
                      onValueChange={(v) =>
                        onTransientModeChange(Number(v) as TransientPlayMode)
                      }
                    >
                      <SegmentedControl.Item value={String(TransientPlayMode.Once)}>
                        Once
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value={String(TransientPlayMode.Repeat)}>
                        Repeat
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value={String(TransientPlayMode.Pingpong)}>
                        Pingpong
                      </SegmentedControl.Item>
                    </SegmentedControl.Root>
                  </Flex>
                </>
              )}
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3" p="3">
              <Flex justify="between" align="center">
                <Heading size="4">Reference Pitch (A4)</Heading>
                <Text color="gray">
                  {referencePitch.toFixed(1)} Hz
                  {Math.abs(tuningCents) > 0.01 && (
                    <>
                      {" "}
                      · {tuningCents > 0 ? "+" : ""}
                      {tuningCents.toFixed(2)} cents vs {initialPitchRef.current.toFixed(1)}
                    </>
                  )}
                </Text>
              </Flex>
              <div
                style={{
                  opacity: switching ? 0.5 : 1,
                  pointerEvents: switching ? "none" : "auto",
                }}
              >
                <Slider
                  value={[referencePitch]}
                  onValueChange={([v]) => onReferencePitchChange(v)}
                  min={BaseFrequencyRange.min}
                  max={BaseFrequencyRange.max}
                  step={0.5}
                  disabled={!project}
                />
                <Flex gap="2" wrap="wrap" mt="2">
                  {[432, 440, 442, 443, 444].map((hz) => (
                    <Button
                      key={hz}
                      size="1"
                      variant={referencePitch === hz ? "solid" : "soft"}
                      color="gray"
                      onClick={() => onReferencePitchChange(hz)}
                      disabled={!project}
                    >
                      {hz} Hz
                    </Button>
                  ))}
                </Flex>
              </div>
              <Text size="2" color="gray">
                Writes <Code>project.rootBox.baseFrequency</Code> (range{" "}
                {BaseFrequencyRange.min}–{BaseFrequencyRange.max} Hz). The SDK
                consumes this in <Code>midiToHz()</Code> for synth instruments
                like Vaporisateur — audio files don't read it directly. To
                make the retune audible on the drum loop, the demo
                auto-engages <strong>TimeStretch</strong> the first time the
                value diverges from the project's loaded baseline and applies
                the equivalent{" "}
                <strong>
                  {tuningCents > 0 ? "+" : ""}
                  {tuningCents.toFixed(2)} cents
                </strong>{" "}
                to the box's <Code>playbackRate</Code>.
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3" p="3">
              <Flex justify="between" align="center">
                <Heading size="4">Project BPM</Heading>
                <Text color="gray">
                  {bpm} BPM
                  {bpm !== PROJECT_BPM && (
                    <> · {((bpm / PROJECT_BPM - 1) * 100).toFixed(0)}% off source</>
                  )}
                </Text>
              </Flex>
              <Slider
                value={[bpm]}
                onValueChange={([v]) => onBpmChange(v)}
                min={60}
                max={200}
                step={1}
                disabled={!project}
              />
              <Text size="2" color="gray">
                {playMode === "none" && (
                  <>
                    <strong>NoStretch:</strong> the file plays at its source speed
                    no matter what the BPM is — the audio "drifts" off the grid.
                  </>
                )}
                {playMode === "pitch" && (
                  <>
                    <strong>PitchStretch:</strong> the file follows the BPM and
                    pitch follows tempo. Raise BPM → faster + pitched up. Drop BPM
                    → slower + pitched down. (Classic tape vari-speed.)
                  </>
                )}
                {playMode === "time" && (
                  <>
                    <strong>TimeStretch:</strong> the file follows the BPM but
                    pitch stays at whatever cents you set — transients are spliced
                    to fill the new wall-clock time.
                  </>
                )}
              </Text>
              <Text size="1" color="gray">
                {PROJECT_BPM} BPM is the mapping's identity tempo: the two warp
                markers pin the file's full length to the PPQN span those seconds
                occupy at {PROJECT_BPM} BPM, so the stretch modes play at rate{" "}
                <Code>bpm ÷ {PROJECT_BPM}</Code>. No individual beat is pinned —
                that takes a beat map. See{" "}
                <a href="/warp-demos.html#two-kinds-of-markers">two kinds of markers</a>.
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3" p="3">
              <Heading size="4">Transport</Heading>
              <Flex gap="2">
                <Button
                  onClick={handlePlay}
                  disabled={!project || isPlaying}
                  color="green"
                >
                  Play
                </Button>
                <Button onClick={handlePause} disabled={!project || !isPlaying}>
                  Pause
                </Button>
                <Button
                  onClick={handleStop}
                  disabled={!project}
                  variant="soft"
                  color="gray"
                >
                  Stop
                </Button>
              </Flex>
              <Text size="2" color="gray">
                Sample: <Code>{SAMPLE_PATH}</Code>. The drum loop is the easiest
                material to hear the difference between PitchStretch and TimeStretch.
              </Text>
            </Flex>
          </Card>

          <Callout.Root>
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              First TimeStretch switch runs <Code>Workers.Transients.detect()</Code>{" "}
              on the loaded <Code>AudioBuffer</Code> and writes the detected attack
              points to the <Code>AudioFileBox</Code> (reusable helper:{" "}
              <Code>src/lib/transientDetection.ts</Code>). These are not warp
              markers — detection finds where the engine may splice; the two warp
              markers this demo writes (file start, file end) are the entire
              musical mapping. Beat-aligned warping derives hundreds more from a
              beat map — see the{" "}
              <a href="/warp-demos.html#two-kinds-of-markers">warp overview</a> and{" "}
              <a href="https://opendaw-test.pages.dev/docs/18-time-and-pitch.html#transient-markers-are-required">
                Ch. 18 → Transient Markers Are Required
              </a>
              .
            </Callout.Text>
          </Callout.Root>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<TimePitchDemo />);
