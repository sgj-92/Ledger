// Ledger — "Pin now" push sender.
//
// The client never sends a push directly (that would require the VAPID *private* key to be
// present in browser code). Instead it writes a small document to ledger_pins; this function
// fires on creation, sends a Web Push notification to every registered device, and records the
// outcome back onto the pin document. Nothing here is queued or scheduled — it runs immediately
// when the document is created.
//
// Security: this function runs with the Admin SDK, so Firestore security rules do NOT apply to
// it — it can read every subscription. It therefore enforces ownership itself: a pin is sent only
// to devices registered by the same account (ownerUid). Clients can create pins and register
// devices only as the owner (firestore.rules), so nobody else can trigger a push or add a device.
// Records written before ownership existed carry no ownerUid; they were all created by the
// owner's devices, so a legacy pin or device still matches until it is re-registered (the app
// re-saves a device's subscription, with its ownerUid, every time it pins).
//
// Deploy with: firebase deploy --only functions
// Required one-time setup — see the "Required configuration" section in the delivery report /
// README for exact commands (VAPID keys, APP_URL, etc). Nothing here reads those values except
// through Secret Manager / Firebase params, so no secret ever lives in this repository.

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// VAPID_PRIVATE_KEY is a real secret — stored in Secret Manager, injected only into this
// function's runtime, never checked into source control and never sent to the client.
const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
// The public key and subject/URL are not sensitive (the public key is also embedded in
// index.html by design), but keeping them as params avoids hardcoding here too.
const VAPID_PUBLIC_KEY = defineString('VAPID_PUBLIC_KEY');
const VAPID_SUBJECT = defineString('VAPID_SUBJECT', { default: 'mailto:example@example.com' });
const APP_URL = defineString('APP_URL', { default: 'https://sgj-92.github.io/Ledger/' });

exports.sendPinNotification = onDocumentCreated(
  { document: 'ledger_pins/{pinId}', secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const pin = snap.data() || {};
    const pinId = event.params.pinId;

    if (!pin.text) {
      await snap.ref.update({ status: 'failed', error: 'Empty reminder text', sentAt: new Date().toISOString() });
      return;
    }

    webpush.setVapidDetails(VAPID_SUBJECT.value(), VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());

    const allSubs = await db.collection('ledger_push_subscriptions').get();
    // only the pin owner's devices — a legacy record (no ownerUid) on either side predates accounts
    const subsDocs = allSubs.docs.filter((doc) => {
      const owner = (doc.data() || {}).ownerUid;
      return !pin.ownerUid || !owner || owner === pin.ownerUid;
    });
    const subsSnap = { empty: subsDocs.length === 0, docs: subsDocs };
    if (subsSnap.empty) {
      await snap.ref.update({ status: 'failed', error: 'No registered device', sentAt: new Date().toISOString() });
      return;
    }

    var appUrl = APP_URL.value();
    var url = pin.linkedActionId
      ? appUrl + (appUrl.indexOf('?') === -1 ? '?' : '&') + 'openAction=' + encodeURIComponent(pin.linkedActionId)
      : appUrl;

    const payload = JSON.stringify({
      title: 'Ledger',
      body: pin.text,
      url: url,
      tag: 'pin-' + pinId
    });

    let sentCount = 0;
    const errors = [];

    await Promise.all(subsSnap.docs.map(async (doc) => {
      const sub = doc.data();
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
          { urgency: 'high' }
        );
        sentCount++;
      } catch (err) {
        // 404/410 means the browser dropped the subscription (uninstalled, permission revoked,
        // etc) — clean it up so future pins don't keep failing against a dead endpoint.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await doc.ref.delete().catch(() => {});
        } else {
          errors.push(err && err.message ? err.message : String(err));
        }
      }
    }));

    await snap.ref.update({
      status: sentCount > 0 ? 'sent' : 'failed',
      sentAt: new Date().toISOString(),
      error: sentCount > 0 ? null : (errors[0] || 'No reachable devices')
    });
  }
);
