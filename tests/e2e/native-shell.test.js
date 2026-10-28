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
    // an app built with the messaging plugin (Phase 2) says so; an older build doesn't
    isPluginAvailable: function(name){ return name === 'FirebaseMessaging' && localStorage.getItem('__fm') === '1'; },
    nativePromise: function(plugin, method, options){
      var entry = plugin + '.' + method + (options && Object.keys(options).length ? ' ' + JSON.stringify(options) : '');
      window.__nat.calls.push(entry);
      // kept across a reload (signing out reloads the page)
      try { var log = JSON.parse(sessionStorage.getItem('__natlog') || '[]'); log.push(plugin + '.' + method); sessionStorage.setItem('__natlog', JSON.stringify(log)); } catch(e){}
      if (plugin === 'LedgerWidget' && method === 'publish'){
        (window.__nat.snapshots = window.__nat.snapshots || []).push(JSON.parse(options.snapshot));
        // the app refusing a snapshot, as a build without the App Group would
        if (localStorage.getItem('__widgetfail') === '1') return Promise.reject(new Error('The App Group isn\u2019t available to this build'));
      }
      if (plugin === 'App' && method === 'getInfo') return Promise.resolve({ name: 'Ledger', id: 'luxe.sgj.ledger', version: '1.0', build: '7' });
      if (plugin === 'FirebaseMessaging'){
        if (method === 'checkPermissions') return Promise.resolve({ receive: localStorage.getItem('__fmperm') || 'prompt' });
        if (method === 'requestPermissions'){ localStorage.setItem('__fmperm', 'granted'); return Promise.resolve({ receive: 'granted' }); }
        if (method === 'getToken') return Promise.resolve({ token: 'fcm-token-' + platform + '-1' });
      }
      return Promise.resolve({});
    },
    addListener: function(plugin, event, cb){
      var k = plugin + '.' + event;
      (window.__nat.listeners[k] = window.__nat.listeners[k] || []).push(cb);
      return { remove: function(){ return Promise.resolve(); } };
    }
  };
}

// the same bridge, only once the page has been told it is in the app (to test an upgrade)
function fakeBridgeWhenAsked(){
  var platform = localStorage.getItem('ledger_fake_native');
  if (!platform) return;
  window.__nat = { calls: [], listeners: {} };
  window.Capacitor = {
    isNativePlatform: function(){ return true; },
    getPlatform: function(){ return platform; },
    nativePromise: function(plugin, method){ window.__nat.calls.push(plugin + '.' + method); return Promise.resolve({}); },
    addListener: function(){ return { remove: function(){ return Promise.resolve(); } }; }
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
  async function session(name, platform, theme, withPush){
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Europe/London' });
    await ctx.route(/api\.github\.com/, r => r.abort());
    await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, r => {
      const f = r.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
      r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
    });
    await ctx.addInitScript(t => { localStorage.setItem('ledger_emulator', '1'); localStorage.setItem('ledger_theme', t); }, theme || 'dark');
    if (withPush) await ctx.addInitScript(() => localStorage.setItem('__fm', '1'));
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
  check(await A.evaluate(() => !window.__nat.calls.some(c => /^LedgerWidget/.test(c))), 'Android: no widget calls yet (the widget is iOS first)');
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
  check(await until(A, () => /Needs an app update/.test(document.getElementById('sheetBackdrop').innerText) && /update the app/.test(document.getElementById('sheetBackdrop').innerText)),
    'Android, an app built before notifications: "Needs an app update"', await A.evaluate(() => document.getElementById('sheetBackdrop').innerText.slice(0, 300)));
  check(!(await A.evaluate(() => window.__nat.calls.some(c => /^FirebaseMessaging/.test(c)))), 'Android, that older build: nothing is asked of a plugin it doesn\'t have');
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
  const I = await session('ios', 'ios', 'light', true);
  await signIn(I, SHAUN);
  check(await until(I, ready, null, 25000), 'iOS: Shaun signs in and gets his Ledger');
  check((await calls(I)).includes('SystemBars.setStyle {"style":"LIGHT"}'), 'iOS: the light theme gets dark status-bar text');
  check(await I.evaluate(() => !(window.__nat.listeners['App.backButton'] || []).length), 'iOS: no back-button listener (iOS has no back button)');
  // the Today widget: a snapshot of today's Actions, Ledger's order, for the owner only
  const lastSnap = p => p.evaluate(() => { const a = window.__nat.snapshots || []; return a.length ? a[a.length - 1] : null; });
  check(await until(I, () => (window.__nat.snapshots || []).length > 0, null, 10000), 'iOS widget: Today is published to the widget once his data has loaded');
  let snap = await lastSnap(I);
  check(snap && snap.v === 4 && snap.date === new Date().toLocaleDateString('en-CA') && snap.total === 1 && snap.items[0].title === 'Finish the quarterly plan'
    && snap.items[0].link === 'luxe.sgj.ledger://open?openAction=k1' && typeof snap.generatedAt === 'string',
    'iOS widget: version 4, today, his Action with its link', JSON.stringify(snap));
  check(snap && snap.prime && /Plan|Move|of/.test(snap.prime.label) && Array.isArray(snap.exercise) && 'comms' in snap,
    'iOS widget: Morning Prime while it isn\'t done, today\'s exercise, and Communications (counts only)', JSON.stringify(snap && { p: snap.prime, e: snap.exercise, c: snap.comms }));
  check(snap && (!snap.comms || Object.keys(snap.comms).sort().join() === 'due,needs,waiting'), 'iOS widget: Communications are counts — never names');
  check(snap && snap.prime && /^P (\u2713|\d+\/\d+)( M (\u2713|\d+\/\d+))?$/.test(snap.prime.short), 'iOS widget: Morning Prime\'s short counts for its row ("P 0/4 M 0/5")', snap && snap.prime && snap.prime.short);
  check(snap && snap.focus === null, 'iOS widget: no Current Focus yet → none in the snapshot');
  check(snap && Object.keys(snap.items[0]).sort().join() === 'category,done,id,key,link,open,time,title', 'iOS widget: titles, times and categories only — nothing else crosses', snap && Object.keys(snap.items[0]).join());
  const published = await I.evaluate(() => (window.__nat.snapshots || []).length);
  await put('ledger_commitments/k2', { date: TODAY, originalDate: TODAY, title: 'Call the plumber', category: 'personal', status: 'planned', time: '09:15', priorityId: null, minVersion: null, disruptionReason: null, createdAt: '2026-10-20T10:00:00.000Z' });
  check(await until(I, n => (window.__nat.snapshots || []).length > n && window.__nat.snapshots[window.__nat.snapshots.length - 1].total === 2, published, 12000), 'iOS widget: a new Action today is published again');
  snap = await lastSnap(I);
  // Ledger's Flow order: untimed Actions keep their place; a time orders only timed ones
  check(snap.items.map(i => i.title + ' ' + i.time).join(' | ') === 'Finish the quarterly plan null | Call the plumber 09:15',
    'iOS widget: in Ledger\'s own Flow order, with times', snap.items.map(i => i.title + ' ' + i.time).join(' | '));
  // version 4: the whole Flow for the Flow widget, done steps included, and key tasks marked
  const flowLine = sn => (sn.flow || []).map(f => [f.kind, f.id, f.time, f.end, f.done, f.key].join(' ')).join(' | ');
  check(flowLine(snap) === 'action k1   true false | action k2 09:15  false false',
    'Flow widget: today\'s Flow in order — the ticked Action too — with times', flowLine(snap));
  check(snap.flow.every(f => Object.keys(f).sort().join() === 'category,done,end,id,key,kind,link,time,title'), 'Flow widget: titles, times and ticks only — nothing else crosses');
  const keyFrom = await I.evaluate(() => (window.__nat.snapshots || []).length);
  await put('ledger_commitments/k2', { date: TODAY, originalDate: TODAY, title: 'Call the plumber', category: 'personal', status: 'planned', time: '09:15', durationMin: 30, isKeyTask: true, priorityId: null, minVersion: null, disruptionReason: null, createdAt: '2026-10-20T10:00:00.000Z' });
  check(await until(I, n => { const a = window.__nat.snapshots || []; const l = a[a.length - 1]; return a.length > n && l.items.some(i => i.id === 'k2' && i.key === true); }, keyFrom, 12000),
    'iOS widget: a key task is marked as one');
  snap = await lastSnap(I);
  check(flowLine(snap) === 'action k1   true false | action k2 09:15 09:45 false true', 'Flow widget: …in the Flow too, with when it ends', flowLine(snap));
  const sent = await I.evaluate(() => (window.__nat.snapshots || []).length);
  for (const v of ['plan', 'log', 'me', 'log']){ await I.click(`.tab-btn[data-view="${v}"]`); await sleep(250); }
  await sleep(1200);
  check(await I.evaluate(n => (window.__nat.snapshots || []).length === n, sent), 'iOS widget: re-rendering Today sends nothing new when nothing changed');
  // Settings says when the widgets were last updated; a tap sends today again, and a
  // refused send is reported and tried again rather than remembered as sent
  await openSettings(I); await I.waitForSelector('#setWidgetStatus');
  check(/^Updated \d\d:\d\d \u00b7 2 Actions$/.test(await I.textContent('#setWidgetStatus')), 'iOS widget: Settings shows when the widgets were last updated, and with what', await I.textContent('#setWidgetStatus'));
  await I.evaluate(() => localStorage.setItem('__widgetfail', '1'));
  await I.click('#setWidget');
  check(await until(I, () => /^Not updated at \d\d:\d\d: The App Group/.test((document.getElementById('setWidgetStatus') || {}).textContent || ''), null, 5000),
    'iOS widget: a send the app refuses is shown in Settings, with its reason', await I.textContent('#setWidgetStatus'));
  await I.evaluate(() => localStorage.removeItem('__widgetfail'));
  const retryFrom = await I.evaluate(() => (window.__nat.snapshots || []).length);
  await I.click('#sheetCloseBtn'); await sleep(300);
  for (const v of ['plan', 'log']){ await I.click(`.tab-btn[data-view="${v}"]`); await sleep(250); }
  check(await until(I, n => (window.__nat.snapshots || []).length > n, retryFrom, 5000), 'iOS widget: after a refused send, the next render of Today tries again');
  await openSettings(I); await I.waitForSelector('#setWidgetStatus');
  check(/^Updated /.test(await I.textContent('#setWidgetStatus')), 'iOS widget: …and Settings then shows it updated', await I.textContent('#setWidgetStatus'));
  await I.click('#sheetCloseBtn'); await sleep(300);
  // the Focus widget: setting a focus (on another device) reaches it
  const focusBefore = await I.evaluate(() => (window.__nat.snapshots || []).length);
  // (k1 was ticked done on Android above: a focus on a finished Action is never shown)
  await put('ledger_meta/currentFocus', { ownerUid: owner, type: 'action', sourceId: 'k2', childId: null, title: 'Call the plumber', date: TODAY,
    setAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceDeviceId: 'mac', status: 'active' });
  check(await until(I, n => (window.__nat.snapshots || []).length > n && !!window.__nat.snapshots[window.__nat.snapshots.length - 1].focus, focusBefore, 12000), 'Focus widget: a focus set on the Mac is published to the phone\'s widgets');
  snap = await lastSnap(I);
  check(snap.focus && snap.focus.title === 'Call the plumber' && snap.focus.link === 'luxe.sgj.ledger://open?openAction=k2' && snap.focus.context === 'Action \u00b7 09:15' && typeof snap.focus.setAt === 'string',
    'Focus widget: its title, "Action", since when, and a link that opens it', JSON.stringify(snap.focus));
  // the focus timer (build 5): set on the Mac, each phone schedules its own alert, the
  // widget counts down, and stopping it cancels the alert
  const endsAt = new Date(Date.now() + 25 * 60000).toISOString();
  await put('ledger_meta/currentFocus', { ownerUid: owner, type: 'action', sourceId: 'k2', childId: null, title: 'Call the plumber', date: TODAY,
    setAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceDeviceId: 'mac', status: 'active', timerMin: 25, endsAt });
  const sched = c => /^LocalNotifications\.schedule /.test(c) && /"id":7101/.test(c) && /Call the plumber/.test(c) && c.indexOf(endsAt.slice(0, 16)) > -1;
  check(await until(I, () => window.__nat.calls.some(c => /^LocalNotifications\.schedule /.test(c) && /Call the plumber/.test(c)), null, 12000) && (await calls(I)).some(sched),
    'Focus timer: the iPhone schedules one alert, for when the timer ends', (await calls(I)).filter(c => /LocalNotifications/.test(c)).join(' | '));
  check(!(await calls(I)).some(c => /LocalNotifications\.createChannel/.test(c)), 'Focus timer: no Android channel on iOS');
  check(await until(A, () => window.__nat.calls.some(c => /^LocalNotifications\.createChannel /.test(c) && /focus-timer/.test(c)) && window.__nat.calls.some(c => /^LocalNotifications\.schedule /.test(c) && /"channelId":"focus-timer"/.test(c)), null, 12000),
    'Focus timer: Android makes its "Focus timer" channel and schedules on it');
  check(await until(I, e => { const s = (window.__nat.snapshots || []).slice(-1)[0]; return s && s.focus && s.focus.endsAt === e; }, endsAt, 12000), 'Focus timer: the widget\'s snapshot carries when it ends');
  await I.click('.tab-btn[data-view="log"]');
  check(await until(I, () => { const b = document.getElementById('nowTimer'); return !!b && b.classList.contains('on') && /^2[45]:\d\d$/.test(b.textContent); }), 'Focus timer: the Focus card counts down ("24:59")');
  const cancels = (await calls(I)).filter(c => /^LocalNotifications\.cancel/.test(c)).length;
  await put('ledger_meta/currentFocus', { ownerUid: owner, type: 'action', sourceId: 'k2', childId: null, title: 'Call the plumber', date: TODAY,
    setAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceDeviceId: 'mac', status: 'active' });
  check(await until(I, n => window.__nat.calls.filter(c => /^LocalNotifications\.cancel/.test(c)).length > n, cancels, 12000), 'Focus timer: stopped → the alert is cancelled');
  check(await until(I, () => { const b = document.getElementById('nowTimer'); return !!b && !b.classList.contains('on'); }), 'Focus timer: …and the card shows a plain clock to set one');
  // its links open Ledger at the right place — and only Ledger's own links
  const openLink = (p, url) => p.evaluate(u => (window.__nat.listeners['App.appUrlOpen'] || []).forEach(cb => cb({ url: u })), url);
  await I.click('.tab-btn[data-view="plan"]');
  await openLink(I, 'https://evil.example/?openAction=k2');
  await sleep(500);
  check(!(await sheetOpen(I)), 'iOS: a link that isn\'t Ledger\'s is ignored');
  await openLink(I, 'luxe.sgj.ledger://open?openAction=k2');
  check(await until(I, () => document.getElementById('sheetBackdrop').classList.contains('open')
      && [...document.querySelectorAll('#sheetBackdrop input, #sheetBackdrop textarea')].some(f => f.value === 'Call the plumber')),
    'iOS widget tap: opens that Action in Ledger');
  await I.evaluate(() => { const x = document.querySelector('#sheetBackdrop.open .sheet-close'); if (x) x.click(); });
  await I.click('.tab-btn[data-view="comms"]');
  await openLink(I, 'luxe.sgj.ledger://open?view=today');
  check(await until(I, () => document.querySelector('.view.active').id === 'view-log'), 'iOS widget tap elsewhere: opens Today');
  await openLink(I, 'luxe.sgj.ledger://open?view=today&mode=flow');
  check(await until(I, () => document.querySelector('.view.active').id === 'view-log' && !document.getElementById('todayFlow').hidden), 'Flow widget tap: opens Today in Flow');
  await I.click('[data-today-mode="overview"]'); await sleep(200);
  await openLink(I, 'luxe.sgj.ledger://open?view=comms');
  check(await until(I, () => document.querySelector('.view.active').id === 'view-comms'), 'iOS widget: its Communications line opens Communications');
  await openLink(I, 'luxe.sgj.ledger://open?view=focus');
  check(await until(I, () => document.getElementById('sheetBackdrop').classList.contains('open') && /Current focus/.test(document.getElementById('sheetBackdrop').innerText)
      && document.querySelector('.view.active').id === 'view-log'), 'Focus widget with no focus: a tap opens Today and the focus picker');
  await I.evaluate(() => { const x = document.querySelector('#sheetBackdrop.open .sheet-close'); if (x) x.click(); });
  // notifications in the app (Phase 2): FCM, from a tap, the device his alone
  const subs = async () => {
    const r = await fetch(`${FS}/ledger_push_subscriptions?pageSize=50`, { headers: ADMIN });
    const j = await r.json();
    return (j.documents || []).map(d => ({ id: d.name.split('/').pop(), f: Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, Object.values(v)[0]])) }));
  };
  check(await I.evaluate(() => !window.__nat.calls.some(c => /^FirebaseMessaging\.(requestPermissions|getToken)/.test(c))), 'iOS push: nothing is asked before a tap');
  check(await I.evaluate(() => (window.__nat.listeners['FirebaseMessaging.notificationActionPerformed'] || []).length === 1), 'iOS push: it listens for a tapped notification');
  await openSettings(I); await I.click('#setNotifications');
  check(await until(I, () => /Not enabled/.test(document.getElementById('ntDeviceState').textContent) && !document.getElementById('ntEnable').hidden && /iPhone app/.test(document.getElementById('ntDeviceName').textContent)),
    'iOS push: Settings → Notifications: "Shaun · iPhone app — Not enabled", with Enable');
  await I.click('#ntEnable');
  check(await until(I, () => /Enabled/.test(document.getElementById('ntDeviceState').textContent) && /Home Screen/.test(document.getElementById('ntNote').textContent)), 'iOS push: Enable → "Enabled", with a word about the Home Screen web app');
  await I.screenshot({ path: `${shots}/native-ios-notifications.png` });
  let mine = (await subs()).filter(x => x.f.userUid === owner && x.f.transport === 'fcm');
  check(mine.length === 1 && mine[0].id.indexOf(owner + '_n') === 0 && mine[0].f.fcmToken === 'fcm-token-ios-1' && mine[0].f.platform === 'ios' && mine[0].f.appVersion === '1.0 (7)' && mine[0].f.deviceLabel === 'Shaun · iPhone app' && !mine[0].f.endpoint,
    'iOS push: one device record, his, with an FCM token (no Web Push endpoint)', JSON.stringify(mine));
  check(await I.evaluate(() => window.__nat.calls.some(c => c === 'FirebaseMessaging.requestPermissions') && !window.__nat.calls.some(c => /createChannel/.test(c))), 'iOS push: permission asked on the tap; no Android channels on iOS');
  await I.evaluate(() => { const x = document.querySelector('#sheetBackdrop.open .sheet-close'); if (x) x.click(); });
  // a new token from FCM replaces the old one
  await I.evaluate(() => (window.__nat.listeners['FirebaseMessaging.tokenReceived'] || []).forEach(cb => cb({ token: 'fcm-token-ios-2' })));
  let rotated = false;
  for (let k = 0; k < 20 && !rotated; k++){ await sleep(250); rotated = (await subs()).some(x => x.f.userUid === owner && x.f.fcmToken === 'fcm-token-ios-2'); }
  check(rotated, 'iOS push: a new token replaces the old one on the same record');
  // tapping a notification opens what it is about
  await I.click('.tab-btn[data-view="plan"]');
  await I.evaluate(() => (window.__nat.listeners['FirebaseMessaging.notificationActionPerformed'] || []).forEach(cb => cb({ actionId: 'tap', notification: { data: { url: 'https://ledger.sgj.luxe/?openAction=k2', kind: 'general' } } })));
  check(await until(I, () => document.getElementById('sheetBackdrop').classList.contains('open')
      && [...document.querySelectorAll('#sheetBackdrop input, #sheetBackdrop textarea')].some(f => f.value === 'Call the plumber')),
    'iOS push tap: opens that Action');
  await I.evaluate(() => { const x = document.querySelector('#sheetBackdrop.open .sheet-close'); if (x) x.click(); });
  await I.evaluate(() => (window.__nat.listeners['FirebaseMessaging.notificationActionPerformed'] || []).forEach(cb => cb({ notification: { data: { url: 'https://evil.example/?openAction=k2' } } })));
  await sleep(500);
  check(!(await sheetOpen(I)), 'iOS push tap: a link that isn\'t Ledger\'s is ignored');
  // signing out empties the widget, and the phone stops being his for notifications
  I.on('dialog', d => d.accept());
  await openSettings(I); await I.waitForSelector('#setSignOut'); await I.click('#setSignOut');
  check(await until(I, () => { try { return JSON.parse(sessionStorage.getItem('__natlog') || '[]').indexOf('LedgerWidget.clear') > -1; } catch (e){ return false; } }, null, 15000),
    'iOS: signing out clears the widget');
  check(await until(I, () => { try { return JSON.parse(sessionStorage.getItem('__natlog') || '[]').indexOf('FirebaseMessaging.deleteToken') > -1; } catch (e){ return false; } }, null, 15000)
    && !(await subs()).some(x => x.f.userUid === owner && x.f.transport === 'fcm'), 'iOS push: signing out removes his app record and its token');

  // ---- Abi (partner) in the Android app: back closes her portal's sheet ----
  const P = await session('abi', 'android', 'dark');
  await signIn(P, ABI);
  check(await until(P, () => !document.getElementById('partnerApp').hidden, null, 25000), 'Android: Abi signs in and gets her portal');
  await P.click('#ppNotify');
  check(await until(P, () => document.getElementById('ppBackdrop').classList.contains('open')), 'Abi: Notifications opens in her sheet');
  await back(P);
  check(await until(P, () => !document.getElementById('ppBackdrop').classList.contains('open')), 'Abi: back closes it');

  // ---- a service worker left from before the app stopped registering one is removed ----
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.route(/api\.github\.com|gstatic\.com/, r => r.abort());
    await ctx.addInitScript(fakeBridgeWhenAsked);
    const p = await ctx.newPage();
    await p.goto(APP);
    const before = await until(p, async () => !!(navigator.serviceWorker && (await navigator.serviceWorker.getRegistrations()).length), null, 8000);
    await p.evaluate(() => localStorage.setItem('ledger_fake_native', 'android'));
    await p.reload();
    check(before && await until(p, async () => (await navigator.serviceWorker.getRegistrations()).length === 0, null, 8000),
      'Android: an old service worker (registered by the web page) is removed in the app');
    await ctx.close();
  }

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
