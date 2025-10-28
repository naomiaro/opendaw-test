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
