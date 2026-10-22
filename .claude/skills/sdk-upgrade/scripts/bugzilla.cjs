// Bugzilla REST sweep for the vendor register: `node bugzilla.cjs <host> search "<query>"…` lists open bugs
// (quicksearch), `node bugzilla.cjs <host> read <id>…` prints each bug's header, description and last two comments.
// Hosts: bugzilla.mozilla.org (Firefox, product Core, component "Web Audio"), bugs.webkit.org (WebKit).
const https = require('https');
const get = (url) => new Promise((res, rej) => https.get(url, { headers: { 'User-Agent': 'opendaw-test register sweep' } }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(url + ': ' + d.slice(0, 120))); } }); }).on('error', rej));
const [host, mode, ...args] = process.argv.slice(2);
(async () => {
  if (mode === 'search') {
    for (const q of args) {
      const d = await get(`https://${host}/rest/bug?quicksearch=${encodeURIComponent(q)}&resolution=---&include_fields=id,summary,status,priority,component,last_change_time&limit=40`);
      const b = (d.bugs || []).sort((x, y) => y.last_change_time.localeCompare(x.last_change_time));
      console.log(`\n==== ${host} "${q}": ${b.length}`);
      for (const x of b.slice(0, 25)) console.log(x.id, x.status, x.priority, x.component, x.last_change_time.slice(0, 10), x.summary.slice(0, 105));
    }
  } else {
    for (const id of args) {
      const [bug, com] = await Promise.all([get(`https://${host}/rest/bug/${id}?include_fields=id,summary,status,priority,severity,creation_time,last_change_time,platform,op_sys,version,depends_on,see_also,assigned_to`), get(`https://${host}/rest/bug/${id}/comment`)]);
      const b = bug.bugs[0]; const cs = com.bugs[id].comments;
      const clean = (t) => t.replace(/\s+/g, ' ').slice(0, 900);
      console.log(`\n==== ${host} ${id} | ${b.status} ${b.priority}/${b.severity || ''} | created ${b.creation_time.slice(0, 10)} changed ${b.last_change_time.slice(0, 10)} | ${b.platform} ${b.op_sys} | v${b.version} | see_also ${(b.see_also || []).join(' ')}\n${b.summary}\n-- description: ${clean(cs[0].text)}`);
      for (const c of cs.slice(1).slice(-2)) console.log(`-- comment ${c.count} (${c.creation_time.slice(0, 10)}): ${clean(c.text).slice(0, 500)}`);
      console.log(`-- comments: ${cs.length}`);
    }
  }
})().catch(e => { console.error(e.message); process.exit(1); });
