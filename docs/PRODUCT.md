# Ledger — Product Definition

Durable product definition. This is what Ledger *is*, independent of how any
part of it is currently built.

- Coordination state, decisions and handoffs live in `PROJECT_LEDGER.md`.
- Interaction philosophy lives in `docs/UX_PRINCIPLES.md`.
- The backlog lives in GitHub Issues, not here.

---

## What Ledger is

Ledger is a private personal operating system for one person — Shaun.

It is a single-file progressive web app used primarily on a phone. It holds the
plan for the day, the record of what actually happened, and the connection
between the two. It is designed to be opened many times a day, briefly.

It is not a team tool, not a product for sale, and not a general-purpose task
manager. Every decision may be optimised for one user's real life.

## Who it is currently for

One owner. Ledger has one person's private data in it. Since 2026-10-06 it
signs in (Firebase Authentication), and a partner can be given a role. A partner
will only ever see what the owner explicitly shares, through separate shared
collections, never the owner's private Ledger. Since 2026-10-07 that is real:
see [Partner Sharing](#partner-sharing), [Privacy and data](#privacy-and-data)
and `docs/SECURITY.md`.

## Core loop

```
Plan → Do → Track → Review → Adjust
```

- **Plan** — decide what the day contains: direction, actions and key outcomes,
  health & fitness, constraints and notes. Plan is intent; Today executes it.
- **Do** — execute from Today, the day's working surface.
- **Track** — record what actually happened as real evidence, not self-report.
- **Review** — close the day honestly, including the parts that did not happen.
- **Adjust** — carry the reality of one day into the planning of the next.

Every surface in Ledger should be identifiable as one of these five stages. A
feature that does not serve the loop needs a reason to exist.

## Core user journeys

These are the journeys that must always work. They are the basis of the
release checklist and of any future automated smoke suite.

1. **Prime the morning.** Open Today, run Morning Prime: **Plan** (acknowledge
   meals, choose three key tasks, review today's plan, set an intention)
   and **Move** (the physical morning routine).
2. **Work the day.** Read Today, work the action list in order, complete
   actions, add new ones as they arrive.
3. **Log evidence.** Record training, nutrition, weight, a photo or symptoms
   as the day goes — from Quick Log or from a planned item.
4. **Plan ahead.** Use Plan to set up a coming day or week, including meals
   and training.
5. **Close the day.** Use Evening Wind-down to close today while it is still
   today — food log, day status, exposure check, accountability, tomorrow.
6. **Recover a day.** Use Catch-up the next morning for whatever the evening
   did not close. A day already closed is reported, not re-asked.
7. **Recover unfinished work.** Review the Backlog and deliberately pull
   selected items onto a chosen day.
8. **Hand the day to Claude.** Export the Daily Handoff as structured text
   and paste it into an external tool.
9. **See progress.** Read Progress and Focus: trends, stats, priorities,
   level and streak.

## Product principles

Carried from `PROJECT_LEDGER.md`. These are the durable ones.

- **Today before history.** The current day is the default answer to "what
  should I be looking at?".
- **Direction before productivity.** Longer-term priorities are the point;
  task throughput is only evidence.
- **Evidence before encouragement.** Ledger reports what actually happened.
  It does not flatter.
- **Missing data is not failure.** A blank field is a blank field. Ledger
  never calls it late, missed, overdue or failed.
- **Minimum viable wins when life is disrupted.** A disrupted day should
  still have a version of success.
- **Whole-life understanding without daily overload.** Ledger can hold
  everything; it must not show everything at once.
- **Ledger recommends; Shaun decides.** No automatic carry-forward, no silent
  rescheduling, no assumed causation.
- **Privacy by design.** This is personal health and life data.
- **Earned and explainable gamification.** Progress signals must be traceable
  to real recorded effort.
- **Editable goals rather than hardcoded assumptions.** Priorities, targets
  and circumstances change.
- **Start small and let the system grow through real use.** Features earn
  their place by being used.

## Current primary surfaces

Five tabs. The order is itself a product decision and should not be changed
casually.

| Surface | Purpose |
| --- | --- |
| **Plan** | What I intend over the coming days. Whole-day week summaries; each day opens as a Day Plan (Direction, Actions, Health & fitness, Constraints, Day Notes) over the same records as Today. Meal ideas library. |
| **Today** | The execution surface, in two modes: **Overview** (the editable day) and **Flow** (the day's timeline: actions and training in the order they will be worked; untimed items are a sequence, timed items sit at their time). Morning Prime (Plan, Move), Actions, Health & fitness, Day Notes, Quick Log, Evening Wind-down, Recorded Activity, Backlog, Catch-up, Daily Handoff. |
| **Calendar** | What actually happened. Month view with an activity filter, day detail (Planned, Recorded, Outcome), day status. |
| **Progress** | Am I moving there? Towards your focus, weekly chart, health and training stats, stat detail. |
| **Focus** | Where am I going? Player card, priorities (optionally linked to evidence), active focus, target weight, Settings. |
| **Communications** | Who has the ball? Matters and the conversations inside them, by attention state. Reached from Today on a phone (not a tab); a sidebar entry on wider screens. |

Today is the centre of the product. Everything else supports it.

## Key product concepts

- **Plan vs evidence.** A planned activity and a recorded activity are
  distinct records that are linked, never merged. Planning something does not
  make it true.
- **Key tasks.** Morning Prime chooses three per day. They are ordinary
  actions carrying a flag, not a separate list. The flag does not survive a
  date change — each day chooses its own three.
- **Two orderings.** Order view holds one global execution sequence for the
  day; Groups view holds an order within each category. They answer different
  questions and must never overwrite each other.
- **Optional times.** An action or planned session may be given a time and a
  duration; most are not. Untimed work is an order, timed work sits at its time,
  and Ledger never sets or moves a time by itself.
- **Backlog.** Actions assigned to an earlier date and not completed surface as a recovery layer derived at
  read time. Nothing ever moves to an active day on its own.
- **Inbox (reserved).** The future home for unprocessed capture — something noted
  but not yet decided (what it is, when, whether it is an action, matter or note).
  Not built; the word is not used for Backlog.
- **Exposure vs symptoms.** A suspected gluten exposure belongs to the date
  the food was eaten. A symptom episode belongs to the date the symptoms were
  noticed. Any link between them is recorded and worded as *possible*, never
  as proven cause.
- **Daily Handoff.** A stable, structured plain-text export of one day, in a
  fixed section order, inventing nothing. It opens with Previous Day Cleanup so
  external tools can be reconciled before today's work is created.
- **Day Notes.** Freeform text for one date. Context and thinking, never parsed
  into Actions — a note becomes work only when it is written as an action.
- **Routines.** Morning Prime and Evening Wind-down are editable ordered lists,
  stored as a preference. Where Ledger holds a record of a step, that record
  decides whether the step is done — a tick is only for steps nothing else
  answers.
- **Matter, Conversation, Action.** A Matter is the wider ongoing piece of life
  or work; a Conversation is the communication thread with its context; an
  Action is the ordinary executable commitment, optionally linked to either.
  Waiting is a state of a conversation, never a task. Completing a
  communication action asks what happens next; it never closes the Matter.
  Communications are whole-life — family and friends as much as clients.
- **One closure.** A day is closed once. Wind-down closes it in the evening,
  Catch-up closes it the next morning; both write the same `closedAt`.

## What Ledger deliberately is not

- Not a multi-user or team product.
- Not a general task manager competing with Todoist.
- Not a calendar replacement.
- Not an email client, a messaging app or a CRM — Communications tracks who
  has the ball, not the messages themselves.
- Not a habit-streak app that rewards self-report over evidence.
- Not an automatic scheduler — it does not move work without being told.
- Not a system that carries unfinished work forward silently.
- Not a diagnostic tool — it records possible correlations, never conclusions
  about cause.
- Not a framework application. The zero-build, single-file architecture is a
  current property of the repository, under review (see
  `docs/ROAD_TO_SHIPPABLE.md` §12), not an aspiration to be modernised away.

## Relationship to Claude and external tools

Only one relationship has actually been decided and implemented.

- **Ledger is the source of truth for planning the day.** The plan is made in
  Ledger.
- **Claude is the bridge.** The Daily Handoff exports the day as structured
  text with a fixed section order and an optional instruction footer. It is
  copied or shared manually.
- **Explicitly out of scope, as agreed:** direct API calls from Ledger to
  Claude, Todoist or FlowSavvy, and any automatic external syncing. The
  handoff is a text export that a human moves.

**NotePlan, FlowSavvy and Todoist** have no documented integration decision
beyond the exclusion above. Where they appear, they are destinations a human
pastes into. Do not infer a roadmap from this section — any integration is an
open product decision.

## Partner Sharing

Ledger stays private. A partner (Abi) gets a calm view of what the owner chooses
to share, and a simple way to ask for something. She does not get access to
Ledger.

- **A projection, not access.** Publishing writes share-safe display data (a
  title, a day, a status) into shared collections. The partner never reads a
  private record, and no filtered view of private data exists.
- **Live after publishing, never published automatically.** A day or a week is
  shared only when the owner publishes it. After that, it follows the day:
  completed, moved and newly added Actions in shared categories update without
  republishing. A day or week that has passed stays as it was shared.
- **Presets are allow-lists.** Sections and Action categories are shared only
  when named. The partner's default: key outcomes, Family and Personal Actions,
  training. Never Day Notes or Communications. The owner reviews exactly what
  will be shown, and can leave items out, before publishing.
- **The partner's Ledger** is two views, Today and This week, plus her requests
  ("From you") and the week's checkpoint. Rows and whitespace. No scores, no
  shaming, no admin.
- **Requests are capture, not Actions.** A request lands in the owner's
  **Inbox** (separate from Backlog). Today or Choose day makes one ordinary
  Action, marked as from the partner. Dismiss sets it aside. The request then
  follows its Action: Planned, Done, or back to Requested if the Action
  disappears. Never Done unless it was done.
- **Each request has Updates**: a short shared history, not a chat. It holds what
  either side wrote ("Tried twice, no answer", "They need it tomorrow now") and
  the meaningful things that happened (asked, planned, moved, in progress, done,
  set aside, withdrawn). The current status stays simple; the Updates carry the
  nuance. An update never changes the Action: "Can this be Friday?" is
  information, and the owner decides. Nothing private flows into Updates
  automatically. A new update from the other side shows quietly ("Abi updated ·
  20m"). For the owner, a processed request with news from Abi returns to the
  Inbox as one row (Update from Abi → Review), never as a second task.
- Image sharing is separate and unchanged. Share image is a one-off picture for
  anyone. Publish to Abi is the live view.

Not yet: notifications of any kind, more than one partner, general chat or
comments outside requests, attachments, reactions, mentions, the partner editing
Actions, calendar sharing.

## Privacy and data

- Firebase Firestore (project `ledger-6aec3`) with a complete localStorage
  fallback. The app is required to work with no network and no Firebase config.
- Ten collections, listed in `PROJECT_LEDGER.md` → Current State.
- The data is personal: health, food, symptoms, weight, photographs, plans.
- **Access:** Firebase Authentication (email link) and owner-only Firestore
  rules (`firestore.rules`, `docs/SECURITY.md`). The client config is public by
  design; the rules, not secrecy, protect the data.
- **Partner data:** a partner reads only the shared collections, only their
  own, and only while sharing is active. This is enforced by the rules, not by
  the app. A partner's device never loads the owner's stored data.

## Product success principles

Ledger is succeeding when:

1. It gets opened without deciding to open it.
2. Priming the morning takes under a minute.
3. Logging something real is faster than not logging it.
4. A disrupted day still closes honestly instead of being abandoned.
5. What it reports back is believed, because it is evidence.
6. Nothing is lost — no action, no record, no day.
7. It stays out of the way for the other twenty-three hours.

Shippable means the eight core journeys above work reliably, on a phone,
in both themes, without data loss. It does not mean feature-complete.
