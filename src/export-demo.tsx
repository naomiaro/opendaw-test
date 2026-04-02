import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { UUID } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { TransportControls } from "./components/TransportControls";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";
import { useTransportControls } from "./hooks/useTransportControls";
import {
  exportMetronomeOnly,
  exportStemsRange,
  exportStemWithMetronome,
  channelsToAudioBuffer,
  downloadAsWav,
  type ExportResult,
} from "./lib/rangeExport";
import type { TrackData } from "./lib/types";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Button,
  Select,
  Slider,
  Switch,
  TextField,
  Separator,
  Badge,
  Callout,
  CheckboxGroup,
} from "@radix-ui/themes";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840

interface PreviewResult extends ExportResult {
  audioBuffer: AudioBuffer;
}

const App: React.FC = () => {
  // --- Initialization state ---
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);

  // --- Transport ---
  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  // --- Metronome settings ---
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [metronomeGain, setMetronomeGain] = useState(-6);

  // --- Range selection ---
  const [startBar, setStartBar] = useState(1);
  const [endBar, setEndBar] = useState(1);
  const [maxBar, setMaxBar] = useState(1);

  // --- Stem selection ---
  const [selectedStemUuids, setSelectedStemUuids] = useState<string[]>([]);
  const [stemWithMetronomeUuid, setStemWithMetronomeUuid] = useState<string>("");

  // --- Export state ---
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [results, setResults] = useState<PreviewResult[]>([]);

  // --- Preview playback ---
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [playingPreviewIndex, setPlayingPreviewIndex] = useState<number | null>(null);

  // --- Initialize project and load tracks ---
  useEffect(() => {
    let mounted = true;
    const localAudioBuffers = new Map<string, AudioBuffer>();

    (async () => {
      try {
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: (s) => mounted && setStatus(s),
        });

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
            { name: "Effect Returns", file: `/audio/DarkRide/07_EffectReturns.${ext}` },
          ],
          localAudioBuffers,
          {
            onProgress: (current, total, trackName) => {
              if (mounted) setStatus(`Loading ${trackName} (${current}/${total})...`);
            },
          }
        );

        if (!mounted) return;

        // Calculate max bar from last region
        const lastPpqn = newProject.lastRegionAction();
        const totalBars = Math.ceil(lastPpqn / BAR);
        setMaxBar(totalBars);
        setEndBar(totalBars);

        // Default: all stems selected
        const uuids = loadedTracks.map((t) => UUID.toString(t.audioUnitBox.address.uuid));
        setSelectedStemUuids(uuids);
        setStemWithMetronomeUuid(uuids[0] ?? "");

        setProject(newProject);
        setAudioContext(newAudioContext);
        setTracks(loadedTracks);
        setStatus("Ready");
      } catch (error) {
        if (mounted) setStatus(`Error: ${error}`);
        console.error(error);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // --- Sync metronome toggle to engine preferences ---
  useEffect(() => {
    if (!project) return;
    project.engine.preferences.settings.metronome.enabled = metronomeEnabled;
  }, [project, metronomeEnabled]);

  useEffect(() => {
    if (!project) return;
    project.engine.preferences.settings.metronome.gain = metronomeGain;
  }, [project, metronomeGain]);

  // --- Range to PPQN helpers ---
  const startPpqn = ((startBar - 1) * BAR) as import("@opendaw/lib-dsp").ppqn;
  const endPpqn = (endBar * BAR) as import("@opendaw/lib-dsp").ppqn;
  const rangeDurationSeconds = project
    ? project.tempoMap.intervalToSeconds(startPpqn, endPpqn)
    : 0;

  // --- Export handlers ---
  const handleExportMetronome = useCallback(async () => {
    if (!project || !audioContext) return;
    setIsExporting(true);
    setExportStatus("Rendering metronome...");
    try {
      const result = await exportMetronomeOnly({
        project,
        startPpqn,
        endPpqn,
        tracks,
        metronomeGain,
      });
      const audioBuffer = channelsToAudioBuffer(result.channels, result.sampleRate);
      setResults((prev) => [...prev, { ...result, audioBuffer }]);
      setExportStatus("Metronome export complete");
    } catch (error) {
      setExportStatus(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  }, [project, audioContext, startPpqn, endPpqn, tracks, metronomeGain]);

  const handleExportStems = useCallback(async () => {
    if (!project || !audioContext || selectedStemUuids.length === 0) return;
    setIsExporting(true);
    setExportStatus("Rendering stems...");
    try {
      const stemResults = await exportStemsRange({
        project,
        startPpqn,
        endPpqn,
        tracks,
        selectedUuids: selectedStemUuids,
      });
      const previewResults = stemResults.map((r) => ({
        ...r,
        audioBuffer: channelsToAudioBuffer(r.channels, r.sampleRate),
      }));
      setResults((prev) => [...prev, ...previewResults]);
      setExportStatus(`Exported ${stemResults.length} stem(s)`);
    } catch (error) {
      setExportStatus(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  }, [project, audioContext, startPpqn, endPpqn, tracks, selectedStemUuids]);

  const handleExportStemWithMetronome = useCallback(async () => {
    if (!project || !audioContext || !stemWithMetronomeUuid) return;
    setIsExporting(true);
    setExportStatus("Rendering stem + metronome...");
    try {
      const result = await exportStemWithMetronome({
        project,
        startPpqn,
        endPpqn,
        tracks,
        audioUnitUuid: stemWithMetronomeUuid,
        metronomeGain,
      });
      const audioBuffer = channelsToAudioBuffer(result.channels, result.sampleRate);
      setResults((prev) => [...prev, { ...result, audioBuffer }]);
      setExportStatus("Stem + metronome export complete");
    } catch (error) {
      setExportStatus(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  }, [project, audioContext, startPpqn, endPpqn, tracks, stemWithMetronomeUuid, metronomeGain]);

  // --- Preview playback ---
  const stopPreview = useCallback(() => {
    if (previewSourceRef.current) {
      previewSourceRef.current.stop();
      previewSourceRef.current.disconnect();
      previewSourceRef.current = null;
    }
    setPlayingPreviewIndex(null);
  }, []);

  const playPreview = useCallback(
    (index: number) => {
      if (!audioContext) return;
      stopPreview();
      const result = results[index];
      if (!result) return;
      const source = audioContext.createBufferSource();
      source.buffer = result.audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => setPlayingPreviewIndex(null);
      source.start();
      previewSourceRef.current = source;
      setPlayingPreviewIndex(index);
    },
    [audioContext, results, stopPreview]
  );

  // --- Format helpers ---
  const formatDuration = (seconds: number) => {
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

  // --- Loading state ---
  if (!project) {
    return (
      <Theme appearance="dark" accentColor="blue" radius="large">
        <Container size="3" px="4" py="8">
          <Flex direction="column" align="center" gap="4" style={{ paddingTop: 100 }}>
            <Heading size="6">{status}</Heading>
          </Flex>
        </Container>
      </Theme>
    );
  }

  const currentBar = Math.floor(currentPosition / BAR) + 1;

  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* Header */}
          <Flex direction="column" gap="3">
            <Heading size="8">Audio Export Demo</Heading>
            <Text size="4" color="gray">
              Export audio with range selection and metronome control using OpenDAW's offline
              rendering API
            </Text>
          </Flex>

          {/* Transport */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Transport</Heading>
              <Flex align="center" gap="3">
                <TransportControls
                  isPlaying={isPlaying}
                  currentPosition={currentPosition}
                  bpm={BPM}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onStop={handleStop}
                />
                <Text size="2" color="gray">
                  Bar {currentBar} | {BPM} BPM
                </Text>
              </Flex>
            </Flex>
          </Card>

          {/* Metronome Settings */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Metronome</Heading>
              <Flex align="center" gap="3">
                <Text as="label" size="2">
                  <Flex gap="2" align="center">
                    <Switch
                      checked={metronomeEnabled}
                      onCheckedChange={setMetronomeEnabled}
                    />
                    Enable Metronome
                  </Flex>
                </Text>
              </Flex>
              <Flex align="center" gap="3">
                <Text size="2" style={{ minWidth: 80 }}>
                  Gain: {metronomeGain} dB
                </Text>
                <Slider
                  min={-60}
                  max={0}
                  step={1}
                  value={[metronomeGain]}
                  onValueChange={([v]) => setMetronomeGain(v)}
                  style={{ flex: 1 }}
                />
              </Flex>
            </Flex>
          </Card>

          {/* Range Selection */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Range Selection</Heading>
              <Flex align="center" gap="3">
                <Text size="2">Start Bar:</Text>
                <TextField.Root
                  type="number"
                  value={String(startBar)}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(endBar, parseInt(e.target.value) || 1));
                    setStartBar(v);
                  }}
                  style={{ width: 80 }}
                />
                <Text size="2">End Bar:</Text>
                <TextField.Root
                  type="number"
                  value={String(endBar)}
                  onChange={(e) => {
                    const v = Math.max(startBar, Math.min(maxBar, parseInt(e.target.value) || 1));
                    setEndBar(v);
                  }}
                  style={{ width: 80 }}
                />
                <Text size="2" color="gray">
                  / {maxBar} bars
                </Text>
              </Flex>
              <Text size="2" color="gray">
                Duration: {formatDuration(rangeDurationSeconds)} | Bars {startBar}-{endBar} (
                {endBar - startBar + 1} bars)
              </Text>
            </Flex>
          </Card>

          <Separator size="4" />

          {/* Export Mode 1: Metronome Only */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Export Metronome Only</Heading>
              <Text size="2" color="gray">
                Renders only metronome clicks for the selected range (all tracks muted).
              </Text>
              <Button onClick={handleExportMetronome} disabled={isExporting}>
                Export Metronome
              </Button>
            </Flex>
          </Card>

          {/* Export Mode 2: Clean Stems */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Export Clean Stems</Heading>
              <Text size="2" color="gray">
                Renders selected tracks as individual stems (no metronome).
              </Text>
              <CheckboxGroup.Root
                value={selectedStemUuids}
                onValueChange={setSelectedStemUuids}
              >
                <Flex direction="column" gap="2">
                  {tracks.map((track) => {
                    const uuid = UUID.toString(track.audioUnitBox.address.uuid);
                    return (
                      <CheckboxGroup.Item key={uuid} value={uuid}>
                        {track.name}
                      </CheckboxGroup.Item>
                    );
                  })}
                </Flex>
              </CheckboxGroup.Root>
              <Flex gap="2">
                <Button
                  variant="soft"
                  size="1"
                  onClick={() =>
                    setSelectedStemUuids(
                      tracks.map((t) => UUID.toString(t.audioUnitBox.address.uuid))
                    )
                  }
                >
                  Select All
                </Button>
                <Button variant="soft" size="1" onClick={() => setSelectedStemUuids([])}>
                  Deselect All
                </Button>
              </Flex>
              <Button
                onClick={handleExportStems}
                disabled={isExporting || selectedStemUuids.length === 0}
              >
                Export {selectedStemUuids.length} Stem(s)
              </Button>
            </Flex>
          </Card>

          {/* Export Mode 3: Stem + Metronome */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Export Stem + Metronome</Heading>
              <Text size="2" color="gray">
                Renders a single track mixed with metronome clicks for the selected range.
              </Text>
              <Select.Root value={stemWithMetronomeUuid} onValueChange={setStemWithMetronomeUuid}>
                <Select.Trigger placeholder="Select track..." />
                <Select.Content>
                  {tracks.map((track) => {
                    const uuid = UUID.toString(track.audioUnitBox.address.uuid);
                    return (
                      <Select.Item key={uuid} value={uuid}>
                        {track.name}
                      </Select.Item>
                    );
                  })}
                </Select.Content>
              </Select.Root>
              <Button
                onClick={handleExportStemWithMetronome}
                disabled={isExporting || !stemWithMetronomeUuid}
              >
                Export Stem + Metronome
              </Button>
            </Flex>
          </Card>

          {/* Export Status */}
          {exportStatus && (
            <Callout.Root>
              <Callout.Text>{exportStatus}</Callout.Text>
            </Callout.Root>
          )}

          <Separator size="4" />

          {/* Results */}
          {results.length > 0 && (
            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Heading size="4">Export Results</Heading>
                <Button
                  variant="soft"
                  color="red"
                  size="1"
                  onClick={() => {
                    stopPreview();
                    setResults([]);
                  }}
                >
                  Clear All
                </Button>
              </Flex>
              {results.map((result, index) => (
                <Card key={index}>
                  <Flex direction="column" gap="2" p="3">
                    <Flex justify="between" align="center">
                      <Text weight="bold">{result.label}</Text>
                      <Flex gap="2">
                        <Badge size="1" variant="soft">
                          {formatDuration(result.durationSeconds)}
                        </Badge>
                        <Badge size="1" variant="soft">
                          {result.sampleRate / 1000}kHz
                        </Badge>
                        <Badge size="1" variant="soft">
                          {formatFileSize(result.channels)}
                        </Badge>
                      </Flex>
                    </Flex>
                    <Flex gap="2">
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() =>
                          playingPreviewIndex === index ? stopPreview() : playPreview(index)
                        }
                      >
                        {playingPreviewIndex === index ? "Stop" : "Play"}
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() =>
                          downloadAsWav(
                            result.channels,
                            result.sampleRate,
                            result.label.replace(/[^a-zA-Z0-9-_]/g, "_")
                          )
                        }
                      >
                        Download WAV
                      </Button>
                    </Flex>
                  </Flex>
                </Card>
              ))}
            </Flex>
          )}

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
