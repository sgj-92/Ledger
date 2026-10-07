// Partner Sharing, end to end: the real Firebase compat SDK (the version index.html loads)
// against the Auth and Firestore emulators, which enforce ../../firestore.rules. Two browsers:
// the owner (Shaun) and the partner (Abi). Nothing here touches a real Firebase project.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node partner-sharing.test.js [shots-dir] [dark|light] [width]"
//
// The project id must be the app's own (ledger-6aec3) so the page talks to the emulators
// under the same name; index.html switches to them only on localhost, and only when the
// page sets localStorage.ledger_emulator. CHROMIUM_PATH overrides Playwright's browser.
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
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
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
  const SHAUN = 'shaun@example.com', ABI = 'abi@example.com';
  const owner = await signUp(SHAUN), abi = await signUp(ABI);
  await put(`ledger_users/${owner}`, { role: 'owner', displayName: 'Shaun', email: SHAUN, createdAt: TODAY });
  await put(`ledger_users/${abi}`, { role: 'partner', displayName: 'Abi', email: ABI, createdAt: TODAY });
  const A0 = (id, title, category, extra) => put(`ledger_commitments/${id}`, Object.assign({ date: TODAY, originalDate: TODAY, title, category, status: 'planned', priorityId: null, minVersion: null, disruptionReason: null, createdAt: '2026-10-01T08:00:00.000Z' }, extra || {}));
  await A0('k1', 'Finish the quarterly plan', 'work', { isKeyTask: true });
  await A0('w1', 'Client call — Harbour Ltd contract', 'work');
  await A0('f1', 'Book swimming lessons', 'family');
  await A0('f2', 'Collect the dry cleaning', 'personal');
  await A0('f3', 'Order the birthday cake', 'family');
  await A0('c1', 'Call Mark about padel', 'communicate');
  await A0('f4', 'School pickup', 'family', { date: plus(1), originalDate: plus(1) });
  await put(`ledger_plans/${TODAY}`, { trainingTypes: ['hiit'], dayNotes: 'SECRET NOTE — feeling low about work', meals: [{ id: 'm1', text: 'Porridge with berries', completed: true }] });

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

  // 0 — when Firebase refuses to send a link (here: the daily email quota, the real
  // production failure of 2026-10-07), the sign-in screen names the reason and its code
  const S = await session('shaun');
  await S.route(/accounts:sendOobCode/, r => r.fulfill({ status: 400, contentType: 'application/json',
    body: JSON.stringify({ error: { code: 400, message: 'QUOTA_EXCEEDED : Exceeded daily quota for email sign-in.', errors: [{ message: 'QUOTA_EXCEEDED', domain: 'global', reason: 'invalid' }] } }) }));
  await S.goto(APP); await S.waitForSelector('#authEmail', { timeout: 20000 });
  await S.fill('#authEmail', SHAUN); await S.click('#authSend');
  check(await until(S, () => /auth\/quota-exceeded$/.test(document.getElementById('authError').textContent) && /for today/.test(document.getElementById('authError').textContent)),
    '0 a refused send names the reason and its code: ' + await S.evaluate(() => document.getElementById('authError').textContent));
  await S.unroute(/accounts:sendOobCode/);

  // 1 — Shaun signs in and Ledger opens with his data
  await signIn(S, SHAUN);
  check(await until(S, () => /Book swimming lessons/.test(document.querySelector('main').innerText)), '1 owner signs in; private Ledger opens');
  const shaunLink = lastLink;
  check(new URL(shaunLink).searchParams.get('continueUrl') === APP, '1 the link returns to the address it was sent from: ' + new URL(shaunLink).searchParams.get('continueUrl'));
  check(await S.evaluate(() => JSON.parse(localStorage.getItem('ledger_auth_role')).role === 'owner'), '1 resolves as owner');
  await S.reload();
  check(await until(S, () => /Book swimming lessons/.test(document.querySelector('main').innerText) && document.getElementById('authGate').hidden), '1 a reload stays signed in, with the data');

  // 2 — Abi signs in and sees her Account ID
  const A = await session('abi');
  await signIn(A, ABI);
  check(await until(A, () => document.getElementById('authCard').getAttribute('data-state') === 'partner'), '2 partner signs in: holding screen');
  const shownId = await A.textContent('[data-role="auth-uid"]');
  check(shownId === abi, `2 her Account ID is shown (${shownId})`);
  check(await A.evaluate(() => !/Book swimming|Harbour/.test(document.body.innerText)), '2 partner holding screen shows nothing private');
  await A.screenshot({ path: `${shots}/${tag}-02-partner-holding.png` });

  // 3 — Shaun sets Abi up from Settings (the relationship only; the role was granted outside)
  await openSettings(S);
  await S.waitForSelector('#setSharing #setPartnerAdd', { timeout: 10000 });
  await S.screenshot({ path: `${shots}/${tag}-03-settings-empty.png` });
  await S.click('#setPartnerAdd');
  await S.fill('#f_pUid', 'notarealaccount12345'); await S.fill('#f_pName', 'Abi'); await S.fill('#f_pOwner', 'Shaun');
  await S.click('#pSetupBtn');
  check(await until(S, () => /isn.t set up as a partner/.test(document.getElementById('pSetupErr').textContent)), '3 an account without the partner role is refused, kindly');
  await S.fill('#f_pUid', abi); await S.click('#pSetupBtn');
  check(await until(S, () => !document.getElementById('sheetBackdrop').classList.contains('open')), '3 partner set up');
  await backToToday(S);
  const members = await all('ledger_share_members');
  check(members.length === 1 && members[0].id === `${owner}_${abi}` && members[0].active === true && members[0].role === 'partner', '3 membership written {owner}_{partner}, active');
  // and Abi's page follows live: no shared data yet
  check(await until(A, () => !document.getElementById('partnerApp').hidden && /Nothing shared for today yet/.test(document.getElementById('partnerApp').innerText)), '3 partner portal opens on the active membership — nothing shared yet');
  const pAuth = await A.evaluate(() => ({ gateHidden: document.getElementById('authGate').hidden, mainInert: !!document.querySelector('main').inert }));
  check(pAuth.gateHidden && pAuth.mainInert, '3 owner navigation stays inert under the portal');

  // 4 — Shaun: Share snapshot → Abi, Abi preset applied, reviewed, published
  await openShare(S);
  await S.waitForSelector('[data-snap-mode-to="partner"]');
  check(/Abi/.test(await txt(S, '[data-snap-mode-to="partner"]')), '4 Share snapshot offers Image | Abi');
  await S.click('[data-snap-mode-to="partner"]');
  await S.waitForSelector('#sharePublishBtn');
  const pv = await txt(S, '.share-preview');
  check(/Finish the quarterly plan/.test(pv) && /Book swimming lessons/.test(pv) && /Collect the dry cleaning/.test(pv) && /HIIT/.test(pv), '4 preview: key outcome, family + personal actions, training');
  check(!/Harbour|Call Mark|Porridge|SECRET/.test(pv), '4 preview leaves out work, communicate, food and Day Notes');
  check(/Publish to Abi/.test(await txt(S, '#sharePublishBtn')), '4 button reads "Publish to Abi"');
  await S.screenshot({ path: `${shots}/${tag}-04-owner-publish-day.png`, fullPage: false });
  // change one thing before publishing: leave out the dry cleaning
  await S.click('.share-pv-row:has-text("Collect the dry cleaning")');
  check(/Not shared/.test(await txt(S, '.share-pv-row.off')), '4 an item can be left out in review');
  await S.click('#sharePublishBtn');
  check(await until(S, () => /Shared with Abi/.test((document.querySelector('.pin-toast') || {}).textContent || '')), '4 confirmation "Shared with Abi"');
  await sleep(600);
  let snaps = await all('ledger_shared_snapshots');
  const daySnap = snaps.find(s => s.id === `${owner}_${abi}_day_${TODAY}`);
  check(!!daySnap && daySnap.ownerUid === owner && daySnap.partnerUid === abi && daySnap.periodType === 'day', '4 structured day projection written (not an image)');
  const dayJson = JSON.stringify(daySnap || {});
  check(!/SECRET|Harbour|Porridge|Call Mark|dry cleaning|dayNotes/.test(dayJson), '4 projection holds no Day Notes, work, food, or left-out item');
  check((daySnap.items || []).every(i => Object.keys(i).every(k => ['publicId', 'section', 'type', 'title', 'meta', 'category', 'date', 'status', 'isKeyTask', 'sourceLabel', 'sourceId'].includes(k))), '4 items carry share-safe fields only');
  await S.waitForSelector('#sheetCloseBtn'); await S.click('#sheetCloseBtn');
  check(await until(S, () => !document.getElementById('shareLiveLine').hidden && /Shared with Abi · updated/.test(document.getElementById('shareLiveLine').innerText)), '4 owner sees a quiet "Shared with Abi · updated" line');

  // 5 — Abi sees Today
  check(await until(A, () => /Book swimming lessons/.test(document.getElementById('partnerApp').innerText)), '5 partner Today shows the published day');
  const aToday = await txt(A, '#partnerApp');
  check(/Key outcomes/i.test(aToday) && /Finish the quarterly plan/.test(aToday) && /Family/i.test(aToday) && /Training/i.test(aToday), '5 Key outcomes, Family, Training');
  check(!/dry cleaning|Harbour|SECRET|Porridge/.test(aToday), '5 nothing unpublished appears');
  check(/Shaun.s day/.test(aToday), '5 titled "Shaun’s day"');
  await A.screenshot({ path: `${shots}/${tag}-05-partner-today.png`, fullPage: true });

  // 6 — Shaun publishes the week with a checkpoint
  await S.locator('#shareLiveLine').scrollIntoViewIfNeeded(); await S.click('#shareLiveLine');
  await S.waitForSelector('#shareState');
  check(/Live for Abi/.test(await txt(S, '#shareState')), '6 reopening shows what is live');
  await S.click('[data-share-period="week"]');
  await S.waitForSelector('[data-share-cp]');
  const pvw = await txt(S, '.share-preview');
  check(/School pickup/.test(pvw) && /Book swimming lessons/.test(pvw), '6 week preview spans the week');
  await S.screenshot({ path: `${shots}/${tag}-06-owner-publish-week.png` });
  await S.click('#sharePublishBtn');
  check(await until(S, () => /Shared with Abi/.test((document.querySelector('.pin-toast') || {}).textContent || '')), '6 week published');
  await S.click('#sheetCloseBtn');
  await A.click('[data-pp-tab="week"]');
  check(await until(A, () => /School pickup/.test(document.getElementById('partnerApp').innerText)), '6 partner This week shows the week');
  const wk = await txt(A, '#partnerApp');
  check(/Checkpoint (today|[A-Z][a-z]+day)|Review (today|[A-Z][a-z]+day)/.test(wk), '6 weekly rhythm shown (checkpoint / review)');
  check(!/score|%|behind|failed/i.test(wk), '6 no scores or shaming words');
  await A.screenshot({ path: `${shots}/${tag}-06-partner-week.png`, fullPage: true });
  await A.click('[data-pp-tab="today"]');

  // 7 — Abi asks for something
  await A.click('#ppAddReq');
  await A.waitForSelector('#ppReqText');
  check(/What do you need Shaun to do\?/i.test(await txt(A, '#ppSheet')), '7 request sheet asks "What do you need Shaun to do?"');
  check(!/Category|Priority/i.test(await txt(A, '#ppSheet')), '7 no categories or priorities for the partner');
  await A.fill('#ppReqText', 'Pick up nappies');
  await A.fill('#ppReqNote', 'The big pack');
  await A.screenshot({ path: `${shots}/${tag}-07-partner-request.png` });
  await A.click('#ppReqSave');
  check(await until(A, () => /Pick up nappies/.test(document.getElementById('partnerApp').innerText) && /Requested/.test(document.getElementById('partnerApp').innerText)), '7 partner sees "Pick up nappies · Requested"');

  // 8 — Shaun's Inbox
  check(await until(S, () => /Pick up nappies/.test((document.getElementById('inboxSection') || {}).innerText || '')), '8 owner Inbox shows the request');
  const ib = await txt(S, '#inboxSection');
  check(/FROM ABI/i.test(ib) && /Requested today/.test(ib) && /For today/.test(ib) && /The big pack/.test(ib), `8 "From Abi · Pick up nappies · Requested today" (${ib.replace(/\n/g, ' | ')})`);
  check(/Today/.test(ib) && /Choose day/.test(ib) && /Dismiss/.test(ib), '8 actions: Today / Choose day / Dismiss');
  await S.evaluate(() => document.getElementById('inboxSection').scrollIntoView({ block: 'center' }));
  await S.screenshot({ path: `${shots}/${tag}-08-owner-inbox.png` });
  await S.click('[data-ib-today]');

  // 9 — one Action, with provenance; request planned
  await sleep(1200);
  let acts = (await all('ledger_commitments')).filter(c => c.title === 'Pick up nappies');
  check(acts.length === 1 && acts[0].sourceType === 'partner_request' && acts[0].sourceLabel === 'Abi' && !!acts[0].sourceRequestId && acts[0].date === TODAY, '9 exactly one Action, sourceType partner_request, from Abi, today');
  let reqs = await all('ledger_shared_requests');
  let nap = reqs.find(r => r.text === 'Pick up nappies');
  check(nap.status === 'planned' && nap.plannedDate === TODAY && nap.linkedActionId === acts[0].id, '9 request planned, linked to the Action');
  check(await until(S, () => /Pick up nappies[\s\S]*From Abi/.test(document.getElementById('commitmentsList').innerText)), '9 the Action row says "From Abi"');
  check(await until(S, () => !/Pick up nappies/.test(document.getElementById('inboxSection').innerText)), '9 Inbox clears');

  // 10 — Abi sees Planned today
  check(await until(A, () => /Planned today/.test(document.getElementById('partnerApp').innerText)), '10 partner sees "Planned today"');
  check(!/Pick up nappies[\s\S]*Pick up nappies/.test(await txt(A, '#partnerApp')), '10 the request appears once, under From you');

  // 11 — Shaun completes it → Done
  await completeRow(S, 'Pick up nappies');
  check(await until(A, () => /Done ✓/.test(document.getElementById('partnerApp').innerText), null, 15000), '11 completing the Action shows "Done ✓" to the partner');
  await A.screenshot({ path: `${shots}/${tag}-11-partner-done.png`, fullPage: true });

  // 12 — live: moving a shared Action updates the projection
  await editRow(S, 'Order the birthday cake'); await S.fill('#f_commitDate', plus(1)); await S.click('#saveCommitBtn');
  check(await until(A, () => /Order the birthday cake[\s\S]{0,80}Moved to/.test(document.getElementById('partnerApp').innerText), null, 15000), '12 a moved Action reads "Moved to …" — live, without republishing');
  await completeRow(S, 'Book swimming lessons');
  check(await until(A, () => { const r = [...document.querySelectorAll('.pp-row')].find(x => /Book swimming/.test(x.innerText)); return r && r.classList.contains('st-done'); }, null, 15000), '12 a completed shared Action shows done');
  // a new family Action joins the published day by the preset's allow-list; a work one does not
  // written from elsewhere (another device): the owner's listeners pick them up
  await put('ledger_commitments/n1', { date: TODAY, originalDate: TODAY, title: 'Buy a present for Nan', category: 'family', status: 'planned', createdAt: new Date().toISOString() });
  await put('ledger_commitments/n2', { date: TODAY, originalDate: TODAY, title: 'Send the Harbour invoice', category: 'work', status: 'planned', createdAt: new Date().toISOString() });
  check(await until(A, () => /Buy a present for Nan/.test(document.getElementById('partnerApp').innerText), null, 15000), '12 a new family Action appears live');
  check(!/Harbour/.test(await txt(A, '#partnerApp')), '12 a new work Action does not');

  // 13 — Choose day, then the Action is deleted → back to Requested, never Done
  await A.click('#ppAddReq'); await A.fill('#ppReqText', 'Fix the gate');
  await A.click('[data-pp-timing="week"]'); await A.click('#ppReqSave');
  check(await until(S, () => /Fix the gate/.test(document.getElementById('inboxSection').innerText)), '13 second request reaches the Inbox');
  await S.click('[data-ib-day]');
  await S.waitForSelector('#rqConfirmBtn');
  await S.screenshot({ path: `${shots}/${tag}-13-owner-choose-day.png` });
  const target = plus(2);
  await S.fill('#f_rqDay', target); await S.click('#rqConfirmBtn');
  const dayName = new Date(target + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' });
  check(await until(A, n => new RegExp('Planned ' + n).test(document.getElementById('partnerApp').innerText), dayName), `13 partner sees "Planned ${dayName}"`);
  await sleep(600);
  const gateActs = (await all('ledger_commitments')).filter(c => c.title === 'Fix the gate');
  check(gateActs.length === 1 && gateActs[0].date === target, '13 one Action, on the chosen day');
  // deleted elsewhere (another device, or the Plan): the owner's listener sees it go
  await del('ledger_commitments/' + gateActs[0].id);
  await sleep(1500);
  reqs = await all('ledger_shared_requests');
  const gate = reqs.find(r => r.text === 'Fix the gate');
  check(gate.status === 'requested' && !gate.linkedActionId && !gate.plannedDate, '13 deleting the Action returns the request to Requested (never Done)');
  check(await until(S, () => /Fix the gate/.test(document.getElementById('inboxSection').innerText)), '13 …and it is back in the Inbox');

  // 14 — dismiss, with undo; then dismiss for real. An undone dismissal writes nothing.
  await S.click('[data-ib-dismiss]');
  check(await until(S, () => /Set aside/.test((document.querySelector('.pin-toast') || {}).textContent || '')), '14 dismiss: "Set aside" with Undo');
  check(await until(S, () => !/Fix the gate/.test(document.getElementById('inboxSection').innerText)), '14 the row leaves the Inbox at once');
  await S.click('.pin-toast-act');
  check(await until(S, () => /Fix the gate/.test(document.getElementById('inboxSection').innerText)), '14 undo brings it back');
  await sleep(6000);
  check((await all('ledger_shared_requests')).find(r => r.text === 'Fix the gate').status === 'requested', '14 undo restores it — nothing was written');
  const gateId = (await all('ledger_shared_requests')).find(r => r.text === 'Fix the gate').id;
  check(!(await all('ledger_shared_request_updates')).some(u => u.requestId === gateId && u.type === 'dismissed'), '14 an undone dismissal leaves no trace in Updates');
  await S.click('[data-ib-dismiss]'); await sleep(7000);
  const dis = (await all('ledger_shared_requests')).find(r => r.text === 'Fix the gate');
  check(dis.status === 'dismissed', '14 dismissed is a status, not a deletion');
  check((await all('ledger_shared_request_updates')).filter(u => u.requestId === gateId && u.type === 'dismissed').length === 1, '14 one "dismissed" entry');
  check(await until(A, () => /Set aside/.test(document.getElementById('partnerApp').innerText)), '14 partner sees gentle "Set aside"');

  // 15 — partner edits before processing; withdraws as a state; after processing, Updates only
  await A.click('#ppAddReq'); await A.fill('#ppReqText', 'Ring the plumber'); await A.click('[data-pp-timing="none"]'); await A.click('#ppReqSave');
  await sleep(800);
  await A.click('.pp-req:has-text("Ring the plumber")');
  await A.waitForSelector('#rqEdit');
  await A.click('#rqEdit'); await A.waitForSelector('#ppReqText');
  await A.fill('#ppReqText', 'Ring the plumber about the boiler'); await A.click('#ppReqSave');
  check(await until(A, () => /Ring the plumber about the boiler/.test((document.getElementById('rqTitle') || {}).textContent || '')), '15 partner can edit an unprocessed request');
  await A.click('#rqWithdraw');
  check(await until(A, () => /Ring the plumber about the boiler[\s\S]{0,40}Withdrawn/.test(document.getElementById('partnerApp').innerText)), '15 …or withdraw it (kept, as Withdrawn)');
  await sleep(1200);
  const plumber = (await all('ledger_shared_requests')).find(r => /plumber/.test(r.text));
  check(plumber.status === 'withdrawn', '15 withdrawn is a status');
  const plumberUpd = (await all('ledger_shared_request_updates')).filter(u => u.requestId === plumber.id).map(u => u.type).sort().join(',');
  check(plumberUpd === 'request_created,withdrawn', '15 its history: asked, withdrawn (' + plumberUpd + ')');
  check(await until(S, () => !/plumber/.test(document.getElementById('inboxSection').innerText)), '15 a withdrawn request is not in the Inbox');
  await A.click('.pp-req:has-text("Pick up nappies")');
  await A.waitForSelector('#rqTimeline');
  check(!(await A.$('#rqEdit')) && !!(await A.$('#rqText')), '15 a processed request is reference only — but can take an update');
  await A.click('#ppSheet .sheet-close');

  // ---------- Updates: a request's shared history (Phase 2.5) ----------
  // U1 — Abi asks
  await A.click('#ppAddReq'); await A.fill('#ppReqText', 'Pick up prescription'); await A.click('#ppReqSave');
  // U2 — it reaches Shaun's Inbox
  check(await until(S, () => /Pick up prescription/.test(document.getElementById('inboxSection').innerText)), 'U2 the request reaches the Inbox');
  let rx = (await all('ledger_shared_requests')).find(r => r.text === 'Pick up prescription');
  const evOf = async (type) => (await all('ledger_shared_request_updates')).filter(u => u.requestId === rx.id && (!type || u.type === type));
  // U3 — "asked" is recorded
  check((await evOf('request_created')).length === 1, 'U3 a request_created entry exists');
  // U4 — Shaun opens it
  await S.click('.ib-row:has-text("Pick up prescription") .ib-body');
  await S.waitForSelector('#rqTimeline');
  check(await until(S, () => /Asked by Abi/.test(document.getElementById('rqTimeline').innerText)), 'U4 the detail shows the request and "Asked by Abi"');
  check(/Requested/.test(await txt(S, '#rqState')), 'U4 current state: Requested');
  // U5 — Today, from the detail
  await S.click('#rqToday');
  check(await until(S, () => /Planned for today/.test(document.getElementById('rqTimeline').innerText)), 'U7 the timeline shows "Planned for today"');
  // U6 — exactly one Action
  await sleep(800);
  let rxActs = (await all('ledger_commitments')).filter(c => c.sourceRequestId === rx.id);
  check(rxActs.length === 1, 'U6 exactly one Action for the request');
  // a private detail on that Action, which must never reach the partner
  { const { id, ...rest } = rxActs[0]; await put('ledger_commitments/' + id, Object.assign(rest, { minVersion: 'PRIVATE-MIN note about the pharmacy' })); }
  check(await until(S, () => /Your action/i.test(document.getElementById('rqAct').innerText)), 'U6 the detail links the Action');
  // U8 — Shaun adds an update
  await S.fill('#rqText', "I'll do this after lunch."); await S.click('#rqSend');
  check(await until(S, () => /I.ll do this after lunch\./.test(document.getElementById('rqTimeline').innerText)), 'U8 the owner update appears in the timeline');
  await S.screenshot({ path: `${shots}/${tag}-U08-owner-detail.png` });
  await S.click('#sheetCloseBtn');   // an update arriving while the request is open is read on arrival
  // U9 — Abi sees it, first as a quiet signal
  check(await until(A, () => /Shaun updated/.test(document.getElementById('partnerApp').innerText)), 'U9 partner list says "Shaun updated"');
  await A.screenshot({ path: `${shots}/${tag}-U09-partner-signal.png`, fullPage: true });
  await A.click('.pp-req:has-text("Pick up prescription")');
  check(await until(A, () => /I.ll do this after lunch\./.test(document.getElementById('rqTimeline').innerText)), 'U9 partner sees the update in the timeline');
  // U10 — Abi replies
  await A.fill('#rqText', 'Please get the larger size.'); await A.click('#rqSend');
  check(await until(A, () => /Please get the larger size\./.test(document.getElementById('rqTimeline').innerText)), 'U10 partner update appears');
  await A.screenshot({ path: `${shots}/${tag}-U10-partner-detail.png` });
  await A.click('#ppSheet .sheet-close');
  check(await until(A, () => !/Shaun updated/.test(document.getElementById('partnerApp').innerText)), 'U10 opening it cleared the partner signal');
  // U11 — Shaun gets "Update from Abi", one coherent row
  check(await until(S, () => /Update from Abi/i.test(document.getElementById('inboxSection').innerText) && /Please get the larger size/.test(document.getElementById('inboxSection').innerText)), 'U11 Inbox: "Update from Abi" with the update');
  const ibText = await txt(S, '#inboxSection');
  check((ibText.match(/Pick up prescription/g) || []).length === 1 && /Review/.test(ibText), 'U11 one row, with Review');
  await S.evaluate(() => document.getElementById('inboxSection').scrollIntoView({ block: 'center' }));
  await S.screenshot({ path: `${shots}/${tag}-U11-owner-inbox-update.png` });
  // U12 — no new Action
  check((await all('ledger_commitments')).filter(c => c.sourceRequestId === rx.id).length === 1, 'U12 an update never makes another Action');
  // U13 — Review clears it
  await S.click('.ib-row:has-text("Pick up prescription") [data-ib-open]:not(.ib-body)');
  await S.waitForSelector('#rqTimeline');
  await sleep(800);
  rx = (await all('ledger_shared_requests')).find(r => r.text === 'Pick up prescription');
  check(rx.ownerLastReadAt >= rx.latestCommentAt, 'U13 opening marks it read (ownerLastReadAt)');
  // a second owner device is open meanwhile: its syncing must not double anything
  const S2 = await session('shaun-2');
  await signIn(S2, SHAUN);
  await until(S2, () => /Book swimming lessons/.test(document.querySelector('main').innerText), null, 20000);
  // U14 — Shaun moves the Action to tomorrow (from the request, into the Action's editor)
  await S.click('#rqAction'); await S.waitForSelector('#f_commitDate');
  await S.fill('#f_commitDate', plus(1)); await S.click('#saveCommitBtn');
  await sleep(2500);
  check((await evOf('moved')).length === 1, 'U15 one "moved" entry (two owner devices open)');
  check(!/Pick up prescription/.test(await txt(S, '#inboxSection')), 'U13 the Inbox row has cleared');
  // U16 — complete it from its editor
  await S.click('.tab-btn[data-view="focus"]'); await openSettings(S); await S.waitForSelector('#setShareReq');
  await S.click('#setShareReq'); await S.waitForSelector('.rq-li');
  await S.click('.rq-li:has-text("Pick up prescription")'); await S.waitForSelector('#rqTimeline');
  check(await until(S, () => /Moved to tomorrow/.test(document.getElementById('rqTimeline').innerText)), 'U15 the timeline shows a quiet "Moved to tomorrow"');
  await S.click('#rqAction'); await S.waitForSelector('#commitStatusGrid');
  await S.click('#commitStatusGrid [data-s="completed"]'); await S.click('#saveCommitBtn');
  await sleep(2500);
  check((await evOf('status')).filter(u => (u.metadata || {}).status === 'done').length === 1, 'U17 one "done" entry');
  await backToToday(S);
  await S.click('.tab-btn[data-view="focus"]'); await openSettings(S); await S.waitForSelector('#setShareReq');
  await S.click('#setShareReq'); await S.waitForSelector('.rq-li');
  await S.click('.rq-li:has-text("Pick up prescription")'); await S.waitForSelector('#rqTimeline');
  check(await until(S, () => /Done ✓/.test(document.getElementById('rqTimeline').innerText) && /Done ✓/.test(document.getElementById('rqState').innerText)), 'U17 the timeline and state say Done ✓');
  await S.screenshot({ path: `${shots}/${tag}-U17-owner-history.png` });
  await S.click('#sheetCloseBtn'); await backToToday(S);
  // re-renders and a reload of the second device do not repeat anything
  await S2.reload(); await sleep(4000);
  const kinds = (await evOf()).map(u => u.type + ((u.metadata || {}).status ? ':' + u.metadata.status : '')).sort().join(',');
  check(kinds === 'comment,comment,moved,planned,request_created,status:done', 'U21 history is exactly asked, planned, 2 updates, moved, done — idempotent (' + kinds + ')');
  // U18 — Abi sees Done and the whole story
  await A.click('.pp-req:has-text("Pick up prescription")'); await A.waitForSelector('#rqTimeline');
  check(await until(A, () => {
    const t = document.getElementById('rqTimeline').innerText;
    return /Done ✓/.test(document.getElementById('rqState').innerText) && /You asked/.test(t) && /Planned for today/.test(t) && /after lunch/.test(t) && /larger size/.test(t) && /Moved to tomorrow/.test(t) && /Done ✓/.test(t);
  }), 'U18 partner sees Done ✓ and the full history');
  await A.screenshot({ path: `${shots}/${tag}-U18-partner-history.png` });
  await A.click('#ppSheet .sheet-close');
  // U19 — Abi cannot touch the Action, nor plan through the request
  const touch = await A.evaluate(async (ids) => {
    const db = firebase.firestore(), out = {};
    const tryIt = async (k, f) => { try { await f(); out[k] = 'ALLOWED'; } catch (e){ out[k] = e.code; } };
    await tryIt('read action', () => db.collection('ledger_commitments').doc(ids.act).get());
    await tryIt('move action', () => db.collection('ledger_commitments').doc(ids.act).update({ date: '2030-01-01' }));
    await tryIt('complete action', () => db.collection('ledger_commitments').doc(ids.act).update({ status: 'completed' }));
    await tryIt('replan request', () => db.collection('ledger_shared_requests').doc(ids.req).update({ plannedDate: '2030-01-01' }));
    await tryIt('fake done event', () => db.collection('ledger_shared_request_updates').add({ requestId: ids.req, ownerUid: ids.owner, partnerUid: ids.abi,
      type: 'status', actorUid: ids.abi, actorRole: 'system', text: null, createdAt: firebase.firestore.FieldValue.serverTimestamp(), metadata: { status: 'done' } }));
    await tryIt('comment as Shaun', () => db.collection('ledger_shared_request_updates').add({ requestId: ids.req, ownerUid: ids.owner, partnerUid: ids.abi,
      type: 'comment', actorUid: ids.owner, actorRole: 'owner', text: 'fake', createdAt: firebase.firestore.FieldValue.serverTimestamp(), metadata: {} }));
    return out;
  }, { act: rxActs[0].id, req: rx.id, owner, abi });
  check(Object.values(touch).every(v => v === 'permission-denied'), 'U19 partner cannot read, move or complete the Action, replan, or fake an entry: ' + JSON.stringify(touch));
  // U20 — nothing private crosses
  const updJson = JSON.stringify(await all('ledger_shared_request_updates'));
  check(!/SECRET|PRIVATE-MIN|Harbour|Porridge/.test(updJson), 'U20 no private notes in shared Updates');
  check(!/SECRET|PRIVATE-MIN/.test(await A.evaluate(() => document.documentElement.innerHTML)), 'U20 …nor on the partner page');
  await S2.context().close();

  // 16 — the boundary: Abi cannot reach private data, by any route the SDK offers
  const probe = await A.evaluate(async (ids) => {
    const db = firebase.firestore(), out = {};
    const tryIt = async (k, f) => { try { await f(); out[k] = 'ALLOWED'; } catch (e){ out[k] = e.code; } };
    for (const c of ['ledger_commitments', 'ledger_plans', 'ledger_sessions', 'ledger_meta', 'ledger_day_status', 'ledger_matters', 'ledger_conversations', 'ledger_focus', 'ledger_priorities', 'ledger_challenges', 'ledger_meals'])
      await tryIt(c, () => db.collection(c).get());
    await tryIt('plan doc', () => db.collection('ledger_plans').doc(ids.today).get());
    await tryIt('sharing meta', () => db.collection('ledger_meta').doc('sharing').get());
    await tryIt('own profile write', () => db.collection('ledger_users').doc(ids.abi).set({ role: 'owner' }));
    await tryIt('plan a request', () => db.collection('ledger_shared_requests').where('ownerUid', '==', ids.owner).where('partnerUid', '==', ids.abi).get()
      .then(s => db.collection('ledger_shared_requests').doc(s.docs.find(d => d.data().status === 'requested' || d.data().status === 'dismissed').id).update({ status: 'done', linkedActionId: 'x' })));
    await tryIt('write projection', () => db.collection('ledger_shared_snapshots').doc(ids.owner + '_' + ids.abi + '_day_' + ids.today).update({ title: 'x' }));
    await tryIt('membership write', () => db.collection('ledger_share_members').doc(ids.owner + '_' + ids.abi).update({ active: true }));
    return out;
  }, { owner, abi, today: TODAY });
  check(Object.values(probe).every(v => v === 'permission-denied'), '16 partner is refused every private read and every owner-only write: ' + JSON.stringify(probe));
  const ls = await A.evaluate(() => Object.keys(localStorage).filter(k => /fallback/.test(k)));
  check(ls.length === 0, '16 partner device holds no Ledger data in localStorage (' + ls.join(',') + ')');
  check(!/SECRET/.test(await A.evaluate(() => document.documentElement.innerHTML)), '16 Day Notes never reach the partner page');
  const allShared = JSON.stringify(await all('ledger_shared_snapshots')) + JSON.stringify(await all('ledger_shared_requests')) + JSON.stringify(await all('ledger_share_members'));
  check(!/SECRET|dayNotes|Harbour|Porridge/.test(allShared), '16 nothing private in the shared namespace');

  // 17 — pause hides everything; resume restores it
  await openSettings(S); await S.waitForSelector('#setShareToggle');
  await S.screenshot({ path: `${shots}/${tag}-17-settings-partner.png` });
  await S.click('#setShareToggle');
  check(await until(A, () => document.getElementById('partnerApp').hidden && document.getElementById('authCard').getAttribute('data-state') === 'partner' && /paused/i.test(document.getElementById('authCard').innerText)), '17 pausing hides the portal ("Sharing is paused")');
  const pausedRead = await A.evaluate(async (ids) => { try { await firebase.firestore().collection('ledger_shared_snapshots').doc(ids.owner + '_' + ids.abi + '_day_' + ids.today).get(); return 'ALLOWED'; } catch (e){ return e.code; } }, { owner, abi, today: TODAY });
  check(pausedRead === 'permission-denied', '17 while paused the rules refuse the projection too');
  await S.waitForSelector('#setShareToggle'); await S.click('#setShareToggle');
  check(await until(A, () => !document.getElementById('partnerApp').hidden && /Book swimming/.test(document.getElementById('partnerApp').innerText)), '17 resuming restores it');
  await S.click('#sheetCloseBtn'); await backToToday(S);

  // 18 — image sharing still works
  await openShare(S);
  await S.waitForSelector('[data-snap-mode-to="image"]');
  await S.click('[data-snap-mode-to="image"]');
  check(await until(S, () => { const i = document.getElementById('snapImg'); return i && !i.hidden && i.naturalWidth === 1080; }), '18 image mode still draws the snapshot');
  const dl = S.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await S.click('#snapSaveBtn');
  const d = await dl;
  check(!!d && /ledger-\d{4}-\d\d-\d\d\.png/.test(d.suggestedFilename()), '18 Save image still downloads ' + (d && d.suggestedFilename()));
  check(await S.evaluate(() => document.querySelectorAll('[data-snap-preset]').length >= 3), '18 presets still listed (incl. Abi)');
  await S.screenshot({ path: `${shots}/${tag}-18-owner-image-mode.png` });
  await S.click('#sheetCloseBtn');

  // ---------- password sign-in (the main way in), the email link kept as a backup ----------
  const IDT = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`;
  const post = async (path, body) => (await fetch(`${IDT}/${path}?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const codeFor = async (email, type) => (await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/oobCodes`)).json()).oobCodes.filter(c => c.email === email && c.requestType === type).pop();
  // an account made by email link alone gains a password through the password email — same account
  await post('accounts:sendOobCode', { requestType: 'EMAIL_SIGNIN', email: 'linkonly@example.com', continueUrl: APP, canHandleCodeInApp: true });
  const lo = await post('accounts:signInWithEmailLink', { email: 'linkonly@example.com', oobCode: (await codeFor('linkonly@example.com', 'EMAIL_SIGNIN')).oobCode });
  await post('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: 'linkonly@example.com' });
  await post('accounts:resetPassword', { oobCode: (await codeFor('linkonly@example.com', 'PASSWORD_RESET')).oobCode, newPassword: 'linkonly-pass-1' });
  const lo2 = await post('accounts:signInWithPassword', { email: 'linkonly@example.com', password: 'linkonly-pass-1', returnSecureToken: true });
  check(lo.localId && lo2.localId === lo.localId, 'P1 a link-only account gains a password and keeps its account id');
  // Shaun sets a password in Settings
  await openSettings(S); await S.waitForSelector('#setPassword');
  await S.click('#setPassword'); await S.waitForSelector('#pwNew');
  await S.fill('#pwNew', 'short'); await S.fill('#pwAgain', 'short'); await S.click('#pwSave');
  check(/at least 8/.test(await txt(S, '#pwErr')), 'P2 a short password is refused');
  await S.fill('#pwNew', 'correct-horse-9'); await S.fill('#pwAgain', 'correct-horse-9'); await S.click('#pwSave');
  check(await until(S, () => /Password saved/.test((document.querySelector('.pin-toast') || {}).textContent || '')), 'P2 owner sets a password from Settings');
  // sign out, then back in with it
  await openSettings(S); await S.waitForSelector('#setSignOut'); await S.click('#setSignOut');
  check(await until(S, () => (document.getElementById('authCard') || { getAttribute: () => null }).getAttribute('data-state') === 'signin' && !!document.getElementById('authPassword'), null, 20000), 'P3 signed out: the sign-in screen');
  check(await S.evaluate(() => !!document.getElementById('authPassword') && /Sign in/.test(document.getElementById('authSignIn').textContent) && !!document.getElementById('authSend')), 'P3 password first, email link offered underneath');
  await S.screenshot({ path: `${shots}/${tag}-P3-signin.png` });
  await S.fill('#authEmail', SHAUN); await S.fill('#authPassword', 'not-the-password'); await S.click('#authSignIn');
  check(await until(S, () => /don.t match/.test(document.getElementById('authError').textContent) && /· auth\//.test(document.getElementById('authError').textContent)), 'P4 a wrong password is named, with its code: ' + await S.evaluate(() => document.getElementById('authError').textContent));
  await S.fill('#authPassword', 'correct-horse-9'); await S.click('#authSignIn');
  check(await until(S, () => /Book swimming lessons/.test(document.querySelector('main').innerText) && document.getElementById('authGate').hidden, null, 20000), 'P5 password sign-in opens Ledger with its data');
  check(await S.evaluate(o => { const r = JSON.parse(localStorage.getItem('ledger_auth_role')); return r.uid === o && r.role === 'owner'; }, owner), 'P5 same account, still the owner');
  await S.reload();
  check(await until(S, () => /Book swimming lessons/.test(document.querySelector('main').innerText) && document.getElementById('authGate').hidden), 'P5 a reload stays signed in');
  // Abi sets one through the password email, then signs in with it
  await A.click('#ppSignOut');
  check(await until(A, () => (document.getElementById('authCard') || { getAttribute: () => null }).getAttribute('data-state') === 'signin' && !!document.getElementById('authPassword'), null, 20000), 'P6 partner signed out');
  await A.fill('#authEmail', ABI); await A.click('#authReset');
  check(await until(A, () => (document.getElementById('authCard') || { getAttribute: () => null }).getAttribute('data-state') === 'reset'), 'P6 "Set or reset your password" sends the password email');
  const rs = await codeFor(ABI, 'PASSWORD_RESET');
  check(!!rs && new URL(rs.oobLink).searchParams.get('continueUrl') === APP, 'P6 its link comes back to Ledger');
  await post('accounts:resetPassword', { oobCode: rs.oobCode, newPassword: 'abi-new-pass-1' });
  await A.click('#authRestart'); await A.waitForSelector('#authPassword');
  await A.fill('#authEmail', ABI); await A.fill('#authPassword', 'abi-new-pass-1'); await A.click('#authSignIn');
  check(await until(A, () => !document.getElementById('partnerApp').hidden && /Book swimming/.test(document.getElementById('partnerApp').innerText), null, 20000), 'P7 partner signs in with the new password: her shared view, as before');

  // layout: no sideways scroll anywhere we looked
  const sx = async p => p.evaluate(() => { const el = document.getElementById('partnerApp'); return Math.max(document.documentElement.scrollWidth, el && !el.hidden ? el.scrollWidth : 0) <= innerWidth + 1; });
  check(await sx(A), 'partner portal has no horizontal scroll');
  await A.screenshot({ path: `${shots}/${tag}-19-partner-final.png`, fullPage: true });
  await S.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await S.screenshot({ path: `${shots}/${tag}-19-owner-foot.png` });

  check(!S.errs.length, 'owner: no page errors ' + S.errs.slice(0, 3).join(' | '));
  check(!A.errs.length, 'partner: no page errors ' + A.errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  if (bad.length) console.log(bad.join('\n'));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
