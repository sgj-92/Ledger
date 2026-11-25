// The coach (2026-11-25), end to end over the Auth and Firestore emulators:
//   - why it matters: the server's line shows under the title on Today and in the sheet
//     ("suggested by Claude"); clearing it stays cleared; a line typed on a new Action is his;
//   - moving an Action to another day counts the move on the Action (moveCount);
//   - the focus block: locked from its Morning Prime step, saved on the day's plan, live on
//     the Mac; marked in Flow; the push's link starts the timer on its Action;
//   - following through: the week's counts in Progress, and the Actions moved 3+ times;
//   - Settings → Reminders: the nudges switch.
// (The server halves — Claude's line, the nudges, the focus block's push — are in
// tests/functions/coach.test.js and remind.test.js.)
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node coach.test.js"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PID = 'ledger-6aec3';
const PORT = 8962;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m, why) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && why ? ' — ' + why : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const NOW_MIN = (() => { const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number); return h * 60 + m; })();
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

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
const S = v => ({ stringValue: v }), N = v => ({ integerValue: String(v) }), B = v => ({ booleanValue: v });
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
async function get(docPath){
  const r = await fetch(`${FS}/${docPath}`, { headers: ADMIN });
  if (!r.ok) return null;
  const j = await r.json();
  return dec({ mapValue: { fields: j.fields } });
}
async function wait(fn){ for (let i = 0; i < 30; i++){ const v = await fn(); if (v) return v; await sleep(300); } return null; }

(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'shaun@example.com', password: 'pw-123456', returnSecureToken: true }) });
  const owner = (await r.json()).localId;
  const day = n => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  await put(`ledger_users/${owner}`, { role: S('owner'), displayName: S('Shaun'), createdAt: S(TODAY) });
  await put('ledger_meta/presets', { prioritiesSeeded: B(true) });
  const act = (id, title, date, extra) => put('ledger_commitments/' + id, Object.assign({ title: S(title), date: S(date), originalDate: S(date), status: S('planned'),
    category: S('work'), createdAt: S(TODAY + 'T08:00:00Z') }, extra || {}));
  await act('w1', 'Write the Hill proposal', TODAY, { isKeyTask: B(true), why: S('Wins the Hill contract before Christmas'), whySuggested: B(true) });
  await act('w2', 'Book the MOT', TODAY);
  await act('w3', 'Call the accountant', TODAY, { originalDate: S(day(-9)), moveCount: N(3) });
  await act('w4', 'Reply to Tom', TODAY, { status: S('completed') });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  async function device(name, width, url){
    const ctx = await b.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, timezoneId: 'Europe/London' });
    await ctx.route(/api\.github\.com/, x => x.abort());
    await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, x => {
      const f = x.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
      x.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
    });
    await ctx.addInitScript(() => { localStorage.setItem('ledger_emulator', '1'); });
    const p = await ctx.newPage(); p.errs = []; p.name = name;
    p.on('pageerror', e => p.errs.push(String(e)));
    await p.goto(url || APP);
    await p.waitForSelector('#authEmail', { timeout: 20000 });
    await p.fill('#authEmail', 'shaun@example.com'); await p.fill('#authPassword', 'pw-123456'); await p.click('#authSignIn');
    await p.waitForFunction(() => document.getElementById('authGate').hidden, null, { timeout: 25000 });
    return p;
  }
  const until = async (p, fn, arg, t) => { try { await p.waitForFunction(fn, arg, { timeout: t || 12000 }); return true; } catch (e){ return false; } };
  const tap = (p, sel) => p.evaluate(s => document.querySelector(s).click(), sel);

  const phone = await device('phone', 390), mac = await device('mac', 1440);
  check(true, 'Shaun signed in on his phone and his Mac');

  // ---- why it matters ----
  check(await until(phone, () => [...document.querySelectorAll('.commitment-why')].some(e => e.textContent === 'Wins the Hill contract before Christmas')),
    'Today: the why line under the title');
  check(await phone.evaluate(() => ![...document.querySelectorAll('.commitment-item')].some(r => /Reply to Tom/.test(r.innerText) && r.querySelector('.commitment-why'))),
    'Today: no why line on a done Action');
  await phone.evaluate(() => [...document.querySelectorAll('.commitment-item')].find(r => /Write the Hill/.test(r.innerText)).click());
  await phone.waitForSelector('#f_commitWhy');
  check(await phone.evaluate(() => document.getElementById('f_commitWhy').value === 'Wins the Hill contract before Christmas' && !document.getElementById('commitWhyBy').hidden),
    'Sheet: the line, marked as suggested by Claude');
  await phone.fill('#f_commitWhy', '');
  await phone.click('#saveCommitBtn');
  const w1 = await wait(async () => { const d = await get('ledger_commitments/w1'); return d && d.why === '' ? d : null; });
  check(w1 && w1.whySuggested === false && w1.isKeyTask === true && w1.title === 'Write the Hill proposal', 'Cleared: why is empty (so it stays cleared), the rest kept', JSON.stringify(w1));
  check(await until(mac, () => ![...document.querySelectorAll('.commitment-why')].some(e => /Hill contract/.test(e.textContent))), 'Mac: the cleared line is gone, live');
  // his own line on another
  await phone.evaluate(() => [...document.querySelectorAll('.commitment-item')].find(r => /Book the MOT/.test(r.innerText)).click());
  await phone.waitForSelector('#f_commitWhy');
  await phone.fill('#f_commitWhy', 'Keeps the car legal');
  await phone.click('#saveCommitBtn');
  const w2 = await wait(async () => { const d = await get('ledger_commitments/w2'); return d && d.why ? d : null; });
  check(w2 && w2.why === 'Keeps the car legal' && w2.whySuggested === false, 'Typed: his own line, not marked as Claude\'s');
  // an edit that doesn't touch the why leaves the field alone (Claude can still suggest one for a new Action)
  await act('w5', 'Renew insurance', TODAY);
  await until(phone, () => /Renew insurance/.test(document.getElementById('commitmentsList').innerText));
  await phone.evaluate(() => [...document.querySelectorAll('.commitment-item')].find(r => /Renew insurance/.test(r.innerText)).click());
  await phone.waitForSelector('#f_commitWhy');
  await phone.fill('#f_commitTitle', 'Renew the car insurance');
  await phone.click('#saveCommitBtn');
  const w5 = await wait(async () => { const d = await get('ledger_commitments/w5'); return d && d.title === 'Renew the car insurance' ? d : null; });
  check(w5 && !('why' in w5), 'An edit that leaves the why untouched writes no why', JSON.stringify(w5));
  // the server's line arriving after a device took its copy is kept by that device's next save
  await put('ledger_commitments/w5', { title: S('Renew the car insurance'), date: S(TODAY), originalDate: S(TODAY), status: S('planned'), category: S('work'),
    createdAt: S(TODAY + 'T08:00:00Z'), why: S('Keeps you covered on the road'), whySuggested: B(true) });
  await until(phone, () => [...document.querySelectorAll('.commitment-why')].some(e => /covered on the road/.test(e.textContent)));
  await phone.evaluate(() => [...document.querySelectorAll('.commitment-item')].find(r => /Renew the car/.test(r.innerText)).querySelector('.commitment-status-dot').click());
  const w5b = await wait(async () => { const d = await get('ledger_commitments/w5'); return d && d.status === 'completed' ? d : null; });
  check(w5b && w5b.why === 'Keeps you covered on the road' && w5b.whySuggested === true, 'Ticking it off keeps the line', JSON.stringify(w5b));

  // ---- a move is counted ----
  await phone.evaluate(() => [...document.querySelectorAll('.commitment-item')].find(r => /Book the MOT/.test(r.innerText)).click());
  await phone.waitForSelector('#f_commitDate');
  await phone.evaluate(d => { const e = document.getElementById('f_commitDate'); e.value = d; e.dispatchEvent(new Event('change', { bubbles: true })); }, day(1));
  await phone.click('#saveCommitBtn');
  const moved = await wait(async () => { const d = await get('ledger_commitments/w2'); return d && d.date === day(1) ? d : null; });
  check(moved && moved.moveCount === 1 && moved.originalDate === TODAY && moved.why === 'Keeps the car legal', 'Moved: counted on the Action (moveCount 1), first day and why kept', JSON.stringify(moved));

  // ---- the focus block ----
  await until(phone, () => !!document.querySelector('[data-rt-open="plan-focus"]'));
  check(await phone.evaluate(() => /Lock your focus block/.test(document.querySelector('[data-rt-label="plan-focus"]').textContent)), 'Morning Prime: a "Lock your focus block" step');
  await tap(phone, '[data-rt-open="plan-focus"]');
  await phone.waitForSelector('#fbTime');
  check(await phone.evaluate(() => { const r = document.querySelector('[data-fb-act][aria-checked="true"]'); return r && /Write the Hill/.test(r.innerText); }),
    'The sheet offers today\'s Actions, the key task chosen');
  const start = Math.max(0, NOW_MIN - 10);
  await phone.fill('#fbTime', hm(start));
  await phone.click('[data-fb-len="120"]');
  await phone.click('#fbLock');
  const plan = await wait(async () => { const d = await get('ledger_plans/' + TODAY); return d && d.focusBlock ? d : null; });
  check(plan && plan.focusBlock.time === hm(start) && plan.focusBlock.durationMin === 120 && plan.focusBlock.actionId === 'w1', 'Locked: on the day\'s plan', JSON.stringify(plan && plan.focusBlock));
  check(await until(phone, (t) => { const e = document.querySelector('[data-rt-open="plan-focus"]'); return e && e.textContent.indexOf(t) > -1; }, hm(start) + '–' + hm(start + 120)),
    'The step shows the block\'s times');
  check(await until(mac, () => /Focus block/i.test(document.getElementById('focusBlockCue').innerText) && /Write the Hill/.test(document.getElementById('focusBlockCue').innerText)),
    'Mac: the focus block on Today, live');
  if (NOW_MIN < 23 * 60 && NOW_MIN >= 10){
    check(await phone.evaluate(() => /left/.test(document.getElementById('focusBlockCue').innerText) && !!document.getElementById('fbStart')), 'Under way: time left, and Start');
  }
  // Flow
  await phone.click('[data-today-mode="flow"]');
  check(await until(phone, () => { const e = document.getElementById('flowFocusBlock'); return e && /Focus block/.test(e.innerText) && /Write the Hill/.test(e.innerText); }), 'Flow: the block on the timeline');
  await phone.click('[data-today-mode="overview"]');
  // the push's link
  const push = await device('push', 390, APP + '?open=focus-block');
  if (NOW_MIN < 23 * 60 && NOW_MIN >= 10){
    check(await until(push, () => { const f = document.querySelector('.focus-full'); return f && !f.hidden && /Write the Hill/.test(f.innerText); }, null, 20000),
      'The push\'s link starts the focus timer on its Action, full screen');
    const focus = await wait(async () => { const d = await get('ledger_meta/currentFocus'); return d && d.sourceId === 'w1' && d.endsAt ? d : null; });
    check(focus && focus.timerMin > 100 && focus.timerMin <= 110, 'The timer runs for what the block has left', JSON.stringify(focus && { m: focus.timerMin }));
    check(await until(phone, () => document.getElementById('focusBlockCue').innerHTML === '' && /Write the Hill/.test(document.getElementById('nowCue').innerText)),
      'Once started, Now carries it (no second card)');
  }

  // ---- following through ----
  await phone.click('.tab-btn[data-view="me"]');
  await phone.click('[data-me-sub="stats"]');
  check(await until(phone, () => !!document.querySelector('#followThrough .ft-stats')), 'Progress: a Following through card');
  const stats = await phone.evaluate(() => [...document.querySelectorAll('.ft-stat')].map(e => e.querySelector('.ft-l').textContent + '=' + e.querySelector('.ft-n').textContent).join('|'));
  check(/Planned=\d+/.test(stats) && /Done on the day=\d+/.test(stats) && /Done later=\d+/.test(stats) && /Moved=\d+/.test(stats) && /Still open=\d+/.test(stats),
    'Five counts: planned, done on the day, done later, moved, still open', stats);
  check(await phone.evaluate(() => document.querySelectorAll('.ft-col').length === 8 && !/%/.test(document.getElementById('followThrough').innerText)), 'Eight weeks of bars, and no percentage anywhere');
  check(await phone.evaluate(() => [...document.querySelectorAll('.ft-stuck-row')].some(e => /Call the accountant/.test(e.innerText) && /Moved 3 times/.test(e.innerText))),
    'Moved 3 times or more: listed');

  // ---- Settings → Reminders: the nudges ----
  await phone.evaluate(() => document.getElementById('openSettingsBtn').click());
  await phone.waitForSelector('#setReminders');
  await phone.click('#setReminders');
  await phone.waitForSelector('#rmNudges');
  check(await phone.evaluate(() => document.getElementById('rmNudges').getAttribute('aria-checked') === 'true'), 'Nudges: on unless switched off');
  await phone.click('#rmNudges');
  await phone.click('#rmSave');
  const rem = await wait(async () => { const d = await get('ledger_meta/reminders'); return d && d.nudges === false ? d : null; });
  check(!!rem && rem.tz === 'Europe/London', 'Switched off: saved with the reminders (nudges false)');

  for (const p of [phone, mac, push]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.join(' | ').slice(0, 300));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
