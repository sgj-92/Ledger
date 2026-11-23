// Ledger — two-way sync with aCcountable, Shaun's calorie and training app (2026-11-23).
//
// The contract is aCcountable's docs/ledger-sync.md; docs/ACCOUNTABLE_SYNC.md is Ledger's
// side. In short:
//
//   aCcountable → Ledger  (accountableSync, HTTPS): one day — its planned training, its
//     meals, the day's nutrition and weight. Written into the day's plan and the day's
//     nutrition and weight records, only where something differs, and marked as from
//     aCcountable.
//   Ledger → aCcountable  (the triggers in index.js): when the day's plan changes
//     (training, a meal ticked) or a weigh-in is logged, the whole day's training, the
//     aCcountable meals ticked done and the weight are POSTed to its ledger-sync function.
//
// Both ways are signed: HMAC-SHA256 of "<timestamp>.<raw body>" with one shared secret
// (ACCOUNTABLE_SYNC_SECRET here, LEDGER_SYNC_SECRET there), within five minutes.
//
// No echo: ledger_sync/accountable-<date> (server only) keeps a hash of the last outbound
// day. After an inbound day is applied, the outbound day it implies is hashed there in
// the same batch, so the triggers its own writes fire find nothing new to send.
//
// Shaun's choices (2026-11-23): two sessions of one type (a run and a walk, both cardio)
// are each kept, as trainingDetails[type].syncSessions, and each goes back with its ref;
// aCcountable fills the day's food (diary, calories, macros, targets) and Ledger shows it
// read-only, while the day rating and daily checks stay Ledger's; on a day aCcountable
// plans, its meals are the day's meals, and ticking one asks aCcountable to log it —
// Ledger doesn't also write it into its own diary.

const crypto = require('crypto');

const TYPES = ['padel', 'resistance', 'cardio', 'hiit', 'yoga'];
const SKEW_MS = 5 * 60 * 1000;
const SYNC = 'ledger_sync';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// text only: whitespace tidied, never markup (Ledger writes some of it into HTML)
const str = (v, n) => (v == null ? '' : String(v)).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n || 200);
const num = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
const hhmm = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || '')); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? m[1].padStart(2, '0') + ':' + m[2] : null; };
// a stable JSON: the same day always hashes the same
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const hash = (v) => crypto.createHash('sha256').update(stable(v)).digest('hex');
const same = (a, b) => stable(a) === stable(b);
// a meal's id in Ledger, from its ref: the same meal is always the same row
const mealId = (ref) => 'acc_' + crypto.createHash('sha1').update(String(ref)).digest('hex').slice(0, 16);

function sign(secret, ts, raw) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(String(ts) + '.' + raw).digest('hex');
}

function createAccountable(deps) {
  const db = deps.db;
  const http = deps.fetch;
  const secret = deps.secret || '';
  const url = deps.url || '';
  const clock = deps.now || (() => new Date());
  const log = deps.log || (() => {});
  const configured = () => secret.length >= 32;

  // ---- the signature, both ways ----
  function verify(headers, raw) {
    if (!configured()) return { ok: false, status: 503, error: 'Sync is not set up on Ledger yet.' };
    const ts = String(headers['x-sync-timestamp'] || '');
    const sig = String(headers['x-sync-signature'] || '');
    if (!/^\d{10,16}$/.test(ts) || Math.abs(clock().getTime() - Number(ts)) > SKEW_MS) return { ok: false, status: 401, error: 'Stale or missing timestamp.' };
    const want = Buffer.from(sign(secret, ts, raw));
    const got = Buffer.from(sig);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return { ok: false, status: 401, error: 'Bad signature.' };
    return { ok: true };
  }

  // ---- reading a day as Ledger holds it ----
  async function weightSessions(date) {
    const q = await db.collection('ledger_sessions').where('date', '==', date).get();
    return q.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((s) => s.type === 'weight');
  }
  // the day's weigh-in: the latest logged that day
  function latestWeight(list) {
    const ws = list.filter((s) => num(s.weightKg) != null)
      .sort((a, b) => String(a.activityTime || a.createdAt || '').localeCompare(String(b.activityTime || b.createdAt || '')));
    return ws.length ? ws[ws.length - 1] : null;
  }
  // what Ledger would tell aCcountable about a day
  function outboundOf(date, plan, weights) {
    const training = [];
    const p = plan || {};
    if (!p.restDay) {
      (p.trainingTypes || []).filter((t) => TYPES.indexOf(t) > -1).forEach((t) => {
        const det = (p.trainingDetails && p.trainingDetails[t]) || {};
        const ss = Array.isArray(det.syncSessions) ? det.syncSessions : [];
        // the first session is the one Ledger edits (its time and length); the rest go back as they came
        training.push({ ref: ss.length ? ss[0].ref : 'ledger:' + date + ':' + t, type: t, startTime: hhmm(det.activityTime), durationMin: num(det.durationMin) });
        ss.slice(1).forEach((s) => training.push({ ref: s.ref, type: t, startTime: hhmm(s.startTime), durationMin: num(s.durationMin) }));
      });
    }
    const mealsDone = (p.meals || []).filter((m) => m && typeof m === 'object' && m.ref && m.completed).map((m) => m.ref).sort();
    const w = latestWeight(weights || []);
    return { v: 1, origin: 'ledger', date, training, mealsDone, weightKg: w ? num(w.weightKg) : null };
  }

  // ---- aCcountable → Ledger ----
  function clean(payload) {
    if (!payload || payload.v !== 1 || payload.origin !== 'accountable' || !DATE_RE.test(String(payload.date || ''))) return null;
    const training = (Array.isArray(payload.training) ? payload.training : []).slice(0, 20)
      .filter((t) => t && TYPES.indexOf(t.type) > -1 && t.ref)
      .map((t) => ({ ref: str(t.ref, 120), type: t.type, title: str(t.title, 80) || null, startTime: hhmm(t.startTime), durationMin: num(t.durationMin) }));
    const meals = (Array.isArray(payload.meals) ? payload.meals : []).slice(0, 20).filter((m) => m && m.ref).map((m) => ({
      ref: str(m.ref, 120), name: str(m.name, 80) || 'Meal', time: hhmm(m.time), tag: m.tag === 'pre' || m.tag === 'post' ? m.tag : null,
      kcal: num(m.kcal), done: !!m.done,
      foods: (Array.isArray(m.foods) ? m.foods : []).slice(0, 40).map((f) => ({ name: str(f && f.name, 80), amount: str(f && f.amount, 40) || null, kcal: num(f && f.kcal), done: !!(f && f.done) })).filter((f) => f.name)
    }));
    const n = payload.nutrition && typeof payload.nutrition === 'object' ? payload.nutrition : null;
    const nutrition = n ? {
      eatenKcal: num(n.eatenKcal), proteinG: num(n.proteinG), carbsG: num(n.carbsG), fatG: num(n.fatG),
      targetKcal: num(n.targetKcal), targetProteinG: num(n.targetProteinG), targetCarbsG: num(n.targetCarbsG), targetFatG: num(n.targetFatG),
      dayType: str(n.dayType, 60) || null, diaryOnly: !!n.diaryOnly,
      diary: (Array.isArray(n.diary) ? n.diary : []).slice(0, 120).map((l) => str(l, 300)).filter(Boolean)
    } : null;
    const w = num(payload.weightKg);
    return { date: payload.date, training, meals, nutrition, weightKg: w != null && w > 20 && w < 400 ? w : null };
  }
  function mealText(m) {
    const foods = m.foods.map((f) => f.name + (f.amount ? ' ' + f.amount : '')).join(', ');
    return (m.name + (foods ? ' · ' + foods : '')).slice(0, 300);
  }

  async function applyDay(payload) {
    const d = clean(payload);
    if (!d) return { status: 400, body: { error: 'Not a day from aCcountable (v 1).' } };
    const now = clock().toISOString();
    const planRef = db.collection('ledger_plans').doc(d.date);
    const [planSnap, weights, nutQ] = await Promise.all([
      planRef.get(), weightSessions(d.date),
      db.collection('ledger_sessions').where('date', '==', d.date).get()
    ]);
    const plan = planSnap.exists ? planSnap.data() : null;
    const base = plan || { date: d.date, restDay: false, trainingTypes: [], meals: [] };
    const next = Object.assign({}, base);
    const changed = { training: false, meals: false, nutrition: false, weight: false };

    // training: the day's list as aCcountable has it. A type it no longer lists goes only if
    // aCcountable had it before (it carries syncSessions) — one planned in Ledger that hasn't
    // reached aCcountable yet stays — and never once Ledger has logged it or it's under way.
    if (!base.restDay || d.training.length) {
      const byType = {};
      d.training.forEach((t) => { (byType[t.type] = byType[t.type] || []).push(t); });
      const oldTypes = base.trainingTypes || [];
      const oldDet = base.trainingDetails || {};
      const keep = oldTypes.filter((t) => !byType[t] && (!oldDet[t] || !oldDet[t].syncSessions || oldDet[t].completed || oldDet[t].inProgress));
      const types = d.training.map((t) => t.type).filter((t, i, a) => a.indexOf(t) === i).concat(keep);
      const details = {};
      types.forEach((t) => {
        const det = Object.assign({}, oldDet[t] || {});
        const list = byType[t];
        if (list) {
          det.activityTime = list[0].startTime || '';
          det.durationMin = list[0].durationMin;
          det.syncSessions = list.map((s) => ({ ref: s.ref, title: s.title, startTime: s.startTime, durationMin: s.durationMin }));
        }
        details[t] = det;
      });
      // types Ledger keeps no details for stay out of trainingDetails, as before
      Object.keys(oldDet).forEach((t) => { if (types.indexOf(t) > -1 && !details[t]) details[t] = oldDet[t]; });
      if (!same(types, oldTypes) || !same(details, pick(oldDet, types)) || Object.keys(oldDet).some((t) => types.indexOf(t) === -1)) {
        next.trainingTypes = types;
        next.trainingDetails = details;
        if (types.length) next.restDay = false;
        changed.training = true;
      }
    }

    // meals: on a day aCcountable plans, its meals are the day's meals. Ledger's own meals
    // that were ticked (they're in its diary) stay; the rest give way.
    if (d.meals.length) {
      const old = (base.meals || []).map((m) => (typeof m === 'string' ? { text: m } : m));
      const byRef = {};
      old.forEach((m) => { if (m.ref) byRef[m.ref] = m; });
      const acc = d.meals.map((m) => {
        const was = byRef[m.ref] || {};
        const done = m.done || !!was.completed;
        return Object.assign({}, was, {
          id: was.id || mealId(m.ref), ref: m.ref, source: 'accountable', text: mealText(m), name: m.name,
          time: m.time, tag: m.tag, kcal: m.kcal, foods: m.foods,
          completed: done, completedAt: done ? (was.completedAt || now) : null, nutritionEntryId: null
        });
      }).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
      const mine = old.filter((m) => !m.ref && m.completed && m.text);
      const meals = acc.concat(mine);
      if (!same(meals, old)) { next.meals = meals; changed.meals = true; }
    }

    const batch = db.batch();
    if (changed.training || changed.meals) {
      next.date = d.date;
      next.syncedFromAccountableAt = now;
      batch.set(planRef, next);
    }

    // nutrition: the food is aCcountable's; the rating and the checks stay Ledger's
    if (d.nutrition) {
      const nut = nutQ.docs.map((x) => Object.assign({ id: x.id }, x.data())).find((s) => s.type === 'nutrition') || null;
      const acc = Object.assign({}, d.nutrition);
      const diary = acc.diary.join('\n');
      const oldAcc = nut && nut.accountable ? Object.assign({}, nut.accountable) : null;
      if (oldAcc) delete oldAcc.syncedAt;
      if (!nut || !same(oldAcc, acc) || (nut.foodDiary || '') !== diary) {
        const ref = nut ? db.collection('ledger_sessions').doc(nut.id) : db.collection('ledger_sessions').doc('acc-nutrition-' + d.date);
        const patch = { type: 'nutrition', date: d.date, accountable: Object.assign({ syncedAt: now }, acc), foodDiary: diary, foodDiarySource: 'accountable', planMealLines: [] };
        // a diary he typed in Ledger first is kept aside, never lost
        if (nut && nut.foodDiary && nut.foodDiarySource !== 'accountable' && !nut.foodDiaryLedger) patch.foodDiaryLedger = nut.foodDiary;
        if (!nut) patch.createdAt = now;
        batch.set(ref, patch, { merge: true });
        changed.nutrition = true;
      }
    }

    // weight: set where it differs; a day without one in aCcountable never deletes Ledger's
    let weightsAfter = weights;
    if (d.weightKg != null) {
      const w = latestWeight(weights);
      if (!w || num(w.weightKg) !== d.weightKg) {
        const ref = w ? db.collection('ledger_sessions').doc(w.id) : db.collection('ledger_sessions').doc('acc-weight-' + d.date);
        const rec = w ? { weightKg: d.weightKg, syncSource: 'accountable', syncedAt: now }
          : { type: 'weight', date: d.date, weightKg: d.weightKg, syncSource: 'accountable', syncedAt: now, createdAt: now };
        batch.set(ref, rec, { merge: true });
        weightsAfter = w ? weights.map((x) => (x.id === w.id ? Object.assign({}, x, rec) : x)) : weights.concat([Object.assign({ id: ref.id }, rec)]);
        changed.weight = true;
      }
    }

    // what Ledger would now send back is what aCcountable just sent: never echoed
    const out = outboundOf(d.date, Object.assign({}, base, next), weightsAfter);
    batch.set(db.collection(SYNC).doc('accountable-' + d.date), { outHash: hash(out), inAt: now }, { merge: true });
    batch.set(db.collection('ledger_meta').doc('accountable'), { lastInAt: now, lastInDate: d.date }, { merge: true });
    await batch.commit();
    return { status: 200, body: { ok: true, date: d.date, changed } };
  }

  // ---- Ledger → aCcountable ----
  // Sends the day when what Ledger would say about it differs from what was last said (or
  // just received). A day it has never spoken about, with nothing on it, stays quiet.
  async function pushDay(date) {
    if (!DATE_RE.test(String(date || ''))) return { skipped: 'date' };
    if (!configured() || !/^https:\/\//.test(url)) return { skipped: 'not set up' };
    const [planSnap, weights, syncSnap] = await Promise.all([
      db.collection('ledger_plans').doc(date).get(), weightSessions(date), db.collection(SYNC).doc('accountable-' + date).get()
    ]);
    const out = outboundOf(date, planSnap.exists ? planSnap.data() : null, weights);
    const h = hash(out);
    const prev = syncSnap.exists ? syncSnap.data() : null;
    if (prev && prev.outHash === h) return { skipped: 'unchanged' };
    if (!prev && !out.training.length && !out.mealsDone.length && out.weightKg == null) return { skipped: 'empty' };
    const raw = JSON.stringify(out);
    const ts = String(clock().getTime());
    const r = await http(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-timestamp': ts, 'x-sync-signature': sign(secret, ts, raw) }, body: raw });
    const now = clock().toISOString();
    if (!r.ok) {
      log('accountable push failed', date, r.status);
      await db.collection('ledger_meta').doc('accountable').set({ lastError: 'aCcountable answered ' + r.status, lastErrorAt: now }, { merge: true });
      return { sent: false, status: r.status };
    }
    await db.collection(SYNC).doc('accountable-' + date).set({ outHash: h, outAt: now }, { merge: true });
    await db.collection('ledger_meta').doc('accountable').set({ lastOutAt: now, lastOutDate: date, lastError: null }, { merge: true });
    return { sent: true };
  }

  return { verify, applyDay, pushDay, outboundOf, configured };
}
function pick(o, keys) { const r = {}; keys.forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

module.exports = { createAccountable, sign, hash, mealId };
