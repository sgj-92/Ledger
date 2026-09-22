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

One user. No accounts, no login, no multi-user model, no sharing.

This is a deliberate scope boundary, not an unfinished feature. It is also the
reason the security posture is what it is — see
[Privacy and data](#privacy-and-data).

## Core loop

```
Plan → Do → Track → Review → Adjust
```

- **Plan** — decide what the day contains: meals, training, key tasks, actions.
- **Do** — execute from Today, the day's working surface.
- **Track** — record what actually happened as real evidence, not self-report.
- **Review** — close the day honestly, including the parts that did not happen.
- **Adjust** — carry the reality of one day into the planning of the next.

Every surface in Ledger should be identifiable as one of these five stages. A
feature that does not serve the loop needs a reason to exist.

## Core user journeys

These are the journeys that must always work. They are the basis of the
release checklist and of any future automated smoke suite.

1. **Prime the morning.** Open Today, run Morning Prime: acknowledge meals,
   choose three key tasks, finish Today's Plan, set an intention.
2. **Work the day.** Read Today, work the action list in order, complete
   actions, add new ones as they arrive.
3. **Log evidence.** Record training, nutrition, weight, a photo or symptoms
   as the day goes — from Quick Log or from a planned item.
4. **Plan ahead.** Use Plan to set up a coming day or week, including meals
   and training.
5. **Close a day.** Use Catch-up to close a previous day against its real
   records — actions, training, nutrition, overall status, notes.
6. **Recover unfinished work.** Review the Backlog and deliberately pull
   selected items onto a chosen day.
7. **Hand the day to Claude.** Export the Daily Handoff as structured text
   and paste it into an external tool.
8. **See progress.** Read Progress and Focus: trends, stats, priorities,
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
| **Plan** | The week ahead: per-day summaries and the meal ideas library. |
| **Today** | The execution surface. Morning Prime, Actions, Today's Plan, Quick Log, Recorded Activity, Backlog, Catch-up, Daily Handoff. |
| **Calendar** | Month view, day detail, day status. |
| **Progress** | Weekly chart, health and training stats, stat detail. |
| **Focus** | Player card, priorities, target weight, focus items, appearance. |

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
- **Backlog.** Unfinished past actions surface as a recovery layer derived at
  read time. Nothing ever moves to an active day on its own.
- **Exposure vs symptoms.** A suspected gluten exposure belongs to the date
  the food was eaten. A symptom episode belongs to the date the symptoms were
  noticed. Any link between them is recorded and worded as *possible*, never
  as proven cause.
- **Daily Handoff.** A stable, structured plain-text export of one day, in a
  fixed section order, inventing nothing.

## What Ledger deliberately is not

- Not a multi-user or team product.
- Not a general task manager competing with Todoist.
- Not a calendar replacement.
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

## Privacy and data

- Firebase Firestore (project `ledger-6aec3`) with a complete localStorage
  fallback. The app is required to work with no network and no Firebase config.
- Ten collections, listed in `PROJECT_LEDGER.md` → Current State.
- The data is personal: health, food, symptoms, weight, photographs, plans.
- **Known conflict:** Firestore rules are currently fully open and the client
  config sits in a public repository. This was accepted knowingly for a
  single-user app with no login, and it contradicts "Privacy by design". It is
  tracked as an Issue, not as a settled decision.

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
