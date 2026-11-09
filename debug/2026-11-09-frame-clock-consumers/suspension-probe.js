// Stuck automation suspension probe (track-automation-demo.html, dev server).
// A parameter write while `engine.isPlaying` reads true sends `suspendAutomation` (AutomationSuspension.ts).
// After Stop, `isPlaying` reads true until the next SDK frame tick; a write in that window reaches the
// engine after its stop cleared the suspensions, and `play` does not clear them. The probe writes the
// volume's own field to 0 (-96 dB) in that window and measures the next playback's master RMS.
// Paste into browser_evaluate / DevTools after one real click on the page (AudioContext running).
async () => {
  // Run after selecting the volume lane's "Fade Out" preset (loud at the loop start; the default
  // "Fade In" sits near the noise floor for the first seconds and measures nothing).
  const delays = [null, 0, 10, 20, 30, 40, 60, 80]; // null = control: write after isPlaying reads false
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
  const {EngineAddresses} = await import(mods.find(n => n.includes('@opendaw_studio-adapters.js')));
  const {AnimationFrame} = await import(mods.find(n => n.includes('@opendaw_lib-dom.js')));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (cond, ms = 3000) => { const t0 = performance.now(); while (!cond() && performance.now() - t0 < ms) await sleep(2); return cond(); };
  const vol = p.rootBoxAdapter.audioUnits.adapters().find(u => !u.isOutput).namedParameter.volume;
  if (vol.track.isEmpty()) return 'volume lane missing';
  const original = vol.getUnitValue();
  const start = p.timelineBox.loopArea.from.getValue();
  let rms = []; let sampling = false;
  // The track-automation demo's default volume preset is a fade-in, quiet at the loop start: read the
  // master PEAK (the engine's peak meter, 250 ms decay) over the first 3 s, not a short RMS window.
  const sub = p.liveStreamReceiver.subscribeFloats(EngineAddresses.PEAKS, v => { if (sampling) rms.push(Math.max(v[0], v[1])); });
  const ticks = []; const tick = AnimationFrame.add(() => ticks.push(performance.now()));
  // skip the first 600 ms: the peak meter still decays from the previous playback (250 ms constant)
  const measure = async () => { rms = []; await sleep(600); sampling = true; await sleep(2400); sampling = false;
    const m = Math.max(0, ...rms); return m > 0 ? 20 * Math.log10(m) : -Infinity; };
  const playFromStart = async () => { e.setPosition(start); e.play(); return until(() => e.isPlaying.getValue()); };
  const rows = [];
  for (const delay of delays) {
    p.editing.modify(() => vol.setUnitValue(original), false);
    await playFromStart();
    const before = await measure();
    const stopAt = performance.now();
    e.stop(true);
    if (delay === null) await until(() => !e.isPlaying.getValue());
    else if (delay > 0) await sleep(delay);
    const playingAtWrite = e.isPlaying.getValue();
    const writeAfterStopMs = performance.now() - stopAt;
    p.editing.modify(() => vol.setUnitValue(0), false);
    await until(() => !e.isPlaying.getValue());
    const flagFalseAfterMs = performance.now() - stopAt;
    await sleep(400);
    await playFromStart();
    const after = await measure();
    e.stop(true); await until(() => !e.isPlaying.getValue()); await sleep(300);
    rows.push({delay: delay === null ? 'control' : delay, playingAtWrite, writeAfterStopMs: +writeAfterStopMs.toFixed(1),
      isPlayingFalseAfterMs: +flagFalseAfterMs.toFixed(1), peakBeforeDb: +before.toFixed(1), peakNextPlayDb: +after.toFixed(1),
      verdict: after < before - 30 ? 'curve ignored (stuck)' : 'curve followed'});
  }
  // Positive control: a write DURING playback must suspend the lane (by design, #347).
  p.editing.modify(() => vol.setUnitValue(original), false);
  await playFromStart(); const pcBefore = await measure();
  p.editing.modify(() => vol.setUnitValue(0), false); const pcAfter = await measure();
  e.stop(true); await until(() => !e.isPlaying.getValue());
  p.editing.modify(() => vol.setUnitValue(original), false);
  sub.terminate(); tick.terminate();
  const d = ticks.slice(1).map((t, i) => t - ticks[i]).sort((a, b) => a - b);
  return {sdkTickMeanHz: +(1000 * d.length / (ticks[ticks.length - 1] - ticks[0])).toFixed(1), sampleRate: ctx.sampleRate,
    positiveControl: {beforeDb: +pcBefore.toFixed(1), afterWriteDb: +pcAfter.toFixed(1)}, rows};
}
