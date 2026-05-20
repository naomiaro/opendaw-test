import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile } from "@/lib/audioUtils";
import { renderOfflineSlice } from "@/lib/offlineScan";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Callout,
  Badge,
  Button,
  Code,
  Separator,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon, StopIcon, ActivityLogIcon } from "@radix-ui/react-icons";

// Target / reference demo. Runs the SAME crossfade scenario through
// three different paths so a listener (and the offline scan) can
// compare them directly:
//
//   ALIGNED   — pure Web Audio. Phase-correlate file A's tail
//               against file B's head, apply the integer-sample
//               shift to file B's read offset, build a single
//               AudioBuffer with a linear crossfade, play via
//               AudioBufferSourceNode. THIS IS THE AUDIBLE TARGET.
//
//   UNALIGNED — pure Web Audio, identical to ALIGNED but with
//               shift = 0. Demonstrates what a phase-mismatched
//               linear crossfade sounds like (sub-unity sum, audible
//               dip mid-crossfade). Control / counter-example.
//
//   OPENDAW   — same scenario through OpenDAW: two AudioFileBoxes,
//               two AudioRegionBoxes on SEPARATE Tape tracks (one
//               region per track) with 40 ms linear crossfade
//               extensions, the phase-correlate shift applied via
//               loopOffset on region B. Two tracks rather than one
//               sidesteps the per-track no-overlap invariant — see
//               `debug/project-copy-deletes-overlapping-regions.md`
//               (placing both overlapping regions on a single track
//               caused `project.copy()` to silently delete them
//               during validation, making offline rendering
//               impossible). The track outputs sum at the master,
//               so the crossfade emerges from mixing two separate
//               voice paths. Should match ALIGNED once the engine
//               artifacts documented in the sibling debug notes
//               (shared-source-double-process, voice-fadein-clip-
//               fadein-product) are resolved.
//
// Audio fixtures: test-440hz.wav and test-440hz-offset30.wav. File B
// is file A delayed by 30 samples at the WAV's authored 44.1 kHz
// (~0.680 ms ~24° at 440 Hz) — a deliberately phase-offset pair so
// the alignment shift is non-trivial and the without-alignment dip is
// audible.

const FILE_A = "/audio/test-440hz.wav";
const FILE_B = "/audio/test-440hz-offset30.wav";
const BPM = 120;
// File B is file A delayed by 30 samples at the WAV's authored 44.1 kHz.
// In time, that's 0.680 ms — preserved through decodeAudioData's resample
// to AudioContext rate, regardless of the runtime rate.
const SOURCE_OFFSET_SECONDS = 30 / 44100;
const TOTAL_DURATION_SECONDS = 60;
const SEAM_SECONDS = 30;
const PLAYBACK_START_SECONDS = 28;
const CROSSFADE_MS = 40;

// Phase-correlation parameters. Window straddles the seam in both files
// (HALF_WINDOW_SEC before / after). Search range is half a period at the
// lowest expected fundamental — for a 440 Hz test signal, ± half a
// 440-Hz period is ~50 samples at 44.1 kHz / ~54 at 48 kHz. Keep the
// search strictly within half-period to avoid the well-known period
// wrap-around ambiguity for purely periodic signals.
const WINDOW_SEC = 0.02;
const HALF_WINDOW_SEC = WINDOW_SEC / 2;
const MAX_SHIFT_SEC = 0.005; // ±5 ms, well under half a 440 Hz period

type Scenario = "aligned" | "unaligned" | "opendaw";

/**
 * Pure-JS normalized cross-correlation; ported from the same algorithm
 * used by the Studio (`phaseCorrelate.js`). Returns the integer sample
 * shift in `[-maxShiftSamples, +maxShiftSamples]` that maximises the
 * correlation between the fixed reference window and a sliding window
 * inside target.
 */
function phaseCorrelate(
  reference: Float32Array,
  target: Float32Array,
  maxShiftSamples: number
): { shiftSamples: number; score: number } {
  const W = reference.length;
  if (target.length < W + 2 * maxShiftSamples) {
    throw new Error(
      `target length ${target.length} < required ${W + 2 * maxShiftSamples}`
    );
  }
  let refNormSq = 0;
  for (let i = 0; i < W; i++) refNormSq += reference[i] * reference[i];
  const refNorm = Math.sqrt(refNormSq);
  if (refNorm === 0) return { shiftSamples: 0, score: 0 };

  let bestK = 0;
  let bestScore = -Infinity;
  for (let k = -maxShiftSamples; k <= maxShiftSamples; k++) {
    const offset = maxShiftSamples + k;
    let dot = 0;
    let tgtNormSq = 0;
    for (let i = 0; i < W; i++) {
      const t = target[offset + i];
      dot += reference[i] * t;
      tgtNormSq += t * t;
    }
    if (tgtNormSq === 0) continue;
    const score = dot / (refNorm * Math.sqrt(tgtNormSq));
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
    }
  }
  return { shiftSamples: bestK, score: bestScore === -Infinity ? 0 : bestScore };
}

/**
 * Build a new mono AudioBuffer that plays file A from 0 → seam-halfFade,
 * crossfades A → B across the fade window, then plays B (shifted by
 * `shiftSamples`) from seam+halfFade onwards. Linear gain (equal-gain)
 * crossfade — phase-aligned identical-source signals sum to unity,
 * which is exactly what we want here.
 */
function buildCrossfadedOutput(
  bufferA: AudioBuffer,
  bufferB: AudioBuffer,
  destinationContext: BaseAudioContext,
  seamSeconds: number,
  crossfadeMs: number,
  shiftSamples: number
): AudioBuffer {
  const sampleRate = destinationContext.sampleRate;
  const totalSamples = Math.min(bufferA.length, bufferB.length);
  const out = destinationContext.createBuffer(1, totalSamples, sampleRate);
  const outData = out.getChannelData(0);
  const a = bufferA.getChannelData(0);
  const b = bufferB.getChannelData(0);
  const seamSample = Math.floor(seamSeconds * sampleRate);
  const halfFadeSamples = Math.floor((crossfadeMs / 2000) * sampleRate);
  const fadeStart = seamSample - halfFadeSamples;
  const fadeEnd = seamSample + halfFadeSamples;

  // Pre-fade: file A only.
  for (let i = 0; i < fadeStart; i++) {
    outData[i] = a[i];
  }
  // Crossfade: linear A → B.
  const fadeLen = fadeEnd - fadeStart;
  for (let i = fadeStart; i < fadeEnd; i++) {
    const t = (i - fadeStart) / fadeLen;
    const aSample = i < a.length ? a[i] : 0;
    const bIndex = i + shiftSamples;
    const bSample = bIndex >= 0 && bIndex < b.length ? b[bIndex] : 0;
    outData[i] = aSample * (1 - t) + bSample * t;
  }
  // Post-fade: file B only, with the shift applied.
  for (let i = fadeEnd; i < totalSamples; i++) {
    const bIndex = i + shiftSamples;
    outData[i] = bIndex >= 0 && bIndex < b.length ? b[bIndex] : 0;
  }
  return out;
}

interface ScanResult {
  text: string;
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [scenario, setScenario] = useState<Scenario>("aligned");
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [computedShift, setComputedShift] = useState<{ samples: number; score: number } | null>(
    null
  );
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<{ a: AudioBuffer | null; b: AudioBuffer | null }>({
    a: null,
    b: null,
  });
  const playbackRef = useRef<{ source: AudioBufferSourceNode | null; startTime: number }>({
    source: null,
    startTime: 0,
  });
  const animationFrameRef = useRef<number | null>(null);

  // OpenDAW-side state. We use the SAME AudioContext that initializeOpenDAW
  // creates so pure-Web-Audio playback and OpenDAW playback share an audio
  // device. project.engine drives playback for the OPENDAW scenario.
  const [openDawProject, setOpenDawProject] = useState<Project | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const openDawPlayheadSubRef = useRef<{ terminate(): void } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStatus("Initializing OpenDAW…");
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;
        audioContextRef.current = newAudioContext;
        setOpenDawProject(newProject);

        setStatus("Loading test-440hz files…");
        const [a, b] = await Promise.all([
          loadAudioFile(newAudioContext, FILE_A),
          loadAudioFile(newAudioContext, FILE_B),
        ]);
        if (!mounted) return;
        buffersRef.current = { a, b };

        // Run phase correlation once at load.
        const sr = newAudioContext.sampleRate;
        const aData = a.getChannelData(0);
        const bData = b.getChannelData(0);
        const halfWindow = Math.round(HALF_WINDOW_SEC * sr);
        const maxShiftSamples = Math.round(MAX_SHIFT_SEC * sr);
        const seamSample = Math.floor(SEAM_SECONDS * sr);
        const reference = aData.slice(seamSample - halfWindow, seamSample + halfWindow);
        const target = bData.slice(
          seamSample - halfWindow - maxShiftSamples,
          seamSample + halfWindow + maxShiftSamples
        );
        const result = phaseCorrelate(reference, target, maxShiftSamples);
        if (!mounted) return;
        setComputedShift({ samples: result.shiftSamples, score: result.score });

        // Build the OpenDAW project. Two AudioFileBoxes (distinct UUIDs, same
        // content can be loaded under each — we use the real on-disk files
        // here), two AudioRegionBoxes with a 40 ms linear crossfade centred
        // on the seam, and loopOffset on Region B compensating BOTH the
        // 30-sample source delay AND the phase-correlate shift so the
        // engine receives a phase-aligned crossfade configuration.
        const uuidA = UUID.generate();
        const uuidB = UUID.generate();
        localAudioBuffersRef.current.set(UUID.toString(uuidA), a);
        localAudioBuffersRef.current.set(UUID.toString(uuidB), b);

        const shiftSeconds = result.shiftSamples / sr;
        const bpm = newProject.timelineBox.bpm.getValue();
        const fullDurationPPQN = PPQN.secondsToPulses(a.duration, bpm);
        const seamPPQN = PPQN.secondsToPulses(SEAM_SECONDS, bpm);
        const halfFadeSec = CROSSFADE_MS / 2000;
        const halfFadePPQN = PPQN.secondsToPulses(halfFadeSec, bpm);
        const fadePPQN = PPQN.secondsToPulses(CROSSFADE_MS / 1000, bpm);
        // loopOffset for region B = (seam − half-fade) + shiftSeconds. The
        // phase-correlation result already finds the absolute sample shift
        // that aligns file B's buffer with file A's at the seam — it
        // operates on the raw resampled AudioBuffers, so it implicitly
        // accounts for the 30-sample authored delay in file B. Adding a
        // separate `SOURCE_OFFSET_SECONDS` term on top of `shiftSeconds`
        // double-counts the delay and produces a phase mismatch in OpenDAW
        // playback (≈ −13.9 dB dip in the offline scan vs the ≈ 1.0 ratio
        // the pure-JS ALIGNED case achieves).
        const loopOffsetBSec = SEAM_SECONDS - halfFadeSec + shiftSeconds;
        const loopOffsetBPPQN = PPQN.secondsToPulses(loopOffsetBSec, bpm);

        // Use SEPARATE tracks for the two regions so they can overlap in
        // timeline (crossfade) without violating the per-track no-overlap
        // invariant that `project.copy()` enforces. See
        // `debug/project-copy-deletes-overlapping-regions.md` — overlapping
        // regions on the same track are deleted during copy, which makes
        // offline rendering of any crossfade impossible. Separate tracks
        // each have their own `regions` collection, so each track has only
        // one region; the overlap is between tracks and the mix happens
        // when the engine sums the track outputs.
        let trackBoxA: { regions: unknown };
        let trackBoxB: { regions: unknown };
        newProject.editing.modify(() => {
          trackBoxA = newProject.api.createInstrument(InstrumentFactories.Tape)
            .trackBox as { regions: unknown };
        });
        newProject.editing.modify(() => {
          trackBoxB = newProject.api.createInstrument(InstrumentFactories.Tape)
            .trackBox as { regions: unknown };
        });
        newProject.editing.modify(() => {
          const fileBoxA = AudioFileBox.create(newProject.boxGraph, uuidA, (box) => {
            box.fileName.setValue("test-440hz.wav");
            box.endInSeconds.setValue(a.duration);
          });
          const fileBoxB = AudioFileBox.create(newProject.boxGraph, uuidB, (box) => {
            box.fileName.setValue("test-440hz-offset30.wav");
            box.endInSeconds.setValue(b.duration);
          });
          const eventsA = ValueEventCollectionBox.create(
            newProject.boxGraph,
            UUID.generate()
          );
          AudioRegionBox.create(newProject.boxGraph, UUID.generate(), (box) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            box.regions.refer((trackBoxA as any).regions);
            box.file.refer(fileBoxA);
            box.events.refer(eventsA.owners);
            box.position.setValue(0);
            box.duration.setValue(seamPPQN + halfFadePPQN);
            box.loopOffset.setValue(0);
            box.loopDuration.setValue(fullDurationPPQN);
            box.label.setValue("A");
            box.mute.setValue(false);
            box.fading.in.setValue(0);
            box.fading.out.setValue(fadePPQN);
            box.fading.inSlope.setValue(0.5);
            box.fading.outSlope.setValue(0.5);
          });
          const eventsB = ValueEventCollectionBox.create(
            newProject.boxGraph,
            UUID.generate()
          );
          AudioRegionBox.create(newProject.boxGraph, UUID.generate(), (box) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            box.regions.refer((trackBoxB as any).regions);
            box.file.refer(fileBoxB);
            box.events.refer(eventsB.owners);
            box.position.setValue(seamPPQN - halfFadePPQN);
            box.duration.setValue(fullDurationPPQN - seamPPQN + halfFadePPQN);
            box.loopOffset.setValue(loopOffsetBPPQN);
            box.loopDuration.setValue(fullDurationPPQN);
            box.label.setValue("B (shifted)");
            box.mute.setValue(false);
            box.fading.in.setValue(fadePPQN);
            box.fading.out.setValue(0);
            box.fading.inSlope.setValue(0.5);
            box.fading.outSlope.setValue(0.5);
          });
          newProject.timelineBox.loopArea.enabled.setValue(false);
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(fullDurationPPQN);
        });

        newProject.engine.isPlaying.catchupAndSubscribe((obs) => {
          if (!mounted) return;
          const playing = obs.getValue();
          // Mirror OpenDAW's play state into the demo's isPlaying. Pure-Web-
          // Audio playback manages isPlaying separately via source.onended.
          if (scenario === "opendaw" || playing) {
            setIsPlaying(playing);
          }
        });

        setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${String(error)}`);
      }
    })();
    return () => {
      mounted = false;
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      if (openDawPlayheadSubRef.current) openDawPlayheadSubRef.current.terminate();
      if (playbackRef.current.source) {
        try {
          playbackRef.current.source.stop();
        } catch (_) {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updatePlayhead = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !playbackRef.current.source) return;
    const elapsed = ctx.currentTime - playbackRef.current.startTime;
    setPositionSec(PLAYBACK_START_SECONDS + elapsed);
    animationFrameRef.current = requestAnimationFrame(updatePlayhead);
  }, []);

  // Helper: stop any in-flight playback from BOTH paths (pure-Web-Audio
  // BufferSource and OpenDAW engine). Switching scenarios always passes
  // through a full stop so the two audio paths don't overlap.
  const stopAllPlayback = useCallback(() => {
    if (playbackRef.current.source) {
      try {
        playbackRef.current.source.stop();
      } catch (_) {
        // ignore
      }
      playbackRef.current.source = null;
    }
    if (openDawProject && openDawProject.engine.isPlaying.getValue()) {
      openDawProject.engine.stop(true);
    }
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (openDawPlayheadSubRef.current) {
      openDawPlayheadSubRef.current.terminate();
      openDawPlayheadSubRef.current = null;
    }
    setIsPlaying(false);
  }, [openDawProject]);

  const handlePlay = useCallback(
    async (next: Scenario) => {
      const ctx = audioContextRef.current;
      const bufferA = buffersRef.current.a;
      const bufferB = buffersRef.current.b;
      if (!ctx || !bufferA || !bufferB || !computedShift) return;

      if (ctx.state === "suspended") await ctx.resume();
      stopAllPlayback();
      setScenario(next);

      if (next === "opendaw") {
        if (!openDawProject) return;
        const bpm = openDawProject.timelineBox.bpm.getValue();
        openDawProject.engine.setPosition(PPQN.secondsToPulses(PLAYBACK_START_SECONDS, bpm));
        openDawProject.engine.play();
        setIsPlaying(true);
        setPositionSec(PLAYBACK_START_SECONDS);
        // Drive the playhead readout from OpenDAW's engine position via
        // AnimationFrame (same pattern as the other debug demos).
        const sub = AnimationFrame.add(() => {
          const positionPpqn = openDawProject.engine.position.getValue();
          setPositionSec(PPQN.pulsesToSeconds(positionPpqn, bpm));
        });
        openDawPlayheadSubRef.current = sub;
        return;
      }

      // ALIGNED / UNALIGNED — pure Web Audio.
      const shiftForScenario = next === "aligned" ? computedShift.samples : 0;
      const outputBuffer = buildCrossfadedOutput(
        bufferA,
        bufferB,
        ctx,
        SEAM_SECONDS,
        CROSSFADE_MS,
        shiftForScenario
      );

      const source = ctx.createBufferSource();
      source.buffer = outputBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (playbackRef.current.source === source) {
          playbackRef.current.source = null;
          setIsPlaying(false);
          if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
        }
      };
      source.start(0, PLAYBACK_START_SECONDS);
      playbackRef.current = { source, startTime: ctx.currentTime };
      setIsPlaying(true);
      setPositionSec(PLAYBACK_START_SECONDS);
      if (animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(updatePlayhead);
      }
    },
    [computedShift, openDawProject, stopAllPlayback, updatePlayhead]
  );

  const handleStop = useCallback(() => {
    stopAllPlayback();
  }, [stopAllPlayback]);

  const handleScan = useCallback(async () => {
    const ctx = audioContextRef.current;
    const bufferA = buffersRef.current.a;
    const bufferB = buffersRef.current.b;
    if (!ctx || !bufferA || !bufferB || !computedShift || scanning) return;
    setScanning(true);
    setScanResult(null);
    try {
      const sr = ctx.sampleRate;
      const sliceStart = SEAM_SECONDS - 0.05;
      const sliceEnd = SEAM_SECONDS + 0.05;
      let data: Float32Array;
      let renderedSampleRate: number;
      if (scenario === "opendaw") {
        if (!openDawProject) throw new Error("OpenDAW project not ready");
        // Stop OpenDAW live playback before offline-rendering; OfflineAudioContext
        // is independent but project.copy() snapshots state, so it's cleaner to
        // not have the live engine running concurrently.
        if (openDawProject.engine.isPlaying.getValue()) openDawProject.engine.stop(true);
        const offlineResult = await renderOfflineSlice(
          openDawProject,
          sliceStart,
          sliceEnd,
          sr
        );
        data = offlineResult.channels[0];
        renderedSampleRate = offlineResult.sampleRate;
      } else {
        // Pure Web Audio: render the same output buffer the live playback uses
        // via OfflineAudioContext.
        const sliceSamples = Math.ceil((sliceEnd - sliceStart) * sr);
        const offline = new OfflineAudioContext(1, sliceSamples, sr);
        const shiftForScenario = scenario === "aligned" ? computedShift.samples : 0;
        const outputBuffer = buildCrossfadedOutput(
          bufferA,
          bufferB,
          offline,
          SEAM_SECONDS,
          CROSSFADE_MS,
          shiftForScenario
        );
        const source = offline.createBufferSource();
        source.buffer = outputBuffer;
        source.connect(offline.destination);
        source.start(0, sliceStart);
        const rendered = await offline.startRendering();
        data = rendered.getChannelData(0);
        renderedSampleRate = rendered.sampleRate;
      }
      const sr2 = renderedSampleRate;

      // Compute peak in pre-seam reference, peak / min-envelope in crossfade
      // overlap, and max |Δsample| anywhere in the rendered slice.
      const indexAtSeconds = (sec: number) =>
        Math.max(0, Math.min(data.length, Math.round((sec - sliceStart) * sr2)));
      const peakInRange = (startSec: number, endSec: number) => {
        let peak = 0;
        const s = indexAtSeconds(startSec);
        const e = indexAtSeconds(endSec);
        for (let i = s; i < e; i++) {
          const abs = Math.abs(data[i]);
          if (abs > peak) peak = abs;
        }
        return peak;
      };
      const minEnvelopeInRange = (startSec: number, endSec: number, windowMs: number) => {
        const winSamples = Math.max(1, Math.round((windowMs / 1000) * sr2));
        const stride = Math.max(1, Math.floor(winSamples / 2));
        let minPeak = Infinity;
        let atIdx = indexAtSeconds(startSec);
        const s = indexAtSeconds(startSec);
        const e = indexAtSeconds(endSec);
        for (let start = s; start + winSamples <= e; start += stride) {
          let localPeak = 0;
          for (let i = start; i < start + winSamples; i++) {
            const abs = Math.abs(data[i]);
            if (abs > localPeak) localPeak = abs;
          }
          if (localPeak < minPeak) {
            minPeak = localPeak;
            atIdx = start + Math.floor(winSamples / 2);
          }
        }
        return {
          minPeak: minPeak === Infinity ? 0 : minPeak,
          atSec: sliceStart + atIdx / sr2,
        };
      };
      const maxDeltaInRange = (startSec: number, endSec: number) => {
        let maxDelta = 0;
        let atIdx = indexAtSeconds(startSec);
        const s = Math.max(1, indexAtSeconds(startSec));
        const e = indexAtSeconds(endSec);
        for (let i = s; i < e; i++) {
          const d = Math.abs(data[i] - data[i - 1]);
          if (d > maxDelta) {
            maxDelta = d;
            atIdx = i - 1;
          }
        }
        return { maxDelta, atSec: sliceStart + atIdx / sr2 };
      };

      const halfFadeSec = CROSSFADE_MS / 2000;
      const ref = peakInRange(SEAM_SECONDS - 0.04, SEAM_SECONDS - halfFadeSec - 0.005);
      const dip = minEnvelopeInRange(
        SEAM_SECONDS - halfFadeSec,
        SEAM_SECONDS + halfFadeSec,
        2.5
      );
      const delta = maxDeltaInRange(SEAM_SECONDS - 0.005, SEAM_SECONDS + 0.005);
      const expectedDelta = (2 * Math.PI * 440 * 0.5) / sr2;
      const ratio = ref > 1e-6 ? dip.minPeak / ref : 0;
      const ratioDb = ratio > 1e-6 ? 20 * Math.log10(ratio) : -Infinity;

      const appliedShift =
        scenario === "aligned" || scenario === "opendaw"
          ? computedShift.samples
          : 0;
      setScanResult({
        text: [
          `scenario             : ${scenario.toUpperCase()}`,
          `sample rate          : ${sr2} Hz`,
          `phase-correlate shift: ${computedShift.samples} samples (score ${computedShift.score.toFixed(4)}); applied shift = ${appliedShift}`,
          ``,
          `── crossfade envelope ──`,
          `reference peak       : ${ref.toFixed(4)}  (in [${(SEAM_SECONDS - 0.04).toFixed(3)} s, ${(SEAM_SECONDS - halfFadeSec - 0.005).toFixed(3)} s])`,
          `min envelope peak    : ${dip.minPeak.toFixed(4)}  (2.5 ms windows across [${(SEAM_SECONDS - halfFadeSec).toFixed(3)} s, ${(SEAM_SECONDS + halfFadeSec).toFixed(3)} s])`,
          `min / reference      : ${ratio.toFixed(4)}  (${ratioDb.toFixed(2)} dB; ALIGNED should be ≈ 1.0, UNALIGNED dips noticeably)`,
          `dip located at       : ${dip.atSec.toFixed(6)} s  (τ = ${((dip.atSec - SEAM_SECONDS) * 1000).toFixed(3)} ms relative to seam)`,
          ``,
          `── sample-to-sample Δ ──`,
          `expected clean max Δ : ${expectedDelta.toFixed(5)}  (= 2π·440·0.5/SR)`,
          `seam-band max |Δ|    : ${delta.maxDelta.toFixed(5)}  (in [${(SEAM_SECONDS - 0.005).toFixed(3)} s, ${(SEAM_SECONDS + 0.005).toFixed(3)} s])`,
          `largest jump at      : ${delta.atSec.toFixed(6)} s  (τ = ${((delta.atSec - SEAM_SECONDS) * 1000).toFixed(3)} ms relative to seam)`,
        ].join("\n"),
      });
    } catch (error) {
      setScanResult({ text: `Error: ${String(error)}` });
    } finally {
      setScanning(false);
    }
  }, [computedShift, scanning, scenario]);

  const inCrossfadeRegion =
    positionSec > SEAM_SECONDS - CROSSFADE_MS / 2000 - 0.005 &&
    positionSec < SEAM_SECONDS + CROSSFADE_MS / 2000 + 0.005;

  return (
    <Theme appearance="dark" accentColor="green">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Target Crossfade — Pure Web Audio vs OpenDAW
          </Heading>

          <Callout.Root color="green">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              Same crossfade scenario rendered three ways for direct A/B/C comparison.{" "}
              <strong>ALIGNED</strong> (pure Web Audio + phase correlation + linear crossfade)
              is the audible target. <strong>UNALIGNED</strong> (pure Web Audio, no phase shift)
              is the control showing what mis-aligned linear crossfade sounds like.{" "}
              <strong>OPENDAW</strong> is the same scenario rendered through OpenDAW's
              <Code>TapeDeviceProcessor</Code> with the phase-correlate shift applied via{" "}
              <Code>loopOffset</Code> — should match ALIGNED once the engine artifacts documented
              in the sibling debug notes are resolved.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">
                Status:
              </Text>
              <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
                {status}
              </Badge>
              {isPlaying && (
                <Badge color="amber">
                  Playing:{" "}
                  {scenario === "aligned"
                    ? "ALIGNED"
                    : scenario === "unaligned"
                      ? "UNALIGNED"
                      : "OPENDAW"}
                </Badge>
              )}
              <Text size="2" weight="bold">
                Position:
              </Text>
              <Badge color={inCrossfadeRegion ? "red" : isPlaying ? "amber" : "gray"} size="2">
                <Code>
                  {positionSec.toFixed(3)} s
                  {inCrossfadeRegion ? " ← CROSSFADE" : ""}
                </Code>
              </Badge>
              <Text size="2" color="gray">
                (seam at {SEAM_SECONDS}.000 s, crossfade ±{CROSSFADE_MS / 2} ms)
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">
                Phase correlation
              </Text>
              <Separator size="4" />
              {computedShift ? (
                <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                  {[
                    `window         : ${(WINDOW_SEC * 1000).toFixed(1)} ms (${(HALF_WINDOW_SEC * 1000).toFixed(1)} ms either side of seam)`,
                    `search range   : ±${(MAX_SHIFT_SEC * 1000).toFixed(1)} ms`,
                    `shift found    : ${computedShift.samples} samples (${((computedShift.samples / (audioContextRef.current?.sampleRate ?? 48000)) * 1000).toFixed(4)} ms)`,
                    `score          : ${computedShift.score.toFixed(6)}  (1.0 = perfect alignment)`,
                  ].join("\n")}
                </Code>
              ) : (
                <Text size="2" color="gray">
                  Awaiting audio load…
                </Text>
              )}
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">
                Reproduce
              </Text>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2">
                  Playback starts at <Code>{PLAYBACK_START_SECONDS}</Code> s so the seam at{" "}
                  <Code>{SEAM_SECONDS}</Code> s is reached in ~2 s.
                </Text>
                <Text size="2">
                  <strong>ALIGNED</strong> (pure Web Audio, target): apply the phase-correlate
                  shift to file B's read offset before the linear crossfade. Two phase-aligned
                  identical-source signals sum to unity through the crossfade.
                </Text>
                <Text size="2">
                  <strong>UNALIGNED</strong> (pure Web Audio, control): identical setup but with{" "}
                  <Code>shift = 0</Code>. Phase mismatch through the crossfade produces a
                  sub-unity sum — an audible dip centred mid-crossfade.
                </Text>
                <Text size="2">
                  <strong>OPENDAW</strong>: same scenario through OpenDAW's{" "}
                  <Code>TapeDeviceProcessor</Code>. Two <Code>AudioFileBox</Code>es, two{" "}
                  <Code>AudioRegionBox</Code>es with 40 ms linear fades on each side, phase-shift
                  applied via <Code>loopOffset</Code> on region B. Should sound identical to
                  ALIGNED; currently does not (engine artifacts documented elsewhere).
                </Text>
              </Flex>
              <Flex gap="3" wrap="wrap">
                <Button
                  onClick={() => handlePlay("aligned")}
                  disabled={status !== "Ready" || scanning}
                  color="green"
                  size="3"
                >
                  <PlayIcon /> Play (ALIGNED — target)
                </Button>
                <Button
                  onClick={() => handlePlay("unaligned")}
                  disabled={status !== "Ready" || scanning}
                  color="amber"
                  size="3"
                >
                  <PlayIcon /> Play (UNALIGNED — control)
                </Button>
                <Button
                  onClick={() => handlePlay("opendaw")}
                  disabled={status !== "Ready" || scanning || !openDawProject}
                  color="ruby"
                  size="3"
                >
                  <PlayIcon /> Play (OPENDAW)
                </Button>
                <Button onClick={handleStop} disabled={!isPlaying} variant="soft" size="3">
                  <StopIcon /> Stop
                </Button>
                <Button
                  onClick={handleScan}
                  disabled={status !== "Ready" || scanning}
                  variant="soft"
                  color="amber"
                  size="3"
                >
                  <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan current scenario"}
                </Button>
              </Flex>
              {scanResult && (
                <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                  {scanResult.text}
                </Code>
              )}
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">
                Configuration
              </Text>
              <Separator size="4" />
              <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                {`File A:              test-440hz.wav (${TOTAL_DURATION_SECONDS} s, 440 Hz sine)
File B:              test-440hz-offset30.wav (B delayed ~0.680 ms / ~24° at 440 Hz)
ALIGNED engine:      pure Web Audio (AudioBufferSourceNode → destination)
UNALIGNED engine:    pure Web Audio (shift = 0)
OPENDAW engine:      OpenDAW TapeDeviceProcessor (2 Tape tracks, 1 AudioRegionBox each)
Seam:                ${SEAM_SECONDS} s
Crossfade:           ${CROSSFADE_MS} ms linear (equal-gain), symmetric around seam
Phase window:        ${WINDOW_SEC * 1000} ms straddling the seam
Search range:        ±${MAX_SHIFT_SEC * 1000} ms
Playback start:      ${PLAYBACK_START_SECONDS} s`}
              </Code>
            </Flex>
          </Card>
        </Flex>

        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
