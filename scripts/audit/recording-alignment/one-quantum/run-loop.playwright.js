// Passed to the Playwright MCP's run-code tool (dev server on https://localhost:5173).
// Runs one audit URL RUNS times, a fresh page per run, and returns each run's state and
// verdict line. The runs' envelopes land in `.verify-output/`; count events afterwards with
//   node scripts/audit/recording-alignment/one-quantum-events.ts
//
// Edit RUNS and QUERY before a call. `multitrack-janked` at 120 BPM is 8 repeats in about
// 70 s; the tool moves a call that outlasts two minutes to the background and reports when
// it is done. Do not edit any file under the repo while a call is running: Vite reloads the
// page and the run is lost.
async (page) => {
  const RUNS = 5;
  const QUERY = "scenario=multitrack-janked&bpm=120&rate=48000"; // add &stopLead=off for the stop after the click
  const PER_RUN_DEADLINE_MS = 240000;

  const context = page.context();
  const results = [];
  for (let run = 1; run <= RUNS; run++) {
    const stale = context.pages();
    const fresh = await context.newPage();
    for (const other of stale) await other.close();
    const warnings = [];
    fresh.on("console", (message) => {
      if (message.type() === "warning" && /stop request/.test(message.text())) warnings.push(message.text());
    });
    await fresh.goto("https://localhost:5173/recording-alignment-audit-debug-demo.html?" + QUERY);
    const button = fresh.getByRole("button", { name: /run audit/i });
    await button.waitFor({ timeout: 90000 });
    await fresh.waitForFunction(() => {
      const found = [...document.querySelectorAll("button")].find((b) => /run audit/i.test(b.textContent));
      return found && !found.disabled;
    }, null, { timeout: 90000 });
    await fresh.waitForTimeout(2000);
    if ((await fresh.evaluate(() => document.visibilityState)) !== "visible") {
      results.push({ run, state: "skipped: the page is not visible, the transport would not advance" });
      continue;
    }
    await button.click();
    const started = Date.now();
    let state = "";
    while (Date.now() - started < PER_RUN_DEADLINE_MS) {
      state = (await fresh.getAttribute("#audit-state", "data-audit-state")) ?? "";
      if (state === "done" || state.startsWith("error")) break;
      await fresh.waitForTimeout(3000);
    }
    const line = await fresh.evaluate(() => (document.body.innerText.match(/\d+ rows — [^\n]*/) || [""])[0]);
    results.push({ run, state, line, seconds: Math.round((Date.now() - started) / 1000), stopLeadWarnings: warnings.length });
  }
  return results;
}
