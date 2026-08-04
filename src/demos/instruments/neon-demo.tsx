import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Project, MidiDevices } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { AudioUnitBox, NeonDeviceBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { PianoKeyboard, PIANO_STYLES } from "@/demos/midi/PianoKeyboard";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Flex, Card, Callout, Badge } from "@radix-ui/themes";

/**
 * Main Neon Demo App
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Initializing…");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [neonBox, setNeonBox] = useState<NeonDeviceBox | null>(null);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());

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

        // Create the Neon instrument so MIDI notes produce sound.
        let audioUnitBox: AudioUnitBox | null = null;
        let instrumentBox: NeonDeviceBox | null = null;
        newProject.editing.modify(() => {
          const result = newProject.api.createInstrument(InstrumentFactories.Neon);
          audioUnitBox = result.audioUnitBox;
          instrumentBox = result.instrumentBox as NeonDeviceBox;
        });

        // Resolve the capture AFTER the creation transaction commits (repo rule).
        // armed is a runtime observable — no editing.modify() around setValue.
        const captureOption = audioUnitBox
          ? newProject.captureDevices.get((audioUnitBox as AudioUnitBox).address.uuid)
          : null;
        if (!captureOption || captureOption.isEmpty()) {
          setInitError("Could not arm the MIDI capture — keys would make no sound.");
          return;
        }
        captureOption.unwrap().armed.setValue(true);

        setNeonBox(instrumentBox);
        setProject(newProject);
        setStatus("Ready — play the keyboard");
      } catch (error) {
        console.error("Init error: " + String(error));
        if (mounted) {
          setInitError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleNoteOn = useCallback(async (note: number) => {
    if (audioContext && audioContext.state !== "running") await audioContext.resume();
    MidiDevices.softwareMIDIInput.sendNoteOn(note, 0.8);
    setActiveNotes(prev => new Set(prev).add(note));
  }, [audioContext]);

  const handleNoteOff = useCallback((note: number) => {
    MidiDevices.softwareMIDIInput.sendNoteOff(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PIANO_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Instruments — Phase Distortion · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              NEON
            </h1>
            <p className="mc-intro">
              Play Neon, OpenDAW's Casio CZ-101 phase-distortion synthesizer. Load{" "}
              <code>.syx</code> tone dumps, tweak waves and ring/noise modulation, and
              inspect 8-stage envelopes.
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
            <Card>
              <Flex direction="column" gap="4">
                <Flex align="center" gap="2">
                  <Text size="2" weight="bold" color="gray">Software Keyboard</Text>
                  {neonBox && <Badge color="green" size="1">Neon loaded</Badge>}
                </Flex>
                <Text size="2" color="gray">
                  Click keys to play Neon's built-in init tone (line-1 saw, organ DCA).
                </Text>
                <Flex justify="center" style={{ overflow: "auto", padding: "8px 0" }}>
                  <PianoKeyboard
                    activeNotes={activeNotes}
                    onNoteOn={handleNoteOn}
                    onNoteOff={handleNoteOff}
                    disabled={!project}
                  />
                </Flex>
              </Flex>
            </Card>
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
