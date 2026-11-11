// Ledger — reminders, the server half (functions/remind.js), against the Firestore emulator
// with a fixed clock: a daily reminder comes at its minute, once, on its days, in Shaun's
// timezone; Morning Prime, Wind-down and the sweep stay quiet once done; his own text
// reminders always come; an Action's "Remind me" time comes on its day unless it's done,
// and changing the time re-arms it.
//
//   cd functions && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node ../tests/functions/remind.test.js"

const path = require('path');
const fnDir = path.join(__dirname, '../../functions');
const admin = require(path.join(fnDir, 'node_modules/firebase-admin'));
const { createReminders, localClock } = require(path.join(fnDir, 'remind.js'));
const { createEngine, appLink } = require(path.join(fnDir, 'push.js'));

admin.initializeApp({ projectId: 'demo-ledger' });
const db = admin.firestore();

let passed = 0, failed = 0;
function check(cond, name, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
// Wednesday 11 November 2026; London is on GMT, Dubai four hours ahead
const DAY = '2026-11-11';
let sent = [];
const engine = createEngine({ db, send: async () => ({}), deleteField: () => admin.firestore.FieldValue.delete() });
function rem(iso) {
  return createReminders({
    db, now: () => new Date(iso),
    claim: (id, info) => engine.claimEvent(id, info),
    send: async (uid, payload) => { sent.push(Object.assign({ uid }, payload)); return { sent: 1 }; },
    appLink: (params) => appLink('https://ledger.sgj.luxe/', params)
  });
}
async function run(iso) { sent = []; const out = await rem(iso).run(); return out; }
async function wipe() {
  for (const c of ['ledger_meta', 'ledger_plans', 'ledger_day_status', 'ledger_commitments', 'ledger_push_events', 'ledger_users']) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
}
const cfg = (items, tz) => db.collection('ledger_meta').doc('reminders').set({ tz: tz || 'Europe/London', items });
const WEEKDAYS = [1, 2, 3, 4, 5];

(async () => {
  await wipe();
  check(localClock('Europe/London', new Date('2026-11-11T07:30:00Z')).weekday === 3 && localClock('Asia/Dubai', new Date('2026-11-11T03:30:00Z')).min === 450,
    'the clock: Wednesday in London; 07:30 in Dubai is 03:30 UTC');

  // nobody to remind until there's an owner
  await cfg([{ id: 'prime', kind: 'prime', time: '07:30', days: WEEKDAYS, on: true }]);
  let out = await run('2026-11-11T07:30:20Z');
  check(sent.length === 0, 'no owner: nothing is sent', out);
  await db.collection('ledger_push_events').get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
  await db.collection('ledger_users').doc('shaun').set({ role: 'owner', displayName: 'Shaun' });
  await db.collection('ledger_users').doc('abi').set({ role: 'partner', displayName: 'Abi' });

  // Morning Prime at 07:30 on weekdays
  await run('2026-11-11T07:29:00Z');
  check(sent.length === 0, 'Prime: nothing at 07:29');
  await run('2026-11-11T07:30:05Z');
  check(sent.length === 1 && sent[0].uid === 'shaun' && sent[0].title === 'Morning Prime' && /[?&]open=prime/.test(sent[0].url) && sent[0].kind === 'reminder',
    'Prime: at 07:30, to Shaun only, opening Morning Prime', sent);
  await run('2026-11-11T07:31:00Z');
  check(sent.length === 0, 'Prime: once — not again the next minute');
  // a day it isn't set for
  await cfg([{ id: 'prime', kind: 'prime', time: '07:30', days: [0, 6], on: true }]);
  await run('2026-11-11T07:30:05Z');
  check(sent.length === 0, 'Prime: not on a day it isn\'t set for');

  // already done: quiet
  await db.collection('ledger_push_events').get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
  await cfg([{ id: 'prime', kind: 'prime', time: '07:30', days: [], on: true }]);
  await db.collection('ledger_plans').doc(DAY).set({ morningPrime: { completedAt: '2026-11-11T07:10:00Z' } });
  out = await run('2026-11-11T07:30:05Z');
  check(sent.length === 0 && out.skipped === 1, 'Prime already done: quiet', out);

  // late tick within the grace: still delivered; past it: not
  await db.collection('ledger_plans').doc(DAY).delete();
  await run('2026-11-11T07:39:00Z');
  check(sent.length === 1, 'a tick nine minutes late still delivers it');
  await db.collection('ledger_push_events').get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
  await run('2026-11-11T07:45:00Z');
  check(sent.length === 0, 'fifteen minutes late: let go');

  // switched off
  await cfg([{ id: 'prime', kind: 'prime', time: '07:30', days: [], on: false }]);
  await run('2026-11-11T07:30:05Z');
  check(sent.length === 0, 'switched off: nothing');

  // Wind-down and the sweep: quiet when done, sent when not
  await cfg([
    { id: 'wd', kind: 'windDown', time: '21:00', days: [], on: true },
    { id: 'sw', kind: 'sweep', time: '12:00', days: [], on: true }
  ]);
  await db.collection('ledger_day_status').doc(DAY).set({ draft: true, status: 'partial' });
  await run('2026-11-11T21:00:10Z');
  check(sent.length === 1 && sent[0].title === 'Evening Wind-down' && /open=winddown/.test(sent[0].url), 'Wind-down: a draft review still gets the reminder', sent);
  await db.collection('ledger_push_events').get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
  await db.collection('ledger_day_status').doc(DAY).set({ status: 'completed', caughtUpAt: '2026-11-11T20:40:00Z' });
  await run('2026-11-11T21:00:10Z');
  check(sent.length === 0, 'Wind-down: quiet once the day is reviewed');
  await db.collection('ledger_plans').doc(DAY).set({ sweep: { items: [], sweptAt: '2026-11-11T09:00:00Z' } });
  await run('2026-11-11T12:00:10Z');
  check(sent.length === 0, 'Sweep: quiet once swept');
  await db.collection('ledger_plans').doc(DAY).set({ sweep: { items: [{ id: 'x', name: 'Ben' }] } });
  await run('2026-11-11T12:00:10Z');
  check(sent.length === 1 && sent[0].title === 'Comms sweep' && /open=sweep/.test(sent[0].url), 'Sweep: sent while not yet swept', sent);

  // his own reminder: always sent, his words
  await cfg([{ id: 'c1', kind: 'custom', text: 'Supplements', time: '08:00', days: [], on: true }, { id: 'c2', kind: 'custom', text: '  ', time: '08:00', days: [], on: true }]);
  await run('2026-11-11T08:00:30Z');
  check(sent.length === 1 && sent[0].body === 'Supplements' && /view=today/.test(sent[0].url), 'his own reminder: his words; an empty one is skipped', sent);

  // in his timezone: Dubai's 07:30 is 03:30 UTC
  await db.collection('ledger_push_events').get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
  await cfg([{ id: 'prime', kind: 'prime', time: '07:30', days: [], on: true }], 'Asia/Dubai');
  await run('2026-11-11T07:30:05Z');
  check(sent.length === 0, 'Dubai: nothing at 07:30 London');
  await run('2026-11-11T03:30:05Z');
  check(sent.length === 1, 'Dubai: at 07:30 his time');

  // Actions: "Remind me" on its own day
  await cfg([], 'Europe/London');
  const C = db.collection('ledger_commitments');
  await C.doc('a1').set({ title: 'Call the bank', date: DAY, time: '15:00', remindAt: '14:50', status: 'planned', category: 'personal' });
  await C.doc('a2').set({ title: 'Already done', date: DAY, remindAt: '14:50', status: 'completed', category: 'work' });
  await C.doc('a3').set({ title: 'Tomorrow', date: '2026-11-12', remindAt: '14:50', status: 'planned', category: 'work' });
  await C.doc('a4').set({ title: 'No reminder', date: DAY, status: 'planned', category: 'work' });
  out = await run('2026-11-11T14:50:10Z');
  check(sent.length === 1 && sent[0].body === 'Call the bank · 15:00' && /openAction=a1/.test(sent[0].url) && sent[0].title === 'Reminder',
    'Action: reminded at 14:50, opening it; done ones and other days are not', { sent, out });
  await run('2026-11-11T14:52:00Z');
  check(sent.length === 0, 'Action: once');
  await C.doc('a1').update({ remindAt: '16:00' });
  await run('2026-11-11T16:00:10Z');
  check(sent.length === 1, 'Action: a new time re-arms it');
  // moved to tomorrow: it goes with it
  await C.doc('a3').update({ remindAt: '09:00' });
  await run('2026-11-12T09:00:10Z');
  check(sent.length === 1 && /openAction=a3/.test(sent[0].url), 'Action moved to another day: reminded on that day');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
