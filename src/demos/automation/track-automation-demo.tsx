import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Flex, Button, Card, Callout, Code } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { Project, EffectFactories } from "@opendaw/studio-core";
import { AudioUnitBox, ReverbDeviceBox, TrackBox, ValueRegionBox } from "@opendaw/studio-boxes";
import type { ppqn } from "@opendaw/lib-dsp";
import { UUID } from "@opendaw/lib-std";
import { ValueRegionBoxAdapter, TrackBoxAdapter } from "@opendaw/studio-adapters";
import { getAllRegions } from "@/lib/adapterUtils";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { AutomationCanvas } from "./AutomationCanvas";
import { BAR, NUM_BARS, TOTAL_PPQN, TRACK_CONFIGS, eventsToJson } from "./trackAutomationPresets";
import type { AutomationEvent, AutomationTrackConfig } from "./trackAutomationPresets";

const BPM = 124; // Match Dark Ride BPM

// Start at bar 17 of the guitar track (skip silence at the beginning)
const PLAYBACK_START = (BAR * 16) as ppqn; // bar 17 = 16 bars in
const PLAYBACK_END = (PLAYBACK_START + TOTAL_PPQN) as ppqn;

// Page-local styles — the <details> summary is keyboard-focusable but not covered
// by CONSOLE_STYLES' focus rules (which target .mc-open and .mc-anchors a)
const PAGE_STYLES = `
.mc-data summary:focus-visible {
  outline: 2px solid var(--mc-amber);
  outline-offset: 2px;
  border-radius: 3px;
}
`;

// ─── Helper: Apply Automation Events to a Track ─────────────────────────

/**
 * Creates a new automation region with the given events, then deletes any
 * pre-existing regions on the track. Returns true on success; returns false
 * if region creation failed (old regions are preserved unchanged).
 */
function applyAutomationEvents(project: Project, trackBox: TrackBox, events: AutomationEvent[]): boolean {
  // Snapshot existing automation regions via the adapter layer
  const trackAdapter = project.boxAdapters.adapterFor(trackBox, TrackBoxAdapter);
  const existingRegions = trackAdapter.regions.adapters.values()
    .filter(r => r.isValueRegion())
    .map(r => r.box);

  // Create new region first (don't delete old ones until this succeeds)
  let newRegionCreated = false;
  project.editing.modify(() => {
    const regionOpt = project.api.createTrackRegion(trackBox, PLAYBACK_START, TOTAL_PPQN as ppqn);
    if (regionOpt.isEmpty()) {
      console.warn("Failed to create automation region");
      return;
    }
    const regionBox = regionOpt.unwrap() as ValueRegionBox;

    const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
    const collectionOpt = adapter.optCollection;
    if (collectionOpt.isEmpty()) {
      console.warn("Failed to get event collection from automation region");
      return;
    }
    const collection = collectionOpt.unwrap();

    // Event positions are LOCAL to the region (0 to duration).
    // Use (position, index) composite key: same position → index 1 (matching eventsToJson).
    events.forEach((evt, i) => {
      collection.createEvent({
        position: evt.position,
        index: i > 0 && events[i - 1].position === evt.position ? 1 : 0,
        value: evt.value,
        interpolation: evt.interpolation
      });
    });
    newRegionCreated = true;
  });

  // Only delete old regions after new one was successfully created
  if (newRegionCreated && existingRegions.length > 0) {
    project.editing.modify(() => {
      for (const region of existingRegions) {
        const adapter = project.boxAdapters.adapterFor(region, ValueRegionBoxAdapter);
        const collectionOpt = adapter.optCollection;
        if (collectionOpt.nonEmpty()) {
          collectionOpt.unwrap().events.asArray().forEach((evt: any) => evt.box.delete());
        }
        region.delete();
      }
    });
  }

  return newRegionCreated;
}

// ─── Server Data Block Component ────────────────────────────────────────

interface ServerDataBlockProps {
  data: Record<string, unknown>;
  label: string;
}

const ServerDataBlock: React.FC<ServerDataBlockProps> = ({ data, label }) => {
  return (
    <details className="mc-data" style={{ marginTop: 4 }}>
      <summary
        style={{
          cursor: "pointer",
          fontFamily: "var(--mc-mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--mc-label)",
          userSelect: "none"
        }}
      >
        {label}
      </summary>
      <pre
        style={{
          background: "var(--mc-bg)",
          border: "1px solid var(--mc-line)",
          borderRadius: "4px",
          padding: 12,
          fontFamily: "var(--mc-mono)",
          fontSize: 12,
          lineHeight: 1.6,
          overflow: "auto",
          maxHeight: 300,
          color: "var(--mc-muted)",
          marginTop: 8,
          marginBottom: 0
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
};

// ─── Automation Section Component ───────────────────────────────────────

interface AutomationSectionProps {
  config: AutomationTrackConfig;
  activePresetIndex: number;
  onPresetSelect: (index: number) => void;
  onPlay: () => void;
  onStop: () => void;
  playheadPosition: ppqn;
  isActiveSection: boolean;
  isPlaying: boolean;
  targetUnitId: string;
}

const AutomationSection: React.FC<AutomationSectionProps> = ({
  config,
  activePresetIndex,
  onPresetSelect,
  onPlay,
  onStop,
  playheadPosition,
  isActiveSection,
  isPlaying,
  targetUnitId
}) => {
  const activePreset = config.presets[activePresetIndex];
  // activePreset object identity is stable (TRACK_CONFIGS is module-level constant);
  // targetUnitId changes once on init then is stable.
  const jsonData = useMemo(
    () => eventsToJson(activePreset.events, config.parameterName, targetUnitId),
    [activePreset, config.parameterName, targetUnitId]
  );
  const showPlayhead = isActiveSection && isPlaying;

  return (
    <Card size="3">
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between">
          <Flex align="center" gap="2">
            <span className="mc-chip" style={{ backgroundColor: config.color }} />
            <h2 className="mc-name">{config.label} Automation</h2>
          </Flex>
          {!(isActiveSection && isPlaying) ? (
            <Button size="2" onClick={onPlay}>
              Play
            </Button>
          ) : (
            <Button size="2" color="red" onClick={onStop}>
              Stop
            </Button>
          )}
        </Flex>

        <Flex gap="2" wrap="wrap">
          {config.presets.map((preset, index) => (
            <Button
              key={preset.name}
              variant={activePresetIndex === index ? "solid" : "outline"}
              size="2"
              onClick={() => onPresetSelect(index)}
              style={
                activePresetIndex === index
                  ? { backgroundColor: config.color, color: "var(--mc-bg)" }
                  : { borderColor: config.color, color: config.color }
              }
            >
              {preset.name}
            </Button>
          ))}
        </Flex>

        <AutomationCanvas
          events={activePreset.events}
          color={config.color}
          yLabels={config.yLabels}
          playheadPosition={playheadPosition}
          showPlayhead={showPlayhead}
          playbackStart={PLAYBACK_START}
        />

        <ServerDataBlock data={jsonData} label="Server persistence data" />
      </Flex>
    </Card>
  );
};

// ─── Main App ───────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [targetUnitId, setTargetUnitId] = useState("");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [initWarning, setInitWarning] = useState<string | null>(null);

  // Per-section active preset indices
  const [activePresets, setActivePresets] = useState([0, 0, 0]);
  const [playingSectionIndex, setPlayingSectionIndex] = useState<number | null>(null);

  // Store track boxes for automation tracks
  const automationTrackBoxesRef = useRef<TrackBox[]>([]);
  const audioUnitBoxRef = useRef<AudioUnitBox | null>(null);
  const reverbDeviceBoxRef = useRef<ReverbDeviceBox | null>(null);

  const { currentPosition: playheadPosition, isPlaying } = usePlaybackPosition(project);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setStatus("Initializing audio engine...");

        const localAudioBuffers = new Map<string, AudioBuffer>();

        const { project: newProject, audioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: setStatus
        });

        if (cancelled) return;

        projectRef.current = newProject;
        audioContextRef.current = audioContext;
        setProject(newProject);

        // Load guitar track
        setStatus("Loading audio track...");

        const ext = getAudioExtension();
        const tracks = await loadTracksFromFiles(
          newProject,
          audioContext,
          [{ name: "Guitar", file: `/audio/DarkRide/04_ElecGtrs.${ext}` }],
          localAudioBuffers
        );

        if (cancelled) return;
        if (tracks.length === 0) {
          setInitError("Failed to load audio track — check the browser console");
          return;
        }

        const { audioUnitBox } = tracks[0];
        audioUnitBoxRef.current = audioUnitBox;
        setTargetUnitId(UUID.toString(audioUnitBox.address.uuid));

        // Trim the audio region: position at bar 17, read from bar 17 of audio, 8 bars long
        const guitarRegion = getAllRegions(newProject).find(r =>
          r.isAudioRegion() && r.box.label.getValue() === "Guitar"
        );
        if (guitarRegion && guitarRegion.isAudioRegion()) {
          newProject.editing.modify(() => {
            guitarRegion.position = PLAYBACK_START;
            guitarRegion.duration = TOTAL_PPQN;
            guitarRegion.loopOffset = PLAYBACK_START;
          });
        } else {
          console.warn('Could not find AudioRegionBox with label "Guitar" — audio may play from wrong position');
          if (!cancelled) {
            setInitWarning('Could not find the "Guitar" audio region — playback may start from the wrong position');
          }
        }

        // Insert a Reverb effect with exaggerated settings for demo
        setStatus("Setting up automation tracks...");
        let reverbBox: ReverbDeviceBox | null = null;
        newProject.editing.modify(() => {
          const effectBox = newProject.api.insertEffect(audioUnitBox.audioEffects, EffectFactories.Reverb);
          reverbBox = effectBox as ReverbDeviceBox;
          // Large hall: long decay, low damping, noticeable wet level
          reverbBox.decay.setValue(0.85);     // long tail (0-1)
          reverbBox.preDelay.setValue(0.03);  // 30ms pre-delay
          reverbBox.damp.setValue(0.3);       // low damping = brighter
          reverbBox.wet.setValue(-6);         // -6 dB wet (loud enough to hear)
          reverbBox.dry.setValue(0);          // 0 dB dry
        });
        if (!reverbBox) {
          throw new Error("Failed to create Reverb effect");
        }
        reverbDeviceBoxRef.current = reverbBox;

        // Create 3 automation tracks: volume, pan, reverb wet
        const automationTargets = [audioUnitBox.volume, audioUnitBox.panning, reverbBox.wet];

        const trackBoxes: TrackBox[] = [];
        for (let i = 0; i < automationTargets.length; i++) {
          let trackBox: TrackBox | null = null;
          newProject.editing.modify(() => {
            trackBox = newProject.api.createAutomationTrack(audioUnitBox, automationTargets[i]);
          });
          if (trackBox) {
            trackBoxes.push(trackBox);
          } else {
            console.warn(`Failed to create automation track for ${TRACK_CONFIGS[i].parameterName}`);
          }
        }

        automationTrackBoxesRef.current = trackBoxes;

        // Apply default preset for volume only (one automation at a time)
        if (trackBoxes[0]) {
          const ok = applyAutomationEvents(newProject, trackBoxes[0], TRACK_CONFIGS[0].presets[0].events);
          if (!ok) {
            console.warn("Failed to apply initial automation preset — demo may start without automation");
            if (!cancelled) {
              setInitWarning("Initial automation preset could not be applied");
            }
          }
        }

        // Set loop area to bar 17–25 and position engine at bar 17
        newProject.editing.modify(() => {
          newProject.timelineBox.loopArea.from.setValue(PLAYBACK_START);
          newProject.timelineBox.loopArea.to.setValue(PLAYBACK_END);
          newProject.timelineBox.loopArea.enabled.setValue(true);
        });
        newProject.engine.setPosition(PLAYBACK_START);

        setStatus("Ready");
        setIsReady(true);
      } catch (error) {
        console.error("Track automation demo initialization failed:", error);
        if (!cancelled) {
          setInitError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePresetSelect = (sectionIndex: number, presetIndex: number) => {
    const p = projectRef.current;
    const trackBox = automationTrackBoxesRef.current[sectionIndex];
    if (!p || !trackBox) return;

    setRuntimeError(null);

    if (isPlaying) {
      p.engine.stop(true);
      setPlayingSectionIndex(null);
    }

    const ok = applyAutomationEvents(p, trackBox, TRACK_CONFIGS[sectionIndex].presets[presetIndex].events);
    if (!ok) {
      setRuntimeError("Could not write the automation region — the preset was not applied. Try selecting it again.");
      return;
    }

    setActivePresets(prev => {
      const next = [...prev];
      next[sectionIndex] = presetIndex;
      return next;
    });
  };

  const clearAutomationForSection = (sectionIndex: number) => {
    const p = projectRef.current;
    const trackBox = automationTrackBoxesRef.current[sectionIndex];
    if (!p || !trackBox) return;

    // Remove all regions from this automation track via the adapter layer
    const trackAdapter = p.boxAdapters.adapterFor(trackBox, TrackBoxAdapter);
    const existingAdapters = trackAdapter.regions.adapters.values()
      .filter(r => r.isValueRegion());
    if (existingAdapters.length > 0) {
      p.editing.modify(() => {
        for (const adapter of existingAdapters) {
          const collectionOpt = adapter.optCollection;
          if (collectionOpt.nonEmpty()) {
            collectionOpt
              .unwrap()
              .events.asArray()
              .forEach((evt: any) => evt.box.delete());
          }
          adapter.box.delete();
        }
      });
    }
  };

  const handlePlaySection = async (sectionIndex: number) => {
    const p = projectRef.current;
    const ac = audioContextRef.current;
    if (!p || !ac) return;

    setRuntimeError(null);

    try {
      // Stop if currently playing
      if (isPlaying) {
        p.engine.stop(true);
      }

      // Ensure AudioContext is running (with 5s timeout for iOS)
      if (ac.state !== "running") {
        await ac.resume();
        if (ac.state !== "running") {
          await Promise.race([
            new Promise<void>(resolve => {
              const handler = () => {
                if (ac.state === "running") {
                  ac.removeEventListener("statechange", handler);
                  resolve();
                }
              };
              ac.addEventListener("statechange", handler);
            }),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("AudioContext failed to resume within 5 seconds")), 5000)
            ),
          ]);
        }
      }

      // Clear automation from all other sections
      for (let i = 0; i < TRACK_CONFIGS.length; i++) {
        if (i !== sectionIndex) {
          clearAutomationForSection(i);
        }
      }

      // Ensure the active section's automation is applied
      const trackBox = automationTrackBoxesRef.current[sectionIndex];
      if (!trackBox) {
        setRuntimeError("Automation track for this section is missing — reload the page.");
        return;
      }
      const presetIndex = activePresets[sectionIndex];
      const ok = applyAutomationEvents(p, trackBox, TRACK_CONFIGS[sectionIndex].presets[presetIndex].events);
      if (!ok) {
        setRuntimeError("Could not write the automation region — the preset was not applied. Try selecting it again.");
        return;
      }

      setPlayingSectionIndex(sectionIndex);
      p.engine.setPosition(PLAYBACK_START);
      p.engine.play();
    } catch (error) {
      console.error("Failed to start playback:", error);
      setRuntimeError(error instanceof Error ? error.message : String(error));
      setPlayingSectionIndex(null);
    }
  };

  const handleStop = () => {
    const p = projectRef.current;
    if (!p) return;
    p.engine.stop(true);
    setPlayingSectionIndex(null);
  };

  // Build full project JSON — memoized so it doesn't re-run per frame during playback
  // (usePlaybackPosition re-renders per frame; this only needs recompute on preset changes).
  const fullProjectJson = useMemo(() => {
    const trackData = TRACK_CONFIGS.map((config, i) => {
      const preset = config.presets[activePresets[i]];
      return eventsToJson(preset.events, config.parameterName, targetUnitId);
    });

    return {
      project: {
        bpm: BPM,
        timeSignature: { numerator: 4, denominator: 4 },
        duration: { bars: NUM_BARS, ppqn: TOTAL_PPQN },
        loop: { enabled: true, from: PLAYBACK_START, to: PLAYBACK_END },
        tracks: [
          {
            type: "audio",
            name: "Guitar",
            unitId: targetUnitId
          }
        ],
        automation: trackData.map(d => d.automationTrack)
      }
    };
  }, [activePresets, targetUnitId]);

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Automation — Track Parameters · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              TRACK AUTOMATION
            </h1>
            <p className="mc-intro">
              Automate volume, pan, and reverb wet on a real guitar stem. Each preset writes
              a value region onto a lane made with <code>createAutomationTrack</code> — the
              canvases plot <code>Curve.normalizedAt</code>, the same math the engine
              evaluates, and each section shows the JSON a server would store to restore it.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{initError}</Callout.Text>
            </Callout.Root>
          ) : !isReady ? (
            <Text align="center">{status}</Text>
          ) : (
            <Flex direction="column" gap="5">
              {runtimeError && (
                <Callout.Root color="red">
                  <Callout.Icon>
                    <InfoCircledIcon />
                  </Callout.Icon>
                  <Callout.Text>{runtimeError}</Callout.Text>
                </Callout.Root>
              )}

              {/* Persistent init warning — not cleared by user actions, unlike runtimeError */}
              {initWarning && (
                <Callout.Root color="yellow">
                  <Callout.Icon>
                    <InfoCircledIcon />
                  </Callout.Icon>
                  <Callout.Text>{initWarning}</Callout.Text>
                </Callout.Root>
              )}

              {/* Automation Sections */}
              {TRACK_CONFIGS.map((config, sectionIndex) => (
                <AutomationSection
                  key={config.label}
                  config={config}
                  activePresetIndex={activePresets[sectionIndex]}
                  onPresetSelect={presetIndex => handlePresetSelect(sectionIndex, presetIndex)}
                  onPlay={() => handlePlaySection(sectionIndex)}
                  onStop={handleStop}
                  playheadPosition={playheadPosition as ppqn}
                  isActiveSection={playingSectionIndex === sectionIndex}
                  isPlaying={isPlaying}
                  targetUnitId={targetUnitId}
                />
              ))}

              {/* Full Project Data */}
              <Card size="3">
                <Flex direction="column" gap="3">
                  <h2 className="mc-name">Full Project Data</h2>
                  <Text size="2" color="gray">
                    Combined automation data for all tracks, ready for server persistence.
                  </Text>
                  <ServerDataBlock data={fullProjectJson} label="Full project JSON" />
                </Flex>
              </Card>

              <section className="mc-anchors">
                <h2 className="mc-anchors-head">SDK reference</h2>
                <p>
                  <code>project.api.createAutomationTrack(audioUnitBox, parameterField)</code>{" "}
                  adds a value lane targeting any automatable field — unit volume and pan,
                  or an effect parameter like reverb <code>wet</code>.{" "}
                  <code>createTrackRegion</code> then holds the events; event positions are
                  LOCAL to the region (0 to duration), not absolute timeline PPQN. Event
                  values are unitValue 0–1 — <code>AudioUnitBoxAdapter.VolumeMapper</code>{" "}
                  converts between unitValue and dB (<code>.x(0)</code> ≈ 0.734 is 0 dB).
                </p>
                <Code
                  size="2"
                  style={{
                    display: "block",
                    padding: "12px",
                    backgroundColor: "var(--gray-3)",
                    borderRadius: "4px",
                    whiteSpace: "pre-wrap",
                    marginTop: "12px",
                  }}
                >
{`let trackBox: TrackBox | null = null;
project.editing.modify(() => {
  trackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume);
});

project.editing.modify(() => {
  const regionBox = project.api.createTrackRegion(trackBox, position, duration)
    .unwrap() as ValueRegionBox;
  const collection = project.boxAdapters
    .adapterFor(regionBox, ValueRegionBoxAdapter).optCollection.unwrap();
  collection.createEvent({
    position: 0,  // region-LOCAL PPQN, not absolute
    index: 0,
    value: AudioUnitBoxAdapter.VolumeMapper.x(0), // unitValue for 0 dB
    interpolation: Interpolation.Curve(0.25),
  });
});`}
                </Code>
                <p>
                  <a href="/docs/09-editing-fades-and-automation.html">Editing, fades &amp; automation</a>
                </p>
              </section>
            </Flex>
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
