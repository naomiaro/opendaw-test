// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import { INITIAL_STATE, type PageState } from "@/lib/midiEffects/pageState";
import { MidiChainSections } from "./MidiChainSections";

function show(state: PageState) {
  const dispatch = vi.fn();
  render(
    <Theme>
      <MidiChainSections
        state={state}
        dispatch={dispatch}
        entries={[]}
        project={null}
        renderCard={() => <div data-testid="card" />}
      />
    </Theme>,
  );
  return { dispatch };
}

describe("MidiChainSections", () => {
  it("in single mode with the dry tab shows the no-device hint", () => {
    show(INITIAL_STATE);
    expect(document.body.textContent).toContain("No device: the pattern as written.");
  });

  it("selecting a device tab dispatches selectTab", async () => {
    const user = userEvent.setup();
    const { dispatch } = show(INITIAL_STATE);
    await user.click(screen.getAllByText("Pitch")[0]);
    expect(dispatch).toHaveBeenCalledWith({ type: "selectTab", tab: "pitch" });
  });

  it("in stack mode the tabs are inert and the hint says the stack owns the chain", () => {
    show({ mode: "stack", tab: "dry", stack: ["pitch"] });
    expect(document.body.textContent).toContain("The stack below owns the chain.");
    const tabs = screen.getAllByText("Pitch")[0].closest("div[style*='pointer-events']") as HTMLElement;
    expect(tabs.style.pointerEvents).toBe("none");
  });
});
