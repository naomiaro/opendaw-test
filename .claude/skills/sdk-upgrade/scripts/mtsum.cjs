// Summarize a multi-mic recording-alignment envelope (recaudit-mt-summary-<run>.json), plain or forced-churn.
const fs = require('fs');
const e = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rows = e.rows || [];
const num = (k) => rows.map(r => r[k]).filter(Number.isFinite);
const range = (v, d = 2) => v.length ? `${Math.min(...v).toFixed(d)} .. ${Math.max(...v).toFixed(d)}` : '—';
const tally = {}; for (const v of num('medianBeatErrorMsNetted')) { const k = v.toFixed(3); tally[k] = (tally[k] || 0) + 1; }
const disc = e.clockDiscontinuities || [];
console.log('sdk', e.sdkVersion, 'churn', e.graphChurn === true, 'rows', rows.length, 'errors', rows.filter(r => r.error).length,
  'finalized', rows.filter(r => r.finalizeLoaderState === 'loaded').length, 'nodeDelays', num('nodeDelayMs').length);
console.log('netted tally', JSON.stringify(tally), '| firstFrameCheck', range(num('firstFrameCheckMs')), '| tail deficits', rows.filter(r => r.tailMissingMs > 0.01).length);
console.log('post-stop margin ms', range(rows.map(r => (r.finalizeNumberOfFramesAtLimit - r.finalizeNumberOfFramesAtStop) / (e.sampleRate || 48000) * 1000).filter(Number.isFinite), 1));
console.log('clock discontinuities', disc.length, 'stalls', disc.filter(d => d.frame === d.previousFrame).length, 'witnessFailure', e.clockWitnessFailure ?? null);
if (e.graphChurn === true) console.log('churn pairs', range(num('graphChurnPairs'), 0), 'nodeTapMissingQuanta', range(num('nodeTapMissingQuanta'), 0));
for (const c of e.cellVerdicts || []) console.log(' ', c.scenario, c.verdict ?? c.status, String(c.detail || '').slice(0, 240));
