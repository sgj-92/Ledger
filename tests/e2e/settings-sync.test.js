// Settings that follow the account, end to end over the Auth and Firestore emulators:
// Shaun's phone and Mac share ledger_meta/presets. The Claude conversation link set on one
// device shows on the other, and survives the other device saving a different setting
// (it was once missing from the presets listener, so a save elsewhere erased it).
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node settings-sync.test.js"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PID = 'ledger-6aec3';
const PORT = 8955;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m, why) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && why ? ' — ' + why : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date().toISOString().slice(0, 10);
const LINK = 'https://claude.ai/chat/0f3c2a91-ledger-test';

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
async function presets(){
  const r = await fetch(`${FS}/ledger_meta/presets`, { headers: ADMIN });
  const j = r.ok ? await r.json() : {};
  const f = j.fields || {};
  return { claudeUrl: f.claudeUrl ? f.claudeUrl.stringValue || null : undefined, weekStartsOn: f.weekStartsOn ? f.weekStartsOn.stringValue : undefined };
}

(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'shaun@example.com', password: 'pw-123456', returnSecureToken: true }) });
  const owner = (await r.json()).localId;
  await put(`ledger_users/${owner}`, { role: { stringValue: 'owner' }, displayName: { stringValue: 'Shaun' }, createdAt: { stringValue: TODAY } });

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
  const closeSheet = p => p.evaluate(() => { const x = document.querySelector('#sheetBackdrop.open .sheet-close'); if (x) x.click(); });
  async function openSettings(p){
    // close whatever is open (a sheet opened from Settings returns to Settings), so
    // Settings is drawn afresh from the current presets
    for (let i = 0; i < 4 && await p.evaluate(() => document.getElementById('sheetBackdrop').classList.contains('open')); i++){
      await closeSheet(p); await sleep(300);
    }
    await p.click('.tab-btn[data-view="me"]'); await p.click('[data-me-sub="focus"]');
    await p.locator('#openSettingsBtn').scrollIntoViewIfNeeded(); await p.click('#openSettingsBtn');
    await p.waitForSelector('#setClaudeUrl');
  }

  const phone = await device('phone', 390), mac = await device('mac', 1440);
  check(true, 'Shaun signed in on his phone and his Mac');
  // the phone sets the link
  await openSettings(phone); await phone.click('#setClaudeUrl');
  await phone.waitForSelector('#f_claudeUrl'); await phone.fill('#f_claudeUrl', LINK); await phone.click('#claudeUrlSave');
  let saved = false;
  for (let i = 0; i < 20 && !saved; i++){ await sleep(300); saved = (await presets()).claudeUrl === LINK; }
  check(saved, 'Phone: the Claude conversation link is saved to his account');
  // the Mac has it, live
  await openSettings(mac);
  check(await until(mac, () => /Claude conversation\s*Set/.test(document.getElementById('setClaudeUrl').innerText)), 'Mac: Settings shows the Claude conversation as Set');
  await mac.click('#setClaudeUrl'); await mac.waitForSelector('#f_claudeUrl');
  check(await mac.evaluate(l => document.getElementById('f_claudeUrl').value === l, LINK), 'Mac: the same link');
  await closeSheet(mac);
  // the Mac saves something else in the same presets: the link must survive
  await openSettings(mac);
  const wk = (await presets()).weekStartsOn === 'sunday' ? 'monday' : 'sunday';
  await mac.click(`[data-week-start="${wk}"]`);
  let after = null;
  for (let i = 0; i < 20; i++){ await sleep(300); after = await presets(); if (after.weekStartsOn === wk) break; }
  check(after.weekStartsOn === wk && after.claudeUrl === LINK, 'Mac changes the week start: the link is still saved', JSON.stringify(after));
  // and the phone still has it, after a reload
  await phone.reload(); await phone.waitForFunction(() => document.getElementById('authGate').hidden, null, { timeout: 25000 });
  await openSettings(phone);
  check(await until(phone, () => /Claude conversation\s*Set/.test(document.getElementById('setClaudeUrl').innerText)), 'Phone, reloaded: still Set');
  // clearing on one device clears it everywhere
  await phone.click('#setClaudeUrl'); await phone.waitForSelector('#claudeUrlClear'); await phone.click('#claudeUrlClear');
  let cleared = false;
  for (let i = 0; i < 20 && !cleared; i++){ await sleep(300); cleared = !(await presets()).claudeUrl; }
  await openSettings(mac);
  check(cleared && await until(mac, () => /Claude conversation\s*Not set/.test(document.getElementById('setClaudeUrl').innerText)), 'Cleared on the phone: Not set on the Mac');
  for (const p of [phone, mac]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.join(' | ').slice(0, 300));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
