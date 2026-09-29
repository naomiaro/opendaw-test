// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useParameterUnit } from "./useParameterUnit";
import { samplerFixture } from "@/lib/testing/boxGraphFixtures";

describe("useParameterUnit", () => {
  it("starts with the parameter's value, already on the first render", () => {
    const { adapter, project } = samplerFixture();
    const renders: string[] = [];

    renderHook(() => {
      const [unit, print] = useParameterUnit(project, adapter.namedParameter.octave);
      renders.push(`${unit} ${print}`);
    });

    expect(renders[0]).toBe("0.5 0 oct");
  });

  it("writes through the returned function", () => {
    const { adapter, box, project } = samplerFixture();
    const { result } = renderHook(() => useParameterUnit(project, adapter.namedParameter.tune));

    act(() => result.current[2](1));

    expect(box.tune.getValue()).toBeCloseTo(1200, 3);
    expect(result.current[0]).toBe(1);
    expect(result.current[1]).toBe("1200 ct");
  });

  it("follows a write made elsewhere, such as a preset or an undo", () => {
    const { adapter, box, project } = samplerFixture();
    const { result } = renderHook(() => useParameterUnit(project, adapter.namedParameter.octave));

    act(() => project.editing.modify(() => box.octave.setValue(2)));
    expect(result.current[1]).toBe("2 oct");

    act(() => project.editing.undo());
    expect(result.current[1]).toBe("0 oct");
  });

  it("ends its subscription when the component goes away", () => {
    const { adapter, project } = samplerFixture();
    const parameter = adapter.namedParameter.octave;
    // Count what the hook does with the parameter's real subscription.
    let open = 0;
    const subscribe = parameter.catchupAndSubscribe.bind(parameter);
    parameter.catchupAndSubscribe = observer => {
      const subscription = subscribe(observer);
      open++;
      return { terminate: () => { open--; subscription.terminate(); } };
    };
    const { unmount } = renderHook(() => useParameterUnit(project, parameter));
    expect(open).toBe(1);

    unmount();

    expect(open).toBe(0);
  });

  it("follows the new parameter, and lets go of the old one, when the parameter changes", () => {
    const { adapter, box, project } = samplerFixture();
    const { result, rerender } = renderHook(
      ({ name }: { name: "octave" | "tune" }) => useParameterUnit(project, adapter.namedParameter[name]),
      { initialProps: { name: "octave" } }
    );

    rerender({ name: "tune" });
    expect(result.current[1]).toBe("0 ct");

    act(() => project.editing.modify(() => box.octave.setValue(3)));
    expect(result.current[1]).toBe("0 ct");

    act(() => project.editing.modify(() => box.tune.setValue(700)));
    expect(result.current[1]).toBe("700 ct");
  });

  it("writes to the new parameter after the parameter changes", () => {
    const { adapter, box, project } = samplerFixture();
    const { result, rerender } = renderHook(
      ({ name }: { name: "octave" | "tune" }) => useParameterUnit(project, adapter.namedParameter[name]),
      { initialProps: { name: "octave" } }
    );

    rerender({ name: "tune" });
    act(() => result.current[2](1));

    expect(box.tune.getValue()).toBeCloseTo(1200, 3);
    expect(box.octave.getValue()).toBe(0);
  });

  it("keeps the same write function between renders, so a control is not rebuilt each time", () => {
    const { adapter, project } = samplerFixture();
    const { result, rerender } = renderHook(() => useParameterUnit(project, adapter.namedParameter.tune));
    const first = result.current[2];

    rerender();

    expect(result.current[2]).toBe(first);
  });
});
