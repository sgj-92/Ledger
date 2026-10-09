# Security and identity

How Ledger decides who can see what, and how to roll it out or change it.
The rules themselves are in `firestore.rules`; this is the runbook around them.

## The model

- **Identity is Firebase Authentication**: email and password first, with the
  emailed sign-in link kept as a backup (both are Firebase's Email/Password
  provider, so they are the same account). Signing in proves who someone is. It
  grants nothing on its own: anyone can create an account against this project,
  because the web config is public.
- **Authority is a role**, read from `ledger_users/{uid}`:

  ```
  ledger_users/{uid}
    role:        "owner" | "partner"
    displayName: string
    email:       string
    createdAt:   ISO date string
  ```

  No client can write this collection. Roles are granted in the Firebase Console
  (or with the Admin SDK). A signed-in user may read their own profile; the owner
  may read all of them.
- **Ledger is single-owner.** Every existing `ledger_*` collection is the owner's
  private data. The rules allow read and write only to a signed-in user whose
  profile role is `owner`. Records carry no per-record owner field. "Owner" is a
  role on this deployment, not a property stamped on each document. See
  "Ownership of existing records" below.
- **A partner gets nothing from private collections**, ever. Partner Sharing
  is a projection, not access: the owner publishes share-safe display data
  into three separate collections, and the partner reads only those. Sharing is
  never a filtered client-side view of private data. See "Partner Sharing"
  below.

### Collections

| Collection | Holds | Access |
| --- | --- | --- |
| `ledger_users` | roles | read own (owner reads all); no client writes |
| `ledger_commitments` | actions | owner |
| `ledger_plans` | day plans, Morning Prime, challenge logs | owner |
| `ledger_sessions` | training, weight, steps, nutrition, photos, symptoms | owner |
| `ledger_day_status` | day close / review | owner |
| `ledger_priorities`, `ledger_focus` | direction | owner |
| `ledger_meals` | meal ideas | owner |
| `ledger_meta` | preferences (`presets`), kept sprint items (`sprintKept`) | owner |
| `ledger_meta/currentFocus` | the Current Focus | owner; must name the owner who writes it |
| `ledger_sprints` | Reset Sprints | owner |
| `ledger_matters`, `ledger_conversations` | Communications | owner |
| `ledger_challenges` | challenges | owner |
| `ledger_push_subscriptions` | each user's devices for Web Push | the user's own only (owner and partner alike) |
| `ledger_notification_prefs` | each user's notification choices | the user's own only |
| `ledger_config/push` | the VAPID *public* key | read by owner and partner; no client writes |
| `ledger_pins` | Pin now requests | owner; a pin names its owner; only the sender updates it |
| `ledger_push_events` | the sender's log and de-duplication marks | no client access |
| `ledger_meta/sharing` | what each publication was chosen to include | owner |
| `ledger_share_members` | the owner–partner relationship | owner manages own; partner reads own |
| `ledger_shared_snapshots` | published day and week projections | owner writes own; partner reads own, while active |
| `ledger_shared_requests` | requests from the partner | partner creates/edits/withdraws own until processed, then may hide a withdrawn one or renew it once as a new request; owner moves them on; each keeps own read mark |
| `ledger_shared_request_updates` | a request's Updates (comments and lifecycle entries) | append-only; each side writes only as itself, see below |
| anything else | — | denied |

## The app's side

Startup is: Firebase → auth state → role → then one of:

- **Owner**: the private listeners start and Ledger opens.
- **Partner**: their membership is read. With an active one, the partner's
  Ledger opens: only what has been published to them, and their requests.
  Without one, a holding screen ("Shared Ledger access is being set up.", with
  their Account ID) or "Sharing is paused". No private listener or read is ever
  started, and the device's stored copy of Ledger is never loaded.
- **Signed in, no role**: "This account isn't set up for Ledger", showing the
  account ID to grant.
- **Signed out**: the sign-in screen.

An opaque gate covers the app from first paint until this is decided. Nothing
private is fetched or drawn before the owner is confirmed. Firestore errors
are never what hides private data.

**Offline.** Firebase Auth keeps the session on the device. The last role the
server confirmed is remembered for that account, under
`localStorage.ledger_auth_role`. So an owner who has opened Ledger online on
this device can open it offline. The remembered role only applies to the
account Firebase Auth already has signed in here. A device that has never
confirmed the owner stays closed offline. A server answer of "no role" or
"denied" clears the remembered role at once.

The localStorage copy of Ledger is only ever loaded for a local build, or for
the confirmed owner when the cloud cannot be reached. It is never loaded for a
signed-out or non-owner session. Signing out forgets the remembered role.

A build with no Firebase config (`apiKey: "YOUR_API_KEY"`, used for local
development and tests) has no accounts and runs on device storage, as before.

**Passwords.** The sign-in screen asks for email and password. "Set or reset
your password" emails a link to Firebase's own page for choosing one. That works
for an account that has only ever used email links: it gains a password and keeps
its Account ID, role and data. Signed in, Settings → Account → Password (and
Password at the foot of the partner's page) sets or changes it directly. If
Firebase wants a recent sign-in first, it offers the email instead. Passwords are
at least 8 characters and are never seen or stored by Ledger, only by Firebase.

**The daily email limit.** On the free (Spark) plan, Firebase sends only a few
sign-in *link* emails per project per day. This is why the link is now the backup,
not the main way in (2026-10-07: every device signing in again on the new address
used it up). When the limit is reached, the sign-in screen says so
(`auth/quota-exceeded`) and points to the password. Password emails are counted
separately, with a much larger allowance. Any other refusal shows its Firebase
code after the message, e.g. "Couldn't sign in · auth/internal-error".

**Email links on the installed app.** On iOS, an email link opens in Safari,
not the Home Screen app, and the two keep separate storage. The "Check your
email" screen therefore offers a field to paste the link. Press and hold the
link in Mail, choose Copy Link, and paste it into Ledger. Opening the link in
Safari also signs Safari in.

## Rollout (first time) — in this order

The rules must not go live before the owner profile exists, or Ledger loses
access to its own data.

1. **Firebase Console → Authentication → Sign-in method**: enable
   **Email/Password** and, inside it, **Email link (passwordless sign-in)**.
2. **Authentication → Settings → Authorized domains**: the production domain
   `ledger.sgj.luxe` (Vercel), plus `sgj-92.github.io` while the legacy copy
   lives. Emailed links (sign-in and password) return to production, or to the
   page's own address on production and localhost. From anywhere else (the
   legacy GitHub copy, a Vercel preview) they return to
   `https://ledger.sgj.luxe/`.
3. Open Ledger, enter your email, and finish sign-in from the link. Ledger
   shows "This account isn't set up for Ledger" with your **Account ID**. Copy
   it.
4. **Firestore → Start collection** `ledger_users`, with **Document ID** set to
   the Account ID. Add these fields: `role` (string) `owner`, `displayName`
   (string), `email` (string), `createdAt` (string, e.g. `2026-10-06`).
5. In Ledger, tap "I've done that — try again". Ledger opens with all your
   data. Sign in on your other devices the same way.
6. Only now **publish the rules**. Either paste `firestore.rules` into
   Firestore → **Rules** → **Publish** in the Console (keep a copy of the old
   rules; the Rules tab's history can restore them), or run
   `npx -y firebase-tools@latest deploy --only firestore:rules`. The project is
   already set in `.firebaserc`. Then reload Ledger on each device and check it
   still opens with everything there.
7. **Deploying the functions** needs the Blaze plan (on since 2026-10-07). The
   old owner-only Pin now function was never deployed (#20) and has been
   replaced by the push sender below; follow "Push notifications → Setting it
   up". Don't use `npm install -g`: on a Mac it fails with EACCES.

**Status:** rolled out 2026-10-07 (steps 1–6) and verified on the owner's
devices.

## Partner Sharing (Phase 2)

**Publish the rules first.** Phase 2 adds rules for the shared collections. Until
the current `firestore.rules` is published (Console → Firestore → Rules, as in
step 6 above), the old rules keep those collections closed: Ledger works as
before, and Settings → Partner sharing says the rules need publishing.

### Adding Abi (manual, once)

1. Abi opens Ledger, enters her email and taps "Set or reset your password",
   chooses a password from the email, then signs in (or uses "Email me a sign-in
   link instead"). She sees "This account
   isn't set up for Ledger" with her **Account ID**. She sends it to Shaun.
2. Shaun, in the Firebase Console → Firestore → `ledger_users` → **Add
   document**: Document ID = Abi's Account ID; fields `role` (string)
   `partner`, `displayName` (string) `Abi`, `email` (string), `createdAt`
   (string). A role is only ever granted here, never by the app.
3. Shaun, in Ledger: Settings → Partner sharing → **Set up a partner**: paste
   the Account ID, her name, and his name as she'll see it. This writes the
   relationship (`ledger_share_members/{ownerUid}_{partnerUid}`, active). The
   rules refuse it unless that account already holds the partner role.
4. Abi reopens Ledger (or just waits — it follows live). She sees "Nothing
   shared for today yet" until Shaun publishes.
5. Shaun: Today → **Share snapshot** → **Abi** → review → **Publish to Abi**
   (today, or **This week** with its checkpoint and review days).

Pause / Resume and Remove are in Settings → Partner sharing. Pausing sets
`active: false`: the rules then refuse every shared read, so Abi sees "Sharing
is paused". Removing deletes the relationship and everything published to her.
Her requests stay with Shaun.

### What the rules allow

- **Owner**: manages relationships it owns (only for an account holding the
  partner role), writes projections only under its own uid and only to a
  partner it has a relationship with, reads and processes requests addressed to
  it, and may change a request only in `status`, `plannedDate`,
  `linkedActionId`, `updatedAt`, `processedAt`. Never what was asked, or by whom.
- **Partner**: reads its own relationship, and only while it is active, its own
  projections and requests. It creates a request only through its own active
  relationship, with status `requested` and no plan or link. Its id must look
  like a generated id. It may edit the wording and timing, or withdraw it, only
  while it is still `requested`. It can never set `ownerUid`, `partnerUid`,
  `linkedActionId`, `plannedDate` or an owner status.
- **Requests are never deleted.** Withdrawn (partner, while still requested)
  and dismissed (owner) are states, so a request's history survives. The owner
  cannot revive a withdrawn request.
- **After withdrawing** (the partner, own requests only): *hide* it from her own
  list (`partnerHiddenAt` set or cleared, nothing else, only while `withdrawn`;
  the owner cannot set it), or *move it to upcoming*: a new request (`requested`,
  timing `later`) whose `renewedFrom` names the withdrawn one, written together
  with the withdrawn one's `renewedAs` naming it back. Each must point at the
  other in the same write, the withdrawn one must be hers and not yet renewed, so
  it happens once; the withdrawn record keeps its status and history.
- **Summary and read marks.** The request carries a small summary of its latest
  update (`latestUpdate*`, `latestComment*`) and each side's `ownerLastReadAt` /
  `partnerLastReadAt`. Each side may sign the summary only as itself (the owner
  also as `system`) and may set only its own read mark. The partner may do so at
  any status, but this never touches the plan, the link or the status.
- **Updates** (`ledger_shared_request_updates`) are append-only: no edits, no
  deletes. Every entry must name an existing request of the same relationship
  (checked against the request itself, not the client's word), be written by the
  signed-in user (`actorUid`), at the server's time (`createdAt == request.time`),
  with only the known fields.
  - The partner (active relationship only) writes `comment` entries, plus the two
    facts that are hers alone: `request_created`, `withdrawn` and `renewed` (only
    once the request names its renewal). Each of those
    can be written once, on a fixed id, and only while the request says so. She
    can never write as the owner or as `system`.
  - The owner writes `comment` entries as `owner`. Lifecycle entries as `system`
    (`planned`, `moved`, `status`, `dismissed`) are accepted only when the request
    itself shows that state (status, planned date, linked Action). The app writes
    each one in the same transaction as the request change, so none is faked or
    repeated.
  - Reads: the owner reads its own; the partner reads her own, only while the
    relationship is active.
- Everything else is denied. Partner queries must name `ownerUid` and
  `partnerUid` (and, for Updates, `requestId`). Rules are not filters.

### What crosses the boundary

A projection holds display fields only: per item `publicId`, `section`, `type`,
`title`, `meta`, `category` (a label), `date`, `status`, `isKeyTask`,
`sourceLabel`, and `sourceId`. `sourceId` is the private Action id, used only
to say "Moved to …". A request's Updates hold only what someone typed for the
other to read, and lifecycle facts (planned for, moved to, done) derived from the
request itself. No Action notes, Day Notes or other private text is ever copied
into them. What was chosen (the selection) stays private in
`ledger_meta/sharing`. Presets are allow-lists: a section or Action category
is shared only when named. A new kind of data is therefore not shared until
someone chooses it. Day Notes and Communications are never offered.

## Hosting and origins

Production is `https://ledger.sgj.luxe` (Vercel). GitHub Pages
(`sgj-92.github.io/Ledger/`) is a legacy copy that still works and links to the
new address; it never redirects. Moving host changes nothing about security: the
boundary is Firebase Authentication and `firestore.rules`, the same for every
origin. No hosting token, Firebase Admin credential or VAPID private key is in
the client or the repository.

**What does not move between addresses.** A browser keeps these per origin, so
`ledger.sgj.luxe` starts without the old address's:

- signed-in Firebase session: sign in once per device;
- localStorage: theme, Today view mode, collapsed sections, the remembered
  role (re-confirmed online at first sign-in) and the local fallback copy;
- service worker and installed app: install again from `ledger.sgj.luxe`
  (Share → Add to Home Screen), and remove the old icon;
- notification permission and push subscriptions: created afresh against
  `ledger.sgj.luxe` when push is built.

Firestore data is not per origin: everything appears once signed in. Nothing
copies storage across origins, by design.

## Ownership of existing records

No data was moved, copied or rewritten. Ledger has exactly one owner, so the
rules express ownership as the owner role rather than a field on every
document. Two alternatives were rejected:

- Stamping `ownerUid` on every record would mean migrating every collection.
  Every list query would also have to filter on it, because rules are not
  filters. Every writer would have to add the field, and one missed writer
  means a refused save.
- Moving everything under `users/{uid}/...` would mean copying all data to new
  paths and rewriting every read and write.

Both carry real data risk for no gain while there is one owner. If Ledger ever
needs several owners, that migration can be done then, deliberately. Because
nothing is migrated, record counts are unchanged by this phase.

## Push notifications

One engine, in `functions/` (`push.js`, wired up in `index.js`). Firestore is the
truth; a push is best-effort delivery on top. If it fails, nothing in Ledger is
undone.

- **Devices belong to users.** `ledger_push_subscriptions/{uid}_{hash}` holds one
  browser's subscription for the signed-in user who turned notifications on
  there: `userUid, endpoint, keys, deviceId, deviceLabel, platform,
  vapidPublicKey, createdAt, updatedAt, lastSeenAt` (the sender adds
  `lastSentAt` / `lastError`). Owner and partner each create, read, update and
  delete only their own. Nobody can read anyone else's, register one for
  another uid, or move one to another uid. The owner gets no blanket access.
  Signing out removes that device's record.
- **The sender finds the recipient from trusted records.** It never takes a
  recipient from the browser.
  - **Current Focus.** The recipient is `ledger_meta/currentFocus.ownerUid`. The
    rules make that the owner who wrote it, and the sender checks the role
    again.
  - **Partner requests.** A new entry in `ledger_shared_request_updates` names its
    request. The sender reads the request and the active membership, and checks
    that the entry's actor really is that side.
  - **Pin now.** The pin's `ownerUid` must be its creator (rules), and the sender
    checks that this user is an owner.
- **No loops, no duplicates.** The triggers are a write to the focus document
  and the creation of an update or a pin. No handler writes to what triggered
  it. Each event is claimed once in `ledger_push_events/{eventId}`, created
  before sending, so a retried trigger sends nothing.
- **Dead devices are cleaned up.** A 404/410 from a push service deletes the
  record. So does a record made with a different VAPID key. Other failures
  are written onto the device (`lastError`) and into the event log.
- **Preferences.** `ledger_notification_prefs/{uid}` holds `currentFocus` and
  `partner`, both on unless turned off. Each user sets and reads only their
  own.
- **What a notification says.** It shows on a lock screen. Current Focus shows
  the title Shaun chose. Partner notifications show the request's title and a
  short preview of an update (140 characters). Nothing else is sent: no Day
  Notes, no Action notes, no private Ledger data.
- **No secret is in the client.** The browser reads only the VAPID *public* key,
  from `ledger_config/push`. The private key is in Secret Manager.

### Setting it up (once, from Shaun's Mac)

0. Find the Firestore location: Console → Firestore Database (it is shown on
   the database page). A Firestore trigger must run there. `nam5` →
   `us-central1`; `eur3` → `europe-west1`; a single region such as
   `europe-west2` → that region.
1. Get the code and dependencies:
   `git pull` then `cd functions && npm install && cd ..`
2. Make a VAPID key pair: `npx web-push generate-vapid-keys`. It prints a
   Public Key and a Private Key. Keep the private key out of chat, notes and
   the repo.
3. Store the private key in Secret Manager, pasting it when asked:
   `npx -y firebase-tools@latest functions:secrets:set VAPID_PRIVATE_KEY --project ledger-6aec3`
4. Create `functions/.env.ledger-6aec3` (git-ignored; it stays on the Mac):
   ```
   VAPID_PUBLIC_KEY=<the Public Key>
   VAPID_SUBJECT=mailto:<an address you choose for push services>
   APP_URL=https://ledger.sgj.luxe/
   FUNCTIONS_REGION=<the region from step 0>
   ```
   VAPID_SUBJECT has no default; it is yours to choose. An `https:` URL is
   allowed too.
5. Publish the public key to the app: Console → Firestore → Start collection
   `ledger_config` → document ID `push` → field `vapidPublicKey` (string) = the
   Public Key. A new key pair later needs only steps 2–5. Each device then
   re-enables in Settings → Notifications.
6. Deploy the rules and the functions:
   `npx -y firebase-tools@latest deploy --only firestore:rules,functions --project ledger-6aec3`
7. On each device: Settings → Notifications → Enable notifications. On an
   iPhone or iPad this works only in Ledger installed to the Home Screen.

### What the operating system decides

A Web Push notification is an ordinary, high-priority notification. The OS and
browser decide where it shows, how long it stays, how it groups and when it is
dismissed. It is not an iOS Live Activity and cannot be pinned on any
platform.

- **Replacing.** Current Focus uses one tag (`ledger-current-focus`) and a
  Topic header, so a new focus replaces the last one where the platform allows.
- **The in-app record.** The focus that always persists is the one in Ledger
  (Today's NOW line), synced through Firestore.
- **iPhone and iPad.** Web Push needs Ledger installed to the Home Screen (iOS
  and iPadOS 16.4+). In Safari, Settings → Notifications says so instead of
  offering the button.

## Testing the rules

`tests/firestore-rules/` runs the rules against the Firestore emulator. It
needs Java and Node:

```
cd tests/firestore-rules && npm install
npx firebase emulators:exec --only firestore --project demo-ledger --config ../../firebase.json "node rules.test.js"
```

It covers signed out, owner, a second owner, Partner A, Partner B, an inactive
relationship, a signed-in account with no role, every private collection, the
shared collections and an unlisted collection. All of them must pass before a
rules change is deployed.

`tests/e2e/` runs Partner Sharing end to end: the Firebase SDK version
`index.html` loads, in two browsers (owner and partner), against the Auth and
Firestore emulators enforcing these rules:

```
cd tests/e2e && npm install
npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 --config ../../firebase.json "node partner-sharing.test.js"
```

It uses the app's own project id so the page and the emulators agree; nothing
touches the real project.

`tests/functions/push.test.js` runs the push engine against the Firestore
emulator, with a fake sender. It covers targeting, source-device exclusion,
de-duplication, dead and stale devices, preferences, and the trust checks on
partner entries. `tests/e2e/execution.run.js` runs Reset Sprint, Current
Focus across three Owner devices, and the push sender end to end: the Auth,
Firestore *and Functions* emulators, a throwaway VAPID pair, and a local HTTPS
push endpoint that decrypts what web-push sends with each device's key:

```
(cd functions && npm install) && (cd tests/e2e && npm install)
node tests/e2e/execution.run.js
``` `index.html` switches to the emulators only when it
is served from localhost and the page has set `localStorage.ledger_emulator`.
A deployed Ledger never can.
