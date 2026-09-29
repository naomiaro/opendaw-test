// @vitest-environment jsdom
import { installFakeContext2d, layOut } from "@/lib/testing/domSetup";
import { describe, it, expect } from "vitest";
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
  readonly marker: (name: string) => HTMLElement;
  readonly unmount: () => void;
}

function mount(params: Partial<NanoParams> = {}, options: { sample?: boolean } = {}): Mounted {
  const fixture = samplerFixture();
  if (options.sample !== false) withSample(fixture.adapter, FRAMES);
  fixture.project.editing.modify(() =>
    applyParams(fixture.adapter, { ...NANO_PRESETS.pad.params, ...params })
  );
  const stream = new FakeStream();
  const project = { editing: fixture.project.editing, liveStreamReceiver: stream } as unknown as NanoWaveformProps["project"];
  const { container, unmount } = render(
    <Theme>
      <NanoWaveform project={project} adapter={fixture.adapter} sampleSeconds={2} peaksVersion={0} />
    </Theme>
  );
  const wave = container.querySelector(".nn-wave") as HTMLElement;
  layOut(wave, { left: 100, top: 0, width: WIDTH, height: 180 });
  return {
    ...fixture, stream, wave, unmount,
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
    const { marker, box } = mount();

    drag(marker("Region end marker"), 1000, 1200, 1400);
    expect(box.sampleEnd.getValue()).toBe(1);

    drag(marker("Region start marker"), 0, -50, -300);
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

  it("says nothing about a region of one slider step, which the engine plays", () => {
    mount({ sampleStart: 0.5, sampleEnd: 0.501, loop: false });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says nothing about the region while no sample has loaded", () => {
    mount({ sampleStart: 0.5, sampleEnd: 0.5 }, { sample: false });

    expect(screen.queryByRole("status")).toBeNull();
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

  it("clears the lines when the engine reports no voices", () => {
    installFakeContext2d();
    const mounted = mount();
    show();
    mounted.stream.send(300, -1);
    expect(overlay().dataset.playheads).toBe("1");

    mounted.stream.send(-1);

    expect(overlay().dataset.playheads).toBe("0");
    expect(overlay().dataset.positions).toBe("");
  });

  it("draws nothing while no sample has loaded", () => {
    installFakeContext2d();
    const mounted = mount({}, { sample: false });
    show();

    mounted.stream.send(300, -1);

    expect(overlay().dataset.playheads).toBe("0");
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
