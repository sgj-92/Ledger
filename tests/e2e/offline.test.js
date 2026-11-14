// Ledger with no connection (2026-11-14), end to end in Chromium over the emulators:
//   - after one online visit, the service worker opens Ledger offline (the page, its
//     fonts, the pinned Firebase SDK);
//   - Firestore's copy on the device shows his data offline, and a change made offline
//     survives closing the app and reaches the server once he's back online;
//   - signing out wipes the copy, so a signed-out device holds nobody's data.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node offline.test.js"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PID = 'ledger-6aec3';
const PORT = 8961;
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
  await put('ledger_meta/presets', { prioritiesSeeded: { booleanValue: true } });
  await put('ledger_priorities/g1', { title: S('Pipeline: 20 qualified leads'), area: S('business'), horizon: S('year'), period: S(TODAY.slice(0, 4)), status: S('active'), createdAt: S('2026-01-02T10:00:00Z') });
  await put('ledger_commitments/a1', { title: S('Call the accountant'), date: S(TODAY), originalDate: S(TODAY), status: S('planned'), category: S('work'), createdAt: S(TODAY + 'T08:00:00Z') });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/London' });
  await ctx.route(/api\.github\.com/, x => x.abort());
  await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, x => {
    const f = x.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
    x.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
  });
  await ctx.addInitScript(() => { localStorage.setItem('ledger_emulator', '1'); });
  const errs = [];
  const open = async () => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e))); await p.goto(APP); return p; };
  const ready = p => p.waitForFunction(() => document.getElementById('authGate').hidden, null, { timeout: 30000 }).then(() => true, () => false);
  const today = p => p.evaluate(() => (document.getElementById('commitmentsList') || {}).innerText || '');

  // ---- online, once ----
  let p = await open();
  await p.waitForSelector('#authEmail', { timeout: 20000 });
  await p.fill('#authEmail', 'shaun@example.com'); await p.fill('#authPassword', 'pw-123456'); await p.click('#authSignIn');
  check(await ready(p), 'Online: signed in');
  check(await p.waitForFunction(() => /Call the accountant/.test(document.getElementById('commitmentsList').innerText), null, { timeout: 15000 }).then(() => true, () => false), 'Online: his Action');
  check(await p.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }, null, { timeout: 15000 }).then(() => true, () => false),
    'The service worker is installed');
  const stored = await p.evaluate(async () => { const c = await caches.open('ledger-shell-v1'); return (await c.keys()).map(r => r.url); });
  check(stored.some(u => /\/$/.test(u)) && stored.some(u => /firebase-firestore-compat\.js/.test(u)) && stored.some(u => /inter-400\.woff2/.test(u)),
    'It has stored the page, the Firebase SDK and the fonts', stored.join(' '));
  await sleep(1500);
  await p.close();

  // ---- offline: it opens, with his data ----
  await ctx.setOffline(true);
  p = await open();
  check(await ready(p), 'Offline: Ledger opens, still signed in');
  check(await p.waitForFunction(() => /Call the accountant/.test(document.getElementById('commitmentsList').innerText), null, { timeout: 25000 }).then(() => true, () => false),
    'Offline: his Actions are there (the copy on this device)');
  await p.click('.tab-btn[data-view="me"]'); await p.click('[data-me-sub="focus"]');
  check(await p.waitForFunction(() => /Pipeline: 20 qualified leads/.test(document.getElementById('prioritiesList').innerText), null, { timeout: 10000 }).then(() => true, () => false),
    'Offline: his goals are there');
  await p.click('.tab-btn[data-view="log"]');
  // a change made offline, then the app closed
  await p.evaluate(() => [...document.querySelectorAll('#commitmentsList .commitment-item')].find(x => /accountant/.test(x.innerText)).querySelector('.commitment-status-dot').click());
  // a done Action leaves the open list (Today folds completed ones away)
  const ticked = () => ![...document.querySelectorAll('#commitmentsList .commitment-item:not(.done)')].some(x => /accountant/.test(x.innerText));
  check(await p.waitForFunction(ticked, null, { timeout: 8000 }).then(() => true, () => false), 'Offline: ticked off');
  await sleep(1500);
  await p.close();
  p = await open();
  check(await ready(p), 'Offline, reopened');
  await p.waitForFunction(() => document.querySelectorAll('#commitmentsList .commitment-item').length > 0 || /Nothing|done/i.test(document.getElementById('commitmentsList').innerText), null, { timeout: 25000 }).catch(() => {});
  await sleep(1500);
  check(await p.evaluate(ticked) && await p.evaluate(() => /Completed\s*1/.test(document.getElementById('commitmentsList').innerText)),
    'Offline, reopened: the tick is still there (Completed · 1)');
  const before = (await list('ledger_commitments')).find(x => x.id === 'a1');
  check(before && before.status === 'planned', 'The server hasn\'t had it yet');

  // ---- back online: it's sent ----
  await ctx.setOffline(false);
  const sent = await wait(async () => { const a = (await list('ledger_commitments')).find(x => x.id === 'a1'); return a && a.status === 'completed' ? a : null; });
  let synced = sent;
  for (let i = 0; !synced && i < 30; i++){ await sleep(1500); const a = (await list('ledger_commitments')).find(x => x.id === 'a1'); if (a && a.status === 'completed') synced = a; }
  check(synced && synced.title === 'Call the accountant', 'Back online: the change made offline reaches the server');

  // ---- signing out wipes the copy ----
  const dbs = async () => p.evaluate(async () => (await indexedDB.databases()).map(d => d.name).filter(n => /firestore/i.test(n)));
  check((await dbs()).length > 0, 'Signed in: Firestore\'s copy is on this device');
  p.on('dialog', d => d.accept());
  await p.click('.tab-btn[data-view="me"]'); await p.click('[data-me-sub="focus"]');
  await p.click('#openSettingsBtn'); await p.waitForSelector('#setSignOut'); await p.click('#setSignOut');
  check(await p.waitForSelector('#authEmail', { timeout: 30000 }).then(() => true, () => false), 'Signed out: the sign-in screen');
  await sleep(1500);
  const left = await dbs();
  const keys = await p.evaluate(async () => { const out = []; for (const d of await indexedDB.databases()){ if (!/firestore/i.test(d.name)) continue;
    out.push(await new Promise(res => { const q = indexedDB.open(d.name); q.onsuccess = () => { const db = q.result; const names = [...db.objectStoreNames]; if (!names.includes('remoteDocuments')){ db.close(); res(0); return; }
      const c = db.transaction('remoteDocuments').objectStore('remoteDocuments').count(); c.onsuccess = () => { db.close(); res(c.result); }; c.onerror = () => res(-1); }; q.onerror = () => res(-1); })); } return out; });
  check(keys.every(n => n === 0), 'Signed out: no documents left in the copy on this device', JSON.stringify({ left, keys }));

  check(!errs.length, 'no page errors ' + errs.join(' | ').slice(0, 300));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
