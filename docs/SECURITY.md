# Security and identity

How Ledger decides who can see what, and how to roll it out or change it.
The rules themselves are in `firestore.rules`; this is the runbook around them.

## The model

- **Identity is Firebase Authentication** (passwordless email link). Signing in
  proves who someone is. It grants nothing on its own: anyone can create an
  email-link account against this project, because the web config is public.
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
| `ledger_meta` | preferences (`presets`) | owner |
| `ledger_matters`, `ledger_conversations` | Communications | owner |
| `ledger_challenges` | challenges | owner |
| `ledger_push_subscriptions` | devices for Pin now | owner |
| `ledger_pins` | Pin now requests | owner |
| `ledger_meta/sharing` | what each publication was chosen to include | owner |
| `ledger_share_members` | the owner–partner relationship | owner manages own; partner reads own |
| `ledger_shared_snapshots` | published day and week projections | owner writes own; partner reads own, while active |
| `ledger_shared_requests` | requests from the partner | partner creates/edits/withdraws own until processed; owner moves them on; each keeps own read mark |
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
2. **Authentication → Settings → Authorized domains**: add `sgj-92.github.io`.
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
7. **Deploying the function** needs the Blaze plan. The project is on Spark,
   and no function has ever been deployed (#20). On Blaze, run `npm install` in
   `functions/`, then `npx -y firebase-tools@latest deploy --only functions`
   from the repo root. Don't use `npm install -g`: on a Mac it fails with
   EACCES. The function sends each Pin now only to the devices of the account
   that created it.

**Status:** rolled out 2026-10-07 (steps 1–6) and verified on the owner's
devices.

## Partner Sharing (Phase 2)

**Publish the rules first.** Phase 2 adds rules for the shared collections. Until
the current `firestore.rules` is published (Console → Firestore → Rules, as in
step 6 above), the old rules keep those collections closed: Ledger works as
before, and Settings → Partner sharing says the rules need publishing.

### Adding Abi (manual, once)

1. Abi opens Ledger and signs in with her email link. She sees "This account
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
    facts that are hers alone: `request_created` and `withdrawn`. Each of those
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

## Push notifications (Pin now)

- Devices and pins are owner-only under the rules. No one else can read
  devices, register a device or create a pin that triggers a push.
- New devices and pins carry `ownerUid`. A device's subscription is re-saved
  with its `ownerUid` every time it pins.
- The Cloud Function uses the Admin SDK, which is **not subject to Firestore
  rules**. It enforces ownership itself: a pin goes only to devices with the
  same `ownerUid`. A legacy record without one still matches, because every
  legacy record was made by the owner. No secret is in the client. The VAPID
  private key stays in Secret Manager.

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
touches the real project. `index.html` switches to the emulators only when it
is served from localhost and the page has set `localStorage.ledger_emulator`.
A deployed Ledger never can.
