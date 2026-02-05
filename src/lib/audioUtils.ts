/**
 * Returns the preferred audio file extension for the current browser.
 * Safari (including iOS) doesn't reliably decode Ogg Opus, so we use m4a (AAC).
 * All other browsers use opus for smaller file sizes.
 */
export function getAudioExtension(): string {
  const audio = new Audio();
  return audio.canPlayType('audio/ogg; codecs="opus"') ? "opus" : "m4a";
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
