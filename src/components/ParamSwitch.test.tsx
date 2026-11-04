import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Theme } from "@radix-ui/themes";
import { NoteFilterDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { ParamSwitch } from "./ParamSwitch";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";

// Rendered to markup on the server, as ParamSlider.test.tsx does: what the
// switch shows for the parameter's current value. Clicks and undo are in
// ParamSwitch.dom.test.tsx.
function render(element: React.ReactElement): string {
  return renderToStaticMarkup(<Theme>{element}</Theme>);
}

function setParameter() {
  const { adapter, editing } = midiEffectFixture("note-filter");
  if (!(adapter instanceof NoteFilterDeviceBoxAdapter)) throw new Error("not a note filter fixture");
  return { set: adapter.namedParameter.set, editing };
}

describe("ParamSwitch", () => {
  it("shows the label, prints Off and renders an unchecked switch named by its label", () => {
    const { set, editing } = setParameter();

    const markup = render(<ParamSwitch project={{ editing }} parameter={set} label="Set" />);

    expect(markup).toContain("Set");
    expect(markup).toContain("Off");
    expect(markup).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(markup).toContain('aria-label="Set"');
  });
});
