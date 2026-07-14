import React, { useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, MidiDevices } from "@opendaw/studio-core";
import {
  InstrumentFactories,
  NoteRegionBoxAdapter,
  ScriptCompiler,
  ScriptDeclaration,
} from "@opendaw/studio-adapters";
import { ApparatDeviceBox, AudioUnitBox, NoteRegionBox, TrackBox, WerkstattParameterBox } from "@opendaw/studio-boxes";
import { asInstanceOf } from "@opendaw/lib-std";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import { CONSOLE_STYLES, CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import { SHOWCASE_INSTRUMENTS } from "@/lib/apparatScripts";
import type { ShowcaseInstrument } from "@/lib/apparatScripts";
import { PianoKeyboard, PIANO_STYLES } from "@/demos/midi/PianoKeyboard";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Text, Flex, Card, Button,
  Callout, Separator, Slider, Code, SegmentedControl,
} from "@radix-ui/themes";
import { PlayIcon, PauseIcon, StopIcon } from "@radix-ui/react-icons";

/** Read Apparat parameter values from the box's pointerHub (WerkstattParameterBox children). */
function readApparatParams(apparatBox: ApparatDeviceBox): Record<string, number> {
  const params: Record<string, number> = {};
  for (const pointer of apparatBox.parameters.pointerHub.incoming()) {
    const paramBox = asInstanceOf(pointer.box, WerkstattParameterBox);
    params[paramBox.label.getValue()] = paramBox.value.getValue();
  }
  return params;
}

const BPM = 120;
const BAR = PPQN.fromSignature(4, 4); // 3840
const PATTERN_BARS = 4;
const PATTERN_LENGTH = BAR * PATTERN_BARS;
const EIGHTH = PPQN.Quarter / 2;

// Am – F – C – G, one bar each, voiced to stay in one register.
const CHORDS: ReadonlyArray<ReadonlyArray<number>> = [
  [57, 60, 64, 69], // A minor
  [53, 57, 60, 65], // F major
  [55, 60, 64, 67], // C major
  [55, 59, 62, 67], // G major
];

type PatternNote = { position: number; duration: number; pitch: number; velocity: number };

/** Bass roots on beats 1 & 3 plus an eighth-note arpeggio over each bar's chord. */
function buildPattern(): PatternNote[] {
  const notes: PatternNote[] = [];
  const arpOrder = [0, 1, 2, 3, 2, 1, 0, 2];
  CHORDS.forEach((chord, barIndex) => {
    const barStart = barIndex * BAR;
    notes.push({ position: barStart, duration: PPQN.Quarter, pitch: chord[0] - 12, velocity: 0.85 });
    notes.push({ position: barStart + PPQN.Quarter * 2, duration: PPQN.Quarter, pitch: chord[0] - 12, velocity: 0.8 });
    arpOrder.forEach((chordIndex, stepIndex) => {
      notes.push({
        position: barStart + stepIndex * EIGHTH,
        duration: Math.round(EIGHTH * 0.9),
        pitch: chord[chordIndex],
        velocity: stepIndex % 2 === 0 ? 0.72 : 0.6,
      });
    });
  });
  return notes;
}

// Same console-panel card grid as the Werkstatt demo (scoped per page).
const PAGE_STYLES = `
.ap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.ap-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  text-align: left;
  background: var(--mc-panel);
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  padding: 12px;
  cursor: pointer;
  font: inherit;
  color: var(--mc-text);
  transition: background 160ms ease, border-color 160ms ease;
}
.ap-card:hover:not(:disabled) { background: var(--mc-panel-hover); }
.ap-card[data-active] { border-color: var(--mc-amber); }
.ap-card:disabled { cursor: default; opacity: 0.55; }
.ap-card:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.ap-card-name { font-family: var(--mc-mono); font-size: 13px; font-weight: 600; }
.ap-card-desc { font-size: 11.5px; line-height: 1.45; color: var(--mc-muted); }
.ap-table-wrap { overflow-x: auto; }
.ap-table { width: 100%; border-collapse: collapse; }
.ap-table th {
  font-family: var(--mc-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mc-label);
  text-align: left;
  padding: 8px;
  border-bottom: 1px solid var(--mc-line-bright);
  white-space: nowrap;
}
.ap-table td {
  padding: 8px;
  border-bottom: 1px solid var(--mc-line);
  font-size: 12.5px;
  color: var(--mc-muted);
}
.ap-keyboard-wrap { overflow-x: auto; padding-bottom: 4px; }
@media (prefers-reduced-motion: reduce) {
  .ap-card { transition: none; }
}
`;

const PROCESSOR_API: ReadonlyArray<[string, string]> = [
  ["noteOn(pitch, velocity, cent, id)", "A note starts. id is unique per note — key your voice on it."],
  ["noteOff(id)", "The note with that id releases. Fade the voice out; never cut it hard."],
  ["process(output, block)", "Render [block.s0, block.s1) into output ([outL, outR]). Buffers arrive zeroed — ADD your voices in."],
  ["paramChanged(label, value)", "A // @param value changed. Values arrive already mapped to the declared range; the engine also pushes every current value once after (re)instantiation, so a hot-swapped script picks up the slider positions."],
  ["reset()", "Transport reset. Fade everything out fast and drop pending state."],
  ["samples", "Object holding AudioData for each // @sample slot (label → data or null while loading)."],
];

const App: React.FC = () => {
  // Core state
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [status, setStatus] = useState("Click Start to initialize audio...");
  const [initError, setInitError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Showcase state — which instrument script is compiled onto the Apparat box.
  const [activeInstrument, setActiveInstrument] = useState<string | null>(null);
  const [instrumentParams, setInstrumentParams] = useState<Record<string, number>>({});
  const [patternOn, setPatternOn] = useState(true);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());

  // Post-init action errors (compile failures) — cleared when the next action starts.
  const [actionError, setActionError] = useState<string | null>(null);

  // In-flight guard: compile awaits addModule — without this a double-click
  // races two compiles onto the same box. Ref guards (state isn't synchronous);
  // state drives the disabled UI.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  // Refs for SDK objects (not React state — no re-render needed)
  const audioUnitBoxRef = useRef<AudioUnitBox | null>(null);
  const apparatBoxRef = useRef<ApparatDeviceBox | null>(null);
  const regionBoxRef = useRef<NoteRegionBox | null>(null);
  const activeScriptRef = useRef<string | null>(null);
  const initStartedRef = useRef(false);
  // Lazy-init: ScriptCompiler.create() runs once, not on every render.
  const compilerRef = useRef<ReturnType<typeof ScriptCompiler.create> | null>(null);
  if (!compilerRef.current) {
    compilerRef.current = ScriptCompiler.create({
      headerTag: "apparat",
      registryName: "apparatProcessors",
      functionName: "apparat",
    });
  }

  // Transport hooks
  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  const beginAction = useCallback(() => {
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
  }, []);

  const endAction = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
  }, []);

  // --- Instrument management (hot-swap: recompile onto the SAME Apparat box) ---
  const loadInstrument = useCallback(async (instrument: ShowcaseInstrument) => {
    if (!project || !audioContext || !apparatBoxRef.current || busyRef.current) return;
    const apparatBox = apparatBoxRef.current;
    beginAction();
    try {
      // compile() validates the script (a syntax error throws BEFORE the box is
      // touched — the previous script keeps playing), then writes the new code +
      // reconciled parameter boxes in ONE transaction and awaits addModule.
      // The processor swaps between blocks: held voices are cut, and the engine
      // re-pushes every current parameter value to the fresh Processor.
      const codeBefore = apparatBox.code.getValue();
      try {
        await compilerRef.current!.compile(audioContext, project.editing, apparatBox, instrument.script);
      } catch (err) {
        console.error(`Failed to compile instrument "${instrument.name}":`, err);
        setActionError(`Failed to load instrument "${instrument.name}": ${err instanceof Error ? err.message : String(err)}`);
        // An addModule failure rejects AFTER the box was mutated, and the
        // processor silences itself waiting for a registry update that never
        // arrives. Recompile the previous script to recover (a fresh update
        // number reloads it) — editing.undo() would revert the code field
        // without re-registering a worklet module, leaving the device silent.
        if (apparatBox.code.getValue() !== codeBefore && activeScriptRef.current) {
          try {
            await compilerRef.current!.compile(audioContext, project.editing, apparatBox, activeScriptRef.current);
          } catch (restoreErr) {
            console.error("Failed to restore the previous instrument:", restoreErr);
            setActionError(`Failed to load "${instrument.name}" and could not restore the previous instrument — the device stays silent until a script compiles.`);
          }
        }
        setInstrumentParams(readApparatParams(apparatBox));
        return;
      }
      activeScriptRef.current = instrument.script;
      setActiveInstrument(instrument.name);
      setInstrumentParams(readApparatParams(apparatBox));
    } finally {
      endAction();
    }
  }, [project, audioContext, beginAction, endAction]);

  const updateInstrumentParam = useCallback((paramName: string, value: number) => {
    if (!project || !apparatBoxRef.current) return;
    const paramBox = apparatBoxRef.current.parameters.pointerHub.incoming()
      .map(pointer => asInstanceOf(pointer.box, WerkstattParameterBox))
      .find(box => box.label.getValue() === paramName);
    if (!paramBox) {
      // Reachable when the box's params were reconciled away (e.g. a failed
      // compile) while the sliders still render the old script — never swallow it.
      console.warn(`Apparat parameter "${paramName}" not found on the device — slider write dropped.`);
      return;
    }
    project.editing.modify(() => {
      paramBox.value.setValue(value);
    });
    setInstrumentParams(prev => ({ ...prev, [paramName]: value }));
  }, [project]);

  const togglePattern = useCallback((on: boolean) => {
    if (!project || !regionBoxRef.current) return;
    const regionBox = regionBoxRef.current;
    project.editing.modify(() => {
      regionBox.mute.setValue(!on);
    });
    setPatternOn(on);
  }, [project]);

  // --- Live keyboard (software MIDI input reaches the armed CaptureMidi) ---
  const handleNoteOn = useCallback((note: number) => {
    MidiDevices.softwareMIDIInput.sendNoteOn(note, 0.8);
    setActiveNotes(prev => new Set(prev).add(note));
  }, []);

  const handleNoteOff = useCallback((note: number) => {
    MidiDevices.softwareMIDIInput.sendNoteOff(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  // --- Initialization ---
  const handleInit = useCallback(async () => {
    if (isInitialized || initStartedRef.current) return;
    initStartedRef.current = true;
    setInitError(null);
    setStatus("Initializing audio engine...");

    let createdContext: AudioContext | null = null;
    try {
      const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
        bpm: BPM,
        onStatusUpdate: setStatus,
      });
      createdContext = newAudioContext;

      setAudioContext(newAudioContext);
      setProject(newProject);

      const settings = newProject.engine.preferences.settings;
      settings.metronome.enabled = false;

      // Create the Apparat instrument. createInstrument returns the audio unit,
      // the instrument box AND its note track. editing.modify forwards the
      // modifier's return value as Option<R>; outer variables just keep the
      // three products readable without unwrapping.
      setStatus("Creating Apparat instrument...");
      let audioUnitBox: AudioUnitBox | null = null;
      let apparatBox: ApparatDeviceBox | null = null;
      let trackBox: TrackBox | null = null;
      newProject.editing.modify(() => {
        const product = newProject.api.createInstrument(InstrumentFactories.Apparat);
        audioUnitBox = product.audioUnitBox;
        apparatBox = product.instrumentBox;
        trackBox = product.trackBox;
      });
      if (!audioUnitBox || !apparatBox || !trackBox) {
        throw new Error("Failed to create the Apparat instrument.");
      }
      audioUnitBoxRef.current = audioUnitBox;
      apparatBoxRef.current = apparatBox;

      // Arm the CaptureMidi so the on-screen keyboard is heard live. Resolve the
      // capture AFTER the creation transaction commits (pointer re-routing
      // guideline); armed is a runtime observable — no editing.modify().
      const captureOption = newProject.captureDevices.get(
        (audioUnitBox as AudioUnitBox).address.uuid
      );
      if (captureOption.isEmpty()) {
        throw new Error("Could not arm the MIDI capture — the keyboard would be silent.");
      }
      captureOption.unwrap().armed.setValue(true);

      // A looping 4-bar chord pattern drives the instrument. createNoteRegion
      // defaults loopDuration to the region duration (set explicitly only when
      // the loop should differ); only a raw NoteRegionBox.create leaves it at
      // 0, which plays silently.
      let regionBox: NoteRegionBox | null = null;
      newProject.editing.modify(() => {
        regionBox = newProject.api.createNoteRegion({
          trackBox: trackBox as TrackBox,
          position: 0,
          duration: PATTERN_LENGTH,
          loopOffset: 0,
          loopDuration: PATTERN_LENGTH,
          name: "Chord Pattern",
        });
      });
      if (!regionBox) {
        throw new Error("Failed to create the note region.");
      }
      regionBoxRef.current = regionBox;

      // Fill the pattern in a second transaction: the region's `events` pointer
      // resolves only when the creation transaction commits, so optCollection
      // is empty until then.
      const regionAdapter = newProject.boxAdapters.adapterFor(
        regionBox as NoteRegionBox,
        NoteRegionBoxAdapter
      );
      const collectionOption = regionAdapter.optCollection;
      if (collectionOption.isEmpty()) {
        throw new Error("The note region has no event collection.");
      }
      const collection = collectionOption.unwrap();
      newProject.editing.modify(() => {
        for (const note of buildPattern()) {
          collection.createEvent({
            position: note.position,
            duration: note.duration,
            pitch: note.pitch,
            cent: 0,
            velocity: note.velocity,
            chance: 100,
            playCount: 1,
          });
        }
      });

      // Loop the timeline over the pattern
      newProject.editing.modify(() => {
        newProject.timelineBox.loopArea.from.setValue(0);
        newProject.timelineBox.loopArea.to.setValue(PATTERN_LENGTH);
        newProject.timelineBox.loopArea.enabled.setValue(true);
        newProject.timelineBox.durationInPulses.setValue(PATTERN_LENGTH);
      });

      // Compile the default instrument script onto the Apparat box
      setStatus("Compiling instrument script...");
      const defaultInstrument = SHOWCASE_INSTRUMENTS[0];
      await compilerRef.current!.compile(
        newAudioContext,
        newProject.editing,
        apparatBox as ApparatDeviceBox,
        defaultInstrument.script
      );
      activeScriptRef.current = defaultInstrument.script;
      setActiveInstrument(defaultInstrument.name);
      setInstrumentParams(readApparatParams(apparatBox as ApparatDeviceBox));

      setIsInitialized(true);
      setStatus("Ready");
    } catch (err) {
      console.error("Apparat demo initialization failed:", err);
      // A retry re-creates everything; close this context so repeated retries
      // don't exhaust the browser's AudioContext limit.
      void createdContext?.close();
      setAudioContext(null);
      setProject(null);
      setInitError(err instanceof Error ? err.message : String(err));
      setStatus("Click Start to retry...");
      initStartedRef.current = false;
    }
  }, [isInitialized]);

  // --- Render ---
  return (
    <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <style>{PIANO_STYLES}</style>
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Header */}
          <div>
            <div className="mc-kicker">Apparat &mdash; Scriptable Instruments &middot; OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              APPARAT
            </h1>
            <p className="mc-intro">
              Write a polyphonic instrument in JavaScript and play it inside the engine. An
              Apparat device wraps a user script &mdash; a <code>Processor</code> class with{" "}
              <code>noteOn()</code> / <code>noteOff()</code> / <code>process()</code> methods
              and parameters declared as <code>// @param</code> comments &mdash; compiles it
              with <code>ScriptCompiler</code>, and runs it on the AudioWorklet thread. A
              looping chord pattern drives the instrument; switch synth engines while it
              plays, tweak parameters live, or play the on-screen keyboard.
            </p>
          </div>

          {!isInitialized ? (
            <Card>
              <Flex direction="column" align="center" gap="3" p="6">
                {initError && (
                  <Callout.Root color="red" role="alert">
                    <Callout.Text>
                      <strong>Initialization failed:</strong> {initError}
                    </Callout.Text>
                  </Callout.Root>
                )}
                <Text size="3">{status}</Text>
                <Button size="3" onClick={handleInit}>
                  Start Audio Engine
                </Button>
              </Flex>
            </Card>
          ) : (
            <>
              {/* Transport & pattern */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Transport &amp; Pattern
                  </Text>
                  <Separator size="4" />
                  <Flex gap="4" align="center" wrap="wrap">
                    <Flex gap="2" align="center">
                      <Button
                        variant={isPlaying ? "soft" : "solid"}
                        onClick={isPlaying ? handlePause : handlePlay}
                      >
                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                        {isPlaying ? "Pause" : "Play"}
                      </Button>
                      <Button variant="soft" onClick={handleStop}>
                        <StopIcon /> Stop
                      </Button>
                      <Text size="2" color="gray" ml="2" style={{ fontFamily: "var(--mc-mono)" }}>
                        Bar {Math.floor(currentPosition / BAR) + 1}, Beat{" "}
                        {Math.floor((currentPosition % BAR) / (BAR / 4)) + 1}
                      </Text>
                    </Flex>
                    <Flex gap="3" align="center" ml="auto">
                      <Text size="2" weight="bold">Chord Pattern</Text>
                      <SegmentedControl.Root
                        value={patternOn ? "on" : "off"}
                        onValueChange={(v) => togglePattern(v === "on")}
                      >
                        <SegmentedControl.Item value="on">On</SegmentedControl.Item>
                        <SegmentedControl.Item value="off">Off</SegmentedControl.Item>
                      </SegmentedControl.Root>
                    </Flex>
                  </Flex>
                  <Text size="1" color="gray">
                    Four looping bars &mdash; Am, F, C, G &mdash; bass roots plus an eighth-note
                    arpeggio, all played by the script below.
                  </Text>
                </Flex>
              </Card>

              {/* Instrument Showcase */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">
                    Instrument Showcase
                  </Text>
                  <Separator size="4" />

                  {actionError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{actionError}</Callout.Text>
                    </Callout.Root>
                  )}

                  <div className="ap-grid">
                    {SHOWCASE_INSTRUMENTS.map((instrument) => (
                      <button
                        key={instrument.name}
                        type="button"
                        className="ap-card"
                        data-active={activeInstrument === instrument.name || undefined}
                        onClick={() => loadInstrument(instrument)}
                        disabled={busy}
                      >
                        <span className="ap-card-name">{instrument.name}</span>
                        <span className="ap-card-desc">{instrument.description}</span>
                      </button>
                    ))}
                  </div>

                  {/* Parameter sliders */}
                  {Object.keys(instrumentParams).length > 0 && activeScriptRef.current && (() => {
                    const sections = ScriptDeclaration.parseGroups(activeScriptRef.current!);
                    return (
                      <div style={{
                        border: "1px solid var(--mc-line)",
                        borderRadius: 4,
                        padding: 16,
                        background: "var(--mc-bg)",
                      }}>
                        <Flex direction="column" gap="3">
                          <Text size="2" weight="bold">Parameters</Text>
                          {sections.map((section, sIdx) => (
                            <Flex key={sIdx} direction="column" gap="2">
                              {section.group && (
                                <Text size="1" weight="bold" style={{
                                  color: section.group.color || undefined,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em",
                                }}>
                                  {section.group.label}
                                </Text>
                              )}
                              {section.items
                                .filter((item): item is Extract<typeof item, { type: "param" }> => item.type === "param")
                                .map((item) => {
                                  const decl = item.declaration;
                                  const value = instrumentParams[decl.label] ?? decl.defaultValue;
                                  const step = decl.mapping === "int" ? 1 : (decl.max - decl.min) / 200;
                                  return (
                                    <Flex key={decl.label} direction="column" gap="1">
                                      <Flex justify="between">
                                        <Text size="1" color="gray">{decl.label}</Text>
                                        <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>
                                          {decl.mapping === "int" ? value.toFixed(0) : value.toFixed(2)}
                                          {decl.unit ? ` ${decl.unit}` : ""}
                                        </Text>
                                      </Flex>
                                      <Slider
                                        min={decl.min}
                                        max={decl.max}
                                        step={step}
                                        value={[value]}
                                        onValueChange={([v]) => updateInstrumentParam(decl.label, v)}
                                      />
                                    </Flex>
                                  );
                                })}
                            </Flex>
                          ))}
                        </Flex>
                      </div>
                    );
                  })()}

                  {/* Code display */}
                  {activeInstrument && (
                    <div>
                      <Text size="2" weight="bold">Source Code</Text>
                      <Code size="2" style={CODE_BLOCK_STYLE}>
                        {SHOWCASE_INSTRUMENTS.find(i => i.name === activeInstrument)?.script}
                      </Code>
                    </div>
                  )}
                </Flex>
              </Card>

              {/* Live keyboard */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Play Live
                  </Text>
                  <Separator size="4" />
                  <Text size="1" color="gray">
                    The keyboard sends software MIDI into the armed capture &mdash; the script
                    voices your notes immediately, with or without the transport running.
                  </Text>
                  <div className="ap-keyboard-wrap">
                    <PianoKeyboard
                      activeNotes={activeNotes}
                      onNoteOn={handleNoteOn}
                      onNoteOff={handleNoteOff}
                    />
                  </div>
                </Flex>
              </Card>

              {/* Processor API */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    The Processor API
                  </Text>
                  <Separator size="4" />
                  <Text size="2" color="gray">
                    An Apparat script defines a <code>Processor</code> class. The engine
                    instantiates it on the AudioWorklet thread and calls:
                  </Text>
                  <div className="ap-table-wrap">
                    <table className="ap-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Called when</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PROCESSOR_API.map(([member, when]) => (
                          <tr key={member}>
                            <td style={{ whiteSpace: "nowrap" }}><Code size="1">{member}</Code></td>
                            <td>{when}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Text size="2" color="gray">
                    The engine validates every rendered block &mdash; a NaN or a sample beyond
                    &plusmn;1000 (~60 dB) silences the device and reports the error &mdash; and
                    runs a limiter after the script. Keep allocation out of{" "}
                    <code>process()</code>: per-note allocation (a delay line in{" "}
                    <code>noteOn</code>) is fine, per-block allocation invites GC glitches.
                  </Text>
                </Flex>
              </Card>

              {/* SDK reference */}
              <section className="mc-anchors">
                <h2 className="mc-anchors-head">SDK reference</h2>
                <p>
                  An Apparat instrument is created like any other instrument &mdash;{" "}
                  <code>createInstrument</code> returns the audio unit, the instrument box and
                  its note track. The script only runs after{" "}
                  <code>ScriptCompiler.compile()</code> wraps it, registers it on the
                  AudioWorklet, and writes an <code>// @apparat</code> header back into the
                  box&apos;s code field. Recompiling onto the same box hot-swaps the
                  instrument between blocks &mdash; that is what the showcase cards do while
                  the pattern plays. The swap cuts held voices and the engine re-pushes the
                  current parameter values to the fresh <code>Processor</code>.
                </p>

                <Code size="2" style={CODE_BLOCK_STYLE}>
                  {`// Create the instrument (inside a transaction), then compile OUTSIDE it
let product: InstrumentProduct<ApparatDeviceBox>;
project.editing.modify(() => {
  product = project.api.createInstrument(InstrumentFactories.Apparat);
});
await compiler.compile(audioContext, project.editing, product.instrumentBox, script);

// Arm the capture so live MIDI (e.g. the software keyboard) reaches the script
project.captureDevices.get(product.audioUnitBox.address.uuid)
  .unwrap().armed.setValue(true);

// Drive it from the timeline. createNoteRegion defaults loopDuration to
// duration; only a raw NoteRegionBox.create leaves it at 0, which plays
// silently.
const regionBox = project.api.createNoteRegion({
  trackBox: product.trackBox, position: 0, duration: length,
  loopOffset: 0, loopDuration: length, name: "Pattern",
});`}
                </Code>

                <p>
                  Each <code>// @param</code> declaration becomes an automatable parameter box
                  the sliders above write inside <code>editing.modify()</code>. The same user
                  script runs unchanged on the TypeScript engine and on the WASM (Rust)
                  engine &mdash; there the Apparat device is a thin wasm bridge that calls the
                  script once per block over shared memory.
                </p>
              </section>
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
}
