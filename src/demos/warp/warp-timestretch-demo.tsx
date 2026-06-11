// src/demos/warp/warp-timestretch-demo.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { TransientPlayMode } from "@opendaw/studio-enums";
import {
  AudioPitchStretchBox,
  AudioTimeStretchBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import {
  buildWarpAnchors,
  segmentBpms,
  gridAnchorTicks,
  type WarpAnchor,
} from "@/lib/beats/beatMapConversions";
import { ensureTransientMarkers } from "@/lib/transientDetection";
import { setupWarpDemo, type WarpDemoSetup } from "./lib/setupWarpDemo";
import { WarpWaveform, type WaveformSegment } from "./lib/WarpWaveform";
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
  Badge,
  Separator,
  SegmentedControl,
  Link,
  Button,
} from "@radix-ui/themes";

const QUARTER = PPQN.Quarter; // 960
const BAR = PPQN.fromSignature(4, 4); // 3840

type WarpMode = "raw" | "varispeed" | "timestretch";

function WarpTimestretchDemo() {
  const [setup, setSetup] = useState<WarpDemoSetup | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WarpMode>("raw");
  const [transientMode, setTransientMode] = useState<TransientPlayMode>(
    TransientPlayMode.Pingpong
  );
  const [transientCount, setTransientCount] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const [repaintKey, setRepaintKey] = useState(0);

  const anchorsRef = useRef<WarpAnchor[]>([]);
  const modeRef = useRef<WarpMode>("raw");
  const stretchBoxRef = useRef<AudioPitchStretchBox | AudioTimeStretchBox | null>(null);
  // Re-entrancy guard for the async transient-detection path (stale-closure-proof).
  const switchingRef = useRef(false);
  const segmentReadoutRef = useRef<HTMLSpanElement | null>(null);
  const [localAudioBuffers] = useState(() => new Map<string, AudioBuffer>());

  const project = setup?.project ?? null;
  const { isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext: setup?.audioContext ?? null,
    pausedPositionRef,
  });

  useEffect(() => {
    let cancelled = false;
    setupWarpDemo({ localAudioBuffers, onStatusUpdate: setStatus })
      .then((result) => {
        if (cancelled) return;
        anchorsRef.current = buildWarpAnchors(
          result.markers,
          result.audioBuffer.duration,
          QUARTER
        );
        setSetup(result);
        setStatus("Ready — raw playback drifts off the click");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("Failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [localAudioBuffers]);

  // Live segment readout — in timestretch mode the rate line notes pitch stays put.
  useEffect(() => {
    if (!setup) return undefined;
    const bpms = segmentBpms(setup.markers);
    const { firstBeatTick } = gridAnchorTicks(setup.markers, QUARTER);
    const terminable = AnimationFrame.add(() => {
      const el = segmentReadoutRef.current;
      if (!el) return;
      if (modeRef.current === "raw") {
        el.textContent = "— (raw: file plays at its own wobbly tempo)";
        return;
      }
      const tick = setup.project.engine.position.getValue();
      const n = Math.floor((tick - firstBeatTick) / QUARTER);
      if (n < 0 || n >= bpms.length) {
        el.textContent = "— (outside the tracked beats)";
        return;
      }
      const rate = setup.projectBpm / bpms[n];
      const cents = 1200 * Math.log2(rate);
      el.textContent =
        modeRef.current === "varispeed"
          ? `segment ${n + 1}/${bpms.length} · rate ${rate.toFixed(3)} · ` +
            `${cents >= 0 ? "+" : ""}${cents.toFixed(0)} cents pitch shift`
          : `segment ${n + 1}/${bpms.length} · rate ${rate.toFixed(3)} · pitch unchanged`;
    });
    return () => terminable.terminate();
  }, [setup]);

  const switchMode = useCallback(
    async (next: WarpMode) => {
      if (!setup || switchingRef.current) return;
      const { project, region, audioBuffer, audioFileBox } = setup;
      const anchors = anchorsRef.current;
      const endTick = anchors[anchors.length - 1].tick;
      switchingRef.current = true;
      setSwitching(true);
      try {
        if (next === "timestretch") {
          setStatus("Detecting transients...");
          const positions = await ensureTransientMarkers(project, audioFileBox, audioBuffer);
          setTransientCount(positions.length);
        }
        // Loop area end follows the active mode's timeline length: warped ticks
        // come from the anchor list, raw ticks from seconds at the rigid tempo.
        const rawEndPpqn = Math.round(
          PPQN.secondsToPulses(audioBuffer.duration, setup.projectBpm)
        );
        // Single transaction per the SDK's AudioContentModifier pattern:
        // create new → refer (replaces atomically) → delete old → flip timeBase.
        project.editing.modify(() => {
          const prev = stretchBoxRef.current;
          project.timelineBox.loopArea.to.setValue(next === "raw" ? rawEndPpqn : endTick);
          if (next === "raw") {
            region.playMode.defer();
            if (prev) prev.delete();
            stretchBoxRef.current = null;
            region.timeBase.setValue(TimeBase.Seconds);
            region.duration.setValue(audioBuffer.duration);
            region.loopOffset.setValue(0);
            region.loopDuration.setValue(audioBuffer.duration);
            return;
          }
          const nextBox =
            next === "varispeed"
              ? AudioPitchStretchBox.create(project.boxGraph, UUID.generate())
              : AudioTimeStretchBox.create(project.boxGraph, UUID.generate(), (b) => {
                  b.transientPlayMode.setValue(transientMode);
                  b.playbackRate.setValue(1.0); // pitch preserved: rate 1, timing from markers
                });
          // The identical anchor list both engines consume — the ch09 thesis.
          for (const anchor of anchors) {
            WarpMarkerBox.create(project.boxGraph, UUID.generate(), (m) => {
              m.owner.refer(nextBox.warpMarkers);
              m.position.setValue(anchor.tick);
              m.seconds.setValue(anchor.second);
            });
          }
          region.playMode.refer(nextBox);
          if (prev) prev.delete();
          stretchBoxRef.current = nextBox;
          region.timeBase.setValue(TimeBase.Musical);
          region.duration.setValue(endTick);
          region.loopOffset.setValue(0);
          region.loopDuration.setValue(endTick);
        });
        project.engine.setPosition(0);
        pausedPositionRef.current = 0;
        modeRef.current = next;
        setMode(next);
        setRepaintKey((k) => k + 1);
        setStatus("Ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed");
        // editing.modify is atomic — reconcile UI to actual box state on throw.
        const current = stretchBoxRef.current;
        if (current === null) setMode("raw");
        else if (current instanceof AudioTimeStretchBox) setMode("timestretch");
        else setMode("varispeed");
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [setup, transientMode, pausedPositionRef]
  );

  const onTransientModeChange = useCallback(
    (value: string) => {
      const nextMode = Number(value) as TransientPlayMode;
      setTransientMode(nextMode);
      if (!setup) return;
      const box = stretchBoxRef.current;
      if (box instanceof AudioTimeStretchBox) {
        // transientPlayMode writes do NOT reset engine.position (verified) —
        // safe as a live control.
        setup.project.editing.modify(() => {
          box.transientPlayMode.setValue(nextMode);
        });
      }
    },
    [setup]
  );

  // ---- Waveform callbacks: same mapping as the varispeed demo;
  // "warped" = either conform mode.
  const getSegments = useCallback((): WaveformSegment[] => {
    if (!setup) return [];
    const anchors = anchorsRef.current;
    if (modeRef.current === "raw") return [{ x0: 0, x1: 1, u0: 0, u1: 1 }];
    const endTick = anchors[anchors.length - 1].tick;
    const duration = setup.audioBuffer.duration;
    const segments: WaveformSegment[] = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      segments.push({
        x0: anchors[i].tick / endTick,
        x1: anchors[i + 1].tick / endTick,
        u0: anchors[i].second / duration,
        u1: anchors[i + 1].second / duration,
      });
    }
    return segments;
  }, [setup]);

  const getBarLines = useCallback((): number[] => {
    if (!setup) return [];
    const anchors = anchorsRef.current;
    const endTick = anchors[anchors.length - 1].tick;
    const lines: number[] = [];
    if (modeRef.current !== "raw") {
      for (let tick = 0; tick <= endTick; tick += BAR) lines.push(tick / endTick);
    } else {
      const barSeconds = (BAR / QUARTER) * (60 / setup.projectBpm);
      for (let s = 0; s <= setup.audioBuffer.duration; s += barSeconds) {
        lines.push(s / setup.audioBuffer.duration);
      }
    }
    return lines;
  }, [setup]);

  const getPlayheadFrac = useCallback((): number => {
    if (!setup) return 0;
    const tick = setup.project.engine.position.getValue();
    const anchors = anchorsRef.current;
    if (modeRef.current !== "raw") return tick / anchors[anchors.length - 1].tick;
    const seconds = (tick / QUARTER) * (60 / setup.projectBpm);
    return seconds / setup.audioBuffer.duration;
  }, [setup]);

  return (
    <Theme appearance="dark" accentColor="iris">
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7">Warp to Grid: Time-Stretch</Heading>
          <Text color="gray">
            The triptych on one page. <em>Raw</em> drifts off the metronome.{" "}
            <em>Varispeed</em> locks the beats and changes the key.{" "}
            <em>Time-stretch</em> locks the beats and keeps it — the{" "}
            <strong>identical warp-marker list</strong> consumed by an{" "}
            <code>AudioTimeStretchBox</code>, which plays transient-bounded segments at
            rate 1.0 and resynchronizes at each transient (closer to Ableton&apos;s{" "}
            <em>Beats</em> mode than to a granular engine).
          </Text>
          {error && (
            <Card>
              <Text color="red">{error}</Text>
            </Card>
          )}
          <Card>
            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Text weight="bold">Status</Text>
                <Badge color={setup ? "green" : "orange"}>{status}</Badge>
              </Flex>
              <Separator size="4" />
              {/* Dimmed-div pattern: SegmentedControl.Root lacks a `disabled` prop in
                  this Radix version. The wrapper div blocks pointer events while
                  switching is in progress or audio is playing. */}
              <div
                style={{
                  opacity: switching || isPlaying ? 0.5 : 1,
                  pointerEvents: switching || isPlaying || !setup ? "none" : "auto",
                }}
              >
                <Flex direction="column" gap="3">
                  <SegmentedControl.Root
                    value={mode}
                    onValueChange={(v) => {
                      if (switchingRef.current) return;
                      void switchMode(v as WarpMode);
                    }}
                    size="3"
                  >
                    <SegmentedControl.Item value="raw">Raw</SegmentedControl.Item>
                    <SegmentedControl.Item value="varispeed">Varispeed</SegmentedControl.Item>
                    <SegmentedControl.Item value="timestretch">Time-Stretch</SegmentedControl.Item>
                  </SegmentedControl.Root>
                  <Flex align="center" gap="3">
                    <Text size="2">Transient play mode</Text>
                    <div
                      style={{
                        opacity: mode !== "timestretch" ? 0.4 : 1,
                        pointerEvents: mode !== "timestretch" ? "none" : "auto",
                      }}
                    >
                      <SegmentedControl.Root
                        value={String(transientMode)}
                        onValueChange={onTransientModeChange}
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
                    </div>
                    {transientCount !== null && (
                      <Badge variant="soft">{transientCount} transients</Badge>
                    )}
                  </Flex>
                </Flex>
              </div>
              <Text size="2" color="gray">
                Current segment: <span ref={segmentReadoutRef}>—</span>
              </Text>
            </Flex>
          </Card>
          {setup && (
            <Card>
              <WarpWaveform
                project={setup.project}
                fileUuid={setup.fileUuid}
                getSegments={getSegments}
                getBarLines={getBarLines}
                getPlayheadFrac={getPlayheadFrac}
                repaintKey={repaintKey}
              />
            </Card>
          )}
          <Card>
            <Flex direction="column" gap="3" p="3">
              <Heading size="4">Transport</Heading>
              <Flex gap="2">
                <Button
                  onClick={handlePlay}
                  disabled={!setup || isPlaying}
                  color="green"
                >
                  Play
                </Button>
                <Button onClick={handlePause} disabled={!setup || !isPlaying}>
                  Pause
                </Button>
                <Button
                  onClick={handleStop}
                  disabled={!setup}
                  variant="soft"
                  color="gray"
                >
                  Stop
                </Button>
              </Flex>
            </Flex>
          </Card>
          <Card>
            <Flex direction="column" gap="2">
              <Heading size="4">The thesis (warp-markers ch 09)</Heading>
              <Text size="2" color="gray">
                The warp math does not change. The same anchors driving{" "}
                <Link href="/warp-varispeed-demo.html">varispeed</Link> drive this engine
                untouched — swapping the stretch algorithm never moves a marker, which is
                why Ableton lets you change a clip&apos;s warp <em>mode</em> without touching
                its warp <em>markers</em>. Honest limits apply: transients can smear or
                double under heavy stretching, and extreme rates expose segment looping.
                The third direction —{" "}
                <Link href="/warp-grid-follows-file-demo.html">bend the grid instead</Link>{" "}
                — costs no DSP at all.
              </Text>
            </Flex>
          </Card>
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpTimestretchDemo />);
