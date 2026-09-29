import { Terminable, UUID } from "@opendaw/lib-std";
import type { PointerField } from "@opendaw/lib-box";
import type { Project } from "@opendaw/studio-core";
import { AudioFileBox } from "@opendaw/studio-boxes";
import type { Pointers } from "@opendaw/studio-enums";

/**
 * Point `filePointer` at the AudioFileBox for `uuid`, creating the box when it
 * does not exist, and delete the previously referred file box when this
 * pointer was its only reference.
 *
 * MUST be called inside `editing.modify()` — it opens no transaction, so the
 * caller can combine the swap with other writes in one undo step.
 *
 * Returns the uuid string of a deleted file box, so the caller can drop its
 * decoded buffer from the local sample map, or null.
 */
export function referSampleFile(
  project: Pick<Project, "boxGraph">,
  filePointer: PointerField<Pointers.AudioFile>,
  uuid: UUID.Bytes,
  name: string,
  durationSeconds: number
): string | null {
  const { boxGraph } = project;
  const newFile = boxGraph
    .findBox<AudioFileBox>(uuid)
    .unwrapOrElse(() =>
      AudioFileBox.create(boxGraph, uuid, box => {
        box.fileName.setValue(name);
        box.endInSeconds.setValue(durationSeconds);
      })
    );
  let deletedUUID: string | null = null;
  filePointer.targetVertex.match({
    none: () => filePointer.refer(newFile),
    some: ({ box: existingFile }) => {
      if (UUID.equals(newFile.address.uuid, existingFile.address.uuid)) return;
      const mustDelete = existingFile.pointerHub.size() === 1;
      filePointer.refer(newFile);
      if (mustDelete) {
        deletedUUID = UUID.toString(existingFile.address.uuid);
        existingFile.delete();
      }
    },
  });
  return deletedUUID;
}

export interface SampleLoadHandlers {
  readonly onLoaded?: () => void;
  readonly onError?: (reason: string) => void;
}

/**
 * Report the outcome of a sample load exactly once. Reads the loader state
 * first: `subscribe()` invokes its callback synchronously for a terminal
 * state, so terminating inside that callback would touch the subscription
 * binding before it exists.
 *
 * Terminate the returned handle to cancel a watch that is no longer wanted
 * (for example when another sample has been selected in the meantime).
 */
export function watchSampleLoad(
  project: Pick<Project, "sampleManager">,
  uuid: UUID.Bytes,
  handlers: SampleLoadHandlers
): Terminable {
  const loader = project.sampleManager.getOrCreate(uuid);
  const state = loader.state;
  if (state.type === "error") {
    handlers.onError?.(state.reason);
    return Terminable.Empty;
  }
  if (state.type === "loaded") {
    handlers.onLoaded?.();
    return Terminable.Empty;
  }
  let subscribed = false;
  let cancelled = false;
  const sub = loader.subscribe(next => {
    if (cancelled) return;
    if (next.type === "error") handlers.onError?.(next.reason);
    if (next.type === "loaded") handlers.onLoaded?.();
    if ((next.type === "error" || next.type === "loaded") && subscribed) sub.terminate();
  });
  subscribed = true;
  return {
    terminate: () => {
      cancelled = true;
      sub.terminate();
    },
  };
}
