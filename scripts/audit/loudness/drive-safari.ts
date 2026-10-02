/**
 * Runs the loudness harness in Safari through safaridriver (Safari > Develop > Allow Remote
 * Automation must be on): opens the page, clicks Run through WebDriver, prints the result table.
 *
 *   node scripts/audit/loudness/drive-safari.ts "https://localhost:5180/loudness-meter-audit-debug-demo.html?case=all" [timeoutSeconds]
 *
 * Safari trusts the dev server's certificate only if its root is in the keychain (mkcert's is).
 * Keep the automation window uncovered until the run ends.
 */
import { spawn } from "node:child_process";
import { REPORT_EXPRESSION, STATE_EXPRESSION, isFinished, printReport, readArguments, sleep } from "./report.ts";

const PORT = 4455;
const base = `http://127.0.0.1:${PORT}`;

const { url, timeoutMs } = readArguments();
const driver = spawn("/usr/bin/safaridriver", ["-p", String(PORT)], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
driver.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

async function call(method: string, path: string, body?: object): Promise<unknown> {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { value: unknown };
  if (!response.ok) {
    const failure = json.value as { error?: string; message?: string };
    throw new Error(`${method} ${path}: ${failure.error} ${failure.message}`);
  }
  return json.value;
}

let sessionId: string | null = null;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch(`${base}/status`);
      break;
    } catch {
      await sleep(250);
    }
  }
  const session = (await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } })) as {
    sessionId: string;
    capabilities: { browserName: string; browserVersion: string };
  };
  sessionId = session.sessionId;
  console.log(`browser: ${session.capabilities.browserName} ${session.capabilities.browserVersion}`);
  const prefix = `/session/${sessionId}`;
  await call("POST", `${prefix}/window/maximize`, {}).catch(() => undefined);
  await call("POST", `${prefix}/url`, { url });
  const evaluate = (expression: string): Promise<unknown> =>
    call("POST", `${prefix}/execute/sync`, { script: `return ${expression}`, args: [] });
  // The page renders after its scripts load; the first page of a cold dev server can take a while.
  let element: Record<string, string> | null = null;
  for (let attempt = 0; attempt < 120 && element === null; attempt++) {
    try {
      element = (await call("POST", `${prefix}/element`, { using: "css selector", value: "#run" })) as Record<string, string>;
    } catch {
      await sleep(500);
    }
  }
  if (element === null) throw new Error("the Run button never appeared");
  await call("POST", `${prefix}/element/${Object.values(element)[0]}/click`, {});
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isFinished(String(await evaluate(STATE_EXPRESSION)))) break;
    await sleep(2000);
  }
  printReport(String(await evaluate(REPORT_EXPRESSION)));
} catch (error) {
  console.log(`driver error: ${error instanceof Error ? error.message : String(error)} ${stderr.slice(-300)}`);
  process.exitCode = 1;
} finally {
  if (sessionId !== null) await call("DELETE", `/session/${sessionId}`).catch(() => undefined);
  driver.kill("SIGTERM");
}
