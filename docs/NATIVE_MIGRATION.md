# Ledger — native iOS and Android apps: architecture and migration audit

Status: audit 2026-10-23. **Phase 1 (the native shell) built on `feature/native-apps`,
2026-10-23. It is not merged; see §12a.** Shaun approved:
- Capacitor;
- `native/` in this repository;
- the app id `luxe.sgj.ledger`;
- loading `https://ledger.sgj.luxe` (option A).

Every other decision marked **Shaun** still needs his answer before its phase starts.
Scope: installable iOS and Android apps with native home-screen widgets and
notifications. The web app at `ledger.sgj.luxe` stays the product, and stays operational
throughout.

---

## 1. What Ledger is today (from the code, not the ledger)

| Area | What the repository actually does |
| --- | --- |
| **Shape** | One file, `index.html`, about **25,400 lines** (one inline script of about 20,000 lines in a single function scope). No build step, no modules, no framework. ES5-style JS. `PROJECT_LEDGER.md` and `CLAUDE.md` still say about 10,500 — out of date. |
| **Firebase** | The compat SDK 10.12.2 is loaded from `gstatic.com` (app, auth, firestore). The web config is inline (`firebaseConfig`), and is public by design. |
| **Identity** | Firebase Auth: email and password, and email-link sign-in with `handleCodeInApp`, returning to `ledger.sgj.luxe` (`authContinueUrl`). There is also a "paste the link" form (`#authLink`). A role comes from `ledger_users/{uid}` (owner / partner / household), which no client writes. Private listeners start only after `role === 'owner'` (`handleAuthState` → `startOwnerData`). |
| **Persistence** | Firestore `onSnapshot` listeners on whole collections (`ledger_commitments`, `ledger_plans`, `ledger_sessions`, …). The Firestore cache is **in memory only** (no `enablePersistence`). |
| **Offline** | A `localStorage` copy per collection (`ledger_*_fallback`). It is written by local saves, not mirrored from every snapshot. `fallbackMode()` uses it only for the confirmed owner, or a local build. Edits made in fallback mode stay local: there is no reconciliation when the connection returns. |
| **Service worker** | `sw.js` caches **nothing** (fetch passes straight through). It exists for "Install app" and Web Push. So a cold start with no connection fails on the web today. |
| **Push** | Web Push with VAPID. A device record is `ledger_push_subscriptions/{uid}_{hash(endpoint)}` (rules: `subShape` requires an https `endpoint` and `keys`). The server sends with `web-push` from `functions/push.js` (`sendPushToUser`), which is the one engine. A notification tap → `ledger-open` message → `openLedgerLink(url)`. |
| **Deep links** | Query strings on the root: `?openAction=`, `?request=`, `?view=`, `?sprint=`, `?home=`. **`openLedgerLink(url)` is the single in-app router**, used at load and on notification taps. |
| **Domain side effects** | Completing an Action (`toggleCommitmentQuickStatus`) does several things beyond setting `status: 'completed'`: <ul><li>normalises `execState`;</li><li>writes the private timeline (`ledger_action_updates`, deterministic ids);</li><li>clears pins;</li><li>clears Current Focus if it was that Action;</li><li>logs the Matter or Conversation, and **opens "What happens next?"** for conversation-linked Actions.</li></ul>A linked Home request follows later by reconciliation (`reconcileHome`, when Shaun's app is open). |
| **Hosting** | Vercel serves the repo root as static files (`outputDirectory: "."`). GitHub Pages is legacy. Production origin: `ledger.sgj.luxe`. |
| **Layout** | Already safe-area aware (`viewport-fit=cover`, 20 uses of `env(safe-area-inset-*)`). It works as an iOS home-screen PWA today. |

Consequences for native:
- Every UI feature already runs in a WebView. Rewriting the UI would be the expensive,
  risky part, and nothing requires it.
- Widgets cannot run this JavaScript. They need a small, explicit data contract.
- Completing something from a widget is not just a field write. Only Actions with no
  app-only follow-up can be completed in place.

## 2. Recommendation: Capacitor, with native code only where the platform demands it

**Capacitor** wraps the existing app in a native shell: WKWebView on iOS, Android System
WebView on Android. The JavaScript calls native code through plugins, and native targets
(widgets, notification extensions) live in the same Xcode and Gradle projects.

### Capacitor compared with React Native

| | Capacitor | React Native (or Flutter) |
| --- | --- | --- |
| Existing 25k-line UI | Runs as is | **Rewritten** — the "rebuild" the brief rules out |
| Web / desktop app | The same code | A second UI codebase to keep in step forever |
| Business logic | One copy (the web app's) | Two copies (web and RN), or a large extraction first |
| Widgets | Native Swift (WidgetKit) / Kotlin (Glance) | **Also native Swift / Kotlin** — RN cannot render widgets |
| Push | Plugin over FCM / APNs | Native modules over FCM / APNs (same) |
| Firebase in native code | Native SDKs, through plugins | `react-native-firebase` (excellent) |
| Feel | WebView scrolling, gestures and keyboard. Good on modern devices; needs care (below) | Native views and transitions |
| Time to a first installable app | Days | Months |

**Why Capacitor:** the widgets, App Intents and notification extensions have to be
native in either approach. React Native's advantage — native views — only buys a nicer
UI, and it costs the whole UI plus a permanent second codebase. Capacitor keeps one
product, one data model and one release of the business logic.

**Capacitor's material limitations, and how Ledger handles them:**
- **WebView feel.** Scroll physics, the keyboard pushing content, overscroll bounce,
  and text selection on long press. Handle with:
  - the Keyboard plugin (resize mode);
  - turning off WebView bounce where it fights the sheets;
  - `-webkit-touch-callout: none` on controls;
  - the existing drag handles (they use pointer events and work in WKWebView).
- **No native navigation transitions.** These are not needed: the five-tab navigation is
  already in-page (`goView`) and adds no history.
- **Android back button.** It has no meaning in the web app (tabs add no history). In
  the shell it must close the open sheet first, then leave the app. That is a small
  native-only handler.
- **Web APIs that differ inside a WebView:**
  - Web Push and service workers are not available in WKWebView (without App-Bound
    Domains);
  - `window.open`, `navigator.share`, and file or camera inputs need checking;
  - each gets a plugin or a guarded path.
- **Memory.** A WebView app is heavier. Ledger's unbounded collection listeners
  (`ledger_commitments`, `ledger_plans`) grow with time. This is not a blocker, but it is
  a known cost (§9).

### Where the web code comes from: production URL or bundled copy (**Shaun**)

| | **A. Load production** (`server.url = https://ledger.sgj.luxe`) — recommended to start | B. Bundle a copy of the web files in each build |
| --- | --- | --- |
| Updates | Every Vercel deploy reaches the app at once. One pipeline, as today | A new native build (TestFlight / Play) for every web change, or a live-update service |
| Origin | `https://ledger.sgj.luxe`. Auth's authorised domains, the API key's website restrictions, `LEDGER_HOME`, emailed links and deep links all work unchanged | `capacitor://localhost` (iOS), `https://localhost` (Android). Authorised domains and the browser key's referrer restrictions must change, and email links need rethinking |
| Offline cold start | Fails, as the web does today. A bundled offline page is shown instead (`server.errorPath`) | Works (the shell is local); data still needs the network or a cache |
| Store review | A thin wrapper of a website is what App Review rejects (guideline 4.2). Widgets, native push and App Intents count against that, and **internal TestFlight is not reviewed** | Same considerations |
| Security | The native bridge is exposed to whatever `ledger.sgj.luxe` serves. Navigation is limited to that host; it carries the same trust as the web app | The bridge is exposed only to bundled code |

**Recommendation:**
- **Start with A.** It keeps Ledger's deploy model, origin and security model intact, and
  needs no change to Firebase or the web app to get running.
- **Revisit B at the Phase 5 gate** only if offline cold start or App Store review
  requires it.
- **A real offline shell is still possible later under A:** WKWebView supports service
  workers for App-Bound Domains (`WKAppBoundDomains` = `ledger.sgj.luxe`), so `sw.js`
  could gain caching.

## 3. Feature by feature

**Preserved unchanged** (runs in the WebView as it is):
- all five tabs and their content: Plan, Today, Me (Calendar / Progress / Focus), Comms,
  Home;
- the sheets and the inspector;
- Firestore data, rules, roles and listeners;
- Partner Sharing (Abi's portal), Home for Abi and the nanny;
- recurring responsibilities, checklists, Quick capture, Day Notes, Life Context, Reset
  Sprint and Current Focus;
- light and dark themes;
- the wider-screen layouts (iPad / tablet).

**Needs adaptation** (a guarded `isNative()` path in `index.html`; the web path is
untouched):

| Feature | Adaptation |
| --- | --- |
| Turning notifications on | The native plugin instead of `PushManager`. The "install to Home Screen first" (iOS Safari) state disappears |
| Notification tap | Plugin event → `openLedgerLink(url)` (the same router) |
| Deep links from outside | `appUrlOpen` (Universal / App Links, `ledger://`) → `openLedgerLink(url)` |
| Email-link sign-in | Password sign-in works as is. A link opens Safari, not the app, until Universal Links exist; the existing "paste the link" form covers that gap |
| Android back | Close the sheet → close the inspector → leave the app |
| Status bar, splash, keyboard | StatusBar (theme-aware), SplashScreen, Keyboard plugins |
| Share (`navigator.share`), files and camera inputs, `window.open` | Check each in both WebViews; the Share and Browser plugins where needed |
| PWA install prompts, "Live: Up to date" | Hidden in the app; the footer shows the app version beside the web build |
| `deviceKind()` labels for devices | "Shaun · iPhone (app)" — so a phone with both the PWA and the app is not ambiguous |

**Native-only** (Swift / Kotlin, no WebView):
- home-screen widgets (iOS WidgetKit, Android Glance);
- interactive widget actions (App Intents / Glance actions);
- shared storage between the app and its widgets (App Group / app storage);
- notification channels (Android), categories and actions (iOS / Android);
- badge counts;
- Universal Links and App Links;
- later: a notification service extension, and Live Activities (Current Focus is a
  natural one — not in scope).

## 4. Widgets

### 4.1 One data contract: the widget snapshot

Widgets never contain Ledger's logic. They show a **snapshot**: a small, versioned JSON
document holding exactly what a widget draws.

```
WidgetSnapshot v1
  v: 1, uid, role ("owner" | "partner" | "household"), generatedAt (ISO), source ("app" | "server")
  today:   date, actions: [ id, title, category, time | null, done, inlineComplete ], counts: open / done
  home:    forMe: [ id, text, due, from, inlineComplete ], overdue: n
  focus:   title | null            (owner only)
  links:   per item, the deep link (?openAction=… / ?home=…)
```

- **Built by the web app's own code** — the same "what is today, in what order" logic
  that renders Today and Home (`plan.actionOrder`, `hrForToday`, …). It is a pure
  function `buildWidgetSnapshot(state)`.
- **`inlineComplete` is decided by the app.** It is false for:
  - an Action linked to a Conversation (it needs "What happens next?");
  - the Current Focus;
  - anything with a checklist left.

  The widget doesn't guess.
- **Privacy:**
  - only titles and counts, never notes, Life Context, Day Notes, Comms content or health
    data;
  - a partner or household snapshot contains only what their app already shows them;
  - widgets mark titles `privacySensitive` (redacted on a locked screen when the user
    chooses);
  - signing out clears the snapshot and reloads widgets to a signed-out state.
- **The JSON schema and fixtures live in one place.** The JS builder, Swift decoder and
  Kotlin decoder are all tested against the same fixtures.

### 4.2 How the snapshot reaches the widget, by phase

1. **The app publishes it (Phase 3).**
   - Whenever the data it depends on changes, the WebView calls a small local plugin:
     `LedgerBridge.publishSnapshot(json)`.
   - It writes to the App Group container (iOS) or app storage (Android), then calls
     `WidgetCenter.reloadAllTimelines()` (iOS) or `GlanceAppWidget.updateAll()` (Android).
   - Fresh whenever Ledger has run recently. No credentials leave the WebView.
2. **The widget refreshes itself (Phase 4).** Needed for "live without Ledger open":
   - Both platforms sign in natively too: the native Firebase Auth SDK, sharing the
     session with the widget extension through a Keychain access group on iOS (Firebase
     supports this; §7).
   - The refresh fetches today's data with the user's own ID token, **so the Firestore
     rules still decide what it may read**.
   - Two options for what it fetches (**decide at the Phase 4 spike**):
     - (a) Firestore REST queries from Swift / Kotlin, plus a small, fixture-tested port
       of the ordering;
     - (b) an HTTPS function that returns the snapshot, built server-side by the same JS
       builder, extracted into a shared module.

     (b) keeps one copy of the logic; (a) needs no new server code.
   - When it runs:
     - **iOS:** timeline refresh (about every 15–30 minutes, within WidgetKit's daily
       budget); a reload when the app writes; and, from iOS 26, **WidgetKit push
       updates** over APNs (to verify in the spike — they are also budgeted);
     - **Android:** a WorkManager periodic job (15-minute minimum), and an FCM data
       message that triggers an update.

### 4.3 Interactive actions: completing from the widget (Phase 5)

- **iOS:**
  - iOS 17+ `Button(intent:)` with an App Intent that runs in the widget extension;
  - it updates the snapshot at once (optimistic), then writes;
  - the write uses the user's ID token against Firestore — the **same fields and the
    same rules** as the app:
    - `status: 'completed'`, `execState: 'done'` (an update mask, so sibling fields are
      untouched);
    - plus the Action timeline entry under a deterministic id;
  - if offline, the intent is queued in the App Group and retried by the widget's next
    refresh or by the app on launch;
  - completing twice is a no-op;
  - a deleted Action fails the precondition and simply disappears.
- **Android:** a Glance `ActionCallback` (runs in the app process; the full native
  Firebase SDK is available), the same writes, and WorkManager for retries.
- **Home requests** (Abi, the nanny, Shaun as assignee):
  - mark done through the same rules branch the web uses (status plus the history entry
    with the server's time — a REST commit with a server timestamp transform);
  - Undo follows the web: on the widget, a short "Done · Undo" state before it is
    written.
- **Anything with `inlineComplete: false`** opens the app at that item
  (`?openAction=…`), where the full flow runs.
- **Pins and Current Focus clean-up** stay app-side. They are why such items aren't
  inline.
- **A linked Home request** follows by the existing reconciliation the next time
  Shaun's app runs. If that delay is not acceptable, those Actions are `inlineComplete:
  false` too (**Shaun**).

### 4.4 Background limits (what can't be promised)

- **iOS:**
  - no general background execution;
  - `BGAppRefreshTask` is opportunistic;
  - widget reloads are budgeted (roughly tens per day for a widget that is looked at
    often);
  - silent pushes are throttled and are **not delivered after the user force-quits the
    app**;
  - a notification service extension runs reliably for visible pushes (about 30
    seconds), so it could refresh the snapshot when a Ledger notification arrives;
  - "live" means "minutes old", not real time.
- **Android:**
  - Doze and App Standby;
  - WorkManager's minimum period is 15 minutes, and `updatePeriodMillis` 30 minutes;
  - high-priority FCM data messages may be deprioritised if they don't show a
    notification;
  - exact alarms are restricted (Android 14+);
  - some makers (Samsung) kill background work harder.
- **Design consequence:** every widget shows "Updated 12:40" quietly, and treats tapping
  as the way to be exactly current.

## 5. Native push

- **Transport:**
  - **FCM for both platforms** (Android natively; iOS through FCM's APNs bridge), via the
    Capacitor Firebase Messaging plugin;
  - one server API (`admin.messaging()`), so iOS and Android stay aligned.
- **Device records:** an **additive** shape in `ledger_push_subscriptions`:
  - `transport: 'fcm'`, `fcmToken`, `platform`, `deviceId`, `appVersion`, plus the
    existing `userUid` / timestamps;
  - the rules gain a second shape branch (`fcmShape`); existing Web Push records and
    rules are unchanged;
  - the same ownership: a user writes only their own device, and the server finds a
    user's devices — never a recipient named by a client.
- **Server:** `sendPushToUser` picks the sender per record (`web-push` for web, FCM for
  native).
  - Handlers, preferences, event de-duplication and recipients are untouched.
  - A stale FCM token is deleted like an expired endpoint.
- **Payload:** the same title, body, URL and tag. The URL stays the query-string deep
  link, and a tap goes to `openLedgerLink`. Android notification channels, by kind:
  - Current Focus;
  - Home;
  - Partner.
- **Double notifications:** a phone with both the Safari PWA and the app subscribed gets
  both. The app turns on with a prompt to switch off the PWA's notifications (or
  removes that phone's web record when the user agrees). Each record is already
  per-device.
- **Rollback:** a flag in `ledger_config/push` (`nativeEnabled`). Removing the `fcm`
  records returns everyone to Web Push.

## 6. Deep links

- **Inside the app:** `openLedgerLink(url)` already routes every Ledger link. Native
  entry points call it.
- **From outside:**
  - **Universal Links (iOS) and App Links (Android)** on `ledger.sgj.luxe`, so the same
    `https://ledger.sgj.luxe/?home=…` opens the app when installed, and the web when not;
  - Universal Links need `/.well-known/apple-app-site-association` (served as JSON, no
    extension) and `/.well-known/assetlinks.json`. On Vercel that means a `headers`
    entry in `vercel.json` (**Shaun**: `CLAUDE.md` says to keep `vercel.json` minimal;
    headers are not routes or rewrites);
  - the AASA matches the root with the query keys Ledger uses.
- **Widget taps:** `widgetURL` / `Link` with the same URLs, or a `ledger://` custom
  scheme that carries the same query string.
- **Email-link sign-in in the app:** works once Universal Links cover the continue URL.
  Firebase Dynamic Links are gone (shut down August 2025), so this is the route.
  Until then: password, or paste the link.

## 7. Authentication and credentials

- **In the WebView** (option A): the Firebase JS Auth session is exactly as today. Its
  refresh token is in the WebView's own storage, inside the app sandbox, separate from
  Safari.
- **Native code** (widgets, App Intents, background refresh) needs its own signed-in
  Firebase user from Phase 4. It uses the Capacitor Firebase Authentication plugin:
  - **sign-in happens once, natively first, then in the WebView** with the same
    credential;
  - the password is passed in-process and never stored by Ledger;
  - each SDK keeps only its own refresh token: iOS Keychain (shared with the widget
    extension by a Keychain access group; Firebase's documented "share auth across app
    and extensions"), Android's private storage;
  - **sign-out signs out both, clears the snapshot and the queued intents, and reloads
    widgets.**
- **No secrets in the apps:**
  - `GoogleService-Info.plist` and `google-services.json` are configuration, like the web
    config already in `index.html`;
  - the API keys are restricted per platform (bundle ID; package plus certificate
    SHA-1);
  - the APNs key lives in the Firebase Console only;
  - the Android signing key never enters the repo.
- **Roles stay server-granted** (`ledger_users`). The apps add no role logic. A partner's
  or nanny's app reads only what the rules already let them.

## 8. Offline and consistency

- **Today** (web):
  - in-memory Firestore cache while the page is open;
  - `localStorage` copies for the owner if the cloud is unreachable;
  - edits made then are not merged back;
  - no offline cold start.
- **In the app (A):** unchanged at first (parity), plus a bundled offline page. Two
  improvements, each a separate, reviewable step (**Shaun**):
  1. **Firestore persistent cache** (IndexedDB in the WebView), owner-only after the role
     check:
     - it gives real offline reads, and queued writes that survive a restart;
     - the condition is to `terminate()` and `clearPersistence()` on sign-out, keeping
       the rule that private data never outlives the session.
  2. **An App-Bound-Domains service worker** that caches the shell, for offline cold
     start.
- **Widget writes** are idempotent and minimal (field masks, deterministic event ids).
- **Known existing risk, not introduced here:** the web app saves an Action as a whole
  document from its in-memory copy. A device holding a stale copy can overwrite a change
  made elsewhere (a widget tick included) in the short window before its listener
  updates. This already exists between phone and Mac. Field-level saves would remove it;
  that is a separate piece of work.

## 9. Does Ledger need modularising first?

**No big-bang modularisation.** Capacitor runs the file as it is. Three targeted seams,
each small and guarded:

1. **A platform adapter** inside `index.html`: `isNative()`, plus push, open-link,
   share, back-button and status-bar hooks. With no `window.Capacitor` it is a no-op on
   the web.
2. **`buildWidgetSnapshot(state)`**, a pure function written once in JS (Phase 3).
   Extracted into a separate shared ES5 script (like `buildInfo.js`) only if Phase 4
   chooses the server-built snapshot — then the web, Cloud Functions and tests share one
   copy.
3. **One completion path** in JS that the app, the snapshot's `inlineComplete` and the
   widget's write all describe the same way, documented with the fixture tests.

Not needed for native, and kept out: splitting the 20,000-line script, a bundler,
TypeScript or a framework. Two performance items are worth a later look on phones:
- the unbounded collection listeners;
- the first render of all of `ledger_commitments`.

## 10. Proposed structure

```
native/                          new; nothing at the root changes
  package.json                   Capacitor and plugins only (the web app keeps no package.json)
  capacitor.config.json          appId, server.url (production or a preview), allowNavigation, errorPath
  www/offline.html               the bundled "you're offline" page
  ios/App/                       Xcode project (App target)
  ios/LedgerWidget/              WidgetKit extension (SwiftUI, App Intents)
  ios/Shared/                    Snapshot model and decoder, shared by app and widget
  android/app/                   Gradle app module
  android/widget/                Glance widget module (Kotlin)
  plugins/ledger-bridge/         local Capacitor plugin: publishSnapshot, clearSnapshot, intents queue
shared/
  widget-snapshot.schema.json    the contract
  fixtures/                      snapshots used by JS, Swift and Kotlin tests
docs/NATIVE_MIGRATION.md         this file
.vercelignore                    keeps native/ and shared/fixtures off the website
```

The same repository, so the web app and the native contract change together. `_config.yml`
also excludes `native/` (Pages).

## 11. Roadmap

Each phase ships on its own, behind `isNative()` or a flag, and leaves the web app as it
is.

| Phase | Delivers | Acceptance | Rollback |
| --- | --- | --- | --- |
| **1. Native shell** | Capacitor iOS and Android apps loading production; signing in; the five tabs; safe areas; status bar; Android back; external links; offline page | §12 | Uninstall. The web is untouched (`native/` only) |
| **2. Native push and links** | FCM device records (rules: additive `fcmShape`), sender per transport, channels, tap → `openLedgerLink`, Universal / App Links, the `ledger://` scheme | Every existing push kind arrives on iPhone and Pixel and opens the right sheet; Web Push unchanged (push e2e green); rules tests for `fcmShape` | `nativeEnabled` off; delete `fcm` records; revert the rules branch |
| **3. Read-only widgets** | Snapshot contract; `buildWidgetSnapshot`; bridge plugin; iOS small/medium and Android widgets for Today and Home "For me"; tap → deep link | The snapshot matches the fixtures in JS, Swift and Kotlin; widgets show today within a second of the app writing; sign-out blanks them; no private field beyond titles | Remove the widget targets; the plugin call is a no-op |
| **4. Fresh without the app** | Native auth (shared Keychain), widget refresh (REST or the server-built snapshot), WorkManager, FCM / WidgetKit push-triggered reloads | With the app force-quit, a change made on the Mac shows on both widgets within the platform budget (measured and documented); a role change or removal blanks the widget | Refresh off → back to Phase 3 behaviour |
| **5. Interactive widgets** | Complete an Action / mark a Home request done from the widget; offline queue; Undo state | Same fields and history as the app (compared doc by doc against the emulator); double tap is a no-op; offline → queued → applied once; `inlineComplete: false` opens the app | Hide the buttons (flag); queued intents drain through the app |
| **6. Offline and polish** (separate decisions) | Firestore persistent cache with clear-on-sign-out; App-Bound-Domains service worker; notification actions; Live Activity for Current Focus | Each its own acceptance | Each its own flag |
| **Gate after 5** | Decide on bundled web assets (B) / store submission | — | — |

**Testing, throughout:**
- **Stays green:** the existing suites (rules, functions, Home / Partner / push e2e)
  stay green on every phase — the web is the regression surface.
- **New:**
  - fixture tests for the snapshot (JS with Node, Swift with XCTest, Kotlin with JUnit);
  - rules tests for every rules change;
  - emulator tests for widget writes (Firestore REST against the emulator);
  - UI tests on iPhone 16e and Pixel 10 Pro (XCUITest, Espresso / Compose tests) for
    sign-in, the tabs, back and deep links;
  - push on a real iPhone (simulators receive pushes, but not reliably for background
    and extension cases).
- **Each phase** finishes with the UX playbook's review on both platforms, in light and
  dark.

## 12. The first milestone (Phase 1: the native shell)

**Builds:**
- `native/` with Capacitor, for iOS and Android;
- `server.url` = production, `allowNavigation` = `ledger.sgj.luxe` only;
- a bundled offline page;
- app icon and splash from the existing icons;
- StatusBar following the theme; the Keyboard plugin;
- Android back: sheet → inspector → leave;
- `window.open` and `mailto:` go to the system browser or mail;
- `.vercelignore` and the Pages exclude for `native/`.

The `index.html` changes are limited to a guarded `isNative()` adapter (back button,
status bar, hiding install prompts). The web path is unchanged, and checked by the
existing suites plus the 390px screenshot diff.

**Acceptance:**
1. **Builds and launches** on the iPhone 16e simulator and the Pixel 10 Pro emulator,
   with no console errors.
2. **Sign-in:** Shaun signs in with a password and gets his Ledger. Abi gets her portal;
   the nanny gets Home. A signed-out launch shows the sign-in screen, never cached
   private data.
3. **Everyday use works:** all five tabs, the Me switch and the main sheets (an Action,
   Home request, Quick capture, Settings). Ticking an Action and adding a Home request
   save and show on the web at once.
4. **Fits the device:**
   - safe areas correct, with no content under the notch or the home indicator;
   - no horizontal scroll at the device width;
   - the keyboard doesn't hide the field being typed in.
5. **Android back** closes the sheet, then leaves. No history is added by tabs.
6. **Offline:** launching with no connection shows the offline page. Coming back online
   and tapping retry loads Ledger.
7. **The web app is unchanged:** all suites green, and no difference in the 390px
   screenshots.

**Not in Phase 1:** push, widgets, Universal Links, store submission.

## 12a. Phase 1 as built (`feature/native-apps`, 2026-10-23)

**What exists** (`native/README.md` has the run steps):
- **Capacitor 8.5.3:** iOS (Swift Package Manager) and Android projects, app id
  `luxe.sgj.ledger`, `server.url` = production. `LEDGER_APP_URL` points a local build
  elsewhere, for testing only.
- **Plugins:** App, Keyboard, SplashScreen, plus the core **SystemBars**.
  - The audit's StatusBar plugin is replaced by SystemBars, Capacitor 8's edge-to-edge
    API.
  - The audit's Browser plugin is dropped: Capacitor already hands every off-site link
    and `window.open` to the system (Safari / the default browser / the site's app).
- **Icons and splash** come from `icon-512.png` (`native/scripts/make-assets.py`). The
  black corners are filled, the Android adaptive icon has its mark inside the safe zone,
  and the splash is Ledger's dark ground with the mark.
- **Safe areas:**
  - **iOS:** `contentInset: never`, so the page's own `viewport-fit=cover` and `env()`
    padding apply, as in the PWA;
  - **Android:** edge to edge (`EdgeToEdge.enable`), and SystemBars `insetsHandling:
    css` keeps `env(safe-area-inset-*)` right.
- **Keyboard:** `resize: native` (the web view shrinks above it). On Android,
  SystemBars handles the keyboard's inset; `resizeOnFullScreen` was removed on
  2026-10-24, because Capacitor warns it conflicts with SystemBars.
- **Android window ground:** `windowBackground` is Ledger's `#0e0b08`. The first
  emulator run showed a white strip under the status bar — the theme's default
  background showing where Android kept space for the bar.
- **Android themes (2026-10-24):** no theme has a title bar or action bar. The launch
  theme no longer sets a theme-wide `android:background` (Capacitor's template set it to
  the splash image). Every view inherits that attribute, and on the emulator it drew a
  "Ledger" title bar with the splash smeared across it, under the status bar. WebView
  145 was confirmed in `chrome://inspect`, and the page's own insets were correct
  (`--safe-area-inset-top: 52px`).
  - **The real cause:** the bar was still there, plain, after that change.
    `EdgeToEdge.enable` ran *before* `super.onCreate`, which built the window under the
    launch theme — and Android's own action bar came with it. It now runs after
    Capacitor's set-up, and every theme states the framework's `android:windowNoTitle`
    and `android:windowActionBar` as well as AppCompat's.
- **Offline:** `server.errorPath` → the bundled `www/offline.html`, in both themes.
  "Try again" opens Ledger, and it reopens by itself when the connection returns.
- **Auth:**
  - unchanged: the page keeps its own origin, so sign-in, authorised domains and the API
    key's restrictions behave exactly as on the web;
  - `allowNavigation` lists only `ledger-6aec3.firebaseapp.com`, so Firebase's auth
    frame is never handed to the system browser;
  - email links still open in the browser (Universal Links are Phase 2); password and
    "paste the link" work in the app.
- **Privacy:** Android backups and device transfer exclude the app's data (the signed-in
  session and any offline copy stay on the phone). On iOS this is unchanged: the system
  includes app data in encrypted device backups.
- **Camera:** `NSCameraUsageDescription` (iOS) and the CAMERA permission (Android), for
  the progress-photo field's "Take photo".

**The page's side** (`index.html`, the "native apps" block). All of it is guarded by
`window.Capacitor`, and there is no behaviour change on the web — proven below:
- `NATIVE`, plus `nativeCall` through the injected bridge (`Capacitor.nativePromise`).
  A remote page has no `@capacitor/core`, so it uses the bridge's own calls.
- **The status bar** follows Ledger's theme (`applyTheme` → SystemBars).
- **Android back:**
  - an open sheet (`#ppBackdrop`, then `#sheetBackdrop`) is closed by its own × — the
    same as tapping it;
  - otherwise `App.minimizeApp`, Android's convention for an app's first screen;
  - tabs add no history, so back never steps through tabs.
- **Push:** `pushSupported()` is false in the app. The app never subscribes to Web Push
  (a web view may still expose `PushManager`). Settings → Notifications says
  notifications come to the app later.
- **No service worker registration** in the app, and any registered earlier is
  removed (2026-10-24). On the emulator, an offline launch showed Android's "Webpage
  not available" (`net::ERR_FAILED`), not the offline page. The web's pass-through
  worker, registered while the app ran `main`'s page, failed the navigation itself,
  so Capacitor never saw the error. **Until the merge,** the worker comes back with
  each launch of `main`'s page; clearing the app's storage removes it until then.
- The Claude link no longer shows a false "Couldn't open" when the system opened it.
- The Build sheet shows "Native app · iOS / Android version (build)".

**Deployment configuration:**
- `.vercelignore` (new) keeps `native/` off the public website.
- `_config.yml` excludes `native` from the legacy Pages build.
- `vercel.json` is unchanged.

**Verified here** (Linux, no simulators: Apple's tools don't run on Linux, and this
environment's network policy blocks Google's Android SDK downloads, so neither app was
compiled here):
- `tests/e2e/native-shell.test.js`: 27 checks, against the emulators, with a stand-in
  bridge:
  - Shaun on Android and iOS, Abi on Android, and a web session;
  - sign-in, the five tabs, a saved Action;
  - the status bar in both themes;
  - back closing the sheet, then the background;
  - no back listener on iOS;
  - no service worker;
  - the notifications copy;
  - the Build sheet;
  - the web untouched.
- The offline page: 13 checks, in both themes.
- Web unchanged: screenshots of every tab and Settings at 390px, both themes, are
  byte-identical to `main`.
- Regression suites: rules 553, functions 47 + 35 + 49, Home 183, Partner Sharing 209,
  Quick capture 24, push e2e 76.
- `cap sync` and `cap doctor`: Android configuration OK; "Xcode not installed" (expected
  here).

**Verified on Shaun's Mac (2026-10-24):**
- **Both apps build and run** (Xcode 26.3, iPhone 16e on iOS 26.3; Android Studio,
  Pixel 10 Pro with WebView 145).
- **Signed in, Today renders:** the hero runs under the notch and camera, and the tab bar
  sits above the home indicator.
- **Android needed three fixes** (§12a above), now right.
- **iPhone:** the first load was slow (a cold cache).

**Still to verify on the Mac:** everything in §12's acceptance list on the iPhone 16e
simulator and Pixel 10 Pro emulator. The first thing it proves is that both projects
compile.

**The web-side hooks ship with `index.html`.** The app loads production, so until this
branch is merged the app runs `main`'s page. Before the merge, the hooks can only be
tried against a preview or local build (`LEDGER_APP_URL`). Merging is Shaun's decision.
Without the hooks, in the app:
- Android back leaves the app;
- the status bar is always light text;
- Notifications shows the browser's "can't receive" note.

## 13. Risks and dependencies

| Risk | Mitigation |
| --- | --- |
| App Review (4.2) for a wrapped site | Internal TestFlight first. Native widgets, push and intents before any public submission |
| Firebase JS Auth inside WKWebView | Option A keeps the real origin, where it already works as a PWA. Verified in Phase 1 acceptance 2 |
| Widget freshness expectations | Show "Updated hh:mm"; measured budgets documented in Phase 4 |
| Two write paths (app, widget) diverging | One fixture-tested description of the completion write; widgets complete only `inlineComplete` items |
| Stale whole-document saves overwrite a widget tick | Already a phone/Mac risk. Field-level saves proposed separately |
| Duplicate notifications (PWA plus app) | Offer to turn the PWA off on that phone |
| Unbounded listeners and memory in a WebView | Measure in Phase 1; bound by date in a separate change if needed |
| iOS 26 widget push updates | Verify in the Phase 4 spike; timeline refresh works without them |
| Universal Links need `vercel.json` headers | Shaun's approval (Phase 2) |
| Abi's and the nanny's phones | Their OS versions decide minimums (iOS 17+ for interactive widgets; Android 8+, with Android 12+ for the best widgets) |

## 14. What Shaun needs to prepare

1. **Apple Developer Program** membership (needed for App Groups, push, TestFlight and
   on-device widgets), and the Team ID.
2. **The app identifier**, e.g. `luxe.sgj.ledger` (the same for iOS bundle ID and Android
   applicationId). It can't be changed after release.
3. **Firebase Console:** add an iOS app and an Android app to `ledger-6aec3`, and upload
   an **APNs authentication key (.p8)** under Cloud Messaging. Never in the repo.
4. **Google Cloud → Credentials:** check the browser API key's website restrictions
   (option A needs none changed). Native keys restricted by bundle ID / package and
   SHA-1.
5. **An Android upload keystore,** kept outside the repo, and its SHA-256 (for App Links).
   A Google Play Console account if Abi and the nanny install through Play internal
   testing (otherwise a direct APK).
6. **Distribution:** TestFlight (internal for Shaun; external for Abi and the nanny,
   which has a light review) and Play internal testing, or direct installs.
7. **Decisions:**
   - option A (production URL) for Phase 1;
   - `native/` in this repository;
   - `vercel.json` headers for Universal Links (Phase 2);
   - whether Home-linked Actions may complete from the widget (§4.3);
   - Firestore persistent cache (§8);
   - the phones and OS versions Abi and the nanny use.
8. **On the Mac:** CocoaPods is not needed (Capacitor uses Swift Package Manager). Node 20
   or newer, Xcode 26.3 command-line tools, Android Studio with SDK 35+ and an emulator
   (already running).
