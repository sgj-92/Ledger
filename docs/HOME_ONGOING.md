# Home — ongoing tasks with steps: design for review

Status: **proposed, 2026-10-25. Not built.** Shaun's request of 2026-10-25. As with
recurring responsibilities, this is written first and built only once Shaun approves it.

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
private Action, exactly as now. A step for Maria reaches her as any request does. The
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
- **Someone with a step** (Maria) sees:
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
  - who the open steps are with ("You, Maria");
  - the next dated step, if any.

### The ongoing task's sheet
- The title, then "Why it matters", then the note. This is the same layout as a
  request.
- **Steps** come in Shaun's order. Each row shows:
  - a completion circle;
  - the text;
  - the person and when (e.g. "Maria · Thursday").

  Done steps fold into "Done (3)", as completed Actions do.
- **Add a step:** the text, then **For** (Me / Abi / Maria, as on a new request) and
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
- **Abi's portal and Maria's app:** the same Ongoing section and sheet, with the
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
  five steps for Maria at once sends one summary, as "Several at once" does.
- **No new Cloud Function.** Progress is computed on the device from the steps it can
  see.

## 6. Questions for Shaun

1. **Name.** "Ongoing" (proposed), or "Projects"?
2. **Visibility:** confirm §3, where Maria sees the title and "Why" of an ongoing task
   she has a step in, but not other people's private steps.
3. **Who can start one:** admins only (Shaun, Abi; proposed), or Maria too?
4. **Finishing:** by hand (proposed). Alternatively, it could suggest "Finish?" when the
   last step is done.
5. **Steps for nobody yet:** every step is for someone (proposed), even if that is you
   for now; it can be passed on later. The alternative is an unassigned step, which
   requests don't support today.
6. **Your Inbox items today:** add "Move to Home as an ongoing task" to an Inbox
   Action? Not proposed for the first build; you'd re-enter them once.

## 7. Build order once approved

1. Rules and rules tests.
2. Data helpers, then the Ongoing section and sheet for Shaun.
3. Steps as requests: add, reorder, "Part of" on requests and Actions.
4. Abi's portal and Maria's app.
5. E2E: Shaun starts one with steps for himself and Maria, schedules his into Today, and
   Maria completes hers. Then a UX review, then the ledger and deploy notes (rules
   only).
