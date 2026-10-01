// Playwright side of the graph-lock clock experiment (pass the file to the Playwright
// MCP's tool that runs a code snippet against the page; dev server on
// https://localhost:5173, which only supplies a secure page: no SDK is loaded).
// `seconds` is how long each condition is watched, `burstMs` how long the main thread
// works at a stretch, `gapMs` the pause between stretches. The `stream` condition does
// one build per stretch whatever `burstMs` is. The artifact lands in .verify-output/.
async (page) => {
  const cfg = { sampleRate: 48000, seconds: 12, burstMs: 8, gapMs: 2, conditions: ["idle", "busy", "connect", "create", "stream"] };
  await page.goto("https://localhost:5173/");
  await page.mouse.click(5, 5); // a real click: the context must be allowed to run
  const source = await page.evaluate(async () => (await import("/scripts/audit/recording-alignment/one-quantum/graph-lock-clock.page.js?raw")).default);
  await page.addScriptTag({ content: source });
  return await page.evaluate((c) => window.runGraphLockClock(c), cfg);
}
