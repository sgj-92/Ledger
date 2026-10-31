// Goals and the week (docs/GOALS_AND_REVIEW.md, phase 1), end to end over the Auth and
// Firestore emulators, on Shaun's phone and Mac:
//   - a priority from before is asked its area once and becomes a year goal;
//   - a 90-day goal under it, with a number he updates;
//   - the week's outcome on Plan (ledger_weeks/{week start}), named with its goal;
//   - an Action that moves it ("Moves"), shown on Today;
//   - the outcome marked done, and the goal achieved — never deleted.
// Everything written on the phone shows on the Mac, live.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node goals.test.js"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PID = 'ledger-6aec3';
const PORT = 8957;
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
  // a priority from before goals existed, and an action for today
  await put('ledger_priorities/p1', { title: S('Generate money & clear the backlog'), note: S(''), createdAt: S('2026-01-02T10:00:00Z') });
  await put('ledger_commitments/a1', { title: S('Call the accountant'), date: S(TODAY), originalDate: S(TODAY), status: S('planned'),
    category: S('work'), createdAt: S(TODAY + 'T08:00:00Z') });

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
  const goals = async p => { await p.click('.tab-btn[data-view="me"]'); await p.click('[data-me-sub="focus"]'); };
  const tab = (p, v) => p.click(`.tab-btn[data-view="${v}"]`);
  const pick = (p, id, v) => p.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);

  const phone = await device('phone', 390), mac = await device('mac', 1440);
  check(true, 'Shaun signed in on his phone and his Mac');

  // ---- a priority becomes a year goal: its area is asked once ----
  await goals(phone); await goals(mac);
  check(await until(phone, () => /Which area is each goal in\?/.test((document.querySelector('.goal-ask') || {}).innerText || '')),
    'Phone: the priority from before is asked its area');
  await phone.click('.goal-ask [data-area="business"]');
  const p1 = await wait(async () => (await list('ledger_priorities')).find(x => x.id === 'p1' && x.area === 'business'));
  check(p1 && p1.horizon === 'year' && p1.status === 'active' && /^\d{4}$/.test(p1.period) && p1.title === 'Generate money & clear the backlog',
    'Saved as an active year goal in Business, title kept', JSON.stringify(p1));
  check(await until(phone, () => !document.querySelector('.goal-ask')), 'Phone: asked once — the question is gone');
  check(await until(mac, () => !document.querySelector('.goal-ask') && /Generate money/.test(document.querySelector('.goal-area[data-area="business"]').innerText)),
    'Mac: the goal is under Business, live');

  // ---- a 90-day goal with a number ----
  await phone.click('.goal-area[data-area="business"] .goal-add-q');
  await phone.waitForSelector('#f_priorityTitle');
  check(await phone.evaluate(() => document.getElementById('f_goalParent').value === 'p1' && !document.getElementById('gQuarterWrap').hidden),
    'Phone: "+ 90-day goal" opens under its year goal, in this quarter');
  await phone.fill('#f_priorityTitle', 'Five new retainer clients');
  await phone.click('[data-chips="gmeasure"] [data-v="number"]');
  await phone.fill('#f_goalUnit', '£'); await phone.fill('#f_goalStart', '0'); await phone.fill('#f_goalTarget', '60000'); await phone.fill('#f_goalValue', '42000');
  await phone.click('#savePriorityBtn');
  const q = await wait(async () => (await list('ledger_priorities')).find(x => x.horizon === 'quarter'));
  check(q && q.parentId === 'p1' && q.area === 'business' && /^\d{4}-Q[1-4]$/.test(q.period) && q.measure && q.measure.target === 60000 &&
    q.measure.unit === '£' && q.values.length === 1 && q.values[0].value === 42000 && q.values[0].date === TODAY,
    'Saved: the 90-day goal, its quarter, its parent and its first value', JSON.stringify(q));
  check(await until(mac, () => /£42,000 of £60,000 · £18,000 to go/.test(document.getElementById('prioritiesList').innerText)),
    'Mac: the measure reads as counts and the gap — no percentage');
  check(!/%/.test(await text(mac, '#prioritiesList')), 'Mac: no percentage or score anywhere in Goals');

  // ---- the week's outcome on Plan ----
  await tab(phone, 'plan'); await tab(mac, 'plan');
  check(/What will this week move\?/.test(await text(phone, '#planOutcomes')), 'Phone: Plan asks what this week will move');
  await phone.click('#planOutcomes [data-role="wk-add"]');
  await phone.waitForSelector('#f_outText');
  await phone.fill('#f_outText', 'Send 5 proposals');
  await pick(phone, 'f_outGoal', q.id);
  check(await phone.evaluate(() => document.getElementById('outAreaWrap').hidden), 'Phone: with a goal chosen, its area is taken from the goal');
  await phone.click('#outSave');
  const wk = await wait(async () => (await list('ledger_weeks')).find(x => (x.outcomes || []).length));
  const o = wk && wk.outcomes[0];
  const monday = (() => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  check(wk && wk.id === monday && o.text === 'Send 5 proposals' && o.goalId === q.id && o.area === 'business' && o.result === null && /^o/.test(o.id),
    'Saved on the week\'s own record (its Monday), named with its goal', JSON.stringify(wk));
  check(await until(mac, () => /Send 5 proposals/.test(document.getElementById('planOutcomes').innerText) &&
    /Five new retainer clients/.test(document.getElementById('planOutcomes').innerText)), 'Mac: the outcome and its goal top the week, live');

  // ---- an Action moves it ----
  await tab(phone, 'log'); await tab(mac, 'log');
  await phone.evaluate(() => [...document.querySelectorAll('#commitmentsList .commitment-item')].find(x => /accountant/.test(x.innerText)).click());
  await phone.waitForSelector('.moves-field');
  check(/Send 5 proposals/.test(await text(phone, '.moves-field')), 'Phone: the action editor offers the week\'s outcome under Moves');
  await phone.evaluate(() => [...document.querySelectorAll('.moves-field .cd-chip')].find(x => /proposals/.test(x.textContent)).click());
  await phone.click('#saveCommitBtn');
  const a1 = await wait(async () => (await list('ledger_commitments')).find(x => x.id === 'a1' && x.outcomeId));
  check(a1 && a1.outcomeId === o.id && a1.title === 'Call the accountant' && a1.date === TODAY, 'Saved: the action names the outcome, and nothing else changed', JSON.stringify(a1));
  check(await until(mac, () => [...document.querySelectorAll('#commitmentsList .commitment-moves')].some(x => /Send 5 proposals/.test(x.textContent))),
    'Mac: Today shows the outcome it moves, as a quiet line');

  // ---- the outcome done; the goal achieved ----
  await tab(phone, 'plan'); await tab(mac, 'plan');
  await phone.click(`#planOutcomes [data-outcome="${o.id}"]`);
  await phone.waitForSelector('#outActions');
  check(/Call the accountant/.test(await text(phone, '#outActions')), 'Phone: the outcome lists the action serving it');
  await phone.click('[data-chips="oresult"] [data-v="done"]');
  await phone.click('#outSave');
  const done = await wait(async () => { const w = (await list('ledger_weeks')).find(x => x.id === monday); return w && w.outcomes[0].result === 'done' ? w : null; });
  check(done && done.outcomes[0].text === 'Send 5 proposals' && done.outcomes[0].goalId === q.id, 'Saved: done, built on the stored outcome');
  check(await until(mac, () => /1 of 1 done/.test(document.getElementById('planOutcomes').innerText)), 'Mac: "1 of 1 done"');
  await goals(phone); await goals(mac);
  await phone.click(`.goal-row[data-goal="${q.id}"]`);
  await phone.waitForSelector('#gAchieved'); await phone.click('#gAchieved');
  const ach = await wait(async () => (await list('ledger_priorities')).find(x => x.id === q.id && x.status === 'achieved'));
  check(ach && ach.closedAt && ach.measure && ach.values.length === 1, 'Saved: achieved, kept with its measure — not deleted');
  check(await until(mac, () => /Achieved and dropped · 1/.test(document.getElementById('prioritiesList').innerText)), 'Mac: under "Achieved and dropped"');

  for (const p of [phone, mac]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.join(' | ').slice(0, 300));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
