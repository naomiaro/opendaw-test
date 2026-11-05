// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { patternById } from "@/lib/midiEffects/patterns";
import { velocityColor } from "@/lib/midiEffects/velocityColor";
import { EffectChainDiagram, NoteDataLink, PaperRollComparison, PianoRollSteps } from "./PianoRollExplainer";

const num = (element: Element, name: string) => Number(element.getAttribute(name));
/** A block is drawn one unit inside its cell on every side, so it shows the grid around it. */
const BLOCK_INSET = 2;

function step(heading: string) {
  const panel = screen.getByRole("heading", { name: heading }).closest("[data-step]") as HTMLElement;
  return {
    blocks: [...panel.querySelectorAll("[data-note]")],
    stems: [...panel.querySelectorAll("[data-stem]")],
  };
}

describe("PianoRollSteps", () => {
  const HEADINGS = ["1. A note is a block", "2. Height is pitch", "3. Width is length", "4. Brightness is velocity"];

  it("teaches the four ideas in order", () => {
    render(<PianoRollSteps />);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(HEADINGS);
  });

  it("draws a single block in the first step", () => {
    render(<PianoRollSteps />);
    expect(step(HEADINGS[0]).blocks).toHaveLength(1);
  });

  it("rises one block height per key in the pitch step", () => {
    render(<PianoRollSteps />);
    const { blocks } = step(HEADINGS[1]);
    const row = num(blocks[0], "height") + BLOCK_INSET;
    const rises = blocks.slice(1).map((block, index) => (num(blocks[index], "y") - num(block, "y")) / row);
    expect(rises).toEqual([4, 3, 2]); // keys 60, 64, 67, 69
  });

  it("spaces the pitch step's quarter notes evenly along time", () => {
    render(<PianoRollSteps />);
    const starts = step(HEADINGS[1]).blocks.map((block) => num(block, "x"));
    expect(new Set(starts.slice(1).map((x, index) => x - starts[index])).size).toBe(1);
    expect(starts[1]).toBeGreaterThan(starts[0]);
  });

  it("keeps one key and scales width with length in the length step", () => {
    render(<PianoRollSteps />);
    const { blocks } = step(HEADINGS[2]);
    expect(new Set(blocks.map((block) => num(block, "y"))).size).toBe(1);
    const spans = blocks.map((block) => num(block, "width") + BLOCK_INSET);
    expect([spans[1] / spans[0], spans[2] / spans[0]]).toEqual([2, 4]); // an eighth, a quarter, a half
    blocks.slice(1).forEach((block, index) => expect(num(blocks[index], "x") + spans[index]).toBe(num(block, "x"))); // they abut
  });

  describe("the piano", () => {
    function piano() {
      const { container } = render(<PianoRollSteps />);
      const svg = container.querySelector("svg")!;
      return {
        white: svg.querySelector("[data-white-keys]")!,
        black: [...svg.querySelectorAll("[data-black-key]")],
        edges: [...svg.querySelectorAll("[data-key-edge]")],
      };
    }

    it("has a black key for each of the five black notes, and no others", () => {
      const { black } = piano();
      expect(black.map((key) => key.getAttribute("data-black-key"))).toEqual(["70", "68", "66", "63", "61"]);
    });

    it("makes black keys shorter than white keys", () => {
      const { white, black } = piano();
      for (const key of black) {
        expect(num(key, "x")).toBe(num(white, "x"));
        expect(num(key, "width")).toBeLessThan(num(white, "width") * 0.7);
        expect(num(key, "width")).toBeGreaterThan(num(white, "width") * 0.4);
      }
    });

    it("divides the white keys into the seven of an octave, E-F and B-C sharing no black key", () => {
      const { white, black, edges } = piano();
      expect(edges).toHaveLength(6); // 7 white keys from C (60) up to B (71)
      const rowHeight = num(black[0], "height");
      const rows = edges.map((edge) => (num(white, "y") + num(white, "height") - num(edge, "y1")) / rowHeight);
      // Rows from the bottom: under a black key's middle where one sits between, on the row line for E-F.
      expect(rows.sort((a, b) => a - b)).toEqual([1.5, 3.5, 5, 6.5, 8.5, 10.5]);
    });
  });

  it("lines each black key up with its own row in the grid", () => {
    render(<PianoRollSteps />);
    const firstRoll = screen.getByRole("heading", { name: HEADINGS[1] }).closest("[data-step]")!;
    const bottomBar = firstRoll.querySelector("[data-note]")!; // key 60
    const rowHeight = num(bottomBar, "height") + BLOCK_INSET;
    const rowOf60 = num(bottomBar, "y") - BLOCK_INSET / 2;
    const keys = [...firstRoll.querySelectorAll("[data-black-key]")];
    expect(keys).toHaveLength(5);
    for (const key of keys) {
      const pitch = Number(key.getAttribute("data-black-key"));
      expect(num(key, "y")).toBe(rowOf60 - (pitch - 60) * rowHeight);
      expect(num(key, "height")).toBe(rowHeight);
    }
  });

  it("keeps every block inside its roll", () => {
    const { container } = render(<PianoRollSteps />);
    for (const svg of container.querySelectorAll("svg")) {
      const [, , width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      for (const block of svg.querySelectorAll("[data-note]")) {
        expect(num(block, "x")).toBeGreaterThanOrEqual(0);
        expect(num(block, "y")).toBeGreaterThanOrEqual(0);
        expect(num(block, "x") + num(block, "width")).toBeLessThanOrEqual(width);
        expect(num(block, "y") + num(block, "height")).toBeLessThanOrEqual(height);
      }
    }
  });

  it("holds velocity back until the last step", () => {
    render(<PianoRollSteps />);
    for (const heading of HEADINGS.slice(0, 3)) {
      const { blocks, stems } = step(heading);
      expect(stems).toHaveLength(0);
      expect(new Set(blocks.map((block) => block.getAttribute("fill")))).toEqual(new Set([velocityColor(1)]));
    }
    const last = step(HEADINGS[3]);
    expect(last.stems).toHaveLength(last.blocks.length);
    expect(new Set(last.blocks.map((block) => block.getAttribute("fill"))).size).toBe(last.blocks.length);
  });

  it("describes each drawing to a screen reader, rather than repeating its heading", () => {
    render(<PianoRollSteps />);
    const labels = screen.getAllByRole("img").map((image) => image.getAttribute("aria-label"));
    expect(labels).toHaveLength(4);
    labels.forEach((label) => expect(HEADINGS).not.toContain(label));
    expect(new Set(labels).size).toBe(4);
  });

  it("gives a harder note a brighter block and a taller stem", () => {
    render(<PianoRollSteps />);
    const { blocks, stems } = step(HEADINGS[3]);
    const height = (stem: Element) => num(stem, "y1") - num(stem, "y2");
    expect(blocks[0].getAttribute("fill")).toBe(velocityColor(0.4));
    expect(blocks[blocks.length - 1].getAttribute("fill")).toBe(velocityColor(1));
    expect(height(stems[stems.length - 1]) / height(stems[0])).toBeCloseTo(1 / 0.4, 5); // the value itself, not its square
  });

  it("stands each stem under its own block", () => {
    render(<PianoRollSteps />);
    const { blocks, stems } = step(HEADINGS[3]);
    expect(new Set(stems.map((stem, index) => num(stem, "x1") - num(blocks[index], "x"))).size).toBe(1);
  });
});

describe("EffectChainDiagram", () => {
  function stages() {
    render(<EffectChainDiagram />);
    const stage = (name: string) => {
      const panel = screen.getByRole("heading", { name }).closest("[data-stage]") as HTMLElement;
      return {
        blocks: [...panel.querySelectorAll("[data-note]")],
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
    expect(pitch.blocks).toHaveLength(notes.blocks.length);
    const rises = notes.blocks.map((block, index) => num(block, "y") - num(pitch.blocks[index], "y"));
    expect(rises[0]).toBeGreaterThan(0);
    expect(new Set(rises).size).toBe(1);
    expect(pitch.blocks.map((block) => block.getAttribute("fill"))).toEqual(notes.blocks.map((block) => block.getAttribute("fill")));
    expect(pitch.blocks.map((block) => num(block, "x"))).toEqual(notes.blocks.map((block) => num(block, "x")));
  });

  it("hands Velocity what Pitch gave it, and only makes the notes softer", () => {
    const { pitch, velocity } = stages();
    expect(velocity.blocks.map((block) => num(block, "y"))).toEqual(pitch.blocks.map((block) => num(block, "y")));
    velocity.blocks.forEach((block, index) => expect(block.getAttribute("fill")).not.toBe(pitch.blocks[index].getAttribute("fill")));
    velocity.stems.forEach((stem, index) => expect(stemHeight(stem)).toBeLessThan(stemHeight(pitch.stems[index])));
  });

  it("ends in sound, not in another roll", () => {
    const { instrument, velocity } = stages();
    expect(instrument.blocks).toHaveLength(0);
    expect(instrument.sound).not.toBeNull();
    expect(velocity.sound).toBeNull();
  });
});

describe("PaperRollComparison", () => {
  function show() {
    const { container } = render(<PaperRollComparison />);
    return { holes: [...container.querySelectorAll("[data-hole]")], blocks: [...container.querySelectorAll("[data-note]")] };
  }

  it("shows the paper first, then the grid it became", () => {
    render(<PaperRollComparison />);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["The paper", "The grid"]);
  });

  it("punches one hole for each block, exactly where that block sits", () => {
    const { holes, blocks } = show();
    expect(holes.length).toBeGreaterThan(1);
    expect(holes).toHaveLength(blocks.length);
    for (const name of ["x", "y", "width", "height"]) {
      expect(holes.map((hole) => num(hole, name))).toEqual(blocks.map((block) => num(block, name)));
    }
  });

  it("uses notes of different lengths and a chord, so the holes show both", () => {
    const { holes } = show();
    expect(new Set(holes.map((hole) => num(hole, "width"))).size).toBeGreaterThan(1);
    const starts = holes.map((hole) => num(hole, "x"));
    expect(new Set(starts).size).toBeLessThan(starts.length);
  });

  it("draws no velocity on the paper: a hole only knows which key and for how long", () => {
    const { container } = render(<PaperRollComparison />);
    expect(container.querySelectorAll("[data-stem]")).toHaveLength(0);
    const fills = new Set(show().holes.map((hole) => hole.getAttribute("fill")));
    expect(fills.size).toBe(1);
  });
});

describe("NoteDataLink", () => {
  function show() {
    const { container } = render(<NoteDataLink />);
    const rows = within(container).getAllByRole("button");
    const blocks = [...container.querySelectorAll("[data-note]")];
    const lit = () => ({
      rows: rows.flatMap((row, index) => (row.getAttribute("aria-current") === "true" ? [index] : [])),
      blocks: blocks.flatMap((block, index) => (block.getAttribute("stroke") !== null ? [index] : [])),
    });
    return { container, rows, blocks, lit };
  }

  it("writes each note as the fields that draw its block, from the demos' Melody pattern", () => {
    const { rows, blocks } = show();
    expect(rows).toHaveLength(8);
    expect(blocks).toHaveLength(8);
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toBe("{ position: 0, duration: 480, pitch: 60, velocity: 0.40 }");
    expect(rows[7].textContent?.replace(/\s+/g, " ")).toBe("{ position: 3360, duration: 480, pitch: 71, velocity: 1.00 }");
  });

  it("draws every block where its line of data says", () => {
    const { rows, blocks } = show();
    const field = (row: HTMLElement, name: string) => Number(new RegExp(`${name}:\\s*([\\d.]+)`).exec(row.textContent ?? "")![1]);
    const row0 = rows[0];
    const span = num(blocks[0], "width") + BLOCK_INSET; // one duration's width
    const rowHeight = num(blocks[0], "height") + BLOCK_INSET;
    rows.forEach((row, index) => {
      const block = blocks[index];
      expect(num(block, "x") - num(blocks[0], "x")).toBeCloseTo((field(row, "position") / field(row0, "duration")) * span, 5);
      expect(num(block, "width") + BLOCK_INSET).toBeCloseTo((field(row, "duration") / field(row0, "duration")) * span, 5);
      expect(num(blocks[0], "y") - num(block, "y")).toBe((field(row, "pitch") - field(row0, "pitch")) * rowHeight);
      expect(block.getAttribute("fill")).toBe(velocityColor(patternById("melody").notes[index].velocity));
    });
  });

  it("counts musical bars and beats along the top of the roll", () => {
    const { container } = show();
    const labels = [...container.querySelectorAll<HTMLElement>(".prx-ruler span")];
    expect(labels.map((label) => label.textContent)).toEqual(["1", "1.2", "1.3", "1.4"]);
  });

  it("puts each beat's number over the note that starts on that beat", () => {
    const { container, rows, blocks } = show();
    const [, , viewWidth] = container.querySelector(".prx-roll svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    const labels = [...container.querySelectorAll<HTMLElement>(".prx-ruler span")];
    expect(labels).toHaveLength(4);
    labels.forEach((label, beat) => {
      const index = rows.findIndex((row) => new RegExp(`position:\\s*${beat * 960},`).test(row.textContent ?? ""));
      const blockLeft = num(blocks[index], "x") - BLOCK_INSET / 2;
      expect((parseFloat(label.style.left) / 100) * viewWidth).toBeCloseTo(blockLeft, 5);
    });
  });

  it("names the rail's rows at the height of those rows", () => {
    const { container, rows, blocks } = show();
    const [, , , viewHeight] = container.querySelector(".prx-roll svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    const labels = [...container.querySelectorAll<HTMLElement>(".prx-rail span")];
    expect(labels.map((label) => label.textContent)).toEqual(["71", "67", "64", "60"]);
    for (const label of labels) {
      const index = rows.findIndex((row) => new RegExp(`pitch:\\s*${label.textContent},`).test(row.textContent ?? ""));
      const blockMiddle = num(blocks[index], "y") + num(blocks[index], "height") / 2;
      expect((parseFloat(label.style.top) / 100) * viewHeight).toBeCloseTo(blockMiddle, 5);
    }
  });

  it("opens with one pair already lit, so the link shows before anyone touches it", () => {
    const { lit } = show();
    expect(lit()).toEqual({ rows: [3], blocks: [3] });
  });

  it("lights the block of the row the pointer is on", () => {
    const { rows, lit } = show();
    fireEvent.mouseEnter(rows[6]);
    expect(lit()).toEqual({ rows: [6], blocks: [6] });
  });

  it("lights the row of the block the pointer is on", () => {
    const { blocks, lit } = show();
    fireEvent.mouseEnter(blocks[1]);
    expect(lit()).toEqual({ rows: [1], blocks: [1] });
  });

  it("lights a pair when a block is tapped", () => {
    const { blocks, lit } = show();
    fireEvent.click(blocks[5]);
    expect(lit()).toEqual({ rows: [5], blocks: [5] });
  });

  it("lights a pair when a row is tapped or pressed", () => {
    const { rows, lit } = show();
    fireEvent.click(rows[4]);
    expect(lit()).toEqual({ rows: [4], blocks: [4] });
  });

  it("never announces a row as a toggle: it marks the current note", () => {
    const { rows } = show();
    rows.forEach((row) => expect(row.hasAttribute("aria-pressed")).toBe(false));
  });

  it("lights a pair when a row takes keyboard focus", () => {
    const { rows, lit } = show();
    fireEvent.focus(rows[2]);
    expect(lit()).toEqual({ rows: [2], blocks: [2] });
  });
});
