// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import type { Project } from "@opendaw/studio-core";
import { MidiEffectCard } from "./MidiEffectCard";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";

describe("MidiEffectCard", () => {
  it("dims Key while Set is off and Semitones once it is on", () => {
    const { box, editing, boxAdapters } = midiEffectFixture("note-filter");
    // The card reads `editing` and `boxAdapters` of its project; the fixture's stand in for the rest.
    const project = { editing, boxAdapters } as unknown as Project;
    render(
      <Theme>
        <MidiEffectCard project={project} entry={{ id: "note-filter", box, enabled: true }} onEnabledChange={() => {}} onChainChange={() => {}} page="effects" />
      </Theme>
    );
    const dimmed = () => [...document.querySelectorAll("[data-dimmed]")].map((el) => el.textContent ?? "");

    expect(dimmed()).toHaveLength(1);
    expect(dimmed()[0]).toContain("Key");

    fireEvent.click(screen.getByRole("switch", { name: "Set" }));

    expect(dimmed()).toHaveLength(1);
    expect(dimmed()[0]).toContain("Semitones");
  });
});
