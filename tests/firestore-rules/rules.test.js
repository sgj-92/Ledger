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
const SHARED = ['ledger_share_members', 'ledger_shared_snapshots', 'ledger_shared_requests'];

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
    for (const c of PRIVATE) await db.doc(c + '/seed').set({ seeded: true });
    for (const c of SHARED) await db.doc(c + '/seed').set({ seeded: true });
  });

  const anon = env.unauthenticatedContext().firestore();
  const owner = env.authenticatedContext('owner1', { email: 'owner@example.com' }).firestore();
  const partner = env.authenticatedContext('partner1', { email: 'partner@example.com' }).firestore();
  const stranger = env.authenticatedContext('stranger1', { email: 'someone@example.com' }).firestore();

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

  // ---- future shared namespace: closed for now ----
  for (const c of SHARED){
    await check('shared ' + c + ': owner denied for now', () => assertFails(owner.collection(c).get()));
    await check('shared ' + c + ': partner denied for now', () => assertFails(partner.collection(c).get()));
  }

  // ---- anything unlisted ----
  await check('unlisted collection: owner denied', () => assertFails(owner.collection('something_else').get()));

  await env.cleanup();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
