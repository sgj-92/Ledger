// Ledger — the one notification engine.
//
// Everything that sends a push goes through sendPushToUser(): Web Push to a browser, FCM to
// the iOS and Android apps. It is written against small injected pieces (the Firestore
// Admin handle, the senders, the clock), so the
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
const { localNow } = require('./recur');
const PREFS = 'ledger_notification_prefs';

const FOCUS_TAG = 'ledger-current-focus';

// The iOS and Android apps get the same payload through Firebase Cloud Messaging (FCM
// for Android; FCM's APNs bridge for iOS). Android groups notifications into channels by
// kind, created by the app with these ids.
function channelFor(payload) {
  const url = String((payload && payload.url) || '');
  if (payload && payload.tag === FOCUS_TAG) return 'focus';
  if (/[?&]home=/.test(url)) return 'home';
  if (/[?&]request=/.test(url)) return 'partner';
  return 'general';
}
// An FCM message for one device: what the user sees, and the link a tap opens (as data,
// all strings). The tag replaces an earlier notification of the same thing.
function fcmMessage(token, payload, o) {
  const p = payload || {}, ttl = o.ttl != null ? o.ttl : 3600, high = o.urgency === 'high';
  const channel = channelFor(p), tag = p.tag ? String(p.tag).slice(0, 64) : null;
  const data = { url: String(p.url || ''), kind: channel };
  if (tag) data.tag = tag;
  const android = { priority: high ? 'high' : 'normal', ttl: ttl * 1000, notification: { channelId: channel } };
  if (tag) android.notification.tag = tag;
  const apns = {
    headers: { 'apns-priority': high ? '10' : '5', 'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl) },
    payload: { aps: { sound: 'default', 'thread-id': channel } }
  };
  if (tag) apns.headers['apns-collapse-id'] = tag;
  return { token, notification: { title: clip(p.title || 'Ledger', 120), body: clip(p.body || '', 400) }, data, android, apns };
}
// FCM's answer for a token the device no longer holds (app removed, token rotated)
function fcmGone(err) {
  const code = String((err && (err.code || (err.errorInfo && err.errorInfo.code))) || '');
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
}

// "Thu 30 Oct" from a YYYY-MM-DD date, for a notification
function dayLabel(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  if (!m) return '';
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()] + ' ' + (+m[3]) + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1];
}

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
  const sendFcm = deps.sendFcm || null;                    // (message) => Promise — the apps; absent, they're skipped
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
    return role === 'owner' || role === 'partner' || role === 'household' ? role : null;
  }
  // a user's own choice for one kind of notification; on unless they turned it off —
  // or, for something they must opt into, off unless they turned it on
  async function wants(uid, kind, optIn) {
    const doc = await db.collection(PREFS).doc(uid).get();
    const p = doc.exists ? (doc.data() || {}) : {};
    return optIn ? p[kind] === true : p[kind] !== false;
  }

  // The apps' notifications can be switched off in one place (ledger_config/push,
  // nativeEnabled: false): their devices are then skipped, and Web Push carries on.
  async function nativeOn() {
    const doc = await db.collection('ledger_config').doc('push').get().catch(() => null);
    return !(doc && doc.exists && (doc.data() || {}).nativeEnabled === false);
  }

  // Sends one payload to every device the user has registered (minus, optionally, the
  // device that caused it): a browser by Web Push, an app by FCM. Dead subscriptions
  // (404/410, or a token FCM no longer knows) are removed; other failures are recorded on
  // the device and in the result.
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
    const apps = docs.some((d) => (d.data() || {}).transport === 'fcm') && sendFcm ? await nativeOn() : false;
    await Promise.all(docs.map(async (doc) => {
      const s = doc.data() || {};
      if (s.transport === 'fcm') {
        if (!apps || !s.fcmToken) { result.skipped = (result.skipped || 0) + 1; return; }
        try {
          await sendFcm(fcmMessage(s.fcmToken, payload, o));
          result.sent++;
          const patch = { lastSentAt: now() };
          if (deleteField && s.lastError) { patch.lastError = deleteField(); patch.lastErrorAt = deleteField(); }
          await doc.ref.update(patch).catch(() => {});
        } catch (err) {
          if (fcmGone(err)) {
            await doc.ref.delete().catch(() => {});
            result.removed++;
          } else {
            result.failed++;
            const msg = clip(String((err && (err.code || err.message)) || err), 200);
            result.errors.push(msg);
            await doc.ref.update({ lastError: msg, lastErrorAt: now() }).catch(() => {});
          }
        }
        return;
      }
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
    // an Action or a sprint opens itself; today's training or Morning Prime opens Today
    const url = after.type === 'sprint_item'
      ? appLink(ev.appUrl, { sprint: after.sourceId })
      : (after.type === 'training' || after.type === 'prime' ? appLink(ev.appUrl, {}) : appLink(ev.appUrl, { openAction: after.sourceId }));
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
  // A request the owner recorded on the partner's behalf (they asked in person) is
  // announced exactly as if the partner had sent it: "Abi sent a request", to every one
  // of the owner's devices — the one it was typed on included. Only the input differs.
  // The partner hears nothing, as for a request of her own.
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
      // a withdrawn request moved to upcoming is a new request: one push, said as such
      // (its old record's "renewed" entry stays quiet)
      if (u.type === 'request_created') {
        title = partnerName + (r.renewedFrom ? ' moved a request to upcoming' : ' sent a request'); body = clip(r.text, 120);
      }
      else if (u.type === 'comment') { title = partnerName + ' updated “' + what + '”'; body = clip(u.text, 140); }
    } else if (u.actorRole === 'owner' && u.actorUid === r.ownerUid && u.type === 'request_created'
               && r.createdByRole === 'owner' && r.createdByUid === r.ownerUid) {
      to = r.ownerUid;
      title = partnerName + ' sent a request'; body = clip(r.text, 120);
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

  // ---- Home requests ----
  // One trigger: a new entry in ledger_home_requests/{id}/updates. Everything is read
  // again here — the request, and each person's membership of its Home — so a push only
  // ever goes to someone the request involves (or, if they chose to follow them, an admin
  // of that Home), never to anyone an entry claims. Who hears what:
  //   created     → the assignee, said as from the requester ("Magda sent a request"), on
  //                 all their devices — even when they wrote it themselves on someone's
  //                 behalf (only the input differs). Admins following Home: "Abi asked Magda".
  //   comment     → everyone in it but its author.
  //   planned, done, can't do → the requester, and its writer if someone else; never the
  //                 person who did it. Admins following Home also hear "done".
  //   reassigned  → the new assignee.
  //   everything else (started, moved, withdrawn, shared, deleted) stays quiet.
  async function handleHomeUpdate(ev) {
    const u = ev.update || {};
    const rid = ev.requestId;
    if (!rid || typeof rid !== 'string') return { skipped: 'no request' };
    // history copied in by the move from Partner Sharing (migrate.js) is not news
    if (u.metadata && Object.prototype.hasOwnProperty.call(u.metadata, 'legacyRole')) return { skipped: 'migrated' };
    // one of a list sent together: announced once, for the whole list (handleHomeBatch)
    if (u.type === 'created' && u.metadata && typeof u.metadata.batchId === 'string' && u.metadata.batchId) return { skipped: 'in a list' };
    const reqSnap = await db.collection('ledger_home_requests').doc(rid).get();
    if (!reqSnap.exists) return { skipped: 'no request' };
    const r = reqSnap.data() || {};
    if (r.deletedAt) return { skipped: 'deleted' };
    const memberCache = {};
    async function member(uid) {
      if (!uid || typeof uid !== 'string') return null;
      if (!(uid in memberCache)) {
        const d = await db.collection('ledger_home_members').doc(uid).get();
        const m = d.exists ? (d.data() || {}) : null;
        memberCache[uid] = m && m.homeId === r.homeId && m.status === 'active' ? m : null;
      }
      return memberCache[uid];
    }
    const actor = await member(u.actorUid);
    if (!actor) return { skipped: 'not at Home' };
    const name = async (uid) => clip(((await member(uid)) || {}).displayName || 'Someone', 40);
    const what = clip(r.text, 60);
    const watchers = (requestId, itemId) => watchersOf(r, requestId, itemId, member);
    const plan = [];          // { to, title, body, optIn }
    const tellAsker = async (title, body) => {
      for (const to of new Set([r.requesterUid, r.createdByUid])) if (to && to !== u.actorUid) plan.push({ to, title, body });
    };
    const follow = async (title, body) => {
      const admins = await db.collection('ledger_home_members').where('homeId', '==', r.homeId).where('role', '==', 'admin').get();
      admins.docs.forEach((d) => {
        const uid = d.id, m = d.data() || {};
        if (m.status !== 'active' || uid === u.actorUid || (r.participants || []).indexOf(uid) > -1) return;
        plan.push({ to: uid, title, body, optIn: true });
      });
    };
    if (u.type === 'created' && u.metadata && typeof u.metadata.recurring === 'string') {
      // a recurring responsibility, due today: its person; or, when anyone can take it,
      // everyone at Home but the one who set it up
      if (r.assigneeUid) plan.push({ to: r.assigneeUid, title: 'Today: ' + clip(r.text, 80), body: r.requesterUid === r.assigneeUid ? 'Regular' : 'Regular, from ' + (await name(r.requesterUid)) });
      else {
        const all = await db.collection('ledger_home_members').where('homeId', '==', r.homeId).get();
        all.docs.forEach((d) => { if ((d.data() || {}).status === 'active' && d.id !== r.createdByUid) plan.push({ to: d.id, title: 'Today at Home: ' + clip(r.text, 80), body: 'Anyone can take it' }); });
      }
    } else if (u.type === 'created' && r.requesterUid === r.assigneeUid && r.assigneeUid === u.actorUid) {
      // someone's own task, their own idea: nobody needs telling (admins following Home
      // hear of it). Something asked of them in person is not this: it notifies exactly
      // as if the person who asked had sent it (Decisions, 2026-10-16).
      await follow((await name(u.actorUid)) + ' added a task', clip(r.text, 120));
    } else if (u.type === 'created') {
      plan.push({ to: r.assigneeUid, title: (await name(r.requesterUid)) + ' sent a request', body: clip(r.text, 120) });
      await follow((await name(r.requesterUid)) + ' asked ' + (await name(r.assigneeUid)), clip(r.text, 120));
    } else if (u.type === 'comment') {
      const title = (await name(u.actorUid)) + ' updated “' + what + '”';
      for (const to of new Set(r.participants || [])) if (to !== u.actorUid) plan.push({ to, title, body: clip(u.text, 140) });
    } else if (u.type === 'planned') {
      await tellAsker((await name(u.actorUid)) + ' planned your request', clip(r.text, 120));
    } else if (u.type === 'status' && u.metadata && u.metadata.status === 'done') {
      await tellAsker((await name(u.actorUid)) + ' completed your request', clip(r.text, 120));
      // an admin ticked off someone else's: the person it was for hears it's done
      if (r.assigneeUid && r.assigneeUid !== u.actorUid)
        plan.push({ to: r.assigneeUid, title: (await name(u.actorUid)) + ' marked “' + what + '” done', body: 'No need to do it now' });
      // anyone who asked to hear when it's done (their own, private wish)
      for (const w of await watchers(rid, null)) if (w !== u.actorUid) plan.push({ to: w, title: (await name(u.actorUid)) + ' completed “' + what + '”', body: 'You asked to hear when it was done' });
      await follow((await name(u.actorUid)) + ' completed “' + what + '”', r.requesterUid === r.assigneeUid ? 'Own task' : 'Asked by ' + (await name(r.requesterUid)));
    } else if (u.type === 'cant_do') {
      await tellAsker((await name(u.actorUid)) + ' can’t do “' + what + '”', clip(r.cantDoReason || '', 140));
    } else if (u.type === 'claimed' && r.assigneeUid === u.actorUid) {
      await tellAsker((await name(u.actorUid)) + ' will do “' + what + '”', 'They took it on');
    } else if (u.type === 'reassigned' && u.metadata && u.metadata.toUid === r.assigneeUid && r.assigneeUid !== u.actorUid) {
      plan.push({ to: r.assigneeUid, title: (await name(u.actorUid)) + ' passed you a request', body: clip(r.text, 120) });
    }
    if (!plan.length) return { skipped: 'quiet' };
    const eventId = 'home_' + rid + '_' + ev.updateId;
    if (!(await claimEvent(eventId, { kind: 'home_' + u.type, requestId: rid }))) return { skipped: 'duplicate' };
    const results = [];
    const seen = {};
    for (const p of plan) {
      if (seen[p.to]) continue;
      seen[p.to] = true;
      if (!(await member(p.to)) || !(await userRole(p.to))) continue;
      if (!(await wants(p.to, p.optIn ? 'homeOversight' : 'partner', !!p.optIn))) continue;
      const payload = { title: p.title, body: p.body || '', url: appLink(ev.appUrl, { home: rid }),
        tag: 'ledger-home-' + rid, renotify: true, kind: 'home' };
      results.push(await sendPushToUser(p.to, payload, { urgency: 'normal', ttl: 24 * 3600, vapidPublicKey: ev.vapidPublicKey }));
    }
    const sum = { recipients: results.map((x) => x.recipientUid), sent: results.reduce((n, x) => n + x.sent, 0), failed: results.reduce((n, x) => n + x.failed, 0) };
    await recordEvent(eventId, Object.assign({ status: 'done' }, sum));
    return Object.assign(sum, { results });
  }

  // ---- Home: "tell me when it's ticked / done" (ledger_home_watches) ----
  // Each watch is one person's own; the server sends only to people still at that Home who
  // can still see the request (in it, sharing it with Home, or an admin).
  async function watchersOf(r, requestId, itemId, member) {
    const snap = await db.collection('ledger_home_watches').where('requestId', '==', requestId).where('itemId', '==', itemId).get();
    const out = [];
    for (const d of snap.docs) {
      const w = d.data() || {};
      if (w.homeId !== r.homeId || !w.uid || out.indexOf(w.uid) > -1) continue;
      const m = await member(w.uid);
      if (!m) continue;
      if (m.role === 'admin' || (r.participants || []).indexOf(w.uid) > -1 || r.visibility === 'home') out.push(w.uid);
    }
    return out;
  }
  // a checklist item ticked: everyone watching that item, but whoever ticked it
  async function handleItemTicked(ev) {
    const before = ev.before || {}, after = ev.after || {};
    const rid = ev.requestId, iid = ev.itemId;
    if (!rid || !iid || after.done !== true || before.done === true) return { skipped: 'not a tick' };
    const reqSnap = await db.collection('ledger_home_requests').doc(rid).get();
    if (!reqSnap.exists) return { skipped: 'no request' };
    const r = reqSnap.data() || {};
    if (r.deletedAt) return { skipped: 'deleted' };
    const memberCache = {};
    async function member(uid) {
      if (!uid || typeof uid !== 'string') return null;
      if (!(uid in memberCache)) {
        const d = await db.collection('ledger_home_members').doc(uid).get();
        const m = d.exists ? (d.data() || {}) : null;
        memberCache[uid] = m && m.homeId === r.homeId && m.status === 'active' ? m : null;
      }
      return memberCache[uid];
    }
    const actor = await member(after.doneByUid);
    if (!actor) return { skipped: 'not at Home' };
    const to = (await watchersOf(r, rid, iid, member)).filter((u) => u !== after.doneByUid);
    if (!to.length) return { skipped: 'nobody watching' };
    const eventId = 'item_' + rid + '_' + iid + '_' + String(after.doneAt || '').replace(/[^0-9A-Za-z]/g, '');
    if (!(await claimEvent(eventId, { kind: 'home_item_ticked', requestId: rid }))) return { skipped: 'duplicate' };
    const results = [];
    for (const uid of to) {
      if (!(await userRole(uid))) continue;
      if (!(await wants(uid, 'partner', false))) continue;
      const payload = { title: clip(actor.displayName || 'Someone', 40) + ' ticked “' + clip(after.text, 80) + '”',
        body: 'On “' + clip(r.text, 80) + '”', url: appLink(ev.appUrl, { home: rid }),
        tag: 'ledger-item-' + rid + '-' + iid, renotify: true, kind: 'home' };
      results.push(await sendPushToUser(uid, payload, { urgency: 'normal', ttl: 24 * 3600, vapidPublicKey: ev.vapidPublicKey }));
    }
    const sum = { recipients: results.map((x) => x.recipientUid), sent: results.reduce((n, x) => n + x.sent, 0), failed: results.reduce((n, x) => n + x.failed, 0) };
    await recordEvent(eventId, Object.assign({ status: 'done' }, sum));
    return Object.assign(sum, { results });
  }

  // ---- Home: daily tasks (functions/daily.js, docs/HOME_DAILY.md) ----
  // A task someone else adds to a person's list for today: that person hears it, once.
  // Tasks the day brings (carried over, or repeating) are announced by the morning
  // message, never one by one; a list for another day is quiet until its morning.
  async function handleDailyItemAdded(ev) {
    const after = ev.after || {}, rid = ev.requestId, iid = ev.itemId;
    if (!rid || !iid || ev.before) return { skipped: 'not new' };
    if (after.carriedFrom || after.repeatId) return { skipped: 'the day\'s own' };
    const reqSnap = await db.collection('ledger_home_requests').doc(rid).get();
    if (!reqSnap.exists) return { skipped: 'no list' };
    const r = reqSnap.data() || {};
    if (r.kind !== 'daily' || r.deletedAt || !r.dailyUid) return { skipped: 'not a daily list' };
    if (!after.createdByUid || after.createdByUid === r.dailyUid) return { skipped: 'their own' };
    const cfg = await db.collection('ledger_home_daily').doc(r.dailyUid).get();
    const c = cfg.exists ? cfg.data() || {} : null;
    if (!c || c.status !== 'active' || c.homeId !== r.homeId) return { skipped: 'daily tasks off' };
    if (r.dailyDate !== localNow(c.timezone, new Date(now())).date) return { skipped: 'not today' };
    const member = async (uid) => {
      const d = await db.collection('ledger_home_members').doc(uid).get();
      const m = d.exists ? d.data() || {} : null;
      return m && m.homeId === r.homeId && m.status === 'active' ? m : null;
    };
    const actor = await member(after.createdByUid), them = await member(r.dailyUid);
    if (!actor || !them || !(await userRole(r.dailyUid))) return { skipped: 'not at Home' };
    const eventId = 'daily_add_' + rid + '_' + iid;
    if (!(await claimEvent(eventId, { kind: 'home_daily_added', requestId: rid }))) return { skipped: 'duplicate' };
    const result = await sendPushToUser(r.dailyUid, {
      title: clip(actor.displayName || 'Someone', 40) + ' added to today’s tasks', body: clip(after.text, 120),
      url: appLink(ev.appUrl, { home: rid }), tag: 'ledger-daily-' + rid, renotify: true, kind: 'home'
    }, { urgency: 'normal', ttl: 12 * 3600, vapidPublicKey: ev.vapidPublicKey });
    await recordEvent(eventId, Object.assign({ status: 'done' }, result));
    return result;
  }
  // the morning message (daily.js decides when, and what it says)
  async function sendDailyMorning(uid, m, ev) {
    if (!(await userRole(uid))) return null;
    return sendPushToUser(uid, {
      title: m.title, body: m.body, url: appLink(ev.appUrl, { home: m.listId }), tag: 'ledger-daily-morning', renotify: true, kind: 'home'
    }, { urgency: 'normal', ttl: 6 * 3600, vapidPublicKey: ev.vapidPublicKey });
  }

  // ---- Home: an update on an ongoing task (ledger_home_ongoing/{id}/updates/{id}) ----
  // What someone on it says, or (an admin) that it's waiting on someone, or no longer is.
  // Everyone on the task hears it but whoever wrote it; admins not on it hear it only if
  // they follow Home. The writer must still be at that Home and able to post there.
  async function handleOngoingUpdate(ev) {
    const u = ev.update || {};
    const oid = ev.ongoingId;
    if (!oid || typeof oid !== 'string') return { skipped: 'no task' };
    if (['comment', 'waiting', 'waiting_cleared'].indexOf(u.type) === -1) return { skipped: 'quiet' };
    const snap = await db.collection('ledger_home_ongoing').doc(oid).get();
    if (!snap.exists) return { skipped: 'no task' };
    const o = snap.data() || {};
    const memberCache = {};
    async function member(uid) {
      if (!uid || typeof uid !== 'string') return null;
      if (!(uid in memberCache)) {
        const d = await db.collection('ledger_home_members').doc(uid).get();
        const m = d.exists ? (d.data() || {}) : null;
        memberCache[uid] = m && m.homeId === o.homeId && m.status === 'active' ? m : null;
      }
      return memberCache[uid];
    }
    const actor = await member(u.actorUid);
    if (!actor) return { skipped: 'not at Home' };
    const people = o.participants || [];
    if (actor.role !== 'admin' && (u.type !== 'comment' || people.indexOf(u.actorUid) === -1)) return { skipped: 'not on it' };
    const name = clip(actor.displayName || 'Someone', 40);
    const md = u.metadata || {};
    const title = name + ' updated “' + clip(o.title, 60) + '”';
    let body;
    if (u.type === 'comment') body = clip(u.text, 140);
    else if (u.type === 'waiting') body = clip('Waiting on ' + (md.on || 'someone') + (md.chaseBy ? ' · chase ' + dayLabel(md.chaseBy) : '') + (u.text ? ' — ' + u.text : ''), 140);
    else body = clip('No longer waiting on ' + (md.on || 'them') + (u.text ? ' — ' + u.text : ''), 140);
    const plan = [];
    for (const to of new Set(people)) if (to !== u.actorUid) plan.push({ to });
    const admins = await db.collection('ledger_home_members').where('homeId', '==', o.homeId).where('role', '==', 'admin').get();
    admins.docs.forEach((d) => {
      const m = d.data() || {};
      if (m.status === 'active' && d.id !== u.actorUid && people.indexOf(d.id) === -1) plan.push({ to: d.id, optIn: true });
    });
    if (!plan.length) return { skipped: 'quiet' };
    const eventId = 'ongoing_' + oid + '_' + ev.updateId;
    if (!(await claimEvent(eventId, { kind: 'ongoing_' + u.type, ongoingId: oid }))) return { skipped: 'duplicate' };
    const results = [];
    for (const p of plan) {
      if (!(await member(p.to)) || !(await userRole(p.to))) continue;
      if (!(await wants(p.to, p.optIn ? 'homeOversight' : 'partner', !!p.optIn))) continue;
      const payload = { title, body, url: appLink(ev.appUrl, { home: 'og-' + oid }), tag: 'ledger-ongoing-' + oid, renotify: true, kind: 'home' };
      results.push(await sendPushToUser(p.to, payload, { urgency: 'normal', ttl: 24 * 3600, vapidPublicKey: ev.vapidPublicKey }));
    }
    const sum = { recipients: results.map((x) => x.recipientUid), sent: results.reduce((n, x) => n + x.sent, 0), failed: results.reduce((n, x) => n + x.failed, 0) };
    await recordEvent(eventId, Object.assign({ status: 'done' }, sum));
    return Object.assign(sum, { results });
  }

  // ---- Home: a list sent in one go ----
  // ledger_home_batches/{id} names the requests that went out together. Nothing in it is
  // trusted on its own: each id must be a live request at the same Home, created by the
  // batch's writer, whose "created" entry carries this list's id. Each assignee then hears
  // ONE notification for everything they were sent ("Abi sent you 6 requests").
  async function handleHomeBatch(ev) {
    const bt = ev.batch || {};
    const bid = ev.batchDocId;
    if (!bid || typeof bt.batchId !== 'string' || !Array.isArray(bt.requestIds) || !bt.requestIds.length) return { skipped: 'empty' };
    const by = bt.createdByUid;
    const meSnap = by ? await db.collection('ledger_home_members').doc(by).get() : null;
    const writer = meSnap && meSnap.exists ? meSnap.data() || {} : null;
    if (!writer || writer.homeId !== bt.homeId || writer.status !== 'active') return { skipped: 'not at Home' };
    const ids = bt.requestIds.filter((x) => typeof x === 'string' && /^[A-Za-z0-9]{1,40}$/.test(x)).slice(0, 40);
    const reqs = [];
    for (const id of ids) {
      const ref = db.collection('ledger_home_requests').doc(id);
      const [rs, cs] = await Promise.all([ref.get(), ref.collection('updates').doc('created').get()]);
      if (!rs.exists || !cs.exists) continue;
      const r = rs.data() || {}, c = cs.data() || {};
      if (r.homeId !== bt.homeId || r.createdByUid !== by || r.deletedAt || r.status === 'withdrawn') continue;
      if (!c.metadata || c.metadata.batchId !== bt.batchId || c.actorUid !== by) continue;
      reqs.push(Object.assign({ id }, r));
    }
    if (!reqs.length) return { skipped: 'nothing to announce' };
    const eventId = 'homebatch_' + bid;
    if (!(await claimEvent(eventId, { kind: 'home_batch', count: reqs.length }))) return { skipped: 'duplicate' };
    const memberCache = {};
    async function member(uid) {
      if (!uid || typeof uid !== 'string') return null;
      if (!(uid in memberCache)) {
        const d = await db.collection('ledger_home_members').doc(uid).get();
        const m = d.exists ? (d.data() || {}) : null;
        memberCache[uid] = m && m.homeId === bt.homeId && m.status === 'active' ? m : null;
      }
      return memberCache[uid];
    }
    const from = clip(writer.displayName || 'Someone', 40);
    const byAssignee = {};
    reqs.forEach((r) => { if (r.assigneeUid && r.assigneeUid !== by) (byAssignee[r.assigneeUid] = byAssignee[r.assigneeUid] || []).push(r); });
    const list = (rs) => {
      const names = rs.slice(0, 3).map((r) => clip(r.text, 40));
      return clip(names.join(', ') + (rs.length > 3 ? ' and ' + (rs.length - 3) + ' more' : ''), 160);
    };
    const results = [];
    const told = {};
    for (const to of Object.keys(byAssignee)) {
      const rs = byAssignee[to];
      if (!(await member(to)) || !(await userRole(to))) continue;
      if (!(await wants(to, 'partner', false))) continue;
      told[to] = true;
      const one = rs.length === 1;
      const payload = { title: one ? from + ' sent a request' : from + ' sent you ' + rs.length + ' requests', body: one ? clip(rs[0].text, 120) : list(rs),
        url: appLink(ev.appUrl, { home: one ? rs[0].id : 'all' }), tag: 'ledger-home-batch-' + bid, renotify: true, kind: 'home' };
      results.push(await sendPushToUser(to, payload, { urgency: 'normal', ttl: 24 * 3600, vapidPublicKey: ev.vapidPublicKey }));
    }
    // admins who follow Home hear it once too, if it wasn't for them
    const admins = await db.collection('ledger_home_members').where('homeId', '==', bt.homeId).where('role', '==', 'admin').get();
    for (const d of admins.docs) {
      const uid = d.id, m = d.data() || {};
      if (m.status !== 'active' || uid === by || told[uid]) continue;
      if (!(await userRole(uid)) || !(await wants(uid, 'homeOversight', true))) continue;
      const who = Object.keys(byAssignee).map((u) => (memberCache[u] && memberCache[u].displayName) || 'someone');
      results.push(await sendPushToUser(uid, { title: from + ' asked ' + clip(who.join(' and '), 60) + ' for ' + reqs.length + (reqs.length === 1 ? ' thing' : ' things'),
        body: list(reqs), url: appLink(ev.appUrl, { home: 'all' }), tag: 'ledger-home-batch-' + bid, renotify: true, kind: 'home' },
        { urgency: 'normal', ttl: 24 * 3600, vapidPublicKey: ev.vapidPublicKey }));
    }
    const sum = { requests: reqs.length, recipients: results.map((x) => x.recipientUid), sent: results.reduce((n, x) => n + x.sent, 0), failed: results.reduce((n, x) => n + x.failed, 0) };
    await recordEvent(eventId, Object.assign({ status: 'done' }, sum));
    return Object.assign(sum, { results });
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

  return { sendPushToUser, handleFocusWrite, handleRequestUpdate, handleHomeUpdate, handleOngoingUpdate, handleItemTicked, handleHomeBatch, handlePinCreated, claimEvent,
    handleDailyItemAdded, sendDailyMorning };
}

module.exports = { createEngine, appLink, clip, fcmMessage, channelFor, FOCUS_TAG };
