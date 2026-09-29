// Playwright side of the two-tap spike (pass the file to the Playwright MCP's
// browser_run_code, dev server on https://localhost:5173). One variant per call keeps a
// call under two minutes: edit `cfg`. The artifact lands in .verify-output/.
async (page) => {
  const cfg = { sampleRate: 48000, opens: 40, variants: ["together"] };
  await page.goto("https://localhost:5173/");
  await page.mouse.click(5, 5); // a real click: the context must be allowed to run
  const source = await page.evaluate(async () => (await import("/scripts/audit/recording-alignment/stream-tap/two-tap-spike.page.js?raw")).default);
  await page.addScriptTag({ content: source });
  const result = await page.evaluate((c) => window.runTwoTapSpike(c), cfg);
  return { saved: result.saved, summary: result.summary };
}
