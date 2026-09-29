import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Project, MidiDevices } from "@opendaw/studio-core";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { NANO_SAMPLES, checkCustomSample } from "@/lib/nanoSamples";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DropZone } from "@/components/DropZone";
import { ParamSlider } from "@/components/ParamSlider";
import { PianoKeyboard, PIANO_STYLES } from "@/demos/midi/PianoKeyboard";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { buildNanoDemoContent, NANO_DEMO_BPM, type CurrentSample, type NanoDemoSetup } from "./nanoContent";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Flex, Card, Callout, Badge, Button, Switch, Grid } from "@radix-ui/themes";

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

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [setup, setSetup] = useState<NanoDemoSetup | null>(null);
  const [current, setCurrent] = useState<CurrentSample | null>(null);
  // Task 7 reads this value; until then only the setter is named (an unread state value fails the type check).
  const [, setPeaksVersion] = useState(0);
  const [sampleError, setSampleError] = useState<string | null>(null);
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
    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        const { project: newProject, audioContext: context } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: NANO_DEMO_BPM,
          onStatusUpdate: setStatus,
        });
        createdContext = context;
        if (!mounted) return;
        newProject.engine.preferences.settings.metronome.enabled = false;
        const built = await buildNanoDemoContent(newProject, context, localAudioBuffers, setStatus);
        if (!mounted) return;
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
      if (selectionRef.current === token) setSampleError(message);
    },
  }), []);

  const chooseSample = useCallback((id: string) => {
    if (!setup) return;
    const token = ++selectionRef.current;
    setSampleError(null);
    try {
      setCurrent(setup.selectSample(id, callbacksFor(token)));
    } catch (error) {
      console.error("Nano demo: could not select sample: " + String(error));
      setSampleError(`Could not load that sample: ${String(error)}`);
    }
  }, [setup, callbacksFor]);

  const loadDroppedFile = useCallback(async (file: File) => {
    if (!setup || !audioContext) return;
    setBusy(true);
    setSampleError(null);
    try {
      let buffer: AudioBuffer;
      try {
        buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
      } catch (error) {
        console.warn("Nano demo: could not decode dropped file: " + String(error));
        setSampleError(`Could not decode "${file.name}". Drop a wav, mp3 or m4a audio file.`);
        return;
      }
      const refusal = checkCustomSample(buffer.duration, buffer.length);
      if (refusal !== null) {
        setSampleError(`"${file.name}" was not loaded: ${refusal}.`);
        return;
      }
      // A box-graph failure here is not the fault of the user's file.
      try {
        const token = ++selectionRef.current;
        setCurrent(setup.setCustomSample(file.name, buffer, callbacksFor(token)));
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
              it. Everything on this page goes through{" "}
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
                    onFile={file => void loadDroppedFile(file)}
                    onInvalidDrop={() => setSampleError("That drop held no file. Drop an audio file.")}
                  >
                    <Text size="2" color="gray">
                      {current.id === null
                        ? `Loaded: ${current.name} (${current.seconds.toFixed(2)} s). Drop another file to replace it.`
                        : "Or drop your own audio file here (up to 60 s)."}
                    </Text>
                  </DropZone>
                  {sampleError && (
                    <Callout.Root color="red" size="1" role="alert">
                      <Callout.Text>{sampleError}</Callout.Text>
                    </Callout.Root>
                  )}
                </Flex>
              </Card>

              {/* WAVEFORM — Task 7 inserts <NanoWaveform …/> in a Card here */}

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
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.rootKey} label="Root key" step={1 / 127} />
                    <ParamSlider project={project} parameter={setup.adapter.namedParameter.octave} label="Octave" step={1 / 6} />
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
                    </Text>
                  </Flex>
                </Card>
              </Grid>

              {/* LFO — Task 8 inserts <LfoCard …/> here */}

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

              {/* CODE REFERENCE — Task 10 inserts the reference card here */}
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
