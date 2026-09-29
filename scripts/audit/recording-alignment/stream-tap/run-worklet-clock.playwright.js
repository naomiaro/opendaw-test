// Playwright side of the worklet-clock experiment (pass the file to the Playwright
// MCP's tool that runs a code snippet against the page; dev server on
// https://localhost:5173). No SDK on the page. Edit `cfg`: `jankMs` holds the main
// thread after the recorders are made, `batch` is how many are made at once, `streams`
// opens two streams and builds two source nodes in the same task. The artifact lands
// in .verify-output/.
async (page) => {
  const cfg = { sampleRate: 48000, opens: 300, quanta: 40, gapMs: 20, jankMs: 150, batch: 3, streams: true };
  await page.goto("https://localhost:5173/");
  await page.mouse.click(5, 5); // a real click: the context must be allowed to run
  const source = await page.evaluate(async () => (await import("/scripts/audit/recording-alignment/stream-tap/worklet-clock.page.js?raw")).default);
  await page.addScriptTag({ content: source });
  return await page.evaluate((c) => window.runWorkletClock(c), cfg);
}
