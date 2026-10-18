# Household Requests — design (Phase B, for review)

Status: **proposed, not implemented.** Written 2026-10-18 for Shaun's review before
any code changes. Nothing below is built yet. Open questions are at the end.

Principle: the Household is useful to the whole family, but it never touches Ledger's
identity as Shaun's private planning system. It is a **separate shared namespace**
with its own collections and rules. No household member, Abi included, ever gets a view
of a private Ledger collection.

---

## 1. What exists today (Phase A)

- `ledger_users/{uid}` holds a role, `owner` or `partner`, set in the Firebase Console
  only. The app opens Ledger for an owner and the partner portal for a partner.
- Partner Sharing is a two-person relationship, `ledger_share_members/{owner}_{partner}`.
- Requests (`ledger_shared_requests`) always run partner → owner: `partnerUid` is the
  requester, `ownerUid` is the assignee, and `createdByUid` is the creator. Updates live
  in `ledger_shared_request_updates`. Delete is soft.
- A request the owner plans makes one private Action (`sourceRequestId`), and the
  request follows that Action's status.
- Published day/week snapshots (`ledger_shared_snapshots`) are Abi's view of Shaun's
  day.

The request model is hard-wired to two people in one direction. Adding a third person
to it would mean overloading `ownerUid`/`partnerUid`, so we don't do that.

## 2. Model

### Roles (two layers, kept apart)

| Layer | Where | Who sets it | Values |
| --- | --- | --- | --- |
| App role | `ledger_users/{uid}.role` | Firebase Console only (unchanged) | `owner` (Shaun), `partner` (Abi), **`household`** (new: the nanny) |
| Household role | `ledger_household_members/{uid}.role` | household admins, in the app, within the rules | `admin` (Shaun, Abi), `member` (the nanny) |

The app role decides which app opens: Ledger, the partner portal, or a new household
view. The household role decides what someone can do with requests. Only an account
that already has an app role can be added to the household, so no one can sign up
their way in.

### Collections (all new)

- **`ledger_households/{householdId}`**: `{ name, ownerUid, createdAt }`. One
  household; `ownerUid` = Shaun, who is permanent.
- **`ledger_household_members/{uid}`**: one doc per person (one household each).
  Fields: `householdId`, `role`, `status` (`active` | `removed`), `displayName`,
  `label` (e.g. "Nanny"), `addedByUid`, `addedAt`, `removedByUid`, `removedAt`.
  Removing someone sets `status: removed`. The rules check `active` on every read, so
  access is revoked immediately, and the record and its history stay.
- **`ledger_household_requests/{requestId}`**: the single source of truth, with no
  copies per member. Fields:
  - People: `householdId`, `requesterUid`, `assigneeUid`, `createdByUid`.
  - Visibility: `participants` = exactly those three uids (a query and rules aid).
  - Content and timing: `text`, `note`, `requestedTiming`, `requestedDate`,
    `plannedDate`, `createdAt`, `updatedAt`.
  - `status`: `requested` → `accepted` / `declined` → `in_progress` → `done`; also
    `withdrawn` and `dismissed`.
  - Owner link: `linkedActionId` and `linkedByUid`, only when the assignee is Shaun.
  - Summary: `latestUpdateAt`, `latestUpdateByUid`, `latestUpdateType`, and the
    `latestComment*` fields.
  - Read marks: `readAt` (a map uid → time; each person may write only their own key).
  - Soft delete: `deletedAt`, `deletedByUid`.
- **`ledger_household_requests/{requestId}/updates/{updateId}`**: the append-only
  history (comments plus facts: created, created on behalf, accepted, planned, moved,
  in progress, done, declined, withdrawn, reassigned, deleted). It is a subcollection,
  so its rules can read the parent request by path, and a list query is allowed exactly
  when the parent is readable.

### Who sees what (enforced by the rules, not the UI)

| | Shaun (admin, owner) | Abi (admin) | Nanny (member) |
| --- | --- | --- | --- |
| Shaun's private Ledger | yes | **no** | **no** |
| Abi's published snapshots | publishes | reads | **no** |
| Household members list | read, manage | read, manage members | read (names only) |
| Requests they are part of | read | read | read |
| All other household requests | read (oversight) | read (oversight) | **no** |
| Request history (updates) | if they can read the request | same | same |

Read rule for a request: the signed-in user is an active member of
`resource.data.householdId` **and** (they are an admin **or** their uid is in
`participants`). The nanny's app queries `participants array-contains me`; an admin's
queries `householdId == H`.

### Who may change what

- **Create.** Any active member, for their own household. `requesterUid` and
  `assigneeUid` must both be active members. `createdByUid` must be the signed-in
  user. If the creator is not the requester, it is an on-behalf request, and only
  admins may create those. Starts `requested`.
- **Requester or creator** (while `requested`): edit the wording and timing, or
  withdraw.
- **Assignee:**
  - accept, decline (optional reason), start, complete or reopen;
  - set `plannedDate`;
  - link one private Action (Shaun only, `linkedByUid` = him).
- **Admins:** reassign (to another active member, written as a "reassigned" entry)
  and set aside (`dismissed`).
- **Everyone involved:** comment, and set their own read mark.
- **Delete (soft, as Phase A):** the requester or the creator, after confirmation.
  A deleted request is frozen for everyone, and its linked Action is untouched.
- **Never changeable after create:** `householdId`, `createdByUid`, `createdAt`.
  The requester changes only on reassignment-from-requester, which is not allowed;
  the requester is fixed.
- **Membership.**
  - Admins add or remove `member`s.
  - Only the household owner (Shaun) grants or removes `admin`.
  - Nobody can remove the owner.
  - A removed member's own records stay, but they lose access.

### Linked Actions (Shaun only)

- When Shaun accepts a request assigned to him, Ledger makes one private Action (in a
  transaction, as now) and writes only its id to the request.
- The request follows the Action: planned date, in progress, done, and back to
  requested if the Action is deleted. The same existing sync code, pointed at the new
  collection.
- Only the status and date travel. The Action's title edits, notes, private updates,
  category and order never do.
- Abi and the nanny have no private Actions. As assignees they change the request
  itself.

### Notifications (one engine, `functions/push.js`)

- **One trigger:** a new entry in a request's `updates`. The recipients come from the
  request and active membership, server-side. The browser never names a recipient.
- **New request:** the assignee, said as from the requester ("Abi sent a request").
  This includes on-behalf requests, reaching every device of the assignee, as Shaun
  chose in Phase A. The requester isn't told about a request made on their behalf.
- **Accepted, planned, done, declined:** the requester, plus the creator if different.
- **Comments:** every participant except the person who wrote it.
- **Reassigned:** the new assignee.
- **Never:**
  - the actor, when they are also the recipient — except the "as if from" case above;
  - admins who are not participants (oversight is something you look at, not
    something that pings you);
  - anything for deleted, withdrawn or moved entries.
- **Each person's own on/off** (`ledger_notification_prefs`) applies as today.

## 3. UI (mobile first, the existing patterns)

- **Shaun.**
  - Requests assigned to him appear in Today's **Inbox**, exactly as now (Today ·
    Choose day · Set aside). Today stays his private planning surface.
  - A **Household** sheet holds everything:
    - For me / From me / Everyone (oversight; Open and Done);
    - **+ Request** (to: Abi or the nanny; for: me or on someone's behalf);
    - the request detail with its history;
    - Members (add, remove, roles) under Settings → Household.
- **Abi.**
  - Her portal keeps Today / This week (Shaun's published snapshots).
  - Her current "From you" becomes **Household**: For me, From me, Everyone; plus
    + Request (to Shaun or the nanny, or on the nanny's behalf), and member management.
- **The nanny.** A small, calm household app:
  - **For you** (assigned, with Accept / Done) and **From you**, with + Request (to
    Shaun or Abi);
  - each request opens its history and an update box;
  - nothing else: no Ledger, no snapshots, no other people's requests.
- Every new screen reuses Ledger's sheets, rows, chips, status pills and empty states,
  checked against `docs/UX_PLAYBOOK.md`.

## 4. Migration and rollback

Additive stages. Partner Sharing keeps working, unchanged, until the last stage.

1. **Members.** Create the household and members collections, rules and tests, plus
   Settings → Household (create, add Abi as admin, add the nanny). No change to
   requests.
2. **Requests engine.** Requests and updates rules, emulator tests, push handling. No
   UI yet.
3. **Shaun and Abi UI.** Household sheet, Inbox integration, Abi's Household tab. Old
   partner requests still show alongside.
4. **Nanny.** The `household` app role gate and her view; end-to-end tests with three
   browsers.
5. **Move existing requests.**
   - A callable Cloud Function, run once by Shaun from Settings, copies every
     `ledger_shared_requests` record into `ledger_household_requests`. It keeps the
     same id, so each linked Action's `sourceRequestId` still matches with no Action
     write.
   - Field mapping: `requesterUid` = partnerUid, `assigneeUid` = ownerUid, and
     `createdByUid` = createdByUid or partnerUid. The history is copied into
     `updates`, and deleted ones stay deleted.
   - It is idempotent (the same ids), and it marks the old record `migratedTo` (a
     server-only field).
   - The app then creates new requests only in the household collection, and the old
     collection becomes read-only in the rules.

**Rollback.**
- Stages 1–4 add collections and rules blocks only. Rolling back is redeploying the
  previous rules and hiding the UI; nothing existing was changed.
- Stage 5 copies and never deletes. Rolling back is:
  1. switching the app back to the old collection (a flag in `ledger_meta/presets`);
  2. redeploying the pre-Stage-5 rules, which make it writable again;
  3. optionally deleting the household copies with the Admin SDK.
- Requests made in the household collection between the migration and a rollback
  would need copying back; the same function can run in reverse for those.

**Deploys.** Every stage needs `firestore:rules`. Stages 2, 4 and 5 also need
`functions`. Stage 4 needs the nanny's Firebase account, with
`ledger_users/{uid}.role = household` set in the Console (as was done for Abi).

## 5. Tests per stage

- **Rules (emulator).** Every row of the permission tables above, permitted and
  forbidden, including:
  - forged creators and requesters;
  - a removed member's immediate loss of access;
  - the nanny denied every private Ledger collection, snapshots and unrelated
    requests;
  - read-mark keys limited to one's own;
  - frozen deleted requests.
- **Engine.** Recipients and wording for every event, including no echo to the actor
  and no push to non-participant admins.
- **End to end.** Three browsers (Shaun, Abi, the nanny) over the Auth, Firestore and
  Functions emulators: create in each direction, on behalf, accept → Action → done →
  the requester sees done, comments both ways, delete, member removal mid-session.
- **Regression.** The existing Partner Sharing and push suites stay green at every
  stage.

## 6. Open questions for Shaun

1. **The nanny's account:** her name and email. She signs in like Abi (password or
   email link), and you set her `household` role in the Console. OK?
2. **Abi as admin:** may she add and remove the nanny? Proposed: yes. Only you can
   make or remove an admin, and nobody can remove you.
3. **The nanny's visibility:** she sees only requests she is part of. Confirm she
   should not see requests between you and Abi.
4. **Notifications:** proposed as above. In particular, admins are not notified about
   requests between other people; is that right?
5. **Decline:** should an assignee be able to say "Can't do" (with a reason), or
   only accept and do?
6. **Existing requests:** move them into the Household at Stage 5 (recommended, one
   history), or keep them as a separate legacy list?
7. **Name:** "Household" in the UI, or something warmer ("Home")?
