#!/bin/sh
# Xcode Cloud (docs/NATIVE_MIGRATION.md §12d): what the iPhone build needs that GitHub
# doesn't hold, made the same way `npm run sync` makes it on the Mac.
#   - the plugins (native/node_modules), which the Swift packages point at;
#   - the web layer Capacitor copies in (App/public, capacitor.config.json);
#   - GoogleService-Info.plist, kept out of the repository and given to Xcode Cloud as the
#     secret environment variable GOOGLE_SERVICE_INFO_PLIST (the file, base64);
#   - Package.resolved, so Xcode Cloud can resolve the Swift packages.
set -e

if [ -z "$GOOGLE_SERVICE_INFO_PLIST" ]; then
  echo "error: GOOGLE_SERVICE_INFO_PLIST isn't set. Add it to this workflow's environment as a secret (see docs/NATIVE_MIGRATION.md §12d)."
  exit 1
fi

export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1
command -v node >/dev/null 2>&1 || brew install node

cd "$CI_PRIMARY_REPOSITORY_PATH/native"
npm ci
node scripts/app-url.mjs
npx cap sync ios

printf '%s' "$GOOGLE_SERVICE_INFO_PLIST" | base64 --decode > ios/App/App/GoogleService-Info.plist

cd ios/App
xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App
