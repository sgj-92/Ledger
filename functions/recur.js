// Ledger — Home: recurring responsibilities (docs/HOME_RECURRENCE.md).
//
// A template (ledger_home_recurring/{tid}) says what repeats and for whom. On each due
// date this creates ONE ordinary Home request from it — the occurrence — under the
// deterministic id `${tid}_${YYYYMMDD}`, so generation is create-if-absent: a retry, a
// second run, or the template trigger racing the hourly tick can never make two, and a
// deleted occurrence (kept, soft-deleted) is never made again. Only today's occurrence is
// ever created; future ones are computed for display, never stored. Missed days are not
// backfilled; the previous occurrence, if still open, is marked `missed` (never done).
//
// The Admin SDK is not subject to the security rules, so everything relied on is checked
// here: the template's status and dates, and that its creator and (if named) its assignee
// are still active members of its Home.

const TPL = 'ledger_home_recurring';
const REQ = 'ledger_home_requests';
const MEMBERS = 'ledger_home_members';
const OPEN = ['requested', 'planned', 'in_progress'];

function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
function parse(s) { const [y, m, d] = String(s).split('-').map(Number); return { y, m, d }; }
// day arithmetic on calendar dates, free of any timezone
function toDays(s) { const p = parse(s); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000); }
function fromDays(n) { const t = new Date(n * 86400000); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
function weekday(s) { return new Date(toDays(s) * 86400000).getUTCDay(); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

// The template's own "now": its local date and hour, in its timezone.
function localNow(timezone, now) {
  let tz = timezone;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch (e) { tz = 'Europe/London'; }
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).forEach((p) => { parts[p.type] = p.value; });
  return { date: parts.year + '-' + parts.month + '-' + parts.day, hour: Number(parts.hour) };
}

// Is this date one the schedule falls on?
function isDue(sc, date) {
  if (!sc || !sc.startDate || date < sc.startDate) return false;
  if (sc.endDate && date > sc.endDate) return false;
  const wd = weekday(date);
  if (sc.freq === 'daily') return true;
  if (sc.freq === 'weekdays') return Array.isArray(sc.days) && sc.days.indexOf(wd) > -1;
  if (sc.freq === 'weekly') return Array.isArray(sc.days) && sc.days[0] === wd;
  if (sc.freq === 'monthly') {
    const p = parse(date), want = Math.min(Number(sc.monthDay) || 1, daysInMonth(p.y, p.m));
    return p.d === want;
  }
  if (sc.freq === 'interval') {
    const every = Math.max(2, Math.min(365, Number(sc.every) || 2));
    return (toDays(date) - toDays(sc.startDate)) % every === 0;
  }
  return false;
}
// The next due date on or after `from` (within a year), or null.
function nextDue(sc, from) {
  if (!sc || !sc.startDate) return null;
  let n = toDays(from > sc.startDate ? from : sc.startDate);
  for (let i = 0; i < 400; i++, n++) {
    const d = fromDays(n);
    if (sc.endDate && d > sc.endDate) return null;
    if (isDue(sc, d)) return d;
  }
  return null;
}

function createRecurrer(deps) {
  const db = deps.db;
  const clock = deps.now || (() => new Date());
  const serverTime = deps.serverTime || (() => new Date());
  const log = deps.log || (() => {});

  async function activeMember(uid, homeId) {
    if (!uid || typeof uid !== 'string') return null;
    const d = await db.collection(MEMBERS).doc(uid).get();
    const m = d.exists ? d.data() || {} : null;
    return m && m.homeId === homeId && m.status === 'active' ? m : null;
  }

  // Runs one template. opts.anyHour: on the template's own write, don't wait for 06:00.
  async function runTemplate(ref, opts) {
    opts = opts || {};
    const snap = await ref.get();
    if (!snap.exists) return { skipped: 'gone' };
    const t = snap.data() || {};
    const tid = snap.id;
    if (t.status !== 'active') return { skipped: t.status || 'inactive' };
    const local = localNow(t.timezone, clock());
    const nowIso = clock().toISOString();
    // who it is for, checked every time
    let blocked = null;
    if (!(await activeMember(t.createdByUid, t.homeId))) blocked = 'creator_removed';
    else if (t.mode === 'assigned' && !(await activeMember(t.assigneeUid, t.homeId))) blocked = 'assignee_removed';
    else if (t.mode !== 'assigned' && t.mode !== 'anyone') blocked = 'invalid';
    if ((t.blocked || null) !== blocked) await ref.update({ blocked, lastRunAt: nowIso });
    if (blocked) return { skipped: blocked };
    const date = local.date;
    if (!isDue(t.schedule, date)) return { skipped: 'not due' };
    if (!opts.anyHour && local.hour < 6) return { skipped: 'too early' };
    const occId = tid + '_' + date.replace(/-/g, '');
    const occRef = db.collection(REQ).doc(occId);
    const anyone = t.mode === 'anyone';
    const participants = anyone ? [t.createdByUid] : Array.from(new Set([t.createdByUid, t.assigneeUid]));
    const items = (Array.isArray(t.checklist) ? t.checklist : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 40);
    const occ = {
      homeId: t.homeId, text: String(t.title || '').slice(0, 280), note: t.note ? String(t.note).slice(0, 500) : null,
      why: t.why ? String(t.why).slice(0, 300) : null,
      requestedTiming: 'date', requestedDate: date, requestedTime: (t.schedule && t.schedule.time) || null,
      requesterUid: t.createdByUid, assigneeUid: anyone ? null : t.assigneeUid, createdByUid: t.createdByUid,
      participants, visibility: anyone ? 'home' : (t.visibility === 'home' ? 'home' : 'private'),
      status: 'requested', plannedDate: null, linkedActionId: null,
      recurringId: tid, occurrenceDate: date,
      createdAt: nowIso, updatedAt: nowIso, latestUpdateAt: nowIso, latestUpdateByUid: t.createdByUid, latestUpdateType: 'created', readAt: {}
    };
    if (items.length) occ.hasChecklist = true;
    let created = false;
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(occRef);
      if (cur.exists) return;                       // already made (or made and deleted): never again
      tx.create(occRef, occ);
      tx.create(occRef.collection('updates').doc('created'), { type: 'created', actorUid: t.createdByUid, text: null, createdAt: serverTime(),
        metadata: { recurring: tid, occurrence: date, mode: t.mode } });
      items.forEach((text, i) => tx.create(occRef.collection('items').doc('t' + i), {
        text: text.slice(0, 200), done: false, order: i + 1, createdByUid: t.createdByUid, createdAt: nowIso,
        doneByUid: null, doneAt: null, updatedByUid: t.createdByUid, updatedAt: nowIso }));
      tx.update(ref, { lastDate: date, lastRunAt: nowIso });
      created = true;
    });
    // the one before, still open, is now missed — never done
    let missed = 0;
    if (created) {
      const prev = await db.collection(REQ).where('recurringId', '==', tid).get();
      for (const d of prev.docs) {
        const r = d.data() || {};
        if (d.id === occId || r.deletedAt || !(r.occurrenceDate < date) || OPEN.indexOf(r.status) === -1) continue;
        await db.runTransaction(async (tx) => {
          const c = await tx.get(d.ref);
          const cr = c.data() || {};
          if (cr.deletedAt || OPEN.indexOf(cr.status) === -1) return;
          tx.update(d.ref, { status: 'missed', updatedAt: nowIso, latestUpdateAt: nowIso, latestUpdateByUid: cr.createdByUid, latestUpdateType: 'missed' });
          tx.create(d.ref.collection('updates').doc('missed'), { type: 'missed', actorUid: cr.createdByUid, text: null, createdAt: serverTime(), metadata: { next: date } });
          missed++;
        }).catch((e) => log('missed mark failed', d.id, e && e.message));
      }
    }
    return { created: created ? occId : null, missed };
  }

  async function runAll() {
    const all = await db.collection(TPL).where('status', '==', 'active').get();
    const out = { templates: all.size, created: [], skipped: 0, errors: [] };
    for (const d of all.docs) {
      try {
        const r = await runTemplate(d.ref);
        if (r.created) out.created.push(r.created); else out.skipped++;
      } catch (e) { out.errors.push(d.id + ': ' + ((e && e.message) || e)); }
    }
    return out;
  }

  return { runTemplate, runAll };
}

module.exports = { createRecurrer, isDue, nextDue, localNow };
