// Runs execution.test.js — Reset Sprint, Current Focus across devices, and the push sender —
// against the Auth, Firestore *and Functions* emulators, with a throwaway VAPID key pair made
// for this run (never a real one). The functions read their params and secret from
// functions/.env.local and functions/.secret.local, which exist only while this runs.
//
//   (cd functions && npm install) && (cd tests/e2e && npm install)
//   node tests/e2e/execution.run.js [shots-dir]
//
// FIREBASE_BIN overrides the firebase CLI (default: tests/e2e/node_modules/.bin/firebase).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const FN = path.join(ROOT, 'functions');
const webpush = require(path.join(FN, 'node_modules/web-push'));

const keys = webpush.generateVAPIDKeys();
const APP_URL = 'http://127.0.0.1:8952/';
const envFile = path.join(FN, '.env.local'), secretFile = path.join(FN, '.secret.local');
fs.writeFileSync(envFile, [
  'VAPID_PUBLIC_KEY=' + keys.publicKey,
  'VAPID_SUBJECT=mailto:test@example.com',
  'APP_URL=' + APP_URL,
  'FUNCTIONS_REGION=us-central1'
].join('\n') + '\n');
fs.writeFileSync(secretFile, 'VAPID_PRIVATE_KEY=' + keys.privateKey + '\n');

const bin = process.env.FIREBASE_BIN || path.join(__dirname, 'node_modules/.bin/firebase');
let status = 1;
try {
  const r = spawnSync(bin, ['emulators:exec', '--only', 'auth,firestore,functions', '--project', 'ledger-6aec3',
    '--config', path.join(ROOT, 'firebase.json'),
    'node ' + JSON.stringify(path.join(__dirname, 'execution.test.js')) + ' ' + (process.argv[2] || '')], {
    cwd: ROOT, stdio: 'inherit',
    env: Object.assign({}, process.env, {
      LEDGER_VAPID_PUBLIC: keys.publicKey, LEDGER_APP_URL: APP_URL,
      // the local push endpoint uses a self-signed certificate
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    })
  });
  status = r.status == null ? 1 : r.status;
} finally {
  fs.rmSync(envFile, { force: true });
  fs.rmSync(secretFile, { force: true });
  for (const f of ['firestore-debug.log', 'firebase-debug.log', 'ui-debug.log']) fs.rmSync(path.join(ROOT, f), { force: true });
}
process.exit(status);
