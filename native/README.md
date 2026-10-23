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
git checkout feature/native-apps
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
- **Not in Phase 1:** native notifications, widgets, Universal / App Links, store
  submission.

## Tests

- `tests/e2e/native-shell.test.js`: the page's native hooks, with a stand-in bridge, and
  the web untouched.
- The offline page and the web's appearance are checked by Playwright in development.
- On real simulators and devices, the checklist is in `docs/NATIVE_MIGRATION.md` §12.
