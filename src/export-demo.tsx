import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN, ppqn } from "@opendaw/lib-dsp";
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
  exportStemsRange,
  exportMixdown,
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
  id: number;
  audioBuffer: AudioBuffer;
}

let nextResultId = 0;

const App: React.FC = () => {
  // --- Initialization state ---
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);

  // --- Transport ---
  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop: baseHandleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });
  const handleStop = useCallback(() => {
    baseHandleStop();
    setLoopingRange(false);
  }, [baseHandleStop]);

  // --- Metronome settings ---
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [metronomeGain, setMetronomeGain] = useState(-6);

  // --- Range selection ---
  const [startBar, setStartBar] = useState(1);
  const [endBar, setEndBar] = useState(1);
  const [maxBar, setMaxBar] = useState(1);
  const [loopingRange, setLoopingRange] = useState(false);

  // --- Track selection ---
  const [selectedStemUuids, setSelectedStemUuids] = useState<string[]>([]);
  const [mixdownUuids, setMixdownUuids] = useState<string[]>([]);
  const [mixdownMetronome, setMixdownMetronome] = useState(true);
  const [stemsMetronome, setStemsMetronome] = useState(false);

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
        setMixdownUuids(uuids);

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
  const validRange = startBar <= endBar && startBar >= 1 && endBar <= maxBar;
  const startPpqn = ((startBar - 1) * BAR) as ppqn;
  const endPpqn = (endBar * BAR) as ppqn;
  const rangeDurationSeconds = project
    ? project.tempoMap.intervalToSeconds(startPpqn, endPpqn)
    : 0;

  // --- Sync loop area with range selection ---
  useEffect(() => {
    if (!project || !validRange) return;
    project.editing.modify(() => {
      project.timelineBox.loopArea.from.setValue(startPpqn);
      project.timelineBox.loopArea.to.setValue(endPpqn);
      project.timelineBox.loopArea.enabled.setValue(loopingRange);
    });
  }, [project, startPpqn, endPpqn, loopingRange, validRange]);

  const handleLoopRange = useCallback(async () => {
    if (!project || !audioContext || !validRange) return;
    if (audioContext.state !== "running") {
      await audioContext.resume();
    }
    if (loopingRange) {
      project.engine.stop(true);
      setLoopingRange(false);
    } else {
      setLoopingRange(true);
      project.engine.setPosition(startPpqn);
      project.engine.play();
    }
  }, [project, audioContext, validRange, loopingRange, startPpqn]);

  // --- Export handlers ---
  const handleExportMixdown = useCallback(async () => {
    if (!project || !audioContext) return;
    if (!mixdownMetronome && mixdownUuids.length === 0) return;
    setIsExporting(true);
    setExportStatus("Rendering mixdown...");
    try {
      const result = await exportMixdown({
        project,
        startPpqn,
        endPpqn,
        tracks,
        selectedUuids: mixdownUuids,
        includeMetronome: mixdownMetronome,
        metronomeGain,
      });
      const audioBuffer = channelsToAudioBuffer(result.channels, result.sampleRate);
      setResults((prev) => [...prev, { ...result, id: nextResultId++, audioBuffer }]);
      setExportStatus("Mixdown export complete");
    } catch (error) {
      console.error("Export failed:", error);
      const message = error instanceof Error ? error.message : String(error);
      setExportStatus(`Export failed: ${message}`);
    } finally {
      setIsExporting(false);
    }
  }, [project, audioContext, startPpqn, endPpqn, tracks, mixdownUuids, mixdownMetronome, metronomeGain]);

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
        includeMetronome: stemsMetronome,
        metronomeGain,
      });
      const previewResults = stemResults.map((r) => ({
        ...r,
        id: nextResultId++,
        audioBuffer: channelsToAudioBuffer(r.channels, r.sampleRate),
      }));
      setResults((prev) => [...prev, ...previewResults]);
      setExportStatus(`Exported ${stemResults.length} stem(s)`);
    } catch (error) {
      console.error("Export failed:", error);
      const message = error instanceof Error ? error.message : String(error);
      setExportStatus(`Export failed: ${message}`);
    } finally {
      setIsExporting(false);
    }
  }, [project, audioContext, startPpqn, endPpqn, tracks, selectedStemUuids, stemsMetronome, metronomeGain]);

  // --- Preview playback ---
  const stopPreview = useCallback(() => {
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
      } catch {
        // Source may have already ended naturally
      }
      previewSourceRef.current.disconnect();
      previewSourceRef.current = null;
    }
    setPlayingPreviewIndex(null);
  }, []);

  // Cleanup preview on unmount
  useEffect(() => {
    return () => {
      if (previewSourceRef.current) {
        try {
          previewSourceRef.current.stop();
        } catch {
          // Source may have already ended
        }
        previewSourceRef.current.disconnect();
        previewSourceRef.current = null;
      }
    };
  }, []);

  const playPreview = useCallback(
    async (index: number) => {
      if (!audioContext) return;
      // iOS Safari can re-suspend AudioContext after backgrounding
      if (audioContext.state !== "running") {
        await audioContext.resume();
      }
      stopPreview();
      const result = results[index];
      if (!result) return;
      const source = audioContext.createBufferSource();
      source.buffer = result.audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        source.disconnect();
        previewSourceRef.current = null;
        setPlayingPreviewIndex(null);
      };
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
                  min={1}
                  max={endBar}
                  value={String(startBar)}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value);
                    if (!isNaN(parsed)) setStartBar(parsed);
                  }}
                  onBlur={() => {
                    setStartBar((v) => Math.max(1, Math.min(endBar, v)));
                  }}
                  style={{ width: 80 }}
                />
                <Text size="2">End Bar:</Text>
                <TextField.Root
                  type="number"
                  min={startBar}
                  max={maxBar}
                  value={String(endBar)}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value);
                    if (!isNaN(parsed)) setEndBar(parsed);
                  }}
                  onBlur={() => {
                    setEndBar((v) => Math.max(startBar, Math.min(maxBar, v)));
                  }}
                  style={{ width: 80 }}
                />
                <Text size="2" color="gray">
                  / {maxBar} bars
                </Text>
              </Flex>
              <Flex align="center" gap="3">
                <Text size="2" color="gray">
                  Duration: {formatDuration(rangeDurationSeconds)} | Bars {startBar}-{endBar} (
                  {endBar - startBar + 1} bars)
                </Text>
                <Button
                  size="1"
                  variant={loopingRange ? "solid" : "soft"}
                  onClick={handleLoopRange}
                  disabled={!validRange}
                >
                  {loopingRange ? "Stop Loop" : "Preview Range"}
                </Button>
              </Flex>
            </Flex>
          </Card>

          <Separator size="4" />

          {/* Export Mixdown */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Export Mixdown</Heading>
              <Text size="2" color="gray">
                Mix selected tracks and metronome into a single stereo file.
              </Text>
              <CheckboxGroup.Root
                value={mixdownUuids}
                onValueChange={setMixdownUuids}
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
                    setMixdownUuids(
                      tracks.map((t) => UUID.toString(t.audioUnitBox.address.uuid))
                    )
                  }
                >
                  Select All
                </Button>
                <Button variant="soft" size="1" onClick={() => setMixdownUuids([])}>
                  Deselect All
                </Button>
              </Flex>
              <Text as="label" size="2">
                <Flex gap="2" align="center">
                  <Switch
                    checked={mixdownMetronome}
                    onCheckedChange={setMixdownMetronome}
                  />
                  Include Metronome
                </Flex>
              </Text>
              <Button
                onClick={handleExportMixdown}
                disabled={isExporting || !validRange || (mixdownUuids.length === 0 && !mixdownMetronome)}
              >
                Export Mixdown
              </Button>
            </Flex>
          </Card>

          {/* Export Stems */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Export Stems</Heading>
              <Text size="2" color="gray">
                Renders selected tracks as individual stem files. Optionally includes a
                separate metronome stem.
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
              <Text as="label" size="2">
                <Flex gap="2" align="center">
                  <Switch
                    checked={stemsMetronome}
                    onCheckedChange={setStemsMetronome}
                  />
                  Include Metronome Stem
                </Flex>
              </Text>
              <Button
                onClick={handleExportStems}
                disabled={isExporting || !validRange || (selectedStemUuids.length === 0 && !stemsMetronome)}
              >
                Export {selectedStemUuids.length + (stemsMetronome ? 1 : 0)} Stem(s)
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
                <Card key={result.id}>
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
                        onClick={() => {
                          try {
                            downloadAsWav(
                              result.channels,
                              result.sampleRate,
                              result.label.replace(/[^a-zA-Z0-9-_]/g, "_")
                            );
                          } catch (e) {
                            console.error("Download failed:", e);
                            const msg = e instanceof Error ? e.message : String(e);
                            setExportStatus(`Download failed: ${msg}`);
                          }
                        }}
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
