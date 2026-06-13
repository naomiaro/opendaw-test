import React, { useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, EffectFactories } from "@opendaw/studio-core";
import { AudioRegionBox, AudioUnitBox, WerkstattDeviceBox } from "@opendaw/studio-boxes";
import { ScriptCompiler, ScriptDeclaration } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import { CONSOLE_STYLES, CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import {
  SHOWCASE_EFFECTS,
  SINE_GENERATOR_SCRIPT,
  NOISE_GENERATOR_SCRIPT,
  API_EXAMPLES,
} from "@/lib/werkstattScripts";
import type { ShowcaseEffect } from "@/lib/werkstattScripts";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Text, Flex, Card, Button,
  Callout, Separator, Slider, Code, SegmentedControl,
} from "@radix-ui/themes";
import { PlayIcon, PauseIcon, StopIcon } from "@radix-ui/react-icons";

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

// Showcase cards are real <button>s (keyboard focus + activation for free),
// styled as console panels. The grid auto-fills so it never clips at 390px.
const PAGE_STYLES = `
.wk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.wk-card {
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
.wk-card:hover:not(:disabled) { background: var(--mc-panel-hover); }
.wk-card[data-active] { border-color: var(--mc-amber); }
.wk-card:disabled { cursor: default; opacity: 0.55; }
.wk-card:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.wk-card-name { font-family: var(--mc-mono); font-size: 13px; font-weight: 600; }
.wk-card-desc { font-size: 11.5px; line-height: 1.45; color: var(--mc-muted); }
.wk-table-wrap { overflow-x: auto; }
.wk-table { width: 100%; border-collapse: collapse; }
.wk-table th {
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
.wk-table td {
  padding: 8px;
  border-bottom: 1px solid var(--mc-line);
  font-size: 12.5px;
  color: var(--mc-muted);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .wk-card { transition: none; }
}
`;

const App: React.FC = () => {
  // Core state
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [status, setStatus] = useState("Click Start to initialize audio...");
  const [initError, setInitError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Audio source
  const [audioSource, setAudioSource] = useState<AudioSource>("drums");

  // Showcase state. activeEffect highlights a showcase card; hasLoadedEffect
  // also covers API examples (which deselect the cards) so Clear Effect stays
  // available for any loaded Werkstatt effect.
  const [activeEffect, setActiveEffect] = useState<string | null>(null);
  const [hasLoadedEffect, setHasLoadedEffect] = useState(false);
  const [effectParams, setEffectParams] = useState<Record<string, number>>({});

  // Post-init action errors (compile failures, source-switch failures) — rendered
  // as a red callout near the showcase grid; cleared when the next action starts.
  const [actionError, setActionError] = useState<string | null>(null);

  // In-flight guard: loadShowcaseEffect / loadApiExample / switchAudioSource are
  // async (compile awaits addModule) — without this, a double-click inserts two
  // Werkstatt boxes and the slower compile wins the refs. The ref is the guard
  // (state updates aren't synchronous); the state drives the disabled UI.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  // Refs for SDK objects (not in React state to avoid unnecessary re-renders)
  const audioBoxRef = useRef<AudioUnitBox | null>(null);
  const regionBoxRef = useRef<AudioRegionBox | null>(null);
  const werkstattBoxRef = useRef<WerkstattDeviceBox | null>(null);
  const generatorBoxRef = useRef<WerkstattDeviceBox | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const lastAudioSourceRef = useRef<AudioSource>("drums");
  const activeScriptRef = useRef<string | null>(null);
  const initStartedRef = useRef(false);
  // Lazy-init: ScriptCompiler.create() runs once, not on every render.
  const compilerRef = useRef<ReturnType<typeof ScriptCompiler.create> | null>(null);
  if (!compilerRef.current) {
    compilerRef.current = ScriptCompiler.create({
      headerTag: "werkstatt",
      registryName: "werkstattProcessors",
      functionName: "werkstatt",
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

  // --- Werkstatt effect management ---
  const loadShowcaseEffect = useCallback(async (effect: ShowcaseEffect) => {
    if (!project || !audioContext || !audioBoxRef.current || busyRef.current) return;
    beginAction();
    try {
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
        await compilerRef.current!.compile(audioContext, project.editing, newBox, effect.script);
      } catch (err) {
        console.error(`Failed to compile effect "${effect.name}": ` + String(err));
        setActionError(`Failed to load effect "${effect.name}": ${err instanceof Error ? err.message : String(err)}`);
        try { project.editing.modify(() => newBox!.delete()); } catch { /* cleanup */ }
        werkstattBoxRef.current = null;
        activeScriptRef.current = null;
        setActiveEffect(null);
        setHasLoadedEffect(false);
        setEffectParams({});
        return;
      }

      // Read parameter values after compilation creates the WerkstattParameterBoxes
      setHasLoadedEffect(true);
      setEffectParams(readWerkstattParams(newBox));
    } finally {
      endAction();
    }
  }, [project, audioContext, beginAction, endAction]);

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
    if (!project || !werkstattBoxRef.current || busyRef.current) return;
    project.editing.modify(() => {
      werkstattBoxRef.current!.delete();
    });
    werkstattBoxRef.current = null;
    activeScriptRef.current = null;
    setActiveEffect(null);
    setHasLoadedEffect(false);
    setEffectParams({});
    setActionError(null);
  }, [project]);

  const switchAudioSource = useCallback(async (source: AudioSource) => {
    if (!project || !audioContext || !audioBoxRef.current || busyRef.current) return;
    beginAction();
    try {
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

        // Insert generator Werkstatt at chain position 0 so it runs before the
        // showcase effect. insertEffect's insertIndex routes through
        // IndexedBox.insertOrder, which renumbers an already-loaded showcase
        // effect (a raw index.setValue(0) would leave two devices at index 0).
        const script = source === "sine" ? SINE_GENERATOR_SCRIPT : NOISE_GENERATOR_SCRIPT;
        let genBox: WerkstattDeviceBox | null = null;
        project.editing.modify(() => {
          const effectBox = project.api.insertEffect(
            audioBoxRef.current!.audioEffects,
            EffectFactories.Werkstatt,
            0
          );
          genBox = effectBox as WerkstattDeviceBox;
          genBox.label.setValue(source === "sine" ? "Sine Generator" : "Noise Generator");
        });

        if (genBox) {
          try {
            await compilerRef.current!.compile(audioContext, project.editing, genBox, script);
            generatorBoxRef.current = genBox;
          } catch (err) {
            console.error("Failed to compile generator: " + String(err));
            setActionError(`Failed to switch source: ${err instanceof Error ? err.message : String(err)}`);
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
    } finally {
      endAction();
    }
  }, [project, audioContext, beginAction, endAction]);

  const loadApiExample = useCallback(async (script: string) => {
    if (!project || !audioContext || !audioBoxRef.current || busyRef.current) return;
    beginAction();
    try {
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
        await compilerRef.current!.compile(audioContext, project.editing, newBox, script);
      } catch (err) {
        console.error("Failed to compile API example: " + String(err));
        setActionError(`Failed to load example: ${err instanceof Error ? err.message : String(err)}`);
        try { project.editing.modify(() => newBox!.delete()); } catch { /* cleanup */ }
        werkstattBoxRef.current = null;
        activeScriptRef.current = null;
        setHasLoadedEffect(false);
        setEffectParams({});
        return;
      }

      // Read params after compilation
      setHasLoadedEffect(true);
      setEffectParams(readWerkstattParams(newBox));
    } finally {
      endAction();
    }
  }, [project, audioContext, beginAction, endAction]);

  // --- Initialization ---
  const handleInit = useCallback(async () => {
    if (isInitialized || initStartedRef.current) return;
    initStartedRef.current = true;
    setInitError(null);
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
        { onProgress: (_current, _total, name) => setStatus(`Loading ${name}...`) }
      );

      if (tracks.length === 0) {
        throw new Error("Failed to load audio.");
      }

      // Find the audio region via the adapter layer
      const firstUnit = newProject.rootBoxAdapter.audioUnits.adapters()[0];
      const firstTrack = firstUnit?.tracks.values()[0];
      const regionAdapter = firstTrack?.regions.adapters.values().find(r => r.isAudioRegion());

      if (!regionAdapter) {
        throw new Error("No audio region found.");
      }

      regionBoxRef.current = regionAdapter.box;
      audioBoxRef.current = tracks[0].audioUnitBox;

      // Apply waveformOffset to skip silence (bar 25)
      const waveformOffsetSeconds = PPQN.pulsesToSeconds(CONTENT_START, BPM);
      const playbackDuration = BAR * 16; // 16 bars of drums
      const regionBox = regionBoxRef.current!;
      newProject.editing.modify(() => {
        regionBox.position.setValue(0);
        regionBox.loopOffset.setValue(0);
        regionBox.duration.setValue(playbackDuration);
        regionBox.loopDuration.setValue(playbackDuration);
        regionBox.waveformOffset.setValue(waveformOffsetSeconds);
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
      console.error("Werkstatt demo initialization failed: " + String(err));
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
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Header */}
          <div>
            <div className="mc-kicker">Werkstatt &mdash; Scriptable Audio Effects &middot; OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              WERKSTATT
            </h1>
            <p className="mc-intro">
              Write an audio effect in JavaScript and hear it run inside the engine. A
              Werkstatt device wraps a user script &mdash; a <code>Processor</code> class
              with a <code>process()</code> method, parameters declared as{" "}
              <code>// @param</code> comments &mdash; compiles it with{" "}
              <code>ScriptCompiler</code>, and executes it on the AudioWorklet thread. Load
              a pre-built effect over the drum loop, tweak its parameters during playback,
              or work through the API reference below with runnable examples.
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
              {/* Transport & audio source */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Transport &amp; Source
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
                    <Flex
                      gap="3"
                      align="center"
                      ml="auto"
                      style={busy ? { opacity: 0.55, pointerEvents: "none" } : undefined}
                      aria-disabled={busy || undefined}
                    >
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
                  </Flex>
                </Flex>
              </Card>

              {/* Effect Showcase */}
              <Card>
                <Flex direction="column" gap="4">
                  <Flex justify="between" align="center">
                    <Text size="2" weight="bold" color="gray">
                      Effect Showcase
                    </Text>
                    {hasLoadedEffect && (
                      <Button variant="ghost" size="1" onClick={clearShowcaseEffect} disabled={busy}>
                        Clear Effect
                      </Button>
                    )}
                  </Flex>
                  <Separator size="4" />

                  {actionError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{actionError}</Callout.Text>
                    </Callout.Root>
                  )}

                  <div className="wk-grid">
                    {SHOWCASE_EFFECTS.map((effect) => (
                      <button
                        key={effect.name}
                        type="button"
                        className="wk-card"
                        data-active={activeEffect === effect.name || undefined}
                        onClick={() => loadShowcaseEffect(effect)}
                        disabled={busy}
                      >
                        <span className="wk-card-name">{effect.name}</span>
                        <span className="wk-card-desc">{effect.description}</span>
                      </button>
                    ))}
                  </div>

                  {/* Parameter sliders */}
                  {Object.keys(effectParams).length > 0 && activeScriptRef.current && (() => {
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
                                  const value = effectParams[decl.label] ?? decl.defaultValue;
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
                                        onValueChange={([v]) => updateEffectParam(decl.label, v)}
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
                  {activeEffect && (
                    <div>
                      <Text size="2" weight="bold">Source Code</Text>
                      <Code size="2" style={CODE_BLOCK_STYLE}>
                        {SHOWCASE_EFFECTS.find(e => e.name === activeEffect)?.script}
                      </Code>
                    </div>
                  )}
                </Flex>
              </Card>

              {/* API Reference */}
              <Flex direction="column" gap="4">
                <div>
                  <Text size="2" weight="bold" color="gray">
                    API Reference
                  </Text>
                  <Text as="p" size="2" color="gray" mt="2">
                    Each section below documents a part of the Werkstatt API. Load an example
                    to hear it applied to the current audio source.
                  </Text>
                </div>

                {API_EXAMPLES.map((example) => (
                  <Card key={example.id}>
                    <Flex direction="column" gap="3">
                      <Flex justify="between" align="center" gap="3">
                        <Text size="3" weight="bold">{example.title}</Text>
                        {example.script && (
                          <Button
                            variant="soft"
                            size="1"
                            onClick={() => loadApiExample(example.script!)}
                            disabled={busy}
                          >
                            Load
                          </Button>
                        )}
                      </Flex>

                      <Text size="2" color="gray">{example.description}</Text>

                      {example.id === "param-declarations" && (
                        <div className="wk-table-wrap">
                          <table className="wk-table">
                            <thead>
                              <tr>
                                <th>Declaration</th>
                                <th>Type</th>
                                <th>Range</th>
                                <th>Default</th>
                                <th>paramChanged receives</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                ["// @param gain", "unipolar", "0–1", "0", "0.0–1.0"],
                                ["// @param gain 0.5", "unipolar", "0–1", "0.5", "0.0–1.0"],
                                ["// @param time 500 1 2000", "linear", "1–2000", "500", "raw value"],
                                ["// @param cutoff 1000 20 20000 exp Hz", "exponential", "20–20000", "1000", "raw value"],
                                ["// @param steps 4 1 16 int", "integer", "1–16", "4", "integer"],
                                ["// @param bypass false", "boolean", "—", "Off", "0 or 1"],
                              ].map(([decl, type, range, def, receives], idx) => (
                                <tr key={idx}>
                                  <td><Code size="1">{decl}</Code></td>
                                  <td>{type}</td>
                                  <td>{range}</td>
                                  <td>{def}</td>
                                  <td>{receives}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {example.script && (
                        <Code size="2" style={CODE_BLOCK_STYLE}>{example.script}</Code>
                      )}
                    </Flex>
                  </Card>
                ))}
              </Flex>

              {/* SDK reference */}
              <section className="mc-anchors">
                <h2 className="mc-anchors-head">SDK reference</h2>
                <p>
                  A Werkstatt box is inserted like any other effect, but the script only runs
                  after <code>ScriptCompiler.compile()</code> wraps it, registers it on the
                  AudioWorklet, and writes a <code>// @werkstatt</code> header back into the
                  box&apos;s code field &mdash; the processor never loads headerless code. The
                  sine and noise generators insert at chain position 0
                  (<code>insertEffect</code>&apos;s third argument) so they run before the
                  showcase effect.
                </p>

                <Code size="2" style={CODE_BLOCK_STYLE}>
                  {`// Insert (optionally at a chain position), then compile OUTSIDE the transaction
let box: WerkstattDeviceBox;
project.editing.modify(() => {
  box = project.api.insertEffect(
    audioUnitBox.audioEffects,
    EffectFactories.Werkstatt,
    0 // insertIndex — renumbers existing devices in the chain
  ) as WerkstattDeviceBox;
  box.label.setValue("Sine Generator");
});
await compiler.compile(audioContext, project.editing, box, script);`}
                </Code>

                <p>
                  Each <code>// @param</code> declaration becomes a{" "}
                  <code>WerkstattParameterBox</code> child &mdash; an automatable Float32 field
                  the sliders above write inside <code>editing.modify()</code>. The engine
                  validates every output block: a NaN or a sample beyond &plusmn;1000 (~60 dB)
                  silences the device and reports the error back to the client.
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
