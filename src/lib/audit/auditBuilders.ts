/**
 * Scenario project builders for the sample-rate alignment audit.
 *
 * Each builder mutates a FRESH project (caller creates it — see
 * `src/lib/projectSetup.ts`) into the box-graph content one `AuditFamily`
 * needs, at the given bpm, and returns what `renderOfflineSlice` needs to
 * render it. No unit tests here — this is SDK/box-graph code, browser-
 * validated in Task 6 (see `.superpowers/sdd/2026-08-27-samplerate-alignment-audit/`).
 */
import { UUID } from "@opendaw/lib-std";
import { PPQN, Interpolation, type ppqn } from "@opendaw/lib-dsp";
import type { Field } from "@opendaw/lib-box";
import type { Pointers } from "@opendaw/studio-enums";
import {
  InstrumentFactories,
  AudioUnitBoxAdapter,
  ValueRegionBoxAdapter,
} from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import type { TrackBox, ValueRegionBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import {
  AUDIT_SCENARIOS,
  BAR_PPQN,
  LOOP_WRAP_BARS,
  SIGNATURE_BARS_3_4,
  SIGNATURE_BARS_4_4,
  NOTE_ONSET_POSITIONS,
  expectedOnsets,
  type AuditFamily,
} from "./auditExpectations";

/** Mutates a FRESH project (caller creates it) to hold the family's scenario at
 *  the given bpm. Returns what the renderer needs. */
export interface BuiltScenario {
  renderSeconds: number; // duration to render
  startPositionPpqn: number; // renderer setPosition before stepping (0 for most)
  needsMetronome: boolean; // pass the includeInMixdown export config
}

const VOL_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0);
const VOL_SILENT = 0.0;
const SIXTEENTH_PPQN = PPQN.Quarter / 4; // 240
/** Small tail past the last expected onset so its attack/decay is captured. */
const TAIL_PADDING_SEC = 0.5;
const CLICK_DURATION_SEC = 0.008;
const CLICK_FREQ_HZ = 2000;

function quartersToSeconds(quarters: number, bpm: number): number {
  return quarters * (60 / bpm);
}

// ─── Synthetic buffer generators ───────────────────────────────────────────

function createToneBuffer(audioContext: AudioContext, durationSeconds: number, freqHz: number): AudioBuffer {
  const sr = audioContext.sampleRate;
  const length = Math.max(1, Math.round(durationSeconds * sr));
  const buffer = audioContext.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = 0.5 * Math.sin((2 * Math.PI * freqHz * i) / sr);
  }
  return buffer;
}

/** Short bursts on every beat, separated by silence — a percussive/step-like
 *  signal the onset detector's rising-edge heuristic can locate reliably. */
function createClickTrainBuffer(audioContext: AudioContext, durationSeconds: number, bpm: number): AudioBuffer {
  const sr = audioContext.sampleRate;
  const length = Math.max(1, Math.round(durationSeconds * sr));
  const buffer = audioContext.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  const beatSeconds = 60 / bpm;
  const clickSamples = Math.round(CLICK_DURATION_SEC * sr);
  for (let beatIndex = 0; beatIndex * beatSeconds < durationSeconds; beatIndex++) {
    const start = Math.round(beatIndex * beatSeconds * sr);
    for (let i = 0; i < clickSamples && start + i < length; i++) {
      // Linear fade-out so the burst's END isn't itself a discontinuity — the
      // detector only flags RISING edges, so the abrupt START is what it finds.
      const env = 1 - i / clickSamples;
      data[start + i] = 0.8 * Math.sin((2 * Math.PI * CLICK_FREQ_HZ * i) / sr) * env;
    }
  }
  return buffer;
}

function registerAudioFile(
  project: Project,
  localAudioBuffers: Map<string, AudioBuffer>,
  buffer: AudioBuffer,
  fileName: string
): AudioFileBox {
  const uuid = UUID.generate();
  localAudioBuffers.set(UUID.toString(uuid), buffer);
  return AudioFileBox.create(project.boxGraph, uuid, (box) => {
    box.fileName.setValue(fileName);
    box.endInSeconds.setValue(buffer.duration);
  });
}

function createTapeRegion(
  project: Project,
  trackBox: TrackBox,
  fileBox: AudioFileBox,
  position: number,
  duration: number,
  loopOffset: number,
  loopDuration: number,
  label: string
): void {
  const eventsCollectionBox = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());
  AudioRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
    box.regions.refer(trackBox.regions);
    box.file.refer(fileBox);
    box.events.refer(eventsCollectionBox.owners);
    box.position.setValue(position);
    box.duration.setValue(duration);
    box.loopOffset.setValue(loopOffset);
    box.loopDuration.setValue(loopDuration);
    box.label.setValue(label);
    box.mute.setValue(false);
  });
}

// ─── Per-family builders ────────────────────────────────────────────────────

function buildMetronome(bpm: number): BuiltScenario {
  const quarters = AUDIT_SCENARIOS.metronome.renderBars * 4;
  return { renderSeconds: quartersToSeconds(quarters, bpm) + TAIL_PADDING_SEC, startPositionPpqn: 0, needsMetronome: true };
}

function buildLoopWrap(project: Project, bpm: number): BuiltScenario {
  const loopPpqn = LOOP_WRAP_BARS * BAR_PPQN;
  const { trackBox } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Vaporisateur))
    .unwrap();

  project.editing.modify(() => {
    const regionBox = project.api.createNoteRegion({
      trackBox,
      position: 0 as ppqn,
      duration: loopPpqn as ppqn,
      loopDuration: loopPpqn as ppqn,
    });
    project.api.createNoteEvent({
      owner: regionBox,
      position: 0 as ppqn,
      duration: SIXTEENTH_PPQN as ppqn,
      pitch: 60,
      velocity: 1.0,
    });
  });

  project.editing.modify(() => {
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(loopPpqn);
    project.timelineBox.loopArea.enabled.setValue(true);
  });

  const totalBars = AUDIT_SCENARIOS["loop-wrap"].renderBars;
  return {
    renderSeconds: quartersToSeconds(totalBars * 4, bpm) + TAIL_PADDING_SEC,
    startPositionPpqn: 0,
    needsMetronome: false,
  };
}

function buildSeam(
  project: Project,
  bpm: number,
  localAudioBuffers: Map<string, AudioBuffer>,
  audioContext: AudioContext
): BuiltScenario {
  const totalBars = AUDIT_SCENARIOS.seam.renderBars; // 2
  const totalSeconds = quartersToSeconds(totalBars * 4, bpm);
  const fullPpqn = totalBars * BAR_PPQN;
  const buffer = createToneBuffer(audioContext, totalSeconds, 220);

  const { trackBox } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Tape))
    .unwrap();

  project.editing.modify(() => {
    const fileBox = registerAudioFile(project, localAudioBuffers, buffer, "seam-tone-220hz.wav");
    // Two butt regions on ONE track (same file, continuous content) — region B's
    // loopOffset continues exactly where A left off, per rebuildSpliceRegions's
    // zoneStart + take.offset pattern (src/lib/compLaneUtils.ts).
    createTapeRegion(project, trackBox, fileBox, 0, BAR_PPQN, 0, fullPpqn, "Seam A");
    createTapeRegion(project, trackBox, fileBox, BAR_PPQN, fullPpqn - BAR_PPQN, BAR_PPQN, fullPpqn, "Seam B");
  });

  return { renderSeconds: totalSeconds + TAIL_PADDING_SEC, startPositionPpqn: 0, needsMetronome: false };
}

function buildRegionFencepost(
  project: Project,
  bpm: number,
  localAudioBuffers: Map<string, AudioBuffer>,
  audioContext: AudioContext
): BuiltScenario {
  const totalBars = AUDIT_SCENARIOS["region-fencepost"].renderBars; // 4
  const contentSeconds = quartersToSeconds(totalBars * 4, bpm);
  const contentPpqn = totalBars * BAR_PPQN;
  const buffer = createClickTrainBuffer(audioContext, contentSeconds, bpm);

  const { trackBox } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Tape))
    .unwrap();

  const position = Math.round((7 * PPQN.Quarter) / 4); // 1680 — 7 sixteenths
  project.editing.modify(() => {
    const fileBox = registerAudioFile(project, localAudioBuffers, buffer, "click-train.wav");
    createTapeRegion(project, trackBox, fileBox, position, contentPpqn, 0, contentPpqn, "Click Train");
  });

  return { renderSeconds: contentSeconds + TAIL_PADDING_SEC, startPositionPpqn: 0, needsMetronome: false };
}

function buildNoteOnsets(project: Project, bpm: number): BuiltScenario {
  const totalBars = AUDIT_SCENARIOS["note-onsets"].renderBars; // 4
  const contentPpqn = totalBars * BAR_PPQN;

  const { trackBox } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Vaporisateur))
    .unwrap();

  project.editing.modify(() => {
    const regionBox = project.api.createNoteRegion({
      trackBox,
      position: 0 as ppqn,
      duration: contentPpqn as ppqn,
      loopDuration: contentPpqn as ppqn,
    });
    for (const pos of NOTE_ONSET_POSITIONS) {
      project.api.createNoteEvent({
        owner: regionBox,
        position: pos as ppqn,
        duration: SIXTEENTH_PPQN as ppqn,
        pitch: 60,
        velocity: 1.0,
      });
    }
  });

  return {
    renderSeconds: quartersToSeconds(totalBars * 4, bpm) + TAIL_PADDING_SEC,
    startPositionPpqn: 0,
    needsMetronome: false,
  };
}

function buildAutomation(
  project: Project,
  bpm: number,
  localAudioBuffers: Map<string, AudioBuffer>,
  audioContext: AudioContext
): BuiltScenario {
  const totalBars = AUDIT_SCENARIOS.automation.renderBars; // 4
  const contentSeconds = quartersToSeconds(totalBars * 4, bpm);
  const contentPpqn = totalBars * BAR_PPQN;
  const buffer = createToneBuffer(audioContext, contentSeconds, 440);

  const { audioUnitBox, trackBox } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Tape))
    .unwrap();

  project.editing.modify(() => {
    const fileBox = registerAudioFile(project, localAudioBuffers, buffer, "automation-tone-440hz.wav");
    createTapeRegion(project, trackBox, fileBox, 0, contentPpqn, 0, contentPpqn, "Automation Tone");
  });

  const automationTrackBox = project.editing
    .modify(() =>
      project.api.createAutomationTrack(
        audioUnitBox,
        audioUnitBox.volume as unknown as Field<Pointers.Automation>
      )
    )
    .unwrap();
  const regionBox = project.editing
    .modify(() => project.api.createTrackRegion(automationTrackBox, 0 as ppqn, contentPpqn as ppqn))
    .unwrap()
    .unwrap() as ValueRegionBox;

  // Gate schedule: ON@0, OFF@bar1, ON@bar2, OFF@bar2.5, ON@bar3 (rising edges
  // at bars 0/2/3 are the expected onsets — see auditExpectations.ts).
  const steps = [
    { position: 0, value: VOL_0DB },
    { position: BAR_PPQN, value: VOL_SILENT },
    { position: 2 * BAR_PPQN, value: VOL_0DB },
    { position: Math.round(2.5 * BAR_PPQN), value: VOL_SILENT },
    { position: 3 * BAR_PPQN, value: VOL_0DB },
  ];
  // Separate commit (editing.append): createTrackRegion's seed node at
  // region-local position 0 isn't visible to the adapter collection until this
  // transaction commits (root CLAUDE.md transaction-staleness rule).
  project.editing.append(() => {
    const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
    const collection = adapter.optCollection.unwrap();
    collection.events.asArray().forEach((evt) => evt.box.delete());
    for (const step of steps) {
      collection.createEvent({
        position: step.position as ppqn,
        index: 0,
        value: step.value,
        interpolation: Interpolation.None,
      });
    }
  });

  return { renderSeconds: contentSeconds + TAIL_PADDING_SEC, startPositionPpqn: 0, needsMetronome: false };
}

function buildTempoRamp(project: Project, bpm: number): BuiltScenario {
  const totalPpqn = AUDIT_SCENARIOS["tempo-ramp"].renderBars * BAR_PPQN; // 8 bars

  project.editing.modify(() => {
    project.timelineBoxAdapter.tempoTrackEvents.ifSome((collection) => {
      collection.events.asArray().forEach((evt) => evt.box.delete());
    });
    project.timelineBoxAdapter.tempoTrackEvents.ifSome((collection) => {
      // Linear from bpm to 0.75*bpm across evenly-spaced PPQN beats == linear
      // in beat index (auditExpectations.ts's tempo-ramp onset formula).
      collection.createEvent({ position: 0 as ppqn, index: 0, value: bpm, interpolation: Interpolation.Linear });
      collection.createEvent({ position: totalPpqn as ppqn, index: 0, value: bpm * 0.75, interpolation: Interpolation.None });
    });
  });

  const onsets = expectedOnsets("tempo-ramp", bpm);
  const lastOnset = onsets.length > 0 ? onsets[onsets.length - 1] : 0;
  const tailBeatSec = 60 / (bpm * 0.75); // slowest tempo in the ramp — generous tail
  return { renderSeconds: lastOnset + tailBeatSec, startPositionPpqn: 0, needsMetronome: true };
}

function buildSignature(project: Project, bpm: number): BuiltScenario {
  project.editing.modify(() => {
    project.timelineBox.signature.nominator.setValue(3);
    project.timelineBox.signature.denominator.setValue(4);
  });

  const changePosition = SIGNATURE_BARS_3_4 * 3 * 960; // 2 bars of 3/4 = 5760 PPQN
  project.editing.modify(() => {
    project.timelineBoxAdapter.signatureTrack.createEvent(changePosition as ppqn, 4, 4);
  });

  const totalQuarters = SIGNATURE_BARS_3_4 * 3 + SIGNATURE_BARS_4_4 * 4; // 26
  return {
    renderSeconds: quartersToSeconds(totalQuarters, bpm) + TAIL_PADDING_SEC,
    startPositionPpqn: 0,
    needsMetronome: true,
  };
}

function buildTransportPos(bpm: number): BuiltScenario {
  const totalBars = AUDIT_SCENARIOS["transport-pos"].renderBars; // 2
  const startPositionPpqn = 5 * 960 + 240; // off-grid: 5 beats + a sixteenth
  return {
    renderSeconds: quartersToSeconds(totalBars * 4, bpm) + TAIL_PADDING_SEC,
    startPositionPpqn,
    needsMetronome: true,
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────

export function buildAuditScenario(
  project: Project,
  family: AuditFamily,
  bpm: number,
  localAudioBuffers: Map<string, AudioBuffer>,
  audioContext: AudioContext
): BuiltScenario {
  project.editing.modify(() => {
    project.timelineBox.bpm.setValue(bpm);
  });

  switch (family) {
    case "metronome":
      return buildMetronome(bpm);
    case "loop-wrap":
      return buildLoopWrap(project, bpm);
    case "seam":
      return buildSeam(project, bpm, localAudioBuffers, audioContext);
    case "region-fencepost":
      return buildRegionFencepost(project, bpm, localAudioBuffers, audioContext);
    case "note-onsets":
      return buildNoteOnsets(project, bpm);
    case "automation":
      return buildAutomation(project, bpm, localAudioBuffers, audioContext);
    case "tempo-ramp":
      return buildTempoRamp(project, bpm);
    case "signature":
      return buildSignature(project, bpm);
    case "transport-pos":
      return buildTransportPos(bpm);
  }
}
