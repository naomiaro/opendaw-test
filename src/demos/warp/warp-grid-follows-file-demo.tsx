// src/demos/warp/warp-grid-follows-file-demo.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import {
  barsToTempoEvents,
  gridAnchorTicks,
  clipStartSeconds,
  type TempoEvent,
} from "@/lib/beats/beatMapConversions";
import { setupWarpDemo, type WarpDemoSetup } from "./lib/setupWarpDemo";
import {
  applyGridPlacement,
  applyGridTempoEvents,
  gridEndTick,
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

function WarpGridFollowsFileDemo() {
  const [setup, setSetup] = useState<WarpDemoSetup | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [conformed, setConformed] = useState(false);
  const [eventCount, setEventCount] = useState(1);
  const [repaintKey, setRepaintKey] = useState(0);

  const conformedRef = useRef(false);
  const tempoEventsRef = useRef<TempoEvent[]>([]);
  const firstBeatTickRef = useRef(0);
  const endTickRef = useRef(0);
  const bpmReadoutRef = useRef<HTMLSpanElement | null>(null);
  const driftReadoutRef = useRef<HTMLSpanElement | null>(null);
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
        const { markers, audioBuffer, project, region } = result;
        const { firstBeatTick } = gridAnchorTicks(markers, QUARTER);
        firstBeatTickRef.current = firstBeatTick;
        tempoEventsRef.current = barsToTempoEvents(markers, QUARTER);
        // End tick: last tracked beat + one bar of outro headroom (single source of truth).
        endTickRef.current = gridEndTick(markers);

        // The whole point: the audio NEVER changes. NoStretch, Seconds timeBase,
        // placed so the file's first tracked beat sounds exactly at firstBeatTick.
        // waveformOffset trims the file's pre-beat lead-in (a raw seconds shift
        // on the engine read position).
        const ctx: WarpScenarioContext = {
          project,
          region,
          audioBuffer,
          markers,
          projectBpm: result.projectBpm,
          prevStretchBox: null,
        };
        applyGridPlacement(ctx);
        project.engine.setPosition(0);
        setSetup(result);
        setStatus("Ready — grid is RIGID, the metronome fights the music");
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

  // Live BPM + bar-residual readout (direct DOM, no per-frame setState).
  useEffect(() => {
    if (!setup) return undefined;
    const { project, markers } = setup;
    const terminable = AnimationFrame.add(() => {
      const tick = project.engine.position.getValue();
      const bpmEl = bpmReadoutRef.current;
      if (bpmEl) bpmEl.textContent = project.tempoMap.getTempoAt(tick).toFixed(1);
      const driftEl = driftReadoutRef.current;
      if (driftEl) {
        if (!conformedRef.current) {
          driftEl.textContent = "n/a while rigid";
          return;
        }
        // Residual at the nearest downbeat: grid second minus audio second.
        // Bar-level events anchor each downbeat exactly — audioSecond is
        // markers[n].second directly (no ppqnToSeconds(firstBeatTick) offset,
        // which diverges from s0 when the lead-in BPM differs from the bar BPM).
        const rawN = Math.round((tick - firstBeatTickRef.current) / QUARTER);
        const n = Math.max(0, Math.min(markers.length - 1, rawN));
        // Snap n to nearest downbeat (beatInBar === 1).
        let dn = n;
        while (dn > 0 && markers[dn].beatInBar !== 1) dn--;
        const gridSecond = project.tempoMap.ppqnToSeconds(
          firstBeatTickRef.current + dn * QUARTER
        );
        const audioSecond = markers[dn].second;
        const bar = Math.floor(dn / 4) + 1; // 4/4 assumed (matches the fixed-meter grid)
        driftEl.textContent = `bar ${bar}: ${((gridSecond - audioSecond) * 1000).toFixed(2)} ms`;
      }
    });
    return () => terminable.terminate();
  }, [setup]);

  const toggleConform = useCallback(
    (next: boolean) => {
      if (!setup) return;
      setError(null);
      const { project, projectBpm } = setup;
      try {
        applyGridTempoEvents(
          { project },
          next ? tempoEventsRef.current : [{ tick: 0, bpm: projectBpm }]
        );
        conformedRef.current = next;
        setConformed(next);
        setEventCount(next ? tempoEventsRef.current.length : 1);
        setStatus(
          next
            ? "Ready — CONFORMED: the grid bends to the file"
            : "Ready — grid is RIGID, the metronome fights the music"
        );
        setRepaintKey((k) => k + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed");
        // Tempo state is unknown after a failed rewrite — surface the error only.
      }
    },
    [setup]
  );

  // ---- Waveform callbacks. Axis: real seconds (audio plays raw at rate 1.0).
  const totalSeconds = useCallback((): number => {
    if (!setup) return 1;
    return setup.project.tempoMap.ppqnToSeconds(endTickRef.current);
  }, [setup]);

  const getSegments = useCallback((): WaveformSegment[] => {
    if (!setup) return [];
    const { markers, audioBuffer, project } = setup;
    const s0 = clipStartSeconds(markers);
    const total = totalSeconds();
    const audioStart = project.tempoMap.ppqnToSeconds(firstBeatTickRef.current);
    return [
      {
        x0: audioStart / total,
        x1: (audioStart + (audioBuffer.duration - s0)) / total,
        u0: s0 / audioBuffer.duration,
        u1: 1,
      },
    ];
  }, [setup, totalSeconds]);

  const getBarLines = useCallback((): number[] => {
    if (!setup) return [];
    const total = totalSeconds();
    const lines: number[] = [];
    for (let tick = 0; tick <= endTickRef.current; tick += BAR) {
      lines.push(setup.project.tempoMap.ppqnToSeconds(tick) / total);
    }
    return lines;
  }, [setup, totalSeconds]);

  const getPlayheadFrac = useCallback((): number => {
    if (!setup) return 0;
    const tick = setup.project.engine.position.getValue();
    return setup.project.tempoMap.ppqnToSeconds(tick) / totalSeconds();
  }, [setup, totalSeconds]);

  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <div className="mc-kicker">Warp 02 — Set Tempo from Clip · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>WARP THE GRID: SET TEMPO FROM CLIP</h1>
          <p className="mc-intro">
            The inverse of warping audio: the project&apos;s <em>tempo map</em> becomes the
            file&apos;s beat map — one stepped tempo event per bar on OpenDAW&apos;s tempo
            track. The audio is scheduled once and never touched; it plays raw at rate
            1.0, bit-identical in both states. Only the metronome, the bar ruler, and the
            grid bend (Ableton <em>Set tempo from clip</em>, Logic Smart Tempo{" "}
            <em>ADAPT</em>).
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
                <Switch checked={conformed} onCheckedChange={toggleConform} disabled={!setup} />
                <Text>Conform grid to file</Text>
                <Badge variant="soft">
                  {eventCount} tempo event{eventCount === 1 ? "" : "s"}
                </Badge>
              </Flex>
              <Text size="2" color="gray">
                Tempo at playhead: <span ref={bpmReadoutRef}>—</span> BPM · Bar residual:{" "}
                <span ref={driftReadoutRef}>—</span>
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
            <h2 className="mc-anchors-head">The math (warp-markers ch 08)</h2>
            <p>
              One stepped tempo event per bar — BPM computed as{" "}
              <code>60 × 4 / (nextDownbeat − thisDownbeat)</code> in seconds, placed at
              each downbeat&apos;s grid tick. Bar-level granularity (130 events for this
              file, ~150 ms per rewrite) is roughly 4× faster than per-beat events
              (510 events, ~600 ms) while capturing
              the song&apos;s real tempo drift bar-by-bar. The file&apos;s pickup fills the end of
              the lead-in bar (the full-bars rule), and the region stays in Seconds
              timeBase — a Musical region would stretch under the new tempo map,
              defeating the point. Compare{" "}
              <a href="/warp-varispeed-demo.html">varispeed</a> (bends the sound)
              and <a href="/warp-timestretch-demo.html">time-stretch</a> (bends
              neither — it slices). See the{" "}
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

createRoot(document.getElementById("root")!).render(<WarpGridFollowsFileDemo />);
