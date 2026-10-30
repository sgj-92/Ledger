// Ledger — Home: daily tasks (docs/HOME_DAILY.md).
//
// A person's daily tasks are switched on by an admin (ledger_home_daily/{uid}): one list a
// day, the ordinary request `D{uid}{YYYYMMDD}` (kind 'daily'), with the tasks that repeat
// in ledger_home_daily/{uid}/repeats. Each hour, for each person, in their own timezone:
//
//   1. once a day, anything left unticked on an earlier day's list (up to 14 days back)
//      moves onto today's, marked with the day it came from;
//   2. the repeating tasks due today are added, each once (a task removed today stays
//      removed: the list remembers which it has had, in `repeatsAdded`);
//   3. at the morning time chosen, one notification: what's on today's list.
//
// Every write is keyed (`c{item id}` for a carried task, `r{repeat}{day}` for a repeating
// one), so a retry or a second run never doubles anything. The Admin SDK is not subject to
// the security rules: who it is for, and that they are still at Home, is checked here.

const { isDue, localNow } = require('./recur');

const DAILY = 'ledger_home_daily';
const REQ = 'ledger_home_requests';
const MEMBERS = 'ledger_home_members';
const LOOKBACK_DAYS = 14;

function listId(uid, date) { return 'D' + uid + String(date).replace(/-/g, ''); }
function addDays(date, n) {
  const [y, m, d] = String(date).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
}

function createDaily(deps) {
  const db = deps.db;
  const clock = deps.now || (() => new Date());
  const log = deps.log || (() => {});
  const notify = deps.notify || null;          // async (uid, { title, body, listId, homeId }) => result

  async function activeMember(uid, homeId) {
    if (!uid || typeof uid !== 'string') return null;
    const d = await db.collection(MEMBERS).doc(uid).get();
    const m = d.exists ? d.data() || {} : null;
    return m && m.homeId === homeId && m.status === 'active' ? m : null;
  }

  // a day's list, as the app would make it, from whoever switched daily tasks on
  function listDoc(c, date, nowIso) {
    const by = c.createdByUid;
    return {
      homeId: c.homeId, text: 'Daily tasks', note: null, requestedTiming: 'date', requestedDate: date,
      requesterUid: c.uid, assigneeUid: c.uid, createdByUid: by, participants: Array.from(new Set([c.uid, by])),
      visibility: 'private', status: 'requested', plannedDate: null, linkedActionId: null,
      createdAt: nowIso, updatedAt: nowIso, latestUpdateAt: nowIso, latestUpdateByUid: by, latestUpdateType: 'created',
      readAt: {}, hasChecklist: true, kind: 'daily', dailyUid: c.uid, dailyDate: date
    };
  }

  async function runOne(ref) {
    const snap = await ref.get();
    if (!snap.exists) return { skipped: 'gone' };
    const c = Object.assign({ uid: snap.id }, snap.data() || {});
    if (c.status !== 'active') return { skipped: c.status || 'inactive' };
    if (c.uid !== snap.id || !(await activeMember(c.uid, c.homeId)) || !(await activeMember(c.createdByUid, c.homeId))) return { skipped: 'not at Home' };
    const local = localNow(c.timezone, clock());
    const date = local.date, nowIso = clock().toISOString();
    const todayRef = db.collection(REQ).doc(listId(c.uid, date));

    // 1. what was left on earlier days (only once a day)
    const carry = [];
    if (c.lastRollDate !== date) {
      const from = addDays(date, -LOOKBACK_DAYS);
      const lists = await db.collection(REQ).where('dailyUid', '==', c.uid).get();
      for (const l of lists.docs) {
        const r = l.data() || {};
        if (r.kind !== 'daily' || r.homeId !== c.homeId || r.deletedAt || !(r.dailyDate < date) || r.dailyDate < from) continue;
        const open = await l.ref.collection('items').where('done', '==', false).get();
        open.docs.forEach((it) => carry.push({ ref: it.ref, id: it.id, data: it.data() || {}, from: r.dailyDate }));
      }
    }
    // 2. the repeating tasks due today
    const repeats = (await ref.collection('repeats').get()).docs
      .map((d) => Object.assign({ id: d.id }, d.data() || {}))
      .filter((x) => typeof x.text === 'string' && x.text.trim() && isDue(x.schedule, date));

    let carried = 0, added = 0;
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(todayRef);
      const list = cur.exists ? cur.data() || {} : null;
      if (list && list.deletedAt) return;
      // re-read what moves, so a task ticked or moved meanwhile stays where it is
      const moving = [];
      for (const it of carry.slice(0, 200)) {
        const fresh = await tx.get(it.ref);
        if (fresh.exists && (fresh.data() || {}).done === false) moving.push(Object.assign(it, { data: fresh.data() }));
      }
      const had = new Set((list && list.repeatsAdded) || []);
      const items = list ? (await tx.get(todayRef.collection('items'))).docs.map((d) => d.data() || {}) : [];
      items.forEach((x) => { if (x.repeatId) had.add(x.repeatId); });
      moving.forEach((it) => { if (it.data.repeatId) had.add(it.data.repeatId); });
      const due = repeats.filter((x) => !had.has(x.id));
      const repeatsAdded = Array.from(new Set([...((list && list.repeatsAdded) || []), ...due.map((x) => x.id)]));
      // one write to the list itself: made with what it has had, or told what it has now
      if (!list) tx.create(todayRef, Object.assign(listDoc(c, date, nowIso), { repeatsAdded }));
      else if (due.length) tx.update(todayRef, { repeatsAdded });
      moving.forEach((it, i) => {
        const d = it.data;
        const copy = {
          text: String(d.text || '').slice(0, 200), done: false, order: -1000 + i,
          createdByUid: d.createdByUid || c.createdByUid, createdAt: d.createdAt || nowIso,
          doneByUid: null, doneAt: null, updatedByUid: d.createdByUid || c.createdByUid, updatedAt: nowIso,
          carriedFrom: d.carriedFrom || it.from
        };
        if (d.starred) copy.starred = true;
        if (d.repeatId) copy.repeatId = d.repeatId;
        tx.set(todayRef.collection('items').doc('c' + it.id), copy);
        tx.delete(it.ref);
      });
      due.forEach((x, i) => {
        const doc = {
          text: String(x.text).slice(0, 200), done: false, order: 1000 + i,
          createdByUid: x.createdByUid || c.createdByUid, createdAt: nowIso, doneByUid: null, doneAt: null,
          updatedByUid: x.createdByUid || c.createdByUid, updatedAt: nowIso, repeatId: x.id
        };
        if (x.starred) doc.starred = true;
        tx.set(todayRef.collection('items').doc('r' + x.id + date.replace(/-/g, '')), doc);
      });
      const book = { lastRunAt: nowIso };
      if (c.lastRollDate !== date) book.lastRollDate = date;
      tx.update(ref, book);
      carried = moving.length; added = due.length;
    });

    // 3. the morning message, once a day, at the hour chosen
    let notified = null;
    const hour = c.notifyTime ? Number(String(c.notifyTime).slice(0, 2)) : null;
    // (within three hours of it: switched on in the afternoon, the first message is tomorrow's)
    if (notify && hour != null && local.hour >= hour && local.hour < hour + 3 && c.lastNotifiedDate !== date) {
      await ref.update({ lastNotifiedDate: date });
      const open = (await todayRef.collection('items').where('done', '==', false).get()).docs.map((d) => d.data() || {});
      if (open.length && notify) {
        const fromBefore = open.filter((x) => x.carriedFrom).length;
        const firsts = open.slice().sort((a, b) => ((b.starred ? 1 : 0) - (a.starred ? 1 : 0)) || ((a.order || 0) - (b.order || 0)))
          .slice(0, 3).map((x) => x.text).join(', ');
        try {
          notified = await notify(c.uid, {
            homeId: c.homeId, listId: todayRef.id,
            title: 'Today: ' + open.length + (open.length === 1 ? ' task' : ' tasks') + (fromBefore ? ', ' + fromBefore + ' from before' : ''),
            body: firsts + (open.length > 3 ? '…' : '')
          });
        } catch (e) { log('daily morning message failed', c.uid, e && e.message); }
      }
    }
    return { uid: c.uid, date, carried, added, notified: !!notified };
  }

  async function runAll() {
    const all = await db.collection(DAILY).where('status', '==', 'active').get();
    const out = { people: all.size, carried: 0, added: 0, notified: 0, errors: [] };
    for (const d of all.docs) {
      try {
        const r = await runOne(d.ref);
        out.carried += r.carried || 0; out.added += r.added || 0; if (r.notified) out.notified++;
      } catch (e) { out.errors.push(d.id + ': ' + ((e && e.message) || e)); }
    }
    return out;
  }

  return { runOne, runAll };
}

module.exports = { createDaily, listId, addDays };
