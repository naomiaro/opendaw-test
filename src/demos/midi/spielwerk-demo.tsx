/**
 * Spielwerk demo: the scriptable MIDI effect. A two-bar pattern loops on a Vaporisateur through one
 * Spielwerk on the unit's MIDI chain; the visitor browses pre-built scripts, edits them, compiles on
 * demand, turns the declared parameters, and loads the API reference's examples into the editor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimationFrame } from "@opendaw/lib-dom";
import { UUID, type Terminable } from "@opendaw/lib-std";
import { EffectFactories, type Project } from "@opendaw/studio-core";
import { InstrumentFactories, NoteStreamReceiver, ScriptDeclaration } from "@opendaw/studio-adapters";
import type { AudioUnitBox, NoteEventBox, NoteRegionBox, SpielwerkDeviceBox, VaporisateurDeviceBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { midiEffectsFieldOf } from "@/lib/adapterUtils";
import { useTimelineLoop } from "@/hooks/useTimelineLoop";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { NoteLane, type LaneNote, type NoteLaneHandle } from "@/components/NoteLane";
import { CONSOLE_STYLES, CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import { PATTERNS, PATTERN_BPM, PATTERN_PPQN, BAR_PPQN, patternById, writePattern, type Pattern, type PatternId } from "@/lib/midiEffects/patterns";
import { setDeviceEnabled } from "@/lib/midiEffects/chain";
import { EmittedBars } from "@/lib/midiEffects/emittedNotes";
import { SPIELWERK_REFERENCE, SPIELWERK_SCRIPTS, scriptById, type ScriptId } from "@/lib/midiEffects/spielwerkScripts";
import { useSpielwerkCompile } from "./useSpielwerkCompile";
import { SpielwerkEditor } from "./SpielwerkEditor";
import { SpielwerkReference } from "./SpielwerkReference";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Button, Flex, Select, Switch, Slider, Callout, Code } from "@radix-ui/themes";
import { PlayIcon, StopIcon } from "@radix-ui/react-icons";

const PITCH_LOW = 36;
const PITCH_HIGH = 96;
const LANE_HEIGHT = 72;
const DEFAULT_PATTERN: PatternId = "melody";
const DEFAULT_SCRIPT: ScriptId = "echo";

interface Built {
  project: Project;
  audioContext: AudioContext;
  audioUnitBox: AudioUnitBox;
  regionBox: NoteRegionBox;
  spielwerk: SpielwerkDeviceBox;
}

function laneNotes(pattern: Pattern): LaneNote[] {
  return pattern.notes.map((n) => ({ pitch: n.pitch, from: n.position, to: n.position + n.duration, velocity: n.velocity }));
}

function SpielwerkDemo() {
  const [built, setBuilt] = useState<Built | null>(null);
  const [status, setStatus] = useState("Starting engine…");
  const [initError, setInitError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [patternId, setPatternId] = useState<PatternId>(DEFAULT_PATTERN);
  const [activeScript, setActiveScript] = useState<ScriptId | null>(DEFAULT_SCRIPT);
  const [source, setSource] = useState(scriptById(DEFAULT_SCRIPT).source);
  const [restorable, setRestorable] = useState<string | null>(null);
  /** A load that failed to compile, or the worklet's runtime message; cleared by the next successful compile. */
  const [pageError, setPageError] = useState<string | null>(null);
  /** The source the device runs; its declarations give the sliders their ranges. */
  const [compiledSource, setCompiledSource] = useState<string | null>(null);

  const project = built?.project ?? null;
  const audioUnitBox = built?.audioUnitBox ?? null;
  useTimelineLoop(project, { from: 0, to: PATTERN_PPQN, enabled: true });

  const heldRef = useRef<NoteEventBox[]>([]);
  const patternRef = useRef<Pattern>(patternById(DEFAULT_PATTERN));
  const writtenLane = useRef<NoteLaneHandle>(null);
  const emittedLane = useRef<NoteLaneHandle>(null);
  const barsRef = useRef(new EmittedBars());

  const reseekIfPlaying = useCallback(() => {
    if (project && project.engine.isPlaying.getValue()) project.engine.setPosition(0);
  }, [project]);

  const { compile, busy, params, writeParam } = useSpielwerkCompile(project, built?.audioContext ?? null, built?.spielwerk ?? null, reseekIfPlaying);

  // Boot: engine, synth, region with the default pattern, one Spielwerk running the default script.
  useEffect(() => {
    let mounted = true;
    const subs: Terminable[] = [];
    (async () => {
      try {
        const { project, audioContext } = await initializeOpenDAW({ onStatusUpdate: setStatus });
        if (!mounted) return;
        const { audioUnitBox, instrumentBox, trackBox } = project.editing
          .modify(() => {
            project.timelineBox.bpm.setValue(PATTERN_BPM);
            return project.api.createInstrument(InstrumentFactories.Vaporisateur);
          })
          .unwrap("createInstrument");
        const field = midiEffectsFieldOf(project, audioUnitBox);
        const { regionBox, spielwerk } = project.editing
          .modify(() => {
            const synth = instrumentBox as VaporisateurDeviceBox;
            synth.attack.setValue(0.005);
            synth.release.setValue(0.2);
            const regionBox = project.api.createNoteRegion({ trackBox, position: 0, duration: PATTERN_PPQN, name: "pattern" });
            const spielwerk = project.api.insertEffect(field, EffectFactories.Spielwerk) as SpielwerkDeviceBox;
            return { regionBox, spielwerk };
          })
          .unwrap("createNoteRegion");
        heldRef.current = writePattern(project, regionBox, [], patternRef.current);
        subs.push(project.engine.subscribeDeviceMessage(UUID.toString(spielwerk.address.uuid), (message) => {
          if (!mounted) return;
          setPageError(`The script failed while running and the device is silenced until it is fixed and compiled again: ${message}`);
        }));
        subs.push(project.engine.isPlaying.catchupAndSubscribe((obs) => {
          if (!mounted) return;
          const playing = obs.getValue();
          setIsPlaying(playing);
          if (!playing) {
            barsRef.current.reset();
            emittedLane.current?.requestUpdate();
          }
        }));
        setBuilt({ project, audioContext, audioUnitBox, regionBox, spielwerk });
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

  // The default script, compiled once the device exists.
  const compiledOnceRef = useRef(false);
  useEffect(() => {
    if (!built || compiledOnceRef.current) return;
    compiledOnceRef.current = true;
    const initial = scriptById(DEFAULT_SCRIPT).source;
    compile(initial)
      .then(() => setCompiledSource(initial))
      .catch((error: unknown) => setInitError(`The default script failed to compile: ${error instanceof Error ? error.message : String(error)}`));
  }, [built, compile]);

  // The emitted lane: sample the unit's held-note set every frame while playing.
  useEffect(() => {
    if (!project || !audioUnitBox) return undefined;
    const receiver = new NoteStreamReceiver(project.liveStreamReceiver, audioUnitBox.address);
    const bars = barsRef.current;
    const frame = AnimationFrame.add(() => {
      if (!project.engine.isPlaying.getValue()) return;
      bars.sample((pitch) => receiver.isNoteOn(pitch), project.engine.position.getValue());
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
    patternRef.current = pattern;
    heldRef.current = writePattern(built.project, built.regionBox, heldRef.current, pattern);
    setPatternId(id);
    writtenLane.current?.requestUpdate();
    reseekIfPlaying();
  }, [built, reseekIfPlaying]);

  const handleCompile = useCallback(async (text: string) => {
    await compile(text);
    setCompiledSource(text);
    setPageError(null);
  }, [compile]);

  /** The visitor's own compile: a success also retires the Restore link, whose text is from before. */
  const handleUserCompile = useCallback(async (text: string) => {
    await handleCompile(text);
    setRestorable(null);
  }, [handleCompile]);

  /** Put `text` in the editor and compile it, keeping the current text for one Restore if it differs. */
  const loadSource = useCallback((text: string, scriptId: ScriptId | null) => {
    setRestorable((current) => current ?? (source !== text ? source : null));
    setSource(text);
    setActiveScript(scriptId);
    handleCompile(text).catch((error: unknown) => {
      setPageError(`The loaded script failed to compile: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [source, handleCompile]);

  const restore = useCallback(() => {
    if (restorable === null) return;
    setSource(restorable);
    setActiveScript(null);
    setRestorable(null);
  }, [restorable]);

  const toggleEnabled = useCallback((value: boolean) => {
    if (!built) return;
    setDeviceEnabled(built.project.editing, built.spielwerk, value);
    setEnabled(value);
    reseekIfPlaying();
  }, [built, reseekIfPlaying]);

  const handlePlay = useCallback(() => project?.engine.play(), [project]);
  const handleStop = useCallback(() => project?.engine.stop(true), [project]);

  const position = useMemo(() => (project ? () => project.engine.position.getValue() : undefined), [project]);
  const writtenNotes = useCallback(() => laneNotes(patternRef.current), []);
  const emittedNotes = useCallback(() => barsRef.current.bars, []);

  const declarations = useMemo(() => (compiledSource === null ? [] : ScriptDeclaration.parseParams(compiledSource)), [compiledSource]);
  const noPass = compiledSource !== null && !ScriptDeclaration.parsePassThrough(compiledSource);
  const currentPattern = patternById(patternId);

  return (
    <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <GitHubCorner />
      <Container size="3" style={{ padding: "48px 16px 64px" }}>
        <BackLink />
        <header style={{ marginBottom: 28 }}>
          <div className="mc-kicker">MIDI 03 — Spielwerk · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>Spielwerk</h1>
          <p className="mc-intro">
            A MIDI effect you write in JavaScript: a <code>Processor</code> class whose <code>process()</code> generator
            receives the block's note events and yields notes to the synth. Browse the scripts, edit one, compile it,
            turn the knobs it declares, and watch the lower lane read what the chain emits from the engine. The five
            fixed devices are on the{" "}
            <a href="/midi-effects-demo.html">MIDI Effects demo</a>, and all
            the MIDI pages are on the{" "}
            <a href="/midi-demos.html">MIDI overview</a>.
          </p>
        </header>

        {initError && (
          <Callout.Root color="red" style={{ marginBottom: 16 }}>
            <Callout.Text>{initError}</Callout.Text>
          </Callout.Root>
        )}

        <Flex gap="3" align="center" wrap="wrap" style={{ marginBottom: 12 }}>
          <Button size="3" onClick={handlePlay} disabled={!built || isPlaying}><PlayIcon /> Play</Button>
          <Button size="3" variant="soft" onClick={handleStop} disabled={!built || !isPlaying}><StopIcon /> Stop</Button>
          <Text size="2" color="gray">{PATTERN_BPM} bpm · 2 bars · loop</Text>
          <Text as="label" size="2" color="gray">
            <Flex gap="2" align="center">
              <Switch size="1" checked={enabled} onCheckedChange={toggleEnabled} disabled={!built} aria-label="Spielwerk enabled" />
              Spielwerk enabled
            </Flex>
          </Text>
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

        <Flex direction="column" gap="3" style={{ marginBottom: 24 }}>
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
            caption="frame-sampled from the engine's held-note set: timing to about a frame, no velocity"
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

        <section style={{ marginBottom: 20 }}>
          <div className="mc-kicker" style={{ marginBottom: 10 }}>Scripts</div>
          <Flex gap="2" wrap="wrap">
            {SPIELWERK_SCRIPTS.map((s) => (
              <Button
                key={s.id}
                size="2"
                variant={s.id === activeScript ? "solid" : "soft"}
                disabled={!built}
                onClick={() => loadSource(s.source, s.id)}
                title={s.blurb}
              >
                {s.label}
              </Button>
            ))}
          </Flex>
          {activeScript && (
            <Text size="1" color="gray" style={{ display: "block", marginTop: 8 }}>{scriptById(activeScript).blurb}</Text>
          )}
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(260px, 2fr)", gap: 20, marginBottom: 32 }} className="sw-split">
          <Flex direction="column" gap="3" style={{ minWidth: 0 }}>
            <SpielwerkEditor
              source={source}
              onChange={setSource}
              onCompile={handleUserCompile}
              busy={busy || !built}
              restorable={restorable}
              onRestore={restore}
            />
            {pageError !== null && (
              <Callout.Root color="red" size="1">
                <Callout.Text style={{ fontFamily: "var(--mc-mono)", whiteSpace: "pre-wrap" }}>{pageError}</Callout.Text>
              </Callout.Root>
            )}
            {noPass && (
              <Text size="1" color="gray">This script declares <code>// @no-pass</code>: the device emits only what it yields. A script that yields nothing is then silent.</Text>
            )}
            {declarations.length > 0 && (
              <div className="mc-panel" style={{ padding: "14px 18px", gap: 10 }}>
                <div className="mc-kicker" style={{ fontSize: 10 }}>Parameters</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px 18px" }}>
                  {declarations.map((decl) => {
                    const value = params.find((p) => p.label === decl.label)?.value ?? decl.defaultValue;
                    const step = decl.mapping === "int" || decl.mapping === "bool" ? 1 : (decl.max - decl.min) / 200;
                    return (
                      <Flex key={decl.label} direction="column" gap="1">
                        <Flex justify="between" gap="2">
                          <Text size="1" color="gray">{decl.label}</Text>
                          <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>
                            {decl.mapping === "int" || decl.mapping === "bool" ? value : value.toFixed(2)} {decl.unit}
                          </Text>
                        </Flex>
                        <Slider
                          aria-label={decl.label}
                          min={decl.min}
                          max={decl.max}
                          step={step}
                          value={[value]}
                          onValueChange={([v]) => writeParam(decl.label, v)}
                        />
                      </Flex>
                    );
                  })}
                </div>
              </div>
            )}
          </Flex>
          <SpielwerkReference entries={SPIELWERK_REFERENCE} onLoad={(example) => loadSource(example, null)} />
        </div>
        <style>{`@media (max-width: 760px) { .sw-split { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>

        <section className="mc-anchors">
          <h2 className="mc-anchors-head">SDK reference</h2>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>Insert a Spielwerk and compile a script:</Text>
          <Code size="2" style={CODE_BLOCK_STYLE}>
{`const field = midiEffectsFieldOf(project, audioUnitBox);
const box = project.editing
  .modify(() => project.api.insertEffect(field, EffectFactories.Spielwerk))
  .unwrap("insertEffect") as SpielwerkDeviceBox;
const compiler = ScriptCompiler.create({
  headerTag: "spielwerk", registryName: "spielwerkProcessors", functionName: "spielwerk",
});
await compiler.compile(audioContext, project.editing, box, source); // rejects on a bad script`}
          </Code>
          <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>Read and write the declared parameters:</Text>
          <Code size="2" style={CODE_BLOCK_STYLE}>
{`// each // @param line becomes a parameter box on box.parameters
for (const pointer of box.parameters.pointerHub.incoming()) {
  const param = pointer.box as WerkstattParameterBox; // label, value, index
}
ScriptDeclaration.parseParams(source); // the declarations: label, default, min, max, mapping, unit`}
          </Code>
        </section>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<SpielwerkDemo />);
}
