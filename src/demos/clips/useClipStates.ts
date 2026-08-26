import { useEffect, useState } from "react";
import { Project } from "@opendaw/studio-core";
import { applyClipNotification, type ClipStateMap } from "./clipStates";

/** Live clip launcher state (absent key = idle). Subscribes to the engine's
 *  clip notifications: "waiting" fires on schedule (optimistic), "sequencing"
 *  confirms started/stopped/obsolete at quantize boundaries. */
export function useClipStates(project: Project | null): ClipStateMap {
  const [states, setStates] = useState<ClipStateMap>(new Map());

  useEffect(() => {
    if (project === null) return undefined;
    const subscription = project.engine.subscribeClipNotification(notification => {
      setStates(prev => applyClipNotification(prev, notification));
    });
    return () => {
      subscription.terminate();
      setStates(new Map());
    };
  }, [project]);

  return states;
}
