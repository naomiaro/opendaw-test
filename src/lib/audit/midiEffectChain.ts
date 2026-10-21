/**
 * Removing a MIDI effect device the audit inserted, and reaching a Zeitgeist's groove box.
 * The groove box requires an incoming edge and the Zeitgeist's pointer is its only one, so the
 * graph unstages it with the device (the test pins it): one `delete()` in one transaction
 * leaves nothing behind. A groove shared by two devices would stay.
 */
import { GrooveShuffleBox, type ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
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
