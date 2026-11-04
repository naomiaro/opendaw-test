/**
 * MIDI Effects demo: a two-bar pattern loops on a Vaporisateur while the visitor puts one stock
 * MIDI effect at a time on the unit's MIDI chain, then stacks and reorders them. Two lanes show
 * the notes as written and as the chain emits them (the engine's held-note set, marked as the
 * instrument pulls the chain's output and read on the main thread once per frame).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimationFrame } from "@opendaw/lib-dom";
import type { Terminable } from "@opendaw/lib-std";
import { EffectFactories, type Project } from "@opendaw/studio-core";
import { InstrumentFactories, NoteStreamReceiver } from "@opendaw/studio-adapters";
import type { AudioUnitBox, NoteEventBox, NoteRegionBox, VaporisateurDeviceBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { midiEffectsFieldOf } from "@/lib/adapterUtils";
import { useTimelineLoop } from "@/hooks/useTimelineLoop";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { NoteLane, type LaneNote, type NoteLaneHandle } from "@/components/NoteLane";
import { CONSOLE_STYLES, CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import { PATTERNS, PATTERN_BPM, PATTERN_PPQN, BAR_PPQN, REGION_START_PPQN, patternById, writePattern, type Pattern, type PatternId } from "@/lib/midiEffects/patterns";
import { reconcileChain, setDeviceEnabled, type Factories } from "@/lib/midiEffects/chain";
import { INITIAL_STATE, desiredChain, pageReducer } from "@/lib/midiEffects/pageState";
import { EmittedBars } from "@/lib/midiEffects/emittedNotes";
import { useMidiChain } from "./useMidiChain";
import { MidiEffectCard } from "./MidiEffectCard";
import { MidiChainSections } from "./MidiChainSections";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Button, Flex, Select, Callout, Code } from "@radix-ui/themes";
import { PlayIcon, StopIcon } from "@radix-ui/react-icons";

const FACTORIES: Factories = EffectFactories.MidiNamed;

/** C2 to C7: the patterns (36..71) with room for a three-octave Arpeggio on Chords or a two-octave Pitch
 *  shift; beyond that the lane marks notes out of range. */
const PITCH_LOW = 36;
const PITCH_HIGH = 96;
const LANE_HEIGHT = 112;
const DEFAULT_PATTERN: PatternId = "chords";

interface Built {
  project: Project;
  audioUnitBox: AudioUnitBox;
  regionBox: NoteRegionBox;
}

function laneNotes(pattern: Pattern): LaneNote[] {
  return pattern.notes.map((n) => ({ pitch: n.pitch, from: n.position, to: n.position + n.duration, velocity: n.velocity }));
}

function MidiEffectsDemo() {
  const [built, setBuilt] = useState<Built | null>(null);
  const [status, setStatus] = useState("Starting engine…");
  const [initError, setInitError] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [patternId, setPatternId] = useState<PatternId>(DEFAULT_PATTERN);
  const [state, dispatch] = useReducer(pageReducer, INITIAL_STATE);

  const project = built?.project ?? null;
  const audioUnitBox = built?.audioUnitBox ?? null;
  const entries = useMidiChain(project, audioUnitBox);
  useTimelineLoop(project, { from: REGION_START_PPQN, to: REGION_START_PPQN + PATTERN_PPQN, enabled: true });

  const heldRef = useRef<NoteEventBox[]>([]);
  const patternRef = useRef<Pattern>(patternById(DEFAULT_PATTERN));
  const writtenLane = useRef<NoteLaneHandle>(null);
  const emittedLane = useRef<NoteLaneHandle>(null);
  const barsRef = useRef(new EmittedBars());

  // Boot: engine, synth, region with the default pattern.
  useEffect(() => {
    let mounted = true;
    const subs: Terminable[] = [];
    (async () => {
      try {
        const { project } = await initializeOpenDAW({ onStatusUpdate: setStatus });
        if (!mounted) return;
        const { audioUnitBox, instrumentBox, trackBox } = project.editing
          .modify(() => {
            project.timelineBox.bpm.setValue(PATTERN_BPM);
            return project.api.createInstrument(InstrumentFactories.Vaporisateur);
          })
          .unwrap("createInstrument");
        // Settings and the region in a second transaction: pointers made in the first resolve at its commit.
        const regionBox = project.editing
          .modify(() => {
            const synth = instrumentBox as VaporisateurDeviceBox;
            synth.attack.setValue(0.005);
            synth.release.setValue(0.2);
            return project.api.createNoteRegion({ trackBox, position: REGION_START_PPQN, duration: PATTERN_PPQN, name: "pattern" });
          })
          .unwrap("createNoteRegion");
        heldRef.current = writePattern(project, regionBox, [], patternRef.current);
        subs.push(project.engine.isPlaying.catchupAndSubscribe((obs) => {
          if (!mounted) return;
          const playing = obs.getValue();
          setIsPlaying(playing);
          if (!playing) {
            barsRef.current.reset();
            emittedLane.current?.requestUpdate();
          }
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

  // The emitted lane: sample the unit's held-note set every frame while playing.
  useEffect(() => {
    if (!project || !audioUnitBox) return undefined;
    const receiver = new NoteStreamReceiver(project.liveStreamReceiver, audioUnitBox.address);
    const bars = barsRef.current;
    const frame = AnimationFrame.add(() => {
      if (!project.engine.isPlaying.getValue()) return;
      bars.sample((pitch) => receiver.isNoteOn(pitch), project.engine.position.getValue() - REGION_START_PPQN);
      emittedLane.current?.requestUpdate();
    });
    return () => {
      frame.terminate();
      receiver.terminate();
    };
  }, [project, audioUnitBox]);

  const changePattern = useCallback((id: PatternId) => {
    if (!built) return;
    const pattern = patternById(id);
    heldRef.current = writePattern(built.project, built.regionBox, heldRef.current, pattern);
    patternRef.current = pattern;
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
  const writtenNotes = useCallback(() => laneNotes(patternRef.current), []);
  const emittedNotes = useCallback(() => barsRef.current.bars, []);

  const currentPattern = patternById(patternId);

  const renderCard = (entry: (typeof entries)[number], compact: boolean) => (
    <MidiEffectCard
      project={project!}
      entry={entry}
      compact={compact}
      page="effects"
      onEnabledChange={(enabled) => {
        try {
          setDeviceEnabled(project!.editing, entry.box, enabled);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[midi-effects] ${enabled ? "enabling" : "bypassing"} ${entry.id} failed: ${message}`);
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
          <div className="mc-kicker">MIDI 01 — Effects · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>MIDI Effects</h1>
          <p className="mc-intro">
            A two-bar pattern loops on a Vaporisateur. Put one of the four stock MIDI effects on the unit's MIDI
            chain and hear what it does to the notes before they reach the synth, then stack several and drag them
            into an order. The lower lane reads the notes the chain emits from the engine, not from a model of the
            device. For the fifth device, the scriptable one, see the{" "}
            <a href="/spielwerk-demo.html" style={{ color: "var(--mc-amber)" }}>Spielwerk demo</a>.
            For the exact view, velocity included, see the{" "}
            <a href="/midi-effects-rendered-demo.html" style={{ color: "var(--mc-amber)" }}>Rendered page</a>; all
            three pages are on the{" "}
            <a href="/midi-effects-demos.html" style={{ color: "var(--mc-amber)" }}>MIDI Effects overview</a>.
          </p>
        </header>

        {(initError ?? chainError) && (
          <Callout.Root color="red" style={{ marginBottom: 16 }}>
            <Callout.Text>{initError ?? chainError}</Callout.Text>
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
        <Text size="1" color="gray" style={{ display: "block", marginBottom: 12 }}>{currentPattern.blurb}</Text>

        <Flex direction="column" gap="3" style={{ marginBottom: 28 }}>
          <NoteLane
            ref={writtenLane}
            title="As written"
            caption="the region's notes, shaded by velocity"
            notes={writtenNotes}
            rangePpqn={PATTERN_PPQN}
            pitchLow={PITCH_LOW}
            pitchHigh={PITCH_HIGH}
            height={LANE_HEIGHT}
            shadeByVelocity
            position={position}
            barPpqn={BAR_PPQN}
          />
          <NoteLane
            ref={emittedLane}
            title="As the chain emits it"
            caption="frame-sampled from the engine's held-note set: shows Arpeggio steps and Pitch moves; carries no velocity, so every bar is one colour (the Rendered page shows it); Zeitgeist's shift only roughly"
            notes={emittedNotes}
            rangePpqn={PATTERN_PPQN}
            pitchLow={PITCH_LOW}
            pitchHigh={PITCH_HIGH}
            height={LANE_HEIGHT}
            shadeByVelocity={false}
            position={position}
            barPpqn={BAR_PPQN}
          />
        </Flex>

        <MidiChainSections state={state} dispatch={dispatch} entries={entries} project={project} renderCard={renderCard} />

        <section className="mc-anchors">
          <h2 className="mc-anchors-head">SDK reference</h2>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>Insert a MIDI effect:</Text>
          <Code size="2" style={CODE_BLOCK_STYLE}>
{`const field = midiEffectsFieldOf(project, audioUnitBox); // adapter layer, outside the transaction
const box = project.editing
  .modify(() => project.api.insertEffect(field, EffectFactories.Arpeggio))
  .unwrap("insertEffect");`}
          </Code>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>Reorder the chain:</Text>
          <Code size="2" style={CODE_BLOCK_STYLE}>
{`// drop index is a gap in the ORIGINAL order; arrayMove(from, to) is
const dropIndex = from < to ? to + 1 : to;
project.editing.modify(() => IndexedBox.moveIndices(field, [from], dropIndex));`}
          </Code>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>Read what the chain emits:</Text>
          <Code size="2" style={CODE_BLOCK_STYLE}>
{`// 128 held-note bits per unit, marked in the engine as the instrument pulls the chain's
// output; read on the main thread once per frame
const notes = new NoteStreamReceiver(project.liveStreamReceiver, audioUnitBox.address);
AnimationFrame.add(() => { if (notes.isNoteOn(60)) { /* C4 is sounding */ } });`}
          </Code>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>A chain change drops sounding voices:</Text>
          <Code size="2" style={CODE_BLOCK_STYLE}>
{`// insert, remove, reorder or an enabled toggle: the instrument's voices stop.
// This page restarts the pattern (at its region, one bar in) so the lanes and the sound stay in step.
if (project.engine.isPlaying.getValue()) project.engine.setPosition(regionStartPpqn);`}
          </Code>
        </section>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<MidiEffectsDemo />);
}
