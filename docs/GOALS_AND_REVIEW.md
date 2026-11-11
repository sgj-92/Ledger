# Goals, weekly planning and review — design for review

Status: **approved 2026-10-31; phase 1 built 2026-10-31** (§9). Shaun's answers to §8 are
recorded there. Phases 2 and 3 are not started.

> "Let's look at closing the review → adjust loop and enhancing planning to align closer
> to my personal and business goals."

**Shaun's answers (2026-10-31):**
- **Structure:** year → 90 days → week.
- **Rhythm:** two weekly reviews — Friday for business, Sunday for personal.
- **Claude:** drafts the review and proposes next week; Shaun edits and approves.
- **Measures:** numbers he updates himself (revenue, new clients), alongside the evidence
  Ledger already records.

---

## 1. The problem

The core loop is Plan → Do → Track → Review → Adjust.

**Plan, Do and Track are strong.** Morning Prime, key tasks, Flow, the logs and Wind-down
all work day to day.

**Review and Adjust stop at the day:**
- Wind-down and Catch-up close a day. Nothing looks across a week.
- **Priorities** (Me → Focus) hold the outcomes, but planning never asks about them.
- An Action *can* name a priority. Nothing prompts it, so most don't.
- A week can be full and busy while moving no goal, and Ledger can't say so.

The principle "Direction before productivity" is stated but not yet enforced by the loop.

## 2. The shape

Three levels, in two areas:

| Level | What | How many |
| --- | --- | --- |
| **Year goal** | where this year is going ("Business: £X revenue", "Personal: 85kg and fit") | a few per area |
| **90-day goal** | what this quarter delivers towards a year goal | 1–3 per year goal |
| **Weekly outcome** | what this week moves on a 90-day goal ("Send 5 proposals") | 1–3 per active 90-day goal; about 7 a week in all |

**How the levels connect to each day:**
- An **Action** may name the weekly outcome it serves.
- **Morning Prime's "Set 3 key tasks"** starts from the week's outcomes.
- So every day can trace back up to a year goal. None has to.

**Areas: Personal and Business**, the same split Comms already uses.
- Each goal and outcome has one area.
- An unlinked Action takes its area from its category; see §8, question 2.

**Measures:**
- **A number you update:** revenue, clients, pipeline. It has a start, a target and a log
  of values entered at review time.
- **Evidence Ledger already records:** weight, training, nutrition, linked Actions. This
  is the existing `evidenceType`.
- **Or none:** qualitative goals stay valid.
- **How a measure is shown:** counts and the gap to target only ("£42k of £60k · £18k to
  go"). No scores, percentages or pass/fail colours, as decided on 2026-09-29.

## 3. Data

**Goals extend the existing priorities** (`ledger_priorities`).
- Nothing is lost: each priority becomes a year goal, and is asked its area once.
- **New fields:**
  - `area`: `personal` or `business`;
  - `horizon`: `year` or `quarter`;
  - `parentId`: a 90-day goal's year goal;
  - `period`: `2026` or `2026-Q4`;
  - `status`: `active`, `achieved` or `dropped`, never deleted;
  - `why`;
  - `measure`: `{ kind: 'number', unit, start, target }`, beside the existing
    `evidenceType`;
  - `values`: `[{ date, value, note }]`, the last 60.
- Editors build on the stored record, as every editor must.

**A week is one record:** `ledger_weeks/{week start date}`. Per-period state lives on the
period's record, as per-day state lives on the day's plan.
- `outcomes`: `[{ id, text, goalId, area, order, result: null | 'done' | 'partly' | 'not', note }]`.
- `reviews.business` and `reviews.personal`:
  `{ at, summary, wins, misses, patterns, decisions, measuresUpdated }`. This is Shaun's
  approved text, Claude's draft edited.
- `plannedAt`.

**Actions:** an optional `outcomeId`, beside the existing `priorityId`.

**Security:** everything is owner-only, the same rules as `ledger_plans`. Nothing crosses
to Abi; her Home Claude never sees it.

## 4. Planning: the week and the day

**Plan tab, this week:**
- The week's outcomes sit at the top, grouped by area, each named with its goal.
- Tap one to see the Actions serving it this week. Add or remove outcomes here.

**The Action editor** gets "Moves", a picker of this week's outcomes, so the link takes one
tap.

**Morning Prime, "Set 3 key tasks":**
- The week's open outcomes are shown first.
- Choosing one makes a key task already linked to it.

**Today:**
- An Action that serves an outcome shows it as a quiet line.
- Nothing new is added above the fold.

**Me → Focus becomes Me → Goals:**
- Personal and Business.
- Each year goal shows its 90-day goals and its measure's latest value.
- The active focus items stay.

## 5. The reviews

**Friday: business review.** Prompted Friday afternoon; see §8, question 1.
1. **The evidence, from the records:**
   - this week's business outcomes, each marked done, partly or not;
   - business Actions done;
   - Actions that slipped: moved more than once, or still open;
   - Comms: business conversations that need you or have gone quiet;
   - each business measure, with a field for this week's value.
2. **Claude's draft:**
   - the week in four lines;
   - wins;
   - what didn't move, and the likely reason, from the records only;
   - **goals that got no time this week;**
   - patterns, e.g. "proposals slip every Thursday".
3. **Proposals**, ticked and applied as today:
   - next week's business outcomes;
   - stale Actions to drop or move;
   - an outcome to carry over or let go.
4. **Approve:** the review is saved on the week, and the proposals are applied with Undo.

**Sunday: personal review.** The same flow for personal goals: training, weight, food,
family, Morning Prime streak and sleep if logged. It then plans the whole coming week, with
business outcomes already set on Friday.

**End of a quarter:**
- Each 90-day goal: achieved, carry over or drop.
- Then set next quarter's.

**Each month:** a light check, the measures' trend and nothing to fill in. This comes in a
later phase.

**Principles kept:**
- Evidence before encouragement.
- Missing data is not failure: "no weight logged this week", never "missed".
- Ledger recommends; Shaun decides. Nothing moves without his tick.

## 6. Claude's part

These are new tools on Shaun's assistant (`functions/assistant.js`), owner-only like the
rest.
- **Read:**
  - `list_goals`;
  - `get_week`: the outcomes, the week's Actions and how each ended, Morning Prime and
    Wind-down results, training and weight, Comms states, and measures;
  - `get_weeks`: the last few, for patterns.
- **Propose:**
  - `propose_outcomes` for next week;
  - `propose_outcome_result`;
  - `propose_review` (the draft text);
  - the existing Action changes, for drop and move.
- **The review draft is a proposal like any other.** He edits the text before approving it.
- **His records are data, never instructions**, as now.

## 7. Phases

1. **Goals and the week.**
   - Areas and the year → 90-day structure; priorities move over.
   - Number measures.
   - Weekly outcomes on the Plan tab.
   - "Moves" on Actions, and Morning Prime's key tasks from the outcomes.
2. **The weekly reviews.**
   - The Friday and Sunday flows, with evidence and measures.
   - Claude's draft and proposals.
   - Saved on the week.
3. **Quarter and month.**
   - End-of-quarter goal review.
   - The monthly trend check.
   - A measures chart in Progress.

Each phase is usable on its own. Phase 1 already lets a plain week be checked against its
goals.

## 8. Decided (Shaun, 2026-10-31)

1. **Prompting the reviews:** a card on Today (Friday from 15:00, Sunday from 17:00, until
   done), plus one notification at that time. This approves Ledger's first timed
   reminder, for these two reviews only.
2. **Area of an unlinked Action:** by category. Work, success and communicate are
   business; family, personal and training are personal.
3. **Quarters:** calendar quarters.
4. **The week** starts on his setting (Monday). The Friday review covers Monday to
   Friday; the Sunday review covers the week.
5. **Priorities carry over:** each becomes a year goal, and Ledger asks its area once.

## 9. Phase 1 as built (2026-10-31)

**Code:** `index.html` — "goals" (after the priorities' evidence) and "the week's
outcomes"; the Action editor's "Moves"; the key-tasks sheet. **Rules:**
`ledger_weeks/{week start}`, owner only. **Tests:** the rules suite (`ledger_weeks` with
the private collections) and `tests/e2e/goals.test.js` (phone and Mac).

**Me → Goals** (the Me switch's third tab, formerly Focus):
- Business, then Personal. Each year goal shows its 90-day goals beneath it, its measure
  and its evidence. "+ Goal" per area; "+ 90-day goal" on a year goal.
- **Priorities carried over:** read as active year goals for this year. A card asks the
  area of each one without one; choosing saves `area`, `horizon`, `period` and `status`.
  Nothing else is migrated or written.
- **The goal sheet:** goal, area, horizon (this year or 90 days; a 90-day goal has a
  calendar quarter, this or next, and a year goal it is part of), why it matters, and a
  measure: none, a number (unit, start, target, and a new value saved with today's date),
  or Ledger records (the existing evidence). One measure per goal.
- **Never deleted:** "Mark achieved" or "Drop this goal" (`status`, `closedAt`); both
  stay under "Achieved and dropped", and "Make active again" reopens.
- A goal's linked actions now include actions naming a goal under it, or an outcome that
  moves it.

**Plan → Outcomes**, above the week's days:
- The week shown: its outcomes by area, each with its goal and its actions ("2 actions, 1
  done"). Folds; each device remembers.
- **The outcome sheet:** text, the goal it moves (90-day goals first; its area follows the
  goal, or is chosen), and, once it exists, its result (open, done, partly, not this week),
  its actions with "+ Add action", and "Remove outcome" (its actions stay, unlinked).
- The record is keyed by the week's first day on Shaun's week-start setting. Changing that
  setting leaves earlier weeks under their old key.

**Moves** in the Action editor: one tap on any open outcome of the action's week (or the one
it already names). **Today** shows that outcome as a quiet line under the action.

**Key tasks** (Morning Prime and Plan): "This week's outcomes" come first. Choosing one opens
a new action with the outcome's text to edit; it is made a key task that moves the outcome,
in Work or Personal by the outcome's area.

**Not yet (phase 2):** the reviews, the Today card and the two notifications. Marking
results in the outcome sheet is the manual form of what the review will do. Claude's goal
and week tools (§6) arrived with Ask Claude phase 2 on 2026-11-01
(`docs/CLAUDE_ASSISTANT.md` §13); the review draft (`propose_review`) comes with the
reviews.

## 10. Phase 2 as built (2026-11-11), with the goal line

**The goal line** shows on Plan → Outcomes, in Today's Wind-down, and in each review. It
reads like "8 of 14 Actions this week move a goal · No time yet: Pipeline".
- **Counts only.** An Action moves a goal when `actionGoalIds` finds one: it names a goal,
  a goal under it, or an outcome that moves one.
- **The goals a week is for:** that quarter's 90-day goals, plus this year's goals that have
  none under them.
- **An Action's area** is its goal's; failing that, its category's (§8, q. 2).
- **Code:** `weekGoalLine` and `goalLineText` in `index.html`.

**The reviews** (`openWeekReviewSheet`):
- **Friday, business:** Monday to Friday. **Sunday, personal:** the whole week.
- **The sheet:**
  - **Outcomes:** each marked Done, Partly or Not this week, saved as he taps.
  - **The week:** the area's goal line, Actions done, what's still open or came in from
    earlier weeks. Business adds the Comms counts; personal adds training days, food days,
    Morning Prime and weight.
  - **Measures:** this week's value, saved on approve with the note "Weekly review".
  - **His review:** the week in a few lines, wins, what didn't move and why, patterns, next
    week.
- **Saving:**
  - **Approve:** `ledger_weeks/{week start}.reviews.{area}`, with `at`, the five texts and
    `measuresUpdated`.
  - **Save and finish later:** `reviewDrafts.{area}`.
  - Editors build on the stored week, so outcomes and the other review survive.
  - Sunday's approve offers **Plan next week**.
- **Prompting** (§8, q. 1):
  - **On Today:** a card from Friday 15:00 to the week's end (business), and from Sunday
    17:00 to the end of Monday (personal), until approved.
  - **Notifications:** one at Friday 15:00 and Sunday 17:00. These are `remind.js`
    reminders, on by default, quiet once approved, editable or switchable in Settings →
    Reminders.
  - **Plan → Outcomes:** both reviews can be opened from the week's Friday on.
- **Claude's draft:**
  - **Draft with Claude** asks Ask Claude to read the week and propose: `propose_review`
    (the draft), results for open outcomes, next week's outcomes and stale Actions.
  - Applied, the draft lands in `reviewDrafts`, and "Back to the review" fills the fields
    for him to edit. An approved review is never overwritten by a draft.

**Tests:**
- `tests/functions/assistant.test.js`: `propose_review`.
- `tests/functions/remind.test.js`: the review prompts, including Sunday-start weeks.
- `tests/e2e/assistant.test.js`: the draft from link to approval, under the rules.

**Phase 3:** see §11. The monthly trend is still to come.

## 11. Phase 3 as built (2026-11-11): Goals rebuilt, and the quarter review

**The Progress Identity card is gone.** XP, levels, avatars and the streak went at Shaun's
request.

**This week, at the top of Me → Goals** (`renderGoalsWeek`):
- the goal line;
- the week's outcomes ("1 of 2 done"), a tap to Plan;
- the Friday and Sunday reviews, each marked done or due, and each opening its review;
- the quarter review, while it's due.

**A goal's own page** (`openGoalPage`; a tap on any goal):
- **Why it matters.**
- **Its 90-day goals**, or the year goal it's part of. Each opens its own page.
- **Measure:**
  - the gap ("8 leads of 20 · 12 to go");
  - a line of the values entered, with a dashed target line;
  - a field for today's value, and the last five values.
  - A goal measured by Ledger records shows those instead.
  - Counts and the gap only, as decided on 2026-09-29.
- **Effort by week:** Actions done for it in each of the last 8 weeks, by
  `actionServesGoal`. This week also shows what's still planned.
- **History:**
  - each week it had an outcome: the outcome and how it ended;
  - that week's review in its area;
  - any review that names it;
  - the quarter reviews' decisions.
  - A tap on a review opens it.
- **Edit goal** returns to the page.

**The quarter review** (`openQuarterReviewSheet`):
- **The quarter in counts:** outcomes done, weekly reviews approved, Actions done that
  moved a goal.
- **Each 90-day goal:** Achieved, Carry over or Drop, with its measure, outcomes and
  Actions.
  - In Q4, each of the year's goals as well: Achieved, Carry into next year, or Drop.
  - A goal left undecided stays as it is.
- **Next quarter:** under each year goal, the goals already set and those being carried,
  plus a field to add one. A goal added here is saved at once.
- **What the quarter taught you:** optional.
- **Close the quarter** applies the decisions:
  - **achieved or dropped:** `status`, `closedAt`;
  - **carried:** `period` moves to the next quarter (or year), and `carriedFrom` gains the
    old one. The goal stays one record, keeping its measure and history.
- **Finish later** keeps the choices in `draft`. So does each tap.
- **Data:** `ledger_quarters/{2026-Q4}` =
  `{ at, goals: [{ id, title, horizon, area, result }], notes, draft }`. Owner-only, like
  the weeks.

**Prompting:**
- **Today card and Goals chip:** from the quarter's last seven days until it's closed.
  If its 90-day goals are still open, also for two weeks into the next quarter.
- **Notification:** `reviewQuarter` in `remind.js`, at 18:00 on the quarter's last Sunday.
  It's on by default, and changeable in Settings → Reminders. Any day he picks fires only
  in the quarter's last seven days. It stays quiet once the quarter is closed.
- **Link:** `?open=review-quarter` opens it.

**Tests:**
- `tests/functions/remind.test.js`: the quarter prompt.
- `tests/firestore-rules/rules.test.js`: `ledger_quarters` is owner-only.
- The browser run covers the strip, the page and a quarter closed end to end.

