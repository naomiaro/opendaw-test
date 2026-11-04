// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import type { Project } from "@opendaw/studio-core";
import { INITIAL_STATE, type PageState } from "@/lib/midiEffects/pageState";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";
import { MidiChainSections, type MidiChainSectionsProps } from "./MidiChainSections";
import type { ChainEntry } from "./useMidiChain";

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

/** One real Pitch entry and a project the sections only test for presence (the card renderer is the spy). */
function showWithPitch(state: PageState) {
  const entry: ChainEntry = { box: midiEffectFixture("pitch").box, id: "pitch", enabled: true };
  const renderCard = vi.fn<MidiChainSectionsProps["renderCard"]>(() => <div data-testid="card" />);
  render(
    <Theme>
      <MidiChainSections state={state} dispatch={vi.fn()} entries={[entry]} project={{} as Project} renderCard={renderCard} />
    </Theme>,
  );
  return { entry, renderCard };
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

  it("in single mode with the device's tab selected renders its full card, and says Adding carries it over", () => {
    const { entry, renderCard } = showWithPitch({ mode: "single", tab: "pitch", stack: [] });
    expect(screen.getByTestId("card")).toBeTruthy();
    expect(renderCard).toHaveBeenCalledWith(entry, false);
    expect(renderCard.mock.calls.every(([, compact]) => compact === false)).toBe(true);
    expect(document.body.textContent).toContain("Adding carries Pitch over as the first chip.");
  });

  it("in stack mode an expanded chip renders the compact card", async () => {
    const user = userEvent.setup();
    const { entry, renderCard } = showWithPitch({ mode: "stack", tab: "dry", stack: ["pitch"] });
    expect(renderCard).not.toHaveBeenCalled();
    const chip = document.querySelector("button[aria-expanded]") as HTMLButtonElement;
    await user.click(chip);
    expect(renderCard).toHaveBeenCalledWith(entry, true);
    expect(renderCard.mock.calls.every(([, compact]) => compact === true)).toBe(true);
  });
});
