# Home — daily tasks

Status: **built 2026-10-30** (Shaun's request).
- **Code:**
  - `functions/daily.js`: the day's work, hourly;
  - `functions/index.js`: `onDailyTick`, `onDailyWritten`, `onDailyRepeatWritten`;
  - `functions/push.js`: `handleDailyItemAdded`, `sendDailyMorning`;
  - `index.html`: "daily tasks".
- **Tests:** the rules suite ("daily"), `tests/functions/daily.test.js`, Home e2e H25.

## 1. Why

> "I think we need an actual section for Magda's Daily Tasks. At the moment, Abi is
> re-writing a list… Where a task may not be completed the day before, the button moves it
> to the next day but Abi is making a new list and that task isn't being picked up there.
> We want to eventually get to a place where recurring tasks just show up and it's only
> ad-hoc things that Abi needs to note down."

**What went wrong:** a day's checklist was an ordinary request. "Move what's left to
tomorrow" made a second list when Abi's own list for that day didn't exist yet. A
recurring responsibility makes a whole request, so it can't join a list either.

## 2. Shaun's answers

- **Unfinished tasks:** carry over automatically overnight. Magda can still move them on
  by hand in the afternoon.
- **Who has a list:** anyone Abi or Shaun switches it on for.
- **Who adds:** Abi, Shaun and the person themselves (their own one-offs). Only admins
  change the repeating tasks.
- **Morning message:** yes, one, at a time an admin chooses.

## 3. The design

**One list per person per day**, so there is never a second one.
- Each day's list is an ordinary Home request with the id `D{uid}{YYYYMMDD}`:
  - `kind: 'daily'`, `dailyUid`, `dailyDate`;
  - requester and assignee are the person; it is private (admins see every request).
- Its tasks are ordinary checklist items: ticks, stars, bells, photos and moving all work as
  on any list.
- **Who makes it:** whoever adds to that day first (the person, or an admin), or the server
  in the morning.
- **Where it shows:** never among the requests. It lives in the **Daily tasks** section on
  the Home screen: one row per person, with today's progress.

**The setup:** `ledger_home_daily/{uid}`.
- **Fields:** `homeId`, `uid`, `status` (`active`/`off`), `notifyTime` (`HH:MM` or null),
  `timezone`, `createdByUid`, `createdAt`, `updatedAt`, `updatedByUid`.
- **The server's bookkeeping:** `lastRollDate`, `lastNotifiedDate`, `lastRunAt`.
- **Who writes it:** admins only. **Who reads it:** admins see everyone's; each person sees
  their own.
- **Switching off:** it is never deleted; "Stop daily tasks" sets `off`, and the lists so
  far stay.

**The repeating tasks:** `ledger_home_daily/{uid}/repeats/{id}`.
- **Fields:** `text`, `schedule`, `starred`, and provenance.
- **Schedule:** the same shape as recurring responsibilities. The app offers "Every day"
  or chosen days of the week.
- **Who:** admins write them; the person sees them.

**Each hour, for each person, in their own timezone** (`daily.js`):
1. **Once a day:** anything unticked on an earlier day's list (up to 14 days back) moves
   onto today's, with `carriedFrom` set to the day it came from. Stars are kept.
2. **The repeating tasks due today are added, once each.**
   - The list records which it has had (`repeatsAdded`), so a task removed today stays
     removed.
   - A repeat carried over from yesterday counts as today's.
3. **At the morning hour**, and within three hours of it, one notification: "Today: 7 tasks,
   2 from before", with the first few. Nothing is sent for an empty list. Switched on in the
   afternoon, the first message is the next morning's.

Every write is keyed (`c{item}` for a carried task, `r{repeat}{day}` for a repeating one),
so a retry never doubles anything. Switching daily tasks on, or changing a repeating task,
runs it at once, without the message.

**By hand:**
- "Move what's left (n) to tomorrow", or Move on one task. Either goes into that day's one
  list, which is made if needed, with `carriedFrom`.
- A task moved on keeps its repeat id, so that day's repeat doesn't come twice.

**Notifications:**
- someone else adds a task to a person's list **for today**: they hear "Abi added to
  today's tasks";
- their own tasks, and what the day brings, are quiet;
- other days are quiet until their morning;
- bells and "tell me when it's done" work as on any list.

## 4. Rules

- `dailyList()` is a second route to creating a request, used only for a day's list:
  - the id is the person and the date;
  - only while their daily tasks are on;
  - only by them or an admin;
  - always private, with a fixed shape.
- An ordinary request can never claim `kind`.
- Items may carry `carriedFrom` (a date) and `repeatId`.
- `homeReqUpdate` is unchanged, since it sits at Firestore's expression limit.

## 5. Deploy

Rules and functions together: "Deploy Firebase", everything. Until then the app's daily
tasks reads are refused and retried quietly, and the section doesn't show.

## 6. Not yet

- Existing recurring responsibilities for Magda are separate requests. Moving them into her
  daily list is a manual step: add each as a repeating task, then end the old one.
- Admins load every day's list, as they load every request. Older lists may need trimming
  from that read in time.
