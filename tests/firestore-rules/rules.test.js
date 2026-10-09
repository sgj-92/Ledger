// Ledger — Firestore security rules tests.
//
// Runs against the Firestore emulator:
//   cd tests/firestore-rules && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node rules.test.js"
//
// Every case is a real request evaluated by the rules in ../../firestore.rules.

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment, assertSucceeds, assertFails
} = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const NOW = () => firebase.firestore.FieldValue.serverTimestamp();

const PRIVATE = [
  'ledger_commitments', 'ledger_plans', 'ledger_sessions', 'ledger_day_status',
  'ledger_priorities', 'ledger_focus', 'ledger_meals', 'ledger_meta',
  'ledger_matters', 'ledger_conversations', 'ledger_challenges', 'ledger_sprints'
];

// a device subscription as the client writes it
const sub = (uid, o) => Object.assign({ userUid: uid, endpoint: 'https://push.example/' + uid, keys: { p256dh: 'BKey', auth: 'auth' },
  deviceId: 'dev-' + uid, deviceLabel: 'Shaun · iPhone', platform: 'ios', vapidPublicKey: 'BPublicKey',
  createdAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-08T09:00:00Z', lastSeenAt: '2026-10-08T09:00:00Z' }, o || {});
// the current focus as the client writes it
const focus = (o) => Object.assign({ ownerUid: 'owner1', type: 'action', sourceId: 'act1', childId: null, title: 'Tidy desk',
  date: '2026-10-08', setAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-08T09:00:00Z', sourceDeviceId: 'dev-mac', status: 'active' }, o || {});

let passed = 0, failed = 0;
async function check(name, fn){
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e){ failed++; console.log('FAIL ' + name + ' — ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-ledger',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') }
  });

  // existing data, written as an administrator would see it (rules bypassed)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('ledger_users/owner1').set({ role: 'owner', displayName: 'Owner', email: 'owner@example.com', createdAt: '2026-10-06' });
    await db.doc('ledger_users/partner1').set({ role: 'partner', displayName: 'Partner', email: 'partner@example.com', createdAt: '2026-10-06' });
    await db.doc('ledger_users/partner2').set({ role: 'partner', displayName: 'Partner B', email: 'b@example.com', createdAt: '2026-10-07' });
    await db.doc('ledger_users/owner2').set({ role: 'owner', displayName: 'Other owner', email: 'o2@example.com', createdAt: '2026-10-07' });
    for (const c of PRIVATE) await db.doc(c + '/seed').set({ seeded: true });
    // push: each user's own devices, and one from before devices had a user
    await db.doc('ledger_push_subscriptions/owner1_dev1').set(sub('owner1'));
    await db.doc('ledger_push_subscriptions/partner1_dev1').set(sub('partner1'));
    await db.doc('ledger_push_subscriptions/sub_legacy').set({ ownerUid: 'owner1', endpoint: 'https://push.example/legacy', keys: { p256dh: 'p', auth: 'a' } });
    await db.doc('ledger_notification_prefs/owner1').set({ currentFocus: true, partner: true });
    await db.doc('ledger_notification_prefs/partner1').set({ currentFocus: true, partner: true });
    await db.doc('ledger_config/push').set({ vapidPublicKey: 'BPublicKey' });
    await db.doc('ledger_push_events/e1').set({ kind: 'focus' });
    await db.doc('ledger_pins/pin1').set({ ownerUid: 'owner1', text: 'x', status: 'sent' });
    await db.doc('ledger_meta/currentFocus').set(focus());
    // sharing: owner1 shares with partner1 (active) and partner2 (paused)
    await db.doc('ledger_share_members/owner1_partner1').set({ ownerUid: 'owner1', partnerUid: 'partner1', role: 'partner', active: true, displayName: 'A' });
    await db.doc('ledger_share_members/owner1_partner2').set({ ownerUid: 'owner1', partnerUid: 'partner2', role: 'partner', active: false, displayName: 'B' });
    await db.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').set({ ownerUid: 'owner1', partnerUid: 'partner1', periodType: 'day', periodKey: '2026-10-07', items: [] });
    await db.doc('ledger_shared_snapshots/owner1_partner2_day_2026-10-07').set({ ownerUid: 'owner1', partnerUid: 'partner2', periodType: 'day', periodKey: '2026-10-07', items: [] });
    await db.doc('ledger_shared_requests/reqA').set({ ownerUid: 'owner1', partnerUid: 'partner1', text: 'Pick up nappies', note: null, requestedTiming: 'today', requestedDate: null, status: 'requested', plannedDate: null, linkedActionId: null, createdAt: 'x', updatedAt: 'x' });
    await db.doc('ledger_shared_requests/reqPlanned').set({ ownerUid: 'owner1', partnerUid: 'partner1', text: 'Call landlord', note: null, requestedTiming: 'week', requestedDate: null, status: 'planned', plannedDate: '2026-10-08', linkedActionId: 'act1', createdAt: 'x', updatedAt: 'x' });
    await db.doc('ledger_shared_request_updates/seedA').set({ requestId: 'reqPlanned', ownerUid: 'owner1', partnerUid: 'partner1', type: 'comment', actorUid: 'partner1', actorRole: 'partner', text: 'Larger size please', createdAt: 'x', metadata: {} });
    await db.doc('ledger_shared_request_updates/seedB').set({ requestId: 'reqB', ownerUid: 'owner1', partnerUid: 'partner2', type: 'comment', actorUid: 'partner2', actorRole: 'partner', text: 'B note', createdAt: 'x', metadata: {} });
    await db.doc('ledger_shared_requests/reqB').set({ ownerUid: 'owner1', partnerUid: 'partner2', text: 'B thing', note: null, requestedTiming: 'none', requestedDate: null, status: 'requested', plannedDate: null, linkedActionId: null, createdAt: 'x', updatedAt: 'x' });
  });

  const anon = env.unauthenticatedContext().firestore();
  const owner = env.authenticatedContext('owner1', { email: 'owner@example.com' }).firestore();
  const partner = env.authenticatedContext('partner1', { email: 'partner@example.com' }).firestore();
  const stranger = env.authenticatedContext('stranger1', { email: 'someone@example.com' }).firestore();
  const partnerB = env.authenticatedContext('partner2', { email: 'b@example.com' }).firestore();
  const owner2 = env.authenticatedContext('owner2', { email: 'o2@example.com' }).firestore();
  const newRequest = (o) => Object.assign({ ownerUid: 'owner1', partnerUid: 'partner1', text: 'Buy milk', note: null,
    requestedTiming: 'today', requestedDate: null, status: 'requested', plannedDate: null, linkedActionId: null,
    createdAt: '2026-10-07T09:00:00Z', updatedAt: '2026-10-07T09:00:00Z' }, o || {});
  // an entry on a request's Updates timeline
  const upd = (o) => Object.assign({ requestId: 'reqPlanned', ownerUid: 'owner1', partnerUid: 'partner1', type: 'comment',
    actorUid: 'partner1', actorRole: 'partner', text: 'An update', createdAt: NOW(), metadata: {} }, o || {});
  const ownerUpd = (o) => upd(Object.assign({ actorUid: 'owner1', actorRole: 'owner' }, o || {}));
  const sysUpd = (o) => upd(Object.assign({ actorUid: 'owner1', actorRole: 'system', text: null }, o || {}));
  const UPD = 'ledger_shared_request_updates';
  const forReq = (db, id, p) => db.collection(UPD).where('requestId', '==', id).where('ownerUid', '==', 'owner1').where('partnerUid', '==', p || 'partner1');

  // ---- signed out ----
  await check('signed out: cannot read private plans', () => assertFails(anon.doc('ledger_plans/seed').get()));
  await check('signed out: cannot list private plans', () => assertFails(anon.collection('ledger_plans').get()));
  await check('signed out: cannot write private actions', () => assertFails(anon.doc('ledger_commitments/x').set({ title: 'x' })));
  await check('signed out: cannot read conversations', () => assertFails(anon.collection('ledger_conversations').get()));
  await check('signed out: cannot access push subscriptions', () => assertFails(anon.collection('ledger_push_subscriptions').get()));
  await check('signed out: cannot create a pin', () => assertFails(anon.collection('ledger_pins').add({ text: 'x' })));
  await check('signed out: cannot read profiles', () => assertFails(anon.doc('ledger_users/owner1').get()));

  // ---- owner ----
  for (const c of PRIVATE){
    await check('owner: can read ' + c, () => assertSucceeds(owner.collection(c).get()));
    await check('owner: can write ' + c, () => assertSucceeds(owner.doc(c + '/owner-write').set({ ok: true })));
    await check('owner: can delete in ' + c, () => assertSucceeds(owner.doc(c + '/owner-write').delete()));
  }
  await check('owner: ordered query (sessions by date) works', () => assertSucceeds(owner.collection('ledger_sessions').orderBy('date', 'desc').get()));
  await check('owner: can read own profile', () => assertSucceeds(owner.doc('ledger_users/owner1').get()));
  await check('owner: can read partner profile', () => assertSucceeds(owner.doc('ledger_users/partner1').get()));
  await check('owner: cannot write profiles from a client', () => assertFails(owner.doc('ledger_users/partner1').set({ role: 'owner' })));

  // ---- partner ----
  await check('partner: cannot read private plans', () => assertFails(partner.collection('ledger_plans').get()));
  await check('partner: cannot read a single plan', () => assertFails(partner.doc('ledger_plans/seed').get()));
  await check('partner: cannot read sessions / health', () => assertFails(partner.collection('ledger_sessions').get()));
  await check('partner: cannot read matters', () => assertFails(partner.collection('ledger_matters').get()));
  await check('partner: cannot read conversations', () => assertFails(partner.collection('ledger_conversations').get()));
  await check('partner: cannot write owner actions', () => assertFails(partner.doc('ledger_commitments/seed').set({ title: 'changed' })));
  await check('partner: cannot create owner actions', () => assertFails(partner.collection('ledger_commitments').add({ title: 'x' })));
  await check('partner: cannot read push subscriptions', () => assertFails(partner.collection('ledger_push_subscriptions').get()));
  await check('partner: cannot register a malformed subscription', () => assertFails(partner.doc('ledger_push_subscriptions/sub_x').set({ endpoint: 'x' })));
  await check('partner: cannot create pins', () => assertFails(partner.collection('ledger_pins').add({ text: 'x' })));
  for (const c of PRIVATE){
    await check('partner: denied ' + c, () => assertFails(partner.collection(c).get()));
  }
  await check('partner: can read own profile', () => assertSucceeds(partner.doc('ledger_users/partner1').get()));
  await check('partner: cannot read owner profile', () => assertFails(partner.doc('ledger_users/owner1').get()));
  await check('partner: cannot promote themselves', () => assertFails(partner.doc('ledger_users/partner1').update({ role: 'owner' })));

  // ---- signed in, no profile (anyone can create an email-link account) ----
  await check('no profile: cannot read private data', () => assertFails(stranger.collection('ledger_commitments').get()));
  await check('no profile: cannot write private data', () => assertFails(stranger.doc('ledger_plans/2026-10-06').set({ x: 1 })));
  await check('no profile: cannot create own profile', () => assertFails(stranger.doc('ledger_users/stranger1').set({ role: 'owner' })));
  await check('no profile: cannot read push subscriptions', () => assertFails(stranger.collection('ledger_push_subscriptions').get()));

  // ---- Partner Sharing: signed out ----
  await check('signed out: cannot read a shared snapshot', () => assertFails(anon.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').get()));
  await check('signed out: cannot create a request', () => assertFails(anon.collection('ledger_shared_requests').add(newRequest())));
  await check('signed out: cannot read memberships', () => assertFails(anon.doc('ledger_share_members/owner1_partner1').get()));

  // ---- Partner Sharing: owner ----
  await check('owner: can read own memberships (query)', () => assertSucceeds(owner.collection('ledger_share_members').where('ownerUid', '==', 'owner1').get()));
  await check('owner: can update own membership (pause)', () => assertSucceeds(owner.doc('ledger_share_members/owner1_partner1').update({ active: true, updatedAt: 'now' })));
  await check('owner: cannot move a membership to another partner', () => assertFails(owner.doc('ledger_share_members/owner1_partner1').update({ partnerUid: 'partner2' })));
  await check('owner: cannot share with an account that is not a partner', () => assertFails(owner.doc('ledger_share_members/owner1_stranger1').set({ ownerUid: 'owner1', partnerUid: 'stranger1', role: 'partner', active: true })));
  await check('owner: membership id must be ownerUid_partnerUid', () => assertFails(owner.doc('ledger_share_members/whatever').set({ ownerUid: 'owner1', partnerUid: 'partner1', role: 'partner', active: true })));
  await check('owner: can publish own projection', () => assertSucceeds(owner.doc('ledger_shared_snapshots/owner1_partner1_week_2026-10-05').set({ ownerUid: 'owner1', partnerUid: 'partner1', periodType: 'week', periodKey: '2026-10-05', items: [] })));
  await check('owner: cannot publish under another id shape', () => assertFails(owner.doc('ledger_shared_snapshots/x').set({ ownerUid: 'owner1', partnerUid: 'partner1', periodType: 'day', periodKey: '2026-10-07' })));
  await check('owner: cannot publish to someone with no relationship', () => assertFails(owner.doc('ledger_shared_snapshots/owner1_stranger1_day_2026-10-07').set({ ownerUid: 'owner1', partnerUid: 'stranger1', periodType: 'day', periodKey: '2026-10-07' })));
  await check('owner: can read requests addressed to them (query)', () => assertSucceeds(owner.collection('ledger_shared_requests').where('ownerUid', '==', 'owner1').get()));
  await check('owner: can mark a request in progress', () => assertSucceeds(owner.doc('ledger_shared_requests/reqPlanned').update({ status: 'in_progress', updatedAt: 'now' })));
  await check('owner: cannot mark a request withdrawn', () => assertFails(owner.doc('ledger_shared_requests/reqPlanned').update({ status: 'withdrawn' })));
  await env.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('ledger_shared_requests/reqPlanned').update({ status: 'planned' }); });
  await check('owner: can plan a request', () => assertSucceeds(owner.doc('ledger_shared_requests/reqA').update({ status: 'planned', plannedDate: '2026-10-07', linkedActionId: 'act9', updatedAt: 'now', processedAt: 'now' })));
  await check('owner: cannot rewrite what was asked', () => assertFails(owner.doc('ledger_shared_requests/reqA').update({ text: 'Something else' })));
  await check('owner: cannot reassign a request to another partner', () => assertFails(owner.doc('ledger_shared_requests/reqA').update({ partnerUid: 'partner2' })));
  await check('owner: can dismiss a request', () => assertSucceeds(owner.doc('ledger_shared_requests/reqB').update({ status: 'dismissed', updatedAt: 'now' })));
  await check('owner: cannot set an unknown status', () => assertFails(owner.doc('ledger_shared_requests/reqB').update({ status: 'deleted' })));
  await env.withSecurityRulesDisabled(async (ctx) => {   // put the requests back for the partner cases
    await ctx.firestore().doc('ledger_shared_requests/reqA').update({ status: 'requested', plannedDate: null, linkedActionId: null });
    await ctx.firestore().doc('ledger_shared_requests/reqB').update({ status: 'requested' });
  });
  await check('another owner: cannot create a membership as owner1', () => assertFails(owner2.doc('ledger_share_members/owner1_partner1').set({ ownerUid: 'owner1', partnerUid: 'partner1', role: 'partner', active: true })));
  await check('another owner: cannot read owner1 memberships', () => assertFails(owner2.doc('ledger_share_members/owner1_partner1').get()));
  await check('another owner: cannot read owner1 projections', () => assertFails(owner2.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').get()));
  await check('another owner: cannot publish into owner1 namespace', () => assertFails(owner2.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-08').set({ ownerUid: 'owner1', partnerUid: 'partner1', periodType: 'day', periodKey: '2026-10-08' })));
  await check('another owner: cannot read owner1 requests', () => assertFails(owner2.doc('ledger_shared_requests/reqA').get()));

  // ---- Partner Sharing: partner A ----
  await check('partner A: can read own membership', () => assertSucceeds(partner.doc('ledger_share_members/owner1_partner1').get()));
  await check('partner A: can find own membership (query)', () => assertSucceeds(partner.collection('ledger_share_members').where('partnerUid', '==', 'partner1').get()));
  await check('partner A: cannot read partner B membership', () => assertFails(partner.doc('ledger_share_members/owner1_partner2').get()));
  await check('partner A: cannot write memberships', () => assertFails(partner.doc('ledger_share_members/owner1_partner1').update({ active: true })));
  await check('partner A: cannot create a membership for themselves', () => assertFails(partner.doc('ledger_share_members/owner2_partner1').set({ ownerUid: 'owner2', partnerUid: 'partner1', role: 'partner', active: true })));
  await check('partner A: can read projection addressed to them', () => assertSucceeds(partner.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').get()));
  await check('partner A: can query their week projections', () => assertSucceeds(partner.collection('ledger_shared_snapshots').where('ownerUid', '==', 'owner1').where('partnerUid', '==', 'partner1').where('periodType', '==', 'week').get()));
  await check('partner A: cannot read projection addressed to partner B', () => assertFails(partner.doc('ledger_shared_snapshots/owner1_partner2_day_2026-10-07').get()));
  await check('partner A: cannot write projections', () => assertFails(partner.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').update({ items: [{ title: 'x' }] })));
  await check('partner A: can create a request through own active membership', () => assertSucceeds(partner.collection('ledger_shared_requests').add(newRequest())));
  await check('partner A: cannot create a request for another owner', () => assertFails(partner.collection('ledger_shared_requests').add(newRequest({ ownerUid: 'owner2' }))));
  await check('partner A: cannot create a request as partner B', () => assertFails(partner.collection('ledger_shared_requests').add(newRequest({ partnerUid: 'partner2' }))));
  await check('partner A: cannot pre-set linkedActionId', () => assertFails(partner.collection('ledger_shared_requests').add(newRequest({ linkedActionId: 'act1' }))));
  await check('partner A: cannot pre-set an owner status', () => assertFails(partner.collection('ledger_shared_requests').add(newRequest({ status: 'done' }))));
  await check('partner A: cannot pre-set plannedDate', () => assertFails(partner.collection('ledger_shared_requests').add(newRequest({ plannedDate: '2026-10-07' }))));
  await check('partner A: cannot add extra fields', () => assertFails(partner.collection('ledger_shared_requests').add(newRequest({ category: 'work' }))));
  await check('partner A: cannot send an empty request', () => assertFails(partner.collection('ledger_shared_requests').add(newRequest({ text: '' }))));
  await check('partner A: can create a request with an ordinary id', () => assertSucceeds(partner.doc('ledger_shared_requests/Ab12cd34Ef56gh78Ij90').set(newRequest())));
  await check('partner A: cannot choose an id that is markup', () => assertFails(partner.doc('ledger_shared_requests/x"><img src=x onerror=alert(1)>').set(newRequest())));
  await check('partner A: cannot choose an over-long id', () => assertFails(partner.doc('ledger_shared_requests/' + 'a'.repeat(41)).set(newRequest())));
  await check('partner A: can read own requests (query)', () => assertSucceeds(partner.collection('ledger_shared_requests').where('ownerUid', '==', 'owner1').where('partnerUid', '==', 'partner1').get()));
  await check('partner A: cannot read partner B request', () => assertFails(partner.doc('ledger_shared_requests/reqB').get()));
  await check('partner A: can edit wording before it is processed', () => assertSucceeds(partner.doc('ledger_shared_requests/reqA').update({ text: 'Pick up nappies (size 4)', updatedAt: 'now' })));
  await check('partner A: cannot alter ownerUid', () => assertFails(partner.doc('ledger_shared_requests/reqA').update({ ownerUid: 'owner2' })));
  await check('partner A: cannot set linkedActionId', () => assertFails(partner.doc('ledger_shared_requests/reqA').update({ linkedActionId: 'act1' })));
  await check('partner A: cannot mark own request done', () => assertFails(partner.doc('ledger_shared_requests/reqA').update({ status: 'done' })));
  await check('partner A: cannot set plannedDate', () => assertFails(partner.doc('ledger_shared_requests/reqA').update({ plannedDate: '2026-10-07' })));
  await check('partner A: cannot edit once planned', () => assertFails(partner.doc('ledger_shared_requests/reqPlanned').update({ text: 'changed' })));
  await check('partner A: cannot delete a request (withdrawing is a state)', () => assertFails(partner.doc('ledger_shared_requests/reqA').delete()));
  await check('partner A: cannot withdraw once planned', () => assertFails(partner.doc('ledger_shared_requests/reqPlanned').update({ status: 'withdrawn', updatedAt: 'now' })));

  // ---- Action Updates: owner-private ----
  const AU = 'ledger_action_updates';
  const au = (o) => Object.assign({ actionId: 'seed', ownerUid: 'owner1', type: 'comment', actorUid: 'owner1', actorRole: 'owner',
    text: 'Payroll file sent at 10:20.', createdAt: NOW(), metadata: {} }, o || {});
  await env.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc(AU + '/seedAU').set(au({ createdAt: 'x' })); });
  await check('action updates: owner can add an update to own Action', () => assertSucceeds(owner.doc(AU + '/au1').set(au())));
  await check('action updates: owner can log a status fact', () => assertSucceeds(owner.doc(AU + '/au2').set(au({ type: 'status', actorRole: 'system', text: null, metadata: { fromStatus: 'not_started', toStatus: 'waiting', context: 'payroll' } }))));
  await check('action updates: owner can read own (query)', () => assertSucceeds(owner.collection(AU).where('ownerUid', '==', 'owner1').where('actionId', '==', 'seed').get()));
  await check('action updates: owner cannot write as another owner', () => assertFails(owner.doc(AU + '/au3').set(au({ ownerUid: 'owner2' }))));
  await check('action updates: owner cannot claim another author', () => assertFails(owner.doc(AU + '/au4').set(au({ actorUid: 'partner1' }))));
  await check('action updates: only for an Action that exists', () => assertFails(owner.doc(AU + '/au5').set(au({ actionId: 'nope' }))));
  await check('action updates: unknown types are refused', () => assertFails(owner.doc(AU + '/au6').set(au({ type: 'assigned' }))));
  await check('action updates: an empty update is refused', () => assertFails(owner.doc(AU + '/au7').set(au({ text: '' }))));
  await check('action updates: cannot backdate', () => assertFails(owner.doc(AU + '/au8').set(au({ createdAt: '2020-01-01T00:00:00Z' }))));
  await check('action updates: no extra fields', () => assertFails(owner.doc(AU + '/au9').set(au({ shared: true }))));
  await check('action updates: entries are not edited', () => assertFails(owner.doc(AU + '/au1').update({ text: 'changed' })));
  await check('action updates: owner may remove them', () => assertSucceeds(owner.doc(AU + '/au2').delete()));
  await check("action updates: another owner cannot read owner1's", () => assertFails(owner2.doc(AU + '/seedAU').get()));
  await check('action updates: partner cannot read one', () => assertFails(partner.doc(AU + '/seedAU').get()));
  await check('action updates: partner cannot query them', () => assertFails(partner.collection(AU).where('ownerUid', '==', 'owner1').get()));
  await check('action updates: partner cannot write one', () => assertFails(partner.doc(AU + '/p1').set(au({ ownerUid: 'partner1', actorUid: 'partner1' }))));
  await check('action updates: partner cannot delete one', () => assertFails(partner.doc(AU + '/seedAU').delete()));
  await check('action updates: signed out cannot read', () => assertFails(anon.doc(AU + '/seedAU').get()));
  await check('action updates: no role cannot read', () => assertFails(stranger.collection(AU).where('ownerUid', '==', 'owner1').get()));

  // ---- Partner Request Updates ----
  // signed out / no role
  await check('updates: signed out cannot read', () => assertFails(forReq(anon, 'reqPlanned').get()));
  await check('updates: signed out cannot write', () => assertFails(anon.collection(UPD).add(upd())));
  await check('updates: no role cannot read', () => assertFails(forReq(stranger, 'reqPlanned').get()));
  await check('updates: no role cannot write', () => assertFails(stranger.collection(UPD).add(upd({ actorUid: 'stranger1' }))));
  // partner A
  await check('updates: partner A can read own request updates', () => assertSucceeds(forReq(partner, 'reqPlanned').get()));
  await check('updates: partner A can add a comment to own request', () => assertSucceeds(partner.collection(UPD).add(upd({ text: 'Please get the larger size.' }))));
  await check('updates: partner A can add a comment to a processed request', () => assertSucceeds(partner.collection(UPD).add(upd({ requestId: 'reqPlanned' }))));
  await check('updates: partner A cannot read partner B updates', () => assertFails(forReq(partner, 'reqB', 'partner2').get()));
  await check('updates: partner A cannot comment on partner B request', () => assertFails(partner.collection(UPD).add(upd({ requestId: 'reqB', partnerUid: 'partner2' }))));
  await check('updates: partner A cannot attach to B request under own uid', () => assertFails(partner.collection(UPD).add(upd({ requestId: 'reqB' }))));
  await check('updates: partner A cannot attach to a request that does not exist', () => assertFails(partner.collection(UPD).add(upd({ requestId: 'nope' }))));
  await check('updates: partner A cannot write as the owner (actorUid)', () => assertFails(partner.collection(UPD).add(upd({ actorUid: 'owner1' }))));
  await check('updates: partner A cannot claim actorRole owner', () => assertFails(partner.collection(UPD).add(upd({ actorRole: 'owner' }))));
  await check('updates: partner A cannot claim actorRole system', () => assertFails(partner.collection(UPD).add(upd({ actorRole: 'system' }))));
  await check('updates: partner A cannot fake a moved event', () => assertFails(partner.collection(UPD).add(upd({ type: 'moved', text: null, metadata: { toDate: '2026-10-08' } }))));
  await check('updates: partner A cannot fake a done/status event', () => assertFails(partner.collection(UPD).add(upd({ type: 'status', text: null, metadata: { status: 'planned' } }))));
  await check('updates: partner A cannot fake a planned event', () => assertFails(partner.collection(UPD).add(upd({ type: 'planned', text: null }))));
  await check('updates: partner A cannot fake a dismissed event', () => assertFails(partner.collection(UPD).add(upd({ type: 'dismissed', text: null }))));
  await check('updates: partner A cannot backdate an update', () => assertFails(partner.collection(UPD).add(upd({ createdAt: '2020-01-01T00:00:00Z' }))));
  await check('updates: partner A cannot send an empty comment', () => assertFails(partner.collection(UPD).add(upd({ text: '' }))));
  await check('updates: partner A cannot add unknown fields', () => assertFails(partner.collection(UPD).add(upd({ urgent: true }))));
  await check('updates: partner A cannot edit an update', () => assertFails(partner.doc(UPD + '/seedA').update({ text: 'changed' })));
  await check('updates: partner A cannot delete an update', () => assertFails(partner.doc(UPD + '/seedA').delete()));
  await check('updates: partner A can mark "asked" once, on its fixed id', () => assertSucceeds(partner.doc(UPD + '/reqA_created').set(upd({ requestId: 'reqA', type: 'request_created', text: null }))));
  await check('updates: partner A cannot repeat "asked"', () => assertFails(partner.doc(UPD + '/reqA_created').set(upd({ requestId: 'reqA', type: 'request_created', text: null }))));
  await check('updates: partner A cannot mark "asked" under any other id', () => assertFails(partner.collection(UPD).add(upd({ requestId: 'reqA', type: 'request_created', text: null }))));
  await check('updates: partner A cannot claim "asked" for a processed request', () => assertFails(partner.doc(UPD + '/reqPlanned_created').set(upd({ type: 'request_created', text: null }))));
  await check('updates: partner A cannot mark withdrawn while it is not', () => assertFails(partner.doc(UPD + '/reqA_withdrawn').set(upd({ requestId: 'reqA', type: 'withdrawn', text: null }))));
  await check('updates: partner A can create a request and its "asked" entry together', () => {
    const b = partner.batch();
    b.set(partner.doc('ledger_shared_requests/newReq1'), newRequest({ latestUpdateAt: 'now', latestUpdateBy: 'partner', latestUpdateType: 'request_created' }));
    b.set(partner.doc(UPD + '/newReq1_created'), upd({ requestId: 'newReq1', type: 'request_created', text: null }));
    return assertSucceeds(b.commit());
  });
  await check('updates: partner A cannot create a request summarised as the owner', () => assertFails(partner.doc('ledger_shared_requests/newReq2').set(newRequest({ latestUpdateBy: 'owner' }))));
  // the request's summary and read marks
  await check('summary: partner A can record their update and read mark', () => assertSucceeds(partner.doc('ledger_shared_requests/reqPlanned').update({
    latestUpdateAt: 'now', latestUpdateBy: 'partner', latestUpdateType: 'comment', latestCommentAt: 'now', latestCommentBy: 'partner', latestCommentText: 'Larger size', partnerLastReadAt: 'now' })));
  await check('summary: partner A cannot sign the summary as the owner', () => assertFails(partner.doc('ledger_shared_requests/reqPlanned').update({ latestCommentBy: 'owner', latestCommentAt: 'now2' })));
  await check('summary: partner A cannot sign it as the system', () => assertFails(partner.doc('ledger_shared_requests/reqPlanned').update({ latestUpdateBy: 'system', latestUpdateAt: 'now2' })));
  await check("summary: partner A cannot set the owner's read mark", () => assertFails(partner.doc('ledger_shared_requests/reqPlanned').update({ ownerLastReadAt: 'now' })));
  await check('summary: partner A still cannot change the plan with it', () => assertFails(partner.doc('ledger_shared_requests/reqPlanned').update({ partnerLastReadAt: 'now3', plannedDate: '2026-10-09' })));
  // withdrawing: a state, with its one entry
  await check('withdraw: partner A can withdraw an unprocessed request, with its entry', () => {
    const b = partner.batch();
    b.update(partner.doc('ledger_shared_requests/newReq1'), { status: 'withdrawn', updatedAt: 'now', latestUpdateAt: 'now', latestUpdateBy: 'partner', latestUpdateType: 'withdrawn' });
    b.set(partner.doc(UPD + '/newReq1_withdrawn'), upd({ requestId: 'newReq1', type: 'withdrawn', text: null }));
    return assertSucceeds(b.commit());
  });
  await check('withdraw: the owner cannot revive a withdrawn request', () => assertFails(owner.doc('ledger_shared_requests/newReq1').update({ status: 'planned', plannedDate: '2026-10-08', linkedActionId: 'x' })));
  // a withdrawn request, afterwards: hidden from the partner's own list, or moved to upcoming
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('ledger_shared_requests/reqW').set(newRequest({ status: 'withdrawn', text: 'Sort the visa' }));
    await db.doc('ledger_shared_requests/reqW2').set(newRequest({ partnerUid: 'partner2', status: 'withdrawn', text: 'B withdrawn' }));
  });
  await check('hide: partner A can hide own withdrawn request', () => assertSucceeds(partner.doc('ledger_shared_requests/newReq1').update({ partnerHiddenAt: '2026-10-09T10:00:00Z', updatedAt: 'now' })));
  await check('hide: partner A can bring it back (Undo)', () => assertSucceeds(partner.doc('ledger_shared_requests/newReq1').update({ partnerHiddenAt: null, updatedAt: 'now' })));
  await check('hide: partner A cannot hide an open request', () => assertFails(partner.doc('ledger_shared_requests/reqA').update({ partnerHiddenAt: 'now', updatedAt: 'now' })));
  await check('hide: partner A cannot hide a planned request', () => assertFails(partner.doc('ledger_shared_requests/reqPlanned').update({ partnerHiddenAt: 'now', updatedAt: 'now' })));
  await check('hide: partner A cannot change anything else with it', () => assertFails(partner.doc('ledger_shared_requests/newReq1').update({ partnerHiddenAt: 'now', text: 'changed' })));
  await check('hide: partner A cannot revive it with it', () => assertFails(partner.doc('ledger_shared_requests/newReq1').update({ partnerHiddenAt: 'now', status: 'requested' })));
  await check('hide: the owner cannot hide it for the partner', () => assertFails(owner.doc('ledger_shared_requests/newReq1').update({ partnerHiddenAt: 'now' })));
  await check("hide: partner A cannot hide partner B's request", () => assertFails(partner.doc('ledger_shared_requests/reqW2').update({ partnerHiddenAt: 'now', updatedAt: 'now' })));
  await check('hide: a withdrawn request still cannot be deleted (partner)', () => assertFails(partner.doc('ledger_shared_requests/newReq1').delete()));
  await check('hide: a withdrawn request still cannot be deleted (owner)', () => assertFails(owner.doc('ledger_shared_requests/newReq1').delete()));
  const renewal = (db, oldId, newId, o) => {
    const b = db.batch();
    b.set(db.doc('ledger_shared_requests/' + newId), newRequest(Object.assign({ requestedTiming: 'later', renewedFrom: oldId,
      latestUpdateAt: 'now', latestUpdateBy: 'partner', latestUpdateType: 'request_created' }, o || {})));
    b.update(db.doc('ledger_shared_requests/' + oldId), { renewedAs: newId, updatedAt: 'now' });
    b.set(db.doc(UPD + '/' + newId + '_created'), upd({ requestId: newId, type: 'request_created', text: null, metadata: { timing: 'later', renewedFrom: oldId } }));
    b.set(db.doc(UPD + '/' + oldId + '_renewed'), upd({ requestId: oldId, type: 'renewed', text: null, metadata: { renewedAs: newId } }));
    return b.commit();
  };
  await check('upcoming: partner A can move own withdrawn request to upcoming (new request + both entries)', () => assertSucceeds(renewal(partner, 'newReq1', 'newRen1')));
  await check('upcoming: the old record keeps its withdrawn state and points at the new one', async () => {
    const d = (await partner.doc('ledger_shared_requests/newReq1').get()).data();
    if (d.status !== 'withdrawn' || d.renewedAs !== 'newRen1') throw new Error(JSON.stringify(d));
  });
  await check('upcoming: the same withdrawn request cannot be renewed twice', () => assertFails(renewal(partner, 'newReq1', 'newRen2')));
  await check('upcoming: an open request cannot be "renewed"', () => assertFails(renewal(partner, 'reqA', 'newRen3')));
  await check('upcoming: a new request cannot claim a withdrawn one without marking it', () => assertFails(partner.doc('ledger_shared_requests/newRen4').set(newRequest({ requestedTiming: 'later', renewedFrom: 'reqW' }))));
  await check('upcoming: a withdrawn request cannot point at a request that does not name it', () => assertFails(partner.doc('ledger_shared_requests/reqW').update({ renewedAs: 'reqA', updatedAt: 'now' })));
  await check('upcoming: a withdrawn request cannot point at nothing', () => assertFails(partner.doc('ledger_shared_requests/reqW').update({ renewedAs: 'nope', updatedAt: 'now' })));
  await check("upcoming: partner A cannot renew partner B's withdrawn request", () => assertFails(renewal(partner, 'reqW2', 'newRen5')));
  await check('upcoming: a renewal cannot pre-set linkedActionId', () => assertFails(renewal(partner, 'reqW', 'newRen6', { linkedActionId: 'act1' })));
  await check('upcoming: a renewal cannot pre-set an owner status', () => assertFails(renewal(partner, 'reqW', 'newRen7', { status: 'planned' })));
  await check('upcoming: an open request cannot be given renewedAs', () => assertFails(partner.doc('ledger_shared_requests/reqA').update({ renewedAs: 'newRen1', updatedAt: 'now' })));
  await check('upcoming: "renewed" entry only for a renewed request', () => assertFails(partner.doc(UPD + '/reqW_renewed').set(upd({ requestId: 'reqW', type: 'renewed', text: null }))));
  await check('upcoming: "renewed" entry is written once', () => assertFails(partner.doc(UPD + '/newReq1_renewed').set(upd({ requestId: 'newReq1', type: 'renewed', text: null }))));
  await check('upcoming: the owner cannot write the partner\'s "renewed" entry', () => assertFails(owner.doc(UPD + '/reqW_renewed').set(sysUpd({ requestId: 'reqW', type: 'renewed' }))));
  await check('upcoming: the owner plans the new request like any other', () => assertSucceeds(owner.doc('ledger_shared_requests/newRen1').update({ status: 'planned', plannedDate: '2026-10-10', linkedActionId: 'act7', updatedAt: 'now', processedAt: 'now' })));
  await check('upcoming: the partner cannot edit it once planned', () => assertFails(partner.doc('ledger_shared_requests/newRen1').update({ text: 'changed', updatedAt: 'now' })));
  await check('upcoming: the owner cannot unlink the old record', () => assertFails(owner.doc('ledger_shared_requests/newReq1').update({ renewedAs: null })));
  await check('upcoming: partner A can create an upcoming request directly', () => assertSucceeds(partner.doc('ledger_shared_requests/newUp1').set(newRequest({ requestedTiming: 'later' }))));
  // partner B (paused)
  await check('updates: partner B (inactive) cannot read own request updates', () => assertFails(forReq(partnerB, 'reqB', 'partner2').get()));
  await check('updates: partner B (inactive) cannot comment', () => assertFails(partnerB.collection(UPD).add(upd({ requestId: 'reqB', partnerUid: 'partner2', actorUid: 'partner2' }))));
  await check('updates: partner B cannot read partner A updates', () => assertFails(forReq(partnerB, 'reqPlanned').get()));
  // owner
  await check('updates: owner can read updates of own requests', () => assertSucceeds(forReq(owner, 'reqPlanned').get()));
  await check('updates: owner can add an update', () => assertSucceeds(owner.collection(UPD).add(ownerUpd({ text: "I'll do this after lunch." }))));
  await check('updates: owner can add an update to a request still in the Inbox', () => assertSucceeds(owner.collection(UPD).add(ownerUpd({ requestId: 'reqA' }))));
  await check('updates: owner cannot write as the partner', () => assertFails(owner.collection(UPD).add(ownerUpd({ actorUid: 'partner1' }))));
  await check('updates: owner cannot claim actorRole partner', () => assertFails(owner.collection(UPD).add(ownerUpd({ actorRole: 'partner' }))));
  await check('updates: owner can log "planned" for a planned request', () => assertSucceeds(owner.collection(UPD).add(sysUpd({ type: 'planned', metadata: { toDate: '2026-10-08' } }))));
  await check('updates: owner cannot log "planned" for a request still in the Inbox', () => assertFails(owner.collection(UPD).add(sysUpd({ requestId: 'reqA', type: 'planned', metadata: { toDate: '2026-10-08' } }))));
  await check('updates: owner can log "moved" to the date the request now holds', () => assertSucceeds(owner.collection(UPD).add(sysUpd({ type: 'moved', metadata: { fromDate: '2026-10-07', toDate: '2026-10-08' } }))));
  await check('updates: owner cannot log a move the request does not show', () => assertFails(owner.collection(UPD).add(sysUpd({ type: 'moved', metadata: { toDate: '2026-12-25' } }))));
  await check('updates: owner cannot log "done" before the request is done', () => assertFails(owner.collection(UPD).add(sysUpd({ type: 'status', metadata: { status: 'done' } }))));
  await check('updates: owner can mark done and log it in one write', () => {
    const b = owner.batch();
    b.update(owner.doc('ledger_shared_requests/reqPlanned'), { status: 'done', updatedAt: 'now', latestUpdateAt: 'now', latestUpdateBy: 'system', latestUpdateType: 'status' });
    b.set(owner.collection(UPD).doc(), sysUpd({ type: 'status', metadata: { status: 'done' } }));
    return assertSucceeds(b.commit());
  });
  await check('updates: owner cannot backdate', () => assertFails(owner.collection(UPD).add(ownerUpd({ createdAt: '2020-01-01T00:00:00Z' }))));
  await check('updates: owner cannot attach to a request of another relationship', () => assertFails(owner.collection(UPD).add(ownerUpd({ requestId: 'reqB' }))));
  await check('updates: another owner cannot write to owner1 requests', () => assertFails(owner2.collection(UPD).add(ownerUpd({ actorUid: 'owner2' }))));
  await check('updates: another owner cannot claim it as theirs', () => assertFails(owner2.collection(UPD).add(ownerUpd({ actorUid: 'owner2', ownerUid: 'owner2' }))));
  await check('updates: another owner cannot read owner1 updates', () => assertFails(owner2.doc(UPD + '/seedA').get()));
  await check('updates: owner cannot edit or remove history', () => assertFails(owner.doc(UPD + '/seedA').delete()));
  await check('summary: owner can record their update and read mark', () => assertSucceeds(owner.doc('ledger_shared_requests/reqPlanned').update({
    latestUpdateAt: 'now4', latestUpdateBy: 'owner', latestUpdateType: 'comment', latestCommentAt: 'now4', latestCommentBy: 'owner', latestCommentText: 'After lunch', ownerLastReadAt: 'now4' })));
  await check('summary: owner cannot sign the summary as the partner', () => assertFails(owner.doc('ledger_shared_requests/reqPlanned').update({ latestCommentBy: 'partner', latestCommentAt: 'now5' })));
  await check("summary: owner cannot set the partner's read mark", () => assertFails(owner.doc('ledger_shared_requests/reqPlanned').update({ partnerLastReadAt: 'now5' })));
  await check('partner A: still cannot read private plans', () => assertFails(partner.collection('ledger_plans').get()));
  await check('partner A: still cannot read actions', () => assertFails(partner.doc('ledger_commitments/seed').get()));

  // ---- Partner Sharing: partner B (relationship paused) ----
  await check('partner B: cannot read partner A projection', () => assertFails(partnerB.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').get()));
  await check('partner B: cannot read partner A requests', () => assertFails(partnerB.doc('ledger_shared_requests/reqPlanned').get()));
  await check('partner B: can see own membership (to know it is paused)', () => assertSucceeds(partnerB.doc('ledger_share_members/owner1_partner2').get()));
  await check('partner B (inactive): cannot read own live projection', () => assertFails(partnerB.doc('ledger_shared_snapshots/owner1_partner2_day_2026-10-07').get()));
  await check('partner B (inactive): cannot create a request', () => assertFails(partnerB.collection('ledger_shared_requests').add(newRequest({ partnerUid: 'partner2' }))));
  await check('partner B (inactive): cannot read own requests', () => assertFails(partnerB.doc('ledger_shared_requests/reqB').get()));

  // ---- no role: nothing shared ----
  await check('no profile: cannot read projections', () => assertFails(stranger.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').get()));
  await check('no profile: cannot create a request', () => assertFails(stranger.collection('ledger_shared_requests').add(newRequest({ partnerUid: 'stranger1' }))));

  // ---- Push subscriptions: each user's own devices ----
  const SUBS = 'ledger_push_subscriptions';
  await check('owner: can register own device', () => assertSucceeds(owner.doc(SUBS + '/owner1_mac').set(sub('owner1', { deviceId: 'dev-mac', deviceLabel: 'Shaun · MacBook' }))));
  await check('owner: can read own device', () => assertSucceeds(owner.doc(SUBS + '/owner1_dev1').get()));
  await check('owner: can list own devices (query)', () => assertSucceeds(owner.collection(SUBS).where('userUid', '==', 'owner1').get()));
  await check('owner: can refresh own device', () => assertSucceeds(owner.doc(SUBS + '/owner1_dev1').set(sub('owner1', { lastSeenAt: '2026-10-09T09:00:00Z' }))));
  await check('owner: cannot list every device', () => assertFails(owner.collection(SUBS).get()));
  await check('owner: cannot read a partner device', () => assertFails(owner.doc(SUBS + '/partner1_dev1').get()));
  await check('owner: cannot query a partner\'s devices', () => assertFails(owner.collection(SUBS).where('userUid', '==', 'partner1').get()));
  await check('owner: cannot register a device for the partner (their id)', () => assertFails(owner.doc(SUBS + '/partner1_spoof').set(sub('partner1'))));
  await check('owner: cannot register a device for the partner (own id)', () => assertFails(owner.doc(SUBS + '/owner1_spoof').set(sub('partner1'))));
  await check('owner: cannot hand own device to another uid', () => assertFails(owner.doc(SUBS + '/owner1_dev1').set(sub('partner1'))));
  await check('owner: cannot change a partner device', () => assertFails(owner.doc(SUBS + '/partner1_dev1').set(sub('owner1'))));
  await check('owner: cannot delete a partner device', () => assertFails(owner.doc(SUBS + '/partner1_dev1').delete()));
  await check('owner: an http endpoint is refused', () => assertFails(owner.doc(SUBS + '/owner1_http').set(sub('owner1', { endpoint: 'http://push.example/x' }))));
  await check('owner: unknown fields are refused', () => assertFails(owner.doc(SUBS + '/owner1_extra').set(sub('owner1', { recipientUid: 'partner1' }))));
  await check('owner: can remove the legacy record of this device', () => assertSucceeds(owner.doc(SUBS + '/sub_legacy').delete()));
  await check('owner: can remove own device', () => assertSucceeds(owner.doc(SUBS + '/owner1_mac').delete()));
  await check('partner: can register own device', () => assertSucceeds(partner.doc(SUBS + '/partner1_phone').set(sub('partner1', { deviceLabel: 'Abi · iPhone' }))));
  await check('partner: can read own device', () => assertSucceeds(partner.doc(SUBS + '/partner1_dev1').get()));
  await check('partner: can list own devices (query)', () => assertSucceeds(partner.collection(SUBS).where('userUid', '==', 'partner1').get()));
  await check('partner: cannot read owner device', () => assertFails(partner.doc(SUBS + '/owner1_dev1').get()));
  await check('partner: cannot query owner devices', () => assertFails(partner.collection(SUBS).where('userUid', '==', 'owner1').get()));
  await check('partner: cannot modify owner device', () => assertFails(partner.doc(SUBS + '/owner1_dev1').set(sub('owner1', { endpoint: 'https://evil.example/x' }))));
  await check('partner: cannot take over owner device', () => assertFails(partner.doc(SUBS + '/owner1_dev1').set(sub('partner1'))));
  await check('partner: cannot delete owner device', () => assertFails(partner.doc(SUBS + '/owner1_dev1').delete()));
  await check('partner: cannot register a device as the owner', () => assertFails(partner.doc(SUBS + '/owner1_fake').set(sub('owner1'))));
  await check('partner: can remove own device', () => assertSucceeds(partner.doc(SUBS + '/partner1_phone').delete()));
  await check('no profile: cannot register a device', () => assertFails(stranger.doc(SUBS + '/stranger1_x').set(sub('stranger1'))));
  await check('signed out: cannot read a device', () => assertFails(anon.doc(SUBS + '/owner1_dev1').get()));
  await check('signed out: cannot register a device', () => assertFails(anon.doc(SUBS + '/x_y').set(sub('x'))));

  // ---- Notification preferences: each user's own ----
  const PREFS = 'ledger_notification_prefs';
  await check('owner: can save own notification prefs', () => assertSucceeds(owner.doc(PREFS + '/owner1').set({ currentFocus: false, partner: true, updatedAt: 'now' })));
  await check('owner: can read own prefs', () => assertSucceeds(owner.doc(PREFS + '/owner1').get()));
  await check('owner: cannot read partner prefs', () => assertFails(owner.doc(PREFS + '/partner1').get()));
  await check('owner: cannot change partner prefs', () => assertFails(owner.doc(PREFS + '/partner1').set({ partner: false })));
  await check('owner: prefs must be on/off', () => assertFails(owner.doc(PREFS + '/owner1').set({ currentFocus: 'loud' })));
  await check('owner: prefs take no other fields', () => assertFails(owner.doc(PREFS + '/owner1').set({ partner: true, recipients: ['x'] })));
  await check('partner: can save own prefs', () => assertSucceeds(partner.doc(PREFS + '/partner1').set({ partner: false, updatedAt: 'now' })));
  await check('partner: cannot read owner prefs', () => assertFails(partner.doc(PREFS + '/owner1').get()));
  await check('no profile: cannot save prefs', () => assertFails(stranger.doc(PREFS + '/stranger1').set({ partner: true })));

  // ---- Config, Pin now, the sender's log ----
  await check('owner: can read the push config', () => assertSucceeds(owner.doc('ledger_config/push').get()));
  await check('partner: can read the push config', () => assertSucceeds(partner.doc('ledger_config/push').get()));
  await check('owner: cannot write the push config', () => assertFails(owner.doc('ledger_config/push').set({ vapidPublicKey: 'other' })));
  await check('no profile: cannot read the push config', () => assertFails(stranger.doc('ledger_config/push').get()));
  await check('signed out: cannot read the push config', () => assertFails(anon.doc('ledger_config/push').get()));
  await check('owner: can pin to own devices', () => assertSucceeds(owner.collection('ledger_pins').add({ ownerUid: 'owner1', text: 'Bring charger', status: 'pending' })));
  await check('owner: cannot pin for someone else', () => assertFails(owner.collection('ledger_pins').add({ ownerUid: 'partner1', text: 'x' })));
  await check('owner: cannot rewrite a pin\'s outcome', () => assertFails(owner.doc('ledger_pins/pin1').update({ status: 'pending' })));
  await check('owner: can clear own pins', () => assertSucceeds(owner.doc('ledger_pins/pin1').delete()));
  await check('owner: cannot read the sender\'s log', () => assertFails(owner.doc('ledger_push_events/e1').get()));
  await check('owner: cannot write the sender\'s log', () => assertFails(owner.doc('ledger_push_events/e2').set({ x: 1 })));
  await check('partner: cannot read the sender\'s log', () => assertFails(partner.doc('ledger_push_events/e1').get()));

  // ---- Reset Sprints: owner only ----
  await check('owner: can create a sprint', () => assertSucceeds(owner.doc('ledger_sprints/s1').set({ ownerUid: 'owner1', state: 'active', items: [{ id: 'i1', text: 'Shower', completed: false }] })));
  await check('owner: can update a sprint', () => assertSucceeds(owner.doc('ledger_sprints/s1').update({ state: 'finished' })));
  await check('owner: can read sprints', () => assertSucceeds(owner.collection('ledger_sprints').get()));
  await check('owner: can delete a sprint', () => assertSucceeds(owner.doc('ledger_sprints/s1').delete()));
  await check('partner: cannot read a sprint', () => assertFails(partner.doc('ledger_sprints/seed').get()));
  await check('partner: cannot create a sprint', () => assertFails(partner.doc('ledger_sprints/p1').set({ state: 'active' })));
  await check('no profile: cannot read sprints', () => assertFails(stranger.collection('ledger_sprints').get()));

  // ---- Current Focus: the owner's, naming the owner who set it ----
  const FOCUS = 'ledger_meta/currentFocus';
  await check('owner: can read current focus', () => assertSucceeds(owner.doc(FOCUS).get()));
  await check('owner: can set current focus', () => assertSucceeds(owner.doc(FOCUS).set(focus({ sourceId: 'act2', title: 'Finish proposal' }))));
  await check('owner: can focus on a sprint item', () => assertSucceeds(owner.doc(FOCUS).set(focus({ type: 'sprint_item', sourceId: 's1', childId: 'i1' }))));
  await check('owner: can clear current focus', () => assertSucceeds(owner.doc(FOCUS).set({ ownerUid: 'owner1', status: 'cleared', clearedAt: 'now', updatedAt: 'now', sourceDeviceId: 'dev-mac' })));
  await check('owner: focus cannot name another user', () => assertFails(owner.doc(FOCUS).set(focus({ ownerUid: 'partner1' }))));
  await check('owner: focus type is action or sprint item', () => assertFails(owner.doc(FOCUS).set(focus({ type: 'note' }))));
  await check('owner: focus takes no other fields', () => assertFails(owner.doc(FOCUS).set(focus({ recipientUid: 'partner1' }))));
  await check('owner: active focus needs what it points at', () => assertFails(owner.doc(FOCUS).set(focus({ sourceId: '' }))));
  await check('owner: other meta documents are unaffected', () => assertSucceeds(owner.doc('ledger_meta/presets').set({ anything: true })));
  await check('partner: cannot read current focus', () => assertFails(partner.doc(FOCUS).get()));
  await check('partner: cannot set current focus', () => assertFails(partner.doc(FOCUS).set(focus({ ownerUid: 'partner1' }))));
  await check('no profile: cannot read current focus', () => assertFails(stranger.doc(FOCUS).get()));
  await check('signed out: cannot read current focus', () => assertFails(anon.doc(FOCUS).get()));

  // ---- anything unlisted ----
  await check('unlisted collection: owner denied', () => assertFails(owner.collection('something_else').get()));

  await env.cleanup();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
