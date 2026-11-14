// Opening Ledger offline (2026-11-14): when the app starts and Firestore can't be reached,
// this device's empty cache must not be taken for "no presets" or "no goals". That once
// wrote default presets over Shaun's (his sweep channels reset) and added the two starter
// goals again, which synced as duplicates once he was back online.
//   - an existing account opened offline, then back online: presets and goals untouched;
//   - a brand-new account online: the two starter goals, once, with fixed ids.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node offline-start.test.js"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PID = 'ledger-6aec3';
const PORT = 8959;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m, why) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && why ? ' — ' + why : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const FS = `http://127.0.0.1:8080/v1/projects/${PID}/databases/(default)/documents`;
const ADMIN = { authorization: 'Bearer owner', 'content-type': 'application/json' };
async function put(docPath, fields){
  const r = await fetch(`${FS}/${docPath}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('seed failed ' + docPath + ' ' + r.status);
}
const S = v => ({ stringValue: v });
// a Firestore REST value, as plain JSON
function dec(v){
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v){ const o = {}; Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => { o[k] = dec(x); }); return o; }
  return undefined;
}
async function list(coll){
  const r = await fetch(`${FS}/${coll}`, { headers: ADMIN });
  const j = r.ok ? await r.json() : {};
  return (j.documents || []).map(d => Object.assign({ id: d.name.split('/').pop() }, dec({ mapValue: { fields: d.fields } })));
}
async function wait(fn){ for (let i = 0; i < 25; i++){ const v = await fn(); if (v) return v; await sleep(300); } return null; }


(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'shaun@example.com', password: 'pw-123456', returnSecureToken: true }) });
  const owner = (await r.json()).localId;
  await put(`ledger_users/${owner}`, { role: S('owner'), displayName: S('Shaun'), createdAt: S(TODAY) });
  await put('ledger_meta/presets', { prioritiesSeeded: { booleanValue: true }, sweepChannels: { arrayValue: { values: [S('WhatsApp - S&J'), S('Email - S&J')] } } });
  await put('ledger_priorities/g1', { title: S('Real goal'), area: S('business'), horizon: S('year'), period: S(TODAY.slice(0, 4)), status: S('active'), createdAt: S('2026-01-02T10:00:00Z') });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/London' });
  await ctx.route(/api\.github\.com/, x => x.abort());
  await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, x => {
    const f = x.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
    x.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
  });
  await ctx.addInitScript(() => { localStorage.setItem('ledger_emulator', '1'); });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(APP);
  await p.waitForSelector('#authEmail', { timeout: 20000 });
  await p.fill('#authEmail', 'shaun@example.com'); await p.fill('#authPassword', 'pw-123456'); await p.click('#authSignIn');
  await p.waitForFunction(() => document.getElementById('authGate').hidden, null, { timeout: 25000 });
  const goals = async () => { await p.click('.tab-btn[data-view="me"]'); await p.click('[data-me-sub="focus"]'); };
  await goals();
  check(await p.waitForFunction(() => /Real goal/.test(document.getElementById('prioritiesList').innerText), null, { timeout: 15000 }).then(() => true, () => false),
    'Signed in online: his one goal');

  // ---- opened again with Firestore out of reach ----
  const FS_HOST = /127\.0\.0\.1:8080/;
  await ctx.route(FS_HOST, x => x.abort());
  await p.reload();
  await sleep(22000);                 // the role check gives up (8s), then the offline snapshots arrive
  check(true, 'Opened offline');
  // ---- back online: a goal added proves the writes are flowing again ----
  await ctx.unroute(FS_HOST);
  await goals().catch(() => {});
  await p.waitForSelector('.goal-area[data-area="personal"] [data-role="add-goal"]', { timeout: 20000 });
  await p.click('.goal-area[data-area="personal"] [data-role="add-goal"]');
  await p.waitForSelector('#f_priorityTitle');
  await p.fill('#f_priorityTitle', 'Back online');
  await p.click('#savePriorityBtn');
  const back = await wait(async () => (await list('ledger_priorities')).some(x => x.title === 'Back online'));
  for (let i = 0; !back && i < 40; i++){ await sleep(1500); if ((await list('ledger_priorities')).some(x => x.title === 'Back online')) break; }
  check((await list('ledger_priorities')).some(x => x.title === 'Back online'), 'Back online: a new goal reaches the server (so anything queued offline has too)');
  await sleep(3000);
  const all = await list('ledger_priorities');
  check(all.length === 2 && !all.some(x => /Reduce weight to 90kg|Generate money/.test(x.title)),
    'No starter goals were added while offline', all.map(x => x.title).join(', '));
  const pre = (await list('ledger_meta')).find(x => x.id === 'presets');
  check(pre && pre.prioritiesSeeded === true && JSON.stringify(pre.sweepChannels) === JSON.stringify(['WhatsApp - S&J', 'Email - S&J']),
    'His presets were not reset to the defaults (sweep channels kept)', JSON.stringify(pre));

  // ---- a brand-new Ledger, online: the two starter goals, once ----
  for (const c of ['ledger_priorities', 'ledger_meta']){
    for (const d of await list(c)) await fetch(`${FS}/${c}/${d.id}`, { method: 'DELETE', headers: ADMIN });
  }
  await p.reload();
  await p.waitForFunction(() => document.getElementById('authGate').hidden, null, { timeout: 25000 });
  const seeded = await wait(async () => { const l = await list('ledger_priorities'); return l.length >= 2 ? l : null; });
  check(seeded && seeded.length === 2 && seeded.map(x => x.id).sort().join() === 'seed-money,seed-weight', 'New account: the two starter goals, with fixed ids', seeded && seeded.map(x => x.id).join());
  await p.reload();
  await p.waitForFunction(() => document.getElementById('authGate').hidden, null, { timeout: 25000 });
  await sleep(4000);
  check((await list('ledger_priorities')).length === 2, 'Opened again: still two, never more');

  check(!p.errs.length, 'no page errors ' + p.errs.join(' | ').slice(0, 300));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
