# Ledger — UX Principles

Ledger's interaction philosophy. These are the standards a change is judged
against in review, and the language used when writing a friction Issue.

They describe how Ledger should behave. They are not a description of how it
currently behaves everywhere — where the product falls short, that is a
friction Issue, not a reason to weaken the principle.

---

## 1. Minimum interaction

Common actions should require as few deliberate steps as reasonably possible.

Count the taps for anything done daily. Priming the morning, completing an
action, logging a session: each extra tap is paid many times over. Rare
actions may cost more.

## 2. Don't ask twice

If Ledger already knows something, do not require the user to enter it again.

Planned training pre-fills the log. Planned meals become nutrition evidence
when marked eaten. Catch-up reads the day's real records rather than asking
what happened. If a form asks for something already stored, that is a defect.

## 3. Immediate feedback

Every meaningful tap should visibly acknowledge the interaction.

A tap that appears to do nothing gets tapped again. Acknowledge first, persist
second — never leave the acknowledgement waiting on a network round trip.

## 4. Preserve context

Prefer inline interaction, sheets and progressive disclosure over unnecessary
navigation.

Leaving the day to change something about the day is a loss. Scroll position,
expanded sections and the selected date should survive an edit.

## 5. No mystery state

The user should be able to tell whether something is planned, completed,
logged, saved, syncing or failed.

Ledger distinguishes intention from evidence everywhere else in its data
model; the interface must show that distinction. Nutrition *in progress* and a
*closed* day are different states and must read differently.

## 6. Progressive disclosure

Show the minimum useful information first. Reveal complexity when requested.

Ledger holds a lot. Collapsed-by-default sections, bounded previews and
detail sheets are how it holds a lot without showing a lot. A section that is
expanded by default has to earn it.

## 7. Today is for doing

The Today surface prioritises execution over administration.

What to do next comes above the fold. Configuration, history and review live
below it or behind a sheet.

## 8. Planning and execution are connected

Planning should flow naturally into Today rather than behave like a separate
application.

Morning Prime and Health & fitness write to the same record. The same data uses
the same editor wherever it is reached from. Two editors for one concept is a
bug waiting to happen.

## 9. One concept, one interaction pattern

Equivalent actions should look and behave equivalently throughout Ledger.

One way to expand a section. One way to reorder. One way to open an editor.
One shape of confirmation. A second pattern for the same job is
inconsistency, even when each pattern is individually fine.

## 10. Safe by default

Potentially destructive actions should be difficult to trigger accidentally
and easy to understand.

Deleting a record, clearing a day, overwriting a log: these need deliberate
intent and a plain-language description of what will be lost. Nothing
destructive sits under an accidental thumb.

## 11. Mobile first

Thumb reach, touch targets, keyboard behaviour, safe areas and scroll
behaviour are first-class design constraints.

Ledger is used on a phone, one-handed, often while doing something else.
Desktop is a convenience. A layout that only works with a mouse and a keyboard
is not finished.

## 12. Perceived speed matters

Avoid unnecessary waiting, layout shifts, full re-renders and interactions
without progress feedback.

Ledger's data is small and mostly local. It should feel instant. Anything
that makes it feel otherwise — a blocking remote script, a re-render that
loses scroll position, content that jumps as it loads — is a real defect, not
a cosmetic one.

---

## Derived from agreed Ledger decisions

These follow directly from decisions already recorded in `PROJECT_LEDGER.md`
and are included because they change interaction design, not just data.

## 13. Neutral language about unfinished work

Ledger never says overdue, late, missed or failed. Unfinished work is
unfinished; it is described, not judged. This is why the Backlog exists as a
recovery layer rather than as a list of failures.

## 14. Nothing moves without being told

No automatic carry-forward, no silent rescheduling, no assumed causation.
Ledger may surface, suggest and prompt. Moving work to a day, or linking an
exposure to a symptom, is always a deliberate act by the user, and a suggested
link is always worded as possible.

---

## Using these in review

When writing a friction Issue, name the principle it breaks. When reviewing a
change, check it against §9 (is this a second pattern for an existing job?)
and §5 (can the user tell what state this is in?) — those are the two that
quietly erode a product that is otherwise working.

Add a principle here only when an existing Ledger decision clearly supports
it. This file is a standard, not a wish list.
