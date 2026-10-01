// Playwright side of the graph-lock clock experiment (pass the file to the Playwright
// MCP's tool that runs a code snippet against the page; dev server on
// https://localhost:5173, which only supplies a secure page: no SDK is loaded).
// The measuring code is src/lib/audit/workletClockProbe.ts, the same the page
// worklet-clock-debug-demo.html runs on a button press.
// `seconds` is how long each condition is watched, `burstMs` how long the main thread
// works at a stretch, `gapMs` the pause between stretches. The `stream` condition does
// one build per stretch whatever `burstMs` is. The artifact lands in .verify-output/.
async (page) => {
  const cfg = { sampleRate: 48000, seconds: 12, burstMs: 8, gapMs: 2, conditions: ["idle", "busy", "connect", "create", "stream"] };
  await page.goto("https://localhost:5173/");
  await page.mouse.click(5, 5); // a real click: the context must be allowed to run
  return await page.evaluate(async (c) => {
    const probe = await import("/src/lib/audit/workletClockProbe.ts");
    const report = await probe.runWorkletClockProbe(c);
    const verdict = probe.classifyClockProbe(report.results);
    const name = "graph-lock-clock-" + String(Date.now()) + ".json";
    const put = await fetch("/__verify/" + name, { method: "PUT", body: JSON.stringify({ ...report, verdict }, null, 1) });
    return { saved: put.ok ? name : "NOT SAVED (" + String(put.status) + ")", verdict, ...report };
  }, cfg);
}
