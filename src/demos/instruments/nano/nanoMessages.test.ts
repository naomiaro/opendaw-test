import { afterEach, describe, it, expect, vi } from "vitest";
import {
  NO_MESSAGES, dropZoneText, messagesAfter, readDroppedSample, regionMessage, skippedFilesNote,
  type SampleMessages,
} from "./nanoMessages";

const file = (name: string, read: () => Promise<ArrayBuffer>) => ({ name, arrayBuffer: read });
const bytes = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
const audio = (duration: number, length: number) => ({ duration, length });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readDroppedSample", () => {
  it("hands back the decoded audio of a file that is fine", async () => {
    const decoded = audio(2.5, 120000);

    const result = await readDroppedSample(file("loop.wav", bytes), async () => decoded);

    expect(result).toEqual({ ok: true, buffer: decoded });
  });

  it("says a file could not be READ when it is gone by the time it is opened", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    let decodeCalled = false;

    const result = await readDroppedSample(
      file("moved.wav", () => Promise.reject(new Error("NotFoundError"))),
      async () => { decodeCalled = true; return audio(1, 48000); }
    );

    expect(result).toEqual({ ok: false, message: 'Could not read "moved.wav". It may have been moved or deleted.' });
    expect(decodeCalled).toBe(false);
    expect(warnings).toHaveBeenCalledWith('Nano demo: could not read "moved.wav": Error: NotFoundError');
  });

  it("says a file could not be DECODED when it is not audio", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await readDroppedSample(file("notes.md", bytes), () => Promise.reject(new Error("EncodingError")));

    expect(result).toEqual({ ok: false, message: 'Could not decode "notes.md". Drop a wav, mp3 or m4a audio file.' });
    expect(warnings).toHaveBeenCalledWith('Nano demo: could not decode "notes.md": Error: EncodingError');
  });

  it("refuses a file that is too long, giving its length and the limit", async () => {
    const result = await readDroppedSample(file("song.mp3", bytes), async () => audio(220.94, 9743454));

    expect(result).toEqual({
      ok: false,
      message: '"song.mp3" was not loaded: it is 220.94 s long and the sampler page takes samples up to 60 s.',
    });
  });

  it("refuses a file that decodes to nothing", async () => {
    const result = await readDroppedSample(file("empty.wav", bytes), async () => audio(0, 0));

    expect(result).toEqual({ ok: false, message: '"empty.wav" was not loaded: the file holds no audio.' });
  });
});

describe("skippedFilesNote", () => {
  it("says nothing when one file was dropped", () => {
    expect(skippedFilesNote(0)).toBeNull();
  });

  it("says one other file was left out", () => {
    expect(skippedFilesNote(1)).toBe("1 other file was left out: the sampler holds one sample at a time.");
  });

  it("says how many other files were left out", () => {
    expect(skippedFilesNote(3)).toBe("3 other files were left out: the sampler holds one sample at a time.");
  });

  it.each([-1, Number.NaN, 0.5])("says nothing for a count of %d", count => {
    expect(skippedFilesNote(count)).toBeNull();
  });
});

describe("dropZoneText", () => {
  it("invites a drop while a gallery sample is selected", () => {
    expect(dropZoneText({ id: "pad", name: "Pad", seconds: 2 }, false))
      .toBe("Or drop your own audio file here (up to 60 s).");
  });

  it("names a dropped file that has loaded", () => {
    expect(dropZoneText({ id: null, name: "loop.wav", seconds: 2.5 }, false))
      .toBe("Loaded: loop.wav (2.50 s). Drop another file to replace it.");
  });

  it("does not call a dropped file loaded when its load failed", () => {
    const text = dropZoneText({ id: null, name: "loop.wav", seconds: 2.5 }, true);

    expect(text).toBe('"loop.wav" did not load. Drop another file, or pick a sample above.');
    expect(text).not.toContain("Loaded");
  });
});

describe("regionMessage", () => {
  it("says nothing for a region that plays", () => {
    expect(regionMessage({ empty: false, startIsModulated: false })).toBeNull();
    expect(regionMessage({ empty: false, startIsModulated: true })).toBeNull();
  });

  it("says notes play nothing when the region is empty", () => {
    expect(regionMessage({ empty: true, startIsModulated: false }))
      .toBe("The region is empty, so notes play nothing. Move Start or End.");
  });

  // The engine reads the start with the LFO added, so it is not always empty then.
  it("does not claim silence while the LFO moves the start", () => {
    const message = regionMessage({ empty: true, startIsModulated: true });

    expect(message).toBe("Start and End are at the same place. A note sounds only if the LFO has moved its start away.");
    expect(message).not.toContain("play nothing");
  });
});

describe("messagesAfter", () => {
  const NOTE = "2 other files were left out: the sampler holds one sample at a time.";
  const busy: SampleMessages = { error: "an earlier error", note: NOTE, loadFailed: true };

  it("starts with nothing to say", () => {
    expect(NO_MESSAGES).toEqual({ error: null, note: null, loadFailed: false });
  });

  it("clears everything when a gallery sample is chosen", () => {
    expect(messagesAfter(busy, { type: "sample chosen" })).toEqual(NO_MESSAGES);
  });

  it("clears the error and notes the files left out when a drop begins", () => {
    expect(messagesAfter(busy, { type: "files dropped", skippedCount: 2 }))
      .toEqual({ error: null, note: NOTE, loadFailed: true });
    expect(messagesAfter(busy, { type: "files dropped", skippedCount: 0 }))
      .toEqual({ error: null, note: null, loadFailed: true });
  });

  // The sample that was there is still there, in whatever state it was.
  it("reports a file that was refused and leaves the current sample's state alone", () => {
    const state: SampleMessages = { error: null, note: NOTE, loadFailed: false };

    expect(messagesAfter(state, { type: "file refused", message: "Could not decode" }))
      .toEqual({ error: "Could not decode", note: NOTE, loadFailed: false });
    expect(messagesAfter({ ...state, loadFailed: true }, { type: "file refused", message: "x" }).loadFailed)
      .toBe(true);
  });

  it("forgets an earlier failed load when a dropped file becomes the sample", () => {
    expect(messagesAfter(busy, { type: "file accepted" }))
      .toEqual({ error: "an earlier error", note: NOTE, loadFailed: false });
  });

  it("reports a load that failed", () => {
    expect(messagesAfter(NO_MESSAGES, { type: "load failed", message: '"loop.wav" failed to load: gone' }))
      .toEqual({ error: '"loop.wav" failed to load: gone', note: null, loadFailed: true });
  });

  it("reports a failure that is not a failed load without calling the sample unloaded", () => {
    expect(messagesAfter(NO_MESSAGES, { type: "failed", message: "Could not load that sample" }))
      .toEqual({ error: "Could not load that sample", note: null, loadFailed: false });
  });

  it("says a drop held no file, and drops the note about an earlier drop", () => {
    expect(messagesAfter(busy, { type: "nothing dropped" }))
      .toEqual({ error: "That drop held no file. Drop an audio file.", note: null, loadFailed: true });
  });

  it("walks a whole visit: three files, then an empty drop, then a gallery sample", () => {
    let state = NO_MESSAGES;
    state = messagesAfter(state, { type: "files dropped", skippedCount: 2 });
    state = messagesAfter(state, { type: "file accepted" });
    expect(state).toEqual({ error: null, note: NOTE, loadFailed: false });

    state = messagesAfter(state, { type: "nothing dropped" });
    expect(state.note).toBeNull();
    expect(state.error).toBe("That drop held no file. Drop an audio file.");

    state = messagesAfter(state, { type: "sample chosen" });
    expect(state).toEqual(NO_MESSAGES);
  });
});
