// The native apps' shell hooks (docs/NATIVE_MIGRATION.md, Phase 1), end to end over the
// Auth and Firestore emulators. A real iPhone or Android app injects window.Capacitor
// before the page's scripts run; here a stand-in bridge with the same calls
// (isNativePlatform, getPlatform, nativePromise, addListener) records what Ledger asks of
// the shell. A plain browser session checks the web is untouched: no bridge, no calls,
// its service worker still registered.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node native-shell.test.js [shots-dir]"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const [OUT] = process.argv.slice(2);
const shots = OUT || path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const PID = 'ledger-6aec3';
const PORT = 8954;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m, why) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && why ? ' — ' + why : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date().toISOString().slice(0, 10);

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
async function put(docPath, data){
  const r = await fetch(`${FS}/${docPath}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) throw new Error('seed failed ' + docPath + ' ' + r.status);
}
async function get(docPath){
  const r = await fetch(`${FS}/${docPath}`, { headers: ADMIN });
  return r.ok ? r.json() : null;
}
async function signUp(email){
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) });
  return (await r.json()).localId;
}

// what the native shell injects, recording each call instead of doing it
function fakeBridge(platform){
  window.__nat = { calls: [], listeners: {} };
  window.Capacitor = {
    isNativePlatform: function(){ return true; },
    getPlatform: function(){ return platform; },
    nativePromise: function(plugin, method, options){
      window.__nat.calls.push(plugin + '.' + method + (options && Object.keys(options).length ? ' ' + JSON.stringify(options) : ''));
      if (plugin === 'App' && method === 'getInfo') return Promise.resolve({ name: 'Ledger', id: 'luxe.sgj.ledger', version: '1.0', build: '7' });
      return Promise.resolve({});
    },
    addListener: function(plugin, event, cb){
      var k = plugin + '.' + event;
      (window.__nat.listeners[k] = window.__nat.listeners[k] || []).push(cb);
      return { remove: function(){ return Promise.resolve(); } };
    }
  };
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
  await put('ledger_commitments/k1', { date: TODAY, originalDate: TODAY, title: 'Finish the quarterly plan', category: 'work', status: 'planned', priorityId: null, minVersion: null, disruptionReason: null, createdAt: '2026-10-20T09:00:00.000Z' });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  async function session(name, platform, theme){
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Europe/London' });
    await ctx.route(/api\.github\.com/, r => r.abort());
    await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, r => {
      const f = r.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
      r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
    });
    await ctx.addInitScript(t => { localStorage.setItem('ledger_emulator', '1'); localStorage.setItem('ledger_theme', t); }, theme || 'dark');
    if (platform) await ctx.addInitScript(fakeBridge, platform);
    const p = await ctx.newPage(); p.errs = []; p.name = name;
    p.on('pageerror', e => p.errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|permission|Missing or insufficient|offline|net::ERR/i.test(m.text())) p.errs.push('console: ' + m.text()); });
    return p;
  }
  async function signIn(p, email){
    await p.goto(APP);
    await p.waitForSelector('#authEmail', { timeout: 20000 });
    await p.fill('#authEmail', email);
    if (await p.$('#authPassword')){ await p.fill('#authPassword', 'pw-123456'); await p.click('#authSignIn'); }
  }
  const until = async (p, fn, arg, t) => { try { await p.waitForFunction(fn, arg, { timeout: t || 12000 }); return true; } catch (e){ return false; } };
  const calls = p => p.evaluate(() => window.__nat.calls.slice());
  // his Ledger is open: the Action shows (or, once ticked, its "Completed" group)
  const ready = () => /Finish the quarterly plan|Completed/.test(document.querySelector('main').innerText) && document.getElementById('authGate').hidden;
  const back = p => p.evaluate(() => { (window.__nat.listeners['App.backButton'] || []).forEach(cb => cb({ canGoBack: false })); });
  const sheetOpen = (p, id) => p.evaluate(i => { const e = document.getElementById(i); return !!e && e.classList.contains('open'); }, id || 'sheetBackdrop');
  async function openSettings(p){
    await p.click('.tab-btn[data-view="me"]'); await p.click('[data-me-sub="focus"]');
    await p.locator('#openSettingsBtn').scrollIntoViewIfNeeded(); await p.click('#openSettingsBtn');
  }

  // ---- Shaun, in the Android app ----
  const A = await session('android', 'android', 'dark');
  await signIn(A, SHAUN);
  check(await until(A, () => /Finish the quarterly plan/.test(document.querySelector('main').innerText), null, 25000), 'Android: Shaun signs in with his password and gets his Ledger');
  check((await calls(A)).includes('SystemBars.setStyle {"style":"DARK"}'), 'Android: the status bar is set for the dark theme (light text)', (await calls(A)).join(' | '));
  check(await A.evaluate(() => (window.__nat.listeners['App.backButton'] || []).length === 1), 'Android: one back-button listener');
  check(await A.evaluate(async () => !navigator.serviceWorker || (await navigator.serviceWorker.getRegistrations()).length === 0), 'Android: no web service worker in the app');
  // the five tabs
  for (const v of ['plan', 'log', 'me', 'comms', 'home']){
    await A.click(`.tab-btn[data-view="${v}"]`); await sleep(250);
  }
  check(await A.evaluate(() => document.querySelector('.view.active').id === 'view-home'), 'Android: all five tabs open (Plan, Today, Me, Comms, Home)');
  await A.screenshot({ path: `${shots}/native-android-home.png` });
  // back: closes the sheet, as its × would, then sends the app to the background
  await openSettings(A);
  check(await until(A, () => document.getElementById('sheetBackdrop').classList.contains('open')), 'Android: Settings opens as a sheet');
  await back(A);
  check(await until(A, () => !document.getElementById('sheetBackdrop').classList.contains('open')) && !(await calls(A)).includes('App.minimizeApp'), 'Android back: closes the open sheet (and nothing else)');
  await back(A);
  check(await until(A, () => window.__nat.calls.includes('App.minimizeApp')), 'Android back with nothing open: Ledger goes to the background');
  check(await A.evaluate(() => document.querySelector('.view.active').id === 'view-focus' || document.querySelector('.view.active').id === 'view-me' || /focus/.test(document.querySelector('.view.active').id)), 'Android back never changes tab');
  // the theme follows into the status bar
  await openSettings(A); await A.waitForSelector('[data-theme-set="light"]');
  await A.click('[data-theme-set="light"]');
  check(await until(A, () => window.__nat.calls.includes('SystemBars.setStyle {"style":"LIGHT"}')), 'Android: Light theme → dark status-bar text');
  await A.click('[data-theme-set="dark"]');
  // notifications: honest about the app
  await A.click('#setNotifications'); await sleep(600);
  check(await until(A, () => /Not in the app yet/.test(document.getElementById('sheetBackdrop').innerText) && /come in a later update/.test(document.getElementById('sheetBackdrop').innerText)),
    'Android: Notifications says "Not in the app yet" — they come in a later update', await A.evaluate(() => document.getElementById('sheetBackdrop').innerText.slice(0, 300)));
  await A.screenshot({ path: `${shots}/native-android-notifications.png` });
  await back(A);
  // the Build sheet names the app
  await A.click('.tab-btn[data-view="me"]'); await A.click('[data-me-sub="focus"]');
  await A.locator('#buildFooter').scrollIntoViewIfNeeded(); await A.click('#buildFooter');
  check(await until(A, () => /Native app\s*Android 1\.0 \(7\)/.test(document.getElementById('sheetBackdrop').innerText)), 'Android: the Build sheet shows "Native app · Android 1.0 (7)"');
  await back(A);
  // saving data still goes where it always did
  await A.click('.tab-btn[data-view="log"]'); await sleep(300);
  await A.evaluate(() => { const r = [...document.querySelectorAll('.commitment-item')].find(x => /Finish the quarterly plan/.test(x.innerText)); const t = r && r.querySelector('.commitment-status-dot, .ci-tick, button[aria-label*="omplete"], .tick-btn'); if (t) t.click(); });
  let saved = false;
  for (let i = 0; i < 20 && !saved; i++){ await sleep(300); const d = await get('ledger_commitments/k1'); saved = !!(d && d.fields && d.fields.status && d.fields.status.stringValue === 'completed'); }
  check(saved, 'Android: ticking an Action saves it to Firestore');

  // ---- Shaun, in the iOS app (light theme) ----
  const I = await session('ios', 'ios', 'light');
  await signIn(I, SHAUN);
  check(await until(I, ready, null, 25000), 'iOS: Shaun signs in and gets his Ledger');
  check((await calls(I)).includes('SystemBars.setStyle {"style":"LIGHT"}'), 'iOS: the light theme gets dark status-bar text');
  check(await I.evaluate(() => !(window.__nat.listeners['App.backButton'] || []).length), 'iOS: no back-button listener (iOS has no back button)');

  // ---- Abi (partner) in the Android app: back closes her portal's sheet ----
  const P = await session('abi', 'android', 'dark');
  await signIn(P, ABI);
  check(await until(P, () => !document.getElementById('partnerApp').hidden, null, 25000), 'Android: Abi signs in and gets her portal');
  await P.click('#ppNotify');
  check(await until(P, () => document.getElementById('ppBackdrop').classList.contains('open')), 'Abi: Notifications opens in her sheet');
  await back(P);
  check(await until(P, () => !document.getElementById('ppBackdrop').classList.contains('open')), 'Abi: back closes it');

  // ---- the web: untouched ----
  const W = await session('web', null, 'dark');
  await signIn(W, SHAUN);
  check(await until(W, ready, null, 25000), 'Web: Shaun signs in as before');
  check(await W.evaluate(() => typeof window.Capacitor === 'undefined' && !window.__nat), 'Web: no native bridge, no native calls');
  check(await until(W, async () => !!(navigator.serviceWorker && (await navigator.serviceWorker.getRegistrations()).length), null, 8000), 'Web: the service worker still registers (install, Web Push)');
  await openSettings(W); await W.click('#setNotifications'); await sleep(800);
  check(!(await W.evaluate(() => /Not in the app yet/.test(document.body.innerText))), 'Web: Notifications says nothing about the app');

  for (const p of [A, I, P, W]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.slice(0, 3).join(' | ').slice(0, 400));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  if (bad.length) console.log(bad.join('\n'));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
