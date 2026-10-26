# Ledger — iOS and Android apps

Capacitor shells around the live web app (`docs/NATIVE_MIGRATION.md`). Each app loads
**https://ledger.sgj.luxe** and runs the same page as the web: the same sign-in, data, five
tabs and Home. Native code is only what the platform needs:
- the icon and splash;
- the status bar and safe areas;
- the keyboard;
- Android's back button;
- links to other sites opening in the system browser;
- a bundled "You're offline" page.

| Path | What it is |
| --- | --- |
| `capacitor.config.ts` | App id `luxe.sgj.ledger`, the address it loads, plugins |
| `www/` | `offline.html` (bundled; shown when Ledger can't load), a stepping-stone `index.html`, its fonts and mark |
| `ios/` | Xcode project (Swift Package Manager; no CocoaPods) |
| `android/` | Android Studio / Gradle project |
| `scripts/app-url.mjs` | Which address the build loads (production unless `LEDGER_APP_URL` is set) |
| `scripts/make-assets.py` | Regenerates the icons and splash screens from `icon-512.png` |

## Running the apps on the Mac

Needs: Node 20+, Xcode 26 with an iOS simulator, Android Studio with an emulator. No Apple
or Google account is needed for simulators and emulators.

```
cd ~/Ledger
git fetch origin
git checkout main
git pull
cd native
npm install          # Capacitor; the iOS project reads its Swift packages from here
npm run sync         # writes the app's settings and the offline page into both projects
```

**iOS:**
1. Run `npm run ios`. Xcode opens `ios/App/App.xcodeproj`. The first time, it fetches the
   Capacitor Swift packages, which takes a minute.
2. Choose **iPhone 16e** as the destination and press **Run** (⌘R).
3. A simulator needs no signing team. A real iPhone needs your Apple Developer team under
   App → Signing & Capabilities.

**Android:**
1. Run `npm run android`. Android Studio opens `android/`. The first Gradle sync downloads
   the Android Gradle plugin and SDK 36, which takes a few minutes.
2. Choose **Pixel 10 Pro** and press **Run**.

**After pulling new commits:** run `npm install && npm run sync` again before building.

## Notifications and app links (Phase 2)

1. **Get the code:**
   ```
   cd ~/Ledger && git checkout main && git pull
   cd native && npm install && npm run sync
   ```
2. **Copy in the two Firebase files.** They are configuration, not secrets, and are kept
   out of git.
   - `GoogleService-Info.plist` → `native/ios/App/App/`
   - `google-services.json` → `native/android/app/`

   Both come from Firebase Console → Project settings → Your apps. The iOS build stops
   with a message if the plist is missing.
3. **iOS:** run `npm run ios`.
   - In Xcode → App → Signing & Capabilities, **Push Notifications**, **Associated
     Domains** and **App Groups** come from the entitlements file. With automatic
     signing on, Xcode registers them.
   - Run it on the iPhone.
4. **Android:** run `npm run android`, then Run.
5. **In the app:** Settings → Notifications → **Enable notifications**, then allow them.
   - Send yourself a test: a Pin now, or a Home request from Abi.
   - A tap opens it in Ledger.
   - If the Home Screen web app on the same phone also has notifications on, turn them
     off there.
6. **Links:** tap a `https://ledger.sgj.luxe/?home=…` link in Notes or Messages, and the
   app opens it.
   - iOS fetches the site's association file when the app is installed, so reinstall
     after the site has it.
   - On Android: Settings → Apps → Ledger → Open by default.

**Switching the apps' notifications off for everyone:** in Firestore, set
`ledger_config/push` → `nativeEnabled: false`. Web Push carries on.

## Getting the app to other phones

Abi's and Maria's phones get release builds:
- **iPhone:** through **TestFlight** (external testers);
- **Android:** through **Firebase App Distribution**.

Both update themselves when you send a new build. Website changes still reach every
phone without a new build; you only send one when something in `native/` changes.

**Every time, first:** `cd ~/Ledger/native && git pull && npm install && npm run bump &&
npm run sync`. `bump` raises the build number, which the stores require to go up each
time. Commit that change.

### Android: Firebase App Distribution

**Once: the upload key.** Keep it outside the Ledger folder and back it up; if you lose
it, the app can't be updated in place.
1. Create it:
   ```
   mkdir -p ~/ledger-keys && cd ~/ledger-keys
   keytool -genkeypair -v -keystore ledger-upload.jks -alias ledger -keyalg RSA -keysize 2048 -validity 10000
   ```
   It asks for a password and your name. Remember the password. If `keytool` isn't
   found, use `"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"`.
2. Create `native/android/keystore.properties`. Git ignores it.
   ```
   storeFile=/Users/shaunjohnson/ledger-keys/ledger-upload.jks
   storePassword=YOUR_PASSWORD
   keyAlias=ledger
   keyPassword=YOUR_PASSWORD
   ```
3. Get its fingerprint:
   `keytool -list -v -keystore ~/ledger-keys/ledger-upload.jks -alias ledger | grep SHA256`.
   - Send it to Claude for `assetlinks.json`, so links open the app on their phones.
   - Add it in Firebase Console → Project settings → Ledger Android → **Add fingerprint**.

**Each build:**
1. `npm run android`.
2. In Android Studio: **Build → Generate Signed App Bundle or APK → APK** → your
   key → **release** → Create. The APK lands in `native/android/app/release/`.
3. In Firebase Console → **App Distribution** (under Run / Release & Monitor), choose
   **Ledger Android**:
   - drag the APK in;
   - add testers by email (Maria, Abi) or a group;
   - Distribute.
4. **On their phone, first time:**
   - they open the email → **Get started** → install the **App Tester** app;
   - allow it to install apps → install Ledger → sign in as usual.

   After that, App Tester tells them when there's an update.

### iPhone: TestFlight

**Once: the App Store Connect record.**
1. Go to appstoreconnect.apple.com → **Apps** → **+** → **New App**:
   - **Platform:** iOS;
   - **Name:** must be unique on the App Store, so "Ledger" is likely taken. Try e.g.
     **"Ledger SGJ"**. What the phone shows under the icon stays "Ledger";
   - **Primary language:** English (UK);
   - **Bundle ID:** `luxe.sgj.ledger`;
   - **SKU:** `ledger`;
   - **User access:** Full.
2. **TestFlight** tab → **Test Information**:
   - **Beta app description:** e.g. "Ledger, our household planner";
   - **Feedback email:** yours;
   - **Privacy Policy URL:** `https://ledger.sgj.luxe/privacy.html`.
3. **TestFlight** tab → **External Testing** → **+** → a group, e.g. "Family".

**Each build:**
1. `npm run ios`.
2. In Xcode, top bar: scheme **App**, device **Any iOS Device (arm64)**.
3. **Product → Archive**. When it finishes, the Organizer opens: **Distribute App** →
   **App Store Connect** → **Distribute**. It uploads; keep the defaults.
4. After 10–30 minutes the build appears in App Store Connect → TestFlight, once Apple
   has processed it.
   - Add it to the **Family** group, and add testers by email.
   - The first build goes to Apple's **beta review**, usually within a day. Later builds
     are usually instant.
5. **On their iPhone:** they open the invite email → install **TestFlight** from the
   App Store → **Accept** → **Install** → sign in as usual.

**TestFlight builds expire after 90 days.** Upload a new one, even unchanged (`npm run
bump` first), before then.

### After installing, on each phone
They sign in, then Settings → Notifications → **Enable notifications**.

## Which Ledger the app loads

- **By default: production,** `https://ledger.sgj.luxe/`. Every Vercel deploy reaches
  the app the next time it opens; there is no app release for web changes.
- **For testing another build,** set `LEDGER_APP_URL` when syncing, then build again in
  Xcode or Android Studio:

  ```
  LEDGER_APP_URL=https://<a Vercel preview>.vercel.app npm run sync
  LEDGER_APP_URL=http://localhost:8000 npm run sync      # iOS simulator, web served from the Mac
  LEDGER_APP_URL=http://10.0.2.2:8000 npm run sync       # Android emulator, the same server
  npm run sync                                            # back to production
  ```

  - Plain `http` is accepted only for a local server.
  - Signing in from a preview or local address depends on the Firebase API key's website
    restrictions. If sign-in says the address isn't allowed, test against production
    instead.

## What is native, and what is the web's

- **Native:**
  - the icon and splash (`#0e0b08` ground);
  - edge to edge, with correct `env(safe-area-inset-*)` on Android (Capacitor
    SystemBars);
  - the keyboard resizing the web view;
  - the camera permission for progress photos;
  - no device backups of the app's data (Android);
  - the offline page.
- **The web page** (`index.html`, guarded by `window.Capacitor`, inert on the web):
  - the status bar's text follows Ledger's theme;
  - Android back closes the open sheet as its × would, and otherwise sends Ledger to the
    background;
  - no web service worker or Web Push in the app — Settings → Notifications says
    notifications come to the app later;
  - the Build sheet names the app's version.
- **Not in Phase 1:** native notifications and Universal / App Links (Phase 2,
  above), widgets (Phase 3), store submission.

## The Today widget (iOS)

The widget shows today's Actions in Ledger's Flow order. Ledger's page builds the list
and hands it to the app (the `LedgerWidget` plugin), which shares it with the widget
through the App Group `group.luxe.sgj.ledger`.

**In Xcode:**
- **Signing:** App → Signing & Capabilities: choose your Team for **both** the `App` and
  `LedgerWidget` targets. App Groups need a paid Apple Developer team on a real
  iPhone; the simulator works without one.
- **Running it:** run the `App` scheme, then add the widget: long-press the Home
  Screen → Edit → Add Widget → Ledger.
- **Previews:** `LedgerWidget/TodayWidget.swift` has previews for both sizes (Editor →
  Canvas).

The page must include the widget's web side (in `main`, or a preview via
`LEDGER_APP_URL`) for the widget to fill.

## Tests

- `tests/e2e/native-shell.test.js`: the page's native hooks, with a stand-in bridge, and
  the web untouched.
- The offline page and the web's appearance are checked by Playwright in development.
- On real simulators and devices, the checklist is in `docs/NATIVE_MIGRATION.md` §12.
