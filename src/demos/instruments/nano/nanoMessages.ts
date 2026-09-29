/**
 * What the Nano page says to a person, and the reading of a dropped file that
 * decides it. Kept apart from the page so it can be tested without a browser.
 */
import { MAX_CUSTOM_SAMPLE_SECONDS, checkCustomSample, type NanoSampleId } from "@/lib/nanoSamples";

/** The part of a File this module reads */
export interface DroppedFile {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The part of decoded audio this module reads */
export interface DecodedAudio {
  readonly duration: number;
  readonly length: number;
}

export type DroppedSample<BUFFER extends DecodedAudio> =
  | { readonly ok: true; readonly buffer: BUFFER }
  | { readonly ok: false; readonly message: string };

/**
 * Read and decode a dropped file. Three things can go wrong and each gets its
 * own message: the file cannot be read, it is not audio, or it is audio the
 * sampler page does not take.
 */
export async function readDroppedSample<BUFFER extends DecodedAudio>(
  file: DroppedFile,
  decode: (bytes: ArrayBuffer) => Promise<BUFFER>
): Promise<DroppedSample<BUFFER>> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    console.warn(`Nano demo: could not read "${file.name}": ` + String(error));
    return { ok: false, message: `Could not read "${file.name}". It may have been moved or deleted.` };
  }
  let buffer: BUFFER;
  try {
    buffer = await decode(bytes);
  } catch (error) {
    console.warn(`Nano demo: could not decode "${file.name}": ` + String(error));
    return { ok: false, message: `Could not decode "${file.name}". Drop a wav, mp3 or m4a audio file.` };
  }
  const refusal = checkCustomSample(buffer.duration, buffer.length);
  if (refusal !== null) return { ok: false, message: `"${file.name}" was not loaded: ${refusal}.` };
  return { ok: true, buffer };
}

/** What to say about the files of a drop that were not used, or null for nothing */
export function skippedFilesNote(skippedCount: number): string | null {
  if (!Number.isInteger(skippedCount) || skippedCount < 1) return null;
  const files = skippedCount === 1 ? "1 other file was" : `${skippedCount} other files were`;
  return `${files} left out: the sampler holds one sample at a time.`;
}

export interface ShownSample {
  /** Gallery sample id, or null for a dropped file */
  readonly id: NanoSampleId | null;
  readonly name: string;
  readonly seconds: number;
}

export function dropZoneText(current: ShownSample, loadFailed: boolean): string {
  if (current.id !== null) return `Or drop your own audio file here (up to ${MAX_CUSTOM_SAMPLE_SECONDS} s).`;
  if (loadFailed) return `"${current.name}" did not load. Drop another file, or pick a sample above.`;
  return `Loaded: ${current.name} (${current.seconds.toFixed(2)} s). Drop another file to replace it.`;
}

/**
 * What to say about the region, or null for nothing. The markers show the
 * stored start; the engine reads the start with modulation added, so an empty
 * region is only certain to be silent while nothing modulates it.
 */
export function regionMessage(region: { readonly empty: boolean; readonly startIsModulated: boolean }): string | null {
  if (!region.empty) return null;
  return region.startIsModulated
    ? "Start and End are at the same place. A note sounds only if the LFO has moved its start away."
    : "The region is empty, so notes play nothing. Move Start or End.";
}
