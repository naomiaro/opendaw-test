/**
 * Runs the loudness harness in the installed Firefox through WebDriver BiDi, with no driver binary:
 * a fresh profile, the page in a visible window, Run clicked with a real pointer action, and the
 * result table printed when the run ends.
 *
 *   node scripts/audit/loudness/drive-firefox.ts "https://localhost:5180/loudness-meter-audit-debug-demo.html?case=all" [timeoutSeconds]
 *
 * Keep the window uncovered: a hidden tab stops the page receiving the meter's readings.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REPORT_EXPRESSION,
  RUN_BUTTON_EXPRESSION,
  STATE_EXPRESSION,
  isFinished,
  printReport,
  readArguments,
  sleep,
} from "./report.ts";

const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";
const PORT = 9333;

interface BiDiResponse {
  id?: number;
  type?: string;
  error?: string;
  message?: string;
  result?: unknown;
}
interface Evaluated {
  type: string;
  result?: { value?: unknown };
  exceptionDetails?: { text: string };
}

const { url, timeoutMs } = readArguments();
const profile = mkdtempSync(join(tmpdir(), "firefox-loudness-"));
// A quiet first run: no welcome tour, no default-browser prompt, BiDi only.
writeFileSync(
  join(profile, "user.js"),
  [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("remote.active-protocols", 1);',
  ].join("\n")
);
const firefox = spawn(
  FIREFOX,
  ["--remote-debugging-port", String(PORT), "--profile", profile, "--no-remote", "--new-instance", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] }
);
let stderr = "";
firefox.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

async function connect(): Promise<WebSocket> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
      });
      return socket;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Firefox did not open its BiDi socket: ${stderr.slice(-400)}`);
}

try {
  const socket = await connect();
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as BiDiResponse;
    if (message.id === undefined) return;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    if (message.type === "error") entry.reject(new Error(`${message.error}: ${message.message}`));
    else entry.resolve(message.result);
  });
  const send = (method: string, params: object): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const session = (await send("session.new", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } })) as {
    capabilities: { browserName: string; browserVersion: string };
  };
  console.log(`browser: ${session.capabilities.browserName} ${session.capabilities.browserVersion}`);
  const tree = (await send("browsingContext.getTree", {})) as { contexts: { context: string }[] };
  const context = tree.contexts[0].context;
  const evaluate = async (expression: string): Promise<unknown> => {
    const result = (await send("script.evaluate", {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: "none",
    })) as Evaluated;
    if (result.type === "exception") throw new Error(`the page threw: ${result.exceptionDetails?.text}`);
    return result.result?.value;
  };
  await send("browsingContext.navigate", { context, url, wait: "complete" });
  let button: unknown = null;
  for (let attempt = 0; attempt < 120 && button === null; attempt++) {
    button = await evaluate(RUN_BUTTON_EXPRESSION);
    if (button === null) await sleep(500);
  }
  if (typeof button !== "string") throw new Error("the Run button never appeared");
  const [x, y] = JSON.parse(button) as [number, number];
  await send("input.performActions", {
    context,
    actions: [
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", x: Math.round(x), y: Math.round(y) },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ],
  });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isFinished(String(await evaluate(STATE_EXPRESSION)))) break;
    await sleep(2000);
  }
  printReport(String(await evaluate(REPORT_EXPRESSION)));
  await send("session.end", {}).catch(() => undefined);
  socket.close();
} catch (error) {
  console.log(`driver error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  firefox.kill("SIGTERM");
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1500).unref();
}
