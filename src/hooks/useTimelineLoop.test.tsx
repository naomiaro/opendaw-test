// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BoxEditing } from "@opendaw/lib-box";
import { ProjectSkeleton } from "@opendaw/studio-adapters";
import { useTimelineLoop, type TimelineLoopHost } from "./useTimelineLoop";

/** A real timeline box and a real editing, without an engine. */
function host(): TimelineLoopHost & { editing: BoxEditing } {
  const { boxGraph, mandatoryBoxes: { timelineBox } } =
    ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  return { editing: new BoxEditing(boxGraph), timelineBox };
}

const FOUR_BARS = { from: 0, to: 15360 };

describe("useTimelineLoop", () => {
  it("switches the loop on over the given range when asked to start enabled", () => {
    const project = host();
    const { loopArea } = project.timelineBox;
    expect(loopArea.enabled.getValue()).toBe(false); // a fresh project does not loop

    const { result } = renderHook(() => useTimelineLoop(project, { from: 960, to: 7680, enabled: true }));

    expect(loopArea.enabled.getValue()).toBe(true);
    expect(loopArea.from.getValue()).toBe(960);
    expect(loopArea.to.getValue()).toBe(7680);
    expect(result.current[0]).toBe(true);
  });

  it("switches a loop that is on off when asked to start disabled", () => {
    const project = host();
    const { loopArea } = project.timelineBox;
    project.editing.modify(() => loopArea.enabled.setValue(true));

    const { result } = renderHook(() => useTimelineLoop(project, { ...FOUR_BARS, enabled: false }));

    expect(loopArea.enabled.getValue()).toBe(false);
    expect(result.current[0]).toBe(false);
  });

  it("writes through the returned function", () => {
    const project = host();
    const { result } = renderHook(() => useTimelineLoop(project, { ...FOUR_BARS, enabled: false }));

    act(() => result.current[1](true));

    expect(project.timelineBox.loopArea.enabled.getValue()).toBe(true);
    expect(result.current[0]).toBe(true);
  });

  it("follows a write made elsewhere, such as an undo", () => {
    const project = host();
    const { result } = renderHook(() => useTimelineLoop(project, { ...FOUR_BARS, enabled: false }));

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    act(() => { project.editing.undo(); });
    expect(result.current[0]).toBe(false);
    expect(project.timelineBox.loopArea.enabled.getValue()).toBe(false);
  });

  it("rewrites the range when it changes and leaves the switch where the user put it", () => {
    const project = host();
    const { result, rerender } = renderHook(
      ({ to }) => useTimelineLoop(project, { from: 0, to, enabled: false }),
      { initialProps: { to: 15360 } }
    );
    act(() => result.current[1](true));

    rerender({ to: 30720 });

    expect(project.timelineBox.loopArea.to.getValue()).toBe(30720);
    expect(project.timelineBox.loopArea.enabled.getValue()).toBe(true);
    expect(result.current[0]).toBe(true);
  });

  it("does nothing without a project and stops following after unmount", () => {
    const { result } = renderHook(() => useTimelineLoop(null, { ...FOUR_BARS, enabled: true }));
    act(() => result.current[1](false)); // no project to write to
    expect(result.current[0]).toBe(true);

    const project = host();
    const mounted = renderHook(() => useTimelineLoop(project, { ...FOUR_BARS, enabled: false }));
    mounted.unmount();
    act(() => { project.editing.modify(() => project.timelineBox.loopArea.enabled.setValue(true)); });
    expect(mounted.result.current[0]).toBe(false);
  });
});
