// Ledger — Ask Claude, phase 2 (docs/CLAUDE_ASSISTANT.md §13): everything beyond Actions and
// the Food Plan, for Shaun's own Ledger.
//
//   - Logs: training, weight, steps, food (the day's food diary, as written), a goal's number,
//     a Day Note, the day's intention, a movement on a conversation, a Life Context.
//     A log that only ADDS is marked `auto`: Ledger saves it as soon as the answer arrives,
//     with Undo (Shaun's answer, 2026-11-01). A log that would replace something already
//     there (the day's steps, a rating, an intention, a goal's value for that day) is not
//     auto, and waits for review like any other change.
//   - Reads: health for a range, goals, a week and its outcomes, Comms, and "what's missing".
//   - Changes that always wait for review: goals, the week's outcomes and their results, a
//     conversation's state.
//
// Like phase 1, nothing here writes Ledger data. Each tool checks its input against the
// records as they are now and returns a change; the app makes it, as Shaun, under the rules.

const crypto = require('crypto');

const SESSIONS = 'ledger_sessions';
const PLANS = 'ledger_plans';
const PRIORITIES = 'ledger_priorities';
const WEEKS = 'ledger_weeks';
const COMMITMENTS = 'ledger_commitments';
const CONVERSATIONS = 'ledger_conversations';
const MATTERS = 'ledger_matters';
const LIFE = 'ledger_life_context';
const META = 'ledger_meta';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TRAINING = ['padel', 'resistance', 'cardio', 'hiit', 'yoga'];
const TRAINING_LABEL = { padel: 'Padel', resistance: 'Strength', cardio: 'Cardio', hiit: 'HIIT', yoga: 'Mobility' };
const PADEL_TYPES = ['match', 'tournament', 'social', 'training'];
const RATINGS = ['good', 'neutral', 'off-track'];
const LOG_KINDS = ['received', 'sent', 'call', 'meeting', 'note'];
const ATTENTION = ['needs_me', 'waiting_on_person', 'waiting_on_third_party', 'follow_up_later', 'no_action', 'closed'];
const LC_CATEGORIES = ['illness', 'injury', 'sleep', 'family', 'work', 'travel', 'other'];
const LC_AREAS = ['day', 'training', 'steps', 'challenges', 'actions', 'nutrition', 'routines'];
const RESULTS = ['done', 'partly', 'not'];
const MISSING_AREAS = ['health', 'goals', 'actions_comms'];
const MAX_RANGE_DAYS = 31;
const QUIET_DAYS = 14;

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const nullable = (t, extra) => ({ anyOf: [Object.assign({ type: t }, extra || {}), { type: 'null' }] });
const DATE = { type: 'string', description: 'YYYY-MM-DD' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
function addDays(date, n) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
function dow(date) { return new Date(date + 'T00:00:00Z').getUTCDay(); }
const newId = (p) => p + crypto.randomBytes(9).toString('hex');
function quarterOf(date) { return date.slice(0, 4) + '-Q' + Math.ceil(Number(date.slice(5, 7)) / 3); }

const SYSTEM_EXTRA = [
  '',
  'Beyond Actions and meals, you can also:',
  '- LOG what Shaun tells you he did, for the day he says (or today): training (log_training), weight (log_weight), steps (log_steps), food he ate (log_food — the day\'s food diary, in his words; never estimate calories or nutrients), a goal\'s number (log_goal_value), a Day Note (add_day_note), the day\'s intention (set_intention), something that happened in a conversation (log_conversation), and a circumstance that affected his days (log_life_context).',
  '  Logs that only add something are saved by Ledger as soon as you finish, with Undo; you may say they are logged. A log that would replace something already there (the day\'s steps, the day\'s rating, an intention, a goal\'s value for that day) waits for his review like any other change — the tool says so.',
  '- Plan and review his goals and weeks: list_goals, get_week, propose_goal, propose_update_goal, propose_outcome, propose_outcome_result. These wait for his review.',
  '- Communications: list_comms, log_conversation, propose_conversation_state (waits for review).',
  '- Health: get_health for a range of days.',
  '- "What\'s missing?": call whats_missing for the day or days he means (today, if he does not say). Report what it finds briefly, grouped, in plain words — missing data is never failure, so say "no weight logged", never "missed". Then he can tell you the values and you log them.',
  '- His Home, if he is an admin there: the home_* and *_daily tools and propose_request / propose_checklist_items. Those changes reach Abi or Magda, so they always wait for his review.',
  'Read before you log when it matters: if he says "I did legs", one log_training with the exercises he names. Never invent numbers he did not give. One log per thing he did; do not log the same thing twice.',
  'Goals are Business or Personal, a year goal or a 90-day goal (calendar quarter) under one. A week\'s outcomes are what that week moves on a goal; each can be marked done, partly or not.'
].join('\n');

const TOOLS = [
  // ---- reading ----
  { name: 'get_health', description: 'Health records for a range of days (at most 31): training sessions, weight, steps, the nutrition day (food diary, rating), symptoms, and Life Context.',
    input_schema: obj({ from: DATE, to: DATE }) },
  { name: 'list_goals', description: 'Shaun\'s goals: area (business/personal), horizon (year/quarter), period, parent, status, measure and latest value.',
    input_schema: obj({ include_closed: { type: 'boolean' } }) },
  { name: 'get_week', description: 'The week containing a date: its first day, its outcomes (with their goal and result) and the Actions that move each.',
    input_schema: obj({ date: DATE }) },
  { name: 'list_comms', description: 'Conversations and matters. filter: needs_me, waiting, follow_up (follow-up date reached), quiet (no movement for 14 days), or all open.',
    input_schema: obj({ filter: { type: 'string', enum: ['needs_me', 'waiting', 'follow_up', 'quiet', 'all'] } }) },
  { name: 'whats_missing', description: 'What is not yet recorded for a range of days (at most 31; future days are skipped). areas: any of health (weight, steps, nutrition, planned training not logged), goals (numbers not updated this week, outcomes without a result or Actions), actions_comms (open Actions from earlier days, conversations that need him or have gone quiet).',
    input_schema: obj({ from: DATE, to: DATE, areas: { type: 'array', items: { type: 'string', enum: MISSING_AREAS } } }) },

  // ---- logs ----
  { name: 'log_training', description: 'Log a training session he did. Only fill what he said; null for the rest.',
    input_schema: obj({
      date: DATE, type: { type: 'string', enum: TRAINING },
      time: Object.assign(nullable('string'), { description: 'HH:MM, or null' }),
      duration_min: nullable('integer'), venue: nullable('string'), notes: nullable('string'),
      padel_type: nullable('string', { enum: PADEL_TYPES }),
      cardio_type: Object.assign(nullable('string'), { description: 'e.g. Run, Cycle, Swim' }),
      distance: nullable('number'), distance_unit: nullable('string', { enum: ['km', 'mi', 'm'] }),
      exercises: { anyOf: [{ type: 'array', items: obj({ name: { type: 'string' }, sets: nullable('integer'), reps: nullable('integer'), value: nullable('number'), unit: nullable('string', { enum: ['kg', 'lb', 'reps', 'sec', 'm'] }) }) }, { type: 'null' }] },
      focus: Object.assign(nullable('string'), { description: 'mobility focus, e.g. hips' }),
      outline: Object.assign(nullable('string'), { description: 'HIIT outline' })
    }) },
  { name: 'log_weight', description: 'Log his weight in kg (convert stones/pounds if he uses them).', input_schema: obj({ date: DATE, kg: { type: 'number' } }) },
  { name: 'log_steps', description: 'Log the day\'s step total (one total a day; a new one replaces the old and waits for review).', input_schema: obj({ date: DATE, steps: { type: 'integer' } }) },
  { name: 'log_food', description: 'Add what he ate to the day\'s food diary, in his words (one line each). rating: how the day went (good, neutral, off-track) only if he says.',
    input_schema: obj({ date: DATE, lines: { type: 'array', items: { type: 'string' } }, rating: nullable('string', { enum: RATINGS }) }) },
  { name: 'log_goal_value', description: 'Record a goal\'s number (its measure) for a date.', input_schema: obj({ goal_id: { type: 'string' }, value: { type: 'number' }, date: DATE }) },
  { name: 'add_day_note', description: 'Add a line to a day\'s Day Notes.', input_schema: obj({ date: DATE, text: { type: 'string' } }) },
  { name: 'set_intention', description: 'Set the day\'s intention (Morning Prime).', input_schema: obj({ date: DATE, text: { type: 'string' } }) },
  { name: 'log_conversation', description: 'Record a movement on a conversation: received, sent, call, meeting or note.',
    input_schema: obj({ conversation_id: { type: 'string' }, kind: { type: 'string', enum: LOG_KINDS }, text: { type: 'string' } }) },
  { name: 'log_life_context', description: 'Record a circumstance that affected his days (illness, poor sleep, travel…). end_date null while it is ongoing.',
    input_schema: obj({ category: { type: 'string', enum: LC_CATEGORIES }, start_date: DATE, end_date: nullable('string'), note: nullable('string'), areas: { type: 'array', items: { type: 'string', enum: LC_AREAS } } }) },

  // ---- changes for review ----
  { name: 'propose_goal', description: 'Propose a new goal. A quarter goal names its quarter (YYYY-QN) and, usually, its year goal.',
    input_schema: obj({ title: { type: 'string' }, area: { type: 'string', enum: ['business', 'personal'] }, horizon: { type: 'string', enum: ['year', 'quarter'] },
      quarter: nullable('string'), parent_id: nullable('string'), why: nullable('string'), unit: nullable('string'), start: nullable('number'), target: nullable('number') }) },
  { name: 'propose_update_goal', description: 'Propose a change to a goal: a new title, or its status (achieved, dropped, or active again). Null leaves it.',
    input_schema: obj({ id: { type: 'string' }, title: nullable('string'), status: nullable('string', { enum: ['active', 'achieved', 'dropped'] }) }) },
  { name: 'propose_outcome', description: 'Propose an outcome for the week containing date: what that week moves, on a goal (or with an area if no goal).',
    input_schema: obj({ date: DATE, text: { type: 'string' }, goal_id: nullable('string'), area: { type: 'string', enum: ['business', 'personal'] } }) },
  { name: 'propose_outcome_result', description: 'Propose how an outcome ended: done, partly or not (or null to reopen it).',
    input_schema: obj({ outcome_id: { type: 'string' }, result: nullable('string', { enum: RESULTS }) }) },
  { name: 'propose_conversation_state', description: 'Propose who has the ball on a conversation, with who it waits on and a follow-up date if they apply.',
    input_schema: obj({ conversation_id: { type: 'string' }, state: { type: 'string', enum: ATTENTION }, waiting_on: nullable('string'), follow_up: nullable('string') }) }
].map((t) => Object.assign({ strict: true }, t));

const READS = ['get_health', 'list_goals', 'get_week', 'list_comms', 'whats_missing'];

function createLedgerTools({ db, now = () => new Date() }) {
  const get = async (coll, id) => {
    if (!id || typeof id !== 'string' || id.length > 200 || id.indexOf('/') > -1) return null;
    const d = await db.collection(coll).doc(id).get();
    return d.exists ? Object.assign({ id: d.id }, d.data() || {}) : null;
  };
  const all = async (coll) => (await db.collection(coll).get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
  async function sessionsIn(from, to) {
    const snap = await db.collection(SESSIONS).where('date', '>=', from).where('date', '<=', to).get();
    return snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
  }
  async function weekStartOf(date) {
    const p = await get(META, 'presets');
    const startDow = p && p.weekStartsOn === 'sunday' ? 0 : 1;
    return addDays(date, -((dow(date) - startDow + 7) % 7));
  }
  function range(input) {
    if (!DATE_RE.test(input.from || '') || !DATE_RE.test(input.to || '')) return { error: 'from and to must be YYYY-MM-DD' };
    if (input.to < input.from) return { error: 'to is before from' };
    if (daysBetween(input.from, input.to) > MAX_RANGE_DAYS - 1) return { error: 'At most ' + MAX_RANGE_DAYS + ' days at once.' };
    return null;
  }

  // ---- views: compact, and never a photo ----
  function sessionView(s) {
    const v = { id: s.id, date: s.date, type: s.type };
    if (TRAINING.indexOf(s.type) > -1) {
      v.label = TRAINING_LABEL[s.type];
      ['activityTime', 'durationMin', 'venue', 'padelType', 'result', 'cardioType', 'distance', 'distanceUnit', 'focus', 'outline'].forEach((k) => { if (s[k] != null && s[k] !== '') v[k] = typeof s[k] === 'string' ? clip(s[k], 200) : s[k]; });
      if (Array.isArray(s.exercises) && s.exercises.length) v.exercises = s.exercises.slice(0, 30).map((e) => ({ name: clip(e.name, 60), sets: e.sets || null, reps: e.reps || null, value: e.value || null, unit: e.unit || null }));
      if (s.notes) v.notes = clip(s.notes, 300);
    } else if (s.type === 'weight') v.kg = s.weightKg;
    else if (s.type === 'steps') v.steps = s.steps;
    else if (s.type === 'nutrition') {
      v.food_diary = clip(s.foodDiary, 1500); v.rating = s.dayRating || null;
      if (s.glutenExposure) v.gluten = clip(s.glutenSource, 100) || true;
    } else if (s.type === 'symptom') v.note = clip(s.notes || s.symptoms || '', 200);
    else if (s.type === 'photo') v.photo = 'a daily photo (not shown)';
    return v;
  }
  function goalView(g, byId) {
    const vals = (Array.isArray(g.values) ? g.values : []).filter((x) => x && x.date).sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = vals[vals.length - 1] || null;
    const m = g.measure && g.measure.kind === 'number' ? g.measure : null;
    const parent = g.parentId && byId[g.parentId];
    return {
      id: g.id, title: clip(g.title, 200), area: g.area || null, horizon: g.horizon === 'quarter' ? 'quarter' : 'year',
      period: g.period || null, status: g.status === 'achieved' || g.status === 'dropped' ? g.status : 'active',
      parent: parent ? { id: parent.id, title: clip(parent.title, 120) } : null, why: clip(g.why || g.note, 300) || null,
      measure: m ? { unit: m.unit || null, start: m.start, target: m.target, latest: last ? { date: last.date, value: last.value } : null } : null,
      evidence: g.evidenceType || null
    };
  }
  function convView(v) {
    return {
      id: v.id, name: clip(v.title || (v.participants || []).map((p) => p && p.name).filter(Boolean).join(', ') || 'Untitled', 120),
      category: v.category || null, state: v.attentionState || 'needs_me', waiting_on: clip(v.waitingOn, 80) || null,
      follow_up: v.nextFollowUpAt || null, last_activity: v.lastActivityAt || v.updatedAt || null, matter_id: v.matterId || null,
      recent: (v.log || []).slice(-3).map((l) => ({ at: l.at, kind: l.kind, text: clip(l.text, 200) }))
    };
  }

  async function readTool(name, input, ctx) {
    if (name === 'get_health') {
      const bad = range(input); if (bad) return bad;
      const [ss, lc] = await Promise.all([sessionsIn(input.from, input.to), all(LIFE)]);
      return {
        from: input.from, to: input.to,
        records: ss.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(sessionView),
        life_context: lc.filter((r) => r.startDate && r.startDate <= input.to && (!r.endDate || r.endDate >= input.from))
          .map((r) => ({ id: r.id, category: r.category, start: r.startDate, end: r.endDate || null, note: clip(r.note, 200) || null, areas: r.areas || [] }))
      };
    }
    if (name === 'list_goals') {
      const gs = await all(PRIORITIES), byId = {};
      gs.forEach((g) => { byId[g.id] = g; });
      return { goals: gs.filter((g) => input.include_closed || !(g.status === 'achieved' || g.status === 'dropped')).map((g) => goalView(g, byId)) };
    }
    if (name === 'get_week') {
      if (!DATE_RE.test(input.date || '')) return { error: 'date must be YYYY-MM-DD' };
      const ws = await weekStartOf(input.date);
      const [w, gs, acts] = await Promise.all([get(WEEKS, ws),
        all(PRIORITIES),
        db.collection(COMMITMENTS).where('date', '>=', ws).where('date', '<=', addDays(ws, 6)).get()]);
      const byId = {}; gs.forEach((g) => { byId[g.id] = g; });
      const outs = ((w && w.outcomes) || []).filter((o) => o && o.id && o.text);
      const actions = acts.docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
      return {
        week_start: ws, week_end: addDays(ws, 6),
        outcomes: outs.map((o) => ({
          id: o.id, text: clip(o.text, 200), area: o.area || null, result: o.result || null,
          goal: byId[o.goalId] ? { id: o.goalId, title: clip(byId[o.goalId].title, 120) } : null,
          actions: actions.filter((c) => c.outcomeId === o.id).map((c) => ({ id: c.id, title: clip(c.title, 120), date: c.date, status: c.status === 'completed' ? 'completed' : 'open' }))
        }))
      };
    }
    if (name === 'list_comms') {
      const [cs, ms] = await Promise.all([all(CONVERSATIONS), all(MATTERS)]);
      const today = ctx.today, quietBefore = addDays(today, -QUIET_DAYS);
      const open = cs.filter((v) => v.attentionState !== 'closed');
      const pick = {
        needs_me: (v) => (v.attentionState || 'needs_me') === 'needs_me',
        waiting: (v) => /^waiting/.test(v.attentionState || ''),
        follow_up: (v) => v.nextFollowUpAt && String(v.nextFollowUpAt).slice(0, 10) <= today,
        quiet: (v) => v.attentionState !== 'no_action' && String(v.lastActivityAt || v.updatedAt || '').slice(0, 10) < quietBefore,
        all: () => true
      }[input.filter] || (() => true);
      return {
        conversations: open.filter(pick).slice(0, 80).map(convView),
        matters: ms.filter((m) => m.status !== 'closed').slice(0, 60).map((m) => ({ id: m.id, title: clip(m.title, 120), status: m.status || 'active', summary: clip(m.summary, 200) || null }))
      };
    }
    if (name === 'whats_missing') return whatsMissing(input, ctx);
    return null;
  }

  // Facts only: what is not recorded. Never a judgement.
  async function whatsMissing(input, ctx) {
    const bad = range(input); if (bad) return bad;
    const areas = (input.areas && input.areas.length ? input.areas : MISSING_AREAS).filter((a) => MISSING_AREAS.indexOf(a) > -1);
    const today = ctx.today, to = input.to > today ? today : input.to, from = input.from;
    const out = { from, to };
    if (from > today) return Object.assign(out, { note: 'Those days have not happened yet.' });
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

    if (areas.indexOf('health') > -1) {
      const [ss, plans] = await Promise.all([sessionsIn(from, to), Promise.all(days.map((d) => get(PLANS, d)))]);
      out.health = days.map((d, i) => {
        const on = ss.filter((s) => s.date === d), plan = plans[i] || {};
        const missing = [];
        if (!on.some((s) => s.type === 'weight')) missing.push('no weight logged');
        if (!on.some((s) => s.type === 'steps')) missing.push('no steps logged');
        const n = on.find((s) => s.type === 'nutrition');
        if (!n) missing.push('no food logged');
        else {
          if (!clip(n.foodDiary, 10)) missing.push('food diary empty');
          if (!n.dayRating) missing.push('nutrition day not rated');
        }
        if (!plan.restDay) (plan.trainingTypes || []).forEach((t) => {
          const done = on.some((s) => s.type === t) || (plan.trainingDetails && plan.trainingDetails[t] && plan.trainingDetails[t].completed);
          if (!done) missing.push((TRAINING_LABEL[t] || t) + ' planned, not logged');
        });
        return { date: d, missing };
      }).filter((x) => x.missing.length);
    }
    if (areas.indexOf('goals') > -1) {
      const ws = await weekStartOf(to);
      const [gs, w, acts] = await Promise.all([all(PRIORITIES), get(WEEKS, ws),
        db.collection(COMMITMENTS).where('date', '>=', ws).where('date', '<=', addDays(ws, 6)).get()]);
      const weekAgo = addDays(today, -7);
      const stale = gs.filter((g) => !(g.status === 'achieved' || g.status === 'dropped') && g.measure && g.measure.kind === 'number')
        .map((g) => {
          const vals = (g.values || []).filter((x) => x && x.date).sort((a, b) => (a.date < b.date ? -1 : 1));
          const last = vals[vals.length - 1];
          return (!last || last.date < weekAgo) ? { id: g.id, title: clip(g.title, 120), last_value: last ? { date: last.date, value: last.value } : null } : null;
        }).filter(Boolean);
      const linked = acts.docs.map((d) => d.data() || {});
      const outs = ((w && w.outcomes) || []).filter((o) => o && o.id && o.text);
      out.goals = {
        week_start: ws,
        numbers_not_updated_this_week: stale,
        no_outcomes_this_week: !outs.length,
        outcomes_without_result: today >= addDays(ws, 4) ? outs.filter((o) => !o.result).map((o) => ({ id: o.id, text: clip(o.text, 120) })) : [],
        outcomes_without_actions: outs.filter((o) => !o.result && !linked.some((c) => c.outcomeId === o.id)).map((o) => ({ id: o.id, text: clip(o.text, 120) })),
        goals_without_area: gs.filter((g) => !g.area && !(g.status === 'achieved' || g.status === 'dropped')).map((g) => ({ id: g.id, title: clip(g.title, 120) }))
      };
    }
    if (areas.indexOf('actions_comms') > -1) {
      const [acts, cs] = await Promise.all([db.collection(COMMITMENTS).where('date', '>=', from).where('date', '<=', to).get(), all(CONVERSATIONS)]);
      const open = acts.docs.map((d) => Object.assign({ id: d.id }, d.data() || {}))
        .filter((c) => c.title && c.category !== 'roadblock' && c.status !== 'completed' && c.status !== 'not_done');
      const quietBefore = addDays(today, -QUIET_DAYS);
      const live = cs.filter((v) => v.attentionState !== 'closed');
      out.actions_comms = {
        open_from_earlier_days: open.filter((c) => c.date < today).map((c) => ({ id: c.id, title: clip(c.title, 120), date: c.date })).slice(0, 40),
        open_today: open.filter((c) => c.date === today).length,
        conversations_needing_you: live.filter((v) => (v.attentionState || 'needs_me') === 'needs_me').map(convView).map((v) => ({ id: v.id, name: v.name })),
        follow_ups_due: live.filter((v) => v.nextFollowUpAt && String(v.nextFollowUpAt).slice(0, 10) <= today).map((v) => ({ id: v.id, name: convView(v).name, follow_up: v.nextFollowUpAt })),
        gone_quiet: live.filter((v) => v.attentionState !== 'no_action' && String(v.lastActivityAt || v.updatedAt || '').slice(0, 10) < quietBefore)
          .map((v) => ({ id: v.id, name: convView(v).name, last_activity: v.lastActivityAt || v.updatedAt || null }))
      };
    }
    return out;
  }

  // ---- logs and changes ----
  async function proposeTool(name, input, ctx) {
    const changes = ctx.changes;
    const add = (c) => { c.n = changes.length + 1; changes.push(c); return { ok: true, change: c.n, saved: c.auto ? 'Saved as soon as you finish, with Undo.' : 'Waits for Shaun\'s review.' }; };
    const nowIso = now().toISOString();
    const dateOk = (d) => DATE_RE.test(d || '');
    const notFuture = (d) => d <= addDays(ctx.today, 1);       // a log is for a day that has happened (or tonight's tomorrow)

    if (name === 'log_training') {
      if (!dateOk(input.date) || !notFuture(input.date)) return { error: 'date must be YYYY-MM-DD, and not in the future' };
      if (TRAINING.indexOf(input.type) === -1) return { error: 'unknown training type' };
      if (input.time && !TIME_RE.test(input.time)) return { error: 'time must be HH:MM' };
      const r = { type: input.type, date: input.date, createdAt: nowIso, notes: clip(input.notes, 1000), activityTime: input.time || '', createdVia: 'claude' };
      if (input.duration_min && input.duration_min > 0) r.durationMin = Math.min(600, Math.round(input.duration_min));
      if (input.venue) r.venue = clip(input.venue, 80);
      if (input.type === 'padel') { r.padelType = input.padel_type || 'match'; r.result = null; r.sets = []; r.players = ['', '', '', '']; }
      if (input.type === 'cardio') {
        r.cardioType = clip(input.cardio_type, 40) || 'Run';
        if (input.distance != null && input.distance > 0) { r.distance = input.distance; r.distanceUnit = input.distance_unit || 'km'; }
      }
      if (input.type === 'resistance') {
        r.exercises = (input.exercises || []).map((e) => ({ name: clip(e.name, 60), sets: e.sets || null, reps: e.reps || null, value: e.value != null ? e.value : null, unit: e.unit || 'kg' })).filter((e) => e.name).slice(0, 30);
        r.bodyweight = null;
      }
      if (input.type === 'yoga') r.focus = clip(input.focus, 80);
      if (input.type === 'hiit') r.outline = clip(input.outline, 500);
      return add({ kind: 'session_create', collection: SESSIONS, id: newId('s'), before: null, after: r, auto: true });
    }
    if (name === 'log_weight') {
      if (!dateOk(input.date) || !notFuture(input.date)) return { error: 'date must be YYYY-MM-DD, and not in the future' };
      if (!(input.kg > 25 && input.kg < 350)) return { error: 'That weight is out of range; it is in kg.' };
      return add({ kind: 'session_create', collection: SESSIONS, id: newId('s'), before: null, auto: true,
        after: { type: 'weight', date: input.date, weightKg: Math.round(input.kg * 10) / 10, createdAt: nowIso, notes: '', activityTime: '', createdVia: 'claude' } });
    }
    if (name === 'log_steps') {
      if (!dateOk(input.date) || !notFuture(input.date)) return { error: 'date must be YYYY-MM-DD, and not in the future' };
      if (!(input.steps >= 0 && input.steps <= 200000)) return { error: 'steps out of range' };
      if (changes.some((c) => c.kind === 'steps_set' && c.date === input.date)) return { error: 'That day\'s steps are already in this answer.' };
      const ss = (await sessionsIn(input.date, input.date)).filter((s) => s.type === 'steps')
        .sort((a, b) => String(b.loggedAt || b.updatedAt || b.createdAt || '').localeCompare(String(a.loggedAt || a.updatedAt || a.createdAt || '')));
      const cur = ss[0] || null;
      if (cur && Number(cur.steps) === input.steps) return { error: 'That is already the day\'s total.' };
      return add({ kind: 'steps_set', collection: SESSIONS, id: cur ? cur.id : newId('s'), date: input.date, steps: input.steps,
        before: cur ? { steps: cur.steps } : null, auto: !cur });
    }
    if (name === 'log_food') {
      if (!dateOk(input.date) || !notFuture(input.date)) return { error: 'date must be YYYY-MM-DD, and not in the future' };
      const lines = (input.lines || []).map((l) => clip(l, 200)).filter(Boolean).slice(0, 20);
      if (!lines.length && !input.rating) return { error: 'Nothing to log.' };
      if (changes.some((c) => c.kind === 'food_add' && c.date === input.date)) return { error: 'That day\'s food is already in this answer; log it all in one call.' };
      const n = (await sessionsIn(input.date, input.date)).find((s) => s.type === 'nutrition') || null;
      const replacing = !!(input.rating && n && n.dayRating && n.dayRating !== input.rating);
      return add({ kind: 'food_add', collection: SESSIONS, id: n ? n.id : newId('s'), date: input.date, lines, rating: input.rating || null,
        before: n ? { foodDiary: n.foodDiary || '', dayRating: n.dayRating || null } : null, auto: !replacing });
    }
    if (name === 'log_goal_value') {
      const g = await get(PRIORITIES, input.goal_id);
      if (!g) return { error: 'No goal has that id. Use list_goals.' };
      if (!(g.measure && g.measure.kind === 'number')) return { error: 'That goal has no number to track. Shaun can add one in Me → Goals.' };
      if (!dateOk(input.date) || !notFuture(input.date)) return { error: 'date must be YYYY-MM-DD, and not in the future' };
      if (!isFinite(input.value)) return { error: 'value must be a number' };
      const same = (g.values || []).find((v) => v && v.date === input.date);
      if (same && Number(same.value) === input.value) return { error: 'That value is already recorded for that day.' };
      return add({ kind: 'goal_value', collection: PRIORITIES, id: g.id, title: clip(g.title, 120), unit: g.measure.unit || null, date: input.date, value: input.value,
        before: { value: same ? same.value : null }, auto: !same });
    }
    if (name === 'add_day_note') {
      if (!dateOk(input.date)) return { error: 'date must be YYYY-MM-DD' };
      const text = clip(input.text, 500);
      if (!text) return { error: 'Nothing to add.' };
      const p = await get(PLANS, input.date);
      return add({ kind: 'day_note', collection: PLANS, id: input.date, text, before: { dayNotes: (p && p.dayNotes) || '' }, auto: true });
    }
    if (name === 'set_intention') {
      if (!dateOk(input.date)) return { error: 'date must be YYYY-MM-DD' };
      const text = clip(input.text, 140);
      if (!text) return { error: 'An intention needs words.' };
      const p = await get(PLANS, input.date);
      const cur = (p && p.morningPrime && p.morningPrime.intention) || '';
      if (cur.trim() === text) return { error: 'That is already the intention.' };
      return add({ kind: 'intention', collection: PLANS, id: input.date, text, before: { intention: cur }, auto: !cur.trim() });
    }
    if (name === 'log_conversation') {
      const v = await get(CONVERSATIONS, input.conversation_id);
      if (!v) return { error: 'No conversation has that id. Use list_comms.' };
      const text = clip(input.text, 300);
      if (!text || LOG_KINDS.indexOf(input.kind) === -1) return { error: 'A movement needs a kind and words.' };
      return add({ kind: 'comms_log', collection: CONVERSATIONS, id: v.id, name: convView(v).name, logKind: input.kind, text, at: nowIso, before: null, auto: true });
    }
    if (name === 'log_life_context') {
      if (LC_CATEGORIES.indexOf(input.category) === -1 || !dateOk(input.start_date)) return { error: 'A circumstance needs a category and a start date.' };
      if (input.end_date && (!dateOk(input.end_date) || input.end_date < input.start_date)) return { error: 'end_date must be on or after the start' };
      const areas = (input.areas || []).filter((a) => LC_AREAS.indexOf(a) > -1);
      const end = input.end_date || null;
      return add({ kind: 'life_context', collection: LIFE, id: newId('lc'), before: null, auto: true, after: {
        category: input.category, label: null, note: clip(input.note, 500) || null, startDate: input.start_date, endDate: end,
        areas: areas.length ? areas : ['day'], status: end && end < ctx.today ? 'resolved' : 'active', createdAt: nowIso, resolvedAt: null } });
    }

    if (name === 'propose_goal') {
      const title = clip(input.title, 200);
      if (!title) return { error: 'A goal needs a title.' };
      let period = ctx.today.slice(0, 4), parentId = null;
      if (input.horizon === 'quarter') {
        period = input.quarter && /^\d{4}-Q[1-4]$/.test(input.quarter) ? input.quarter : quarterOf(ctx.today);
        if (input.parent_id) {
          const p = await get(PRIORITIES, input.parent_id);
          if (!p || p.horizon === 'quarter') return { error: 'parent_id must be a year goal. Use list_goals.' };
          parentId = p.id;
        }
      }
      const measure = input.target != null && isFinite(input.target) ? { kind: 'number', unit: clip(input.unit, 16) || null, start: input.start != null && isFinite(input.start) ? input.start : null, target: input.target } : null;
      return add({ kind: 'goal_create', collection: PRIORITIES, id: newId('g'), before: null, auto: false, after: {
        title, area: input.area, horizon: input.horizon, period, parentId, why: clip(input.why, 300) || null, note: null,
        status: 'active', evidenceType: null, measure, values: [], createdAt: nowIso } });
    }
    if (name === 'propose_update_goal') {
      const g = await get(PRIORITIES, input.id);
      if (!g) return { error: 'No goal has that id. Use list_goals.' };
      if (changes.some((c) => c.collection === PRIORITIES && c.id === g.id && c.kind === 'goal_update')) return { error: 'That goal already has a change in this answer.' };
      const patch = {};
      if (input.title != null) { const t = clip(input.title, 200); if (!t) return { error: 'A title cannot be empty.' }; if (t !== g.title) patch.title = t; }
      const st = g.status === 'achieved' || g.status === 'dropped' ? g.status : 'active';
      if (input.status != null && input.status !== st) { patch.status = input.status; patch.closedAt = input.status === 'active' ? null : nowIso; }
      if (!Object.keys(patch).length) return { error: 'Nothing would change.' };
      const before = {}; Object.keys(patch).forEach((k) => { before[k] = k === 'status' ? st : (g[k] == null ? null : g[k]); });
      return add({ kind: 'goal_update', collection: PRIORITIES, id: g.id, title: clip(g.title, 120), before, patch, auto: false });
    }
    if (name === 'propose_outcome') {
      if (!dateOk(input.date)) return { error: 'date must be YYYY-MM-DD' };
      const text = clip(input.text, 200);
      if (!text) return { error: 'An outcome needs words.' };
      let goal = null;
      if (input.goal_id) { goal = await get(PRIORITIES, input.goal_id); if (!goal) return { error: 'No goal has that id. Use list_goals.' }; }
      const ws = await weekStartOf(input.date);
      return add({ kind: 'outcome_add', collection: WEEKS, id: ws, before: null, auto: false,
        outcome: { id: newId('o'), text, goalId: goal ? goal.id : null, area: (goal && goal.area) || input.area, result: null, note: null },
        goal: goal ? clip(goal.title, 120) : null });
    }
    if (name === 'propose_outcome_result') {
      const ws = await all(WEEKS);
      let found = null, week = null;
      ws.forEach((w) => { (w.outcomes || []).forEach((o) => { if (o && o.id === input.outcome_id) { found = o; week = w.id; } }); });
      if (!found) return { error: 'No outcome has that id. Use get_week.' };
      if ((found.result || null) === (input.result || null)) return { error: 'Nothing would change.' };
      return add({ kind: 'outcome_result', collection: WEEKS, id: week, outcomeId: found.id, text: clip(found.text, 120),
        before: { result: found.result || null }, result: input.result || null, auto: false });
    }
    if (name === 'propose_conversation_state') {
      const v = await get(CONVERSATIONS, input.conversation_id);
      if (!v) return { error: 'No conversation has that id. Use list_comms.' };
      if (input.follow_up && !dateOk(input.follow_up)) return { error: 'follow_up must be YYYY-MM-DD' };
      const cur = v.attentionState || 'needs_me';
      if (cur === input.state && !input.waiting_on && !input.follow_up) return { error: 'Nothing would change.' };
      return add({ kind: 'conv_state', collection: CONVERSATIONS, id: v.id, name: convView(v).name, state: input.state,
        waitingOn: clip(input.waiting_on, 80) || null, followUp: input.follow_up || null,
        before: { attentionState: cur, waitingOn: v.waitingOn || null, nextFollowUpAt: v.nextFollowUpAt || null }, auto: false });
    }
    return null;
  }

  return { readTool, proposeTool };
}

module.exports = { createLedgerTools, TOOLS, READS, SYSTEM_EXTRA, addDays };
