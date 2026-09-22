# Ledger shared coordination

Before doing any meaningful work, read `PROJECT_LEDGER.md`.

`PROJECT_LEDGER.md` is the shared coordination file between:
- Shaun
- ChatGPT
- Claude Chat
- Claude Code

Rules:

1. Read these sections before coding:
   - Current State
   - Product Vision
   - Product Principles
   - Agreed Architecture
   - Decisions Log
   - Current Task
   - Handoffs

2. `PROJECT_LEDGER.md` is the coordination source of truth, but the repository code is the implementation source of truth.

3. Do not contradict an agreed decision without surfacing the conflict first.

4. Execute only the active Claude Code handoff unless Shaun explicitly expands scope.

5. Do not start unrelated work because it appears in Next or Open Questions.

6. After meaningful implementation work:
   - update Current State if necessary
   - add meaningful product/technical decisions to Decisions Log
   - add completed work to Recently Completed
   - update Current Task
   - write a concise next handoff for ChatGPT or Claude Chat if review is needed
   - clear the Claude Code handoff when your assigned work is complete

7. Keep updates concise, factual and useful.
   Do not turn PROJECT_LEDGER.md into a full technical changelog.

8. Do not erase another agent's unresolved handoff unless the work is complete or Shaun explicitly changes direction.

9. If repository reality and PROJECT_LEDGER.md disagree:
   - inspect the code
   - document the mismatch
   - do not silently assume the ledger is correct

10. Main branch may be used unless Shaun explicitly asks for a separate branch.

11. Do not make product decisions that materially change UX/data behaviour unless:
    - they are already agreed in PROJECT_LEDGER.md, or
    - Shaun explicitly approves them.

---

# GitHub is the backlog

Issues are the canonical backlog for discrete work. `PROJECT_LEDGER.md` is
coordination state, not a task list — do not maintain a duplicate issue list
in it. Reference Issue numbers instead.

| Where | Holds |
| --- | --- |
| GitHub Issues | Discrete backlog items |
| GitHub Project ("Ledger — Road to Shippable") | Workflow status and Priority |
| `PROJECT_LEDGER.md` | Current state, durable decisions, current task, handoffs |
| `docs/PRODUCT.md` | Durable product definition |
| `docs/UX_PRINCIPLES.md` | Interaction philosophy |
| `docs/DESIGN_SYSTEM.md` | Visual/component system (an audit of what exists) |
| `docs/ROAD_TO_SHIPPABLE.md` | Quality framework — what to examine, not what to do |
| `docs/RELEASE_CHECKLIST.md` | Release gate |

## Labels

One **Type** label per Issue: `type: friction`, `type: bug`, `type: feature`,
`type: polish`, `type: technical-debt`.

One or more **Area** labels: `area: ui`, `area: ux`, `area: performance`,
`area: accessibility`, `area: mobile-pwa`, `area: data`, `area: architecture`,
`area: security`, `area: testing`.

Labels never represent workflow status, and never represent priority. Status
and Priority live on the Project.

## Critical rule

**An Issue existing in GitHub does not authorise implementation.**

Claude Code may implement an Issue only when:

1. Shaun explicitly asks for it; or
2. it is part of the currently active Claude Code handoff in
   `PROJECT_LEDGER.md`.

Capturing something and building it are separate acts. A backlog full of
unbuilt Issues is the system working correctly.

## When implementing tracked work

- Reference the Issue number.
- Understand the acceptance criteria *before* writing code. If they are
  missing or ambiguous, resolve that first.
- Move the Issue to **In Progress** where Project access permits.
- Make the smallest coherent change that satisfies the criteria.
- Test it.
- Move it to **Test** rather than Done where Shaun or device verification is
  required.
- Link the implementing commit or PR on the Issue.
- Close only once the acceptance criteria are actually satisfied. Close as
  *not planned* rather than inventing a "Won't Do" column.

Do not opportunistically fix unrelated backlog items while working on another
Issue unless they are genuinely inseparable. Note what you noticed instead —
that is a capture, not a fix.

---

# Short command protocol

Shaun may use these shorthand commands:

## Ledger CCode
Read PROJECT_LEDGER.md, inspect current repo state, execute only the active Claude Code handoff, update PROJECT_LEDGER.md, then stop.

## Ledger Capture
Shaun is handing over an observation, irritation or idea to be recorded — not
built.

- Search existing Issues first. If a substantially identical Issue exists,
  update that Issue rather than opening a duplicate.
- Otherwise create an Issue using the matching template (friction / bug /
  feature).
- Apply one Type label and one or more Area labels.
- Place it in **Inbox** where Project access permits.
- Leave acceptance criteria blank if they are not yet known.
- **Do not implement it. Do not change product code.**
- Report the Issue number and title, and stop.

## Ledger Sync
Read PROJECT_LEDGER.md and repo state. Report:
- stale information
- contradictions
- unresolved handoffs
- implementation drift

Do not code unless explicitly asked.

## Ledger Status
Return a concise factual project status only.
Do not code.

## Ledger Update
Update PROJECT_LEDGER.md with the latest explicitly agreed decision/status.
Do not implement product changes unless separately instructed.

If Shaun provides a normal detailed instruction instead of a short command, follow that instruction and use PROJECT_LEDGER.md for context.

---

# File discipline for PROJECT_LEDGER.md

- Do not dump long chat transcripts into PROJECT_LEDGER.md.
- Do not paste every Claude response into it.
- Store durable decisions, current state and handoffs only.
- Keep Current State current.
- Keep Decisions Log durable.
- Keep Current Task singular.
- Keep Next short.
- Keep handoffs actionable.
- Prefer linking to commits/files over copying large code blocks.
- Do not delete historical decisions just because implementation changed; append a superseding decision where needed.

---

# Repository notes

These are observed facts about this repo, useful before making changes.

## Shape
- **Single-file app.** All product code — HTML, CSS and JavaScript — lives in
  `index.html` (~8,000 lines). There is no build step, no bundler, no framework
  and no package manager for the app itself.
- `functions/` is the only separate codebase: one Firebase Cloud Function that
  sends Web Push for "Pin now". It has its own `package.json`.
- Other root files: `sw.js` (service worker), `manifest.json`, `fonts/`
  (self-hosted woff2 subsets), `hero-mountain.webp`, app icons, `avatars/`.
- `docs/` holds product documentation, not code: `PRODUCT.md`,
  `UX_PRINCIPLES.md`, `DESIGN_SYSTEM.md`, `ROAD_TO_SHIPPABLE.md`,
  `RELEASE_CHECKLIST.md`. `.github/ISSUE_TEMPLATE/` holds the Issue templates.
- `docs/DESIGN_SYSTEM.md` is an audit of what the UI currently is, including
  its inconsistencies. It is not a spec to conform code to, and the items it
  marks **Needs design decision** must not be resolved unilaterally.

## Conventions
- Match the surrounding style: ES5-era vanilla JS (`var`, function
  expressions), no arrow functions in app code.
- Per-date state belongs on that day's plan record (`ledger_plans/<date>`).
  Per-device UI preference belongs in `localStorage`.
- **Editors must build on top of the record they edit** (`Object.assign({}, existing, {...})`).
  Rebuilding an object from scratch has silently destroyed sibling fields more
  than once. Treat it as a bug pattern.
- User-supplied text is written with `textContent` or as an input `value`,
  never interpolated into an HTML string.

## Persistence
- Firebase Firestore (project `ledger-6aec3`) with a complete localStorage
  fallback — the app must keep working with no network and no Firebase config.
- Live `onSnapshot` listeners drive re-renders; a save generally triggers a
  render rather than the caller updating the DOM directly.
- Firestore security rules are **not** in this repo and are currently fully
  open. See Open Questions in `PROJECT_LEDGER.md` before widening exposure.

## Verifying changes
- There are no automated tests in the repo. Changes are verified by driving the
  app in a headless browser (Playwright against a local static server) and by
  reading the rendered result — not by assuming.
- A JS syntax check over the inline `<script>` block is a cheap first gate
  before any browser run.
