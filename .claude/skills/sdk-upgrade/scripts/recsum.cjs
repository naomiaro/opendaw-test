// Summarize a single-tape recording-alignment envelope (recaudit-summary-<run>.json).
const fs = require('fs');
const e = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rows = e.rows || [];
console.log('sdk', e.sdkVersion, 'rate', e.sampleRate || e.rate, 'rows', rows.length, 'schema', e.schemaVersion, 'buildFeatures', JSON.stringify(e.buildFeatures));
const errs = rows.filter(r => r.error || r.verdict === 'error');
console.log('error rows', errs.length, errs.slice(0,3).map(r => `${r.scenario}/${r.bpm}/r${r.repeat}: ${r.error || r.reason || ''}`.slice(0,160)));
const netted = rows.map(r => r.medianBeatErrorMsNetted).filter(v => typeof v === 'number' && isFinite(v));
const tally = {}; for (const v of netted) { const k = v.toFixed(2); tally[k] = (tally[k] || 0) + 1; }
console.log('netted n', netted.length, 'min', netted.length ? Math.min(...netted).toFixed(3) : '—', 'max', netted.length ? Math.max(...netted).toFixed(3) : '—', 'tally', JSON.stringify(Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,8)));
const tails = rows.filter(r => typeof r.tailMissingMs === 'number' && r.tailMissingMs > 0.01);
console.log('tail deficit rows', tails.length, tails.slice(0,5).map(r => `${r.scenario}/${r.bpm}/r${r.repeat}: ${r.tailMissingMs.toFixed(2)}ms`));
const heads = rows.filter(r => typeof r.headMissingMs === 'number' && r.headMissingMs > 1);
console.log('head deficit rows', heads.length, heads.slice(0,5).map(r => `${r.scenario}/${r.bpm}/r${r.repeat}: ${r.headMissingMs.toFixed(1)}ms`));
const fin = rows.filter(r => r.finalizeLoaderState && r.finalizeLoaderState !== 'loaded');
console.log('not finalized', fin.length);
const cv = e.cellVerdicts || [];
const byV = {}; for (const c of cv) { const k = c.verdict ?? c.status ?? c.classification ?? Object.keys(c).join(','); byV[k] = (byV[k] || 0) + 1; }
console.log('cells', cv.length, JSON.stringify(byV));
for (const c of cv.filter(c => (c.verdict ?? c.status) !== 'aligned')) console.log('  ', c.scenario, c.bpm, c.verdict ?? c.status, (c.detail || c.reason || '').toString().slice(0, 200));
const margins = rows.map(r => (r.finalizeNumberOfFramesAtLimit - r.finalizeNumberOfFramesAtStop) / (e.sampleRate || 48000) * 1000).filter(v => isFinite(v));
if (margins.length) console.log('post-stop margin ms', Math.min(...margins).toFixed(1), '..', Math.max(...margins).toFixed(1));
