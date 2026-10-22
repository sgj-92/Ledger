// Communications quick capture, end to end: Shaun on two devices (phone and Mac) and Abi
// (partner), over the Auth and Firestore emulators, which enforce ../../firestore.rules.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node comms-capture.test.js [shots-dir] [dark|light] [width]"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const [OUT, THEME, W] = process.argv.slice(2);
const shots = OUT || path.join(__dirname, 'shots');
const theme = THEME || 'dark', w = Number(W || 390), mobile = w < 768, tag = `${w}-${theme}`;
fs.mkdirSync(shots, { recursive: true });
const PID = 'ledger-6aec3';
const PORT = 8953;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m, why) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && why ? ' — ' + why : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ymd(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const now = new Date(), TODAY = ymd(now);
const plus = n => { const d = new Date(now); d.setDate(d.getDate() + n); return ymd(d); };

// the repository, served as it is
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';      // as Vercel serves the root
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// Firestore emulator REST, as an administrator (the emulator's "owner" token skips the rules)
const FS = `http://127.0.0.1:8080/v1/projects/${PID}/databases/(default)/documents`;
const ADMIN = { authorization: 'Bearer owner', 'content-type': 'application/json' };
function enc(v){
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
function dec(v){
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
}
async function put(docPath, data){
  const r = await fetch(`${FS}/${docPath}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) throw new Error('seed failed ' + docPath + ' ' + r.status);
}
async function del(docPath){ await fetch(`${FS}/${docPath}`, { method: 'DELETE', headers: ADMIN }); }
async function all(coll){
  const r = await (await fetch(`${FS}/${coll}?pageSize=500`, { headers: ADMIN })).json();
  return (r.documents || []).map(d => Object.assign({ id: d.name.split('/').pop() }, dec({ mapValue: { fields: d.fields || {} } })));
}

async function signUp(email){
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) });
  return (await r.json()).localId;
}
async function oobLink(email){
  const r = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/oobCodes`);
  const j = await r.json();
  return j.oobCodes.filter(c => c.email === email && c.requestType === 'EMAIL_SIGNIN').pop().oobLink;
}

(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const SHAUN = 'shaun@example.com', ABI = 'abi@example.com';
  const owner = await signUp(SHAUN), abi = await signUp(ABI);
  await put(`ledger_users/${owner}`, { role: 'owner', displayName: 'Shaun', email: SHAUN, createdAt: TODAY });
  await put(`ledger_users/${abi}`, { role: 'partner', displayName: 'Abi', email: ABI, createdAt: TODAY });
  await put(`ledger_share_members/${owner}_${abi}`, { ownerUid: owner, partnerUid: abi, role: 'partner', active: true, displayName: 'Abi', ownerName: 'Shaun', createdAt: TODAY });
  const then = '2026-10-15T09:00:00.000Z';
  await put('ledger_matters/m1', { title: 'Accounts', area: 'business', status: 'active', summary: '', log: [], createdAt: then, updatedAt: then });
  await put('ledger_conversations/c1', { title: 'James', matterId: 'm1', participants: [{ name: 'James', role: '' }], channel: 'email', externalRef: null, attentionState: 'waiting_on_person',
    waitingOn: 'James', summary: 'Sent draft', notes: '', lastActivityAt: then, nextFollowUpAt: null, log: [{ at: then, kind: 'state', text: 'Started · Waiting on James' }], createdAt: then, updatedAt: then });
  await put(`ledger_commitments/k1`, { date: TODAY, originalDate: TODAY, title: 'Finish the quarterly plan', category: 'work', status: 'planned', priorityId: null, minVersion: null, disruptionReason: null, createdAt: then });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  async function session(name, width){
    const ww = width || w, mob = ww < 768;
    const ctx = await b.newContext({ viewport: { width: ww, height: mob ? 844 : 900 }, deviceScaleFactor: 1, isMobile: mob, hasTouch: mob, serviceWorkers: 'block', timezoneId: 'Europe/London' });
    await ctx.route(/api\.github\.com/, r => r.abort());
    await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, r => {
      const f = r.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
      r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
    });
    await ctx.addInitScript(t => { localStorage.setItem('ledger_emulator', '1'); localStorage.setItem('ledger_theme', t); }, theme);
    const p = await ctx.newPage(); p.errs = []; p.name = name;
    p.on('pageerror', e => p.errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|permission|Missing or insufficient|offline|net::ERR|quick capture save failed|ledger_conversations save failed/i.test(m.text())) p.errs.push('console: ' + m.text()); });
    return p;
  }
  async function signIn(p, email){
    await p.goto(APP);
    await p.waitForSelector('#authEmail', { timeout: 20000 });
    await p.fill('#authEmail', email); await p.click('#authSend');
    await p.waitForSelector('#authLink', { timeout: 15000 });
    await p.fill('#authLink', await oobLink(email));
    await p.click('#authPasteForm button[type=submit]');
  }
  const until = async (p, fn, arg, t) => { try { await p.waitForFunction(fn, arg, { timeout: t || 12000 }); return true; } catch (e){ return false; } };
  const toast = p => p.evaluate(() => (document.querySelector('.pin-toast') || {}).textContent || '');
  const needsN = p => p.evaluate(() => { const b = document.querySelector('[data-comms-filter="needs"] .cf-n'); return Number((b && b.textContent) || 0); });
  const convs = async () => await all('ledger_conversations');

  // two of Shaun's devices
  const S = await session('phone'), S2 = await session('mac', 1440);
  await signIn(S, SHAUN); await signIn(S2, SHAUN);
  check(await until(S, () => /Finish the quarterly plan/.test(document.querySelector('main').innerText), null, 20000) && await until(S2, () => /Finish the quarterly plan/.test(document.querySelector('main').innerText), null, 20000), 'Shaun signed in on his phone and his Mac');
  await S.click('nav.tabbar .tab-btn[data-view="comms"]'); await S2.click('nav.tabbar .tab-btn[data-view="comms"]');
  check(await until(S2, () => document.querySelector('.view.active').id === 'view-comms' && /Waiting\s*1/.test(document.getElementById('commsFilter').innerText)), 'the Mac shows Communications: James is waiting on him (Waiting 1)', await S2.evaluate(() => document.getElementById('commsFilter').innerText));
  const needs0 = await needsN(S2);
  // the phone: a morning sweep — with one write that will fail
  await S.evaluate(() => {
    const proto = firebase.firestore.DocumentReference.prototype, orig = proto.set;
    window.__failOn = 'Fail me';
    proto.set = function(data){ if (window.__failOn && data && data.title === window.__failOn && /ledger_conversations/.test(this.path)) return Promise.reject(Object.assign(new Error('simulated'), { code: 'unavailable' })); return orig.apply(this, arguments); };
  });
  await S.click('#commsCapture'); await S.waitForSelector('#cqText');
  await S.evaluate(() => [...document.querySelectorAll('[data-chips="cqcat"] .cd-chip')].find(c => c.textContent === 'Business').click());
  await S.fill('#cqText', '• James — reply about accounts\n1. Fail me — this one fails first\n\nDaniel — WhatsApp about meeting\n');
  await S.click('#cqPreview'); await S.waitForSelector('#cqpRows .cq-row');
  check(await S.evaluate(() => /Updates James/.test(document.querySelector('#cqpRows .cq-row .cq-meta').textContent)), 'James is recognised: "Updates James"');
  check(await S.evaluate(() => /No category/.test(document.querySelector('#cqpRows .cq-row .cq-meta').textContent) && document.querySelector('#cqpCat .cd-chip.sel').textContent === 'Business'),
    'the list is Business; James, matched, keeps his (none): "No category"');
  await S.click('#cqpSave');
  check(await until(S, () => /2 saved\. 1 couldn’t be/.test(document.getElementById('cqpErr').textContent) && /Try the 1 again/.test(document.getElementById('cqpSave').textContent)), 'a partial failure says so: "2 saved. 1 couldn’t be…", "Try the 1 again"');
  check(await S.evaluate(() => [...document.querySelectorAll('#cqpRows .cq-name')].map(i => i.value).join() === 'Fail me'), '…and only the one that failed stays in the list');
  await S.screenshot({ path: `${shots}/${tag}-CQ1-partial.png` });
  check(!(await S.evaluate(() => [...document.querySelectorAll('#commsRows *')].some(e => e.children.length === 0 && /Fail me/.test(e.textContent)))), 'what failed isn\'t shown as if it were saved');
  await S.evaluate(() => { window.__failOn = null; });
  await S.click('#cqpSave');
  check(await until(S, () => !document.getElementById('sheetBackdrop').classList.contains('open')) && /1 person added/.test(await toast(S)), 'retry: "1 person added", the sheet closes');
  await sleep(1500);
  const cs = await convs();
  const jm = cs.find(c => c.id === 'c1');
  check(cs.filter(c => c.title === 'Daniel').length === 1 && cs.filter(c => c.title === 'Fail me').length === 1 && cs.filter(c => c.title === 'James').length === 1, 'one of each — no duplicates from the retry');
  check(jm.attentionState === 'needs_me' && jm.summary === 'reply about accounts' && jm.matterId === 'm1' && jm.log.filter(e => e.kind === 'received').length === 1
    && jm.log.some(e => e.text === 'Was: Sent draft') && jm.log[0].text === 'Started · Waiting on James', 'James updated once: Needs me, still in Accounts, his history intact with "Was: Sent draft"');
  check((await all('ledger_commitments')).length === 1, 'no Action was made');
  check(!('category' in jm) && ['Daniel', 'Fail me'].every(n => { const c = cs.find(x => x.title === n); return c.category === 'business' && Array.isArray(c.tags) && c.tags.length === 0; }),
    'categories: the new two are Business with an empty tags list; James, an existing record, is not reclassified');
  // the Mac, live
  check(await until(S2, (n) => { const b = document.querySelector('[data-comms-filter="needs"] .cf-n'); return Number((b && b.textContent) || 0) === n; }, needs0 + 3, 15000), 'the Mac\'s Needs me count follows at once: ' + needs0 + ' → ' + (needs0 + 3));
  check(await until(S2, () => ['James', 'Daniel', 'Fail me'].every(n => document.getElementById('commsRows').innerText.indexOf(n) > -1)), '…with all three under Needs me');
  await S2.click('nav.tabbar .tab-btn[data-view="log"]');
  check(await until(S2, () => /3 need you/.test(document.querySelector('main').innerText)), 'and Today on the Mac: "3 need you"');
  await S2.screenshot({ path: `${shots}/${tag}-CQ2-mac-today.png` });
  // categories across devices: the Mac filters to Business, and gives James a category; the phone follows
  await S2.click('nav.tabbar .tab-btn[data-view="comms"]'); await S2.click('[data-comms-cat="business"]');
  check(await until(S2, () => { const t = document.getElementById('commsRows').innerText; return /Daniel/.test(t) && /Fail me/.test(t) && !/James/.test(t); })
    && await needsN(S2) === 2, 'the Mac, Business: Daniel and Fail me, not James — Needs me 2');
  await S2.click('[data-comms-cat="all"]');
  await S2.evaluate(() => [...document.querySelectorAll('#commsRows .cv-row')].find(x => /James/.test(x.innerText)).click());
  await S2.waitForSelector('[data-chips="category"]');
  await S2.evaluate(() => [...document.querySelectorAll('[data-chips="category"] .cd-chip')].find(c => c.textContent === 'Personal').click());
  await S.click('[data-comms-cat="personal"]');
  check(await until(S, () => /James/.test(document.getElementById('commsRows').innerText), null, 15000), 'James set to Personal on the Mac shows under Personal on the phone');
  const j3 = (await convs()).find(c => c.id === 'c1');
  check(j3.category === 'personal' && j3.summary === 'reply about accounts' && j3.matterId === 'm1' && j3.log.some(e => e.text === 'Category: Personal'), '…stored on his record, noted in his history, nothing else changed');
  check(await S.evaluate(() => localStorage.getItem('ledger_comms_category')) === 'personal' && await S2.evaluate(() => localStorage.getItem('ledger_comms_category')) === 'all', 'the filter is per device (phone Personal, Mac All)');
  await S.screenshot({ path: `${shots}/${tag}-CQ3-personal.png` });
  // owner-private: a partner can't read any of it
  const A = await session('abi');
  await signIn(A, ABI);
  await until(A, () => !document.getElementById('partnerApp').hidden, null, 20000);
  const probe = await A.evaluate(async () => { const out = {}; for (const c of ['ledger_conversations', 'ledger_matters']) { try { await firebase.firestore().collection(c).get(); out[c] = 'ALLOWED'; } catch (e){ out[c] = e.code; } } return out; });
  check(Object.values(probe).every(v => v === 'permission-denied'), 'Abi is refused Communications: ' + JSON.stringify(probe));
  check(!/Fail me|WhatsApp about meeting|this one fails/.test(await A.evaluate(() => document.body.innerText)), 'nothing captured is on her screen');
  for (const p of [S, S2, A]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.slice(0, 3).join(' | ').slice(0, 400));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  if (bad.length) console.log(bad.join('\n'));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
