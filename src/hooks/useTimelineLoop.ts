import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineBox } from "@opendaw/studio-boxes";

/** The part of a Project the loop switch touches. */
export interface TimelineLoopHost {
  readonly editing: { modify(modifier: () => void, mark?: boolean): unknown };
  readonly timelineBox: TimelineBox;
}

export interface TimelineLoopOptions {
  /** Loop start in PPQN (the field is an Int32). */
  readonly from: number;
  /** Loop end in PPQN (the field is an Int32). */
  readonly to: number;
  /** Whether the loop is on when the project arrives. */
  readonly enabled: boolean;
}

/**
 * The timeline loop as React state, for a page with a Loop switch.
 *
 * When the project arrives the hook writes the loop range and its starting state:
 * a fresh project's loop area is disabled and four bars long, and a switch has to
 * agree with the engine from the first frame. It then follows `loopArea.enabled`,
 * so an undo or a write made elsewhere moves the switch too. A later change of
 * `from` / `to` rewrites the range and leaves the switch where the user put it.
 *
 * Returns `[enabled, setEnabled]`.
 */
export function useTimelineLoop(
  project: TimelineLoopHost | null,
  { from, to, enabled: initiallyEnabled }: TimelineLoopOptions
): readonly [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(initiallyEnabled);
  // The project whose starting state has been written, so a range change does not reset the switch
  const initialized = useRef<TimelineLoopHost | null>(null);

  useEffect(() => {
    if (!project) return undefined;
    const { loopArea } = project.timelineBox;
    const first = initialized.current !== project;
    initialized.current = project;
    project.editing.modify(() => {
      loopArea.from.setValue(from);
      loopArea.to.setValue(to);
      if (first) loopArea.enabled.setValue(initiallyEnabled);
    });
    const subscription = loopArea.enabled.catchupAndSubscribe((owner) => setEnabledState(owner.getValue()));
    return () => subscription.terminate();
  }, [project, from, to, initiallyEnabled]);

  const setEnabled = useCallback((next: boolean) => {
    if (!project) return;
    project.editing.modify(() => project.timelineBox.loopArea.enabled.setValue(next));
  }, [project]);

  return [enabled, setEnabled];
}
