import { largestStep } from "./sectionRenderGap.ts";

export type RenderRead = {
  hash: string;
  frames: number;
  channels: number;
  peak: number;
  nonFinite: number;
  impulseHits: number[];
  largestStep: { step: number; frame: number };
  energyPastRange: number | null;
};

const IMPULSE_THRESHOLD = 0.05;
const IMPULSE_MIN_GAP_FRAMES = 1000;
const STEP_GUARD_SECONDS = 0.1;

export const sha256OfSamples = async (channels: readonly Float32Array[]): Promise<string> => {
  const total = channels.reduce((sum, c) => sum + c.length, 0);
  const joined = new Float32Array(total);
  let at = 0;
  for (const channel of channels) {
    joined.set(channel, at);
    at += channel.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

/** The peak sample of each cluster over the threshold; a cluster ends after `minGapFrames` under it. */
export const findImpulses = (channel: Float32Array, threshold: number, minGapFrames: number): number[] => {
  const hits: number[] = [];
  let peakFrame = -1;
  let peakValue = 0;
  let lastOver = -Infinity;
  for (let i = 0; i < channel.length; i++) {
    const magnitude = Math.abs(channel[i]);
    if (!(magnitude > threshold)) continue;
    if (i - lastOver > minGapFrames && peakFrame >= 0) {
      hits.push(peakFrame);
      peakValue = 0;
    }
    if (magnitude > peakValue) {
      peakValue = magnitude;
      peakFrame = i;
    }
    lastOver = i;
  }
  if (peakFrame >= 0) hits.push(peakFrame);
  return hits;
};

export { computedFrame } from "./exportRegressionSignals.ts";

export const readRender = async (
  channels: readonly Float32Array[],
  options: { rangeFrames: number; pageRate: number }
): Promise<RenderRead> => {
  const frames = channels[0].length;
  let peak = 0;
  let nonFinite = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const value = channel[i];
      if (!Number.isFinite(value)) nonFinite++;
      else if (Math.abs(value) > peak) peak = Math.abs(value);
    }
  }
  const guard = Math.round(STEP_GUARD_SECONDS * options.pageRate);
  let energyPastRange: number | null = null;
  if (frames > options.rangeFrames) {
    let sum = 0;
    let count = 0;
    for (const channel of channels) {
      for (let i = options.rangeFrames; i < channel.length; i++) {
        sum += channel[i] * channel[i];
        count++;
      }
    }
    energyPastRange = Math.sqrt(sum / count);
  }
  return {
    hash: await sha256OfSamples(channels),
    frames,
    channels: channels.length,
    peak,
    nonFinite,
    impulseHits: channels.length > 1 ? findImpulses(channels[1], IMPULSE_THRESHOLD, IMPULSE_MIN_GAP_FRAMES) : [],
    largestStep: largestStep(channels[0], guard, options.rangeFrames - guard),
    energyPastRange
  };
};
