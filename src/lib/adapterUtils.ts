import type { Project } from "@opendaw/studio-core";
import type { AudioRegionBoxAdapter, ValueRegionBoxAdapter } from "@opendaw/studio-adapters";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { Field } from "@opendaw/lib-box";
import type { Pointers } from "@opendaw/studio-enums";

/**
 * Collect all region adapters across every audio unit and track in the project.
 */
export function getAllRegions(project: Project): AnyRegionBoxAdapter[] {
  return project.rootBoxAdapter.audioUnits.adapters()
    .flatMap(unit => unit.tracks.values())
    .flatMap(track => [...track.regions.adapters.values()]);
}

/**
 * Collect all audio region adapters across every audio unit and track.
 */
export function getAllAudioRegions(project: Project): AudioRegionBoxAdapter[] {
  return getAllRegions(project).filter(r => r.isAudioRegion());
}

/**
 * Collect all automation (value) region adapters. Note regions are excluded.
 */
export function getAllValueRegions(project: Project): ValueRegionBoxAdapter[] {
  return getAllRegions(project).filter(r => r.isValueRegion());
}

/**
 * Resolve the AudioUnitBoxAdapter for an AudioUnitBox (lazily created, cached by UUID).
 */
export function audioUnitAdapterFor(project: Project, audioUnitBox: AudioUnitBox): AudioUnitBoxAdapter {
  return project.boxAdapters.adapterFor(audioUnitBox, AudioUnitBoxAdapter);
}

/**
 * Audio-effect chain field of an audio unit, via the adapter layer — the field
 * `project.api.insertEffect()` / `moveEffects()` take. The DeviceHost chain getters
 * are Option-wrapped (`None` = the host has no such chain kind, e.g. an
 * effect-composite branch); an audio unit always hosts both chains, so the unwrap
 * cannot fail here. Resolve OUTSIDE editing.modify() when the unit was created in a
 * still-open transaction.
 */
export function audioEffectsFieldOf(project: Project, audioUnitBox: AudioUnitBox): Field<Pointers.AudioEffectHost> {
  return audioUnitAdapterFor(project, audioUnitBox)
    .audioEffectsField.unwrap("audio unit hosts no audio-effect chain");
}

/**
 * MIDI-effect chain field of an audio unit, via the adapter layer (see
 * audioEffectsFieldOf for the Option semantics).
 */
export function midiEffectsFieldOf(project: Project, audioUnitBox: AudioUnitBox): Field<Pointers.MIDIEffectHost> {
  return audioUnitAdapterFor(project, audioUnitBox)
    .midiEffectsField.unwrap("audio unit hosts no midi-effect chain");
}
