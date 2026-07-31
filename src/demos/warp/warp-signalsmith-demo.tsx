// src/demos/warp/warp-signalsmith-demo.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { TransientPlayMode } from "@opendaw/studio-enums";
import { AudioSignalsmithBox, AudioTimeStretchBox } from "@opendaw/studio-boxes";
import {
  AudioSignalsmithBoxAdapter,
  AudioTimeStretchBoxAdapter,
} from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { buildWarpAnchors, type WarpAnchor } from "@/lib/beats/beatMapConversions";
import { ensureTransientMarkers } from "@/lib/transientDetection";
import { setupWarpDemo, type WarpDemoSetup } from "./lib/setupWarpDemo";
import {
  applyRaw,
  applySignalsmith,
  applyTimeStretch,
  type WarpScenarioContext,
  type WarpStretchBox,
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
  SegmentedControl,
  Slider,
  Button,
} from "@radix-ui/themes";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

const QUARTER = PPQN.Quarter;
const BAR = PPQN.fromSignature(4, 4);
// Adapter/box do NOT clamp transpose — the UI is the only clamp in the write
// path; ±24 st mirrors the schema's declared (unenforced) range.
const TRANSPOSE_MIN = -24;
const TRANSPOSE_MAX = 24;
// TimeStretch cents clamp is ±1200 → the A/B pitch-match only holds within ±12 st.
const TIMESTRETCH_MATCH_LIMIT = 12;
const PRESETS = [-2, 0, 3, 12] as const;

// Page-local table in the mastering-console language (no shared table style exists).
const CHOICE_TABLE_STYLES = `
.mc-choice-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 16px;
  font-size: 12.5px;
  line-height: 1.5;
}
.mc-choice-table th {
  font-family: var(--mc-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--mc-label);
  text-align: left;
  padding: 8px 14px 8px 0;
  border-bottom: 1px solid var(--mc-line-bright);
  white-space: nowrap;
}
.mc-choice-table td {
  color: var(--mc-muted);
  padding: 9px 14px 9px 0;
  border-bottom: 1px solid var(--mc-line);
  vertical-align: top;
}
.mc-choice-table td:first-child {
  font-family: var(--mc-mono);
  font-size: 11.5px;
  color: var(--mc-text);
  white-space: nowrap;
}
`;

type WarpMode = "raw" | "signalsmith" | "timestretch";

function clampTranspose(st: number): number {
  return Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, st));
}

function WarpSignalsmithDemo() {
  const [setup, setSetup] = useState<WarpDemoSetup | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WarpMode>("raw");
  const [transpose, setTranspose] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [repaintKey, setRepaintKey] = useState(0);

  const anchorsRef = useRef<WarpAnchor[]>([]);
  const modeRef = useRef<WarpMode>("raw");
  const stretchBoxRef = useRef<WarpStretchBox | null>(null);
  // Re-entrancy guard for the async transient-detection path (stale-closure-proof).
  const switchingRef = useRef(false);
  const transposeRef = useRef(0);
  transposeRef.current = transpose;
  const readoutRef = useRef<HTMLSpanElement | null>(null);
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

  // Live readout: mode + effective pitch.
  useEffect(() => {
    if (!setup) return undefined;
    const terminable = AnimationFrame.add(() => {
      const el = readoutRef.current;
      if (!el) return;
      const st = transposeRef.current;
      if (modeRef.current === "raw") {
        el.textContent = "— (raw: file plays at its own wobbly tempo, source pitch)";
      } else if (modeRef.current === "signalsmith") {
        el.textContent = `spectral stretch · transpose ${st >= 0 ? "+" : ""}${st} st`;
      } else {
        const matched = clampTranspose(st);
        const clamped = Math.abs(matched) > TIMESTRETCH_MATCH_LIMIT;
        const applied = Math.max(
          -TIMESTRETCH_MATCH_LIMIT,
          Math.min(TIMESTRETCH_MATCH_LIMIT, matched)
        );
        el.textContent =
          `transient-segmented stretch · cents ${applied >= 0 ? "+" : ""}${applied * 100}` +
          (clamped ? " (clamped — TimeStretch range is ±12 st)" : "");
      }
    });
    return () => terminable.terminate();
  }, [setup]);

  const switchMode = useCallback(
    async (next: WarpMode) => {
      if (!setup || switchingRef.current) return;
      const anchors = anchorsRef.current;
      switchingRef.current = true;
      setSwitching(true);
      try {
        setError(null);
        if (next === "timestretch") {
          setStatus("Detecting transients...");
          await ensureTransientMarkers(setup.project, setup.audioFileBox, setup.audioBuffer);
        }
        const ctx: WarpScenarioContext = {
          project: setup.project,
          region: setup.region,
          audioBuffer: setup.audioBuffer,
          markers: setup.markers,
          projectBpm: setup.projectBpm,
          prevStretchBox: stretchBoxRef.current,
        };
        // A/B pitch match is folded into applyTimeStretch's creation transaction
        // (initialCents), so every switch is a single atomic editing.modify —
        // the catch below can trust stretchBoxRef as ground truth.
        stretchBoxRef.current =
          next === "raw"
            ? applyRaw(ctx)
            : next === "signalsmith"
              ? applySignalsmith(ctx, anchors, transposeRef.current)
              : applyTimeStretch(
                  ctx,
                  anchors,
                  TransientPlayMode.Pingpong,
                  clampTranspose(transposeRef.current) * 100
                );
        // Convenience reposition for the stopped state only — mode swaps don't
        // reset engine.position; setPosition mid-playback would itself jump.
        if (!setup.project.engine.isPlaying.getValue()) {
          setup.project.engine.setPosition(0);
          pausedPositionRef.current = 0;
        }
        modeRef.current = next;
        setMode(next);
        setRepaintKey((k) => k + 1);
        setStatus(
          next === "raw"
            ? "Ready — raw playback drifts off the click"
            : next === "signalsmith"
              ? "Ready — signalsmith: beats lock, pitch is yours to set"
              : "Ready — time-stretch: beats lock, pitch matched for A/B"
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed");
        // editing.modify is atomic — reconcile UI to actual box state on throw.
        // modeRef drives the readout and waveform mapping, so it must be
        // reconciled alongside the React state.
        const current = stretchBoxRef.current;
        const actual: WarpMode =
          current === null
            ? "raw"
            : current instanceof AudioSignalsmithBox
              ? "signalsmith"
              : "timestretch";
        modeRef.current = actual;
        setMode(actual);
        setRepaintKey((k) => k + 1);
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [setup, pausedPositionRef]
  );

  // Transpose writes are live controls — verified live (see warp CLAUDE.md);
  // the TimeStretch fields are additionally source-audited per-render-block reads.
  const onTransposeChange = useCallback(
    (value: number) => {
      // Keyboard events reach this handler even under the pointer-events
      // wrapper — mirror the SegmentedControl's explicit state guard.
      if (switchingRef.current || modeRef.current === "raw") return;
      const st = clampTranspose(Math.round(value));
      setTranspose(st);
      if (!setup) return;
      const box = stretchBoxRef.current;
      if (box instanceof AudioSignalsmithBox) {
        setup.project.editing.modify(() => {
          setup.project.boxAdapters.adapterFor(box, AudioSignalsmithBoxAdapter).transpose =
            st;
        });
      } else if (box instanceof AudioTimeStretchBox) {
        setup.project.editing.modify(() => {
          setup.project.boxAdapters.adapterFor(box, AudioTimeStretchBoxAdapter).cents =
            st * 100; // adapter clamps rate to [0.5, 2.0] (±1200 cents)
        });
      }
    },
    [setup]
  );

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
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{CHOICE_TABLE_STYLES}</style>
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <div className="mc-kicker">Warp 04 — Signalsmith · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
            WARP TO GRID: SIGNALSMITH
          </h1>
          <p className="mc-intro">
            The spectral answer. The <strong>identical warp-marker list</strong> that
            drives <a href="/warp-varispeed-demo.html">varispeed</a> and{" "}
            <a href="/warp-timestretch-demo.html">time-stretch</a> here feeds an{" "}
            <code>AudioSignalsmithBox</code> — a Signalsmith phase-vocoder stretch that
            locks beats to the grid with <strong>no transient markers</strong> and lets
            you transpose the whole song ±24 semitones while the tempo stays put.
            Change the key without touching the clock.
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
              <div
                style={{
                  opacity: switching || isPlaying ? 0.5 : 1,
                  pointerEvents: switching || isPlaying || !setup ? "none" : "auto",
                  overflowX: "auto",
                }}
              >
                <SegmentedControl.Root
                  value={mode}
                  onValueChange={(v) => {
                    // pointer-events:none on the wrapper is mouse-only — guard
                    // keyboard activation (Tab + Enter) against the same states.
                    if (switchingRef.current || isPlaying) return;
                    void switchMode(v as WarpMode);
                  }}
                  size="3"
                >
                  <SegmentedControl.Item value="raw">Raw</SegmentedControl.Item>
                  <SegmentedControl.Item value="signalsmith">Signalsmith</SegmentedControl.Item>
                  <SegmentedControl.Item value="timestretch">
                    Time-Stretch (A/B)
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>
              <div
                style={{
                  opacity: switching || !setup || mode === "raw" ? 0.4 : 1,
                  pointerEvents: switching || !setup || mode === "raw" ? "none" : "auto",
                }}
              >
                <Flex direction="column" gap="2">
                  <Flex justify="between">
                    <Text size="2" weight="medium">
                      Transpose
                    </Text>
                    <Text size="2" color="gray">
                      {transpose >= 0 ? "+" : ""}
                      {transpose} st
                    </Text>
                  </Flex>
                  <Slider
                    value={[transpose]}
                    onValueChange={([v]) => onTransposeChange(v)}
                    min={TRANSPOSE_MIN}
                    max={TRANSPOSE_MAX}
                    step={1}
                  />
                  <Flex gap="2" wrap="wrap">
                    {PRESETS.map((st) => (
                      <Button
                        key={st}
                        size="1"
                        variant={transpose === st ? "solid" : "soft"}
                        color="gray"
                        onClick={() => onTransposeChange(st)}
                      >
                        {st >= 0 ? "+" : ""}
                        {st} st
                      </Button>
                    ))}
                  </Flex>
                  <Text size="1" color="gray">
                    Live during playback. Signalsmith range ±24 st (the UI clamps —
                    neither the box nor the adapter does). In Time-Stretch A/B the same
                    value drives <code>cents</code>, clamped by the adapter to ±12 st.
                  </Text>
                </Flex>
              </div>
              <Text size="2" color="gray">
                Project grid: {setup?.projectBpm ?? "..."} BPM — both stretch modes lock
                to it; raw drifts.
              </Text>
              <Text size="2" color="gray">
                Engine: <span ref={readoutRef}>—</span>
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
                <Button onClick={handlePlay} disabled={!setup || isPlaying} color="green">
                  Play
                </Button>
                <Button onClick={handlePause} disabled={!setup || !isPlaying}>
                  Pause
                </Button>
                <Button onClick={handleStop} disabled={!setup} variant="soft" color="gray">
                  Stop
                </Button>
              </Flex>
            </Flex>
          </Card>
          <section className="mc-anchors">
            <h2 className="mc-anchors-head">Which stretch, when?</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="mc-choice-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Pitch ↔ time</th>
                    <th>Pitch range</th>
                    <th>Needs</th>
                    <th>Reach for it when</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>NoStretch</td>
                    <td>both fixed at source</td>
                    <td>—</td>
                    <td>nothing</td>
                    <td>audio shouldn&apos;t follow tempo; it drifts under BPM changes</td>
                  </tr>
                  <tr>
                    <td>Varispeed</td>
                    <td>coupled</td>
                    <td>follows tempo</td>
                    <td>warp markers</td>
                    <td>the tape sound is fine or the point; cheapest, artifact-free</td>
                  </tr>
                  <tr>
                    <td>Time-stretch</td>
                    <td>decoupled</td>
                    <td>±12 st</td>
                    <td>warp markers + ≥2 transient markers</td>
                    <td>percussive material — transient-segmented playback keeps attacks sharp</td>
                  </tr>
                  <tr>
                    <td>Signalsmith</td>
                    <td>decoupled</td>
                    <td>±24 st</td>
                    <td>warp markers only</td>
                    <td>
                      sustained or harmonic material, big transposes, or files where
                      transient detection has nothing to find
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The transient dependency is the sharp edge: <code>AudioTimeStretchBox</code>{" "}
              renders <strong>silence</strong> with fewer than two transient markers on
              the file, so sparse material — pads, drones, a solo sustained vocal — can
              defeat it outright. <code>AudioSignalsmithBox</code> has no such
              dependency. The trade runs the other way on drums: the segment player
              re-syncs at every attack, while a phase vocoder must reconstruct attacks
              spectrally. A/B the two pitch-preserving modes above on the same song and
              judge with your own ears; the{" "}
              <a href="/time-pitch-demo.html">time &amp; pitch demo</a> covers the same
              four modes as API mechanics, and the{" "}
              <a href="/warp-demos.html">warp overview</a> maps them onto the DAWs you
              know.
            </p>
          </section>
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpSignalsmithDemo />);
