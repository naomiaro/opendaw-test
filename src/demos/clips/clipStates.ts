// Pure reducer over engine clip notifications. Absent key = idle.
import { UUID } from "@opendaw/lib-std";
import type { ClipNotification } from "@opendaw/studio-adapters";

export type ClipState = "waiting" | "playing";
export type ClipStateMap = ReadonlyMap<string, ClipState>;

export const applyClipNotification = (
  prev: ClipStateMap,
  notification: ClipNotification,
): ClipStateMap => {
  const next = new Map(prev);
  if (notification.type === "waiting") {
    notification.clips.forEach(uuid => next.set(UUID.toString(uuid), "waiting"));
  } else {
    const { started, stopped, obsolete } = notification.changes;
    stopped.forEach(uuid => next.delete(UUID.toString(uuid)));
    obsolete.forEach(uuid => next.delete(UUID.toString(uuid)));
    started.forEach(uuid => next.set(UUID.toString(uuid), "playing"));
  }
  return next;
};
