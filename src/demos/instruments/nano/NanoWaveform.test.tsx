// @vitest-environment jsdom
import { driveFrames, installFakeContext2d, layOut, resize } from "@/lib/testing/domSetup";
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Option } from "@opendaw/lib-std";
import { Theme } from "@radix-ui/themes";
import type { NanoDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { samplerFixture, type SamplerFixture } from "@/lib/testing/boxGraphFixtures";
import { applyParams } from "./nanoContent";
import { NANO_PRESETS, type NanoParams } from "./nanoPresets";
import { NanoWaveform, type NanoWaveformProps } from "./NanoWaveform";

// One second at 48 kHz, so that one frame is a realistic share of the sample.
const FRAMES = 48001;
const WIDTH = 1000;

/** The engine's position broadcast, driven by the test */
class FakeStream {
  #listener: ((positions: Float32Array) => void) | null = null;
  subscriptions = 0;

  subscribeFloats(_address: unknown, listener: (positions: Float32Array) => void): { terminate: () => void } {
    this.subscriptions++;
    this.#listener = listener;
    return { terminate: () => { this.#listener = null; } };
  }

  send(...positions: number[]): void {
    this.#listener?.(Float32Array.from(positions));
  }

  get listening(): boolean {
    return this.#listener !== null;
  }
}

/** Stand in for a loaded sample: the fixture's sampler has none attached */
function withSample(adapter: NanoDeviceBoxAdapter, numberOfFrames: number): void {
  const file = { data: Option.wrap({ numberOfFrames }), peaks: Option.None };
  adapter.file = (() => Option.wrap(file)) as unknown as NanoDeviceBoxAdapter["file"];
}

interface Mounted extends SamplerFixture {
  readonly stream: FakeStream;
  readonly wave: HTMLElement;
  readonly container: HTMLElement;
  readonly marker: (name: string) => HTMLElement;
  readonly setLfo: (on: boolean) => void;
  readonly unmount: () => void;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(params: Partial<NanoParams> = {}, options: { sample?: boolean; lfo?: boolean } = {}): Mounted {
  const fixture = samplerFixture();
  if (options.sample !== false) withSample(fixture.adapter, FRAMES);
  fixture.project.editing.modify(() =>
    applyParams(fixture.adapter, { ...NANO_PRESETS.pad.params, ...params })
  );
  const stream = new FakeStream();
  const project = { editing: fixture.project.editing, liveStreamReceiver: stream } as unknown as NanoWaveformProps["project"];
  const ui = (lfo: boolean) => (
    <Theme>
      <NanoWaveform
        project={project} adapter={fixture.adapter} sampleSeconds={2} peaksVersion={0}
        ghostParameter={lfo ? fixture.adapter.namedParameter.sampleStart : null}
      />
    </Theme>
  );
  const { container, unmount, rerender } = render(ui(options.lfo === true));
  const wave = container.querySelector(".nn-wave") as HTMLElement;
  layOut(wave, { left: 100, top: 0, width: WIDTH, height: 180 });
  return {
    ...fixture, stream, wave, container, unmount,
    setLfo: on => rerender(ui(on)),
    marker: name => screen.getByRole("slider", { name }),
  };
}

/** Where a marker is drawn, in percent. Parameters hold 32-bit floats, so compare with a tolerance. */
const at = (handle: HTMLElement): number => parseFloat(handle.style.left);

const drag = (handle: HTMLElement, from: number, ...to: number[]): void => {
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 + from });
  for (const x of to) fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 + x });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 + to[to.length - 1] });
};

describe("NanoWaveform markers", () => {
  it("shows the four markers where the parameters are", () => {
    const { marker } = mount();

    expect(at(marker("Region start marker"))).toBe(0);
    expect(at(marker("Region end marker"))).toBe(100);
    expect(at(marker("Loop start marker"))).toBeCloseTo(35, 4);
    expect(at(marker("Loop end marker"))).toBeCloseTo(85, 4);
  });

  it("shows no loop markers while the loop is off", () => {
    mount({ loop: false });

    expect(screen.queryByRole("slider", { name: "Loop start marker" })).toBeNull();
    expect(screen.getAllByRole("slider").length).toBe(2);
  });

  it("draws a loop marker at the edge of the region when it is stored outside it", () => {
    const { marker, box } = mount({ sampleStart: 0.5, loopStart: 0.25 });

    expect(at(marker("Loop start marker"))).toBeCloseTo(50, 4);
    expect(box.loopStart.getValue()).toBeCloseTo(0.25, 6);
  });

  it("follows a change made elsewhere", () => {
    const { marker, box, project } = mount();

    act(() => project.editing.modify(() => box.sampleEnd.setValue(0.6)));

    expect(at(marker("Region end marker"))).toBeCloseTo(60, 4);
  });
});

describe("NanoWaveform keyboard", () => {
  it("moves a focused marker by one hundredth with an arrow key, one thousandth with Shift", async () => {
    const user = userEvent.setup();
    const { marker, box } = mount();
    marker("Region end marker").focus();

    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(box.sampleEnd.getValue()).toBeCloseTo(0.97, 6);

    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(box.sampleEnd.getValue()).toBeCloseTo(0.969, 6);
  });

  it("moves a loop marker that is drawn at the region's edge on the first key press", async () => {
    const user = userEvent.setup();
    const { marker, box } = mount({ sampleStart: 0.5, loopStart: 0.25 });
    marker("Loop start marker").focus();

    await user.keyboard("{ArrowRight}");

    expect(box.loopStart.getValue()).toBeCloseTo(0.51, 6);
    expect(at(marker("Loop start marker"))).toBeCloseTo(51, 4);
  });

  it("sends a loop marker to the ends of the region with Home and End", async () => {
    const user = userEvent.setup();
    const { marker, box } = mount({ sampleStart: 0.2, sampleEnd: 0.8, loopStart: 0.4, loopEnd: 0.6 });
    marker("Loop start marker").focus();
    await user.keyboard("{Home}");
    marker("Loop end marker").focus();
    await user.keyboard("{End}");

    expect(box.loopStart.getValue()).toBeCloseTo(0.2, 6);
    expect(box.loopEnd.getValue()).toBeCloseTo(0.8, 6);
  });

  it("makes each key press its own undo step", async () => {
    const user = userEvent.setup();
    const { marker, box, project } = mount();
    marker("Region end marker").focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(box.sampleEnd.getValue()).toBeCloseTo(0.98, 6);

    act(() => project.editing.undo());

    expect(box.sampleEnd.getValue()).toBeCloseTo(0.99, 6);
  });

  it("moves focus on with Tab, as any control does", async () => {
    const user = userEvent.setup();
    const { marker } = mount();
    marker("Region start marker").focus();

    await user.tab();

    expect(document.activeElement).toBe(marker("Region end marker"));
  });

  // fireEvent returns false when the handler called preventDefault.
  it("keeps the keys it handles from also scrolling the page, and no others", () => {
    const { marker } = mount({ sampleStart: 0.3 });
    const start = marker("Region start marker");

    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(fireEvent.keyDown(start, { key }), key).toBe(false);
    }
    for (const key of ["Tab", "a", "ArrowUp", "ArrowDown", "PageDown", " "]) {
      expect(fireEvent.keyDown(start, { key }), key).toBe(true);
    }
  });

  it("tells a screen reader where a marker is drawn", () => {
    const { marker } = mount({ sampleStart: 0.5, loopStart: 0.25, loopEnd: 0.853 });

    expect(marker("Loop start marker").getAttribute("aria-valuenow")).toBe("50");
    expect(marker("Loop start marker").getAttribute("aria-valuetext")).toBe("50.0 percent");
    expect(marker("Loop end marker").getAttribute("aria-valuenow")).toBe("85");
    expect(marker("Loop end marker").getAttribute("aria-valuetext")).toBe("85.3 percent");
  });

  it("leaves other keys to the page", async () => {
    const user = userEvent.setup();
    const { marker, box } = mount();
    marker("Region start marker").focus();

    await user.keyboard("a{Enter}{ArrowUp}");

    expect(box.sampleStart.getValue()).toBe(0);
  });
});

describe("NanoWaveform dragging", () => {
  it("moves a marker to where the pointer is, as a share of the waveform's width", () => {
    const { marker, box } = mount();

    drag(marker("Region start marker"), 0, 150, 300);

    expect(box.sampleStart.getValue()).toBeCloseTo(0.3, 6);
    expect(at(marker("Region start marker"))).toBeCloseTo(30, 4);
  });

  it("lets the start pass the end, which plays the region backwards", () => {
    const { marker, box } = mount({ sampleEnd: 0.5 });

    drag(marker("Region start marker"), 0, 400, 800);

    expect(box.sampleStart.getValue()).toBeCloseTo(0.8, 6);
    expect(box.sampleEnd.getValue()).toBeCloseTo(0.5, 6);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("played backwards");
  });

  it("stops at the ends of the waveform when the pointer goes past them", () => {
    const { marker, box } = mount({ sampleStart: 0.4, sampleEnd: 0.6, loop: false });

    drag(marker("Region end marker"), 600, 900, 1400);
    expect(box.sampleEnd.getValue()).toBe(1);

    drag(marker("Region start marker"), 400, 100, -300);
    expect(box.sampleStart.getValue()).toBe(0);
  });

  it("keeps a loop marker inside the region", () => {
    const { marker, box } = mount({ sampleStart: 0.2, sampleEnd: 0.8, loopStart: 0.4, loopEnd: 0.6 });

    drag(marker("Loop end marker"), 600, 750, 950);

    expect(box.loopEnd.getValue()).toBeCloseTo(0.8, 6);
  });

  it("makes one undo step of a whole drag", () => {
    const { marker, box, project } = mount();
    project.editing.modify(() => box.sampleEnd.setValue(0.9));

    drag(marker("Region start marker"), 0, 100, 200, 300, 400);
    expect(box.sampleStart.getValue()).toBeCloseTo(0.4, 6);

    act(() => project.editing.undo());
    expect(box.sampleStart.getValue()).toBe(0);
    expect(box.sampleEnd.getValue()).toBeCloseTo(0.9, 6);
  });

  it("makes a second drag a second undo step", () => {
    const { marker, box, project } = mount();

    drag(marker("Region start marker"), 0, 100, 200);
    drag(marker("Region start marker"), 200, 300, 400);

    act(() => project.editing.undo());
    expect(box.sampleStart.getValue()).toBeCloseTo(0.2, 6);
  });

  it("ends the drag when the pointer is released", () => {
    const { marker, box } = mount();
    const handle = marker("Region start marker");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });

    expect(box.sampleStart.getValue()).toBeCloseTo(0.2, 6);
  });

  // Without capture a fast drag leaves the 24 px handle and stops.
  it("captures the pointer when a drag starts", () => {
    const { marker } = mount();
    const handle = marker("Region start marker");

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 100 });

    expect(handle.hasPointerCapture(7)).toBe(true);
  });

  it("does not start a drag with the right mouse button", () => {
    const { marker, box } = mount();
    const handle = marker("Region start marker");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, button: 2 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });

    expect(box.sampleStart.getValue()).toBe(0);
    expect(handle.hasPointerCapture(1)).toBe(false);
  });

  it("leaves no undo step behind for a press and release that did not move", () => {
    const { marker, box, project } = mount();
    project.editing.modify(() => box.sampleEnd.setValue(0.9));
    const handle = marker("Region start marker");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 });

    act(() => project.editing.undo());
    expect(box.sampleEnd.getValue()).toBe(1);
  });

  // A drag belongs to the pointer that started it, until that pointer lets go.
  it("does not hand a drag over to a second pointer that presses another marker", () => {
    const { marker, box } = mount({ loop: false });
    const start = marker("Region start marker");
    const end = marker("Region end marker");
    fireEvent.pointerDown(start, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(start, { pointerId: 1, clientX: 300 });

    fireEvent.pointerDown(end, { pointerId: 2, clientX: 1100 });
    fireEvent.pointerMove(end, { pointerId: 2, clientX: 900 });
    fireEvent.pointerMove(start, { pointerId: 1, clientX: 500 });

    expect(box.sampleEnd.getValue()).toBe(1);
    expect(box.sampleStart.getValue()).toBeCloseTo(0.4, 6);
  });

  it("does not end a drag when a second pointer is released", () => {
    const { marker, box } = mount();
    const handle = marker("Region start marker");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });

    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });

    expect(box.sampleStart.getValue()).toBeCloseTo(0.4, 6);
  });

  // The loop markers go away with the loop. The drag must go with them, or the
  // same pointer passing over another marker later would move a marker nobody sees.
  it("drops the drag of a loop marker when the loop is switched off under it", () => {
    const { marker, box, project } = mount({ loopStart: 0.3, loopEnd: 0.9 });
    const loopStart = marker("Loop start marker");
    fireEvent.pointerDown(loopStart, { pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(loopStart, { pointerId: 1, clientX: 500 });
    expect(box.loopStart.getValue()).toBeCloseTo(0.4, 6);

    act(() => project.editing.modify(() => box.loop.setValue(false)));
    fireEvent.pointerMove(marker("Region start marker"), { pointerId: 1, clientX: 800 });

    expect(box.loopStart.getValue()).toBeCloseTo(0.4, 6);
    expect(box.sampleStart.getValue()).toBe(0);
  });

  // With the pointer captured every event goes to the first marker anyway. If
  // capture is lost, passing over another marker must not stall or redirect the drag.
  it("keeps moving the marker it started on while the pointer passes over another", () => {
    const { marker, box } = mount({ loop: false });
    const start = marker("Region start marker");
    fireEvent.pointerDown(start, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(start, { pointerId: 1, clientX: 300 });

    fireEvent.pointerMove(marker("Region end marker"), { pointerId: 1, clientX: 600 });

    expect(box.sampleStart.getValue()).toBeCloseTo(0.5, 6);
    expect(box.sampleEnd.getValue()).toBe(1);
  });

  it("ignores a pointer that moves without having pressed", () => {
    const { marker, box } = mount();

    fireEvent.pointerMove(marker("Region start marker"), { pointerId: 1, clientX: 600 });

    expect(box.sampleStart.getValue()).toBe(0);
  });

  it("ignores a second pointer while one is dragging", () => {
    const { marker, box } = mount();
    const handle = marker("Region start marker");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 900 });

    expect(box.sampleStart.getValue()).toBeCloseTo(0.2, 6);
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)("ends the drag on %s", ending => {
    const { marker, box } = mount();
    const handle = marker("Region start marker");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });

    fireEvent[ending](handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });

    expect(box.sampleStart.getValue()).toBeCloseTo(0.2, 6);
  });
});

describe("NanoWaveform messages", () => {
  it("says the region is empty when start meets end", () => {
    mount({ sampleStart: 0.5, sampleEnd: 0.5 });

    expect(screen.getByRole("status").textContent).toContain("The region is empty");
  });

  it("does not claim silence for an empty region while the LFO moves the start", () => {
    mount({ sampleStart: 0.5, sampleEnd: 0.5 }, { lfo: true });

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("only if the LFO has moved its start away");
    expect(text).not.toContain("play nothing");
  });

  it("says nothing about a region of one slider step, which the engine plays", () => {
    mount({ sampleStart: 0.5, sampleEnd: 0.501, loop: false });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says nothing about the region while no sample has loaded", () => {
    mount({ sampleStart: 0.5, sampleEnd: 0.5 }, { sample: false });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says nothing about the loop when it is off or the region is empty", () => {
    const first = mount({ sampleStart: 0.1, sampleEnd: 0.3, loopStart: 0.5, loopEnd: 0.9, loop: false });
    expect(screen.queryByText(/the whole region loops/)).toBeNull();
    first.unmount();

    mount({ sampleStart: 0.5, sampleEnd: 0.5, loopStart: 0.5, loopEnd: 0.9 });
    expect(screen.queryByText(/the whole region loops/)).toBeNull();
  });

  it("describes the region and the loop in the waveform's label", () => {
    mount({ sampleStart: 0.2, sampleEnd: 0.8, loopStart: 0.4, loopEnd: 0.6 });

    expect(screen.getByRole("img").getAttribute("aria-label"))
      .toBe("Waveform of the sample. Region 20 to 80 percent. Loop 40 to 60 percent.");
  });

  it("says the whole region loops when the loop points leave nothing inside it", () => {
    mount({ sampleStart: 0.1, sampleEnd: 0.3, loopStart: 0.5, loopEnd: 0.9 });

    expect(screen.getByText(/the whole region loops/)).toBeDefined();
  });
});

describe("NanoWaveform read heads", () => {
  const overlay = (): HTMLCanvasElement => document.querySelector(".nn-wave-overlay") as HTMLCanvasElement;
  const show = (): void => layOut(overlay(), { left: 100, top: 0, width: WIDTH, height: 180 });

  it("draws one line per sounding voice, up to the end of the list", () => {
    const { calls } = installFakeContext2d();
    const mounted = mount();
    show();
    calls.length = 0;

    mounted.stream.send(0, 24000, 48000, -1, 12000);

    expect(overlay().dataset.playheads).toBe("3");
    expect(overlay().dataset.positions).toBe("0.000,0.500,1.000");
    expect(calls.filter(call => call.startsWith("fillRect"))).toEqual([
      "fillRect(0,0,1,180)", "fillRect(500,0,1,180)", "fillRect(1000,0,1,180)",
    ]);
  });

  it("wipes the lines when the engine reports no voices", () => {
    const { calls } = installFakeContext2d();
    const mounted = mount();
    show();
    mounted.stream.send(14400, -1);
    expect(overlay().dataset.playheads).toBe("1");
    calls.length = 0;

    mounted.stream.send(-1);

    expect(overlay().dataset.playheads).toBe("0");
    expect(overlay().dataset.positions).toBe("");
    expect(calls).toContain("clearRect(0,0,1000,180)");
    expect(calls.some(call => call.startsWith("fillRect"))).toBe(false);
  });

  it("wipes the lines, without an error, when the sample goes away", () => {
    const { calls } = installFakeContext2d();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mounted = mount();
    show();
    mounted.stream.send(24000, -1);
    expect(overlay().dataset.playheads).toBe("1");
    mounted.adapter.file = (() => Option.None) as unknown as NanoDeviceBoxAdapter["file"];
    calls.length = 0;

    mounted.stream.send(24000, -1);

    expect(overlay().dataset.playheads).toBe("0");
    expect(calls.some(call => call.startsWith("fillRect"))).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });

  it("reports a failure to draw once, and goes on listening", () => {
    installFakeContext2d();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mounted = mount();
    show();
    mounted.adapter.file = (() => { throw new Error("adapter is gone"); }) as unknown as NanoDeviceBoxAdapter["file"];

    mounted.stream.send(24000, -1);
    mounted.stream.send(24000, -1);
    mounted.stream.send(24000, -1);

    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain("adapter is gone");
    expect(mounted.stream.listening).toBe(true);
  });

  it("wipes lines that are 150 ms old, and not before", () => {
    const { calls } = installFakeContext2d();
    const clock = driveFrames();
    const now = vi.spyOn(performance, "now").mockReturnValue(5000);
    const mounted = mount();
    show();
    mounted.stream.send(24000, -1);

    now.mockReturnValue(5100);
    clock.tick();
    expect(overlay().dataset.playheads).toBe("1");
    calls.length = 0;

    now.mockReturnValue(5151);
    clock.tick();

    expect(overlay().dataset.playheads).toBe("0");
    expect(calls).toContain("clearRect(0,0,1000,180)");
  });

  it("draws at the screen's pixel ratio", () => {
    const { calls } = installFakeContext2d();
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    try {
      const mounted = mount();
      show();
      calls.length = 0;

      mounted.stream.send(24000, -1);

      expect([overlay().width, overlay().height]).toEqual([2000, 360]);
      expect(calls).toEqual([
        "setTransform(1,0,0,1,0,0)", "clearRect(0,0,2000,360)",
        "setTransform(2,0,0,2,0,0)", "fillRect(500,0,1,180)",
      ]);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    }
  });

  it("leaves no frame work behind when it goes away", () => {
    const { calls } = installFakeContext2d();
    const clock = driveFrames();
    const now = vi.spyOn(performance, "now").mockReturnValue(5000);
    const mounted = mount();
    show();
    mounted.stream.send(24000, -1);

    mounted.unmount();
    calls.length = 0;
    now.mockReturnValue(6000);
    clock.tick();

    expect(calls).toEqual([]);
  });

  it("stops listening to the engine when the component goes away", () => {
    installFakeContext2d();
    const mounted = mount();
    expect(mounted.stream.listening).toBe(true);

    mounted.unmount();

    expect(mounted.stream.listening).toBe(false);
  });

  it("survives a canvas that cannot draw, and does not listen for positions it could not show", () => {
    const mounted = mount();

    expect(mounted.stream.subscriptions).toBe(0);
    expect(mounted.marker("Region start marker")).toBeDefined();
  });
});

describe("NanoWaveform picture", () => {
  const layOutPicture = (mounted: Mounted): void =>
    layOut(mounted.container.querySelector(".nn-wave-static") as HTMLCanvasElement, { left: 100, top: 0, width: WIDTH, height: 180 });
  const rectangles = (calls: string[]): string[] =>
    calls
      .filter(call => call.startsWith("fillRect"))
      .map(call => call.slice("fillRect(".length, -1).split(",").map(part => Math.round(Number(part))).join(","));

  it("paints the background, the region, the loop and its two fade zones", () => {
    const { calls } = installFakeContext2d();
    const clock = driveFrames();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mounted = mount({ sampleStart: 0.2, sampleEnd: 0.8, loopStart: 0.4, loopEnd: 0.6, loopFade: 0.1 });
    layOutPicture(mounted);

    clock.tick();

    expect(rectangles(calls)).toEqual([
      "0,0,1000,180",    // background
      "200,0,600,180",   // region
      "400,0,200,180",   // loop
      "400,0,50,180",    // fade zone at the loop's start: 0.1 s of a 2 s sample
      "550,0,50,180",    // fade zone at the loop's end
    ]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("paints again after a change, and not while nothing changes", () => {
    const { calls } = installFakeContext2d();
    const clock = driveFrames();
    const mounted = mount({ sampleStart: 0.2, sampleEnd: 0.8, loop: false });
    layOutPicture(mounted);
    clock.tick();
    calls.length = 0;

    clock.tick();
    expect(calls).toEqual([]);

    act(() => mounted.project.editing.modify(() => mounted.box.sampleStart.setValue(0.3)));
    clock.tick();
    expect(rectangles(calls)[1]).toBe("300,0,500,180");
  });

  it("paints no loop while the loop is off", () => {
    const { calls } = installFakeContext2d();
    const clock = driveFrames();
    const mounted = mount({ sampleStart: 0.2, sampleEnd: 0.8, loop: false });
    layOutPicture(mounted);

    clock.tick();

    expect(rectangles(calls)).toEqual(["0,0,1000,180", "200,0,600,180"]);
  });

  it("paints again when its size changes", () => {
    const { calls } = installFakeContext2d();
    const clock = driveFrames();
    const mounted = mount({ sampleStart: 0.2, sampleEnd: 0.8, loop: false });
    const picture = mounted.container.querySelector(".nn-wave-static") as HTMLCanvasElement;
    layOutPicture(mounted);
    clock.tick();
    calls.length = 0;

    layOut(picture, { left: 100, top: 0, width: 500, height: 180 });
    expect(resize(picture)).toBe(1);
    clock.tick();

    expect(rectangles(calls)).toEqual(["0,0,500,180", "100,0,300,180"]);
  });

  it("stops painting when it goes away, and stops watching its size", () => {
    const { calls } = installFakeContext2d();
    const clock = driveFrames();
    const mounted = mount();
    const picture = mounted.container.querySelector(".nn-wave-static") as HTMLCanvasElement;
    layOutPicture(mounted);
    clock.tick();

    mounted.unmount();
    calls.length = 0;
    mounted.project.editing.modify(() => mounted.box.sampleStart.setValue(0.3));
    const told = resize(picture);
    clock.tick();

    expect(told).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("NanoWaveform ghost marker", () => {
  const ghost = (mounted: Mounted): HTMLElement => mounted.container.querySelector(".nn-ghost") as HTMLElement;

  it("is hidden while nothing modulates the start", () => {
    const clock = driveFrames();
    const mounted = mount({ sampleStart: 0.25 });

    clock.tick();

    expect(ghost(mounted).style.display).toBe("none");
  });

  it("follows the start on every frame while the LFO is on", () => {
    const clock = driveFrames();
    const mounted = mount({ sampleStart: 0.25 }, { lfo: true });

    clock.tick();
    expect(ghost(mounted).style.display).toBe("block");
    expect(parseFloat(ghost(mounted).style.left)).toBeCloseTo(25, 4);

    act(() => mounted.project.editing.modify(() => mounted.box.sampleStart.setValue(0.6)));
    clock.tick();
    expect(parseFloat(ghost(mounted).style.left)).toBeCloseTo(60, 4);
  });

  it("hides again when the LFO is switched off, and stops following", () => {
    const clock = driveFrames();
    const mounted = mount({ sampleStart: 0.25 }, { lfo: true });
    clock.tick();

    mounted.setLfo(false);
    act(() => mounted.project.editing.modify(() => mounted.box.sampleStart.setValue(0.6)));
    clock.tick();

    expect(ghost(mounted).style.display).toBe("none");
    expect(parseFloat(ghost(mounted).style.left)).toBeCloseTo(25, 4);
  });
});
