// Ledger — Microsoft 365 for the Comms sweep (2026-11-11).
//
// Shaun connects his Microsoft 365 account once (Outlook mail and Teams chats); after
// that the sweep's "Check Outlook & Teams" asks this server who is waiting for a reply,
// and the app adds those names to Replies like any he jots down.
//
// - Sign-in is OAuth 2.0 with PKCE as a public client: no client secret exists anywhere.
//   The app registration's id is the MS_CLIENT_ID param (functions/.env).
// - The refresh token lives only in ledger_connections/microsoft, which no client can
//   read or write (firestore.rules); Microsoft rotates it on each use and it's replaced.
// - The app sees only ledger_meta/connections: connected or not, the account, when last
//   checked. The pull returns names, a channel kind and a key — never message contents.
// - Only the owner (ledger_users role) can start, use or remove the connection.
//
// "Waiting for a reply" means, since the last check (at most 7 days back; 2 the first
// time): an email in the Focused inbox from someone else with nothing sent in its
// conversation after it; a Teams chat whose newest message is someone else's.

const crypto = require('crypto');

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access User.Read Mail.Read Chat.Read';
const CONN = 'ledger_connections';
const STATE_TTL_MS = 10 * 60 * 1000;
const FIRST_DAYS = 2, MAX_DAYS = 7;
const NOT_PEOPLE = /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|alerts?|newsletter|marketing|bounce)([._-]|@)/i;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createConnect(deps) {
  const db = deps.db;
  const http = deps.fetch;                      // fetch(url, init) => Response
  const clientId = deps.clientId || '';
  const redirectUri = deps.redirectUri;
  const appUrl = deps.appUrl || 'https://ledger.sgj.luxe/';
  const clock = deps.now || (() => new Date());
  const random = deps.random || ((n) => b64url(crypto.randomBytes(n)));
  const log = deps.log || (() => {});

  const configured = () => /^[0-9a-f-]{36}$/i.test(clientId);
  async function isOwner(uid) {
    if (!uid) return false;
    const d = await db.collection('ledger_users').doc(uid).get();
    return d.exists && (d.data() || {}).role === 'owner';
  }
  async function form(url, fields) {
    const r = await http(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error_description || j.error || ('token ' + r.status)); e.code = j.error; throw e; }
    return j;
  }
  async function graph(token, path) {
    const r = await http(GRAPH + path, { headers: { authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((j.error && j.error.message) || ('graph ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
  const meta = (patch) => db.collection('ledger_meta').doc('connections').set({ microsoft: patch }, { merge: true });

  // 1. the link to Microsoft's sign-in, bound to this owner by a one-time state
  async function start(uid) {
    if (!(await isOwner(uid))) return { status: 403, body: { error: 'Only Ledger\'s owner can connect an account.' } };
    if (!configured()) return { status: 503, body: { error: 'Microsoft 365 isn\'t set up for Ledger yet.' } };
    const state = random(24), verifier = random(48);
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    await db.collection(CONN).doc('_state_' + state).set({ uid, verifier, createdAt: clock().toISOString() });
    const q = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query',
      scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
    });
    return { status: 200, body: { url: AUTH + '/authorize?' + q.toString() } };
  }

  // 2. Microsoft sends him back here: the code becomes tokens, kept on the server
  async function callback(query) {
    const back = (v) => ({ redirect: appUrl + (appUrl.indexOf('?') === -1 ? '?' : '&') + 'connected=' + v });
    const state = String((query && query.state) || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(state)) return back('failed');
    const ref = db.collection(CONN).doc('_state_' + state);
    const snap = await ref.get();
    if (!snap.exists) return back('failed');
    const st = snap.data() || {};
    await ref.delete();
    if (clock().getTime() - Date.parse(st.createdAt || 0) > STATE_TTL_MS) return back('failed');
    if (query.error || !query.code) return back(query.error === 'access_denied' ? 'cancelled' : 'failed');
    if (!(await isOwner(st.uid))) return back('failed');
    try {
      const t = await form(AUTH + '/token', {
        client_id: clientId, grant_type: 'authorization_code', code: String(query.code), redirect_uri: redirectUri,
        code_verifier: st.verifier, scope: SCOPES
      });
      if (!t.refresh_token || !t.access_token) return back('failed');
      const me = await graph(t.access_token, '/me?$select=id,displayName,mail,userPrincipalName');
      const account = String(me.mail || me.userPrincipalName || me.displayName || 'Microsoft 365').slice(0, 120);
      const now = clock().toISOString();
      await db.collection(CONN).doc('microsoft').set({ uid: st.uid, refreshToken: t.refresh_token, msUserId: me.id || null, account, connectedAt: now, lastPullAt: null });
      await meta({ connected: true, account, connectedAt: now, lastPullAt: null });
      return back('microsoft');
    } catch (e) {
      log('microsoft connect failed', e && e.message);
      return back('failed');
    }
  }

  async function disconnect(uid) {
    if (!(await isOwner(uid))) return { status: 403, body: { error: 'Only Ledger\'s owner can do that.' } };
    await db.collection(CONN).doc('microsoft').delete();
    await meta({ connected: false, account: null, lastPullAt: null });
    return { status: 200, body: { ok: true } };
  }

  // 3. who is waiting: names only
  async function pull(uid) {
    if (!(await isOwner(uid))) return { status: 403, body: { error: 'Only Ledger\'s owner can do that.' } };
    const ref = db.collection(CONN).doc('microsoft');
    const snap = await ref.get();
    if (!snap.exists) return { status: 409, body: { error: 'Connect Microsoft 365 first.' } };
    const c = snap.data() || {};
    let t;
    try {
      t = await form(AUTH + '/token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: c.refreshToken, scope: SCOPES });
    } catch (e) {
      if (e.code === 'invalid_grant') {          // revoked or expired: sign in again
        await ref.delete();
        await meta({ connected: false, account: c.account || null, expired: true });
        return { status: 409, body: { error: 'Microsoft 365 needs connecting again.' } };
      }
      throw e;
    }
    const nowD = clock();
    const floor = new Date(nowD.getTime() - MAX_DAYS * 86400000);
    let since = c.lastPullAt ? new Date(c.lastPullAt) : new Date(nowD.getTime() - FIRST_DAYS * 86400000);
    if (!(since > floor)) since = floor;
    const sinceIso = since.toISOString().replace(/\.\d+Z$/, 'Z');
    const me = String(c.account || '').toLowerCase();
    const found = [], errors = [];

    // Outlook: the Focused inbox, minus anything already answered
    try {
      const inbox = await graph(t.access_token, '/me/mailFolders/inbox/messages?$filter=' + encodeURIComponent('receivedDateTime ge ' + sinceIso) +
        '&$orderby=receivedDateTime%20desc&$top=100&$select=from,conversationId,receivedDateTime,inferenceClassification');
      const sent = await graph(t.access_token, '/me/mailFolders/sentitems/messages?$filter=' + encodeURIComponent('sentDateTime ge ' + sinceIso) +
        '&$top=200&$select=conversationId,sentDateTime');
      const lastSent = {};
      (sent.value || []).forEach((m) => { if (m.conversationId && (!lastSent[m.conversationId] || m.sentDateTime > lastSent[m.conversationId])) lastSent[m.conversationId] = m.sentDateTime; });
      const seen = {};
      (inbox.value || []).forEach((m) => {
        const from = (m.from && m.from.emailAddress) || {};
        const addr = String(from.address || '').toLowerCase();
        if (!m.conversationId || seen[m.conversationId]) return;
        seen[m.conversationId] = true;                       // newest first: one per conversation
        if (m.inferenceClassification === 'other' || !addr || addr === me || NOT_PEOPLE.test(addr)) return;
        if (lastSent[m.conversationId] && lastSent[m.conversationId] > m.receivedDateTime) return;
        found.push({ source: 'mail', key: 'ms-mail:' + m.conversationId + ':' + m.receivedDateTime, name: String(from.name || from.address).slice(0, 80), at: m.receivedDateTime });
      });
    } catch (e) { errors.push('mail'); log('microsoft mail pull failed', e && e.message); }

    // Teams: chats whose newest message is someone else's
    try {
      const chats = await graph(t.access_token, '/me/chats?$expand=lastMessagePreview&$top=50');
      (chats.value || []).forEach((ch) => {
        const lp = ch.lastMessagePreview;
        if (!lp || lp.isDeleted || (lp.messageType && lp.messageType !== 'message')) return;
        if (!lp.createdDateTime || lp.createdDateTime < sinceIso) return;
        const u = lp.from && lp.from.user;
        if (!u || !u.displayName || (c.msUserId && u.id === c.msUserId)) return;
        const group = ch.chatType && ch.chatType !== 'oneOnOne';
        const name = group && ch.topic ? u.displayName + ' (' + ch.topic + ')' : u.displayName;
        found.push({ source: 'teams', key: 'ms-chat:' + ch.id + ':' + (lp.id || lp.createdDateTime), name: String(name).slice(0, 80), at: lp.createdDateTime });
      });
    } catch (e) { errors.push('teams'); log('microsoft teams pull failed', e && e.message); }

    const now = nowD.toISOString();
    const patch = { lastPullAt: errors.length === 2 ? (c.lastPullAt || null) : now };
    if (t.refresh_token) patch.refreshToken = t.refresh_token;          // rotated: keep the new one
    await ref.set(patch, { merge: true });
    await meta({ connected: true, account: c.account || null, lastPullAt: patch.lastPullAt });
    found.sort((a, b) => (a.at < b.at ? -1 : 1));
    return { status: 200, body: { found: found.slice(0, 60), errors, since: sinceIso } };
  }

  // 4. "ledger: …" in Teams (2026-11-25): every couple of minutes, the chats with something
  // new are read, and only Shaun's own messages that start "ledger:" (or "send to ledger:")
  // are acted on. Each becomes an S&J Action on its day; a bare "ledger" in reply to a
  // message takes that message. Nobody else's message is kept, except the one he replied
  // to with "ledger". Each Teams message makes one Action at most (its id is the key).
  async function capture(opts) {
    opts = opts || {};
    if (!configured()) return { skipped: 'not set up' };
    const ref = db.collection(CONN).doc('microsoft');
    const snap = await ref.get();
    if (!snap.exists) return { skipped: 'not connected' };
    const c = snap.data() || {};
    if (!c.msUserId || !c.uid) return { skipped: 'no account id' };
    let t;
    try {
      t = await form(AUTH + '/token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: c.refreshToken, scope: SCOPES });
    } catch (e) {
      if (e.code === 'invalid_grant') {
        await ref.delete();
        await meta({ connected: false, account: c.account || null, expired: true });
        return { skipped: 'expired' };
      }
      throw e;
    }
    const nowD = clock();
    // from the last look, with a minute's overlap (ids stop doubles); the first time, ten minutes
    const since = c.captureSince ? new Date(c.captureSince) : new Date(nowD.getTime() - 10 * 60000);
    const sinceIso = since.toISOString();
    const out = { checked: 0, added: [], errors: [] };
    const tz = opts.timezone || 'Europe/London';
    try {
      const chats = await graph(t.access_token, '/me/chats?$expand=lastMessagePreview&$top=50&$orderby=' + encodeURIComponent('lastMessagePreview/createdDateTime desc'));
      for (const ch of (chats.value || [])) {
        const lp = ch.lastMessagePreview;
        if (!lp || !lp.createdDateTime || lp.createdDateTime < sinceIso) continue;
        out.checked++;
        let msgs;
        try { msgs = await graph(t.access_token, '/me/chats/' + encodeURIComponent(ch.id) + '/messages?$top=20&$orderby=' + encodeURIComponent('createdDateTime desc')); }
        catch (e) { out.errors.push('chat'); log('teams capture: a chat failed', e && e.message); continue; }
        for (const m of (msgs.value || [])) {
          if (!m || m.deletedDateTime || (m.messageType && m.messageType !== 'message')) continue;
          if (!m.createdDateTime || m.createdDateTime < sinceIso) continue;
          const u = m.from && m.from.user;
          if (!u || u.id !== c.msUserId) continue;                 // only his own messages
          const cmd = ledgerCommand(htmlText(m.body && m.body.content, m.body && m.body.contentType));
          if (!cmd) continue;
          let text = cmd.rest;
          if (!text) {                                               // "ledger" in reply: the message replied to
            const refA = (m.attachments || []).find((a) => a && a.contentType === 'messageReference');
            let quoted = '';
            try { quoted = refA ? String((JSON.parse(refA.content || '{}') || {}).messagePreview || '') : ''; } catch (e) { quoted = ''; }
            text = cleanLine(htmlText(quoted, 'html'));
          }
          if (!text) continue;
          const when = dateFromText(text, clock(), tz);
          const title = capFirst(cleanLine(when.text)).slice(0, 200);
          if (!title) continue;
          const id = 'teams-' + crypto.createHash('sha1').update(ch.id + '|' + m.id).digest('hex').slice(0, 20);
          const chatName = chatLabel(ch, c.msUserId, msgs.value || []);
          const now = clock().toISOString();
          try {
            await db.collection('ledger_commitments').doc(id).create({
              title, date: when.date, originalDate: when.date, category: 'work', status: 'planned', sj: true, clientId: null, teamId: null,
              priorityId: null, minVersion: null, disruptionReason: null,
              sourceType: 'teams', sourceLabel: chatName ? 'Teams · ' + chatName : 'Teams', createdAt: now
            });
          } catch (e) {
            if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) continue;   // made already
            throw e;
          }
          out.added.push({ id, title, date: when.date });
          if (opts.notify) {
            try { await opts.notify(c.uid, { id, title, date: when.date, today: when.today }); } catch (e) { log('teams capture: notify failed', e && e.message); }
          }
        }
      }
    } catch (e) { out.errors.push('chats'); log('teams capture failed', e && e.message); }
    const patch = { captureSince: new Date(nowD.getTime() - 60000).toISOString() };
    if (out.errors.indexOf('chats') > -1) delete patch.captureSince;   // look again next time
    if (t.refresh_token) patch.refreshToken = t.refresh_token;
    await ref.set(patch, { merge: true });
    return out;
  }

  return { start, callback, disconnect, pull, capture, configured };
}

// ---- "ledger: …": reading the line ----
// Teams sends a message as HTML: tags go, entities are read, lines are joined
function htmlText(content, type) {
  let s = String(content || '');
  if (String(type || '').toLowerCase() === 'html') {
    s = s.replace(/<attachment[^>]*>[\s\S]*?<\/attachment>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div)>/gi, ' ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return s.replace(/\s+/g, ' ').trim();
}
// "ledger: send Acme the pack", "Ledger - …", "send to ledger: …", or a bare "ledger"
function ledgerCommand(text) {
  const m = /^(?:send\s+to\s+)?ledger\b\s*(?:[:\-\u2013\u2014]\s*([\s\S]*))?$/i.exec(String(text || '').trim());
  if (!m) return null;
  return { rest: cleanLine(m[1] || '') };
}
// text only, never markup (it is written into Ledger)
function cleanLine(t) { return String(t || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300); }
function capFirst(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
// the day it's for, from a word at the end: today, tomorrow, or a weekday (the next one,
// today counting). "…pack by Friday" is for Friday, titled "…pack". Otherwise today.
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function localDate(d, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, weekday: DAYS.indexOf(String(p.weekday).toLowerCase()) };
}
function addDays(ymd, n) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dateFromText(text, now, tz) {
  let zone = tz;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); } catch (e) { zone = 'Europe/London'; }
  const today = localDate(now, zone);
  const m = /\s*(?:\b(?:by|on|for|due)\s+)?\b(today|tomorrow|tmrw|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?\s*$/i.exec(text);
  if (!m) return { text, date: today.date, today: true };
  const w = m[1].toLowerCase();
  let date;
  if (w === 'today') date = today.date;
  else if (w === 'tomorrow' || w === 'tmrw') date = addDays(today.date, 1);
  else {
    const idx = DAYS.findIndex((d) => d.indexOf(w.slice(0, 3)) === 0);
    date = addDays(today.date, (idx - today.weekday + 7) % 7);
  }
  const rest = text.slice(0, m.index).trim();
  return { text: rest || text, date, today: date === today.date };
}
// the chat, as he'd know it: its topic, or the other person (from its recent messages)
function chatLabel(ch, me, msgs) {
  if (ch.topic) return cleanLine(ch.topic).slice(0, 60);
  const names = [];
  (msgs || []).concat([ch.lastMessagePreview || {}]).forEach((x) => {
    const u = x && x.from && x.from.user;
    if (u && u.id !== me && u.displayName && names.indexOf(u.displayName) === -1) names.push(u.displayName);
  });
  return names.length ? cleanLine(names.slice(0, 3).join(', ')).slice(0, 60) : '';
}

module.exports = { createConnect, SCOPES, NOT_PEOPLE, ledgerCommand, htmlText, dateFromText };
