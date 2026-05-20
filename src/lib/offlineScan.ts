import { Project, AudioWorklets } from "@opendaw/studio-core";
import { PPQN } from "@opendaw/lib-dsp";
import { TimeSpan } from "@opendaw/lib-std";
import { Wait } from "@opendaw/lib-runtime";

const LOADING_TIMEOUT_MS = 30_000;

/**
 * Render a slice of the live project to a stereo `Float32Array[]` via
 * `OfflineAudioContext`. Used by the debug demos to scan rendered audio
 * for amplitude artifacts that confirm (or refute) the suspected mechanism
 * documented in the sibling markdown notes.
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
    const context = new OfflineAudioContext(2, numSamples, sampleRate);
    const worklets = await AudioWorklets.createFor(context);
    const engineWorklet = worklets.createEngine({ project: projectCopy });
    engineWorklet.connect(context.destination, 0);

    const bpm = projectCopy.timelineBox.bpm.getValue();
    engineWorklet.setPosition(PPQN.secondsToPulses(startSeconds, bpm));
    await engineWorklet.isReady();
    engineWorklet.play();

    const startedAt = Date.now();
    while (!(await engineWorklet.queryLoadingComplete())) {
      if (Date.now() - startedAt > LOADING_TIMEOUT_MS) {
        throw new Error(
          `Sample loading timed out after ${LOADING_TIMEOUT_MS / 1000}s`
        );
      }
      await Wait.timeSpan(TimeSpan.millis(100));
    }

    const buffer = await context.startRendering();
    const channels: Float32Array[] = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }
    return { channels, sampleRate: buffer.sampleRate };
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
