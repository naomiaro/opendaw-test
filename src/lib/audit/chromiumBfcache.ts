/**
 * Chromium 575891839: a document with a running AudioContext and an AudioWorkletNode,
 * restored from the back/forward cache, keeps `state: running` but advances `currentTime`
 * at about half wall-clock speed. This file holds the judgement, pure and Node-testable;
 * the browser half is `chromiumBfcacheProbe.ts`.
 *
 * The same probe has a MIDI arm (`&midi=1`) for Chromium 40635109: a document that has
 * requested MIDI access is never put in the cache (`kRequestedMIDIPermission`). The arm
 * requests access before the baseline and judges on the way back whether the page was
 * restored, and if not, whether the not-restored reasons name MIDI.
 */
import { notChecked, type Verdict } from "./chromiumWatched";

export interface BfcacheOptions {
  /** `&midi=1`: request Web MIDI access before the baseline, and judge the cache on it. */
  midi: boolean;
}

/** The probe's parameters beyond `?issue=`; `&midi=` takes `1` only, anything else is refused. */
export function bfcacheOptionsFrom(params: URLSearchParams): BfcacheOptions {
  const midi = params.get("midi");
  if (midi !== null && midi !== "1") throw new Error(`&midi=${midi}: expected &midi=1, or no &midi=`);
  return { midi: midi === "1" };
}

/** One measurement window: how far the context clock and the wall clock moved over it. */
export interface ClockRatioSample {
  /** `context.currentTime` at the end minus at the start. */
  contextAdvanceSec: number;
  /** `performance.now()` at the end minus at the start, in seconds. */
  wallAdvanceSec: number;
}

export type BfcacheVerdict = "HALF SPEED" | "NORMAL" | "NOT CHECKED";

export interface BfcacheJudgement {
  verdict: BfcacheVerdict;
  ratioBefore: number;
  /** The clock's speed over the windows after the first: the speed it settled at. */
  ratioAfter: number | null;
  /** Every window's ratio after the restore, the first included; empty when there were none. */
  windowRatios: number[];
  /** Why the restore was not judged: the not-restored reasons, or a short word; null when judged. */
  reason: string | null;
}

/** Below this the clock before leaving is already wrong, and nothing after it can be judged against it. */
export const BASELINE_MIN_RATIO = 0.9;

/** Below this after the restore the clock has slowed: the tracker's figure is 0.501. */
export const HALF_SPEED_MAX_RATIO = 0.75;

/**
 * The restore is measured in consecutive windows and judged on all but the first, so a
 * clock that stalls while it resumes and then runs true is not read as a slow one.
 */
export const RESTORE_WINDOWS = 3;
export const RESTORE_WINDOW_SECONDS = 1;

/** The context clock's speed against the wall clock: 1 is true. */
export function clockRatio(sample: ClockRatioSample): number {
  return sample.contextAdvanceSec / sample.wallAdvanceSec;
}

export function judgeBfcache(
  before: ClockRatioSample,
  after: ClockRatioSample[] | null,
  persisted: boolean,
  notRestoredReasons: string | null
): BfcacheJudgement {
  const ratioBefore = clockRatio(before);
  const windowRatios = after === null ? [] : after.map(clockRatio);
  const settled = after === null ? [] : after.slice(1);
  const ratioAfter =
    settled.length === 0 ? null
    : clockRatio({
        contextAdvanceSec: settled.reduce((sum, w) => sum + w.contextAdvanceSec, 0),
        wallAdvanceSec: settled.reduce((sum, w) => sum + w.wallAdvanceSec, 0),
      });
  const notChecked = (reason: string): BfcacheJudgement => ({
    verdict: "NOT CHECKED",
    ratioBefore,
    ratioAfter,
    windowRatios,
    reason,
  });
  if (!persisted) return notChecked(notRestoredReasons ?? "not-restored, no reasons reported");
  if (after === null) return notChecked("no-measurement-after-restore");
  if (ratioAfter === null) return notChecked("too-few-windows");
  if (ratioBefore < BASELINE_MIN_RATIO) return notChecked("baseline-slow");
  const verdict: BfcacheVerdict = ratioAfter < HALF_SPEED_MAX_RATIO ? "HALF SPEED" : "NORMAL";
  return { verdict, ratioBefore, ratioAfter, windowRatios, reason: null };
}

/** The reason Blink reports for `kRequestedMIDIPermission` is "requested midi permission"; the match is kept loose to its one distinctive word. */
const MIDI_REASON = /midi/i;

/**
 * The MIDI arm's verdict. Restored from the cache with a `MIDIAccess` held: `CACHED WITH MIDI`,
 * which would be the half-speed defect reaching the MIDI pages. Kept out of the cache: the
 * reasons name MIDI, or the arm does not know why the page was not cached (the cache may be
 * off, as in Playwright's Chrome). Only the `reasons` entries are searched, never the page URL,
 * which carries `&midi=1` itself.
 */
export function judgeMidiArm(persisted: boolean, notRestoredReasons: string | null): Verdict {
  if (persisted) return "CACHED WITH MIDI";
  if (notRestoredReasons === null) return notChecked("not-cached-no-reasons-reported");
  return reasonEntries(notRestoredReasons).some((reason) => MIDI_REASON.test(reason))
    ? "MIDI BLOCKS CACHE"
    : notChecked("not-cached-without-a-midi-reason");
}

/** Every `reason` string in a serialized `NotRestoredReasons`, the frames' children included; the whole text when it does not parse. */
function reasonEntries(serialized: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return [serialized];
  }
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (!isRecord(node)) return;
    if (Array.isArray(node.reasons)) {
      for (const entry of node.reasons) {
        if (typeof entry === "string") found.push(entry);
        else if (isRecord(entry) && typeof entry.reason === "string") found.push(entry.reason);
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(value);
  return found;
}

/** Both tones' pitch as the analysers read them, in Hz. */
export interface Pitches {
  control: number;
  worklet: number;
}

/** The schema of the stored run: an entry with no version, or another one, is an older page's and is not judged. */
export const STORED_BFCACHE_RUN_VERSION = 3;

/** What the first document keeps in `sessionStorage` for a later load to judge. */
export interface StoredBfcacheRun {
  version: typeof STORED_BFCACHE_RUN_VERSION;
  runToken: string;
  chrome: string;
  date: string;
  before: ClockRatioSample;
  pitchBefore: Pitches;
  sampleRate: number;
  /** `Date.now()` when the baseline was stored: the time away is measured from here. */
  startedAt: number;
  /** The MIDI arm: the document requested Web MIDI access before the baseline. */
  midiRequested: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const numbers = (value: unknown, fields: readonly string[]): boolean =>
  isRecord(value) && fields.every((field) => typeof value[field] === "number");

/** The stored run, or null when the text is not one of this schema's. */
export function parseStoredBfcacheRun(raw: string): StoredBfcacheRun | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== STORED_BFCACHE_RUN_VERSION) return null;
  if (typeof value.runToken !== "string" || typeof value.chrome !== "string" || typeof value.date !== "string") return null;
  if (!numbers(value.before, ["contextAdvanceSec", "wallAdvanceSec"]) || !numbers(value.pitchBefore, ["control", "worklet"])) return null;
  if (typeof value.sampleRate !== "number" || typeof value.startedAt !== "number") return null;
  if (typeof value.midiRequested !== "boolean") return null;
  return value as unknown as StoredBfcacheRun;
}
