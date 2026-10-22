# Home (Household Requests) — design, as built

Status: **built 2026-10-18** (Phase B). Proposed earlier the same day and reviewed by
Shaun. His answers shaped what was built; they are recorded under §2. Rules, push
engine, migration and app all ship together.

Principle: Home is useful to the whole family, but it never touches Ledger's identity
as Shaun's private planning system. It is a **separate shared namespace** with its own
collections and rules. Nobody at Home, Abi included, ever gets a view of a private
Ledger collection.

---

## 1. Model

### Roles: two layers, kept apart

| Layer | Where | Who sets it | Values |
| --- | --- | --- | --- |
| App role | `ledger_users/{uid}.role` | Firebase Console only (unchanged) | `owner` (Shaun), `partner` (Abi), `household` (the nanny; new) |
| Home role | `ledger_home_members/{uid}.role` | Shaun, in the app, within the rules | `admin` (Shaun, Abi), `member` (the nanny) |

- **App role:** decides which app opens:
  - Ledger, for Shaun;
  - the partner portal, for Abi, with Home inside it;
  - the Home app, for the nanny, with nothing of Ledger.
- **Home role:** decides what someone sees and can do with requests.
- **Who can join:** only an account that already holds an app role can be added. A
  partner account joins as an admin, a household account as a member.

### Collections

- **`ledger_homes/{homeId}`:** `{ name, ownerUid }`. `homeId` is Shaun's uid, so there
  is one Home.
- **`ledger_home_members/{uid}`:** one per person. Fields:
  - `homeId`;
  - `role`, and `status` (`active` | `removed`);
  - `displayName`, plus an optional `label` (e.g. "Nanny");
  - who added or removed them, and when.
- **`ledger_home_requests/{id}`:** one shared record per request, never copied per person.
  - **People:** `requesterUid`, `assigneeUid`, `createdByUid`. They are separate,
    immutable facts; the assignee changes only by passing the request on.
  - **Visibility:** `participants` lists the requester, the creator and everyone it has
    been assigned to. `visibility` is `private` (the default) or `home` (everyone at
    Home).
  - **`status`:** `requested`, `planned`, `in_progress`, `done`, `cant_do` (with a
    `cantDoReason`) or `withdrawn`. Moved requests can also carry `dismissed`.
  - **Dates and link:** `plannedDate`, plus `linkedActionId` and `linkedByUid` (Shaun
    only: just the id of his private Action).
  - **Summary:** `latestUpdate*` and `latestComment*`.
  - **Read marks:** `readAt`, keyed by uid; each person writes only their own key.
  - **Soft delete:** `deletedAt` and `deletedByUid`, as in Phase A.
- **`ledger_home_requests/{id}/updates/{u}`:** the append-only history.
  - **Comments.**
  - **Facts:** created, planned, moved, status, can't do, reassigned, visibility,
    withdrawn, deleted.
  - **Rules:** each entry is written by the signed-in user at the server's time, and a
    fact is accepted only when the request itself says so.

### Who sees what (enforced by `firestore.rules`)

| | Shaun (owner, admin) | Abi (admin) | The nanny (member) |
| --- | --- | --- | --- |
| Shaun's private Ledger | yes | **no** | **no** |
| Published snapshots of Shaun's day/week | publishes | reads | **no** |
| People at Home | reads, **adds and removes** | reads | reads (names only) |
| Requests they are in | yes | yes | yes |
| Requests shared with everyone at Home | yes | yes | yes |
| Every other request at Home (oversight) | yes | yes | **no** |

### Who may change what

- **Ask (create):** any active member, for themselves.
  - Only an admin may ask on someone else's behalf. The request then shows "Created by
    Shaun on <her name>'s behalf".
  - The creator is always the signed-in user, and both requester and assignee must be
    active members.
- **The person who asked or wrote it,** while it waits: reword it, or withdraw it.
- **The assignee:** start, done, can't do (optional reason), reopen. Shaun alone links
  his own Action, by id.
- **Pass on (reassign):** the assignee or an admin can pass it to another active
  member, never back to the requester. The new assignee joins `participants` and nobody
  leaves them.
- **Who sees it:** its creator or an admin switches `private` ↔ `home`.
- **Anyone who can see it:** comment, and set their own read mark.
- **Delete (soft):** the requester or the creator, after the Phase A confirmation.
  Afterwards it is frozen for everyone.
- **Members:** only Shaun adds and removes. Removing someone is a state: their access
  ends at once and the history stays. Nobody can remove Shaun or promote themselves.

### Shaun's Actions

- **Taking one on:** when a request is Shaun's, Today, or Choose day, makes **one**
  private Action (`sourceType: 'home_request'`, `sourceRequestId`). It is created in a
  transaction that checks the request is still his and still waiting, so a double tap
  never makes two.
- **Sync:** the request follows the Action — its planned day, in progress, done, and
  back to requested if the Action is gone. This is the same sync code as Partner
  Sharing.
- **Privacy:** only the id and the request's state travel. Abi and the nanny have no
  Actions; they change the request itself.

### Notifications (`functions/push.js` → `handleHomeUpdate`)

The trigger is `ledger_home_requests/{id}/updates/{u}`. The recipients are worked out on
the server from the request and the people currently at Home.

| Entry | Who hears |
| --- | --- |
| created | the assignee, "Abi sent a request", on all their devices — also when Shaun recorded it for himself on someone's behalf (as Phase A) |
| comment | everyone in it except its author |
| planned, done, can't do | the requester, and its writer if different; never the person who did it |
| reassigned | the new assignee, "Abi passed you a request" |
| a list sent at once | each person it was for, once: "Abi sent you 6 requests" (the first three, "and 3 more"); admins following Home, once |
| started, moved, withdrawn, shared, deleted | nobody |

- **Following Home (admins only):** opt-in, off by default (Settings → Notifications →
  "Requests between others", `homeOversight`). Admins who aren't in a request hear when
  someone else asks something, and when it's done.
- **Other preferences:** each person's "Requests & updates" switch applies. Removed
  members hear nothing.
- **Migrated history:** entries copied in by the move are never announced.

## 2. Shaun's answers (2026-10-18)

1. **The nanny's account:** yes. She gets her own sign-in, with the `household` role set
   in the Console.
2. **Membership:** only Shaun adds and removes people. Abi is an admin for oversight
   only.
3. **Visibility:** the nanny sees only what she's part of. Requests can also be shared
   with everyone at Home, with one current assignee and everyone able to see.
4. **Oversight notifications:** off by default. A setting lets each admin follow what
   the other asks the nanny, and when she finishes it.
5. **Can't do and Pass on (reassign):** both available.
6. **Earlier requests:** yes, move them into Home, keeping requests between Shaun and Abi
   private to them.
7. **Name:** "Home".

## 3. Where it lives in the app

Updated 2026-10-22 (navigation redesign): Home is a place, not a sheet.

- **One Home screen, three surfaces.** Shaun's **Home** tab (the fifth), Abi's **Home**
  tab in her portal (beside Today and This week, with a "Home" row leading to it), and
  the nanny's app are the same screen:
  1. who is at Home, and a compact **Add** (one request, or several at once);
  2. a summary that doubles as filters: **For me**, **Assigned to others**, **Overdue**;
  3. **Today** (due today or earlier, or in progress), then **Upcoming**;
  4. **Recent updates** (the last two weeks, newest first; › opens All activity);
  5. **People** (Shaun adds and removes; everyone else sees who is there) and, for
     admins, Notifications.
- **When a request is due:** its planned day, its chosen date, "today" on the day it
  was asked, "this week" by that week's Sunday; "no preference" has no date.
- **Done in one tap:** the assignee ticks a row; it shows done at once and is written
  after a 5-second Undo (as Partner Sharing's Done). Shaun's requests linked to an
  Action follow the Action instead.
- **Attention:** a dot on the Home tab (and on Abi's Home tab) when something is new for
  you, or someone has added an update to a request you're in. Following other people's
  requests stays the opt-in notification, never a dot.
- **Shaun** also keeps requests that are his to decide in Today's **Inbox** (Today,
  Choose day, Done, Can't do), and Settings → **Home** (Set up Home, Open Home, People,
  "Bring in requests with Abi"). Today's old Home row is gone: the tab replaces it.
- **The nanny** sees only her Home app; Shaun's tabs stay locked (inert) behind it.

### Several at once (2026-10-22)

- **Add → Add several tasks:** one text box, one line per task; **For** (an admin's
  default is the one person who helps at home), **When** (Today by default; Tomorrow,
  a date, or no date), an optional note for all of them. The draft is kept on the
  device until it is sent.
- **Parsing is plain:** each non-empty line is one task; leading bullets, numbers and
  checkboxes are removed; spacing is tidied; nothing is merged or reworded.
- **Check the list:** every line is editable, removable, and can have its own person or
  day; "Add another" adds a line. The button says how many will be created.
- **Creating them:** separate requests (each with its own history, status and
  completion), written five to a batch with ids fixed at preview time. A double tap or
  a retry can never make a second copy, and if some fail it says exactly how many were
  created and keeps the rest to try again.
- **One notification each:** see §1, Notifications.

### Checklists (2026-10-22)

- **Shape:** a request may carry a checklist: `ledger_home_requests/{id}/items/{itemId}`,
  one document per item. Each item has:
  - `text` (≤ 200), `done`, and `order`;
  - `createdByUid` and `createdAt`;
  - `doneByUid` and `doneAt` while ticked;
  - `updatedByUid` and `updatedAt`.

  The request says `hasChecklist: true`.
- **Who:** items are read by whoever can read the request, and changed by the people
  it is between: who asked, who wrote it, whose it is now. An admin following Home
  sees them but cannot tick, add or reorder. Who added or ticked an item is always the
  signed-in user.
- **Sync without overwrites:** one document per item means two people ticking or
  adding at once never overwrite each other. A reorder writes only the moved item's
  `order`, set between its new neighbours.
- **On screen:**
  - **Rows:** "3 of 8 items" on the request's row, live.
  - **The sheet:** a Checklist section with tick, text (tap to edit; empty removes
    it), and a handle to drag.
  - **Adding:** "Add an item — or paste a list" adds one per line.
  - **Ticked items** fold into "Ticked · N", showing who ticked each and when.
- **Done is never automatic.** Ticking everything says "all ticked" and leaves the
  request open. Done with items left asks first ("2 items aren't ticked. Mark it done
  anyway?") and leaves them as they are. History is kept.
- **Creating one:** Add → **Shopping or checklist** (or "With a checklist" on any new
  request): items one per line, created with the request in one write. An existing
  request gains one by adding its first item.
- **Notifications:** none for ticks or edits.

### Recurring responsibilities (2026-10-22)

Designed and built per `docs/HOME_RECURRENCE.md`:
- **The model:** a template, plus one ordinary request per due date. The server makes
  it hourly from 06:00 local, or at once when the responsibility is set up. Its id is
  deterministic, so it is never duplicated.
- **Who:** a named person, or "anyone at Home" ("I'll do it").
- **Missed occurrences** are kept as missed, never auto-completed.
- **Changes:** pause, resume, end and edit the series.
- **Members removed** are never given more.

## 4. Moving Partner Sharing requests into Home

- **Starting it:** Shaun taps "Bring in requests with Abi", which writes
  `ledger_meta/homeMigration` (owner-only). A Cloud Function
  (`onHomeMigrationRequested` → `functions/migrate.js`) then copies each
  `ledger_shared_requests` record into `ledger_home_requests` with the same id, so every
  linked Action's `sourceRequestId` still matches.
- **What is kept:**
  - `requesterUid` = partner, `assigneeUid` = owner, `createdByUid` = creator or
    partner;
  - `visibility: 'private'`;
  - status, dates, link, summary, read marks, soft deletion and hidden-for-Abi;
  - its history, keeping who and when.
- **The old record:** it is marked `migratedTo` and never deleted. The apps stop listing
  it.
- **Running it again:** it copies nothing twice, and it picks up any request a stale app
  made afterwards.

**Rollback.**
- **Before the move:** Home is additive (new collections and rules blocks), so
  redeploying the previous rules removes it; nothing existing changed.
- **After the move:** the old records still exist. Clearing their `migratedTo` (Admin
  SDK) makes the apps list them again; the Home copies can then be deleted.

## 5. Deploy

```
npx firebase-tools deploy --only firestore:rules,firestore:indexes,functions --project ledger-6aec3
```

- **New rules:** Home, the `household` role, and `homeOversight`.
- **A composite index:** `homeId` + `participants` (for the nanny's list).
- **Two new functions:** `onHomeUpdateCreated` and `onHomeMigrationRequested`.

**The nanny's account.**
1. She opens `ledger.sgj.luxe` and taps "New here? Create an account" (or uses the
   email link). She sees "This account isn't set up" with her Account ID.
2. Shaun adds `ledger_users/{that id}` with `role: household` and `displayName` in the
   Console.
3. She taps "try again", and sees "Almost there".
4. Shaun goes to Settings → Home → People → Add someone, picks her, and adds the label
   "Nanny".

## 6. Tests

- **Rules:** 473 in all. Among them:
  - every permission row;
  - forged creators;
  - removed members;
  - the nanny denied every private collection, snapshots, Partner Sharing and other
    requests;
  - frozen deletions.
- **Engine and migration:** 31, plus 49 for push.
- **End to end:**
  - Home (`tests/e2e/home.test.js`, three browsers): 73;
  - push (`execution.test.js`, the real triggers and the migration through the Functions
    emulator): 72;
  - Partner Sharing: 201.
