import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { Project, MidiDevices } from "@opendaw/studio-core";
import { NoteSignal, InstrumentFactories } from "@opendaw/studio-adapters";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { NoteEventBox, NoteEventCollectionBox, NoteRegionBox, AudioUnitBox } from "@opendaw/studio-boxes";
import type { TrackBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "@/hooks/useEnginePreference";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Button,
  Flex,
  Card,
  Checkbox,
  Select,
  Callout,
  Separator,
  Badge,
  TextField,
  Slider,
  Code,
} from "@radix-ui/themes";

// Piano key layout constants
const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11]; // C, D, E, F, G, A, B semitone offsets
const BLACK_KEY_OFFSETS = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A# semitone offsets
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

// Octave range for the on-screen keyboard
const KEYBOARD_START_OCTAVE = 3; // C3
const KEYBOARD_OCTAVES = 3; // C3 to B5
const KEYBOARD_START_NOTE = KEYBOARD_START_OCTAVE * 12 + 12; // MIDI note 48 (C3)
const KEYBOARD_END_NOTE = KEYBOARD_START_NOTE + KEYBOARD_OCTAVES * 12; // MIDI note 84 (C6)

type ActiveNote = {
  pitch: number;
  velocity: number;
  timestamp: number;
};

type RecordedNote = {
  pitch: number;
  velocity: number;
  position: number; // PPQN
  duration: number; // PPQN
};

/**
 * PianoKeyboard component - on-screen MIDI keyboard
 */
const PianoKeyboard: React.FC<{
  activeNotes: Set<number>;
  onNoteOn: (note: number) => void;
  onNoteOff: (note: number) => void;
  disabled?: boolean;
}> = ({ activeNotes, onNoteOn, onNoteOff, disabled }) => {
  const whiteKeyWidth = 36;
  const blackKeyWidth = 22;
  const whiteKeyHeight = 120;
  const blackKeyHeight = 75;

  // Build list of white keys in range
  const whiteKeys: number[] = [];
  for (let note = KEYBOARD_START_NOTE; note < KEYBOARD_END_NOTE; note++) {
    if (WHITE_KEYS.includes(note % 12)) {
      whiteKeys.push(note);
    }
  }

  const totalWidth = whiteKeys.length * whiteKeyWidth;

  // Map white key index for positioning
  const whiteKeyIndex = (note: number) => whiteKeys.indexOf(note);

  return (
    <div
      style={{
        position: "relative",
        width: totalWidth,
        height: whiteKeyHeight,
        userSelect: "none",
        margin: "0 auto",
      }}
    >
      {/* White keys */}
      {whiteKeys.map((note) => (
        <div
          key={note}
          onMouseDown={() => !disabled && onNoteOn(note)}
          onMouseUp={() => !disabled && onNoteOff(note)}
          onMouseLeave={() => !disabled && activeNotes.has(note) && onNoteOff(note)}
          style={{
            position: "absolute",
            left: whiteKeyIndex(note) * whiteKeyWidth,
            top: 0,
            width: whiteKeyWidth - 1,
            height: whiteKeyHeight,
            background: activeNotes.has(note) ? "#6366f1" : "#f0f0f0",
            border: "1px solid #999",
            borderRadius: "0 0 4px 4px",
            cursor: disabled ? "default" : "pointer",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 4,
            transition: "background 0.05s",
          }}
        >
          {note % 12 === 0 && (
            <Text size="1" style={{ color: "#666", fontSize: 9 }}>
              {noteName(note)}
            </Text>
          )}
        </div>
      ))}

      {/* Black keys */}
      {whiteKeys.map((note, i) => {
        const nextSemitone = note + 1;
        if (nextSemitone >= KEYBOARD_END_NOTE) return null;
        if (!BLACK_KEY_OFFSETS.includes(nextSemitone % 12)) return null;

        return (
          <div
            key={nextSemitone}
            onMouseDown={() => !disabled && onNoteOn(nextSemitone)}
            onMouseUp={() => !disabled && onNoteOff(nextSemitone)}
            onMouseLeave={() => !disabled && activeNotes.has(nextSemitone) && onNoteOff(nextSemitone)}
            style={{
              position: "absolute",
              left: i * whiteKeyWidth + whiteKeyWidth - blackKeyWidth / 2,
              top: 0,
              width: blackKeyWidth,
              height: blackKeyHeight,
              background: activeNotes.has(nextSemitone) ? "#818cf8" : "#333",
              border: "1px solid #111",
              borderRadius: "0 0 3px 3px",
              cursor: disabled ? "default" : "pointer",
              zIndex: 1,
              transition: "background 0.05s",
            }}
          />
        );
      })}
    </div>
  );
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
            <Badge key={`${note.pitch}-${i}`} color="purple" size="1">
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
 * Step Recording Section
 */
const StepRecordingSection: React.FC<{
  project: Project;
  onNotesCreated: (notes: RecordedNote[]) => void;
}> = ({ project, onNotesCreated }) => {
  const [stepEnabled, setStepEnabled] = useState(false);
  const [stepDuration, setStepDuration] = useState<string>("quarter");
  const [stepVelocity, setStepVelocity] = useState(100);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [createdNotes, setCreatedNotes] = useState<RecordedNote[]>([]);

  const durationMap: Record<string, number> = {
    "whole": PPQN.Quarter * 4,
    "half": PPQN.Quarter * 2,
    "quarter": PPQN.Quarter,
    "eighth": PPQN.Quarter / 2,
    "sixteenth": PPQN.Quarter / 4,
  };

  // Track position via animation frame
  useEffect(() => {
    const sub = AnimationFrame.add(() => {
      setCurrentPosition(project.engine.position.getValue());
    });
    return () => sub.terminate();
  }, [project]);

  const handleStepNote = useCallback((note: number) => {
    if (!stepEnabled) return;

    const duration = durationMap[stepDuration] ?? PPQN.Quarter;
    const position = currentPosition;
    const velocity = stepVelocity / 127;

    // Find the "Step Recording" note region via the adapter layer
    const audioUnitAdapters = project.rootBoxAdapter.audioUnits.adapters();
    let eventsCollection: NoteEventCollectionBox | null = null;
    let regionOffset = 0;

    for (const unit of audioUnitAdapters) {
      for (const track of unit.tracks.values()) {
        for (const region of track.regions.adapters) {
          if (region.label === "Step Recording" && !region.isAudioRegion()) {
            const noteBox = region.box as NoteRegionBox;
            const eventsVertex = noteBox.events.targetVertex;
            if (!eventsVertex.isEmpty()) {
              eventsCollection = eventsVertex.unwrap().box as NoteEventCollectionBox;
            }
            regionOffset = noteBox.position.getValue();
            break;
          }
        }
        if (eventsCollection) break;
      }
      if (eventsCollection) break;
    }

    // Create a step recording region if none exists
    if (!eventsCollection) {
      const firstUnit = audioUnitAdapters[0];
      if (!firstUnit) return;
      const firstTrack = firstUnit.tracks.values()[0];
      if (!firstTrack) return;
      const trackBox = firstTrack.box;

      project.editing.modify(() => {
        const collection = NoteEventCollectionBox.create(project.boxGraph, UUID.generate());
        NoteRegionBox.create(project.boxGraph, UUID.generate(), (box: NoteRegionBox) => {
          box.regions.refer(trackBox!.regions);
          box.events.refer(collection.owners);
          box.position.setValue(0);
          box.label.setValue("Step Recording");
        });
      });

      // Re-find the created region via the adapter layer
      for (const unit of project.rootBoxAdapter.audioUnits.adapters()) {
        for (const track of unit.tracks.values()) {
          for (const region of track.regions.adapters) {
            if (region.label === "Step Recording" && !region.isAudioRegion()) {
              const noteBox = region.box as NoteRegionBox;
              const eventsVertex = noteBox.events.targetVertex;
              if (!eventsVertex.isEmpty()) {
                eventsCollection = eventsVertex.unwrap().box as NoteEventCollectionBox;
              }
              regionOffset = noteBox.position.getValue();
              break;
            }
          }
          if (eventsCollection) break;
        }
        if (eventsCollection) break;
      }
    }

    if (!eventsCollection) return;

    project.editing.modify(() => {
      NoteEventBox.create(project.boxGraph, UUID.generate(), (box: NoteEventBox) => {
        box.events.refer(eventsCollection!.events);
        box.position.setValue(Math.max(0, position - regionOffset));
        box.duration.setValue(duration);
        box.pitch.setValue(note);
        box.velocity.setValue(velocity);
      });
    });

    // Advance position
    const newPos = position + duration;
    project.engine.setPosition(newPos);

    const recorded: RecordedNote = { pitch: note, velocity, position, duration };
    setCreatedNotes(prev => [...prev, recorded]);
    onNotesCreated([recorded]);
  }, [project, stepEnabled, stepDuration, stepVelocity, currentPosition, onNotesCreated]);

  return (
    <Card>
      <Flex direction="column" gap="4">
        <Flex justify="between" align="center">
          <Heading size="5">Step Recording</Heading>
          <Badge color={stepEnabled ? "green" : "gray"} size="2">
            {stepEnabled ? "Enabled" : "Disabled"}
          </Badge>
        </Flex>

        <Callout.Root color="blue">
          <Callout.Text>
            Step recording lets you enter notes one at a time at the current playhead position.
            Each note automatically advances the playhead by the selected duration.
            The engine must be <strong>stopped</strong> (not playing) for step recording.
          </Callout.Text>
        </Callout.Root>

        <Flex gap="4" wrap="wrap" align="center">
          <Flex asChild align="center" gap="2">
            <Text as="label" size="2">
              <Checkbox
                checked={stepEnabled}
                onCheckedChange={checked => setStepEnabled(checked === true)}
              />
              Enable step recording
            </Text>
          </Flex>

          <Flex align="center" gap="2">
            <Text size="2" weight="medium">Duration:</Text>
            <Select.Root value={stepDuration} onValueChange={setStepDuration}>
              <Select.Trigger style={{ width: 130 }} />
              <Select.Content>
                <Select.Item value="whole">Whole</Select.Item>
                <Select.Item value="half">Half</Select.Item>
                <Select.Item value="quarter">Quarter</Select.Item>
                <Select.Item value="eighth">Eighth</Select.Item>
                <Select.Item value="sixteenth">16th</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          <Flex align="center" gap="2">
            <Text size="2" weight="medium">Velocity:</Text>
            <Slider
              value={[stepVelocity]}
              onValueChange={values => setStepVelocity(values[0])}
              min={1}
              max={127}
              step={1}
              style={{ width: 100 }}
            />
            <Text size="1" color="gray" style={{ fontFamily: "monospace", minWidth: 30 }}>
              {stepVelocity}
            </Text>
          </Flex>
        </Flex>

        {stepEnabled && (
          <>
            <Text size="2" color="gray">
              Position: {PPQN.pulsesToSeconds(currentPosition, project.timelineBox.bpm.getValue()).toFixed(2)}s
              ({currentPosition} PPQN)
            </Text>
            <PianoKeyboard
              activeNotes={new Set()}
              onNoteOn={handleStepNote}
              onNoteOff={() => {}}
            />
            {createdNotes.length > 0 && (
              <Text size="1" color="gray">
                {createdNotes.length} step note{createdNotes.length !== 1 ? "s" : ""} created
              </Text>
            )}
          </>
        )}
      </Flex>
    </Card>
  );
};

/**
 * Main MIDI Recording Demo App
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // MIDI state
  const [midiAvailable, setMidiAvailable] = useState(false);
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
  const [countInBars, setCountInBars] = useEnginePreference(project, ["recording", "countInBars"]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
          onStatusUpdate: setStatus,
        });

        if (!mounted) return;

        setAudioContext(ctx);

        // Create a synth instrument so MIDI notes produce sound on playback.
        // startRecording() auto-creates a Tape (audio-only) if no instruments exist,
        // which can't play back MIDI. Vaporisateur is a built-in subtractive synth.
        let audioUnitBox: any = null;
        newProject.editing.modify(() => {
          const result = newProject.api.createInstrument(InstrumentFactories.Vaporisateur);
          audioUnitBox = result.audioUnitBox;
        });

        // Arm the CaptureMidi so it listens to software keyboard and external MIDI
        // devices. Must resolve capture outside the creation transaction (pointer
        // re-routing guideline). Arming enables both live monitoring (hearing notes
        // as you play) and recording (CaptureMidi captures notes into NoteEventBoxes).
        if (audioUnitBox) {
          const captureOption = newProject.captureDevices.get(audioUnitBox.address.uuid);
          if (!captureOption.isEmpty()) {
            newProject.captureDevices.setArm(captureOption.unwrap(), true);
          }
        }

        setProject(newProject);
        setStatus("Ready!");

        // Subscribe to engine state
        newProject.engine.isRecording.catchupAndSubscribe(obs => {
          if (mounted) setIsRecording(obs.getValue());
        });
        newProject.engine.isPlaying.catchupAndSubscribe(obs => {
          if (mounted) setIsPlaying(obs.getValue());
        });
        newProject.engine.isCountingIn.catchupAndSubscribe(obs => {
          if (mounted) setIsCountingIn(obs.getValue());
        });
      } catch (error) {
        console.error("Init error:", error);
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => { mounted = false; };
  }, []);

  // Check MIDI availability
  useEffect(() => {
    setMidiAvailable(MidiDevices.canRequestMidiAccess());
  }, []);

  // Request MIDI permission
  const handleRequestMidi = useCallback(async () => {
    try {
      await MidiDevices.requestPermission();
      const devices = MidiDevices.inputDevices();
      setMidiDevices([...devices]);
      if (devices.length > 0) {
        // Default to Software Keyboard
        const softwareKb = devices.find(d => d.id === "software-midi-input");
        setSelectedDeviceId(softwareKb?.id ?? devices[0].id);
      }
    } catch (error) {
      console.error("MIDI permission error:", error);
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
    if (audioContext.state === "suspended") await audioContext.resume();

    setRecordedNotes([]);
    project.engine.setPosition(0);
    project.startRecording(useCountIn);
  }, [project, audioContext, useCountIn]);

  const handleStopRecording = useCallback(() => {
    if (!project) return;
    // Use stopRecording() to keep the engine alive while Recording.ts
    // processes the isRecording=false state change and creates final
    // NoteEventBoxes. MIDI finalization is synchronous (no audio to write),
    // so one animation frame is sufficient for the observable chain.
    project.engine.stopRecording();
    requestAnimationFrame(() => project.engine.stop(true));
  }, [project]);

  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();
    project.engine.stop(true);
    await project.engine.queryLoadingComplete();
    project.engine.play();
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

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="purple" radius="large">
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <Heading size="8">MIDI Recording Demo</Heading>
            <Text size="3" color="gray">{status}</Text>
          </Flex>
        </Container>
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="purple" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <BackLink />

          <Flex direction="column" align="center" gap="2">
            <Heading size="8">MIDI Recording Demo</Heading>
            <Text size="3" color="gray">
              Record MIDI notes with device selection, on-screen keyboard, and step recording
            </Text>
          </Flex>

          <Callout.Root color="purple">
            <Callout.Text>
              This demo demonstrates OpenDAW's MIDI recording capabilities. Use an external MIDI
              controller or the on-screen keyboard (via <strong>MidiDevices.softwareMIDIInput</strong>)
              to input notes. Step recording mode lets you enter notes one at a time without real-time
              performance.
            </Callout.Text>
          </Callout.Root>

          {/* MIDI Device Setup */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">MIDI Devices</Heading>

              {!midiAvailable ? (
                <Callout.Root color="red">
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
                  <Button onClick={handleRequestMidi} color="purple" size="2" variant="soft">
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
              <Heading size="5">Setup</Heading>
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
              <Heading size="5">Software Keyboard</Heading>
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
              <Heading size="5">Record & Playback</Heading>

              <Callout.Root color="orange">
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
            </Flex>
          </Card>

          {/* Step Recording */}
          <StepRecordingSection
            project={project}
            onNotesCreated={(notes) => setRecordedNotes(prev => [...prev, ...notes])}
          />

          {/* API Reference */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="5">API Reference</Heading>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">MIDI Device Access:</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`import { MidiDevices } from "@opendaw/studio-core";

await MidiDevices.requestPermission();
const devices = MidiDevices.inputDevices();
// Includes Software Keyboard + external devices`}
                </Code>

                <Text size="2" weight="bold" style={{ marginTop: 8 }}>Software Keyboard:</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`MidiDevices.softwareMIDIInput.sendNoteOn(60, 0.8);
MidiDevices.softwareMIDIInput.sendNoteOff(60);
MidiDevices.softwareMIDIInput.channel = 0; // 0-15`}
                </Code>

                <Text size="2" weight="bold" style={{ marginTop: 8 }}>Step Recording (headless):</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`import { NoteEventBox, NoteEventCollectionBox }
  from "@opendaw/studio-boxes";

project.editing.modify(() => {
  NoteEventBox.create(boxGraph, UUID.generate(), box => {
    box.events.refer(collection.events);
    box.position.setValue(positionPPQN);
    box.duration.setValue(PPQN.Quarter);
    box.pitch.setValue(60);  // Middle C
    box.velocity.setValue(0.8);
  });
});
engine.setPosition(positionPPQN + PPQN.Quarter);`}
                </Code>
              </Flex>
            </Flex>
          </Card>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
