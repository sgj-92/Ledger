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
  'ledger_matters', 'ledger_conversations', 'ledger_challenges', 'ledger_sprints', 'ledger_life_context'
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
  // the iOS and Android apps: an FCM token instead of a Web Push endpoint
  const fcm = (uid, o) => Object.assign({ userUid: uid, transport: 'fcm', fcmToken: 'tok-' + uid, deviceId: 'dev-app', deviceLabel: 'Shaun · iPhone app', platform: 'ios',
    appVersion: '1.0 (1)', createdAt: 'now', updatedAt: 'now', lastSeenAt: 'now' }, o || {});
  await check('fcm: the owner registers the app on his phone', () => assertSucceeds(owner.doc(SUBS + '/owner1_ndev-app').set(fcm('owner1'))));
  await check('fcm: …and refreshes its token', () => assertSucceeds(owner.doc(SUBS + '/owner1_ndev-app').set(fcm('owner1', { fcmToken: 'tok-new' }))));
  await check('fcm: Abi registers hers (Android)', () => assertSucceeds(partner.doc(SUBS + '/partner1_ndev-a').set(fcm('partner1', { platform: 'android', deviceId: 'dev-a' }))));
  await check('fcm: never for someone else (their id)', () => assertFails(owner.doc(SUBS + '/partner1_ndev-x').set(fcm('partner1'))));
  await check('fcm: never for someone else (own id)', () => assertFails(owner.doc(SUBS + '/owner1_ndev-x').set(fcm('partner1'))));
  await check('fcm: only ios or android', () => assertFails(owner.doc(SUBS + '/owner1_ndev-w').set(fcm('owner1', { platform: 'web' }))));
  await check('fcm: a token, and only one kind of record', () => assertFails(owner.doc(SUBS + '/owner1_ndev-m').set(fcm('owner1', { endpoint: 'https://push.example/x' }))));
  await check('fcm: no empty token', () => assertFails(owner.doc(SUBS + '/owner1_ndev-e').set(fcm('owner1', { fcmToken: '' }))));
  await check('fcm: never a recipient named by the client', () => assertFails(owner.doc(SUBS + '/owner1_ndev-r').set(fcm('owner1', { recipientUid: 'partner1' }))));
  await check('fcm: the owner cannot read the partner\'s app', () => assertFails(owner.doc(SUBS + '/partner1_ndev-a').get()));
  await check('fcm: …nor take it over', () => assertFails(owner.doc(SUBS + '/partner1_ndev-a').set(fcm('owner1'))));
  await check('fcm: a signed-out device removes nothing', () => assertFails(anon.doc(SUBS + '/owner1_ndev-app').delete()));
  await check('fcm: the owner removes his own app', () => assertSucceeds(owner.doc(SUBS + '/owner1_ndev-app').delete()));
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

  // ---- Requests made in person: the owner records them on the partner's behalf ----
  // requester = partnerUid, assignee = ownerUid, creator = createdByUid (the signed-in user)
  const RQ = 'ledger_shared_requests';
  const onBehalf = (o) => newRequest(Object.assign({ createdByUid: 'owner1', createdByRole: 'owner',
    latestUpdateAt: '2026-10-16T09:00:00Z', latestUpdateBy: 'owner', latestUpdateType: 'request_created' }, o || {}));
  const createdEntry = (id, o) => Object.assign({ requestId: id, ownerUid: 'owner1', partnerUid: 'partner1', type: 'request_created',
    actorUid: 'owner1', actorRole: 'owner', text: null, createdAt: NOW(), metadata: { onBehalf: true } }, o || {});
  async function ownerCreates(db, id, doc, entry){
    const b = db.batch();
    b.set(db.doc(RQ + '/' + id), doc);
    if (entry !== false) b.set(db.doc(UPD + '/' + id + '_created'), entry || createdEntry(id));
    return b.commit();
  }
  await check('owner: can record a request on the partner\'s behalf (with its "created" entry)', () => assertSucceeds(ownerCreates(owner, 'obA', onBehalf())));
  await check('partner: sees the request recorded for them', () => assertSucceeds(partner.doc(RQ + '/obA').get()));
  await check('partner: sees its "created by the owner" entry', () => assertSucceeds(partner.doc(UPD + '/obA_created').get()));
  await check('owner: on-behalf only for the partner of an active relationship (paused)', () => assertFails(ownerCreates(owner, 'obPaused', onBehalf({ partnerUid: 'partner2' }), false)));
  await check('owner: on-behalf never for someone outside the relationship', () => assertFails(ownerCreates(owner, 'obStranger', onBehalf({ partnerUid: 'stranger1' }), false)));
  await check('owner: on-behalf never for themselves', () => assertFails(ownerCreates(owner, 'obSelf', onBehalf({ partnerUid: 'owner1' }), false)));
  await check('owner: cannot name the partner as its creator', () => assertFails(ownerCreates(owner, 'obForge', onBehalf({ createdByUid: 'partner1' }), false)));
  await check('owner: must name themselves as its creator', () => assertFails(ownerCreates(owner, 'obNoCreator', newRequest(), false)));
  await check('owner: cannot say the partner wrote it', () => assertFails(ownerCreates(owner, 'obRole', onBehalf({ createdByRole: 'partner' }), false)));
  await check('owner: cannot assign it to another owner', () => assertFails(ownerCreates(owner, 'obOther', onBehalf({ ownerUid: 'owner2' }), false)));
  await check('owner: an on-behalf request starts as a request (not already planned)', () => assertFails(ownerCreates(owner, 'obPlanned', onBehalf({ status: 'planned', plannedDate: '2026-10-16', linkedActionId: 'a1' }), false)));
  await check('owner: an on-behalf request takes no other fields', () => assertFails(ownerCreates(owner, 'obExtra', onBehalf({ deletedAt: null }), false)));
  await check('another owner: cannot record a request for owner1\'s partner', () => assertFails(ownerCreates(owner2, 'obO2', onBehalf({ ownerUid: 'owner2', createdByUid: 'owner2' }), false)));
  await check('no profile: cannot record a request on anyone\'s behalf', () => assertFails(ownerCreates(stranger, 'obSt', onBehalf({ createdByUid: 'stranger1' }), false)));
  await check('owner: "created" entry only for a request they created', () => assertFails(owner.doc(UPD + '/reqB_created').set(createdEntry('reqB', { partnerUid: 'partner2' }))));
  await check('owner: "created" entry cannot name the partner as its author', () => assertFails(ownerCreates(owner, 'obBadEntry', onBehalf(), createdEntry('obBadEntry', { actorUid: 'partner1' }))));
  await check('partner: cannot write a request as if the owner made it', () => assertFails(partner.collection(RQ).add(newRequest({ createdByUid: 'owner1', createdByRole: 'owner' }))));
  await check('partner: cannot claim the owner role as creator', () => assertFails(partner.collection(RQ).add(newRequest({ createdByUid: 'partner1', createdByRole: 'owner' }))));
  await check('partner: may record themselves as creator', () => assertSucceeds(partner.collection(RQ).add(newRequest({ createdByUid: 'partner1', createdByRole: 'partner' }))));
  await check('owner: provenance never changes (createdByUid)', () => assertFails(owner.doc(RQ + '/obA').update({ createdByUid: 'partner1' })));
  await check('owner: provenance never changes (createdByRole)', () => assertFails(owner.doc(RQ + '/obA').update({ createdByRole: 'partner' })));
  await check('partner: cannot rewrite provenance', () => assertFails(partner.doc(RQ + '/obA').update({ createdByUid: 'partner1', createdByRole: 'partner' })));
  await check('partner: cannot add provenance to an older request', () => assertFails(partner.doc(RQ + '/reqA').update({ createdByUid: 'owner1' })));
  await check('partner: can edit the wording of a request recorded for them', () => assertSucceeds(partner.doc(RQ + '/obA').update({ text: 'Buy oat milk', updatedAt: 'now' })));
  await check('owner: processes it like any request (plan)', () => assertSucceeds(owner.doc(RQ + '/obA').update({ status: 'planned', plannedDate: '2026-10-16', linkedActionId: 'actOB', updatedAt: 'now', processedAt: 'now' })));
  await check('owner: cannot change who asked', () => assertFails(owner.doc(RQ + '/obA').update({ partnerUid: 'partner2' })));

  // ---- Deleting a request: soft, once, by the right person ----
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(RQ + '/delP').set(newRequest({ text: 'Typo reqest', status: 'planned', plannedDate: '2026-10-16', linkedActionId: 'actP' }));
    await db.doc(RQ + '/delP2').set(newRequest({ text: 'Another' }));
    await db.doc(RQ + '/delO').set(onBehalf({ text: 'Recorded by mistake' }));
    await db.doc(RQ + '/delW').set(newRequest({ text: 'Withdrawn one', status: 'withdrawn' }));
    await db.doc(RQ + '/delB').set(newRequest({ partnerUid: 'partner2', text: 'B request' }));
  });
  const del = (by, role, o) => Object.assign({ deletedAt: '2026-10-16T10:00:00Z', deletedByUid: by, deletedByRole: role, updatedAt: '2026-10-16T10:00:00Z' }, o || {});
  const delEntry = (id, by, role, o) => Object.assign({ requestId: id, ownerUid: 'owner1', partnerUid: 'partner1', type: 'deleted',
    actorUid: by, actorRole: role, text: null, createdAt: NOW(), metadata: {} }, o || {});
  async function deletes(db, id, by, role, o, entry){
    const b = db.batch();
    b.update(db.doc(RQ + '/' + id), del(by, role, o));
    if (entry !== false) b.set(db.doc(UPD + '/' + id + '_deleted'), entry || delEntry(id, by, role));
    return b.commit();
  }
  await check('owner: cannot delete a request the partner made', () => assertFails(deletes(owner, 'delP', 'owner1', 'owner')));
  await check('owner: cannot delete one they recorded while naming the partner', () => assertFails(deletes(owner, 'delO', 'partner1', 'owner', null, false)));
  await check('another owner: cannot delete owner1\'s requests', () => assertFails(deletes(owner2, 'delO', 'owner2', 'owner', null, false)));
  await check('no profile: cannot delete a request', () => assertFails(deletes(stranger, 'delP2', 'stranger1', 'partner', null, false)));
  await check('partner B: cannot delete partner A\'s request', () => assertFails(deletes(partnerB, 'delP2', 'partner2', 'partner', null, false)));
  await check('partner B (paused): cannot delete even their own', () => assertFails(deletes(partnerB, 'delB', 'partner2', 'partner', null, false)));
  await check('partner: cannot delete as the owner', () => assertFails(deletes(partner, 'delP2', 'partner1', 'owner', null, false)));
  await check('partner: deleting changes nothing else', () => assertFails(deletes(partner, 'delP2', 'partner1', 'partner', { status: 'dismissed' }, false)));
  await check('partner: cannot remove a request from Firestore', () => assertFails(partner.doc(RQ + '/delP2').delete()));
  await check('owner: cannot remove a request from Firestore', () => assertFails(owner.doc(RQ + '/delO').delete()));
  await check('partner: "deleted" entry only for a deleted request', () => assertFails(partner.doc(UPD + '/delP2_deleted').set(delEntry('delP2', 'partner1', 'partner'))));
  await check('partner: can delete their planned request (its Action is the owner\'s, untouched)', () => assertSucceeds(deletes(partner, 'delP', 'partner1', 'partner')));
  await check('owner: can delete a request they recorded on the partner\'s behalf', () => assertSucceeds(deletes(owner, 'delO', 'owner1', 'owner')));
  await check('partner: can delete a request the owner recorded for them', () => assertSucceeds(deletes(partner, 'obA', 'partner1', 'partner')));
  await check('partner: can delete a withdrawn request', () => assertSucceeds(deletes(partner, 'delW', 'partner1', 'partner')));
  await check('owner: a deleted request stays readable (for its linked Action)', () => assertSucceeds(owner.doc(RQ + '/delP').get()));
  await check('deleted: cannot be deleted again', () => assertFails(deletes(partner, 'delP', 'partner1', 'partner', { deletedAt: '2026-10-16T11:00:00Z' }, false)));
  await check('deleted: cannot be undeleted', () => assertFails(partner.doc(RQ + '/delP').update({ deletedAt: null, deletedByUid: null, deletedByRole: null })));
  await check('deleted: the partner cannot edit it', () => assertFails(partner.doc(RQ + '/delO').update({ text: 'Back again', updatedAt: 'now' })));
  await check('deleted: the partner cannot withdraw it', () => assertFails(partner.doc(RQ + '/obA').update({ status: 'withdrawn', updatedAt: 'now', latestUpdateAt: 'now', latestUpdateBy: 'partner', latestUpdateType: 'withdrawn' })));
  await check('deleted: the partner cannot hide it', () => assertFails(partner.doc(RQ + '/delW').update({ partnerHiddenAt: 'now', updatedAt: 'now' })));
  await check('deleted: the partner cannot mark it read', () => assertFails(partner.doc(RQ + '/delP').update({ partnerLastReadAt: 'now' })));
  await check('deleted: the owner cannot process it', () => assertFails(owner.doc(RQ + '/delO').update({ status: 'planned', plannedDate: '2026-10-16', linkedActionId: 'actX', updatedAt: 'now', processedAt: 'now' })));
  await check('deleted: the owner cannot complete it', () => assertFails(owner.doc(RQ + '/delP').update({ status: 'done', updatedAt: 'now' })));
  await check('deleted: a stale device cannot write it back', () => assertFails(partner.doc(RQ + '/delP2x').set(newRequest()).then(() => partner.doc(RQ + '/delO').set(onBehalf()))));
  await check('deleted: no new update from the partner', () => assertFails(partner.collection(UPD).add(upd({ requestId: 'delP' }))));
  await check('deleted: no new update from the owner', () => assertFails(owner.collection(UPD).add(ownerUpd({ requestId: 'delO' }))));
  await check('deleted: no status entry from the owner', () => assertFails(owner.collection(UPD).add(sysUpd({ requestId: 'delP', type: 'status', metadata: { status: 'done' } }))));
  await check('deleted: its "deleted" entry is written once', () => assertFails(partner.doc(UPD + '/delP_deleted').set(delEntry('delP', 'partner1', 'partner'))));
  await check('deleted: only the person who deleted it writes its entry', () => assertFails(owner.doc(UPD + '/delW_deleted').set(delEntry('delW', 'owner1', 'owner'))));
  await check('deleted: a withdrawn request deleted cannot be moved to upcoming', async () => {
    const b = partner.batch(), nref = partner.collection(RQ).doc();
    b.set(nref, newRequest({ requestedTiming: 'later', renewedFrom: 'delW' }));
    b.update(partner.doc(RQ + '/delW'), { renewedAs: nref.id, updatedAt: 'now' });
    await assertFails(b.commit());
  });
  await check('partner: still reads the deleted request\'s history (nothing else changes)', () => assertSucceeds(partner.doc(UPD + '/delP_deleted').get()));

  // ---- Home: Shaun (owner, admin), Abi (partner, admin), the nanny (household, member) ----
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('ledger_users/nanny1').set({ role: 'household', displayName: 'Nanny' });
    await db.doc('ledger_users/nanny2').set({ role: 'household', displayName: 'Nanny two' });
    await db.doc('ledger_users/exnanny').set({ role: 'household', displayName: 'Ex' });
    await db.doc('ledger_homes/owner1').set({ name: 'Home', ownerUid: 'owner1', createdAt: 'x' });
    const M = (role, status, name) => ({ homeId: 'owner1', role, status, displayName: name, addedByUid: 'owner1', addedAt: 'x' });
    await db.doc('ledger_home_members/owner1').set(M('admin', 'active', 'Shaun'));
    await db.doc('ledger_home_members/partner1').set(M('admin', 'active', 'Abi'));
    await db.doc('ledger_home_members/nanny1').set(M('member', 'active', 'Maria'));
    await db.doc('ledger_home_members/exnanny').set(M('member', 'removed', 'Ex'));
    const R = (o) => Object.assign({ homeId: 'owner1', text: 'x', note: null, requestedTiming: 'today', requestedDate: null, visibility: 'private',
      status: 'requested', plannedDate: null, linkedActionId: null, createdAt: 'x', updatedAt: 'x' }, o);
    await db.doc('ledger_home_requests/hr1').set(R({ text: 'Bath at 6', requesterUid: 'owner1', assigneeUid: 'nanny1', createdByUid: 'owner1', participants: ['owner1', 'nanny1'] }));
    await db.doc('ledger_home_requests/hr2').set(R({ text: 'Private between us', requesterUid: 'partner1', assigneeUid: 'owner1', createdByUid: 'partner1', participants: ['partner1', 'owner1'] }));
    await db.doc('ledger_home_requests/hr3').set(R({ text: 'Shared: tidy the playroom', requesterUid: 'partner1', assigneeUid: 'owner1', createdByUid: 'partner1', participants: ['partner1', 'owner1'], visibility: 'home' }));
    await db.doc('ledger_home_requests/hr4').set(R({ text: 'Nappies running low', requesterUid: 'nanny1', assigneeUid: 'partner1', createdByUid: 'nanny1', participants: ['nanny1', 'partner1'] }));
    await db.doc('ledger_home_requests/hr1/updates/created').set({ type: 'created', actorUid: 'owner1', text: null, createdAt: 'x', metadata: {} });
    await db.doc('ledger_home_requests/hr2/updates/created').set({ type: 'created', actorUid: 'partner1', text: null, createdAt: 'x', metadata: {} });
  });
  const nanny = env.authenticatedContext('nanny1', { email: 'n@example.com' }).firestore();
  const nanny2 = env.authenticatedContext('nanny2', { email: 'n2@example.com' }).firestore();
  const exnanny = env.authenticatedContext('exnanny', { email: 'x@example.com' }).firestore();
  const HM = 'ledger_home_members', HR = 'ledger_home_requests';
  const member = (o) => Object.assign({ homeId: 'owner1', role: 'member', status: 'active', displayName: 'Nanny two', addedByUid: 'owner1', addedAt: 'now' }, o || {});
  // the Home and its people
  await check('home: an owner creates their own Home', () => assertSucceeds(owner2.doc('ledger_homes/owner2').set({ name: 'Home', ownerUid: 'owner2', createdAt: 'now' })));
  await check('home: never under someone else\'s id', () => assertFails(owner.doc('ledger_homes/owner2x').set({ name: 'Home', ownerUid: 'owner1', createdAt: 'now' })));
  await check('home: a partner cannot create one', () => assertFails(partner.doc('ledger_homes/partner1').set({ name: 'Home', ownerUid: 'partner1', createdAt: 'now' })));
  await check('home: members read their Home', () => assertSucceeds(nanny.doc('ledger_homes/owner1').get()));
  await check('home: members list the people at Home', () => assertSucceeds(nanny.collection(HM).where('homeId', '==', 'owner1').get()));
  await check('home: a removed member cannot', () => assertFails(exnanny.collection(HM).where('homeId', '==', 'owner1').get()));
  await check('home: someone not at Home cannot', () => assertFails(nanny2.collection(HM).where('homeId', '==', 'owner1').get()));
  await check('home: a removed member still reads their own record', () => assertSucceeds(exnanny.doc(HM + '/exnanny').get()));
  await check('home: no profile, nothing', () => assertFails(stranger.collection(HM).where('homeId', '==', 'owner1').get()));
  await check('members: the owner adds a household account', () => assertSucceeds(owner.doc(HM + '/nanny2').set(member())));
  await check('members: never someone without an app role', () => assertFails(owner.doc(HM + '/stranger1').set(member({ displayName: 'S' }))));
  await check('members: a household account is never an admin', () => assertFails(owner.doc(HM + '/nanny2').set(member({ role: 'admin' }))));
  await check('members: never another owner', () => assertFails(owner.doc(HM + '/owner2').set(member({ role: 'admin', displayName: 'O2' }))));
  await check('members: Abi (admin) cannot add or remove people', () => assertFails(partner.doc(HM + '/nanny2').set(member({ status: 'removed' }))));
  await check('members: the nanny cannot either', () => assertFails(nanny.doc(HM + '/nanny2').set(member({ status: 'removed' }))));
  await check('members: another owner cannot add to this Home', () => assertFails(owner2.doc(HM + '/nanny2').set(member())));
  await check('members: the owner cannot step down or leave', () => assertFails(owner.doc(HM + '/owner1').update({ status: 'removed' })));
  await check('members: nobody promotes themselves', () => assertFails(nanny.doc(HM + '/nanny1').update({ role: 'admin' })));
  await check('members: the owner removes someone (a state; no delete)', () => assertSucceeds(owner.doc(HM + '/nanny2').set(member({ status: 'removed', removedByUid: 'owner1', removedAt: 'now' }))));
  await check('members: never deleted', () => assertFails(owner.doc(HM + '/nanny2').delete()));
  // who sees which request
  await check('requests: an admin sees the whole Home', () => assertSucceeds(owner.collection(HR).where('homeId', '==', 'owner1').get()));
  await check('requests: Abi (admin) too', () => assertSucceeds(partner.collection(HR).where('homeId', '==', 'owner1').get()));
  await check('requests: the nanny sees the ones she is part of', () => assertSucceeds(nanny.collection(HR).where('homeId', '==', 'owner1').where('participants', 'array-contains', 'nanny1').get()));
  await check('requests: …and the ones shared with the whole Home', () => assertSucceeds(nanny.collection(HR).where('homeId', '==', 'owner1').where('visibility', '==', 'home').get()));
  await check('requests: the nanny cannot list the whole Home', () => assertFails(nanny.collection(HR).where('homeId', '==', 'owner1').get()));
  await check('requests: …nor read one between Shaun and Abi', () => assertFails(nanny.doc(HR + '/hr2').get()));
  await check('requests: …nor its history', () => assertFails(nanny.collection(HR + '/hr2/updates').get()));
  await check('requests: she reads a shared one', () => assertSucceeds(nanny.doc(HR + '/hr3').get()));
  await check('requests: she reads her own one\'s history', () => assertSucceeds(nanny.collection(HR + '/hr1/updates').get()));
  await check('requests: a removed member reads nothing', () => assertFails(exnanny.doc(HR + '/hr1').get()));
  await check('requests: someone not at Home reads nothing', () => assertFails(nanny2.doc(HR + '/hr3').get()));
  await check('requests: no profile, nothing', () => assertFails(stranger.doc(HR + '/hr1').get()));
  await check('requests: another owner, nothing', () => assertFails(owner2.doc(HR + '/hr1').get()));
  // asking
  const ask = (o) => Object.assign({ homeId: 'owner1', text: 'Milk', note: null, requestedTiming: 'today', requestedDate: null, visibility: 'private',
    status: 'requested', plannedDate: null, linkedActionId: null, createdAt: 'now', updatedAt: 'now' }, o);
  const created = (by) => ({ type: 'created', actorUid: by, text: null, createdAt: NOW(), metadata: {} });
  async function asks(db, id, doc, by){ const b = db.batch(); b.set(db.doc(HR + '/' + id), doc); b.set(db.doc(HR + '/' + id + '/updates/created'), created(by)); return b.commit(); }
  await check('ask: the nanny asks Shaun', () => assertSucceeds(asks(nanny, 'n1', ask({ requesterUid: 'nanny1', assigneeUid: 'owner1', createdByUid: 'nanny1', participants: ['nanny1', 'owner1'] }), 'nanny1')));
  await check('why: Abi says why she is asking', () => assertSucceeds(asks(partner, 'w1', ask({ why: 'So it is ready for Sunday', requesterUid: 'partner1', assigneeUid: 'nanny1', createdByUid: 'partner1', participants: ['partner1', 'nanny1'] }), 'partner1')));
  await check('why: …at most 300 characters', () => assertFails(asks(partner, 'w2', ask({ why: 'x'.repeat(301), requesterUid: 'partner1', assigneeUid: 'nanny1', createdByUid: 'partner1', participants: ['partner1', 'nanny1'] }), 'partner1')));
  await check('why: …and only words', () => assertFails(asks(partner, 'w3', ask({ why: { html: '<b>' }, requesterUid: 'partner1', assigneeUid: 'nanny1', createdByUid: 'partner1', participants: ['partner1', 'nanny1'] }), 'partner1')));
  await check('why: Abi rewords why while it waits', () => assertSucceeds(partner.doc(HR + '/w1').update({ why: 'The in-laws arrive Friday', updatedAt: 'now' })));
  await check('why: the nanny (asked) cannot rewrite the reason', () => assertFails(nanny.doc(HR + '/w1').update({ why: 'No reason', updatedAt: 'now' })));
  await check('ask: Abi asks the nanny, shared with the whole Home', () => assertSucceeds(asks(partner, 'a1', ask({ requesterUid: 'partner1', assigneeUid: 'nanny1', createdByUid: 'partner1', participants: ['partner1', 'nanny1'], visibility: 'home' }), 'partner1')));
  await check('ask: Shaun records the nanny asking Abi (on her behalf)', () => assertSucceeds(asks(owner, 'o1', ask({ requesterUid: 'nanny1', assigneeUid: 'partner1', createdByUid: 'owner1', participants: ['nanny1', 'partner1', 'owner1'] }), 'owner1')));
  await check('ask: the nanny never asks on someone else\'s behalf', () => assertFails(asks(nanny, 'n2', ask({ requesterUid: 'partner1', assigneeUid: 'owner1', createdByUid: 'nanny1', participants: ['partner1', 'owner1', 'nanny1'] }), 'nanny1')));
  await check('ask: the creator is always the one writing', () => assertFails(asks(nanny, 'n3', ask({ requesterUid: 'nanny1', assigneeUid: 'owner1', createdByUid: 'owner1', participants: ['nanny1', 'owner1'] }), 'nanny1')));
  await check('ask: never of someone removed', () => assertFails(asks(owner, 'o2', ask({ requesterUid: 'owner1', assigneeUid: 'exnanny', createdByUid: 'owner1', participants: ['owner1', 'exnanny'] }), 'owner1')));
  await check('ask: never of someone not at Home', () => assertFails(asks(owner, 'o3', ask({ requesterUid: 'owner1', assigneeUid: 'nanny2', createdByUid: 'owner1', participants: ['owner1', 'nanny2'] }), 'owner1')));
  // a task for yourself: your own idea, or something asked of you in person
  await check('own: the nanny adds a task for herself, for everyone to see', () => assertSucceeds(asks(nanny, 'n4', ask({ requesterUid: 'nanny1', assigneeUid: 'nanny1', createdByUid: 'nanny1', participants: ['nanny1'], visibility: 'home' }), 'nanny1')));
  await check('own: she marks it done', () => assertSucceeds(act(nanny, 'n4', { status: 'done', latestUpdateAt: 'now', latestUpdateByUid: 'nanny1', latestUpdateType: 'status', updatedAt: 'now' }, { type: 'status', actorUid: 'nanny1', text: null, createdAt: NOW(), metadata: { status: 'done' } })));
  await check('own: the nanny records what Abi asked her in person', () => assertSucceeds(asks(nanny, 'n4b', ask({ requesterUid: 'partner1', assigneeUid: 'nanny1', createdByUid: 'nanny1', participants: ['partner1', 'nanny1'] }), 'nanny1')));
  await check('own: never "their own" for someone else', () => assertFails(asks(nanny, 'n4c', ask({ requesterUid: 'owner1', assigneeUid: 'owner1', createdByUid: 'nanny1', participants: ['owner1', 'nanny1'] }), 'nanny1')));
  await check('own: never written down as if the asker wrote it', () => assertFails(asks(nanny, 'n4d', ask({ requesterUid: 'partner1', assigneeUid: 'nanny1', createdByUid: 'partner1', participants: ['partner1', 'nanny1'] }), 'nanny1')));
  await check('own: never as asked by someone not at Home', () => assertFails(asks(nanny, 'n4e', ask({ requesterUid: 'exnanny', assigneeUid: 'nanny1', createdByUid: 'nanny1', participants: ['exnanny', 'nanny1'] }), 'nanny1')));
  await check('own: just her, nobody added', () => assertFails(asks(nanny, 'n4f', ask({ requesterUid: 'nanny1', assigneeUid: 'nanny1', createdByUid: 'nanny1', participants: ['nanny1', 'partner1'] }), 'nanny1')));
  await check('ask: participants are exactly who it involves (none left out)', () => assertFails(asks(owner, 'o4', ask({ requesterUid: 'nanny1', assigneeUid: 'partner1', createdByUid: 'owner1', participants: ['nanny1', 'partner1'] }), 'owner1')));
  await check('ask: …and nobody added', () => assertFails(asks(nanny, 'n5', ask({ requesterUid: 'nanny1', assigneeUid: 'owner1', createdByUid: 'nanny1', participants: ['nanny1', 'owner1', 'partner1'] }), 'nanny1')));
  await check('ask: starts as a request, unlinked', () => assertFails(asks(nanny, 'n6', ask({ requesterUid: 'nanny1', assigneeUid: 'owner1', createdByUid: 'nanny1', participants: ['nanny1', 'owner1'], status: 'done' }), 'nanny1')));
  await check('ask: never with a private Action attached', () => assertFails(asks(owner, 'o5', ask({ requesterUid: 'owner1', assigneeUid: 'nanny1', createdByUid: 'owner1', participants: ['owner1', 'nanny1'], linkedActionId: 'a1' }), 'owner1')));
  await check('ask: only private or the whole Home', () => assertFails(asks(nanny, 'n7', ask({ requesterUid: 'nanny1', assigneeUid: 'owner1', createdByUid: 'nanny1', participants: ['nanny1', 'owner1'], visibility: 'public' }), 'nanny1')));
  await check('ask: never into another Home', () => assertFails(asks(nanny, 'n8', ask({ homeId: 'owner2', requesterUid: 'nanny1', assigneeUid: 'owner1', createdByUid: 'nanny1', participants: ['nanny1', 'owner1'] }), 'nanny1')));
  await check('ask: its "created" entry is the creator\'s', () => assertFails(nanny.doc(HR + '/hr4/updates/created2').set(created('nanny1'))));
  await check('ask: a removed member cannot ask', () => assertFails(asks(exnanny, 'x1', ask({ requesterUid: 'exnanny', assigneeUid: 'owner1', createdByUid: 'exnanny', participants: ['exnanny', 'owner1'] }), 'exnanny')));
  // working on it
  const sumBy = (uid, type, o) => Object.assign({ latestUpdateAt: 'now', latestUpdateByUid: uid, latestUpdateType: type, updatedAt: 'now' }, o || {});
  const entry = (by, type, meta, text) => ({ type, actorUid: by, text: text || null, createdAt: NOW(), metadata: meta || {} });
  async function act(db, id, patch, e){ const b = db.batch(); b.update(db.doc(HR + '/' + id), patch); if (e) b.set(db.collection(HR + '/' + id + '/updates').doc(), e); return b.commit(); }
  await check('work: the requester rewords it while it waits', () => assertSucceeds(nanny.doc(HR + '/hr4').update({ text: 'Nappies: size 5', updatedAt: 'now' })));
  await check('work: an admin (Abi, asked it) corrects its wording — the history says so', async () => {
    const b = partner.batch();
    b.update(partner.doc(HR + '/hr4'), { text: 'Nappies: size 5 (Pampers)', latestUpdateAt: 'now', latestUpdateByUid: 'partner1', latestUpdateType: 'edited', updatedAt: 'now' });
    b.set(partner.collection(HR + '/hr4/updates').doc(), { type: 'edited', actorUid: 'partner1', text: null, createdAt: NOW(), metadata: { fromText: 'Nappies: size 5', timing: 'today' } });
    return assertSucceeds(b.commit());
  });
  await check('work: …and clears its date', () => assertSucceeds(partner.doc(HR + '/hr4').update({ requestedTiming: 'none', requestedDate: null, updatedAt: 'now' })));
  await check('work: an admin never rewrites who it\'s for this way', () => assertFails(partner.doc(HR + '/hr4').update({ text: 'x', assigneeUid: 'owner1', updatedAt: 'now' })));
  await check('work: an admin never signs as someone else', () => assertFails(partner.doc(HR + '/hr4').update({ text: 'y', latestUpdateByUid: 'nanny1', updatedAt: 'now' })));
  await check('work: the nanny (assignee, not an admin) cannot reword what Shaun asked her', () => assertFails(nanny.doc(HR + '/hr1').update({ text: 'Something else', updatedAt: 'now' })));
  await check('work: the nanny cannot write an "edited" entry on what she didn\'t write', () => assertFails(nanny.collection(HR + '/hr1/updates').add({ type: 'edited', actorUid: 'nanny1', text: null, createdAt: NOW(), metadata: {} })));
  await check('work: the nanny starts what was asked of her', () => assertSucceeds(act(nanny, 'hr1', Object.assign({ status: 'in_progress' }, sumBy('nanny1', 'status')), entry('nanny1', 'status', { status: 'in_progress' }))));
  await check('work: …and finishes it', () => assertSucceeds(act(nanny, 'hr1', Object.assign({ status: 'done' }, sumBy('nanny1', 'status')), entry('nanny1', 'status', { status: 'done' }))));
  await check('work: a "done" entry only when it is done', () => assertFails(nanny.collection(HR + '/hr4/updates').add(entry('nanny1', 'status', { status: 'done' }))));
  await check('work: the nanny never links an Action', () => assertFails(nanny.doc(HR + '/hr1').update({ linkedActionId: 'a9', linkedByUid: 'nanny1' })));
  await check('work: an admin does not change someone else\'s work', () => assertFails(partner.doc(HR + '/hr1').update({ status: 'requested', updatedAt: 'now' })));
  await check('work: Shaun plans what is his, linking his Action by id', () => assertSucceeds(act(owner, 'hr2', Object.assign({ status: 'planned', plannedDate: '2026-10-18', linkedActionId: 'actH2', linkedByUid: 'owner1', processedAt: 'now' }, sumBy('owner1', 'planned')), entry('owner1', 'planned', { toDate: '2026-10-18' }))));
  await check('work: "Can\'t do", with a reason', () => assertSucceeds(act(partner, 'hr4', Object.assign({ status: 'cant_do', cantDoReason: 'Out until Friday' }, sumBy('partner1', 'cant_do')), entry('partner1', 'cant_do', {}, null))));
  await check('work: nobody rewrites who asked', () => assertFails(owner.doc(HR + '/hr2').update({ requesterUid: 'owner1' })));
  await check('work: …who wrote it', () => assertFails(partner.doc(HR + '/hr4').update({ createdByUid: 'partner1' })));
  await check('work: …or which Home', () => assertFails(owner.doc(HR + '/hr2').update({ homeId: 'owner2' })));
  // passing it on
  const pass = (from, to, parts) => ({ assigneeUid: to, participants: parts, status: 'requested', plannedDate: null, linkedActionId: null, linkedByUid: null, cantDoReason: null, latestUpdateAt: 'now', latestUpdateByUid: from, latestUpdateType: 'reassigned', updatedAt: 'now' });
  await check('pass: Abi passes the nanny\'s request on to Shaun', () => assertSucceeds(act(partner, 'hr4', pass('partner1', 'owner1', ['nanny1', 'partner1', 'owner1']), entry('partner1', 'reassigned', { fromUid: 'partner1', toUid: 'owner1' }))));
  await check('pass: never back to the person who asked', () => assertFails(act(owner, 'hr4', pass('owner1', 'nanny1', ['nanny1', 'partner1', 'owner1']))));
  await check('pass: nobody drops out of it', () => assertFails(act(owner, 'hr2', pass('owner1', 'nanny1', ['owner1', 'nanny1']))));
  await check('pass: the nanny cannot pass on what is not hers', () => assertFails(act(nanny, 'hr3', pass('nanny1', 'nanny1', ['partner1', 'owner1', 'nanny1']))));
  await check('pass: an admin passes work on (Shaun → Abi takes the nanny\'s)', () => assertSucceeds(act(owner, 'n1', pass('owner1', 'partner1', ['nanny1', 'owner1', 'partner1']), entry('owner1', 'reassigned', { fromUid: 'owner1', toUid: 'partner1' }))));
  await check('pass: a "reassigned" entry only in the write that passes it', () => assertFails(nanny.collection(HR + '/n1/updates').add(entry('nanny1', 'reassigned', { fromUid: 'nanny1', toUid: 'partner1' }))));
  // who can see it, comments, read marks
  await check('visibility: its creator shares it with the whole Home', () => assertSucceeds(act(nanny, 'hr4', Object.assign({ visibility: 'home' }, sumBy('nanny1', 'visibility')), entry('nanny1', 'visibility', { visibility: 'home' }))));
  await check('visibility: not someone else\'s to change', () => assertFails(nanny.doc(HR + '/hr3').update({ visibility: 'private', updatedAt: 'now' })));
  await check('comment: the nanny adds an update to her request', () => assertSucceeds(act(nanny, 'hr1', { latestCommentAt: 'now', latestCommentByUid: 'nanny1', latestCommentText: 'Bath done, early night', latestUpdateAt: 'now', latestUpdateByUid: 'nanny1', latestUpdateType: 'comment', updatedAt: 'now' }, entry('nanny1', 'comment', {}, 'Bath done, early night'))));
  await check('comment: never signed as someone else', () => assertFails(nanny.doc(HR + '/hr1').update({ latestCommentByUid: 'owner1', latestCommentText: 'x', latestCommentAt: 'now' })));
  await check('comment: not on a request she cannot see', () => assertFails(nanny.collection(HR + '/hr2/updates').add(entry('nanny1', 'comment', {}, 'hi'))));
  await check('read: her own read mark', () => assertSucceeds(nanny.doc(HR + '/hr1').update({ 'readAt.nanny1': 'now' })));
  await check('read: never someone else\'s', () => assertFails(nanny.doc(HR + '/hr1').update({ 'readAt.owner1': 'now' })));
  // several at once: a list goes in chunks of five (one batch each), then one summary record
  const listBatch = async (db, by, to, ids, bid) => { const b = db.batch(); ids.forEach(id => { b.set(db.doc(HR + '/' + id), ask({ text: 'Task ' + id, requesterUid: by, assigneeUid: to, createdByUid: by, participants: [by, to] }));
    b.set(db.doc(HR + '/' + id + '/updates/created'), Object.assign(created(by), { metadata: { batchId: bid, timing: 'today' } })); }); return b.commit(); };
  await check('list: Abi sends the nanny five in one batch', () => assertSucceeds(listBatch(partner, 'partner1', 'nanny1', ['L1', 'L2', 'L3', 'L4', 'L5'], 'B1')));
  await check('list: …and the next five', () => assertSucceeds(listBatch(partner, 'partner1', 'nanny1', ['L6', 'L7', 'L8', 'L9', 'L10'], 'B1')));
  await check('list: a retry of a chunk already written is refused (never a second copy)', () => assertFails(listBatch(partner, 'partner1', 'nanny1', ['L1', 'L2'], 'B1')));
  const HB = 'ledger_home_batches';
  const summary = (o) => Object.assign({ homeId: 'owner1', createdByUid: 'partner1', batchId: 'B1', requestIds: ['L1', 'L2'], count: 2, createdAt: 'now' }, o || {});
  await check('list summary: written once by whoever sent the list', () => assertSucceeds(partner.doc(HB + '/B1').set(summary())));
  await check('list summary: a later part of the same list', () => assertSucceeds(partner.doc(HB + '/B1_1').set(summary({ requestIds: ['L3'], count: 1 }))));
  await check('list summary: never as someone else', () => assertFails(nanny.doc(HB + '/B2').set(summary({ batchId: 'B2', createdByUid: 'partner1' }))));
  await check('list summary: never by someone not at Home', () => assertFails(nanny2.doc(HB + '/B3').set(summary({ batchId: 'B3', createdByUid: 'nanny2' }))));
  await check('list summary: never into another Home', () => assertFails(partner.doc(HB + '/B4').set(summary({ batchId: 'B4', homeId: 'owner2' }))));
  await check('list summary: its id is its list', () => assertFails(partner.doc(HB + '/Bx').set(summary({ batchId: 'B5' }))));
  await check('list summary: the count is the list', () => assertFails(partner.doc(HB + '/B6').set(summary({ batchId: 'B6', count: 9 }))));
  await check('list summary: at most forty', () => assertFails(partner.doc(HB + '/B7').set(summary({ batchId: 'B7', requestIds: Array.from({ length: 41 }, (_, i) => 'x' + i), count: 41 }))));
  await check('list summary: nothing else in it', () => assertFails(partner.doc(HB + '/B8').set(summary({ batchId: 'B8', recipientUid: 'owner1' }))));
  await check('list summary: nobody reads it back', () => assertFails(partner.doc(HB + '/B1').get()));
  await check('list summary: or changes it', () => assertFails(partner.doc(HB + '/B1').update({ count: 2 })));
  await check('list summary: or removes it', () => assertFails(partner.doc(HB + '/B1').delete()));
  // checklists: one document per item, inside its request
  const item = (by, o) => Object.assign({ text: 'Milk', done: false, order: 1, createdByUid: by, createdAt: 'now', doneByUid: null, doneAt: null, updatedByUid: by, updatedAt: 'now' }, o || {});
  async function askWithList(db, id, doc, by, n){ const b = db.batch(); b.set(db.doc(HR + '/' + id), Object.assign({ hasChecklist: true }, doc)); b.set(db.doc(HR + '/' + id + '/updates/created'), created(by));
    for (let i = 0; i < n; i++) b.set(db.doc(HR + '/' + id + '/items/i' + i), item(by, { text: 'Item ' + i, order: i })); return b.commit(); }
  await check('checklist: the nanny asks Abi for groceries, with three items, in one write', () => assertSucceeds(askWithList(nanny, 'G1', ask({ text: 'Weekly groceries', requesterUid: 'nanny1', assigneeUid: 'partner1', createdByUid: 'nanny1', participants: ['nanny1', 'partner1'] }), 'nanny1', 3)));
  await check('checklist: …or forty', () => assertSucceeds(askWithList(nanny, 'G2', ask({ text: 'Big shop', requesterUid: 'nanny1', assigneeUid: 'partner1', createdByUid: 'nanny1', participants: ['nanny1', 'partner1'] }), 'nanny1', 40)));
  await check('checklist: a request never says it has none', () => assertFails(asks(nanny, 'G3', ask({ hasChecklist: false, requesterUid: 'nanny1', assigneeUid: 'owner1', createdByUid: 'nanny1', participants: ['nanny1', 'owner1'] }), 'nanny1')));
  await check('checklist: Abi (assignee) ticks one, as herself', () => assertSucceeds(partner.doc(HR + '/G1/items/i0').update({ done: true, doneByUid: 'partner1', doneAt: 'now', updatedByUid: 'partner1', updatedAt: 'now' })));
  await check('checklist: never ticked in someone else\'s name', () => assertFails(partner.doc(HR + '/G1/items/i1').update({ done: true, doneByUid: 'nanny1', doneAt: 'now', updatedByUid: 'partner1', updatedAt: 'now' })));
  await check('checklist: never edited in someone else\'s name', () => assertFails(partner.doc(HR + '/G1/items/i1').update({ text: 'Oat milk', updatedByUid: 'nanny1', updatedAt: 'now' })));
  await check('checklist: the nanny (who asked) adds an item', () => assertSucceeds(nanny.doc(HR + '/G1/items/n1').set(item('nanny1', { text: 'Rice', order: 5 }))));
  await check('checklist: …but not as someone else', () => assertFails(nanny.doc(HR + '/G1/items/n2').set(item('partner1', { updatedByUid: 'nanny1' }))));
  await check('checklist: or already ticked by someone else', () => assertFails(nanny.doc(HR + '/G1/items/n3').set(item('nanny1', { done: true, doneByUid: 'partner1', doneAt: 'now' }))));
  await check('checklist: rewording and reordering', () => assertSucceeds(nanny.doc(HR + '/G1/items/n1').update({ text: 'Basmati rice', order: 0.5, updatedByUid: 'nanny1', updatedAt: 'now' })));
  await check('checklist: who added it never changes', () => assertFails(partner.doc(HR + '/G1/items/n1').update({ createdByUid: 'partner1', updatedByUid: 'partner1', updatedAt: 'now' })));
  await check('checklist: who ticked it never changes without unticking', () => assertFails(nanny.doc(HR + '/G1/items/i0').update({ doneByUid: 'nanny1', updatedByUid: 'nanny1', updatedAt: 'now' })));
  await check('checklist: unticking clears who ticked it', () => assertSucceeds(nanny.doc(HR + '/G1/items/i0').update({ done: false, doneByUid: null, doneAt: null, updatedByUid: 'nanny1', updatedAt: 'now' })));
  await check('checklist: unticking must clear it', () => assertFails(nanny.doc(HR + '/G1/items/i0').update({ done: true, doneByUid: 'nanny1', doneAt: 'now', updatedByUid: 'nanny1', updatedAt: 'now' }).then(() => nanny.doc(HR + '/G1/items/i0').update({ done: false, updatedByUid: 'nanny1', updatedAt: 'now' }))));
  await check('checklist: at most 200 characters', () => assertFails(nanny.doc(HR + '/G1/items/n4').set(item('nanny1', { text: 'x'.repeat(201) }))));
  await check('checklist: nothing else on an item', () => assertFails(nanny.doc(HR + '/G1/items/n5').set(item('nanny1', { price: 3 }))));
  await check('checklist: an item is removed by the people in it', () => assertSucceeds(nanny.doc(HR + '/G1/items/n1').delete()));
  await check('checklist: Shaun (admin, not in it) reads it — oversight', () => assertSucceeds(owner.collection(HR + '/G1/items').get()));
  await check('checklist: …but cannot tick, add or remove', () => assertFails(owner.doc(HR + '/G1/items/i1').update({ done: true, doneByUid: 'owner1', doneAt: 'now', updatedByUid: 'owner1', updatedAt: 'now' })));
  await check('checklist: …or add', () => assertFails(owner.doc(HR + '/G1/items/o1').set(item('owner1'))));
  await check('checklist: …or remove', () => assertFails(owner.doc(HR + '/G1/items/i1').delete()));
  await check('checklist: the nanny cannot read a private one between Shaun and Abi', () => assertFails(nanny.collection(HR + '/hr2/items').get()));
  await check('checklist: someone not at Home reads nothing', () => assertFails(nanny2.collection(HR + '/G1/items').get()));
  await check('checklist: the asker gives an existing request one', () => assertSucceeds(partner.doc(HR + '/hr2').update({ hasChecklist: true, updatedAt: 'now' })));
  await check('checklist: not someone outside it', () => assertFails(partner.doc(HR + '/hr1').update({ hasChecklist: true, updatedAt: 'now' })));

  // recurring responsibilities: templates (written by people), occurrences (by the server)
  const RT = 'ledger_home_recurring';
  const tpl = (by, o) => Object.assign({ homeId: 'owner1', title: 'Uniform ready', note: null, createdByUid: by, mode: 'assigned', assigneeUid: 'nanny1', visibility: 'private',
    schedule: { freq: 'weekly', days: [0], monthDay: 1, every: 2, startDate: '2026-10-25', endDate: null, time: null }, timezone: 'Europe/London', checklist: ['Wash', 'Iron'],
    status: 'active', createdAt: 'now', updatedAt: 'now', updatedByUid: by }, o || {});
  await check('recurring: Abi sets one up for the nanny', () => assertSucceeds(partner.doc(RT + '/t1').set(tpl('partner1'))));
  await check('recurring: …with why it matters', () => assertSucceeds(partner.doc(RT + '/tw').set(tpl('partner1', { why: 'Ready for Monday' }))));
  await check('recurring: …why at most 300 characters', () => assertFails(partner.doc(RT + '/tw2').set(tpl('partner1', { why: 'x'.repeat(301) }))));
  await check('recurring: anyone at Home, shared with everyone', () => assertSucceeds(partner.doc(RT + '/t2').set(tpl('partner1', { mode: 'anyone', assigneeUid: null, visibility: 'home' }))));
  await check('recurring: anyone at Home is never private', () => assertFails(partner.doc(RT + '/t3').set(tpl('partner1', { mode: 'anyone', assigneeUid: null, visibility: 'private' }))));
  await check('recurring: never as someone else', () => assertFails(nanny.doc(RT + '/t4').set(tpl('partner1', { updatedByUid: 'nanny1' }))));
  await check('recurring: never for someone not at Home', () => assertFails(partner.doc(RT + '/t5').set(tpl('partner1', { assigneeUid: 'exnanny' }))));
  await check('recurring: one for yourself', () => assertSucceeds(nanny.doc(RT + '/t6').set(tpl('nanny1', { assigneeUid: 'nanny1', visibility: 'home' }))));
  await check('recurring: a schedule that makes sense', () => assertFails(partner.doc(RT + '/t7').set(tpl('partner1', { schedule: { freq: 'hourly', startDate: '2026-10-25' } }))));
  await check('recurring: …weekly means one day', () => assertFails(partner.doc(RT + '/t8').set(tpl('partner1', { schedule: { freq: 'weekly', days: [0, 1], startDate: '2026-10-25' } }))));
  await check('recurring: …ending before it starts is refused', () => assertFails(partner.doc(RT + '/t9').set(tpl('partner1', { schedule: { freq: 'daily', startDate: '2026-10-25', endDate: '2026-10-01' } }))));
  await check('recurring: …every 1 day is "daily", not an interval', () => assertFails(partner.doc(RT + '/t10').set(tpl('partner1', { schedule: { freq: 'interval', every: 1, startDate: '2026-10-25' } }))));
  await check('recurring: never with the server\'s bookkeeping', () => assertFails(partner.doc(RT + '/t11').set(tpl('partner1', { lastDate: '2026-10-25' }))));
  await check('recurring: never set up already ended', () => assertFails(partner.doc(RT + '/t12').set(tpl('partner1', { status: 'ended' }))));
  await check('recurring: the nanny reads one she is assigned', () => assertSucceeds(nanny.doc(RT + '/t1').get()));
  await check('recurring: …and lists hers', () => assertSucceeds(nanny.collection(RT).where('homeId', '==', 'owner1').where('assigneeUid', '==', 'nanny1').get()));
  await check('recurring: …and the shared ones', () => assertSucceeds(nanny.collection(RT).where('homeId', '==', 'owner1').where('visibility', '==', 'home').get()));
  await check('recurring: …but cannot list them all', () => assertFails(nanny.collection(RT).where('homeId', '==', 'owner1').get()));
  await check('recurring: Shaun (admin) lists them all', () => assertSucceeds(owner.collection(RT).where('homeId', '==', 'owner1').get()));
  await check('recurring: Abi pauses hers', () => assertSucceeds(partner.doc(RT + '/t1').update({ status: 'paused', updatedAt: 'now', updatedByUid: 'partner1' })));
  await check('recurring: Shaun (admin) edits the series', () => assertSucceeds(owner.doc(RT + '/t1').update({ title: 'Uniform washed, ironed, ready', status: 'active', updatedAt: 'now', updatedByUid: 'owner1' })));
  await check('recurring: the nanny (assigned, not its author) cannot change it', () => assertFails(nanny.doc(RT + '/t1').update({ status: 'paused', updatedAt: 'now', updatedByUid: 'nanny1' })));
  await check('recurring: nobody writes the server\'s bookkeeping', () => assertFails(partner.doc(RT + '/t1').update({ blocked: null, updatedAt: 'now', updatedByUid: 'partner1' })));
  await check('recurring: who set it up never changes', () => assertFails(owner.doc(RT + '/t1').update({ createdByUid: 'owner1', updatedAt: 'now', updatedByUid: 'owner1' })));
  await check('recurring: never deleted — it ends', () => assertFails(partner.doc(RT + '/t1').delete()));
  await check('recurring: ending it', () => assertSucceeds(partner.doc(RT + '/t2').update({ status: 'ended', endedAt: 'now', updatedAt: 'now', updatedByUid: 'partner1' })));
  await check('recurring: once ended, it stays ended', () => assertFails(partner.doc(RT + '/t2').update({ status: 'active', updatedAt: 'now', updatedByUid: 'partner1' })));
  await check('recurring: someone not at Home reads nothing', () => assertFails(nanny2.doc(RT + '/t1').get()));
  // ongoing tasks: a parent record kept by admins; its steps are ordinary requests carrying its id
  const OG = 'ledger_home_ongoing';
  const og = (by, o) => Object.assign({ homeId: 'owner1', title: 'Kitchen refit', note: null, why: 'Before the baby comes', createdByUid: by, visibility: 'private',
    participants: [by], status: 'active', stepOrder: [], fromRequestId: null, createdAt: 'now', updatedAt: 'now', updatedByUid: by }, o || {});
  await check('ongoing: Shaun (admin) starts one', () => assertSucceeds(owner.doc(OG + '/og1').set(og('owner1'))));
  await check('ongoing: Abi (admin) starts one', () => assertSucceeds(partner.doc(OG + '/og2').set(og('partner1', { visibility: 'home' }))));
  await check('ongoing: the nanny (member) cannot start one', () => assertFails(nanny.doc(OG + '/og3').set(og('nanny1'))));
  await check('ongoing: never as someone else', () => assertFails(partner.doc(OG + '/og4').set(og('owner1', { updatedByUid: 'partner1', participants: ['owner1', 'partner1'] }))));
  await check('ongoing: never started already finished', () => assertFails(owner.doc(OG + '/og5').set(og('owner1', { status: 'done' }))));
  await check('ongoing: never into another Home', () => assertFails(owner.doc(OG + '/og6').set(og('owner1', { homeId: 'owner2' }))));
  await check('ongoing: only its own fields', () => assertFails(owner.doc(OG + '/og7').set(og('owner1', { linkedActionId: 'a1' }))));
  await check('ongoing: why at most 300', () => assertFails(owner.doc(OG + '/og8').set(og('owner1', { why: 'x'.repeat(301) }))));
  // steps
  const step = (by, to, oid, o) => ask(Object.assign({ requesterUid: by, assigneeUid: to, createdByUid: by, participants: by === to ? [by] : [by, to], ongoingId: oid, requestedTiming: 'later' }, o || {}));
  await check('step: Shaun adds one for the nanny', () => assertSucceeds(asks(owner, 'st1', step('owner1', 'nanny1', 'og1'), 'owner1')));
  await check('step: …and one for himself', () => assertSucceeds(asks(owner, 'st2', step('owner1', 'owner1', 'og1'), 'owner1')));
  await check('step: the nanny cannot add steps', () => assertFails(asks(nanny, 'st3', step('nanny1', 'owner1', 'og1'), 'nanny1')));
  await check('step: never to an ongoing task that does not exist', () => assertFails(asks(owner, 'st4', step('owner1', 'nanny1', 'nope'), 'owner1')));
  await check('step: a new task and its first step in one go', async () => {
    const b = owner.batch();
    b.set(owner.doc(OG + '/og9'), og('owner1', { participants: ['owner1', 'nanny1'] }));
    b.set(owner.doc(HR + '/st5'), step('owner1', 'nanny1', 'og9')); b.set(owner.doc(HR + '/st5/updates/created'), created('owner1'));
    return assertSucceeds(b.commit());
  });
  await check('ongoing: the nanny reads one she has a step in', () => assertSucceeds(nanny.doc(OG + '/og9').get()));
  await check('ongoing: …and lists hers', () => assertSucceeds(nanny.collection(OG).where('homeId', '==', 'owner1').where('participants', 'array-contains', 'nanny1').get()));
  await check('ongoing: …and the shared ones', () => assertSucceeds(nanny.collection(OG).where('homeId', '==', 'owner1').where('visibility', '==', 'home').get()));
  await check('ongoing: …but not one she is not in', () => assertFails(nanny.doc(OG + '/og1').get()));
  await check('ongoing: …nor all of them', () => assertFails(nanny.collection(OG).where('homeId', '==', 'owner1').get()));
  await check('ongoing: someone not at Home reads nothing', () => assertFails(nanny2.doc(OG + '/og2').get()));
  await check('ongoing: Abi (admin) reads Shaun\'s', () => assertSucceeds(partner.doc(OG + '/og1').get()));
  await check('ongoing: an admin reorders steps and adds people', () => assertSucceeds(owner.doc(OG + '/og1').update({ stepOrder: ['st2', 'st1'], participants: ['owner1', 'nanny1'], updatedAt: 'now', updatedByUid: 'owner1' })));
  await check('ongoing: nobody drops out of it', () => assertFails(owner.doc(OG + '/og1').update({ participants: ['owner1'], updatedAt: 'now', updatedByUid: 'owner1' })));
  await check('ongoing: the nanny cannot change it', () => assertFails(nanny.doc(OG + '/og9').update({ title: 'Mine now', updatedAt: 'now', updatedByUid: 'nanny1' })));
  await check('ongoing: who started it never changes', () => assertFails(partner.doc(OG + '/og1').update({ createdByUid: 'partner1', updatedAt: 'now', updatedByUid: 'partner1' })));
  await check('ongoing: never deleted', () => assertFails(owner.doc(OG + '/og1').delete()));
  // filing an existing request under one ("Move to Home"), once
  await check('step: an admin files a waiting request under it', () => assertSucceeds(owner.doc(HR + '/n1').update({ ongoingId: 'og1', updatedAt: 'now' })));
  await check('step: …once: it stays there', () => assertFails(owner.doc(HR + '/n1').update({ ongoingId: 'og2', updatedAt: 'now' })));
  await check('step: the nanny files nothing', () => assertFails(nanny.doc(HR + '/hr1').update({ ongoingId: 'og9', updatedAt: 'now' })));
  await check('step: never with other changes', () => assertFails(owner.doc(HR + '/hr2').update({ ongoingId: 'og1', text: 'Changed', updatedAt: 'now' })));
  await check('delete: the nanny deletes one she wrote (with its entry)', async () => {
    const b = nanny.batch(); b.update(nanny.doc(HR + '/n4b'), { deletedAt: 'now', deletedByUid: 'nanny1', updatedAt: 'now' });
    b.set(nanny.doc(HR + '/n4b/updates/deleted'), { type: 'deleted', actorUid: 'nanny1', text: null, createdAt: NOW(), metadata: { hadAction: false } });
    return assertSucceeds(b.commit());
  });
  // finished: no more steps
  await check('ongoing: Shaun marks it finished', () => assertSucceeds(owner.doc(OG + '/og1').update({ status: 'done', doneAt: 'now', updatedAt: 'now', updatedByUid: 'owner1' })));
  await check('step: never added to a finished one', () => assertFails(asks(owner, 'st6', step('owner1', 'nanny1', 'og1'), 'owner1')));
  await check('ongoing: …and it can be reopened', () => assertSucceeds(owner.doc(OG + '/og1').update({ status: 'active', doneAt: null, updatedAt: 'now', updatedByUid: 'owner1' })));
  // occurrences: made by the server (Admin SDK); here, what people may do with them
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const occ = (o) => Object.assign({ homeId: 'owner1', text: 'Bins out', note: null, requestedTiming: 'date', requestedDate: '2026-10-26', requesterUid: 'partner1', createdByUid: 'partner1',
      assigneeUid: null, participants: ['partner1'], visibility: 'home', status: 'requested', plannedDate: null, linkedActionId: null, recurringId: 't2', occurrenceDate: '2026-10-26', createdAt: 'x', updatedAt: 'x' }, o || {});
    await db.doc(HR + '/t2_20261026').set(occ());
    await db.doc(HR + '/t2_20261027').set(occ({ occurrenceDate: '2026-10-27', requestedDate: '2026-10-27' }));
    await db.doc(HR + '/hrNo').set(occ({ recurringId: null }));
    await db.doc(HR + '/t1_20261025').set(occ({ text: 'Uniform', recurringId: 't1', assigneeUid: 'nanny1', participants: ['partner1', 'nanny1'], visibility: 'private', status: 'missed' }));
  });
  const claim = (db, id, by, parts) => { const b = db.batch(); b.update(db.doc(HR + '/' + id), { assigneeUid: by, participants: parts, latestUpdateAt: 'now', latestUpdateByUid: by, latestUpdateType: 'claimed', updatedAt: 'now' });
    b.set(db.doc(HR + '/' + id + '/updates/claimed'), entry(by, 'claimed')); return b.commit(); };
  await check('claim: the nanny takes an unclaimed one ("I\'ll do it")', () => assertSucceeds(claim(nanny, 't2_20261026', 'nanny1', ['partner1', 'nanny1'])));
  await check('claim: once taken, nobody else can take it', () => assertFails(claim(owner, 't2_20261026', 'owner1', ['partner1', 'nanny1', 'owner1'])));
  await check('claim: never in someone else\'s name', () => assertFails(claim(nanny, 't2_20261027', 'owner1', ['partner1', 'owner1'])));
  await check('claim: never a request that isn\'t a recurring one', () => assertFails(claim(nanny, 'hrNo', 'nanny1', ['partner1', 'nanny1'])));
  await check('claim: never dropping anyone from it', () => assertFails(claim(nanny, 't2_20261027', 'nanny1', ['nanny1'])));
  await check('missed: its person can still finish it, late', () => assertSucceeds(act(nanny, 't1_20261025', { status: 'done' }, entry('nanny1', 'status', { status: 'done' }))));
  await check('missed: nobody marks one missed themselves', () => assertFails(nanny.doc(HR + '/t2_20261026').update({ status: 'missed', updatedAt: 'now' })));

  // deleting (soft, as in Phase A)
  const hdel = (by) => ({ deletedAt: 'now', deletedByUid: by, updatedAt: 'now' });
  await check('delete: not by an assignee who neither asked nor wrote it', () => assertFails(nanny.doc(HR + '/a1').update(hdel('nanny1'))));
  await check('delete: the person who asked deletes it', () => assertSucceeds(act(partner, 'a1', hdel('partner1'), null).then(() => partner.doc(HR + '/a1/updates/deleted').set(entry('partner1', 'deleted')))));
  await check('delete: then it is frozen', () => assertFails(nanny.doc(HR + '/a1').update({ status: 'done', updatedAt: 'now' })));
  await check('delete: no more history', () => assertFails(partner.collection(HR + '/a1/updates').add(entry('partner1', 'comment', {}, 'hello?'))));
  await check('delete: never removed outright', () => assertFails(owner.doc(HR + '/hr1').delete()));
  await check('checklist: a deleted request\'s list is frozen', () => assertFails(partner.doc(HR + '/a1/items/x1').set(item('partner1'))));
  // the boundary: the nanny reaches nothing private, nothing of Partner Sharing
  for (const c of ['ledger_commitments', 'ledger_plans', 'ledger_sessions', 'ledger_life_context', 'ledger_meta', 'ledger_action_updates', 'ledger_day_status'])
    await check('nanny: cannot read ' + c, () => assertFails(nanny.collection(c).get()));
  await check('nanny: cannot read published snapshots', () => assertFails(nanny.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').get()));
  await check('nanny: cannot read Partner Sharing requests', () => assertFails(nanny.doc('ledger_shared_requests/reqA').get()));
  await check('nanny: cannot read Shaun\'s profile', () => assertFails(nanny.doc('ledger_users/owner1').get()));
  await check('nanny: registers her own device', () => assertSucceeds(nanny.doc('ledger_push_subscriptions/nanny1_d1').set(sub('nanny1'))));
  await check('nanny: her own notification choices', () => assertSucceeds(nanny.doc('ledger_notification_prefs/nanny1').set({ partner: true, updatedAt: 'now' })));
  await check('Abi: may follow requests between others', () => assertSucceeds(partner.doc('ledger_notification_prefs/partner1').set({ partner: true, homeOversight: true, updatedAt: 'now' })));
  await check('prefs: on/off only', () => assertFails(partner.doc('ledger_notification_prefs/partner1').set({ homeOversight: 'yes' })));

  // ---- Ask Claude: proposals are the server's; the owner records what he did with his ----
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('ledger_assistant_proposals/p1').set({ ownerUid: 'owner1', status: 'proposed', summary: 'Move 2', changes: [{ n: 1, kind: 'action_update' }], createdAt: 'x' });
    await ctx.firestore().doc('ledger_assistant_proposals/p2').set({ ownerUid: 'owner2', status: 'proposed', summary: 'Other', changes: [], createdAt: 'x' });
    await ctx.firestore().doc('ledger_assistant_threads/t1').set({ ownerUid: 'owner1', messagesJson: '[]' });
  });
  const AP = 'ledger_assistant_proposals/';
  await check('assistant: the owner reads his proposal', () => assertSucceeds(owner.doc(AP + 'p1').get()));
  await check('assistant: not another owner\'s', () => assertFails(owner.doc(AP + 'p2').get()));
  await check('assistant: a partner cannot read a proposal', () => assertFails(partner.doc(AP + 'p1').get()));
  await check('assistant: the owner records it applied', () => assertSucceeds(owner.doc(AP + 'p1').update({ status: 'applied', applied: [{ n: 1 }], appliedAt: 'now', updatedAt: 'now' })));
  await check('assistant: …and undone', () => assertSucceeds(owner.doc(AP + 'p1').update({ status: 'undone', undoneAt: 'now', updatedAt: 'now' })));
  await check('assistant: the changes themselves can\'t be rewritten', () => assertFails(owner.doc(AP + 'p1').update({ changes: [] })));
  await check('assistant: nor its owner', () => assertFails(owner.doc(AP + 'p1').update({ ownerUid: 'partner1', status: 'applied' })));
  await check('assistant: only a known outcome', () => assertFails(owner.doc(AP + 'p1').update({ status: 'proposed' })));
  await check('assistant: no client creates a proposal', () => assertFails(owner.doc(AP + 'p3').set({ ownerUid: 'owner1', status: 'proposed', changes: [] })));
  await check('assistant: nor deletes one', () => assertFails(owner.doc(AP + 'p1').delete()));
  await check('assistant: the conversation is server-only', () => assertFails(owner.doc('ledger_assistant_threads/t1').get()));
  await check('assistant: the daily count is server-only', () => assertFails(owner.doc('ledger_assistant_usage/owner1_2026-10-27').set({ count: 0 })));

  // ---- anything unlisted ----
  await check('unlisted collection: owner denied', () => assertFails(owner.collection('something_else').get()));

  await env.cleanup();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
