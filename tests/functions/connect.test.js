// Ledger — Microsoft 365 for the Comms sweep, the server half (functions/connect.js),
// against the Firestore emulator with a stand-in Microsoft: only the owner can connect;
// sign-in is PKCE with a one-time state; the tokens stay on the server; the pull finds who
// is waiting (Focused mail not yet answered, Teams chats whose last word is someone
// else's) and returns names only; a revoked sign-in disconnects cleanly.
//
//   cd functions && npm install
//   npx firebase emulators:exec --only firestore --project demo-ledger "node ../tests/functions/connect.test.js"

const path = require('path');
const crypto = require('crypto');
const fnDir = path.join(__dirname, '../../functions');
const admin = require(path.join(fnDir, 'node_modules/firebase-admin'));
const { createConnect } = require(path.join(fnDir, 'connect.js'));

admin.initializeApp({ projectId: 'demo-ledger' });
const db = admin.firestore();

let passed = 0, failed = 0;
function check(cond, name, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
const CLIENT = '11111111-2222-3333-4444-555555555555';
const REDIRECT = 'https://us-central1-demo-ledger.cloudfunctions.net/msCallback';
let NOW = new Date('2026-11-11T09:00:00Z');
const calls = [];
let refreshFails = false, rot = 0;
// a stand-in Microsoft: the token endpoint and the few Graph calls the pull makes
async function fakeFetch(url, init) {
  const u = new URL(url);
  const body = init && init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
  calls.push({ path: u.pathname, query: u.search, body, auth: init && init.headers && init.headers.authorization });
  const json = (status, j) => ({ ok: status < 300, status, json: async () => j });
  if (u.pathname.endsWith('/oauth2/v2.0/token')) {
    if (body.grant_type === 'authorization_code') {
      if (body.code !== 'good-code' || !body.code_verifier) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: 'at1', refresh_token: 'rt1' });
    }
    if (refreshFails) return json(400, { error: 'invalid_grant', error_description: 'revoked' });
    rot++;
    return json(200, { access_token: 'at' + (rot + 1), refresh_token: 'rt' + (rot + 1) });
  }
  if (u.pathname === '/v1.0/me') return json(200, { id: 'me-id', displayName: 'Shaun', mail: 'shaun@sj.example' });
  if (u.pathname === '/v1.0/me/mailFolders/inbox/messages') return json(200, { value: [
    { conversationId: 'c1', receivedDateTime: '2026-11-11T08:00:00Z', inferenceClassification: 'focused', from: { emailAddress: { name: 'Kori Lane', address: 'kori@client.example' } }, subject: 'SECRET SUBJECT', bodyPreview: 'SECRET BODY' },
    { conversationId: 'c1', receivedDateTime: '2026-11-10T08:00:00Z', inferenceClassification: 'focused', from: { emailAddress: { name: 'Kori Lane', address: 'kori@client.example' } } },
    { conversationId: 'c2', receivedDateTime: '2026-11-10T12:00:00Z', inferenceClassification: 'focused', from: { emailAddress: { name: 'Ben Ode', address: 'ben@client.example' } } },
    { conversationId: 'c3', receivedDateTime: '2026-11-10T13:00:00Z', inferenceClassification: 'other', from: { emailAddress: { name: 'Promo', address: 'deals@shop.example' } } },
    { conversationId: 'c4', receivedDateTime: '2026-11-10T14:00:00Z', inferenceClassification: 'focused', from: { emailAddress: { name: 'Service', address: 'no-reply@service.example' } } },
    { conversationId: 'c5', receivedDateTime: '2026-11-10T15:00:00Z', inferenceClassification: 'focused', from: { emailAddress: { name: 'Shaun', address: 'shaun@sj.example' } } }
  ] });
  if (u.pathname === '/v1.0/me/mailFolders/sentitems/messages') return json(200, { value: [
    { conversationId: 'c2', sentDateTime: '2026-11-10T16:00:00Z' },        // Ben answered
    { conversationId: 'c1', sentDateTime: '2026-11-10T09:00:00Z' }         // before Kori's newest
  ] });
  // "ledger: …" capture: its own chats and their messages, when a test sets them
  if (captureChats && u.pathname === '/v1.0/me/chats') return json(200, { value: captureChats });
  const cm = /^\/v1\.0\/me\/chats\/([^/]+)\/messages$/.exec(u.pathname);
  if (cm && captureMsgs[decodeURIComponent(cm[1])]) return json(200, { value: captureMsgs[decodeURIComponent(cm[1])] });
  if (u.pathname === '/v1.0/me/chats') return json(200, { value: [
    { id: 'ch1', chatType: 'oneOnOne', lastMessagePreview: { id: 'm1', createdDateTime: '2026-11-11T07:00:00Z', messageType: 'message', from: { user: { id: 'u-jc', displayName: 'JC' } } } },
    { id: 'ch2', chatType: 'oneOnOne', lastMessagePreview: { id: 'm2', createdDateTime: '2026-11-11T07:30:00Z', messageType: 'message', from: { user: { id: 'me-id', displayName: 'Shaun' } } } },
    { id: 'ch3', chatType: 'group', topic: 'Launch', lastMessagePreview: { id: 'm3', createdDateTime: '2026-11-11T06:00:00Z', messageType: 'message', from: { user: { id: 'u-thea', displayName: 'Thea' } } } },
    { id: 'ch4', chatType: 'group', lastMessagePreview: { id: 'm4', createdDateTime: '2026-11-11T06:30:00Z', messageType: 'systemEventMessage', from: null } },
    { id: 'ch5', chatType: 'oneOnOne', lastMessagePreview: { id: 'm5', createdDateTime: '2026-11-01T06:30:00Z', messageType: 'message', from: { user: { id: 'u-old', displayName: 'Old' } } } }
  ] });
  return json(404, { error: { message: 'not faked: ' + u.pathname } });
}
let captureChats = null;
const captureMsgs = {};
const connect = (clientId) => createConnect({ db, fetch: fakeFetch, clientId: clientId === undefined ? CLIENT : clientId, redirectUri: REDIRECT, appUrl: 'https://ledger.sgj.luxe/', now: () => NOW });

(async () => {
  for (const c of ['ledger_users', 'ledger_connections', 'ledger_meta']) {
    const s = await db.collection(c).get(); await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
  await db.collection('ledger_users').doc('shaun').set({ role: 'owner' });
  await db.collection('ledger_users').doc('abi').set({ role: 'partner' });

  // starting a sign-in
  let out = await connect().start('abi');
  check(out.status === 403, 'start: only the owner');
  out = await connect('').start('shaun');
  check(out.status === 503 && /isn't set up/.test(out.body.error), 'start: says so until the app registration is set');
  out = await connect().start('shaun');
  const url = new URL(out.body.url);
  const state = url.searchParams.get('state');
  check(out.status === 200 && url.host === 'login.microsoftonline.com' && url.searchParams.get('client_id') === CLIENT &&
    url.searchParams.get('code_challenge_method') === 'S256' && url.searchParams.get('redirect_uri') === REDIRECT &&
    /Mail\.Read/.test(url.searchParams.get('scope')) && /Chat\.Read/.test(url.searchParams.get('scope')) && !/secret/i.test(out.body.url),
    'start: Microsoft sign-in with PKCE, mail and chat read, no secret', out.body.url);

  // coming back
  out = await connect().callback({ state: 'x'.repeat(30), code: 'good-code' });
  check(/connected=failed/.test(out.redirect), 'callback: an unknown state is refused');
  out = await connect().callback({ state, code: 'good-code' });
  const tokenCall = calls.filter((c) => c.body && c.body.grant_type === 'authorization_code').pop();
  const st = crypto.createHash('sha256').update(tokenCall.body.code_verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check(st === url.searchParams.get('code_challenge') && !tokenCall.body.client_secret, 'callback: the code is exchanged with the matching verifier, no secret');
  check(out.redirect === 'https://ledger.sgj.luxe/?connected=microsoft', 'callback: back to Ledger, connected', out);
  const conn = (await db.collection('ledger_connections').doc('microsoft').get()).data();
  const meta = (await db.collection('ledger_meta').doc('connections').get()).data();
  check(conn.refreshToken === 'rt1' && conn.uid === 'shaun' && conn.account === 'shaun@sj.example', 'callback: the refresh token is kept on the server');
  check(meta.microsoft.connected === true && meta.microsoft.account === 'shaun@sj.example' && !JSON.stringify(meta).includes('rt1'), 'callback: the app sees only connected and the account', meta);
  out = await connect().callback({ state, code: 'good-code' });
  check(/connected=failed/.test(out.redirect), 'callback: a state works once');
  const s2 = new URL((await connect().start('shaun')).body.url).searchParams.get('state');
  NOW = new Date('2026-11-11T09:20:00Z');
  out = await connect().callback({ state: s2, code: 'good-code' });
  check(/connected=failed/.test(out.redirect), 'callback: an old sign-in (over 10 minutes) is refused');
  const s3 = new URL((await connect().start('shaun')).body.url).searchParams.get('state');
  out = await connect().callback({ state: s3, error: 'access_denied' });
  check(/connected=cancelled/.test(out.redirect), 'callback: cancelling at Microsoft says so');
  NOW = new Date('2026-11-11T09:00:00Z');

  // the pull
  out = await connect().pull('abi');
  check(out.status === 403, 'pull: only the owner');
  out = await connect().pull('shaun');
  const names = out.body.found.map((f) => f.source + ':' + f.name).sort().join(', ');
  check(out.status === 200 && names === 'mail:Kori Lane, teams:JC, teams:Thea (Launch)',
    'pull: Kori (unanswered); not Ben (answered), promotions, no-reply or his own; JC and Thea, not his own last word, system notes or old chats', names);
  check(out.body.found.every((f) => Object.keys(f).sort().join() === 'at,key,name,source') && !JSON.stringify(out.body).includes('SECRET'),
    'pull: names only — no subject or message text leaves the server');
  const inboxCall = calls.filter((c) => c.path.endsWith('/inbox/messages')).pop();
  check(/2026-11-09T09:00:00Z/.test(decodeURIComponent(inboxCall.query)), 'pull: the first check looks back two days', inboxCall.query);
  const afterPull = (await db.collection('ledger_connections').doc('microsoft').get()).data();
  check(afterPull.refreshToken === 'rt2' && afterPull.lastPullAt === NOW.toISOString(), 'pull: the rotated refresh token is kept; the time is noted');
  NOW = new Date('2026-11-11T12:00:00Z');
  await connect().pull('shaun');
  const second = calls.filter((c) => c.path.endsWith('/inbox/messages')).pop();
  check(/2026-11-11T09:00:00Z/.test(decodeURIComponent(second.query)), 'pull: the next check starts where the last left off');
  NOW = new Date('2026-11-30T12:00:00Z');
  await connect().pull('shaun');
  const third = calls.filter((c) => c.path.endsWith('/inbox/messages')).pop();
  check(/2026-11-23T12:00:00Z/.test(decodeURIComponent(third.query)), 'pull: never more than seven days back');

  // revoked at Microsoft: disconnected, and the app is told
  refreshFails = true;
  out = await connect().pull('shaun');
  const gone = (await db.collection('ledger_connections').doc('microsoft').get()).exists;
  const meta2 = (await db.collection('ledger_meta').doc('connections').get()).data();
  check(out.status === 409 && !gone && meta2.microsoft.connected === false && meta2.microsoft.expired === true, 'pull: a revoked sign-in disconnects and asks to connect again', out);

  // disconnect
  refreshFails = false;
  await db.collection('ledger_connections').doc('microsoft').set({ uid: 'shaun', refreshToken: 'rt9', account: 'a' });
  check((await connect().disconnect('abi')).status === 403, 'disconnect: only the owner');
  out = await connect().disconnect('shaun');
  check(out.status === 200 && !(await db.collection('ledger_connections').doc('microsoft').get()).exists, 'disconnect: the token is deleted');

  // ---- "ledger: …" in Teams: his own messages become S&J Actions ----
  check((await connect().capture()).skipped === 'not connected', 'capture: nothing until Microsoft 365 is connected');
  await db.collection('ledger_connections').doc('microsoft').set({ uid: 'shaun', refreshToken: 'rt-c', msUserId: 'me-id', account: 'shaun@sj.example' });
  NOW = new Date('2026-11-25T10:00:00Z');                     // a Wednesday
  const me = { user: { id: 'me-id', displayName: 'Shaun' } }, kori = { user: { id: 'u-kori', displayName: 'Kori Lane' } };
  captureChats = [
    { id: 'cA', chatType: 'oneOnOne', lastMessagePreview: { id: 'x', createdDateTime: '2026-11-25T09:58:00Z', from: kori } },
    { id: 'cB', chatType: 'group', topic: 'Old project', lastMessagePreview: { id: 'y', createdDateTime: '2026-11-25T07:00:00Z', from: kori } }
  ];
  captureMsgs.cA = [
    { id: 'k1', messageType: 'message', createdDateTime: '2026-11-25T09:58:00Z', from: kori, body: { contentType: 'html', content: '<p>ledger: pay me now</p>' } },
    { id: 'm1', messageType: 'message', createdDateTime: '2026-11-25T09:57:00Z', from: me, body: { contentType: 'html', content: '<p>Ledger:&nbsp;send Acme the pack by Friday</p>' } },
    { id: 'm3', messageType: 'message', createdDateTime: '2026-11-25T09:56:00Z', from: me, body: { contentType: 'html', content: '<attachment id="q1"></attachment><p>ledger</p>' },
      attachments: [{ id: 'q1', contentType: 'messageReference', content: JSON.stringify({ messagePreview: 'Can you review the <b>VAT</b> figures?', messageSender: kori }) }] },
    { id: 'm4', messageType: 'message', createdDateTime: '2026-11-25T09:55:00Z', from: me, body: { contentType: 'html', content: '<p>it is in the ledger: later</p>' } },
    { id: 'm6', messageType: 'message', createdDateTime: '2026-11-25T09:54:00Z', from: me, deletedDateTime: '2026-11-25T09:59:00Z', body: { contentType: 'html', content: 'ledger: deleted one' } },
    { id: 'm5', messageType: 'message', createdDateTime: '2026-11-25T08:00:00Z', from: me, body: { contentType: 'html', content: 'ledger: from this morning' } }
  ];
  captureMsgs.cB = [{ id: 'b1', messageType: 'message', createdDateTime: '2026-11-25T06:59:00Z', from: me, body: { contentType: 'text', content: 'ledger: in a quiet chat' } }];
  const told = [];
  const cap1 = await connect().capture({ timezone: 'Europe/London', notify: async (uid, a) => { told.push([uid, a.title, a.date]); } });
  // only the Actions from Teams: other suites share this database and leave their own
  const teamsActs = async () => (await db.collection('ledger_commitments').where('sourceType', '==', 'teams').get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const acts = await teamsActs();
  const pack = acts.find((a) => /Acme/.test(a.title)), vat = acts.find((a) => /VAT/.test(a.title));
  check(cap1.added.length === 2 && acts.length === 2, 'capture: two Actions, from his own "ledger" messages only', acts.map((a) => a.title));
  check(pack && pack.title === 'Send Acme the pack' && pack.date === '2026-11-27' && pack.sj === true && pack.category === 'work' && pack.status === 'planned' && pack.sourceType === 'teams' && pack.sourceLabel === 'Teams · Kori Lane',
    'capture: "ledger: send Acme the pack by Friday" is an S&J Action for Friday, from Teams · Kori Lane', pack);
  check(vat && vat.title === 'Can you review the VAT figures?' && vat.date === '2026-11-25', 'capture: a bare "ledger" in reply takes the message replied to, for today, as text', vat);
  check(!acts.some((a) => /pay me|later|deleted|morning|quiet/.test(a.title)), 'capture: not someone else\'s, not "ledger" mid-sentence, not deleted, not before the first look, not a quiet chat');
  check(told.length === 2 && told.every((t) => t[0] === 'shaun'), 'capture: his phone is told, once for each', told);
  check(!calls.some((c) => /\/chats\/cB\/messages/.test(c.path)), 'capture: a chat with nothing new isn\'t read');
  const capConn = (await db.collection('ledger_connections').doc('microsoft').get()).data();
  check(capConn.captureSince === '2026-11-25T09:59:00.000Z' && /^rt/.test(capConn.refreshToken) && capConn.refreshToken !== 'rt-c', 'capture: the next look starts a minute back; the rotated token is kept', capConn);
  // the same messages again (an overlap): nothing is made twice
  await db.collection('ledger_connections').doc('microsoft').set({ captureSince: '2026-11-25T09:00:00.000Z' }, { merge: true });
  told.length = 0;
  const cap2 = await connect().capture({ timezone: 'Europe/London', notify: async (uid, a) => { told.push(a.title); } });
  check(cap2.added.length === 0 && !told.length && (await teamsActs()).length === 2, 'capture: a message already made into an Action never makes a second', cap2);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
