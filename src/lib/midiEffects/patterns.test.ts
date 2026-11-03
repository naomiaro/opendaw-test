import { describe, expect, it } from "vitest";
import { Option, UUID } from "@opendaw/lib-std";
import { BoxEditing } from "@opendaw/lib-box";
import { NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton, TrackType } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import type { Project } from "@opendaw/studio-core";
import { transact } from "@/lib/testing/boxGraphFixtures";
import { PATTERNS, PATTERN_PPQN, patternById, writePattern } from "./patterns";

/** A note region on a real graph, and the one-method `api` double `writePattern` needs (mirrors ProjectApi.createNoteEvent). */
function regionFixture() {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph } = skeleton;
  const { collection, regionBox } = transact(boxGraph, () => {
    const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    const trackBox = TrackBox.create(boxGraph, UUID.generate(), (box) => {
      box.type.setValue(TrackType.Notes);
      box.index.setValue(0);
      box.tracks.refer(unit.tracks);
      box.target.refer(unit);
    });
    const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate());
    const regionBox = NoteRegionBox.create(boxGraph, UUID.generate(), (box) => {
      box.regions.refer(trackBox.regions);
      box.events.refer(collection.owners);
      box.position.setValue(0);
      box.duration.setValue(PATTERN_PPQN);
      box.loopDuration.setValue(PATTERN_PPQN);
    });
    return { collection, regionBox };
  });
  const editing = new BoxEditing(boxGraph);
  const api = {
    createNoteEvent: ({ owner, position, duration, velocity, pitch }: { owner: NoteRegionBox; position: number; duration: number; velocity: number; pitch: number }) =>
      NoteEventBox.create(boxGraph, UUID.generate(), (box) => {
        box.position.setValue(position);
        box.duration.setValue(duration);
        box.velocity.setValue(velocity);
        box.pitch.setValue(pitch);
        box.events.refer(owner.events.targetVertex.unwrap("no collection").box.asBox(NoteEventCollectionBox).events);
      }),
  } as unknown as Project["api"];
  const notes = () => collection.events.pointerHub.incoming().map((p) => p.box as NoteEventBox);
  return { editing, regionBox, project: { editing, api }, notes };
}

describe("writePattern", () => {
  it("replaces the region's notes with the pattern's, in one undo step", () => {
    const { editing, regionBox, project, notes } = regionFixture();
    const chords = writePattern(project, regionBox, [], patternById("chords"));
    expect(notes()).toHaveLength(12);
    const bass = writePattern(project, regionBox, chords, patternById("bass"));
    expect(bass).toHaveLength(8);
    expect(bass.every((b) => b.isAttached())).toBe(true);
    expect(notes().map((n) => n.pitch.getValue()).sort((a, b) => a - b)).toEqual([36, 36, 41, 41, 43, 43, 45, 45]);
    expect(chords.every((c) => !c.isAttached())).toBe(true);
    editing.undo();
    // One undo step: the bass notes go and the chord notes come back (as new instances under the same uuids).
    const chordUuids = new Set(chords.map((c) => UUID.toString(c.address.uuid)));
    expect(notes()).toHaveLength(12);
    expect(notes().every((n) => chordUuids.has(UUID.toString(n.address.uuid)))).toBe(true);
    expect(bass.every((b) => !b.isAttached())).toBe(true);
  });
});

describe("patterns", () => {
  it("has the four patterns in order", () => {
    expect(PATTERNS.map((p) => p.id)).toEqual(["chords", "sixteenths", "melody", "bass"]);
  });

  it("keeps every note inside two bars with a positive duration", () => {
    for (const p of PATTERNS) {
      for (const n of p.notes) {
        expect(n.position).toBeGreaterThanOrEqual(0);
        expect(n.duration).toBeGreaterThan(0);
        expect(n.position + n.duration).toBeLessThanOrEqual(PATTERN_PPQN);
        expect(Number.isInteger(n.position)).toBe(true);
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("chords: four triads, one per half bar, each held its half bar", () => {
    const notes = patternById("chords").notes;
    expect(notes).toHaveLength(12);
    const starts = [...new Set(notes.map((n) => n.position))];
    expect(starts).toEqual([0, 1920, 3840, 5760]);
    for (const n of notes) expect(n.duration).toBe(1920);
  });

  it("sixteenths: 32 notes on one pitch, each a thirty-second, velocities alternating 1 and 0.6", () => {
    const notes = patternById("sixteenths").notes;
    expect(notes).toHaveLength(32);
    expect(new Set(notes.map((n) => n.pitch)).size).toBe(1);
    expect(notes.map((n) => n.velocity).slice(0, 4)).toEqual([1, 0.6, 1, 0.6]);
    for (const n of notes) expect(n.duration).toBe(120);
  });

  it("melody: 16 eighths, bar two repeats bar one, velocities rise 0.4 to 1.0 within a bar", () => {
    const notes = patternById("melody").notes;
    expect(notes).toHaveLength(16);
    for (let i = 0; i < 8; i++) {
      expect(notes[i + 8].pitch).toBe(notes[i].pitch);
      expect(notes[i + 8].position).toBe(notes[i].position + 3840);
    }
    expect(notes[0].velocity).toBeCloseTo(0.4);
    expect(notes[7].velocity).toBeCloseTo(1.0);
  });

  it("bass: 8 quarter-note roots around C2 at velocity 0.9", () => {
    const notes = patternById("bass").notes;
    expect(notes).toHaveLength(8);
    for (const n of notes) {
      expect(n.duration).toBe(960);
      expect(n.velocity).toBe(0.9);
      expect(n.pitch).toBeGreaterThanOrEqual(36);
      expect(n.pitch).toBeLessThanOrEqual(47);
    }
  });
});
