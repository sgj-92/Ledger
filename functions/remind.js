// Ledger — reminders (2026-11-11). Every minute, in Shaun's own timezone:
//
//   1. his daily reminders (ledger_meta/reminders → items): Morning Prime, Evening
//      Wind-down, the Comms sweep, and his own text reminders, each at a time on chosen
//      days. Morning Prime, Wind-down and the sweep stay quiet once they're done that day.
//   2. a "Remind me" time on an Action (remindAt "HH:MM" on its own date), unless it's
//      done by then. Moving the Action to another day moves the reminder with it.
//
// A reminder fires once: from its minute until REMIND_GRACE_MIN later (a late or skipped
// tick still delivers it), never twice — each is claimed as a push event first. Changing
// an Action's time re-arms it. The Admin SDK is not subject to the security rules: the
// recipient is the one user whose role is owner, checked here.
//
// ledger_meta/reminders = { tz: 'Europe/London', items: [{ id, kind: 'prime' | 'windDown'
//   | 'sweep' | 'custom', text, time: 'HH:MM', days: [0..6] (0 = Sunday), on }] }

const REMIND_GRACE_MIN = 10;
const KINDS = ['prime', 'windDown', 'sweep', 'custom', 'reviewBusiness', 'reviewPersonal'];
// The weekly reviews' prompts (docs/GOALS_AND_REVIEW.md §8, q. 1): on unless he changes
// them in Settings → Reminders, and quiet once that week's review is approved.
const REVIEW_DEFAULTS = [
  { id: 'reviewBusiness', kind: 'reviewBusiness', time: '15:00', days: [5], on: true },
  { id: 'reviewPersonal', kind: 'reviewPersonal', time: '17:00', days: [0], on: true }
];
const TEXT = {
  prime: { title: 'Morning Prime', body: 'Set up the day: plan, move, and one line of intention.', open: 'prime' },
  windDown: { title: 'Evening Wind-down', body: 'Review today and set up tomorrow.', open: 'winddown' },
  sweep: { title: 'Comms sweep', body: 'Go through your channels: who needs a reply?', open: 'sweep' },
  reviewBusiness: { title: 'Friday review', body: 'How did the business week go? A few minutes.', open: 'review-business' },
  reviewPersonal: { title: 'Sunday review', body: 'Look back on the week, then set up the next one.', open: 'review-personal' }
};
function addDaysIso(date, n) {
  const [y, m, d] = String(date).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

// the date, minutes past midnight and weekday where he is
function localClock(timezone, now) {
  let tz = timezone;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch (e) { tz = 'Europe/London'; }
  if (!tz) tz = 'Europe/London';
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(now).forEach((p) => { parts[p.type] = p.value; });
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { tz, date: parts.year + '-' + parts.month + '-' + parts.day, min: Number(parts.hour) * 60 + Number(parts.minute), weekday: wd };
}
function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
// due now: its minute has come, and not more than the grace period ago
function dueNow(time, clock) {
  const t = toMin(time);
  return t != null && clock.min >= t && clock.min - t <= REMIND_GRACE_MIN;
}

function createReminders(deps) {
  const db = deps.db;
  const clock = deps.now || (() => new Date());
  const log = deps.log || (() => {});
  const send = deps.send;              // async (uid, payload) => result
  const claim = deps.claim;            // async (eventId, info) => boolean
  const appLink = deps.appLink;        // (params) => url

  async function ownerUid() {
    const s = await db.collection('ledger_users').where('role', '==', 'owner').limit(2).get();
    return s.size === 1 ? s.docs[0].id : null;    // one owner, or nobody to remind
  }
  async function done(kind, date) {
    if (kind === 'prime' || kind === 'sweep') {
      const p = await db.collection('ledger_plans').doc(date).get();
      const d = p.exists ? (p.data() || {}) : {};
      return kind === 'prime' ? !!(d.morningPrime && d.morningPrime.completedAt) : !!(d.sweep && d.sweep.sweptAt);
    }
    if (kind === 'reviewBusiness' || kind === 'reviewPersonal') {
      // the week it covers, on his week-start setting; a Sunday review in a week that starts on Sunday looks back
      const p = await db.collection('ledger_meta').doc('presets').get();
      const startDow = p.exists && (p.data() || {}).weekStartsOn === 'sunday' ? 0 : 1;
      const dowOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
      const startOf = (d) => addDaysIso(d, -((dowOf(d) - startDow + 7) % 7));
      let ws = startOf(date);
      if (kind === 'reviewPersonal' && ws === date && dowOf(date) === 0) ws = startOf(addDaysIso(date, -1));
      const w = await db.collection('ledger_weeks').doc(ws).get();
      const area = kind === 'reviewBusiness' ? 'business' : 'personal';
      const r = w.exists ? (((w.data() || {}).reviews || {})[area]) : null;
      return !!(r && r.at);
    }
    if (kind === 'windDown') {
      const r = await db.collection('ledger_day_status').doc(date).get();
      const d = r.exists ? (r.data() || {}) : null;
      if (!d) return false;
      if (d.windDown && d.windDown.completedAt) return true;
      return !d.draft && !!(d.caughtUpAt || d.status);
    }
    return false;
  }

  async function run() {
    const out = { sent: 0, skipped: 0, errors: [] };
    const cfgDoc = await db.collection('ledger_meta').doc('reminders').get();
    const cfg = cfgDoc.exists ? (cfgDoc.data() || {}) : {};
    const c = localClock(cfg.tz, clock());
    let uid;          // looked up only when something is due

    async function deliver(eventId, info, payload) {
      if (uid === undefined) uid = await ownerUid();
      if (!uid) { out.skipped++; return; }
      if (!(await claim(eventId, Object.assign({ recipientUid: uid }, info)))) { out.skipped++; return; }
      try { await send(uid, payload); out.sent++; } catch (e) { out.errors.push(eventId + ': ' + (e && e.message)); }
    }

    // 1. the daily reminders
    const items = (Array.isArray(cfg.items) ? cfg.items : []).slice();
    REVIEW_DEFAULTS.forEach((d) => { if (!items.some((x) => x && x.kind === d.kind)) items.push(d); });
    for (const it of items) {
      try {
        if (!it || it.on === false || KINDS.indexOf(it.kind) === -1 || !it.id) continue;
        if (Array.isArray(it.days) && it.days.length && it.days.indexOf(c.weekday) === -1) continue;
        if (!dueNow(it.time, c)) continue;
        if (it.kind !== 'custom' && (await done(it.kind, c.date))) { out.skipped++; continue; }
        const t = TEXT[it.kind];
        const text = String(it.text || '').trim();
        if (it.kind === 'custom' && !text) continue;
        await deliver('reminder_' + String(it.id).slice(0, 60) + '_' + c.date, { kind: 'reminder', reminder: it.kind }, {
          title: t ? t.title : 'Reminder',
          body: t ? t.body : text.slice(0, 200),
          url: appLink(t ? { open: t.open } : { view: 'today' }),
          tag: 'ledger-reminder-' + String(it.id).slice(0, 40), renotify: true, kind: 'reminder'
        });
      } catch (e) { out.errors.push('item ' + (it && it.id) + ': ' + (e && e.message)); }
    }

    // 2. Actions with a "Remind me" time today
    try {
      const snap = await db.collection('ledger_commitments').where('date', '==', c.date).where('remindAt', '>', '').get();
      for (const doc of snap.docs) {
        const a = doc.data() || {};
        if (!dueNow(a.remindAt, c)) continue;
        if (a.status === 'completed' || a.category === 'roadblock') { out.skipped++; continue; }
        const when = /^\d{1,2}:\d{2}$/.test(String(a.time || '')) ? ' · ' + a.time : '';
        await deliver('remind_a_' + doc.id + '_' + c.date + '_' + String(a.remindAt).replace(':', ''), { kind: 'reminder', reminder: 'action', actionId: doc.id }, {
          title: 'Reminder',
          body: String(a.title || 'An Action').slice(0, 180) + when,
          url: appLink({ openAction: doc.id }),
          tag: 'ledger-reminder-a-' + doc.id, renotify: true, kind: 'reminder'
        });
      }
    } catch (e) { out.errors.push('actions: ' + (e && e.message)); }

    if (out.errors.length) log('reminders', out);
    return Object.assign(out, { date: c.date, min: c.min, tz: c.tz });
  }

  return { run };
}

module.exports = { createReminders, localClock, dueNow, toMin, REMIND_GRACE_MIN };
