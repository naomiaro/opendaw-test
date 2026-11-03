/**
 * Removing a MIDI effect device the audit inserted, and reaching a Zeitgeist's groove box.
 * The groove box requires an incoming edge and the Zeitgeist's pointer is its only one, so the
 * graph unstages it with the device (the test pins it): one `delete()` in one transaction
 * leaves nothing behind. A groove shared by two devices would stay.
 */
import { GrooveShuffleBox, MaximizerDeviceBox, type AudioUnitBox, type ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
import type { EffectBox } from "@opendaw/studio-core";

export function zeitgeistGrooveBox(box: ZeitgeistDeviceBox): GrooveShuffleBox {
  const groove = box.groove.targetVertex.unwrap("Zeitgeist has no groove").box;
  if (!(groove instanceof GrooveShuffleBox)) throw new Error(`Zeitgeist groove is a ${groove.constructor.name}, not a GrooveShuffleBox`);
  return groove;
}

/** One transaction; a Zeitgeist takes its groove box with it. */
export function removeMidiEffect(editing: { modify(fn: () => void): unknown }, box: EffectBox): void {
  editing.modify(() => box.delete());
}

/** Every box, one transaction each, last to first (the chain unwinds the way it was built). A throw names the
 *  box and leaves the boxes already removed removed. `Box.delete()` of a detached box returns without a word,
 *  so a box that is not attached is refused here: it is not in the chain it was meant to leave. */
export function removeMidiEffects(editing: { modify(fn: () => void): unknown }, boxes: readonly EffectBox[]): void {
  for (const box of [...boxes].reverse()) {
    try {
      if (!box.isAttached()) throw new Error("the box is not attached");
      removeMidiEffect(editing, box);
    } catch (cause) {
      throw new Error(`${box.label.getValue()} could not be removed: ${String(cause)}`);
    }
  }
}

/** The project skeleton puts a Maximizer on the master's audio chain; a render that must be level-true
 *  deletes it first. One transaction; returns how many it deleted. */
export function removeMasterMaximizer(editing: { modify(fn: () => void): unknown }, outputUnitBox: AudioUnitBox): number {
  const maximizers = outputUnitBox.audioEffects.pointerHub.incoming()
    .map((pointer) => pointer.box)
    .filter((box): box is MaximizerDeviceBox => box instanceof MaximizerDeviceBox);
  editing.modify(() => maximizers.forEach((box) => box.delete()));
  return maximizers.length;
}
