// Before each build you send out (TestFlight, Firebase App Distribution): a new build
// number for both apps, which the stores require to go up every time. The iPhone app and
// its widget share one number (Apple rejects a mismatch).
//
//   npm run bump              → build 1 → 2, version unchanged
//   npm run bump -- 1.1       → also the version people see (1.0 → 1.1)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
const version = process.argv[2];
if (version && !/^\d+\.\d+(\.\d+)?$/.test(version)) { console.error('Version looks like 1.1 or 1.1.2'); process.exit(1); }

const gradlePath = here('android/app/build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');
const code = Number((gradle.match(/versionCode (\d+)/) || [])[1]);
if (!code) { console.error('No versionCode in android/app/build.gradle'); process.exit(1); }

const pbxPath = here('ios/App/App.xcodeproj/project.pbxproj');
let pbx = readFileSync(pbxPath, 'utf8');
const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
const next = Math.max(code, ...builds) + 1;

gradle = gradle.replace(/versionCode \d+/, 'versionCode ' + next);
pbx = pbx.replace(/CURRENT_PROJECT_VERSION = \d+;/g, 'CURRENT_PROJECT_VERSION = ' + next + ';');
if (version) {
  gradle = gradle.replace(/versionName "[^"]*"/, 'versionName "' + version + '"');
  pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = ' + version + ';');
}
writeFileSync(gradlePath, gradle);
writeFileSync(pbxPath, pbx);
console.log('Build ' + next + (version ? ', version ' + version : '') + ' — Android and iPhone (app and widget).');
