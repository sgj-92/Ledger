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
