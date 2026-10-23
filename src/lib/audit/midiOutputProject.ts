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
 * Replaces the pattern region: the previous one is re-resolved by uuid and deleted (cascade; a held
 * instance may be stale after a rollback), a new one created at `originPpqn` spanning the pattern
 * (`loopDuration` written explicitly equal to the duration; the API would default it the same way), and
 * the events written region-local in the same transaction through the API, as the repo's builders do.
 * Afterwards the track must hold exactly one note region, with every note in its collection.
 */
export function writeOutputPattern(project: Project, state: OutputProjectState, pattern: readonly OutputPatternNote[], originPpqn: number): void {
  const durationPpqn = patternEndPpqnOf(pattern) - originPpqn;
  const previousUuid = state.regionBox?.address.uuid ?? null;
  const regionBox = project.editing.modify(() => {
    if (previousUuid !== null) {
      const previous = project.boxGraph.findBox(previousUuid);
      if (previous.nonEmpty()) previous.unwrap().delete();
    }
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
  const trackUuid = state.trackBox.address.uuid;
  const onTrack = getAllRegions(project).filter((r) => r.isNoteRegion() && r.trackBoxAdapter.mapOr((t) => UUID.equals(t.box.address.uuid, trackUuid), false));
  if (onTrack.length !== 1) throw new Error(`writeOutputPattern: the track holds ${onTrack.length} note regions, expected 1 (a leftover would play beside the pattern)`);
  const adapter = onTrack[0];
  if (!adapter.isNoteRegion() || !UUID.equals(adapter.box.address.uuid, regionBox.address.uuid)) throw new Error("writeOutputPattern: the region on the track is not the one just written");
  if (!adapter.hasCollection) throw new Error("writeOutputPattern: the region has no event collection");
  const count = adapter.optCollection.unwrap().events.asArray().length;
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

/**
 * Stops a recording still running, resets the engine and rewinds. THROWS when the stop does not land:
 * `project.startRecording` is a silent no-op while a recording is in flight, so nothing after this could
 * succeed, and the row must name the reset, not a later stage.
 */
export async function resetOutputTransport(project: Project): Promise<void> {
  if (project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue()) {
    project.stopRecording();
    try {
      await waitForNotRecording(project, 10_000);
    } catch (err) {
      throw new Error(`recording did not stop before cleanup: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  project.engine.stop(true);
  project.engine.setPosition(0 as ppqn);
}
