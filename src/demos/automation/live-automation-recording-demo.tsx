import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimationFrame } from "@opendaw/lib-dom";
import { UUID } from "@opendaw/lib-std";
import type { Project } from "@opendaw/studio-core";
import type { AutomationMode } from "@opendaw/studio-adapters";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { CANVAS_COLORS, CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { DEMO_BPM, HEADER_WIDTH, NUM_BARS, WINDOW_PPQN, presetGhost } from "./laneRenderModel";
import type { LanePoint } from "./laneRenderModel";
import { buildLiveAutomationContent } from "./liveAutomationContent";
import type { LaneId, LaneSpec, LiveAutomationSetup } from "./liveAutomationContent";
import { LiveAutomationLane } from "./LiveAutomationLane";
import { DrumWaveformStrip } from "./DrumWaveformStrip";
import { TRACK_CONFIGS } from "./trackAutomationPresets";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Flex, Grid, Text, Card, Button, Badge, Switch, Select,
  SegmentedControl, Separator, Callout,
} from "@radix-ui/themes";

// The playhead overlay sits over the CANVAS column only: it must clear the lane
// header (the shared HEADER_WIDTH) plus the Radix gap="3" between the header and
// the canvas.
const LANE_HEADER_OFFSET = HEADER_WIDTH + 12; // 12 = Radix gap="3"

const LANE_IDS: ReadonlyArray<LaneId> = ["volume", "pan", "wet"];

type LaneStats = { captured: number; kept: number };

// ParameterFieldAdapters defaults every address to "read". The selector below
// starts on "latch" to match what recording actually does, so the registry has
// to be pushed there at boot — otherwise the control reports a mode nothing set.
const INITIAL_MODE: AutomationMode = "latch";

const NO_OVERRIDES: Record<LaneId, boolean> = { volume: false, pan: false, wet: false };
const NO_STATS: Record<LaneId, LaneStats> = {
  volume: { captured: 0, kept: 0 },
  pan: { captured: 0, kept: 0 },
  wet: { captured: 0, kept: 0 },
};
const NO_GHOSTS: Record<LaneId, string> = { volume: "none", pan: "none", wet: "none" };
const INITIAL_SLIDER_VALUES: Record<LaneId, number> = { volume: 0, pan: 0.5, wet: 0 };

/** Copy one lane slot without a computed-key spread (keeps the Record<LaneId, T> type exact). */
function withLane<T>(record: Record<LaneId, T>, id: LaneId, value: T): Record<LaneId, T> {
  const next: Record<LaneId, T> = { ...record };
  next[id] = value;
  return next;
}

// ---------------------------------------------------------------------------
// Ghost overlays: the very shapes track-automation-demo writes into the box
// graph, drawn here as dashed comparison lines only — no boxes are created.
// The volume presets are normalized unit-value shapes authored on the same
// 8-bar grid as this page's window, so all three lanes reuse them as-is. Only
// Fade Out and Swell actually span the whole window — Fade In's last event is at
// bar 4, and the ghost is drawn with no hold extension, so it simply ends there.
// ---------------------------------------------------------------------------

const GHOST_NAMES: ReadonlyArray<string> = ["Fade In", "Fade Out", "Swell"];

const GHOST_PRESETS: ReadonlyArray<{ name: string; points: LanePoint[] }> = GHOST_NAMES.flatMap(name => {
  // Module-level: a throw here happens before createRoot and would blank the page
  // with nothing but a console trace, so an empty/renamed config degrades to
  // "no ghosts offered" instead.
  const preset = TRACK_CONFIGS[0]?.presets?.find(p => p.name === name);
  if (preset === undefined) {
    console.error(`[live-automation-recording-demo] preset "${name}" is gone from TRACK_CONFIGS — ghost omitted`);
    return [];
  }
  return [{ name, points: presetGhost(preset.events, WINDOW_PPQN) }];
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [setup, setSetup] = useState<LiveAutomationSetup | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [mode, setMode] = useState<AutomationMode>(INITIAL_MODE);
  const [sliderValues, setSliderValues] = useState<Record<LaneId, number>>(INITIAL_SLIDER_VALUES);
  const [overridden, setOverridden] = useState<Record<LaneId, boolean>>(NO_OVERRIDES);
  const [stats, setStats] = useState<Record<LaneId, LaneStats>>(NO_STATS);
  const [ghostNames, setGhostNames] = useState<Record<LaneId, string>>(NO_GHOSTS);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  // True for the WHOLE of a drag — set on the first onValueChange, cleared on
  // Radix's onValueCommit. Setting and clearing it inside one handler would be
  // useless: JS is single-threaded, so the frame loop can never observe a flag
  // that is raised and lowered without yielding.
  const gestureRef = useRef<Record<LaneId, boolean>>({ volume: false, pan: false, wet: false });
  // Authoritative, synchronously-updated mirror of sliderValues: the frame loop
  // reads and writes it without a React dep, and the drag handler updates it
  // BEFORE setState so a frame landing mid-drag cannot write a stale snapshot
  // back over the move. Never assigned from the render body — that would let a
  // render triggered by other state clobber a fresher value.
  const sliderValuesRef = useRef(sliderValues);
  // Region UUIDs that already existed when the current take started. `captured`
  // counts one take's writes, so `kept` has to be scoped the same way — counting
  // every event on the lane makes an overdub read backwards (kept 15 / captured 2).
  const takeBaselineRef = useRef<Record<LaneId, ReadonlySet<string>>>({
    volume: new Set(), pan: new Set(), wet: new Set(),
  });

  // --- Boot -----------------------------------------------------------------

  useEffect(() => {
    let disposed = false;
    let bootProject: Project | null = null;
    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        const { project: newProject, audioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: DEMO_BPM,
          onStatusUpdate: setStatus,
        });
        bootProject = newProject;
        if (disposed) { newProject.terminate(); return; }
        audioCtxRef.current = audioContext;
        const built = await buildLiveAutomationContent(newProject, audioContext, localAudioBuffers, setStatus);
        if (disposed) { newProject.terminate(); return; }
        const initial: Record<LaneId, number> = { ...INITIAL_SLIDER_VALUES };
        built.lanes.forEach(lane => {
          initial[lane.id] = lane.adapter.getUnitValue();
          // Registry state, not box graph — deliberately outside editing.modify().
          newProject.parameterFieldAdapters.setMode(lane.adapter.address, INITIAL_MODE);
        });
        sliderValuesRef.current = initial;
        setSliderValues(initial);
        setProject(newProject);
        setSetup(built);
        setStatus("Ready — press Record");
      } catch (error) {
        // Report FIRST: a throwing teardown below must not swallow the real
        // cause and leave the page stuck on "Booting…" with no error card.
        console.error("[live-automation-recording-demo] init failed: " + String(error) +
          (error instanceof Error && error.stack ? "\n" + error.stack : ""));
        if (!disposed) setInitError(error instanceof Error ? error.message : String(error));
        // Without the terminate, a failed content build leaves the engine
        // worklet running behind the error card.
        try {
          bootProject?.terminate();
        } catch (terminateError) {
          console.error("[live-automation-recording-demo] terminate after init failure threw: " +
            String(terminateError));
        }
      }
    })();
    return () => { disposed = true; };
  }, []);

  // --- Transport state ------------------------------------------------------

  useEffect(() => {
    if (!project) return undefined;
    // Suspensions are runtime-only and dropped by the engine on pause/stop/
    // stopRecording — mirror that on the falling edge of either flag.
    const clearOverrides = () => {
      setOverridden(prev => (LANE_IDS.some(id => prev[id]) ? NO_OVERRIDES : prev));
      // Safety net for a drag whose onValueCommit never arrived (cancelled
      // pointer): nothing is following while stopped, so releasing here is free.
      gestureRef.current = { volume: false, pan: false, wet: false };
    };
    let wasPlaying = false;
    let wasRecording = false;
    const playingSub = project.engine.isPlaying.catchupAndSubscribe(obs => {
      const playing = obs.getValue();
      setIsPlaying(playing);
      if (wasPlaying && !playing) clearOverrides();
      wasPlaying = playing;
    });
    const recordingSub = project.engine.isRecording.catchupAndSubscribe(obs => {
      const recording = obs.getValue();
      setIsRecording(recording);
      // A new take counts its own writes; kept counts come from the box graph.
      if (recording && !wasRecording) {
        setStats(prev => {
          const next: Record<LaneId, LaneStats> = { ...prev };
          LANE_IDS.forEach(id => { next[id] = { captured: 0, kept: prev[id].kept }; });
          return next;
        });
      }
      if (wasRecording && !recording) clearOverrides();
      wasRecording = recording;
    });
    return () => {
      playingSub.terminate();
      recordingSub.terminate();
    };
  }, [project]);

  // --- Write plumbing: captured counts + AutomationSuspension inference ------

  useEffect(() => {
    if (!project || !setup) return undefined;
    // The registry hands back the very adapter instances the lanes hold, so
    // reference identity is the correct (and cheapest) lane lookup.
    const sub = project.parameterFieldAdapters.subscribeWrites(({ adapter }) => {
      const lane = setup.lanes.find(l => l.adapter === adapter);
      if (lane === undefined) return;
      if (project.engine.isRecording.getValue()) {
        setStats(prev => withLane(prev, lane.id, { ...prev[lane.id], captured: prev[lane.id].captured + 1 }));
      } else if (project.engine.isPlaying.getValue() && lane.adapter.track.nonEmpty()) {
        // A write during plain playback is what triggers the engine's
        // AutomationSuspension — there is no observable for it, so infer it here.
        setOverridden(prev => (prev[lane.id] ? prev : withLane(prev, lane.id, true)));
      }
    });
    return () => sub.terminate();
  }, [project, setup]);

  // --- Kept counts: one subscription, recomputed from the box graph ----------

  useEffect(() => {
    if (!project || !setup) return undefined;
    const recompute = () => {
      setStats(prev => {
        const next: Record<LaneId, LaneStats> = { ...prev };
        let changed = false;
        for (const lane of setup.lanes) {
          let kept = 0;
          const trackOption = lane.adapter.track;
          if (trackOption.nonEmpty()) {
            const baseline = takeBaselineRef.current[lane.id];
            for (const region of trackOption.unwrap().regions.adapters.values()) {
              if (!region.isValueRegion()) continue;
              // Regions that predate the take belong to an earlier one.
              if (baseline.has(UUID.toString(region.box.address.uuid))) continue;
              const eventsOption = region.events;
              if (eventsOption.nonEmpty()) kept += eventsOption.unwrap().asArray().length;
            }
          }
          if (next[lane.id].kept !== kept) {
            next[lane.id] = { ...next[lane.id], kept };
            changed = true;
          }
        }
        // Returning prev unchanged lets React bail out — a recording take commits
        // a transaction per write, and re-rendering on each would be a storm.
        return changed ? next : prev;
      });
    };
    recompute();
    const sub = project.editing.subscribe(recompute);
    return () => sub.terminate();
  }, [project, setup]);

  // --- Fader-follows-curve + playhead (one frame loop, no per-frame setState
  //     for the playhead) -----------------------------------------------------

  useEffect(() => {
    if (!project || !setup) return undefined;
    const frame = AnimationFrame.add(() => {
      const engine = project.engine;
      const playing = engine.isPlaying.getValue();
      const position = engine.position.getValue();
      const head = playheadRef.current;
      if (head !== null) {
        const visible = playing && position >= 0 && position <= WINDOW_PPQN;
        head.style.visibility = visible ? "visible" : "hidden";
        if (visible) head.style.left = `${(position / WINDOW_PPQN) * 100}%`;
      }
      if (!playing) return;
      // The plain field observable does not fire while automation plays back —
      // the controlled value (automation + modulation) is the honest read.
      // Built from the ref (kept fresh by the drag handler), so a frame that
      // lands before React commits a drag cannot revert the other lanes.
      const current = sliderValuesRef.current;
      const next: Record<LaneId, number> = { ...current };
      let changed = false;
      for (const lane of setup.lanes) {
        if (gestureRef.current[lane.id]) continue;
        const value = lane.adapter.getControlledUnitValue();
        if (Math.abs(value - current[lane.id]) > 0.001) {
          next[lane.id] = value;
          changed = true;
        }
      }
      if (changed) {
        sliderValuesRef.current = next;
        setSliderValues(next);
      }
    });
    return () => frame.terminate();
  }, [project, setup]);

  // --- Handlers -------------------------------------------------------------

  const onRecord = useCallback(async () => {
    if (!project || !setup) return;
    // The click handler fires this as `void onRecord()`, so an unhandled
    // rejection (a refused resume, a failing startRecording) would be an
    // invisible no-op — report it on the status channel instead.
    try {
      // Freeze what the lanes already hold so the kept counts that follow describe
      // only the take about to start.
      const baseline: Record<LaneId, Set<string>> = { volume: new Set(), pan: new Set(), wet: new Set() };
      for (const lane of setup.lanes) {
        const trackOption = lane.adapter.track;
        if (!trackOption.nonEmpty()) continue;
        for (const region of trackOption.unwrap().regions.adapters.values()) {
          if (region.isValueRegion()) baseline[lane.id].add(UUID.toString(region.box.address.uuid));
        }
      }
      takeBaselineRef.current = baseline;
      // startRecording does not resume the context itself (only the engine
      // facade's play() does) — a suspended context would record silence.
      const audioContext = audioCtxRef.current;
      if (audioContext !== null && audioContext.state !== "running") await audioContext.resume();
      project.startRecording(false); // no count-in: the first write is the take
    } catch (error) {
      console.error("[live-automation-recording-demo] record failed: " + String(error));
      setStatus("Record failed: " + String(error));
    }
  }, [project, setup]);

  const onPlay = useCallback(() => {
    // initializeOpenDAW's engine facade resumes a suspended AudioContext first.
    project?.engine.play();
  }, [project]);

  const onStop = useCallback(() => {
    if (!project) return;
    project.engine.stopRecording();
    project.engine.stop(true);
  }, [project]);

  const onSliderChange = useCallback((lane: LaneSpec, value: number) => {
    if (!project) return;
    // Raised for the rest of the drag; onSliderCommit lowers it.
    gestureRef.current[lane.id] = true;
    // mark=false: a fader drag is one gesture, not fifty undo entries.
    project.editing.modify(() => lane.adapter.setUnitValue(value), false);
    // Ref first, state second — the frame loop reads the ref.
    sliderValuesRef.current = withLane(sliderValuesRef.current, lane.id, value);
    setSliderValues(prev => withLane(prev, lane.id, value));
  }, [project]);

  const onSliderCommit = useCallback((lane: LaneSpec) => {
    gestureRef.current[lane.id] = false;
  }, []);

  const onLoopToggle = useCallback((next: boolean) => {
    if (!project) return;
    project.editing.modify(() => {
      const loopArea = project.timelineBox.loopArea;
      loopArea.from.setValue(0);
      // The transport loops the WHOLE window: one pass is one screenful of lane,
      // so the wrap lands on the right-hand edge instead of mid-canvas.
      loopArea.to.setValue(WINDOW_PPQN);
      loopArea.enabled.setValue(next);
    });
    setLoopEnabled(next);
  }, [project]);

  const onModeChange = useCallback((next: AutomationMode) => {
    if (!project || !setup) return;
    // Registry state, not box graph — never inside editing.modify().
    setup.lanes.forEach(lane => project.parameterFieldAdapters.setMode(lane.adapter.address, next));
    setMode(next);
  }, [project, setup]);

  const ghosts = useMemo(() => {
    const resolve = (name: string): LanePoint[] | null => {
      const preset = GHOST_PRESETS.find(p => p.name === name);
      return preset === undefined ? null : preset.points;
    };
    const result: Record<LaneId, LanePoint[] | null> = { volume: null, pan: null, wet: null };
    LANE_IDS.forEach(id => { result[id] = resolve(ghostNames[id]); });
    return result;
  }, [ghostNames]);

  const transportLabel = isRecording ? "Recording" : isPlaying ? "Playing" : status;

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="4" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="5" style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Automation — Live Recording · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>LATCH</h1>
            <p className="mc-intro">
              Hit Record, then move a fader. OpenDAW's automation recording is{" "}
              <strong>latch-based</strong>: while the engine is recording, the{" "}
              <em>first</em> write to a parameter opens an automation take for that
              parameter alone — a value region on its own lane, no audio recorded — no
              arming, no touch gate. Every parameter you touch gets its own independent
              take, and every write after the first extends the same value region. Only
              a transport stop or a loop wrap closes it. The three lanes below are the
              audio unit's <code>volume</code> and <code>panning</code> plus the
              Delay's <code>wet</code>, each resolved to its{" "}
              <code>AutomatableParameterFieldAdapter</code>. Nothing is pre-created:
              the automation track and its region appear on the first gesture.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text><strong>Initialization failed:</strong> {initError}</Callout.Text>
            </Callout.Root>
          ) : !project || !setup ? (
            <Text align="center" color="gray">{status}</Text>
          ) : (
            <>
              <Card>
                <Flex direction="column" gap="3">
                  <Flex align="center" gap="3" wrap="wrap">
                    <Button color="red" onClick={() => { void onRecord(); }} disabled={isRecording || isPlaying}>● Record</Button>
                    <Button onClick={onPlay} disabled={isPlaying}>▶ Play</Button>
                    <Button variant="soft" onClick={onStop}>■ Stop</Button>
                    <Separator orientation="vertical" />
                    <Flex align="center" gap="2">
                      <Switch checked={loopEnabled} onCheckedChange={onLoopToggle} />
                      <Text size="2" color="gray">Loop {NUM_BARS} bars</Text>
                    </Flex>
                    <Separator orientation="vertical" />
                    <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>
                      {DEMO_BPM} BPM · window {NUM_BARS} bars
                    </Text>
                    <Badge color={isRecording ? "red" : isPlaying ? "green" : "amber"}>{transportLabel}</Badge>
                  </Flex>
                  <Text size="2" color="gray">
                    The drum loop plays across the whole eight-bar window — the region
                    itself region-loops the four-bar audio, so it repeats once at bar 4
                    (that is the brighter grid line) with or without the Loop switch.
                    The switch controls the <em>transport</em>, and it wraps the whole
                    window: one pass is one screenful, about 15.7 s at {DEMO_BPM} BPM,
                    and the wrap lands on the right-hand edge of every lane. Recording
                    starts immediately — <code>startRecording(false)</code>, no count-in.
                    At each wrap every lane's automation take is finalized and a fresh
                    region opens for the next pass — holding your last value, and growing
                    with the playhead whether or not you play anything, so a hands-off lap
                    overwrites the lap before it. Overdub a different lane each pass and
                    the outlines stack up; leave one alone and it gets flattened.
                  </Text>
                </Flex>
              </Card>

              <Card>
                <Flex direction="column" gap="4">
                  <Flex align="center" justify="between" wrap="wrap" gap="3">
                    <Text size="2" weight="bold" color="gray">Automation Lanes</Text>
                    <Flex align="center" gap="2">
                      <Badge color="red">REC</Badge>
                      <Text size="1" color="gray">writing an automation take</Text>
                      <Badge color="amber">OVERRIDE</Badge>
                      <Text size="1" color="gray">automation suspended by hand</Text>
                    </Flex>
                  </Flex>

                  {/* Waveform strip + lane stack + one playhead overlay across all four rows. */}
                  <div style={{ position: "relative" }}>
                    <Flex direction="column" gap="3">
                      <DrumWaveformStrip regionAdapter={setup.drumRegionAdapter} />
                      {setup.lanes.map(lane => (
                        <LiveAutomationLane
                          key={lane.id}
                          project={project}
                          spec={lane}
                          sliderValue={sliderValues[lane.id]}
                          onSliderChange={value => onSliderChange(lane, value)}
                          onSliderCommit={() => onSliderCommit(lane)}
                          overridden={overridden[lane.id]}
                          recording={isRecording}
                          stats={stats[lane.id]}
                          ghost={ghosts[lane.id]}
                        />
                      ))}
                    </Flex>
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: LANE_HEADER_OFFSET,
                        right: 0,
                        pointerEvents: "none",
                      }}
                    >
                      <div
                        ref={playheadRef}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          width: 2,
                          left: 0,
                          background: CANVAS_COLORS.playhead,
                          visibility: "hidden",
                        }}
                      />
                    </div>
                  </div>

                  <Text size="1" color="gray">
                    Each lane draws the value regions on its parameter's automation
                    track over an eight-bar window; the brighter grid line at bar 4 is
                    where the drum audio repeats, not a transport boundary — the loop
                    wraps at the far edge. Fader writes go through{" "}
                    <code>editing.modify(() =&gt; adapter.setUnitValue(v), false)</code> —
                    the <code>false</code> skips the undo mark so a drag is one gesture,
                    not fifty entries on the undo stack.
                  </Text>
                </Flex>
              </Card>

              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">How an automation take is made</Text>
                  <Grid columns={{ initial: "1", sm: "2", md: "4" }} gap="3">
                    <Flex direction="column" gap="1">
                      <div className="mc-lattice-label" style={{ color: "var(--mc-amber)" }}>1 · Write</div>
                      <Text size="2" color="gray">
                        The fader calls <code>setUnitValue</code> inside a transaction.
                        Every parameter write — fader, MIDI, or a checkbox — is broadcast
                        by <code>parameterFieldAdapters.subscribeWrites</code>, which is
                        how this page counts them.
                      </Text>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <div className="mc-lattice-label" style={{ color: "var(--mc-amber)" }}>2 · Latch</div>
                      <Text size="2" color="gray">
                        While <code>engine.isRecording</code>, that first write opens the
                        automation take. <code>RecordAutomation</code> resolves the lane owner via{" "}
                        <code>optTracks()</code> and creates the automation track on
                        demand — nothing had to exist beforehand.
                      </Text>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <div className="mc-lattice-label" style={{ color: "var(--mc-amber)" }}>3 · Region</div>
                      <Text size="2" color="gray">
                        Further writes extend the same <code>ValueRegionBox</code>, its
                        events at region-local positions. A loop wrap finalizes it and
                        opens the next; stop closes it for good.
                      </Text>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <div className="mc-lattice-label" style={{ color: "var(--mc-amber)" }}>4 · Simplify</div>
                      <Text size="2" color="gray">
                        On finalize the raw stream is thinned by a single-pass greedy
                        collinearity pass with ε = 0.01: points that lie within that
                        tolerance of the line through their neighbours are dropped. Each
                        lane header shows <em>kept / captured</em> — hundreds of writes
                        typically survive as a handful of events. With Loop on you can
                        watch it happen: the curve visibly snaps to its thinned form at{" "}
                        <em>every</em> loop wrap as well as at Stop. That is the take
                        being finalized, not a glitch. Worth knowing before you judge a
                        take: ε does not bound what you see. The pass only ever tests the
                        point next to the far end of its growing chord, where a smooth
                        arc is closest to that chord anyway — so a slow, gradual move can
                        flatten almost to a straight line (measured here: a two-bar arc
                        thinned from 116 events to 4, twenty times ε off its performed
                        shape) while a fast, jagged one survives nearly intact.
                      </Text>
                    </Flex>
                  </Grid>
                </Flex>
              </Card>

              <Grid columns={{ initial: "1", md: "2" }} gap="5">
                <Card>
                  <Flex direction="column" gap="3">
                    <Text size="2" weight="bold" color="gray">Automation Mode</Text>
                    <SegmentedControl.Root value={mode} onValueChange={v => onModeChange(v as AutomationMode)}>
                      <SegmentedControl.Item value="read">read</SegmentedControl.Item>
                      <SegmentedControl.Item value="touch">touch</SegmentedControl.Item>
                      <SegmentedControl.Item value="latch">latch</SegmentedControl.Item>
                    </SegmentedControl.Root>
                    <Text size="2" color="gray">
                      This writes for real through{" "}
                      <code>parameterFieldAdapters.setMode(address, mode)</code> — plain
                      registry state, deliberately outside <code>editing.modify()</code>{" "}
                      because it is not box graph data.
                    </Text>
                    <Callout.Root color="amber" size="1">
                      <Callout.Text>
                        The engine never reads the stored mode yet — recording always
                        behaves latch-like: the first write opens an automation take, only
                        transport stop or a loop wrap closes it. That has teeth with Loop
                        on. Latch never lifts off, so each wrap opens a fresh region
                        holding your last value and that region keeps growing with the
                        playhead <em>even if you never touch anything again</em> — growing
                        straight over the previous pass, which is front-trimmed out of the
                        way. Take your hands off after a pass and the next lap quietly
                        replaces your curve with a flat hold. Keep performing, or stop
                        before the wrap. Real <em>touch</em> mode is exactly the missing
                        behaviour: it would lift off at the end of the gesture and leave
                        the earlier pass standing.
                      </Callout.Text>
                    </Callout.Root>
                  </Flex>
                </Card>

                <Card>
                  <Flex direction="column" gap="3">
                    <Text size="2" weight="bold" color="gray">Manual Override</Text>
                    <Text size="2" color="gray">
                      Move a fader while the transport is playing and the engine suspends
                      that lane's automation so your hand wins:{" "}
                      <code>AutomationSuspension</code>, started per project, runtime-only,
                      no box graph write. The engine's only conditions are{" "}
                      <code>engine.isPlaying</code> and the lane already having a track — a
                      write <em>during</em> a take suspends it too. The OVERRIDE badge here
                      is deliberately narrower: this page lights it only when playing and{" "}
                      <em>not</em> recording, because during a take the write is the take.
                      That is our inference, not an engine rule — there is no observable
                      for the suspension itself. The recorded curve stays exactly where it
                      was and dims on the lane while the badge is up. Pause, stop, or{" "}
                      <code>stopRecording()</code> drops every suspension and the faders go
                      back to riding the curves.
                    </Text>
                  </Flex>
                </Card>
              </Grid>

              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">Preset Comparison</Text>
                  <Text size="2" color="gray">
                    Overlay a dashed reference shape on any lane — these are the same
                    curves <code>track-automation-demo</code> writes into the box graph
                    programmatically. Here they are drawing only: no regions, no events,
                    nothing recorded. Handy for judging how close a performed move lands
                    to an authored one.
                  </Text>
                  <Grid columns={{ initial: "1", sm: "3" }} gap="3">
                    {setup.lanes.map(lane => (
                      <Flex key={lane.id} direction="column" gap="1">
                        <Text size="1" color="gray">{lane.label}</Text>
                        <Select.Root
                          value={ghostNames[lane.id]}
                          onValueChange={value => setGhostNames(prev => withLane(prev, lane.id, value))}
                        >
                          <Select.Trigger aria-label={`Ghost curve for ${lane.label}`} />
                          <Select.Content>
                            <Select.Item value="none">None</Select.Item>
                            {GHOST_PRESETS.map(preset => (
                              <Select.Item key={preset.name} value={preset.name}>{preset.name}</Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Root>
                      </Flex>
                    ))}
                  </Grid>
                </Flex>
              </Card>
            </>
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
} else {
  console.error("[live-automation-recording-demo] #root is missing — nothing rendered");
}
