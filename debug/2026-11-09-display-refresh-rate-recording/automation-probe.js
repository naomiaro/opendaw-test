async () => {
  await new Promise(r => setTimeout(r, 3000));
  const host = document.getElementById('root');
  const key = Object.keys(host).find(k => k.startsWith('__reactContainer$'));
  let p = null; const stack = [host[key].stateNode.current];
  while (stack.length && !p) { const f = stack.pop(); let h = f.memoizedState;
    while (h && typeof h === 'object' && 'next' in h) { const v = h.memoizedState; if (v && v.engine && v.rootBoxAdapter) { p = v; break; } h = h.next; }
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling); }
  const ctx = p.env.audioContext; const e = p.engine;
  if (ctx.state !== 'running') return 'context ' + ctx.state;
  const mod = performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('@opendaw_lib-dom.js'));
  const {AnimationFrame} = await import(mod);
  const ticks = []; const tick = AnimationFrame.add(() => ticks.push(performance.now()));
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('Record')).click();
  const t0 = performance.now();
  while ((!e.isRecording.getValue() || e.recordingStart.isEmpty()) && performance.now() - t0 < 5000) await new Promise(r => setTimeout(r, 10));
  if (e.recordingStart.isEmpty()) return 'no recordingStart';
  await new Promise(r => setTimeout(r, 300));
  const vol = p.rootBoxAdapter.audioUnits.adapters().find(u => !u.isOutput).namedParameter.volume;
  const writes = []; let k = 0;
  const run = async (phase, ms, gap) => { const end = performance.now() + ms; while (performance.now() < end) {
    const v = Math.round((0.15 + 0.7 * ((k * 0.6180339887) % 1)) * 1000) / 1000;
    p.editing.modify(() => vol.setUnitValue(v), false);
    writes.push({v, phase, ctx: ctx.currentTime, stored: vol.getUnitValue()}); k++;
    await new Promise(r => setTimeout(r, gap)); } };
  await run('A', 4000, 37);
  await run('B', 1000, 4);
  const rs = e.recordingStart.unwrap(); const anchor = {contextTime: rs.contextTime, position: rs.position};
  tick.terminate();
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('Stop')).click();
  await new Promise(r => setTimeout(r, 1000));
  const d = ticks.slice(1).map((t, i) => t - ticks[i]).sort((a, b) => a - b);
  const regions = [...vol.track.unwrap().regions.adapters.values()].filter(r => r.isValueRegion());
  const pps = p.timelineBox.bpm.getValue() / 60 * 960;
  const evAll = [];
  for (const r of regions) { const evs = r.events.unwrap().asArray(); evs.forEach((ev, i) => evAll.push({abs: r.position + ev.position, rel: ev.position, value: ev.value, i, n: evs.length})); }
  const count = new Map(); writes.forEach(w => { const kk = w.stored.toFixed(4); count.set(kk, (count.get(kk) || 0) + 1); });
  const res = {A: [], B: []}; const kept = {A: 0, B: 0}; const uniq = {A: 0, B: 0};
  writes.forEach(w => { if (count.get(w.stored.toFixed(4)) === 1) uniq[w.phase]++; });
  for (const ev of evAll) {
    if (ev.rel === 0 || ev.i === ev.n - 1) continue;
    const kk = ev.value.toFixed(4);
    if (count.get(kk) !== 1) continue;
    const w = writes.find(w => w.stored.toFixed(4) === kk);
    kept[w.phase]++;
    res[w.phase].push((ev.abs - (anchor.position + (w.ctx - anchor.contextTime) * pps)) / pps * 1000);
  }
  const stat = errs => { errs.sort((a, b) => a - b); const q = f => errs[Math.min(errs.length - 1, Math.floor(f * errs.length))].toFixed(1); return errs.length ? {min: q(0), median: q(0.5), max: errs[errs.length-1].toFixed(1)} : null; };
  return {sdkTick: {medianMs: d[Math.floor(d.length / 2)].toFixed(2), maxMs: d[d.length - 1].toFixed(2), meanHz: (1000 * d.length / (ticks[ticks.length - 1] - ticks[0])).toFixed(1)},
    stillRecording: e.isRecording.getValue(), regions: regions.length, sampleRate: ctx.sampleRate,
    A: {gapMs: 37, unique: uniq.A, kept: kept.A, errMs: stat(res.A)}, B: {gapMs: 4, unique: uniq.B, kept: kept.B, errMs: stat(res.B)}};
}
