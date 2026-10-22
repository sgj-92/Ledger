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
    await p.click('.tab-btn[data-view="me"]'); await p.click('[data-me-sub="focus"]');
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
  // the Home screen: Shaun's Home tab, Abi's Home tab, Maria's app
  const SH = '#view-home', AH = '#ppHomeScreen', MH = '#hpList';
  const titles = (p, scope) => p.evaluate(s => [...document.querySelectorAll(s + ' .hs-row .commitment-title')].map(e => e.textContent), scope);
  const openRow = (p, scope, t) => p.evaluate(([s, t]) => { const e = [...document.querySelectorAll(s + ' .hs-row .commitment-title')].find(x => x.textContent === t); if (!e) return false; e.closest('.hs-row-body').click(); return true; }, [scope, t]);
  const rowHas = (p, scope, t, re) => until(p, ([s, t, re]) => [...document.querySelectorAll(s + ' .hs-row')].some(r => r.innerText.indexOf(t) > -1 && new RegExp(re, 'i').test(r.innerText)), [scope, t, re || '.']);
  const rowDone = (p, scope, t) => until(p, ([s, t]) => [...document.querySelectorAll(s + ' .hs-row.st-done')].some(r => r.innerText.indexOf(t) > -1), [scope, t], 15000);
  async function goHome(p){
    if (p === S) await p.click('.tab-btn[data-view="home"]');
    else if (p === A) await p.click('[data-pp-tab="home"]');
    await sleep(200);
  }
  async function addSelf(p, text){
    await goHome(p); await p.waitForSelector('#hsAdd'); await p.click('#hsAdd'); await p.waitForSelector('#hamSelf'); await p.click('#hamSelf');
    await p.waitForSelector('#hnText'); await p.fill('#hnText', text); await p.click('#hnSave'); await sleep(800);
  }
  async function addOne(p){ await goHome(p); await p.waitForSelector('#hsAdd'); await p.click('#hsAdd'); await p.waitForSelector('#hamOne'); await p.click('#hamOne'); }
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
    await until(p, () => { const t = document.getElementById('hnText'); return !t || !t.closest('.sheet-backdrop.open'); }, null, 8000);
    await sleep(500);
  }
  const sx = p => p.evaluate(() => { const el = document.getElementById('partnerApp'); return Math.max(document.documentElement.scrollWidth, el && !el.hidden ? el.scrollWidth : 0) <= innerWidth + 1; });

  // H1 — Shaun sets up Home: Abi joins as an admin with it
  let S, A, M;
  S = await session('shaun');
  await signIn(S, SHAUN);
  check(await until(S, () => /Finish the quarterly plan/.test(document.querySelector('main').innerText), null, 20000), 'H1 Shaun\'s Ledger opens');
  await goHome(S);
  check(await until(S, () => !!document.getElementById('hsSetup'), null, 15000), 'H1 the Home tab, one tap away, offers "Set up Home" before Home exists');
  await S.screenshot({ path: `${shots}/${tag}-H1-home-setup.png` });
  await backToToday(S);
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
  M = await session('maria');
  await signIn(M, MARIA);
  check(await until(M, () => !document.getElementById('partnerApp').hidden && /Hi, Maria/.test(document.getElementById('partnerApp').innerText), null, 20000), 'H3 Maria\'s app: "Hi, Maria"');
  check(await until(M, () => /Nothing at Home yet/.test(document.getElementById('hpList').innerText)), 'H3 nothing at Home yet');
  check(await M.evaluate(() => { const n = document.querySelector('nav.tabbar'); return n.inert && n.getAttribute('aria-hidden') === 'true'; }), 'H3 Shaun\'s tabs stay locked away (inert) behind her app');
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
  await addOne(S);
  await newRequest(S, { for: 'Maria', text: 'Bath at six', timing: 'today' });
  check(/Sent to Maria/.test(await toast(S)), 'H4 "Sent to Maria"');
  const bath = await reqByText('Bath at six');
  check(bath && bath.requesterUid === owner && bath.assigneeUid === maria && bath.createdByUid === owner && bath.visibility === 'private', 'H4 stored: from Shaun, for Maria, written by Shaun, private');
  check(await rowHas(M, MH, 'Bath at six'), 'H4 Maria sees it, today');
  check(await until(M, () => document.querySelector('[data-hs-filter="mine"] .hs-stat-n').textContent === '1'), 'H4 her summary: 1 for her');
  await M.screenshot({ path: `${shots}/${tag}-H4-maria-for-you.png` });
  await openRow(M, MH, 'Bath at six');
  check(await until(M, () => /From Shaun/.test(document.getElementById('hdKicker').textContent) && !!document.getElementById('hdStart')), 'H4 her detail: "From Shaun", Start / Done / Can\'t do');
  await M.screenshot({ path: `${shots}/${tag}-H4-maria-detail.png` });
  await M.click('#hdStart');
  check(await until(M, () => /In progress/.test(document.getElementById('hdState').textContent)), 'H4 Start → In progress');
  await M.click('#hdDone');
  check(await until(M, () => /Done/.test(document.getElementById('hdState').textContent) && /Done ✓/.test(document.getElementById('hdTimeline').innerText)), 'H4 Done → Done ✓, in its history');
  await M.fill('#rqText', 'All asleep by seven'); await M.click('#rqSend');
  check(await until(M, () => /All asleep by seven/.test(document.getElementById('hdTimeline').innerText)), 'H4 Maria adds an update');
  await M.click('#ppSheet .sheet-close');
  await backToToday(S);
  check(await until(S, () => !document.getElementById('homeTabDot').hidden), 'H4 Shaun\'s Home tab carries a dot: Maria\'s update');
  await goHome(S);
  check(await rowDone(S, SH, 'Bath at six'), 'H4 Shaun\'s Home shows it done, under Recent updates');
  check(await S.evaluate(() => [...document.querySelectorAll('#view-home .hs-sec')].some(s => /Recent updates/i.test(s.innerText) && /Bath at six/.test(s.innerText)) && ![...document.querySelectorAll('#view-home .hs-sec')].some(s => /^Today/i.test(s.innerText.trim()) && /Bath at six/.test(s.innerText))), 'H4 …as history, not in Today');
  await openRow(S, SH, 'Bath at six');
  check(await until(S, () => /All asleep by seven/.test(document.getElementById('hdTimeline').innerText) && /Started/.test(document.getElementById('hdTimeline').innerText)), 'H4 Shaun reads its history: Started, Done ✓, her update');
  await S.click('#sheetCloseBtn');
  check(await until(S, () => document.getElementById('homeTabDot').hidden), 'H4 …and once read, the dot goes');
  // H4b — done straight from the row, with Undo
  await addOne(S);
  await newRequest(S, { for: 'Maria', text: 'Fold the laundry', timing: 'today' });
  check(await rowHas(M, MH, 'Fold the laundry'), 'H4b Maria sees "Fold the laundry"');
  const tick = () => M.evaluate(() => { const r = [...document.querySelectorAll('#hpList .hs-row')].find(x => /Fold the laundry/.test(x.innerText)); r.querySelector('.commitment-status-dot').click(); });
  await tick();
  check(await until(M, () => [...document.querySelectorAll('#hpList .hs-row')].some(r => /Fold the laundry/.test(r.innerText) && r.querySelector('.commitment-status-dot.completed')) && /Undo/.test((document.querySelector('.pin-toast') || {}).textContent || '')), 'H4b one tap: it shows done at once, with Undo');
  await M.screenshot({ path: `${shots}/${tag}-H4b-maria-ticked.png` });
  await M.click('.pin-toast-act'); await sleep(5800);
  check((await reqByText('Fold the laundry')).status === 'requested', 'H4b Undo: nothing was written');
  await tick(); await sleep(6000);
  check((await reqByText('Fold the laundry')).status === 'done', 'H4b otherwise it is done once Undo has passed');
  check(await rowDone(S, SH, 'Fold the laundry') && await rowHas(S, SH, 'Fold the laundry', 'Maria completed it'), 'H4b …and Shaun sees it done: "Maria completed it"');

  // H5 — Maria asks Abi; Abi can't, and passes it to Shaun; Shaun takes it on as one Action
  A = await session('abi');
  await signIn(A, ABI);
  check(await until(A, () => !document.getElementById('partnerApp').hidden && !!document.querySelector('[data-pp-tab="home"]') && !!document.getElementById('ppHomeAll'), null, 20000), 'H5 Abi\'s portal: a Home tab, and a way into it from Today');
  check(await until(A, () => /Earlier requests/i.test(document.getElementById('partnerApp').innerText) && /Old request from before Home/.test(document.getElementById('partnerApp').innerText)), 'H5 …and her earlier requests, until they move into Home');
  await A.click('#ppHomeAll');
  check(await until(A, () => !!document.getElementById('ppHomeScreen') && document.querySelector('[data-pp-tab="home"]').classList.contains('sel') && /Hi, Abi/.test(document.getElementById('ppTitle').textContent)), 'H5 …which opens her Home tab');
  await A.screenshot({ path: `${shots}/${tag}-H5-abi-home.png` });
  await addOne(M);
  check(await until(M, () => document.getElementById('hnFromField').hidden && [...document.querySelectorAll('#hnFor .bk-filter-chip')].map(b => b.textContent).join('|') === 'Me|Abi|Shaun'), 'H5 Maria asks as herself, of Abi or Shaun (or adds her own: Me)');
  await newRequest(M, { for: 'Abi', text: 'Nappies running low' });
  check(await rowHas(A, AH, 'Nappies running low'), 'H5 Abi sees it, for her');
  await openRow(A, AH, 'Nappies running low');
  await A.waitForSelector('#hdCant'); await A.click('#hdCant');
  await A.waitForSelector('#hcReason'); await A.fill('#hcReason', 'Out until Friday'); await A.click('#hcSave');
  check(await until(A, () => /Can’t do — “Out until Friday”/.test((document.getElementById('hdState') || {}).textContent || '')), 'H5 Abi: Can\'t do, with a reason');
  check(await rowHas(M, MH, 'Nappies running low', 'Can’t do'), 'H5 Maria sees "Can\'t do"');
  await A.click('#hdPass'); await A.waitForSelector('#hpPassList .act-row');
  check(await A.evaluate(() => [...document.querySelectorAll('#hpPassList .act-row')].map(r => r.innerText.trim()).join('|') === 'Shaun'), 'H5 Pass on: to Shaun (never back to Maria, who asked)');
  await A.evaluate(() => document.querySelector('#hpPassList .act-row').click());
  check(await until(A, () => /Abi passed it to Shaun|You passed it to Shaun/.test((document.getElementById('hdTimeline') || {}).innerText || '')), 'H5 history: "You passed it to Shaun"');
  await A.click('#ppSheet .sheet-close');
  const nap = await reqByText('Nappies running low');
  check(nap.assigneeUid === owner && nap.requesterUid === maria && nap.status === 'requested' && nap.participants.sort().join() === [maria, abi, owner].sort().join(), 'H5 now Shaun\'s; Maria still asked it; Abi stays in it');
  check(await until(S, () => [...document.querySelectorAll('#inboxSection .ib-row')].some(r => /Nappies running low/.test(r.innerText) && /From Maria/i.test(r.innerText))), 'H5 Shaun\'s Inbox: "From Maria"');
  await S.screenshot({ path: `${shots}/${tag}-H5-owner-inbox.png` });
  await backToToday(S);
  await S.evaluate(t => { const r = [...document.querySelectorAll('#inboxSection .ib-row')].find(x => x.innerText.indexOf(t) > -1); const b = r.querySelector('[data-hb-today]'); b.click(); b.click(); }, 'Nappies running low');
  await sleep(1500);
  const napActs = (await all('ledger_commitments')).filter(c => c.sourceRequestId === nap.id);
  check(napActs.length === 1 && napActs[0].sourceType === 'home_request' && napActs[0].title === 'Nappies running low' && napActs[0].sourceLabel === 'Maria', 'H5 Today: exactly one Action (two taps), marked from Maria');
  check(await rowHas(M, MH, 'Nappies running low', 'Planned today'), 'H5 Maria sees "Planned today"');
  check(!/Finish the quarterly plan/.test(await M.evaluate(() => document.documentElement.innerHTML)) && (await reqByText('Nappies running low')).linkedActionId === napActs[0].id, 'H5 only the Action\'s id is shared; nothing else of Shaun\'s Ledger');
  // Shaun completes the Action → the request is done
  await S.evaluate(id => firebase.firestore().collection('ledger_commitments').doc(id).update({ status: 'completed' }), napActs[0].id);
  check(await rowDone(M, MH, 'Nappies running low'), 'H5 Shaun completes his Action → Maria sees it done');

  // H6 — what Maria can't see, and what is shared with the whole Home
  await addOne(A); await newRequest(A, { for: 'Shaun', text: 'Private between us' });
  await addOne(A); await newRequest(A, { for: 'Shaun', text: 'Tidy the playroom together', shared: true });
  check(await until(S, () => [...document.querySelectorAll('#inboxSection .ib-row')].filter(r => /Private between us|Tidy the playroom together/.test(r.innerText)).length === 2), 'H6 both reach Shaun');
  check(await rowHas(M, MH, 'Tidy the playroom together'), 'H6 Maria sees the one shared with everyone at Home');
  check(!(await titles(M, MH)).includes('Private between us'), 'H6 …but never the private one between Shaun and Abi');
  check(await until(M, () => document.querySelector('[data-hs-filter="others"] .hs-stat-n').textContent === '1'), 'H6 her "Assigned to others" counts only what she can see (1)');
  check(await until(S, () => Number(document.querySelector('#view-home [data-hs-filter="others"] .hs-stat-n').textContent) >= 0), 'H6 Shaun\'s summary renders');
  const priv = await reqByText('Private between us');
  check(await M.evaluate(async id => { try { await firebase.firestore().collection('ledger_home_requests').doc(id).get(); return 'ALLOWED'; } catch (e){ return e.code; } }, priv.id) === 'permission-denied', 'H6 a direct read of it is refused');
  await M.screenshot({ path: `${shots}/${tag}-H6-maria-shared.png` });

  // H7 — on someone's behalf: Shaun records Maria asking Abi
  await addOne(S);
  await newRequest(S, { from: 'Maria', for: 'Abi', text: 'Spare key for Saturday' });
  const key = await reqByText('Spare key for Saturday');
  check(key && key.requesterUid === maria && key.assigneeUid === abi && key.createdByUid === owner && key.participants.sort().join() === [maria, abi, owner].sort().join(), 'H7 stored: asked by Maria, for Abi, written by Shaun');
  check(await rowHas(A, AH, 'Spare key for Saturday', 'From Maria · added by Shaun'), 'H7 Abi: "From Maria · added by Shaun"');
  check(await rowHas(M, MH, 'Spare key for Saturday'), 'H7 Maria sees it, asked by her');
  await openRow(M, MH, 'Spare key for Saturday');
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
  await addOne(M); await newRequest(M, { for: 'Shaun', text: 'Typo reqest' });
  check(await until(S, () => [...document.querySelectorAll('#inboxSection .ib-row')].some(r => /Typo reqest/.test(r.innerText))), 'H8 it reaches Shaun');
  await openRow(M, MH, 'Typo reqest');
  await M.waitForSelector('#hdDelBtn'); await M.click('#hdDelBtn'); await M.waitForSelector('#rqDelGo');
  check(/Delete this request\?/.test(await txt(M, '#ppSheet')) && /both people.s request lists/.test(await txt(M, '#ppSheet')), 'H8 the same confirmation as Phase A');
  await M.click('#rqDelGo');
  check(await until(M, () => /Request deleted/.test((document.querySelector('.pin-toast') || {}).textContent || '') && ![...document.querySelectorAll('#hpList .hs-row .commitment-title')].some(x => x.textContent === 'Typo reqest')), 'H8 deleted: gone from Maria\'s list');
  check(await until(S, () => ![...document.querySelectorAll('#inboxSection .ib-row')].some(r => /Typo reqest/.test(r.innerText))), 'H8 …and from Shaun\'s Inbox');
  const typo = await reqByText('Typo reqest');
  check(typo.deletedAt && typo.deletedByUid === maria, 'H8 soft-deleted, by Maria');

  // H13 — several at once: Abi pastes the day's list for Maria
  await goHome(A); await A.click('#hsAdd'); await A.waitForSelector('#hamMany'); await A.click('#hamMany');
  await A.waitForSelector('#hbText');
  check(await A.evaluate(() => [...document.querySelectorAll('#hbFor .bk-filter-chip.sel')].map(b => b.textContent).join() === 'Maria'), 'H13 for: Maria, by default (the one person who helps at home)');
  check(await A.evaluate(() => [...document.querySelectorAll('#hbWhen .bk-filter-chip.sel')].map(b => b.textContent).join() === 'Today'), 'H13 when: Today, by default');
  await A.fill('#hbText', '- Empty the dishwasher\n2. Wash the school uniform\n\n• Tidy the toy box\n[ ] Collect the parcel\n   Water the plants   \n');
  check(await A.evaluate(() => document.getElementById('hbPreview').textContent) === 'Preview 5 tasks', 'H13 five lines, blank ones ignored: "Preview 5 tasks"');
  await A.screenshot({ path: `${shots}/${tag}-H13-list.png` });
  await A.click('#hbPreview'); await A.waitForSelector('#hbpRows .hb-input');
  const rowVals = () => A.evaluate(() => [...document.querySelectorAll('#hbpRows .hb-input')].map(i => i.value));
  check((await rowVals()).join('|') === 'Empty the dishwasher|Wash the school uniform|Tidy the toy box|Collect the parcel|Water the plants', 'H13 preview: bullets, numbers and boxes gone, wording kept — ' + (await rowVals()).join('|'));
  await A.fill('#hbpRows .hb-row:nth-child(2) .hb-input', 'Wash and iron the school uniform');
  await A.click('#hbpRows .hb-row:nth-child(5) .hb-x');
  await A.click('#hbpAdd'); await A.keyboard.type('Book the plumber');
  await A.click('#hbpRows .hb-row:nth-child(5) .hb-who');
  check(await chip(A, '#hbpRows .hb-row:nth-child(5) .hb-own', 'Shaun'), 'H13 one row for Shaun instead');
  check(await A.evaluate(() => /Shaun · Today/.test(document.querySelector('#hbpRows .hb-row:nth-child(5) .hb-who').textContent) && document.getElementById('hbpSave').textContent === 'Create 5 requests'), 'H13 "Shaun · Today" on that row; "Create 5 requests"');
  await A.screenshot({ path: `${shots}/${tag}-H13-preview.png` });
  await A.evaluate(() => { const b = document.getElementById('hbpSave'); b.click(); b.click(); });   // a double tap
  check(await until(A, () => !document.getElementById('ppBackdrop').classList.contains('open'), null, 15000), 'H13 created: the sheet closes');
  check(/5 requests sent to Maria and Shaun/.test(await toast(A)), 'H13 "5 requests sent to Maria and Shaun"');
  await sleep(800);
  const listed = (await all(HR)).filter(r => ['Empty the dishwasher', 'Wash and iron the school uniform', 'Tidy the toy box', 'Collect the parcel', 'Book the plumber', 'Water the plants', 'Wash the school uniform'].includes(r.text));
  check(listed.length === 5 && new Set(listed.map(r => r.text)).size === 5, 'H13 exactly five requests, one each, despite the double tap');
  check(listed.filter(r => r.assigneeUid === maria).length === 4 && listed.find(r => r.text === 'Book the plumber').assigneeUid === owner
    && listed.every(r => r.requesterUid === abi && r.createdByUid === abi && r.requestedTiming === 'today' && r.status === 'requested' && r.visibility === 'private'),
    'H13 each its own request: four for Maria, one for Shaun, asked by Abi, today, private');
  const batches = await all('ledger_home_batches');
  check(batches.length === 1 && batches[0].requestIds.length === 5 && batches[0].createdByUid === abi, 'H13 one summary record for the list (one notification each)');
  check(await until(M, () => ['Empty the dishwasher', 'Wash and iron the school uniform', 'Tidy the toy box', 'Collect the parcel'].every(t => [...document.querySelectorAll('#hpList .hs-row .commitment-title')].some(x => x.textContent === t))), 'H13 Maria sees all four at once, today');
  check(!(await titles(M, MH)).includes('Book the plumber'), 'H13 …and not Shaun\'s');
  check(await A.evaluate(() => localStorage.getItem('ledger_home_bulk_draft') === null), 'H13 the draft is cleared once sent');
  await M.screenshot({ path: `${shots}/${tag}-H13-maria-list.png` });

  // H14 — a checklist: Maria's weekly groceries, for Abi
  await M.click('#hsAdd'); await M.waitForSelector('#hamList'); await M.click('#hamList');
  await M.waitForSelector('#hnList');
  check(await M.evaluate(() => !document.getElementById('hnListField').hidden && document.getElementById('hnListOn').getAttribute('aria-checked') === 'true'), 'H14 "Shopping or checklist" opens a request with its list ready');
  check(await chip(M, '#hnFor', 'Abi'), 'chose For Abi');
  await M.fill('#hnText', 'Weekly groceries'); await M.fill('#hnList', 'Milk\nEggs\nRice\nChicken');
  await M.screenshot({ path: `${shots}/${tag}-H14-new-list.png` });
  await M.click('#hnSave');
  await until(M, () => !document.getElementById('ppBackdrop').classList.contains('open'), null, 8000);
  const gro = await reqByText('Weekly groceries');
  const items = async () => (await (await fetch(`${FS}/${HR}/${gro.id}/items?pageSize=100`, { headers: ADMIN })).json()).documents.map(d => Object.assign({ id: d.name.split('/').pop() }, dec({ mapValue: { fields: d.fields } })));
  check(gro && gro.hasChecklist === true && gro.requesterUid === maria && gro.assigneeUid === abi && (await items()).length === 4 && (await items()).every(i => i.createdByUid === maria && i.done === false), 'H14 one request, four items, each added by Maria');
  check(await rowHas(M, MH, 'Weekly groceries', '0 of 4 items'), 'H14 her row: "0 of 4 items"');
  await goHome(A); await openRow(A, AH, 'Weekly groceries');
  await A.waitForSelector('#hlList .hl-row');
  const hlTexts = (p, sel) => p.evaluate(s => [...document.querySelectorAll(s + ' .hl-text')].map(x => x.textContent), sel || '#hlList');
  check((await hlTexts(A)).join('|') === 'Milk|Eggs|Rice|Chicken', 'H14 Abi sees the list, in order');
  const tickItem = (p, t) => p.evaluate(t => { const r = [...document.querySelectorAll('.hl-row')].find(x => x.querySelector('.hl-text') && x.querySelector('.hl-text').textContent === t); r.querySelector('.commitment-status-dot').click(); }, t);
  await tickItem(A, 'Milk'); await tickItem(A, 'Eggs');
  check(await rowHas(M, MH, 'Weekly groceries', '2 of 4 items'), 'H14 Abi ticks two → Maria\'s row says "2 of 4 items", live');
  check(await until(A, () => /Ticked · 2/.test((document.getElementById('hlDoneToggle') || {}).textContent || '') && document.querySelectorAll('#hlList .hl-row').length === 2), 'H14 ticked ones fold away: "Ticked · 2"');
  // Maria adds two more from her side (a pasted pair), and rewords one
  await openRow(M, MH, 'Weekly groceries'); await M.waitForSelector('#hlAdd');
  await M.fill('#hlAdd', 'Bread\nButter'); await M.click('#hlAddBtn');
  check(await until(A, () => document.querySelectorAll('#hlList .hl-row').length === 4 && /2 of 6/.test(document.querySelector('.hl-head').textContent)), 'H14 a pasted pair becomes two items; Abi sees "2 of 6" at once');
  await M.evaluate(() => [...document.querySelectorAll('.hl-text')].find(x => x.textContent === 'Rice').click());
  await M.waitForSelector('.hl-edit'); await M.fill('.hl-edit', 'Basmati rice'); await M.keyboard.press('Enter');
  check(await until(A, () => [...document.querySelectorAll('.hl-text')].some(x => x.textContent === 'Basmati rice')), 'H14 Maria rewords "Rice" → Abi sees "Basmati rice"');
  // both tick at the same moment: neither overwrites the other
  await Promise.all([tickItem(M, 'Bread'), tickItem(A, 'Chicken')]);
  await sleep(1500);
  const its = await items();
  check(its.find(i => i.text === 'Bread').done && its.find(i => i.text === 'Bread').doneByUid === maria && its.find(i => i.text === 'Chicken').done && its.find(i => i.text === 'Chicken').doneByUid === abi, 'H14 two ticks at once, by two people: both kept, each signed by its own person');
  await A.evaluate(() => { const t = document.getElementById('hlDoneToggle'); if (t && t.getAttribute('aria-expanded') === 'false') t.click(); });
  await tickItem(A, 'Chicken'); await sleep(600);
  check(await until(A, () => [...document.querySelectorAll('#hlList .hl-text')].some(x => x.textContent === 'Chicken')), 'H14 unticking puts it back on the list');
  await A.evaluate(() => { const t = document.getElementById('hlDoneToggle'); if (t && t.getAttribute('aria-expanded') === 'true') t.click(); });
  // Abi drags "Chicken" to the top
  await A.waitForSelector('#hlList .hl-grip');
  const grip = async t => A.evaluate(t => { const r = [...document.querySelectorAll('#hlList .hl-row')].find(x => x.querySelector('.hl-text').textContent === t); const b = r.querySelector('.hl-grip').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, t);
  const g1 = await grip('Chicken'), g0 = await grip('Basmati rice');
  await A.mouse.move(g1.x, g1.y); await A.mouse.down();
  for (let i = 1; i <= 10; i++){ await A.mouse.move(g1.x, g1.y + (g0.y - g1.y - 20) * i / 10); await sleep(25); }
  await A.mouse.up(); await sleep(1200);
  check((await hlTexts(A)).join('|') === 'Chicken|Basmati rice|Butter', 'H14 drag: "Chicken" first — ' + (await hlTexts(A)).join('|'));
  check(await until(M, () => [...document.querySelectorAll('#hlList .hl-text')].map(x => x.textContent).join('|') === 'Chicken|Basmati rice|Butter'), 'H14 …and on Maria\'s phone too');
  await A.screenshot({ path: `${shots}/${tag}-H14-abi-list.png` });
  // Shaun (admin, not in it) can look but not touch
  await goHome(S);
  await S.click('[data-hs-filter="others"]'); await sleep(300);
  await openRow(S, SH, 'Weekly groceries'); await S.waitForSelector('#hlList .hl-row');
  check(await S.evaluate(() => !document.getElementById('hlAdd') && [...document.querySelectorAll('#hlList .commitment-status-dot')].every(b => b.disabled) && !document.querySelector('.hl-grip')), 'H14 Shaun (following, not in it) sees the list, but cannot tick, add or reorder');
  await S.click('#sheetCloseBtn'); await S.click('[data-hs-filter="others"]');
  // all ticked never completes the request; Done with some left asks first
  for (const t of ['Chicken', 'Basmati rice', 'Butter']) { await tickItem(A, t); await sleep(250); }
  await sleep(1000);
  check((await reqByText('Weekly groceries')).status === 'requested' && await A.evaluate(() => /all ticked/.test(document.querySelector('.hl-head').textContent)), 'H14 every item ticked: "all ticked", but the request is still open');
  await A.evaluate(() => { const t = document.getElementById('hlDoneToggle'); if (t && t.getAttribute('aria-expanded') === 'false') t.click(); }); await A.waitForSelector('.hl-done-list');
  await tickItem(A, 'Butter'); await sleep(600);
  const dlg = A.dialogs.length;
  await A.click('#hdDone');
  check(await until(A, () => /Done/.test(document.getElementById('hdState').textContent)) && /1 item isn.t ticked/.test(A.dialogs[dlg] || ''), 'H14 Done with one left: it asks first ("1 item isn’t ticked")');
  await sleep(800);
  const fin = await items();
  check((await reqByText('Weekly groceries')).status === 'done' && fin.find(i => i.text === 'Butter').done === false && fin.filter(i => i.done).length === 5, 'H14 …then done, leaving that item unticked; the rest keep who ticked them');
  await A.click('#ppSheet .sheet-close'); await M.click('#ppSheet .sheet-close');

  // H15 — recurring responsibilities: set up once, they come round by themselves
  await goHome(A); await A.click('#hsAdd'); await A.waitForSelector('#hamRecur'); await A.click('#hamRecur');
  await A.waitForSelector('#rcText');
  check(await A.evaluate(() => [...document.querySelectorAll('#rcMode .bk-filter-chip.sel')].map(b => b.textContent).join() === 'A named person'
    && [...document.querySelectorAll('#rcFor .bk-filter-chip.sel')].map(b => b.textContent).join() === 'Maria'
    && [...document.querySelectorAll('#rcFreq .bk-filter-chip.sel')].map(b => b.textContent).join() === 'Weekly'), 'H15 defaults: a named person (Maria), weekly');
  await A.fill('#rcText', 'School uniform washed, ironed and ready');
  check(await chip(A, '#rcDays', 'Sun'), 'H15 on Sundays');
  await A.fill('#rcList', 'Wash\nIron\nHang up');
  check(await until(A, () => /^Every Sunday · first /.test(document.getElementById('rcPreview').textContent)), 'H15 it says what it will do: "Every Sunday · first …"');
  await A.screenshot({ path: `${shots}/${tag}-H15-recurring-form.png` });
  await A.click('#rcSave');
  check(await until(A, () => !document.getElementById('ppBackdrop').classList.contains('open') && /Set up/.test((document.querySelector('.pin-toast') || {}).textContent || '')), 'H15 "Set up · first …"');
  await sleep(600);
  const tpls = await all('ledger_home_recurring');
  const uni = tpls.find(t => /School uniform/.test(t.title));
  check(uni && uni.createdByUid === abi && uni.mode === 'assigned' && uni.assigneeUid === maria && uni.schedule.freq === 'weekly' && uni.schedule.days.join() === '0'
    && uni.timezone === 'Europe/London' && uni.checklist.join('|') === 'Wash|Iron|Hang up' && uni.status === 'active' && uni.visibility === 'private', 'H15 stored once: weekly on Sunday, for Maria, with its checklist, in her timezone', JSON.stringify(uni));
  check(await until(A, () => [...document.querySelectorAll('#ppHomeScreen .rc-row')].some(r => /School uniform/.test(r.innerText) && /Every Sunday · Maria · next/.test(r.innerText))), 'H15 Abi\'s Home → Recurring: "Every Sunday · Maria · next …"');
  check(await until(M, () => [...document.querySelectorAll('#hpList .rc-row')].some(r => /School uniform/.test(r.innerText) && /Every Sunday · You/.test(r.innerText))), 'H15 Maria sees it too: "Every Sunday · You"');
  check(await until(S, () => [...document.querySelectorAll('#view-home .rc-row')].some(r => /School uniform/.test(r.innerText))), 'H15 …and Shaun, who sees all of Home');
  // pause, resume, edit the series
  await A.evaluate(() => [...document.querySelectorAll('#ppHomeScreen .rc-row')].find(r => /School uniform/.test(r.innerText)).click());
  await A.waitForSelector('#rcPause'); await A.click('#rcPause');
  const pausedUi = await until(A, () => /Paused/.test(document.getElementById('rcState').textContent));
  await sleep(400);
  const pausedDb = (await all('ledger_home_recurring')).find(t => t.id === uni.id);
  check(pausedUi && pausedDb.status === 'paused', 'H15 Pause: "Paused", and nothing new until resumed', JSON.stringify({ pausedUi, st: pausedDb.status, state: await txt(A, '#rcState'), toast: await toast(A) }));
  await A.click('#rcPause');
  check(await until(A, () => /^Next /.test(document.getElementById('rcState').textContent)), 'H15 Resume: "Next …"');
  await A.click('#rcEdit'); await A.waitForSelector('#rcText');
  await A.fill('#rcText', 'School uniform ready for Monday');
  await A.click('#rcSave');
  check(await until(A, () => /Saved — from the next one/.test((document.querySelector('.pin-toast') || {}).textContent || '')), 'H15 editing the series: "Saved — from the next one"');
  await sleep(500);
  check((await all('ledger_home_recurring')).find(t => t.id === uni.id).title === 'School uniform ready for Monday' && (await all('ledger_home_recurring')).length === 1, 'H15 …the same responsibility, changed (not a copy)');
  // Maria can see it, not change it
  await M.evaluate(() => [...document.querySelectorAll('#hpList .rc-row')].find(r => /School uniform/.test(r.innerText)).click());
  await M.waitForSelector('#rcState');
  check(await M.evaluate(() => !document.getElementById('rcEdit') && !document.getElementById('rcPause')), 'H15 Maria (assigned) sees it, but only Abi or an admin changes it');
  await M.click('#ppSheet .sheet-close');
  // anyone at Home
  await A.click('#hsAdd'); await A.waitForSelector('#hamRecur'); await A.click('#hamRecur'); await A.waitForSelector('#rcText');
  await A.fill('#rcText', 'Bins out');
  check(await chip(A, '#rcMode', 'Anyone at Home') && await chip(A, '#rcFreq', 'Daily'), 'H15 "Bins out": anyone at Home, daily');
  check(await A.evaluate(() => document.getElementById('rcShare').getAttribute('aria-checked') === 'true' && document.getElementById('rcShare').disabled), 'H15 anyone at Home is always shared');
  await A.click('#rcSave'); await until(A, () => !document.getElementById('ppBackdrop').classList.contains('open'));
  await sleep(500);
  const bins = (await all('ledger_home_recurring')).find(t => t.title === 'Bins out');
  check(bins && bins.mode === 'anyone' && bins.assigneeUid === null && bins.visibility === 'home', 'H15 stored: anyone, shared with Home, nobody named');
  // the server makes today's (here, as the server would), unclaimed
  const occId = bins.id + '_' + TODAY.replace(/-/g, '');
  const nowIso = new Date().toISOString();
  await put(`${HR}/${occId}`, { homeId: owner, text: 'Bins out', note: null, requestedTiming: 'date', requestedDate: TODAY, requestedTime: null, requesterUid: abi, assigneeUid: null, createdByUid: abi,
    participants: [abi], visibility: 'home', status: 'requested', plannedDate: null, linkedActionId: null, recurringId: bins.id, occurrenceDate: TODAY,
    createdAt: nowIso, updatedAt: nowIso, latestUpdateAt: nowIso, latestUpdateByUid: abi, latestUpdateType: 'created', readAt: {} });
  check(await until(M, (id) => [...document.querySelectorAll('#hpList .hs-row')].some(r => /Bins out/.test(r.innerText) && r.querySelector('.hs-claim') && r.querySelector('.rc-inline')), occId), 'H15 Maria: "Bins out" today, with a repeat mark and "I’ll do it"');
  await M.screenshot({ path: `${shots}/${tag}-H15-maria-claim.png` });
  await M.evaluate(() => [...document.querySelectorAll('#hpList .hs-row')].find(r => /Bins out/.test(r.innerText)).querySelector('.hs-claim').click());
  await sleep(1200);
  const claimed = (await all(HR)).find(r => r.id === occId);
  check(claimed.assigneeUid === maria && claimed.participants.includes(maria) && claimed.participants.includes(abi), 'H15 "I’ll do it": it is Maria\'s, and Abi stays in it');
  check(await until(A, () => [...document.querySelectorAll('#ppHomeScreen .hs-row')].some(r => /Bins out/.test(r.innerText) && !r.querySelector('.hs-claim') && /Maria/.test(r.innerText))), 'H15 Abi sees Maria took it (no "I’ll do it" left)');
  check(await until(M, () => [...document.querySelectorAll('#hpList .hs-row')].some(r => /Bins out/.test(r.innerText) && r.querySelector('.commitment-status-dot'))), 'H15 …and Maria can now tick it off');
  // a missed one: history, and still finishable
  const missId = uni.id + '_20261018';
  await put(`${HR}/${missId}`, { homeId: owner, text: 'School uniform washed, ironed and ready', note: null, requestedTiming: 'date', requestedDate: '2026-10-18', requesterUid: abi, assigneeUid: maria, createdByUid: abi,
    participants: [abi, maria], visibility: 'private', status: 'missed', plannedDate: null, linkedActionId: null, recurringId: uni.id, occurrenceDate: '2026-10-18',
    createdAt: nowIso, updatedAt: nowIso, latestUpdateAt: nowIso, latestUpdateByUid: abi, latestUpdateType: 'missed', readAt: {} });
  check(await until(M, () => [...document.querySelectorAll('#hpList .hs-row.st-missed')].some(r => /Missed/.test(r.innerText))), 'H15 a missed one sits in history: "Missed"');
  await M.evaluate(() => [...document.querySelectorAll('#hpList .hs-row.st-missed')][0].querySelector('.hs-row-body').click());
  await M.waitForSelector('#hdDone');
  check(/Done, late/.test(await txt(M, '#hdDone')), 'H15 …and its person can still finish it: "Done, late"');
  await M.click('#hdDone'); await sleep(1000);
  check((await all(HR)).find(r => r.id === missId).status === 'done', 'H15 done, late');
  await M.click('#ppSheet .sheet-close');
  // ending one
  await A.evaluate(() => [...document.querySelectorAll('#ppHomeScreen .rc-row')].find(r => /Bins out/.test(r.innerText)).click());
  await A.waitForSelector('#rcEnd'); await A.click('#rcEnd');
  check(await until(A, () => !document.getElementById('ppBackdrop').classList.contains('open')) && /End “Bins out”/.test(A.dialogs[A.dialogs.length - 1] || ''), 'H15 End asks first');
  await sleep(500);
  check((await all('ledger_home_recurring')).find(t => t.id === bins.id).status === 'ended' && !(await A.evaluate(() => [...document.querySelectorAll('#ppHomeScreen .rc-row')].some(r => /Bins out/.test(r.innerText)))), 'H15 ended: kept, and off the Recurring list');
  await A.screenshot({ path: `${shots}/${tag}-H15-abi-home.png`, fullPage: true });

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
  check(await until(M, () => !document.getElementById('partnerApp').hidden && [...document.querySelectorAll('#hpList .hs-row')].some(r => /Bins out/.test(r.innerText)), null, 15000), 'H10 added back: her Home returns');
  await M.click('#hsFilterClear').catch(() => {});
  await M.evaluate(() => { const h = document.getElementById('hsRecentAll'); if (h) h.click(); });
  check(await until(M, () => [...document.querySelectorAll('#hpList .hs-row')].some(r => /Bath at six/.test(r.innerText))), 'H10 …with its history (All activity)');
  await M.evaluate(() => { const x = document.getElementById('hsFilterClear'); if (x) x.click(); });
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
  check(await until(N2, () => /already an account for this email/.test(document.getElementById('authError').textContent), null, 20000), 'H12 an email that already has an account: "Sign in instead"',
    await N2.evaluate(() => JSON.stringify({ err: (document.getElementById('authError') || {}).textContent, state: document.getElementById('authCard').getAttribute('data-state'), email: (document.getElementById('authEmail') || {}).value, btn: (document.getElementById('authCreate') || {}).textContent })));
  await N2.context().close();

  // H16 — Recent updates: shown or hidden (remembered), cleared with Undo, newer ones come back
  await goHome(S); await S.click('#hsFilterClear').catch(() => {});
  await S.waitForSelector('#hsRecentToggle');
  const recentRows = p => p.evaluate(() => [...document.querySelectorAll('#hsRecentBody .hs-row')].length);
  check(await S.evaluate(() => document.getElementById('hsRecentToggle').getAttribute('aria-expanded') === 'true' && !document.getElementById('hsRecentClear').hidden) && await recentRows(S) > 0,
    'H16 Recent updates: open, with Clear all');
  const tallest = await S.evaluate(() => Math.max(...[...document.querySelectorAll('#view-home .hs-row')].map(r => r.offsetHeight)));
  check(tallest < 100, 'H16 every Home row stays compact at this width (tallest ' + tallest + 'px)');
  const n0 = await S.evaluate(() => document.querySelector('#hsRecentToggle .cz-sec-count').textContent);
  await S.click('#hsRecentToggle');
  check(await until(S, () => !document.getElementById('hsRecentBody') && document.getElementById('hsRecentToggle').getAttribute('aria-expanded') === 'false' && document.getElementById('hsRecentClear').hidden)
    && await S.evaluate(n => document.querySelector('#hsRecentToggle .cz-sec-count').textContent === n && localStorage.getItem('ledger_home_recent_open') === '0', n0),
    'H16 hidden: only its header, with its count (' + n0 + '), remembered on this device');
  await S.screenshot({ path: `${shots}/${tag}-H16-hidden.png` });
  await backToToday(S); await goHome(S);
  check(await until(S, () => !document.getElementById('hsRecentBody')), 'H16 …still hidden on coming back');
  await S.click('#hsRecentToggle'); await S.waitForSelector('#hsRecentBody');
  await S.click('#hsRecentClear');
  check(await until(S, () => /You’re up to date/.test(document.getElementById('hsRecentBody').innerText) && !document.querySelector('#hsRecentBody .hs-row')) && /updates? cleared\s*Undo/.test(await toast(S)),
    'H16 Clear all: the list empties at once — "' + (await toast(S)).replace(/\s+/g, ' ') + '"');
  await S.screenshot({ path: `${shots}/${tag}-H16-cleared.png` });
  await S.click('.pin-toast-act');
  check(await until(S, () => document.querySelectorAll('#hsRecentBody .hs-row').length > 0) && await S.evaluate(() => !localStorage.getItem('ledger_home_recent_cleared')), 'H16 Undo: they are all back, nothing kept');
  await sleep(5600);
  check(await recentRows(S) > 0, 'H16 …and stay back after the Undo time');
  await S.click('#hsRecentClear'); await sleep(5800);
  check(await S.evaluate(o => { const m = JSON.parse(localStorage.getItem('ledger_home_recent_cleared') || '{}'); return typeof m[o] === 'string'; }, owner)
    && !(await recentRows(S)), 'H16 cleared for good once Undo has passed (for Shaun, on this device)');
  await S.click('#hsRecentAll');
  check(await until(S, () => [...document.querySelectorAll('#view-home .hs-row')].some(r => /Bath at six/.test(r.innerText))), 'H16 All activity still has everything');
  await S.click('#hsFilterClear');
  // something new afterwards shows again
  const later = (await all(HR)).find(r => r.text === 'Bath at six');
  const { id: laterId, ...laterData } = later;
  await put(`${HR}/${laterId}`, Object.assign({}, laterData, { latestUpdateAt: new Date(Date.now() + 60000).toISOString(), latestUpdateType: 'comment' }));
  check(await until(S, () => [...document.querySelectorAll('#hsRecentBody .hs-row')].some(r => /Bath at six/.test(r.innerText))), 'H16 a newer update appears again after clearing');

  // H17 — anyone adds a task for themselves: their own idea, or asked in person; everyone sees it
  await M.click('#hsFilterClear').catch(() => {});
  await M.click('#hsAdd'); await M.waitForSelector('#hamSelf'); await M.click('#hamSelf');
  await M.waitForSelector('#hnText');
  check(await M.evaluate(() => document.querySelector('#ppSheet .sheet-title').textContent === 'New task'
    && [...document.querySelectorAll('#hnFor .bk-filter-chip.sel')].map(b => b.textContent).join() === 'Me'
    && [...document.querySelectorAll('#hnFrom .bk-filter-chip.sel')].map(b => b.textContent).join() === 'Me'
    && document.getElementById('hnShare').getAttribute('aria-checked') === 'true'
    && document.getElementById('hnTextLabel').textContent === 'What will you do?' && document.getElementById('hnSave').textContent === 'Add to Home'),
    'H17 Maria: Add → Something I’ll do — for Me, asked by Me, everyone at Home can see it');
  await M.screenshot({ path: `${shots}/${tag}-H17-own-form.png` });
  await M.fill('#hnText', 'Sort the toy box'); await M.click('#hnSave');
  check(await until(M, () => /Added to Home — everyone can see it/.test((document.querySelector('.pin-toast') || {}).textContent || '')), 'H17 "Added to Home — everyone can see it"');
  await sleep(600);
  const own = await reqByText('Sort the toy box');
  check(own && own.requesterUid === maria && own.assigneeUid === maria && own.createdByUid === maria && JSON.stringify(own.participants) === JSON.stringify([maria]) && own.visibility === 'home',
    'H17 stored as hers: asked by, for and written by Maria; shared with Home', JSON.stringify(own));
  check(await rowHas(A, AH, 'Sort the toy box', 'Maria’s task'), 'H17 Abi sees it: "Maria’s task"');
  check(await rowHas(S, SH, 'Sort the toy box', 'Maria’s task'), 'H17 …and Shaun');
  check(await rowHas(M, MH, 'Sort the toy box', 'Your task'), 'H17 Maria: "Your task"');
  // asked in person
  await M.click('#hsAdd'); await M.waitForSelector('#hamSelf'); await M.click('#hamSelf'); await M.waitForSelector('#hnText');
  check(await chip(M, '#hnFrom', 'Abi'), 'H17 asked by Abi (in person)');
  check(await M.evaluate(() => document.getElementById('hnTextLabel').textContent === 'What did Abi ask you to do?' && /Abi asked you in person/.test(document.getElementById('hnFromNote').textContent)),
    'H17 "What did Abi ask you to do?" — "Abi asked you in person. It shows as from Abi, added by you."');
  await M.fill('#hnText', 'Fold the washing'); await M.click('#hnSave'); await sleep(900);
  const ip = await reqByText('Fold the washing');
  check(ip && ip.requesterUid === abi && ip.assigneeUid === maria && ip.createdByUid === maria && ip.visibility === 'home', 'H17 stored as from Abi, for Maria, written by Maria', JSON.stringify(ip));
  check(await rowHas(A, AH, 'Fold the washing', 'For Maria · added by Maria'), 'H17 Abi sees "For Maria · added by Maria"');
  // her own: no "Can't do"; she ticks it off
  await openRow(M, MH, 'Sort the toy box'); await M.waitForSelector('#hdAct');
  check(await until(M, () => !document.getElementById('hdCant') && !document.getElementById('hdWithdraw') && /Edit task/.test(document.getElementById('hdOwn').textContent) && /Added by you/.test(document.getElementById('hdTimeline').innerText)),
    'H17 her own task: no "Can’t do" or Withdraw; "Edit task"; history "Added by you"');
  await M.click('#hdDone');
  check(await rowDone(A, AH, 'Sort the toy box'), 'H17 she does it → Abi sees it done');
  await M.click('#ppSheet .sheet-close').catch(() => {});
  // several at once, for herself
  await M.click('#hsAdd'); await M.waitForSelector('#hamMany'); await M.click('#hamMany'); await M.waitForSelector('#hbText');
  check(await M.evaluate(() => [...document.querySelectorAll('#hbFor .bk-filter-chip.sel')].map(b => b.textContent).join() === 'Me'), 'H17 Add several tasks: for Me, to start with');
  await M.fill('#hbText', 'Wipe the high chair\nTidy the shoes'); await M.click('#hbPreview'); await M.waitForSelector('#hbpRows .hb-input');
  check(await M.evaluate(() => document.getElementById('hbpSave').textContent === 'Add 2 tasks'), 'H17 "Add 2 tasks"');
  await M.click('#hbpSave');
  check(await until(M, () => /2 tasks added to Home/.test((document.querySelector('.pin-toast') || {}).textContent || '')), 'H17 "2 tasks added to Home"');
  await sleep(600);
  const two = (await all(HR)).filter(r => ['Wipe the high chair', 'Tidy the shoes'].includes(r.text));
  check(two.length === 2 && two.every(r => r.requesterUid === maria && r.assigneeUid === maria && r.visibility === 'home'), 'H17 both hers, shared with Home');
  // recurring, for herself
  await M.click('#hsAdd'); await M.waitForSelector('#hamRecur'); await M.click('#hamRecur'); await M.waitForSelector('#rcText');
  check(await M.evaluate(() => [...document.querySelectorAll('#rcFor .bk-filter-chip.sel')].map(b => b.textContent).join() === 'Me' && document.getElementById('rcShare').getAttribute('aria-checked') === 'true'),
    'H17 Recurring responsibility: for Me, shared, to start with');
  await M.fill('#rcText', 'Water the plants'); await M.click('#rcSave');
  check(await until(M, () => /Set up/.test((document.querySelector('.pin-toast') || {}).textContent || '')), 'H17 set up');
  await sleep(600);
  const wt = (await all('ledger_home_recurring')).find(t => t.title === 'Water the plants');
  check(wt && wt.assigneeUid === maria && wt.createdByUid === maria && wt.visibility === 'home', 'H17 a recurring one of her own, shared');
  // Shaun's own task is not news to him: it never lands in his Inbox
  await addSelf(S, 'Call the boiler man');
  check(await rowHas(A, AH, 'Call the boiler man', 'Shaun’s task'), 'H17 Shaun adds his own → Abi sees "Shaun’s task"');
  await backToToday(S);
  check(!(await S.evaluate(() => /Call the boiler man/.test(document.querySelector('main').innerText))), 'H17 …and it isn\'t in his Inbox on Today');
  await goHome(S);

  // H11 — the partner portal still does what it did
  await A.click('[data-pp-tab="today"]'); await sleep(300);
  check(await A.evaluate(() => /Nothing shared for today yet/.test(document.getElementById('partnerApp').innerText)), 'H11 Abi\'s shared day is untouched');
  // layout and errors
  check(await sx(M) && await sx(A), 'no horizontal scroll (Maria, Abi)');
  await A.screenshot({ path: `${shots}/${tag}-H11-abi-portal.png`, fullPage: true });
  await M.screenshot({ path: `${shots}/${tag}-H11-maria-home.png`, fullPage: true });
  await backToToday(S);
  // Settings keeps Home's administration, and "Open Home" goes to the tab
  await openSettings(S); await S.waitForSelector('#setHomeOpen'); await S.click('#setHomeOpen');
  check(await until(S, () => document.querySelector('.view.active').id === 'view-home' && !document.getElementById('sheetBackdrop').classList.contains('open')), 'H11 Settings → Open Home lands on the Home tab');
  await S.screenshot({ path: `${shots}/${tag}-H11-owner-home.png`, fullPage: true });
  check(await S.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal scroll (Shaun\'s Home)');
  await S.click('#hsPeople'); await S.waitForSelector('#hpeAdd');
  check(true, 'H11 People is on the Home screen, with Add someone for Shaun');
  await S.click('#sheetCloseBtn');
  await goHome(A); await A.click('#hsPeople'); await A.waitForSelector('#hpeList');
  check(await A.evaluate(() => !document.getElementById('hpeAdd') && [...document.querySelectorAll('#hpeList .act-row')].every(r => r.disabled)), 'H11 Abi sees who is at Home, but cannot add or remove');
  await A.click('#ppSheet .sheet-close');
  for (const p of [S, A, M]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.slice(0, 3).join(' | ').slice(0, 500));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  if (bad.length) console.log(bad.join('\n'));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
