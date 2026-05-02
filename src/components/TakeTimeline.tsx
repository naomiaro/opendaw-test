import React, { useRef, useEffect } from "react";
import { Flex, Text, Button, Badge } from "@radix-ui/themes";
import type { SampleLoader } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { PPQN } from "@opendaw/lib-dsp";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { CanvasPainter } from "../lib/CanvasPainter";

// --- Types ---

export interface TakeRegion {
  regionBox: AudioRegionBox;
  inputTapeId: string;
  takeNumber: number;
  isMuted: boolean;
  sampleLoader: SampleLoader | null;
  waveformOffsetFrames: number;
  durationFrames: number;
}

export interface TakeIteration {
  takeNumber: number;
  isLeadIn: boolean;
  regions: TakeRegion[];
  isMuted: boolean;
}

interface TakeTimelineProps {
  takeIterations: TakeIteration[];
  recordingTapeLabels: { id: string; label: string }[];
  currentPosition: number;
  leadInBars: number;
  loopLengthBars: number;
  isRecording: boolean;
  isPlaying: boolean;
  sampleRate: number;
  onToggleMute: (takeNumber: number) => void;
}

// --- Constants ---

const LANE_HEIGHT = 40;
const CONTROLS_WIDTH = 120;

// --- Sub-components ---

/** Renders a single tape's waveform within a take.
 *  Uses refs so the CanvasPainter survives across React re-renders.
 *  Duration is read live from the box graph each frame. */
const TakeWaveformCanvas: React.FC<{
  region: TakeRegion;
  height: number;
  isMuted: boolean;
  sampleRate: number;
}> = ({ region, height, isMuted, sampleRate }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const regionRef = useRef(region);
  const isMutedRef = useRef(isMuted);

  // Update refs on every render — painter reads these without recreation
  regionRef.current = region;
  isMutedRef.current = isMuted;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const painter = new CanvasPainter(canvas, (_, context) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const r = regionRef.current;
      const muted = isMutedRef.current;

      context.fillStyle = muted ? "#1a1a2e" : "#0a0a1a";
      context.fillRect(0, 0, w, h);

      if (!r.sampleLoader) return;

      const peaksOption = r.sampleLoader.peaks;
      if (!peaksOption || peaksOption.isEmpty()) return;

      const peaks = peaksOption.unwrap();
      const isPeaksWriter = "dataIndex" in peaks;

      const u0 = r.waveformOffsetFrames;
      // Read duration live from box graph — SDK updates every frame during recording.
      // This avoids needing React re-renders for live waveform growth.
      const durationFrames = Math.round(
        r.regionBox.duration.getValue() * sampleRate
      );

      const u1 =
        durationFrames > 0
          ? u0 + durationFrames
          : isPeaksWriter
            ? peaks.dataIndex[0] * peaks.unitsEachPeak()
            : peaks.numFrames;

      if (u1 <= u0) return;

      context.fillStyle = muted ? "#555577" : "#f59e0b";
      const numChannels = peaks.numChannels;
      const channelHeight = h / numChannels;

      for (let ch = 0; ch < numChannels; ch++) {
        PeaksPainter.renderPixelStrips(context, peaks, ch, {
          x0: 0,
          x1: w,
          y0: ch * channelHeight + 1,
          y1: (ch + 1) * channelHeight - 1,
          u0,
          u1,
          // Slight headroom absorbs the SDK Float16 unpack quirk: stored
          // peaks at exactly ±1.0 unpack to ±1.0001219511032104 (the upper
          // edge of the Float16 bucket), which would otherwise clamp to
          // canvas bounds and produce flat-top "square" waveforms.
          v0: -1.001,
          v1: 1.001,
        });
      }
    });

    const animSub = AnimationFrame.add(() => painter.requestUpdate());

    return () => {
      animSub.terminate();
      painter.terminate();
    };
  }, [height, sampleRate]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height,
        display: "block",
        borderRadius: 2,
        opacity: isMuted ? 0.4 : 1,
      }}
    />
  );
};

/** Bar ruler showing bar numbers with lead-in/loop zone styling */
const BarRuler: React.FC<{
  leadInBars: number;
  loopLengthBars: number;
}> = ({ leadInBars, loopLengthBars }) => {
  const totalBars = leadInBars + loopLengthBars;

  return (
    <div
      style={{
        display: "flex",
        marginLeft: CONTROLS_WIDTH,
        borderBottom: "1px solid var(--gray-6)",
      }}
    >
      {Array.from({ length: totalBars }, (_, i) => {
        const isLeadIn = i < leadInBars;
        const isBoundary = i === leadInBars && leadInBars > 0;

        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: 24,
              borderLeft: isBoundary
                ? "2px solid var(--amber-9)"
                : i > 0
                  ? "1px solid var(--gray-6)"
                  : undefined,
              background: isLeadIn
                ? "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.03) 3px, rgba(255,255,255,0.03) 6px)"
                : "rgba(245, 158, 11, 0.08)",
              padding: "4px 6px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <Text size="1" color="gray" style={{ fontSize: 10 }}>
              {i + 1}
            </Text>
          </div>
        );
      })}
    </div>
  );
};

/** A single take iteration lane with controls and waveform area */
const TakeIterationLane: React.FC<{
  take: TakeIteration;
  tapeLabels: { id: string; label: string }[];
  leadInBars: number;
  loopLengthBars: number;
  sampleRate: number;
  onToggleMute: () => void;
}> = ({ take, tapeLabels, leadInBars, loopLengthBars, sampleRate, onToggleMute }) => {
  const totalBars = leadInBars + loopLengthBars;
  const leadInPercent = totalBars > 0 ? (leadInBars / totalBars) * 100 : 0;
  const loopPercent = totalBars > 0 ? (loopLengthBars / totalBars) * 100 : 0;

  // Take 1 spans all bars (includes lead-in), take 2+ only spans loop region
  const isFullWidth = take.isLeadIn || leadInBars === 0;
  const marginLeft = isFullWidth ? 0 : leadInPercent;
  const width = isFullWidth ? 100 : loopPercent;

  // Sort regions to match tape display order
  const sortedRegions = tapeLabels
    .map((tl) => take.regions.find((r) => r.inputTapeId === tl.id))
    .filter((r): r is TakeRegion => r != null);

  const totalHeight = Math.max(sortedRegions.length, 1) * LANE_HEIGHT;

  return (
    <div
      style={{
        display: "flex",
        borderBottom: "1px solid var(--gray-5)",
        minHeight: totalHeight + 16,
      }}
    >
      {/* Left controls */}
      <div
        style={{
          width: CONTROLS_WIDTH,
          minWidth: CONTROLS_WIDTH,
          boxSizing: "border-box",
          padding: "8px 8px",
          borderRight: "1px solid var(--gray-5)",
          borderLeft: take.isMuted
            ? "3px solid transparent"
            : "3px solid var(--amber-9)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 4,
        }}
      >
        <Flex align="center" gap="2">
          <Text size="2" weight={!take.isMuted ? "bold" : "medium"}>
            Take {take.takeNumber}
          </Text>
          <Button
            size="1"
            color={take.isMuted ? "gray" : "red"}
            variant={take.isMuted ? "soft" : "solid"}
            onClick={onToggleMute}
            style={{
              width: 24,
              height: 20,
              padding: 0,
              fontSize: 11,
              fontWeight: "bold",
            }}
          >
            M
          </Button>
        </Flex>
        <Badge
          color={take.isMuted ? "gray" : "green"}
          size="1"
          style={{ width: "fit-content" }}
        >
          {take.isMuted ? "Muted" : "Active"}
        </Badge>
      </div>

      {/* Waveform area */}
      <div style={{ flex: 1, position: "relative", padding: "4px 0" }}>
        <div
          style={{
            marginLeft: `${marginLeft}%`,
            width: `${width}%`,
          }}
        >
          {sortedRegions.map((region, i) => (
            <div
              key={region.inputTapeId}
              style={{
                borderTop: i > 0 ? "1px solid var(--gray-6)" : undefined,
                position: "relative",
              }}
            >
              {tapeLabels.length > 1 && (
                <Text
                  size="1"
                  color="gray"
                  style={{
                    position: "absolute",
                    left: 4,
                    top: 2,
                    zIndex: 1,
                    fontSize: 9,
                    opacity: 0.7,
                  }}
                >
                  {tapeLabels.find((t) => t.id === region.inputTapeId)?.label}
                </Text>
              )}
              <TakeWaveformCanvas
                region={region}
                height={LANE_HEIGHT}
                isMuted={take.isMuted}
                sampleRate={sampleRate}
              />
            </div>
          ))}
          {sortedRegions.length === 0 && (
            <div
              style={{
                height: LANE_HEIGHT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text size="1" color="gray">
                No regions
              </Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Main Component ---

export const TakeTimeline: React.FC<TakeTimelineProps> = ({
  takeIterations,
  recordingTapeLabels,
  currentPosition,
  leadInBars,
  loopLengthBars,
  isRecording,
  isPlaying,
  sampleRate,
  onToggleMute,
}) => {
  const totalBars = leadInBars + loopLengthBars;
  const totalPPQN = totalBars * PPQN.Quarter * 4; // 4/4 time

  // Use modulo so the playhead wraps correctly during looped playback
  const playheadPercent =
    totalPPQN > 0
      ? Math.min(((currentPosition % totalPPQN) / totalPPQN) * 100, 100)
      : 0;

  const showPlayhead = (isRecording || isPlaying) && totalPPQN > 0;

  return (
    <div
      style={{
        border: "1px solid var(--gray-5)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--gray-2)",
      }}
    >
      {/* Bar ruler */}
      <BarRuler leadInBars={leadInBars} loopLengthBars={loopLengthBars} />

      {/* Take lanes with playhead overlay */}
      <div style={{ position: "relative" }}>
        {takeIterations.map((take) => (
          <TakeIterationLane
            key={take.takeNumber}
            take={take}
            tapeLabels={recordingTapeLabels}
            leadInBars={leadInBars}
            loopLengthBars={loopLengthBars}
            sampleRate={sampleRate}
            onToggleMute={() => onToggleMute(take.takeNumber)}
          />
        ))}

        {/* Playhead */}
        {showPlayhead && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: CONTROLS_WIDTH,
              right: 0,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${playheadPercent}%`,
                width: 2,
                background: "var(--amber-9)",
                zIndex: 10,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
