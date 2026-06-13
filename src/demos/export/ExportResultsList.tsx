import React from "react";
import { Flex, Button, Badge } from "@radix-ui/themes";
import type { ExportResult } from "@/lib/rangeExport";

export interface PreviewResult extends ExportResult {
  id: number;
  audioBuffer: AudioBuffer;
}

export const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
};

const formatFileSize = (channels: Float32Array[]) => {
  // WAV: 44 byte header + samples * 4 bytes (32-bit float) * channels
  const bytes = 44 + (channels[0]?.length ?? 0) * 4 * channels.length;
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
};

interface ExportResultsListProps {
  results: PreviewResult[];
  playingPreviewIndex: number | null;
  onPlay: (index: number) => void;
  onStop: () => void;
  onDownload: (result: PreviewResult) => void;
  onClearAll: () => void;
}

/**
 * The export-results ledger — the page's signature element. Each row is an
 * engraved strip on --mc-bg with the take label and a metering badge cluster
 * (duration / sample rate / file size), plus preview + download controls.
 */
export const ExportResultsList: React.FC<ExportResultsListProps> = ({
  results,
  playingPreviewIndex,
  onPlay,
  onStop,
  onDownload,
  onClearAll,
}) => {
  if (results.length === 0) return null;

  return (
    <section className="ex-results">
      <Flex justify="between" align="center" className="ex-results-head">
        <span className="ex-results-title">Export Results</span>
        <Button variant="soft" color="red" size="1" onClick={onClearAll}>
          Clear All
        </Button>
      </Flex>
      <div className="ex-results-list">
        {results.map((result, index) => {
          const isPlaying = playingPreviewIndex === index;
          return (
            <div className="ex-result-row" key={result.id}>
              <Flex justify="between" align="center" gap="3" wrap="wrap">
                <span className="ex-result-label">{result.label}</span>
                <Flex gap="2" className="ex-result-badges">
                  <Badge size="1" variant="soft" color="amber">
                    {formatDuration(result.durationSeconds)}
                  </Badge>
                  <Badge size="1" variant="soft" color="gray">
                    {result.sampleRate / 1000}kHz
                  </Badge>
                  <Badge size="1" variant="soft" color="gray">
                    {formatFileSize(result.channels)}
                  </Badge>
                </Flex>
              </Flex>
              <Flex gap="2" mt="2">
                <Button
                  size="1"
                  variant={isPlaying ? "solid" : "soft"}
                  color="amber"
                  onClick={() => (isPlaying ? onStop() : onPlay(index))}
                >
                  {isPlaying ? "Stop" : "Play"}
                </Button>
                <Button size="1" variant="soft" onClick={() => onDownload(result)}>
                  Download WAV
                </Button>
              </Flex>
            </div>
          );
        })}
      </div>
    </section>
  );
};
