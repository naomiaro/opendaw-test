import { AudioData } from "@opendaw/lib-dsp";

/**
 * Returns the preferred audio file extension for the current browser.
 * Safari (including iOS) doesn't reliably decode Ogg Opus via decodeAudioData,
 * even though canPlayType may return "maybe". Use m4a (AAC) for all Apple devices.
 */
export function getAudioExtension(): string {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    || /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isSafari ? "m4a" : "opus";
}

const channelCache = new Map<string, 1 | 2>();

/**
 * Probes an audio input device to determine its maximum channel count.
 * Opens a short-lived getUserMedia stream requesting stereo, checks the
 * actual channelCount from getSettings(), then immediately stops the stream.
 * Results are cached per deviceId.
 */
export async function probeDeviceChannels(deviceId: string): Promise<1 | 2> {
  const cached = channelCache.get(deviceId);
  if (cached !== undefined) return cached;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId }, channelCount: { ideal: 2 } },
    });
    const tracks = stream.getAudioTracks();
    const channels = (tracks[0]?.getSettings().channelCount ?? 1) >= 2 ? 2 : 1;
    stream.getTracks().forEach((t) => t.stop());
    channelCache.set(deviceId, channels);
    return channels;
  } catch {
    channelCache.set(deviceId, 1);
    return 1;
  }
}

/**
 * Enumerates available audio output devices, excluding the browser's
 * implicit "default" device (which duplicates a real device).
 * AudioDevices class only handles inputs — use this for outputs.
 * Note: setSinkId (required to actually use these) is Chrome/Edge only.
 */
export async function enumerateOutputDevices(): Promise<MediaDeviceInfo[]> {
  const allDevices = await navigator.mediaDevices.enumerateDevices();
  return allDevices.filter(
    d => d.kind === "audiooutput" && d.deviceId !== "" && d.deviceId !== "default"
  );
}

/**
 * Helper function to load and decode audio files
 * @param audioContext - The AudioContext to use for decoding
 * @param url - The URL of the audio file to load
 * @returns A promise that resolves to an AudioBuffer
 */
export async function loadAudioFile(audioContext: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load audio file "${url}": ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

export type DurationFormat = "m:ss" | "mm:ss" | "m:ss.t" | "mm:ss.cc";

const DURATION_FORMATS: Record<DurationFormat, { fractionDigits: number; padMinutes: boolean }> = {
  "m:ss": { fractionDigits: 0, padMinutes: false },     // "1:05"
  "mm:ss": { fractionDigits: 0, padMinutes: true },     // "01:05"
  "m:ss.t": { fractionDigits: 1, padMinutes: false },   // "1:05.3"
  "mm:ss.cc": { fractionDigits: 2, padMinutes: true },  // "01:05.30"
};

/**
 * Format a duration in seconds. By default rounds at the displayed
 * precision and carries — 119.6 s as "m:ss" is "2:00" (never "1:60") —
 * while `mode: "floor"` truncates instead, which is what a live position
 * clock wants (it must never display a time the playhead hasn't reached).
 * Minutes do not roll into hours ("90:00"). Non-finite input renders as
 * zeros in the requested format (live clocks pass NaN before the engine
 * reports a position).
 *
 * Hand-rolled on purpose: Intl.DurationFormat's digital style force-pads
 * minutes to two digits, so the compact forms are unproducible with it,
 * and Intl.DateTimeFormat formats dates, not durations.
 */
export function formatDuration(
  seconds: number,
  format: DurationFormat = "m:ss",
  mode: "round" | "floor" = "round"
): string {
  const { fractionDigits, padMinutes } = DURATION_FORMATS[format];
  const scale = 10 ** fractionDigits;
  // The relative epsilon counters binary-float droop on decimally-exact
  // inputs: 1.005 * 100 is 100.49999999999999 and would round DOWN.
  const scaled = seconds * scale;
  const nudged = scaled + Math.abs(scaled) * 1e-12;
  const units = Number.isFinite(seconds)
    ? Math.max(0, mode === "floor" ? Math.floor(nudged) : Math.round(nudged))
    : 0;
  const totalSeconds = Math.floor(units / scale);
  const minutes = Math.floor(totalSeconds / 60);
  const minutesText = padMinutes ? String(minutes).padStart(2, "0") : String(minutes);
  const secondsText = String(totalSeconds % 60).padStart(2, "0");
  const fractionText = fractionDigits > 0
    ? "." + String(units % scale).padStart(fractionDigits, "0")
    : "";
  return `${minutesText}:${secondsText}${fractionText}`;
}

/**
 * Convert a browser AudioBuffer into OpenDAW's AudioData (SharedArrayBuffer-backed).
 *
 * AudioData is what the SDK's DSP layer consumes — workers, processors, transient
 * detection, bpm detection, peak generation all take AudioData, not AudioBuffer.
 * The conversion is a per-channel copy; cost is O(frames * channels).
 */
export function audioBufferToAudioData(buffer: AudioBuffer): AudioData {
  const { numberOfChannels, length: numberOfFrames, sampleRate } = buffer;
  const audioData = AudioData.create(sampleRate, numberOfFrames, numberOfChannels);
  for (let channel = 0; channel < numberOfChannels; channel++) {
    audioData.frames[channel].set(buffer.getChannelData(channel));
  }
  return audioData;
}
