// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { velocityColor } from "@/lib/midiEffects/velocityColor";
import { NoteDataLink, PianoRollSteps } from "./PianoRollExplainer";

const num = (element: Element, name: string) => Number(element.getAttribute(name));

function step(heading: string) {
  const panel = screen.getByRole("heading", { name: heading }).closest("[data-step]") as HTMLElement;
  return {
    bars: [...panel.querySelectorAll("[data-note]")],
    stems: [...panel.querySelectorAll("[data-stem]")],
  };
}

describe("PianoRollSteps", () => {
  const HEADINGS = ["1. A note is a bar", "2. Height is pitch", "3. Width is length", "4. Brightness is velocity"];

  it("teaches the four ideas in order", () => {
    render(<PianoRollSteps />);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(HEADINGS);
  });

  it("draws a single bar in the first step", () => {
    render(<PianoRollSteps />);
    expect(step(HEADINGS[0]).bars).toHaveLength(1);
  });

  it("puts a higher note on a higher row in the pitch step", () => {
    render(<PianoRollSteps />);
    const tops = step(HEADINGS[1]).bars.map((bar) => num(bar, "y"));
    expect(tops.length).toBeGreaterThan(1);
    expect(tops).toEqual([...tops].sort((a, b) => b - a));
    expect(new Set(tops).size).toBe(tops.length);
  });

  it("keeps one key and only widens the bars in the length step", () => {
    render(<PianoRollSteps />);
    const { bars } = step(HEADINGS[2]);
    expect(new Set(bars.map((bar) => num(bar, "y"))).size).toBe(1);
    const widths = bars.map((bar) => num(bar, "width"));
    expect(new Set(widths).size).toBe(widths.length);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it("holds velocity back until the last step", () => {
    render(<PianoRollSteps />);
    for (const heading of HEADINGS.slice(0, 3)) {
      const { bars, stems } = step(heading);
      expect(stems).toHaveLength(0);
      expect(new Set(bars.map((bar) => bar.getAttribute("fill")))).toEqual(new Set([velocityColor(1)]));
    }
    const last = step(HEADINGS[3]);
    expect(last.stems).toHaveLength(last.bars.length);
    expect(new Set(last.bars.map((bar) => bar.getAttribute("fill"))).size).toBe(last.bars.length);
  });

  it("gives a harder note a brighter bar and a taller stem", () => {
    render(<PianoRollSteps />);
    const { bars, stems } = step(HEADINGS[3]);
    const height = (stem: Element) => num(stem, "y1") - num(stem, "y2");
    expect(bars[0].getAttribute("fill")).toBe(velocityColor(0.4));
    expect(bars[bars.length - 1].getAttribute("fill")).toBe(velocityColor(1));
    expect(height(stems[stems.length - 1])).toBeGreaterThan(height(stems[0]));
  });
});

describe("NoteDataLink", () => {
  function show() {
    const { container } = render(<NoteDataLink />);
    const rows = within(container).getAllByRole("button");
    const bars = [...container.querySelectorAll("[data-note]")];
    const lit = () => ({
      rows: rows.flatMap((row, index) => (row.getAttribute("aria-pressed") === "true" ? [index] : [])),
      bars: bars.flatMap((bar, index) => (bar.getAttribute("data-active") === "true" ? [index] : [])),
    });
    return { rows, bars, lit };
  }

  it("writes each note as the fields that draw its bar, from the demos' Melody pattern", () => {
    const { rows, bars } = show();
    expect(rows).toHaveLength(8);
    expect(bars).toHaveLength(8);
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toBe("{ position: 0, duration: 480, pitch: 60, velocity: 0.40 }");
    expect(rows[7].textContent?.replace(/\s+/g, " ")).toBe("{ position: 3360, duration: 480, pitch: 71, velocity: 1.00 }");
  });

  it("lights the bar of the row the pointer is on", () => {
    const { rows, lit } = show();
    fireEvent.mouseEnter(rows[6]);
    expect(lit()).toEqual({ rows: [6], bars: [6] });
  });

  it("lights the row of the bar the pointer is on", () => {
    const { bars, lit } = show();
    fireEvent.mouseEnter(bars[1]);
    expect(lit()).toEqual({ rows: [1], bars: [1] });
  });

  it("lights a pair when a bar is tapped", () => {
    const { bars, lit } = show();
    fireEvent.click(bars[5]);
    expect(lit()).toEqual({ rows: [5], bars: [5] });
  });

  it("lights a pair when a row takes keyboard focus", () => {
    const { rows, lit } = show();
    fireEvent.focus(rows[2]);
    expect(lit()).toEqual({ rows: [2], bars: [2] });
  });
});
