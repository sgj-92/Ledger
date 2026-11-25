# The coach

*2026-11-25, Shaun.* Four pieces that help Shaun do what he says he'll do, without
nagging:

1. why it matters, on every Action;
2. a focus block, locked in Morning Prime;
3. follow-through, week by week, in Progress;
4. nudges, only when the day is slipping.

Shaun's words: "It's easy for me to just ignore tasks or keep re-scheduling."

These follow the Product Principles:

- **Evidence before encouragement.**
- **Missing data is not failure.** No nudge or label says "failed", "late", "missed",
  "overdue" or "behind".
- **Counts and gaps only.** There's no score and no percentage.

## 1. Why it matters

Every Action has a `why`: one short line under its title, about 12 words.

**Claude suggests it** (Shaun, 2026-11-25).

- `onActionCreatedWhy` (`functions/coach.js`) runs when an Action is created without one.
- Claude is given the Action's title, category, notes and minimum version, plus:
  - its goal;
  - its S&J client and team member;
  - Shaun's active goals.
- The line is written as `why`, with `whySuggested: true`.
- It's written only if the Action still has no `why`, so a line Shaun typed meanwhile wins.

**Shaun can change or clear it.** The Action sheet has a "Why it matters" field under the
title, marked "suggested by Claude" until he edits it.

- Clearing it saves `why: ''`. That stays cleared: nothing suggests another.
- An edit that doesn't touch the field writes no `why`.
- A device whose copy predates Claude's line keeps the line when it saves.

**Where it shows:**

- Today: the line under the title, while the Action is open.
- Its sheet.
- The focus block's choices.
- The nudges, which use it.

**Not suggested** for Morning Prime steps, the Replies (sweep) Action, Home requests and
partner requests. There's a limit of 150 suggestions a day.

## 2. The focus block

One protected block a day for the work that matters most. It's set in a Morning Prime
step, "Lock your focus block" (Plan, after the key tasks; it can be switched off like
any step).

- The step's sheet asks three things:
  - **Starts at:** a time.
  - **How long:** 30 min to 2 h.
  - **On what:** one of today's open Actions, with the first key task chosen, or "Just
    protect the time".
- It's saved on the day's plan:
  `ledger_plans/<date>.focusBlock = { time, durationMin, actionId, lockedAt }`.
- **Today:** a card under Now shows the block until it ends.
  - Before it starts, it reads "Protected".
  - During it, it reads "Now · 1 h 25 min left", with **Start**.
  - Once its timer runs, the Now card carries it.
- **Flow:** a band on the timeline at its time.
- **At its start,** a push: "Your focus block starts now". This is part of
  `onReminderTick`, unless the Action is already done.
  - Its link is `?open=focus-block`.
  - It starts the focus timer on the block's Action, for the time the block has left,
    full screen.
- **No nudge comes during the block.**

## 3. Following through

A card in Me → Progress, "Following through", covering the last 8 weeks.

- **An Action belongs to the week it was first planned for** (`originalDate`).
- **Moves:**
  - Each move to another day adds one to the Action's `moveCount`, from 2026-11-25.
  - Before that, the Action's history (`ledger_action_updates`, "moved") counts.
  - Whichever is higher is used.
  - An Action whose day isn't its first day counts as moved at least once.
- **The selected week's five counts** (this week first; tap a bar for another):
  - **Planned**
  - **Done on the day:** done, never moved.
  - **Done later:** done after a move.
  - **Moved:** at least once.
  - **Still open**
  - An Action let go on purpose (Disrupted, Not done) is noted separately.
- **A bar per week:** done on the day, done later, not done.
- **Moved 3 times or more:** the Actions still open, with how many moves and when each was
  first planned. A tap opens one, with a prompt: do the smallest first step, give it a
  time, or let it go.

Morning Prime steps, the Replies Action and roadblocks aren't counted.

## 4. Nudges

**Only when slipping** (Shaun, 2026-11-25). `onNudgeTick` runs every 10 minutes and acts
in three windows, in Shaun's timezone (`ledger_meta/reminders.tz`). Each window speaks at
most once a day, and only when there's a reason:

| Window | From | Reason |
| --- | --- | --- |
| Late-morning check-in | 11:00 | Morning Prime isn't done (a day he skipped counts as dealt with), or nothing is planned |
| Afternoon check-in | 15:00 | A key task hasn't been started, or nothing is done yet |
| Evening check-in | 18:00 | An Action moved twice or more is still open, or nothing has been done or logged today |

**Claude writes the nudge** from the day's facts:

- Prime;
- the intention;
- counts of Actions planned, done and logged;
- the open Actions, with their why and how many times each has moved;
- the one to focus on.

The nudge is kind and specific, one or two sentences, with one small next step. It never
uses a harsh word: a line with one is replaced by a plain one. If Claude can't be reached,
a plain line says the same.

**Where its link goes:**

- Morning Prime (`?open=prime`), when Prime is the reason;
- otherwise the Action it names (`?openAction=`);
- otherwise Today.

**Quiet:**

- during the focus block;
- when nothing is slipping;
- when switched off: Settings → Reminders → "Nudges when the day slips", which is
  `ledger_meta/reminders.nudges`, on unless set to `false`.

**What was said** is kept in `ledger_nudges/<date>`. It's server-only: no client rule, like
`ledger_sync`.

## Running it

- **Model:** the same as Ask Claude (`claude-sonnet-5-5`), at low effort, with the
  server-side fallback. The `ANTHROPIC_API_KEY` secret is already set for Ask Claude, so
  there's nothing new to configure.
- **Deploy:** GitHub → Actions → Deploy Firebase → Everything. This adds the
  `onActionCreatedWhy` and `onNudgeTick` functions and the focus block's push.
- **Tests:**
  - `tests/functions/coach.test.js`: the why line and nudges, with a stand-in Claude.
  - `tests/functions/remind.test.js`: the focus block's push.
  - `tests/e2e/coach.test.js`: the app.
  - `tests/firestore-rules/rules.test.js`: that no client reaches `ledger_nudges`.
