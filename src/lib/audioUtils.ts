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

/**
 * Helper function to load and decode audio files
 * @param audioContext - The AudioContext to use for decoding
 * @param url - The URL of the audio file to load
 * @returns A promise that resolves to an AudioBuffer
 */
export async function loadAudioFile(audioContext: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}
