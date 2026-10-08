// Reset Sprint, Current Focus across devices, and the push sender, end to end. Run it through
// execution.run.js (it starts the Auth, Firestore and Functions emulators with a throwaway
// VAPID key pair). Nothing here touches a real Firebase project or a real push service.
//
// Shaun has three devices (a Mac, an installed iPhone app, a Samsung), each its own browser;
// Abi has one. The browsers' push subscriptions are stand-ins (headless Chromium cannot reach
// a push service), each pointing at a local HTTPS "push service" in this script. Everything
// else is real: the app, the Firestore rules, the Cloud Functions in functions/, web-push's
// VAPID signing and payload encryption — which this script decrypts with each device's key.
const { chromium } = require('playwright');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const vm = require('vm');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const ece = require(path.join(ROOT, 'functions/node_modules/http_ece'));
const OUT = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const PID = 'ledger-6aec3';
const PORT = 8952, SINK = 8953;
const APP = `http://127.0.0.1:${PORT}/`;
const APP_URL = process.env.LEDGER_APP_URL || APP;
const VAPID = process.env.LEDGER_VAPID_PUBLIC;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ymd(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const TODAY = ymd(new Date());

// ---- the app, served as Vercel serves it ----
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// ---- a local push service: receives what web-push sends, decrypts it with the device key ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-push-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', tmp + '/k.pem', '-out', tmp + '/c.pem', '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
const devices = {};      // name → { ecdh, p256dh, auth, endpoint }
function device(name){
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const d = { name, ecdh, p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url'), endpoint: `https://127.0.0.1:${SINK}/push/${name}` };
  devices[name] = d; return d;
}
const inbox = [];        // { device, payload, headers }
const sink = https.createServer({ key: fs.readFileSync(tmp + '/k.pem'), cert: fs.readFileSync(tmp + '/c.pem') }, (req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const name = req.url.split('/').pop(), d = devices[name];
    let payload = null;
    try { payload = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString('utf8')); }
    catch (e){ payload = { error: String(e) }; }
    inbox.push({ device: name, payload, headers: req.headers });
    res.writeHead(201); res.end();
  });
});
const since = n => inbox.slice(n);
async function waitPushes(from, count, ms){
  const end = Date.now() + (ms || 20000);
  while (Date.now() < end){ if (inbox.length - from >= count) break; await sleep(200); }
  await sleep(800);                         // and nothing extra arrives
  return since(from);
}

// ---- Firestore emulator REST, as an administrator ----
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
async function get(docPath){
  const r = await fetch(`${FS}/${docPath}`, { headers: ADMIN });
  if (!r.ok) return null;
  const d = await r.json();
  return dec({ mapValue: { fields: d.fields || {} } });
}
async function all(coll){
  const r = await (await fetch(`${FS}/${coll}?pageSize=500`, { headers: ADMIN })).json();
  return (r.documents || []).map(d => Object.assign({ id: d.name.split('/').pop() }, dec({ mapValue: { fields: d.fields || {} } })));
}
async function signUp(email){
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) });
  return (await r.json()).localId;
}

// ---- the service worker's push handling, on its own ----
async function swChecks(){
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const handlers = {}, shown = [], posted = [], opened = [];
  let clients = [];
  const self = {
    registration: { scope: 'https://ledger.sgj.luxe/', showNotification: (t, o) => { shown.push({ t, o }); return Promise.resolve(); } },
    clients: { matchAll: () => Promise.resolve(clients), openWindow: u => { opened.push(u); return Promise.resolve(); }, claim(){} },
    addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting(){}
  };
  vm.runInNewContext(src, { self, URL, fetch: () => {} });
  let wait;
  handlers.push({ data: { json: () => ({ title: 'Ledger · Current focus', body: 'Tidy desk', url: 'https://ledger.sgj.luxe/?openAction=a1', tag: 'ledger-current-focus', renotify: true }) }, waitUntil: p => { wait = p; } });
  await wait;
  check(shown[0] && shown[0].t === 'Ledger · Current focus' && shown[0].o.tag === 'ledger-current-focus' && shown[0].o.renotify === true && shown[0].o.body === 'Tidy desk',
    'service worker: shows the push with its tag (replaces the last focus) and renotify');
  handlers.push({ data: { json: () => ({ title: 'Ledger', body: 'x', url: 'https://ledger.sgj.luxe/' }) }, waitUntil: p => { wait = p; } });
  await wait;
  check(shown[1] && !shown[1].o.tag && !shown[1].o.renotify, 'service worker: no tag, no renotify');
  // tapped with no Ledger window open: opens the link on this installation's origin
  handlers.notificationclick({ notification: { close(){}, data: { url: 'https://elsewhere.example/?openAction=a1' } }, waitUntil: p => { wait = p; } });
  await wait;
  check(opened[0] === 'https://ledger.sgj.luxe/?openAction=a1', 'service worker: a tap opens the deep link on its own origin: ' + opened[0]);
  // tapped with Ledger open: hands the link over and focuses it — no reload
  clients = [{ url: 'https://ledger.sgj.luxe/', focus(){ posted.push('focus'); return Promise.resolve(); }, postMessage: m => posted.push(m) }];
  handlers.notificationclick({ notification: { close(){}, data: { url: 'https://ledger.sgj.luxe/?sprint=s1' } }, waitUntil: p => { wait = p; } });
  await wait;
  check(posted[0] && posted[0].type === 'ledger-open' && posted[0].url === 'https://ledger.sgj.luxe/?sprint=s1' && posted[1] === 'focus', 'service worker: with Ledger open, it hands over the link and focuses the window');
}

(async () => {
  await swChecks();
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  await new Promise(r => sink.listen(SINK, '127.0.0.1', r));
  const SHAUN = 'shaun@example.com', ABI = 'abi@example.com';
  const owner = await signUp(SHAUN), abi = await signUp(ABI);
  await put(`ledger_users/${owner}`, { role: 'owner', displayName: 'Shaun', email: SHAUN, createdAt: TODAY });
  await put(`ledger_users/${abi}`, { role: 'partner', displayName: 'Abi', email: ABI, createdAt: TODAY });
  await put(`ledger_share_members/${owner}_${abi}`, { ownerUid: owner, partnerUid: abi, role: 'partner', active: true, displayName: 'Abi', ownerName: 'Shaun', createdAt: TODAY });
  await put('ledger_config/push', { vapidPublicKey: VAPID });
  const A0 = (id, title, category, extra) => put(`ledger_commitments/${id}`, Object.assign({ date: TODAY, originalDate: TODAY, title, category, status: 'planned', priorityId: null, minVersion: null, disruptionReason: null, createdAt: '2026-10-01T08:00:00.000Z' }, extra || {}));
  await A0('a1', 'Finish accounts proposal', 'work', { isKeyTask: true });
  await A0('a2', 'Call the bank about the mortgage', 'work');
  await A0('a3', 'Book swimming lessons', 'family');
  await put(`ledger_plans/${TODAY}`, { dayNotes: 'SECRET NOTE — private', trainingTypes: [] });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const UA = {
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
  };
  async function session(name, o){
    const dev = device(name);
    const ctx = await b.newContext({ viewport: { width: o.w, height: o.w < 768 ? 844 : 900 }, deviceScaleFactor: o.w < 768 ? 2 : 1, isMobile: o.w < 768, hasTouch: o.w < 768,
      userAgent: o.ua, serviceWorkers: 'block', timezoneId: 'Europe/London' });
    await ctx.route(/api\.github\.com/, r => r.abort());
    await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, r => {
      const f = r.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
      r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
    });
    // the browser's side of Web Push, stood in: permission, and a subscription that points at
    // the local push service with this device's real keys
    await ctx.addInitScript(cfg => {
      localStorage.setItem('ledger_emulator', '1'); localStorage.setItem('ledger_theme', 'dark');
      if (cfg.standalone){
        try { Object.defineProperty(navigator, 'standalone', { get: () => true }); } catch(e){}
        const mm = window.matchMedia.bind(window);
        window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} } : mm(q);
      }
      let perm = 'default', sub = null;
      try { Object.defineProperty(Notification, 'permission', { get: () => perm, configurable: true }); } catch(e){}
      Notification.requestPermission = () => { perm = 'granted'; return Promise.resolve(perm); };
      const make = o => ({ endpoint: cfg.endpoint, options: { userVisibleOnly: true, applicationServerKey: o.applicationServerKey.buffer.slice(0) },
        toJSON(){ return { endpoint: cfg.endpoint, expirationTime: null, keys: { p256dh: cfg.p256dh, auth: cfg.auth } }; },
        unsubscribe(){ sub = null; return Promise.resolve(true); } });
      const reg = { pushManager: { getSubscription: () => Promise.resolve(sub), subscribe: o => { sub = make(o); return Promise.resolve(sub); } } };
      if (navigator.serviceWorker) Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg), configurable: true });
    }, { endpoint: dev.endpoint, p256dh: dev.p256dh, auth: dev.auth, standalone: !!o.standalone });
    const p = await ctx.newPage(); p.errs = []; p.name = name; p.ctx = ctx;
    p.on('pageerror', e => p.errs.push(String(e)));
    p.on('dialog', d => d.accept());
    return p;
  }
  async function signIn(p, email){
    await p.goto(APP);
    await p.waitForSelector('#authEmail', { timeout: 20000 });
    await p.fill('#authEmail', email); await p.fill('#authPassword', 'pw-123456'); await p.click('#authSignIn');
  }
  const until = async (p, fn, arg, t) => { try { await p.waitForFunction(fn, arg, { timeout: t || 15000 }); return true; } catch (e){ return false; } };
  const txt = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
  const nowOn = (p, re) => until(p, r => { const e = document.querySelector('#nowCue .now-title'); return !!e && new RegExp(r).test(e.textContent); }, re);
  async function openSettings(p){
    await p.click('.tab-btn[data-view="focus"]');
    await p.locator('#openSettingsBtn').scrollIntoViewIfNeeded(); await p.click('#openSettingsBtn');
    await p.waitForSelector('#setNotifications');
  }
  async function enableNotifications(p){
    await openSettings(p);
    await p.click('#setNotifications');
    await p.waitForSelector('#ntEnable:not([hidden])', { timeout: 15000 });
    await p.click('#ntEnable');
    return until(p, () => (document.getElementById('ntDeviceState') || {}).textContent === 'Enabled');
  }
  async function closeSheet(p){ await p.click('#sheetCloseBtn'); await sleep(250); }
  async function today(p){ await p.click('.tab-btn[data-view="log"]'); await sleep(300); }
  async function openAction(p, title){
    await p.evaluate(t => [...document.querySelectorAll('.commitment-item')].find(r => r.textContent.indexOf(t) > -1).querySelector('.commitment-body').click(), title);
    await p.waitForSelector('#saveCommitBtn');
  }
  const focusDoc = () => get('ledger_meta/currentFocus');
  const devId = p => p.evaluate(() => localStorage.getItem('ledger_device_id'));

  // ---- devices sign in ----
  const mac = await session('mac', { w: 1280, ua: UA.mac });
  const iphone = await session('iphone', { w: 390, ua: UA.iphone, standalone: true });
  const samsung = await session('samsung', { w: 412, ua: UA.samsung });
  for (const p of [mac, iphone, samsung]) await signIn(p, SHAUN);
  for (const p of [mac, iphone, samsung]) check(await until(p, () => !!document.querySelector('.commitment-item')), p.name + ': Shaun signed in, Today loaded');

  // ---- device registration ----
  for (const p of [mac, iphone, samsung]) check(await enableNotifications(p), p.name + ': Settings → Notifications → Enable → "Enabled"');
  await iphone.screenshot({ path: `${OUT}/x-1-notifications-iphone.png` });
  const subs = (await all('ledger_push_subscriptions')).filter(s => s.userUid === owner);
  const labels = subs.map(s => s.deviceLabel).sort();
  check(subs.length === 3 && labels.join('|') === 'Shaun · Mac|Shaun · Samsung|Shaun · iPhone', 'three device records under Shaun\'s uid: ' + labels.join(', '));
  check(subs.every(s => s.id.indexOf(owner + '_') === 0 && s.vapidPublicKey === VAPID && /^https:\/\//.test(s.endpoint)), 'each record: id under his uid, the published key, his endpoint');
  check(new Set(subs.map(s => s.deviceId)).size === 3 && subs.map(s => s.platform).sort().join('|') === 'android|ios|macos', 'distinct device ids; platforms ios / android / macos');
  for (const p of [mac, iphone, samsung]) await closeSheet(p);
  for (const p of [mac, iphone, samsung]) await today(p);
  const macId = await devId(mac), iphoneId = await devId(iphone), samsungId = await devId(samsung);

  // an iPhone in Safari (not installed): honest about the Home Screen requirement
  const safari = await session('safari', { w: 390, ua: UA.iphone });
  await signIn(safari, SHAUN);
  await until(safari, () => !!document.querySelector('.commitment-item'));
  await openSettings(safari); await safari.click('#setNotifications');
  await until(safari, () => (document.getElementById('ntDeviceState') || {}).textContent === 'Needs Home Screen');
  check(/Needs Home Screen/.test(await txt(safari, '#ntDeviceState')) && /Install Ledger to your Home Screen to enable notifications/.test(await txt(safari, '#ntNote')) && await safari.isHidden('#ntEnable'),
    'iPhone in Safari: "Install Ledger to your Home Screen to enable notifications", no Enable button');
  await safari.screenshot({ path: `${OUT}/x-2-safari-install.png` });
  await safari.ctx.close();

  // Abi registers her own device
  const abiPhone = await session('abi', { w: 390, ua: UA.samsung });
  await signIn(abiPhone, ABI);
  check(await until(abiPhone, () => !!document.getElementById('ppNotify')), 'Abi: her shared view, with Notifications in the footer');
  await abiPhone.click('#ppNotify');
  await abiPhone.waitForSelector('#ntEnable:not([hidden])', { timeout: 15000 });
  check(!(await abiPhone.$('#ntFocus')) && !!(await abiPhone.$('#ntPartner')), 'Abi\'s sheet: requests & updates only (Current Focus is not hers)');
  await abiPhone.click('#ntEnable');
  check(await until(abiPhone, () => (document.getElementById('ntDeviceState') || {}).textContent === 'Enabled'), 'Abi: her device enabled');
  const abiSubs = (await all('ledger_push_subscriptions')).filter(s => s.userUid === abi);
  check(abiSubs.length === 1 && abiSubs[0].id.indexOf(abi + '_') === 0 && abiSubs[0].deviceLabel === 'Abi · Samsung', 'Abi\'s device is under her uid: ' + (abiSubs[0] && abiSubs[0].deviceLabel));
  const peek = await abiPhone.evaluate(async (o) => {
    const db = firebase.firestore(), out = {};
    for (const [k, f] of [['list', () => db.collection('ledger_push_subscriptions').where('userUid', '==', o).get()],
                          ['doc', () => db.collection('ledger_push_subscriptions').doc(o + '_x').get()],
                          ['focus', () => db.collection('ledger_meta').doc('currentFocus').get()],
                          ['sprints', () => db.collection('ledger_sprints').get()]]){
      try { await f(); out[k] = 'allowed'; } catch(e){ out[k] = e.code; }
    }
    return out;
  }, owner);
  check(peek.list === 'permission-denied' && peek.focus === 'permission-denied' && peek.sprints === 'permission-denied', 'Abi cannot read Shaun\'s devices, his focus or his sprints: ' + JSON.stringify(peek));
  await abiPhone.click('#ppSheet .sheet-close'); await sleep(250);

  // ---- 1. the Mac sets Action A as the Current Focus ----
  let mark = inbox.length;
  await openAction(mac, 'Finish accounts proposal');
  await mac.click('#focusSetBtn');
  check(await nowOn(mac, 'Finish accounts proposal'), 'Mac: NOW shows the Action at once');
  let f = null;
  for (let i = 0; i < 40 && !(f && f.sourceId === 'a1'); i++){ f = await focusDoc(); if (!(f && f.sourceId === 'a1')) await sleep(250); }
  check(f && f.status === 'active' && f.type === 'action' && f.sourceId === 'a1' && f.ownerUid === owner && f.sourceDeviceId === macId, 'Firestore: ledger_meta/currentFocus → a1, set by the Mac');
  check(await nowOn(iphone, 'Finish accounts proposal'), 'iPhone: NOW updates without reload');
  check(await nowOn(samsung, 'Finish accounts proposal'), 'Samsung: NOW updates without reload');
  check(/Work · Key task/.test(await txt(iphone, '#nowCue .now-meta')), 'NOW line: Work · Key task');
  await iphone.screenshot({ path: `${OUT}/x-3-now-iphone.png` });
  let got = await waitPushes(mark, 2);
  check(got.length === 2 && got.map(g => g.device).sort().join('|') === 'iphone|samsung', 'push: Shaun\'s other two devices, not the Mac that set it: ' + got.map(g => g.device).join(', '));
  const p1 = got[0] && got[0].payload;
  check(p1 && p1.title === 'Ledger · Current focus' && p1.body === 'Finish accounts proposal' && p1.tag === 'ledger-current-focus' && p1.renotify === true, 'payload: "Ledger · Current focus" / the title / stable tag / renotify');
  check(p1 && p1.url === APP_URL + '?openAction=a1', 'payload opens the Action: ' + (p1 && p1.url));
  check(got[0] && got[0].headers.topic === 'ledger-current-focus' && got[0].headers.urgency === 'high' && /vapid t=.+, k=/.test(got[0].headers.authorization || '') && (got[0].headers.authorization || '').indexOf(VAPID) > -1,
    'Web Push headers: Topic, high urgency, VAPID signed with the published key');
  check(!got.some(g => g.device === 'abi'), 'Abi gets nothing');

  // ---- 2. the iPhone changes it to Action B ----
  mark = inbox.length;
  await iphone.click('#nowChange'); await iphone.waitForSelector('.fp-list');
  await iphone.evaluate(() => [...document.querySelectorAll('.fp-row')].find(r => /Call the bank/.test(r.textContent)).click());
  check(await nowOn(mac, 'Call the bank') && await nowOn(samsung, 'Call the bank'), 'iPhone changes the focus → Mac and Samsung follow');
  f = await focusDoc();
  check(f.sourceId === 'a2' && f.sourceDeviceId === iphoneId, 'one focus record, replaced (a2, set by the iPhone)');
  got = await waitPushes(mark, 2);
  check(got.length === 2 && got.map(g => g.device).sort().join('|') === 'mac|samsung' && got.every(g => g.payload.tag === 'ledger-current-focus' && g.payload.body === 'Call the bank about the mortgage'),
    'push: Mac and Samsung, same tag, so it replaces the last one');

  // ---- 3. the Samsung completes it: the normal completion, focus cleared everywhere ----
  mark = inbox.length;
  await samsung.click('#nowDone');
  check(await until(mac, () => !document.querySelector('#nowCue .now-cue')) && await until(iphone, () => !document.querySelector('#nowCue .now-cue')), 'Done on the Samsung: the focus disappears on the Mac and the iPhone');
  check((await get('ledger_commitments/a2')).status === 'completed' && (await focusDoc()).status === 'cleared', 'Action B completed through the normal path; focus cleared');
  got = await waitPushes(mark, 1, 4000);
  check(got.length === 0, 'clearing the focus sends no push');

  // ---- 4. a Reset Sprint on the Mac; the first item becomes the focus ----
  mark = inbox.length;
  await mac.click('#sprintEntry'); await mac.waitForSelector('#spLines'); await sleep(150);
  await mac.fill('#spLines', 'Tidy desk\nPut washing on\nEat lunch');
  await mac.click('#spStart');
  check(await until(iphone, () => /Tidy desk/.test((document.querySelector('#sprintSection .sp-next-title') || {}).textContent || '')), 'iPhone: the sprint appears live, Next: Tidy desk');
  const sp = (await all('ledger_sprints'))[0];
  f = await focusDoc();
  check(sp && sp.items.length === 3 && f.type === 'sprint_item' && f.sourceId === sp.id && f.childId === sp.items[0].id, 'the first sprint item is the Current Focus');
  got = await waitPushes(mark, 2);
  check(got.length === 2 && got.every(g => g.payload.body === 'Tidy desk' && g.payload.url === APP_URL + '?sprint=' + sp.id), 'push: the sprint item, opening its sprint');
  await mac.screenshot({ path: `${OUT}/x-4-sprint-mac.png` });

  // ---- 5. the iPhone ticks it: the focus advances on every device ----
  mark = inbox.length;
  await iphone.click('#sprintSection [data-sp-item="0"]');
  check(await until(mac, () => /Put washing on/.test((document.querySelector('#sprintSection .sp-next-title') || {}).textContent || '') && !!document.querySelector('#sprintSection .sp-now')), 'Mac: Next and Now move to "Put washing on"');
  f = await focusDoc();
  check(f.childId === sp.items[1].id && f.sourceDeviceId === iphoneId, 'focus advanced to the next item, by the iPhone');
  await samsung.click('[data-today-mode="flow"]');
  check(await until(samsung, () => { const r = document.querySelector('.tl-row.sprint'); return !!r && r.classList.contains('is-focus') && /1 of 3 cleared/.test(r.textContent); }), 'Samsung Flow: one sprint block, marked Now, 1 of 3 cleared');
  check(await nowOn(samsung, 'Put washing on'), 'Samsung (Flow): NOW shows the sprint item');
  await samsung.screenshot({ path: `${OUT}/x-5-flow-samsung.png` });
  got = await waitPushes(mark, 2);
  check(got.length === 2 && got.map(g => g.device).sort().join('|') === 'mac|samsung' && got.every(g => g.payload.body === 'Put washing on'), 'the advance is one focus push to the other devices — the tick itself pushes nothing more');
  await samsung.click('[data-today-mode="overview"]');

  // ---- deep links: cold, and handed over by the service worker ----
  const cold = await iphone.ctx.newPage(); cold.on('dialog', d => d.accept());
  await cold.goto(APP + '?sprint=' + sp.id);
  check(await until(cold, () => !!document.querySelector('.sheet .sp-panel') && document.getElementById('sheetBackdrop').classList.contains('open'), null, 20000), 'a notification link (?sprint=) opens the sprint');
  await cold.goto(APP + '?openAction=a1');
  check(await until(cold, () => (document.getElementById('f_commitTitle') || {}).value === 'Finish accounts proposal', null, 20000), 'a notification link (?openAction=) opens the Action');
  await cold.close();
  await mac.evaluate(u => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'ledger-open', url: u } })), APP_URL + '?openAction=a3');
  check(await until(mac, () => (document.getElementById('f_commitTitle') || {}).value === 'Book swimming lessons'), 'a tap while Ledger is open: the link opens in place, no reload');
  await closeSheet(mac);

  // ---- Partner: requests and updates reach the other side ----
  mark = inbox.length;
  await abiPhone.click('#ppAddReq'); await abiPhone.waitForSelector('#ppReqText');
  await abiPhone.fill('#ppReqText', 'Pick up prescription');
  await abiPhone.click('#ppReqSave');
  got = await waitPushes(mark, 3);
  const rq = (await all('ledger_shared_requests'))[0];
  check(got.length === 3 && got.map(g => g.device).sort().join('|') === 'iphone|mac|samsung' && got.every(g => g.payload.title === 'Abi sent a request' && g.payload.body === 'Pick up prescription' && g.payload.url === APP_URL + '?request=' + rq.id),
    'Abi sends a request → all of Shaun\'s devices: "Abi sent a request" / "Pick up prescription"');
  mark = inbox.length;
  check(await until(mac, () => !!document.querySelector('[data-ib-open]')), 'Mac: the request is in the Inbox');
  await mac.click('[data-ib-open]'); await mac.waitForSelector('#rqText');
  await mac.fill('#rqText', 'Spoke to the pharmacy — ready at 4.'); await mac.click('#rqSend');
  got = await waitPushes(mark, 1);
  check(got.length === 1 && got[0].device === 'abi' && got[0].payload.title === 'Shaun updated “Pick up prescription”' && got[0].payload.body === 'Spoke to the pharmacy — ready at 4.', 'Shaun adds an update → Abi: ' + (got[0] && got[0].payload.title));
  await closeSheet(mac);
  mark = inbox.length;
  await abiPhone.evaluate(() => [...document.querySelectorAll('.pp-req, [data-pp-req], .pp-row')].find(r => /Pick up prescription/.test(r.textContent)).click());
  await abiPhone.waitForSelector('#rqText');
  await abiPhone.fill('#rqText', 'Thank you!'); await abiPhone.click('#rqSend');
  got = await waitPushes(mark, 3);
  check(got.length === 3 && got.every(g => g.payload.title === 'Abi updated “Pick up prescription”' && g.payload.body === 'Thank you!'), 'Abi adds an update → Shaun\'s devices');
  const everything = JSON.stringify(inbox.map(g => g.payload));
  check(!/SECRET|accounts proposal.*private|mortgage.*note/i.test(everything) && !/SECRET/.test(everything), 'no private Ledger data in any notification (Day Notes never)');

  // ---- turning a device off; signing out ----
  await openSettings(samsung); await samsung.click('#setNotifications');
  await samsung.waitForSelector('#ntDisable:not([hidden])', { timeout: 15000 }); await samsung.click('#ntDisable');
  check(await until(samsung, () => (document.getElementById('ntDeviceState') || {}).textContent === 'Not enabled'), 'Samsung: Disable on this device');
  check(!(await all('ledger_push_subscriptions')).some(s => s.deviceId === samsungId), 'its record is gone');
  await closeSheet(samsung); await today(samsung);
  mark = inbox.length;
  await openAction(mac, 'Book swimming lessons'); await mac.click('#focusSetBtn');
  got = await waitPushes(mark, 1);
  check(got.length === 1 && got[0].device === 'iphone', 'the next focus reaches only the iPhone (Mac set it, Samsung is off)');
  // Pin now rides the same engine: every device Shaun has on, the Mac included
  await closeSheet(mac).catch(() => {});
  mark = inbox.length;
  await openAction(mac, 'Finish accounts proposal'); await mac.click('#pinExistingBtn');
  got = await waitPushes(mark, 2);
  check(got.length === 2 && got.map(g => g.device).sort().join('|') === 'iphone|mac' && got.every(g => g.payload.body === 'Finish accounts proposal' && g.payload.url === APP_URL + '?openAction=a1'),
    'Pin now: to Shaun\'s enabled devices (Mac and iPhone), opening the Action');
  const pins = await all('ledger_pins');
  check(pins.length === 1 && pins[0].status === 'sent' && pins[0].ownerUid === owner, 'the pin is marked sent by the server');
  await closeSheet(mac).catch(() => {});

  await openSettings(iphone);
  await iphone.click('#setSignOut');
  check(await until(iphone, () => !!document.getElementById('authEmail'), null, 20000), 'iPhone: signed out');
  check(!(await all('ledger_push_subscriptions')).some(s => s.deviceId === iphoneId), 'signing out removes this device\'s record');
  const events = await all('ledger_push_events');
  check(events.length === 9 && events.every(e => e.status === 'done'), 'every push event logged once, done (' + events.length + ')');

  for (const p of [mac, iphone, samsung, abiPhone]){
    const errs = p.errs.filter(e => !/permission|offline|network/i.test(e));
    check(!errs.length, p.name + ': no page errors ' + errs.join(' | '));
  }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  await b.close(); server.close(); sink.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
