# Ledger UX Playbook

## Product standard

Ledger must feel like a modern, polished, fast consumer app in 2026.

It should never feel like:

- a prototype
- an internal admin tool
- a collection of forms
- a developer dashboard
- a web page with features bolted onto it
- an app where the user has to understand how the database is structured

The benchmark is not simply “does the feature work?”

The benchmark is:

> Does this feel effortless, obvious, responsive and enjoyable to use repeatedly throughout the day?

Ledger should feel closer to products such as Linear, Things, Todoist, Notion Calendar, Arc and other polished modern applications than to a traditional CRUD web app.

## 1. Core UX philosophy

Ledger exists to reduce mental load.

The app should help the user understand:

- What matters now?
- What should I do next?
- What have I already done?
- What needs my attention?

The user should not have to organise Ledger before Ledger can organise them.

## 2. The five Ledger UX tests

Every screen and feature should pass these five tests.

### 1. Obvious

Within roughly one second, the user should understand:

- what this screen is for
- what matters most
- what the primary action is

If several elements appear equally important, the hierarchy is wrong.

### 2. Fast

Common actions should normally require:

- one tap
- one swipe
- one drag
- or one short interaction

Avoid unnecessary:

- modal screens
- confirmation dialogs
- menus
- dropdowns
- navigation changes

Frequently used actions must be disproportionately easy.

### 3. Calm

Ledger contains a lot of information.

That does not mean it should display everything at once.

Use:

- whitespace
- progressive disclosure
- collapsing sections
- hierarchy
- contextual controls
- restrained colour
- subtle borders

The screen should feel calm even when the user's life is not.

### 4. Responsive

Every interaction should provide immediate feedback.

Examples:

- taps visually respond
- completed items animate
- reordered items move naturally
- saves appear instant
- loading states preserve layout
- selected states are unmistakable

The app should never leave the user wondering:

> “Did that work?”

### 5. Predictable

Similar actions must behave similarly throughout Ledger.

If tapping a task opens details in one place, it should not unexpectedly complete the task somewhere else.

Consistency creates speed because the user stops thinking about the interface.

## 3. Ledger should feel like an app, not a website

Avoid traditional website behaviour wherever possible.

Prefer:

- **Inline editing** instead of opening an edit page
- **Bottom sheets / drawers** instead of navigating away
- **Drag and drop** instead of “Move up / Move down”
- **Tap to complete** instead of opening a form
- **Swipe/contextual actions** instead of permanently visible buttons
- **Autosave** instead of Save buttons everywhere
- **Optimistic updates** instead of waiting for the server before showing a change
- **Persistent state** instead of screens resetting when reopened

The interface should feel like the user is manipulating objects, not submitting forms.

## 4. Direct manipulation first

Whenever practical, allow the user to interact directly with the thing they want to change.

Example:

Instead of:

> Task → Edit → Change order → Select position → Save

Use:

> Hold task → drag → drop

Instead of:

> Meal → Open details → Mark eaten → Save

Use:

> Tap ✓

Details should exist when needed, but should not obstruct the common action.

## 5. Progressive disclosure

Ledger should not show every possible option permanently.

Show the simplest useful version first.

Reveal complexity only when requested.

Example:

**Default task card**

- title
- completion state
- relevant time/context

**After tapping**

- notes
- category
- date
- dependencies
- optional settings

This principle should be used heavily throughout Ledger.

## 6. One dominant action per context

Every screen should have an obvious primary purpose.

Examples:

| Screen | Purpose |
| --- | --- |
| Plan | Build the plan |
| Today — Overview | Understand today |
| Today — Action | Do the next thing |
| Backlog | Decide what happens to unfinished work |
| Nutrition | Record what was eaten |
| Review | Close the day |

Screens should not try to perform every function simultaneously.

## 7. Planning mode and execution mode are different

Ledger must recognise that planning and doing require different interfaces.

Planning encourages:

- thinking
- rearranging
- reviewing
- adding detail

Execution should minimise thinking.

The Action view should therefore prioritise:

- chronological/mental flow
- current task
- next task
- quick completion
- quick rearranging
- minimal secondary information

The Action screen should feel like moving through a queue, not reviewing a database.

## 8. The user controls flow, not necessarily time

Ledger does not need to force every activity into exact times.

The user should be able to create a sequence such as:

```
Morning Prime
↓
Client work
↓
Call accountant
↓
Gym
↓
Admin
↓
Family task
```

without pretending that each item has a precise scheduled time.

This is flow ordering.

Flow ordering should be a first-class Ledger concept.

## 9. Motion is functional

Animation should help the user understand what happened.

Use motion for:

- completion
- expanding/collapsing
- navigation
- reordering
- adding/removing items
- changing state

Motion should normally be:

- subtle
- fast
- natural
- interruptible

Avoid decorative animation that slows the user down.

The goal is not “make things animate.”

The goal is:

> make state changes understandable and satisfying.

## 10. Completion should feel satisfying

Ledger is heavily centred around taking action.

Completion therefore deserves excellent feedback.

When something is completed:

1. respond instantly
2. show a clear completed state
3. provide a subtle animation
4. update related progress automatically
5. optionally move/collapse the item
6. allow easy undo

Completing something should create a small sense of progress.

## 11. Avoid layout jumping

The interface should remain visually stable.

Avoid:

- sections suddenly moving several hundred pixels
- buttons changing size after interaction
- loading content shifting the entire page
- accordions opening unpredictably
- headers resizing unnecessarily

The user's eyes should not have to constantly relocate information.

## 12. Preserve context

Avoid unnecessary navigation.

If the user opens task details from Today, they should feel like they are still inside Today.

Prefer:

- drawers
- sheets
- overlays
- expandable cards

Use full-screen navigation when the user is genuinely entering another area of Ledger.

## 13. Mobile-first means thumb-first

Ledger is primarily a phone application.

Important controls should sit within comfortable thumb reach.

Avoid:

- tiny tap targets
- controls pressed against screen edges
- actions requiring precision
- essential actions placed exclusively at the top of long screens

Interactive targets should generally feel generous.

## 14. Reduce visible controls

Not every possible action needs a visible button.

A screen containing:

- Edit
- Delete
- Move
- Details
- Complete
- More
- Add
- Expand

quickly becomes visually noisy.

Instead use:

- direct tapping
- contextual menus
- swipe actions
- long press
- drag handles
- one overflow menu

The interface should expose capability without advertising every capability simultaneously.

## 15. Hierarchy before decoration

Before adding gradients, shadows or animations, establish:

1. primary information
2. secondary information
3. supporting information
4. controls

Typography, spacing and layout should communicate hierarchy first.

Visual styling should reinforce hierarchy rather than compensate for weak hierarchy.

## 16. Use colour deliberately

Colour should communicate meaning.

Examples:

- success
- warning
- selected
- active
- destructive
- progress

Do not colour everything.

Most of Ledger should remain visually restrained so meaningful colour has impact.

## 17. Empty states should help

An empty screen should not simply say:

> “No items.”

It should tell the user:

- what belongs here
- why it matters
- what to do next

Example:

> Nothing in your backlog.
> Anything unfinished will appear here automatically.

## 18. Errors should be recoverable

Errors should:

- explain what happened
- avoid blaming the user
- preserve entered information
- offer a clear recovery action

Never silently fail.

Never discard user input unnecessarily.

## 19. Autosave by default

Where practical, Ledger should save changes immediately.

Avoid repeated Save buttons unless:

- multiple changes need committing together
- the action is consequential
- confirmation is genuinely useful

Modern apps should feel persistent rather than transactional.

## 20. Smart defaults

Ledger already knows substantial context.

Use it.

Examples:

- today's date
- current plan
- selected user
- usual routines
- previous categories
- planned workout
- existing meal plan

Do not repeatedly ask for information Ledger already possesses.

## 21. Design for interruption

The user will frequently leave Ledger mid-task.

When they return:

- preserve scroll position where useful
- preserve drafts
- preserve selected view
- preserve partially completed workflows
- make the next action obvious

Ledger should tolerate fragmented attention.

## 22. Minimise cognitive branching

Avoid interfaces that repeatedly ask:

> “What would you like to do?”

Instead, infer the most likely action and offer alternatives secondarily.

For example:

> Tap task → open useful task view.

Do not first display:

- Edit
- View
- Complete
- Move
- Schedule
- Categorise

unless the context genuinely demands it.

## 23. Navigation should remain boring

Navigation should be exceptionally predictable.

The user should never wonder:

- where something lives
- how to get back
- whether they left the current workflow

Navigation is infrastructure, not entertainment.

## 24. Ledger's visual personality

Ledger should feel:

- Calm
- Premium
- Focused
- Masculine without being aggressive
- Modern
- Purposeful
- Private
- Personal
- Confident

Avoid making it feel:

- corporate
- gamified for children
- sterile
- overly colourful
- overly futuristic
- like a finance dashboard

## 25. Information density should adapt to context

Planning screens can contain more information.

Execution screens should contain less.

Review screens can reveal more detail progressively.

The entire application should not use one density level.

## 26. Components should behave consistently

Ledger should establish reusable interaction primitives.

Examples:

- **TaskCard** — always behaves consistently.
- **CompletionControl** — same interaction everywhere.
- **BottomSheet** — same animation and closing behaviour.
- **SectionHeader** — same visual hierarchy.
- **DragHandle** — same appearance and behaviour.
- **ProgressIndicator** — same visual language.
- **EmptyState** — same structure.

The user should gradually learn Ledger's interaction vocabulary.

## 27. Every extra tap needs justification

When evaluating a workflow, ask:

> Could this reasonably require one fewer interaction?

If yes, redesign it.

Repeated actions deserve particular attention.

Saving one tap from something performed twenty times per day matters far more than saving three taps from something used once per month.

## 28. The 3-second test

For important screens:

Show the screen for three seconds.

The user should be able to answer:

- where am I?
- what matters?
- what should I do?

If not, simplify.

## 29. The one-hand test

Core daily Ledger workflows should be comfortable using one hand on a phone.

Especially:

- completion
- logging
- changing today's flow
- opening details
- returning
- adding tasks

## 30. The interruption test

Start an action.

Leave Ledger.

Return later.

The user should immediately understand where they were and what remains unfinished.

## 31. The “would Apple ship this?” test

This does not mean copying Apple visually.

It means questioning:

- spacing
- state transitions
- responsiveness
- touch targets
- wording
- edge cases
- loading states
- animations
- inconsistencies

Functional is not enough.

Every important interaction should feel considered.

## 32. The “prototype smell” checklist

A screen probably still feels like a prototype if it has several of these:

- too many borders
- too many boxes
- too many buttons
- repeated labels
- inconsistent spacing
- inconsistent icon sizes
- controls always visible
- abrupt state changes
- forms for simple actions
- large unused headers
- excessive explanatory text
- inconsistent typography
- repeated confirmation
- navigation for actions that could be inline
- weak loading states
- layout shifts
- tiny click areas
- developer terminology
- database terminology
- debug-like UI
- sections that look independent rather than part of one system

These should be actively removed.

## 33. Feature-complete does not mean product-complete

A feature passes through three stages:

1. **Functional** — It works.
2. **Usable** — The user can use it reliably.
3. **Product-quality** — It feels obvious, fast, polished and enjoyable.

Ledger features should not be considered finished at stage one.

## 34. Development rule for Claude

When implementing a feature, Claude should consider both:

- Functional acceptance criteria
- and UX acceptance criteria

Example:

**Functional:**

- user can reorder tasks

**UX:**

- reordering begins naturally
- dragged item visibly lifts
- surrounding items animate out of the way
- position updates instantly
- accidental movement is difficult
- state persists
- interaction works smoothly on touch
- there is no layout jump after dropping

Both sets of criteria matter.

## 35. UX reviews should happen separately from feature reviews

After a feature works, perform a second pass asking only:

- Is this obvious?
- Is this fast?
- Is this visually calm?
- Is this satisfying?
- Is anything redundant?
- Can something disappear?
- Can something happen automatically?
- Can navigation be avoided?
- Does this feel native/app-like?
- Does anything still feel like a prototype?

This is the Ledger polish pass.

## 36. Performance is part of UX

Ledger should feel instantaneous.

Prioritise:

- fast initial render
- no visible re-render flicker
- local optimistic updates
- sensible caching
- lazy loading where appropriate
- efficient component updates
- skeleton states rather than blank screens

A beautiful interface that hesitates still feels unfinished.

## 37. Architecture should support polish

As Ledger grows, reusable components and predictable state management become important.

The architecture should make it easy to achieve:

- consistent interactions
- consistent animation
- reusable components
- shared design tokens
- predictable state
- fast rendering

This is one reason migrating toward React + TypeScript is worth considering.

The migration itself is not the UX improvement.

It is infrastructure that makes sustained UX quality easier.

## 38. Ledger design tokens

Ledger should eventually define shared tokens for:

- spacing
- border radius
- typography
- elevation
- animation speed
- easing
- touch sizes
- colours
- opacity
- section gaps

Avoid manually choosing slightly different values screen by screen.

Consistency creates polish.

## 39. Interaction speed targets

As a general design target:

| Interaction | Target |
| --- | --- |
| Tap feedback | Immediate. |
| Small transitions | Approximately 100–200ms. |
| Larger layout transitions | Approximately 200–300ms. |
| Anything longer | Must have a clear reason. |

The interface should feel responsive rather than theatrical.

## 40. Final Ledger UX principle

When faced with two solutions, prefer the one that requires the user to:

- think less
- tap less
- wait less
- remember less

while still keeping them in control.

Ledger's intelligence should appear through reduced friction, not added complexity.

## Definition of Done — 2026 Standard

A Ledger feature is not complete merely because it works.

Before calling it complete, we should be comfortable saying:

- It works reliably.
- It is understandable without explanation.
- The primary action is obvious.
- Common actions are fast.
- It works comfortably on mobile.
- It provides immediate feedback.
- It preserves context.
- It uses Ledger's existing interaction patterns.
- It has polished loading, empty and error states.
- Animations support comprehension.
- There are no unnecessary controls.
- There are no obvious layout jumps.
- It does not expose implementation details.
- It feels like part of one coherent product.
- It would not look out of place in a polished 2026 consumer application.

If those conditions are not met, the feature is still in prototype state.
