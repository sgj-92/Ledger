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
const { createEngine, appLink, fcmMessage } = require(path.join(fnDir, 'push.js'));

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
  r = await engine.handleFocusWrite({ before: null, after: focus({ type: 'training', sourceId: 'resistance', childId: 'Lateral Raises', title: 'Lateral Raises', setAt: 'x3' }), eventId: 'ev5t', appUrl: APP, vapidPublicKey: KEY });
  check(sent.length === 3 && sent[0].payload.url === APP && sent[0].payload.body === 'Lateral Raises', 'focus: an exercise in focus opens Today', sent[0] && sent[0].payload);
  reset();
  r = await engine.handleFocusWrite({ before: focus({ setAt: 'x4' }), after: focus({ setAt: 'x4', timerMin: 25, endsAt: '2026-10-28T10:25:00Z' }), eventId: 'ev5u', appUrl: APP, vapidPublicKey: KEY });
  check(sent.length === 0, 'focus: setting a timer on the same focus sends nothing');
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
  // a withdrawn request moved to upcoming: the new request pushes once, said as such;
  // the old record's "renewed" entry stays quiet
  await db.doc('ledger_shared_requests/req2').set({ ownerUid: 'shaun', partnerUid: 'abi', text: 'Sort the visa', status: 'requested', requestedTiming: 'later', renewedFrom: 'req1' });
  reset();
  r = await engine.handleRequestUpdate({ update: u({ requestId: 'req2', type: 'request_created', text: null, metadata: { renewedFrom: 'req1' } }), updateId: 'req2_created', appUrl: APP, vapidPublicKey: KEY });
  check(to('shaun').length === 3 && to('shaun')[0].payload.title === 'Abi moved a request to upcoming' && to('shaun')[0].payload.body === 'Sort the visa', 'moved to upcoming → Shaun, once, as a new request', to('shaun')[0] && to('shaun')[0].payload);
  reset();
  r = await engine.handleRequestUpdate({ update: u({ type: 'renewed', text: null, metadata: { renewedAs: 'req2' } }), updateId: 'req1_renewed', appUrl: APP });
  check(sent.length === 0, 'the withdrawn record\'s "renewed" entry stays quiet');
  // recorded by Shaun on Abi's behalf: announced exactly as if Abi had sent it, to every
  // one of Shaun's devices (the one he typed it on included); Abi hears nothing
  await db.doc('ledger_shared_requests/req3').set({ ownerUid: 'shaun', partnerUid: 'abi', text: 'Book the dentist', status: 'requested', requestedTiming: 'week', createdByUid: 'shaun', createdByRole: 'owner' });
  reset();
  r = await engine.handleRequestUpdate({ update: u({ requestId: 'req3', type: 'request_created', actorUid: 'shaun', actorRole: 'owner', text: null, metadata: { onBehalf: true } }), updateId: 'req3_created', appUrl: APP, vapidPublicKey: KEY });
  const ob = to('shaun')[0] && to('shaun')[0].payload;
  check(to('shaun').length === 3 && to('abi').length === 0 && r.excluded === 0, 'a request Shaun records on Abi\'s behalf → all of Shaun\'s devices, none excluded; Abi nothing', r);
  check(ob && ob.title === 'Abi sent a request' && ob.body === 'Book the dentist' && ob.url === APP + '?request=req3' && ob.tag === 'ledger-request-req3' && ob.kind === 'partner',
    '…the same notification as one Abi sent herself', ob);
  // only a request that really names Shaun as its creator is announced this way
  await db.doc('ledger_shared_requests/req4').set({ ownerUid: 'shaun', partnerUid: 'abi', text: 'Not his', status: 'requested', requestedTiming: 'week' });
  reset();
  r = await engine.handleRequestUpdate({ update: u({ requestId: 'req4', type: 'request_created', actorUid: 'shaun', actorRole: 'owner', text: null }), updateId: 'req4_created', appUrl: APP, vapidPublicKey: KEY });
  check(sent.length === 0, 'an owner "created" entry on a request he did not create sends nothing');
  reset();
  r = await engine.handleRequestUpdate({ update: u({ requestId: 'req3', type: 'request_created', actorUid: 'shaun', actorRole: 'owner', text: null }), updateId: 'req3_created', appUrl: APP, vapidPublicKey: KEY });
  check(sent.length === 0 && r.skipped === 'duplicate', 'and it is announced once');
  reset();
  r = await engine.handleRequestUpdate({ update: u({ requestId: 'req3', type: 'request_created', text: null }), updateId: 'req3_fake', appUrl: APP, vapidPublicKey: KEY });
  check(to('shaun').length === 3, '(an entry is judged by who wrote it: Abi\'s own request still reaches Shaun)');
  // deleted: never a push, from either side, and never as if it were done
  reset();
  for (const [id, x] of [['d1', { type: 'deleted', text: null }], ['d2', { actorUid: 'shaun', actorRole: 'owner', type: 'deleted', text: null }]]) {
    await engine.handleRequestUpdate({ update: u(x), updateId: id, appUrl: APP });
  }
  check(sent.length === 0, 'a deleted request notifies nobody');
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

  // ---- the iOS and Android apps: FCM, alongside Web Push ----
  let fcmSent = [];
  const goneTokens = new Set(), badTokens = new Set();
  async function sendFcm(m){
    if (goneTokens.has(m.token)){ const e = new Error('gone'); e.code = 'messaging/registration-token-not-registered'; throw e; }
    if (badTokens.has(m.token)){ const e = new Error('unavailable'); e.code = 'messaging/server-unavailable'; throw e; }
    fcmSent.push(m);
  }
  const both = createEngine({ db, send, sendFcm, deleteField: () => admin.firestore.FieldValue.delete() });
  const app = (uid, dev, o) => Object.assign({ userUid: uid, transport: 'fcm', fcmToken: 'tok-' + uid + '-' + dev, deviceId: dev, platform: 'ios', deviceLabel: uid + ' app' }, o || {});
  await db.doc('ledger_push_subscriptions/abi_napp').set(app('abi', 'app'));
  reset(); fcmSent = [];
  r = await both.sendPushToUser('abi', { title: 'Shaun sent a request', body: 'Milk', url: APP + '?home=r1' }, { vapidPublicKey: KEY, ttl: 86400 });
  check(r.sent === 2 && to('abi').length === 1 && fcmSent.length === 1 && fcmSent[0].token === 'tok-abi-app', 'apps: the browser by Web Push and the app by FCM, both', r);
  const m = fcmSent[0];
  check(m.notification.title === 'Shaun sent a request' && m.notification.body === 'Milk' && m.data.url === APP + '?home=r1' && m.data.kind === 'home'
    && m.android.notification.channelId === 'home' && m.apns.payload.aps['thread-id'] === 'home' && m.android.ttl === 86400000,
    'apps: the same title, body and link; Android\'s Home channel; a day to live', m);
  check(Object.values(m.data).every((v) => typeof v === 'string'), 'apps: FCM data is all strings');
  const f = fcmMessage('t', { title: 'Ledger · Current focus', body: 'x', url: APP + '?openAction=a', tag: 'ledger-current-focus' }, { urgency: 'high' });
  check(f.android.notification.channelId === 'focus' && f.android.notification.tag === 'ledger-current-focus' && f.apns.headers['apns-collapse-id'] === 'ledger-current-focus'
    && f.apns.headers['apns-priority'] === '10' && f.android.priority === 'high', 'apps: Current Focus replaces the last one (tag / collapse id), sent at high priority');
  check(fcmMessage('t', { title: 'x', url: APP + '?request=q' }, {}).data.kind === 'partner' && fcmMessage('t', { title: 'x', url: APP + '?openAction=q' }, {}).data.kind === 'general', 'apps: Partner and other kinds have their channels');
  // the app's own device is left out like a browser's
  reset(); fcmSent = [];
  r = await both.sendPushToUser('abi', { title: 't' }, { excludeDeviceId: 'app' });
  check(fcmSent.length === 0 && r.excluded === 1, 'apps: the device that did it is left out', r);
  // a token FCM no longer knows is removed; a passing failure is kept and noted
  goneTokens.add('tok-abi-app'); fcmSent = [];
  r = await both.sendPushToUser('abi', { title: 't' }, {});
  check(r.removed === 1 && !(await db.doc('ledger_push_subscriptions/abi_napp').get()).exists, 'apps: an unregistered token is removed', r);
  await db.doc('ledger_push_subscriptions/abi_napp2').set(app('abi', 'app2'));
  badTokens.add('tok-abi-app2');
  r = await both.sendPushToUser('abi', { title: 't' }, {});
  const kept = (await db.doc('ledger_push_subscriptions/abi_napp2').get()).data();
  check(r.failed === 1 && kept && /server-unavailable/.test(kept.lastError), 'apps: a passing failure keeps the device and notes why', r);
  badTokens.clear();
  // the off switch: ledger_config/push nativeEnabled false — apps skipped, browsers carry on
  await db.doc('ledger_config/push').set({ nativeEnabled: false }, { merge: true });
  reset(); fcmSent = [];
  r = await both.sendPushToUser('abi', { title: 't' }, {});
  check(fcmSent.length === 0 && to('abi').length === 1 && r.skipped === 1, 'apps: switched off in one place — Web Push carries on', r);
  await db.doc('ledger_config/push').set({ nativeEnabled: true }, { merge: true });
  // an engine without FCM (as before) never touches app records
  reset(); fcmSent = [];
  r = await engine.sendPushToUser('abi', { title: 't' }, {});
  check(fcmSent.length === 0 && to('abi').length === 1 && (await db.doc('ledger_push_subscriptions/abi_napp2').get()).exists, 'apps: without FCM, app records are skipped and kept', r);
  await db.doc('ledger_push_subscriptions/abi_napp2').delete();

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
