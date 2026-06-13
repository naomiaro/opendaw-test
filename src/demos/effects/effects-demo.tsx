import React, { useEffect, useState, useCallback, useRef, memo } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import { AudioUnitBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TrackRow } from "@/components/TrackRow";
import { TransportControls } from "@/components/TransportControls";
import { TimelineRuler } from "@/components/TimelineRuler";
import { TracksContainer } from "@/components/TracksContainer";
import { EffectPanel } from "@/components/EffectPanel";
import { EffectChain, type EffectInstance } from "@/components/EffectChain";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { useWaveformRendering } from "@/hooks/useWaveformRendering";
import { useEffectChain } from "@/hooks/useEffectChain";
import { useDynamicEffect } from "@/hooks/useDynamicEffect";
import { useAudioExport } from "@/hooks/useAudioExport";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import { CONSOLE_STYLES, CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import type { TrackData } from "@/lib/types";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Flex, Card, Separator, Callout, Slider, Button, Code } from "@radix-ui/themes";

// AudioUnit volume schema is decibel(-96, -9, +6) and box constraints are
// no-ops — out-of-schema values really render as gain, so the UI must not
// offer values past +6 dB.
const MASTER_VOLUME_MIN_DB = -60;
const MASTER_VOLUME_MAX_DB = 6;

const DARK_RIDE_STEMS = [
  { name: "Intro", file: "01_Intro" },
  { name: "Vocals", file: "06_Vox" },
  { name: "Guitar Lead", file: "05_ElecGtrsLead" },
  { name: "Guitar", file: "04_ElecGtrs" },
  { name: "Drums", file: "02_Drums" },
  { name: "Bass", file: "03_Bass" },
  { name: "Effect Returns", file: "07_EffectReturns" }
] as const;

// Loading spinner — amber ring on console tokens, gated for reduced motion
// (the status text below the ring carries the same information).
const PAGE_STYLES = `
.fx-spinner {
  width: 44px;
  height: 44px;
  border: 3px solid var(--mc-line-bright);
  border-top-color: var(--mc-amber);
  border-radius: 50%;
  animation: fx-spin 1s linear infinite;
}
@keyframes fx-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .fx-spinner { animation: none; }
}
`;

/**
 * Renders one effect instance (memoized — EffectPanel sliders are the heavy part)
 */
const EffectRenderer: React.FC<{
  effect: EffectInstance;
  trackName: string;
  audioBox: AudioUnitBox | null;
  onRemove: (id: string) => void;
  project: Project | null;
}> = memo(({ effect, trackName, audioBox, onRemove, project }) => {
  const dynamicEffect = useDynamicEffect({
    id: effect.id,
    type: effect.type,
    trackName,
    project,
    audioBox
  });

  return (
    <EffectPanel
      title={effect.label}
      description={`${effect.type} effect`}
      isActive={true}
      onToggle={() => onRemove(effect.id)}
      isBypassed={dynamicEffect.isBypassed}
      onBypass={dynamicEffect.handleBypass}
      parameters={dynamicEffect.parameters}
      onParameterChange={dynamicEffect.handleParameterChange}
      presets={dynamicEffect.presets}
      onPresetChange={preset => dynamicEffect.loadPreset(preset)}
      accentColor={effect.accentColor}
    />
  );
});

EffectRenderer.displayName = "EffectRenderer";

/**
 * Main Effects Demo App Component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [masterVolume, setMasterVolume] = useState(0); // dB

  // Playback position and transport hooks
  const { currentPosition, setCurrentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({ project, audioContext, pausedPositionRef });

  // Audio boxes for effect targets
  const boxFor = (name: string): AudioUnitBox | null => tracks.find(t => t.name === name)?.audioUnitBox ?? null;
  const introBox = boxFor("Intro");
  const vocalsBox = boxFor("Vocals");
  const guitarLeadBox = boxFor("Guitar Lead");
  const guitarBox = boxFor("Guitar");
  const drumsBox = boxFor("Drums");
  const bassBox = boxFor("Bass");
  const effectReturnsBox = boxFor("Effect Returns");
  const masterAudioBox = project?.rootBoxAdapter.audioUnits.adapters().find(u => u.isOutput)?.box ?? null;

  // Audio export hook
  const { isExporting, exportStatus, handleExportMix, handleExportStems } = useAudioExport(project, {
    sampleRate: 48000,
    mixFileName: "dark-ride-mix"
  });
  const exportFailed = exportStatus.toLowerCase().includes("failed");

  // Effect chain hooks — the track list is static, so eight explicit hook
  // calls satisfy the Rules of Hooks; everything downstream is data-driven.
  const introEffects = useEffectChain(project, introBox, "Intro");
  const vocalsEffects = useEffectChain(project, vocalsBox, "Vocals");
  const guitarLeadEffects = useEffectChain(project, guitarLeadBox, "Guitar Lead");
  const guitarEffects = useEffectChain(project, guitarBox, "Guitar");
  const drumsEffects = useEffectChain(project, drumsBox, "Drums");
  const bassEffects = useEffectChain(project, bassBox, "Bass");
  const effectReturnsEffects = useEffectChain(project, effectReturnsBox, "Effect Returns");
  const masterEffects = useEffectChain(project, masterAudioBox, "Master");

  const trackChains = [
    { name: "Intro", audioBox: introBox, chain: introEffects },
    { name: "Vocals", audioBox: vocalsBox, chain: vocalsEffects },
    { name: "Guitar Lead", audioBox: guitarLeadBox, chain: guitarLeadEffects },
    { name: "Guitar", audioBox: guitarBox, chain: guitarEffects },
    { name: "Drums", audioBox: drumsBox, chain: drumsEffects },
    { name: "Bass", audioBox: bassBox, chain: bassEffects },
    { name: "Effect Returns", audioBox: effectReturnsBox, chain: effectReturnsEffects }
  ];
  const masterChain = { name: "Master", audioBox: masterAudioBox, chain: masterEffects };

  // One shared render factory replaces the eight copy-pasted callbacks.
  // EffectRenderer is memoized, so the per-render closure identity is cheap.
  const renderEffectFor = useCallback(
    (trackName: string, audioBox: AudioUnitBox | null, onRemove: (id: string) => void) =>
      (effect: EffectInstance) => (
        <EffectRenderer
          key={effect.id}
          effect={effect}
          trackName={trackName}
          audioBox={audioBox}
          onRemove={onRemove}
          project={project}
        />
      ),
    [project]
  );

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const bpmRef = useRef<number>(120);

  // Max duration for the timeline — computed once, shared by ruler/container/rows
  const maxDuration = Math.max(...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration), 1);

  // Use shared waveform rendering hook with region-aware rendering
  useWaveformRendering(project, tracks, canvasRefs.current, localAudioBuffersRef.current, {
    onAllRendered: () => setStatus("Ready to play!"),
    maxDuration
  });

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        localAudioBuffersRef.current = localAudioBuffers;

        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: 124,
          onStatusUpdate: setStatus
        });

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);

        // Store BPM for playhead calculations
        bpmRef.current = newProject.timelineBox.bpm.getValue();

        // Load audio files and create tracks
        const ext = getAudioExtension();
        const loadedTracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          DARK_RIDE_STEMS.map(({ name, file }) => ({ name, file: `/audio/DarkRide/${file}.${ext}` })),
          localAudioBuffers,
          {
            onProgress: (current, total, trackName) => {
              if (mounted) setStatus(`Loading ${trackName} (${current}/${total})...`);
            }
          }
        );

        if (mounted) {
          setTracks(loadedTracks);
          setStatus("Loading waveforms...");
        }
      } catch (error) {
        console.error("Failed to initialize: " + String(error));
        if (mounted) setInitError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleMasterVolumeChange = useCallback(
    (value: number) => {
      if (!project || !masterAudioBox) return;

      project.editing.modify(() => {
        masterAudioBox.volume.setValue(value);
      });

      setMasterVolume(value);
    },
    [project, masterAudioBox]
  );

  // Subscribe to master volume changes
  useEffect(() => {
    if (!masterAudioBox) return undefined;

    const subscription = masterAudioBox.volume.catchupAndSubscribe((obs: { getValue: () => number }) => {
      setMasterVolume(obs.getValue());
    });

    return () => {
      subscription.terminate();
    };
  }, [masterAudioBox]);

  // Stems export with per-track effects rendered in
  const handleEffectsStems = useCallback(async () => {
    await handleExportStems({
      includeAudioEffects: true,
      includeSends: false
    });
  }, [handleExportStems]);

  // Keep the overlay up while waveforms render; an init error replaces it
  const isLoading = status !== "Ready to play!";

  return (
    <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          {/* Header */}
          <div>
            <div className="mc-kicker">Effects &mdash; Insert Chains &amp; Mixdown &middot; OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              EFFECT CHAINS
            </h1>
            <p className="mc-intro">
              Ten insert effects on the seven unmastered stems of Dark Ride&apos;s &lsquo;Deny
              Control&rsquo;. Build per-track chains &mdash; compressors to tighten the drums
              and bass, reverb and compression on the vocal, delay on the lead &mdash; or
              process the master bus, then render the result offline with every effect baked
              in. Each effect ships with presets, a bypass, and parameters that respond in
              real time during playback.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                <strong>Initialization failed:</strong> {initError}
              </Callout.Text>
            </Callout.Root>
          ) : !project ? (
            <Text align="center" color="gray">
              {status}
            </Text>
          ) : (
            <>
              {/* Loading overlay (waveform rendering phase) */}
              {isLoading && (
                <div
                  role="status"
                  style={{
                    position: "fixed",
                    inset: 0,
                    backgroundColor: "rgba(13, 12, 10, 0.88)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 9999,
                    gap: 20
                  }}
                >
                  <div className="fx-spinner" aria-hidden="true" />
                  <Text size="4" weight="medium" style={{ color: "var(--mc-text)" }}>
                    {status}
                  </Text>
                </div>
              )}

              {/* Transport */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Transport
                  </Text>
                  <Separator size="4" />
                  <TransportControls
                    isPlaying={isPlaying}
                    currentPosition={currentPosition}
                    bpm={bpmRef.current}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onStop={handleStop}
                  />
                </Flex>
              </Card>

              {/* Mixer */}
              <Card>
                <Flex direction="column" gap="4">
                  <Flex justify="between" align="center" gap="4" wrap="wrap">
                    <Text size="2" weight="bold" color="gray">
                      Mixer
                    </Text>
                    <Flex align="center" gap="3" style={{ minWidth: "300px" }}>
                      <Text size="2" weight="bold" style={{ whiteSpace: "nowrap" }}>
                        Master Volume
                      </Text>
                      <Slider
                        value={[masterVolume]}
                        onValueChange={values => handleMasterVolumeChange(values[0])}
                        min={MASTER_VOLUME_MIN_DB}
                        max={MASTER_VOLUME_MAX_DB}
                        step={0.1}
                        style={{ flex: 1 }}
                      />
                      <Text size="2" color="gray" style={{ minWidth: "50px", textAlign: "right" }}>
                        {masterVolume.toFixed(1)} dB
                      </Text>
                    </Flex>
                  </Flex>
                  <Separator size="4" />

                  <TracksContainer
                    currentPosition={currentPosition}
                    bpm={bpmRef.current}
                    maxDuration={maxDuration}
                    leftOffset={200}
                    playheadColor="#fff"
                    showBorder={true}
                  >
                    <TimelineRuler maxDuration={maxDuration} />
                    {tracks.map(track => (
                      <TrackRow
                        key={UUID.toString(track.uuid)}
                        track={track}
                        project={project}
                        allTracks={tracks}
                        canvasRef={el => {
                          if (el) {
                            canvasRefs.current.set(UUID.toString(track.uuid), el);
                          }
                        }}
                        currentPosition={currentPosition}
                        isPlaying={isPlaying}
                        bpm={bpmRef.current}
                        audioBuffer={localAudioBuffersRef.current.get(UUID.toString(track.uuid))}
                        setCurrentPosition={setCurrentPosition}
                        pausedPositionRef={pausedPositionRef}
                        maxDuration={maxDuration}
                      />
                    ))}
                  </TracksContainer>
                </Flex>
              </Card>

              {/* Effect chains */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">
                    Effect Chains
                  </Text>
                  <Separator size="4" />
                  <Text size="2" color="gray">
                    Pick an effect, add it to a chain, and tweak while the transport runs &mdash; every
                    slider writes an automatable box field inside an editing transaction. Presets are
                    useful starting points; Bypass toggles the box&apos;s enabled field without removing it.
                  </Text>

                  <Flex direction="column" gap="3">
                    <Text size="2" weight="bold" color="gray">
                      Per-Track Effects
                    </Text>
                    {trackChains.map(({ name, audioBox, chain }, index) => (
                      <div
                        key={name}
                        style={{
                          padding: "12px",
                          backgroundColor: index % 2 ? "var(--gray-4)" : "var(--gray-2)",
                          borderRadius: "var(--radius-2)"
                        }}
                      >
                        <EffectChain
                          trackName={name}
                          effects={chain.effects}
                          onAddEffect={chain.addEffect}
                          renderEffect={renderEffectFor(name, audioBox, chain.removeEffect)}
                        />
                      </div>
                    ))}
                  </Flex>

                  <Flex direction="column" gap="3">
                    <Text size="2" weight="bold" color="gray">
                      Master Output Effects
                    </Text>
                    <div style={{ padding: "12px", backgroundColor: "var(--accent-3)", borderRadius: "var(--radius-2)" }}>
                      <EffectChain
                        trackName={masterChain.name}
                        effects={masterChain.chain.effects}
                        onAddEffect={masterChain.chain.addEffect}
                        renderEffect={renderEffectFor(masterChain.name, masterChain.audioBox, masterChain.chain.removeEffect)}
                      />
                    </div>
                  </Flex>
                </Flex>
              </Card>

              {/* Export */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">
                    Export Audio
                  </Text>
                  <Separator size="4" />
                  <Text size="2" color="gray">
                    Renders offline at 48 kHz into 32-bit float WAV with every effect chain baked in
                    &mdash; the full mix as one stereo file, or one stem per track with its own effects.
                  </Text>

                  <Flex gap="3" wrap="wrap" justify="center">
                    <Button
                      onClick={handleExportMix}
                      disabled={tracks.length === 0 || isExporting}
                      color="amber"
                      size="3"
                      variant="solid"
                    >
                      Export Full Mix (with Effects)
                    </Button>
                    <Button
                      onClick={handleEffectsStems}
                      disabled={tracks.length === 0 || isExporting}
                      color="amber"
                      size="3"
                      variant="outline"
                    >
                      Export Stems ({tracks.length} tracks with Effects)
                    </Button>
                  </Flex>

                  {exportFailed ? (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{exportStatus}</Callout.Text>
                    </Callout.Root>
                  ) : (
                    (exportStatus || isExporting) && (
                      <Flex direction="column" gap="2" align="center">
                        <Text size="2" weight="medium">
                          {exportStatus}
                        </Text>
                        {isExporting && (
                          <Text size="1" color="gray" align="center">
                            Rendering offline (may take a moment for long tracks)
                          </Text>
                        )}
                      </Flex>
                    )
                  )}
                </Flex>
              </Card>

              {/* SDK reference */}
              <section className="mc-anchors">
                <h2 className="mc-anchors-head">SDK reference</h2>
                <p>
                  Ten audio effects, all inserted with the same call: Reverb, Dattorro Reverb,
                  Compressor, Parametric EQ (Revamp), Delay, Lo-Fi Crusher, Wavefolder, Stereo
                  Width (StereoTool), Tidal LFO, and Maximizer. Chains are per-track UI state
                  (<code>useEffectChain</code>); each instance owns its box lifecycle
                  (<code>useDynamicEffect</code>) &mdash; insert on mount, <code>box.delete()</code> on
                  removal.
                </p>

                <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
                  Effect insertion:
                </Text>
                <Code size="2" style={CODE_BLOCK_STYLE}>
                  {`// insertEffect returns the EffectBox union — cast to the device type
project.editing.modify(() => {
  const effectBox = project.api.insertEffect(
    audioUnitBox.audioEffects,
    EffectFactories.AudioNamed.Compressor
  );
  effectBox.label.setValue("Drums Compressor");
  (effectBox as CompressorDeviceBox).threshold.setValue(-20); // dB
});`}
                </Code>

                <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
                  Bypass and parameter changes:
                </Text>
                <Code size="2" style={CODE_BLOCK_STYLE}>
                  {`// Every effect box has an enabled BooleanField (the bypass)
project.editing.modify(() => {
  effectBox.enabled.setValue(!effectBox.enabled.getValue());
});

// Observe it outside the transaction
effectBox.enabled.catchupAndSubscribe(obs => {
  const bypassed = !obs.getValue();
});`}
                </Code>

                <p>
                  All box-graph writes go through <code>project.editing.modify()</code>; state
                  observation uses <code>catchupAndSubscribe()</code>. The offline render uses{" "}
                  <code>AudioOfflineRenderer.start()</code> &mdash; stems pass{" "}
                  <code>useInstrumentOutput: false</code> so effects, sends, and the channel strip
                  stay in the render path.
                </p>
              </section>

              {/* Audio Attribution */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Audio Attribution
                  </Text>
                  <Separator size="4" />
                  <Text size="2">
                    Mix stems from Dark Ride&apos;s &lsquo;Deny Control&rsquo;. This file is provided for
                    educational purposes only, and the material contained in it should not be used for
                    any commercial purpose without the express permission of the copyright holders.
                    Please refer to{" "}
                    <a
                      href="https://www.cambridge-mt.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent-9)" }}
                    >
                      www.cambridge-mt.com
                    </a>{" "}
                    for further details.
                  </Text>
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

// Mount the app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
