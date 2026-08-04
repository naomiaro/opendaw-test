import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Project, MidiDevices } from "@opendaw/studio-core";
import { InstrumentFactories, CzSysex, NeonPreset } from "@opendaw/studio-adapters";
import type { CzTone } from "@opendaw/studio-adapters";
import type { AudioUnitBox, NeonDeviceBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { PianoKeyboard, PIANO_STYLES } from "@/demos/midi/PianoKeyboard";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { NEON_PRESETS } from "./neonPresets";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Flex, Card, Callout, Badge } from "@radix-ui/themes";

// Preset card grid + drop zone — same console-panel card grid as the Apparat demo,
// scoped to this page (ne- prefix).
const PAGE_STYLES = `
.ne-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.ne-card {
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
.ne-card:hover:not(:disabled) { background: var(--mc-panel-hover); }
.ne-card[data-active] { border-color: var(--mc-amber); }
.ne-card:disabled { cursor: default; opacity: 0.55; }
.ne-card:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.ne-card-name { font-family: var(--mc-mono); font-size: 13px; font-weight: 600; }
.ne-card-desc { font-size: 11.5px; line-height: 1.45; color: var(--mc-muted); }
.ne-dropzone {
  padding: 28px 20px;
  border: 2px dashed var(--mc-line-bright);
  border-radius: 4px;
  text-align: center;
  cursor: pointer;
  background: var(--mc-bg);
  transition: border-color 160ms ease, background 160ms ease;
}
.ne-dropzone[data-active] {
  border-color: var(--mc-amber);
  background: rgba(232, 163, 61, 0.05);
}
`;

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
  const [activePatch, setActivePatch] = useState("Init");
  const [syxError, setSyxError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const suppressCustomRef = useRef(false); // Task 4 reads this to skip "Custom" during preset apply
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const applyTone = useCallback((tone: CzTone, label: string) => {
    if (!project || !neonBox) return;
    // Deliberately through both codec directions: the applied patch is the projection
    // real hardware would receive, and encode/decode are exercised on every click.
    const roundTripped = CzSysex.decode(CzSysex.encode(tone));
    suppressCustomRef.current = true;
    project.editing.modify(() => NeonPreset.apply(neonBox, roundTripped));
    suppressCustomRef.current = false;
    setActivePatch(label);
    setSyxError(null);
  }, [project, neonBox]);

  const handleSyxFile = useCallback(async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!CzSysex.isToneDump(bytes)) {
      console.log(`Neon demo: rejected ${file.name} — not a CZ-101 tone dump`);
      setSyxError(`"${file.name}" is not a CZ-101 tone dump (.syx single-tone format).`);
      return;
    }
    applyTone(CzSysex.decode(bytes), `Imported: ${file.name}`);
  }, [applyTone]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleSyxFile(file);
  }, [handleSyxFile]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleSyxFile(file);
    e.target.value = "";
  }, [handleSyxFile]);

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PIANO_STYLES}</style>
      <style>{PAGE_STYLES}</style>
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

          {project && (
            <Card>
              <Flex direction="column" gap="4">
                <Flex align="center" justify="between">
                  <Text size="2" weight="bold" color="gray">Presets</Text>
                  <Badge color="amber" size="1">{activePatch}</Badge>
                </Flex>
                <Text size="2" color="gray">
                  Every click round-trips the tone through <code>CzSysex.encode</code> /{" "}
                  <code>CzSysex.decode</code> before applying it to Neon.
                </Text>
                <div className="ne-grid">
                  {NEON_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className="ne-card"
                      data-active={activePatch === preset.name || undefined}
                      onClick={() => applyTone(preset.tone, preset.name)}
                      disabled={!neonBox}
                    >
                      <span className="ne-card-name">{preset.name}</span>
                      <span className="ne-card-desc">{preset.description}</span>
                    </button>
                  ))}
                </div>
              </Flex>
            </Card>
          )}

          {project && (
            <Card>
              <Flex direction="column" gap="3">
                <Text size="2" weight="bold" color="gray">Load .syx Tone Dump</Text>
                <Text size="2" color="gray">
                  Drop a Casio CZ-101 single-tone <code>.syx</code> file, or click to browse.
                  Bank dumps are read as their last tone if the sysex framing matches;
                  anything else is rejected.
                </Text>
                <div
                  className="ne-dropzone"
                  data-active={isDragOver || undefined}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Text size="2" color="gray">Drop .syx file here or click to browse</Text>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".syx"
                  style={{ display: "none" }}
                  onChange={handleFileInputChange}
                />
                {syxError && (
                  <Callout.Root color="red" role="alert" size="1">
                    <Callout.Text>{syxError}</Callout.Text>
                  </Callout.Root>
                )}
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
