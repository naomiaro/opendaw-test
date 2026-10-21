/**
 * Removing a MIDI effect device the audit inserted, and reaching a Zeitgeist's groove box.
 * A Zeitgeist points at its own groove box through a mandatory pointer, and the groove box
 * itself requires an incoming edge; the box graph deletes the groove with the device (the test
 * pins it), so one `delete()` in one transaction leaves nothing behind.
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
