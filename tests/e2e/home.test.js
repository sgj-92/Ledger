// Home, end to end: Shaun (owner), Abi (partner) and Maria, who helps at home (household),
// in three browsers over the Auth and Firestore emulators, which enforce ../../firestore.rules.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node home.test.js [shots-dir] [dark|light] [width]"
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
const PORT = 8951;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
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
  // a clean emulator
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const SHAUN = 'shaun@example.com', ABI = 'abi@example.com', MARIA = 'maria@example.com';
  const owner = await signUp(SHAUN), abi = await signUp(ABI), maria = await signUp(MARIA);
  await put(`ledger_users/${owner}`, { role: 'owner', displayName: 'Shaun', email: SHAUN, createdAt: TODAY });
  await put(`ledger_users/${abi}`, { role: 'partner', displayName: 'Abi', email: ABI, createdAt: TODAY });
  await put(`ledger_users/${maria}`, { role: 'household', displayName: 'Maria', email: MARIA, createdAt: TODAY });
  await put(`ledger_share_members/${owner}_${abi}`, { ownerUid: owner, partnerUid: abi, role: 'partner', active: true, displayName: 'Abi', ownerName: 'Shaun', createdAt: TODAY });
  await put(`ledger_commitments/k1`, { date: TODAY, originalDate: TODAY, title: 'Finish the quarterly plan', category: 'work', status: 'planned', priorityId: null, minVersion: null, disruptionReason: null, createdAt: '2026-10-01T08:00:00.000Z' });
  await put(`ledger_plans/${TODAY}`, { trainingTypes: ['hiit'], dayNotes: 'SECRET NOTE — private', meals: [] });
  await put(`ledger_life_context/lc1`, { category: 'illness', startDate: TODAY, endDate: null, status: 'active', areas: ['day'], note: 'PRIVATE-LC' });
  await put(`ledger_shared_requests/legacy1`, { ownerUid: owner, partnerUid: abi, text: 'Old request from before Home', note: null, requestedTiming: 'today', requestedDate: null, status: 'requested', plannedDate: null, linkedActionId: null, createdAt: '2026-10-10T09:00:00.000Z', updatedAt: '2026-10-10T09:00:00.000Z' });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  async function session(name){
    const ctx = await b.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', timezoneId: 'Europe/London', acceptDownloads: true });
    await ctx.route(/api\.github\.com/, r => r.abort());
    await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, r => {
      const f = r.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
      r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
    });
    await ctx.addInitScript(t => { localStorage.setItem('ledger_emulator', '1'); localStorage.setItem('ledger_theme', t); }, theme);
    const p = await ctx.newPage(); p.errs = []; p.name = name;
    p.on('pageerror', e => p.errs.push(String(e)));
    p.logs = []; p.on('console', m => { if (/home|Home/.test(m.text())) p.logs.push(m.type() + ': ' + m.text()); });
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|permission|Missing or insufficient|offline|net::ERR/i.test(m.text())) p.errs.push('console: ' + m.text()); });
    p.on('response', r => { if (r.status() === 404) p.errs.push('404 ' + r.url()); });
    p.dialogs = []; p.on('dialog', d => { p.dialogs.push(d.message()); d.accept(); });
    return p;
  }
  let lastLink = null;
  async function signIn(p, email){
    await p.goto(APP);
    await p.waitForSelector('#authEmail', { timeout: 20000 });
    await p.fill('#authEmail', email); await p.click('#authSend');
    await p.waitForSelector('#authLink', { timeout: 15000 });
    lastLink = await oobLink(email);
    await p.fill('#authLink', lastLink);
    await p.click('#authPasteForm button[type=submit]');
  }
  const until = async (p, fn, arg, t) => { try { await p.waitForFunction(fn, arg, { timeout: t || 12000 }); return true; } catch (e){ return false; } };
  const txt = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
  async function openSettings(p){
    await p.click('.tab-btn[data-view="focus"]');
    await p.locator('#openSettingsBtn').scrollIntoViewIfNeeded(); await p.click('#openSettingsBtn');
  }
  async function backToToday(p){ await p.click('.tab-btn[data-view="log"]'); await sleep(200); }
  async function openShare(p){ await p.locator('#shareSnapFootBtn').scrollIntoViewIfNeeded(); await p.click('#shareSnapFootBtn'); }
  async function deleteFromDay(p, dateStr, t){
    for (let i = 0; i < 7 && !(await p.$(rowSel(t))); i++){ await p.click('#dayNextBtn'); await sleep(250); }
    await editRow(p, t); await p.click('#deleteCommitBtn');
    for (let i = 0; i < 7; i++){ const back = await p.$('#dayPrevBtn'); if (!back) break; if (await p.evaluate(() => /Today/i.test(document.getElementById('topDateLabel').textContent))) break; await p.click('#dayPrevBtn'); await sleep(250); }
  }
  const rowSel = t => `#commitmentsList .commitment-item:has-text("${t}")`;
  async function completeRow(p, t){ await p.locator(rowSel(t) + ' .commitment-status-dot').scrollIntoViewIfNeeded(); await p.click(rowSel(t) + ' .commitment-status-dot'); }
  async function editRow(p, t){ await p.locator(rowSel(t) + ' .ct-text').scrollIntoViewIfNeeded(); await p.click(rowSel(t) + ' .ct-text'); await p.waitForSelector('#saveCommitBtn'); }

  const HR = 'ledger_home_requests';
  const reqByText = async t => (await all(HR)).find(r => r.text === t);
  const titles = (p, scope) => p.evaluate(s => [...document.querySelectorAll(s + ' .hm-li .rq-li-t')].map(e => e.textContent), scope);
  const openRow = (p, scope, t) => p.evaluate(([s, t]) => { const e = [...document.querySelectorAll(s + ' .hm-li .rq-li-t')].find(x => x.textContent === t); if (!e) return false; e.closest('button').click(); return true; }, [scope, t]);
  const chip = (p, group, label) => p.evaluate(([g, l]) => { const b = [...document.querySelectorAll(g + ' .bk-filter-chip')].find(x => x.textContent === l); if (!b) return false; b.click(); return true; }, [group, label]);
  const toast = p => p.evaluate(() => (document.querySelector('.pin-toast') || {}).textContent || '');
  async function newRequest(p, o){
    await p.waitForSelector('#hnText');
    if (o.from) check(await chip(p, '#hnFrom', o.from), 'chose Asked by ' + o.from);
    check(await chip(p, '#hnFor', o.for), 'chose For ' + o.for);
    await p.fill('#hnText', o.text);
    if (o.timing) await p.click('[data-hn-timing="' + o.timing + '"]');
    if (o.shared) await p.click('#hnShare');
    await p.click('#hnSave');
    await until(p, t => !!document.querySelector('#hmList, #hpList, #ppHomeList') && !document.getElementById('hnText'), null, 8000);
    await sleep(500);
  }
  const sx = p => p.evaluate(() => { const el = document.getElementById('partnerApp'); return Math.max(document.documentElement.scrollWidth, el && !el.hidden ? el.scrollWidth : 0) <= innerWidth + 1; });

  // H1 — Shaun sets up Home: Abi joins as an admin with it
  const S = await session('shaun');
  await signIn(S, SHAUN);
  check(await until(S, () => /Finish the quarterly plan/.test(document.querySelector('main').innerText), null, 20000), 'H1 Shaun\'s Ledger opens');
  check(await S.evaluate(() => !document.getElementById('homeRowBtn')), 'H1 no Home row before Home exists');
  await openSettings(S);
  await S.waitForSelector('#setHomeCreate', { timeout: 15000 });
  await S.screenshot({ path: `${shots}/${tag}-H1-settings-setup.png` });
  await S.click('#setHomeCreate');
  check(await until(S, () => !!document.getElementById('setHomePeople'), null, 15000), 'H1 Settings → Set up Home');
  const mem1 = await all('ledger_home_members');
  check(mem1.length === 2 && mem1.find(m => m.id === owner).role === 'admin' && mem1.find(m => m.id === abi).role === 'admin' && mem1.every(m => m.homeId === owner && m.status === 'active'),
    'H1 Shaun and Abi are at Home, both admins');
  // H2 — Shaun adds Maria (her household role was granted outside the app)
  await S.click('#setHomePeople'); await S.waitForSelector('#hpeAdd'); await S.click('#hpeAdd');
  check(await until(S, () => [...document.querySelectorAll('#haList .act-row')].some(r => /Maria/.test(r.innerText))), 'H2 Add someone lists Maria\'s household account');
  await S.evaluate(() => [...document.querySelectorAll('#haList .act-row')].find(r => /Maria/.test(r.innerText)).click());
  await S.fill('#haLabel', 'Nanny'); await S.click('#haSave');
  check(await until(S, () => /Maria/.test((document.getElementById('hpeList') || {}).innerText || '')), 'H2 Maria is at Home');
  await S.screenshot({ path: `${shots}/${tag}-H2-people.png` });
  const mm = (await all('ledger_home_members')).find(m => m.id === maria);
  check(mm && mm.role === 'member' && mm.label === 'Nanny' && mm.status === 'active' && mm.addedByUid === owner, 'H2 as a member, "Nanny", added by Shaun');
  await S.click('#sheetCloseBtn');
  // earlier Partner Sharing requests: offered once, moved by the server (tested in the push suite)
  await openSettings(S);
  check(await until(S, () => /Bring in requests with Abi/.test((document.getElementById('setHomeMigrate') || {}).textContent || '')), 'H2 Settings offers "Bring in requests with Abi" while earlier ones exist');
  await S.click('#setHomeMigrate');
  check(await until(S, () => true) && await (async () => { await sleep(800); const m = (await all('ledger_meta')).find(d => d.id === 'homeMigration'); return !!m && m.status === 'requested' && m.requestedBy === owner; })(), 'H2 tapping it asks the server to move them (ledger_meta/homeMigration, owner-only)');
  await S.click('#sheetCloseBtn'); await backToToday(S);

  // H3 — Maria signs in: Home, and nothing of Ledger
  const M = await session('maria');
  await signIn(M, MARIA);
  check(await until(M, () => !document.getElementById('partnerApp').hidden && /Hi, Maria/.test(document.getElementById('partnerApp').innerText), null, 20000), 'H3 Maria\'s app: "Hi, Maria"');
  check(await until(M, () => /Nothing at Home yet/.test(document.getElementById('hpList').innerText)), 'H3 nothing at Home yet');
  const probe = await M.evaluate(async (ids) => {
    const db = firebase.firestore(), out = {};
    const tryIt = async (k, f) => { try { await f(); out[k] = 'ALLOWED'; } catch (e){ out[k] = e.code; } };
    for (const c of ['ledger_commitments', 'ledger_plans', 'ledger_sessions', 'ledger_life_context', 'ledger_meta', 'ledger_day_status', 'ledger_action_updates'])
      await tryIt(c, () => db.collection(c).get());
    await tryIt('snapshots', () => db.collection('ledger_shared_snapshots').where('ownerUid', '==', ids.owner).where('partnerUid', '==', ids.abi).get());
    await tryIt('partner requests', () => db.collection('ledger_shared_requests').where('ownerUid', '==', ids.owner).get());
    await tryIt('Shaun\'s profile', () => db.collection('ledger_users').doc(ids.owner).get());
    await tryIt('the whole Home', () => db.collection('ledger_home_requests').where('homeId', '==', ids.owner).get());
    await tryIt('add herself as admin', () => db.collection('ledger_home_members').doc(ids.maria).update({ role: 'admin' }));
    return out;
  }, { owner, abi, maria });
  check(Object.values(probe).every(v => v === 'permission-denied'), 'H3 Maria is refused every private read, Partner Sharing, the whole Home and a role change: ' + JSON.stringify(probe));
  check((await M.evaluate(() => Object.keys(localStorage).filter(k => /fallback/.test(k)))).length === 0, 'H3 her device holds no Ledger data');
  check(!/SECRET|PRIVATE-LC|quarterly/.test(await M.evaluate(() => document.documentElement.innerHTML)), 'H3 nothing private on her page');
  await M.screenshot({ path: `${shots}/${tag}-H3-maria-empty.png` });

  // H4 — Shaun asks Maria; she starts and finishes it; Shaun sees it done
  check(await until(S, () => !!document.getElementById('homeRowBtn')), 'H4 Today has a quiet Home row');
  await S.click('#homeRowBtn'); await S.waitForSelector('#hmNew'); await S.click('#hmNew');
  await newRequest(S, { for: 'Maria', text: 'Bath at six', timing: 'today' });
  check(/Sent to Maria/.test(await toast(S)), 'H4 "Sent to Maria"');
  const bath = await reqByText('Bath at six');
  check(bath && bath.requesterUid === owner && bath.assigneeUid === maria && bath.createdByUid === owner && bath.visibility === 'private', 'H4 stored: from Shaun, for Maria, written by Shaun, private');
  check(await until(M, () => [...document.querySelectorAll('#hpList .hm-li')].some(r => /Bath at six/.test(r.innerText))), 'H4 Maria sees it (For you)');
  await M.screenshot({ path: `${shots}/${tag}-H4-maria-for-you.png` });
  await openRow(M, '#hpList', 'Bath at six');
  check(await until(M, () => /From Shaun/.test(document.getElementById('hdKicker').textContent) && !!document.getElementById('hdStart')), 'H4 her detail: "From Shaun", Start / Done / Can\'t do');
  await M.screenshot({ path: `${shots}/${tag}-H4-maria-detail.png` });
  await M.click('#hdStart');
  check(await until(M, () => /In progress/.test(document.getElementById('hdState').textContent)), 'H4 Start → In progress');
  await M.click('#hdDone');
  check(await until(M, () => /Done/.test(document.getElementById('hdState').textContent) && /Done ✓/.test(document.getElementById('hdTimeline').innerText)), 'H4 Done → Done ✓, in its history');
  await M.fill('#rqText', 'All asleep by seven'); await M.click('#rqSend');
  check(await until(M, () => /All asleep by seven/.test(document.getElementById('hdTimeline').innerText)), 'H4 Maria adds an update');
  await M.click('#ppSheet .sheet-close');
  check(await until(S, () => /1 update/.test((document.getElementById('homeRowValue') || {}).textContent || '')), 'H4 Shaun\'s Home row: "1 update"');
  check(await until(S, () => [...document.querySelectorAll('#hmList .hm-li')].some(r => /Bath at six/.test(r.innerText) && /Done/.test(r.innerText))), 'H4 Shaun\'s Home sheet shows it done');
  await openRow(S, '#hmList', 'Bath at six');
  check(await until(S, () => /All asleep by seven/.test(document.getElementById('hdTimeline').innerText) && /Started/.test(document.getElementById('hdTimeline').innerText)), 'H4 Shaun reads its history: Started, Done ✓, her update');
  await S.click('#sheetCloseBtn');
  check(await until(S, () => /Nothing open|open/.test((document.getElementById('homeRowValue') || {}).textContent || '') && !/update/.test(document.getElementById('homeRowValue').textContent)), 'H4 …and the update is read');

  // H5 — Maria asks Abi; Abi can't, and passes it to Shaun; Shaun takes it on as one Action
  const A = await session('abi');
  await signIn(A, ABI);
  check(await until(A, () => !document.getElementById('partnerApp').hidden && !!document.getElementById('ppHomeList'), null, 20000), 'H5 Abi\'s portal has Home');
  check(await until(A, () => /Earlier requests/i.test(document.getElementById('partnerApp').innerText) && /Old request from before Home/.test(document.getElementById('partnerApp').innerText)), 'H5 …and her earlier requests, until they move into Home');
  await M.click('#hpNew');
  check(await until(M, () => !document.getElementById('hnFrom') && [...document.querySelectorAll('#hnFor .bk-filter-chip')].map(b => b.textContent).join('|') === 'Abi|Shaun'), 'H5 Maria asks for herself only, of Abi or Shaun');
  await newRequest(M, { for: 'Abi', text: 'Nappies running low' });
  check(await until(A, () => [...document.querySelectorAll('#ppHomeList .hm-li')].some(r => /Nappies running low/.test(r.innerText))), 'H5 Abi sees it, for her');
  await openRow(A, '#ppHomeList', 'Nappies running low');
  await A.waitForSelector('#hdCant'); await A.click('#hdCant');
  await A.waitForSelector('#hcReason'); await A.fill('#hcReason', 'Out until Friday'); await A.click('#hcSave');
  check(await until(A, () => /Can’t do — “Out until Friday”/.test((document.getElementById('hdState') || {}).textContent || '')), 'H5 Abi: Can\'t do, with a reason');
  check(await until(M, () => [...document.querySelectorAll('#hpList .hm-li')].some(r => /Nappies running low/.test(r.innerText) && /Can’t do/.test(r.innerText))), 'H5 Maria sees "Can\'t do"');
  await A.click('#hdPass'); await A.waitForSelector('#hpList .act-row');
  check(await A.evaluate(() => [...document.querySelectorAll('#hpList .act-row')].map(r => r.innerText.trim()).join('|') === 'Shaun'), 'H5 Pass on: to Shaun (never back to Maria, who asked)');
  await A.evaluate(() => document.querySelector('#hpList .act-row').click());
  check(await until(A, () => /Abi passed it to Shaun|You passed it to Shaun/.test((document.getElementById('hdTimeline') || {}).innerText || '')), 'H5 history: "You passed it to Shaun"');
  await A.click('#ppSheet .sheet-close');
  const nap = await reqByText('Nappies running low');
  check(nap.assigneeUid === owner && nap.requesterUid === maria && nap.status === 'requested' && nap.participants.sort().join() === [maria, abi, owner].sort().join(), 'H5 now Shaun\'s; Maria still asked it; Abi stays in it');
  check(await until(S, () => [...document.querySelectorAll('#inboxSection .ib-row')].some(r => /Nappies running low/.test(r.innerText) && /From Maria/i.test(r.innerText))), 'H5 Shaun\'s Inbox: "From Maria"');
  await S.screenshot({ path: `${shots}/${tag}-H5-owner-inbox.png` });
  await S.evaluate(t => { const r = [...document.querySelectorAll('#inboxSection .ib-row')].find(x => x.innerText.indexOf(t) > -1); const b = r.querySelector('[data-hb-today]'); b.click(); b.click(); }, 'Nappies running low');
  await sleep(1500);
  const napActs = (await all('ledger_commitments')).filter(c => c.sourceRequestId === nap.id);
  check(napActs.length === 1 && napActs[0].sourceType === 'home_request' && napActs[0].title === 'Nappies running low' && napActs[0].sourceLabel === 'Maria', 'H5 Today: exactly one Action (two taps), marked from Maria');
  check(await until(M, () => [...document.querySelectorAll('#hpList .hm-li')].some(r => /Nappies running low/.test(r.innerText) && /Planned today/.test(r.innerText))), 'H5 Maria sees "Planned today"');
  check(!/Finish the quarterly plan/.test(await M.evaluate(() => document.documentElement.innerHTML)) && (await reqByText('Nappies running low')).linkedActionId === napActs[0].id, 'H5 only the Action\'s id is shared; nothing else of Shaun\'s Ledger');
  // Shaun completes the Action → the request is done
  await S.evaluate(id => firebase.firestore().collection('ledger_commitments').doc(id).update({ status: 'completed' }), napActs[0].id);
  check(await until(M, () => [...document.querySelectorAll('#hpList .hm-li')].some(r => /Nappies running low/.test(r.innerText) && /Done/.test(r.innerText)), null, 15000), 'H5 Shaun completes his Action → Maria sees it done');

  // H6 — what Maria can't see, and what is shared with the whole Home
  await A.click('#ppHomeNew'); await newRequest(A, { for: 'Shaun', text: 'Private between us' });
  await A.click('#ppHomeNew'); await newRequest(A, { for: 'Shaun', text: 'Tidy the playroom together', shared: true });
  check(await until(S, () => [...document.querySelectorAll('#inboxSection .ib-row')].filter(r => /Private between us|Tidy the playroom together/.test(r.innerText)).length === 2), 'H6 both reach Shaun');
  check(await until(M, () => [...document.querySelectorAll('#hpList .hm-li')].some(r => /Tidy the playroom together/.test(r.innerText))), 'H6 Maria sees the one shared with everyone at Home');
  check(!(await titles(M, '#hpList')).includes('Private between us'), 'H6 …but never the private one between Shaun and Abi');
  const priv = await reqByText('Private between us');
  check(await M.evaluate(async id => { try { await firebase.firestore().collection('ledger_home_requests').doc(id).get(); return 'ALLOWED'; } catch (e){ return e.code; } }, priv.id) === 'permission-denied', 'H6 a direct read of it is refused');
  await M.screenshot({ path: `${shots}/${tag}-H6-maria-shared.png` });

  // H7 — on someone's behalf: Shaun records Maria asking Abi
  await S.click('#homeRowBtn'); await S.waitForSelector('#hmNew'); await S.click('#hmNew');
  await newRequest(S, { from: 'Maria', for: 'Abi', text: 'Spare key for Saturday' });
  const key = await reqByText('Spare key for Saturday');
  check(key && key.requesterUid === maria && key.assigneeUid === abi && key.createdByUid === owner && key.participants.sort().join() === [maria, abi, owner].sort().join(), 'H7 stored: asked by Maria, for Abi, written by Shaun');
  await S.click('#sheetCloseBtn');
  check(await until(A, () => [...document.querySelectorAll('#ppHomeList .hm-li')].some(r => /Spare key for Saturday/.test(r.innerText) && /From Maria · added by Shaun/i.test(r.innerText))), 'H7 Abi: "From Maria · added by Shaun"');
  check(await until(M, () => [...document.querySelectorAll('#hpList .hm-li')].some(r => /Spare key for Saturday/.test(r.innerText))), 'H7 Maria sees it under what she asked');
  await openRow(M, '#hpList', 'Spare key for Saturday');
  check(await until(M, () => /Created by Shaun on your behalf/.test(document.getElementById('hdTimeline').innerText)), 'H7 her history: "Created by Shaun on your behalf"');
  await M.click('#ppSheet .sheet-close');
  const forged = await M.evaluate(async (ids) => {
    const db = firebase.firestore(), out = {};
    const tryIt = async (k, f) => { try { await f(); out[k] = 'ALLOWED'; } catch (e){ out[k] = e.code; } };
    const base = { homeId: ids.owner, text: 'Forged', note: null, requestedTiming: 'today', requestedDate: null, visibility: 'private', status: 'requested', plannedDate: null, linkedActionId: null, createdAt: 'x', updatedAt: 'x' };
    await tryIt('as Shaun', () => db.collection('ledger_home_requests').add(Object.assign({}, base, { requesterUid: ids.maria, assigneeUid: ids.abi, createdByUid: ids.owner, participants: [ids.maria, ids.abi, ids.owner] })));
    await tryIt('for Abi, from Shaun', () => db.collection('ledger_home_requests').add(Object.assign({}, base, { requesterUid: ids.owner, assigneeUid: ids.abi, createdByUid: ids.maria, participants: [ids.owner, ids.abi, ids.maria] })));
    await tryIt('rewrite who asked', () => db.collection('ledger_home_requests').doc(ids.key).update({ requesterUid: ids.abi }));
    return out;
  }, { owner, abi, maria, key: key.id });
  check(Object.values(forged).every(v => v === 'permission-denied'), 'H7 Maria cannot write as Shaun, ask on someone\'s behalf, or rewrite who asked: ' + JSON.stringify(forged));

  // H8 — deleting, as in Phase A: gone for everyone
  await M.click('#hpNew'); await newRequest(M, { for: 'Shaun', text: 'Typo reqest' });
  check(await until(S, () => [...document.querySelectorAll('#inboxSection .ib-row')].some(r => /Typo reqest/.test(r.innerText))), 'H8 it reaches Shaun');
  await openRow(M, '#hpList', 'Typo reqest');
  await M.waitForSelector('#hdDelBtn'); await M.click('#hdDelBtn'); await M.waitForSelector('#rqDelGo');
  check(/Delete this request\?/.test(await txt(M, '#ppSheet')) && /both people.s request lists/.test(await txt(M, '#ppSheet')), 'H8 the same confirmation as Phase A');
  await M.click('#rqDelGo');
  check(await until(M, () => /Request deleted/.test((document.querySelector('.pin-toast') || {}).textContent || '') && ![...document.querySelectorAll('#hpList .rq-li-t')].some(x => x.textContent === 'Typo reqest')), 'H8 deleted: gone from Maria\'s list');
  check(await until(S, () => ![...document.querySelectorAll('#inboxSection .ib-row')].some(r => /Typo reqest/.test(r.innerText))), 'H8 …and from Shaun\'s Inbox');
  const typo = await reqByText('Typo reqest');
  check(typo.deletedAt && typo.deletedByUid === maria, 'H8 soft-deleted, by Maria');

  // H9 — following Home: Abi chooses to hear what Shaun asks Maria; nobody else changes
  await A.click('#ppNotify'); await A.waitForSelector('#ntOversight');
  check(await A.evaluate(() => document.getElementById('ntOversight').getAttribute('aria-checked') === 'false'), 'H9 Abi: "Requests between others" is off by default');
  await A.click('#ntOversight');
  check(await until(A, () => document.getElementById('ntOversight').getAttribute('aria-checked') === 'true'), 'H9 she turns it on');
  await A.screenshot({ path: `${shots}/${tag}-H9-abi-notifications.png` });
  await A.click('#ppSheet .sheet-close');
  check((await all('ledger_notification_prefs')).find(p => p.id === abi).homeOversight === true, 'H9 saved as her own choice');
  await M.click('#ppNotify'); await M.waitForSelector('#ntPartner');
  check(!(await M.$('#ntOversight')) && !(await M.$('#ntFocus')) && /Requests &/.test(await txt(M, '#ntPartner')), 'H9 Maria: requests & updates only (she follows nobody else\'s)');
  await M.click('#ppSheet .sheet-close');

  // H10 — removing someone ends their access at once; adding them back restores it
  await openSettings(S); await S.waitForSelector('#setHomePeople'); await S.click('#setHomePeople');
  await S.evaluate(() => [...document.querySelectorAll('#hpeList .act-row')].find(r => /Maria/.test(r.innerText)).click());
  await S.waitForSelector('#hmmRemove'); await S.click('#hmmRemove');
  check(await until(M, () => document.getElementById('authCard').getAttribute('data-state') === 'home' && /no longer at Home/.test(document.getElementById('authCard').innerText), null, 15000), 'H10 Maria removed: "You’re no longer at Home"');
  check(await M.evaluate(async id => { try { await firebase.firestore().collection('ledger_home_requests').doc(id).get(); return 'ALLOWED'; } catch (e){ return e.code; } }, bath.id) === 'permission-denied', 'H10 …and the rules refuse her own requests now');
  await S.waitForSelector('#hpeList'); await S.evaluate(() => [...document.querySelectorAll('#hpeList .act-row')].find(r => /Maria/.test(r.innerText)).click());
  await S.waitForSelector('#hmmBack'); await S.click('#hmmBack');
  check(await until(M, () => !document.getElementById('partnerApp').hidden && [...document.querySelectorAll('#hpList .hm-li')].some(r => /Bath at six/.test(r.innerText)), null, 15000), 'H10 added back: her Home and its history return');
  await S.click('#sheetCloseBtn');

  // H12 — someone new creates an account from the sign-in screen (no link, no Console)
  const N = await session('newbie');
  await N.goto(APP); await N.waitForSelector('#authEmail', { timeout: 20000 });
  await N.fill('#authEmail', 'newbie@example.com'); await N.fill('#authPassword', 'whatever-123'); await N.click('#authSignIn');
  check(await until(N, () => /New here\? Create an account/.test(document.getElementById('authError').textContent)), 'H12 a sign-in with no account says "New here? Create an account"');
  await N.click('#authCreateGo');
  check(await until(N, () => document.getElementById('authCard').getAttribute('data-state') === 'create' && document.getElementById('authEmail').value === 'newbie@example.com'), 'H12 Create your account, with the email carried over');
  await N.screenshot({ path: `${shots}/${tag}-H12-create.png` });
  await N.fill('#authNewPassword', 'short'); await N.click('#authCreate');
  check(/at least 8/.test(await txt(N, '#authError')), 'H12 a short password is refused');
  await N.fill('#authNewPassword', 'a-good-password-9'); await N.click('#authCreate');
  check(await until(N, () => document.getElementById('authCard').getAttribute('data-state') === 'noaccess' && /\S{20,}/.test((document.querySelector('[data-role="auth-uid"]') || {}).textContent || ''), null, 20000),
    'H12 account created: "isn’t set up for Ledger" with the Account ID to send');
  check(await N.evaluate(() => /joining someone.s Ledger or Home/.test(document.getElementById('authCard').innerText)), 'H12 …and says what to do with it');
  const newbieProbe = await N.evaluate(async () => { try { await firebase.firestore().collection('ledger_home_requests').where('homeId', '==', 'x').get(); return 'ALLOWED'; } catch (e){ return e.code; } });
  check(newbieProbe === 'permission-denied', 'H12 a new account opens nothing on its own');
  await N.context().close();
  const N2 = await session('existing');
  await N2.goto(APP); await N2.waitForSelector('#authCreateGo', { timeout: 20000 });
  await N2.click('#authCreateGo'); await N2.waitForSelector('#authNewPassword');
  await N2.fill('#authEmail', ABI); await N2.fill('#authNewPassword', 'another-pass-9'); await N2.click('#authCreate');
  check(await until(N2, () => /already an account for this email/.test(document.getElementById('authError').textContent)), 'H12 an email that already has an account: "Sign in instead"');
  await N2.context().close();

  // H11 — the partner portal still does what it did
  check(await A.evaluate(() => /Nothing shared for today yet/.test(document.getElementById('partnerApp').innerText)), 'H11 Abi\'s shared day is untouched');
  // layout and errors
  check(await sx(M) && await sx(A), 'no horizontal scroll (Maria, Abi)');
  await A.screenshot({ path: `${shots}/${tag}-H11-abi-portal.png`, fullPage: true });
  await M.screenshot({ path: `${shots}/${tag}-H11-maria-home.png`, fullPage: true });
  await backToToday(S);
  await S.click('#homeRowBtn'); await S.waitForSelector('#hmList');
  await S.screenshot({ path: `${shots}/${tag}-H11-owner-home.png` });
  await S.click('#sheetCloseBtn');
  for (const p of [S, A, M]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.slice(0, 3).join(' | ').slice(0, 500));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  if (bad.length) console.log(bad.join('\n'));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
