// Ledger — the coach (2026-11-25, Shaun): two small jobs for Claude, on the server.
//
//   1. Why it matters. A new Action gets one short line saying why it's worth doing,
//      suggested by Claude from its title, its goal, its client and Shaun's active goals.
//      It's written as `why` with `whySuggested: true`. Shaun can change or clear it in the
//      Action sheet; a cleared line is `why: ''` and stays cleared. Only a new Action
//      without a why gets one, and never a Prime step, a sweep or someone else's request.
//
//   2. Nudges, only when the day is slipping. Up to three a day, at late morning,
//      mid-afternoon and early evening in his timezone, each only when there's a reason:
//        late morning   Morning Prime isn't done (and wasn't skipped), or nothing is planned;
//        mid-afternoon  a key task hasn't been started, or nothing is done yet;
//        early evening  an Action that has been moved twice or more is still open, or
//                       nothing has been done or logged today.
//      Claude writes each one from the day's facts: kind and specific, one next step,
//      never "failed", "late", "missed", "overdue" or "behind". If Claude can't be
//      reached, a plain line says the same. Quiet during his locked focus block, and off
//      when ledger_meta/reminders.nudges is false (Settings → Reminders).
//
// createCoach({ db, client, now, log, send, claim, appLink })
//   → { suggestWhy(id, action), nudge() }

const { localClock, toMin } = require('./remind');

const MODEL = 'claude-sonnet-5-5';     // the same model as Ask Claude
const COMMITMENTS = 'ledger_commitments';
const WHY_MAX = 120;
const NUDGE_MAX = 200;
const WHY_DAILY_LIMIT = 150;
const WHY_SKIP_SOURCES = ['prime', 'sweep', 'home_request', 'partner_request'];
// the three windows: minutes past midnight, local, and how long after the start a tick may still act
const WINDOWS = [
  { id: 'morning', at: 11 * 60, title: 'Late-morning check-in' },
  { id: 'afternoon', at: 15 * 60, title: 'Afternoon check-in' },
  { id: 'evening', at: 18 * 60, title: 'Evening check-in' }
];
const WINDOW_SPAN = 20;
// words a nudge never uses (Product Principles: missing data is not failure)
const HARSH = /\b(fail(ed|ing|ure)?|late|missed|overdue|behind|lazy|should have)\b/i;

const WHY_SYSTEM = [
  'You write one line for Shaun\'s planner, Ledger: why a task matters to him.',
  'Use what you are given: the task, its goal, its client, his active goals. Connect the task to the',
  'result it serves, concretely. Plain words, no hype, no exclamation marks, no emoji, UK English.',
  'At most 12 words. Start with the reason itself (for example "Keeps the Hill account paid on time"),',
  'not with "This" or "Because". If nothing given says why, give the plain practical reason.',
  'Reply with the line only.'
].join(' ');

const NUDGE_SYSTEM = [
  'You write a short, encouraging nudge from Shaun\'s planner, Ledger, sent as a phone notification.',
  'You are given the facts of his day so far and the reason for this nudge. Be kind and specific:',
  'name the one thing that matters most right now and suggest one small next step he can take in the',
  'next few minutes. Speak to him directly ("you"). One or two short sentences, at most 160 characters.',
  'Never use the words failed, late, missed, overdue, behind or lazy, and never scold or guilt him;',
  'a slow start is information, not a failure. No emoji, no exclamation marks, no greeting, UK English.',
  'Reply with the nudge only.'
].join(' ');

function clean(s, max) {
  let t = String(s == null ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return t;
}

function createCoach(deps) {
  const db = deps.db;
  const client = deps.client;
  const clock = deps.now || (() => new Date());
  const log = deps.log || (() => {});

  async function ask(system, facts, maxTokens) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: JSON.stringify(facts) }]
    });
    if (!response || response.stop_reason === 'refusal') return '';
    const block = (response.content || []).find((b) => b && b.type === 'text');
    return block ? String(block.text || '') : '';
  }

  // ---- 1. why it matters ----
  async function underLimit(date) {
    const ref = db.collection('ledger_assistant_usage').doc('why_' + date);
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const n = s.exists ? Number((s.data() || {}).count) || 0 : 0;
      if (n >= WHY_DAILY_LIMIT) return false;
      tx.set(ref, { count: n + 1, kind: 'why', date }, { merge: true });
      return true;
    });
  }

  async function suggestWhy(id, a) {
    a = a || {};
    if (!id || a.why != null) return { skipped: 'has why' };
    if (!String(a.title || '').trim()) return { skipped: 'no title' };
    if (WHY_SKIP_SOURCES.indexOf(a.sourceType) > -1) return { skipped: 'source' };
    if (a.category === 'roadblock' || a.status === 'completed') return { skipped: 'not needed' };
    if (!(await underLimit(clock().toISOString().slice(0, 10)))) return { skipped: 'limit' };

    const facts = { task: clean(a.title, 300), category: a.category || null };
    if (a.notes) facts.notes = clean(a.notes, 300);
    if (a.minVersion) facts.minimumVersion = clean(a.minVersion, 120);
    const goals = await db.collection('ledger_priorities').limit(60).get();
    const active = goals.docs.map((d) => Object.assign({ id: d.id }, d.data() || {}))
      .filter((p) => p.status !== 'achieved' && p.status !== 'dropped' && p.title);
    const linked = a.priorityId && active.find((p) => p.id === a.priorityId);
    if (linked) facts.goal = clean(linked.title, 160);
    facts.activeGoals = active.slice(0, 10).map((p) => clean(p.title, 120));
    if (a.sj) {
      facts.business = 'Smith & Johnson (his business)';
      for (const [key, sid] of [['client', a.clientId], ['withTeamMember', a.teamId]]) {
        if (!sid) continue;
        const r = await db.collection('ledger_sj').doc(String(sid)).get();
        if (r.exists && (r.data() || {}).name) facts[key] = clean(r.data().name, 80);
      }
    }

    const line = clean(await ask(WHY_SYSTEM, facts, 2000), WHY_MAX);
    if (!line) return { skipped: 'no answer' };
    const ref = db.collection(COMMITMENTS).doc(id);
    // only if it still has none: Shaun may have written or cleared one meanwhile
    const wrote = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists || (s.data() || {}).why != null) return false;
      tx.update(ref, { why: line, whySuggested: true });
      return true;
    });
    return wrote ? { why: line } : { skipped: 'changed meanwhile' };
  }

  // ---- 2. nudges ----
  async function ownerUid() {
    const s = await db.collection('ledger_users').where('role', '==', 'owner').limit(2).get();
    return s.size === 1 ? s.docs[0].id : null;
  }

  // the day so far, in facts Claude (and the fallback) can use
  async function dayFacts(date, nowMin) {
    const [planDoc, acts, sess] = await Promise.all([
      db.collection('ledger_plans').doc(date).get(),
      db.collection(COMMITMENTS).where('date', '==', date).get(),
      db.collection('ledger_sessions').where('date', '==', date).get()
    ]);
    const plan = planDoc.exists ? (planDoc.data() || {}) : {};
    const mp = plan.morningPrime || {};
    const list = acts.docs.map((d) => Object.assign({ id: d.id }, d.data() || {}))
      .filter((c) => c.category !== 'roadblock' && c.status !== 'disrupted' && c.status !== 'not_done');
    const open = list.filter((c) => c.status !== 'completed');
    const done = list.filter((c) => c.status === 'completed');
    const keysUntouched = open.filter((c) => c.isKeyTask && (c.execState || 'not_started') === 'not_started');
    const lagging = open.filter((c) => (Number(c.moveCount) || 0) >= 2)
      .sort((x, y) => (Number(y.moveCount) || 0) - (Number(x.moveCount) || 0));
    const logged = sess.docs.length;
    const fb = plan.focusBlock && toMin(plan.focusBlock.time) != null ? plan.focusBlock : null;
    const inBlock = !!(fb && nowMin >= toMin(fb.time) && nowMin < toMin(fb.time) + (Number(fb.durationMin) || 60));
    return {
      plan, list, open, done, keysUntouched, lagging, logged, fb, inBlock,
      primeOpen: !mp.completedAt && !mp.skippedDay,
      intention: clean(mp.intention || '', 160)
    };
  }

  // why this window should speak, or null when the day is on track
  function reasonFor(win, d) {
    if (win === 'morning') {
      if (d.primeOpen) return { kind: 'prime', text: 'Morning Prime is not done yet today.' };
      if (!d.list.length) return { kind: 'empty', text: 'Nothing is planned for today yet.' };
      return null;
    }
    if (win === 'afternoon') {
      if (d.keysUntouched.length) return { kind: 'keys', text: 'Key tasks not started yet.', action: d.keysUntouched[0] };
      if (d.open.length && !d.done.length) return { kind: 'nothing-done', text: 'Nothing ticked off yet today.', action: d.open[0] };
      return null;
    }
    if (d.lagging.length) return { kind: 'lagging', text: 'An Action has been moved several times and is still open.', action: d.lagging[0] };
    if (!d.done.length && !d.logged) return { kind: 'quiet', text: 'Nothing done or logged today yet.', action: d.open[0] };
    return null;
  }

  function fallback(reason) {
    const t = reason.action ? clean(reason.action.title, 60) : '';
    if (reason.kind === 'prime') return 'A few minutes on Morning Prime sets up the rest of the day. Start with the first step.';
    if (reason.kind === 'empty') return 'Nothing planned yet. Add the one thing that would make today count.';
    if (reason.kind === 'keys') return t ? 'Still time for “' + t + '”. Give it 15 minutes now and see where it goes.' : 'Pick one key task and give it 15 minutes now.';
    if (reason.kind === 'lagging') return t ? '“' + t + '” keeps moving. Do the smallest first step of it this evening, or decide to let it go.' : 'One Action keeps moving. Take its smallest first step, or let it go.';
    return t ? 'One small thing before the evening: “' + t + '”. Ten minutes is enough to start.' : 'One small thing before the evening. Ten minutes is enough to start.';
  }

  async function nudge() {
    const out = { sent: 0, skipped: 0, errors: [] };
    const cfgDoc = await db.collection('ledger_meta').doc('reminders').get();
    const cfg = cfgDoc.exists ? (cfgDoc.data() || {}) : {};
    if (cfg.nudges === false) return Object.assign(out, { off: true });
    const c = localClock(cfg.tz, clock());
    const win = WINDOWS.find((w) => c.min >= w.at && c.min < w.at + WINDOW_SPAN);
    if (!win) return out;
    try {
      const d = await dayFacts(c.date, c.min);
      if (d.inBlock) { out.skipped++; return Object.assign(out, { window: win.id, quiet: 'focus block' }); }
      const reason = reasonFor(win.id, d);
      if (!reason) { out.skipped++; return Object.assign(out, { window: win.id, onTrack: true }); }
      const uid = await ownerUid();
      if (!uid) { out.skipped++; return out; }
      const eventId = 'nudge_' + win.id + '_' + c.date;
      if (!(await deps.claim(eventId, { recipientUid: uid, kind: 'nudge', window: win.id, reason: reason.kind }))) { out.skipped++; return out; }

      const facts = {
        timeNow: String(Math.floor(c.min / 60)).padStart(2, '0') + ':' + String(c.min % 60).padStart(2, '0'),
        moment: win.title, reason: reason.text,
        morningPrimeDone: !d.primeOpen, intention: d.intention || null,
        actionsPlanned: d.list.length, actionsDone: d.done.length, thingsLogged: d.logged,
        keyTasksNotStarted: d.keysUntouched.slice(0, 3).map((x) => clean(x.title, 100)),
        stillOpen: d.open.slice(0, 6).map((x) => ({ title: clean(x.title, 100), why: x.why ? clean(x.why, 120) : null,
          timesMoved: Number(x.moveCount) || 0, keyTask: !!x.isKeyTask }))
      };
      if (reason.action) facts.focusOn = { title: clean(reason.action.title, 100), why: reason.action.why ? clean(reason.action.why, 120) : null,
        timesMoved: Number(reason.action.moveCount) || 0 };
      let body = '';
      try { body = clean(await ask(NUDGE_SYSTEM, facts, 2000), NUDGE_MAX); } catch (e) { log('nudge: Claude', e && e.message); }
      if (!body || HARSH.test(body)) body = fallback(reason);

      const url = reason.kind === 'prime' ? deps.appLink({ open: 'prime' })
        : reason.action ? deps.appLink({ openAction: reason.action.id }) : deps.appLink({ view: 'today' });
      await deps.send(uid, { title: win.title, body, url, tag: 'ledger-nudge', renotify: true, kind: 'nudge' });
      // a record of what was said (server-only, like ledger_sync): one document a day
      await db.collection('ledger_nudges').doc(c.date).set({ [win.id]: { at: clock().toISOString(), reason: reason.kind, body } }, { merge: true });
      out.sent++;
      return Object.assign(out, { window: win.id, reason: reason.kind, body });
    } catch (e) {
      out.errors.push(win.id + ': ' + (e && e.message));
      log('nudge', out);
      return out;
    }
  }

  return { suggestWhy, nudge, reasonFor };
}

module.exports = { createCoach, WINDOWS, HARSH, MODEL };
