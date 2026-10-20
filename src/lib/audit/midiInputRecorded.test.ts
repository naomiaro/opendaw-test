import { beforeEach, describe, expect, it } from "vitest";
import { Option, UUID } from "@opendaw/lib-std";
import { AudioUnitBox, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton, TrackType } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import { BAR_PPQN } from "./auditExpectations";
import { transact, type Graph } from "@/lib/testing/boxGraphFixtures";
import { clearRecordedNotes, collectRecordedNotes, noteRegionsOf, takeIndexFromLabel } from "./midiInputRecorded";

let graph: Graph;
let unitBox: AudioUnitBox;
let regionTake2: NoteRegionBox;
let tracksBefore: number;

/** Mirrors `RecordMidi.createTakeRegion` + `RecordTrack.findOrCreate` in the SDK. */
const takeRegion = (trackBox: TrackBox, label: string, events: Array<{ pitch: number; position: number; velocity: number; duration: number }>): NoteRegionBox => {
  const collection = NoteEventCollectionBox.create(graph, UUID.generate());
  const region = NoteRegionBox.create(graph, UUID.generate(), (box) => {
    box.regions.refer(trackBox.regions);
    box.events.refer(collection.owners);
    box.position.setValue(0);
    box.duration.setValue(2 * BAR_PPQN);
    box.loopDuration.setValue(2 * BAR_PPQN);
    box.label.setValue(label);
  });
  for (const e of events) {
    NoteEventBox.create(graph, UUID.generate(), (box) => {
      box.position.setValue(e.position);
      box.duration.setValue(e.duration);
      box.pitch.setValue(e.pitch);
      box.velocity.setValue(e.velocity);
      box.events.refer(collection.events);
    });
  }
  return region;
};

beforeEach(() => {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  graph = skeleton.boxGraph;
  transact(graph, () => {
    unitBox = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    tracksBefore = unitBox.tracks.pointerHub.incoming().length;
    const trackBox = TrackBox.create(graph, UUID.generate(), (box) => {
      box.type.setValue(TrackType.Notes);
      box.index.setValue(tracksBefore);
      box.tracks.refer(unitBox.tracks);
      box.target.refer(unitBox);
    });
    regionTake2 = takeRegion(trackBox, "Take 2", [{ pitch: 37, position: 480, velocity: 64 / 127, duration: 120 }]);
    takeRegion(trackBox, "Take 1", [{ pitch: 36, position: 960, velocity: 100 / 127, duration: 240 }]);
  });
});

describe("collectRecordedNotes", () => {
  it("orders takes by their labels and sums earlier takes into the absolute position", () => {
    const { notes, takes, takeIndexSource } = collectRecordedNotes(unitBox);
    expect(takeIndexSource).toBe("label");
    expect(takes.map((t) => t.takeIndex)).toEqual([1, 2]);
    expect(notes.map((n) => [n.pitch, n.absolutePpqn, n.takeIndex, n.velocity]))
      .toEqual([[36, 960, 1, 100], [37, 2 * BAR_PPQN + 480, 2, 64]]);
    expect(notes[1].regionEndPpqn).toBe(4 * BAR_PPQN);
    expect(notes[1].durationPpqn).toBe(120);
  });
  it("falls back to position and track order when a label does not parse", () => {
    transact(graph, () => regionTake2.label.setValue("Untitled"));
    expect(collectRecordedNotes(unitBox).takeIndexSource).toBe("order");
    expect(takeIndexFromLabel("Take 12")).toBe(12);
    expect(takeIndexFromLabel("Untitled")).toBeNull();
  });
  it("deletes regions and their collections and leaves the track", () => {
    expect(clearRecordedNotes({ editing: { modify: (fn) => transact(graph, fn) } }, unitBox)).toBe(2);
    expect(noteRegionsOf(unitBox)).toEqual([]);
    expect(graph.boxes().some((b) => b instanceof NoteEventCollectionBox)).toBe(false);
    expect(graph.boxes().some((b) => b instanceof NoteEventBox)).toBe(false);
    expect(unitBox.tracks.pointerHub.incoming().length).toBe(tracksBefore + 1);
  });
});
