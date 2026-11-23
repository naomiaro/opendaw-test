// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AudioData } from "@opendaw/lib-dsp";
import { RuntimeNotifier } from "@opendaw/lib-std";
// by relative path, as `unstoredRecordingPrompt.test.ts` does: the one module, without loading the whole package index
import { UnstoredRecording } from "../../node_modules/@opendaw/studio-core/dist/UnstoredRecording.js";
import { APPROVE_WITHOUT_ACTION, createDomNotifier, installRuntimeNotifier, NOTIFY_MS, SDK_NOTICES_ID } from "./runtimeNotifier";

type Picker = (options?: unknown) => Promise<unknown>;
const globals = globalThis as unknown as { showSaveFilePicker?: Picker };

afterEach(() => {
  document.getElementById(SDK_NOTICES_ID)?.remove();
  delete globals.showSaveFilePicker;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const bars = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`#${SDK_NOTICES_ID} > div`)];
const button = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>(`#${SDK_NOTICES_ID} button`)].find((b) => b.textContent === label);
  if (found === undefined) throw new Error(`no button "${label}"`);
  return found;
};
/** Lets pending promise chains run. */
const settle = async (turns = 5): Promise<void> => {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("approve", () => {
  it("asks, and waits for an answer", async () => {
    const notifier = createDomNotifier(document);
    let answer: boolean | "pending" = "pending";
    void notifier.approve({ headline: "Recording Not Saved", message: "Download it?", approveText: "Download WAV", cancelText: "Discard" }).then((value) => { answer = value; });
    await settle();
    expect(answer).toBe("pending");
    expect(bars()).toHaveLength(1);
    expect(bars()[0].getAttribute("role")).toBe("alertdialog");
    expect(bars()[0].textContent).toContain("Recording Not Saved. Download it?");
    button("Discard").click();
    await settle();
    expect(answer).toBe(false);
    expect(bars()).toHaveLength(0);
  });

  it("answers yes on the approving button", async () => {
    const notifier = createDomNotifier(document);
    const asked = notifier.approve({ message: "Go on?", approveText: "Yes", cancelText: "No" });
    button("Yes").click();
    expect(await asked).toBe(true);
    expect(bars()).toHaveLength(0);
  });

  it("answers no when the request is aborted, before or after the question shows", async () => {
    const notifier = createDomNotifier(document);
    const controller = new AbortController();
    const asked = notifier.approve({ message: "Go on?", abortSignal: controller.signal });
    expect(bars()).toHaveLength(1);
    controller.abort();
    expect(await asked).toBe(false);
    expect(bars()).toHaveLength(0);
    expect(await notifier.approve({ message: "Again?", abortSignal: controller.signal })).toBe(false);
    expect(bars()).toHaveLength(0);
  });

  it("shows one bar for the same question asked twice, and gives both the one answer", async () => {
    const notifier = createDomNotifier(document);
    const request = { headline: "Warning", message: "No output latency.", approveText: "Ignore", cancelText: "Cancel" };
    const first = notifier.approve(request);
    const second = notifier.approve({ ...request });
    expect(bars()).toHaveLength(1);
    button("Cancel").click();
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(bars()).toHaveLength(0);
    // answered: the next asking is a new question
    const third = notifier.approve(request);
    expect(bars()).toHaveLength(1);
    button("Ignore").click();
    expect(await third).toBe(true);
  });

  it("puts the focus on the cancelling button and takes Escape as a no", async () => {
    const notifier = createDomNotifier(document);
    const asked = notifier.approve({ message: "Go on?", approveText: "Yes", cancelText: "No" });
    expect(document.activeElement).toBe(button("No"));
    expect(bars()[0].getAttribute("aria-label")).toBe("Go on?");
    bars()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await asked).toBe(false);
  });

  it("shows a question whose yes leads to a page this site does not have with its closing button only", async () => {
    expect(APPROVE_WITHOUT_ACTION.has("MIDI Blocked")).toBe(true);
    const notifier = createDomNotifier(document);
    const asked = notifier.approve({ headline: "MIDI Blocked", message: "Allow it in the site settings.", approveText: "How to Allow", cancelText: "OK" });
    expect([...document.querySelectorAll(`#${SDK_NOTICES_ID} button`)].map((b) => b.textContent)).toEqual(["OK"]);
    button("OK").click();
    expect(await asked).toBe(false);
  });

  it("keeps two questions apart", async () => {
    const notifier = createDomNotifier(document);
    const first = notifier.approve({ message: "First?", approveText: "Yes 1", cancelText: "No 1" });
    const second = notifier.approve({ message: "Second?", approveText: "Yes 2", cancelText: "No 2" });
    expect(bars()).toHaveLength(2);
    button("No 2").click();
    expect(await second).toBe(false);
    expect(bars()).toHaveLength(1);
    button("Yes 1").click();
    expect(await first).toBe(true);
  });
});

describe("info, notify and progress", () => {
  it("info resolves at once and leaves its notice until dismissed", async () => {
    const notifier = createDomNotifier(document);
    await notifier.info({ headline: "Audio Device Unavailable", message: "Check your output." });
    expect(bars()).toHaveLength(1);
    expect(bars()[0].textContent).toContain("Audio Device Unavailable. Check your output.");
    button("OK").click();
    expect(bars()).toHaveLength(0);
  });

  it("info does not show a notice that is already showing", async () => {
    const notifier = createDomNotifier(document);
    const request = { headline: "Audio Device Unavailable", message: "Check your output." };
    await notifier.info(request);
    await notifier.info({ ...request });
    expect(bars()).toHaveLength(1);
    await notifier.info({ headline: "Another", message: "Check your output." });
    expect(bars()).toHaveLength(2);
    button("OK").click();
    await notifier.info(request);
    expect(bars()).toHaveLength(2);
  });

  it("notify shows a line that goes away by itself", () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const notifier = createDomNotifier(document);
    notifier.notify({ message: "Audio dropout. Playback stopped." });
    notifier.notify({ message: "Audio dropout. Playback stopped." });
    expect(bars()).toHaveLength(1);
    expect(bars()[0].getAttribute("role")).toBe("status");
    expect(info).toHaveBeenCalledWith("[openDAW] Audio dropout. Playback stopped.");
    vi.advanceTimersByTime(NOTIFY_MS - 1);
    expect(bars()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(bars()).toHaveLength(0);
  });

  it("progress returns an updater that takes a message and terminates", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const updater = createDomNotifier(document).progress({ headline: "Bouncing" });
    updater.message = "half way";
    updater.terminate();
    expect(debug).toHaveBeenCalledWith("[openDAW] Bouncing: half way");
    expect(bars()).toHaveLength(0);
  });
});

// LAST: the SDK's notifier can be installed once per module instance and cannot be removed.
describe("installed, against the SDK's download offer for a recording it could not store", () => {
  let firstInstall = false;
  // here and not in a test: each test below must find the notifier installed when it is run alone
  beforeAll(() => { firstInstall = installRuntimeNotifier(window); });

  it("installs once per window", () => {
    expect(firstInstall).toBe(true);
    expect(installRuntimeNotifier(window)).toBe(false);
  });

  it("asks before any picker, and ends on Discard after a cancelled picker", async () => {
    let pickers = 0;
    globals.showSaveFilePicker = () => {
      pickers++;
      // parked after a few: without a notifier the SDK would ask again without yielding, and the run would hang
      return pickers > 5 ? new Promise(() => {}) : Promise.reject(new DOMException("The user aborted a request.", "AbortError"));
    };
    let outcome: boolean | "pending" = "pending";
    void UnstoredRecording.offerDownload(AudioData.create(48000, 480, 2), "Recording", new Error("storage full")).then((value) => { outcome = value; });
    await settle();
    // the question first: with nothing installed the picker was requested here already
    expect(pickers).toBe(0);
    expect(bars()[0].textContent).toContain("Recording Not Saved");
    button("Download WAV").click();
    await settle();
    // the picker was cancelled: asked again, not a second picker
    expect(pickers).toBe(1);
    expect(outcome).toBe("pending");
    button("Discard").click();
    await settle();
    expect(outcome).toBe(false);
    expect(pickers).toBe(1);
    expect(bars()).toHaveLength(0);
  });

  it("is the notifier the SDK now asks", async () => {
    const asked = RuntimeNotifier.approve({ message: "Through the SDK?", approveText: "Yes", cancelText: "No" });
    button("No").click();
    expect(await asked).toBe(false);
  });
});
