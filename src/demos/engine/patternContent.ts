import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, EffectFactories } from "@opendaw/studio-core";
import { InstrumentFactories, NoteEventCollectionBoxAdapter } from "@opendaw/studio-adapters";
import { NoteEventCollectionBox, NoteRegionBox } from "@opendaw/studio-boxes";
import type { AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";

const QUARTER = PPQN.Quarter;   // 960 ticks
const BAR = QUARTER * 4;        // 4/4
const PATTERN_BARS = 2;
const PATTERN_LEN = BAR * PATTERN_BARS;

// A deterministic 2-bar arpeggio (region-local ticks). pitch = MIDI note number.
const PATTERN: ReadonlyArray<{ position: number; pitch: number }> = [
  { position: 0 * QUARTER, pitch: 60 },
  { position: 1 * QUARTER, pitch: 64 },
  { position: 2 * QUARTER, pitch: 67 },
  { position: 3 * QUARTER, pitch: 72 },
  { position: 4 * QUARTER, pitch: 67 },
  { position: 5 * QUARTER, pitch: 64 },
  { position: 6 * QUARTER, pitch: 60 },
  { position: 7 * QUARTER, pitch: 64 },
];

/**
 * Build the demo's musical content: a Vaporisateur synth through reverb + delay, playing a
 * looping 2-bar pattern. Exercises the WASM instrument + effect plugins (device_vaporisateur/
 * reverb/delay.wasm) so the TS↔WASM A/B is a meaningful "sounds identical" comparison.
 */
export function buildWasmDemoContent(project: Project): void {
  // 1) Instrument (createInstrument routes output to master internally). Capture via outer vars —
  //    editing.modify() does not forward return values.
  let audioUnitBox: AudioUnitBox | null = null;
  let trackBox: TrackBox | null = null;
  project.editing.modify(() => {
    const product = project.api.createInstrument(InstrumentFactories.Vaporisateur);
    audioUnitBox = product.audioUnitBox;
    trackBox = product.trackBox;
  });
  if (!audioUnitBox || !trackBox) {
    throw new Error("buildWasmDemoContent: createInstrument did not return a unit/track");
  }
  // Cast defeats TS closure-narrowing to `never` after the modify() callback (see midi CLAUDE.md).
  const unit = audioUnitBox as AudioUnitBox;
  const track = trackBox as TrackBox;

  // 2) Audio effects (reverb then delay) on the instrument's audio-effect chain.
  project.editing.modify(() => {
    project.api.insertEffect(unit.audioEffects, EffectFactories.AudioNamed.Reverb);
    project.api.insertEffect(unit.audioEffects, EffectFactories.AudioNamed.Delay);
  });

  // 3) A note region holding the pattern, spanning PATTERN_LEN ticks (box path mirrors
  //    StepRecordingSection: create collection + region, wire the regions/events pointers).
  let collectionBox: NoteEventCollectionBox | null = null;
  project.editing.modify(() => {
    const collection = NoteEventCollectionBox.create(project.boxGraph, UUID.generate());
    collectionBox = collection;
    NoteRegionBox.create(project.boxGraph, UUID.generate(), (box: NoteRegionBox) => {
      box.regions.refer(track.regions);
      box.events.refer(collection.owners);
      box.position.setValue(0);
      box.duration.setValue(PATTERN_LEN);
      box.label.setValue("WASM A/B Pattern");
    });
  });

  // 4) Populate the events via the collection adapter (createEvent is the prescribed path).
  if (!collectionBox) {
    throw new Error("buildWasmDemoContent: note event collection was not created");
  }
  // Cast defeats TS closure-narrowing to `never` after the modify() callback (see midi CLAUDE.md).
  const collection = collectionBox as NoteEventCollectionBox;
  const collectionAdapter = project.boxAdapters.adapterFor(collection, NoteEventCollectionBoxAdapter);
  project.editing.modify(() => {
    for (const note of PATTERN) {
      collectionAdapter.createEvent({
        position: note.position,
        duration: Math.round(QUARTER * 0.9),
        pitch: note.pitch,
        cent: 0,
        velocity: 0.8,
        chance: 100,
        playCount: 1,
      });
    }
  });

  // 5) Loop the transport over the pattern so it repeats under the A/B toggle.
  project.editing.modify(() => {
    const { loopArea } = project.timelineBox;
    loopArea.from.setValue(0);
    loopArea.to.setValue(PATTERN_LEN);
    loopArea.enabled.setValue(true);
  });
}
