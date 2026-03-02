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
    const track = stream.getAudioTracks()[0];
    const channels = (track.getSettings().channelCount ?? 1) >= 2 ? 2 : 1;
    track.stop();
    channelCache.set(deviceId, channels);
    return channels;
  } catch {
    channelCache.set(deviceId, 1);
    return 1;
  }
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
