// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { NoteFilterDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { ParamSwitch } from "./ParamSwitch";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";

describe("ParamSwitch in the DOM", () => {
  it("a click writes on through the binding, prints On, and undo flips it back", () => {
    const { adapter, editing } = midiEffectFixture("note-filter");
    if (!(adapter instanceof NoteFilterDeviceBoxAdapter)) throw new Error("not a note filter fixture");
    const set = adapter.namedParameter.set;
    render(<Theme><ParamSwitch project={{ editing }} parameter={set} label="Set" /></Theme>);

    fireEvent.click(screen.getByRole("switch", { name: "Set" }));

    expect(set.getUnitValue()).toBe(1);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("On")).toBeDefined();

    act(() => { editing.undo(); });

    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Off")).toBeDefined();
  });

  it("a second click writes off", () => {
    const { adapter, editing } = midiEffectFixture("note-filter");
    if (!(adapter instanceof NoteFilterDeviceBoxAdapter)) throw new Error("not a note filter fixture");
    const set = adapter.namedParameter.set;
    render(<Theme><ParamSwitch project={{ editing }} parameter={set} label="Set" /></Theme>);

    fireEvent.click(screen.getByRole("switch", { name: "Set" }));
    fireEvent.click(screen.getByRole("switch", { name: "Set" }));

    expect(set.getUnitValue()).toBe(0);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Off")).toBeDefined();
  });
});
