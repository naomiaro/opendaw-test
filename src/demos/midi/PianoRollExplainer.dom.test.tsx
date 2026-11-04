// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { patternById } from "@/lib/midiEffects/patterns";
import { velocityColor } from "@/lib/midiEffects/velocityColor";
import { EffectChainDiagram, NoteDataLink, PianoRollSteps } from "./PianoRollExplainer";

const num = (element: Element, name: string) => Number(element.getAttribute(name));
/** A bar is drawn one unit inside its cell on every side, so it shows the grid around it. */
const BAR_INSET = 2;

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

  it("rises one bar height per key in the pitch step", () => {
    render(<PianoRollSteps />);
    const { bars } = step(HEADINGS[1]);
    const row = num(bars[0], "height") + BAR_INSET;
    const rises = bars.slice(1).map((bar, index) => (num(bars[index], "y") - num(bar, "y")) / row);
    expect(rises).toEqual([4, 3, 2]); // keys 60, 64, 67, 69
  });

  it("spaces the pitch step's quarter notes evenly along time", () => {
    render(<PianoRollSteps />);
    const starts = step(HEADINGS[1]).bars.map((bar) => num(bar, "x"));
    expect(new Set(starts.slice(1).map((x, index) => x - starts[index])).size).toBe(1);
    expect(starts[1]).toBeGreaterThan(starts[0]);
  });

  it("keeps one key and scales width with length in the length step", () => {
    render(<PianoRollSteps />);
    const { bars } = step(HEADINGS[2]);
    expect(new Set(bars.map((bar) => num(bar, "y"))).size).toBe(1);
    const spans = bars.map((bar) => num(bar, "width") + BAR_INSET);
    expect([spans[1] / spans[0], spans[2] / spans[0]]).toEqual([2, 4]); // an eighth, a quarter, a half
    bars.slice(1).forEach((bar, index) => expect(num(bars[index], "x") + spans[index]).toBe(num(bar, "x"))); // they abut
  });

  it("draws the piano's black and white keys in pitch order", () => {
    const { container } = render(<PianoRollSteps />);
    const keys = [...container.querySelector("svg")!.querySelectorAll('rect[x="0"]')];
    const black = keys.map((key) => key.getAttribute("fill") === "var(--mc-line-bright)");
    expect(black).toEqual([false, true, false, true, false, true, false, false, true, false, true, false]); // 71 down to 60
  });

  it("keeps every bar inside its roll", () => {
    const { container } = render(<PianoRollSteps />);
    for (const svg of container.querySelectorAll("svg")) {
      const [, , width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      for (const bar of svg.querySelectorAll("[data-note]")) {
        expect(num(bar, "x")).toBeGreaterThanOrEqual(0);
        expect(num(bar, "y")).toBeGreaterThanOrEqual(0);
        expect(num(bar, "x") + num(bar, "width")).toBeLessThanOrEqual(width);
        expect(num(bar, "y") + num(bar, "height")).toBeLessThanOrEqual(height);
      }
    }
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
    expect(height(stems[stems.length - 1]) / height(stems[0])).toBeCloseTo(1 / 0.4, 5); // the value itself, not its square
  });

  it("stands each stem under its own bar", () => {
    render(<PianoRollSteps />);
    const { bars, stems } = step(HEADINGS[3]);
    expect(new Set(stems.map((stem, index) => num(stem, "x1") - num(bars[index], "x"))).size).toBe(1);
  });
});

describe("EffectChainDiagram", () => {
  function stages() {
    render(<EffectChainDiagram />);
    const stage = (name: string) => {
      const panel = screen.getByRole("heading", { name }).closest("[data-stage]") as HTMLElement;
      return {
        bars: [...panel.querySelectorAll("[data-note]")],
        stems: [...panel.querySelectorAll("[data-stem]")],
        sound: panel.querySelector("[data-sound]"),
      };
    };
    return { notes: stage("Notes"), pitch: stage("Pitch"), velocity: stage("Velocity"), instrument: stage("Instrument") };
  }
  const stemHeight = (stem: Element) => num(stem, "y1") - num(stem, "y2");

  it("runs from the notes through the effects to the instrument", () => {
    render(<EffectChainDiagram />);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Notes", "Pitch", "Velocity", "Instrument"]);
  });

  it("shows Pitch moving every note up by the same amount and changing nothing else", () => {
    const { notes, pitch } = stages();
    expect(pitch.bars).toHaveLength(notes.bars.length);
    const rises = notes.bars.map((bar, index) => num(bar, "y") - num(pitch.bars[index], "y"));
    expect(rises[0]).toBeGreaterThan(0);
    expect(new Set(rises).size).toBe(1);
    expect(pitch.bars.map((bar) => bar.getAttribute("fill"))).toEqual(notes.bars.map((bar) => bar.getAttribute("fill")));
    expect(pitch.bars.map((bar) => num(bar, "x"))).toEqual(notes.bars.map((bar) => num(bar, "x")));
  });

  it("hands Velocity what Pitch gave it, and only makes the notes softer", () => {
    const { pitch, velocity } = stages();
    expect(velocity.bars.map((bar) => num(bar, "y"))).toEqual(pitch.bars.map((bar) => num(bar, "y")));
    velocity.bars.forEach((bar, index) => expect(bar.getAttribute("fill")).not.toBe(pitch.bars[index].getAttribute("fill")));
    velocity.stems.forEach((stem, index) => expect(stemHeight(stem)).toBeLessThan(stemHeight(pitch.stems[index])));
  });

  it("ends in sound, not in another roll", () => {
    const { instrument, velocity } = stages();
    expect(instrument.bars).toHaveLength(0);
    expect(instrument.sound).not.toBeNull();
    expect(velocity.sound).toBeNull();
  });
});

describe("NoteDataLink", () => {
  function show() {
    const { container } = render(<NoteDataLink />);
    const rows = within(container).getAllByRole("button");
    const bars = [...container.querySelectorAll("[data-note]")];
    const lit = () => ({
      rows: rows.flatMap((row, index) => (row.getAttribute("aria-pressed") === "true" ? [index] : [])),
      bars: bars.flatMap((bar, index) => (bar.getAttribute("stroke") !== null ? [index] : [])),
    });
    return { container, rows, bars, lit };
  }

  it("writes each note as the fields that draw its bar, from the demos' Melody pattern", () => {
    const { rows, bars } = show();
    expect(rows).toHaveLength(8);
    expect(bars).toHaveLength(8);
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toBe("{ position: 0, duration: 480, pitch: 60, velocity: 0.40 }");
    expect(rows[7].textContent?.replace(/\s+/g, " ")).toBe("{ position: 3360, duration: 480, pitch: 71, velocity: 1.00 }");
  });

  it("draws every bar where its line of data says", () => {
    const { rows, bars } = show();
    const field = (row: HTMLElement, name: string) => Number(new RegExp(`${name}:\\s*([\\d.]+)`).exec(row.textContent ?? "")![1]);
    const row0 = rows[0];
    const span = num(bars[0], "width") + BAR_INSET; // one duration's width
    const rowHeight = num(bars[0], "height") + BAR_INSET;
    rows.forEach((row, index) => {
      const bar = bars[index];
      expect(num(bar, "x") - num(bars[0], "x")).toBeCloseTo((field(row, "position") / field(row0, "duration")) * span, 5);
      expect(num(bar, "width") + BAR_INSET).toBeCloseTo((field(row, "duration") / field(row0, "duration")) * span, 5);
      expect(num(bars[0], "y") - num(bar, "y")).toBe((field(row, "pitch") - field(row0, "pitch")) * rowHeight);
      expect(bar.getAttribute("fill")).toBe(velocityColor(patternById("melody").notes[index].velocity));
    });
  });

  it("names the rail's rows at the height of those rows", () => {
    const { container, rows, bars } = show();
    const [, , , viewHeight] = container.querySelector(".prx-roll svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    const labels = [...container.querySelectorAll<HTMLElement>(".prx-rail span")];
    expect(labels.map((label) => label.textContent)).toEqual(["71", "67", "64", "60"]);
    for (const label of labels) {
      const index = rows.findIndex((row) => new RegExp(`pitch:\\s*${label.textContent},`).test(row.textContent ?? ""));
      const barMiddle = num(bars[index], "y") + num(bars[index], "height") / 2;
      expect((parseFloat(label.style.top) / 100) * viewHeight).toBeCloseTo(barMiddle, 5);
    }
  });

  it("opens with one pair already lit, so the link shows before anyone touches it", () => {
    const { lit } = show();
    expect(lit()).toEqual({ rows: [3], bars: [3] });
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
