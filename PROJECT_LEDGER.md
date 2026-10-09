# Ledger Project Ledger

Shared coordination file for Shaun, ChatGPT, Claude Chat and Claude Code.
Last updated: 2026-10-07 (ledger.sgj.luxe is the canonical production origin; Vercel migration audit done; Blaze enabled)

---

## Current State

Ledger is a **single-file PWA**: the entire app (HTML, CSS, JS) lives in
`index.html` (~10,500 lines, no build step, no framework, ES5-style vanilla JS).
Supporting files: `sw.js`, `manifest.json`, `fonts/` (self-hosted Playfair
Display + Inter woff2 subsets), `hero-mountain.webp`, icons, `avatars/`,
and `functions/` (one Firebase Cloud Function).

**Five tabs:** Plan · Today · Calendar · Progress · Focus. **Communications** is a
sixth view reached from Today on phones (no bottom tab) and a sidebar entry on
wider screens.

### Responsive layout (one app, one URL)
The same page adapts by viewport width; there is no desktop build, route or flag.
- **< 768px (phone):** unchanged mobile-first layout, bottom tab bar, bottom sheets.
- **768–1199px:** the tab bar becomes a left icon rail (Settings and Quick add at
  its foot); a shallow horizontal header replaces the phone hero. Content is one
  column; sheets stay bottom sheets below 1024px.
- **≥ 1024px:** Today becomes a workspace — Morning Prime / Catch-up across the
  top, Backlog + Actions in the main (primary) column; beside it, the active
  context (Communications, then Health & fitness) and under that the utilities
  (Day Notes — an inline, autosaved notebook — Quick log, Recorded, Wind-down,
  share links).
  Sheets open as a right-hand **inspector**. Plan is week list + selected-day pane;
  Calendar is month + a fixed-width day pane (selected-day content never moves
  the month); Progress puts Towards your focus beside the week
  chart with the stat cards in a grid; Focus is two columns.
- **≥ 1200px:** full labelled sidebar (Ledger mark, five views, Quick add, Settings).
- **≥ 1600px:** Today has three columns, about 40 / 32 / 28: **primary execution**
  (Backlog, Actions) · **active context** (Communications, Health & fitness) ·
  **utility and closure** (Day Notes, Quick log, Recorded activity, Wind-down,
  share links). The three column heads sit level. (Since 2026-10-09; the phone
  order is unchanged — the wrappers are transparent there.)
- The workspace is capped at 1680px and centred; the inspector aligns to it.
- Every wide breakpoint also needs 520px of height, so a phone turned sideways
  keeps the phone layout.

### Today (the main surface)
- **Overview / Flow** — a two-way switch (with the quiet "Reset sprint" entry on
  the same row) under Morning Prime and Catch-up (which
  stay visible in both). **Overview** is the editable whole day described below.
  **Flow** is the day's timeline (inspired by Structured): actions and planned
  training on a hairline rail, each as a coloured icon capsule, a tick on the right.
  Untimed items are a sequence; an item with a time shows it on the left and its
  capsule grows with its duration. Quiet "free" gaps between timed items and a gold
  "now" marker sit on the rail. Tap the capsule or text to open; hold an untimed
  capsule and drag to reorder (mouse: drag straight away; ⋯ Move up/down on hover);
  completed items stay in place, filled and muted. Desktop adds a context column (intention, key tasks, next up,
  constraints, notes). The mode is a per-device preference (`ledger_today_mode`).
  Once Morning Prime is done, the switch lights its Flow side in gold (no separate
  "Start the day in Flow" button since 2026-10-07); when the
  evening routine is due, Flow shows "Evening Wind-down ready".
- **Morning Prime** — two sections, tracked separately. **Plan** is what can be
  done from the phone before getting up (meals → choose key tasks → review today's
  plan → intention); **Move** is the physical start (weigh-in, body photo,
  supplements, water, stretch). Header reads `Plan ✓ · Move 3/5`, and collapses
  to "Completed HH:MM" (never truncated; "Reopen" gives way first on narrow
  screens) once both are complete. Stored as `plan.morningPrime`;
  manual ticks in `plan.morningPrime.checks[section]`. Key tasks are up to three:
  Done in the Key Tasks sheet sets `morningPrime.keysReviewedAt` and completes the
  step at 0–3 ("None today", "2 selected"). The sheet lists Selected, Today and a
  Backlog preview (oldest four, "View all backlog"); choosing a Backlog item moves
  that record to today; "+ New action" is the only way to create. Any step can be **skipped for the day**
  ("Skip a step for today" in the expanded card, then Skip per open step; Undo on the
  row): `morningPrime.skipped[itemId] = { at, reason }`. Skipped is resolved but not
  evidence — a dash and "Skipped today", never the gold check — and real evidence
  or a tick outranks it.
- **Evening Wind-down** — Morning Prime's quieter sibling card (moon mark, title,
  progress, chevron) at the foot of Today, after Recorded activity. It closes today while
  it is still today: finish food log, review food/day status, review suspected
  gluten exposure, accountability check-in, review tomorrow. Most items derive
  their state from real records. Closing writes `windDown.completedAt` and
  `closedAt` onto `ledger_day_status/<date>`.
- **Actions** — collapsible section with two independent views:
  - **Order view**: one numbered execution sequence for the day, drag to reorder.
  - **Groups view**: collapsible category sections, each with its own internal order.
  - Orders stored separately as `plan.actionOrder` and `plan.groupOrder[category]`.
  - Reordering is pointer-event based (HTML5 drag-and-drop does not work on touch).
- **Key tasks** — up to three, chosen in Morning Prime; normal actions flagged `isKeyTask`,
  marked in both views with a gold star, gold left edge and a `Key` pill.
- **Add action** — a `+` in the Actions section header opens one inline field
  under the list ("What needs doing?"). Return creates a plain action for the day
  (remembered category, default Work) and keeps the field focused for the next;
  empty Return does nothing; Escape or × closes. Details are edited afterwards by
  tapping the row. The Quick add / Detailed add choice is gone from Today (the
  global Quick add sheet remains on other tabs).
- **Backlog** — Actions intentionally assigned to an earlier date and not
  completed (not started, partial, disrupted, not done). On Today it sits above
  Actions as a collapsed row ("Backlog  5"), closed whenever Ledger opens; opened,
  it shows up to three compact rows (category · original date · state, quiet
  Add-to-today and Choose-a-day icons) and "Open Backlog" for the full sheet
  (sort by Group/Date, filter, Add to today, Pick a day). Briefly labelled Inbox
  on 2026-10-02; restored on 2026-10-03. **Inbox** is reserved for a future
  unprocessed-capture concept and is not built.
- **Health & fitness** — on Today a short summary (one line per planned session,
  one for the Nutrition Plan, one for meals, a quiet roadblock line) with "Edit the
  day's plan ›" and a share control for Daily Handoff; the Plan pane keeps the
  fuller list. Called **Today's Plan** until 2026-09-22. **Collapsed by default**
  (since 2026-10-09): title, a quiet summary from the day's records ("HIIT, food,
  steps to log"; "HIIT ✓ · 8,240 steps"; "All logged"; "HIIT planned" for a later
  day), chevron, and the share icon still reachable. The whole header row toggles;
  open/closed is remembered per day on the device (`ledger_hf_open`, like
  `ledger_cz_open`).
- **Two tiers of section header** (since 2026-10-09) — one header shape (title
  left, quiet summary, chevron in one right-hand column, same chevron family), in
  two weights. **Primary** — Actions, Communications, Health & fitness: 17px 600
  `--text` titles, summaries in `--text-2`, room above. **Secondary / utility** —
  Backlog, Day notes, Quick log, Recorded activity: 14px 500 `--text-2` titles,
  `--text-3` values, a smaller chevron, 40px rows set close together (Day notes
  starts the utility shelf). Wind-down stays its own card below. Actions summarise
  only Actions ("2 outstanding", "All done"); the old "0 of 1 complete… HIIT not
  yet logged" line under Actions is gone — training state belongs to Health &
  fitness.
- **Day Notes** — freeform text for one date, one compact row on Today between
  Health & fitness and Quick Log; opens a sheet with autosave. Context and
  thinking, never parsed into Actions. Stored as `plan.dayNotes`.
- **Quick Log** — collapsible grid: Nutrition, Weight, Daily photo, Padel,
  Cardio, HIIT, Strength, Mobility, Symptoms.
- **Recorded Activity** — collapsible, with a summary in its header.
- **Reset Sprint** (since 2026-10-08) — a short clearing session for small
  things ("put washing on", "shower"). Started from a quiet "Reset sprint" beside
  the Overview / Flow switch (hidden while one runs): one line per thing, 10/20/30
  min or no timer (default 20), optionally making the first item the Current Focus.
  While it runs it leads Overview (`#sprintSection`, top of the working column):
  time left, **Next**, the list (tap to clear or unclear), + Add, Wrap up. Time up
  reads "20 minutes done · 2 things left" with Keep going / Wrap up. Wrapping up
  with things left: each is **Keep** (back in the next sprint's field, via
  `ledger_meta/sprintKept`), **Make Action** (one ordinary Action today) or
  **Drop**. Never Backlog. Afterwards one quiet line under the Actions:
  "✓ Reset sprint · 5 cleared · 23 min" (opens read-only). In Flow a sprint is
  **one block** at the time it ran ("12:20–12:40 · Reset sprint · 3 of 5
  cleared"), never its items. Stored in `ledger_sprints` (owner-only), local
  fallback `ledger_sprints_fallback`.
- **Current Focus** (since 2026-10-08) — "the one thing I am doing now":
  `ledger_meta/currentFocus` (`ownerUid, type: action | sprint_item, sourceId,
  childId, title, date, setAt, updatedAt, sourceDeviceId, status: active |
  cleared`). One pointer, never a task; every Owner device listens to it. Shown as
  a **NOW** line at the end of the top block (title, "Work · Key task" or "Reset
  sprint · 12 min left", Change, a Done circle); in Overview a sprint item shows
  as the sprint's own "Now" instead. Flow marks its row ("Now", a gold ring).
  Set from an Action's detail ("Set as current focus"), the sprint ("Make it my
  focus"), or Change (the sprint's open items, then today's open Actions, key
  tasks first; Clear focus). Done on an Action = the normal completion; on a
  sprint item = tick it, and focus moves to the next item in the same write. A
  focus whose Action is completed, deleted or moved (or whose item is done) is
  moved on or cleared, in a transaction so only one device does it.
- **Challenge strip** — when a Challenge is running, one quiet line above Morning
  Prime, **collapsed by default**: icon, "Belly Must Go. · Day 3 of 92 · 3 of 4 done"
  (name strongest, the rest muted; the name truncates before the numbers), chevron.
  The whole row expands in place (˅/˄). Expanded: the challenge's hairline of
  progress with › to open the challenge, the day's tasks as one-tap pills, then a
  quiet "Week N progress" list ("Press Ups 50 / 350", tappable to log). Open/closed
  is remembered per day on the device (`ledger_cz_open`). With nothing to expand
  (before the start), the line opens the challenge. The challenge sheet: daily tasks
  for today or an earlier day, the last seven days, weekly targets, add/edit/remove,
  Edit challenge.
- **Health & fitness summary** — keyed lines, a quiet label column then the value:
  Training, Nutrition Plan, Food Plan (planned meals: "6 meals (3 eaten)"), Food
  Diary, Steps. Planned meals are called the **Food Plan** everywhere (Day Plan
  field, plan card, meals sheet title).
- **Food diary** — a line in Today's Health & fitness summary (today and earlier
  days): "3 items · <latest entry>", or "Log food ›". It opens the day's
  Nutrition record (the editor, or the summary once the day is closed); the meals
  sheet links to it too ("View food diary ›").
- **Steps** — a line in Today's Health & fitness summary: "Steps 8,420 · 7-day avg
  9,105", or "Log steps ›". Logged from Quick Log (Nutrition, Weight, Steps, Daily
  photo, Padel, Cardio, HIIT, Strength, Mobility, Symptoms).
- **Catch-up** — the recovery layer for whatever the evening did not close.
  Reads the day's real records *and* its Wind-down state: anything already
  resolved is reported as a ✓ line instead of asked again, and a day closed in
  the evening is not listed as pending at all. On Today it is one quiet row above
  Morning Prime, worded as unfinished work: "Yesterday needs finishing", "Tue 6 Oct
  needs finishing" or "2 days need reviewing" (afterwards "Yesterday closed at
  HH:MM"). Since 2026-10-09 it is a **resumable review**: the day's open Actions
  are listed in it, and an editor opened from it (Action, training, nutrition,
  symptoms) returns to the same day and step on save *or* cancel, re-read from
  the records — visiting is not resolving. The review's answers are kept as a
  draft meanwhile. The return context lives only in memory for the session (no
  routing). Days go oldest first; closing one says "Wed 7 Oct is closed · next,
  Thu 8 Oct" and opens the next; closing the last says "Yesterday is closed" and
  goes back to Today. Editors opened from Today behave as before.
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
reached from **Focus → Settings**, holding Appearance (Dark/Light/System),
Calendar & weeks (**Week starts** Monday/Sunday, `presets.weekStartsOn`, default
Monday), Overall training (training-day target and the activities that count) and
By activity (optional weekly and monthly session targets per type, steppers in
expandable rows) — all in `presets.trainingTarget`, the
two Morning Prime routines, the Wind-down routine and its prominence hour.

### Communications (Phase 1)
- **Who has the ball, across everything in motion.** Matters (`ledger_matters`:
  the wider ongoing thing — a sale, a nursery place) hold Conversations
  (`ledger_conversations`: the thread with a person or organisation). Each
  conversation has an attention state — Needs me · Waiting on them · Waiting on
  third party · Follow up · No action · Closed — plus who it waits on, a follow-up
  date, a current position, notes and a small movement log.
- **Actions stay actions.** A normal `ledger_commitments` record may carry
  `matterId` / `conversationId`. Rows show the matter quietly ("Communicate ·
  Pinewood"); Flow and the Day Plan show it in their meta line.
- **Completing a conversation-linked action** asks "What happens next?" — Waiting
  on them / Waiting on third party (who?) / No action / Matter complete / Leave as
  it is, with an optional follow-up date. Nothing closes a matter on its own.
- **Today** shows Communications as a collapsible section (since 2026-10-09;
  collapsed by default, open state per day per device, `ledger_comms_open`). The
  header is counts only ("1 needs you · 1 due" — never names or notes) and
  expands in place; opened, a short tally (Needs you · Waiting · Follow-up due)
  and **Open Communications ›**, the one way into the Centre (on its most urgent
  filter), its arrow in the utility slot where Actions has +.
- **The Centre:** search, Needs me / Waiting / Follow-up / All filters (All is
  grouped by matter, with Closed folded away), compact rows. Phone: tap → detail
  sheet. Desktop (≥1024): list left, record right, edited in place.
- **Handoff** gains COMMUNICATIONS ATTENTION (Needs me / Waiting / Follow-up due)
  for today, and an instruction that waiting items are never tasks.

### Other tabs
- **Plan** — Ledger's whole-life forward-planning surface (Plan = intent, Today =
  execution). Every day shows a readiness state — **Unplanned**, **Draft** (some
  planning exists) or **Planned ✓** (explicitly reviewed) — in the week list, the
  Day Plan header and the desktop pane; the primary action is "Finish planning". The week list gives each day a whole-day signal (`3 actions · 2 key`,
  its categories, training, meals, fasting, plus quiet marks for priorities
  supported and a known constraint). A day opens as the **Day Plan**: Direction
  (the Morning Prime intention + priorities the day supports), Actions (key
  outcomes, then by category; add, star, edit, pull from Backlog), Health &
  fitness (the previous plan form), Constraints (`plan.roadblocks` + roadblock
  actions) and Day Notes. On a phone these are collapsible sections with one-line
  summaries inside a sheet of fixed height (90dvh) whose content scrolls; sections
  open and close with a short animation and the sheet never moves. One footer
  action: **Finish planning** (unplanned/draft) or **Save changes** (planned).
  **Clear health & fitness** sits at the foot of the Health & fitness section and
  appears only when that section holds something. On desktop the day pane shows
  them all, editable in place; "Edit plan" opens the same sheet as the inspector.
  Meal ideas library unchanged. Weeks follow **Week starts**. Above the rows a
  compact switcher (‹ This week ˅ ›) steps weeks, opens nearby weeks or "Go to date",
  and shows a quiet **This week** return when elsewhere; on phones a deliberate
  sideways swipe over the rows also steps a week. The header arrows remain.
The three reflective tabs have one job each: **Focus** — where am I going?
**Progress** — am I moving there? **Calendar** — what actually happened?
- **Calendar** — month grid laid out by **Week starts**, with a display filter
  (All activity, Training, Padel, Strength, HIIT, Cardio, Mobility, Weight,
  Nutrition): one **Show** picker on phones, wrapped chips from 768px, one state.
  Summary for All/Training: **training days** for the week in focus against the
  day target ("4 / 5 Training days this week · 1 to go"; past "Target met" / "1
  short"; future shows the target only) plus training days this month; with no
  target, a "Set a weekly target" link. A training type (e.g. HIIT) shows that
  type's **sessions** for the week and month against its own targets ("3 / 2 HIIT
  this week · Target exceeded", "6 / 8 HIIT this month"), or plain counts
  ("3 Mobility sessions this week") without one. Weight and Nutrition show days and
  entries. Day detail reads Planned → Recorded → Outcome. A filter chosen from
  Progress holds for that visit; any other way in shows everything.
- **Progress** (`view-stats`) — **Towards your focus** (each priority that names
  its evidence, with a factual signal), then **Last 7 days** (rolling, with its
  date range, now a Training / Weight / Nutrition evidence matrix), **Training frequency** (one Week / Month / Quarter / Year selector;
  training days then sessions per type, each with its target beside it for Week and
  Month, counts only for Quarter and Year), **Challenge zone** and **Steps** tiles side
  by side, then the health &
  training stat cards and their detail sheets. A detail sheet names the priority
  it supports and links to those days in Calendar.
- **Focus** — player card (XP/level/tier/streak/avatar), priorities (optionally
  linked to evidence, with a signal and **View progress →**), target weight,
  focus items (optionally supporting a priority), the entry to Settings, and at its foot a muted **build
  footer**: `Build 7f3a2c1 · 29 Sep, 04:31` / `Live: Up to date`. Tapping it opens a
  small detail sheet.

### Nutrition
Daily checks (gluten-free, minimal processed, water, water amount, suspected
gluten exposure), food diary, day rating, calories. Lifecycle: **In progress**
vs **Day logged/Closed**. Exposure records source/time/confidence/note only;
**symptom episodes are a separate dated session type** (`type: 'symptom'`) with
their own onset date/time and an optional *possible* link to an exposure.

### Training
Five types: **Padel, Cardio, HIIT, Strength, Mobility**. "Strength" is the display
label for the stored type `resistance` (and legacy `gym`). Planned training lives
in `plan.trainingDetails[type]`; logging opens the same activity form pre-filled
and creates a real session linked via `sessionId`. Plan saves are optimistic:
the in-memory plan is the saved plan at once, and the listener converges on it.
HIIT carries a freeform
`outline` alongside the shared location and duration. The Plan sheet's type
selector shows all five on one row (five equal columns, about 64 × 75px each at
390px; no sideways scroll). The day's **Nutrition Plan** is one picker — Not set,
Fasting, No / Low Carb, Normal, High Carb — stored in the existing `fasting` and
`carbLevel` fields. Meals are typed as a list: Return keeps the meal and opens the
next row.

### Gamification / XP
Focus tab shows a player card: XP → level → tier (Rookie, Grinder, Contender,
Competitor, Veteran, Elite) with per-tier avatar art and a day streak.
`computeXP()` is currently `sessions.length × 10 + completed focus items × 25`.

### Notifications (Push Foundation, built 2026-10-08)
One engine: `functions/push.js` (`sendPushToUser`), triggered by Firestore records
(`functions/index.js`): **Current Focus** (a write to `ledger_meta/currentFocus` →
the owner's other devices, tag `ledger-current-focus`, opens `?openAction=` or
`?sprint=`), **Partner request Updates** (a new entry → the other side: request
sent, update added, planned, completed), and **Pin now** (a pin → all the owner's
devices). Device subscriptions belong to the signed-in user
(`ledger_push_subscriptions/{uid}_{hash}`, owner and partner alike, each only
their own). Settings → Notifications (partner: footer → Notifications) shows this
device's state, Enable / Disable, and two choices (`ledger_notification_prefs`).
The VAPID public key is read from `ledger_config/push`; the private key is in
Secret Manager. **Live since 2026-10-08:** Shaun did the one-time setup in
`docs/SECURITY.md` → Push notifications (Firestore `nam5` → functions in
`us-central1`; rules and the three functions deployed) and confirmed a Current
Focus set on the Mac arriving on the Samsung. Firebase is on Blaze (2026-10-07). The old owner-only Pin now function was
never deployed (#20) and is replaced, not kept.

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
The deployed commit is stamped into `buildInfo.js` at build time. On Vercel
(production), `vercel.json` runs `scripts/vercel-build-info.js`, which writes it
from Vercel's build metadata (`VERCEL_GIT_COMMIT_SHA`; no token). On the legacy
Pages copy, Jekyll still renders `buildInfo.pages.js`. See `CLAUDE.md` → Deploys
and the build stamp. Freshness compares three SHAs: **loaded** (the stamp this
page was loaded with), **served** (`buildInfo.js` fetched again with `no-store`:
what this host serves now) and **latest** (HEAD of `main` from GitHub's public,
unauthenticated API). served ≠ latest → `Live: Deploying newer build`; loaded ≠
served → `App: Refresh available` and a quiet "New Ledger build available ·
Refresh" offer. The build sheet names the host it is served from. Until
2026-10-07 the wording said "Pages", which became misleading on Vercel. Checked on
Focus and on returning to the app, at most every 10 minutes (GitHub allows 60
anonymous reads an hour). The service worker is a pure pass-through and cannot
pin an old build; staleness comes from an HTTP cache (GitHub Pages: 10 minutes)
or an installed app left open, both of which the check reports.

### Persistence
Firebase Firestore (project `ledger-6aec3`) with a **full localStorage
fallback** — the app works entirely offline/unconfigured. Collections:
`ledger_commitments`, `ledger_plans`, `ledger_sessions`, `ledger_day_status`,
`ledger_priorities`, `ledger_focus`, `ledger_meals`, `ledger_meta`,
`ledger_pins`, `ledger_push_subscriptions`, `ledger_matters`,
`ledger_conversations`, `ledger_challenges`, `ledger_users` (roles), and the
shared namespace `ledger_share_members`, `ledger_shared_snapshots`,
`ledger_shared_requests` (Partner Sharing). Live
`onSnapshot` listeners drive re-renders.

### Hosting (since 2026-10-07)
- **Canonical production origin: `https://ledger.sgj.luxe`, hosted on Vercel**,
  deployed from `main` on every push. One URL strategy: browser code works from
  its own origin and names production once (`LEDGER_HOME`); Cloud Functions use
  the `APP_URL` param (default `https://ledger.sgj.luxe/`). Ledger lives at the
  root; every asset, the manifest (`start_url`/`scope` "."), and the service
  worker are relative, so nothing assumes `/Ledger/`.
- **Deep links** are query strings on the root (`?openAction=`, `?request=`,
  `?view=today|week`), so a direct link or a refresh is always the same static
  page. There are no routes and no rewrites; `vercel.json` only sets the build
  command for the build stamp.
- **GitHub Pages is legacy/transitional.** It still builds and works, shows a
  "Ledger has moved to ledger.sgj.luxe" link (carrying any deep link), and never
  redirects. Production depends on nothing there. Emailed links requested there
  return to production.
- **Firebase is unchanged** (`ledger-6aec3`, now on Blaze). Users, UIDs, roles,
  memberships and data are untouched. Sign-in is email + password, with the email
  link as a backup.
- **Origin-local state does not migrate:** the Firebase session, localStorage
  preferences, service worker, installed app and notification permission belong
  to the old address. On `ledger.sgj.luxe`, sign in, re-pick device preferences,
  and install the app from there. Future push subscriptions will be created
  against it. Firestore data appears as normal. See `docs/SECURITY.md` →
  Hosting and origins.

### Identity and security
**Firebase Authentication is the identity boundary** — email + password first,
the emailed link as a backup (since 2026-10-07; same accounts, same UIDs).
Roles live in `ledger_users/{uid}` (`owner` | `partner`), granted in the Firebase
Console only. Every private `ledger_*` collection is **owner-only** in the
version-controlled `firestore.rules`; a partner has no access to private
collections and reads only the shared namespace (see Partner Sharing below). The
app shows an opaque gate from first paint and starts private listeners only after
the owner role is confirmed; a partner gets the partner view (or a holding screen
without an active relationship); a signed-in account without a role sees its
Account ID to grant. Offline,
an owner already confirmed on this device can open Ledger (Firebase Auth's
persisted session + the remembered role); nothing else unlocks local data. A build
with no Firebase config stays local and account-free. Runbook and rollout order:
`docs/SECURITY.md`. **Rollout status (2026-10-07): live.** Email-link sign-in
enabled, owner profile created, `firestore.rules` published from the Console, and
Shaun has confirmed Ledger opens with all data on his devices. #5 closed.
**2026-10-07, ledger.sgj.luxe:** "Something went wrong" on Send link was Firebase
refusing the send with `QUOTA_EXCEEDED`, the Spark plan's small daily email-link
quota. The new address signs every device out, so every device needs a new link.
The domain was fine: a send from `ledger.sgj.luxe` with that return address was
accepted. The sign-in screen now names the reason and shows the Firebase code. The
emailed link returns to the page's own address only on production and localhost,
otherwise to production (since the migration audit, the legacy Pages copy too).

### Partner Sharing (Phase 2 — built 2026-10-07; live once the rules are republished)
A projection, not access. The owner publishes a day or a week to the partner from
**Share snapshot → Abi** (Image | Abi; Today | This week), reviewing exactly what
she will see. Publishing writes share-safe display rows to
`ledger_shared_snapshots/{owner}_{partner}_{day|week}_{key}`; what was chosen stays
private in `ledger_meta/sharing`, and a **live sync** rebuilds published, current
projections when the records change (completed, moved → "Moved to …", new Actions
in shared categories). The partner's preset (`partner-{uid}` in
`presets.shareTemplates`) is an allow-list: key outcomes, Family + Personal Actions,
training; snapshot presets gained `actionCategories`. The week carries a
checkpoint and review date ("Checkpoint Wednesday" → "Checkpoint today" →
"Review Sunday"). Today's foot shows "Shared with Abi · updated 09:14".
**Partner view**: Today | This week, "From you" (her requests with status) and
"+ Request something" (what, when, optional note). **Owner Inbox** on Today (above
Backlog, only when something waits): From Abi · text · Requested today — Today /
Choose day / Dismiss (Undo). Accepting makes one normal Action with
`sourceType: 'partner_request'`, `sourceRequestId`, `sourceLabel` ("From Abi" on
the row); the request follows it (planned → done; moved date; back to Requested if
the Action disappears). Settings → Partner sharing: set up (relationship only, never
a role), pause/resume, weekly checkpoint day, remove. Manual onboarding:
`docs/SECURITY.md` → Partner Sharing. Tests: rules 205 (emulator), end to end 104
(`tests/e2e/`, real SDK, two browsers, Auth + Firestore emulators).
**Phase 2.5 — Updates.** Each request has a shared, append-only history in
`ledger_shared_request_updates`: comments from either side plus lifecycle entries
(asked, planned, moved, in progress, done, back to requested, set aside, withdrawn).
The request keeps summary fields (`latestUpdate*`, `latestComment*`) and each
side's read mark. Request detail (owner: from the Inbox, the Action's "From Abi ·
Updates" link, or Settings → Partner sharing → Requests; partner: any request row)
shows state, the linked Action (owner only), the timeline and an "Add an update…"
composer. The Inbox now shows new requests and "Update from Abi → Review" for
processed requests with unread news, one row per request. Accept, dismiss and the
Action-driven sync are Firestore transactions that write the change and its entry
together; Dismiss waits for its Undo before writing. Withdraw is a status (requests
are never deleted). Request statuses gain `in_progress` and `withdrawn`.
**Withdrawn afterwards (2026-10-09).** The partner list has **From you** (requested,
upcoming, planned, in progress) and a quieter **Past** (done, set aside, withdrawn;
the latest four, "All requests" for the rest). A withdrawn row reads "Withdrawn
today" with a ⋯ (also in its detail): **Move to upcoming** or **Hide from my list**.
Move to upcoming makes a *new* request (`status: requested`, `requestedTiming:
'later'`, `renewedFrom: <old id>`); the old one stays withdrawn with `renewedAs`,
both written in one batch with a "renewed" entry on the old and a "moved it to
upcoming" entry on the new; each request links to the other ("Earlier request ·
withdrawn …"). **Upcoming** = requested with timing `later` (partner pill
"Upcoming", owner Inbox "Upcoming · no rush"); the owner accepts, plans or
dismisses it like any request. Hide sets `partnerHiddenAt` (Undo clears it): out of
her list only — the record, its history and the owner's copy are untouched.
Push: the new request notifies the owner once, "Abi moved a request to upcoming";
the withdrawal and "renewed" entries are quiet.

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
- Plan owns no records. Actions planned there are ordinary `ledger_commitments`
  dated that day; key outcomes are `isKeyTask` (max three, one shared rule with
  Morning Prime); priority context comes from each action's `priorityId`; the
  intention is `plan.morningPrime.intention`; notes are `plan.dayNotes`;
  constraints are `plan.roadblocks`. Future days may be planned loosely —
  Morning Prime confirms the current day's key tasks (up to three).
- Communications has three nouns and no second task system: a **Matter** is the
  wider ongoing piece of life or work; a **Conversation** is the communication
  thread and its context; an **Action** is the existing executable commitment,
  linked by optional `matterId` / `conversationId`. Every commitment saver builds
  on the record it edits, so the links survive edits, ticks, moves and key-task
  toggles. The movement log lives on the record (`log`, capped at 80) and actions
  created against a record are derived from their `createdAt`, never stored twice.
- Three orderings, three jobs: `plan.actionOrder` = sequence among actions;
  `plan.groupOrder` = order within each category; `plan.dayFlow` = the whole-day
  execution sequence across actions and planned training. `dayFlow` holds
  references only (`{kind:'action', id}` / `{kind:'training', type}`); stale refs
  are ignored and anything unlisted joins the end. Flow fills its action slots in
  `actionOrder`, and a Flow drag that reorders actions updates `actionOrder`, so
  actions keep one relative order across Ledger.
- Times are optional: an action may carry `time` ('HH:MM', the field the Handoff
  already read) and `durationMin`; planned training already has `activityTime` and
  `durationMin`. Ordering rule, applied everywhere an order is read
  (`applyTimeOrder`): untimed items keep their positions; the positions held by
  timed items are filled by those items in time order. So a time never fights the
  order, and nothing untimed moves. Timed items are not dragged — change the time.
- Plan readiness: `planReviewedAt` is the only "planned" signal. Editing never sets
  or clears it; only Finish planning / Morning Prime's plan review does.
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

### 2026-10-09 — Desktop Today reads: do the work → handle the context → capture and close
**Decision (Shaun's brief):** desktop Today has a primary execution column
(Backlog + Actions), an active-context column (Communications + Health & fitness)
and a quieter utility/closure column (Day Notes, Quick log, Recorded activity,
Wind-down, share links), weighted about 40 / 32 / 28 at ≥1600px. Between 1024 and
1599px the existing two columns stay: the context sits at the top of the right
column with the utilities under it. Communications is collapsible on Today like
the other sections: the header expands in place and only "Open Communications"
navigates; expanded, it gives a compact attention tally, never the Centre itself.
Chevrons share one alignment language across Today's sections — the same
right-hand column (the extra slot reserved), Evening Wind-down's included. Phone
order and feature set are unchanged; only Communications' header now expands
rather than navigates. **Refines** "the row opens the Centre" (2026-09-30).

### 2026-10-09 — Withdrawn requests: hide, or move to upcoming as a new request
**Decision (Shaun's brief):** withdrawn stays a historical state, but never a dead
end: the partner can **Move to upcoming** or **Hide from my list**. Hide, not
delete: requests are never deleted (2026-10-07 decision, `allow delete: if false`),
so "delete" is a partner-side `partnerHiddenAt` flag on withdrawn requests only;
the owner's record and the shared history are not modified. Move to upcoming never
revives the withdrawn record: it creates a new request linked both ways
(`renewedFrom` / `renewedAs`), once per withdrawn request, enforced by the rules,
and the owner sees it once as a new request. **Upcoming** is a partner-facing state
with the simplest internal model: `status: requested` + `requestedTiming: 'later'`
(still wanted, not asking to be scheduled; never an Action until the owner decides).
The partner list separates open requests from **Past** (done, set aside,
withdrawn). Not changed: owner-only fields (`linkedActionId`, `plannedDate`, owner
statuses), Actions, and set-aside requests (still the owner's decision).

### 2026-10-09 — Today has two tiers: primary sections and utilities
**Decision (Shaun's brief):** Primary — Actions, Communications, Health & fitness —
are what Shaun is actively managing today and stay the strong anchors (larger,
brighter titles, stronger summaries, more room). Secondary / utility — Backlog,
Day notes, Quick log, Recorded activity — recede (smaller, muted titles, tighter
rows, lighter chevrons) while keeping the same header shape, chevron family and
right-edge column, and staying obviously tappable. Visual only: no behaviour or
data changes; existing tokens only, tuned locally on Today. **Refines** the
same-day header pass below, which had made every section equally loud.

### 2026-10-09 — One header language on Today; Catch-up is a review you can leave and resume
**Decision (Shaun's brief):** Health & fitness is collapsible on Today, collapsed
by default, remembered per day on the device. Today's major collapsed sections
share one header/summary hierarchy (title, quiet summary, chevron). Actions
summaries contain only Action state; Health & fitness summaries contain Health &
fitness state, built from the records. Catch-up is a resumable review workflow:
editors opened from it return to the same review context after save or cancel;
on return it re-evaluates the actual records rather than assuming completion;
several days are reviewed oldest first, one after another. Normal editor
navigation outside Catch-up is unchanged. The context is session memory only —
no routes, no new records (closing still writes the one `ledger_day_status`
record).

### 2026-10-08 — Reset Sprint: clearing clutter is not committing
**Decision (Shaun's brief):** a Reset Sprint is a temporary list of small things to
clear before focusing. Its items are execution aids, never Actions, Key Tasks,
Backlog, priorities or Progress. Unfinished items are kept for another sprint,
made an Action (only by Shaun's choice, one ordinary Action) or dropped — never
put in the Backlog, which means committed work. A sprint is one Flow block, a
prominent panel only while it runs, and one quiet line after. Timer ends are
never failures. Stored owner-only in `ledger_sprints`; never in a Partner
projection.

### 2026-10-08 — Current Focus: one synced "doing now"
**Decision (Shaun's brief):** at most one Current Focus, in Firestore
(`ledger_meta/currentFocus`), pointing at an Action or a sprint item, never a
task of its own. Every Owner device follows it live; a push is a best-effort
extra. Done uses the Action's own completion (a sprint item: tick it and move
the focus to the next item, in one write). A dead reference is never left:
completed, deleted or moved targets are reconciled in a transaction. Starting a
sprint makes its first item the focus only if nothing else is in focus, or if
Shaun leaves the option on knowing it replaces the current one.

### 2026-10-08 — Push belongs to people and their devices; one engine
**Decision (Shaun's brief):** a device subscription belongs to the Firebase user
who enabled it (`ledger_push_subscriptions/{uid}_…`), owner or partner, readable
and changeable only by them. One server engine (`sendPushToUser`) sends every
push; recipients come from trusted records (the focus's owner; the request's
two sides checked against the active membership; the pin's owner), never from
the browser. Each event is sent once (`ledger_push_events`), no handler writes to
its trigger, dead devices are removed. Current Focus skips the device that set
it. Firestore stays the truth; a failed push changes nothing. The VAPID public
key is published in `ledger_config/push`; the private key lives in Secret
Manager. Lock-screen placement and persistence are the OS's; this is not a Live
Activity. **Supersedes:** the owner-only Pin now function and its owner-wide
device list (never deployed, #20).

### 2026-10-07 — Today: the challenge is collapsed by default; status recedes, work rises
**Decision (Shaun's brief):** the Challenge strip on Today is one collapsed status line
by default (name · day · day's count, chevron); its pills, weekly totals and progress
bar appear only when expanded, and the open/closed state is remembered per day on the
device. Inside it, the day's tasks lead and the week's totals are a quiet list, not a
second row of pills. Around it: Morning Prime's done row never truncates its time
("Completed 07:42"); the Overview/Flow switch is the one control for Flow, so once
Morning Prime is done it lights its Flow side instead of a separate gold button; the
gaps between the status rows and the switch are tighter so the first Actions show in
the first viewport. In the Actions header, Order/Groups and the count are quieter than
the title. A done Action recedes by colour (title and meta alike, still readable), not
opacity; its control is a quiet filled disc with a tick; a key-task star hangs in front
of the title in Overview as it already did in Flow.
**Why:** Today's execution list is the primary content; challenge and routines are
context around it. **Supersedes:** "Start the day in Flow" as a separate link (the
2026-09-30 Flow decision) and the always-open pills of the challenge strip.

### 2026-10-07 — ledger.sgj.luxe is the one production origin
**Decision (Shaun's handoff):** production is `https://ledger.sgj.luxe` on Vercel.
GitHub Pages is legacy/transitional: it still builds, links to the new address,
never redirects, and nothing in production depends on it. One URL strategy:
browsers work from their own origin; production is named once (`LEDGER_HOME`) for
emailed links (which return to production from any unknown host, the legacy copy
included) and the legacy note. Cloud Functions use the `APP_URL` param, default
`https://ledger.sgj.luxe/`. Deep links are query strings on the root, so no routes
or rewrites exist. The build stamp is written by a Vercel build step from Vercel's
own metadata, and the freshness UI no longer says "Pages". Origin-local state
(session, preferences, installed app, push permission) is re-established on the
new origin, never copied. Firebase, users, UIDs, roles and data are unchanged.
Blaze is enabled. Push comes next, per authenticated user, only on Shaun's say.
**Supersedes:** GitHub Pages as the deploy target in the 2026-09-29 build-stamp
decision. That stamp mechanism lives on for the legacy copy.

### 2026-10-07 — A challenge can carry weekly targets
**Decision (Shaun's request, Belly Must Go):** beside its daily tasks, a challenge can
have **weekly targets** (`weeklyTargets` on the challenge record). Each is a weekly
total built up across the week's days: a count (e.g. 350 press ups) logged per day on
that day's plan (`plan.challengeLog`, beside the daily tasks), or steps (e.g. 70,000)
summed from the daily Steps records. Either can have an optional daily goal. A steps
daily goal (10,000) also becomes the day's steps target in Health & fitness when no
daily steps task exists. **Weeks are the challenge's own:** Week 1 is its first seven
days from the start date (a group's "week one"), not the calendar week, and is always
shown with its dates. Targets are scoped like daily tasks: just this week or every
week from this week, edited or stopped per week (`fromWeek`/`untilWeek`, `versions`,
`weekEdits`). The challenge sheet shows them under Days complete with what is left
and roughly what a day needs. Today shows them as "Week N" pills. The share snapshot
lists them. **A weekly target's daily goal is also a daily task** (added
2026-10-07 at Shaun's request). It sits in Daily tasks and on Today's daily pills,
reads the same day figure (one log feeds both), counts towards the day's "x of y" and
Days complete, and is edited with its weekly target. Steps is skipped if the challenge
already has its own daily steps task.
**Why:** the challenge group set weekly totals for week one, possibly continuing.

### 2026-10-07 — Password first; the email link becomes the backup
**Decision (Shaun: the link is "too cumbersome" as the main way in):** the sign-in
screen is email + password ("Sign in"), with "Set or reset your password" and "Email
me a sign-in link instead" beneath. Both methods belong to Firebase's Email/Password
provider, so a password is just another way into the same account. UIDs, roles,
profiles and data are unchanged. A password is set through Firebase's password email
(which works for link-only accounts) or from Settings → Account → Password (the
partner: Password at the foot of her page). Google sign-in was considered and not
chosen: it needs auth-domain proxying to work in Safari and the Home Screen app.
**Why:** one step on a new device, filled by the phone's password manager, and the
daily link-email quota stops mattering.
**Supersedes:** "passwordless email link" as the sign-in method in the 2026-10-06
identity decision (the identity boundary itself is unchanged).

### 2026-10-07 — Partner Requests have Updates: a shared history, not a chat
**Decision (Shaun's Phase 2.5 brief):** every Partner Request has a shared
**Updates** timeline combining human comments (either side) and meaningful lifecycle
entries (asked, planned, moved, in progress, done, back to requested, set aside,
withdrawn). Category, key-task, Flow order and other private changes are never
logged. Human updates never modify the owner's Action ("Can this be Friday?" is
information; Shaun decides), never create Actions, and a request still maps to at
most one Action. Private Ledger text (Action fields, Day Notes, Communications)
never flows into Updates; lifecycle entries are structured facts (dates, statuses)
rendered as words, not stored prose. The current status stays simple; the timeline
carries the nuance. The Inbox surfaces both new requests and new partner updates on
processed requests, one row per request. Entries are append-only and rule-checked
against the request; the partner may record only her own comments and her own two
facts (asked, withdrawn), once each; system entries come only from the owner's
device, in the same transaction as the change they describe (idempotent across
re-renders and devices). Requests are no longer deleted: withdrawn is a state.
**Why:** "open a request and understand what has happened with it".
**Implications:** rules must be republished. Not built: general chat, attachments,
reactions, mentions, comments on other Actions, AI summaries, notifications.

### 2026-10-07 — Partner Sharing is a projection, published on purpose and live after
**Decision (Shaun's Phase 2 brief):** Ledger stays private; a partner sees only
projections the owner publishes, in the shared namespace, enforced by
`firestore.rules` (partner reads own, only while the relationship is active;
creates requests only through it; never touches owner-controlled fields). Never a
filtered client-side view of private data, and never automatic publishing. Once
published, a current day or week follows its records (live sync); a past one is
frozen. Presets are allow-lists (sections and, now, Action categories), so new data
types are not shared by default; Day Notes and Communications are never offered.
Partner requests are capture: they land in the **Inbox** (the name reserved on
2026-10-03, now used for exactly "captured, not yet decided") and become an Action
only by the owner's choice: one ordinary Action with provenance fields, category
Family by default — the request's origin is provenance, not a category. A request
never reads Done unless its Action is completed; a vanished Action returns it to
Requested. Dismissed is a status ("Set aside"), not a deletion. One partner;
roles are still granted only in the Console; the app's "Set up a partner" writes
the relationship only. Request ids must look generated (rules), and no
partner-chosen string is ever put into markup.
**Why:** a calm, trustworthy shared view for Abi without weakening the private
boundary built in step 1.
**Implications:** the published rules must be updated before sharing works
(`docs/SECURITY.md`). Not in Phase 2: notifications (scheduled or push), multiple
partners or admin UI, chat/comments, partner editing Actions, calendar sharing,
automatic sharing on plan change.

### 2026-10-06 — Firebase Auth is the identity boundary; private data is owner-only
**Decision (Shaun's direction, Partner Sharing step 1; supersedes "Firestore rules
left fully open", 2026-09-11):** Ledger signs in with Firebase Authentication,
passwordless email link (the installed iOS app gets a paste-the-link fallback,
since links open in Safari). Authority is a role in `ledger_users/{uid}` —
`owner` or `partner` — that no client can write. `firestore.rules` (now in the
repo, with emulator tests in `tests/firestore-rules/`) makes every private
collection readable and writable only by the owner role; the future shared
namespace is reserved and closed; anything unlisted is denied. **Ownership is the
owner role, not a per-record field:** no data is moved, copied or stamped (an
`ownerUid` on every record or a per-user path would mean migrating every
collection and every writer, with real data risk, for a single-owner app).
Startup is Firebase → auth → role → owner data / partner holding screen / sign-in;
nothing private is fetched or drawn before the owner is confirmed. Offline, the
last server-confirmed role for the account already signed in on the device is
used; the localStorage copy loads only for the confirmed owner (or a config-less
local build). Pin now: devices and pins are owner-only and carry `ownerUid`; the
Admin-SDK function (not subject to rules) sends a pin only to its owner's devices.
**Why:** Ledger holds health, family and business data, and a partner is coming;
open rules could not survive that.
**Implications:** `docs/PRODUCT.md`'s "no accounts" boundary is superseded by
explicit partner sharing. Rollout order matters (rules after the owner profile) —
`docs/SECURITY.md`. Partner UI, snapshots, requests and notifications are Phase 2+.

### 2026-10-06 — A plan can be saved unfinished; a planned session can be saved or logged from either place
**Decision (Shaun's request):** the Day Plan footer offers **Save draft** beside
**Finish planning** for a day not yet planned (it saves everything, including
training, meals and the Nutrition Plan, without setting `planReviewedAt`, so the
day reads Draft); a planned day keeps the single "Save changes". With Morning Prime
waiting, "Return to Morning Prime" takes its own line above the two. The training
form opened for a planned session offers both actions in both places: from Plan,
**Save to plan** (primary) and **Log activity** (only on a day that has come, it
saves the detail to the plan, records the session and marks the plan done); from
Today, **Log activity** (primary) and **Save to plan** (adds detail to the plan
without logging; not shown once the session is logged).
**Why:** closing the Day Plan dropped unsaved health choices unless the day was
declared finished, and a session could only be planned in Plan and only logged
from Today.

### 2026-10-06 — A day can be shared as an image, with presets
**Decision (Shaun's request):** "Share snapshot" draws the chosen parts of a day
onto one PNG (1080 wide, as tall as the content, capped at 9000px), in Ledger's
dark editorial style whatever the app theme, and shares it with the Web Share API
(files) or saves it. Sections: Challenge (day, progress, its tasks), Routines
(Morning Prime, Wind-down), Intention, Key tasks, Actions (Done only, or All with
what's left; key tasks not repeated when Key tasks is on), Training (recorded, then
planned-not-done), Nutrition Plan, Food Plan, Food Diary (with the day rating),
Steps (with the challenge target), Weight. Only sections the day has are offered;
each can be expanded to leave single items out for that share. **Presets**: two
built in (Health & fitness, Whole day) and any number of named ones (e.g. "Belly
Must Go"), which keep the sections, the Actions choice and any challenge tasks left
out; created from the current choice, updated when it changes, renamed, deleted.
A named preset's name appears under the date on the image. Presets sync in
`presets.shareTemplates`; the last one used is remembered per device.
**Why:** sharing the day with an accountability group, quickly and selectively.
**Implications:** the Health & fitness share icon now opens the snapshot with the
Health & fitness preset; the Claude hand-off stays at the foot of Today ("Share day
for Claude"), beside a new "Share snapshot" link. Per-share item choices (a diary
line, a single action) are not saved in presets — items other than challenge tasks
change from day to day.

### 2026-10-05 — Challenge tasks can be Actions; changes are scoped
**Decision (Shaun's request):** a challenge task can optionally **also be an Action**
(`asAction`), so it sits in the day's Actions and Flow. Adding a task asks **Just
today** or **Every day from today** (`fromDate`/`untilDate` on the task; a task
added mid-challenge leaves earlier days as they were). Editing or removing asks
**Just this day** (an exception on that day's plan:
`plan.challengeTaskEdits[challengeId][taskId]`), **From this day on** (a version on
the task, `versions: [{ from, patch }]`; removal sets `untilDate`) or **Every day
of the challenge** (the base, earlier days included and judged by it). The newest
instruction wins: from-on and every-day clear the edited fields from one-day
exceptions they cover. The type is fixed once a task is made. A day's Action is
made when that day is opened (Today, or a later day's Day Plan / day pane) — never
for past days, never the whole challenge in advance — with a fixed id per task and
day (`cz-<challenge>-<task>-<date>`, created only if absent), and the day's plan
remembers it (`plan.challengeActions`) so one deleted by hand is not remade.
Completing the Action counts a count or yes/no as met ("done in Actions"); steps
stay evidence-only. Logging in the challenge keeps the Action in step (met
completes it, dropping below target reopens it); its Log button opens the
challenge's own log. Open Actions follow later edits (retitled unless renamed by
hand; removed when the task or its Action option goes); completed ones are kept.
**Why:** the challenge's daily asks need to be ordered with the rest of the day,
and a target or task often changes for a day or from a day without rewriting
history.
**Implications:** supersedes "a changed target applies to every day" in the
previous entry — that is now the explicit Every-day choice. Days complete counts
only days that had tasks. Ending, cancelling or re-dating the challenge removes
its open Actions from today on.

### 2026-10-05 — A challenge can carry daily tasks
**Decision (Shaun's request; supersedes "time container only — no rules yet"):** a
challenge may list daily tasks on its record, `tasks: [{ id, title, kind, target,
unit }]`, with kind **count** (a number a day, e.g. 50 reps), **check** (yes/no) or
**steps** (at most one). A day's results are per-date state on that day's plan:
`plan.challengeLog[challengeId][taskId] = { value, at }`. A steps task stores
nothing: it reads the day's Steps record, so Steps logged in Health & fitness and
in the challenge are one number, and Health & fitness shows the challenge target
("10,500 / 10,000"). A task is met at or above its target (any amount when no
target); a day is complete when every task is met. Tasks are added, edited and
removed from the challenge sheet; editing builds on the task and keeps its id.
**Why:** the running challenge (10k steps, press ups, sit ups, crunches each day)
needed its daily asks visible and loggable where the day is lived.
**Implications:** challenge tasks are not Actions (no daily Action records, no
Flow/Backlog). A changed target applies to every day, past ones included; a removed
task leaves its logged values on the plans but stops counting. Handoff adds
"Challenge tasks: Steps 9,000 / 10,000; Press ups 50 / 50 reps (met); …". Tapping
the Progress tile or the Today strip opens the challenge detail; Edit challenge is
inside it. A new challenge opens straight onto its daily tasks.

### 2026-10-05 — Choosing key tasks is one question; the Backlog is a source
**Decision:** the "Choose your key tasks" sheet answers only which actions (up to
three) are key today. Sections: Selected (shown only when any are), Today, Backlog
(count, oldest four, "View all backlog"), then "+ New action". The whole row
selects/deselects (○ → gold ★); a separate ⋯ opens the Action editor. Choosing a
Backlog item moves the same record to today with the existing move fields
(`originalDate` kept, `movedFromBacklogAt`, all links/metadata kept) plus
`isKeyTask: true`, and appends it to today's `actionOrder`; it stays in the Backlog
section as "Moved to today" for the session. Un-choosing an item the sheet just
moved puts it back (date, flags, order) — choosing a key task never leaves a stray
move. "+ New action" is the only creating control ("What needs doing?", Return or
Add, marked key). Search is an icon shown only at 9+ candidates; it filters both
lists, labels each result's source, and never creates. At three, the rest mute and
a tap shows a quiet "Choose up to three". Done only sets `keysReviewedAt`; "No key
tasks today" (confirm only when some are selected) clears and reviews. The full
Backlog opens in a selection context ("Make key task", no day picker) and returns
with the sheet's lists, scroll and any half-typed new action intact.
**Why:** one input that both searched and created, Today-only candidates and a
heavy checkout button made a small daily decision feel like data entry.
**Implications:** no new record type; key tasks remain Actions with `isKeyTask`.
`moveActionToDate` now shares `movedToDate(c, date, extra)`; `createQuickAction`
takes an optional patch. The sheet is fixed height with an internal scroller and
updates rows in place, so taps and the keyboard do not move it.

### 2026-10-04 — Evidence matrix, weight trend, Steps and a Challenge Zone
**Decision:** Progress's **Last 7 days** is a rolling Training / Weight / Nutrition
evidence matrix (today and the six days before, never the week start). Training
cells show each recorded modality's colour; several on a day share the cell in
equal bands (none is picked). Planned training never fills a cell. Weight cells
mean "logged", never good or bad. Nutrition cells use the day's own rating — on
track, neutral, off track (a subdued hatch) — or a quiet dot when logged but not
rated. Every cell has an accessible label and opens the day, the weigh-in or the
nutrition record. **Weight detail** plots actual weigh-ins and the rolling 7-day
average (the mean of whatever weigh-ins fall in that date and the six before; no
interpolation), with Week/Month/Quarter/Year as rolling 7/30/91/365-day windows.
The **weekly check-in** is the 7-day average now minus the 7-day average 7 days ago.
One primary weight per date: a dedicated Weight log wins over Strength bodyweight;
within a kind the most recently logged wins. **Steps** is a new daily evidence type
in `ledger_sessions` (`{ type: 'steps', date, steps, loggedAt, updatedAt }`), one
canonical value per date (the most recently logged); relogging a date edits it,
totals are never summed, averages cover logged days only, and Steps never counts
as training. **Challenge Zone** is a lightweight `ledger_challenges` record
(`id, title, startDate, endDate, status active|completed|cancelled, createdAt,
completedAt, notes`); day numbers are inclusive calendar days (start = Day 1),
"Starts in N days" before and "Ended" after. It appears in Progress, on Today
(above Morning Prime) and on Plan weeks/Day Plans that overlap it. It is a time
container only — no rules or compliance yet.
**Why:** the stacked bars were ambiguous; daily weight is noisy; steps and
time-bound challenges were missing.
**Implications:** Handoff adds "Challenge: <name> · Day X of Y" under the date and
"Steps: N" in Health & fitness. Steps is a Focus evidence type and a Calendar
filter. Challenge creation lives in Progress, not Settings. Progress sections are
id-wrapped blocks (`pgFocus`, `pgLast7`, `pgFreq`, `pgPair`, `pgCards`); the desktop
grid no longer depends on heading order.

### 2026-10-04 — Training days and modality frequency are different measures
**Decision:** Ledger counts two things. A **training day** is a unique date with at
least one qualifying session (HIIT + Padel on Tuesday = 1 day); its target is
`daysPerWeek` over the activities that count. **Modality frequency** is recorded
sessions of one type (that Tuesday = 1 HIIT and 1 Padel; two genuine HIIT sessions
on one day = 2). Each of Padel, Strength, HIIT, Cardio and Mobility may have an
optional `weeklyTarget` and `monthlyTarget`, stored in
`presets.trainingTarget.modalities[type]`. They are separate, deliberate values —
a monthly target is never derived from a weekly one — and null means show the
count only. Week follows Week starts; Month, Quarter and Year are calendar
periods; only Week and Month compare with targets. Actual counts are never capped
("3 / 2 · Target exceeded"), the target is secondary, and no percentage or
consistency score is shown without an explicit target.
**Why:** the HIIT target (2 a week) is a session count, not a day count; one
number could not answer both.
**Implications:** only recorded sessions count. A logged planned session is one
session record linked by `sessionId`; plans are never counted, so nothing counts
twice. The Calendar summary follows the display filter (All/Training → training
days; a type → its sessions). Progress has one Training frequency section with a
per-device period choice (`ledger_freq_period`). Settings splits Overall training
from By activity.

### 2026-10-04 — Calendar weeks vs rolling 7 days; a real training target
**Decision:** **Week starts** is a preference, Monday or Sunday (default Monday),
stored as `presets.weekStartsOn` so it follows Shaun across devices. A **calendar
week** follows it and is used by Plan, the Calendar grid and historical weekly
buckets (the 8-week charts in Progress details). **Rolling 7 days** is today plus
the previous six and ignores the preference; it answers "how have I been doing
recently?" — Progress's Last 7 days chart, the Strength/Mobility "Sessions, last 7
days" stats and the Focus evidence "N in the last 7 days" (all previously labelled
"this week" over an 8-day window). Month counts stay monthly. One set of helpers
(`weekStartFor`, `weekEndFor`, `weekDatesFor`, `weekdayLabels`, `rollingDays`,
`dateRangeLabel`…) replaces every `getDay()` week calculation. Changing the
preference regroups immediately and never moves a stored date; Plan rebuilds the
shown week around its chosen day, else today, else its middle. The Calendar's
"Consistency" (training days ÷ days elapsed) is replaced by a configurable
**training target**: `presets.trainingTarget = { types: [...], daysPerWeek }`,
counting days not sessions (two included sessions on a date = one day). No
days-per-week = no target, and the Calendar invites one instead of inventing it
(4 is offered as a suggestion only). Target inclusion is separate from the
Calendar display filter: the Training view shows every training type; Weight can
be viewed with any target. Phones use one Show picker instead of the sideways chip
row.
**Why:** Plan and the Calendar were hard-coded Sunday-first; "this week" metrics
were rolling windows in disguise; days-elapsed percentage was not a goal.
**Implications:** No data migration. Calendar summary uses the target's types for
both the week and the month figure, so they never contradict. Weight-only days no
longer count as training days in the Calendar summary.

### 2026-10-04 — Key tasks are up to three; Morning Prime steps can be skipped for the day
**Decision:** key tasks are "up to three", not exactly three. The Key Tasks step is
complete when it has been intentionally reviewed — Done (or "No key tasks today")
in the sheet sets `morningPrime.keysReviewedAt` — at any count 0–3; zero shows
"None today". A full three also counts (nothing is left to choose; keeps earlier
days complete). Any Morning Prime routine item, custom ones included, may be
skipped for a date: `morningPrime.skipped[itemId] = { at, reason: null }`.
Skipped resolves the step (counts toward Plan/Move and completion) but is not
evidence: no record is created, it shows as a muted dash with "Skipped today" and
Undo, and real evidence or a tick outranks it (a tick also clears the skip).
Wind-down does not skip. Today's Actions `+` opens one inline field: Return
creates a plain action and stays ready for the next; full details are edited after
creation by tapping the row. The Quick add / Detailed add split is removed from
Today. The light theme had a hierarchy/contrast refinement (tokens only, plus a
lifted card and raised mode tab in light); dark is unchanged.
**Why:** exactly-three made a deliberate lighter day look failed; Morning Prime
done late or partly had no honest state; choosing between two add modes was
friction; light cards disappeared into the page.
**Implications:** Handoff notes skips once ("completed at 07:07 (3 skipped)" or
"5 of 9 steps complete, 2 skipped"). New actions sort last by creation (order hints
are sparse), so no order is written. Light tokens: bg `#f2eadd`, surface
`#fdfaf4`, surface-2 `#ece3d4`, surface-3 `#e2d7c4`, lines 0.12/0.23, text
`#261d16`/`#5a4d3e`/`#73624d`; hero less sepia. Plan's "+ Add action" still opens
the editor; it can reuse `createQuickAction` later.

### 2026-10-04 — Strength, one training row, one Nutrition Plan, meals as a list
**Decision:** "Resistance training" displays as **Strength** everywhere (Plan,
Today, Flow, Quick Log, Recorded activity, Calendar, Progress, Focus evidence,
Handoff); the stored type stays `resistance`, so history needs no migration. The
five training cards fit one row on a phone. Diet and Fasting become one
**Nutrition Plan** picker: Not set, Fasting, No / Low Carb, Normal, High Carb (in
that order). Meal fields take Return to keep the meal and open a focused row below.
**Why:** five cards scrolled sideways; Diet + Fasting allowed "Fasting · Normal";
meals needed a tap on Add meal for every row.
**Implications:** no schema change. Not set = fasting false, carbLevel null;
Fasting = fasting true, carbLevel null; the others = fasting false with the
existing `low`/`normal`/`high`. A record holding both (pre-change) reads as
Fasting everywhere and is left as stored until the picker is changed. Labels:
"No / Low Carb", "High Carb". Today shows "Nutrition Plan · X" on its own line;
one-line summaries say "Fasting", "No / Low Carb", "High Carb" or "Normal
nutrition" (never a bare "Normal"). The Daily Handoff's "Diet:" block becomes one
line, `Nutrition Plan: X`. Return on a blank row adds nothing, Add meal reuses a
blank last row, blank rows are never saved, removing every row leaves one blank.
Toggling a training card from the keyboard now keeps focus on it.

### 2026-10-04 — The Day Plan sheet holds still; Clear belongs to Health & fitness
**Decision:** on phones the Day Plan sheet has one stable height (90dvh) and its
content scrolls inside it; sections animate open and closed (about 220ms, none
under reduced motion) and an opened section's header stays where it was — the
sheet scrolls only enough to show the start of new content hidden under the
footer. The plan-wide action is a sticky footer: **Finish planning** (filled
gold) for unplanned or draft days, **Save changes** (gold tint) for planned days,
replacing "Update plan". **Clear health & fitness** moved from the foot of the
sheet into the Health & fitness section as a quiet text action, shown only when
that section holds a rest day, training or training details, a diet, fasting, or
a meal with text; it confirms first and leaves the sheet open.
**Why:** the bottom-anchored sheet resized with its content, so opening a section
moved the whole sheet by over 200px; a global button cleared only one section.
**Implications:** save semantics unchanged (owned fields, `planReviewedAt`,
siblings kept). Clear patches only the health fields and is skipped when there is
no stored record; intention, actions, constraints, notes, Morning Prime, orders,
recorded sessions and food entries are untouched. The desktop inspector keeps
its full height; its footer now sits at the inspector's foot. Day notes in the
sheet now use the app's text-field style (it rendered as a bare textarea).

### 2026-10-03 — One section language on Today; Wind-down closes the day
**Decision:** Today's sections share one header — title, muted status/count,
chevron, reserved extra slot — and one icon language: `>` opens another surface,
`˅` expands in place, `+` adds, share shares; no "Open"/"Edit"/"View" text. Empty
sections collapse to their header (no "Nothing needs attention", "Nothing planned",
"Nothing logged yet"). Evening Wind-down moves below Recorded activity and becomes
a quieter sibling of the Morning Prime card. Recorded in UX_PLAYBOOK §41 and
DESIGN_SYSTEM §7e.
**Why:** headers mixed verbs, arrows and chevrons, and empty sections spent space
saying they were empty.
**Implications:** Today order: Morning Prime, Overview/Flow, Backlog, Actions,
Communications, Health & fitness, Day notes, Quick log, Recorded activity, Evening
Wind-down, Share day for Claude. Health & fitness never shows a bare diet word
("Normal diet", "3 meals · Normal diet · Fasting"). No data or behaviour changed.

### 2026-10-03 — Backlog is Backlog; Inbox is reserved; Today has one hierarchy
**Decision:** the Today section briefly called Inbox is Backlog again: Actions
assigned to an earlier date and not completed. "Inbox" is reserved for a future
concept — something captured but not yet decided (what it is, which date, whether
it is an Action, Matter or note); no Inbox data model exists and none was built.
Backlog moves above Actions and is collapsed by default, as quick triage before
the day. Today's typography uses a small set of roles: display serif for the
date, accent serif italic for the quote only, sans 600 headings (Actions 17px,
other sections 15px) in sentence case without rules, sans 15px action titles,
sans 12px meta, quiet sans empty states. Communications and Health & fitness on
Today are short summaries; done rows recede.
**Supersedes:** the Inbox naming in the 2026-10-02 decision.
**Why:** headings were weaker than the rows beneath them, empty states were the
loudest text on an empty day, and unfinished old work was taking space before
being asked for.
**Implications:** no data or behaviour changed beyond Backlog's position and
collapsed default. Today order: Morning Prime, Overview/Flow, Backlog, Actions,
Communications, Health & fitness, Day notes, Quick log, Evening Wind-down,
Recorded activity.

### 2026-10-03 — Lower cognitive load: rows, quiet secondary sections, gold for meaning
**Decision:** a simplification pass across every screen, taking principles (not
looks) from Things 3, Linear, Sunsama, Structured, Apple Health, Superhuman and Bear:
lists are hairline-divided rows rather than cards; secondary sections are quiet
sentence-case rows; gold is kept for importance, selection and primary actions;
explanatory text goes once a control is obvious; empty and done things recede;
secondary editor fields sit behind one disclosure. Recorded as UX principle 12b and
DESIGN_SYSTEM §7c.
**Why:** Ledger has enough capability; the problem had become seeing what matters.
**Implications:** no function, data or schema changed. Measured on the realistic
seed: Today on a phone went from 19 boxed containers to 3, 11 uppercase labels to
7, 13 gold marks to 4, and shows all 6 actions on the first screen instead of 4.

### 2026-10-02 — Optional times; the timeline takes Structured's calm
**Decision:** Shaun chose, from Structured (the daily planner), optional times,
a clean timeline with icon capsules, and an Inbox, for Today and Plan. Actions may
now carry a time and duration; timed items sit at their time, untimed items keep
their order. Every action row (Today, Plan, Communications, Calendar day) uses one
anatomy: capsule · title and a meta line (time · state · category · matter) ·
tick. Backlog is presented as the Inbox.
**Supersedes:** the 2026-09-30 decision that Flow is "an order, not a schedule"
and that nothing time-blocks — in part. Untimed items are still a sequence; Ledger
still never assigns or moves a time on its own.
**Why:** Shaun wanted Structured's uncluttered, non-distracting timeline, with times
where he chooses to give them.
**Implications:** no new collections; two optional fields on actions. The Handoff
leads timed lines with their time range and instruction 6 explains timed vs
untimed lines. Overview's Order view no longer numbers rows or shows a grip — the
capsule is the handle. Not taken: the week strip and per-action colour/icon
choice (colour comes from the category).

### 2026-09-30 — One selection control: the Ledger picker
**Decision:** raw browser-native selects are no longer visible anywhere in
Ledger. Every `<select>` is upgraded, wherever it is rendered, into a Ledger
field that opens a bottom sheet on phones or a compact anchored popover on
desktop; the hidden select stays as the value holder. Selection UI now follows
one app-wide pattern: segmented controls or chips for 2–3 options, the picker
for a small list, the picker with search for a long one.
**Why:** native selects brought browser bevels, arrows, radii and colours that
broke the design language and ignored the light theme.
**Implications:** no stored value, schema or save path changed — forms still
read `.value` and listen for `change`. New selects need no extra code.

### 2026-09-30 — Communications: who has the ball, not another inbox
**Decision:** Phase 1 of the Communications Centre models Matter → Conversation →
Action (§34 of the brief):
- Matter = the wider ongoing piece of life/work.
- Conversation = the communication thread/context.
- Action = the existing executable commitment (`ledger_commitments`).
- Waiting is a state, not a task — Ledger never creates "Wait for X" actions.
- Completing a communication Action does not close its Matter.
- Communications are whole-life, not business-only (areas: Business, Family,
  Personal, Friends, Other).
- Future external messaging integrations (Gmail, WhatsApp) attach to this model
  through `channel` and `externalRef` on the conversation.
**Why:** the question Shaun needs answered is "who has the ball?", which neither a
task list nor an inbox answers.
**Implications:** Today counts Needs me, Waiting (on them or a third party) and
follow-ups due (date today or earlier, conversation still active). Waiting never
enters Flow. No ingestion, sending, AI triage, contact sync, CRM or notifications
in Phase 1. Wording states position, never blame ("Waiting on solicitor").

### 2026-09-30 — Planned is a declared state; Flow is an order, not a schedule
**Decision:** a day's readiness is Unplanned / Draft / Planned, derived by
`getPlanReadiness(date)` from the day's actions and plan fields, with Planned
meaning `planReviewedAt` is set. Today gains Overview (the editable day) and Flow
(the execution sequence), backed by `plan.dayFlow` — references to actions and
planned training, never copies.
**Why:** the week could not tell a considered day from a half-started one, and
`actionOrder` could only order actions, so a workout could not sit between tasks.
**Implications:** order arrays alone never make a day a Draft. A planned day stays
Planned when edited. The default flow is the actions in day order, then training,
so Flow is never empty just because it was never saved. The Daily Handoff gains
TODAY'S FLOW ("FLOW UPDATED" when it changed since last sent), plus an
instruction that the numbers are sequence, not times. Nothing was added that
schedules, time-blocks or auto-orders.

### 2026-09-30 — Plan is the whole-life Day Plan, not a Health & Fitness form
**Decision:** a selected day in Plan is a Day Plan of five sections — Direction,
Actions, Health & fitness, Constraints, Day Notes — over the same records Today
uses. No schema was added: actions are `ledger_commitments`, key outcomes are
`isKeyTask`, priorities come via `priorityId`, and intention, notes and
constraints are the existing plan fields. Morning Prime's plan step is now
"Review today's plan" and opens the Day Plan at Actions and Health & fitness;
saving it still sets `planReviewedAt`.
**Why:** the rest of Ledger already plans work, family, communication and
success; Plan only showed food and exercise.
**Implications:** Health & fitness keeps its explicit Save; the intention and
Day Notes save as you type (as they do on Today); actions save as records.
"Clear plan" became "Clear health & fitness" and clears only those fields — it
used to delete the whole day record, taking notes, intention and Morning Prime
with it. Backlog can move an item onto the planned day (same record, original
date kept). Plan now refreshes when actions change (it previously went stale).
The action editor takes a target date and a return path; the Backlog sheet takes
a target date. A stored Morning Prime label still reading "Finish health &
fitness" shows the new wording; a renamed one is left alone.

### 2026-09-30 — Desktop Calendar: the day pane cannot move the month
**Decision:** from 1024px the Calendar is `minmax(0, 1fr)` + a day-pane column of
`clamp(340px, 26vw, 400px)`, set by the viewport, never by content. The pane
spans the month column's rows with the month grid in a flexible last row. The
divider is drawn by the section, and wider screens reserve the scrollbar gutter.
The pane is sticky, and it never scrolls on its own.
**Why (root cause):** the pane shared the month column's grid rows. A busy
day's height was spread over the summary and chip rows, pushing the chips and
month grid down by up to about 430px. Its changing height also toggled the page
scrollbar, which on always-visible-scrollbar setups narrowed everything by 15px.
**Implications:** measured identical positions for the month heading, summary,
chips, weekday row, grid, cells, pane and divider across sparse, busy, today,
single-plan and long-title days at 1024–2560px. Long titles wrap inside the pane.

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
*(Superseded 2026-10-06 by "Firebase Auth is the identity boundary".)*
**Decision:** `allow read, write: if true`, accepted knowingly for a
single-user app with no login.
**Why:** No auth exists; the app must work immediately on Shaun's phone.
**Implications:** Anyone with the project ID could read/write all personal data
or write to `ledger_pins` to push arbitrary notifications. Revisit before any
wider exposure — see Open Questions.

---

## Current Task

Owner: Shaun
Status: Verification (2026-10-09)
Objective: redeploy rules + functions for withdrawn Partner Requests; check the Today hierarchy, header polish and the Catch-up review on the phone
(Next 1), and finish the remaining push device checks (Next 2–3).
Acceptance criteria: Next 1–4 confirmed.

The backlog exists as GitHub Issues (#5–#19). None of it is authorised for
implementation — see the workflow rules in `CLAUDE.md`.

---

## Open Questions

Each question that became a discrete piece of work now has an Issue. The Issue
carries the detail; this list records that the question is still open.

1. **Firestore rules vs "Privacy by design".** *Being resolved (2026-10-06): auth +
   owner-only `firestore.rules` are in the repo and emulator-tested; live once Shaun
   deploys them after creating his owner profile (`docs/SECURITY.md`).* Previously:
   rules fully open and not in the repo (no `firestore.rules`; `firebase.json`
   deployed functions only).
   Knowingly accepted, but it conflicts with the stated principle. Options
   previously offered: scope rules per collection, App Check, or real auth.
   → **#5** (proposed P0). Sharpened by audit: the repository is public and the
   client config is committed, and `ledger_pins` is writable by anyone, which
   means arbitrary push notifications to the phone. Since 2026-09-30,
   `ledger_matters` / `ledger_conversations` hold names, positions and notes about
   clients and family under the same open rules — raising the stakes of #5.
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

No active handoff. Today header polish + resumable Catch-up (2026-10-09) is
complete. **Not authorised:** a scheduled-reminder engine (timed reminders, "X
minutes before", recurring/accountability).

---

## Recently Completed

- (2026-10-09) — Desktop Today hierarchy: Communications moved beside Health &
  fitness (active context), 40 / 32 / 28 columns at ≥1600, level column heads,
  collapsible Communications with a tally and Open Communications, Wind-down's
  chevron in the shared column. Layout QA 88/88 at 390–1728; browser suites,
  Partner Sharing e2e (1440) 154 and push e2e 66 green.

- (2026-10-09) — Withdrawn Partner Requests: Past grouping, ⋯ with Move to upcoming /
  Hide from my list, the Upcoming state, provenance links both ways, the push
  wording. Rules 299 (28 new), engine 43, Partner Sharing e2e 154 (22 new), push
  end to end 66 (renewal pushes once). **Needs the rules (and functions) redeployed.**

- (2026-10-09) — Today two-tier hierarchy: primary (Actions, Communications,
  Health & fitness) vs secondary (Backlog, Day notes, Quick log, Recorded
  activity), phone and desktop. Tier QA 14/14 in dark and light (contrast,
  chevron column, tap heights, behaviour unchanged); browser suites green.

- (2026-10-09) — Today header polish + Catch-up as a resumable review: Health &
  fitness collapse with a records-based summary, one header geometry across seven
  sections, Actions summary only Actions, a quiet Catch-up entry, return-to-review
  from Action, training, nutrition and symptom editors, oldest-day-first chaining
  and a restrained close. New QA 30/30 (dark and light, Scenarios A–F); browser
  suites, Partner Sharing e2e 132 and execution e2e 63 green.

- (2026-10-08) — Reset Sprint, Current Focus and the cross-device Push Foundation
  (rules, the one push engine in `functions/`, Settings → Notifications for owner
  and partner, service worker tags and in-app deep links, `?sprint=`). Rules 271,
  engine 41, end to end 63 (three Owner devices and Abi, on the Auth, Firestore and
  Functions emulators, with real Web Push encryption to a local endpoint), Partner
  Sharing e2e 132, and the browser suites. Not deployed: Shaun's setup is in
  `docs/SECURITY.md`.

- (2026-10-07) — Today polish pass: Challenge collapsed by default (per-day memory,
  quieter weekly list), Morning Prime "Completed HH:MM", Flow suggested by the switch,
  tighter status spacing (five Actions in the first viewport at 390px, was about
  one and a half), quieter Actions header, readable done rows. Also fixed a button-
  padding bug that drew every status tick as a symmetric "v" (read as a chevron).

- `4325821` + `43bbd64` (2026-10-07) — Vercel + custom domain migration audit:
  `ledger.sgj.luxe`
  canonical (`LEDGER_HOME`; emailed links return to production from unknown
  hosts); deep links `?openAction=`/`?request=`/`?view=` on the root; Vercel build
  stamp (`vercel.json` + `scripts/vercel-build-info.js`); host-neutral freshness UI;
  legacy Pages "moved" link with no redirect; `APP_URL` default →
  ledger.sgj.luxe; origin-local state and Blaze documented. End to end 132 checks
  (emulators); live-domain checks pending Shaun (not reachable from Claude Code).
  The first Vercel build with the stamp step failed (no `public/`); `43bbd64` set
  `outputDirectory: "."` and deployed. Production stayed on the previous build
  meanwhile.
- (2026-10-07) — Challenge weekly targets (counts and steps, optional daily goal,
  per-week scope), on the challenge sheet, Today and the share snapshot.
- (2026-10-07) — Password sign-in as the main way in (email link as backup):
  sign-in screen, password email, Settings and partner password sheet; e2e 121
  checks, including a link-only account gaining a password with the same UID.
- (2026-10-07) — Sign-in on ledger.sgj.luxe: root cause was the daily email-link
  quota hidden behind "Something went wrong". Errors now named, with the Firebase
  code; continue URL limited to known hosts; e2e covers the quota refusal and a
  reload staying signed in.
- (2026-10-07) — Partner Sharing Phase 2.5: request Updates timeline (comments +
  lifecycle entries), owner/partner request detail with composer, read marks and
  "updated" signals, Inbox update rows, transactional accept/dismiss/sync, withdraw
  as a state; rules 205 and end-to-end 104 checks.
- (2026-10-07) — Partner Sharing Phase 2: shared-namespace rules (143 emulator
  tests), owner publish (day/week, Abi preset, review, live sync, checkpoint),
  partner view (Today / This week / requests), owner Inbox with request → Action
  provenance and completion/move/delete sync, Settings → Partner sharing, end-to-end
  suite in `tests/e2e/` (71 checks, real SDK on emulators).
- (2026-10-07) — Auth + owner-only rules rolled out and verified on Shaun's devices;
  #5 closed. Pin now found never deployed (Spark plan) → #20.
- (2026-10-06) — Partner Sharing step 1: Firebase Auth (email link) gate with
  owner / partner / no-role / signed-out states, owner-only `firestore.rules`
  (emulator-tested), push ownership, `docs/SECURITY.md`.
- (2026-10-06) — Day Plan "Save draft"; training form offers Save to plan and Log
  activity from both Plan and Today.
- (2026-10-06) — Day snapshot sharing: image of chosen sections/items, built-in and
  named presets (create, update, rename, delete), Share / Save image; H&F share icon
  and a "Share snapshot" link at the foot of Today.
- (2026-10-05) — Planned meals relabelled Food Plan; Today's Health & fitness lines
  keyed (Training / Nutrition Plan / Food Plan / Food Diary / Steps).
- (2026-10-05) — Food diary line in Health & fitness and a diary link in the meals
  sheet, so the day's diary is one tap away.
- (2026-10-05) — Challenge tasks as optional daily Actions (Today, Flow, Day Plan),
  and scoped add (just today / from today) and edit/remove (just this day / from
  this day on / every day), with one-day exceptions shown and restorable.
- (2026-10-05) — Challenge daily tasks: detail sheet (tasks for today or an earlier
  day, last seven days, days complete), add/edit/remove tasks, count log with
  quick-add, steps linked to the Steps record, Today pills, Progress tile line,
  Health & fitness target, Handoff line.
- (2026-10-05) — "Choose your key tasks" redesign: Selected / Today / Backlog
  sections, whole-row selection with a separate details control, Backlog items
  moved (not copied) to today, separate "+ New action", search only for long
  lists, quiet three-limit note, refined footer, selection-mode full Backlog.
- (2026-10-04) — Progress/Health expansion: Last 7 days T/W/N matrix, Weight detail
  (actual + 7-day average, periods, summary strip, weekly check-in, compact list),
  manual daily Steps (Quick Log, Today, Calendar, Progress, detail, Focus, Handoff),
  Challenge Zone (Progress, Today, Plan, Handoff).
- (2026-10-04) — Training days vs modality frequency: per-activity weekly/monthly
  session targets, Calendar summary by filter, Progress Training frequency with a
  Week/Month/Quarter/Year selector, Settings By activity.
- (2026-10-04) — Week starts setting (Monday/Sunday) with shared week helpers;
  Rolling 7 days for recent Progress views; Plan week switcher, swipe and This
  week return; Calendar training target (types + days/week) replacing
  Consistency; single Show picker for the Calendar filter on phones.
- (2026-10-04) — Key tasks up to three with an explicit review (`keysReviewedAt`,
  "None today"); per-day Morning Prime skip with undo; inline rapid Action entry on
  Today replacing Quick add / Detailed add; light theme contrast/hierarchy pass.
- (2026-10-04) — Health & fitness refinement: Resistance training displays as
  Strength, all five training cards on one mobile row, Diet + Fasting replaced by
  one Nutrition Plan picker (fasting/carbLevel kept), Enter-to-add meals.
- (2026-10-04) — Day Plan sheet refinement: stable mobile geometry with internal
  scrolling, animated sections with reduced-motion support, Save changes
  replacing Update plan, Clear health & fitness contextual and conditional.
- (2026-10-03) — Today section consistency: shared headers and icon language, no
  filler empty states, diet summary fixed, Wind-down below Recorded activity as
  Morning Prime's quieter sibling.
- (2026-10-03) — Today hierarchy pass: type roles, headings without rules,
  quiet empty states, summary-only Communications and Health & fitness; Backlog
  renamed back from Inbox, moved above Actions, collapsed by default.
- (2026-10-03) — Visual simplification phase across Today, Flow, Plan, Calendar,
  Progress, Focus, Communications and the action editor (see Decisions Log).
- (2026-10-02) — Structured-inspired pass: optional action times and durations,
  Flow as a time-aware capsule timeline (now marker, free gaps, hold-to-drag),
  capsule rows across Today and Plan, Backlog presented as Inbox, Handoff times.
- (2026-09-30) — Native dropdowns replaced by the reusable Ledger picker across
  actions, Plan (Diet), training forms, Communications, symptoms, priorities
  and Focus.
- (2026-09-30) — Communications Centre Phase 1: Matters and Conversations with
  attention states, linked Actions, the "What happens next?" step on completion,
  Today summary, Centre (phone sheet / desktop split), Handoff attention section.
- (2026-09-30) — Plan readiness (Unplanned / Draft / Planned ✓) across the week,
  Day Plan and desktop pane; Today gains Overview / Flow with `plan.dayFlow`; the
  Handoff exports the flow.
- (2026-09-30) — Plan became the whole-life Day Plan (Direction, Actions, Health &
  fitness, Constraints, Day Notes) over shared records; whole-day week rows;
  Morning Prime step renamed "Review today's plan".
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

1. **Shaun: redeploy rules and functions** (withdrawn requests): `firebase deploy
   --only firestore:rules,functions` from `~/Ledger` after `git pull`. Until then,
   Move to upcoming and Hide are refused by the live rules. Then Abi: withdraw a
   test request → ⋯ → Move to upcoming (Shaun's phone: "Abi moved a request to
   upcoming") → withdraw it again → ⋯ → Hide from my list.
2. **Shaun: Today on the phone and the MacBook** — on the Mac: Backlog + Actions,
   then Communications + Health & fitness, then the quieter utilities;
   Communications opens in place, "Open Communications" goes to the Centre. On
   the phone: Actions, Communications and Health & fitness
   read as the main sections; Backlog, Day notes, Quick log and Recorded activity
   read as quieter utilities but still look tappable. Health & fitness starts collapsed with a
   summary that matches the day; its chevron and the share icon both work and the
   open state sticks for the day. Actions says "N outstanding" and nothing about
   training. With yesterday unclosed: the row says "Yesterday needs finishing" →
   open an Action from it → cancel → back in the review, still open → complete it →
   back, resolved → Close this day → "Yesterday is closed", back on Today.
3. **Shaun: the remaining devices** (on `https://ledger.sgj.luxe`). Done: rules
   and functions deployed; the Samsung enabled; Mac → Samsung focus push works.
   - **iPhone and iPad**: Safari → Share → Add to Home Screen → open Ledger *from
     the icon* → sign in (the installed app has its own sign-in) → Settings →
     Notifications → Enable → allow. In Safari itself it says "Install Ledger to
     your Home Screen…" — expected.
   - **MacBook** (optional, to receive as well as send): Settings →
     Notifications → Enable.
   - Change focus on the iPhone → the Mac and Samsung follow; tap the
     notification → that Action opens. Start a Reset Sprint, tick the first item on
     another device → the focus moves on everywhere.
4. **Abi**: installs and signs in → footer → Notifications → Enable. She sends a
   request → Shaun's devices: "Abi sent a request"; she adds an update → Shaun;
   Shaun adds one → Abi. Tapping opens the request. Nothing private shows.
5. If not done yet: the domain checks from 2026-10-07 (build stamp "Up to date",
   password + email-link sign-in return to ledger.sgj.luxe, `?view=week` refresh)
   and the challenge line / Morning Prime check on the phone.
6. Shaun: create the GitHub Project (Open Q7); triage #6–#19.

Everything else is on the board. Do not duplicate it here.
