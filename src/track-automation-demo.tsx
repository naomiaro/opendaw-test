import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Button, Card } from "@radix-ui/themes";
import { Project, EffectFactories } from "@opendaw/studio-core";
import { AudioRegionBox, AudioUnitBox, ReverbDeviceBox, TrackBox, ValueRegionBox } from "@opendaw/studio-boxes";
import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Curve, UUID } from "@opendaw/lib-std";
import { AudioUnitBoxAdapter, ValueRegionBoxAdapter } from "@opendaw/studio-adapters";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";

// 4/4 time: one bar = 3840 PPQN
const BAR = PPQN.fromSignature(4, 4); // 3840
const BPM = 124; // Match Dark Ride BPM
const NUM_BARS = 8;
const TOTAL_PPQN = BAR * NUM_BARS; // 30720

// Start at bar 17 of the guitar track (skip silence at the beginning)
const PLAYBACK_START = (BAR * 16) as ppqn; // bar 17 = 16 bars in
const PLAYBACK_END = (PLAYBACK_START + TOTAL_PPQN) as ppqn;

// ─── Automation Event Types ──────────────────────────────────────────────

type AutomationEvent = {
  position: ppqn;
  value: number; // unitValue 0..1
  interpolation: Interpolation;
};

type AutomationPreset = {
  name: string;
  events: AutomationEvent[];
};

type AutomationTrackConfig = {
  label: string;
  parameterName: string;
  color: string;
  yLabels: { value: number; label: string }[];
  presets: AutomationPreset[];
};

// unitValue that maps to 0 dB through the VolumeMapper
const VOLUME_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0);

// ─── Preset Definitions ─────────────────────────────────────────────────

const volumePresets: AutomationPreset[] = [
  {
    name: "Fade In",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.Curve(0.25) },
      { position: (BAR * 4) as ppqn, value: VOLUME_0DB, interpolation: Interpolation.None }
    ]
  },
  {
    name: "Fade Out",
    events: [
      { position: 0 as ppqn, value: VOLUME_0DB, interpolation: Interpolation.Curve(0.75) },
      { position: (BAR * 8) as ppqn, value: 0.0, interpolation: Interpolation.None }
    ]
  },
  {
    name: "Swell",
    events: [
      { position: 0 as ppqn, value: 0.2, interpolation: Interpolation.Curve(0.75) },
      { position: (BAR * 4) as ppqn, value: 1.0, interpolation: Interpolation.Curve(0.25) },
      { position: (BAR * 8) as ppqn, value: 0.2, interpolation: Interpolation.None }
    ]
  },
  {
    name: "Ducking",
    events: [
      { position: 0 as ppqn, value: 1.0, interpolation: Interpolation.Linear },
      { position: (BAR * 2) as ppqn, value: 1.0, interpolation: Interpolation.Curve(0.75) },
      { position: (BAR * 3) as ppqn, value: 0.2, interpolation: Interpolation.None },
      { position: (BAR * 5) as ppqn, value: 0.2, interpolation: Interpolation.Curve(0.25) },
      { position: (BAR * 6) as ppqn, value: 1.0, interpolation: Interpolation.Linear },
      { position: (BAR * 8) as ppqn, value: 1.0, interpolation: Interpolation.None }
    ]
  }
];

const panPresets: AutomationPreset[] = [
  {
    name: "L-R Sweep",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.Linear },
      { position: (BAR * 8) as ppqn, value: 1.0, interpolation: Interpolation.Linear }
    ]
  },
  {
    name: "Ping-Pong",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.Linear },
      { position: (BAR * 2) as ppqn, value: 1.0, interpolation: Interpolation.Linear },
      { position: (BAR * 4) as ppqn, value: 0.0, interpolation: Interpolation.Linear },
      { position: (BAR * 6) as ppqn, value: 1.0, interpolation: Interpolation.Linear },
      { position: (BAR * 8) as ppqn, value: 0.0, interpolation: Interpolation.Linear }
    ]
  },
  {
    name: "Center Hold",
    events: [
      { position: 0 as ppqn, value: 0.5, interpolation: Interpolation.None },
      { position: (BAR * 8) as ppqn, value: 0.5, interpolation: Interpolation.None }
    ]
  }
];

const reverbWetPresets: AutomationPreset[] = [
  {
    name: "Dry to Wet",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.Curve(0.25) },
      { position: (BAR * 8) as ppqn, value: 1.0, interpolation: Interpolation.Linear }
    ]
  },
  {
    name: "Wet to Dry",
    events: [
      { position: 0 as ppqn, value: 1.0, interpolation: Interpolation.Curve(0.75) },
      { position: (BAR * 8) as ppqn, value: 0.0, interpolation: Interpolation.Linear }
    ]
  },
  {
    name: "Pulse",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.None },
      { position: (BAR * 2) as ppqn, value: 0.8, interpolation: Interpolation.None },
      { position: (BAR * 4) as ppqn, value: 0.0, interpolation: Interpolation.None },
      { position: (BAR * 6) as ppqn, value: 0.8, interpolation: Interpolation.None },
      { position: (BAR * 8) as ppqn, value: 0.0, interpolation: Interpolation.None }
    ]
  }
];

const TRACK_CONFIGS: AutomationTrackConfig[] = [
  {
    label: "Volume",
    parameterName: "volume",
    color: "#a855f7",
    yLabels: [
      { value: 1.0, label: "+6 dB" },
      { value: VOLUME_0DB, label: "0 dB" },
      { value: 0.5, label: "-9 dB" },
      { value: 0.0, label: "-∞ dB" }
    ],
    presets: volumePresets
  },
  {
    label: "Pan",
    parameterName: "panning",
    color: "#38bdf8",
    yLabels: [
      { value: 1.0, label: "R" },
      { value: 0.5, label: "C" },
      { value: 0.0, label: "L" }
    ],
    presets: panPresets
  },
  {
    label: "Reverb Wet",
    parameterName: "wet",
    color: "#34d399",
    yLabels: [
      { value: 1.0, label: "Wet" },
      { value: 0.5, label: "50%" },
      { value: 0.0, label: "Dry" }
    ],
    presets: reverbWetPresets
  }
];

// ─── Helper: Apply Automation Events to a Track ─────────────────────────

function applyAutomationEvents(project: Project, trackBox: TrackBox, events: AutomationEvent[]): void {
  // Snapshot existing regions BEFORE creating new ones
  const boxes = project.boxGraph.boxes();
  const existingRegions = boxes.filter(
    (box: any) =>
      box instanceof ValueRegionBox &&
      box.regions.targetVertex.nonEmpty() &&
      box.regions.targetVertex.unwrap().box === trackBox
  );

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

    // Event positions are LOCAL to the region (0 to duration)
    for (const evt of events) {
      collection.createEvent({
        position: evt.position,
        index: 0,
        value: evt.value,
        interpolation: evt.interpolation
      });
    }
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
}

// ─── Helper: Convert Events to JSON for Server Persistence ──────────────

function interpolationToJson(interp: Interpolation): Record<string, unknown> {
  if (interp.type === "none") return { type: "none" };
  if (interp.type === "linear") return { type: "linear" };
  return { type: "curve", slope: (interp as { type: "curve"; slope: number }).slope };
}

function eventsToJson(events: AutomationEvent[], parameterName: string, targetUnitId: string): Record<string, unknown> {
  return {
    automationTrack: {
      targetParameter: parameterName,
      targetUnitId,
      enabled: true,
      events: events.map((evt, i) => ({
        position: evt.position,
        value: evt.value,
        index: i > 0 && events[i - 1].position === evt.position ? 1 : 0,
        interpolation: interpolationToJson(evt.interpolation)
      }))
    }
  };
}

// ─── Canvas Component ───────────────────────────────────────────────────

const CANVAS_HEIGHT = 150;

interface AutomationCanvasProps {
  events: AutomationEvent[];
  color: string;
  yLabels: { value: number; label: string }[];
  playheadPosition: ppqn;
  isPlaying: boolean;
}

const AutomationCanvas: React.FC<AutomationCanvasProps> = ({ events, color, yLabels, playheadPosition, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = CANVAS_HEIGHT;
    if (width <= 0 || height <= 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const padLeft = 48;
    const padRight = 8;
    const padTop = 14;
    const padBottom = 18;
    const drawWidth = width - padLeft - padRight;
    const drawHeight = height - padTop - padBottom;

    // Clear and draw background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    const toX = (ppqnPos: number) => padLeft + (ppqnPos / TOTAL_PPQN) * drawWidth;
    const toY = (value: number) => padTop + drawHeight - value * drawHeight;

    // Grid lines (bar lines)
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let bar = 0; bar <= NUM_BARS; bar++) {
      const x = toX(bar * BAR);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);
      ctx.stroke();

      if (bar < NUM_BARS) {
        ctx.fillStyle = "#666";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${bar + 1}`, x + 4, height - 4);
      }
    }

    // Y-axis labels and horizontal guide lines
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    for (const yl of yLabels) {
      const y = toY(yl.value);
      ctx.fillStyle = "#888";
      ctx.fillText(yl.label, padLeft - 6, y + 4);
      // horizontal guide line
      ctx.strokeStyle = "#222";
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
    }

    // Draw automation curve
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    if (events.length > 0) {
      for (let i = 0; i < events.length; i++) {
        const evt = events[i];
        const x = toX(evt.position);
        const y = toY(evt.value);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prev = events[i - 1];
          const prevX = toX(prev.position);
          const prevY = toY(prev.value);

          if (prev.interpolation.type === "none") {
            // Step: horizontal then vertical
            ctx.lineTo(x, prevY);
            ctx.lineTo(x, y);
          } else if (prev.interpolation.type === "linear") {
            ctx.lineTo(x, y);
          } else if (prev.interpolation.type === "curve") {
            // Use SDK's Curve.normalizedAt for pixel-accurate rendering
            const slope = prev.interpolation.slope;
            const segments = Math.max(20, Math.round(x - prevX));
            for (let s = 1; s <= segments; s++) {
              const t = s / segments;
              const normalized = Curve.normalizedAt(t, slope);
              const val = prev.value + normalized * (evt.value - prev.value);
              ctx.lineTo(prevX + (x - prevX) * t, toY(val));
            }
          }
        }
      }

      // Extend last event value to end of timeline
      const lastEvt = events[events.length - 1];
      if (lastEvt.position < TOTAL_PPQN) {
        const lastY = toY(lastEvt.value);
        ctx.lineTo(toX(TOTAL_PPQN), lastY);
      }
    }
    ctx.stroke();

    // Dots at event points
    ctx.fillStyle = color;
    for (const evt of events) {
      ctx.beginPath();
      ctx.arc(toX(evt.position), toY(evt.value), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Playhead (offset from PLAYBACK_START to match canvas 0-based positions)
    const relativePlayhead = playheadPosition - PLAYBACK_START;
    if (isPlaying && relativePlayhead >= 0) {
      const px = toX(relativePlayhead);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, height - padBottom);
      ctx.stroke();
    }
  }, [events, color, yLabels, playheadPosition, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: CANVAS_HEIGHT,
        border: "1px solid var(--gray-6)"
      }}
    />
  );
};

// ─── Server Data Block Component ────────────────────────────────────────

interface ServerDataBlockProps {
  data: Record<string, unknown>;
  label: string;
}

const ServerDataBlock: React.FC<ServerDataBlockProps> = ({ data, label }) => {
  return (
    <details style={{ marginTop: 4 }}>
      <summary
        style={{
          cursor: "pointer",
          color: "var(--gray-9)",
          fontSize: 13,
          userSelect: "none"
        }}
      >
        {label}
      </summary>
      <pre
        style={{
          background: "#0d0d1a",
          border: "1px solid var(--gray-6)",
          borderRadius: "var(--radius-2)",
          padding: 12,
          fontSize: 12,
          overflow: "auto",
          maxHeight: 300,
          color: "var(--gray-11)",
          marginTop: 4
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
  const jsonData = eventsToJson(activePreset.events, config.parameterName, targetUnitId);
  const showPlayhead = isActiveSection && isPlaying;

  return (
    <Card size="3">
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between">
          <Flex align="center" gap="2">
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: config.color,
                flexShrink: 0
              }}
            />
            <Heading size="4">{config.label} Automation</Heading>
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
                  ? { backgroundColor: config.color, color: "#000" }
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
          isPlaying={showPlayhead}
        />

        <ServerDataBlock data={jsonData} label="Server persistence data" />
      </Flex>
    </Card>
  );
};

// ─── Main App ───────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [targetUnitId, setTargetUnitId] = useState("");

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
          setStatus("Error: Failed to load audio track. Check the browser console.");
          return;
        }

        const { audioUnitBox } = tracks[0];
        audioUnitBoxRef.current = audioUnitBox;
        setTargetUnitId(UUID.toString(audioUnitBox.address.uuid));

        // Trim the audio region: position at bar 17, read from bar 17 of audio, 8 bars long
        const boxes = newProject.boxGraph.boxes();
        const audioRegion = boxes.find(
          (box: any) => box instanceof AudioRegionBox && box.label?.getValue?.() === "Guitar"
        );
        if (audioRegion) {
          newProject.editing.modify(() => {
            (audioRegion as AudioRegionBox).position.setValue(PLAYBACK_START);
            (audioRegion as AudioRegionBox).duration.setValue(TOTAL_PPQN);
            (audioRegion as AudioRegionBox).loopOffset.setValue(PLAYBACK_START);
          });
        } else {
          console.warn('Could not find AudioRegionBox with label "Guitar" — audio may play from wrong position');
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
          applyAutomationEvents(newProject, trackBoxes[0], TRACK_CONFIGS[0].presets[0].events);
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
          setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
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

    if (isPlaying) {
      p.engine.stop(true);
      setPlayingSectionIndex(null);
    }

    setActivePresets(prev => {
      const next = [...prev];
      next[sectionIndex] = presetIndex;
      return next;
    });

    applyAutomationEvents(p, trackBox, TRACK_CONFIGS[sectionIndex].presets[presetIndex].events);
  };

  const clearAutomationForSection = (sectionIndex: number) => {
    const p = projectRef.current;
    const trackBox = automationTrackBoxesRef.current[sectionIndex];
    if (!p || !trackBox) return;

    // Remove all regions from this automation track
    const boxes = p.boxGraph.boxes();
    const existingRegions = boxes.filter(
      (box: any) =>
        box instanceof ValueRegionBox &&
        box.regions.targetVertex.nonEmpty() &&
        box.regions.targetVertex.unwrap().box === trackBox
    );
    if (existingRegions.length > 0) {
      p.editing.modify(() => {
        for (const region of existingRegions) {
          const adapter = p.boxAdapters.adapterFor(region, ValueRegionBoxAdapter);
          const collectionOpt = adapter.optCollection;
          if (collectionOpt.nonEmpty()) {
            collectionOpt
              .unwrap()
              .events.asArray()
              .forEach((evt: any) => evt.box.delete());
          }
          region.delete();
        }
      });
    }
  };

  const handlePlaySection = async (sectionIndex: number) => {
    const p = projectRef.current;
    const ac = audioContextRef.current;
    if (!p || !ac) return;

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
      const presetIndex = activePresets[sectionIndex];
      applyAutomationEvents(p, trackBox, TRACK_CONFIGS[sectionIndex].presets[presetIndex].events);

      setPlayingSectionIndex(sectionIndex);
      p.engine.setPosition(PLAYBACK_START);
      p.engine.play();
    } catch (error) {
      console.error("Failed to start playback:", error);
      setPlayingSectionIndex(null);
    }
  };

  const handleStop = () => {
    const p = projectRef.current;
    if (!p) return;
    p.engine.stop(true);
    setPlayingSectionIndex(null);
  };

  // Build full project JSON
  const buildFullProjectJson = () => {
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
  };

  return (
    <Theme appearance="dark" accentColor="purple" radius="large">
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading
              size="8"
              style={{
                background: "linear-gradient(135deg, #a855f7 0%, #38bdf8 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text"
              }}
            >
              Track Automation
            </Heading>
            <Text size="3" color="gray" align="center">
              Automate volume, pan, and reverb parameters with visual envelopes
            </Text>
          </Flex>

          {!isReady ? (
            <Text align="center">{status}</Text>
          ) : (
            <Flex direction="column" gap="5">
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
                  <Heading size="4">Full Project Data</Heading>
                  <Text size="2" color="gray">
                    Combined automation data for all tracks, ready for server persistence.
                  </Text>
                  <ServerDataBlock data={buildFullProjectJson()} label="Full project JSON" />
                </Flex>
              </Card>
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
