// Ledger — Home: recurring responsibilities (functions/recur.js), against the Firestore
// emulator: the schedule maths, generation that is create-if-absent, missed marks, and
// who it is for.
//
//   cd functions && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node ../tests/functions/recur.test.js"

const path = require('path');
const fnDir = path.join(__dirname, '../../functions');
const admin = require(path.join(fnDir, 'node_modules/firebase-admin'));
const { createRecurrer, isDue, nextDue, localNow } = require(path.join(fnDir, 'recur.js'));

admin.initializeApp({ projectId: 'demo-ledger' });
const db = admin.firestore();

let passed = 0, failed = 0;
function check(cond, name, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
let NOW = new Date('2026-10-25T07:30:00Z');            // Sunday, 08:30 in London (BST ends that night)
const rec = createRecurrer({ db, now: () => NOW });
const TPL = 'ledger_home_recurring', REQ = 'ledger_home_requests';
const get = async (p) => { const d = await db.doc(p).get(); return d.exists ? d.data() : null; };

(async () => {
  // ---- the schedule ----
  const S = (o) => Object.assign({ startDate: '2026-10-01', endDate: null, time: null }, o);
  check(isDue(S({ freq: 'daily' }), '2026-10-25') && !isDue(S({ freq: 'daily' }), '2026-09-30'), 'daily: every day from its start, never before');
  check(isDue(S({ freq: 'weekly', days: [0] }), '2026-10-25') && !isDue(S({ freq: 'weekly', days: [0] }), '2026-10-26'), 'weekly on Sunday: the 25th, not the 26th');
  check(isDue(S({ freq: 'weekdays', days: [1, 3, 5] }), '2026-10-28') && !isDue(S({ freq: 'weekdays', days: [1, 3, 5] }), '2026-10-27'), 'chosen days Mon/Wed/Fri: Wednesday yes, Tuesday no');
  check(isDue(S({ freq: 'monthly', monthDay: 31 }), '2026-11-30') && !isDue(S({ freq: 'monthly', monthDay: 31 }), '2026-11-29') && isDue(S({ freq: 'monthly', monthDay: 31 }), '2026-10-31'), 'monthly on the 31st: the last day of a shorter month');
  check(isDue(S({ freq: 'monthly', monthDay: 29 }), '2027-02-28'), 'monthly on the 29th: 28 Feb in a non-leap year');
  check(isDue(S({ freq: 'interval', every: 3 }), '2026-10-04') && !isDue(S({ freq: 'interval', every: 3 }), '2026-10-05') && isDue(S({ freq: 'interval', every: 3 }), '2026-10-31'), 'every 3 days, counted from the start');
  check(!isDue(S({ freq: 'daily', endDate: '2026-10-20' }), '2026-10-21'), 'never after its end');
  check(nextDue(S({ freq: 'weekly', days: [0] }), '2026-10-26') === '2026-11-01' && nextDue(S({ freq: 'weekly', days: [0], endDate: '2026-10-30' }), '2026-10-26') === null, 'next date: the following Sunday; none past its end');
  check(nextDue(S({ freq: 'daily', startDate: '2026-11-05' }), '2026-10-25') === '2026-11-05', 'next date before it starts: its start');
  // timezone: the template's own date and hour
  check(localNow('Europe/London', new Date('2026-10-25T23:30:00Z')).date === '2026-10-25' && localNow('Australia/Sydney', new Date('2026-10-25T23:30:00Z')).date === '2026-10-26', 'the date is the template\'s own: London still the 25th, Sydney already the 26th');
  check(localNow('Not/AZone', new Date('2026-10-25T12:00:00Z')).date === '2026-10-25', 'an unknown timezone falls back safely');

  // ---- Home ----
  for (const [uid, role] of [['shaun', 'owner'], ['abi', 'partner'], ['maria', 'household'], ['ex', 'household']]) await db.doc('ledger_users/' + uid).set({ role });
  const M = (role, status, name) => ({ homeId: 'shaun', role, status, displayName: name });
  await db.doc('ledger_home_members/shaun').set(M('admin', 'active', 'Shaun'));
  await db.doc('ledger_home_members/abi').set(M('admin', 'active', 'Abi'));
  await db.doc('ledger_home_members/maria').set(M('member', 'active', 'Maria'));
  await db.doc('ledger_home_members/ex').set(M('member', 'removed', 'Ex'));
  const T = (o) => Object.assign({ homeId: 'shaun', title: 'School uniform washed, ironed and ready', note: null, createdByUid: 'abi', mode: 'assigned', assigneeUid: 'maria',
    visibility: 'private', timezone: 'Europe/London', checklist: ['Wash', 'Iron', 'Hang up'], status: 'active', createdAt: 'x', updatedAt: 'x',
    schedule: S({ freq: 'weekly', days: [0], startDate: '2026-10-04' }) }, o);
  const tref = db.collection(TPL).doc('uni');
  await tref.set(T());

  // generation: today's one, once, with its checklist
  let r = await rec.runTemplate(tref);
  const occ = await get(REQ + '/uni_20261025');
  check(r.created === 'uni_20261025' && occ && occ.recurringId === 'uni' && occ.occurrenceDate === '2026-10-25' && occ.assigneeUid === 'maria' && occ.requesterUid === 'abi'
    && occ.createdByUid === 'abi' && occ.status === 'requested' && occ.requestedTiming === 'date' && occ.requestedDate === '2026-10-25' && occ.hasChecklist === true
    && JSON.stringify(occ.participants.sort()) === '["abi","maria"]' && occ.visibility === 'private',
    'Sunday: one ordinary request for Maria, from Abi, due today, private to them', occ);
  const items = (await db.collection(REQ + '/uni_20261025/items').get()).docs.map((d) => d.data());
  check(items.length === 3 && items.every((i) => i.done === false && i.createdByUid === 'abi') && items.map((i) => i.text).join() === 'Wash,Iron,Hang up', 'its checklist: three fresh, unticked items');
  const created = await get(REQ + '/uni_20261025/updates/created');
  check(created && created.type === 'created' && created.actorUid === 'abi' && created.metadata.recurring === 'uni', 'its history starts "created", marked recurring');
  r = await rec.runTemplate(tref);
  check(!r.created && (await db.collection(REQ).where('recurringId', '==', 'uni').get()).size === 1, 'run again (a retry, a second tick): nothing new');
  const tpl1 = await get(TPL + '/uni');
  check(tpl1.lastDate === '2026-10-25', 'the template notes the last date it made');

  // not due, too early
  NOW = new Date('2026-10-26T07:30:00Z');
  r = await rec.runTemplate(tref);
  check(r.skipped === 'not due', 'Monday: not due, nothing made');
  const dref = db.collection(TPL).doc('dishes');
  await dref.set(T({ title: 'Empty the dishwasher', checklist: [], schedule: S({ freq: 'daily' }) }));
  NOW = new Date('2026-10-26T05:30:00Z');                // 05:30 in London (GMT now)
  r = await rec.runTemplate(dref);
  check(r.skipped === 'too early', 'the hourly run waits until 06:00 local');
  r = await rec.runTemplate(dref, { anyHour: true });
  check(r.created === 'dishes_20261026', '…but setting one up makes today\'s at once');
  check(!(await get(REQ + '/dishes_20261026')).hasChecklist, 'no checklist, no checklist flag');
  check((await get(REQ + '/uni_20261025')).why === null, 'no reason given, none on the occurrence');
  const wref = db.collection(TPL).doc('why');
  await wref.set(T({ title: 'Bins out', checklist: [], why: 'Collection is at 7am', schedule: S({ freq: 'daily' }) }));
  r = await rec.runTemplate(wref, { anyHour: true });
  check((await get(REQ + '/' + r.created)).why === 'Collection is at 7am', 'each occurrence carries the template\'s "why it matters"');

  // the next one: the previous, still open, becomes missed — never done
  NOW = new Date('2026-10-27T08:00:00Z');
  r = await rec.runTemplate(dref);
  const prev = await get(REQ + '/dishes_20261026');
  check(r.created === 'dishes_20261027' && r.missed === 1 && prev.status === 'missed' && (await get(REQ + '/dishes_20261026/updates/missed')).type === 'missed', 'Tuesday: a new one; Monday\'s, never done, is marked missed (with a history entry)');
  await db.doc(REQ + '/dishes_20261027').update({ status: 'done' });
  NOW = new Date('2026-10-28T08:00:00Z');
  r = await rec.runTemplate(dref);
  check(r.created === 'dishes_20261028' && r.missed === 0 && (await get(REQ + '/dishes_20261027')).status === 'done', 'Wednesday: Tuesday\'s, done, stays done');
  // a deleted occurrence is never made again
  await db.doc(REQ + '/dishes_20261028').update({ deletedAt: 'now', deletedByUid: 'abi' });
  r = await rec.runTemplate(dref, { anyHour: true });
  check(!r.created && (await get(REQ + '/dishes_20261028')).deletedAt === 'now', 'a deleted one is never recreated');
  // no backfill after an outage
  NOW = new Date('2026-10-31T08:00:00Z');
  r = await rec.runTemplate(dref);
  const made = (await db.collection(REQ).where('recurringId', '==', 'dishes').get()).docs.map((d) => d.id).sort();
  check(r.created === 'dishes_20261031' && made.join() === 'dishes_20261026,dishes_20261027,dishes_20261028,dishes_20261031', 'after a gap, only today\'s is made — the missed days aren\'t backfilled', made);

  // paused, ended
  await dref.update({ status: 'paused' });
  NOW = new Date('2026-11-01T08:00:00Z');
  r = await rec.runTemplate(dref);
  check(r.skipped === 'paused' && !(await get(REQ + '/dishes_20261101')), 'paused: nothing made');
  await dref.update({ status: 'active' });
  r = await rec.runTemplate(dref);
  check(r.created === 'dishes_20261101', 'resumed: from the next due date (today), nothing backfilled');
  await dref.update({ status: 'ended' });
  NOW = new Date('2026-11-02T08:00:00Z');
  r = await rec.runTemplate(dref);
  check(r.skipped === 'ended', 'ended: never again');

  // anyone at Home
  const aref = db.collection(TPL).doc('bins');
  await aref.set(T({ title: 'Bins out', mode: 'anyone', assigneeUid: null, visibility: 'home', checklist: [], schedule: S({ freq: 'weekly', days: [1] }) }));
  r = await rec.runTemplate(aref);
  const bin = await get(REQ + '/bins_20261102');
  check(r.created && bin.assigneeUid === null && bin.visibility === 'home' && JSON.stringify(bin.participants) === '["abi"]', 'anyone at Home: unclaimed, shared with everyone, only Abi in it so far');

  // who it is for, checked every time
  const xref = db.collection(TPL).doc('exs');
  await xref.set(T({ title: 'Tidy toys', assigneeUid: 'ex', checklist: [], schedule: S({ freq: 'daily' }) }));
  r = await rec.runTemplate(xref);
  check(r.skipped === 'assignee_removed' && (await get(TPL + '/exs')).blocked === 'assignee_removed' && !(await get(REQ + '/exs_20261102')), 'for someone removed: nothing made; marked "needs someone new"');
  await xref.update({ assigneeUid: 'maria' });
  r = await rec.runTemplate(xref);
  check(r.created === 'exs_20261102' && (await get(TPL + '/exs')).blocked === null, 'given to Maria instead: it runs, and the mark clears');
  const cref = db.collection(TPL).doc('byex');
  await cref.set(T({ title: 'From someone gone', createdByUid: 'ex', checklist: [], schedule: S({ freq: 'daily' }) }));
  r = await rec.runTemplate(cref);
  check(r.skipped === 'creator_removed', 'set up by someone since removed: nothing made');
  await db.doc('ledger_home_members/maria').update({ status: 'removed' });
  NOW = new Date('2026-11-03T08:00:00Z');
  r = await rec.runTemplate(xref);
  check(r.skipped === 'assignee_removed' && !(await get(REQ + '/exs_20261103')), 'Maria removed: nothing more for her');
  await db.doc('ledger_home_members/maria').update({ status: 'active' });

  // the hourly tick: every active template, each once
  NOW = new Date('2026-11-08T08:00:00Z');               // Sunday
  const out = await rec.runAll();
  check(out.created.indexOf('uni_20261108') > -1 && out.created.indexOf('exs_20261108') > -1 && !out.errors.length, 'the hourly tick runs every active template', out);
  const again = await rec.runAll();
  check(again.created.length === 0, '…and running it again makes nothing');
  check((await get(REQ + '/uni_20261025')).status === 'missed', 'last Sunday\'s uniform, never done, is missed now that this Sunday\'s exists');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
