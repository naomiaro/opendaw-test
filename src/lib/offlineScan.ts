import { Project, OfflineEngineRenderer } from "@opendaw/studio-core";
import { PPQN } from "@opendaw/lib-dsp";
import { Option } from "@opendaw/lib-std";
import { isWasmReady } from "@/lib/wasmEngine";
import { withDeadline } from "@/lib/deadline";

const LOADING_TIMEOUT_MS = 30_000;

/**
 * Render a slice of the live project to a stereo `Float32Array[]` — via
 * `OfflineEngineRenderer` with `variant: true` (WASM engine). Used by the
 * debug demos to scan rendered audio for amplitude artifacts that confirm
 * (or refute) the suspected mechanism documented in the sibling markdown notes.
 *
 * Operates on `project.copy()` so live playback state and the live engine
 * are untouched — same pattern as `lib/rangeExport.ts`'s `renderRange`.
 *
 * @param sampleRate defaults to 48 kHz (typical AudioContext rate). The
 *   returned channels are at that rate regardless of the source file's
 *   authored rate — `decodeAudioData` already resampled on load.
 */
export async function renderOfflineSlice(
  project: Project,
  startSeconds: number,
  endSeconds: number,
  sampleRate: number = 48000
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  // WASM offline worker is the only render path (the TS engine is removed from this
  // repo). OfflineAudioContext + createEngine is NOT usable here: ensureReady
  // registers the processor module only on the FIRST context it ever sees
  // (see debug/wasm-ensure-ready-second-context.md), and the live engine already
  // consumed that registration at initializeOpenDAW time.
  // Checked BEFORE project.copy() so the error path doesn't pay for an unnecessary clone.
  if (!isWasmReady()) {
    throw new Error(
      "WASM engine is not ready — initializeOpenDAW() must complete before renderOfflineSlice()."
    );
  }

  const projectCopy = project.copy();
  try {
    projectCopy.editing.modify(() => {
      projectCopy.timelineBox.loopArea.enabled.setValue(false);
    });

    const durationSeconds = endSeconds - startSeconds;
    if (durationSeconds <= 0) {
      throw new Error(
        `Invalid render range: startSeconds (${startSeconds}) must be < endSeconds (${endSeconds})`
      );
    }
    const numSamples = Math.ceil(durationSeconds * sampleRate);
    const bpm = projectCopy.timelineBox.bpm.getValue();
    const startPPQN = PPQN.secondsToPulses(startSeconds, bpm);

    const renderer = await OfflineEngineRenderer.create(
      projectCopy,
      Option.None,
      sampleRate,
      true
    );
    try {
      renderer.setPosition(startPPQN);
      // waitForLoading/play poll queryLoadingComplete with no ceiling — bound them
      // with a deadline, or a broken worker hangs the scan forever.
      await withDeadline(
        (async () => {
          await renderer.play();
          await renderer.waitForLoading();
        })(),
        LOADING_TIMEOUT_MS,
        "WASM offline render: sample loading"
      );
      const channels = await withDeadline(
        renderer.step(numSamples),
        LOADING_TIMEOUT_MS,
        "WASM offline render: step"
      );
      if (channels.length < 2 || channels[0].length !== numSamples) {
        throw new Error(
          `WASM offline render returned ${channels.length} channel(s) of ` +
            `${channels[0]?.length ?? 0} frames, expected 2×${numSamples}`
        );
      }
      return { channels: channels.slice(0, 2), sampleRate };
    } finally {
      // Cleanup must not mask an in-flight error or skip terminate().
      try { renderer.stop(); } catch (e) { console.error("renderer.stop() failed: " + String(e)); }
      try { renderer.terminate(); } catch (e) { console.error("renderer.terminate() failed: " + String(e)); }
    }
  } finally {
    projectCopy.terminate();
  }
}

export interface PeakResult {
  /** Maximum |sample| value found in the scanned region. */
  peak: number;
  /** Time of the peak sample, relative to the start of the rendered slice. */
  atSecondsFromStart: number;
  /** Number of samples examined. */
  samplesScanned: number;
}

/**
 * Max absolute amplitude across the requested time window of one channel.
 * For a 440 Hz sine at amplitude 0.5, "normal" output peaks near 0.5; an
 * inversion-and-amplification artifact (the shared-source double-process
 * case) drives the peak above 0.5.
 */
export function peakInWindow(
  channel: Float32Array,
  channelStartSeconds: number,
  windowStartSeconds: number,
  windowEndSeconds: number,
  sampleRate: number
): PeakResult {
  const startIdx = Math.max(
    0,
    Math.floor((windowStartSeconds - channelStartSeconds) * sampleRate)
  );
  const endIdx = Math.min(
    channel.length,
    Math.ceil((windowEndSeconds - channelStartSeconds) * sampleRate)
  );
  let peak = 0;
  let peakIdx = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    const abs = Math.abs(channel[i]);
    if (abs > peak) {
      peak = abs;
      peakIdx = i;
    }
  }
  return {
    peak,
    atSecondsFromStart: peakIdx / sampleRate,
    samplesScanned: Math.max(0, endIdx - startIdx),
  };
}

export interface MaxDeltaResult {
  /** Maximum |sample[i+1] - sample[i]| in the scanned region. */
  maxDelta: number;
  /** Time of the leading sample of the largest jump. */
  atSecondsFromStart: number;
  /** Number of sample-to-sample steps examined. */
  stepsScanned: number;
}

/**
 * Largest sample-to-sample first difference in a time window. For a clean
 * sinusoid at frequency f and amplitude A, `max |Δsample| ≈ 2π·f·A/SR`
 * (at the zero crossing). Any large step beyond that is a waveform
 * discontinuity — a click, a phase jump, or an amplitude impulse — which
 * is what an ear perceives as a "click" even if the peak amplitude is
 * unchanged.
 *
 * Example: a 440 Hz sine at 0.5 amplitude rendered at 48 kHz has expected
 * max |Δ| ≈ 0.029. A 90° phase jump at the seam would produce Δ ≈ 0.5.
 */
export function maxDeltaInWindow(
  channel: Float32Array,
  channelStartSeconds: number,
  windowStartSeconds: number,
  windowEndSeconds: number,
  sampleRate: number
): MaxDeltaResult {
  const startIdx = Math.max(
    1,
    Math.floor((windowStartSeconds - channelStartSeconds) * sampleRate)
  );
  const endIdx = Math.min(
    channel.length,
    Math.ceil((windowEndSeconds - channelStartSeconds) * sampleRate)
  );
  let maxDelta = 0;
  let atIdx = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    const delta = Math.abs(channel[i] - channel[i - 1]);
    if (delta > maxDelta) {
      maxDelta = delta;
      atIdx = i - 1;
    }
  }
  return {
    maxDelta,
    atSecondsFromStart: atIdx / sampleRate,
    stepsScanned: Math.max(0, endIdx - startIdx),
  };
}

export interface EnvelopeMinResult {
  /** Smallest per-window peak amplitude found across the scanned region. */
  minPeak: number;
  /** Center time of the dipping window, relative to the start of the rendered slice. */
  atSecondsFromStart: number;
  /** Number of windows examined. */
  windowsScanned: number;
}

/**
 * Slide a `windowMs`-wide window through `[windowStartSeconds, windowEndSeconds]`
 * and return the minimum per-window peak amplitude. Useful for catching the
 * voice-fade × clip-fade product dip, which manifests as a sustained ~−1.16 dB
 * amplitude reduction over the first half of a crossfade rather than a single-
 * sample spike.
 *
 * Window stride is half the window length so adjacent windows overlap; this
 * makes the metric robust to where the dip lands relative to window boundaries.
 */
export function minEnvelopeInWindow(
  channel: Float32Array,
  channelStartSeconds: number,
  windowStartSeconds: number,
  windowEndSeconds: number,
  sampleRate: number,
  windowMs: number = 2.5
): EnvelopeMinResult {
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const stride = Math.max(1, Math.floor(windowSamples / 2));
  const scanStart = Math.max(
    0,
    Math.floor((windowStartSeconds - channelStartSeconds) * sampleRate)
  );
  const scanEnd = Math.min(
    channel.length,
    Math.ceil((windowEndSeconds - channelStartSeconds) * sampleRate)
  );

  let minPeak = Number.POSITIVE_INFINITY;
  let atIdx = scanStart;
  let windowsScanned = 0;
  for (let start = scanStart; start + windowSamples <= scanEnd; start += stride) {
    let localPeak = 0;
    for (let i = start; i < start + windowSamples; i++) {
      const abs = Math.abs(channel[i]);
      if (abs > localPeak) localPeak = abs;
    }
    if (localPeak < minPeak) {
      minPeak = localPeak;
      atIdx = start + Math.floor(windowSamples / 2);
    }
    windowsScanned++;
  }
  if (minPeak === Number.POSITIVE_INFINITY) minPeak = 0;
  return {
    minPeak,
    atSecondsFromStart: atIdx / sampleRate,
    windowsScanned,
  };
}
