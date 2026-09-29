// Playwright side of the node-tap probe (pass the file to the Playwright MCP's tool that
// runs a code snippet against the page): the standing multi-mic run with the probe
// injected before the page's own scripts. Returns once the run is under way;
// read-node-tap.playwright.js waits for the end and saves the probe.
async (page) => {
  const RATE = 48000; // or 44100
  // A fresh page, so an init script registered by an earlier call does not run twice.
  const fresh = await page.context().newPage();
  await page.close();
  // The probe's text, byte for byte, through the dev server's ?raw (a plain request gets
  // the file with a source map appended).
  await fresh.goto("https://localhost:5173/");
  const source = await fresh.evaluate(async () => (await import("/scripts/audit/recording-alignment/stream-tap/node-tap.init.js?raw")).default);
  await fresh.addInitScript({ content: source });
  await fresh.goto("https://localhost:5173/recording-alignment-audit-debug-demo.html?scenario=multitrack-all&bpm=120&rate=" + String(RATE));
  const button = fresh.getByRole("button", { name: "Run audit" });
  await button.waitFor({ state: "visible", timeout: 30000 });
  await fresh.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Run audit"));
    return b && !b.disabled;
  }, null, { timeout: 60000 });
  await button.click();
  await fresh.waitForTimeout(12000);
  return await fresh.evaluate(() => ({
    state: document.querySelector("#audit-state")?.getAttribute("data-audit-state") ?? "missing",
    visibility: document.visibilityState,
    contexts: window.__nodeTap.contexts,
    taps: window.__nodeTap.taps.length,
    errors: window.__nodeTap.errors,
  }));
}
