// Ledger — Cloud Functions: the push sender.
//
// The browser never sends a push (that needs the VAPID *private* key). Records in
// Firestore are the events; these functions turn them into Web Push notifications through
// the one engine in push.js:
//
//   ledger_meta/currentFocus (written)            → the owner's other devices
//   ledger_shared_request_updates/{id} (created)  → the other side of the request
//   ledger_pins/{id} (created)                    → the owner's devices (Pin now)
//   ledger_home_requests/{id}/updates/{u} (created) → the people the request involves
//   ledger_home_batches/{id} (created)            → each person a list was for, once
//   ledger_home_ongoing/{id}/updates/{u} (created) → everyone on the ongoing task
//   ledger_home_requests/{id}/items/{i} (ticked)  → whoever asked to hear about that item
//
// And three that are not pushes: ledger_meta/homeMigration, written by the owner, moves his
// Partner Sharing requests into Home (migrate.js); and recurring responsibilities at Home
// (recur.js) are generated hourly, and at once when one is set up or changed.
//
// One HTTPS endpoint: `assistant` (assistant.js), Ask Claude. The owner's Ledger posts a
// request with his Firebase ID token; Claude answers with a proposal that Ledger itself
// applies once he approves it. It never writes Ledger data.
//
// Recipients come from those trusted records, checked again here (the Admin SDK is not
// subject to the security rules). Push is best effort: Firestore is already the truth.
//
// Configuration (no secret is in this repository):
//   VAPID_PRIVATE_KEY  Secret Manager:   firebase functions:secrets:set VAPID_PRIVATE_KEY
//   VAPID_PUBLIC_KEY   functions/.env:   the matching public key (also in ledger_config/push)
//   VAPID_SUBJECT      functions/.env:   mailto:you@example.com (or an https: URL) — yours
//   APP_URL            functions/.env:   https://ledger.sgj.luxe/ (the default)
//   FUNCTIONS_REGION   functions/.env:   the region of the Firestore database
//   ANTHROPIC_API_KEY  Secret Manager:   firebase functions:secrets:set ANTHROPIC_API_KEY
//                                        (Ask Claude; the key never reaches a browser)
// See docs/SECURITY.md, "Push notifications", for the exact steps.
//
// Deploy with: firebase deploy --only functions

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
// the modular FieldValue: the same in production and in the emulator, where the namespaced
// admin.firestore.FieldValue is not always there
const { FieldValue } = require('firebase-admin/firestore');
const webpush = require('web-push');
const { createEngine } = require('./push');
const { createMigrator } = require('./migrate');
const { createRecurrer } = require('./recur');
const { createAssistant, ALLOWED_ORIGINS } = require('./assistant');

admin.initializeApp();
const db = admin.firestore();

const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const VAPID_PUBLIC_KEY = defineString('VAPID_PUBLIC_KEY');
// No default: whoever runs Ledger chooses the contact push services may use.
const VAPID_SUBJECT = defineString('VAPID_SUBJECT');
// Where a notification opens Ledger: the canonical production origin. Deep links are
// query strings on this root (?openAction=, ?request=, ?sprint=), so there is no route.
const APP_URL = defineString('APP_URL', { default: 'https://ledger.sgj.luxe/' });
// Firestore triggers must run where the database is (Console → Firestore → location).
const FUNCTIONS_REGION = defineString('FUNCTIONS_REGION', { default: 'us-central1' });

setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 5 });

function engine() {
  webpush.setVapidDetails(VAPID_SUBJECT.value(), VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
  return createEngine({
    db,
    send: (sub, body, opts) => webpush.sendNotification(sub, body, opts),
    // the iOS and Android apps (docs/NATIVE_MIGRATION.md §5): the project's own FCM, no key
    sendFcm: (message) => admin.messaging().send(message),
    deleteField: () => FieldValue.delete(),
    log: (...a) => logger.warn(...a)
  });
}
function common() {
  return { appUrl: APP_URL.value(), vapidPublicKey: VAPID_PUBLIC_KEY.value() };
}
function report(name, result) {
  if (result && result.errors && result.errors.length) logger.warn(name, result);
  else logger.info(name, result);
}

exports.onCurrentFocusWritten = onDocumentWritten(
  { document: 'ledger_meta/currentFocus', secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    const result = await engine().handleFocusWrite(Object.assign({ before, after, eventId: event.id }, common()));
    report('current focus push', result);
  }
);

exports.onRequestUpdateCreated = onDocumentCreated(
  { document: 'ledger_shared_request_updates/{updateId}', secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    if (!event.data) return;
    const result = await engine().handleRequestUpdate(Object.assign({
      update: event.data.data() || {}, updateId: event.params.updateId
    }, common()));
    report('partner request push', result);
  }
);

exports.onPinCreated = onDocumentCreated(
  { document: 'ledger_pins/{pinId}', secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    if (!event.data) return;
    const result = await engine().handlePinCreated(Object.assign({
      pin: event.data.data() || {}, pinId: event.params.pinId, ref: event.data.ref
    }, common()));
    report('pin push', result);
  }
);

exports.onHomeUpdateCreated = onDocumentCreated(
  { document: 'ledger_home_requests/{requestId}/updates/{updateId}', secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    if (!event.data) return;
    const result = await engine().handleHomeUpdate(Object.assign({
      update: event.data.data() || {}, requestId: event.params.requestId, updateId: event.params.updateId
    }, common()));
    report('home request push', result);
  }
);

exports.onHomeItemWritten = onDocumentWritten(
  { document: 'ledger_home_requests/{requestId}/items/{itemId}', secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after || after.done !== true || (before && before.done === true)) return;
    const result = await engine().handleItemTicked(Object.assign({
      before, after, requestId: event.params.requestId, itemId: event.params.itemId
    }, common()));
    report('home item push', result);
  }
);

exports.onOngoingUpdateCreated = onDocumentCreated(
  { document: 'ledger_home_ongoing/{ongoingId}/updates/{updateId}', secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    if (!event.data) return;
    const result = await engine().handleOngoingUpdate(Object.assign({
      update: event.data.data() || {}, ongoingId: event.params.ongoingId, updateId: event.params.updateId
    }, common()));
    report('ongoing update push', result);
  }
);

exports.onHomeBatchCreated = onDocumentCreated(
  { document: 'ledger_home_batches/{batchId}', secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    if (!event.data) return;
    const result = await engine().handleHomeBatch(Object.assign({
      batch: event.data.data() || {}, batchDocId: event.params.batchId
    }, common()));
    report('home list push', result);
  }
);

// Shaun moves his Partner Sharing requests into Home. Only a write that asks for it, by the
// owner it names, runs it; the function's own writes back (running, done) never do.
exports.onHomeMigrationRequested = onDocumentWritten(
  { document: 'ledger_meta/homeMigration' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after || after.status !== 'requested' || !after.requestedBy) return;
    const ref = event.data.after.ref;
    await ref.set({ status: 'running', startedAt: new Date().toISOString() }, { merge: true });
    try {
      const out = await createMigrator({ db }).migrate(after.requestedBy);
      await ref.set(Object.assign({ status: 'done', finishedAt: new Date().toISOString() }, out), { merge: true });
      logger.info('home migration', out);
    } catch (e) {
      await ref.set({ status: 'failed', error: String((e && e.message) || e), finishedAt: new Date().toISOString() }, { merge: true });
      logger.warn('home migration failed', e);
    }
  }
);

// Recurring responsibilities at Home (docs/HOME_RECURRENCE.md): each due date makes ONE
// ordinary request, create-if-absent under a deterministic id. Hourly, so they appear on
// the morning they are due (06:00 in the template's own timezone) whether or not anyone
// opens Ledger; and at once when a template is set up or changed. Bookkeeping the
// generator writes back (lastDate, lastRunAt, blocked) never re-runs it.
function recurrer() {
  return createRecurrer({ db, serverTime: () => FieldValue.serverTimestamp(), log: (...a) => logger.warn(...a) });
}
const RECUR_BOOKKEEPING = ['lastDate', 'lastRunAt', 'blocked'];
function sameApartFrom(a, b, keys) {
  const strip = (o) => { const c = Object.assign({}, o || {}); keys.forEach((k) => delete c[k]); return JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]])); };
  return strip(a) === strip(b);
}
exports.onRecurringTick = onSchedule({ schedule: 'every 60 minutes', timeZone: 'Etc/UTC' }, async () => {
  const out = await recurrer().runAll();
  if (out.errors.length) logger.warn('recurring tick', out); else logger.info('recurring tick', out);
});
exports.onRecurringWritten = onDocumentWritten(
  { document: 'ledger_home_recurring/{templateId}' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after) return;
    if (before && sameApartFrom(before, after, RECUR_BOOKKEEPING)) return;
    const out = await recurrer().runTemplate(event.data.after.ref, { anyHour: true });
    logger.info('recurring written', out);
  }
);

// ---- Ask Claude (assistant.js) ----
// Only Ledger's own pages may call it (ALLOWED_ORIGINS: production, and a local build); the
// signed-in user's ID token is checked, and assistant.js accepts only the owner.
exports.assistant = onRequest(
  {
    secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180, memory: '512MiB', maxInstances: 3,
    cors: ALLOWED_ORIGINS
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
    const m = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
    let uid = null;
    try { uid = m ? (await admin.auth().verifyIdToken(m[1])).uid : null; } catch (e) { uid = null; }
    if (!uid) { res.status(401).json({ error: 'Sign in to Ledger first.' }); return; }
    const Anthropic = require('@anthropic-ai/sdk');
    const AnthropicClient = Anthropic.default || Anthropic;
    const client = new AnthropicClient({ apiKey: ANTHROPIC_API_KEY.value() });
    const body = req.body || {};
    try {
      const out = await createAssistant({ db, client, log: (...a) => logger.warn(...a) })
        .handle({ uid, threadId: body.threadId, message: body.message, today: body.today });
      res.status(out.status).json(out.body);
    } catch (e) {
      logger.error('assistant failed', e && e.message);
      const busy = e && (e.status === 429 || e.status === 529);
      res.status(502).json({ error: busy ? 'Claude is busy. Try again in a minute.' : 'Claude could not be reached. Try again.' });
    }
  }
);
