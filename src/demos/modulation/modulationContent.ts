import { asInstanceOf, UUID } from "@opendaw/lib-std";
import { PPQN, ClassicWaveform } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import {
  InstrumentFactories,
  NoteEventCollectionBoxAdapter,
  AudioUnitBoxAdapter,
  VaporisateurDeviceBoxAdapter,
  LfoModulatorBoxAdapter,
  StepsModulatorBoxAdapter,
  RandomModulatorBoxAdapter,
  MacroModulatorBoxAdapter,
  type AutomatableParameterFieldAdapter,
} from "@opendaw/studio-adapters";
import {
  NoteEventCollectionBox,
  NoteRegionBox,
  VaporisateurDeviceBox,
  LfoModulatorBox,
  StepsModulatorBox,
  RandomModulatorBox,
  MacroModulatorBox,
  type ModulationBox,
} from "@opendaw/studio-boxes";
import type { AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";

const QUARTER = PPQN.Quarter; // 960 ticks
const BAR = QUARTER * 4; // 4/4
const PATTERN_BARS = 2;
export const PATTERN_LEN = BAR * PATTERN_BARS;

// Sustained bass notes — held tones make the cutoff wobble and volume gating audible.
// (region-local ticks; pitch = MIDI note number)
const PATTERN: ReadonlyArray<{ position: number; duration: number; pitch: number }> = [
  { position: 0 * QUARTER, duration: 4 * QUARTER, pitch: 33 }, // A1, bar 1
  { position: 4 * QUARTER, duration: 2 * QUARTER, pitch: 36 }, // C2, bar 2 first half
  { position: 6 * QUARTER, duration: 2 * QUARTER, pitch: 31 }, // G1, bar 2 second half
];

// A 16-step accent pattern for the volume gate (stored unitValues; the modulator runs
// UNIPOLAR here, so stored 1 emits full modulation and stored 0 emits none).
const GATE_PATTERN: ReadonlyArray<number> = [
  1, 0, 0.7, 0, 1, 0, 0.7, 0.4,
  1, 0, 0.7, 0, 1, 0.4, 0, 0.7,
];

// The synced-rate table is SHARED across modulator kinds (Steps and Random build their
// rateSync from LfoModulatorBoxAdapter.RateStrings too). Derive the indices so they
// cannot drift from the table.
const RATE_1_4 = LfoModulatorBoxAdapter.RateStrings.indexOf("1/4");
const RATE_1_8 = LfoModulatorBoxAdapter.RateStrings.indexOf("1/8");

export type ModulatorSlot<A> = {
  readonly adapter: A;
  readonly assignment: ModulationBox;
};

export type ModulationDemoSetup = {
  readonly audioUnitAdapter: AudioUnitBoxAdapter;
  readonly cutoff: AutomatableParameterFieldAdapter<number>;
  readonly volume: AutomatableParameterFieldAdapter<number>;
  readonly panning: AutomatableParameterFieldAdapter<number>;
  readonly lfo: ModulatorSlot<LfoModulatorBoxAdapter>;
  readonly steps: ModulatorSlot<StepsModulatorBoxAdapter>;
  readonly random: ModulatorSlot<RandomModulatorBoxAdapter>;
  readonly macro: ModulatorSlot<MacroModulatorBoxAdapter>;
};

/**
 * Build the demo's content: a Vaporisateur bassline looping over two bars, and the four
 * modulator kinds each assigned to one target through `project.api.modulation`:
 *
 *   LFO "Wobble"   → filter cutoff   (classic synced wobble)
 *   Steps "Gate"   → channel volume  (rhythmic gate, unipolar with negative depth)
 *   Random "Drift" → channel panning (smoothed random stereo drift)
 *   Macro "Center" → filter cutoff   (stacks with the LFO — modulation sums per target)
 *
 * `Modulators.*` never opens a transaction ("every caller is inside an editing.modify"),
 * so each call here is wrapped. Each modulator is created in its OWN transaction: the
 * attach step reads `rootBoxAdapter.modulators.adapters()` for its index and unique
 * label, and a box created in a still-open transaction is not in that collection yet —
 * batching all four into one modify() would hand every modulator index 0.
 */
export function buildModulationDemoContent(project: Project): ModulationDemoSetup {
  const { editing, api, boxAdapters } = project;

  // 1) Instrument (createInstrument routes output to master internally). Capture via
  //    outer vars; resolve adapters AFTER the transaction commits.
  let audioUnitBox: AudioUnitBox | null = null;
  let trackBox: TrackBox | null = null;
  let vaporisateurBox: VaporisateurDeviceBox | null = null;
  editing.modify(() => {
    const product = api.createInstrument(InstrumentFactories.Vaporisateur);
    audioUnitBox = product.audioUnitBox;
    trackBox = product.trackBox;
    vaporisateurBox = asInstanceOf(product.instrumentBox, VaporisateurDeviceBox);
  });
  if (!audioUnitBox || !trackBox || !vaporisateurBox) {
    throw new Error("buildModulationDemoContent: createInstrument returned no unit/track/instrument");
  }
  // Casts defeat TS closure-narrowing to `never` after the modify() callback.
  const unit = audioUnitBox as AudioUnitBox;
  const track = trackBox as TrackBox;
  const vapo = vaporisateurBox as VaporisateurDeviceBox;

  const unitAdapter = boxAdapters.adapterFor(unit, AudioUnitBoxAdapter);
  const vapoAdapter = boxAdapters.adapterFor(vapo, VaporisateurDeviceBoxAdapter);

  // 2) A deterministic wobble-friendly patch: two saws (the factory's osc defaults are
  //    -inf dB), a mid cutoff with some resonance, and a sustained envelope.
  editing.modify(() => {
    const [oscA, oscB] = vapo.oscillators.fields();
    oscA.waveform.setValue(ClassicWaveform.saw);
    oscA.volume.setValue(-6);
    oscB.waveform.setValue(ClassicWaveform.saw);
    oscB.volume.setValue(-9);
    oscB.tune.setValue(9); // slight detune thickens the two saws
    const p = vapoAdapter.namedParameter;
    p.cutoff.setUnitValue(0.45);
    p.resonance.setUnitValue(0.55);
    p.sustain.setUnitValue(1.0);
    p.release.setUnitValue(0.35);
  });

  // 3) The note region (loopOffset/loopDuration MUST be set or the engine plays nothing).
  let collectionBox: NoteEventCollectionBox | null = null;
  editing.modify(() => {
    const collection = NoteEventCollectionBox.create(project.boxGraph, UUID.generate());
    collectionBox = collection;
    NoteRegionBox.create(project.boxGraph, UUID.generate(), (box: NoteRegionBox) => {
      box.regions.refer(track.regions);
      box.events.refer(collection.owners);
      box.position.setValue(0);
      box.duration.setValue(PATTERN_LEN);
      box.loopOffset.setValue(0);
      box.loopDuration.setValue(PATTERN_LEN);
      box.label.setValue("Modulation Bassline");
    });
  });
  if (!collectionBox) {
    throw new Error("buildModulationDemoContent: note event collection was not created");
  }
  const collectionAdapter = boxAdapters.adapterFor(
    collectionBox as NoteEventCollectionBox, NoteEventCollectionBoxAdapter);
  // append(): commits separately (the adapter collection can't see in-transaction boxes)
  // but folds into the region-creation transaction's undo entry.
  editing.append(() => {
    for (const note of PATTERN) {
      collectionAdapter.createEvent({
        position: note.position,
        duration: note.duration - Math.round(QUARTER * 0.05),
        pitch: note.pitch,
        cent: 0,
        velocity: 0.9,
        chance: 100,
        playCount: 1,
      });
    }
  });

  // 4) Loop the transport over the pattern.
  editing.modify(() => {
    const { loopArea } = project.timelineBox;
    loopArea.from.setValue(0);
    loopArea.to.setValue(PATTERN_LEN);
    loopArea.enabled.setValue(true);
  });

  // 5) The four modulators — one transaction each (see the doc comment above).
  const modulation = api.modulation;
  const cutoff = vapoAdapter.namedParameter.cutoff;
  const volume = unitAdapter.namedParameter.volume;
  const panning = unitAdapter.namedParameter.panning;

  // LFO → cutoff: synced 1/8 sine wobble around the patch's base cutoff.
  let lfoBox: LfoModulatorBox | null = null;
  let lfoAssignment: ModulationBox | null = null;
  editing.modify(() => {
    // api.modulation's create* return the ModulatorBox union — narrow to the concrete class.
    const box = asInstanceOf(modulation.createLfo("Wobble"), LfoModulatorBox);
    box.rateSync.setValue(RATE_1_8);
    lfoBox = box;
    lfoAssignment = modulation.assign(box, cutoff.modulationTarget, 0.3);
  });

  // Steps → volume: unipolar 16-step pattern with NEGATIVE depth = rhythmic ducking
  // (channel volume already sits near the top of its dB range, so lifting it would clamp).
  let stepsBox: StepsModulatorBox | null = null;
  let stepsAssignment: ModulationBox | null = null;
  editing.modify(() => {
    const box = asInstanceOf(modulation.createSteps("Gate"), StepsModulatorBox);
    box.bipolar.setValue(false);
    box.smooth.setValue(0.15);
    box.steps.fields().forEach((field, index) =>
      field.setValue(GATE_PATTERN[index % GATE_PATTERN.length]));
    stepsBox = box;
    stepsAssignment = modulation.assign(box, volume.modulationTarget, -0.55);
  });

  // Random → panning: smoothed continuous drift, bipolar so it swings both ways.
  let randomBox: RandomModulatorBox | null = null;
  let randomAssignment: ModulationBox | null = null;
  editing.modify(() => {
    const box = asInstanceOf(modulation.createRandom("Drift"), RandomModulatorBox);
    box.rateSync.setValue(RATE_1_4);
    box.smooth.setValue(0.6);
    randomBox = box;
    randomAssignment = modulation.assign(box, panning.modulationTarget, 0.5);
  });

  // Macro → cutoff (STACKED with the LFO): a hand knob that shifts the wobble's center.
  // Bipolar with the default value 0.5 = zero offset at rest.
  let macroBox: MacroModulatorBox | null = null;
  let macroAssignment: ModulationBox | null = null;
  editing.modify(() => {
    const box = asInstanceOf(modulation.createMacro("Center"), MacroModulatorBox);
    macroBox = box;
    macroAssignment = modulation.assign(box, cutoff.modulationTarget, 0.45);
  });

  if (!lfoBox || !stepsBox || !randomBox || !macroBox
    || !lfoAssignment || !stepsAssignment || !randomAssignment || !macroAssignment) {
    throw new Error("buildModulationDemoContent: a modulator or assignment was not created");
  }

  // Resolve the modulator adapters from the captured boxes AFTER their transactions
  // committed — typed via adapterFor, no label lookup (labels are de-duplicated by
  // Strings.getUniqueName upstream, so they are not stable keys), no casts.
  return {
    audioUnitAdapter: unitAdapter,
    cutoff, volume, panning,
    lfo: {
      adapter: boxAdapters.adapterFor(lfoBox as LfoModulatorBox, LfoModulatorBoxAdapter),
      assignment: lfoAssignment as ModulationBox,
    },
    steps: {
      adapter: boxAdapters.adapterFor(stepsBox as StepsModulatorBox, StepsModulatorBoxAdapter),
      assignment: stepsAssignment as ModulationBox,
    },
    random: {
      adapter: boxAdapters.adapterFor(randomBox as RandomModulatorBox, RandomModulatorBoxAdapter),
      assignment: randomAssignment as ModulationBox,
    },
    macro: {
      adapter: boxAdapters.adapterFor(macroBox as MacroModulatorBox, MacroModulatorBoxAdapter),
      assignment: macroAssignment as ModulationBox,
    },
  };
}
