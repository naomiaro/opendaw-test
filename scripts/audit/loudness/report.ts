/**
 * Shared by the browser drivers: the page expressions that read the loudness harness, the shape
 * of its result, and how it is printed. The drivers differ only in how they reach the browser.
 */
export interface HarnessReport {
  state: string;
  note: string;
  userAgent: string;
  visibility: string;
  /** One line per result row: `rowId | status | meter | error | verdict`. */
  rows: string[];
}

/** Evaluated in the page; returns the report as a JSON string. */
export const REPORT_EXPRESSION = `JSON.stringify({
  state: document.querySelector("#audit-state").dataset.auditState,
  note: document.querySelector("#summary-note").innerText,
  userAgent: navigator.userAgent,
  visibility: document.visibilityState,
  rows: [...document.querySelectorAll("[data-row-id]")].map(r => {
    const cell = (i) => (r.querySelectorAll("td")[i]?.innerText ?? "").replace(/\\s+/g, " ").trim();
    return [r.dataset.rowId, r.dataset.rowStatus, cell(2), cell(3), cell(6)].join(" | ");
  })
})`;

export const STATE_EXPRESSION = `document.querySelector("#audit-state").dataset.auditState`;

/** The Run button's centre in viewport pixels as a JSON pair, or null before it has rendered. */
export const RUN_BUTTON_EXPRESSION = `(() => {
  const button = document.querySelector("#run");
  if (!button) return null;
  const box = button.getBoundingClientRect();
  return JSON.stringify([box.x + box.width / 2, box.y + box.height / 2]);
})()`;

export const isFinished = (state: string): boolean => state === "done" || state.startsWith("error");

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function printReport(json: string): void {
  const report = JSON.parse(json) as HarnessReport;
  const counts = new Map<string, number>();
  for (const row of report.rows) {
    const status = row.split(" | ")[1];
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  console.log(`${report.state} | ${report.note} | tab ${report.visibility}`);
  console.log(report.userAgent);
  console.log([...counts].map(([status, count]) => `${status} ${count}`).join(", ") || "no rows");
  for (const row of report.rows) console.log(row);
}

/** `node <script> <url> [timeoutSeconds]` */
export function readArguments(): { url: string; timeoutMs: number } {
  const url = process.argv[2];
  if (url === undefined) throw new Error("usage: node <script> <harness url> [timeoutSeconds]");
  return { url, timeoutMs: Number(process.argv[3] ?? "900") * 1000 };
}
