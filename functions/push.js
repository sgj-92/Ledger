// Ledger — the one notification engine.
//
// Everything that sends a Web Push goes through sendPushToUser(). It is written against
// small injected pieces (the Firestore Admin handle, a `send` function, the clock), so the
// same code runs in the Cloud Functions in index.js and in the tests.
//
// Principles:
//  - A device subscription belongs to a Firebase Auth user (ledger_push_subscriptions,
//    userUid). A push goes to one user's devices, found here, server-side — never to a
//    recipient a browser named.
//  - The recipient is derived from a trusted record: the owner who wrote the current
//    focus, the two sides of a shared request (checked against their active membership),
//    the owner who created a pin. Firestore rules make those fields match their writer;
//    this code checks them again, because the Admin SDK is not subject to the rules.
//  - Push is best effort. Firestore already holds the truth; nothing here changes it.
//  - Each event is sent at most once (ledger_push_events/{eventId}, created first). No
//    handler writes to the document that triggered it, so nothing can loop.

const SUBS = 'ledger_push_subscriptions';
const EVENTS = 'ledger_push_events';
const PREFS = 'ledger_notification_prefs';

const FOCUS_TAG = 'ledger-current-focus';

function clip(text, n) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

// A link into Ledger: query strings on the one canonical root, so it can never 404.
function appLink(appUrl, params) {
  const base = appUrl || 'https://ledger.sgj.luxe/';
  const q = Object.keys(params || {})
    .filter((k) => params[k] != null && params[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return q ? base + (base.indexOf('?') === -1 ? '?' : '&') + q : base;
}

function createEngine(deps) {
  const db = deps.db;
  const send = deps.send;                                  // (subscription, body, options) => Promise
  const now = deps.now || (() => new Date().toISOString());
  const deleteField = deps.deleteField;                    // FieldValue.delete()
  const log = deps.log || (() => {});

  // Claims an event id. Returns false when it was already handled (a retried trigger).
  async function claimEvent(eventId, info) {
    try {
      await db.collection(EVENTS).doc(eventId).create(Object.assign({ createdAt: now(), status: 'sending' }, info || {}));
      return true;
    } catch (e) {
      if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) return false;
      throw e;
    }
  }
  async function recordEvent(eventId, result) {
    await db.collection(EVENTS).doc(eventId).set(Object.assign({ finishedAt: now() }, result), { merge: true })
      .catch((e) => log('push event record failed', eventId, e && e.message));
  }

  async function userRole(uid) {
    if (!uid || typeof uid !== 'string') return null;
    const doc = await db.collection('ledger_users').doc(uid).get();
    const role = doc.exists ? (doc.data() || {}).role : null;
    return role === 'owner' || role === 'partner' ? role : null;
  }
  // a user's own choice for one kind of notification; on unless they turned it off
  async function wants(uid, kind) {
    const doc = await db.collection(PREFS).doc(uid).get();
    const p = doc.exists ? (doc.data() || {}) : {};
    return p[kind] !== false;
  }

  // Sends one payload to every device the user has registered (minus, optionally, the
  // device that caused it). Dead subscriptions (404/410) are removed; other failures are
  // recorded on the device and in the result.
  async function sendPushToUser(userUid, payload, options) {
    const o = options || {};
    const result = { recipientUid: userUid, devices: 0, excluded: 0, sent: 0, removed: 0, failed: 0, errors: [] };
    if (!userUid) return result;
    const snap = await db.collection(SUBS).where('userUid', '==', userUid).get();
    const docs = snap.docs.filter((d) => {
      if (o.excludeDeviceId && (d.data() || {}).deviceId === o.excludeDeviceId) { result.excluded++; return false; }
      return true;
    });
    result.devices = docs.length;
    const body = JSON.stringify(payload);
    await Promise.all(docs.map(async (doc) => {
      const s = doc.data() || {};
      // made with a different key pair: no push service will accept it, and the app
      // re-subscribes with the current key the next time it opens on that device
      if (o.vapidPublicKey && s.vapidPublicKey && s.vapidPublicKey !== o.vapidPublicKey) {
        await doc.ref.delete().catch(() => {});
        result.removed++;
        return;
      }
      try {
        await send({ endpoint: s.endpoint, keys: s.keys }, body, {
          urgency: o.urgency || 'normal',
          TTL: o.ttl != null ? o.ttl : 3600,
          topic: o.topic
        });
        result.sent++;
        const patch = { lastSentAt: now() };
        if (deleteField && s.lastError) { patch.lastError = deleteField(); patch.lastErrorAt = deleteField(); }
        await doc.ref.update(patch).catch(() => {});
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {                     // the browser dropped it
          await doc.ref.delete().catch(() => {});
          result.removed++;
        } else {
          result.failed++;
          const msg = clip((code ? code + ' ' : '') + ((err && (err.body || err.message)) || String(err)), 200);
          result.errors.push(msg);
          await doc.ref.update({ lastError: msg, lastErrorAt: now() }).catch(() => {});
        }
      }
    }));
    return result;
  }

  // ---- Current Focus ----
  // ledger_meta/currentFocus changed. A push only when a *new* focus became active —
  // not when it was cleared, and not for an edit that left the same thing in focus.
  async function handleFocusWrite(ev) {
    const before = ev.before || null, after = ev.after || null;
    if (!after || after.status !== 'active' || !after.sourceId) return { skipped: 'not active' };
    if (before && before.status === 'active' && before.type === after.type && before.sourceId === after.sourceId &&
        (before.childId || null) === (after.childId || null) && before.setAt === after.setAt) {
      return { skipped: 'same focus' };
    }
    const uid = after.ownerUid;
    if ((await userRole(uid)) !== 'owner') return { skipped: 'not an owner' };
    if (!(await wants(uid, 'currentFocus'))) return { skipped: 'turned off' };
    const eventId = 'focus_' + ev.eventId;
    if (!(await claimEvent(eventId, { kind: 'current_focus', recipientUid: uid }))) return { skipped: 'duplicate' };
    const url = after.type === 'sprint_item'
      ? appLink(ev.appUrl, { sprint: after.sourceId })
      : appLink(ev.appUrl, { openAction: after.sourceId });
    const payload = {
      title: 'Ledger · Current focus',
      body: clip(after.title || 'Something new', 120),
      url: url,
      tag: FOCUS_TAG,          // a new focus replaces the last one where the platform allows
      renotify: true,
      kind: 'current_focus'
    };
    const result = await sendPushToUser(uid, payload, {
      excludeDeviceId: after.sourceDeviceId || null,  // that device is already showing it
      urgency: 'high', ttl: 4 * 3600, topic: FOCUS_TAG, vapidPublicKey: ev.vapidPublicKey
    });
    await recordEvent(eventId, Object.assign({ status: 'done' }, result));
    return result;
  }

  // ---- Partner Requests ----
  // One trigger: a new entry on a request's Updates timeline. What it says decides who
  // hears: the partner asked or added an update → the owner; the owner added an update,
  // planned it or completed it → the partner. Everything else stays quiet.
  async function handleRequestUpdate(ev) {
    const u = ev.update || {};
    if (!u.requestId || typeof u.requestId !== 'string') return { skipped: 'no request' };
    const reqSnap = await db.collection('ledger_shared_requests').doc(u.requestId).get();
    if (!reqSnap.exists) return { skipped: 'no request' };
    const r = reqSnap.data() || {};
    if (u.ownerUid !== r.ownerUid || u.partnerUid !== r.partnerUid) return { skipped: 'mismatch' };
    const memberSnap = await db.collection('ledger_share_members').doc(r.ownerUid + '_' + r.partnerUid).get();
    const m = memberSnap.exists ? (memberSnap.data() || {}) : null;
    if (!m || m.active !== true || m.ownerUid !== r.ownerUid || m.partnerUid !== r.partnerUid) return { skipped: 'not shared' };

    const partnerName = clip(m.displayName || 'Your partner', 40);
    const ownerName = clip(m.ownerName || 'Ledger', 40);
    const what = clip(r.text, 60);
    let to = null, title = null, body = null;
    if (u.actorRole === 'partner' && u.actorUid === r.partnerUid) {
      to = r.ownerUid;
      if (u.type === 'request_created') { title = partnerName + ' sent a request'; body = clip(r.text, 120); }
      else if (u.type === 'comment') { title = partnerName + ' updated “' + what + '”'; body = clip(u.text, 140); }
    } else if ((u.actorRole === 'owner' || u.actorRole === 'system') && u.actorUid === r.ownerUid) {
      to = r.partnerUid;
      if (u.actorRole === 'owner' && u.type === 'comment') { title = ownerName + ' updated “' + what + '”'; body = clip(u.text, 140); }
      else if (u.type === 'planned') { title = ownerName + ' planned your request'; body = clip(r.text, 120); }
      else if (u.type === 'status' && u.metadata && u.metadata.status === 'done') { title = ownerName + ' completed your request'; body = clip(r.text, 120); }
    }
    if (!to || !title) return { skipped: 'quiet' };
    const role = await userRole(to);
    if (role !== (to === r.ownerUid ? 'owner' : 'partner')) return { skipped: 'recipient has no role' };
    if (!(await wants(to, 'partner'))) return { skipped: 'turned off' };
    const eventId = 'rqu_' + ev.updateId;
    if (!(await claimEvent(eventId, { kind: 'partner_' + u.type, recipientUid: to, requestId: u.requestId }))) return { skipped: 'duplicate' };
    const payload = {
      title: title, body: body || '', url: appLink(ev.appUrl, { request: u.requestId }),
      tag: 'ledger-request-' + u.requestId, renotify: true, kind: 'partner'
    };
    const result = await sendPushToUser(to, payload, { urgency: 'normal', ttl: 24 * 3600, vapidPublicKey: ev.vapidPublicKey });
    await recordEvent(eventId, Object.assign({ status: 'done' }, result));
    return result;
  }

  // ---- Pin now ----
  // The owner asks for a push to their own devices, all of them.
  async function handlePinCreated(ev) {
    const pin = ev.pin || {};
    const ref = ev.ref;
    const finish = (patch) => (ref ? ref.update(Object.assign({ sentAt: now() }, patch)).catch(() => {}) : null);
    if (!pin.text) { await finish({ status: 'failed', error: 'Empty reminder text' }); return { skipped: 'empty' }; }
    if ((await userRole(pin.ownerUid)) !== 'owner') { await finish({ status: 'failed', error: 'Not an owner' }); return { skipped: 'not an owner' }; }
    const eventId = 'pin_' + ev.pinId;
    if (!(await claimEvent(eventId, { kind: 'pin', recipientUid: pin.ownerUid }))) return { skipped: 'duplicate' };
    const payload = {
      title: 'Ledger', body: clip(pin.text, 160),
      url: pin.linkedActionId ? appLink(ev.appUrl, { openAction: pin.linkedActionId }) : appLink(ev.appUrl, {}),
      tag: 'ledger-pin-' + ev.pinId, kind: 'pin'
    };
    const result = await sendPushToUser(pin.ownerUid, payload, { urgency: 'high', ttl: 12 * 3600, vapidPublicKey: ev.vapidPublicKey });
    await finish({ status: result.sent > 0 ? 'sent' : 'failed', error: result.sent > 0 ? null : (result.errors[0] || (result.devices ? 'No reachable devices' : 'No registered device')) });
    await recordEvent(eventId, Object.assign({ status: 'done' }, result));
    return result;
  }

  return { sendPushToUser, handleFocusWrite, handleRequestUpdate, handlePinCreated, claimEvent };
}

module.exports = { createEngine, appLink, clip, FOCUS_TAG };
