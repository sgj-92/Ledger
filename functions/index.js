// Ledger — Cloud Functions: the push sender.
//
// The browser never sends a push (that needs the VAPID *private* key). Records in
// Firestore are the events; these functions turn them into Web Push notifications through
// the one engine in push.js:
//
//   ledger_meta/currentFocus (written)            → the owner's other devices
//   ledger_shared_request_updates/{id} (created)  → the other side of the request
//   ledger_pins/{id} (created)                    → the owner's devices (Pin now)
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
// See docs/SECURITY.md, "Push notifications", for the exact steps.
//
// Deploy with: firebase deploy --only functions

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const webpush = require('web-push');
const { createEngine } = require('./push');

admin.initializeApp();
const db = admin.firestore();

const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
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
    deleteField: () => admin.firestore.FieldValue.delete(),
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
