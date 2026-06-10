// src/lib/beats/beatsParser.ts

/** One row of a beat_this `.beats` file: a tracked beat. */
export interface BeatMarker {
  /** Position of the beat in the audio file, in seconds. */
  readonly second: number;
  /** 1-based position within the bar; 1 = downbeat. */
  readonly beatInBar: number;
}

/**
 * Parse beat_this `.beats` text: one `<seconds> <beatInBar>` row per beat,
 * `#` comments and blank lines ignored. Validates at the boundary so the
 * math layer can assume a well-formed, strictly-monotonic marker list.
 */
export function parseBeatsFile(text: string): BeatMarker[] {
  const markers: BeatMarker[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(`Invalid .beats line ${i + 1}: "${line}" — expected exactly 2 columns "<seconds> <beatInBar>"`);
    }
    const second = Number(parts[0]);
    const beatInBar = Number(parts[1]);
    if (!Number.isFinite(second) || !Number.isFinite(beatInBar)) {
      throw new Error(`Invalid .beats line ${i + 1}: "${line}" — both columns must be numeric`);
    }
    if (second < 0) {
      throw new Error(`Invalid .beats line ${i + 1}: seconds must be non-negative, got ${parts[0]}`);
    }
    if (!Number.isInteger(beatInBar) || beatInBar < 1) {
      throw new Error(`Invalid .beats line ${i + 1}: beatInBar must be an integer >= 1, got ${parts[1]}`);
    }
    const prev = markers[markers.length - 1];
    if (prev !== undefined && second <= prev.second) {
      throw new Error(
        `Invalid .beats line ${i + 1}: seconds must be strictly monotonic ` +
          `(${second} after ${prev.second}) — a non-monotonic warp map has no inverse`
      );
    }
    markers.push({ second, beatInBar });
  }
  if (markers.length < 2) {
    throw new Error(`Beat map needs at least 2 markers to derive a tempo, got ${markers.length}`);
  }
  return markers;
}
