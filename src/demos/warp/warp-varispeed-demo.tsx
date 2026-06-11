// src/demos/warp/warp-varispeed-demo.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { AudioPitchStretchBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import {
  buildWarpAnchors,
  segmentBpms,
  gridAnchorTicks,
  type WarpAnchor,
} from "@/lib/beats/beatMapConversions";
import { setupWarpDemo, type WarpDemoSetup } from "./lib/setupWarpDemo";
import {
  applyRaw,
  applyVarispeed,
  type WarpScenarioContext,
} from "./lib/warpScenarios";
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
  Switch,
  Button,
} from "@radix-ui/themes";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

const QUARTER = PPQN.Quarter; // 960
const BAR = PPQN.fromSignature(4, 4); // 3840

function WarpVarispeedDemo() {
  const [setup, setSetup] = useState<WarpDemoSetup | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [warped, setWarped] = useState(false);
  const [repaintKey, setRepaintKey] = useState(0);

  const anchorsRef = useRef<WarpAnchor[]>([]);
  const warpedRef = useRef(false);
  const stretchBoxRef = useRef<AudioPitchStretchBox | null>(null);
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
        setStatus("Ready — warp is OFF, the file will drift off the click");
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

  // Live per-segment readout: direct DOM, no per-frame setState.
  useEffect(() => {
    if (!setup) return undefined;
    const bpms = segmentBpms(setup.markers);
    const { firstBeatTick } = gridAnchorTicks(setup.markers, QUARTER);
    const terminable = AnimationFrame.add(() => {
      const el = segmentReadoutRef.current;
      if (!el) return;
      if (!warpedRef.current) {
        el.textContent = "— (unwarped: file plays at its own wobbly tempo)";
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
        `segment ${n + 1}/${bpms.length} · source ${bpms[n].toFixed(1)} BPM · ` +
        `rate ${rate.toFixed(3)} · ${cents >= 0 ? "+" : ""}${cents.toFixed(0)} cents`;
    });
    return () => terminable.terminate();
  }, [setup]);

  const toggleWarp = useCallback(
    (next: boolean) => {
      if (!setup) return;
      setError(null);
      const { project } = setup;
      const ctx: WarpScenarioContext = {
        project,
        region: setup.region,
        audioBuffer: setup.audioBuffer,
        markers: setup.markers,
        projectBpm: setup.projectBpm,
        prevStretchBox: stretchBoxRef.current,
      };
      try {
        stretchBoxRef.current = next
          ? applyVarispeed(ctx, anchorsRef.current)
          : applyRaw(ctx);
        // Convenience reposition for the stopped state: resets the playhead
        // to bar 1 so the next Play starts cleanly.
        // Mode swaps do NOT reset engine.position (TimeInfo is written only by
        // transport commands); calling setPosition mid-playback would itself
        // cause an audible jump — gate on stopped state only.
        // Read live engine state (not the React var, which may be stale in the
        // closure) for consistency with warp-timestretch-demo.tsx.
        // See debug/time-pitch-start-position-pop.md for resolution.
        if (!project.engine.isPlaying.getValue()) {
          project.engine.setPosition(0);
          pausedPositionRef.current = 0;
        }
        warpedRef.current = next;
        setWarped(next);
        setStatus(
          next
            ? "Ready — warped: beats lock to the click, pitch follows rate"
            : "Ready — warp is OFF, the file will drift off the click"
        );
        setRepaintKey((k) => k + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed");
        // editing.modify is atomic — reconcile UI to actual box state on throw.
        warpedRef.current = stretchBoxRef.current !== null;
        setWarped(stretchBoxRef.current !== null);
      }
    },
    [setup, pausedPositionRef]
  );

  // ---- Waveform callbacks (fractions of canvas width) ----
  const getSegments = useCallback((): WaveformSegment[] => {
    if (!setup) return [];
    const anchors = anchorsRef.current;
    if (!warpedRef.current) return [{ x0: 0, x1: 1, u0: 0, u1: 1 }];
    // Warped: each anchor pair is one slice, stretched to its grid slot.
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
    if (warpedRef.current) {
      for (let tick = 0; tick <= endTick; tick += BAR) lines.push(tick / endTick);
    } else {
      // Unwarped axis is file seconds; bars at the rigid project tempo.
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
    if (warpedRef.current) return tick / anchors[anchors.length - 1].tick;
    // Unwarped: region is Seconds-timeBase at the rigid tempo; axis is file seconds.
    const seconds = (tick / QUARTER) * (60 / setup.projectBpm);
    return seconds / setup.audioBuffer.duration;
  }, [setup]);

  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <div className="mc-kicker">Warp 01 — Varispeed · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>WARP TO GRID: VARISPEED</h1>
          <p className="mc-intro">
            A beat map pins every tracked beat of <em>Otherside</em> to the project grid
            with one <code>WarpMarkerBox</code> per beat on an{" "}
            <code>AudioPitchStretchBox</code>. Between markers the engine reads the file
            at the rate the pins imply — beats lock to the metronome, and pitch scales
            with rate (Ableton&apos;s <em>Re-Pitch</em>). Where the source ran slower than the
            project, it plays sharp; faster, flat.
          </p>
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
              <Flex align="center" gap="3">
                <Switch
                  checked={warped}
                  onCheckedChange={toggleWarp}
                  disabled={!setup || isPlaying}
                />
                <Text>
                  Warp to grid ({setup?.projectBpm ?? "..."} BPM) — toggle while stopped
                </Text>
              </Flex>
              <Text size="2" color="gray">
                Current segment: <span ref={segmentReadoutRef}>—</span>
              </Text>
            </Flex>
          </Card>
          {setup && (
            <div className="mc-lattice-frame">
              <WarpWaveform
                project={setup.project}
                fileUuid={setup.fileUuid}
                getSegments={getSegments}
                getBarLines={getBarLines}
                getPlayheadFrac={getPlayheadFrac}
                repaintKey={repaintKey}
                onError={setError}
              />
            </div>
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
          <section className="mc-anchors">
            <h2 className="mc-anchors-head">The math (warp-markers ch 07)</h2>
            <p>
              Each segment&apos;s rate is <code>projectBpm / segmentBpm</code> — the ratio of
              what the file supplies to what the grid allots. A rate above 1 plays the
              source faster (and sharper, by <code>1200·log₂(rate)</code> cents). The
              project tempo itself is beat-map arithmetic — <code>round(averageBpm)</code>:
              510 beats over the map&apos;s 248 s span average 123.39, so the grid above
              runs at 123 BPM.
              PitchStretch reads the <a href="/warp-demos.html#two-kinds-of-markers">warp
              markers</a> alone — no transient detection runs in this mode, and with no
              splice boundaries there is nothing to introduce artifacts. The
              marker list itself is engine-agnostic: the{" "}
              <a href="/warp-timestretch-demo.html">time-stretch demo</a> consumes
              the identical anchors with pitch preserved, and the{" "}
              <a href="/warp-grid-follows-file-demo.html">grid-follows-file demo</a>{" "}
              inverts the direction entirely. See the{" "}
              <a href="/warp-demos.html">warp overview</a> for which DAWs use each
              approach and who reaches for it.
            </p>
          </section>
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpVarispeedDemo />);
