import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { Curve } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { getAllAudioRegions } from "@/lib/adapterUtils";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Text,
  Flex,
  Card,
  Badge,
  Code,
  Button,
} from "@radix-ui/themes";
import { PlayIcon, StopIcon } from "@radix-ui/react-icons";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

/**
 * Fade curve types with their slope values
 */
const FADE_TYPES = [
  {
    name: "Logarithmic",
    slope: 0.25,
    description: "Slow start, fast end - smooth and natural sounding",
    color: "#f59e0b", // amber
  },
  {
    name: "Linear",
    slope: 0.5,
    description: "Even progression - simple and predictable",
    color: "#3b82f6", // blue
  },
  {
    name: "Exponential",
    slope: 0.75,
    description: "Fast start, slow end - punchy attack",
    color: "#10b981", // emerald
  },
] as const;

/**
 * Component to visualize a fade curve
 */
const FadeCurveCanvas: React.FC<{
  slope: number;
  color: string;
  width?: number;
  height?: number;
  isFadeOut?: boolean;
}> = ({ slope, color, width = 100, height = 50, isFadeOut = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw background grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw curve
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    const padding = 4;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    for (let i = 0; i <= drawWidth; i++) {
      const x = i / drawWidth; // 0 to 1
      let y = Curve.normalizedAt(x, slope);

      // For fade-out, invert the curve
      if (isFadeOut) {
        y = 1 - Curve.normalizedAt(x, slope);
      }

      const canvasX = padding + i;
      const canvasY = padding + (1 - y) * drawHeight;

      if (i === 0) {
        ctx.moveTo(canvasX, canvasY);
      } else {
        ctx.lineTo(canvasX, canvasY);
      }
    }
    ctx.stroke();
  }, [slope, color, width, height, isFadeOut]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        borderRadius: "4px",
        backgroundColor: "rgba(0, 0, 0, 0.3)",
      }}
    />
  );
};

// Clip positioning: bar 18 is where the guitar has audio content
const CLIP_START_BAR = 17; // 0-indexed, so bar 18
const CLIP_LENGTH_BARS = 4;

/**
 * Main Clip Fades Demo Component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingClipIndex, setPlayingClipIndex] = useState<number | null>(null);

  // Store region info for each clip
  const clipDataRef = useRef<Array<{ position: number; duration: number }>>([]);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  const BPM = 124; // Match Dark Ride BPM
  const FADE_DURATION_BEATS = 2;
  const FADE_DURATION_PPQN = PPQN.Quarter * FADE_DURATION_BEATS;

  // Clip position and duration in PPQN
  const clipStartPPQN = PPQN.Bar * CLIP_START_BAR;
  const clipDurationPPQN = PPQN.Bar * CLIP_LENGTH_BARS;

  // Initialize OpenDAW and create clips
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setStatus("Initializing OpenDAW...");

        const localAudioBuffers = new Map<string, AudioBuffer>();
        localAudioBuffersRef.current = localAudioBuffers;

        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);

        // Subscribe to playback state
        newProject.engine.isPlaying.catchupAndSubscribe(obs => {
          if (!mounted) return;
          const playing = obs.getValue();
          setIsPlaying(playing);
          if (!playing) {
            setPlayingClipIndex(null);
          }
        });

        const ext = getAudioExtension();
        setStatus("Loading guitar tracks...");

        // Load 3 separate tracks (one for each fade type) using the proven loadTracksFromFiles.
        // This creates full-duration regions at position=0, which we'll trim below.
        await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [
            { name: "Logarithmic Fade", file: `/audio/DarkRide/04_ElecGtrs.${ext}` },
            { name: "Linear Fade", file: `/audio/DarkRide/04_ElecGtrs.${ext}` },
            { name: "Exponential Fade", file: `/audio/DarkRide/04_ElecGtrs.${ext}` },
          ],
          localAudioBuffers,
          {
            autoSetLoopEnd: false,
            onProgress: (current, total, name) => {
              if (mounted) setStatus(`Loading ${name} (${current}/${total})...`);
            },
          }
        );

        if (!mounted) return;

        setStatus("Applying fades to clips...");

        // Find the audio region adapters via the adapter layer
        const regionAdapters: AudioRegionBoxAdapter[] = getAllAudioRegions(newProject);

        // Sort to match FADE_TYPES order (by label name)
        const fadeTypeIndex = (label: string) => FADE_TYPES.findIndex(ft => label.startsWith(ft.name));
        regionAdapters.sort((a, b) =>
          fadeTypeIndex(a.box.label.getValue()) - fadeTypeIndex(b.box.label.getValue())
        );

        console.debug(`[ClipFades] Found ${regionAdapters.length} audio regions`);

        // Trim regions to short clips at bar 18 and apply fades.
        //
        // loadTracksFromFiles creates regions with:
        //   position=0, loopOffset=0, loopDuration=fullAudioPPQN
        //
        // With that config, playing from bar 18 puts us at startPpqn=65280 relative
        // to the region start (position=0). Since fadeIn=1920, the early-return in
        // fillGainBuffer triggers (65280 >= 1920) and gain stays at 1.0 — fades are
        // never audible.
        //
        // Fix: reposition regions to bar 18 with a short duration (4 bars).
        // Set loopOffset=bar18 so the engine reads audio from bar 18 in the file.
        // Now when playing from bar 18, startPpqn = 65280 - 65280 = 0, which IS
        // in the fade-in zone. The 2-beat fade-in/out will be clearly audible.
        const clipData: Array<{ position: number; duration: number }> = [];

        // Trim regions to short clips, set labels, and apply fades
        newProject.editing.modify(() => {
          regionAdapters.forEach((adapter, index) => {
            if (index < FADE_TYPES.length) {
              const fadeType = FADE_TYPES[index];

              // Reposition and trim
              adapter.box.position.setValue(clipStartPPQN);
              adapter.box.duration.setValue(clipDurationPPQN);
              adapter.box.loopOffset.setValue(clipStartPPQN);
              // Keep loopDuration at full audio length (already set by loadTracksFromFiles)
              adapter.box.label.setValue(fadeType.name);

              // Apply fades
              adapter.fading.inField.setValue(FADE_DURATION_PPQN);
              adapter.fading.outField.setValue(FADE_DURATION_PPQN);
              adapter.fading.inSlopeField.setValue(fadeType.slope);
              adapter.fading.outSlopeField.setValue(fadeType.slope);

              clipData.push({
                position: clipStartPPQN,
                duration: clipDurationPPQN,
              });
            }
          });
        });

        clipDataRef.current = clipData;

        // Enable looping from bar 18 to bar 22 (4 bars, matching clip duration)
        newProject.editing.modify(() => {
          newProject.timelineBox.loopArea.from.setValue(clipStartPPQN);
          newProject.timelineBox.loopArea.to.setValue(clipStartPPQN + clipDurationPPQN);
          newProject.timelineBox.loopArea.enabled.setValue(true);
        });

        if (mounted) {
          setStatus("Ready to play!");
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

  // Play/stop toggle for a specific clip (track)
  const handleToggleClip = useCallback(
    async (clipIndex: number) => {
      if (!project || !audioContext) return;

      // If this clip is already playing, stop it
      if (playingClipIndex === clipIndex && isPlaying) {
        project.engine.stop(true);
        setPlayingClipIndex(null);
        return;
      }

      // Resume AudioContext if suspended (iOS Safari can re-suspend after backgrounding)
      if (audioContext.state !== "running") {
        await audioContext.resume();
        // After resume(), state may not be "running" yet on iOS Safari
        await new Promise<void>(resolve => {
          if (audioContext.state === ("running" as AudioContextState)) {
            resolve();
            return;
          }
          const handler = () => {
            if (audioContext.state === ("running" as AudioContextState)) {
              audioContext.removeEventListener("statechange", handler);
              resolve();
            }
          };
          audioContext.addEventListener("statechange", handler);
        });
      }

      // Get all audio region adapters via the adapter layer
      const regionAdapters: AudioRegionBoxAdapter[] = getAllAudioRegions(project);

      // Sort to match FADE_TYPES order (by label name)
      const fadeTypeIndex = (label: string) => FADE_TYPES.findIndex(ft => label.startsWith(ft.name));
      regionAdapters.sort((a, b) =>
        fadeTypeIndex(a.box.label.getValue()) - fadeTypeIndex(b.box.label.getValue())
      );

      // Mute all tracks except the one we want to play
      project.editing.modify(() => {
        regionAdapters.forEach((adapter, index) => {
          adapter.box.mute.setValue(index !== clipIndex);
        });
      });

      setPlayingClipIndex(clipIndex);

      // Start playback at bar 18 where the clips are positioned
      project.engine.setPosition(clipStartPPQN);
      project.engine.play();
    },
    [project, audioContext, playingClipIndex, isPlaying, clipStartPPQN]
  );

  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <div>
            <div className="mc-kicker">Playback — Clip Fades · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>CLIP FADES</h1>
            <p className="mc-intro">
              Listen to how different fade curve shapes affect the sound. Each track has a{" "}
              2-beat fade-in and 2-beat fade-out using the same curve type. Clips are trimmed
              to bar 18 so the region start falls at playback position — making fades audible
              from the first beat. Click individual tracks to compare.
            </p>
          </div>

          {/* Status */}
          <Card>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">
                Status:
              </Text>
              <Badge color={status.includes("Error") ? "red" : status.includes("Ready") ? "green" : "blue"} size="2">
                {status}
              </Badge>
            </Flex>
          </Card>

          {/* Clip Cards */}
          <Flex direction="column" gap="3">
            {FADE_TYPES.map((fadeType, index) => {
              const isCurrentlyPlaying = playingClipIndex === index && isPlaying;

              return (
                <Card
                  key={fadeType.name}
                  style={{
                    backgroundColor: isCurrentlyPlaying ? "var(--accent-3)" : "var(--gray-2)",
                    border: isCurrentlyPlaying ? "2px solid var(--accent-9)" : "2px solid transparent",
                    transition: "all 0.2s ease",
                  }}
                >
                  <Flex gap="4" align="center">
                    {/* Play/Stop toggle button */}
                    <Button
                      onClick={() => handleToggleClip(index)}
                      disabled={!project || status !== "Ready to play!"}
                      color={isCurrentlyPlaying ? "red" : "gray"}
                      variant={isCurrentlyPlaying ? "solid" : "soft"}
                      size="3"
                      style={{ minWidth: "100px" }}
                    >
                      {isCurrentlyPlaying ? (
                        <>
                          <StopIcon /> Stop
                        </>
                      ) : (
                        <>
                          <PlayIcon /> Play
                        </>
                      )}
                    </Button>

                    {/* Clip info */}
                    <Flex direction="column" gap="1" style={{ flex: 1 }}>
                      <Flex align="center" gap="2">
                        <Badge
                          size="2"
                          style={{
                            backgroundColor: fadeType.color,
                            color: "white",
                          }}
                        >
                          Track {index + 1}
                        </Badge>
                        <Text size="4" weight="bold">
                          {fadeType.name}
                        </Text>
                        <Code size="2">slope: {fadeType.slope}</Code>
                      </Flex>
                      <Text size="2" color="gray">
                        {fadeType.description}
                      </Text>
                    </Flex>

                    {/* Curve visualizations */}
                    <Flex gap="3" align="center">
                      <Flex direction="column" align="center" gap="1">
                        <Text size="1" color="gray">
                          Fade In
                        </Text>
                        <FadeCurveCanvas slope={fadeType.slope} color={fadeType.color} />
                      </Flex>
                      <Flex direction="column" align="center" gap="1">
                        <Text size="1" color="gray">
                          Fade Out
                        </Text>
                        <FadeCurveCanvas slope={fadeType.slope} color={fadeType.color} isFadeOut />
                      </Flex>
                    </Flex>
                  </Flex>
                </Card>
              );
            })}
          </Flex>

          {/* SDK reference + attribution */}
          <section className="mc-anchors">
            <h2 className="mc-anchors-head">SDK reference</h2>
            <p>
              Fades are region-relative: the engine computes{" "}
              <code>startPpqn = cycle.resultStart − regionPosition</code>. Set{" "}
              <code>loopOffset = clipStartPPQN</code> so the region reads audio from the
              correct file position without shifting <code>startPpqn</code> away from the
              fade-in zone. Slope values: <code>0.25</code> = logarithmic (SDK{" "}
              <code>outSlope</code> default), <code>0.5</code> = linear,{" "}
              <code>0.75</code> = exponential (SDK <code>inSlope</code> default).
              OpenDAW&rsquo;s single-parameter curve is monotonic — S-curves require gain
              automation with multiple control points.
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
              {`project.editing.modify(() => {
  // Trim region to the section with audio content
  regionBox.position.setValue(clipStartPPQN);
  regionBox.duration.setValue(clipDurationPPQN);
  regionBox.loopOffset.setValue(clipStartPPQN);   // audio read offset

  // Fade durations in PPQN (960 = 1 beat at any BPM)
  regionBox.fading.in.setValue(1920);       // 2-beat fade-in
  regionBox.fading.out.setValue(1920);      // 2-beat fade-out
  regionBox.fading.inSlope.setValue(0.75);  // exponential (SDK default)
  regionBox.fading.outSlope.setValue(0.25); // logarithmic (SDK default)
});`}
            </Code>
            <p>
              <a href="/docs/09-editing-fades-and-automation.html">Editing, fades &amp; automation</a>
              {" "}&middot;{" "}
              <a href="/docs/04-box-system-and-reactivity.html">Box system &amp; reactivity</a>
              {" "}&middot;{" "}
              Guitar stems from Dark Ride&rsquo;s &lsquo;Deny Control&rsquo; via{" "}
              <a href="https://www.cambridge-mt.com" target="_blank" rel="noopener noreferrer">cambridge-mt.com</a>
            </p>
          </section>
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
