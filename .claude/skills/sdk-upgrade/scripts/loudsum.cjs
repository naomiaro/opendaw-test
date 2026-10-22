// Summarize a loudness-meter envelope (loudness-audit-<run>.json) as the register's table rows.
const fs = require('fs');
const e = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rows = e.rows || [];
const fmt = (v) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2);
const neg = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
console.log('sdk', e.sdkVersion, 'rate', e.sampleRate, 'rows', rows.length, 'pass', rows.filter(r => r.status === 'pass').length, 'statuses', JSON.stringify(rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})), 'ua', (e.userAgent || '').match(/Chrome\/(\d+)/)?.[1]);
for (const r of rows) {
  const m = r.metrics.map(x => `${x.metric} ${neg(x.got)} (${fmt(x.error)})`).join(', ');
  const l = r.late ? `I ${neg(r.late.integrated)}, LRA ${neg(r.late.range)}, peak ${neg(r.late.peak)}` : '—';
  console.log(`| \`${r.rowId}\` | ${r.status} | ${m} | ${l} |`);
}
