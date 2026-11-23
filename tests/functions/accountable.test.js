// Ledger — the aCcountable sync, the server half (functions/accountable.js), against the
// Firestore emulator with a stand-in aCcountable: a day in is signed, applied only where it
// differs and marked; two cardio sessions stay two; aCcountable's meals lead; its food fills
// the day while Ledger's rating and checks stay; weight in and out; Ledger's day goes back
// signed, in the contract's shape; and nothing echoes.
//
//   cd functions && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node ../tests/functions/accountable.test.js"

const path = require('path');
const crypto = require('crypto');
const fnDir = path.join(__dirname, '../../functions');
const admin = require(path.join(fnDir, 'node_modules/firebase-admin'));
const { createAccountable, sign, mealId } = require(path.join(fnDir, 'accountable.js'));

admin.initializeApp({ projectId: 'demo-ledger' });
const db = admin.firestore();

let passed = 0, failed = 0;
function check(cond, name, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const URL_ = 'https://acc.example/functions/v1/ledger-sync';
let NOW = new Date('2026-11-24T09:00:00Z');
const sent = [];
let answer = 200;
async function fakeFetch(url, init) {
  sent.push({ url, headers: init.headers, body: init.body });
  return { ok: answer < 300, status: answer, json: async () => ({}) };
}
const acc = () => createAccountable({ db, fetch: fakeFetch, secret: SECRET, url: URL_, now: () => NOW });
const D = '2026-11-24';
const get = async (p) => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
const day = (over) => Object.assign({
  v: 1, origin: 'accountable', date: D,
  training: [
    { ref: 'acc:session:run1', type: 'cardio', title: 'Run', startTime: '07:00', durationMin: 30 },
    { ref: 'acc:session:walk1', type: 'cardio', title: 'Walk', startTime: '18:00', durationMin: 45 },
    { ref: 'acc:session:pad1', type: 'padel', title: 'Padel', startTime: '19:30', durationMin: 90 }
  ],
  meals: [
    { ref: 'acc:meal:2026-11-24:lunch', name: 'Meal 2', time: '13:00', tag: 'pre', kcal: 620, done: false,
      foods: [{ name: 'Chicken breast', amount: '180 g', kcal: 216, done: false }, { name: 'Basmati rice (dry)', amount: '100 g', kcal: 350, done: false }],
      planned: [{ planItemId: 'x', grams: 180 }] },
    { ref: 'acc:meal:2026-11-24:breakfast', name: 'Meal 1', time: '08:00', tag: null, kcal: 400, done: true, foods: [{ name: 'Eggs', amount: '2 eggs', kcal: 143 }] }
  ],
  nutrition: { eatenKcal: 1204, proteinG: 96, carbsG: 140, fatG: 31, targetKcal: 2400, targetProteinG: 180, targetCarbsG: 270, targetFatG: 67,
    dayType: 'Padel day', diaryOnly: false, diary: ['Meal 1: Eggs · 2 eggs · 100 g (143 kcal)'] },
  weightKg: 98.3
}, over || {});

(async () => {
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/demo-ledger/databases/(default)/documents', { method: 'DELETE' });

  // ---- the signature ----
  const raw = JSON.stringify(day());
  const ts = String(NOW.getTime());
  check(acc().verify({ 'x-sync-timestamp': ts, 'x-sync-signature': sign(SECRET, ts, raw) }, raw).ok, 'a signed day is accepted');
  check(acc().verify({ 'x-sync-timestamp': ts, 'x-sync-signature': sign(SECRET, ts, raw) }, raw + ' ').status === 401, 'a changed body is refused (401)');
  check(acc().verify({ 'x-sync-timestamp': ts, 'x-sync-signature': sign('another-secret-0123456789abcdef0123456789', ts, raw) }, raw).status === 401, 'another secret is refused');
  const old = String(NOW.getTime() - 6 * 60 * 1000);
  check(acc().verify({ 'x-sync-timestamp': old, 'x-sync-signature': sign(SECRET, old, raw) }, raw).status === 401, 'more than five minutes old is refused');
  check(acc().verify({}, raw).status === 401, 'no headers: refused');
  check(createAccountable({ db, fetch: fakeFetch, secret: 'short', url: URL_ }).verify({ 'x-sync-timestamp': ts, 'x-sync-signature': sign('short', ts, raw) }, raw).status === 503,
    'without a real secret set, the sync says it isn\'t set up (503)');
  check((await acc().applyDay({ v: 1, origin: 'ledger', date: D })).status === 400, 'a day not from aCcountable is refused (400)');

  // ---- a day in: Ledger already has the day, with its own things on it ----
  await db.doc('ledger_plans/' + D).set({ date: D, restDay: false, trainingTypes: ['yoga'], trainingDetails: { yoga: { activityTime: '06:30', durationMin: 20, notes: 'mine' } },
    meals: [{ id: 'm1', text: 'Porridge', completed: true, completedAt: '2026-11-24T07:00:00Z', nutritionEntryId: 'n1' }, { id: 'm2', text: 'Something', completed: false }],
    morningPrime: { completedAt: '2026-11-24T07:30:00Z' } });
  await db.doc('ledger_sessions/n1').set({ type: 'nutrition', date: D, foodDiary: 'Porridge', dayRating: 'good', glutenFree: true, sufficientWater: true });
  const r1 = await acc().applyDay(day());
  check(r1.status === 200 && r1.body.changed.training && r1.body.changed.meals && r1.body.changed.nutrition && r1.body.changed.weight, 'the day is applied', r1.body);
  let plan = await get('ledger_plans/' + D);
  check(JSON.stringify(plan.trainingTypes) === '["cardio","padel","yoga"]', 'training: cardio and padel added; Ledger\'s yoga, not yet seen by aCcountable, stays', plan.trainingTypes);
  const cardio = plan.trainingDetails.cardio;
  check(cardio.activityTime === '07:00' && cardio.durationMin === 30 && cardio.syncSessions.length === 2 && cardio.syncSessions[1].title === 'Walk' && cardio.syncSessions[1].startTime === '18:00',
    'two cardio sessions stay two: the run leads, the walk is kept with its ref', cardio);
  check(plan.trainingDetails.yoga.notes === 'mine' && plan.morningPrime && plan.morningPrime.completedAt, 'nothing else on the day is touched (yoga\'s notes, Morning Prime)');
  const lunch = plan.meals.find((m) => m.ref === 'acc:meal:2026-11-24:lunch');
  check(plan.meals[0].ref === 'acc:meal:2026-11-24:breakfast' && lunch && lunch.time === '13:00' && lunch.kcal === 620 && lunch.source === 'accountable' && lunch.id === mealId(lunch.ref)
    && /Chicken breast 180 g/.test(lunch.text) && lunch.foods.length === 2 && !('planned' in lunch), 'meals: aCcountable\'s, in time order, with time, kcal and foods (not its bookkeeping)', plan.meals);
  check(plan.meals.some((m) => m.text === 'Porridge' && m.completed) && !plan.meals.some((m) => m.text === 'Something'), 'Ledger\'s ticked meal stays; its unticked one gives way');
  check(plan.meals.find((m) => m.ref === 'acc:meal:2026-11-24:breakfast').completed === true && !lunch.completed, 'done comes across: breakfast done, lunch not');
  check(!!plan.syncedFromAccountableAt, 'the plan is marked as from aCcountable');
  const nut = await get('ledger_sessions/n1');
  check(nut.foodDiary === 'Meal 1: Eggs · 2 eggs · 100 g (143 kcal)' && nut.foodDiarySource === 'accountable' && nut.accountable.eatenKcal === 1204 && nut.accountable.targetProteinG === 180 && nut.accountable.dayType === 'Padel day',
    'nutrition: aCcountable\'s food fills the day\'s record', nut);
  check(nut.dayRating === 'good' && nut.glutenFree === true && nut.sufficientWater === true, 'the day rating and daily checks stay Ledger\'s');
  check(nut.foodDiaryLedger === 'Porridge', 'the diary typed in Ledger first is kept aside, never lost');
  const w = await get('ledger_sessions/acc-weight-' + D);
  check(w && w.type === 'weight' && w.weightKg === 98.3 && w.syncSource === 'accountable', 'weight: a weigh-in for the day');
  const meta = await get('ledger_meta/accountable');
  check(meta && meta.lastInDate === D && meta.lastInAt, 'the app can see when it last heard (ledger_meta/accountable)');

  // ---- nothing echoes ----
  sent.length = 0;
  const e1 = await acc().pushDay(D);
  check(e1.skipped === 'unchanged' && sent.length === 0, 'right after a day in, Ledger has nothing new to send back', e1);

  // ---- the same day again: nothing is written ----
  const before = (await db.doc('ledger_plans/' + D).get()).updateTime;
  NOW = new Date('2026-11-24T09:05:00Z');
  const r2 = await acc().applyDay(day());
  const after = (await db.doc('ledger_plans/' + D).get()).updateTime;
  check(r2.status === 200 && !r2.body.changed.training && !r2.body.changed.meals && !r2.body.changed.nutrition && !r2.body.changed.weight && before.isEqual(after),
    'the same day again changes nothing', r2.body);

  // ---- Ledger changes: the walk moves, a meal is ticked, a weigh-in ----
  plan = await get('ledger_plans/' + D);
  plan.trainingDetails.cardio.activityTime = '07:15';
  plan.trainingDetails.cardio.durationMin = 40;
  plan.meals = plan.meals.map((m) => (m.ref === 'acc:meal:2026-11-24:lunch' ? Object.assign({}, m, { completed: true, completedAt: '2026-11-24T13:10:00Z' }) : m));
  await db.doc('ledger_plans/' + D).set(plan);
  await db.doc('ledger_sessions/w2').set({ type: 'weight', date: D, weightKg: 98.0, activityTime: '23:00', createdAt: '2026-11-24T10:00:00Z' });
  NOW = new Date('2026-11-24T10:00:00Z');
  const o1 = await acc().pushDay(D);
  check(o1.sent === true && sent.length === 1 && sent[0].url === URL_, 'Ledger\'s change goes to aCcountable', o1);
  const msg = JSON.parse(sent[0].body);
  const h = sent[0].headers;
  check(h['x-sync-signature'] === sign(SECRET, h['x-sync-timestamp'], sent[0].body) && h['x-sync-timestamp'] === String(NOW.getTime()), 'signed as the contract says');
  check(msg.v === 1 && msg.origin === 'ledger' && msg.date === D, 'v 1, from Ledger, the day');
  const refs = msg.training.map((t) => t.ref + '@' + t.startTime + '/' + t.durationMin);
  check(JSON.stringify(refs) === JSON.stringify(['acc:session:run1@07:15/40', 'acc:session:walk1@18:00/45', 'acc:session:pad1@19:30/90', 'ledger:2026-11-24:yoga@06:30/20']),
    'every session goes back with its ref: the run as changed, the walk and padel as they were, Ledger\'s yoga as ledger:…', refs);
  check(JSON.stringify(msg.mealsDone) === JSON.stringify(['acc:meal:2026-11-24:breakfast', 'acc:meal:2026-11-24:lunch']), 'mealsDone: the aCcountable meals ticked', msg.mealsDone);
  check(msg.weightKg === 98, 'weightKg: the day\'s latest weigh-in', msg.weightKg);
  sent.length = 0;
  const o2 = await acc().pushDay(D);
  check(o2.skipped === 'unchanged' && !sent.length, 'sent once: the same day isn\'t sent twice');

  // ---- aCcountable fails: it's said, and tried again next time ----
  plan.trainingDetails.padel = Object.assign({}, plan.trainingDetails.padel, { activityTime: '20:00' });
  await db.doc('ledger_plans/' + D).set(plan);
  answer = 500;
  const o3 = await acc().pushDay(D);
  const meta2 = await get('ledger_meta/accountable');
  check(o3.sent === false && /500/.test(meta2.lastError || ''), 'a failed send is recorded for the app to show');
  answer = 200; sent.length = 0;
  check((await acc().pushDay(D)).sent === true && sent.length === 1, 'and goes on the next change');

  // ---- a type aCcountable drops goes; one Ledger has logged stays ----
  plan = await get('ledger_plans/' + D);
  plan.trainingDetails.padel = Object.assign({}, plan.trainingDetails.padel, { completed: true, sessionId: 's9' });
  await db.doc('ledger_plans/' + D).set(plan);
  NOW = new Date('2026-11-24T11:00:00Z');
  await acc().applyDay(day({ training: [{ ref: 'acc:session:run1', type: 'cardio', title: 'Run', startTime: '07:15', durationMin: 40 }] }));
  plan = await get('ledger_plans/' + D);
  check(plan.trainingTypes.indexOf('padel') > -1 && plan.trainingTypes.indexOf('yoga') > -1, 'a logged session and one aCcountable never had both stay', plan.trainingTypes);
  check(plan.trainingDetails.cardio.syncSessions.length === 1, 'the walk aCcountable removed is gone from cardio');

  // ---- an empty day Ledger never spoke about stays quiet ----
  sent.length = 0;
  await db.doc('ledger_plans/2026-11-30').set({ date: '2026-11-30', restDay: false, trainingTypes: [], meals: [], morningPrime: { checks: {} } });
  check((await acc().pushDay('2026-11-30')).skipped === 'empty' && !sent.length, 'a day with nothing on it isn\'t sent');
  check((await createAccountable({ db, fetch: fakeFetch, secret: '', url: URL_ }).pushDay(D)).skipped === 'not set up', 'without the secret, nothing is sent');

  // ---- sizes are bounded, odd values ignored ----
  NOW = new Date('2026-11-25T09:00:00Z');
  const big = day({ date: '2026-11-25', training: [{ ref: 'acc:x', type: 'skydiving', startTime: '25:99' }, { ref: 'acc:y', type: 'yoga', startTime: '7:5', durationMin: 'x' }],
    meals: [{ ref: 'acc:m', name: 'x'.repeat(500), time: 'noon', foods: [] }], weightKg: 9999 });
  const r3 = await acc().applyDay(big);
  const p25 = await get('ledger_plans/2026-11-25');
  check(r3.status === 200 && JSON.stringify(p25.trainingTypes) === '["yoga"]' && p25.trainingDetails.yoga.activityTime === '' && p25.trainingDetails.yoga.durationMin === null
    && p25.meals[0].name.length <= 80 && p25.meals[0].time === null && !(await get('ledger_sessions/acc-weight-2026-11-25')),
    'unknown types, bad times, long names and impossible weights are cleaned, not stored', p25);

  // ---- text only: nothing aCcountable sends can become markup in Ledger ----
  NOW = new Date('2026-11-26T09:00:00Z');
  await acc().applyDay(day({ date: '2026-11-26', training: [{ ref: 'acc:z', type: 'cardio', title: '<img src=x onerror=alert(1)>Run', startTime: '07:00' }],
    meals: [{ ref: 'acc:m2', name: '<b>Lunch</b>', foods: [{ name: '<i>Rice</i>', amount: '100 g' }] }],
    nutrition: Object.assign({}, day().nutrition, { diary: ['<script>x</script>Eggs'] }) }));
  const p26 = await get('ledger_plans/2026-11-26');
  const n26 = await get('ledger_sessions/acc-nutrition-2026-11-26');
  const all26 = JSON.stringify([p26.trainingDetails.cardio.syncSessions, p26.meals, n26.accountable.diary, n26.foodDiary]);
  check(!/[<>]/.test(all26) && /Run/.test(all26) && /Lunch/.test(all26), 'no < or > is stored from aCcountable: titles, meals, foods and diary are text', all26);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
