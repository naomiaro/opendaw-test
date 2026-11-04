/**
 * MIDI Effects: Rendered. The same chain of stock MIDI effects as the MIDI Effects page, on a Nano sampler playing a
 * pure sine. After every change the project is rendered offline on a copy and the render is read back note by note
 * (onset, end, pitch with cents, velocity) with the semantics audit's reader; the lanes draw what was read, not a model
 * of the devices. The live output keeps the master Maximizer; the render runs without it so its levels are true.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { EffectFactories, type Project } from "@opendaw/studio-core";
import type { AudioUnitBox, NoteEventBox, NoteRegionBox } from "@opendaw/studio-boxes";
import { midiEffectsFieldOf } from "@/lib/adapterUtils";
import { useTimelineLoop } from "@/hooks/useTimelineLoop";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { NoteLane, type LaneNote, type NoteLaneHandle } from "@/components/NoteLane";
import { VelocityStrip, type Stem, type VelocityStripHandle } from "@/components/VelocityStrip";
import { CONSOLE_STYLES, CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import { buildNanoProject } from "@/lib/audit/midiEffectBootstrap";
import { sineSample, type Calibration } from "@/lib/audit/midiEffectSemanticsReader";
import {
  NANO_ATTACK_SECONDS, NANO_RELEASE_SECONDS, REGION_DURATION_PPQN, REGION_POSITION_PPQN, ROOT_KEY,
} from "@/lib/audit/midiEffectSemanticsRows";
import {
  PATTERNS, PATTERN_BPM, PATTERN_PPQN, BAR_PPQN, REGION_START_PPQN, patternById, withGaps, writePattern, type Pattern, type PatternId,
} from "@/lib/midiEffects/patterns";
import { reconcileChain, setDeviceEnabled, type Factories } from "@/lib/midiEffects/chain";
import { INITIAL_STATE, desiredChain, pageReducer } from "@/lib/midiEffects/pageState";
import type { RenderedRows } from "@/lib/midiEffects/renderedNotes";
import { useMidiChain } from "./useMidiChain";
import { MidiEffectCard } from "./MidiEffectCard";
import { MidiChainSections } from "./MidiChainSections";
import { calibrateRendered, lastRenderOf, useRenderedNotes, type RenderedState } from "./useRenderedNotes";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Button, Flex, Select, Callout, Code } from "@radix-ui/themes";
import { PlayIcon, StopIcon } from "@radix-ui/react-icons";

const FACTORIES: Factories = EffectFactories.MidiNamed;

const RATE = 48000;
/** Long enough that no note of the two-bar pattern outlives the sample (the Nano does not loop it). */
const SAMPLE_SECONDS = 20;
/** Every note shortened to 90 % of its written length, so the reader finds the gap between notes. */
const GAP_RATIO = 0.9;
const DEFAULT_PATTERN: PatternId = "melody";

/** C2 to C7, as the MIDI Effects page. */
const PITCH_LOW = 36;
const PITCH_HIGH = 96;
/** About 3.7 px per pitch row, so a bar's dashed edges show. */
const LANE_HEIGHT = 224;
const STRIP_HEIGHT = 64;

const DASHED_SENTENCE = "dashed edges: the step boundaries come from the device rule; a gate under 100 % makes them measured";

interface Built {
  project: Project;
  audioUnitBox: AudioUnitBox;
  regionBox: NoteRegionBox;
}

function laneNotes(pattern: Pattern): LaneNote[] {
  return pattern.notes.map((n) => ({ pitch: n.pitch, from: n.position, to: n.position + n.duration, velocity: n.velocity }));
}

function renderedCaption(rendered: RenderedState): string {
  const last = lastRenderOf(rendered);
  const parts: string[] = [];
  switch (rendered.status) {
    case "calibrating":
      parts.push("calibrating the reader…");
      break;
    case "stale":
    case "rendering":
      parts.push("rendering…");
      break;
    case "error":
      parts.push(rendered.error);
      break;
    case "idle":
      parts.push("read back from an offline render of the chain: onset, end, pitch, cents, velocity");
      break;
  }
  if (last !== null) {
    if (rendered.status === "idle") parts.push(`${Math.round(last.renderMs)} ms`);
    if (last.rows.sentence !== null) parts.push(last.rows.sentence);
    if (last.rows.notes.some((note) => note.dashedEdges === true)) parts.push(DASHED_SENTENCE);
  }
  return parts.join(" · ");
}

function MidiEffectsRenderedDemo() {
  const [built, setBuilt] = useState<Built | null>(null);
  const [status, setStatus] = useState("Starting engine…");
  const [initError, setInitError] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [patternId, setPatternId] = useState<PatternId>(DEFAULT_PATTERN);
  const [state, dispatch] = useReducer(pageReducer, INITIAL_STATE);

  const project = built?.project ?? null;
  const audioUnitBox = built?.audioUnitBox ?? null;
  const entries = useMidiChain(project, audioUnitBox);
  useTimelineLoop(project, { from: REGION_START_PPQN, to: REGION_START_PPQN + PATTERN_PPQN, enabled: true });

  // The region holds the gapped pattern; the hook renders and reads against the same one.
  const gappedPattern = useMemo(() => withGaps(patternById(patternId), GAP_RATIO), [patternId]);
  const rendered = useRenderedNotes({
    project, audioUnitBox, entries, pattern: gappedPattern, bpm: PATTERN_BPM, rate: RATE, calibration, calibrationError,
  });

  const localAudioBuffers = useRef(new Map<string, AudioBuffer>());
  const heldRef = useRef<NoteEventBox[]>([]);
  const gappedRef = useRef<Pattern>(gappedPattern);
  gappedRef.current = gappedPattern;
  const renderedRowsNow = lastRenderOf(rendered)?.rows ?? null;
  const rowsRef = useRef<RenderedRows | null>(renderedRowsNow);
  rowsRef.current = renderedRowsNow;
  const writtenLane = useRef<NoteLaneHandle>(null);
  const renderedLane = useRef<NoteLaneHandle>(null);
  const strip = useRef<VelocityStripHandle>(null);

  // Boot: engine, Nano on a sine, region; calibrate the reader on the gapped Sixteenths before the hook renders
  // anything, so no two offline renders overlap; then the default pattern.
  useEffect(() => {
    let mounted = true;
    const subs: Terminable[] = [];
    (async () => {
      try {
        const { project, audioUnitBox, regionBox } = await buildNanoProject({
          localAudioBuffers: localAudioBuffers.current, bpm: PATTERN_BPM, rate: RATE,
          sample: sineSample(RATE, SAMPLE_SECONDS, 440), fileName: "sine-440-20s.wav", rootKey: ROOT_KEY,
          attackSeconds: NANO_ATTACK_SECONDS, releaseSeconds: NANO_RELEASE_SECONDS,
          regionPositionPpqn: REGION_POSITION_PPQN, regionDurationPpqn: REGION_DURATION_PPQN,
          // the live output keeps its limiter; the render removes it on its copy
          removeMaximizer: false, onStatus: setStatus,
        });
        if (!mounted) return;
        let held = writePattern(project, regionBox, [], withGaps(patternById("sixteenths"), GAP_RATIO));
        setStatus("Calibrating the reader…");
        try {
          const result = await calibrateRendered(project, PATTERN_BPM, RATE);
          if (!mounted) return;
          setCalibration(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[midi-rendered] calibration failed: " + message);
          if (!mounted) return;
          setCalibrationError(`The reader could not calibrate: ${message}`);
        }
        held = writePattern(project, regionBox, held, gappedRef.current);
        heldRef.current = held;
        subs.push(project.engine.isPlaying.catchupAndSubscribe((obs) => {
          if (mounted) setIsPlaying(obs.getValue());
        }));
        setBuilt({ project, audioUnitBox, regionBox });
        setStatus("Ready");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to initialize: " + message);
        if (mounted) setInitError(message);
      }
    })();
    return () => {
      mounted = false;
      subs.forEach((s) => s.terminate());
    };
  }, []);

  // The lane and the strip read the rows inside their paint; repaint them on every new set.
  useEffect(() => {
    renderedLane.current?.requestUpdate();
    strip.current?.requestUpdate();
  }, [renderedRowsNow]);

  const reseekIfPlaying = useCallback(() => {
    if (project && project.engine.isPlaying.getValue()) project.engine.setPosition(REGION_START_PPQN);
  }, [project]);

  // The chain follows the page state; a real change restarts the pattern (the engine drops sounding voices on a chain
  // change). The reducer returns the same state object when it ignores an action, so `desired` is a stable dependency.
  const desired = useMemo(() => desiredChain(state), [state]);
  useEffect(() => {
    if (!project || !audioUnitBox) return;
    try {
      const field = midiEffectsFieldOf(project, audioUnitBox);
      const { changed } = reconcileChain(project, field, desired, FACTORIES);
      if (changed) reseekIfPlaying();
      setChainError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Chain reconcile failed for [${desired.join(", ")}]: ${message}`);
      setChainError(`The chain could not be rebuilt for ${desired.join(" → ") || "dry"}: ${message}`);
    }
  }, [project, audioUnitBox, desired, reseekIfPlaying]);

  const changePattern = useCallback((id: PatternId) => {
    if (!built) return;
    const pattern = withGaps(patternById(id), GAP_RATIO);
    try {
      heldRef.current = writePattern(built.project, built.regionBox, heldRef.current, pattern);
    } catch (error) {
      // the old notes' deletion commits before the new ones are written: keep only the boxes still in the graph
      heldRef.current = heldRef.current.filter((box) => box.isAttached());
      const message = error instanceof Error ? error.message : String(error);
      console.error("[midi-rendered] pattern write failed: " + message);
      setPatternError(`The ${patternById(id).label} pattern could not be written to the region: ${message}. Reload the page.`);
      return;
    }
    setPatternError(null);
    gappedRef.current = pattern;
    setPatternId(id);
    writtenLane.current?.requestUpdate();
    reseekIfPlaying();
  }, [built, reseekIfPlaying]);

  const handlePlay = useCallback(() => {
    if (!project) return;
    // The region starts one bar in: a transport at 0 would run a silent bar first.
    if (project.engine.position.getValue() < REGION_START_PPQN) project.engine.setPosition(REGION_START_PPQN);
    project.engine.play();
  }, [project]);
  const handleStop = useCallback(() => project?.engine.stop(true), [project]);

  const position = useMemo(() => (project ? () => Math.max(0, project.engine.position.getValue() - REGION_START_PPQN) : undefined), [project]);
  const writtenNotes = useCallback(() => laneNotes(gappedRef.current), []);
  const renderedNotes = useCallback((): readonly LaneNote[] => rowsRef.current?.notes ?? [], []);
  const ghosts = useCallback((): readonly Stem[] => rowsRef.current?.ghosts ?? [], []);
  const stems = useCallback((): readonly Stem[] => rowsRef.current?.stems ?? [], []);
  const unreadable = useCallback(() => rowsRef.current?.unreadable ?? [], []);

  const currentPattern = patternById(patternId);
  // the rows on show are not the chain's while a render is due or running, before calibration, and after a failure
  const dimmed = rendered.status !== "idle";
  const calibrationNotice = calibrationError === null ? null : `${calibrationError}. The rendered rows are unavailable; reload the page.`;
  const pageErrors = [initError, chainError, patternError, calibrationNotice].filter((message): message is string => message !== null);

  const renderCard = (entry: (typeof entries)[number], compact: boolean) => (
    <MidiEffectCard
      project={project!}
      entry={entry}
      compact={compact}
      page="rendered"
      onEnabledChange={(enabled) => {
        try {
          setDeviceEnabled(project!.editing, entry.box, enabled);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[midi-rendered] ${enabled ? "enabling" : "bypassing"} ${entry.id} failed: ${message}`);
          setChainError(`The ${entry.id} device could not be ${enabled ? "enabled" : "bypassed"}: ${message}`);
          return;
        }
        reseekIfPlaying();
      }}
      onChainChange={reseekIfPlaying}
    />
  );

  return (
    <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <GitHubCorner />
      <Container size="3" style={{ padding: "48px 16px 64px" }}>
        <BackLink />
        <header style={{ marginBottom: 28 }}>
          <div className="mc-kicker">MIDI 02 — Rendered · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>Rendered</h1>
          <p className="mc-intro">
            The same chain of stock MIDI effects, on a Nano sampler playing a pure sine. After every change the
            project is rendered offline and the render is read back note by note: onset, end, pitch with cents and
            velocity. What you hear is what the reader reads, with one difference: the live output carries the
            master limiter and the render does not, so the velocities read are true levels. For the same chain on a
            synth, read live from the engine, see the{" "}
            <a href="/midi-effects-demo.html" style={{ color: "var(--mc-amber)" }}>MIDI Effects demo</a>; all
            three pages are on the{" "}
            <a href="/midi-effects-demos.html" style={{ color: "var(--mc-amber)" }}>MIDI Effects overview</a>.
          </p>
        </header>

        {pageErrors.length > 0 && (
          <Callout.Root color="red" style={{ marginBottom: 16 }}>
            {pageErrors.map((message) => <Callout.Text key={message}>{message}</Callout.Text>)}
          </Callout.Root>
        )}

        <Flex gap="3" align="center" wrap="wrap" style={{ marginBottom: 16 }}>
          <Button size="3" onClick={handlePlay} disabled={!built || isPlaying}><PlayIcon /> Play</Button>
          <Button size="3" variant="soft" onClick={handleStop} disabled={!built || !isPlaying}><StopIcon /> Stop</Button>
          <Text size="2" color="gray">{PATTERN_BPM} bpm · 2 bars · loop</Text>
          <Flex gap="2" align="center" style={{ marginLeft: "auto" }}>
            <Text size="2" color="gray">Pattern</Text>
            <Select.Root value={patternId} onValueChange={(v) => changePattern(v as PatternId)} disabled={!built}>
              <Select.Trigger />
              <Select.Content>
                {PATTERNS.map((p) => <Select.Item key={p.id} value={p.id}>{p.label}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </Flex>
          {!built && !initError && <Text size="1" color="gray">{status}</Text>}
        </Flex>
        <Text size="1" color="gray" style={{ display: "block", marginBottom: 12 }}>
          {currentPattern.blurb} Notes are shortened to 90 % of their written length so the reader finds the gap between them.
        </Text>

        <Flex direction="column" gap="3" style={{ marginBottom: 28 }}>
          <NoteLane
            ref={writtenLane}
            title="As written"
            caption="the region's notes, colour by velocity"
            notes={writtenNotes}
            rangePpqn={PATTERN_PPQN}
            pitchLow={PITCH_LOW}
            pitchHigh={PITCH_HIGH}
            height={LANE_HEIGHT}
            shadeByVelocity
            position={position}
            barPpqn={BAR_PPQN}
          />
          <div style={{ opacity: dimmed ? 0.5 : 1 }}>
            <NoteLane
              ref={renderedLane}
              title="As rendered"
              caption={renderedCaption(rendered)}
              notes={renderedNotes}
              rangePpqn={PATTERN_PPQN}
              pitchLow={PITCH_LOW}
              pitchHigh={PITCH_HIGH}
              height={LANE_HEIGHT}
              shadeByVelocity
              position={position}
              barPpqn={BAR_PPQN}
              shadedSpans={unreadable}
            />
          </div>
          <div style={{ opacity: dimmed ? 0.5 : 1 }}>
            <VelocityStrip
              ref={strip}
              title="Velocity"
              caption="ghost: written · solid: emitted"
              ghosts={ghosts}
              stems={stems}
              rangePpqn={PATTERN_PPQN}
              height={STRIP_HEIGHT}
              barPpqn={BAR_PPQN}
            />
          </div>
        </Flex>

        <MidiChainSections state={state} dispatch={dispatch} entries={entries} project={project} renderCard={renderCard} />

        <section className="mc-anchors">
          <h2 className="mc-anchors-head">SDK reference</h2>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>Render the chain offline, on a copy:</Text>
          <Code size="2" style={CODE_BLOCK_STYLE}>
{`// the live project is untouched; mutateCopy runs on the copy before the renderer is made
// (here: remove the master Maximizer, so the levels read back are the engine's own)
const { channels } = await renderOfflineSlice(project, 0, renderSeconds(bpm), rate, { mutateCopy });`}
          </Code>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>Read the render back as notes:</Text>
          <Code size="2" style={CODE_BLOCK_STYLE}>
{`// one voice at a time: onset and end from the envelope, pitch from the period, velocity from the peak
const figures = readNotes(channels[0], rate).map((note) =>
  toFigure(note, rate, calibration.referencePeak, calibration.instrumentOffsetFrames));`}
          </Code>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>When it renders:</Text>
          <Text as="p" size="2" color="gray" style={{ marginTop: 8 }}>
            Every device parameter, the Velocity seed, the chain and the pattern ask for a render. Requests settle
            for 300 ms before a render starts, so a slider drag costs one render, not one per step; a change that
            arrives while a render runs queues exactly one more, which starts when the running one ends.
          </Text>
        </section>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<MidiEffectsRenderedDemo />);
}
