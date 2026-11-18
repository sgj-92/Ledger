// Smith & Johnson (2026-11-18), end to end over the Auth and Firestore emulators:
//   - the S&J tab: today, overdue, waiting, coming up, business Comms, clients and team;
//   - a client added on the phone, saved owner-only in ledger_sj, live on the Mac;
//   - an Action added from the client's page: marked S&J, with its client, on Today too;
//   - an existing Action marked S&J from its sheet; others untouched;
//   - a business conversation linked to the client, shown on the client's page.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node sj.test.js"
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

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mjs': 'text/javascript' };
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


async function get(docPath){
  const r = await fetch(`${FS}/${docPath}`, { headers: ADMIN });
  if (!r.ok) return null;
  const j = await r.json();
  return dec({ mapValue: { fields: j.fields } });
}

(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'shaun@example.com', password: 'pw-123456', returnSecureToken: true }) });
  const owner = (await r.json()).localId;
  const day = n => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  await put(`ledger_users/${owner}`, { role: S('owner'), displayName: S('Shaun'), createdAt: S(TODAY) });
  await put('ledger_meta/presets', { prioritiesSeeded: { booleanValue: true } });
  const act = (id, title, date, extra) => put('ledger_commitments/' + id, Object.assign({ title: S(title), date: S(date), originalDate: S(date), status: S('planned'),
    category: S('work'), createdAt: S(TODAY + 'T08:00:00Z') }, extra || {}));
  const T = { booleanValue: true };
  await act('a1', 'Payroll', TODAY, { sj: T });
  await act('a2', 'Chase invoice', day(-2), { sj: T });
  await act('a3', 'VAT figures', day(-1), { sj: T, execState: S('waiting'), statusContext: S('Kaz') });
  await act('a4', 'Quarterly review', day(3), { sj: T });
  await act('a5', 'Gym', TODAY, { category: S('training') });
  await act('a6', 'Send engagement letter', TODAY);
  await put('ledger_conversations/v1', { title: S('Sarah'), category: S('business'), attentionState: S('needs_me'), lastActivityAt: S(TODAY + 'T09:00:00Z') });
  await put('ledger_conversations/v2', { title: S('Mum'), category: S('personal'), attentionState: S('needs_me'), lastActivityAt: S(TODAY + 'T09:00:00Z') });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  async function device(name, width){
    const ctx = await b.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, timezoneId: 'Europe/London' });
    await ctx.route(/api\.github\.com/, x => x.abort());
    await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, x => {
      const f = x.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
      x.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
    });
    await ctx.addInitScript(() => { localStorage.setItem('ledger_emulator', '1'); });
    const p = await ctx.newPage(); p.errs = []; p.name = name;
    p.on('pageerror', e => p.errs.push(String(e)));
    await p.goto(APP);
    await p.waitForSelector('#authEmail', { timeout: 20000 });
    await p.fill('#authEmail', 'shaun@example.com'); await p.fill('#authPassword', 'pw-123456'); await p.click('#authSignIn');
    await p.waitForFunction(() => document.getElementById('authGate').hidden, null, { timeout: 25000 });
    return p;
  }
  const until = async (p, fn, arg, t) => { try { await p.waitForFunction(fn, arg, { timeout: t || 12000 }); return true; } catch (e){ return false; } };
  const text = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const pick = (p, id, v) => p.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);

  const phone = await device('phone', 390), mac = await device('mac', 1440);
  check(true, 'Shaun signed in on his phone and his Mac');

  // ---- the tab ----
  check(await phone.evaluate(() => !!document.querySelector('.tab-btn[data-view="sj"]') && /S&J/.test(document.querySelector('.tab-btn[data-view="sj"]').innerText)), 'Phone: an S&J tab');
  await phone.click('.tab-btn[data-view="sj"]');
  await until(phone, () => /Payroll/.test(document.getElementById('view-sj').innerText));
  const sec = (p, title) => p.evaluate(t => { const c = [...document.querySelectorAll('#view-sj .sj-card')].find(x => x.querySelector('.sj-title').textContent === t); return c ? c.innerText.replace(/\s+/g, ' ') : ''; }, title);
  check(/Payroll/.test(await sec(phone, 'Today')) && !/Gym|engagement/.test(await sec(phone, 'Today')), 'Today: S&J Actions only');
  check(/Chase invoice/.test(await sec(phone, 'Overdue')), 'Overdue: an earlier one not done');
  check(/VAT figures/.test(await sec(phone, 'Waiting on others')) && !/VAT/.test(await sec(phone, 'Overdue')), 'Waiting: by itself, not also overdue');
  check(/Quarterly review/.test(await sec(phone, 'Coming up')), 'Coming up: a later one');
  check(/Sarah/.test(await sec(phone, 'Comms')) && !/Mum/.test(await sec(phone, 'Comms')), 'Comms: business conversations, not personal');
  check(await phone.evaluate(() => [...document.querySelectorAll('.sj-tile')].map(x => x.innerText.replace(/\s+/g, ' ')).join('|')) === '1 today|1 overdue|1 waiting', 'The tiles count them');

  // ---- a client, saved privately, live on the Mac ----
  await phone.click('#sjAddClient');
  await phone.fill('#f_sjName', 'Acme Ltd'); await phone.fill('#f_sjDetail', 'Sarah Jones'); await phone.click('#sjSave');
  const clients = await wait(async () => { const r = await fetch(`${FS}/ledger_sj`, { headers: ADMIN }); const j = await r.json(); return (j.documents || []).length ? j.documents : null; });
  const cid = clients && clients[0].name.split('/').pop();
  const c1 = cid && await get('ledger_sj/' + cid);
  check(c1 && c1.kind === 'client' && c1.name === 'Acme Ltd' && c1.detail === 'Sarah Jones' && c1.status === 'active', 'Saved: the client, in ledger_sj', JSON.stringify(c1));
  check(await until(phone, () => /Acme Ltd/.test(document.getElementById('sjName') && document.getElementById('sjName').textContent)), 'Phone: the client\'s page opens');
  await mac.click('.tab-btn[data-view="sj"]');
  check(await until(mac, () => [...document.querySelectorAll('#view-sj .sj-rec')].some(x => /Acme Ltd/.test(x.innerText))), 'Mac: the client is there, live');

  // ---- an Action from the client's page ----
  await phone.click('#sjAct');
  await phone.waitForSelector('#f_commitTitle');
  check(await phone.evaluate(id => document.querySelector('#f_sjToggle .sel').dataset.v === 'yes' && document.getElementById('f_sjClient').value === id, cid), 'The new Action is S&J, for Acme Ltd');
  await phone.fill('#f_commitTitle', 'Year-end pack for Acme');
  await phone.click('#saveCommitBtn');
  const made = await wait(async () => { const r = await fetch(`${FS}/ledger_commitments`, { headers: ADMIN }); const j = await r.json();
    const d = (j.documents || []).map(x => dec({ mapValue: { fields: x.fields } })).find(x => x.title === 'Year-end pack for Acme'); return d || null; });
  check(made && made.sj === true && made.clientId === cid && made.teamId === null && made.date === TODAY, 'Saved: sj, the client, today', JSON.stringify(made));
  check(await until(phone, () => /Year-end pack/.test(document.getElementById('sjActs') ? document.getElementById('sjActs').innerText : '')), 'Back on the client\'s page, the Action is listed');
  await phone.click('#sheetCloseBtn');
  check(await until(mac, () => [...document.querySelectorAll('#view-sj .sj-card')].some(c => /Year-end pack for Acme/.test(c.innerText) && /Acme Ltd/.test(c.innerText))), 'Mac: on the S&J tab under Today, with its client');
  await phone.click('.tab-btn[data-view="log"]');
  check(await until(phone, () => [...document.querySelectorAll('#commitmentsList .commitment-item')].some(x => /Year-end pack/.test(x.innerText) && /Acme Ltd/.test(x.innerText))), 'Phone: on Today too, with its client');

  // ---- an existing Action marked S&J; another left alone ----
  await phone.evaluate(() => [...document.querySelectorAll('#commitmentsList .commitment-item')].find(x => /engagement letter/.test(x.innerText)).click());
  await phone.waitForSelector('#f_sjToggle');
  check(await phone.evaluate(() => document.querySelector('#f_sjToggle .sel').dataset.v === 'no' && document.getElementById('sjLinks').hidden), 'An ordinary Action: not S&J, the client fields hidden');
  await phone.click('#f_sjToggle [data-v="yes"]');
  await pick(phone, 'f_sjClient', cid);
  await phone.click('#saveCommitBtn');
  const a6 = await wait(async () => { const d = await get('ledger_commitments/a6'); return d && d.sj ? d : null; });
  check(a6 && a6.sj === true && a6.clientId === cid, 'Marked S&J, with Acme Ltd');
  await phone.evaluate(() => [...document.querySelectorAll('#commitmentsList .commitment-item')].find(x => /Gym/.test(x.innerText)).click());
  await phone.waitForSelector('#saveCommitBtn');
  await phone.click('#saveCommitBtn');
  await sleep(800);
  const a5 = await get('ledger_commitments/a5');
  check(a5 && !('sj' in a5) && !('clientId' in a5), 'An Action not marked S&J gets no S&J fields', JSON.stringify(a5));

  // ---- a conversation linked to the client ----
  await phone.click('.tab-btn[data-view="sj"]');
  await phone.waitForSelector('.sj-rec');
  await phone.evaluate(() => [...document.querySelectorAll('.sj-rec')].find(x => /Acme/.test(x.innerText)).click());
  await phone.waitForSelector('#sjLinkConv', { state: 'attached' });
  await pick(phone, 'sjLinkConv', 'v1');
  const v1 = await wait(async () => { const d = await get('ledger_conversations/v1'); return d && d.sjId ? d : null; });
  check(v1 && v1.sjId === cid && v1.category === 'business', 'The conversation is linked to the client');
  check(await until(phone, () => /Sarah/.test(document.getElementById('sjConvs').innerText)), 'Shown on the client\'s page');
  check(await until(mac, () => [...document.querySelectorAll('#view-sj .sj-rec')].some(x => /Acme Ltd/.test(x.innerText) && /2 open actions/.test(x.innerText) && /1 needs a reply/.test(x.innerText))),
    'Mac: the client\'s line counts its open Actions and who needs a reply');
  // notes save
  await phone.fill('#sjNotes', 'Year end 31 March');
  await phone.click('#sjOpenN');
  const noted = await wait(async () => { const d = await get('ledger_sj/' + cid); return d && d.notes === 'Year end 31 March' ? d : null; });
  check(!!noted && noted.kind === 'client' && noted.detail === 'Sarah Jones', 'Notes saved, the rest of the client kept');

  for (const p of [phone, mac]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.join(' | ').slice(0, 300));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
