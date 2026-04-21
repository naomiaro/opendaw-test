import React, { useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, EffectFactories } from "@opendaw/studio-core";
import { AudioRegionBox, AudioUnitBox, WerkstattDeviceBox } from "@opendaw/studio-boxes";
import { ScriptCompiler, ScriptDeclaration, type WerkstattDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import {
  SHOWCASE_EFFECTS,
  SINE_GENERATOR_SCRIPT,
  NOISE_GENERATOR_SCRIPT,
  API_EXAMPLES,
} from "@/lib/werkstattScripts";
import type { ShowcaseEffect } from "@/lib/werkstattScripts";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Button,
  Callout, Separator, Slider, Code, SegmentedControl,
  Box as RadixBox,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon, PauseIcon, StopIcon } from "@radix-ui/react-icons";

/** Read Werkstatt parameter values from the adapter's pointerHub. */
function readWerkstattParams(werkstattBox: WerkstattDeviceBox): Record<string, number> {
  const params: Record<string, number> = {};
  const paramPointers = werkstattBox.parameters.pointerHub.incoming();
  for (const pointer of paramPointers) {
    const paramBox = pointer.box as { label?: { getValue(): string }; value?: { getValue(): number } };
    const label = paramBox.label?.getValue?.();
    const value = paramBox.value?.getValue?.();
    if (label != null && value != null) {
      params[label] = value;
    }
  }
  return params;
}

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840
const CONTENT_START = BAR * 24; // bar 25 — where full drum pattern starts

type AudioSource = "drums" | "sine" | "noise";

const App: React.FC = () => {
  // Core state
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [status, setStatus] = useState("Click Start to initialize audio...");
  const [isInitialized, setIsInitialized] = useState(false);

  // Audio source
  const [audioSource, setAudioSource] = useState<AudioSource>("drums");

  // Showcase state
  const [activeEffect, setActiveEffect] = useState<string | null>(null);
  const [effectParams, setEffectParams] = useState<Record<string, number>>({});

  // Refs for SDK objects (not in React state to avoid unnecessary re-renders)
  const audioBoxRef = useRef<AudioUnitBox | null>(null);
  const regionBoxRef = useRef<AudioRegionBox | null>(null);
  const werkstattBoxRef = useRef<WerkstattDeviceBox | null>(null);
  const generatorBoxRef = useRef<WerkstattDeviceBox | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const lastAudioSourceRef = useRef<AudioSource>("drums");
  const activeScriptRef = useRef<string | null>(null);
  const compilerRef = useRef(ScriptCompiler.create({
    headerTag: "werkstatt",
    registryName: "werkstattProcessors",
    functionName: "werkstatt",
  }));

  // Transport hooks
  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  // --- Werkstatt effect management ---
  const loadShowcaseEffect = useCallback(async (effect: ShowcaseEffect) => {
    if (!project || !audioContext || !audioBoxRef.current) return;

    // Delete existing showcase effect
    if (werkstattBoxRef.current) {
      project.editing.modify(() => {
        werkstattBoxRef.current!.delete();
      });
      werkstattBoxRef.current = null;
    }

    // Insert new Werkstatt effect
    let newBox: WerkstattDeviceBox | null = null;
    project.editing.modify(() => {
      const effectBox = project.api.insertEffect(
        audioBoxRef.current!.audioEffects,
        EffectFactories.Werkstatt
      );
      newBox = effectBox as WerkstattDeviceBox;
      newBox.label.setValue(effect.name);
    });

    if (!newBox) return;
    werkstattBoxRef.current = newBox;
    activeScriptRef.current = effect.script;
    setActiveEffect(effect.name);

    try {
      // Compile the script — wraps code, registers in AudioWorklet, writes header
      await compilerRef.current.compile(audioContext, project.editing, newBox, effect.script);
    } catch (err) {
      console.error(`Failed to compile effect "${effect.name}":`, err);
      setStatus(`Failed to load effect: ${err instanceof Error ? err.message : String(err)}`);
      try { project.editing.modify(() => newBox!.delete()); } catch { /* cleanup */ }
      werkstattBoxRef.current = null;
      activeScriptRef.current = null;
      setActiveEffect(null);
      setEffectParams({});
      return;
    }

    // Read parameter values after compilation creates the WerkstattParameterBoxes
    setEffectParams(readWerkstattParams(newBox));
  }, [project, audioContext]);

  const updateEffectParam = useCallback((paramName: string, value: number) => {
    if (!project || !werkstattBoxRef.current) return;

    const paramPointers = werkstattBoxRef.current.parameters.pointerHub.incoming();
    const paramBox = paramPointers.find(
      p => (p.box as { label?: { getValue(): string } }).label?.getValue?.() === paramName
    )?.box as { value?: { setValue(v: number): void } } | undefined;

    if (paramBox?.value) {
      project.editing.modify(() => {
        paramBox.value!.setValue(value);
      });
      setEffectParams(prev => ({ ...prev, [paramName]: value }));
    }
  }, [project]);

  const clearShowcaseEffect = useCallback(() => {
    if (!project || !werkstattBoxRef.current) return;
    project.editing.modify(() => {
      werkstattBoxRef.current!.delete();
    });
    werkstattBoxRef.current = null;
    activeScriptRef.current = null;
    setActiveEffect(null);
    setEffectParams({});
  }, [project]);

  const switchAudioSource = useCallback(async (source: AudioSource) => {
    if (!project || !audioContext || !audioBoxRef.current) return;
    const previousSource = lastAudioSourceRef.current;

    // Remove existing generator
    if (generatorBoxRef.current) {
      try { project.editing.modify(() => generatorBoxRef.current!.delete()); } catch { /* cleanup */ }
      generatorBoxRef.current = null;
    }

    if (source === "sine" || source === "noise") {
      // Mute the drum region so only the generator is heard
      if (regionBoxRef.current) {
        project.editing.modify(() => {
          regionBoxRef.current!.mute.setValue(true);
        });
      }

      // Insert generator Werkstatt
      const script = source === "sine" ? SINE_GENERATOR_SCRIPT : NOISE_GENERATOR_SCRIPT;
      let genBox: WerkstattDeviceBox | null = null;
      project.editing.modify(() => {
        const effectBox = project.api.insertEffect(
          audioBoxRef.current!.audioEffects,
          EffectFactories.Werkstatt
        );
        genBox = effectBox as WerkstattDeviceBox;
        genBox.label.setValue(source === "sine" ? "Sine Generator" : "Noise Generator");
      });

      // Move to index 0 in a separate transaction so it runs before the showcase effect
      if (genBox) {
        project.editing.modify(() => {
          genBox!.index.setValue(0);
        });

        try {
          await compilerRef.current.compile(audioContext, project.editing, genBox, script);
          generatorBoxRef.current = genBox;
        } catch (err) {
          console.error("Failed to compile generator:", err);
          setStatus(`Failed to switch source: ${err instanceof Error ? err.message : String(err)}`);
          try { project.editing.modify(() => genBox!.delete()); } catch { /* cleanup */ }
          // Restore drums
          if (regionBoxRef.current) {
            project.editing.modify(() => regionBoxRef.current!.mute.setValue(false));
          }
          setAudioSource(previousSource);
          return;
        }
      }
    } else {
      // Drums: unmute the region
      if (regionBoxRef.current) {
        project.editing.modify(() => {
          regionBoxRef.current!.mute.setValue(false);
        });
      }
    }

    lastAudioSourceRef.current = source;
    setAudioSource(source);
  }, [project, audioContext]);

  const loadApiExample = useCallback(async (script: string) => {
    if (!project || !audioContext || !audioBoxRef.current) return;

    // Delete existing showcase effect
    if (werkstattBoxRef.current) {
      project.editing.modify(() => {
        werkstattBoxRef.current!.delete();
      });
      werkstattBoxRef.current = null;
    }

    // Insert the API example as a Werkstatt effect
    let newBox: WerkstattDeviceBox | null = null;
    project.editing.modify(() => {
      const effectBox = project.api.insertEffect(
        audioBoxRef.current!.audioEffects,
        EffectFactories.Werkstatt
      );
      newBox = effectBox as WerkstattDeviceBox;
      newBox.label.setValue("API Example");
    });

    if (!newBox) return;
    werkstattBoxRef.current = newBox;
    activeScriptRef.current = script;
    setActiveEffect(null); // Deselect showcase cards

    try {
      await compilerRef.current.compile(audioContext, project.editing, newBox, script);
    } catch (err) {
      console.error("Failed to compile API example:", err);
      setStatus(`Failed to load example: ${err instanceof Error ? err.message : String(err)}`);
      try { project.editing.modify(() => newBox!.delete()); } catch { /* cleanup */ }
      werkstattBoxRef.current = null;
      activeScriptRef.current = null;
      setEffectParams({});
      return;
    }

    // Read params after compilation
    setEffectParams(readWerkstattParams(newBox));
  }, [project, audioContext]);

  // --- Initialization ---
  const handleInit = useCallback(async () => {
    if (isInitialized) return;
    setStatus("Initializing audio engine...");

    try {
      const localAudioBuffers = new Map<string, AudioBuffer>();
      localAudioBuffersRef.current = localAudioBuffers;

      const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
        localAudioBuffers,
        bpm: BPM,
        onStatusUpdate: setStatus,
      });

      setAudioContext(newAudioContext);
      setProject(newProject);

      const settings = newProject.engine.preferences.settings;
      settings.metronome.enabled = false;

      const ext = getAudioExtension();
      setStatus("Loading drums...");
      const tracks = await loadTracksFromFiles(
        newProject,
        newAudioContext,
        [{ name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` }],
        localAudioBuffers,
        { onProgress: (c, t, name) => setStatus(`Loading ${name}...`) }
      );

      if (tracks.length === 0) {
        setStatus("Failed to load audio.");
        return;
      }

      // Find the audio region via the adapter layer
      const firstUnit = newProject.rootBoxAdapter.audioUnits.adapters()[0];
      const firstTrack = firstUnit?.tracks.adapters()[0];
      const regionAdapter = firstTrack?.regions.adapters.values().find(r => r.isAudioRegion());

      if (!regionAdapter) {
        setStatus("No audio region found.");
        return;
      }

      regionBoxRef.current = regionAdapter.box;
      audioBoxRef.current = tracks[0].audioUnitBox;

      // Apply waveformOffset to skip silence (bar 25)
      const waveformOffsetSeconds = PPQN.pulsesToSeconds(CONTENT_START, BPM);
      const playbackDuration = BAR * 16; // 16 bars of drums
      newProject.editing.modify(() => {
        foundRegion!.position.setValue(0);
        foundRegion!.loopOffset.setValue(0);
        foundRegion!.duration.setValue(playbackDuration);
        foundRegion!.loopDuration.setValue(playbackDuration);
        foundRegion!.waveformOffset.setValue(waveformOffsetSeconds);
      });

      // Timeline loop
      newProject.editing.modify(() => {
        newProject.timelineBox.loopArea.from.setValue(0);
        newProject.timelineBox.loopArea.to.setValue(playbackDuration);
        newProject.timelineBox.loopArea.enabled.setValue(true);
        newProject.timelineBox.durationInPulses.setValue(playbackDuration);
      });

      setIsInitialized(true);
      setStatus("Ready");
    } catch (err) {
      console.error("Werkstatt demo initialization failed:", err);
      setStatus(`Initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [isInitialized]);

  // --- Render ---
  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Werkstatt &mdash; Scriptable Audio Effects</Heading>
            <Text size="3" color="gray" align="center">
              Write custom audio effects in JavaScript that run in the AudioWorklet thread.
              Browse pre-built effects or explore the API with runnable code examples.
            </Text>
          </Flex>

          <Callout.Root color="blue">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              Werkstatt scripts run in the AudioWorklet thread. Define a <Code>Processor</Code> class
              with a <Code>process()</Code> method and declare parameters with <Code>// @param</Code> comments.
            </Callout.Text>
          </Callout.Root>

          {!isInitialized ? (
            <Card>
              <Flex direction="column" align="center" gap="3" p="6">
                <Text size="3">{status}</Text>
                <Button size="3" onClick={handleInit}>
                  Start Audio Engine
                </Button>
              </Flex>
            </Card>
          ) : (
            <>
              {/* Audio Source Selector */}
              <Flex gap="3" align="center">
                <Text size="2" weight="bold">Audio Source</Text>
                <SegmentedControl.Root
                  value={audioSource}
                  onValueChange={(v) => switchAudioSource(v as AudioSource)}
                >
                  <SegmentedControl.Item value="drums">Drums</SegmentedControl.Item>
                  <SegmentedControl.Item value="sine">Sine</SegmentedControl.Item>
                  <SegmentedControl.Item value="noise">Noise</SegmentedControl.Item>
                </SegmentedControl.Root>
              </Flex>

              {/* Transport */}
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
                <Text size="2" color="gray" ml="3">
                  Bar {Math.floor(currentPosition / BAR) + 1}, Beat{" "}
                  {Math.floor((currentPosition % BAR) / (BAR / 4)) + 1}
                </Text>
              </Flex>

              {/* Effect Showcase */}
              <Flex direction="column" gap="4">
                <Flex justify="between" align="center">
                  <Heading size="6">Effect Showcase</Heading>
                  {activeEffect && (
                    <Button variant="ghost" size="1" onClick={clearShowcaseEffect}>
                      Clear Effect
                    </Button>
                  )}
                </Flex>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem" }}>
                  {SHOWCASE_EFFECTS.map((effect) => (
                    <Card
                      key={effect.name}
                      style={{
                        cursor: "pointer",
                        border: activeEffect === effect.name
                          ? "2px solid var(--accent-9)"
                          : "2px solid transparent",
                      }}
                      onClick={() => loadShowcaseEffect(effect)}
                    >
                      <Flex direction="column" gap="1" p="2">
                        <Text size="2" weight="bold">{effect.name}</Text>
                        <Text size="1" color="gray">{effect.description}</Text>
                      </Flex>
                    </Card>
                  ))}
                </div>

                {/* Parameter sliders */}
                {Object.keys(effectParams).length > 0 && activeScriptRef.current && (() => {
                  const sections = ScriptDeclaration.parseGroups(activeScriptRef.current!);
                  return (
                    <Card>
                      <Flex direction="column" gap="3" p="3">
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
                                const value = effectParams[decl.label] ?? decl.defaultValue;
                                const step = decl.mapping === "int" ? 1 : (decl.max - decl.min) / 200;
                                return (
                                  <Flex key={decl.label} direction="column" gap="1">
                                    <Flex justify="between">
                                      <Text size="1" color="gray">{decl.label}</Text>
                                      <Text size="1" color="gray">
                                        {decl.mapping === "int" ? value.toFixed(0) : value.toFixed(2)}
                                        {decl.unit ? ` ${decl.unit}` : ""}
                                      </Text>
                                    </Flex>
                                    <Slider
                                      min={decl.min}
                                      max={decl.max}
                                      step={step}
                                      value={[value]}
                                      onValueChange={([v]) => updateEffectParam(decl.label, v)}
                                    />
                                  </Flex>
                                );
                              })}
                          </Flex>
                        ))}
                      </Flex>
                    </Card>
                  );
                })()}

                {/* Code display */}
                {activeEffect && (
                  <Card>
                    <Flex direction="column" gap="2" p="3">
                      <Text size="2" weight="bold">Source Code</Text>
                      <pre style={{
                        margin: 0,
                        padding: "1rem",
                        backgroundColor: "var(--gray-2)",
                        borderRadius: "var(--radius-2)",
                        overflow: "auto",
                        fontSize: "0.8rem",
                        lineHeight: 1.5,
                      }}>
                        <code>{SHOWCASE_EFFECTS.find(e => e.name === activeEffect)?.script}</code>
                      </pre>
                    </Flex>
                  </Card>
                )}
              </Flex>

              <Separator size="4" />

              {/* API Reference */}
              <Flex direction="column" gap="4">
                <Heading size="6">API Reference</Heading>
                <Text size="2" color="gray">
                  Each section below documents a part of the Werkstatt API. Click &ldquo;Load&rdquo; to hear
                  the example applied to the current audio source.
                </Text>

                {API_EXAMPLES.map((example) => (
                  <Card key={example.id}>
                    <Flex direction="column" gap="3" p="3">
                      <Flex justify="between" align="center">
                        <Heading size="4">{example.title}</Heading>
                        {example.script && (
                          <Button
                            variant="soft"
                            size="1"
                            onClick={() => loadApiExample(example.script!)}
                          >
                            Load
                          </Button>
                        )}
                      </Flex>

                      <Text size="2" color="gray">{example.description}</Text>

                      {example.id === "param-declarations" && (
                        <RadixBox>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--gray-6)" }}>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>Declaration</th>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>Type</th>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>Range</th>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>Default</th>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>paramChanged receives</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                ["// @param gain", "unipolar", "0\u20131", "0", "0.0\u20131.0"],
                                ["// @param gain 0.5", "unipolar", "0\u20131", "0.5", "0.0\u20131.0"],
                                ["// @param time 500 1 2000", "linear", "1\u20132000", "500", "raw value"],
                                ["// @param cutoff 1000 20 20000 exp Hz", "exponential", "20\u201320000", "1000", "raw value"],
                                ["// @param steps 4 1 16 int", "integer", "1\u201316", "4", "integer"],
                                ["// @param bypass false", "boolean", "\u2014", "Off", "0 or 1"],
                              ].map(([decl, type, range, def, receives], idx) => (
                                <tr key={idx} style={{ borderBottom: "1px solid var(--gray-4)" }}>
                                  <td style={{ padding: "0.5rem" }}><Code size="1">{decl}</Code></td>
                                  <td style={{ padding: "0.5rem" }}>{type}</td>
                                  <td style={{ padding: "0.5rem" }}>{range}</td>
                                  <td style={{ padding: "0.5rem" }}>{def}</td>
                                  <td style={{ padding: "0.5rem" }}>{receives}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </RadixBox>
                      )}

                      {example.script && (
                        <pre style={{
                          margin: 0,
                          padding: "1rem",
                          backgroundColor: "var(--gray-2)",
                          borderRadius: "var(--radius-2)",
                          overflow: "auto",
                          fontSize: "0.8rem",
                          lineHeight: 1.5,
                        }}>
                          <code>{example.script}</code>
                        </pre>
                      )}
                    </Flex>
                  </Card>
                ))}
              </Flex>
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
