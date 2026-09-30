# Ledger Project Ledger

Shared coordination file for Shaun, ChatGPT, Claude Chat and Claude Code.
Last updated: 2026-09-30 (responsive desktop and ultrawide layout)

---

## Current State

Ledger is a **single-file PWA**: the entire app (HTML, CSS, JS) lives in
`index.html` (~10,500 lines, no build step, no framework, ES5-style vanilla JS).
Supporting files: `sw.js`, `manifest.json`, `fonts/` (self-hosted Playfair
Display + Inter woff2 subsets), `hero-mountain.webp`, icons, `avatars/`,
and `functions/` (one Firebase Cloud Function).

**Five tabs:** Plan · Today · Calendar · Progress · Focus.

### Responsive layout (one app, one URL)
The same page adapts by viewport width; there is no desktop build, route or flag.
- **< 768px (phone):** unchanged mobile-first layout, bottom tab bar, bottom sheets.
- **768–1199px:** the tab bar becomes a left icon rail (Settings and Quick add at
  its foot); a shallow horizontal header replaces the phone hero. Content is one
  column; sheets stay bottom sheets below 1024px.
- **≥ 1024px:** Today becomes a workspace — Morning Prime / Catch-up across the
  top, Actions + Backlog in the main column, Health & fitness beside it, then Day
  Notes (an inline, autosaved notebook) with Quick log, Wind-down and Recorded.
  Sheets open as a right-hand **inspector**. Plan is week list + selected-day pane;
  Calendar is month + day pane; Progress puts Towards your focus beside the week
  chart with the stat cards in a grid; Focus is two columns.
- **≥ 1200px:** full labelled sidebar (Ledger mark, five views, Quick add, Settings).
- **≥ 1600px:** Today gains a third column (Day Notes and the evening sections).
- The workspace is capped at 1680px and centred; the inspector aligns to it.
- Every wide breakpoint also needs 520px of height, so a phone turned sideways
  keeps the phone layout.

### Today (the main surface)
- **Morning Prime** — two sections, tracked separately. **Plan** is what can be
  done from the phone before getting up (meals → three key tasks → finish health
  & fitness → intention); **Move** is the physical start (weigh-in, body photo,
  supplements, water, stretch). Header reads `Plan ✓ · Move 3/5`, and collapses
  to "Completed at HH:MM" once both are complete. Stored as `plan.morningPrime`;
  manual ticks in `plan.morningPrime.checks[section]`.
- **Evening Wind-down** — a compact collapsible section that closes today while
  it is still today: finish food log, review food/day status, review suspected
  gluten exposure, accountability check-in, review tomorrow. Most items derive
  their state from real records. Closing writes `windDown.completedAt` and
  `closedAt` onto `ledger_day_status/<date>`.
- **Actions** — collapsible section with two independent views:
  - **Order view**: one numbered execution sequence for the day, drag to reorder.
  - **Groups view**: collapsible category sections, each with its own internal order.
  - Orders stored separately as `plan.actionOrder` and `plan.groupOrder[category]`.
  - Reordering is pointer-event based (HTML5 drag-and-drop does not work on touch).
- **Key tasks** — Morning Prime's three; normal actions flagged `isKeyTask`,
  marked in both views with a gold star, gold left edge and a `Key` pill.
- **Add action** — a `+` in the Actions section header; it opens a panel
  under the list holding Quick add and Detailed add.
- **Backlog** — unfinished actions from past dates. On Today it is a compact
  3-row shelf (category · added date · state on one meta line, icon controls for
  Add to today and Choose a day). The full sheet stays spacious and labelled
  (sort by Group/Date, filter, Add to today, Pick a day).
- **Health & fitness** — 2×2 card grid (Training / Meals / Roadblock / Diet),
  with a share control for Daily Handoff. Called **Today's Plan** until
  2026-09-22.
- **Day Notes** — freeform text for one date, one compact row on Today between
  Health & fitness and Quick Log; opens a sheet with autosave. Context and
  thinking, never parsed into Actions. Stored as `plan.dayNotes`.
- **Quick Log** — collapsible grid: Nutrition, Weight, Daily photo, Padel,
  Cardio, HIIT, Resistance, Mobility, Symptoms.
- **Recorded Activity** — collapsible, with a summary in its header.
- **Catch-up** — the recovery layer for whatever the evening did not close.
  Reads the day's real records *and* its Wind-down state: anything already
  resolved is reported as a ✓ line instead of asked again, and a day closed in
  the evening is not listed as pending at all.
- **Daily Handoff** — "Share day" → structured text export for Claude, with an
  optional instruction footer; clipboard + Web Share API. Carries Day Notes when
  non-empty, headed `DAY NOTES UPDATED` when they have changed since the last
  copy or share. Opens with a
  **Previous Day Cleanup** section (completed / partially completed / moved
  forward, each with categories) so Claude can reconcile Todoist and FlowSavvy
  before touching today. Read-only — the export reports state, never changes it.

### Routines and Settings
Morning Prime (Plan, Move) and Evening Wind-down are **editable routines**:
reorder, enable/disable, rename, add and delete custom items. The definition is
a preference, stored in `presets.routines` (`ledger_meta/presets`), so it follows
Shaun across devices. Daily completion belongs to the date. Settings is a sheet
reached from **Focus → Settings**, holding Appearance (Dark/Light/System), the
two Morning Prime routines, the Wind-down routine and its prominence hour.

### Other tabs
- **Plan** — 7-day week list with per-day summaries; meal ideas library.
The three reflective tabs have one job each: **Focus** — where am I going?
**Progress** — am I moving there? **Calendar** — what actually happened?
- **Calendar** — month grid with an activity filter (All, Training, Padel,
  Resistance, HIIT, Cardio, Mobility, Weight, Nutrition), day detail reading
  Planned → Recorded → Outcome, day status. A filter chosen from Progress holds
  for that visit; any other way in shows everything.
- **Progress** (`view-stats`) — **Towards your focus** (each priority that names
  its evidence, with a factual signal), then the weekly bar chart, the health &
  training stat cards and their detail sheets. A detail sheet names the priority
  it supports and links to those days in Calendar.
- **Focus** — player card (XP/level/tier/streak/avatar), priorities (optionally
  linked to evidence, with a signal and **View progress →**), target weight,
  focus items (optionally supporting a priority), the entry to Settings, and at its foot a muted **build
  footer**: `Build 7f3a2c1 · 29 Sep, 04:31` / `Pages: Current`. Tapping it opens a
  small detail sheet.

### Nutrition
Daily checks (gluten-free, minimal processed, water, water amount, suspected
gluten exposure), food diary, day rating, calories. Lifecycle: **In progress**
vs **Day logged/Closed**. Exposure records source/time/confidence/note only;
**symptom episodes are a separate dated session type** (`type: 'symptom'`) with
their own onset date/time and an optional *possible* link to an exposure.

### Training
Five types: **Padel, Cardio, HIIT, Resistance, Mobility**. Planned training lives
in `plan.trainingDetails[type]`; logging opens the same activity form pre-filled
and creates a real session linked via `sessionId`. Plan saves are optimistic:
the in-memory plan is the saved plan at once, and the listener converges on it.
HIIT carries a freeform
`outline` alongside the shared location and duration. The Plan sheet's type
selector scrolls horizontally rather than shrinking five cards into a row.

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

### Build and deploy freshness
The deployed commit is stamped into `buildInfo.js` by the Pages build itself
(Money Padel's mechanism — see `CLAUDE.md` → Deploys and the build stamp).
Freshness compares three SHAs: **loaded** (the stamp this page was loaded with),
**served** (`buildInfo.js` fetched again with `no-store` — what Pages hands out
now) and **latest** (HEAD of `main` from GitHub's public, unauthenticated API).
served ≠ latest → `Pages: Update pending`; loaded ≠ served → `App: Refresh
available` and a quiet "New Ledger build available · Refresh" offer. Checked on
Focus and on returning to the app, at most every 10 minutes (GitHub allows 60
anonymous reads an hour). The service worker is a pure pass-through and cannot
pin an old build; staleness comes from Pages' 10-minute HTTP cache or an
installed app left open, both of which the check reports.

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
- Morning Prime and Health & fitness must share the same underlying data.
- Ledger is one responsive app. Phone uses the bottom nav and bottom sheets;
  desktop uses the left navigation, a multi-column Today and side inspectors.
  Wider screens rearrange the same DOM with CSS (Today's and Focus's wrappers are
  `display: contents` on phones); the few presentation differences in JS
  (inline Day Notes, the Plan day pane, a default Calendar day) call the same
  savers, editors and records. No separate desktop codebase or render path.
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
- The day has one lifecycle: Morning Prime prepares, Today executes, Evening
  Wind-down closes, Catch-up recovers, Calendar reviews history.
- Routine *definitions* are a device-independent preference; routine
  *completion* belongs to the date.
- A routine step linked to a Ledger record derives its completion from that
  record. Manual ticks exist only for steps no record can answer.
- Renaming a routine step changes its label, never its link.
- A day is closed once, by whichever surface got there first, and both
  Wind-down and Catch-up write the same `closedAt`.
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

### 2026-09-30 — One responsive Ledger for phone, laptop and ultrawide
**Decision:** the normal URL adapts by width (768 / 1024 / 1200 / 1600px). The
tab bar is the sidebar; Today's sections sit in four presentation wrappers that
are `display: contents` on a phone and grid columns from 1024px; sheets become a
right inspector from 1024px; the workspace is capped at 1680px.
**Why:** on a laptop the phone column wasted the screen, and Actions, the plan
and Day Notes could not be seen together.
**Implications:** mobile is verified pixel-for-pixel against the previous build
(28 dark + 14 light screenshots at 390/430px; one Morning Prime frame differs by
at most 6/255 in colour, invisibly). Day Notes on desktop autosaves through the
same `saveDayNotes` and never redraws under the cursor. Plan's pane and Today's
Health & fitness are one renderer (`renderPlanWidget`). Keyboard: Escape closes
a sheet via its own close button (so save-on-close still runs); Cmd/Ctrl+Enter
presses its primary action; keyboard focus is outlined. Hover styles apply only
to fine pointers. Between 768 and 1023px sheets remain bottom sheets.

### 2026-09-29 — Focus is direction, Progress is evidence, Calendar is what happened
**Decision:** the three tabs keep distinct jobs and are joined by shared records,
not by a new layer. Focus holds priorities (outcomes) and active focus
(behaviours/skills now; may support a priority, never has to). A priority may
optionally name its evidence (`evidenceType` on the priority record: weight,
all training, one training type, nutrition or linked actions). Progress opens
with **Towards your focus** for linked priorities; its detail sheets say which
priority they support and open Calendar filtered to that activity.
**Why:** the tabs were three unconnected views of the same records.
**Implications:** no scores, percentages or pass/fail colour: signals are counts
and the weight gap only (e.g. `96.1kg → 90kg · 6.1kg to go`, `2 sessions this
week · 3 this month`), and missing data reads as "none logged", never failure.
Qualitative priorities are valid with no link. Actions reuse their existing
`priorityId`; completed linked actions show on any priority. Weight uses the one
target under Targets rather than a second target on the priority. Counts reuse
the Progress cards' windows so the two tabs agree. XP is untouched. The priority
and focus editors now build on the stored record.

### 2026-09-29 — A saved plan is the plan immediately
**Decision:** `savePlanForDate` updates the in-memory plan before the Firestore
write and keeps it until that write settles; the plans listener re-applies any
plan still in flight. Training Details returns the plan it saved, and the Plan
sheet reopens from that plan, not from a lookup.
**Why (root cause):** with Firestore live, the plan changed only when the
snapshot arrived. Details saved without waiting, then reopened the Plan sheet
from the stale plan (training type unselected, details gone); pressing Save plan
then wrote that stale sheet over both. Reproduced under 700ms latency for HIIT:
after Save plan the stored plan had no types and no details. Every training type
was affected; localStorage mode never showed it.
**Implications:** verified for all five types (time, location, duration, notes
and each type's own fields) through reopen, close, reload, Today and the
Handoff. `activityTime` is now kept on planned details and shown in the Today
summary and Handoff. Plan deletion still waits for the snapshot (not changed).

### 2026-09-29 — Review Day answers are held by the sheet until the record confirms them
**Decision:** Review Day keeps its own record of what was chosen in the sheet,
reads every row through it, advances on the tap, and persists in the background;
the Firestore listener then confirms into the same sheet and the held choice is
released. One tap per step.
**Why (root cause):** with Firestore live, `saveCommitment` does not touch the
in-memory `commitments` — the `onSnapshot` listener does, one round-trip later.
The sheet re-rendered from `commitments` straight after the tap, so it drew the
same item again, and the handlers wired by that render still pointed at it. The
**second tap was saved against the first item**: reproduced under 700ms latency,
tapping Completed / Partial / Disrupted for three different actions wrote all
three to the first one and never reached the last two. It never showed with the
localStorage fallback, which updates memory synchronously.
**Implications:** each record is merged onto the latest copy, so `isKeyTask`,
`originalDate` and order survive. The item a grid answers for travels with the
grid (`data-id`), not in a closure. The overall-status stage now treats a day
closed by Wind-down as resolved, like the entry points already did. The item
title is now written as text rather than interpolated as markup. A failed save
releases the choice and says so.

### 2026-09-29 — The build says which commit it is; the app says whether that is current
**Decision:** Ledger adopts Money Padel's build stamp unchanged in principle —
the Pages build renders the commit into `buildInfo.js`, loaded with the page —
and adds what Money Padel does not have: an in-app comparison against what Pages
is serving and what GitHub has, and a quiet refresh offer.
**Why:** Shaun needs to know he is looking at the newest build, and which way
round it is when he is not.
**Implications:** No token exists in the client; the one GitHub read is public
and anonymous. **Money Padel's redeploy trigger is a Claude Code practice, not
app code** — a push that produces no Pages run is repaired by making the last
change through the GitHub API — and Ledger adopts it the same way (`CLAUDE.md`).
An in-app "redeploy" button was not built: it would need a server-side bridge
holding a GitHub token, and with Firestore rules fully open (#5) anything a
client can write could trigger deploys. The refresh offer never auto-reloads,
never shows over an open sheet or a focused field, disappears when typing
starts, and is not offered twice for a build a refresh already failed to load
— so it cannot loop. Money Padel considered and declined an update prompt
because a plain reload could come back out of Pages' 10-minute cache; Ledger's
Refresh first re-fetches the page and the stamp with `cache: 'reload'`.

### 2026-09-29 — Day Notes are context, and never become Actions
**Decision:** Each date carries freeform Day Notes, stored as `plan.dayNotes` on
that day's plan record and merged onto it like every other per-day field. Today
shows one compact row — the first line in serif, a line count when there is more
than one — which opens a sheet that autosaves as you type. The Handoff carries
them when non-empty, headed `DAY NOTES UPDATED` when they have changed since the
last copy or share (tracked per date in `localStorage`, since "what I already
gave Claude" is a device fact, not day data).
**Why:** This absorbs the freeform role NotePlan was doing, without Ledger
growing a second task system.
**Implications:** Nothing in Day Notes is ever parsed into Actions. "Call Mark
tomorrow" stays a sentence until Shaun writes it as an action himself — Day
Notes is thinking, Actions is committed work.

### 2026-09-29 — HIIT is a training type, not a flavour of Cardio
**Decision:** HIIT joins Padel, Cardio, Resistance and Mobility as a first-class
type (`hiit`), with its own accent, icon, planned details, logging, Recorded
Activity, stats card, Quick Log tile, calendar indicator and Handoff line. Its
planned detail is a freeform `outline` beside the shared location and duration —
not a workout builder. Historical Cardio is untouched; HIIT applies only to
sessions explicitly recorded as HIIT.
**Why:** It is a distinct kind of session, and folding it into Cardio would have
made both unreadable in reporting.
**Implications:** The warm end of the accent palette was full — every warm
candidate sat closer to gluten or padel than the tightest existing pair
(yoga/weight, 15.0 CIE76). HIIT takes violet (`#8f7ab8` / `#6a5599` light) at
23.0, the one open slot at proper spacing. Its icon is a work/rest square wave:
Cardio already owns the continuous pulse line and Quick add owns the bolt. Five
cards no longer fit the Plan selector, so that row scrolls horizontally, bleeding
to the sheet edges so the next card peeks.

### 2026-09-23 — The Handoff reports yesterday so Claude can reconcile, not re-create
**Decision:** Every Daily Handoff opens with `PREVIOUS DAY CLEANUP`, derived from
the previous day's real records: what was completed, what is partially completed
and still unresolved, and what was deliberately rescheduled to a later date.
Categories are kept in brackets for cross-tool matching; no ids are exported.
The instruction footer now leads with reconciliation, then today's work.
**Why:** External tools keep yesterday's tasks after Ledger has moved on, so the
day starts with duplicates and stale items. Ledger knows what actually happened;
it should say so.
**Ledger does not integrate with Todoist, FlowSavvy or Google Calendar.** This is
an export, read-only. The section derives from the same records Catch-up, the
backlog and the day record read — no second history system — and mutates
nothing: no status changes, no reschedules, no completions.
**Implications:** Completed and partial are read from the previous day's action
status. Moved-forward is `originalDate === previous day` and `date > previous
day`, so the three lists cannot overlap. **A "Dropped / no longer active"
subsection is not implemented** — Ledger has no cancelled state, and `not_done`
means it did not happen, not that it was abandoned. It is left out rather than
guessed. A task moved *onto* the previous day from an earlier one and then moved
again is not detectable, because `date` is overwritten and only the first
`originalDate` survives.

### 2026-09-22 — Morning Prime is Plan and Move
**Decision:** Morning Prime has two sections tracked separately. Plan is what
Shaun can do from the phone before getting up; Move is the physical start. The
header reads `Plan ✓ · Move 3/5` and Prime completes only when both enabled
sections do. It stays guidance, never a gate on the rest of Today.
**Why:** The existing four steps were all phone-bound. The morning routine that
actually happens has a physical half, and merging the two into one list would
have hidden which half was outstanding.
**Implications:** `mpState` returns `planSec`/`moveSec` section states. Move
ticks live in `plan.morningPrime.checks.move`, keyed by routine item id.

### 2026-09-22 — Routines are editable definitions, completion is evidence
**Decision:** Morning Prime (Plan, Move) and Evening Wind-down are ordered lists
Shaun can reorder, disable, rename and extend. The definition lives in
`presets.routines` (`ledger_meta/presets`) — a preference, so it follows him
across devices. Completion belongs to the date, and where Ledger already holds a
structured record, completion is *derived* from that record rather than stored
again. A manual tick exists only where no record can answer.
**Why:** A checklist that has to be ticked alongside the record it describes is
two versions of the truth, and the first one to drift wins.
**Implications:** A routine item carries a `key` (the link) and a `label` (the
display). Renaming changes only the label. Ten keys derive from records: meals,
key tasks, the day's plan, the intention, the weight log, the daily photo,
nutrition closure, the nutrition day rating, the exposure check and tomorrow's
plan. Everything else — supplements, water, a stretch, the accountability
check-in, anything custom — is a plain tick. Built-in steps are switched off
rather than deleted, because `getRoutine` re-appends missing defaults so later
versions can add steps without a migration.

### 2026-09-22 — Evening Wind-down closes today; Catch-up recovers what it didn't
**Decision:** Wind-down is same-day closure and Catch-up is the next-morning
recovery layer. They are one flow with one closure concept: completing Wind-down
writes `windDown.completedAt` and `closedAt` on the day record, and Catch-up
stops listing that day as pending. Opening it anyway shows "closed itself last
night" with the resolved facts reported rather than re-asked. When Wind-down was
only partial, Catch-up reports what is already settled as ✓ lines and keeps its
controls only for what is genuinely unresolved.
**Why:** Two independent reviews of the same day would make the evening pointless
and the morning tedious.
**Implications:** `ledger_day_status/<date>` gains `windDown { checks, completedAt }`
and `closedAt`. `computeCatchUpDates` treats an evening closure as resolved.
Training already logged and nutrition already closed no longer render a
segmented control. The calendar reports "Closed at HH:MM" for a day that was
closed without an overall status being chosen.

### 2026-09-22 — Next-morning symptoms stay dated to the symptom
**Decision:** Wind-down only asks whether a suspected exposure happened *today*;
it never asks about symptoms. Catch-up may prompt the next morning, with three
answers — No symptoms, Log symptoms, Not sure — and logging opens the symptom
episode dated to today with a *possible* link to yesterday's exposure.
**Why:** Symptoms usually appear the following morning. This preserves the
2026-09-15 separation rather than letting a closing routine collapse it.
**Implications:** "Not sure" records `symptomsUnknown` alongside
`symptomsChecked` — asked and unanswered is a real answer, and is not "no".

### 2026-09-22 — The day's plan grid is named for what is in it
**Decision:** The Today section previously labelled *Today's plan* is now
**Health & fitness**. The Daily Handoff heading becomes `HEALTH & FITNESS PLAN`
and its status line `- Health & fitness plan reviewed`. Morning Prime step 3
becomes "Finish health & fitness". The label no longer varies by date — the
header already says which day it is.
**Why:** The grid holds training, meals, diet and whatever got in the way of
them. "Today's plan" implied it covered the whole day, which Actions and
Morning Prime already do.
**Supersedes the naming in:** 2026-09-15 "Morning Prime includes Today's Plan as
a step" and 2026-09-15 "Daily Handoff is a stable structured export". The
structure and the fixed section order are unchanged; only the heading text
moves. Anything parsing the old `TODAY'S PLAN` heading needs updating.

### 2026-09-22 — Add action belongs to the Actions header
**Decision:** The "Add action" card is replaced by a `+` in the Actions section
header, styled as part of that row (same muted colour and weight as the
chevron and the count). It rotates to a gold × when open, and the panel it
opens — Quick add and Detailed add — sits under the list as before.
**Why:** A 68px card to reach a control used a few times a day, sitting between
the day's work and the backlog.
**Implications:** `.sec-head` is a container with two buttons where Actions is
concerned, because a button cannot nest a button. The section header gains a
32px minimum height as a result. Collapsing Actions hides the `+` and closes the
panel. The panel is scrolled into view on open only when it would land under the
tab bar.

### 2026-09-22 — The hero is a band, not a poster
**Decision:** The Today header establishes mood in a shallow band and then gets
out of the way. The photograph is scaled past its band (`--hero-size`) and
positioned on the ridge, so a shorter header crops the view without shrinking
the mountains. The quote is capped at roughly half the header width so it can
never grow a third line and push the day down the screen.
**Why:** The header behaved like a poster: 147px of a 844px viewport, permanently,
since it is sticky. The first screen was the header rather than the day.
**Implications:** Header 147px → 108px (iPhone) and 163px → 106px (S24); Today's
Plan moved ~300px up and now lands in the first viewport. Scroll-collapse was
considered and rejected — a sticky header occupies flow space, so shrinking it
mid-scroll pulls the page up under the thumb. A permanently shorter header gets
the same space back without the jump.

### 2026-09-22 — Today surfaces the backlog; it does not become the backlog
**Decision:** The Today shelf and the full Backlog sheet are two shapes of one
row (`backlogRowHtml(c, { compact: true })`). On the shelf the category folds
into the meta line, the disruption *reason* is dropped (the state word stays),
the meta is held to one line, and the two controls become icon buttons. The
full sheet keeps its labels and its spacing.
**Why:** Three backlog rows were consuming 485px — more of Today than Today.
**Implications:** Rows 148px → ~70px, panel 485px → 245px. Both actions stay one
tap; the icon controls are 38×38 with `aria-label` and `title`. The trade is
discoverability: on the shelf you have to recognise + and the calendar glyph.
The backlog logic itself is untouched — membership, ordering and dates are as
they were.

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

The backlog exists as GitHub Issues (#5–#19). None of it is authorised for
implementation — see the workflow rules in `CLAUDE.md`. The Today density pass
was a direct instruction from Shaun, not a backlog item.

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
3. **Two overlapping day-review flows.** *(Review Day's first-tap bug fixed
   2026-09-29; the overlap question itself is unchanged.)* `openReviewDaySheet` (older,
   per-action status then overall day) still exists and is reachable from the
   header and calendar day detail, alongside the newer `openCatchUpSheet`.
   → **#12** (proposed P2). **Reassessed 2026-09-22:** Wind-down and Catch-up
   now cover everything Review day does *except* its one-action-at-a-time
   status prompt — Catch-up links out to the day instead. Recommendation: move
   that sequential pass into Catch-up, then route both Review day entry points
   there and delete `openReviewDaySheet`. Not done here: it changes two
   entry points' behaviour, which is Shaun's call. Its buttons already hide on
   a day Wind-down closed, so the two do not collide today.
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

- (2026-09-30) — Responsive desktop/laptop/ultrawide layout on the same URL:
  sidebar, shallow header, Today workspace with inline Day Notes, right-hand
  inspector, Plan and Calendar split panes, Progress grid, two-column Focus.
- (2026-09-29) — Planned training details (HIIT and every other type) no longer
  vanish on Save to plan under Firestore. Focus, Progress and Calendar joined:
  priority evidence links, Towards your focus, cross-navigation, Calendar
  activity filter, Planned / Recorded / Outcome day detail.
- (2026-09-29) — Review Day advances on one tap (and no longer saves a second
  tap against the first action under Firestore). Focus shows the deployed build,
  and Ledger reports whether Pages and this device are current.
- (2026-09-29) — Day Notes added to Today (per-date freeform context, autosaved,
  carried into the Handoff); HIIT added as a fifth training type across planning,
  logging, stats, Quick Log, calendar and export.
- (2026-09-23) — Daily Handoff gains a Previous Day Cleanup section and a
  reconciliation-first instruction footer, so external tools can be cleaned up
  before today's work is created.
- (2026-09-22) — The daily lifecycle: Morning Prime split into Plan and Move,
  editable routines with a Settings sheet, Evening Wind-down, and Catch-up
  rebuilt as the recovery layer behind it.
- (2026-09-22) — Add action moved into the Actions header as a `+`; the Today
  plan grid renamed **Health & fitness** across Today, Morning Prime and the
  Daily Handoff export.
- (2026-09-22) — Today density pass: hero compacted to a shallow band, Backlog
  preview rebuilt as a compact shelf, empty Actions state tightened. Today's
  Plan now lands in the first viewport.
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
