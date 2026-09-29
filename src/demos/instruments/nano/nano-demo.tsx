import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { asInstanceOf } from "@opendaw/lib-std";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project, MidiDevices } from "@opendaw/studio-core";
import { LfoModulatorBoxAdapter } from "@opendaw/studio-adapters";
import { LfoModulatorBox, type ModulationBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { NANO_SAMPLES, type NanoSampleId } from "@/lib/nanoSamples";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DropZone } from "@/components/DropZone";
import { ParamSlider, useSliderThumbLabel } from "@/components/ParamSlider";
import { PianoKeyboard, PIANO_STYLES } from "@/demos/midi/PianoKeyboard";
import { CANVAS_COLORS, CODE_BLOCK_STYLE, CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { CanvasPainter } from "@/lib/CanvasPainter";
import type { UnitParameter } from "@/hooks/useParameterUnit";
import { NanoWaveform, WAVEFORM_STYLES } from "./NanoWaveform";
import { LFO_DEFAULT_RATE_LABEL } from "./nanoPresets";
import { dropZoneText, readDroppedSample, skippedFilesNote } from "./nanoMessages";
import { buildNanoDemoContent, NANO_DEMO_BPM, type CurrentSample, type NanoDemoSetup } from "./nanoContent";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Text, Flex, Card, Callout, Badge, Button, Switch, Grid, Select, Slider, Code,
} from "@radix-ui/themes";

const PAGE_STYLES = `
.nn-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}
.nn-card {
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
.nn-card:hover:not(:disabled) { background: var(--mc-panel-hover); }
.nn-card[data-active] { border-color: var(--mc-amber); }
.nn-card:disabled { cursor: default; opacity: 0.55; }
.nn-card:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.nn-card-name { font-family: var(--mc-mono); font-size: 13px; font-weight: 600; }
.nn-card-desc { font-size: 11.5px; line-height: 1.45; color: var(--mc-muted); }
.nn-keys { overflow-x: auto; padding-bottom: 4px; }
@media (prefers-reduced-motion: reduce) {
  .nn-card { transition: none; }
}
`;

/** Switch bound to the sampler's boolean Loop parameter */
const LoopSwitch: React.FC<{ project: Project; setup: NanoDemoSetup }> = ({ project, setup }) => {
  const parameter = setup.adapter.namedParameter.loop;
  const [on, setOn] = useState(() => parameter.getValue());
  useEffect(() => {
    const sub = parameter.catchupAndSubscribe(current => setOn(current.getValue()));
    return () => sub.terminate();
  }, [parameter]);
  return (
    <Flex align="center" gap="2">
      <Switch
        checked={on}
        aria-label="Loop"
        onCheckedChange={value => project.editing.modify(() => parameter.setValue(value))}
      />
      <Text size="2" color="gray">Loop</Text>
    </Flex>
  );
};

const CODE_REFERENCE = `import { UUID } from "@opendaw/lib-std";
import { AudioFileBox } from "@opendaw/studio-boxes";
import { InstrumentFactories, NanoDeviceBoxAdapter } from "@opendaw/studio-adapters";

// 1. Register the decoded audio under a uuid, then create the file box and
//    the sampler in one transaction. The file box is the factory's attachment.
//    localAudioBuffers is the Map your sample provider's fetch(uuid) reads
//    from; on this site it is the one passed to initializeOpenDAW().
const uuid = UUID.generate();
localAudioBuffers.set(UUID.toString(uuid), audioBuffer);

const { instrumentBox: nanoBox, audioUnitBox } = project.editing.modify(() => {
  const fileBox = AudioFileBox.create(project.boxGraph, uuid, box => {
    box.fileName.setValue("My sample");
    box.endInSeconds.setValue(audioBuffer.duration);
  });
  return project.api.createInstrument(InstrumentFactories.Nano, { attachment: fileBox });
}).unwrap();

// 2. After that transaction: arm the MIDI capture and take the adapter.
project.captureDevices.get(audioUnitBox.address.uuid).unwrap().armed.setValue(true);
const nano = project.boxAdapters.adapterFor(nanoBox, NanoDeviceBoxAdapter);

// 3. Shape the playback. All four markers are shares of the whole sample.
project.editing.modify(() => {
  const p = nano.namedParameter;
  p.rootKey.setValue(57);      // the note that plays the sample at its own pitch
  p.sampleStart.setValue(1);   // start past end: play backwards
  p.sampleEnd.setValue(0);
  p.loop.setValue(true);
  p.loopStart.setValue(0.25);  // kept inside the region by the engine
  p.loopEnd.setValue(0.6);
  p.loopFade.setValue(0.05);   // seconds, capped at half the loop
});

// 4. Follow the read heads: the first 16 sounding voices, in source frames.
//    A -1 ends the list when fewer than 16 are sounding.
const sub = project.liveStreamReceiver.subscribeFloats(nano.positionsAddress, positions => {
  const numberOfFrames = nano.file().unwrap().data.unwrap().numberOfFrames; // once loaded
  for (const frame of positions) {
    if (frame === -1) break;
    drawPlayheadAt(frame / (numberOfFrames - 1));
  }
});`;

const LFO_DEFAULT_DEPTH = 0.3;
const LFO_DEFAULT_RATE = (() => {
  const index = LfoModulatorBoxAdapter.RateStrings.indexOf(LFO_DEFAULT_RATE_LABEL);
  // Index 0 is "Off". A unit test holds the label to the LFO's list, so this is for a reader, not a fallback.
  if (index < 0) console.error(`Nano demo: the LFO offers no "${LFO_DEFAULT_RATE_LABEL}" rate`);
  return Math.max(0, index);
})();
const SCOPE_LENGTH = 4 * 60;

/** Plots the controlled unit value: the stored value plus the modulation the engine streams back */
const StartScope: React.FC<{ parameter: UnitParameter }> = ({ parameter }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const samples = new Float32Array(SCOPE_LENGTH).fill(parameter.getUnitValue());
    let head = 0;
    const painter = new CanvasPainter(canvas, (_painter, context) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, width, height);
      const baseY = (1 - parameter.getUnitValue()) * (height - 8) + 4;
      context.strokeStyle = CANVAS_COLORS.gridSupporting;
      context.setLineDash([3, 4]);
      context.beginPath();
      context.moveTo(0, baseY);
      context.lineTo(width, baseY);
      context.stroke();
      context.setLineDash([]);
      context.strokeStyle = CANVAS_COLORS.amber;
      context.lineWidth = 1.5;
      context.beginPath();
      for (let i = 0; i < SCOPE_LENGTH; i++) {
        const x = (i / (SCOPE_LENGTH - 1)) * width;
        const y = (1 - samples[(head + i) % SCOPE_LENGTH]) * (height - 8) + 4;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    });
    const frame = AnimationFrame.add(() => {
      samples[head] = parameter.getControlledUnitValue();
      head = (head + 1) % SCOPE_LENGTH;
      painter.requestUpdate();
    });
    return () => {
      frame.terminate();
      painter.terminate();
    };
  }, [parameter]);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Recent sample start values, with the LFO added"
      style={{
        width: "100%", height: 64, display: "block", boxSizing: "border-box",
        border: "1px solid var(--mc-line)", borderRadius: 4, background: CANVAS_COLORS.bg,
      }}
    />
  );
};

type LfoSetup = { readonly box: LfoModulatorBox; readonly assignment: ModulationBox };

/**
 * One LFO on Sample Start. Created the first time the switch goes on, in its
 * own transaction; after that the modulator's enabled flag toggles it.
 */
const LfoCard: React.FC<{
  project: Project;
  setup: NanoDemoSetup;
  onEnabledChange: (enabled: boolean) => void;
}> = ({ project, setup, onEnabledChange }) => {
  const [lfo, setLfo] = useState<LfoSetup | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [rate, setRate] = useState(LFO_DEFAULT_RATE);
  const [depth, setDepth] = useState(LFO_DEFAULT_DEPTH);
  const [lfoError, setLfoError] = useState<string | null>(null);
  const sampleStart = setup.adapter.namedParameter.sampleStart;
  const depthRef = useSliderThumbLabel("LFO depth");
  const onEnabledChangeRef = useRef(onEnabledChange);
  onEnabledChangeRef.current = onEnabledChange;

  useEffect(() => {
    if (!lfo) return undefined;
    const enabledSub = lfo.box.enabled.catchupAndSubscribe(obs => {
      setEnabled(obs.getValue());
      onEnabledChangeRef.current(obs.getValue());
    });
    const rateSub = lfo.box.rateSync.catchupAndSubscribe(obs => setRate(obs.getValue()));
    const depthSub = lfo.assignment.depth.catchupAndSubscribe(obs => setDepth(obs.getValue()));
    return () => {
      enabledSub.terminate();
      rateSub.terminate();
      depthSub.terminate();
    };
  }, [lfo]);

  const onToggle = useCallback((on: boolean) => {
    if (lfo) {
      project.editing.modify(() => lfo.box.enabled.setValue(on));
      return;
    }
    if (!on) return;
    let box: LfoModulatorBox | null = null;
    let assignment: ModulationBox | null = null;
    try {
      // modify() rethrows after aborting, so a failure commits nothing. It is
      // caught here so the switch does not just stay off without a reason.
      project.editing.modify(() => {
        box = asInstanceOf(project.api.modulation.createLfo("Start Scan"), LfoModulatorBox);
        box.rateSync.setValue(LFO_DEFAULT_RATE);
        // Unipolar: the LFO only ever moves the start forward from its marker. A
        // bipolar LFO on a start of 0 would spend half of every cycle clamped at 0.
        box.bipolar.setValue(false);
        assignment = project.api.modulation.assign(box, sampleStart.modulationTarget, LFO_DEFAULT_DEPTH);
      });
    } catch (error) {
      console.error("Nano demo: LFO creation failed: " + String(error));
      setLfoError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!box || !assignment) {
      console.error("Nano demo: LFO creation produced no box or no assignment");
      setLfoError("The LFO was not created.");
      return;
    }
    setLfoError(null);
    setLfo({ box: box as LfoModulatorBox, assignment: assignment as ModulationBox });
  }, [project, lfo, sampleStart]);

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between" wrap="wrap" gap="2">
          <Text size="2" weight="bold" color="gray">LFO on Sample Start</Text>
          <Flex align="center" gap="2">
            <Switch checked={enabled} aria-label="LFO on Sample Start" onCheckedChange={onToggle} />
            <Text size="2" color="gray">{enabled ? "On" : "Off"}</Text>
          </Flex>
        </Flex>
        <Text size="1" color="gray">
          The LFO moves the start of each new note away from the S marker by up to the
          depth: forward for a positive depth, backward for a negative one. The result
          stays inside the sample, so with S at 100 % (the Riser as loaded) only a
          negative depth has an effect. A note keeps the region it started with, so a
          note that is already sounding does not follow the LFO. The dashed line on the
          waveform is the start a note would get right now.
        </Text>
        {lfo && (
          <Grid columns={{ initial: "1", sm: "2" }} gap="3">
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">Rate</Text>
              <Select.Root
                value={String(rate)}
                onValueChange={value => project.editing.modify(() => lfo.box.rateSync.setValue(Number(value)))}
              >
                <Select.Trigger aria-label="LFO rate" />
                <Select.Content>
                  {LfoModulatorBoxAdapter.RateStrings.map((label, index) => (
                    <Select.Item key={label} value={String(index)}>{label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <Flex direction="column" gap="1">
              <Flex justify="between">
                <Text size="1" color="gray">Depth</Text>
                <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>{depth.toFixed(2)}</Text>
              </Flex>
              <Slider
                ref={depthRef}
                min={-1} max={1} step={0.01}
                value={[depth]}
                onValueChange={([value]) =>
                  project.editing.modify(() => lfo.assignment.depth.setValue(Math.min(1, Math.max(-1, value))))}
              />
            </Flex>
          </Grid>
        )}
        {lfo && <StartScope parameter={sampleStart} />}
        {lfoError && (
          <Callout.Root color="red" size="1" role="alert">
            <Callout.Text>Could not create the LFO: {lfoError}</Callout.Text>
          </Callout.Root>
        )}
      </Flex>
    </Card>
  );
};

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [setup, setSetup] = useState<NanoDemoSetup | null>(null);
  const [current, setCurrent] = useState<CurrentSample | null>(null);
  const [peaksVersion, setPeaksVersion] = useState(0);
  const [lfoOn, setLfoOn] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [midiState, setMidiState] = useState<"idle" | "enabled" | "unavailable">("idle");
  const [midiError, setMidiError] = useState<string | null>(null);
  // Counts selections, so a callback from an earlier selection can be told apart.
  const selectionRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    let createdContext: AudioContext | null = null;
    let createdProject: Project | null = null;
    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        const { project: newProject, audioContext: context } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: NANO_DEMO_BPM,
          onStatusUpdate: setStatus,
        });
        createdContext = context;
        createdProject = newProject;
        if (!mounted) {
          newProject.terminate();
          void context.close();
          return;
        }
        newProject.engine.preferences.settings.metronome.enabled = false;
        const built = await buildNanoDemoContent(newProject, context, localAudioBuffers, setStatus);
        if (!mounted) {
          newProject.terminate();
          void context.close();
          return;
        }
        setAudioContext(context);
        setProject(newProject);
        setSetup(built);
        setCurrent(built.initialSample);
        setMidiState(MidiDevices.canRequestMidiAccess() ? "idle" : "unavailable");
        setStatus("Ready");
      } catch (error) {
        console.error(
          "Nano demo: init failed: " + String(error) +
          (error instanceof Error && error.stack ? "\n" + error.stack : "")
        );
        // Without the terminate, a failed content build leaves the engine running behind the error card.
        createdProject?.terminate();
        void createdContext?.close();
        if (mounted) setInitError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!project) return undefined;
    const sub = project.engine.isPlaying.catchupAndSubscribe(obs => setIsPlaying(obs.getValue()));
    return () => sub.terminate();
  }, [project]);

  /** Callbacks for one selection. A later selection makes them inert. */
  const callbacksFor = useCallback((token: number) => ({
    onLoaded: () => {
      if (selectionRef.current === token) setPeaksVersion(version => version + 1);
    },
    onError: (message: string) => {
      if (selectionRef.current !== token) return;
      setSampleError(message);
      setLoadFailed(true);
    },
  }), []);

  const chooseSample = useCallback((id: NanoSampleId) => {
    if (!setup) return;
    const token = ++selectionRef.current;
    setSampleError(null);
    setSampleNote(null);
    setLoadFailed(false);
    try {
      setCurrent(setup.selectSample(id, callbacksFor(token)));
    } catch (error) {
      console.error("Nano demo: could not select sample: " + String(error));
      setSampleError(`Could not load that sample: ${String(error)}`);
    }
  }, [setup, callbacksFor]);

  const loadDroppedFile = useCallback(async (file: File, skippedCount: number) => {
    if (!setup || !audioContext) return;
    setBusy(true);
    setSampleError(null);
    setSampleNote(skippedFilesNote(skippedCount));
    try {
      const dropped = await readDroppedSample(file, bytes => audioContext.decodeAudioData(bytes));
      if (!dropped.ok) {
        setSampleError(dropped.message);
        return;
      }
      // A box-graph failure here is not the fault of the user's file.
      try {
        const token = ++selectionRef.current;
        setLoadFailed(false);
        setCurrent(setup.setCustomSample(file.name, dropped.buffer, callbacksFor(token)));
      } catch (error) {
        console.error("Nano demo: could not load sample into the engine: " + String(error));
        setSampleError(`Failed to load "${file.name}" into the engine: ${String(error)}`);
      }
    } finally {
      setBusy(false);
    }
  }, [setup, audioContext, callbacksFor]);

  const handleNoteOn = useCallback((note: number) => {
    // Sent synchronously: awaiting resume() first could deliver Off before On and hang the voice.
    if (audioContext && audioContext.state !== "running") {
      audioContext.resume().catch(error =>
        console.error("Nano demo: AudioContext resume failed: " + String(error)));
    }
    MidiDevices.softwareMIDIInput.sendNoteOn(note, 0.8);
    setActiveNotes(previous => new Set(previous).add(note));
  }, [audioContext]);

  const handleNoteOff = useCallback((note: number) => {
    MidiDevices.softwareMIDIInput.sendNoteOff(note);
    setActiveNotes(previous => {
      const next = new Set(previous);
      next.delete(note);
      return next;
    });
  }, []);

  const enableMidi = useCallback(async () => {
    setMidiError(null);
    try {
      await MidiDevices.requestPermission();
      setMidiState("enabled");
    } catch (error) {
      console.warn("Nano demo: MIDI permission was not granted: " + String(error));
      setMidiError("MIDI input was not enabled. The browser refused access or has no MIDI support.");
    }
  }, []);

  const ready = project !== null && setup !== null && current !== null;

  return (
    <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <style>{PIANO_STYLES}</style>
      <style>{WAVEFORM_STYLES}</style>
      <Container size="4" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="5" style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Instruments — Sampler · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>NANO</h1>
            <p className="mc-intro">
              A polyphonic sampler: one sample, played across the keyboard. Choose the part
              of the sample to play, run it backwards, loop it with a crossfade, and retune
              it. Every sampler control on this page writes to{" "}
              <code>NanoDeviceBoxAdapter.namedParameter</code>; the moving lines on the
              waveform are the engine's own read heads.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text><strong>Initialization failed:</strong> {initError}</Callout.Text>
            </Callout.Root>
          ) : !ready ? (
            <Text align="center" color="gray">{status}</Text>
          ) : (
            <>
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">Sample</Text>
                  <div className="nn-grid">
                    {NANO_SAMPLES.map(spec => (
                      <button
                        key={spec.id}
                        type="button"
                        className="nn-card"
                        data-active={current.id === spec.id ? "" : undefined}
                        aria-pressed={current.id === spec.id}
                        disabled={busy}
                        onClick={() => chooseSample(spec.id)}
                      >
                        <span className="nn-card-name">{spec.name}</span>
                        <span className="nn-card-desc">{spec.description}</span>
                      </button>
                    ))}
                  </div>
                  <DropZone
                    ariaLabel="Drop an audio file to use as the sample, or press Enter to browse"
                    disabled={busy}
                    onFile={(file, skippedCount) => void loadDroppedFile(file, skippedCount)}
                    onInvalidDrop={() => setSampleError("That drop held no file. Drop an audio file.")}
                  >
                    <Text size="2" color="gray">
                      {dropZoneText(current, loadFailed)}
                    </Text>
                  </DropZone>
                  {sampleNote && (
                    <Callout.Root color="amber" size="1" role="status">
                      <Callout.Text>{sampleNote}</Callout.Text>
                    </Callout.Root>
                  )}
                  {sampleError && (
                    <Callout.Root color="red" size="1" role="alert">
                      <Callout.Text>{sampleError}</Callout.Text>
                    </Callout.Root>
                  )}
                </Flex>
              </Card>

              <Card>
                <Flex direction="column" gap="3">
                  <Flex align="center" justify="between" wrap="wrap" gap="2">
                    <Text size="2" weight="bold" color="gray">Waveform</Text>
                    <Text size="1" color="gray">
                      Drag S and E to set the region, L to set the loop. Arrow keys move a focused marker.
                    </Text>
                  </Flex>
                  <NanoWaveform
                    project={project}
                    adapter={setup.adapter}
                    sampleSeconds={current.seconds}
                    peaksVersion={peaksVersion}
                    ghostParameter={lfoOn ? setup.adapter.namedParameter.sampleStart : null}
                  />
                </Flex>
              </Card>

              <Card>
                <Flex align="center" gap="3" wrap="wrap">
                  <Button onClick={() => project.engine.play()} disabled={isPlaying}>▶ Play pattern</Button>
                  <Button variant="soft" onClick={() => project.engine.stop(true)} disabled={!isPlaying}>■ Stop</Button>
                  <Badge color={isPlaying ? "green" : "amber"}>{isPlaying ? "Playing" : "Stopped"}</Badge>
                  <Text size="1" color="gray">
                    A two-bar pattern written for the selected sample. Keys and MIDI play on top of it.
                  </Text>
                </Flex>
              </Card>

              <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                <Card>
                  <Flex direction="column" gap="3">
                    <Text size="2" weight="bold" color="gray">Pitch</Text>
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.rootKey} label="Root key" positions={128} />
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.octave} label="Octave" positions={7} />
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.tune} label="Tune" />
                    <Text size="1" color="gray">These three are read live: they retune notes that are already sounding.</Text>
                  </Flex>
                </Card>
                <Card>
                  <Flex direction="column" gap="3">
                    <Text size="2" weight="bold" color="gray">Envelope and gain</Text>
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.attack} label="Attack" />
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.release} label="Release" />
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.volume} label="Gain" />
                  </Flex>
                </Card>
                <Card>
                  <Flex direction="column" gap="3">
                    <Text size="2" weight="bold" color="gray">Region</Text>
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.sampleStart} label="Start" step={0.001} />
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.sampleEnd} label="End" step={0.001} />
                    <Text size="1" color="gray">
                      Start past End plays backwards. A note keeps the region it started with, so
                      a change is heard on the next note.
                    </Text>
                  </Flex>
                </Card>
                <Card>
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Text size="2" weight="bold" color="gray">Loop</Text>
                      <LoopSwitch project={project} setup={setup} />
                    </Flex>
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.loopStart} label="Loop start" step={0.001} />
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.loopEnd} label="Loop end" step={0.001} />
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.loopFade} label="Fade" />
                    <Text size="1" color="gray">
                      The loop is kept inside the region, and the fade is capped at half the loop.
                      Loop changes are heard at once, on notes that are already sounding.
                    </Text>
                  </Flex>
                </Card>
              </Grid>

              <LfoCard project={project} setup={setup} onEnabledChange={setLfoOn} />

              <Card>
                <Flex direction="column" gap="3">
                  <Flex align="center" justify="between" wrap="wrap" gap="2">
                    <Text size="2" weight="bold" color="gray">Keyboard</Text>
                    {midiState === "idle" && (
                      <Button size="1" variant="soft" onClick={() => void enableMidi()}>Enable MIDI input</Button>
                    )}
                    {midiState === "enabled" && <Badge color="green">MIDI input on</Badge>}
                    {midiState === "unavailable" && <Badge color="gray">No MIDI in this browser</Badge>}
                  </Flex>
                  <div className="nn-keys">
                    <PianoKeyboard activeNotes={activeNotes} onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} />
                  </div>
                  {midiError && (
                    <Callout.Root color="amber" size="1" role="status">
                      <Callout.Text>{midiError}</Callout.Text>
                    </Callout.Root>
                  )}
                </Flex>
              </Card>

              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold" color="gray">Code reference</Text>
                  <Code style={CODE_BLOCK_STYLE}>{CODE_REFERENCE}</Code>
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
  createRoot(rootElement).render(<App />);
}
