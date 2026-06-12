import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { Project, MidiDevices } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { useEnginePreference } from "@/hooks/useEnginePreference";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
import { PianoKeyboard, PIANO_STYLES, noteName } from "./PianoKeyboard";
import { StepRecordingSection } from "./StepRecordingSection";
import type { RecordedNote } from "./StepRecordingSection";
import { CONSOLE_STYLES, CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Text,
  Button,
  Flex,
  Card,
  Select,
  Callout,
  Badge,
  Code,
} from "@radix-ui/themes";

type ActiveNote = {
  pitch: number;
  velocity: number;
  timestamp: number;
};

/**
 * NoteDisplay component - shows recently played/recorded notes
 */
const NoteDisplay: React.FC<{
  notes: ActiveNote[];
  recordedNotes: RecordedNote[];
}> = ({ notes, recordedNotes }) => {
  return (
    <Flex direction="column" gap="2">
      <Flex gap="2" wrap="wrap" style={{ minHeight: 28 }}>
        {notes.length === 0 ? (
          <Text size="2" color="gray">No active notes</Text>
        ) : (
          notes.map((note, i) => (
            <Badge key={`${note.pitch}-${i}`} color="amber" size="1">
              {noteName(note.pitch)} vel:{Math.round(note.velocity * 127)}
            </Badge>
          ))
        )}
      </Flex>
      {recordedNotes.length > 0 && (
        <Text size="1" color="gray">
          {recordedNotes.length} note{recordedNotes.length !== 1 ? "s" : ""} recorded
        </Text>
      )}
    </Flex>
  );
};

/**
 * Main MIDI Recording Demo App
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  // Post-init failures (start recording/playback). The `status` string is
  // only rendered on the pre-init screen, so errors must not go there.
  const [uiError, setUiError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // MIDI state
  const [midiAvailable, setMidiAvailable] = useState(false);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiDevices, setMidiDevices] = useState<MIDIInput[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [filterChannel, setFilterChannel] = useState(-1); // -1 = all

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [recentNotes, setRecentNotes] = useState<ActiveNote[]>([]);
  const [recordedNotes, setRecordedNotes] = useState<RecordedNote[]>([]);

  // Settings
  const [useCountIn, setUseCountIn] = useState(false);
  const [bpm, setBpm] = useState(120);

  // Engine preferences
  const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(project, ["metronome", "enabled"]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;
    const subs: Terminable[] = [];

    (async () => {
      try {
        const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
          onStatusUpdate: setStatus,
        });

        if (!mounted) return;

        setAudioContext(ctx);

        // Create a synth instrument so MIDI notes produce sound on playback.
        // With no armed captures, recording records nothing — no instrument is
        // auto-created. Vaporisateur is a built-in subtractive synth.
        let audioUnitBox: AudioUnitBox | null = null;
        newProject.editing.modify(() => {
          const result = newProject.api.createInstrument(InstrumentFactories.Vaporisateur);
          audioUnitBox = result.audioUnitBox;
        });

        // Arm the CaptureMidi so it listens to software keyboard and external MIDI
        // devices. Must resolve capture outside the creation transaction (pointer
        // re-routing guideline). armed.setValue(true) is deterministic — setArm()
        // TOGGLES (its second param is exclusivity, not the target state). armed is
        // a runtime observable, not a box field, so no editing.modify() here.
        // Arming enables both live monitoring (hearing notes as you play) and
        // recording (CaptureMidi captures notes into NoteEventBoxes).
        // An unarmed CaptureMidi makes recording a silent no-op (zero armed
        // captures records nothing) — fail loudly instead of falling through.
        const captureOption = audioUnitBox
          ? // Cast defeats TS closure-narrowing to never
            newProject.captureDevices.get(
              (audioUnitBox as AudioUnitBox).address.uuid
            )
          : null;
        if (!captureOption || captureOption.isEmpty()) {
          setInitError(
            "Could not arm the MIDI capture device — recording would capture no notes."
          );
          return;
        }
        captureOption.unwrap().armed.setValue(true);

        setProject(newProject);
        setStatus("Ready!");

        // Subscribe to engine state
        subs.push(
          newProject.engine.isRecording.catchupAndSubscribe(obs => {
            if (mounted) setIsRecording(obs.getValue());
          })
        );
        subs.push(
          newProject.engine.isPlaying.catchupAndSubscribe(obs => {
            if (mounted) setIsPlaying(obs.getValue());
          })
        );
        subs.push(
          newProject.engine.isCountingIn.catchupAndSubscribe(obs => {
            if (mounted) setIsCountingIn(obs.getValue());
          })
        );
      } catch (error) {
        console.error("Init error: " + String(error));
        if (mounted) {
          setInitError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      mounted = false;
      subs.forEach(s => s.terminate());
    };
  }, []);

  // Check MIDI availability
  useEffect(() => {
    setMidiAvailable(MidiDevices.canRequestMidiAccess());
  }, []);

  // Request MIDI permission
  const handleRequestMidi = useCallback(async () => {
    setMidiError(null);
    try {
      await MidiDevices.requestPermission();
    } catch (error) {
      console.error("MIDI permission error: " + String(error));
      setMidiError(
        "MIDI access was denied, so external MIDI controllers are unavailable. " +
        "The on-screen Software Keyboard still works for note input and recording."
      );
    }
    // inputDevices() always includes the Software Keyboard, even without permission
    const devices = MidiDevices.inputDevices();
    setMidiDevices([...devices]);
    if (devices.length > 0) {
      // Default to Software Keyboard
      const softwareKb = devices.find(d => d.id === "software-midi-input");
      setSelectedDeviceId(softwareKb?.id ?? devices[0].id);
    }
  }, []);

  // Subscribe to MIDI note events for real-time display
  useEffect(() => {
    if (midiDevices.length === 0) return;

    const sub = MidiDevices.subscribeMessageEvents((event: MIDIMessageEvent) => {
      if (!event.data || event.data.length < 3) return;
      const [status, note, velocity] = event.data;
      const channel = status & 0x0f;
      const messageType = status & 0xf0;

      // Apply channel filter
      if (filterChannel >= 0 && channel !== filterChannel) return;

      if (messageType === 0x90 && velocity > 0) {
        // Note On
        setActiveNotes(prev => new Set(prev).add(note));
        setRecentNotes(prev => [...prev.slice(-7), { pitch: note, velocity: velocity / 127, timestamp: Date.now() }]);
      } else if (messageType === 0x80 || (messageType === 0x90 && velocity === 0)) {
        // Note Off
        setActiveNotes(prev => {
          const next = new Set(prev);
          next.delete(note);
          return next;
        });
      }
    }, filterChannel >= 0 ? filterChannel : undefined);

    return () => sub.terminate();
  }, [midiDevices, filterChannel]);

  // Software keyboard handlers
  const handleSoftwareNoteOn = useCallback((note: number) => {
    MidiDevices.softwareMIDIInput.sendNoteOn(note, 0.8);
    setActiveNotes(prev => new Set(prev).add(note));
    setRecentNotes(prev => [...prev.slice(-7), { pitch: note, velocity: 0.8, timestamp: Date.now() }]);
  }, []);

  const handleSoftwareNoteOff = useCallback((note: number) => {
    MidiDevices.softwareMIDIInput.sendNoteOff(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  // Recording handlers
  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    setUiError(null);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();

      setRecordedNotes([]);
      project.engine.setPosition(0);
      project.startRecording(useCountIn);
    } catch (error) {
      console.error("Failed to start recording: " + String(error));
      setUiError(
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [project, audioContext, useCountIn]);

  const handleStopRecording = useCallback(() => {
    if (!project) return;
    // MIDI finalization writes NoteEventBoxes on the main thread — there are
    // no sample loaders to wait for (RecordMidi has no worklet), so an
    // immediate stop(true) after stopRecording() is safe. The audio demos'
    // deferred-stop pattern is not needed here.
    project.engine.stopRecording();
    project.engine.stop(true);
  }, [project]);

  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;

    setUiError(null);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      project.engine.stop(true);
      // No timeout/poll net needed: a MIDI-only project has no samples to load
      await project.engine.queryLoadingComplete();
      project.engine.play();
    } catch (error) {
      console.error("Failed to start playback: " + String(error));
      setUiError(
        `Failed to start playback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [project, audioContext]);

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
  }, [project]);

  // Sync BPM
  useEffect(() => {
    if (!project) return;
    project.editing.modify(() => { project.timelineBox.bpm.setValue(bpm); });
  }, [project, bpm]);

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PIANO_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">MIDI — Capture &amp; Step Entry · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              MIDI RECORDING
            </h1>
            <p className="mc-intro">
              Record MIDI notes with device selection, an on-screen keyboard, and step
              recording. Play an external MIDI controller or the software keyboard
              (<code>MidiDevices.softwareMIDIInput</code>) — notes reach the recording
              engine either way. Step recording enters notes one at a time, without a
              real-time performance.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                <strong>Initialization failed:</strong> {initError}
              </Callout.Text>
            </Callout.Root>
          ) : !project ? (
            <Text align="center" color="gray">{status}</Text>
          ) : (
            <>
              {/* MIDI Device Setup */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">MIDI Devices</Text>

                  {midiError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{midiError}</Callout.Text>
                    </Callout.Root>
                  )}

                  {!midiAvailable ? (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>
                        WebMIDI is not available in this browser. The on-screen Software Keyboard
                        will still work for note input.
                      </Callout.Text>
                    </Callout.Root>
                  ) : midiDevices.length === 0 ? (
                    <Flex direction="column" gap="3" align="center">
                      <Text size="2" color="gray">
                        Request MIDI access to enumerate connected devices.
                      </Text>
                      <Button onClick={handleRequestMidi} color="amber" size="2" variant="soft">
                        Request MIDI Access
                      </Button>
                    </Flex>
                  ) : (
                    <Flex gap="4" wrap="wrap" align="end">
                      <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 200 }}>
                        <Text size="2" weight="medium">Input Device:</Text>
                        <Select.Root value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                          <Select.Trigger placeholder="Select MIDI input..." />
                          <Select.Content>
                            {midiDevices.map(device => (
                              <Select.Item key={device.id} value={device.id}>
                                {device.name || device.id}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Root>
                      </Flex>

                      <Flex direction="column" gap="1">
                        <Text size="2" weight="medium">Channel Filter:</Text>
                        <Select.Root
                          value={filterChannel.toString()}
                          onValueChange={v => setFilterChannel(Number(v))}
                        >
                          <Select.Trigger style={{ width: 110 }} />
                          <Select.Content>
                            <Select.Item value="-1">All</Select.Item>
                            {Array.from({ length: 16 }, (_, i) => (
                              <Select.Item key={i} value={i.toString()}>Ch {i + 1}</Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Root>
                      </Flex>

                      <Badge color="green" size="1">
                        {midiDevices.length} device{midiDevices.length !== 1 ? "s" : ""}
                      </Badge>
                    </Flex>
                  )}
                </Flex>
              </Card>

              {/* Setup */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">Setup</Text>
                  <Flex gap="4" wrap="wrap" align="center">
                    <BpmControl value={bpm} onChange={setBpm} disabled={isRecording} />
                    <RecordingPreferences
                      useCountIn={useCountIn}
                      onUseCountInChange={setUseCountIn}
                      metronomeEnabled={metronomeEnabled}
                      onMetronomeEnabledChange={setMetronomeEnabled}
                    />
                  </Flex>
                </Flex>
              </Card>

              {/* On-Screen Keyboard */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">Software Keyboard</Text>
                  <Text size="2" color="gray">
                    Click keys to send MIDI notes via <Code size="1">MidiDevices.softwareMIDIInput</Code>.
                    These notes are captured by the recording engine just like external MIDI input.
                  </Text>
                  <Flex justify="center" style={{ overflow: "auto", padding: "8px 0" }}>
                    <PianoKeyboard
                      activeNotes={activeNotes}
                      onNoteOn={handleSoftwareNoteOn}
                      onNoteOff={handleSoftwareNoteOff}
                      disabled={false}
                    />
                  </Flex>
                  <NoteDisplay notes={recentNotes.slice(-8)} recordedNotes={recordedNotes} />
                </Flex>
              </Card>

              {/* Record & Playback */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">Record &amp; Playback</Text>

                  <Callout.Root color="amber">
                    <Callout.Text>
                      Press <strong>Record</strong> then play notes on the keyboard above.
                      A Vaporisateur synth is created at startup so MIDI notes produce sound on playback.
                      After stopping, press <strong>Play</strong> to hear the recorded notes.
                    </Callout.Text>
                  </Callout.Root>

                  <Flex gap="3" wrap="wrap" justify="center">
                    <Button
                      onClick={handleStartRecording}
                      color="red"
                      size="3"
                      variant="solid"
                      disabled={isRecording || isCountingIn || isPlaying}
                    >
                      {isCountingIn ? "Count-in..." : "Record"}
                    </Button>
                    <Button
                      onClick={handlePlay}
                      disabled={isRecording || isCountingIn || isPlaying}
                      color="green"
                      size="3"
                      variant="solid"
                    >
                      Play
                    </Button>
                    <Button onClick={isRecording ? handleStopRecording : handleStop} color="gray" size="3" variant="solid">
                      Stop
                    </Button>
                  </Flex>

                  <Flex justify="center" gap="2">
                    {isRecording && <Badge color="red" size="2">Recording</Badge>}
                    {isCountingIn && <Badge color="amber" size="2">Count-in</Badge>}
                    {isPlaying && !isRecording && <Badge color="green" size="2">Playing</Badge>}
                    {!isRecording && !isPlaying && !isCountingIn && <Badge color="gray" size="2">Stopped</Badge>}
                  </Flex>

                  {uiError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{uiError}</Callout.Text>
                    </Callout.Root>
                  )}
                </Flex>
              </Card>

              {/* Step Recording */}
              <StepRecordingSection
                project={project}
                onNotesCreated={(notes) => setRecordedNotes(prev => [...prev, ...notes])}
              />

              {/* SDK reference */}
              <section className="mc-anchors">
                <h2 className="mc-anchors-head">SDK reference</h2>

                <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
                  MIDI Device Access:
                </Text>
                <Code size="2" style={CODE_BLOCK_STYLE}>
{`import { MidiDevices } from "@opendaw/studio-core";

await MidiDevices.requestPermission();
const devices = MidiDevices.inputDevices();
// Includes Software Keyboard + external devices`}
                </Code>

                <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
                  Software Keyboard:
                </Text>
                <Code size="2" style={CODE_BLOCK_STYLE}>
{`MidiDevices.softwareMIDIInput.sendNoteOn(60, 0.8);
MidiDevices.softwareMIDIInput.sendNoteOff(60);
MidiDevices.softwareMIDIInput.channel = 0; // 0-15`}
                </Code>

                <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
                  Step Recording (headless):
                </Text>
                <Code size="2" style={CODE_BLOCK_STYLE}>
{`// noteRegionAdapter.optCollection is Option<NoteEventCollectionBoxAdapter>
const collection = noteRegionAdapter.optCollection.unwrap();

project.editing.modify(() => {
  collection.createEvent({
    position: positionPPQN,  // region-local, int
    duration: PPQN.Quarter,
    pitch: 60,               // Middle C
    cent: 0,                 // microtuning, -50..+50
    velocity: 0.8,           // 0-1
    chance: 100,             // playback probability, 0-100
    playCount: 1,
  });
});
engine.setPosition(positionPPQN + PPQN.Quarter);`}
                </Code>
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
