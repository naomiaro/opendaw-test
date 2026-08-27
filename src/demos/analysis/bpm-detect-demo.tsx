import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, WasmBpmDetector } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, AudioUnitBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DropZone } from "@/components/DropZone";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { waitForLoadingComplete } from "@/lib/engineLoading";
import { audioBufferToAudioData, formatDuration, loadAudioFile } from "@/lib/audioUtils";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Flex, Grid, Text, Card, Button, Badge, Separator, Callout,
} from "@radix-ui/themes";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

const BPM_STYLES = `
.bpm-file-card:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
`;

// Same URL scheme the studio app uses (STRETCH_WASM_URL in StudioService.ts) — the
// wasm-engine-assets Vite plugin serves studio-core-wasm's dist/wasm tree here.
const STRETCH_WASM_URL = "/wasm-engine/wasm/stretch_wasm.wasm";

// TempoConfig::max_analysis_seconds in crates/stretch/src/tempo.rs — the detector
// reads at most this much audio from the START of the file. Duplicated here only
// for UI copy; the engine value is not exported.
const ANALYSIS_WINDOW_SECONDS = 60;

interface GalleryFile {
  id: string;
  name: string;
  file: string;
  hint: string;
}

const GALLERY: GalleryFile[] = [
  {
    id: "bassdrums",
    name: "BassDrums30",
    file: "/audio/BassDrums30.mp3",
    hint: "Bass + drum loop, 30 s. Independently measured at ~122 BPM in this repo.",
  },
  {
    id: "guitar",
    name: "Guitar30",
    file: "/audio/Guitar30.mp3",
    hint: "Strummed electric guitar, 30 s — strums give it a usable pulse.",
  },
  {
    id: "pianosynth",
    name: "PianoSynth30",
    file: "/audio/PianoSynth30.mp3",
    hint: "Piano + synth pads, 30 s — softer onsets challenge the detector.",
  },
  {
    id: "vocals",
    name: "Vocals30",
    file: "/audio/Vocals30.mp3",
    hint: "A cappella vocal, 30 s — sparse onsets; may honestly refuse.",
  },
  {
    id: "scartissue",
    name: "ScarTissue",
    file: "/audio/ScarTissue.mp3",
    hint: "Full song, 3:41 — only the first 60 s are ever analyzed.",
  },
  {
    id: "otherside",
    name: "Otherside",
    file: "/audio/Otherside.mp3",
    hint: "Full song, 4:18 — only the first 60 s are ever analyzed.",
  },
  {
    id: "sonnet",
    name: "Sonnet",
    file: "/audio/sonnet.mp3",
    hint: "Spoken word — speech has onsets but no periodic pulse.",
  },
  {
    id: "tone",
    name: "440 Hz tone",
    file: "/audio/test-440hz.wav",
    hint: "Pure sine, 60 s — no onsets at all. The honest “no tempo” answer.",
  },
];

interface DetectionResult {
  /** Gallery id, or "drop" for a user file — keys the card highlight exactly. */
  sourceId: string;
  name: string;
  seconds: number;
  sampleRate: number;
  /** null = the detector answered None: no measurable tempo. */
  bpm: number | null;
  elapsedMs: number;
  buffer: AudioBuffer;
}

/** Boxes owned by the current metronome-verification track, for cleanup on replace. */
interface VerifyTrack {
  audioUnitBox: AudioUnitBox;
  audioFileBox: AudioFileBox;
  eventsBox: ValueEventCollectionBox;
  uuidString: string;
  name: string;
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [initError, setInitError] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyName, setVerifyName] = useState<string | null>(null);
  const [detectorUnavailable, setDetectorUnavailable] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const detectorRef = useRef<WasmBpmDetector | null>(null);
  const localBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const verifyTrackRef = useRef<VerifyTrack | null>(null);
  const analyzeBusyRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let bootProject: Project | null = null;
    (async () => {
      try {
        const { project, audioContext } = await initializeOpenDAW({
          localAudioBuffers: localBuffersRef.current,
          onStatusUpdate: setStatus,
        });
        bootProject = project;
        if (disposed) { project.terminate(); return; }
        audioCtxRef.current = audioContext;
        // Mirrors the studio app: SampleService gets `new WasmBpmDetector(url)` so
        // bpm-less imports are measured. Here the demo drives the detector directly.
        detectorRef.current = new WasmBpmDetector(STRETCH_WASM_URL);
        // The SDK deliberately degrades any detector failure to Option.None — which
        // this demo would then present as a confident "no measurable tempo". Probe
        // the module URL once so a missing/unserved wasm gets its own error state
        // instead of masquerading as an honest negative on every file.
        try {
          const probe = await fetch(STRETCH_WASM_URL);
          if (!probe.ok) setDetectorUnavailable(true);
        } catch {
          setDetectorUnavailable(true);
        }
        // The whole point of the verification lane: the click must be audible.
        const settings = project.engine.preferences.settings;
        settings.metronome.enabled = true;
        setProject(project);
        setStatus("Ready — pick a file to analyze");
      } catch (err) {
        // terminate() can itself throw — never let it eat the original error
        try { bootProject?.terminate(); } catch { /* already failing */ }
        console.error("[bpm-detect-demo] init failed: " + String(err));
        setStatus(`Init error: ${String(err)}`);
        setInitError(true);
      }
    })();
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!project) return undefined;
    const sub = project.engine.isPlaying.catchupAndSubscribe(obs => setIsPlaying(obs.getValue()));
    return () => sub.terminate();
  }, [project]);

  const analyze = useCallback(async (id: string, name: string, buffer: AudioBuffer) => {
    const detector = detectorRef.current;
    if (!detector) {
      setAnalysisError("Detector not initialized — reload the page.");
      return;
    }
    setBusyId(id);
    setAnalysisError(null);
    // The result card must describe ONE file: clear the previous result, and
    // disarm Play — the verification track (if any) still holds the old file.
    setResult(null);
    setVerifyName(null);
    setStatus(`Analyzing ${name}…`);
    try {
      // Deliberately NOT sliced to the 60 s analysis window: the engine's bar
      // snap uses the FULL duration it receives, so truncating the buffer here
      // would change results for long files.
      const audioData = audioBufferToAudioData(buffer);
      const started = performance.now();
      // Runs in the SDK's core worker (stretch_wasm.wasm) — main thread stays free.
      // Progress is a formality: the worker reports only completion.
      const bpmOption = await detector.detect(audioData, () => {});
      const elapsedMs = performance.now() - started;
      setResult({
        sourceId: id,
        name,
        seconds: buffer.duration,
        sampleRate: buffer.sampleRate,
        bpm: bpmOption.isEmpty() ? null : bpmOption.unwrap(),
        elapsedMs,
        buffer,
      });
      setStatus("Ready");
    } catch (err) {
      console.error("[bpm-detect-demo] detection failed: " + String(err));
      setAnalysisError(`Detection failed for ${name}: ${String(err)}`);
      setStatus("Ready");
    } finally {
      setBusyId(null);
    }
  }, []);

  /** Ref-based reentrancy guard — state alone can double-fire before a re-render. */
  const beginAnalysis = useCallback((): boolean => {
    if (analyzeBusyRef.current) return false;
    analyzeBusyRef.current = true;
    return true;
  }, []);

  const onSelectGallery = useCallback(async (spec: GalleryFile) => {
    const audioContext = audioCtxRef.current;
    if (!audioContext || !beginAnalysis()) return;
    try {
      setBusyId(spec.id);
      setAnalysisError(null);
      setStatus(`Loading ${spec.name}…`);
      let buffer: AudioBuffer;
      try {
        buffer = await loadAudioFile(audioContext, spec.file);
      } catch (err) {
        console.error("[bpm-detect-demo] could not load gallery file: " + String(err));
        setAnalysisError(`Could not load ${spec.name}: ${String(err)}`);
        setBusyId(null);
        setStatus("Ready");
        return;
      }
      await analyze(spec.id, spec.name, buffer);
    } finally {
      analyzeBusyRef.current = false;
    }
  }, [analyze, beginAnalysis]);

  const onCustomFile = useCallback(async (file: File, skippedCount = 0) => {
    const audioContext = audioCtxRef.current;
    if (!audioContext || !beginAnalysis()) return;
    try {
      setBusyId("drop");
      setAnalysisError(null);
      setStatus(
        skippedCount > 0
          ? `${skippedCount + 1} files dropped — analyzing "${file.name}" (one at a time)…`
          : `Decoding ${file.name}…`
      );
      let buffer: AudioBuffer;
      try {
        const arrayBuffer = await file.arrayBuffer();
        buffer = await audioContext.decodeAudioData(arrayBuffer);
      } catch (err) {
        console.warn("[bpm-detect-demo] could not decode dropped file: " + String(err));
        setAnalysisError(`Could not decode "${file.name}" — drop a wav/mp3/m4a audio file.`);
        setBusyId(null);
        setStatus("Ready");
        return;
      }
      await analyze("drop", file.name, buffer);
    } finally {
      analyzeBusyRef.current = false;
    }
  }, [analyze, beginAnalysis]);

  const onVerify = useCallback(async () => {
    if (!project || !result || result.bpm === null || verifyBusy) return;
    const detectedBpm = result.bpm;
    setVerifyBusy(true);
    setStatus(`Loading ${result.name} at ${detectedBpm.toFixed(2)} BPM…`);
    let uuidString: string | null = null;
    try {
      project.engine.stop(true);
      // Replace any previous verification track. audioUnitBox.delete() cascades to
      // its track lane and region; the file and events boxes are freestanding
      // (referenced by the region, not owned) so they go explicitly. Ref and
      // buffer-map cleanup happen AFTER the transaction commits — a throw aborts
      // the whole delete, and the surviving track must stay recoverable.
      const previous = verifyTrackRef.current;
      if (previous) {
        project.editing.modify(() => {
          previous.audioUnitBox.delete();
          previous.audioFileBox.delete();
          previous.eventsBox.delete();
        });
        verifyTrackRef.current = null;
        localBuffersRef.current.delete(previous.uuidString);
      }
      // Tempo first, in its own transaction (separate-transaction rule): the
      // PPQN durations computed from detectedBpm below only map back to the
      // file's real length at playback if the project bpm matches, and the
      // metronome click reads it live.
      project.editing.modify(() => {
        project.timelineBox.bpm.setValue(detectedBpm);
      });
      const fileUUID = UUID.generate();
      uuidString = UUID.toString(fileUUID);
      const durationPPQN = PPQN.secondsToPulses(result.buffer.duration, detectedBpm);
      // Loop end snapped UP to a whole bar: wrapping mid-beat would jump the
      // metronome's click phase, which is exactly what the ear is judging here.
      const loopEndPPQN = Math.ceil(durationPPQN / PPQN.Bar) * PPQN.Bar;
      let created: VerifyTrack | null = null;
      project.editing.modify(() => {
        const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Tape);
        // Headroom so the metronome click stays audible over full-scale material.
        audioUnitBox.volume.setValue(-6);
        const audioFileBox = AudioFileBox.create(project.boxGraph, fileUUID, box => {
          box.fileName.setValue(result.name);
          box.endInSeconds.setValue(result.buffer.duration);
        });
        const eventsBox = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());
        AudioRegionBox.create(project.boxGraph, UUID.generate(), box => {
          box.regions.refer(trackBox.regions);
          box.file.refer(audioFileBox);
          box.events.refer(eventsBox.owners);
          box.position.setValue(0);
          box.duration.setValue(durationPPQN);
          box.loopOffset.setValue(0);
          box.loopDuration.setValue(durationPPQN);
          box.label.setValue(result.name);
          box.mute.setValue(false);
        });
        const { loopArea } = project.timelineBox;
        loopArea.from.setValue(0);
        loopArea.to.setValue(loopEndPPQN);
        loopArea.enabled.setValue(true);
        created = { audioUnitBox, audioFileBox, eventsBox, uuidString: uuidString!, name: result.name };
      });
      verifyTrackRef.current = created;
      // Register the buffer only after the create transaction commits, so a
      // transaction throw doesn't strand an unreferenced AudioBuffer in the map.
      localBuffersRef.current.set(uuidString, result.buffer);
      // One-shot queryLoadingComplete can resolve false while the sample is
      // still in flight — the poll helper rejects with the real error/timeout.
      await waitForLoadingComplete(project);
      project.engine.setPosition(0);
      setVerifyName(result.name);
      project.engine.play();
      setStatus(`Playing ${result.name} with the metronome at ${detectedBpm.toFixed(2)} BPM`);
    } catch (err) {
      console.error("[bpm-detect-demo] verify failed: " + String(err));
      // The graph may hold partial state (tempo changed, old track deleted,
      // new one absent or unloaded) — disarm Play and say so prominently.
      setVerifyName(null);
      if (uuidString !== null && verifyTrackRef.current === null) {
        localBuffersRef.current.delete(uuidString);
      }
      setAnalysisError(`Could not start verification: ${String(err)}`);
      setStatus("Ready");
    } finally {
      setVerifyBusy(false);
    }
  }, [project, result, verifyBusy]);

  const onPlay = useCallback(() => { project?.engine.play(); }, [project]);
  const onStop = useCallback(() => { project?.engine.stop(true); }, [project]);

  const truncated = result !== null && result.seconds > ANALYSIS_WINDOW_SECONDS;

  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{BPM_STYLES}</style>
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <div className="mc-kicker">Tempo Analysis · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>BPM DETECT</h1>
          <p className="mc-intro">
            The SDK&apos;s <code>WasmBpmDetector</code>: spectral-flux onset detection,
            autocorrelated with a harmonic comb and a log-normal tempo prior, running in
            the core worker on <code>stretch_wasm.wasm</code>. It reports <em>one global
            tempo per file</em> — or, for material without a measurable pulse, an honest
            &ldquo;unknown&rdquo; instead of a fabricated number. Analyze a bundled file
            or drop your own, then prove the result by ear: the file plays against
            OpenDAW&apos;s metronome at the detected tempo.
          </p>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Button onClick={onPlay} disabled={verifyName === null || isPlaying}>▶ Play</Button>
              <Button variant="soft" onClick={onStop} disabled={!project}>■ Stop</Button>
              <Separator orientation="vertical" />
              <Badge color={initError ? "red" : project ? "amber" : "gray"}>
                {initError ? "Init failed" : project ? "Ready" : "Booting…"}
              </Badge>
              <Text size="1" color="gray">{status}</Text>
            </Flex>
          </Card>

          {project && (
            <>
              {detectorUnavailable && (
                <Callout.Root color="red" role="alert" size="1">
                  <Callout.Text>
                    The analysis module (<code>{STRETCH_WASM_URL}</code>) could not be
                    fetched. The SDK degrades detector failures to &ldquo;no tempo&rdquo;
                    rather than throwing, so every result below would read as
                    &ldquo;No measurable tempo&rdquo; regardless of the material — treat
                    them as unavailable, not as answers.
                  </Callout.Text>
                </Callout.Root>
              )}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold">Result</Text>
                  {result ? (
                    <>
                      <Flex align="baseline" gap="3" wrap="wrap">
                        {result.bpm !== null ? (
                          <>
                            <Text
                              size="8"
                              weight="bold"
                              style={{ fontVariantNumeric: "tabular-nums", color: "var(--mc-amber)" }}
                            >
                              {result.bpm.toFixed(2)}
                            </Text>
                            <Text size="3" color="gray">BPM</Text>
                          </>
                        ) : (
                          <Text size="6" weight="bold" style={{ color: "var(--mc-amber)" }}>
                            No measurable tempo
                          </Text>
                        )}
                        <Separator orientation="vertical" />
                        <Text size="1" color="gray">{result.name}</Text>
                        <Text size="1" color="gray">{formatDuration(result.seconds)}</Text>
                        <Text size="1" color="gray">analyzed in {result.elapsedMs.toFixed(0)} ms</Text>
                      </Flex>
                      {result.bpm === null && (
                        <Text size="1" color="gray">
                          The detector answered <code>Option.None</code> — no onsets, or no
                          periodic pulse above its correlation gate. The SDK stores bpm 0
                          for such samples and leaves them in seconds rather than warping
                          them to a fabricated tempo. (A broken analysis module degrades to
                          the same answer — if every file reports this, check the console.)
                        </Text>
                      )}
                      {truncated && (
                        <Callout.Root color="amber" size="1">
                          <Callout.Text>
                            This file runs {formatDuration(result.seconds)}, but detection
                            reads only the <strong>first {ANALYSIS_WINDOW_SECONDS} seconds</strong>{" "}
                            (<code>max_analysis_seconds</code>). Tempo is treated as a global
                            property: a tempo change later in the file is never seen, and one
                            number is reported for the whole file.
                          </Callout.Text>
                        </Callout.Root>
                      )}
                      <Flex align="center" gap="3" wrap="wrap">
                        <Button
                          onClick={onVerify}
                          disabled={result.bpm === null || verifyBusy}
                        >
                          {verifyBusy ? "Loading…" : "♪ Verify with metronome"}
                        </Button>
                        <Text size="1" color="gray">
                          Loads the file on a Tape track, sets the project tempo to the
                          detected BPM and plays with the metronome. Listen for the click{" "}
                          <em>rate</em> matching the material — detection finds the beat
                          period, not its phase, so without downbeat detection the click
                          can sit offset from the hits even when the tempo is right.
                        </Text>
                      </Flex>
                    </>
                  ) : (
                    <Text size="1" color="gray">
                      No file analyzed yet — pick one below or drop your own.
                    </Text>
                  )}
                  {analysisError && (
                    <Callout.Root color="red" role="alert" size="1">
                      <Callout.Text>{analysisError}</Callout.Text>
                    </Callout.Root>
                  )}
                </Flex>
              </Card>

              <Grid columns={{ initial: "1", xs: "2", sm: "4" }} gap="3">
                {GALLERY.map(spec => {
                  const selected = result?.sourceId === spec.id;
                  const busy = busyId === spec.id;
                  return (
                    <Card
                      key={spec.id}
                      className="bpm-file-card"
                      role="button"
                      tabIndex={0}
                      aria-busy={busy}
                      aria-label={`Analyze ${spec.name}`}
                      onClick={() => void onSelectGallery(spec)}
                      onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void onSelectGallery(spec);
                        }
                      }}
                      style={{
                        cursor: busyId === null ? "pointer" : "wait",
                        outline: selected ? "2px solid var(--mc-amber)" : undefined,
                      }}
                    >
                      <Flex direction="column" gap="2">
                        <Flex align="center" justify="between">
                          <Text size="2" weight="bold">{spec.name}</Text>
                          {busy && <Badge color="amber">Analyzing…</Badge>}
                        </Flex>
                        <Text size="1" color="gray">{spec.hint}</Text>
                      </Flex>
                    </Card>
                  );
                })}
              </Grid>

              <DropZone
                ariaLabel="Analyze your own file — drop an audio file or press Enter to browse"
                onFile={(file, skipped) => void onCustomFile(file, skipped)}
                onInvalidDrop={() => setAnalysisError("Drop an audio file (not a link, image or text selection).")}
                disabled={busyId !== null}
              >
                <Flex direction="column" gap="2" align="center" justify="center" style={{ minHeight: 96 }}>
                  <Text size="2" weight="bold">
                    {busyId === "drop" ? "Analyzing…" : "Drop your own audio file"}
                  </Text>
                  <Text size="1" color="gray" align="center">
                    wav / mp3 / m4a — decoded in the browser, analyzed in the worker.
                    Nothing is uploaded.
                  </Text>
                </Flex>
              </DropZone>

              <section style={{ marginTop: 24 }}>
                <div className="mc-kicker">What the detector can — and can&apos;t — do</div>
                <p className="mc-intro">
                  Search range <strong>70–200 BPM</strong> with a preference centered at
                  120. Octave ambiguity is real and benign: a half-time backbeat at 87
                  may report as 174 — every beat still lands on a grid line. If a
                  grid-cut loop measures a hair off (127.94), the estimate snaps so the
                  file spans a whole number of bars (128).
                </p>
                <p className="mc-intro">
                  It analyzes only the <strong>first {ANALYSIS_WINDOW_SECONDS} seconds</strong>{" "}
                  and reports a single tempo for the whole file — there is no segment or
                  tempo-map output, so rubato and mid-file tempo changes are invisible to
                  it. It also reports no beat <strong>phase</strong>: how often beats
                  occur, not where beat one falls. Files shorter than 1.5 s are refused
                  outright.
                </p>
                <p className="mc-intro">
                  In the SDK this detector plugs into <code>SampleService</code>: any
                  import that arrives without a known tempo gets measured, and
                  &ldquo;unknown&rdquo; is stored as bpm 0 so the sample stays in seconds.
                  A recording already knows its tempo, so a caller-supplied bpm always
                  wins over detection.
                </p>
              </section>
            </>
          )}
        </Flex>

        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
