import type { Project } from "@opendaw/studio-core";
import type { AudioRegionBoxAdapter, ValueRegionBoxAdapter, AnyRegionBoxAdapter } from "@opendaw/studio-adapters";

/**
 * Collect all region adapters across every audio unit and track in the project.
 */
export function getAllRegions(project: Project): AnyRegionBoxAdapter[] {
  return project.rootBoxAdapter.audioUnits.adapters()
    .flatMap(unit => unit.tracks.adapters())
    .flatMap(track => track.regions.adapters.values() as AnyRegionBoxAdapter[]);
}

/**
 * Collect all audio region adapters across every audio unit and track.
 */
export function getAllAudioRegions(project: Project): AudioRegionBoxAdapter[] {
  return getAllRegions(project).filter(r => r.isAudioRegion());
}

/**
 * Collect all non-audio (value/note) region adapters across every audio unit and track.
 */
export function getAllValueRegions(project: Project): ValueRegionBoxAdapter[] {
  return getAllRegions(project).filter(r => r.isValueRegion());
}
