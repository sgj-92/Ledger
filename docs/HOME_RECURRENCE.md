# Home — recurring responsibilities: architecture

Status: **designed, then built, 2026-10-22** (Milestone 4 of the navigation and Home
brief). This was written first, and the build follows it.
- **Code:** `functions/recur.js` (the generator), `functions/index.js` (the hourly tick
  and the template trigger), `index.html` ("recurring responsibilities").
- **Tests:** `tests/functions/recur.test.js`, the rules suite, Home e2e H15, and push
  e2e.

Scope: recurring household responsibilities at Home only. This is separate from any
Ledger reminder or scheduling idea, which stays unauthorised. Nothing here touches a
private Ledger collection.

---

## 1. The idea in one paragraph

A **template** describes the responsibility once: what, who, when it repeats, and an
optional checklist. On each due date the **server** creates one ordinary Home request
from it, called an **occurrence**. An occurrence is a normal request: it has its own
status, assignee, checklist ticks and history, and is completed, commented on, passed
on or deleted like any other. Completing one never touches another. Only the current
occurrence is ever created; future ones are computed for display, never stored.

## 2. Data

### Template: `ledger_home_recurring/{templateId}`

| Field | Meaning | Who writes it |
| --- | --- | --- |
| `homeId` | its Home | creator, once |
| `title` (≤ 280), `note` (≤ 500 or null) | what | creator or admin |
| `createdByUid` | who set it up; the occurrences are "from" them | creator, once (= signed-in user) |
| `mode` | `assigned` (a named person) or `anyone` (anyone at Home can take it) | creator or admin |
| `assigneeUid` | the named person (`assigned`), else null | creator or admin |
| `visibility` | `private` or `home`; always `home` for `anyone` | creator or admin |
| `schedule` | see below | creator or admin |
| `timezone` | IANA zone of the device that set it (e.g. `Europe/London`) | creator or admin |
| `checklist` | up to 40 item texts, copied into each occurrence | creator or admin |
| `status` | `active`, `paused` or `ended` (never deleted) | creator or admin |
| `createdAt`, `updatedAt`, `updatedByUid` | provenance | the writer, as themselves |
| `lastDate`, `lastRunAt`, `blocked` | the server's bookkeeping | **server only** |

**Schedule:** `{ freq, days, monthDay, every, startDate, endDate, time }`.
- `freq`:
  - `daily`;
  - `weekdays` (the chosen `days`, 0 = Sunday … 6 = Saturday);
  - `weekly` (one day, `days[0]`);
  - `monthly` (`monthDay` 1–31; in a shorter month, its last day);
  - `interval` (every `every` days from `startDate`, 2–365).
- `startDate` is required. `endDate` is optional: the last day it can fall on.
- `time` is optional (`HH:MM`). It is shown and sorted by, never enforced.

### Occurrence: `ledger_home_requests/{templateId}_{YYYYMMDD}`

An ordinary request (`docs/HOUSEHOLD_DESIGN.md`) with three extra fields:
- `recurringId`;
- `occurrenceDate`;
- `requestedTime` (from `time`).

How its fields are filled:
- **Requester and creator:** both are the template's `createdByUid`.
- **When:** `requestedTiming` is `date`, and `requestedDate` is the occurrence date.
- **Assignee:**
  - `assigned` mode: the named person.
  - `anyone` mode: **null** until someone claims it ("I'll do it"). The request is
    `visibility: home`, so everyone sees it.
- **Checklist:** each item from the template becomes a fresh item, unticked.

**Why the id is deterministic:** the same template and date always name the same
document, so generation is a create-if-absent. A retry, a second scheduler run, or the
template trigger and the scheduler racing can never make two. A deleted or withdrawn
occurrence still exists (soft delete), so it is never recreated.

## 3. Generation (server)

- **Hourly** (`onSchedule('every 60 minutes')`, `onRecurringTick`): the scheduler
  checks every active template. For each one it works out the template's local date
  and hour in its `timezone`.
- **When the template is written** (`onDocumentWritten`, `onRecurringWritten`):
  - it runs at once for that template, so a responsibility set up for today appears
    straight away;
  - the server's own bookkeeping writes back do not re-run it.
- **Which date it creates:** only today's, local to the template, when:
  - today is a due date;
  - it is within `startDate` and `endDate`;
  - the template is `active` and not blocked;
  - and (on the hourly run) the local time is 06:00 or later. Responsibilities appear
    in the morning, not at midnight.
- **Missed days are not backfilled.** If generation didn't run (an outage), the
  skipped dates are not created after the fact. They would only appear already
  missed, about something nobody was shown.
- **The previous occurrence, if still open, becomes `missed`:**
  - it gets a `missed` history entry from the server, and is never marked done;
  - its assignee can still mark it done late;
  - otherwise it stays in history as missed.

  This keeps one current occurrence per responsibility, rather than a pile of
  overdue copies.
- **Who it is for, checked every time:**
  - The creator must still be an active member. If not, the template is blocked
    (`creator_removed`) and nothing is made.
  - In `assigned` mode, the assignee must still be an active member. If not, it is
    blocked (`assignee_removed`), and Home shows "Needs someone new" to its creator
    and the admins.
  - Choosing someone else clears the block on the next run, which the edit itself
    triggers.

  Nothing is ever generated for someone who has been removed.
- **Idempotency in one line:** create-if-absent on a deterministic id. Everything else
  (the missed mark, the bookkeeping) is a no-op when repeated.

## 4. Editing

- **One occurrence:** edit the request itself (wording, note), as any request. It
  changes only that one.
- **The series:** edit the template. The change applies from the next occurrence; the
  current one is left as it is (and can be edited on its own).
- **Pause / resume:** `status` changes. While paused, nothing is generated. On resume
  it continues from the next due date, without backfilling.
- **End:** `status: ended` (with `endedAt`). It is kept for history and never
  generates again. Templates are never deleted.
- **Removing a member** who owns or is assigned a responsibility: see §3, Who it is
  for.

## 5. Permissions (`firestore.rules`)

- **Read a template:** an active member who is an admin, its creator, its assignee,
  or anyone at Home when its visibility is `home`. That mirrors the request rule.
- **Create:**
  - an active member, as themselves (`createdByUid`), into their own Home;
  - `assigned`: the assignee is an active member (since 2026-10-22, possibly
    themselves: a regular task of their own, announced to them as "Today: …" · "Regular");
  - `anyone`: no assignee, and visibility `home`;
  - the shape and schedule are validated;
  - status `active`, and no server-owned field.
- **Update:**
  - by its creator or an admin;
  - `homeId`, `createdByUid` and `createdAt` never change, and no server-owned field
    can be set;
  - a new assignee must be an active member.
- **Delete:** never; End is the way to stop it.
- **Occurrences** are created only by the server (Admin SDK). The client rules for
  `ledger_home_requests` are unchanged, apart from the following.
- **Claim:** any active member may claim an unclaimed `anyone` occurrence. The request
  must have a `recurringId` and a null assignee. The member writes only themselves as
  assignee, joins `participants`, and the status stays `requested`. The history entry
  `claimed` is accepted only in that same write.
- **Late done:** the assignee may move `missed` to `done`.
- **The server re-checks everything** it relies on (membership, mode, assignee),
  because the Admin SDK is not subject to the rules.

## 6. Notifications (the existing engine, `handleHomeUpdate`)

| Entry | Who hears |
| --- | --- |
| an occurrence is created, `assigned` | its assignee: "Today: Wash the school uniform" · "Regular, from Abi" |
| an occurrence is created, `anyone` | every active member except its creator: "Today at Home: …" · "Anyone can take it" |
| claimed | its creator: "Maria will do “…”" |
| done | as any request: its requester (the creator), and admins following Home |
| missed | nobody |

A checklist tick never notifies anyone (§ checklists).

## 7. On the screen

- **Add → Recurring responsibility:**
  - what, and a note;
  - who: a named person, or anyone at Home;
  - repeats: daily, chosen weekdays, weekly, monthly, every N days;
  - starts, optional end, optional time;
  - an optional checklist.
- **Home → Recurring:** one quiet row per responsibility.
  - "Every Sunday · Maria · next Sun 25 Oct".
  - Paused and "Needs someone new" show as pills.
  - Tap it to see it, Edit, Pause / Resume or End.
- **Occurrences** carry a small repeat mark (↻) and sit in Today and Upcoming like
  any request. An unclaimed one says so, with **I'll do it**.
- **Completed and missed occurrences** are history: Recent updates and All activity,
  never the current list.

## 8. Assessed against existing records

- **Nothing existing changes shape.** Templates are a new collection. Occurrences are
  requests with three extra optional fields; every existing request lacks them and
  reads exactly as before.
- **Existing rules branches are all diff-based**, so the extra fields on an
  occurrence never block an edit. They are also not editable by clients:
  `recurringId`, `occurrenceDate` and `requestedTime` are outside every client update
  branch.
- **Phase A / B requests, migrations and linked Actions** are untouched. An occurrence
  can be taken on as one of Shaun's Actions like any request (Today, Choose day), by
  the same transaction.
- **There is no data migration.**

## 9. Deploy

- Rules and functions, as before:
  `npx firebase-tools deploy --only firestore:rules,firestore:indexes,functions --project ledger-6aec3`
- **The hourly scheduler needs Cloud Scheduler.** Firebase enables it on the first
  deploy of a scheduled function (Blaze plan, which Cloud Functions already require).
  If the deploy asks to enable `cloudscheduler.googleapis.com`, answer yes.
- **The scheduler runs in `FUNCTIONS_REGION`.**
