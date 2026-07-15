import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN, ppqn } from "@opendaw/lib-dsp";
import { UUID } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TransportControls } from "@/components/TransportControls";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import { CONSOLE_STYLES, CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import {
  exportStemsRange,
  exportMixdown,
  channelsToAudioBuffer,
  downloadAsWav,
} from "@/lib/rangeExport";
import { ExportResultsList, formatDuration, type PreviewResult } from "./ExportResultsList";
import type { TrackData } from "@/lib/types";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Text,
  Flex,
  Card,
  Button,
  Slider,
  Switch,
  TextField,
  Separator,
  Callout,
  CheckboxGroup,
  Code,
} from "@radix-ui/themes";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840

// Loading spinner — amber ring on console tokens, gated for reduced motion
// (the status text below the ring carries the same information).
const PAGE_STYLES = `
.ex-spinner {
  width: 44px;
  height: 44px;
  border: 3px solid var(--mc-line-bright);
  border-top-color: var(--mc-amber);
  border-radius: 50%;
  animation: ex-spin 1s linear infinite;
}
@keyframes ex-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .ex-spinner { animation: none; }
}
.ex-results {
  margin-top: 8px;
  border: 1px solid var(--mc-line);
  border-left: 2px solid var(--mc-amber);
  border-radius: 4px;
  background: var(--mc-panel);
  padding: 20px 22px;
}
.ex-results-head { margin-bottom: 14px; }
.ex-results-title {
  font-family: var(--mc-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--mc-amber);
}
.ex-results-list {
  display: grid;
  gap: 1px;
  background: var(--mc-line);
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  overflow: hidden;
}
.ex-result-row {
  background: var(--mc-bg);
  padding: 14px 16px;
  min-width: 0;
}
.ex-result-label {
  font-family: var(--mc-mono);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--mc-text);
  min-width: 0;
  overflow-wrap: anywhere;
}
.ex-result-badges { flex: none; }
`;

const App: React.FC = () => {
  // --- Initialization state ---
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
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
  const exportFailed = exportStatus.toLowerCase().includes("failed");
  // Result IDs come from a ref, not module state: module-level counters survive
  // HMR remounts / StrictMode double-mounts and collide across remounts.
  const nextResultIdRef = useRef(0);

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
        console.error("Failed to initialize:", error);
        if (mounted) setInitError(error instanceof Error ? error.message : String(error));
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

  // Derive the "Play Range" toggle from the engine: if playback stops by any
  // path (engine reaches end, transport Stop, etc.), reset the range loop so
  // the button never shows "Stop" while idle.
  useEffect(() => {
    if (!isPlaying) setLoopingRange(false);
  }, [isPlaying]);

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
      setResults((prev) => [...prev, { ...result, id: nextResultIdRef.current++, audioBuffer }]);
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
        id: nextResultIdRef.current++,
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

  const handleDownload = useCallback((result: PreviewResult) => {
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
  }, []);

  const currentBar = project ? Math.floor(currentPosition / BAR) + 1 : 1;

  return (
    <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 800, margin: "0 auto", position: "relative" }}>
          {/* Header */}
          <div>
            <div className="mc-kicker">Export &mdash; Offline Render &middot; OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              AUDIO EXPORT
            </h1>
            <p className="mc-intro">
              Render any bar range of Dark Ride&apos;s &lsquo;Deny Control&rsquo; offline to
              32-bit float WAV &mdash; the full mix as one stereo file, clean stems one per
              track, or a metronome-only click. Each export runs on a throwaway copy of the
              project through <code>OfflineEngineRenderer</code> (a dedicated worker) &mdash;
              or the manual <code>OfflineAudioContext</code> worklet when the metronome is
              enabled &mdash; so the live transport keeps playing while the renderer works
              ahead of real time. Preview the result in the browser, then download.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                <strong>Initialization failed:</strong> {initError}
              </Callout.Text>
            </Callout.Root>
          ) : !project ? (
            <Flex direction="column" align="center" gap="4" style={{ paddingTop: 80 }}>
              <div className="ex-spinner" aria-hidden="true" />
              <Text size="4" weight="medium" style={{ color: "var(--mc-text)" }} role="status">
                {status}
              </Text>
            </Flex>
          ) : (
            <>
              {/* Transport */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Transport
                  </Text>
                  <Separator size="4" />
                  <Flex align="center" gap="3" wrap="wrap">
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
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Metronome
                  </Text>
                  <Separator size="4" />
                  <Text as="label" size="2">
                    <Flex gap="2" align="center">
                      <Switch checked={metronomeEnabled} onCheckedChange={setMetronomeEnabled} />
                      Enable Metronome
                    </Flex>
                  </Text>
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
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Range Selection
                  </Text>
                  <Separator size="4" />
                  <Flex align="center" gap="3" wrap="wrap">
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
                  <Flex align="center" gap="3" wrap="wrap">
                    <Text size="2" color="gray">
                      Duration: {formatDuration(rangeDurationSeconds)} | Bars {startBar}-{endBar} (
                      {endBar - startBar + 1} bars)
                    </Text>
                    <Button
                      size="1"
                      variant="solid"
                      color={loopingRange ? "red" : "amber"}
                      onClick={handleLoopRange}
                      disabled={!validRange}
                    >
                      {loopingRange ? "Stop" : "Play Range"}
                    </Button>
                  </Flex>
                </Flex>
              </Card>

              <Separator size="4" />

              {/* Export Mixdown */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Export Mixdown
                  </Text>
                  <Separator size="4" />
                  <Text size="2" color="gray">
                    Mix selected tracks and metronome into a single stereo file.
                  </Text>
                  <CheckboxGroup.Root value={mixdownUuids} onValueChange={setMixdownUuids}>
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
                        setMixdownUuids(tracks.map((t) => UUID.toString(t.audioUnitBox.address.uuid)))
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
                      <Switch checked={mixdownMetronome} onCheckedChange={setMixdownMetronome} />
                      Include Metronome
                    </Flex>
                  </Text>
                  <Button
                    color="amber"
                    onClick={handleExportMixdown}
                    disabled={isExporting || !validRange || (mixdownUuids.length === 0 && !mixdownMetronome)}
                  >
                    Export Mixdown
                  </Button>
                </Flex>
              </Card>

              {/* Export Stems */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Export Stems
                  </Text>
                  <Separator size="4" />
                  <Text size="2" color="gray">
                    Renders selected tracks as individual stem files. Optionally includes a
                    separate metronome stem.
                  </Text>
                  <CheckboxGroup.Root value={selectedStemUuids} onValueChange={setSelectedStemUuids}>
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
                        setSelectedStemUuids(tracks.map((t) => UUID.toString(t.audioUnitBox.address.uuid)))
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
                      <Switch checked={stemsMetronome} onCheckedChange={setStemsMetronome} />
                      Include Metronome Stem
                    </Flex>
                  </Text>
                  <Button
                    color="amber"
                    onClick={handleExportStems}
                    disabled={isExporting || !validRange || (selectedStemUuids.length === 0 && !stemsMetronome)}
                  >
                    Export {selectedStemUuids.length + (stemsMetronome ? 1 : 0)} Stem(s)
                  </Button>
                </Flex>
              </Card>

              {/* Export Status */}
              {exportStatus &&
                (exportFailed ? (
                  <Callout.Root color="red" role="alert">
                    <Callout.Text>{exportStatus}</Callout.Text>
                  </Callout.Root>
                ) : (
                  <Callout.Root>
                    <Callout.Text>{exportStatus}</Callout.Text>
                  </Callout.Root>
                ))}

              {/* Results */}
              <ExportResultsList
                results={results}
                playingPreviewIndex={playingPreviewIndex}
                onPlay={playPreview}
                onStop={stopPreview}
                onDownload={handleDownload}
                onClearAll={() => {
                  stopPreview();
                  setResults([]);
                }}
              />

              {/* SDK reference */}
              <section className="mc-anchors">
                <h2 className="mc-anchors-head">SDK reference</h2>
                <p>
                  Each export renders on a <code>project.copy()</code> &mdash; a throwaway clone
                  that shares the sample manager (samples stay loaded) but not the live{" "}
                  <code>liveStreamReceiver</code>, so the offline renderer never collides with
                  playback. The mixdown path (no <code>exportConfiguration</code>) mixes every
                  unit; the stem path passes a per-unit config and writes one stereo pair per
                  track, metronome excluded. Stems route through the channel strip
                  (<code>useInstrumentOutput: false</code>) so effects, aux sends, and the
                  strip&apos;s volume/pan all reach the render. Metronome-enabled renders take
                  the manual worklet path &mdash; the metronome flag is an engine{" "}
                  <em>preference</em>, reachable only through{" "}
                  <code>EngineWorklet.preferences</code>; <code>OfflineEngineRenderer</code>{" "}
                  exposes no preferences surface.
                </p>

                <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
                  Offline render (current API — exact range via step):
                </Text>
                <Code size="2" style={CODE_BLOCK_STYLE}>
                  {`const copy = project.copy();
const renderer = await OfflineEngineRenderer.create(
  copy,
  stems ? Option.wrap({ stems }) : Option.None, // undefined config = mixdown branch
  sampleRate,
  false, // pin the TS worker (variant defaults to WasmEngine.useForExports())
);
renderer.setPosition(startPpqn);
await renderer.play();           // transport + first queryLoadingComplete
await renderer.waitForLoading(); // bound with a deadline — polls forever otherwise
// render(config, start, end, …) runs to SILENCE, not to end — step() is exact:
const channels = await renderer.step(numSamples);
renderer.stop(); renderer.terminate(); copy.terminate();`}
                </Code>

                <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
                  Metronome render (manual worklet path):
                </Text>
                <Code size="2" style={CODE_BLOCK_STYLE}>
                  {`const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
const worklets = await AudioWorklets.createFor(context);
const engine = worklets.createEngine({ project: copy, exportConfiguration });
// Engine worklet has 2 outputs — connect output 0 only.
engine.connect(context.destination, 0);
engine.preferences.settings.metronome.enabled = true; // doesn't travel with copy()
engine.setPosition(startPpqn);
await engine.isReady();
engine.play();
while (!(await engine.queryLoadingComplete())) { /* wait for samples */ }
const audioBuffer = await context.startRendering();
copy.terminate();`}
                </Code>
              </section>

              {/* Audio Attribution */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">
                    Audio Attribution
                  </Text>
                  <Separator size="4" />
                  <Text size="2">
                    Mix stems from Dark Ride&apos;s &lsquo;Deny Control&rsquo;. This file is provided
                    for educational purposes only, and the material contained in it should not be
                    used for any commercial purpose without the express permission of the copyright
                    holders. Please refer to{" "}
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
