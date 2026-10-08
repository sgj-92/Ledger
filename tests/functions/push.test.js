// Ledger — the push engine (functions/push.js) against the Firestore emulator.
//
//   cd functions && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node ../tests/functions/push.test.js"
//
// The engine runs with the real Admin SDK and a fake `send` that records what would have
// gone to each push service (and can play a dead or failing endpoint). The full trigger
// path — real Web Push encryption to a local push endpoint, from the app's own writes —
// is covered by tests/e2e/focus-push.test.js.

const path = require('path');
const fnDir = path.join(__dirname, '../../functions');
const admin = require(path.join(fnDir, 'node_modules/firebase-admin'));
const { createEngine, appLink } = require(path.join(fnDir, 'push.js'));

admin.initializeApp({ projectId: 'demo-ledger' });
const db = admin.firestore();
const APP = 'https://ledger.sgj.luxe/';
const KEY = 'BPublicKeyCurrent';

let passed = 0, failed = 0;
function check(cond, name, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
}

let sent = [];
const dead = new Set(), broken = new Set();
async function send(sub, body, opts) {
  if (dead.has(sub.endpoint)) { const e = new Error('Gone'); e.statusCode = 410; throw e; }
  if (broken.has(sub.endpoint)) { const e = new Error('Server error'); e.statusCode = 500; e.body = 'upstream'; throw e; }
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body), opts });
}
const engine = createEngine({ db, send, deleteField: () => admin.firestore.FieldValue.delete() });
const sub = (uid, dev, o) => Object.assign({ userUid: uid, endpoint: 'https://push.example/' + uid + '/' + dev,
  keys: { p256dh: 'p', auth: 'a' }, deviceId: dev, deviceLabel: uid + ' · ' + dev, platform: 'x', vapidPublicKey: KEY }, o || {});
const to = (uid) => sent.filter((s) => s.endpoint.indexOf('/' + uid + '/') > -1);
const reset = () => { sent = []; };

(async () => {
  // ---- the world ----
  await db.doc('ledger_users/shaun').set({ role: 'owner', displayName: 'Shaun' });
  await db.doc('ledger_users/abi').set({ role: 'partner', displayName: 'Abi' });
  await db.doc('ledger_users/eve').set({ role: 'partner', displayName: 'Eve' });
  await db.doc('ledger_share_members/shaun_abi').set({ ownerUid: 'shaun', partnerUid: 'abi', role: 'partner', active: true, displayName: 'Abi', ownerName: 'Shaun' });
  await db.doc('ledger_share_members/shaun_eve').set({ ownerUid: 'shaun', partnerUid: 'eve', role: 'partner', active: false, displayName: 'Eve', ownerName: 'Shaun' });
  for (const d of ['mac', 'iphone', 'ipad', 'samsung']) await db.doc('ledger_push_subscriptions/shaun_' + d).set(sub('shaun', d));
  await db.doc('ledger_push_subscriptions/abi_iphone').set(sub('abi', 'iphone'));
  await db.doc('ledger_push_subscriptions/eve_phone').set(sub('eve', 'phone'));
  await db.doc('ledger_shared_requests/req1').set({ ownerUid: 'shaun', partnerUid: 'abi', text: 'Call nursery about the forms for next week', status: 'requested' });
  await db.doc('ledger_shared_requests/reqEve').set({ ownerUid: 'shaun', partnerUid: 'eve', text: 'Eve thing', status: 'requested' });

  const focus = (o) => Object.assign({ ownerUid: 'shaun', type: 'action', sourceId: 'actA', childId: null, title: 'Tidy desk',
    setAt: '2026-10-08T09:00:00Z', sourceDeviceId: 'mac', status: 'active' }, o || {});

  // ---- sendPushToUser ----
  reset();
  let r = await engine.sendPushToUser('abi', { title: 't' }, {});
  check(r.sent === 1 && to('abi').length === 1 && to('shaun').length === 0, 'sendPushToUser: only that user\'s devices', r);
  reset();
  r = await engine.sendPushToUser('shaun', { title: 't' }, { excludeDeviceId: 'mac' });
  check(r.sent === 3 && r.excluded === 1 && !sent.some((s) => /\/mac$/.test(s.endpoint)), 'sendPushToUser: every device but the one excluded', r);
  reset();
  r = await engine.sendPushToUser('nobody', { title: 't' }, {});
  check(r.devices === 0 && sent.length === 0, 'sendPushToUser: a user with no devices gets nothing, without error');

  // ---- Current Focus ----
  reset();
  r = await engine.handleFocusWrite({ before: null, after: focus(), eventId: 'ev1', appUrl: APP, vapidPublicKey: KEY });
  const fp = to('shaun');
  check(fp.length === 3 && !fp.some((s) => /\/mac$/.test(s.endpoint)), 'focus: pushed to Shaun\'s other three devices, not the Mac that set it', r);
  check(fp.length && fp[0].payload.tag === 'ledger-current-focus' && fp[0].payload.renotify === true, 'focus: stable tag, renotify');
  check(fp.length && fp[0].payload.title === 'Ledger · Current focus' && fp[0].payload.body === 'Tidy desk', 'focus: "Ledger · Current focus" / the title');
  check(fp.length && fp[0].payload.url === APP + '?openAction=actA', 'focus: opens the Action', fp[0] && fp[0].payload.url);
  check(fp.length && fp[0].opts.topic === 'ledger-current-focus' && fp[0].opts.urgency === 'high', 'focus: Topic header replaces an undelivered focus; high urgency');
  check(to('abi').length === 0, 'focus: never reaches the partner');
  reset();
  r = await engine.handleFocusWrite({ before: null, after: focus(), eventId: 'ev1', appUrl: APP, vapidPublicKey: KEY });
  check(sent.length === 0 && r.skipped === 'duplicate', 'focus: the same event twice sends once');
  reset();
  r = await engine.handleFocusWrite({ before: focus(), after: focus({ title: 'Tidy the desk' }), eventId: 'ev2', appUrl: APP });
  check(sent.length === 0 && r.skipped === 'same focus', 'focus: an edit to the same focus is quiet');
  reset();
  r = await engine.handleFocusWrite({ before: focus(), after: focus({ sourceId: 'actB', title: 'Finish proposal', setAt: '2026-10-08T09:05:00Z', sourceDeviceId: 'iphone' }), eventId: 'ev3', appUrl: APP, vapidPublicKey: KEY });
  check(to('shaun').length === 3 && !sent.some((s) => /\/iphone$/.test(s.endpoint)) && sent.some((s) => /\/mac$/.test(s.endpoint)), 'focus: a new focus from the iPhone reaches the Mac, not the iPhone', r);
  reset();
  r = await engine.handleFocusWrite({ before: focus(), after: { ownerUid: 'shaun', status: 'cleared' }, eventId: 'ev4', appUrl: APP });
  check(sent.length === 0, 'focus: clearing is quiet');
  reset();
  r = await engine.handleFocusWrite({ before: null, after: focus({ type: 'sprint_item', sourceId: 'spr1', childId: 'i2', setAt: 'x2' }), eventId: 'ev5', appUrl: APP, vapidPublicKey: KEY });
  check(sent.length === 3 && sent[0].payload.url === APP + '?sprint=spr1', 'focus: a sprint item opens its sprint', sent[0] && sent[0].payload.url);
  reset();
  r = await engine.handleFocusWrite({ before: null, after: focus({ ownerUid: 'abi', setAt: 'x3' }), eventId: 'ev6', appUrl: APP });
  check(sent.length === 0 && r.skipped === 'not an owner', 'focus: a record naming a non-owner sends nothing');
  await db.doc('ledger_notification_prefs/shaun').set({ currentFocus: false, partner: true });
  reset();
  r = await engine.handleFocusWrite({ before: null, after: focus({ setAt: 'x4' }), eventId: 'ev7', appUrl: APP });
  check(sent.length === 0 && r.skipped === 'turned off', 'focus: respects "Current Focus: off"');
  await db.doc('ledger_notification_prefs/shaun').delete();

  // ---- dead, failing and stale devices ----
  dead.add('https://push.example/shaun/ipad');
  broken.add('https://push.example/shaun/samsung');
  await db.doc('ledger_push_subscriptions/shaun_oldkey').set(sub('shaun', 'oldkey', { vapidPublicKey: 'BOldKey' }));
  reset();
  r = await engine.handleFocusWrite({ before: null, after: focus({ setAt: 'x5', sourceDeviceId: null }), eventId: 'ev8', appUrl: APP, vapidPublicKey: KEY });
  check(r.sent === 2 && r.removed === 2 && r.failed === 1, 'focus: 2 sent, dead and stale-key devices removed, 1 failure recorded', r);
  const ipad = await db.doc('ledger_push_subscriptions/shaun_ipad').get();
  const oldkey = await db.doc('ledger_push_subscriptions/shaun_oldkey').get();
  const samsung = await db.doc('ledger_push_subscriptions/shaun_samsung').get();
  check(!ipad.exists && !oldkey.exists, 'a 410 device and a device made with an old key are deleted');
  check(samsung.exists && /500/.test(samsung.data().lastError || ''), 'a failing device keeps its record, with the error', samsung.data());
  const evDoc = await db.doc('ledger_push_events/focus_ev8').get();
  check(evDoc.exists && evDoc.data().failed === 1 && evDoc.data().status === 'done', 'the event is logged with its outcome');
  broken.clear(); dead.clear();
  const mac = await db.doc('ledger_push_subscriptions/shaun_mac').get();
  check(mac.exists && !!mac.data().lastSentAt, 'a delivered device records when');

  // ---- Partner Requests ----
  const u = (o) => Object.assign({ requestId: 'req1', ownerUid: 'shaun', partnerUid: 'abi', type: 'comment', actorUid: 'abi', actorRole: 'partner', text: 'They need the form tomorrow.', metadata: {} }, o || {});
  reset();
  r = await engine.handleRequestUpdate({ update: u({ type: 'request_created', text: null }), updateId: 'req1_created', appUrl: APP, vapidPublicKey: KEY });
  check(to('shaun').length === 3 && to('abi').length === 0, 'Abi sends a request → Shaun\'s devices', r);
  const np = to('shaun')[0] && to('shaun')[0].payload;
  check(np && np.title === 'Abi sent a request' && np.body === 'Call nursery about the forms for next week', 'request: "Abi sent a request" / its text', np);
  check(np && np.url === APP + '?request=req1' && np.tag === 'ledger-request-req1', 'request: opens the shared request');
  reset();
  r = await engine.handleRequestUpdate({ update: u(), updateId: 'c1', appUrl: APP });
  const cp = to('shaun')[0] && to('shaun')[0].payload;
  check(cp && /^Abi updated “Call nursery about the forms for next week”$/.test(cp.title) && cp.body === 'They need the form tomorrow.', 'Abi adds an update → Shaun: "Abi updated …" / the update', cp);
  reset();
  r = await engine.handleRequestUpdate({ update: u({ actorUid: 'shaun', actorRole: 'owner', text: 'Spoke to them — form sent.' }), updateId: 'c2', appUrl: APP });
  const sp = to('abi')[0] && to('abi')[0].payload;
  check(to('abi').length === 1 && to('shaun').length === 0 && sp.title.indexOf('Shaun updated') === 0 && sp.body === 'Spoke to them — form sent.', 'Shaun adds an update → Abi', sp);
  reset();
  await engine.handleRequestUpdate({ update: u({ actorUid: 'shaun', actorRole: 'system', type: 'planned', text: null, metadata: { toDate: '2026-10-09' } }), updateId: 'c3', appUrl: APP });
  check(to('abi').length === 1 && to('abi')[0].payload.title === 'Shaun planned your request', 'Shaun plans it → Abi');
  reset();
  await engine.handleRequestUpdate({ update: u({ actorUid: 'shaun', actorRole: 'system', type: 'status', text: null, metadata: { status: 'done' } }), updateId: 'c4', appUrl: APP });
  check(to('abi').length === 1 && to('abi')[0].payload.title === 'Shaun completed your request', 'Shaun completes it → Abi');
  reset();
  for (const [id, x] of [['q1', { actorUid: 'shaun', actorRole: 'system', type: 'moved', text: null, metadata: { toDate: 'x' } }],
                         ['q2', { actorUid: 'shaun', actorRole: 'system', type: 'status', text: null, metadata: { status: 'in_progress' } }],
                         ['q3', { type: 'withdrawn', text: null }],
                         ['q4', { actorUid: 'shaun', actorRole: 'system', type: 'dismissed', text: null }]]) {
    await engine.handleRequestUpdate({ update: u(x), updateId: id, appUrl: APP });
  }
  check(sent.length === 0, 'moved, in progress, withdrawn and dismissed stay quiet');
  reset();
  r = await engine.handleRequestUpdate({ update: u(), updateId: 'c1', appUrl: APP });
  check(sent.length === 0 && r.skipped === 'duplicate', 'the same Update twice notifies once');
  // trust: a recipient is never what an entry claims
  reset();
  r = await engine.handleRequestUpdate({ update: u({ partnerUid: 'eve' }), updateId: 'x1', appUrl: APP });
  check(sent.length === 0 && r.skipped === 'mismatch', 'an entry naming a different partner than its request sends nothing');
  reset();
  r = await engine.handleRequestUpdate({ update: u({ actorUid: 'eve' }), updateId: 'x2', appUrl: APP });
  check(sent.length === 0, 'an entry whose actor is not the request\'s partner sends nothing');
  reset();
  r = await engine.handleRequestUpdate({ update: u({ actorUid: 'abi', actorRole: 'owner' }), updateId: 'x3', appUrl: APP });
  check(sent.length === 0, 'a partner posing as the owner sends nothing');
  reset();
  r = await engine.handleRequestUpdate({ update: u({ requestId: 'reqEve', partnerUid: 'eve', actorUid: 'eve' }), updateId: 'x4', appUrl: APP });
  check(sent.length === 0 && r.skipped === 'not shared', 'a paused relationship sends nothing');
  reset();
  r = await engine.handleRequestUpdate({ update: u({ requestId: 'missing' }), updateId: 'x5', appUrl: APP });
  check(sent.length === 0, 'an entry for no request sends nothing');
  await db.doc('ledger_notification_prefs/abi').set({ partner: false });
  reset();
  await engine.handleRequestUpdate({ update: u({ actorUid: 'shaun', actorRole: 'owner', text: 'x' }), updateId: 'c9', appUrl: APP });
  check(to('abi').length === 0, 'respects Abi\'s "Partner requests & updates: off"');
  check(to('eve').length === 0, 'Eve\'s device is never reached');

  // ---- Pin now ----
  reset();
  const pinRef = db.doc('ledger_pins/p1');
  await pinRef.set({ ownerUid: 'shaun', text: 'Bring charger', linkedActionId: 'actA', status: 'pending' });
  r = await engine.handlePinCreated({ pin: (await pinRef.get()).data(), pinId: 'p1', ref: pinRef, appUrl: APP });
  const pin = (await pinRef.get()).data();
  check(to('shaun').length === 3 && r.devices === 3 && pin.status === 'sent', 'Pin now: all of the owner\'s remaining devices (the iPad was removed above); pin marked sent', r);
  check(to('shaun')[0].payload.url === APP + '?openAction=actA', 'Pin now: opens its Action');
  reset();
  const pin2 = db.doc('ledger_pins/p2');
  await pin2.set({ ownerUid: 'abi', text: 'x', status: 'pending' });
  r = await engine.handlePinCreated({ pin: (await pin2.get()).data(), pinId: 'p2', ref: pin2, appUrl: APP });
  check(sent.length === 0 && (await pin2.get()).data().status === 'failed', 'Pin now: a pin naming a non-owner sends nothing');

  check(appLink(APP, { request: 'a b&c' }) === APP + '?request=a%20b%26c', 'links are encoded');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
