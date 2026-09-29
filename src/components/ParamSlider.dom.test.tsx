// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import React from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Slider, Theme } from "@radix-ui/themes";
import { ParamSlider, useSliderThumbLabel } from "./ParamSlider";
import { samplerFixture } from "@/lib/testing/boxGraphFixtures";

const show = (element: React.ReactElement) => render(<Theme>{element}</Theme>);

describe("ParamSlider in the DOM", () => {
  it("names its thumb, the element a screen reader announces", () => {
    const { adapter, project } = samplerFixture();

    show(<ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Tune" />);

    expect(screen.getByRole("slider", { name: "Tune" })).toBeDefined();
  });

  it("renames its thumb when the label changes", () => {
    const { adapter, project } = samplerFixture();
    const { rerender } = show(<ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Tune" />);

    rerender(<Theme><ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Fine tune" /></Theme>);

    expect(screen.getByRole("slider", { name: "Fine tune" })).toBeDefined();
    expect(screen.queryByRole("slider", { name: "Tune" })).toBeNull();
  });

  it("goes to the ends of a continuous parameter with End and Home", async () => {
    const user = userEvent.setup();
    const { adapter, box, project } = samplerFixture();
    show(<ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Tune" />);
    screen.getByRole("slider", { name: "Tune" }).focus();

    await user.keyboard("{End}");
    expect(box.tune.getValue()).toBeCloseTo(1200, 3);
    expect(screen.getByText("1200 ct")).toBeDefined();

    await user.keyboard("{Home}");
    expect(box.tune.getValue()).toBeCloseTo(-1200, 3);
  });

  // A slider with a fractional step gets stuck here: the value the parameter
  // reads back misses the slider's step grid by a hair and the key goes nowhere.
  it("steps an integer parameter down through every value with the left arrow", async () => {
    const user = userEvent.setup();
    const { adapter, box, project } = samplerFixture();
    show(<ParamSlider project={project} parameter={adapter.namedParameter.octave} label="Octave" positions={7} />);
    screen.getByRole("slider", { name: "Octave" }).focus();
    await user.keyboard("{End}");
    expect(box.octave.getValue()).toBe(3);

    const seen: number[] = [];
    for (let press = 0; press < 6; press++) {
      await user.keyboard("{ArrowLeft}");
      seen.push(box.octave.getValue());
    }

    expect(seen).toEqual([2, 1, 0, -1, -2, -3]);
  });

  it("steps an integer parameter up through every value with the right arrow", async () => {
    const user = userEvent.setup();
    const { adapter, box, project } = samplerFixture();
    show(<ParamSlider project={project} parameter={adapter.namedParameter.octave} label="Octave" positions={7} />);
    screen.getByRole("slider", { name: "Octave" }).focus();
    await user.keyboard("{Home}");

    const seen: number[] = [];
    for (let press = 0; press < 6; press++) {
      await user.keyboard("{ArrowRight}");
      seen.push(box.octave.getValue());
    }

    expect(seen).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it("steps the root key one note at a time in both directions, from its default", async () => {
    const user = userEvent.setup();
    const { adapter, box, project } = samplerFixture();
    show(<ParamSlider project={project} parameter={adapter.namedParameter.rootKey} label="Root key" positions={128} />);
    screen.getByRole("slider", { name: "Root key" }).focus();

    const seen: number[] = [];
    for (const key of ["{ArrowRight}", "{ArrowRight}", "{ArrowRight}", "{ArrowLeft}", "{ArrowLeft}", "{ArrowLeft}", "{ArrowLeft}"]) {
      await user.keyboard(key);
      seen.push(box.rootKey.getValue());
    }

    expect(seen).toEqual([61, 62, 63, 62, 61, 60, 59]);
  });

  it("shows a change made elsewhere", async () => {
    const { adapter, box, project } = samplerFixture();
    show(<ParamSlider project={project} parameter={adapter.namedParameter.octave} label="Octave" positions={7} />);

    act(() => project.editing.modify(() => box.octave.setValue(-2)));

    expect(screen.getByText("-2 oct")).toBeDefined();
    expect(screen.getByRole("slider", { name: "Octave" }).getAttribute("aria-valuenow")).toBe("1");
  });

  it("shows a change made elsewhere on a continuous parameter", () => {
    const { adapter, box, project } = samplerFixture();
    show(<ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Tune" />);

    act(() => project.editing.modify(() => box.tune.setValue(600)));

    expect(screen.getByText("600 ct")).toBeDefined();
    expect(Number(screen.getByRole("slider", { name: "Tune" }).getAttribute("aria-valuenow"))).toBeCloseTo(0.75, 6);
  });

  it("moves a continuous parameter by its step with an arrow key", async () => {
    const user = userEvent.setup();
    const { adapter, box, project } = samplerFixture();
    show(
      <>
        <ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Tune" />
        <ParamSlider project={project} parameter={adapter.namedParameter.sampleStart} label="Start" step={0.001} />
      </>
    );

    screen.getByRole("slider", { name: "Tune" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(box.tune.getValue()).toBeCloseTo(24, 3);

    screen.getByRole("slider", { name: "Start" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(box.sampleStart.getValue()).toBeCloseTo(0.003, 6);
  });

  // The slider's own number is a position or a share of the range. What a
  // person needs to hear is the value, as it is printed beside the slider.
  it("tells a screen reader the value as it is printed, not the slider's position", () => {
    const { adapter, box, project } = samplerFixture();
    show(
      <>
        <ParamSlider project={project} parameter={adapter.namedParameter.octave} label="Octave" positions={7} />
        <ParamSlider project={project} parameter={adapter.namedParameter.tune} label="Tune" />
      </>
    );
    expect(screen.getByRole("slider", { name: "Octave" }).getAttribute("aria-valuetext")).toBe("0 oct");

    act(() => project.editing.modify(() => {
      box.octave.setValue(-2);
      box.tune.setValue(600);
    }));

    expect(screen.getByRole("slider", { name: "Octave" }).getAttribute("aria-valuetext")).toBe("-2 oct");
    expect(screen.getByRole("slider", { name: "Tune" }).getAttribute("aria-valuetext")).toBe("600 ct");
  });
});

describe("useSliderThumbLabel", () => {
  const Late: React.FC<{ shown: boolean }> = ({ shown }) => {
    const ref = useSliderThumbLabel("LFO depth");
    return <Theme>{shown && <Slider ref={ref} min={-1} max={1} step={0.01} value={[0.3]} />}</Theme>;
  };

  it("names a slider that appears after the component that asked for the name", () => {
    const { rerender } = render(<Late shown={false} />);
    expect(screen.queryByRole("slider")).toBeNull();

    rerender(<Late shown={true} />);

    expect(screen.getByRole("slider", { name: "LFO depth" })).toBeDefined();
  });
});
