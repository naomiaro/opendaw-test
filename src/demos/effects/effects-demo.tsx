// noinspection PointlessArithmeticExpressionJS

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
import type { TrackData } from "@/lib/types";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Separator, Callout, Slider, Button } from "@radix-ui/themes";

/**
 * Component to render individual effect instances (memoized to prevent re-renders)
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
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);

  // Playback position and transport hooks
  const { currentPosition, setCurrentPosition, isPlaying, currentPositionRef, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({ project, audioContext, pausedPositionRef });

  // Get audio boxes for effects
  const vocalsAudioBox = tracks.find(t => t.name === "Vocals")?.audioUnitBox || null;
  const guitarLeadAudioBox = tracks.find(t => t.name === "Guitar Lead")?.audioUnitBox || null;
  const guitarAudioBox = tracks.find(t => t.name === "Guitar")?.audioUnitBox || null;
  const drumsAudioBox = tracks.find(t => t.name === "Drums")?.audioUnitBox || null;
  const bassAudioBox = tracks.find(t => t.name === "Bass")?.audioUnitBox || null;
  const masterAudioBox = project?.rootBoxAdapter.audioUnits.adapters().find(u => u.isOutput)?.box ?? null;

  // Master volume state
  const [masterVolume, setMasterVolume] = useState(0); // dB

  // Audio export hook
  const {
    isExporting,
    exportStatus,
    handleExportMix,
    handleExportStems
  } = useAudioExport(project, {
    sampleRate: 48000,
    mixFileName: "dark-ride-mix"
  });

  // Effect chain hooks for each track and master
  const introEffects = useEffectChain(project, tracks.find(t => t.name === "Intro")?.audioUnitBox || null, "Intro");
  const vocalsEffects = useEffectChain(project, vocalsAudioBox, "Vocals");
  const guitarLeadEffects = useEffectChain(project, guitarLeadAudioBox, "Guitar Lead");
  const guitarEffects = useEffectChain(project, guitarAudioBox, "Guitar");
  const drumsEffects = useEffectChain(project, drumsAudioBox, "Drums");
  const bassEffects = useEffectChain(project, bassAudioBox, "Bass");
  const effectReturnsEffects = useEffectChain(
    project,
    tracks.find(t => t.name === "Effect Returns")?.audioUnitBox || null,
    "Effect Returns"
  );
  const masterEffects = useEffectChain(project, masterAudioBox, "Master");

  // Memoized render functions to prevent unnecessary re-renders
  const renderIntroEffect = useCallback(
    (effect: EffectInstance) => (
      <EffectRenderer
        key={effect.id}
        effect={effect}
        trackName="Intro"
        audioBox={tracks.find(t => t.name === "Intro")?.audioUnitBox}
        onRemove={introEffects.removeEffect}
        project={project}
      />
    ),
    [project, tracks, introEffects.removeEffect]
  );

  const renderVocalsEffect = useCallback(
    (effect: EffectInstance) => (
      <EffectRenderer
        key={effect.id}
        effect={effect}
        trackName="Vocals"
        audioBox={vocalsAudioBox}
        onRemove={vocalsEffects.removeEffect}
        project={project}
      />
    ),
    [project, vocalsAudioBox, vocalsEffects.removeEffect]
  );

  const renderGuitarLeadEffect = useCallback(
    (effect: EffectInstance) => (
      <EffectRenderer
        key={effect.id}
        effect={effect}
        trackName="Guitar Lead"
        audioBox={guitarLeadAudioBox}
        onRemove={guitarLeadEffects.removeEffect}
        project={project}
      />
    ),
    [project, guitarLeadAudioBox, guitarLeadEffects.removeEffect]
  );

  const renderGuitarEffect = useCallback(
    (effect: EffectInstance) => (
      <EffectRenderer
        key={effect.id}
        effect={effect}
        trackName="Guitar"
        audioBox={guitarAudioBox}
        onRemove={guitarEffects.removeEffect}
        project={project}
      />
    ),
    [project, guitarAudioBox, guitarEffects.removeEffect]
  );

  const renderDrumsEffect = useCallback(
    (effect: EffectInstance) => (
      <EffectRenderer
        key={effect.id}
        effect={effect}
        trackName="Drums"
        audioBox={drumsAudioBox}
        onRemove={drumsEffects.removeEffect}
        project={project}
      />
    ),
    [project, drumsAudioBox, drumsEffects.removeEffect]
  );

  const renderBassEffect = useCallback(
    (effect: EffectInstance) => (
      <EffectRenderer
        key={effect.id}
        effect={effect}
        trackName="Bass"
        audioBox={bassAudioBox}
        onRemove={bassEffects.removeEffect}
        project={project}
      />
    ),
    [project, bassAudioBox, bassEffects.removeEffect]
  );

  const renderEffectReturnsEffect = useCallback(
    (effect: EffectInstance) => (
      <EffectRenderer
        key={effect.id}
        effect={effect}
        trackName="Effect Returns"
        audioBox={tracks.find(t => t.name === "Effect Returns")?.audioUnitBox}
        onRemove={effectReturnsEffects.removeEffect}
        project={project}
      />
    ),
    [project, tracks, effectReturnsEffects.removeEffect]
  );

  const renderMasterEffect = useCallback(
    (effect: EffectInstance) => (
      <EffectRenderer
        key={effect.id}
        effect={effect}
        trackName="Master"
        audioBox={masterAudioBox}
        onRemove={masterEffects.removeEffect}
        project={project}
      />
    ),
    [project, masterAudioBox, masterEffects.removeEffect]
  );

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const bpmRef = useRef<number>(120);

  // Calculate max duration for timeline
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
          [
            { name: "Intro", file: `/audio/DarkRide/01_Intro.${ext}` },
            { name: "Vocals", file: `/audio/DarkRide/06_Vox.${ext}` },
            { name: "Guitar Lead", file: `/audio/DarkRide/05_ElecGtrsLead.${ext}` },
            { name: "Guitar", file: `/audio/DarkRide/04_ElecGtrs.${ext}` },
            { name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` },
            { name: "Bass", file: `/audio/DarkRide/03_Bass.${ext}` },
            { name: "Effect Returns", file: `/audio/DarkRide/07_EffectReturns.${ext}` }
          ],
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
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${error}`);
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

  // Export full mix with all effects rendered
  // Wrapper for stems export with effects enabled
  const handleEffectsStems = useCallback(async () => {
    await handleExportStems({
      includeAudioEffects: true, // IMPORTANT: Include effects to hear them in the export!
      includeSends: false
    });
  }, [handleExportStems]);

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="green" radius="medium">
        <Container size="4" style={{ padding: "32px" }}>
          <Heading size="8">OpenDAW Effects Demo</Heading>
          <Text size="4">{status}</Text>
        </Container>
      </Theme>
    );
  }

  // Show loading overlay while status is not "Ready to play!"
  const isLoading = status !== "Ready to play!";

  return (
    <Theme appearance="dark" accentColor="green" radius="medium">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          {/* Loading Overlay */}
          {isLoading && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.85)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                gap: "20px"
              }}
            >
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  border: "4px solid rgba(74, 158, 255, 0.3)",
                  borderTop: "4px solid #4a9eff",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite"
                }}
              />
              <Text size="5" weight="medium" style={{ color: "#fff" }}>
                {status}
              </Text>
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          )}

          <BackLink />

          {/* Header */}
          <Flex direction="column" gap="3">
            <Heading size="8">OpenDAW Effects Demo</Heading>
            <Text size="4" color="gray">
              Multi-track mixer featuring DarkRide stems with 10 professional audio effects (Reverb, Dattorro Reverb,
              Compressor, EQ, Delay, Lo-Fi Crusher, Wavefolder, Stereo Width, Tidal LFO, Maximizer)
            </Text>
          </Flex>

          {/* Info callout */}
          <Callout.Root color="blue">
            <Callout.Text>
              💡 This demo shows OpenDAW's mixer controls and 10 professional audio effects with all 7 unmastered tracks
              from Dark Ride's 'Deny Control'. Each track has independent volume, pan, mute, and solo controls. Add
              studio-quality effects to individual tracks (Compressors to tighten Drums/Bass, Reverb + Compressor on
              Vocals, Delay on Guitar Lead, Lo-Fi Crusher for creative effects) or the master output (Compressor for mix
              glue, Stereo Width for spaciousness).
              <br />
              <br />✨ <strong>New:</strong> Each effect now includes presets! Try loading presets like "Drum Punch",
              "Bass Control", "Vocal Smooth", "Slap Back Delay", and more to hear how different parameter combinations
              sound.
            </Callout.Text>
          </Callout.Root>

          {/* Transport controls */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Transport</Heading>
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

          {/* Mixer section */}
          <Card>
            <Flex direction="column" gap="4">
              <Flex justify="between" align="center" gap="4">
                <Heading size="4">Mixer</Heading>
                {/* Master Volume Control */}
                <Flex align="center" gap="3" style={{ minWidth: "300px" }}>
                  <Text size="2" weight="bold" style={{ whiteSpace: "nowrap" }}>
                    Master Volume
                  </Text>
                  <Slider
                    value={[masterVolume]}
                    onValueChange={values => handleMasterVolumeChange(values[0])}
                    min={-60}
                    max={12}
                    step={0.1}
                    style={{ flex: 1 }}
                  />
                  <Text size="2" color="gray" style={{ minWidth: "50px", textAlign: "right" }}>
                    {masterVolume.toFixed(1)} dB
                  </Text>
                </Flex>
              </Flex>
              <Separator size="4" />

              {/* Timeline and tracks container with playhead overlay */}
              <TracksContainer
                currentPosition={currentPosition}
                bpm={bpmRef.current}
                maxDuration={Math.max(...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration), 1)}
                leftOffset={200}
                playheadColor="#fff"
                showBorder={true}
              >
                {/* Timeline - Dynamically calculated duration */}
                <TimelineRuler
                  maxDuration={Math.max(
                    ...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration),
                    1
                  )}
                />
                {(() => {
                  // Calculate max duration once for all tracks
                  const maxDuration = Math.max(
                    ...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration),
                    1
                  );

                  return tracks.map(track => (
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
                  ));
                })()}
              </TracksContainer>
            </Flex>
          </Card>

          {/* Audio Effects */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Audio Effects</Heading>
              <Separator size="4" />

              <Callout.Root color="purple">
                <Callout.Text>
                  ✨ Add professional audio effects to individual tracks or the master output. These are the same
                  effects used in professional DAWs! Each effect includes preset options - try loading presets to
                  quickly explore different sounds, then fine-tune the parameters to your liking. Try adding Compressors
                  to Drums and Bass to tighten up these unmastered stems, or add Reverb to Vocals with Compressor for a
                  polished vocal chain.
                </Callout.Text>
              </Callout.Root>

              {/* Per-Track Effects */}
              <Flex direction="column" gap="3">
                <Heading size="3">Per-Track Effects</Heading>

                <div style={{ padding: "12px", backgroundColor: "var(--gray-2)", borderRadius: "var(--radius-2)" }}>
                  <EffectChain
                    trackName="Intro"
                    effects={introEffects.effects}
                    onAddEffect={introEffects.addEffect}
                    onRemoveEffect={introEffects.removeEffect}
                    renderEffect={renderIntroEffect}
                  />
                </div>

                <div style={{ padding: "12px", backgroundColor: "var(--gray-4)", borderRadius: "var(--radius-2)" }}>
                  <EffectChain
                    trackName="Vocals"
                    effects={vocalsEffects.effects}
                    onAddEffect={vocalsEffects.addEffect}
                    onRemoveEffect={vocalsEffects.removeEffect}
                    renderEffect={renderVocalsEffect}
                  />
                </div>

                <div style={{ padding: "12px", backgroundColor: "var(--gray-2)", borderRadius: "var(--radius-2)" }}>
                  <EffectChain
                    trackName="Guitar Lead"
                    effects={guitarLeadEffects.effects}
                    onAddEffect={guitarLeadEffects.addEffect}
                    onRemoveEffect={guitarLeadEffects.removeEffect}
                    renderEffect={renderGuitarLeadEffect}
                  />
                </div>

                <div style={{ padding: "12px", backgroundColor: "var(--gray-4)", borderRadius: "var(--radius-2)" }}>
                  <EffectChain
                    trackName="Guitar"
                    effects={guitarEffects.effects}
                    onAddEffect={guitarEffects.addEffect}
                    onRemoveEffect={guitarEffects.removeEffect}
                    renderEffect={renderGuitarEffect}
                  />
                </div>

                <div style={{ padding: "12px", backgroundColor: "var(--gray-2)", borderRadius: "var(--radius-2)" }}>
                  <EffectChain
                    trackName="Drums"
                    effects={drumsEffects.effects}
                    onAddEffect={drumsEffects.addEffect}
                    onRemoveEffect={drumsEffects.removeEffect}
                    renderEffect={renderDrumsEffect}
                  />
                </div>

                <div style={{ padding: "12px", backgroundColor: "var(--gray-4)", borderRadius: "var(--radius-2)" }}>
                  <EffectChain
                    trackName="Bass"
                    effects={bassEffects.effects}
                    onAddEffect={bassEffects.addEffect}
                    onRemoveEffect={bassEffects.removeEffect}
                    renderEffect={renderBassEffect}
                  />
                </div>

                <div style={{ padding: "12px", backgroundColor: "var(--gray-2)", borderRadius: "var(--radius-2)" }}>
                  <EffectChain
                    trackName="Effect Returns"
                    effects={effectReturnsEffects.effects}
                    onAddEffect={effectReturnsEffects.addEffect}
                    onRemoveEffect={effectReturnsEffects.removeEffect}
                    renderEffect={renderEffectReturnsEffect}
                  />
                </div>
              </Flex>

              {/* Master Effects */}
              <Flex direction="column" gap="3">
                <Heading size="3">Master Output Effects</Heading>

                <div style={{ padding: "12px", backgroundColor: "var(--accent-3)", borderRadius: "var(--radius-2)" }}>
                  <EffectChain
                    trackName="Master"
                    effects={masterEffects.effects}
                    onAddEffect={masterEffects.addEffect}
                    onRemoveEffect={masterEffects.removeEffect}
                    renderEffect={renderMasterEffect}
                  />
                </div>
              </Flex>

              <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                💡 Tip: Adjust effect parameters while playback is active to hear the changes in real-time!
              </Text>
            </Flex>
          </Card>

          {/* Technical details */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Technical Details</Heading>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Dynamic Effect Chain System:
                </Text>
                <Text size="2">• Dynamic effect system allows adding multiple effects of any type to each track</Text>
                <Text size="2">
                  • Effects are managed via <code>useEffectChain</code> hook per track/master
                </Text>
                <Text size="2">
                  • Individual effects use <code>useDynamicEffect</code> for full lifecycle management
                </Text>
                <Separator size="1" />
                <Text size="2" weight="bold">
                  Available Effects (10 Total):
                </Text>
                <Text size="2">
                  • <strong>Reverb:</strong> Space simulation with decay, pre-delay, and damping controls
                </Text>
                <Text size="2">
                  • <strong>Compressor:</strong> Dynamic range control with threshold, ratio, attack, release, and
                  makeup gain
                </Text>
                <Text size="2">
                  • <strong>Parametric EQ:</strong> 3-band EQ (Low 250Hz, Mid 1kHz, High 4kHz) with ±24dB gain range
                </Text>
                <Text size="2">
                  • <strong>Delay:</strong> Tempo-synced echo with feedback, cross-feedback, and filtering
                </Text>
                <Text size="2">
                  • <strong>Lo-Fi Crusher:</strong> Bit-crushing and sample rate reduction for digital degradation
                </Text>
                <Text size="2">
                  • <strong>Wavefolder:</strong> Distortion/saturation with drive and oversampling for harmonic
                  generation
                </Text>
                <Text size="2">
                  • <strong>Stereo Width:</strong> Stereo imaging with width, panning, and phase controls
                </Text>
                <Text size="2">
                  • <strong>Dattorro Reverb:</strong> High-quality plate reverb with modulation and diffusion controls
                </Text>
                <Text size="2">
                  • <strong>Tidal LFO:</strong> Tempo-synced amplitude modulation, tremolo, and auto-pan
                </Text>
                <Text size="2">
                  • <strong>Maximizer:</strong> Brick-wall limiter for loudness maximization and peak control
                </Text>
                <Separator size="1" />
                <Text size="2" weight="bold">
                  Implementation:
                </Text>
                <Text size="2">
                  • Effect insertion:{" "}
                  <code>project.api.insertEffect(audioBox.audioEffects, EffectFactories.AudioNamed.*)</code>
                </Text>
                <Text size="2">
                  • All modifications within <code>project.editing.modify()</code> transactions
                </Text>
                <Text size="2">
                  • State observation via <code>catchupAndSubscribe()</code>
                </Text>
                <Text size="2">• Each effect includes presets and bypass functionality</Text>
              </Flex>
            </Flex>
          </Card>

          {/* Export Audio */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Export Audio</Heading>
              <Separator size="4" />

              <Callout.Root color="purple">
                <Callout.Text>
                  🎵 Export your mix with all effects fully rendered! This is perfect for hearing how your effect chains
                  (Reverb, Compressor, Lo-Fi Crusher, etc.) sound in the final audio. The "Export Full Mix" renders
                  everything together, while "Export Stems" gives you individual tracks with their effects baked in.
                </Callout.Text>
              </Callout.Root>

              <Flex direction="column" gap="3">
                <Flex gap="3" wrap="wrap" justify="center">
                  <Button
                    onClick={handleExportMix}
                    disabled={tracks.length === 0 || isExporting}
                    color="purple"
                    size="3"
                    variant="solid"
                  >
                    Export Full Mix (with Effects)
                  </Button>
                  <Button
                    onClick={handleEffectsStems}
                    disabled={tracks.length === 0 || isExporting}
                    color="purple"
                    size="3"
                    variant="outline"
                  >
                    Export Stems ({tracks.length} tracks with Effects)
                  </Button>
                </Flex>

                {/* Export status */}
                {(exportStatus || isExporting) && (
                  <>
                    <Separator size="4" />
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
                  </>
                )}

                <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                  💡 Tip: Add effects to tracks first, then export to hear them in the final audio. The effects are
                  rendered offline at high quality (48kHz, 32-bit float WAV).
                </Text>
              </Flex>
            </Flex>
          </Card>

          {/* Audio Attribution */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Audio Attribution</Heading>
              <Separator size="4" />
              <Text size="2">
                Mix stems from Dark Ride's 'Deny Control'. This file is provided for educational purposes only, and the
                material contained in it should not be used for any commercial purpose without the express permission of
                the copyright holders. Please refer to{" "}
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

          <MoisesLogo />
        </Flex>
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
