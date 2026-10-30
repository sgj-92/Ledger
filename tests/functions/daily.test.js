// Ledger — Home: daily tasks, the server half (functions/daily.js and the push it sends),
// against the Firestore emulator with a fixed clock: what was left moves on once, the
// repeating tasks come once, nothing doubles on a second run, a task removed stays
// removed, the morning message comes once at its hour, and someone adding to today's
// list tells the person.
//
//   cd functions && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node ../tests/functions/daily.test.js"

const path = require('path');
const fnDir = path.join(__dirname, '../../functions');
const admin = require(path.join(fnDir, 'node_modules/firebase-admin'));
const { createDaily, listId } = require(path.join(fnDir, 'daily.js'));
const { createEngine } = require(path.join(fnDir, 'push.js'));

admin.initializeApp({ projectId: 'demo-ledger' });
const db = admin.firestore();

let passed = 0, failed = 0;
function check(cond, name, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
const HR = 'ledger_home_requests', HD = 'ledger_home_daily';
const items = async (id) => (await db.collection(HR).doc(id).collection('items').get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
const TODAY = '2026-11-05', YESTERDAY = '2026-11-04';          // a Thursday, in London (GMT)
const at = (iso) => () => new Date(iso);

(async () => {
  const M = (role, name) => ({ homeId: 'shaun', role, status: 'active', displayName: name, addedByUid: 'shaun', addedAt: 'x' });
  await db.doc('ledger_users/shaun').set({ role: 'owner' });
  await db.doc('ledger_users/magda').set({ role: 'household' });
  await db.doc('ledger_home_members/shaun').set(M('admin', 'Shaun'));
  await db.doc('ledger_home_members/abi').set(M('admin', 'Abi'));
  await db.doc('ledger_home_members/magda').set(M('member', 'Magda'));
  await db.doc(HD + '/magda').set({ homeId: 'shaun', uid: 'magda', status: 'active', notifyTime: '08:00', timezone: 'Europe/London',
    createdByUid: 'abi', createdAt: 'x', updatedAt: 'x', updatedByUid: 'abi' });
  const rep = (text, schedule, o) => Object.assign({ text, schedule, starred: false, createdByUid: 'abi', createdAt: 'x', updatedAt: 'x', updatedByUid: 'abi' }, o || {});
  await db.doc(HD + '/magda/repeats/beds').set(rep('Make the beds', { freq: 'daily', startDate: '2026-10-01' }));
  await db.doc(HD + '/magda/repeats/plants').set(rep('Water the plants', { freq: 'weekdays', days: [1, 4], startDate: '2026-10-01' }, { starred: true }));
  await db.doc(HD + '/magda/repeats/bins').set(rep('Bins out', { freq: 'weekly', days: [2], startDate: '2026-10-01' }));
  // yesterday's list: one left, one done, and yesterday's beds not made
  const yid = listId('magda', YESTERDAY);
  await db.doc(HR + '/' + yid).set({ homeId: 'shaun', text: 'Daily tasks', requestedTiming: 'date', requestedDate: YESTERDAY, requesterUid: 'magda', assigneeUid: 'magda',
    createdByUid: 'abi', participants: ['magda', 'abi'], visibility: 'private', status: 'requested', hasChecklist: true, kind: 'daily', dailyUid: 'magda', dailyDate: YESTERDAY, createdAt: 'x', updatedAt: 'x' });
  const I = (text, o) => Object.assign({ text, done: false, order: 1, createdByUid: 'abi', createdAt: 'x', doneByUid: null, doneAt: null, updatedByUid: 'abi', updatedAt: 'x' }, o || {});
  await db.doc(HR + '/' + yid + '/items/iron').set(I('Iron the tops', { starred: true }));
  await db.doc(HR + '/' + yid + '/items/hoover').set(I('Hoover upstairs', { done: true, doneByUid: 'magda', doneAt: 'x' }));
  await db.doc(HR + '/' + yid + '/items/rbeds').set(I('Make the beds', { repeatId: 'beds' }));
  // an older one, outside the fortnight looked back on: left alone
  const oid = listId('magda', '2026-10-01');
  await db.doc(HR + '/' + oid).set({ homeId: 'shaun', kind: 'daily', dailyUid: 'magda', dailyDate: '2026-10-01', status: 'requested' });
  await db.doc(HR + '/' + oid + '/items/old').set(I('Very old'));

  const messages = [];
  const notify = async (uid, m) => { messages.push(Object.assign({ uid }, m)); return { sent: 1 }; };
  const tid = listId('magda', TODAY);

  // ---- just after midnight: the day begins ----
  let out = await createDaily({ db, now: at('2026-11-05T00:30:00Z'), notify }).runOne(db.doc(HD + '/magda'));
  const list = (await db.doc(HR + '/' + tid).get()).data();
  let its = await items(tid);
  check(out.carried === 2 && out.added === 1, 'two carried over, one repeating task added (beds came carried)', out);
  check(list && list.kind === 'daily' && list.dailyUid === 'magda' && list.dailyDate === TODAY && list.assigneeUid === 'magda' && list.createdByUid === 'abi' && list.visibility === 'private',
    'today\'s list is made, for Magda, from Abi', list);
  const iron = its.find((x) => x.text === 'Iron the tops');
  check(iron && iron.carriedFrom === YESTERDAY && iron.starred === true && !iron.done && iron.createdByUid === 'abi', 'what was left comes over, saying from when, its star kept', iron);
  check(its.filter((x) => x.text === 'Make the beds').length === 1, 'yesterday\'s unmade beds count as today\'s beds: never twice', its.map((x) => x.text));
  check(its.some((x) => x.text === 'Water the plants' && x.repeatId === 'plants' && x.starred) && !its.some((x) => x.text === 'Bins out'), 'Thursday\'s repeating task comes (starred); Tuesday\'s doesn\'t', its.map((x) => x.text));
  const yits = await items(yid);
  check(yits.length === 1 && yits[0].text === 'Hoover upstairs', 'yesterday keeps only what was done', yits.map((x) => x.text));
  check((await items(oid)).length === 1, 'a list from over a fortnight ago is left alone');
  check(messages.length === 0, 'no message at half past midnight');
  check((await db.doc(HD + '/magda').get()).data().lastRollDate === TODAY, 'the day is marked as rolled');

  // ---- a second run, and a task removed today ----
  out = await createDaily({ db, now: at('2026-11-05T01:30:00Z'), notify }).runOne(db.doc(HD + '/magda'));
  check(out.carried === 0 && out.added === 0 && (await items(tid)).length === 3, 'a second run changes nothing', out);
  await db.doc(HR + '/' + tid + '/items/rplants' + TODAY.replace(/-/g, '')).delete();
  await db.doc(HD + '/magda/repeats/plants').update({ text: 'Water the plants (front)' });
  out = await createDaily({ db, now: at('2026-11-05T02:30:00Z'), notify }).runOne(db.doc(HD + '/magda'));
  check(!(await items(tid)).some((x) => x.repeatId === 'plants'), 'a repeating task removed today stays removed, even when it changes');
  // a new repeating task for today arrives the same day
  await db.doc(HD + '/magda/repeats/lunch').set(rep('Lunch for Mikael', { freq: 'daily', startDate: '2026-11-05' }));
  out = await createDaily({ db, now: at('2026-11-05T03:30:00Z'), notify }).runOne(db.doc(HD + '/magda'));
  check(out.added === 1 && (await items(tid)).some((x) => x.text === 'Lunch for Mikael'), 'a repeating task set up today appears today', out);

  // ---- the morning message ----
  out = await createDaily({ db, now: at('2026-11-05T08:10:00Z'), notify }).runOne(db.doc(HD + '/magda'));
  check(messages.length === 1 && messages[0].uid === 'magda' && messages[0].title === 'Today: 3 tasks, 2 from before' && messages[0].listId === tid
    && /^Iron the tops/.test(messages[0].body), 'at 8: "Today: 3 tasks, 2 from before", starred first', messages[0]);
  await createDaily({ db, now: at('2026-11-05T09:10:00Z'), notify }).runOne(db.doc(HD + '/magda'));
  check(messages.length === 1, 'once a day');
  // switched on in the afternoon: the first message is tomorrow's
  await db.doc(HD + '/abi').set({ homeId: 'shaun', uid: 'abi', status: 'active', notifyTime: '08:00', timezone: 'Europe/London', createdByUid: 'shaun', createdAt: 'x', updatedAt: 'x', updatedByUid: 'shaun' });
  await db.doc(HD + '/abi/repeats/x').set(rep('School run', { freq: 'daily', startDate: '2026-10-01' }));
  await createDaily({ db, now: at('2026-11-05T15:10:00Z'), notify }).runOne(db.doc(HD + '/abi'));
  check(messages.length === 1 && (await items(listId('abi', TODAY))).length === 1, 'switched on at 3pm: today\'s list is ready, the message waits for tomorrow');
  // the message without a task on the list: none
  await db.doc(HD + '/abi/repeats/x').delete();
  await createDaily({ db, now: at('2026-11-06T08:10:00Z'), notify }).runOne(db.doc(HD + '/abi'));
  check(messages.length === 2 && messages[1].uid === 'abi' && messages[1].title === 'Today: 1 task, 1 from before', 'next morning: yesterday\'s school run, carried', messages[1]);

  // ---- off, or no longer at Home ----
  await db.doc(HD + '/abi').update({ status: 'off' });
  out = await createDaily({ db, now: at('2026-11-07T08:10:00Z'), notify }).runOne(db.doc(HD + '/abi'));
  check(out.skipped === 'off', 'switched off: nothing happens', out);
  await db.doc('ledger_home_members/magda').update({ status: 'removed' });
  out = await createDaily({ db, now: at('2026-11-06T08:10:00Z'), notify }).runOne(db.doc(HD + '/magda'));
  check(out.skipped === 'not at Home', 'someone no longer at Home: nothing happens', out);
  await db.doc('ledger_home_members/magda').update({ status: 'active' });

  // ---- someone adds to today's list: Magda hears it ----
  const sent = [];
  const engine = createEngine({ db, send: async (sub, body) => { sent.push({ to: sub.endpoint.split('/')[3], p: JSON.parse(body) }); }, deleteField: () => admin.firestore.FieldValue.delete(),
    now: () => '2026-11-05T11:00:00.000Z' });
  await db.doc('ledger_push_subscriptions/magda_phone').set({ userUid: 'magda', endpoint: 'https://push.example/magda/phone', keys: { p256dh: 'p', auth: 'a' },
    deviceId: 'phone', deviceLabel: 'Magda', platform: 'x', vapidPublicKey: 'K' });
  const ev = (id, after, before) => ({ requestId: tid, itemId: id, after, before: before || null, appUrl: 'https://ledger.sgj.luxe/', vapidPublicKey: 'K' });
  let r = await engine.handleDailyItemAdded(ev('a1', I('Buy nappies', { createdByUid: 'abi' })));
  check(sent.length === 1 && sent[0].to === 'magda' && sent[0].p.title === 'Abi added to today’s tasks' && sent[0].p.body === 'Buy nappies' && /home=D/.test(sent[0].p.url),
    'Abi adds to today\'s list: Magda hears "Abi added to today’s tasks"', sent[0]);
  r = await engine.handleDailyItemAdded(ev('a1', I('Buy nappies', { createdByUid: 'abi' })));
  check(r.skipped === 'duplicate' && sent.length === 1, 'once (a retried trigger is not a second message)');
  r = await engine.handleDailyItemAdded(ev('a2', I('My own', { createdByUid: 'magda' })));
  check(r.skipped === 'their own', 'her own task: no message');
  r = await engine.handleDailyItemAdded(ev('a3', I('Carried', { carriedFrom: YESTERDAY })));
  check(r.skipped && sent.length === 1, 'what the day brings (carried, repeating): no message, the morning one says it');
  r = await engine.handleDailyItemAdded(Object.assign(ev('a4', I('Friday thing', { createdByUid: 'abi' })), { requestId: yid }));
  check(r.skipped === 'not today', 'another day\'s list: quiet until its morning', r);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
