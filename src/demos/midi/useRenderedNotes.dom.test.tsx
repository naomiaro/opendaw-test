// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PPQN } from "@opendaw/lib-dsp";
import { Option } from "@opendaw/lib-std";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import { sineSample, type Calibration } from "@/lib/audit/midiEffectSemanticsReader";
import { REGION_POSITION_PPQN, renderSeconds } from "@/lib/audit/midiEffectSemanticsRows";
import type { Pattern } from "@/lib/midiEffects/patterns";
import { renderOfflineSlice } from "@/lib/offlineScan";
import type { ChainEntry } from "./useMidiChain";
import { calibrateRendered, renderChannel, useRenderedNotes, type RenderedNotesOptions, type RenderFn } from "./useRenderedNotes";

// `offlineScan` imports `@opendaw/studio-core`, whose `EngineWorklet` extends `AudioWorkletNode` at module load, which jsdom
// does not have. The hook's tests pass their own `render`; the mock lets `renderChannel`'s wiring be checked without an engine.
vi.mock("@/lib/offlineScan", () => ({ renderOfflineSlice: vi.fn() }));

const RATE = 48000;
const BPM = 120;
const SETTLE_MS = 300;
const CALIBRATION: Calibration = { referencePeak: 1, instrumentOffsetFrames: 0 };
// With `entries: []` the hook touches no adapter and the render is the stub, so these two are never dereferenced.
const PROJECT = {} as Project;
const AUDIO_UNIT_BOX = {} as AudioUnitBox;
// one array for every render, as `useMidiChain`'s state is: a new array is a changed chain and asks for a render
const NO_ENTRIES: readonly ChainEntry[] = [];

const EIGHTH = PPQN.Quarter / 2;
const ONE_NOTE: Pattern = { id: "sixteenths", label: "one", blurb: "", notes: [{ position: 0, duration: EIGHTH, pitch: 69, velocity: 1 }] };
const TWO_NOTES: Pattern = {
  id: "melody", label: "two", blurb: "",
  notes: [{ position: 0, duration: EIGHTH, pitch: 69, velocity: 1 }, { position: PPQN.Quarter, duration: EIGHTH, pitch: 69, velocity: 1 }],
};

/** A render of the region with one 440 Hz note (pitch 69) of an eighth at each of `positions` (region-local pulses). */
function channelWithNotes(positions: readonly number[]): Float32Array {
  const channel = new Float32Array(Math.ceil(renderSeconds(BPM) * RATE));
  const tone = sineSample(RATE, PPQN.pulsesToSeconds(EIGHTH, BPM), 440);
  for (const position of positions) channel.set(tone, Math.round(PPQN.pulsesToSeconds(REGION_POSITION_PPQN + position, BPM) * RATE));
  return channel;
}

interface Deferred { resolve: (channel: Float32Array) => void; reject: (error: Error) => void }

/** A render stub whose every call waits until the test settles it. */
function deferredRender(): { render: RenderFn; calls: Deferred[] } {
  const calls: Deferred[] = [];
  const render: RenderFn = () => new Promise<Float32Array>((resolve, reject) => calls.push({ resolve, reject }));
  return { render, calls };
}

const options = (overrides: Partial<RenderedNotesOptions>): RenderedNotesOptions => ({
  project: PROJECT, audioUnitBox: AUDIO_UNIT_BOX, entries: NO_ENTRIES, pattern: ONE_NOTE, bpm: BPM, rate: RATE, calibration: CALIBRATION, ...overrides,
});

/** Fires the settle timer and lets the render's promise chain run. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS); });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("useRenderedNotes", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("is calibrating without a calibration and renders nothing", async () => {
    const render = vi.fn<RenderFn>(async () => channelWithNotes([0]));
    const { result } = renderHook(() => useRenderedNotes(options({ calibration: null, render })));
    expect(result.current.status).toBe("calibrating");
    await settle();
    expect(render).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: "calibrating", rows: null, error: null, renderMs: null });
  });

  it("a calibration error is the error state and never requests a render", async () => {
    const render = vi.fn<RenderFn>(async () => channelWithNotes([0]));
    const { result, rerender } = renderHook((props: RenderedNotesOptions) => useRenderedNotes(props), {
      initialProps: options({ calibrationError: "read 31 notes, expected 32", render }),
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("read 31 notes, expected 32");
    await settle();
    rerender(options({ calibrationError: "read 31 notes, expected 32", render, pattern: TWO_NOTES }));
    await settle();
    expect(render).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: "error", rows: null, error: "read 31 notes, expected 32", renderMs: null });
  });

  it("requests a render when the pattern changes and goes stale → rendering → idle with rows", async () => {
    const { render, calls } = deferredRender();
    const { result, rerender } = renderHook((props: RenderedNotesOptions) => useRenderedNotes(props), {
      initialProps: options({ render }),
    });
    expect(result.current.status).toBe("stale");
    await settle();
    expect(calls).toHaveLength(1);
    await act(async () => { calls[0].resolve(channelWithNotes([0])); });
    expect(result.current.status).toBe("idle");

    rerender(options({ render, pattern: TWO_NOTES }));
    expect(result.current.status).toBe("stale");
    expect(calls).toHaveLength(1);
    await settle();
    expect(calls).toHaveLength(2);
    expect(result.current.status).toBe("rendering");
    await act(async () => { calls[1].resolve(channelWithNotes([0, PPQN.Quarter])); });
    expect(result.current.status).toBe("idle");
    const rows = result.current.rows;
    if (rows === null) throw new Error("no rows after a finished render");
    expect(rows.ghosts).toHaveLength(2);
    expect(rows.notes.map((note) => [note.pitch, note.measured])).toEqual([[69, true], [69, true]]);
    expect(result.current.error).toBeNull();
    expect(result.current.renderMs).not.toBeNull();
  });

  it("reads the stub's one note as one measured note", async () => {
    const render = vi.fn<RenderFn>(async () => channelWithNotes([0]));
    const { result } = renderHook(() => useRenderedNotes(options({ render })));
    await settle();
    await flush();
    expect(render).toHaveBeenCalledWith(PROJECT, renderSeconds(BPM), RATE);
    expect(result.current.status).toBe("idle");
    const rows = result.current.rows;
    if (rows === null) throw new Error("no rows after a finished render");
    expect(rows.notes).toHaveLength(1);
    expect(rows.notes[0]).toMatchObject({ pitch: 69, measured: true });
    expect(rows.notes[0].velocity).toBeCloseTo(1, 2);
    expect(rows.stems).toHaveLength(1);
  });

  it("keeps the previous rows while stale", async () => {
    const render = vi.fn<RenderFn>(async () => channelWithNotes([0]));
    const { result, rerender } = renderHook((props: RenderedNotesOptions) => useRenderedNotes(props), {
      initialProps: options({ render }),
    });
    await settle();
    await flush();
    const first = result.current.rows;
    expect(first).not.toBeNull();

    rerender(options({ render, pattern: TWO_NOTES }));
    expect(result.current.status).toBe("stale");
    expect(result.current.rows).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("reports a failed render and keeps the rows", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { render, calls } = deferredRender();
    const { result, rerender } = renderHook((props: RenderedNotesOptions) => useRenderedNotes(props), {
      initialProps: options({ render }),
    });
    await settle();
    await act(async () => { calls[0].resolve(channelWithNotes([0])); });
    const first = result.current.rows;
    expect(first).not.toBeNull();

    rerender(options({ render, pattern: TWO_NOTES }));
    await settle();
    await act(async () => { calls[1].reject(new Error("boom")); });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("boom");
    expect(result.current.rows).toBe(first);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[midi-rendered] render failed: boom");

    // the next success clears the error
    rerender(options({ render, pattern: ONE_NOTE }));
    await settle();
    await act(async () => { calls[2].resolve(channelWithNotes([0])); });
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("a pattern change during a render leaves the rows stale until the follow-up lands", async () => {
    const { render, calls } = deferredRender();
    const { result, rerender } = renderHook((props: RenderedNotesOptions) => useRenderedNotes(props), {
      initialProps: options({ render }),
    });
    await settle();
    expect(result.current.status).toBe("rendering");

    rerender(options({ render, pattern: TWO_NOTES }));
    expect(result.current.status).toBe("rendering");
    await act(async () => { calls[0].resolve(channelWithNotes([0])); });
    // the first render's rows are the one-note pattern's and read stale: a follow-up is due
    expect(result.current.status).toBe("stale");
    expect(result.current.rows?.ghosts).toHaveLength(1);
    expect(calls).toHaveLength(1);

    await settle();
    expect(calls).toHaveLength(2);
    expect(result.current.status).toBe("rendering");
    expect(result.current.rows?.ghosts).toHaveLength(1);
    await act(async () => { calls[1].resolve(channelWithNotes([0, PPQN.Quarter])); });
    expect(result.current.status).toBe("idle");
    expect(result.current.rows?.ghosts).toHaveLength(2);
  });

  it("stops rendering on unmount", async () => {
    const render = vi.fn<RenderFn>(async () => channelWithNotes([0]));
    const { unmount } = renderHook(() => useRenderedNotes(options({ render })));
    unmount();
    await settle();
    expect(render).not.toHaveBeenCalled();
  });
});

describe("calibrateRendered", () => {
  it("calibrates on 32 read notes", async () => {
    const positions = Array.from({ length: 32 }, (_, k) => k * PPQN.SemiQuaver);
    const channel = new Float32Array(Math.ceil(renderSeconds(BPM) * RATE));
    const tone = sineSample(RATE, PPQN.pulsesToSeconds(PPQN.SemiQuaver / 2, BPM), 440).map((x) => 0.5 * x);
    for (const position of positions) channel.set(tone, Math.round(PPQN.pulsesToSeconds(REGION_POSITION_PPQN + position, BPM) * RATE) + 7);
    const calibration = await calibrateRendered(PROJECT, BPM, RATE, async () => channel);
    expect(calibration.instrumentOffsetFrames).toBe(8);
    expect(calibration.referencePeak).toBeCloseTo(0.5, 2);
  });

  it("throws unless it read 32 notes", async () => {
    await expect(calibrateRendered(PROJECT, BPM, RATE, async () => channelWithNotes([0]))).rejects.toThrow("read 1 notes, expected 32");
  });
});

describe("renderChannel", () => {
  it("renders from 0 over the given seconds and returns the left channel", async () => {
    const left = new Float32Array([1]);
    vi.mocked(renderOfflineSlice).mockResolvedValueOnce({ channels: [left, new Float32Array([2])], sampleRate: RATE });
    expect(await renderChannel(PROJECT, 6.25, RATE)).toBe(left);
    expect(vi.mocked(renderOfflineSlice)).toHaveBeenLastCalledWith(PROJECT, 0, 6.25, RATE, { mutateCopy: expect.any(Function) });
  });

  it("refuses a copy whose master carries no Maximizer", async () => {
    vi.mocked(renderOfflineSlice).mockImplementationOnce(async (_project, _start, _end, _rate, opts) => {
      const master = { isOutput: true, audioEffects: Option.wrap({ adapters: () => [] }) };
      const copy = { rootBoxAdapter: { audioUnits: { adapters: () => [master] } }, editing: { modify: (fn: () => void) => fn() } };
      opts?.mutateCopy?.(copy as unknown as Project);
      return { channels: [new Float32Array(1), new Float32Array(1)], sampleRate: RATE };
    });
    await expect(renderChannel(PROJECT, 6.25, RATE)).rejects.toThrow("expected one Maximizer on the master, removed 0");
  });
});
