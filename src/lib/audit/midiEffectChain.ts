/**
 * Removing a MIDI effect device the audit inserted, and reaching a Zeitgeist's groove box.
 * A groove is a project resource: `EffectFactories.Zeitgeist` points a new device at the Global Shuffle, every
 * new Zeitgeist of the project shares it, and it stays when a device goes (the test pins it), its settings included.
 */
import type { Box } from "@opendaw/lib-box";
import { GrooveShuffleBox, MaximizerDeviceBox, type ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
import type { EffectBox } from "@opendaw/studio-core";

export function zeitgeistGrooveBox(box: ZeitgeistDeviceBox): GrooveShuffleBox {
  const groove = box.groove.targetVertex.unwrap("Zeitgeist has no groove").box;
  if (!(groove instanceof GrooveShuffleBox)) throw new Error(`Zeitgeist groove is a ${groove.constructor.name}, not a GrooveShuffleBox`);
  return groove;
}

/** One transaction; a Zeitgeist's groove stays in the project. */
export function removeMidiEffect(editing: { modify(fn: () => void): unknown }, box: EffectBox): void {
  editing.modify(() => box.delete());
}

/** Every box, one transaction each, last to first (the chain unwinds the way it was built). A throw names the
 *  box, carries the failure as its `cause`, and leaves the boxes already removed removed. `Box.delete()` of a
 *  detached box returns without a word, so a box that is not attached is refused here: it is not in the chain it
 *  was meant to leave; and a box still attached after its transaction was not removed, whatever the transaction said. */
export function removeMidiEffects(editing: { modify(fn: () => void): unknown }, boxes: readonly EffectBox[]): void {
  for (const box of [...boxes].reverse()) {
    try {
      if (!box.isAttached()) throw new Error("the box is not attached");
      removeMidiEffect(editing, box);
      if (box.isAttached()) throw new Error("the box is still attached after the delete");
    } catch (cause) {
      throw new Error(`${box.label.getValue()} could not be removed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }
}

/** The project skeleton puts a Maximizer on the master's audio chain; a render that must be level-true
 *  deletes it first. `effects` is the master's audio chain as the adapter layer gives it
 *  (`AudioUnitBoxAdapter.audioEffects`, each entry carrying its `box`); a Node test passes the chain's pointers,
 *  which carry it the same way. One transaction; deletes only the Maximizers and returns how many. */
export function removeMasterMaximizer(editing: { modify(fn: () => void): unknown }, effects: ReadonlyArray<{ box: Box }>): number {
  const maximizers = effects
    .map((effect) => effect.box)
    .filter((box): box is MaximizerDeviceBox => box instanceof MaximizerDeviceBox);
  editing.modify(() => maximizers.forEach((box) => box.delete()));
  return maximizers.length;
}
