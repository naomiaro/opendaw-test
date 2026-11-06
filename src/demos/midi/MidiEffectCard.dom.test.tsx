// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteFilterDeviceBoxAdapter, type ZeitgeistDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { Theme } from "@radix-ui/themes";
import type { Project } from "@opendaw/studio-core";
import { MidiEffectCard } from "./MidiEffectCard";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";
import { patternById } from "@/lib/midiEffects/patterns";
import { zeitgeistShuffleOf } from "@/lib/midiEffects/zeitgeistGuide";

describe("MidiEffectCard's Zeitgeist guide", () => {
  const setup = (patternId: "chords" | "sixteenths", enabled = true) => {
    const { box, editing, boxAdapters, adapter } = midiEffectFixture("zeitgeist");
    const shuffle = zeitgeistShuffleOf(adapter as ZeitgeistDeviceBoxAdapter)!;
    const project = { editing, boxAdapters } as unknown as Project;
    const onPatternChange = vi.fn();
    const onEnabledChange = vi.fn();
    const card = (compact = false) => (
      <Theme>
        <MidiEffectCard project={project} entry={{ id: "zeitgeist", box, enabled }} onEnabledChange={onEnabledChange} onChainChange={() => {}} page="effects"
          compact={compact} pattern={patternById(patternId)} onPatternChange={onPatternChange} />
      </Theme>
    );
    return { card, shuffle, onPatternChange, onEnabledChange };
  };

  it("says so when nothing moves on this pattern, and stops saying it once the Duration moves a note", () => {
    const { card, shuffle } = setup("chords");
    render(card());
    expect(screen.getByRole("status").textContent).toMatch(/nothing moves/i);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Duration" }), { key: "End" });
    expect(shuffle.namedParameter.duration.getValue()).toBe(61440);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a Try button writes its pattern and settings", () => {
    const { card, shuffle, onPatternChange } = setup("chords");
    render(card());
    fireEvent.click(screen.getByRole("button", { name: /Eighths/ }));
    expect(onPatternChange).toHaveBeenCalledWith("eighths");
    expect(shuffle.namedParameter.duration.getValue()).toBe(960);
    expect(shuffle.namedParameter.amount.getValue()).toBeCloseTo(0.75, 6);
  });

  it("a device switched off says so on a pattern that would otherwise move, and a Try switches it on", () => {
    const { card, onEnabledChange } = setup("sixteenths", false);
    render(card());
    expect(screen.getByRole("status").textContent).toMatch(/switched off/i);
    fireEvent.click(screen.getByRole("button", { name: /Eighths/ }));
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("a Try leaves a device that is on alone, and there is no sentence where notes move", () => {
    const { card, onEnabledChange } = setup("sixteenths");
    render(card());
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Eighths/ }));
    expect(onEnabledChange).not.toHaveBeenCalled();
  });

  it("a stack's compact card carries neither", () => {
    const { card } = setup("chords");
    render(card(true));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /Eighths/ })).toBeNull();
  });

  it("another device's card has no guide", () => {
    const { box, editing, boxAdapters } = midiEffectFixture("pitch");
    render(
      <Theme>
        <MidiEffectCard project={{ editing, boxAdapters } as unknown as Project} entry={{ id: "pitch", box, enabled: true }} onEnabledChange={() => {}} onChainChange={() => {}} page="effects"
          pattern={patternById("chords")} onPatternChange={() => {}} />
      </Theme>
    );
    expect(screen.queryByRole("button", { name: /Eighths/ })).toBeNull();
  });
});

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
