// Waits (up to 100 s per call) for the audit to end, then saves the node-tap probe to
// .verify-output/node-tap-<time>.json. Call again while it returns a running state.
async (page) => {
  const readState = () => page.evaluate(() => document.querySelector("#audit-state")?.getAttribute("data-audit-state") ?? "missing");
  const deadline = Date.now() + 100000;
  let state = await readState();
  while (Date.now() < deadline && state !== "done" && !state.startsWith("error")) {
    await page.waitForTimeout(1000);
    state = await readState();
  }
  if (state !== "done" && !state.startsWith("error")) {
    return await page.evaluate((s) => ({ state: s, taps: window.__nodeTap.taps.length, errors: window.__nodeTap.errors }), state);
  }
  await page.waitForTimeout(3500); // the last tap records for 2 s and measures 0.6 s later
  return await page.evaluate(async (auditState) => {
    const probe = window.__nodeTap;
    const name = "node-tap-" + String(Date.now()) + ".json";
    const body = JSON.stringify({ url: location.href, userAgent: navigator.userAgent, auditState, errors: probe.errors, refChunks: probe.refChunks, taps: probe.taps }, null, 1);
    const put = await fetch("/__verify/" + name, { method: "PUT", body });
    const statuses = {};
    for (const tr of document.querySelectorAll("tbody tr")) {
      const cells = [...tr.querySelectorAll("td, th")].map((td) => td.textContent.trim());
      statuses[cells[cells.length - 1]] = (statuses[cells[cells.length - 1]] ?? 0) + 1;
    }
    return {
      saved: put.ok ? name : "UPLOAD FAILED " + String(put.status), auditState, statuses,
      taps: probe.taps.length, measured: probe.taps.filter((t) => t.lags !== null).length, errors: probe.errors,
    };
  }, state);
}
