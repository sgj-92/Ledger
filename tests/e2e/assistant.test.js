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
  // phase 2 (2026-11-01): logs saved at once, the rest for review
  const MONDAY = (() => { const d = new Date(TODAY + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return local(d); })();
  await put('ledger_plans/' + YESTERDAY, { trainingTypes: ['resistance'], restDay: false, meals: [] });
  await put('ledger_sessions/nu1', { type: 'nutrition', date: TODAY, foodDiary: 'Porridge', dayRating: null, createdAt: TODAY + 'T08:00:00.000Z' });
  await put('ledger_sessions/st1', { type: 'steps', date: TODAY, steps: 5000, loggedAt: TODAY + 'T12:00:00.000Z' });
  await put('ledger_priorities/g1', { title: '£60k revenue', area: 'business', horizon: 'year', period: TODAY.slice(0, 4), status: 'active',
    measure: { kind: 'number', unit: '£', start: 0, target: 60000 }, values: [{ date: '2026-10-01', value: 30000, note: null }], createdAt: '2026-01-01T00:00:00.000Z' });
  await put('ledger_weeks/' + MONDAY, { outcomes: [{ id: 'o1', text: 'Send 5 proposals', goalId: 'g1', area: 'business', result: null, note: null, order: 1 }] });
  await put('ledger_conversations/v1', { title: 'Accountant', attentionState: 'needs_me', participants: [{ name: 'Accountant', role: '' }], log: [], createdAt: '2026-10-01T00:00:00.000Z' });
  const P3 = { id: 'p3', summary: 'Logged your day; three things to review', changes: [
    { n: 1, kind: 'session_create', collection: 'ledger_sessions', id: 'sx1', before: null, auto: true, after: { type: 'resistance', date: YESTERDAY, activityTime: '18:00', durationMin: 50, notes: '', createdAt: TODAY, createdVia: 'claude', exercises: [{ name: 'Squat', sets: 5, reps: 5, value: 100, unit: 'kg' }], bodyweight: null } },
    { n: 2, kind: 'session_create', collection: 'ledger_sessions', id: 'sx2', before: null, auto: true, after: { type: 'weight', date: TODAY, weightKg: 88.4, notes: '', activityTime: '', createdAt: TODAY, createdVia: 'claude' } },
    { n: 3, kind: 'food_add', collection: 'ledger_sessions', id: 'nu1', date: TODAY, lines: ['Chicken salad', 'Protein shake'], rating: null, before: { foodDiary: 'Porridge', dayRating: null }, auto: true },
    { n: 4, kind: 'goal_value', collection: 'ledger_priorities', id: 'g1', title: '£60k revenue', unit: '£', date: TODAY, value: 42000, before: { value: null }, auto: true },
    { n: 5, kind: 'comms_log', collection: 'ledger_conversations', id: 'v1', name: 'Accountant', logKind: 'call', text: 'Spoke about VAT', at: TODAY + 'T10:00:00.000Z', before: null, auto: true },
    { n: 6, kind: 'day_note', collection: 'ledger_plans', id: TODAY, text: 'Felt sharp', before: { dayNotes: '' }, auto: true },
    { n: 7, kind: 'steps_set', collection: 'ledger_sessions', id: 'st1', date: TODAY, steps: 9500, before: { steps: 5000 }, auto: false },
    { n: 8, kind: 'outcome_result', collection: 'ledger_weeks', id: MONDAY, outcomeId: 'o1', text: 'Send 5 proposals', before: { result: null }, result: 'done', auto: false },
    { n: 9, kind: 'goal_create', collection: 'ledger_priorities', id: 'g2', before: null, auto: false, after: { title: 'Five new retainers', area: 'business', horizon: 'quarter', period: TODAY.slice(0, 4) + '-Q4', parentId: 'g1', why: null, note: null, status: 'active', evidenceType: null, measure: { kind: 'number', unit: 'clients', start: 0, target: 5 }, values: [], createdAt: TODAY } },
    { n: 10, kind: 'intention', collection: 'ledger_plans', id: TODAY, text: 'Ship it', before: { intention: '' }, auto: true },
    { n: 11, kind: 'person_spoke', collection: 'ledger_people', id: 'pp1', name: 'Clem', date: YESTERDAY, before: null, auto: true }
  ] };
  await put('ledger_people/pp1', { name: 'Clem', everyDays: 14, spoke: ['2026-09-01'], createdAt: '2026-09-01T00:00:00.000Z' });
  // "here's what I did": a tick saved at once, and a correction for review
  await put('ledger_matters/mt1', { title: 'Year-end accounts', status: 'active', area: 'business', log: [], createdAt: '2026-10-01T00:00:00.000Z' });
  await put('ledger_commitments/k5', A({ date: TODAY, title: 'Call the accountant', category: 'work', matterId: 'mt1' }));
  await put('ledger_sessions/tr9', { type: 'resistance', date: TODAY, durationMin: 50, activityTime: '07:00', exercises: [], notes: '', createdAt: TODAY + 'T08:00:00.000Z' });
  const k5 = await get('ledger_commitments/k5'), tr9 = await get('ledger_sessions/tr9');
  const P4 = { id: 'p4', summary: 'Ticked the accountant call; one correction', changes: [
    { n: 1, kind: 'action_update', collection: 'ledger_commitments', id: 'k5', before: k5, patch: { status: 'completed' }, after: Object.assign({}, k5, { status: 'completed' }), auto: true, tick: true },
    { n: 2, kind: 'session_update', collection: 'ledger_sessions', id: 'tr9', before: tr9, patch: { durationMin: 60 }, auto: false }
  ] };
  await put('ledger_assistant_proposals/p4', { ownerUid: owner, threadId: 't1', source: 'app', status: 'proposed', summary: P4.summary, createdAt: TODAY, changes: [] });
  await put('ledger_assistant_proposals/p3', { ownerUid: owner, threadId: 't1', source: 'app', status: 'proposed', summary: P3.summary, createdAt: TODAY, changes: [] });
  const replies = [
    { status: 200, body: { threadId: 't1', reply: 'Here\'s what I\'d do.', proposal: P1 } },
    { status: 200, body: { threadId: 't1', reply: '', proposal: P2 } },
    { status: 502, body: { error: 'Claude is busy. Try again in a minute.' } },
    { status: 200, body: { threadId: 't1', reply: 'Logged your session, weight, food, the revenue number, the call, a note and the intention. Three things to review.', proposal: P3 } },
    { status: 200, body: { threadId: 't1', reply: 'Ticked off the accountant call. Your strength session was 60 minutes, not 50: that one is for you to check.', proposal: P4 } }
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

  // ---- phase 2: what he did is logged at once; changes wait for him ----
  const ss = async (id) => get('ledger_sessions/' + id);
  await p.fill('#acInput', 'Legs last night, 88.4kg, chicken salad and a shake, revenue 42k, called the accountant');
  await p.click('#acSend');
  check(await until(() => p.evaluate(() => !!document.querySelector('.ac-prop.is-log') && document.querySelectorAll('.ac-prop').length === 4)), 'phase 2: a "Logged" card and a review card');
  check(await until(async () => { const t = await ss('sx1'); return t && t.type === 'resistance' && t.exercises[0].name === 'Squat'; }), 'logged at once: the strength session, for yesterday');
  check(await until(async () => { const pl = await get('ledger_plans/' + YESTERDAY); return pl.trainingDetails && pl.trainingDetails.resistance.completed === true && pl.trainingDetails.resistance.sessionId === 'sx1'; }),
    'it completes the strength planned for that day');
  check(await until(async () => (await ss('sx2') || {}).weightKg === 88.4), 'logged: the weight');
  check(await until(async () => (await ss('nu1')).foodDiary === 'Porridge\nChicken salad\nProtein shake'), 'logged: the food, added to the day\'s diary in his words');
  check(await until(async () => (await get('ledger_priorities/g1')).values.some(v => v.value === 42000 && v.date === TODAY)), 'logged: the goal\'s number for today');
  check(await until(async () => { const v = await get('ledger_conversations/v1'); return v.log.length === 1 && v.log[0].text === 'Spoke about VAT' && v.log[0].kind === 'call'; }), 'logged: the call, on the conversation');
  check(await until(async () => { const pl = await get('ledger_plans/' + TODAY); return pl.dayNotes === 'Felt sharp' && pl.morningPrime && pl.morningPrime.intention === 'Ship it'; }), 'logged: a Day Note and the intention');
  check((await ss('st1')).steps === 5000 && (await get('ledger_weeks/' + MONDAY)).outcomes[0].result === null && !(await get('ledger_priorities/g2')),
    'not yet: replacing the steps, an outcome\'s result and a new goal wait for review');
  check(await until(async () => { const pr = await get('ledger_assistant_proposals/p3'); return pr.status === 'partial' && pr.applied.map(a => a.n).join() === '1,2,3,4,5,6,10,11'; }), 'the answer records what was logged');
  check(await until(async () => (await get('ledger_people/pp1')).spoke.join() === '2026-09-01,' + YESTERDAY), 'logged: he spoke to Clem yesterday');
  const logCard = await p.evaluate(() => ({ k: document.querySelector('.ac-prop.is-log .ac-prop-k').textContent,
    rows: [...document.querySelectorAll('.ac-prop.is-log .ac-change')].map(r => r.innerText.replace(/\n/g, ' / ')),
    review: [...document.querySelectorAll('.ac-prop:last-of-type .ac-change')].map(r => r.innerText.replace(/\n/g, ' / ')),
    sum: document.querySelector('.ac-prop:last-of-type .ac-prop-sum').textContent }));
  check(logCard.k === 'Logged' && logCard.rows.length === 8 && /Spoke/.test(logCard.rows[7]) && /Clem/.test(logCard.rows[7]) && /Strength/.test(logCard.rows[0]) && /Squat 5×5 · 100 kg/.test(logCard.rows[0]) && /88.4 kg/.test(logCard.rows[1]) &&
    /Chicken salad/.test(logCard.rows[2]) && /£42,000/.test(logCard.rows[3]) && /Call: Spoke about VAT/.test(logCard.rows[4]), 'the Logged card says what was saved, in words', JSON.stringify(logCard));
  check(logCard.review.length === 3 && /5,000 → 9,500/.test(logCard.review[0]) && /Open → Done/.test(logCard.review[1]) && /New goal Five new retainers/.test(logCard.review[2]) && logCard.sum === '3 changes to review',
    'the review card holds the rest: steps replaced, a result, a new goal', JSON.stringify(logCard.review));
  await p.screenshot({ path: `${shots}/assistant-logged.png` });
  await p.click('.ac-prop:last-of-type [data-ac="apply"]');
  check(await until(async () => (await ss('st1')).steps === 9500 && (await get('ledger_weeks/' + MONDAY)).outcomes[0].result === 'done' && !!(await get('ledger_priorities/g2'))),
    'applied: the day\'s steps, the outcome done, the 90-day goal');
  check(await until(async () => (await get('ledger_assistant_proposals/p3')).status === 'applied'), 'the whole answer is now applied');
  // Undo the logs: each is put back
  await p.click('.ac-prop.is-log [data-ac="undo"]');
  check(await until(async () => !(await ss('sx1')) && !(await ss('sx2'))), 'Undo: the session and the weight are gone');
  check(await until(async () => { const pl = await get('ledger_plans/' + YESTERDAY); return !(pl.trainingDetails && pl.trainingDetails.resistance && pl.trainingDetails.resistance.completed); }), 'Undo: the planned strength is open again');
  check(await until(async () => (await ss('nu1')).foodDiary === 'Porridge'), 'Undo: the diary is as it was');
  check(await until(async () => (await get('ledger_priorities/g1')).values.length === 1), 'Undo: the goal\'s number is gone');
  check(await until(async () => (await get('ledger_conversations/v1')).log.length === 0), 'Undo: the call is gone from the conversation');
  check(await until(async () => (await get('ledger_people/pp1')).spoke.join() === '2026-09-01'), 'Undo: the day he spoke to Clem is gone');
  check(await until(async () => { const pl = await get('ledger_plans/' + TODAY); return pl.dayNotes === '' && pl.morningPrime.intention === ''; }), 'Undo: the note and the intention are cleared');
  check((await ss('st1')).steps === 9500 && !!(await get('ledger_priorities/g2')), 'Undo of the logs leaves the reviewed changes alone');

  // ---- "here's what I did": the tick is saved at once; a correction waits ----
  await p.fill('#acInput', 'Here\'s what I did: called the accountant, and strength was an hour');
  await p.click('#acSend');
  check(await until(async () => (await get('ledger_commitments/k5')).status === 'completed'), 'a tick his words plainly ask for is saved at once');
  check(await until(async () => { const m = await get('ledger_matters/mt1'); return m.log.length === 1 && m.log[0].kind === 'done' && m.log[0].text === 'Call the accountant'; }),
    'as tapping its circle would: its matter records it as done');
  check(await until(() => p.evaluate(() => { const c = document.querySelector('.ac-prop:last-of-type'); return /Correct/.test(c.innerText) && /Length/.test(c.innerText) && /Strength/.test(c.innerText); })),
    'the correction waits on the review card, old → new');
  check((await ss('tr9')).durationMin === 50, 'not yet corrected');
  await p.click('.ac-prop:last-of-type [data-ac="apply"]');
  check(await until(async () => (await ss('tr9')).durationMin === 60 && (await ss('tr9')).activityTime === '07:00'), 'applied: the length corrected, the rest of the session kept');
  const logs = await p.$$('.ac-prop.is-log [data-ac="undo"]');
  await logs[logs.length - 1].click();
  check(await until(async () => (await get('ledger_commitments/k5')).status === 'planned' && (await get('ledger_matters/mt1')).log.length === 0), 'Undo: the Action is open again, and the matter forgets it');
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
