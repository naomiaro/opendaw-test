// Minimal waveform rendering straight from AudioBuffers the demo already holds
// (no SampleLoader/peaks subscription needed).

export const computePeaks = (
  channel: Float32Array,
  startFrame: number,
  frameCount: number,
  buckets: number,
): Float32Array => {
  const peaks = new Float32Array(buckets);
  const framesPerBucket = frameCount / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(startFrame + b * framesPerBucket);
    const to = Math.min(Math.floor(from + framesPerBucket), channel.length);
    let peak = 0;
    for (let i = Math.max(from, 0); i < to; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak;
  }
  return peaks;
};

export const drawWaveform = (
  ctx: CanvasRenderingContext2D,
  buffer: AudioBuffer,
  opts: {
    x: number; y: number; width: number; height: number;
    color: string; startSeconds: number; durationSeconds: number;
  },
): void => {
  const { x, y, width, height, color, startSeconds, durationSeconds } = opts;
  const buckets = Math.max(1, Math.floor(width));
  const channel = buffer.getChannelData(0);
  const startFrame = Math.floor(startSeconds * buffer.sampleRate);
  const frameCount = Math.floor(durationSeconds * buffer.sampleRate);
  const peaks = computePeaks(channel, startFrame, frameCount, buckets);
  const mid = y + height / 2;
  ctx.fillStyle = color;
  for (let b = 0; b < buckets; b++) {
    const h = Math.max(1, peaks[b] * height);
    ctx.fillRect(x + b, mid - h / 2, 1, h);
  }
};
