# Ledger Project Ledger

Shared coordination file for Shaun, ChatGPT, Claude Chat and Claude Code.
Last updated: 2026-09-22 (against `main` @ `c7c37b1` + product-development infrastructure)

---

## Current State

Ledger is a **single-file PWA**: the entire app (HTML, CSS, JS) lives in
`index.html` (~8,000 lines, no build step, no framework, ES5-style vanilla JS).
Supporting files: `sw.js`, `manifest.json`, `fonts/` (self-hosted Playfair
Display + Inter woff2 subsets), `hero-mountain.webp`, icons, `avatars/`,
and `functions/` (one Firebase Cloud Function).

**Five tabs:** Plan · Today · Calendar · Progress · Focus.

### Today (the main surface)
- **Morning Prime** — a 4-step daily setup: plan meals → three key tasks →
  finish Today's Plan → set intention. Collapses to a single "Completed at
  HH:MM" row once done. Stored as `plan.morningPrime` on the day's plan record.
- **Actions** — collapsible section with two independent views:
  - **Order view**: one numbered execution sequence for the day, drag to reorder.
  - **Groups view**: collapsible category sections, each with its own internal order.
  - Orders stored separately as `plan.actionOrder` and `plan.groupOrder[category]`.
  - Reordering is pointer-event based (HTML5 drag-and-drop does not work on touch).
- **Key tasks** — Morning Prime's three; normal actions flagged `isKeyTask`,
  marked in both views with a gold star, gold left edge and a `Key` pill.
- **Add action** — compact disclosure holding Quick add and Detailed add.
- **Backlog** — unfinished actions from past dates; bounded 3-row preview on
  Today plus a full sheet (sort by Group/Date, filter, Add to today, Pick a day).
- **Today's Plan** — 2×2 card grid (Training / Meals / Roadblock / Diet),
  with a share control for Daily Handoff.
- **Quick Log** — collapsible grid: Nutrition, Weight, Daily photo, Padel,
  Cardio, Resistance, Mobility, Symptoms.
- **Recorded Activity** — collapsible, with a summary in its header.
- **Catch-up** — closes a past day against its real records (actions tally,
  logged training, nutrition state, overall status, notes).
- **Daily Handoff** — "Share day" → structured text export for Claude, with an
  optional instruction footer; clipboard + Web Share API.

### Other tabs
- **Plan** — 7-day week list with per-day summaries; meal ideas library.
- **Calendar** — month grid, day detail, day status.
- **Progress** (`view-stats`) — weekly bar chart, health & training stat cards,
  stat detail sheets.
- **Focus** — player card (XP/level/tier/streak/avatar), priorities, target
  weight, focus items.

### Nutrition
Daily checks (gluten-free, minimal processed, water, water amount, suspected
gluten exposure), food diary, day rating, calories. Lifecycle: **In progress**
vs **Day logged/Closed**. Exposure records source/time/confidence/note only;
**symptom episodes are a separate dated session type** (`type: 'symptom'`) with
their own onset date/time and an optional *possible* link to an exposure.

### Training
Planned training lives in `plan.trainingDetails[type]`; logging opens the same
activity form pre-filled and creates a real session linked via `sessionId`.

### Gamification / XP
Focus tab shows a player card: XP → level → tier (Rookie, Grinder, Contender,
Competitor, Veteran, Elite) with per-tier avatar art and a day streak.
`computeXP()` is currently `sessions.length × 10 + completed focus items × 25`.

### Notifications / Pin Now
Web Push. Client writes to `ledger_pins`; `functions/index.js` (Firebase Cloud
Function, `onDocumentCreated`) sends the push via `web-push`. VAPID private key
lives in Secret Manager, never in the repo. Device subscriptions in
`ledger_push_subscriptions`.

### Theming
Three modes — **Dark** (default and primary identity), **Light** (warm parchment
editorial), **System** (follows `prefers-color-scheme`, live). Resolved theme
sits on `<html data-theme>`; every component reads semantic tokens only. An
inline pre-render bootstrap in `<head>` applies the stored choice before first
paint. Preference in `localStorage` under `ledger_theme`. Control lives in
Focus → Appearance. `<meta name="theme-color">` updates with the theme.

### Development workflow
GitHub Issues are the backlog. The repository carries its own product
documentation in `docs/` (`PRODUCT.md`, `UX_PRINCIPLES.md`,
`DESIGN_SYSTEM.md`, `ROAD_TO_SHIPPABLE.md`, `RELEASE_CHECKLIST.md`) and Issue
templates in `.github/ISSUE_TEMPLATE/`. Labels are two axes only — one `type:`
and one or more `area:` — never status and never priority. Capturing an Issue
does not authorise building it; see the workflow rules in `CLAUDE.md`.

**The GitHub Project is not yet created** — see Open Questions 7.

### Persistence
Firebase Firestore (project `ledger-6aec3`) with a **full localStorage
fallback** — the app works entirely offline/unconfigured. Collections:
`ledger_commitments`, `ledger_plans`, `ledger_sessions`, `ledger_day_status`,
`ledger_priorities`, `ledger_focus`, `ledger_meals`, `ledger_meta`,
`ledger_pins`, `ledger_push_subscriptions`. Live `onSnapshot` listeners drive
re-renders. Deployed to GitHub Pages (`https://sgj-92.github.io/Ledger/`).

---

## Product Vision

Ledger is a private personal operating system for Shaun.

Its core loop is:

Plan → Do → Track → Review → Adjust

The app should:
- give clarity and structure
- connect longer-term direction to daily action
- support whole-life planning without showing everything all the time
- make progress visual and motivating
- provide honest, evidence-based accountability
- adapt when work, family or life disrupts plans
- remain simple, fast and phone-first
- recommend; Shaun decides
- keep goals, priorities and circumstances editable rather than hardcoded

---

## Product Principles

- Today before history
- Direction before productivity
- Evidence before encouragement
- Missing data is not failure
- Minimum viable wins when life is disrupted
- Whole-life understanding without daily overload
- Ledger recommends; Shaun decides
- Privacy by design
- Earned and explainable gamification
- Editable goals rather than hardcoded assumptions
- Start small and let the system grow through real use

---

## Agreed Architecture

Conventions that should not be casually changed.

- Today actions use the same action records across views.
- Order view stores a global daily execution order.
- Groups view stores a separate within-group order.
- Switching Order/Groups must not destroy the other order.
- Category/group changes move a task between groups without duplicating it.
- Morning Prime uses existing Ledger actions and plan data rather than
  duplicate task/meal systems.
- Morning Prime key tasks are normal actions with a key-task marker.
- Morning Prime and Today's Plan must share the same underlying data.
- Planned activities and recorded activities are distinct but linked.
- Planned activity can pre-fill the actual log.
- Planned meals become nutrition evidence when marked eaten.
- Nutrition can be saved in progress or explicitly closed.
- Recorded Activity should distinguish Nutrition In progress from
  Day logged/Closed.
- Backlog holds unfinished historical actions; items are only moved to
  Today/future dates deliberately.
- Catch-up closes the actual previous-day record rather than creating a
  disconnected copy.
- Catch-up must reflect already-recorded training, actions and nutrition.
- Suspected gluten exposure date/time and symptom onset date/time are separate
  concepts.
- Possible exposure-to-symptom links must remain explicitly suspected, not
  treated as proven causation.
- Daily Handoff exports Ledger day data in a stable structured format for Claude.
- Today is an execution surface, not merely a read-only summary of Plan.
- Same data should use the same editor wherever possible.
- Main branch may be used unless Shaun explicitly requests otherwise.

### Implementation conventions observed in code
- Single-file app: all product code in `index.html`. No build step.
- ES5-style vanilla JS (`var`, function expressions) to match existing code.
- Per-date state lives on the day's plan record (`ledger_plans/<date>`);
  per-device UI preferences live in `localStorage`.
- Order/group hints are **sparse**: unlisted ids sort after listed ones by
  creation order, so new actions land at the bottom with nothing written and
  no migration is needed.
- Forms must build on top of the existing record (`Object.assign`), never
  rebuild it from scratch — doing so has silently destroyed sibling fields
  three separate times (see Decisions Log).

---

## Decisions Log

### 2026-09-22 — Capture is separate from implementation; GitHub holds the backlog
**Decision:** GitHub Issues become the canonical backlog for discrete work,
with a two-axis label taxonomy (`type:` × `area:`). Workflow status and
priority live on the GitHub Project, never on labels. Durable product
definition moves to `docs/PRODUCT.md`, interaction standards to
`docs/UX_PRINCIPLES.md`, the visual audit to `docs/DESIGN_SYSTEM.md`, the
quality framework to `docs/ROAD_TO_SHIPPABLE.md` and the release gate to
`docs/RELEASE_CHECKLIST.md`. An Issue existing does not authorise
implementation — Claude Code builds only on an explicit ask from Shaun or an
active handoff here.
**Why:** Recording a problem had come to imply fixing it immediately, which
made every observation expensive to mention. A backlog lets an idea be
captured, and deliberately not built, without pressure.
**Implications:** This file stops being the place discrete problems are
listed; reference Issue numbers instead. `docs/DESIGN_SYSTEM.md` is an audit
of what the UI currently is, including its inconsistencies — it is not a spec
to conform code to, and items it marks *Needs design decision* are product
calls, not cleanups.

### 2026-09-21 — Theme is a device-level setting over semantic tokens
**Decision:** Ledger supports Dark, Light and System. The preference is a
device-level UI setting stored in `localStorage` (`ledger_theme`), never in
Firestore. System follows `prefers-color-scheme` and reacts live; an explicit
Dark or Light ignores the OS. Dark remains the default and the primary visual
identity. All visual components depend on semantic theme tokens rather than
assuming dark.
**Why:** The same product should work in an evening and on a desk in daylight
without becoming a different app — and without a second stylesheet to maintain.
**Implications:** Only tokens change between themes; no component knows which
theme it is in. Light is a deliberate palette (parchment / cream / espresso /
antique gold), not an inversion. The hero photograph is theme-driven via
`--hero-*` tokens — lit at night, a pressed watermark on paper. Colours that
carry meaning (the eight category accents, four day-status colours, six rank
tiers) keep their hue and are adjusted only for legibility. Contrast was
measured, not eyeballed: light finished at 1 flagged item against dark's 97
existing.

### 2026-09-18 — Two independent action orderings
**Decision:** Order view and Groups view maintain separate stored orderings
(`plan.actionOrder`, `plan.groupOrder[category]`); neither is derived from the
other.
**Why:** They answer different questions — "what next?" vs "how is my day
organised?". A single ordering forced one to destroy the other.
**Implications:** Both stored per date on the plan record. Sparse hints mean no
migration and free bottom-append for new actions. Today's Actions no longer
groups by linked priority — Groups view is category-only.

### 2026-09-18 — Key-task standing does not survive a date change
**Decision:** `isKeyTask` is cleared whenever an action is rescheduled.
**Why:** Each day's Morning Prime chooses its own three. A moved task would
otherwise arrive pre-flagged on a day that never selected it, and silently
consume that day's allowance.
**Implications:** Applies to both the Backlog move and the action editor.

### 2026-09-15 — Exposure and symptoms are separate dated records
**Decision:** Suspected gluten exposure stays on the nutrition record for the
day the food was consumed (source, meal/time, confidence, note). Symptoms are a
separate `type: 'symptom'` session with their own onset date/time and an
optional `possibleExposureId`.
**Why:** Symptoms usually appear the following morning. Collapsing both onto one
date would make later pattern analysis dishonest.
**Implications:** Links are stored and worded as *possible*, never causal. Stats
count exposures and symptom episodes separately and report only recorded links.
Catch-up may prompt for symptoms after a previous-day exposure but must never
assume they occurred.

### 2026-09-15 — Catch-up closes the real day record
**Decision:** Catch-up derives every block from that date's own records and
merges its result onto `ledger_day_status/<date>`.
**Why:** It was a disconnected status picker that ignored everything Ledger
already held.
**Implications:** "Open nutrition" opens that date's actual entry preloaded;
training hands over to the real activity form. Only the judgements no record can
infer (overall status, notes) originate in the sheet.

### 2026-09-15 — Daily Handoff is a stable structured export
**Decision:** A fixed section order (date, intention, key tasks, other actions,
today's plan, roadblocks, status) rendered as plain text, with an optional
Claude-instruction footer.
**Why:** Ledger is the source of truth for planning; Claude is the bridge into
external tools. A predictable shape makes it parseable.
**Implications:** No ids or storage fields are emitted. Nothing is invented — an
action with no recorded time has none. Backlog items appear as context only,
explicitly marked as not today's work.

### 2026-09-15 — Morning Prime includes Today's Plan as a step
**Decision:** "Finish Today's Plan" is step 3; completion is recorded as
`plan.planReviewedAt` when the plan sheet is saved.
**Why:** Planning was two disconnected systems. Reviewing and saving the plan is
the honest completion signal — it does not demand every field be filled.
**Implications:** Morning Prime guides the plan rather than restating it, and
cannot complete until the plan step passes.

### 2026-09-13 — Backlog is a recovery layer, never auto-carry-forward
**Decision:** Unfinished past actions surface in a Backlog derived at read time;
nothing moves to an active day unless deliberately pulled there.
**Why:** Backlog is unresolved history; Today is consciously chosen work.
**Implications:** Membership is a filter (past date, not completed, not a
roadblock). `originalDate` preserves when an action was first written down;
`date` is where it is scheduled now.

### 2026-09-12 — Morning Prime reuses existing records
**Decision:** Key tasks are ordinary actions flagged `isKeyTask`; the meals step
is a view over `plan.meals`. No parallel Morning Prime task or meal type.
**Why:** One source of truth; nothing to keep in sync.
**Implications:** Editing meals in Morning Prime immediately changes Today's Plan
and Nutrition sync.

### 2026-09-12 — Forms must preserve the record they edit
**Decision:** Every editor builds on top of the existing record rather than
constructing a fresh object.
**Why:** Rebuilding silently dropped fields the form did not name — this
destroyed `isKeyTask` (action editor) and `morningPrime` (plan sheet) before
being caught.
**Implications:** Treat "rebuild from scratch" as a bug pattern in review.

### 2026-09-11 — Firestore rules left fully open
**Decision:** `allow read, write: if true`, accepted knowingly for a
single-user app with no login.
**Why:** No auth exists; the app must work immediately on Shaun's phone.
**Implications:** Anyone with the project ID could read/write all personal data
or write to `ledger_pins` to push arbitrary notifications. Revisit before any
wider exposure — see Open Questions.

---

## Current Task

Owner: None
Status: Ready
Objective: No active implementation task. Await next handoff.
Acceptance criteria: N/A

The backlog now exists as GitHub Issues (#5–#19). None of it is authorised for
implementation — see the workflow rules in `CLAUDE.md`.

---

## Open Questions

Each question that became a discrete piece of work now has an Issue. The Issue
carries the detail; this list records that the question is still open.

1. **Firestore rules vs "Privacy by design".** Rules are fully open and not in
   the repo (no `firestore.rules`; `firebase.json` deploys functions only).
   Knowingly accepted, but it conflicts with the stated principle. Options
   previously offered: scope rules per collection, App Check, or real auth.
   → **#5** (proposed P0). Sharpened by audit: the repository is public and the
   client config is committed, and `ledger_pins` is writable by anyone, which
   means arbitrary push notifications to the phone.
2. **XP is not yet "earned and explainable".** `computeXP()` is
   `sessions.length × 10 + completed focus items × 25` — every session counts
   equally regardless of effort or evidence quality, and nothing in the UI
   explains where XP came from. Conflicts with the gamification principle.
   → **#11** (proposed P2). Needs a product decision before implementation.
3. **Two overlapping day-review flows.** `openReviewDaySheet` (older,
   per-action status then overall day) still exists and is reachable from the
   header and calendar day detail, alongside the newer `openCatchUpSheet`.
   Decide whether Review day should be retired, merged, or kept for a distinct
   purpose.
   → **#12** (proposed P2).
4. **Priority grouping was dropped from Today.** Groups view is category-only.
   Priorities remain on the action, in its editor and in the Handoff export.
   Confirm this is the intended end state, or whether priority deserves a
   third view. *No Issue filed* — this is a question about intent with no
   confirmed problem behind it. It becomes an Issue if the answer is “no”.
5. **Light-mode refinements still open.** The six rank-tier colours are fixed
   values set inline by JS; on parchment the level chip needs a darkening
   overlay to stay legible, and Rookie/Grinder read faintly as ring and XP-bar
   fills. A tier palette that adapts per theme would be cleaner, but the
   colours carry rank meaning so it is a product decision, not a styling one.
   → **#15** (proposed P3).
6. **No automated tests or CI.** Verification to date has been manual Playwright
   scripting in the working session, none of it committed. Decide whether a
   minimal smoke suite belongs in the repo.
   → **#18** (proposed P2), with a staged approach so it can stop where it
   stops paying for itself.

7. **The GitHub Project does not exist yet.** GitHub Projects v2 is a
   GraphQL-only API, and GraphQL is blocked from Claude Code sessions, so the
   board, its Status column and its Priority field could not be created here.
   Until Shaun creates it, workflow status and priority live only as proposed
   values written into each Issue body. The intended configuration is recorded
   in the delivery report and takes a few minutes in the GitHub UI.

---

## Handoffs

### ChatGPT

No active handoff.

### Claude Chat

No active handoff.

### Claude Code

No active handoff. Collaboration files are set up; await a new explicit handoff.

---

## Recently Completed

- (2026-09-22) — Product-development infrastructure: Issue labels (two axes),
  Issue templates, five `docs/` files, GitHub workflow rules and the
  `Ledger Capture` protocol in `CLAUDE.md`, and 15 seeded Issues (#5–#19)
  from a repository audit. No product code changed.
- (2026-09-21) — Theme system: Dark / Light / System, semantic token layer,
  no-flash bootstrap, Appearance control in Focus, theme-aware hero and
  `theme-color`. Dark unchanged.
- `1f6cd15` (2026-09-18) — Actions gains two independent orderings (Order /
  Groups), collapsible sections, collapsible Actions header, pointer-based drag.
- `d622326` (2026-09-18) — Key tasks made visible in the Today list (gold star,
  edge, `Key` pill); key-task flag no longer survives a date change.
- `a15bcae` (2026-09-15) — Daily Handoff export; Morning Prime gains the
  "Finish Today's Plan" step; plan sheet no longer wipes `morningPrime`.
- `1d1c874` (2026-09-15) — Catch-up rebuilt against real day records; gluten
  exposure and symptom episodes separated into distinct dated records;
  Nutrition scroll-trap fixed with a sticky action bar.
- `459be3e` (2026-09-14) — Today density pass; Today's Plan brought above the fold.
- `b646870` (2026-09-14) — New gold mountain app icon across all sizes.
- `696823d` (2026-09-13) — Backlog system added.

---

## Next

1. **Shaun:** create the GitHub Project (Open Q7). Configuration is recorded in
   `docs/ROAD_TO_SHIPPABLE.md` → Appendix. Nothing else can be prioritised
   properly until it exists.
2. Decide on #5 (open Firestore rules on a public repository). Proposed P0, and
   the only seeded Issue proposed above P1.
3. Triage #6–#19 into the board, then decide what, if anything, to build.

Everything else is on the board. Do not duplicate it here.
