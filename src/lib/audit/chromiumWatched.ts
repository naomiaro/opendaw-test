// The shared shape of the Chromium watched-issues probes
// (`chromium-watched-issues-debug-demo.html?issue=<name>`): which issue a page load
// probes, what every probe reports, and the file name its envelope is saved under.

export type WatchedIssue =
  | "first-read"
  | "bfcache"
  | "suspend-resume"
  | "capture-gaps"
  | "opfs-usage"
  | "opfs-flush"
  | "output-latency"
  | "clock-drift";

export const WATCHED_ISSUES: readonly WatchedIssue[] = [
  "first-read",
  "bfcache",
  "suspend-resume",
  "capture-gaps",
  "opfs-usage",
  "opfs-flush",
  "output-latency",
  "clock-drift",
];

function isWatchedIssue(value: string): value is WatchedIssue {
  return (WATCHED_ISSUES as readonly string[]).includes(value);
}

/** The issue named by `?issue=`; throws, naming the known issues, when it is missing or unknown. */
export function issueFrom(params: URLSearchParams): WatchedIssue {
  const value = params.get("issue");
  if (value !== null && isWatchedIssue(value)) return value;
  const got = value === null ? "no ?issue=" : `?issue=${value}`;
  throw new Error(`${got}: expected one of ${WATCHED_ISSUES.join(", ")}`);
}

/** Every closed verdict word a probe can give; anything else is a `NOT CHECKED <reason>`. */
export const VERDICT_WORDS = [
  "STALE FIRST READ",
  "FIRST READ TRUE",
  "HALF SPEED",
  "NORMAL",
  "MIDI BLOCKS CACHE",
  "CACHED WITH MIDI",
  "HALF RATE",
  "DISTORTED",
  "DISTORTED (mic only)",
  "CLEAN",
  "GAPS",
  "START GAPS",
  "NEGATIVE USAGE",
  "COUNTED",
  "NOT COUNTED",
  "MEASURED",
  "STEPS",
  "STEADY",
] as const;

export type VerdictWord = (typeof VERDICT_WORDS)[number];
/** A run that could not exercise the condition, and why: the reason is never empty. */
export type NotChecked = `NOT CHECKED ${string}`;
export type Verdict = VerdictWord | NotChecked;

export function notChecked(reason: string): NotChecked {
  if (reason.trim() === "") throw new Error("a NOT CHECKED verdict needs a reason");
  return `NOT CHECKED ${reason}`;
}

export function isNotChecked(verdict: Verdict): verdict is NotChecked {
  return verdict.startsWith("NOT CHECKED ");
}

export type Figures = Record<string, number | string | null>;

/** What one probe run reports: the verdict word and the figures it was judged on. */
export interface ProbeEnvelope {
  issue: WatchedIssue;
  /** The browser's brands (`navigator.userAgentData`), else its user-agent string. */
  chrome: string;
  /** The ISO date of the run. */
  date: string;
  /** Lowercase letters, digits and dashes: it names the saved file. */
  runToken: string;
  verdict: Verdict;
  /** `verdict` is always the first figure, and the same word as the envelope's. */
  figures: Figures;
}

/** Who ran a probe, when, and under which token: the envelope's fields other than the verdict and figures. */
export interface EnvelopeHead {
  issue: WatchedIssue;
  chrome: string;
  date: string;
  runToken: string;
}

/** The envelope, with the verdict written as the first figure (over any `verdict` the figures carry). */
export function makeEnvelope(head: EnvelopeHead, verdict: Verdict, figures: Figures): ProbeEnvelope {
  const { verdict: _ignored, ...rest } = figures;
  return { ...head, verdict, figures: { verdict, ...rest } };
}

export function envelopeName(issue: WatchedIssue, runToken: string): string {
  return `chromium-${issue}-${runToken}.json`;
}

/** The parts of `navigator` a probe reads its browser from. */
export interface BrowserNavigator {
  userAgent: string;
  userAgentData?: { brands: readonly { brand: string; version: string }[] };
}

/** A made-up brand Chrome lists beside its real ones ("Not A;Brand", "Not)A;Brand", …). */
const GREASE_BRAND = /not.?a.?brand/i;

/** The browser's brands joined (`navigator.userAgentData`), the made-up one left out, else its user-agent string. */
export function browserOf(nav: BrowserNavigator): string {
  const brands = nav.userAgentData?.brands.filter((b) => !GREASE_BRAND.test(b.brand));
  if (brands !== undefined && brands.length > 0) return brands.map((b) => `${b.brand} ${b.version}`).join(", ");
  return nav.userAgent;
}

/** Lowercase letters and digits either side of one dash; the dev server's `/__verify` sink accepts names of lowercase letters, digits and dashes only (`[a-z0-9-]`). */
export function newRunToken(now: number = Date.now()): string {
  return now.toString(36) + "-" + Math.random().toString(36).slice(2, 6).padEnd(4, "0");
}

/** The ISO date (YYYY-MM-DD, UTC) of a run. */
export function runDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The parts of `navigator` a probe reads the full browser and OS versions from. */
export interface PlatformNavigator {
  userAgent: string;
  userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ uaFullVersion?: string; platformVersion?: string }> };
}

/** What a probe records of the browser and OS beyond `browserOf`: null where the browser does not say. */
export interface PlatformVersions {
  userAgent: string;
  uaFullVersion: string | null;
  platformVersion: string | null;
}

/** The full browser version and the OS version (`userAgentData.getHighEntropyValues`); nulls when unavailable. */
export async function platformOf(nav: PlatformNavigator): Promise<PlatformVersions> {
  const read = nav.userAgentData?.getHighEntropyValues;
  if (read === undefined) return { userAgent: nav.userAgent, uaFullVersion: null, platformVersion: null };
  try {
    const values = await read.call(nav.userAgentData, ["uaFullVersion", "platformVersion"]);
    return {
      userAgent: nav.userAgent,
      uaFullVersion: values.uaFullVersion ?? null,
      platformVersion: values.platformVersion ?? null,
    };
  } catch {
    return { userAgent: nav.userAgent, uaFullVersion: null, platformVersion: null };
  }
}
