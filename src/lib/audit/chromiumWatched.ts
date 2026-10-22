// The shared shape of the Chromium watched-issues probes
// (`chromium-watched-issues-debug-demo.html?issue=<name>`): which issue a page load
// probes, what every probe reports, and the file name its envelope is saved under.

export type WatchedIssue = "first-read" | "bfcache" | "suspend-resume" | "capture-gaps" | "opfs-usage" | "opfs-flush";

export const WATCHED_ISSUES: readonly WatchedIssue[] = [
  "first-read",
  "bfcache",
  "suspend-resume",
  "capture-gaps",
  "opfs-usage",
  "opfs-flush",
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

/** What one probe run reports: the verdict word and the figures it was judged on. */
export interface ProbeEnvelope {
  issue: WatchedIssue;
  /** The browser's brands (`navigator.userAgentData`), else its user-agent string. */
  chrome: string;
  /** The ISO date of the run. */
  date: string;
  /** Lowercase letters, digits and dashes: it names the saved file. */
  runToken: string;
  verdict: string;
  figures: Record<string, number | string | null>;
}

export function envelopeName(issue: WatchedIssue, runToken: string): string {
  return `chromium-${issue}-${runToken}.json`;
}

/** The parts of `navigator` a probe reads its browser from. */
export interface BrowserNavigator {
  userAgent: string;
  userAgentData?: { brands: readonly { brand: string; version: string }[] };
}

/** The browser's brands joined (`navigator.userAgentData`), else its user-agent string. */
export function browserOf(nav: BrowserNavigator): string {
  const brands = nav.userAgentData?.brands;
  if (brands !== undefined && brands.length > 0) return brands.map((b) => `${b.brand} ${b.version}`).join(", ");
  return nav.userAgent;
}

/** Lowercase letters, digits and one dash: the dev server's `/__verify` sink accepts nothing else in a name. */
export function newRunToken(now: number = Date.now()): string {
  return now.toString(36) + "-" + Math.random().toString(36).slice(2, 6).padEnd(4, "0");
}

/** The ISO date (YYYY-MM-DD, UTC) of a run. */
export function runDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
