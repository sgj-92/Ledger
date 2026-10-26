# Home — ongoing tasks with steps

Status: **designed 2026-10-25, approved and built 2026-10-26.**
- **Code:** `index.html` ("ongoing tasks").
- **Rules:** `ledger_home_ongoing`, and `ongoingId` on requests, in `firestore.rules`.
- **Tests:** the rules suite ("ongoing:", "step:") and Home e2e H20.
- **Deploy:** the rules and indexes, through "Deploy Firebase" (`docs/DEPLOY_FROM_GITHUB.md`).
  There is no new Cloud Function.

> "We have tasks/things to complete but they are more than a single task that I can
> achieve on a given day. They're ongoing tasks with multiple steps involved. Currently
> I'm just leaving them on my inbox but they need a place in home to be stored, with
> subtasks that I can then add to my day/schedule."

Shaun's answer on who does the steps: **steps for different people.**

Scope: Home only. Nothing here reads or writes a private Ledger collection. It is not a
separate task engine: every step is an ordinary Home request.

---

## 1. The idea in one paragraph

An **ongoing task** is a small parent record: a title, an optional "Why it matters" and
note, and who it involves. Its **steps** are ordinary Home requests carrying the
parent's id. A step therefore already has everything a request has:
- someone it is for and someone who asked;
- a status;
- a checklist;
- a "Why";
- history;
- notifications.

A step for Shaun goes to his Inbox, and **Today** or **Choose day** turns it into a
private Action, exactly as now. A step for Magda reaches her as any request does. The
ongoing task shows the steps together, with progress ("3 of 7 steps"), and stays in Home
until someone marks it finished.

Why steps are requests rather than a new kind of item:
- scheduling into Today, passing on, "Can't do", notifications and the partner portal
  already work for requests;
- a new item type would need all of that again, which is the separate task engine that
  is not authorised.

## 2. Data

### Parent: `ledger_home_ongoing/{ongoingId}`

| Field | Meaning | Who writes it |
| --- | --- | --- |
| `homeId` | its Home | creator, once |
| `title` (≤ 280), `note` (≤ 500 or null), `why` (≤ 300 or null) | what, and why | creator or admin |
| `createdByUid` | who started it | creator, once (= signed-in user) |
| `participants` | the creator plus everyone with a step | the client, kept in step with the steps |
| `visibility` | `private` (its participants) or `home` (everyone at Home) | creator or admin |
| `status` | `active`, `done` or `archived` (never deleted) | creator or admin |
| `stepOrder` | step ids in Shaun's chosen order | creator or admin |
| `createdAt`, `updatedAt`, `doneAt` | | |

### Steps: requests in `ledger_home_requests`, plus one field

| Field | Meaning |
| --- | --- |
| `ongoingId` | the parent, set at creation and never changed |

Everything else about a step is the request as it is today. A step with no date uses
the existing **"No rush"** timing (`later`), so it waits in the ongoing task, not on
anyone's day.

## 3. Who sees what

The proposal (Q2 below asks Shaun to confirm it):
- **Admins** (Shaun, Abi) see every ongoing task and all its steps, as they see all of
  Home now.
- **Someone with a step** (Magda) sees:
  - the ongoing task's title and its "Why", so her step makes sense;
  - her own steps, and any steps shared with the whole Home.

  She does not see other people's private steps, as now.
- **An ongoing task shared with the whole Home** shows all its shared steps to everyone.

These are the existing request rules. The parent is readable by its participants, or
by everyone when `home`.

## 4. Screens

### Home
- **Add** gains **"Ongoing task"**, after "Several at once" and "Recurring".
- A new **Ongoing** section sits under Recent updates, before the request lists. Each
  row shows:
  - the title;
  - progress ("3 of 7 steps");
  - who the open steps are with ("You, Magda");
  - the next dated step, if any.

### The ongoing task's sheet
- The title, then "Why it matters", then the note. This is the same layout as a
  request.
- **Steps** come in Shaun's order. Each row shows:
  - a completion circle;
  - the text;
  - the person and when (e.g. "Magda · Thursday").

  Done steps fold into "Done (3)", as completed Actions do.
- **Add a step:** the text, then **For** (Me / Abi / Magda, as on a new request) and
  **When** (No rush / Today / This week / Choose date). Several steps can be pasted at
  once, one per line, using the "Several at once" parsing.
- **Tapping a step** opens its request sheet, unchanged: Today / Choose day / Done /
  Can't do / Pass on. Shaun's "Today" puts it on his day as an Action.
- Steps reorder by drag, with the same handle as checklist items.
- **Mark finished** sets `status: done`. If open steps remain, the sheet asks first.

### Elsewhere
- **A step's request sheet and its Action** show "Part of: *Kitchen refit*", which opens
  the ongoing task.
- **Shaun's Inbox:** a step for him with "No rush" stays in the ongoing task, not the
  Inbox. A dated step behaves as any request does.
- **Abi's portal and Magda's app:** the same Ongoing section and sheet, with the
  visibility above.

## 5. Rules, server, notifications

- **Rules:**
  - a new `ledger_home_ongoing` match: create by a Home member as themselves; edit by
    its creator or an admin; never delete; reads as in §3;
  - the request create rule accepts `ongoingId`, only pointing at an active ongoing
    task in the same Home, checked with `get()`;
  - `ongoingId` is immutable after that;
  - the rules suite gains cases for each.
- **Notifications:** none for the parent. Steps notify exactly as requests do. Adding
  five steps for Magda at once sends one summary, as "Several at once" does.
- **No new Cloud Function.** Progress is computed on the device from the steps it can
  see.

## 6. Shaun's answers (2026-10-26), and what was built

1. **Name:** "Ongoing".
2. **Visibility:** as in §3. Magda sees the title and "Why" of a task she has a step in,
   and only her own steps. Her counts are her part ("1 for you", "Your part · 0 of 1
   done"), never a total she can't see.
3. **Who starts one:** admins only (Shaun, Abi). Only admins add steps, reorder them, edit
   the task or finish it.
4. **Finishing:** by hand. "Mark finished" asks first while steps are open; open steps
   stay as they are. Finished tasks fold under "Finished" and can be reopened.
5. **Every step is for someone:** yes, and that may be you.
6. **Move to Home:** yes. Any open request an admin can see (from the Inbox or Home)
   offers **Move to Ongoing**:
   - it starts an ongoing task prefilled from the request, and the request becomes its
     first step;
   - the request is still the asker's, and they see where it stands;
   - it is filed once and stays there.

Built differently from §4:
- **The Ongoing section** sits after Upcoming, before Recurring, and uses the same row
  as Recurring.
- **A step with no date** uses the existing "No date" timing (`none`). It shows in its
  task, not in Upcoming.
- **The Inbox:** a step never arrives there as new, whatever its date. It is decided in
  its task, and the person still gets the request's notification.
  - This also takes a moved request out of the Inbox.
  - Updates on a step still show there as updates.
- **Steps on others' lists:** a step's row says which task it belongs to
  ("Today · Kitchen refit · For Magda").
- **"Part of" links:**
  - a step's sheet opens its task;
  - an Action made from a step says "From … · part of Kitchen refit".
- **Several steps for someone else at once** reach them as one notification, using the
  same list summary as "Several at once".
- **Passing a step on:** when an admin passes one to someone new, that person is added
  to the task's people.
- **Rules:** the branch that files a request under a task is the last in the request
  update rule, with its cheapest checks first. Firestore stops at 1,000 expressions, and
  placed earlier it pushed an ordinary soft-delete over that limit.

## 7. Build order (as followed)

1. Rules and rules tests.
2. Data helpers, then the Ongoing section and sheet for Shaun.
3. Steps as requests: add, reorder, "Part of" on requests and Actions.
4. Abi's portal and Magda's app.
5. E2E: Shaun starts one with steps for himself and Magda, schedules his into Today, and
   Magda completes hers. Then a UX review, then the ledger and deploy notes (rules
   only).
