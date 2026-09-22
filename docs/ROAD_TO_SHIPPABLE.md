# Ledger — Road to Shippable

**This is not a backlog.** GitHub Issues are the backlog.

This document defines *what "shippable" means* and *what to examine* in each
area. It is the audit framework: work through a category, and whatever you
find becomes an Issue.

Individual problems do not belong in this file. If you are about to write
"the X button is too small here" — that is an Issue.

---

## What "shippable" means for Ledger

Ledger is a private, single-user app. Shippable does not mean marketable,
feature-complete, or ready for other people. It means:

> The eight core journeys in `docs/PRODUCT.md` work reliably, on a phone, in
> both themes, without losing data — and using it does not require patience.

Concretely:

- No known P0 Issues.
- No unresolved data-loss risk.
- Core journeys pass on a real device, not only in a headless browser.
- The product is consistent enough that a new surface can be built without
  inventing a new pattern.

---

## How to use this document

1. Pick one category.
2. Work through its "What to examine" list against the real product on a real
   phone.
3. File each concrete finding as an Issue with a Type label, one or more Area
   labels, and enough evidence to act on.
4. Set Priority on the Project. Do not add priority labels.
5. Do not fix things as you find them. Auditing and implementing are separate
   activities, and mixing them is how scope escapes.

An audit pass that produces no Issues is a valid result. So is one that
produces fifteen.

---

## 1. Core user journeys

**Standard:** each of the eight journeys in `docs/PRODUCT.md` completes
end-to-end without a dead end, a lost input, or a step that requires knowing
how the app is built.

**What to examine**

- Each journey start to finish, on a phone, without touching anything else.
- Interruption: leave mid-journey, come back. Is the state still there?
- The unhappy path: no data yet, no network, a day that was skipped.
- Whether any journey requires leaving Today and losing your place.
- Whether any journey has more steps than it needs (→ `type: friction`).

---

## 2. Friction

**Standard:** common daily actions cost the minimum reasonable number of
deliberate steps, and nothing has to be entered twice.

**What to examine**

- Tap counts for anything done daily: priming the morning, completing an
  action, logging a session, closing a day.
- Places Ledger asks for something it already knows (UX principle §2).
- Repeated actions with no batch or repeat affordance.
- Scrolling required to reach something used every day.
- Anything that made you sigh. That is data.

This is the largest category and the one most likely to be filled from real
use rather than from a systematic pass.

---

## 3. Interaction consistency

**Standard:** equivalent actions look and behave equivalently everywhere
(UX principle §9).

**What to examine**

- Disclosure: how many ways does a section expand?
- Editors: does the same data open the same editor from every entry point?
- Reordering: one gesture, or several?
- Confirmation: sheet, native dialog, or none — by what rule?
- Press feedback: scale, background, colour, opacity — which, and when?
- Button emphasis: is the hierarchy legible without reading the class name?

`docs/DESIGN_SYSTEM.md` §17 lists the known open decisions here.

---

## 4. Visual consistency

**Standard:** the visual language is a system, not a collection of
individually-tuned screens.

**What to examine**

- Type sizes actually in use versus any intended scale.
- Radii, spacing and padding against the token set.
- Raw colour values that bypass tokens.
- Both themes, side by side, on the same screen.
- Meaning colours (category, day status, rank tier) for legibility in both
  themes.
- Anything that was tuned by eye for one comp and never generalised.

---

## 5. Performance and perceived performance

**Standard:** Ledger feels instant. Its data is small and mostly local; there
is no good reason for it not to.

**What to examine**

- Time to first meaningful paint on a cold load, throttled.
- Render-blocking resources — particularly anything remote.
- Whether the app is usable before remote scripts resolve.
- Full re-renders that discard scroll position or an open section.
- Layout shift as data arrives.
- Interactions with no immediate acknowledgement (UX principle §3).
- Payload: page weight, fonts, images, avatar art.
- Behaviour on a slow connection, not only on no connection.

---

## 6. Reliability

**Standard:** it works every time, including the times the network does not.

**What to examine**

- Firestore unreachable, intermittent, or slow.
- The localStorage fallback path — is it exercised, or only assumed to work?
- Snapshot listeners: reconnect, duplicate events, stale renders.
- Two devices editing the same day.
- Long sessions: does anything degrade after hours open?
- Service worker update: does a new version reach an installed app?
- Console errors during normal use.

---

## 7. Data integrity

**Standard:** nothing is ever silently lost or invented. This is the category
where a finding is almost always P0 or P1.

**What to examine**

- Editors that rebuild a record instead of merging onto it. This has silently
  destroyed sibling fields three times (`PROJECT_LEDGER.md`, 2026-09-12) and
  is the repository's known bug pattern. Grep for object literals passed to a
  save, and check every one.
- Records written from more than one place — does each writer preserve the
  others' fields?
- Date handling: local vs UTC, day boundaries, a day that spans midnight.
- The plan-vs-evidence boundary: does anything let a plan masquerade as a
  record?
- Exposure and symptom records staying separate, and links staying *possible*.
- Migration behaviour for records written by older versions.
- Delete paths: what else referenced the thing being deleted?

---

## 8. Mobile and PWA behaviour

**Standard:** installed on a phone, Ledger behaves like an app.

**What to examine**

- Install on iOS and on Android.
- Splash screen and status bar in both themes.
- Safe areas: notch, home indicator, landscape if reachable.
- Keyboard: does it cover the field, the submit button, or the sheet?
- Scroll: any trapped scroller, any nested scroller, any rubber-banding that
  chains to the page behind a sheet.
- Offline: what does the installed app show with no network?
- Service worker: caching strategy, update flow, push behaviour.
- Back gesture and back button inside sheets.

---

## 9. Accessibility

**Standard:** WCAG AA contrast, visible keyboard focus, adequate touch
targets, respected motion preferences. For a single-user app this is about
usability in real conditions — bright sunlight, tired eyes, one hand — as
much as about compliance.

**What to examine**

- Contrast in both themes, measured by compositing alpha over real ancestor
  backgrounds, not estimated.
- Visible focus for every interactive element.
- Touch target sizes against a stated minimum.
- `prefers-reduced-motion`.
- Semantic roles and labels, especially on icon-only controls.
- Behaviour at large system text sizes.
- Colour as the sole carrier of meaning.

---

## 10. Privacy and security

**Standard:** personal health data is not readable or writable by anyone else.

**What to examine**

- Firestore rules — what they currently permit, and who can reach them.
- Client configuration in a public repository, and what it exposes.
- Whether any collection can be written by a third party (particularly
  anything that triggers a notification).
- What is in localStorage on a shared or lost device.
- Third-party requests made by the page.
- Secrets: nothing in the repository, now or in history.

---

## 11. Automated testing

**Standard:** the core journeys cannot silently break.

**What to examine**

- Which journeys would cause real harm if they broke unnoticed.
- What can be tested without introducing a build step.
- A syntax gate over the inline script as the cheapest first check.
- Whether tests should run in CI or on demand.
- What is *not* worth testing — a single-user app does not need coverage
  targets.

Start small. A suite nobody runs is worse than no suite.

---

## 12. Architecture and technical debt

**Standard:** the structure does not make correct changes harder than they
should be.

The current architecture — one `index.html`, no build step, no framework,
no dependencies — has real advantages: instant deploy, trivial debugging, no
dependency burden, and it currently works. **None of that is up for
reflexive replacement.**

**What to examine**

- Where duplication has appeared (components, styles, form handling).
- Whether a change in one place reliably reaches every place it should.
- Regression risk when editing a file of this size.
- Testability of individual behaviours.
- How well a very large single file survives AI-assisted editing.
- Whether any separation of concerns could be gained *without* adopting a
  build step or a framework.

Size alone is not an argument. A migration needs a named problem it solves.

---

## 13. Error, loading and empty states

**Standard:** the user can always tell what state the app is in
(UX principle §5).

**What to examine**

- Every list and surface with no data yet.
- Every surface while data is arriving.
- Every operation that can fail, and what it says when it does.
- Whether the user can tell Firestore from localStorage mode.
- Whether a failed save is distinguishable from a successful one.
- First run: a brand-new install with nothing stored.

---

## 14. Release readiness

**Standard:** `docs/RELEASE_CHECKLIST.md` passes.

**What to examine**

- Whether the checklist itself is still the right checklist.
- Whether anything on it can be automated.
- Rollback: what happens if a release is bad, and how quickly can it be
  undone on an installed PWA.

---

---

## Appendix — GitHub Project configuration

**Status: not yet created.** GitHub Projects v2 is a GraphQL-only API and
GraphQL is not reachable from Claude Code sessions, so the board could not be
created programmatically. It takes a few minutes in the GitHub UI. Recorded
here so the intended configuration is not lost.

Until it exists, each seeded Issue carries a **Proposed priority** and
**Proposed status** at the bottom of its body. Those are proposals to be
transferred to the board, then deleted from the bodies.

### The board

Name: **Ledger — Road to Shippable**. Link it to `sgj-92/Ledger`.

### Status field

| Status | Meaning |
| --- | --- |
| **Inbox** | Newly captured. No decision has been made about whether to build it. |
| **Needs Review** | The problem is real but needs product, UX or technical consideration. |
| **Ready** | Agreed work, with acceptance criteria. |
| **In Progress** | Being implemented now. |
| **Test** | Implemented; needs verification on the real product or device. |
| **Done** | Verified complete. |

There is deliberately **no "Won't Do" column.** Close the Issue as *not
planned* instead.

### Priority field

A single-select custom field named **Priority**:

| Value | Meaning |
| --- | --- |
| **P0 — Critical** | Data loss, serious security or privacy issue, app unusable, severe regression. |
| **P1 — High** | Meaningful recurring friction in a core journey, or an important reliability problem. |
| **P2 — Normal** | Worth doing; not blocking normal use. |
| **P3 — Low** | Minor improvement. |
| **Someday** | Keep the thought without committing to building it. |

**Someday matters.** It is what lets an idea be written down without creating
pressure to build it.

Priority lives here and nowhere else. It is never a label.

### Views

| View | Filter | Purpose |
| --- | --- | --- |
| **Inbox** | Status = Inbox | Fast capture of ideas, irritations and observations. |
| **Friction** | label = `type: friction`, Status ≠ Done | The friction backlog. |
| **Ready** | Status = Ready, sorted by Priority (highest first) | The only pool Claude Code may implement from — and only when Shaun explicitly asks. |
| **Active** | Status = In Progress or Test | Current development work. |
| **Road to Shippable** | Status ≠ Done, grouped by Priority | Everything left. |

Use the simplest configuration GitHub Projects supports. No external
project-management software.

---

*Framework only. Findings go to Issues.*
