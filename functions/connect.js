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

  return { start, callback, disconnect, pull, configured };
}

module.exports = { createConnect, SCOPES, NOT_PEOPLE };
