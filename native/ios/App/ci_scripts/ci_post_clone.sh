#!/bin/sh
# Xcode Cloud (docs/NATIVE_MIGRATION.md §12d): what the iPhone build needs that GitHub
# doesn't hold, made the same way `npm run sync` makes it on the Mac.
#   - the plugins (native/node_modules), which the Swift packages point at;
#   - the web layer Capacitor copies in (App/public, capacitor.config.json);
#   - GoogleService-Info.plist, kept out of the repository and given to Xcode Cloud as
#     secrets: either GOOGLE_SERVICE_INFO_PLIST (the whole file, base64, on one line), or
#     its four values FIREBASE_API_KEY, FIREBASE_GCM_SENDER_ID, FIREBASE_GOOGLE_APP_ID and
#     FIREBASE_PROJECT_ID (for when Xcode Cloud won't take the long one);
#   - Package.resolved, so Xcode Cloud can resolve the Swift packages.
set -e

if [ -z "$GOOGLE_SERVICE_INFO_PLIST" ] && { [ -z "$FIREBASE_API_KEY" ] || [ -z "$FIREBASE_GCM_SENDER_ID" ] || [ -z "$FIREBASE_GOOGLE_APP_ID" ] || [ -z "$FIREBASE_PROJECT_ID" ]; }; then
  echo "error: the Firebase settings aren't set. Add GOOGLE_SERVICE_INFO_PLIST, or the four FIREBASE_* values, to this workflow's environment as secrets (see docs/NATIVE_MIGRATION.md §12d)."
  exit 1
fi

export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1
command -v node >/dev/null 2>&1 || brew install node

cd "$CI_PRIMARY_REPOSITORY_PATH/native"
npm ci
node scripts/app-url.mjs
npx cap sync ios

PLIST=ios/App/App/GoogleService-Info.plist
if [ -n "$GOOGLE_SERVICE_INFO_PLIST" ]; then
  printf '%s' "$GOOGLE_SERVICE_INFO_PLIST" | tr -d ' \n\r' | base64 --decode > "$PLIST"
else
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>API_KEY</key><string>$FIREBASE_API_KEY</string>
	<key>GCM_SENDER_ID</key><string>$FIREBASE_GCM_SENDER_ID</string>
	<key>PLIST_VERSION</key><string>1</string>
	<key>BUNDLE_ID</key><string>luxe.sgj.ledger</string>
	<key>PROJECT_ID</key><string>$FIREBASE_PROJECT_ID</string>
	<key>STORAGE_BUCKET</key><string>$FIREBASE_PROJECT_ID.firebasestorage.app</string>
	<key>IS_ADS_ENABLED</key><false/>
	<key>IS_ANALYTICS_ENABLED</key><false/>
	<key>IS_APPINVITE_ENABLED</key><true/>
	<key>IS_GCM_ENABLED</key><true/>
	<key>IS_SIGNIN_ENABLED</key><true/>
	<key>GOOGLE_APP_ID</key><string>$FIREBASE_GOOGLE_APP_ID</string>
</dict>
</plist>
PLISTEOF
fi
plutil -lint "$PLIST"

cd ios/App
xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App
