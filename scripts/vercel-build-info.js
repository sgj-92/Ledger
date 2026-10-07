// Vercel build step: stamp buildInfo.js with the commit being deployed.
//
// Vercel runs this before publishing (vercel.json → buildCommand). It reads Vercel's own
// system build metadata (VERCEL_GIT_COMMIT_SHA) — public facts about this build, not a
// token — and writes the same shape the app has always read:
//   window.LEDGER_BUILD = { sha, time }   (time: Europe/London, "YYYY-MM-DDTHH:MM")
// Without a commit SHA (a local run, or metadata switched off in the project) it leaves
// the committed placeholder alone, so the app says "local build" rather than guessing.
// No dependencies; nothing else in the site is built or changed.
'use strict';
const fs = require('fs');
const path = require('path');

const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
if (!/^[0-9a-f]{40}$/i.test(sha)) {
  console.log('build info: no Vercel commit SHA — keeping the local placeholder');
  process.exit(0);
}
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(new Date()).map((p) => [p.type, p.value]));
const time = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
const out = '// Written by scripts/vercel-build-info.js during the Vercel build. Not in the repository.\n' +
  'window.LEDGER_BUILD = { sha: "' + sha.toLowerCase() + '", time: "' + time + '" };\n';   // the shape the Pages stamp has always had
fs.writeFileSync(path.join(__dirname, '..', 'buildInfo.js'), out);
console.log('build info: ' + sha.slice(0, 7) + ' · ' + time);
