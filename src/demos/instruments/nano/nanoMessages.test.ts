import { describe, it, expect } from "vitest";
import { dropZoneText, readDroppedSample, regionMessage, skippedFilesNote } from "./nanoMessages";

const file = (name: string, read: () => Promise<ArrayBuffer>) => ({ name, arrayBuffer: read });
const bytes = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
const audio = (duration: number, length: number) => ({ duration, length });

describe("readDroppedSample", () => {
  it("hands back the decoded audio of a file that is fine", async () => {
    const decoded = audio(2.5, 120000);

    const result = await readDroppedSample(file("loop.wav", bytes), async () => decoded);

    expect(result).toEqual({ ok: true, buffer: decoded });
  });

  it("says a file could not be READ when it is gone by the time it is opened", async () => {
    let decodeCalled = false;

    const result = await readDroppedSample(
      file("moved.wav", () => Promise.reject(new Error("NotFoundError"))),
      async () => { decodeCalled = true; return audio(1, 48000); }
    );

    expect(result).toEqual({ ok: false, message: 'Could not read "moved.wav". It may have been moved or deleted.' });
    expect(decodeCalled).toBe(false);
  });

  it("says a file could not be DECODED when it is not audio", async () => {
    const result = await readDroppedSample(file("notes.md", bytes), () => Promise.reject(new Error("EncodingError")));

    expect(result).toEqual({ ok: false, message: 'Could not decode "notes.md". Drop a wav, mp3 or m4a audio file.' });
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
