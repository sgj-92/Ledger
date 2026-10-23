// Where the app's web code comes from (docs/NATIVE_MIGRATION.md §2, option A: production).
// LEDGER_APP_URL points a local build at a Vercel preview or a development server, for
// testing only. Read by capacitor.config.ts, and written into www/app-url.js so the
// bundled offline page knows where "Try again" goes. Run through `npm run sync`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION = 'https://ledger.sgj.luxe/';

export function appUrl() {
  const raw = (process.env.LEDGER_APP_URL || PRODUCTION).trim();
  const u = new URL(raw);
  if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d+\.\d+)$/.test(u.hostname))
    throw new Error('LEDGER_APP_URL must be https (plain http only for a local development server): ' + raw);
  return u.origin + '/';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = appUrl();
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www', 'app-url.js');
  fs.writeFileSync(out, '// Written by scripts/app-url.mjs — the address this build of the app loads.\nwindow.LEDGER_APP_URL = ' + JSON.stringify(url) + ';\n');
  console.log('Ledger app URL: ' + url + (url === PRODUCTION ? ' (production)' : ' (NOT production — a testing build)'));
}
