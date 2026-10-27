// Ask Claude in Ledger (docs/CLAUDE_ASSISTANT.md, phase 1), end to end over the Auth and
// Firestore emulators. The server half has its own test (tests/functions/assistant.test.js);
// here a stand-in answers at the function's address, so this covers what the page does:
// the + menu, the conversation, the proposal card, Apply through Ledger's own saves (into
// the emulator, under the real rules), the "changed since" guard, Undo, and the + keeping
// clear of the content.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node assistant.test.js [shots-dir]"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const [OUT] = process.argv.slice(2);
const shots = OUT || path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const PID = 'ledger-6aec3';
const PORT = 8956;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m, why) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && why ? ' — ' + why : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const local = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = local(new Date()), YESTERDAY = local(new Date(Date.now() - 86400000));

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
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
function enc(v){
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
function dec(v){
  if (!v) return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return v;
}
async function put(docPath, data){
  const r = await fetch(`${FS}/${docPath}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) throw new Error('seed failed ' + docPath + ' ' + r.status);
}
async function get(docPath){
  const r = await fetch(`${FS}/${docPath}`, { headers: ADMIN });
  if (!r.ok) return null;
  const j = await r.json();
  return dec({ mapValue: { fields: j.fields || {} } });
}
async function signUp(email){
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) });
  return (await r.json()).localId;
}
const until = async (fn, t) => { const end = Date.now() + (t || 10000); while (Date.now() < end){ try { if (await fn()) return true; } catch (e){} await sleep(200); } return false; };

(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const SHAUN = 'shaun@example.com';
  const owner = await signUp(SHAUN);
  await put(`ledger_users/${owner}`, { role: 'owner', displayName: 'Shaun', email: SHAUN, createdAt: TODAY });
  const A = (o) => Object.assign({ originalDate: o.date, priorityId: null, minVersion: null, status: 'planned', disruptionReason: null, createdAt: '2026-10-20T09:00:00.000Z' }, o);
  await put('ledger_commitments/k1', A({ date: TODAY, title: 'Call the bank', category: 'work' }));
  await put('ledger_commitments/k2', A({ date: YESTERDAY, title: 'Sort my visa', category: 'work' }));
  await put('ledger_commitments/k3', A({ date: TODAY, title: 'Old junk', category: 'personal' }));
  for (let i = 0; i < 9; i++) await put('ledger_commitments/f' + i, A({ date: TODAY, title: 'Filler Action number ' + i, category: 'family' }));
  await put('ledger_plans/' + TODAY, { meals: [{ id: 'm1', text: 'Porridge', completed: false, completedAt: null, nutritionEntryId: null }] });
  const k2 = await get('ledger_commitments/k2'), k3 = await get('ledger_commitments/k3'), k1 = await get('ledger_commitments/k1');

  // what the stand-in for the function answers, in order
  const P1 = { id: 'p1', summary: 'Bring the visa task to today, add the plumber, clear Old junk, add salmon', changes: [
    { n: 1, kind: 'action_update', collection: 'ledger_commitments', id: 'k2', before: k2, patch: { date: TODAY }, after: Object.assign({}, k2, { date: TODAY }) },
    { n: 2, kind: 'action_create', collection: 'ledger_commitments', id: 'cnew1', before: null, after: A({ date: TODAY, title: 'Book the plumber', category: 'personal', createdVia: 'claude', durationMin: 15 }) },
    { n: 3, kind: 'action_delete', collection: 'ledger_commitments', id: 'k3', before: k3, after: null },
    { n: 4, kind: 'plan_meals_add', collection: 'ledger_plans', id: TODAY, before: { meals: ['Porridge'] }, add: ['Salmon'] }
  ] };
  const P2 = { id: 'p2', summary: 'Rename the bank call', changes: [
    { n: 1, kind: 'action_update', collection: 'ledger_commitments', id: 'k1', before: k1, patch: { title: 'Call the bank about the mortgage' }, after: Object.assign({}, k1, { title: 'Call the bank about the mortgage' }) }
  ] };
  for (const p of [P1, P2]) await put('ledger_assistant_proposals/' + p.id, { ownerUid: owner, threadId: 't1', source: 'app', status: 'proposed', summary: p.summary, createdAt: TODAY, changes: [] });
  const replies = [
    { status: 200, body: { threadId: 't1', reply: 'Here\'s what I\'d do.', proposal: P1 } },
    { status: 200, body: { threadId: 't1', reply: '', proposal: P2 } },
    { status: 502, body: { error: 'Claude is busy. Try again in a minute.' } }
  ];
  const seen = [];

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Europe/London' });
  await ctx.route(/api\.github\.com/, r => r.abort());
  await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, r => {
    const f = r.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
    r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
  });
  await ctx.route(/127\.0\.0\.1:5001\/ledger-6aec3\/us-central1\/assistant/, async (r) => {
    if (r.request().method() === 'OPTIONS'){ r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } }); return; }
    seen.push({ auth: r.request().headers()['authorization'] || '', body: JSON.parse(r.request().postData() || '{}') });
    const next = replies.shift() || { status: 500, body: { error: 'no reply scripted' } };
    r.fulfill({ status: next.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(next.body) });
  });
  await ctx.addInitScript(() => { localStorage.setItem('ledger_emulator', '1'); localStorage.setItem('ledger_theme', 'light'); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(APP);
  await p.waitForSelector('#authEmail', { timeout: 20000 });
  await p.fill('#authEmail', SHAUN);
  if (await p.$('#authPassword')){ await p.fill('#authPassword', 'pw-123456'); await p.click('#authSignIn'); }
  check(await until(() => p.evaluate(() => /Call the bank/.test(document.querySelector('main').innerText) && document.getElementById('authGate').hidden), 25000), 'Shaun signs in and Today shows his Actions');

  // ---- the + : on Today now, and clear of the content ----
  check(await p.evaluate(() => !document.getElementById('globalFabBtn').hidden), 'the + is on Today');
  for (const v of ['plan', 'me', 'comms', 'home', 'log']){ await p.click(`.tab-btn[data-view="${v}"]`); await sleep(200); }
  check(await p.evaluate(() => !document.getElementById('globalFabBtn').hidden), 'the + is on every tab, back on Today');
  const room = await p.evaluate(() => {
    const fab = document.getElementById('globalFabBtn').getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom);
    return { lastContentBottom: innerHeight - pad, fabTop: fab.top };
  });
  check(room.lastContentBottom <= room.fabTop - 4, 'at the foot of the page, the last row ends above the +', JSON.stringify(room));
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
  await p.evaluate(() => window.scrollBy(0, 400)); await sleep(350);
  check(await p.evaluate(() => document.getElementById('globalFabBtn').classList.contains('tucked')), 'going down the page, the + tucks away');
  await p.evaluate(() => window.scrollBy(0, -200)); await sleep(350);
  check(await p.evaluate(() => !document.getElementById('globalFabBtn').classList.contains('tucked')), 'coming back up, it returns');

  // ---- the menu, and the conversation ----
  await p.click('#globalFabBtn');
  check(await until(() => p.evaluate(() => { const m = document.getElementById('addMenu'); return m && !m.hidden && /Ask Claude/.test(m.innerText) && /Quick add/.test(m.innerText); })), 'the + offers Ask Claude and Quick add');
  await p.screenshot({ path: `${shots}/assistant-menu.png` });
  await p.click('#addMenu [data-add="claude"]');
  check(await until(() => p.evaluate(() => document.getElementById('sheetBackdrop').classList.contains('open') && !!document.getElementById('acInput'))), 'Ask Claude opens its sheet');
  await p.fill('#acInput', 'Tidy my day please');
  await p.keyboard.press('Enter');
  check(await until(() => p.evaluate(() => document.querySelectorAll('.ac-prop').length === 1)), 'Claude\'s answer comes back with a proposal');
  check(seen.length === 1 && /^Bearer .{20,}/.test(seen[0].auth) && seen[0].body.message === 'Tidy my day please' && seen[0].body.today === TODAY && seen[0].body.threadId == null,
    'the request carries his sign-in, the message and today\'s date — and no thread yet', JSON.stringify(seen[0] && seen[0].body));
  const card = await p.evaluate(() => ({
    you: document.querySelector('.ac-you').textContent, reply: document.querySelector('.ac-claude').textContent,
    rows: [...document.querySelectorAll('.ac-change')].map(r => r.innerText.replace(/\n/g, ' / ')),
    warn: (document.querySelector('.ac-prop-warn') || {}).textContent, apply: document.querySelector('[data-ac="apply"]').textContent
  }));
  check(card.you === 'Tidy my day please' && card.reply === 'Here\'s what I\'d do.', 'his message and Claude\'s reply, as text');
  check(card.rows.length === 4 && /^Move Sort my visa/.test(card.rows[0]) && /Book the plumber/.test(card.rows[1]) && /^Remove/.test(card.rows[2]) && /Add meals.*Salmon/.test(card.rows[3]),
    'each change in words: Move, Add, Remove, Add meals', JSON.stringify(card.rows));
  check(card.warn === 'Removes 1 Action.' && card.apply === 'Apply', 'a removal is called out; Apply covers everything ticked', JSON.stringify(card));
  await p.screenshot({ path: `${shots}/assistant-proposal.png` });
  check((await get('ledger_commitments/k2')).date === YESTERDAY && !!(await get('ledger_commitments/k3')), 'nothing has changed yet');

  // untick the removal, then apply the rest
  await p.click('.ac-change:nth-child(3)');
  check(await p.evaluate(() => document.querySelector('[data-ac="apply"]').textContent === 'Apply 3 of 4'), 'unticking one: "Apply 3 of 4"');
  await p.click('[data-ac="apply"]');
  check(await until(async () => (await get('ledger_commitments/k2')).date === TODAY && !!(await get('ledger_commitments/cnew1'))), 'applied: the visa task moves to today, the plumber is added');
  check(!!(await get('ledger_commitments/k3')), 'the unticked removal is not made');
  check(await until(async () => ((await get('ledger_plans/' + TODAY)).meals || []).map(m => m.text).join() === 'Porridge,Salmon'), 'salmon joins the Food Plan, after what was there');
  const created = await get('ledger_commitments/cnew1');
  check(created.title === 'Book the plumber' && created.status === 'planned' && created.createdVia === 'claude' && created.date === TODAY, 'the new Action is an ordinary Action, marked as made with Claude');
  check(await until(async () => { const pr = await get('ledger_assistant_proposals/p1'); return pr.status === 'partial' && pr.applied.map(a => a.n).join() === '1,2,4'; }), 'the proposal records what was applied (part of it)');
  check(await until(() => p.evaluate(() => /Call the bank/.test(document.querySelector('main').innerText) && /Book the plumber/.test(document.querySelector('main').innerText))), 'Today shows the new Action at once');

  // ---- Undo ----
  await p.click('[data-ac="undo"]');
  check(await until(async () => (await get('ledger_commitments/k2')).date === YESTERDAY && !(await get('ledger_commitments/cnew1'))), 'Undo: the visa task goes back, the plumber is gone');
  check(await until(async () => ((await get('ledger_plans/' + TODAY)).meals || []).map(m => m.text).join() === 'Porridge'), 'Undo: salmon leaves the Food Plan; porridge stays');
  check(await until(async () => (await get('ledger_assistant_proposals/p1')).status === 'undone'), 'the proposal is marked undone');

  // ---- changed since Claude looked: held back, nothing newer overwritten ----
  await p.fill('#acInput', 'Rename the bank call');
  await p.click('#acSend');
  check(await until(() => p.evaluate(() => document.querySelectorAll('.ac-prop').length === 2)), 'a second proposal in the same conversation');
  check(seen[1] && seen[1].body.threadId === 't1', 'the conversation continues on its thread');
  await put('ledger_commitments/k1', A({ date: TODAY, title: 'Call the bank today', category: 'work' }));   // edited on another device
  check(await until(() => p.evaluate(() => /Call the bank today/.test(document.querySelector('main').innerText))), 'meanwhile the Action is edited elsewhere');
  await p.click('.ac-prop:last-of-type [data-ac="apply"]');
  check(await until(() => p.evaluate(() => /changed since Claude looked/.test(document.querySelector('.ac-prop:last-of-type').innerText))), 'Apply holds that change back, and says why');
  check((await get('ledger_commitments/k1')).title === 'Call the bank today', 'the newer edit is kept');
  check(await p.evaluate(() => { const c = document.querySelector('.ac-prop:last-of-type'); return /Not applied/.test(c.querySelector('.ac-prop-k').textContent) && !c.querySelector('[data-ac="undo"]'); }), 'with nothing applied, the card says so and offers no Undo');

  // ---- when Claude can't be reached ----
  await p.fill('#acInput', 'One more thing');
  await p.click('#acSend');
  check(await until(() => p.evaluate(() => /Claude is busy/.test((document.querySelector('.ac-error') || {}).textContent || ''))), 'an error is shown in the conversation, plainly');
  await p.screenshot({ path: `${shots}/assistant-error.png`, fullPage: false });
  await p.click('#sheetCloseBtn');

  // ---- the menu's other half ----
  await p.click('#globalFabBtn');
  await p.click('#addMenu [data-add="capture"]');
  check(await until(() => p.evaluate(() => document.getElementById('sheetBackdrop').classList.contains('open') && /Quick add/.test(document.getElementById('sheetBackdrop').innerText))), 'Quick add opens from the menu as before');

  check(!errs.length, 'no page errors', errs.join(' | '));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
