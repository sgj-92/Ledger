// Ledger — the coach (functions/coach.js), against the Firestore emulator with a stand-in
// Claude: a new Action gets a short "why it matters" line, once, and never over one Shaun
// wrote or cleared; nudges come only when the day is slipping, at most once per window,
// kind (never "failed", "late", "missed"…), quiet in the focus block and when switched off.
//
//   cd functions && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node ../tests/functions/coach.test.js"

const path = require('path');
const fnDir = path.join(__dirname, '../../functions');
const admin = require(path.join(fnDir, 'node_modules/firebase-admin'));
const { createCoach, HARSH } = require(path.join(fnDir, 'coach.js'));
const { createEngine, appLink } = require(path.join(fnDir, 'push.js'));

admin.initializeApp({ projectId: 'demo-ledger' });
const db = admin.firestore();

let passed = 0, failed = 0;
function check(cond, name, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
const DAY = '2026-11-11';            // a Wednesday; London is on GMT
let calls = [], reply = 'Keeps the Hill account paid on time', sent = [], fail = false;
const client = { beta: { messages: { create: async (req) => {
  calls.push(req);
  if (fail) { const e = new Error('overloaded'); e.status = 529; throw e; }
  return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof reply === 'function' ? reply(req) : reply }] };
} } } };
const engine = createEngine({ db, send: async () => ({}), deleteField: () => admin.firestore.FieldValue.delete() });
function coach(iso) {
  return createCoach({
    db, client, now: () => new Date(iso || DAY + 'T09:00:00Z'),
    claim: (id, info) => engine.claimEvent(id, info),
    send: async (uid, payload) => { sent.push(Object.assign({ uid }, payload)); return { sent: 1 }; },
    appLink: (params) => appLink('https://ledger.sgj.luxe/', params)
  });
}
async function wipe() {
  for (const c of ['ledger_meta', 'ledger_plans', 'ledger_commitments', 'ledger_sessions', 'ledger_push_events', 'ledger_users',
    'ledger_priorities', 'ledger_sj', 'ledger_assistant_usage', 'ledger_nudges']) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
}
async function clearEvents() { const s = await db.collection('ledger_push_events').get(); await Promise.all(s.docs.map((d) => d.ref.delete())); }
async function nudgeAt(iso) { sent = []; calls = []; return coach(iso).nudge(); }

(async () => {
  await wipe();

  // ---- why it matters ----
  await db.collection('ledger_priorities').doc('g1').set({ title: 'Grow S&J to six clients', status: 'active' });
  await db.collection('ledger_priorities').doc('g2').set({ title: 'Old goal', status: 'dropped' });
  await db.collection('ledger_sj').doc('c1').set({ kind: 'client', name: 'Hill & Co' });
  const a1 = { title: 'Send the Hill invoice', date: DAY, status: 'planned', category: 'work', priorityId: 'g1', sj: true, clientId: 'c1' };
  await db.collection('ledger_commitments').doc('a1').set(a1);
  reply = '"Keeps the Hill account paid on time"';
  let out = await coach().suggestWhy('a1', a1);
  let rec = (await db.collection('ledger_commitments').doc('a1').get()).data();
  check(rec.why === 'Keeps the Hill account paid on time' && rec.whySuggested === true, 'why: written, unquoted, marked as suggested', { out, rec });
  const facts = JSON.parse(calls[0].messages[0].content);
  check(facts.task === 'Send the Hill invoice' && facts.goal === 'Grow S&J to six clients' && facts.client === 'Hill & Co' &&
    facts.activeGoals.indexOf('Old goal') === -1, 'why: Claude is told the task, its goal, its client and only the active goals', facts);
  check(calls[0].model === 'claude-sonnet-5-5' && calls[0].output_config.effort === 'low' && !calls[0].thinking && typeof calls[0].system === 'string',
    'why: the model, low effort, a fixed system prompt', calls[0]);

  calls = [];
  out = await coach().suggestWhy('a1', rec);
  check(calls.length === 0 && out.skipped, 'why: an Action that has one is left alone');
  const a2 = { title: 'Pay the nanny', date: DAY, status: 'planned', why: '' };
  await db.collection('ledger_commitments').doc('a2').set(a2);
  out = await coach().suggestWhy('a2', a2);
  check(calls.length === 0 && (await db.collection('ledger_commitments').doc('a2').get()).data().why === '', 'why: one Shaun cleared stays cleared');
  for (const src of ['prime', 'sweep', 'home_request', 'partner_request']) {
    out = await coach().suggestWhy('x', { title: 'x', sourceType: src });
    check(out.skipped === 'source' && calls.length === 0, 'why: none for a ' + src + ' Action');
  }
  // written meanwhile: Claude's line doesn't replace his
  const a3 = { title: 'Book the MOT', date: DAY, status: 'planned' };
  await db.collection('ledger_commitments').doc('a3').set(a3);
  reply = () => { db.collection('ledger_commitments').doc('a3').update({ why: 'Mine' }); return 'Keeps the car legal'; };
  await new Promise((r) => setTimeout(r, 10));
  out = await coach().suggestWhy('a3', a3);
  await new Promise((r) => setTimeout(r, 200));
  rec = (await db.collection('ledger_commitments').doc('a3').get()).data();
  check(rec.why === 'Mine' && !rec.whySuggested, 'why: one he wrote while Claude was thinking is kept', rec);
  // long, or with markup
  reply = 'Keeps <b>everything</b> moving so that the quarter ends with the proposal signed and the new client onboarded properly and on schedule';
  const a4 = { title: 'Draft the proposal', date: DAY, status: 'planned' };
  await db.collection('ledger_commitments').doc('a4').set(a4);
  await coach().suggestWhy('a4', a4);
  rec = (await db.collection('ledger_commitments').doc('a4').get()).data();
  check(rec.why.length <= 120 && !/[<>]/.test(rec.why), 'why: short, and never markup', rec.why);
  // Claude unreachable: nothing written, nothing thrown at the trigger's caller
  fail = true;
  const a5 = { title: 'Renew insurance', date: DAY, status: 'planned' };
  await db.collection('ledger_commitments').doc('a5').set(a5);
  let threw = false;
  try { await coach().suggestWhy('a5', a5); } catch (e) { threw = true; }
  check(threw && (await db.collection('ledger_commitments').doc('a5').get()).data().why === undefined, 'why: Claude unreachable — no line (the trigger logs it)');
  fail = false;

  // ---- nudges ----
  await db.collection('ledger_users').doc('shaun').set({ role: 'owner' });
  await db.collection('ledger_meta').doc('reminders').set({ tz: 'Europe/London', items: [] });
  const wipeDay = async () => { for (const c of ['ledger_commitments', 'ledger_plans', 'ledger_sessions', 'ledger_nudges']) { const s = await db.collection(c).get(); await Promise.all(s.docs.map((d) => d.ref.delete())); } };
  await wipeDay();
  reply = 'A few minutes on Morning Prime now sets up the afternoon. Start with your intention.';

  out = await nudgeAt(DAY + 'T10:30:00Z');
  check(sent.length === 0 && calls.length === 0, 'nudge: nothing outside the three windows', out);
  out = await nudgeAt(DAY + 'T11:05:00Z');
  check(sent.length === 1 && sent[0].title === 'Late-morning check-in' && /Morning Prime/.test(sent[0].body) && /open=prime/.test(sent[0].url) && sent[0].kind === 'nudge',
    'nudge, late morning: Prime not done — a kind line that opens Prime', sent);
  const nf = JSON.parse(calls[0].messages[0].content);
  check(nf.reason && nf.morningPrimeDone === false && nf.timeNow === '11:05', 'nudge: Claude is given the day\'s facts', nf);
  out = await nudgeAt(DAY + 'T11:15:00Z');
  check(sent.length === 0 && calls.length === 0, 'nudge: once per window');
  const log = (await db.collection('ledger_nudges').doc(DAY).get()).data();
  check(log && log.morning && log.morning.reason === 'prime', 'nudge: what was said is kept (server-only)', log);

  // on track: Prime done, Actions planned → nothing
  await clearEvents(); await wipeDay();
  await db.collection('ledger_plans').doc(DAY).set({ morningPrime: { completedAt: DAY + 'T07:40:00Z' } });
  await db.collection('ledger_commitments').doc('k1').set({ title: 'Hill proposal', date: DAY, status: 'planned', isKeyTask: true, why: 'Wins the Hill contract' });
  out = await nudgeAt(DAY + 'T11:05:00Z');
  check(sent.length === 0 && calls.length === 0 && out.onTrack, 'nudge: on track in the morning — quiet', out);
  // Prime skipped for the day counts as dealt with
  await db.collection('ledger_plans').doc(DAY).set({ morningPrime: { skippedDay: { at: 'x' }, completedAt: null } });
  out = await nudgeAt(DAY + 'T11:06:00Z');
  check(sent.length === 0, 'nudge: Prime skipped for today is not a reason');

  // afternoon: a key task not started
  reply = 'There is still time for the Hill proposal. Give it 20 minutes now.';
  out = await nudgeAt(DAY + 'T15:02:00Z');
  check(sent.length === 1 && sent[0].title === 'Afternoon check-in' && /openAction=k1/.test(sent[0].url), 'nudge, afternoon: a key task not started — opens it', sent);
  const af = JSON.parse(calls[0].messages[0].content);
  check(af.focusOn && af.focusOn.title === 'Hill proposal' && af.focusOn.why === 'Wins the Hill contract', 'nudge: names the task and its why', af);
  // started → on track
  await clearEvents();
  await db.collection('ledger_commitments').doc('k1').set({ execState: 'in_progress' }, { merge: true });
  await db.collection('ledger_commitments').doc('d1').set({ title: 'Reply to Tom', date: DAY, status: 'completed' });
  out = await nudgeAt(DAY + 'T15:03:00Z');
  check(sent.length === 0, 'nudge: a key task under way — quiet', out);

  // evening: an Action moved twice or more, still open
  await db.collection('ledger_commitments').doc('m1').set({ title: 'Call the accountant', date: DAY, status: 'planned', moveCount: 3 });
  reply = 'You failed to call the accountant again.';           // harsh — replaced
  out = await nudgeAt(DAY + 'T18:01:00Z');
  check(sent.length === 1 && sent[0].title === 'Evening check-in' && /Call the accountant/.test(sent[0].body) && !HARSH.test(sent[0].body) && /openAction=m1/.test(sent[0].url),
    'nudge, evening: an Action that keeps moving — and a harsh line is never sent', sent);

  // the focus block is protected
  await clearEvents();
  await db.collection('ledger_plans').doc(DAY).set({ focusBlock: { time: '17:30', durationMin: 60, actionId: 'm1' } }, { merge: true });
  out = await nudgeAt(DAY + 'T18:05:00Z');
  check(sent.length === 0 && out.quiet === 'focus block', 'nudge: quiet during the focus block', out);
  await db.collection('ledger_plans').doc(DAY).set({ focusBlock: null }, { merge: true });

  // Claude unreachable: the plain line goes instead
  fail = true;
  out = await nudgeAt(DAY + 'T18:06:00Z');
  check(sent.length === 1 && /Call the accountant/.test(sent[0].body), 'nudge: Claude unreachable — a plain line instead', sent);
  fail = false;

  // nothing done or logged by the evening
  await clearEvents(); await wipeDay();
  await db.collection('ledger_commitments').doc('q1').set({ title: 'Gym', date: DAY, status: 'planned' });
  reply = 'One small thing before the evening ends: ten minutes on the gym bag.';
  out = await nudgeAt(DAY + 'T18:01:00Z');
  check(sent.length === 1 && out.reason === 'quiet', 'nudge, evening: nothing done or logged yet', out);
  await clearEvents();
  await db.collection('ledger_sessions').doc('s1').set({ type: 'weight', date: DAY, weightKg: 80 });
  out = await nudgeAt(DAY + 'T18:02:00Z');
  check(sent.length === 0, 'nudge: something logged — quiet', out);

  // switched off
  await clearEvents();
  await db.collection('ledger_sessions').doc('s1').delete();
  await db.collection('ledger_meta').doc('reminders').set({ nudges: false }, { merge: true });
  out = await nudgeAt(DAY + 'T18:03:00Z');
  check(sent.length === 0 && out.off, 'nudge: switched off in Settings — nothing', out);
  // Dubai: its own evening
  await db.collection('ledger_meta').doc('reminders').set({ nudges: true, tz: 'Asia/Dubai' }, { merge: true });
  out = await nudgeAt(DAY + 'T14:05:00Z');     // 18:05 in Dubai
  check(sent.length === 1 && sent[0].title === 'Evening check-in', 'nudge: in his own timezone', out);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
