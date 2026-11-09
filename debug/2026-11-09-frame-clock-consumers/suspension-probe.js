// Stuck automation suspension probe (track-automation-demo.html, DEV SERVER ONLY: it imports the SDK's
// pre-bundled modules by their Vite dep URLs). The self-classifying page
// automation-suspended-after-stop-debug-demo.html runs the same rows anywhere; prefer it.
//
// A parameter write while `engine.isPlaying` reads true sends `suspendAutomation` (AutomationSuspension.ts).
// After Stop, `isPlaying` reads true until a frame tick reads a state the engine wrote after it stopped; a
// write in that gap reaches the engine after its stop cleared the suspensions, and `play` does not clear them.
// The probe writes the volume's own field to unit 0 (−∞ dB) in that gap and reads the next playback's level
// on the engine's master PEAK meter (`EngineAddresses.PEAKS`, 250 ms decay), 0.6–3.0 s after `isPlaying` reads
// true (the first 0.6 s are skipped while the meter decays from the previous playback).
//
// Select the volume lane's "Fade Out" preset first: the default "Fade In" sits near the noise floor at the loop
// start and the positive control does not fire on it. The probe runs the positive control FIRST and returns
// "blind" when it does not fire. Paste into browser_evaluate / DevTools after one real click on the page.
// The 24 Hz table in the note used delays [null, 0, 20, 40, 60, 80, 120]; edit DELAYS to repeat it.
async () => {
  const DELAYS = [null, 0, 10, 20, 30, 40, 60, 80]; // null = control: write after isPlaying reads false
  const SUSPENDED_DB = 30;
  const MIN_LEVEL_DB = -40;
  const host = document.getElementById('root');
  const key = Object.keys(host).find(k => k.startsWith('__reactContainer$'));
  let p = null; const stack = [host[key].stateNode.current];
  while (stack.length && !p) { const f = stack.pop(); let h = f.memoizedState;
    while (h && typeof h === 'object' && 'next' in h) { const v = h.memoizedState; if (v && v.engine && v.rootBoxAdapter) { p = v; break; } h = h.next; }
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling); }
  if (!p) return 'no project';
  const ctx = p.env.audioContext; const e = p.engine;
  if (ctx.state !== 'running') return 'context ' + ctx.state;
  const mods = performance.getEntriesByType('resource').map(r => r.name);
  const adaptersUrl = mods.find(n => n.includes('@opendaw_studio-adapters.js'));
  const domUrl = mods.find(n => n.includes('@opendaw_lib-dom.js'));
  if (!adaptersUrl || !domUrl) return 'SDK modules not found (dev server only)';
  const {EngineAddresses} = await import(adaptersUrl);
  const {AnimationFrame} = await import(domUrl);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (stage, cond, ms = 3000) => { const t0 = performance.now();
    while (!cond()) { if (performance.now() - t0 > ms) throw new Error(`HUNG: ${stage} (document ${document.visibilityState})`); await sleep(2); } };
  const units = p.rootBoxAdapter.audioUnits.adapters().filter(u => !u.isOutput);
  if (units.length !== 1) return `expected one non-output unit, found ${units.length}`;
  const vol = units[0].namedParameter.volume;
  if (vol.track.isEmpty()) return 'volume lane missing';
  const original = vol.getUnitValue();
  const start = p.timelineBox.loopArea.from.getValue();
  let peaks = []; let sampling = false;
  const sub = p.liveStreamReceiver.subscribeFloats(EngineAddresses.PEAKS, v => { if (sampling) peaks.push(Math.max(v[0], v[1])); });
  const ticks = []; const tick = AnimationFrame.add(() => ticks.push(performance.now()));
  const measure = async () => { peaks = []; await sleep(600); sampling = true; await sleep(2400); sampling = false;
    if (peaks.length === 0) throw new Error(`no meter packets (document ${document.visibilityState})`);
    const m = Math.max(...peaks); return m > 0 ? 20 * Math.log10(m) : -Infinity; };
  const playFromStart = async stage => { e.setPosition(start); e.play(); await until(`${stage}: play`, () => e.isPlaying.getValue()); };
  const rows = [];
  try {
    p.editing.modify(() => vol.setUnitValue(original), false);
    await playFromStart('positive control'); const pcBefore = await measure();
    p.editing.modify(() => vol.setUnitValue(0), false); const pcAfter = await measure();
    e.stop(true); await until('positive control: stop', () => !e.isPlaying.getValue()); await sleep(300);
    const positiveControl = {beforeDb: +pcBefore.toFixed(1), afterWriteDb: +pcAfter.toFixed(1)};
    if (!(pcBefore > MIN_LEVEL_DB) || !(pcAfter < pcBefore - SUSPENDED_DB)) return {blind: 'positive control did not fire (wrong preset?)', positiveControl};
    for (const delay of DELAYS) {
      p.editing.modify(() => vol.setUnitValue(original), false);
      await playFromStart(`row ${delay}`);
      const before = await measure();
      const stopAt = performance.now();
      e.stop(true);
      if (delay === null) await until('control: flag', () => !e.isPlaying.getValue());
      else if (delay > 0) await sleep(delay);
      const playingAtWrite = e.isPlaying.getValue();
      const writeAfterStopMs = performance.now() - stopAt;
      p.editing.modify(() => vol.setUnitValue(0), false);
      await until(`row ${delay}: flag`, () => !e.isPlaying.getValue());
      const flagFalseAfterMs = performance.now() - stopAt;
      await sleep(400);
      await playFromStart(`row ${delay}: next`);
      const after = await measure();
      e.stop(true); await until(`row ${delay}: stop`, () => !e.isPlaying.getValue()); await sleep(300);
      rows.push({delay: delay === null ? 'control' : delay, playingAtWrite, writeAfterStopMs: +writeAfterStopMs.toFixed(1),
        isPlayingFalseAfterMs: +flagFalseAfterMs.toFixed(1), peakBeforeDb: +before.toFixed(1), peakNextPlayDb: +after.toFixed(1),
        visibility: document.visibilityState,
        verdict: !(before > MIN_LEVEL_DB) ? 'no measurement' : after < before - SUSPENDED_DB ? 'curve ignored (stuck)' : 'curve followed'});
    }
    const d = ticks.slice(1).map((t, i) => t - ticks[i]);
    return {sdkTickMeanHz: +(1000 * d.length / (ticks[ticks.length - 1] - ticks[0])).toFixed(1), sampleRate: ctx.sampleRate, positiveControl, rows};
  } catch (error) {
    return {error: String(error), rows};
  } finally {
    try { e.stop(true); } catch {}
    p.editing.modify(() => vol.setUnitValue(original), false);
    sub.terminate(); tick.terminate();
  }
}
