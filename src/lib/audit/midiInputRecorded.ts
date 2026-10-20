/**
 * What the SDK recorded, read off the box graph: every note region under an audio
 * unit, its take order, and each event in absolute linear pulses (the earlier takes'
 * durations added, the way `RecordMidi` offsets later passes). Box traversal from the
 * unit's own `tracks` pointer hub, not an adapter walk, so it runs on a bare box graph
 * in Node and on a live project alike.
 */
import { asInstanceOf } from "@opendaw/lib-std";
import { AudioUnitBox, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox } from "@opendaw/studio-boxes";
import type { RecordedNote } from "./midiInputAlignment";

export interface RecordedTake {
  regionBox: NoteRegionBox;
  takeIndex: number;
  positionPpqn: number;
  durationPpqn: number;
}

export interface CollectedNotes {
  notes: RecordedNote[];
  takes: RecordedTake[];
  takeIndexSource: "label" | "order";
}

/** Note regions of every track of the unit, tracks in their index order. */
export function noteRegionsOf(audioUnitBox: AudioUnitBox): NoteRegionBox[] {
  return audioUnitBox.tracks.pointerHub.incoming()
    .map(({ box }) => asInstanceOf(box, TrackBox))
    .sort((a, b) => a.index.getValue() - b.index.getValue())
    .flatMap((track) => track.regions.pointerHub.incoming()
      .map(({ box }) => box)
      .filter((box): box is NoteRegionBox => box instanceof NoteRegionBox));
}

export function takeIndexFromLabel(label: string): number | null {
  const match = /^Take (\d+)$/.exec(label);
  return match === null ? null : Number(match[1]);
}

/** By label when every label parses; otherwise by position, then the track order `noteRegionsOf` gives. */
export function orderTakes(regions: readonly NoteRegionBox[]): { takes: RecordedTake[]; source: "label" | "order" } {
  const labelled = regions.map((regionBox) => ({ regionBox, index: takeIndexFromLabel(regionBox.label.getValue()) }));
  const byLabel = labelled.every(({ index }) => index !== null);
  const ordered = byLabel
    ? [...labelled].sort((a, b) => (a.index as number) - (b.index as number))
    : regions
      .map((regionBox, order) => ({ regionBox, order }))
      .sort((a, b) => (a.regionBox.position.getValue() - b.regionBox.position.getValue()) || (a.order - b.order));
  return {
    source: byLabel ? "label" : "order",
    takes: ordered.map(({ regionBox }, i) => ({
      regionBox,
      takeIndex: i + 1,
      positionPpqn: regionBox.position.getValue(),
      durationPpqn: regionBox.duration.getValue(),
    })),
  };
}

export function collectRecordedNotes(audioUnitBox: AudioUnitBox): CollectedNotes {
  const { takes, source } = orderTakes(noteRegionsOf(audioUnitBox));
  const notes: RecordedNote[] = [];
  let earlierTakes = 0;
  for (const take of takes) {
    const { regionBox } = take;
    const base = regionBox.position.getValue() + earlierTakes;
    const regionEndPpqn = base + regionBox.duration.getValue();
    const collection = regionBox.events.targetVertex.unwrapOrNull();
    if (collection !== null) {
      for (const { box } of asInstanceOf(collection.box, NoteEventCollectionBox).events.pointerHub.incoming()) {
        const event = asInstanceOf(box, NoteEventBox);
        notes.push({
          pitch: event.pitch.getValue(),
          velocity: Math.round(event.velocity.getValue() * 127),
          absolutePpqn: base + event.position.getValue(),
          durationPpqn: event.duration.getValue(),
          takeIndex: take.takeIndex,
          regionEndPpqn,
        });
      }
    }
    earlierTakes += regionBox.duration.getValue();
  }
  notes.sort((a, b) => a.absolutePpqn - b.absolutePpqn || a.pitch - b.pitch);
  return { notes, takes, takeIndexSource: source };
}

/** Deletes every note region of the unit with its event collection (and so its events); returns the count. */
export function clearRecordedNotes(
  project: { editing: { modify: (fn: () => void) => unknown } },
  audioUnitBox: AudioUnitBox,
): number {
  const regions = noteRegionsOf(audioUnitBox);
  if (regions.length === 0) return 0;
  project.editing.modify(() => {
    for (const regionBox of regions) {
      const collection = regionBox.events.targetVertex.unwrapOrNull();
      if (regionBox.isAttached()) regionBox.delete();
      if (collection !== null && collection.box.isAttached()) collection.box.delete();
    }
  });
  return regions.length;
}
