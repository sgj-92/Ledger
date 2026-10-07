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

const PRIVATE = [
  'ledger_commitments', 'ledger_plans', 'ledger_sessions', 'ledger_day_status',
  'ledger_priorities', 'ledger_focus', 'ledger_meals', 'ledger_meta',
  'ledger_matters', 'ledger_conversations', 'ledger_challenges',
  'ledger_push_subscriptions', 'ledger_pins'
];

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
    // sharing: owner1 shares with partner1 (active) and partner2 (paused)
    await db.doc('ledger_share_members/owner1_partner1').set({ ownerUid: 'owner1', partnerUid: 'partner1', role: 'partner', active: true, displayName: 'A' });
    await db.doc('ledger_share_members/owner1_partner2').set({ ownerUid: 'owner1', partnerUid: 'partner2', role: 'partner', active: false, displayName: 'B' });
    await db.doc('ledger_shared_snapshots/owner1_partner1_day_2026-10-07').set({ ownerUid: 'owner1', partnerUid: 'partner1', periodType: 'day', periodKey: '2026-10-07', items: [] });
    await db.doc('ledger_shared_snapshots/owner1_partner2_day_2026-10-07').set({ ownerUid: 'owner1', partnerUid: 'partner2', periodType: 'day', periodKey: '2026-10-07', items: [] });
    await db.doc('ledger_shared_requests/reqA').set({ ownerUid: 'owner1', partnerUid: 'partner1', text: 'Pick up nappies', note: null, requestedTiming: 'today', requestedDate: null, status: 'requested', plannedDate: null, linkedActionId: null, createdAt: 'x', updatedAt: 'x' });
    await db.doc('ledger_shared_requests/reqPlanned').set({ ownerUid: 'owner1', partnerUid: 'partner1', text: 'Call landlord', note: null, requestedTiming: 'week', requestedDate: null, status: 'planned', plannedDate: '2026-10-08', linkedActionId: 'act1', createdAt: 'x', updatedAt: 'x' });
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
  await check('partner: cannot register a push subscription', () => assertFails(partner.doc('ledger_push_subscriptions/sub_x').set({ endpoint: 'x' })));
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
  await check('partner A: cannot withdraw once planned', () => assertFails(partner.doc('ledger_shared_requests/reqPlanned').delete()));
  await check('partner A: can withdraw before it is processed', () => assertSucceeds(partner.doc('ledger_shared_requests/reqA').delete()));
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

  // ---- anything unlisted ----
  await check('unlisted collection: owner denied', () => assertFails(owner.collection('something_else').get()));

  await env.cleanup();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
