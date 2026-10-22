// Ledger — Home: the push engine's handleHomeUpdate and the migration (functions/migrate.js),
// against the Firestore emulator.
//
//   cd functions && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node ../tests/functions/home.test.js"

const path = require('path');
const fnDir = path.join(__dirname, '../../functions');
const admin = require(path.join(fnDir, 'node_modules/firebase-admin'));
const { createEngine } = require(path.join(fnDir, 'push.js'));
const { createMigrator } = require(path.join(fnDir, 'migrate.js'));

admin.initializeApp({ projectId: 'demo-ledger' });
const db = admin.firestore();
const APP = 'https://ledger.sgj.luxe/';
const KEY = 'BPublicKeyCurrent';

let passed = 0, failed = 0;
function check(cond, name, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
}
let sent = [];
async function send(sub, body) { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) }); }
const engine = createEngine({ db, send, deleteField: () => admin.firestore.FieldValue.delete() });
const sub = (uid, dev) => ({ userUid: uid, endpoint: 'https://push.example/' + uid + '/' + dev, keys: { p256dh: 'p', auth: 'a' }, deviceId: dev, vapidPublicKey: KEY });
const to = (uid) => sent.filter((s) => s.endpoint.indexOf('/' + uid + '/') > -1);
const who = () => Array.from(new Set(sent.map((s) => s.endpoint.split('/')[3]))).sort().join(',');
const reset = () => { sent = []; };
let n = 0;
const fire = (rid, u) => engine.handleHomeUpdate({ update: u, requestId: rid, updateId: 'u' + (++n), appUrl: APP, vapidPublicKey: KEY });

(async () => {
  for (const [uid, role] of [['shaun', 'owner'], ['abi', 'partner'], ['maria', 'household'], ['ex', 'household'], ['eve', 'household']])
    await db.doc('ledger_users/' + uid).set({ role });
  await db.doc('ledger_homes/shaun').set({ name: 'Home', ownerUid: 'shaun' });
  const M = (role, status, name) => ({ homeId: 'shaun', role, status, displayName: name });
  await db.doc('ledger_home_members/shaun').set(M('admin', 'active', 'Shaun'));
  await db.doc('ledger_home_members/abi').set(M('admin', 'active', 'Abi'));
  await db.doc('ledger_home_members/maria').set(M('member', 'active', 'Maria'));
  await db.doc('ledger_home_members/ex').set(M('member', 'removed', 'Ex'));
  for (const [u, d] of [['shaun', 'iphone'], ['shaun', 'mac'], ['abi', 'iphone'], ['maria', 'android'], ['ex', 'phone'], ['eve', 'phone']])
    await db.doc('ledger_push_subscriptions/' + u + '_' + d).set(sub(u, d));
  const R = (o) => Object.assign({ homeId: 'shaun', text: 'Bath at six', visibility: 'private', status: 'requested' }, o);
  await db.doc('ledger_home_requests/r1').set(R({ requesterUid: 'shaun', assigneeUid: 'maria', createdByUid: 'shaun', participants: ['shaun', 'maria'] }));
  await db.doc('ledger_home_requests/r2').set(R({ text: 'Nappies running low', requesterUid: 'maria', assigneeUid: 'abi', createdByUid: 'maria', participants: ['maria', 'abi'] }));
  await db.doc('ledger_home_requests/r3').set(R({ text: 'Book the dentist', requesterUid: 'abi', assigneeUid: 'shaun', createdByUid: 'shaun', participants: ['abi', 'shaun'] }));

  // created → the assignee, as from the requester
  reset(); let r = await fire('r1', { type: 'created', actorUid: 'shaun' });
  check(who() === 'maria' && to('maria')[0].payload.title === 'Shaun sent a request' && to('maria')[0].payload.body === 'Bath at six' && to('maria')[0].payload.url === APP + '?home=r1',
    'Shaun asks Maria → Maria: "Shaun sent a request" / its text, opening it', sent.map((s) => s.payload));
  reset(); await fire('r2', { type: 'created', actorUid: 'maria' });
  check(who() === 'abi' && to('abi')[0].payload.title === 'Maria sent a request', 'Maria asks Abi → only Abi (Shaun is not following)', who());
  reset(); await fire('r3', { type: 'created', actorUid: 'shaun' });
  check(who() === 'shaun' && to('shaun').length === 2 && to('shaun')[0].payload.title === 'Abi sent a request', 'Shaun records one from Abi for himself → all his devices, as if from Abi', who());
  // following Home (opt-in, admins only)
  await db.doc('ledger_notification_prefs/shaun').set({ homeOversight: true });
  reset(); await fire('r2', { type: 'created', actorUid: 'maria' });
  check(who() === 'abi,shaun' && to('shaun')[0].payload.title === 'Maria asked Abi', 'Shaun following Home: "Maria asked Abi"', sent.map((s) => s.payload.title));
  await db.doc('ledger_notification_prefs/maria').set({ homeOversight: true });
  reset(); await fire('r3', { type: 'created', actorUid: 'shaun' });
  check(who() === 'shaun', 'a member who is not an admin never follows Home (Maria opted in, still nothing)', who());
  // a task someone adds for themselves: their own idea, or asked of them in person
  await db.doc('ledger_home_requests/s1').set(R({ text: 'Sort the toy box', requesterUid: 'maria', assigneeUid: 'maria', createdByUid: 'maria', participants: ['maria'], visibility: 'home' }));
  reset(); await fire('s1', { type: 'created', actorUid: 'maria' });
  check(who() === 'shaun' && to('shaun')[0].payload.title === 'Maria added a task' && to('shaun')[0].payload.body === 'Sort the toy box',
    'Maria adds her own task → never told herself; Shaun, following Home: "Maria added a task"', sent.map((s) => s.endpoint + ' ' + s.payload.title));
  await db.doc('ledger_home_requests/s2').set(R({ text: 'Fold the washing', requesterUid: 'abi', assigneeUid: 'maria', createdByUid: 'maria', participants: ['abi', 'maria'] }));
  reset(); await fire('s2', { type: 'created', actorUid: 'maria' });
  check(who() === 'maria,shaun' && to('maria')[0].payload.title === 'Abi sent a request' && to('shaun')[0].payload.title === 'Abi asked Maria' && !to('abi').length,
    'Maria writes down what Abi asked in person → as if Abi sent it: Maria "Abi sent a request", Abi nothing; Shaun following: "Abi asked Maria"', sent.map((s) => s.endpoint + ' ' + s.payload.title));
  await db.doc('ledger_home_requests/s1').update({ status: 'done' });
  reset(); await fire('s1', { type: 'status', actorUid: 'maria', metadata: { status: 'done' } });
  check(who() === 'shaun' && to('shaun')[0].payload.title === 'Maria completed “Sort the toy box”' && to('shaun')[0].payload.body === 'Own task', 'her own task done → nobody to tell but Shaun following: "Own task"', sent.map((s) => s.payload));
  // comments → everyone in it but the author
  reset(); await fire('r1', { type: 'comment', actorUid: 'maria', text: 'Done early, all asleep' });
  check(who() === 'shaun' && to('shaun')[0].payload.title === 'Maria updated “Bath at six”' && to('shaun')[0].payload.body === 'Done early, all asleep', 'Maria adds an update → Shaun');
  reset(); await fire('r1', { type: 'comment', actorUid: 'shaun', text: 'Thank you' });
  check(who() === 'maria', 'Shaun adds one → Maria, never back to Shaun');
  // done, can't do
  await db.doc('ledger_home_requests/r1').update({ status: 'done' });
  reset(); await fire('r1', { type: 'status', actorUid: 'maria', metadata: { status: 'done' } });
  check(who() === 'shaun' && to('shaun')[0].payload.title === 'Maria completed your request', 'Maria completes it → Shaun: "Maria completed your request"');
  await db.doc('ledger_notification_prefs/abi').set({ homeOversight: true });
  reset(); await fire('r1', { type: 'status', actorUid: 'maria', metadata: { status: 'done' } });
  check(who() === 'abi,shaun' && to('abi')[0].payload.title === 'Maria completed “Bath at six”' && to('abi')[0].payload.body === 'Asked by Shaun', 'Abi following Home: "Maria completed “Bath at six”" · Asked by Shaun');
  await db.doc('ledger_notification_prefs/abi').set({ homeOversight: false });
  await db.doc('ledger_home_requests/r2').update({ status: 'cant_do', cantDoReason: 'Out until Friday' });
  reset(); await fire('r2', { type: 'cant_do', actorUid: 'abi' });
  check(who() === 'maria' && to('maria')[0].payload.title === 'Abi can’t do “Nappies running low”' && to('maria')[0].payload.body === 'Out until Friday', 'Abi can\'t do it → Maria, with the reason');
  reset(); await fire('r2', { type: 'status', actorUid: 'abi', metadata: { status: 'in_progress' } });
  check(sent.length === 0, 'starting it is quiet');
  // reassigned → the new assignee
  await db.doc('ledger_home_requests/r2').update({ assigneeUid: 'shaun', participants: ['maria', 'abi', 'shaun'], status: 'requested' });
  reset(); await fire('r2', { type: 'reassigned', actorUid: 'abi', metadata: { fromUid: 'abi', toUid: 'shaun' } });
  check(who() === 'shaun' && to('shaun')[0].payload.title === 'Abi passed you a request', 'Abi passes it to Shaun → Shaun: "Abi passed you a request"');
  // trust: nothing for people no longer (or never) at Home, and nothing a stray entry claims
  reset(); r = await fire('r1', { type: 'comment', actorUid: 'ex', text: 'hello' });
  check(sent.length === 0 && r.skipped === 'not at Home', 'an entry by someone removed sends nothing');
  reset(); r = await fire('r1', { type: 'comment', actorUid: 'eve', text: 'hello' });
  check(sent.length === 0 && r.skipped === 'not at Home', 'an entry by someone never at Home sends nothing');
  await db.doc('ledger_home_requests/r4').set(R({ requesterUid: 'shaun', assigneeUid: 'ex', createdByUid: 'shaun', participants: ['shaun', 'ex'] }));
  reset(); await fire('r4', { type: 'created', actorUid: 'shaun' });
  check(sent.length === 0, 'a removed member is never notified');
  await db.doc('ledger_home_requests/r5').set(R({ requesterUid: 'shaun', assigneeUid: 'maria', createdByUid: 'shaun', participants: ['shaun', 'maria'], deletedAt: 'x' }));
  reset(); r = await fire('r5', { type: 'created', actorUid: 'shaun' });
  check(sent.length === 0 && r.skipped === 'deleted', 'a deleted request notifies nobody');
  reset();
  await engine.handleHomeUpdate({ update: { type: 'comment', actorUid: 'maria', text: 'once' }, requestId: 'r1', updateId: 'same', appUrl: APP });
  const first = sent.length;
  r = await engine.handleHomeUpdate({ update: { type: 'comment', actorUid: 'maria', text: 'once' }, requestId: 'r1', updateId: 'same', appUrl: APP });
  check(first === 2 && sent.length === 2 && r.skipped === 'duplicate', 'the same entry twice notifies once');
  await db.doc('ledger_notification_prefs/shaun').set({ partner: false, homeOversight: true });
  reset(); await fire('r1', { type: 'comment', actorUid: 'maria', text: 'x' });
  check(sent.length === 0, 'Shaun turned requests off: nothing');
  await db.doc('ledger_notification_prefs/shaun').delete();

  // ---- a list sent in one go: one notification each, never one per line ----
  const LB = (id, o) => Promise.all([
    db.doc('ledger_home_requests/' + id).set(R(Object.assign({ requesterUid: 'abi', assigneeUid: 'maria', createdByUid: 'abi', participants: ['abi', 'maria'] }, o))),
    db.doc('ledger_home_requests/' + id + '/updates/created').set({ type: 'created', actorUid: (o && o.createdByUid) || 'abi', metadata: { batchId: (o && o.bid) || 'B1' } })]);
  await LB('L1', { text: 'Empty the dishwasher' }); await LB('L2', { text: 'Wash the school uniform' }); await LB('L3', { text: 'Tidy the toy box' });
  await LB('L4', { text: 'Collect the parcel' }); await LB('L5', { text: 'Ring Shaun about pickup', assigneeUid: 'shaun', participants: ['abi', 'shaun'] });
  await LB('L6', { text: 'Not in this list', bid: 'OTHER' });
  await LB('L7', { text: 'Written by someone else', createdByUid: 'maria', requesterUid: 'maria', assigneeUid: 'abi' });
  await LB('L8', { text: 'Deleted before it went', deletedAt: 'x' });
  reset(); r = await fire('L1', { type: 'created', actorUid: 'abi', metadata: { batchId: 'B1' } });
  check(sent.length === 0 && r.skipped === 'in a list', 'a line of a list does not notify on its own');
  const batch = (id, o) => engine.handleHomeBatch({ batch: Object.assign({ homeId: 'shaun', createdByUid: 'abi', batchId: 'B1', requestIds: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'nope'] }, o), batchDocId: id, appUrl: APP, vapidPublicKey: KEY });
  reset(); r = await batch('B1');
  check(to('maria').length === 1 && to('maria')[0].payload.title === 'Abi sent you 4 requests'
    && to('maria')[0].payload.body === 'Empty the dishwasher, Wash the school uniform, Tidy the toy box and 1 more' && to('maria')[0].payload.url === APP + '?home=all',
    'Maria: ONE notification, "Abi sent you 4 requests", the first three and "1 more", opening Home', to('maria').map((x) => x.payload));
  check(to('shaun').length === 2 && to('shaun')[0].payload.title === 'Abi sent a request' && to('shaun')[0].payload.body === 'Ring Shaun about pickup' && to('shaun')[0].payload.url === APP + '?home=L5',
    'Shaun, sent one line of it: "Abi sent a request", opening that request (both his devices)');
  check(r.requests === 5, 'only lines that are really this list count: not another list, not someone else\'s, not deleted, not a missing id', r.requests);
  reset(); r = await batch('B1');
  check(sent.length === 0 && r.skipped === 'duplicate', 'the same summary twice notifies once');
  reset(); r = await batch('B1x', { createdByUid: 'maria', requestIds: ['L1', 'L2', 'L3'] });
  check(sent.length === 0 && r.skipped === 'nothing to announce', 'a summary claiming someone else\'s requests announces nothing');
  reset(); r = await batch('B1y', { createdByUid: 'ex' });
  check(sent.length === 0 && r.skipped === 'not at Home', 'a summary by someone removed announces nothing');
  await db.doc('ledger_notification_prefs/shaun').set({ homeOversight: true });
  await LB('L9', { text: 'Fold the towels', bid: 'B2' }); await LB('L10', { text: 'Water the plants', bid: 'B2' });
  reset(); r = await engine.handleHomeBatch({ batch: { homeId: 'shaun', createdByUid: 'abi', batchId: 'B2', requestIds: ['L9', 'L10'] }, batchDocId: 'B2', appUrl: APP });
  check(to('maria').length === 1 && to('shaun').length === 2 && to('shaun')[0].payload.title === 'Abi asked Maria for 2 things', 'Shaun following Home hears it once: "Abi asked Maria for 2 things"', to('shaun').map((x) => x.payload.title));
  await db.doc('ledger_notification_prefs/shaun').delete();

  // ---- recurring responsibilities: made by the server, announced by the same engine ----
  await db.doc('ledger_home_requests/t1_20261025').set(R({ text: 'School uniform ready', requesterUid: 'abi', assigneeUid: 'maria', createdByUid: 'abi', participants: ['abi', 'maria'], recurringId: 't1', occurrenceDate: '2026-10-25' }));
  reset(); await fire('t1_20261025', { type: 'created', actorUid: 'abi', metadata: { recurring: 't1', occurrence: '2026-10-25', mode: 'assigned' } });
  check(who() === 'maria' && to('maria')[0].payload.title === 'Today: School uniform ready' && to('maria')[0].payload.body === 'Regular, from Abi', 'a recurring one, due today → its person: "Today: …" · "Regular, from Abi"', sent.map((x) => x.payload));
  await db.doc('ledger_home_requests/t3_20261025').set(R({ text: 'Water the plants', requesterUid: 'maria', assigneeUid: 'maria', createdByUid: 'maria', participants: ['maria'], visibility: 'home', recurringId: 't3', occurrenceDate: '2026-10-25' }));
  reset(); await fire('t3_20261025', { type: 'created', actorUid: 'maria', metadata: { recurring: 't3', occurrence: '2026-10-25', mode: 'assigned' } });
  check(who() === 'maria' && to('maria')[0].payload.title === 'Today: Water the plants' && to('maria')[0].payload.body === 'Regular', 'her own recurring one → her reminder: "Today: …" · "Regular"', sent.map((x) => x.payload));
  await db.doc('ledger_home_requests/t2_20261026').set(R({ text: 'Bins out', requesterUid: 'abi', assigneeUid: null, createdByUid: 'abi', participants: ['abi'], visibility: 'home', recurringId: 't2', occurrenceDate: '2026-10-26' }));
  reset(); await fire('t2_20261026', { type: 'created', actorUid: 'abi', metadata: { recurring: 't2', occurrence: '2026-10-26', mode: 'anyone' } });
  check(who() === 'maria,shaun' && to('maria')[0].payload.title === 'Today at Home: Bins out' && to('maria')[0].payload.body === 'Anyone can take it', 'anyone at Home → everyone at Home but Abi who set it up (and never the removed)', who());
  await db.doc('ledger_home_requests/t2_20261026').update({ assigneeUid: 'maria', participants: ['abi', 'maria'] });
  reset(); await fire('t2_20261026', { type: 'claimed', actorUid: 'maria' });
  check(who() === 'abi' && to('abi')[0].payload.title === 'Maria will do “Bins out”', '"I’ll do it" → Abi: "Maria will do “Bins out”"');
  reset(); await fire('t1_20261025', { type: 'missed', actorUid: 'abi', metadata: { next: '2026-11-01' } });
  check(sent.length === 0, 'missed: nobody is told');

  // ---- the migration ----
  const H = (id, o) => db.doc('ledger_shared_requests/' + id).set(Object.assign({ ownerUid: 'shaun', partnerUid: 'abi', note: null, requestedTiming: 'today', requestedDate: null,
    createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-01T09:00:00Z' }, o));
  await H('old1', { text: 'Pick up prescription', status: 'done', plannedDate: '2026-10-02', linkedActionId: 'actOld1', processedAt: 'p', latestUpdateBy: 'system', latestUpdateType: 'status',
    latestCommentAt: 'c', latestCommentBy: 'partner', latestCommentText: 'Thanks', ownerLastReadAt: 'o', partnerLastReadAt: 'q' });
  await H('old2', { text: 'Renew insurance', status: 'requested', createdByUid: 'shaun', createdByRole: 'owner' });
  await H('old3', { text: 'Typo', status: 'requested', deletedAt: 'd', deletedByUid: 'abi', deletedByRole: 'partner' });
  await H('old4', { text: 'Withdrawn thing', status: 'withdrawn', partnerHiddenAt: 'h' });
  const U = (id, o) => db.doc('ledger_shared_request_updates/' + id).set(Object.assign({ ownerUid: 'shaun', partnerUid: 'abi', text: null, metadata: {} }, o));
  await U('old1_created', { requestId: 'old1', type: 'request_created', actorUid: 'abi', actorRole: 'partner', createdAt: admin.firestore.Timestamp.fromDate(new Date('2026-10-01T09:00:00Z')) });
  await U('e2', { requestId: 'old1', type: 'comment', actorUid: 'abi', actorRole: 'partner', text: 'Thanks', createdAt: admin.firestore.Timestamp.fromDate(new Date('2026-10-02T10:00:00Z')) });
  await U('e3', { requestId: 'old1', type: 'status', actorUid: 'shaun', actorRole: 'system', metadata: { status: 'done' }, createdAt: admin.firestore.Timestamp.fromDate(new Date('2026-10-02T11:00:00Z')) });
  const mig = createMigrator({ db });
  let thrown = null; try { await mig.migrate('abi'); } catch (e) { thrown = e.message; }
  check(thrown === 'Not an owner', 'only an owner can move requests');
  let out = await mig.migrate('shaun');
  check(out.migrated === 4 && out.skipped === 0 && out.updates === 3 && !out.errors.length, 'four requests and their history move into Home', out);
  const m1 = (await db.doc('ledger_home_requests/old1').get()).data();
  check(m1.homeId === 'shaun' && m1.requesterUid === 'abi' && m1.assigneeUid === 'shaun' && m1.createdByUid === 'abi' && m1.visibility === 'private'
    && JSON.stringify(m1.participants.sort()) === '["abi","shaun"]' && m1.status === 'done' && m1.linkedActionId === 'actOld1' && m1.linkedByUid === 'shaun',
    'mapped: requester Abi, assignee Shaun, creator Abi, private to the two of them, done, still linked to the same Action id', m1);
  check(m1.latestUpdateByUid === 'shaun' && m1.latestCommentByUid === 'abi' && m1.readAt.shaun === 'o' && m1.readAt.abi === 'q', 'summary and both read marks carried over');
  const m2 = (await db.doc('ledger_home_requests/old2').get()).data();
  check(m2.createdByUid === 'shaun' && m2.requesterUid === 'abi', 'an on-behalf request keeps Shaun as its creator, Abi as requester');
  const m3 = (await db.doc('ledger_home_requests/old3').get()).data();
  check(m3.deletedAt === 'd' && m3.deletedByUid === 'abi', 'a deleted request stays deleted');
  const m4 = (await db.doc('ledger_home_requests/old4').get()).data();
  check(m4.status === 'withdrawn' && m4.hiddenFor && m4.hiddenFor.abi === 'h', 'withdrawn and hidden from Abi, still');
  const hist = (await db.collection('ledger_home_requests/old1/updates').get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  check(hist.length === 3 && hist.some((e) => e.type === 'created' && e.actorUid === 'abi') && hist.some((e) => e.type === 'comment' && e.text === 'Thanks')
    && hist.every((e) => e.createdAt && e.createdAt.toDate), 'its history keeps who and when ("asked" becomes "created")');
  const oldDoc = (await db.doc('ledger_shared_requests/old1').get()).data();
  check(oldDoc.migratedTo === 'old1' && oldDoc.text === 'Pick up prescription', 'the old record stays, marked as moved');
  out = await mig.migrate('shaun');
  check(out.migrated === 0 && out.skipped === 4, 'running it again copies nothing twice', out);
  const histAgain = (await db.collection('ledger_home_requests/old1/updates').get()).size;
  check(histAgain === 3, '…and no history twice');
  await H('old5', { text: 'Asked from an old app after the move', status: 'requested' });
  out = await mig.migrate('shaun');
  check(out.migrated === 1 && out.skipped === 4, 'a request made on an old app after the move is picked up next time');

  // the copied history announces nothing (each copied entry fires the trigger)
  reset();
  for (const e of hist) await engine.handleHomeUpdate({ update: e, requestId: 'old1', updateId: 'mig_' + e.id, appUrl: APP });
  check(sent.length === 0, 'history copied in by the move notifies nobody');
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
