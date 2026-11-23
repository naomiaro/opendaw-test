// @vitest-environment jsdom
/**
 * A recording the SDK cannot store is offered as a WAV download (`UnstoredRecording.offerDownload`). The offer asks
 * through `RuntimeNotifier.approve`, and with no notifier installed `approve` resolves `true`. `offerDownload` loops
 * until a save succeeds or the answer is no, so with no notifier a save that is refused is asked for again at once,
 * with nothing in between and no way out. This repo installs no notifier.
 *
 * FLIPS WHEN FIXED: these tests assert the loop as measured. When the SDK ends the offer without a notifier (or after
 * a cancelled picker), the "keeps asking" tests fail, and so does "opens the save picker" if the fix is to ask nothing
 * without a notifier: invert them to pin the fixed behaviour and note the release in
 * debug/2026-11-23-unstored-recording-download-loop/note.md.
 *
 * What the count shows: every one of the stub's 50 refusals was answered by another request. The stub parks the 51st
 * call, so that the offer has not settled afterwards is the stub's doing; that nothing in the loop would end it is
 * read from the SDK's code, not measured.
 */
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeNotifier, type RuntimeNotification } from "@opendaw/lib-std";
import { AudioData } from "@opendaw/lib-dsp";
// by relative path, as `midiEffectChain.test.ts` does: the one module, without loading the whole package index
import { UnstoredRecording } from "../../node_modules/@opendaw/studio-core/dist/UnstoredRecording.js";

type Picker = (options?: unknown) => Promise<unknown>;
const globals = globalThis as unknown as { showSaveFilePicker?: Picker };

/** Lets the pending promise chains run for a few macrotasks. */
const settle = async (turns: number): Promise<void> => {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const take = (): AudioData => AudioData.create(48000, 480, 2);

/** A picker that answers the first `limit` calls as `refuse` says and then never answers, which parks the loop. */
function pickerRefusing(refuse: () => Error, limit: number): { calls: () => number } {
  let calls = 0;
  globals.showSaveFilePicker = () => {
    calls++;
    return calls > limit ? new Promise(() => {}) : Promise.reject(refuse());
  };
  return { calls: () => calls };
}

describe("the download offer for a recording that could not be stored, with no notifier installed", () => {
  afterEach(() => { delete globals.showSaveFilePicker; });

  it("opens the save picker without asking anyone", async () => {
    const picker = pickerRefusing(() => new DOMException("The user aborted a request.", "AbortError"), 1);
    void UnstoredRecording.offerDownload(take(), "Recording", new Error("storage full"));
    await settle(5);
    expect(picker.calls()).toBeGreaterThanOrEqual(1);
  });

  it("keeps asking after the picker is cancelled: 50 pickers and no end", async () => {
    const picker = pickerRefusing(() => new DOMException("The user aborted a request.", "AbortError"), 50);
    let settled = false;
    void UnstoredRecording.offerDownload(take(), "Recording", new Error("storage full")).then(() => { settled = true; }, () => { settled = true; });
    await settle(200);
    // 50 refusals, each followed by another request; the 51st is the one the stub parks, so `settled` only shows the park
    expect(picker.calls()).toBe(51);
    expect(settled).toBe(false);
  });

  it("keeps asking after a refusal that is neither a cancel nor NotAllowedError", async () => {
    const picker = pickerRefusing(() => new DOMException("Must be handling a user gesture to show a file picker.", "SecurityError"), 50);
    let settled = false;
    void UnstoredRecording.offerDownload(take(), "Recording", new Error("storage full")).then(() => { settled = true; }, () => { settled = true; });
    await settle(200);
    expect(picker.calls()).toBe(51);
    expect(settled).toBe(false);
  });
});

// LAST in the file: a notifier can be installed once per module instance and cannot be removed.
describe("the same offer with a notifier installed (the control)", () => {
  afterEach(() => { delete globals.showSaveFilePicker; });

  it("ends when the answer after a cancelled picker is no", async () => {
    const answers = [true, false];
    let asked = 0;
    RuntimeNotifier.install({
      info: async () => {},
      approve: async () => { asked++; return answers.shift() ?? false; },
      progress: () => ({ terminate: () => {} }),
      notify: () => {},
    } as unknown as RuntimeNotification.Notifier);
    const picker = pickerRefusing(() => new DOMException("The user aborted a request.", "AbortError"), 50);
    const outcome = await UnstoredRecording.offerDownload(take(), "Recording", new Error("storage full"));
    expect(outcome).toBe(false);
    expect(asked).toBe(2);
    expect(picker.calls()).toBe(1);
  });
});
