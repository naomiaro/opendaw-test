import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Theme } from "@radix-ui/themes";
import { ParamSlider } from "./ParamSlider";
import { samplerFixture } from "@/lib/testing/boxGraphFixtures";

// Rendered to markup on the server: no DOM is needed, and no effect runs. That
// covers what the slider shows for a parameter's current value. Writes and
// live updates are covered by parameterBinding.test.ts.
function render(element: React.ReactElement): string {
  return renderToStaticMarkup(<Theme>{element}</Theme>);
}

const thumbAttribute = (markup: string, name: string): string | null => {
  const thumb = /<span[^>]*role="slider"[^>]*>/.exec(markup);
  if (thumb === null) return null;
  const match = new RegExp(`${name}="([^"]*)"`).exec(thumb[0]);
  return match === null ? null : match[1];
};

/**
 * Where the slider sits, as a share of its track. Rendered on the server the
 * thumb carries its range but not its value; the filled range does.
 */
const filledShare = (markup: string): number | null => {
  const range = /class="rt-SliderRange" style="left:0%;right:([0-9.]+)%"/.exec(markup);
  return range === null ? null : 1 - Number(range[1]) / 100;
};

describe("ParamSlider", () => {
  it("shows the label and the value as the parameter prints it", () => {
    const { adapter, project } = samplerFixture();

    const markup = render(<ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Tune" />);

    expect(markup).toContain("Tune");
    expect(markup).toContain("0 ct");
  });

  it("runs a continuous parameter over the unit range", () => {
    const { adapter, project } = samplerFixture();

    const markup = render(<ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Tune" />);

    expect(thumbAttribute(markup, "aria-valuemin")).toBe("0");
    expect(thumbAttribute(markup, "aria-valuemax")).toBe("1");
    expect(filledShare(markup)).toBeCloseTo(0.5, 6);
  });

  it.each([
    ["octave", 7, "6", 3 / 6],
    ["rootKey", 128, "127", 60 / 127],
  ] as const)("runs %s over whole-number positions", (name, positions, max, share) => {
    const { adapter, project } = samplerFixture();

    const markup = render(
      <ParamSlider project={project} parameter={adapter.namedParameter[name]} label={name} positions={positions} />
    );

    expect(thumbAttribute(markup, "aria-valuemin")).toBe("0");
    expect(thumbAttribute(markup, "aria-valuemax")).toBe(max);
    expect(filledShare(markup)).toBeCloseTo(share, 6);
  });

  it("shows a value that was written before it rendered", () => {
    const { adapter, box, project } = samplerFixture();
    project.editing.modify(() => box.octave.setValue(2));

    const markup = render(
      <ParamSlider project={project} parameter={adapter.namedParameter.octave} label="Octave" positions={7} />
    );

    expect(markup).toContain("2 oct");
    expect(filledShare(markup)).toBeCloseTo(5 / 6, 6);
  });
});
