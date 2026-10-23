/**
 * The MIDI output timing audit's project state: one audio unit whose instrument is the SDK's MIDI
 * Output device, a `MIDIOutputBox` under `rootBox.outputMidiDevices` that names the IAC output port
 * (as the studio's DeviceSelector does), and a note region holding the pattern. The PAGE arm is made
 * by emptying the box's `id`: the engine interns an empty id to device −1 and queues nothing, so the
 * ENGINE arm's timing path is exactly the installed one. Browser-only; no unit tests by repo convention.
 */
import { UUID } from "@opendaw/lib-std";
import type { ppqn } from "@opendaw/lib-dsp";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { MIDIOutputBox, type AudioUnitBox, type NoteRegionBox, type TrackBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import { getAllRegions } from "@/lib/adapterUtils";
import { waitForNotRecording } from "./midiInputCellRunner";
import type { OutputArm } from "./midiOutputParams";
import { patternEndPpqnOf, type OutputPatternNote } from "./midiOutputPattern";

export interface OutputProjectState {
  audioUnitBox: AudioUnitBox;
  trackBox: TrackBox;
  midiOutputBox: MIDIOutputBox;
  regionBox: NoteRegionBox | null;
}

/** One transaction: the instrument, the output box under the root hub, the device pointer. No capture fields are read, so no second transaction. */
export function buildOutputProject(project: Project, port: { id: string; name: string | null }, delayInMs: number, sendTransport: boolean): OutputProjectState {
  const { rootBox } = project;
  return project.editing.modify(() => {
    const { audioUnitBox, instrumentBox, trackBox } = project.api.createInstrument(InstrumentFactories.MIDIOutput);
    const midiOutputBox = MIDIOutputBox.create(rootBox.graph, UUID.generate(), (box) => {
      box.id.setValue(port.id);
      box.label.setValue(port.name ?? "Unnamed");
      box.delayInMs.setValue(delayInMs);
      box.sendTransportMessages.setValue(sendTransport);
      box.root.refer(rootBox.outputMidiDevices);
    });
    instrumentBox.device.refer(midiOutputBox.device);
    return { audioUnitBox, trackBox, midiOutputBox, regionBox: null } satisfies OutputProjectState;
  }).unwrap("buildOutputProject: the transaction returned nothing");
}

/**
 * Replaces the pattern region: the previous one is deleted (cascade), a new one created at `originPpqn`
 * spanning the pattern (`loopDuration` defaults to the duration through `createNoteRegion`), and the
 * events written region-local in the same transaction through the API, as the repo's builders do.
 * Afterwards the region's collection is read back and must hold every note.
 */
export function writeOutputPattern(project: Project, state: OutputProjectState, pattern: readonly OutputPatternNote[], originPpqn: number): void {
  const durationPpqn = patternEndPpqnOf(pattern) - originPpqn;
  const regionBox = project.editing.modify(() => {
    state.regionBox?.delete();
    const box = project.api.createNoteRegion({
      trackBox: state.trackBox,
      position: originPpqn as ppqn,
      duration: durationPpqn as ppqn,
      loopDuration: durationPpqn as ppqn,
      name: "midi output audit",
    });
    for (const note of pattern) {
      project.api.createNoteEvent({
        owner: box,
        position: (note.onPpqn - originPpqn) as ppqn,
        duration: note.durationPpqn as ppqn,
        pitch: note.pitch,
        velocity: note.velocity / 127,
        cent: 0,
        chance: 100,
      });
    }
    return box;
  }).unwrap("writeOutputPattern: the transaction returned nothing");
  state.regionBox = regionBox;
  const adapter = getAllRegions(project).find((r) => r.isNoteRegion() && UUID.equals(r.box.address.uuid, regionBox.address.uuid));
  const count = adapter !== undefined && adapter.isNoteRegion() && adapter.hasCollection ? adapter.optCollection.unwrap().events.asArray().length : -1;
  if (count !== pattern.length) throw new Error(`writeOutputPattern: the region holds ${count} events, expected ${pattern.length}`);
}

/** The arm switch: the page arm empties the box id (nothing is queued), the engine arm names the port; delay and transport are rewritten each time. */
export function setOutputArm(project: Project, state: OutputProjectState, arm: OutputArm, portId: string, delayInMs: number, sendTransport: boolean): void {
  project.editing.modify(() => {
    state.midiOutputBox.id.setValue(arm === "engine" ? portId : "");
    state.midiOutputBox.delayInMs.setValue(delayInMs);
    state.midiOutputBox.sendTransportMessages.setValue(sendTransport);
  });
}

/** Stops a recording still running, resets the engine and rewinds; a warning when the stop did not land in time. */
export async function resetOutputTransport(project: Project): Promise<string | null> {
  let warning: string | null = null;
  if (project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue()) {
    project.stopRecording();
    try {
      await waitForNotRecording(project, 10_000);
    } catch (err) {
      warning = `recording did not stop before cleanup: ${String(err)}`;
    }
  }
  project.engine.stop(true);
  project.engine.setPosition(0 as ppqn);
  return warning;
}
