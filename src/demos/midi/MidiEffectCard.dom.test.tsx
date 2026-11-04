// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteFilterDeviceBoxAdapter } from "@opendaw/studio-adapters";
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

    act(() => { editing.undo(); });

    expect(dimmed()).toHaveLength(1);
    expect(dimmed()[0]).toContain("Key");
  });

  it("a dimmed parameter is still operable: End on the Key slider writes the top key while Set is off", () => {
    const { box, editing, boxAdapters, adapter } = midiEffectFixture("note-filter");
    if (!(adapter instanceof NoteFilterDeviceBoxAdapter)) throw new Error("not a note filter fixture");
    const project = { editing, boxAdapters } as unknown as Project;
    render(
      <Theme>
        <MidiEffectCard project={project} entry={{ id: "note-filter", box, enabled: true }} onEnabledChange={() => {}} onChainChange={() => {}} page="effects" />
      </Theme>
    );
    const key = screen.getByRole("slider", { name: "Key" });
    expect(key.closest("[data-dimmed]")).not.toBeNull();

    fireEvent.keyDown(key, { key: "End" });

    expect(adapter.namedParameter.key.getValue()).toBe(127);
  });

  it("dims on the first render, before any subscription has fired", () => {
    const { box, editing, boxAdapters } = midiEffectFixture("note-filter");
    const project = { editing, boxAdapters } as unknown as Project;
    // Server markup runs no effect: what is dimmed here is dimmed on the first paint.
    const markup = renderToStaticMarkup(
      <Theme>
        <MidiEffectCard project={project} entry={{ id: "note-filter", box, enabled: true }} onEnabledChange={() => {}} onChainChange={() => {}} page="effects" />
      </Theme>
    );
    expect(markup.match(/data-dimmed=""/g)).toHaveLength(1);
    expect(/data-dimmed=""[^>]*>[^<]*(<[^>]*>[^<]*)*Key/.test(markup)).toBe(true);
  });
});
