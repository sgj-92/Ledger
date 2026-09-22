# Ledger — Design System (audit)

**This is an audit, not a specification.** It records what exists in
`index.html` today at `c7c37b1`, including the parts that are inconsistent.

Nothing here is a mandate to standardise. Where there is no coherent existing
rule, the section is marked **Needs design decision** and should become an
Issue before anyone changes code.

Measured facts in this document were taken from the source and from the
rendered page at 390×844 (iPhone-class viewport), not estimated.

---

## 1. Tokens and theming

### How theming works

- A resolved theme sits on `<html data-theme="dark|light">`.
- `:root` holds the **dark** palette. `html[data-theme="light"]` overrides a
  subset of the same names. No component knows which theme it is in — every
  component reads semantic tokens only.
- An inline bootstrap in `<head>`, before the stylesheet, applies the stored
  preference before first paint (no flash).
- Preference in `localStorage` under `ledger_theme`, values `dark | light |
  system`, default `dark`. `system` follows `prefers-color-scheme` live.
- `<meta name="theme-color">` is updated in JS when the theme changes.
- Control lives in **Focus → Appearance** as a three-way segmented control.

Dark is the default and the primary visual identity. Light is a deliberate
warm parchment palette, not an inversion.

### Surface tokens

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--bg` | `#0e0b08` | `#f5efe4` | Page |
| `--surface` | `#16120d` | `#fcf8f1` | Rows, sheets, recorded activity |
| `--surface-2` | `#1c1712` | `#f1e9dc` | Fields, pressed states |
| `--surface-3` | `#241d16` | `#e9dfcd` | Raised / featured |
| `--line` | `rgba(234,223,204,0.07)` | `rgba(74,56,36,0.10)` | Hairline |
| `--line-2` | `rgba(234,223,204,0.13)` | `rgba(74,56,36,0.20)` | Stronger divider |

Structure is carried by hairlines and surface steps, not by shadows or boxes.
The surface steps are deliberately small.

### Text tokens

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--text` | `#f0e9dd` | `#2b211a` | Primary |
| `--text-2` | `#a89b88` | `#665949` | Secondary |
| `--text-3` | `#766a5b` | `#7a6a55` | Labels, meta, section headers |

### Accent

`--gold` (`#dcb878` dark / `#866325` light), `--gold-2`, `--gold-rgb` for
alpha use, `--ink` for text on gold. Used sparingly: key-task marks, selected
states, primary actions.

### Meaning colours

Three families whose **hue carries meaning** and is held across themes,
adjusted only for legibility:

- **Eight category accents** — `--padel`, `--resistance`, `--cardio`,
  `--yoga`, `--weight`, `--photo`, `--nutrition`, `--gluten`, each with a
  `-soft` alpha variant at `0.14`. Used as small marks, never as fills.
- **Four day-status colours** — `--day-good`, `--day-neutral`, `--day-bad`,
  `--danger`, each with an `-rgb` companion for alpha composition.
- **Six rank-tier colours** — Rookie, Grinder, Contender, Competitor,
  Veteran, Elite. **These are not tokens.** They are fixed hex values in a
  `LEVEL_TIERS` array in JS, applied as inline styles. They do not adapt to
  theme. → **Needs design decision** (tracked as an Issue).

### Atmospherics

`--tint-raise`, `--backdrop`, `--bar`, `--header-fade`/`-0`, and five shadow
tokens (`--shadow-card`, `-raised`, `-lift`, `-fab`, `-pop`, `-toast`). The
hero photograph is fully tokenised: `--hero-opacity`, `--hero-filter`,
`--hero-h`, `--hero-pos`, `--hero-mask`, `--hero-scrim`. Dark renders it as a
lit photograph; light as a pressed watermark.

### Legacy aliases

A block of aliases (`--panel`, `--panel-2`, `--panel-raised`, `--panel-inset`,
`--border`, `--border-soft`, `--hairline`, `--text-muted`, `--text-faint`,
`--label-color`, `--gold-soft`, `--amber`) maps older names onto the current
ones so untouched components stay coherent. `--panel-inset` is a raw `#0b0906`
and does **not** change in light.

> **Inconsistency.** Two naming generations coexist. New work should use the
> semantic names; the aliases have no retirement plan. → **Needs design
> decision** on whether to migrate or keep the aliases indefinitely.

---

## 2. Typography

Two self-hosted families, subset woff2, `font-display: swap`:

- **Playfair Display** (`--serif`) — 400, 500, 600, 400 italic. Used for
  display numerals, day headings, empty states (italic), and moments that
  should read as editorial.
- **Inter** (`--sans`) — 400, 500, 600. Everything else.

### Type scale

There is no type scale. The source contains **around twenty distinct
font-size values**, most in half-pixel steps:

```
11.5px ×29   12.5px ×27   13px ×21   12px ×17   10.5px ×16
14.5px ×14   11px ×12     14px ×10   10px ×10   13.5px ×9
9.5px ×7     16px ×7      15px ×7    17px ×5    16.5px ×5
30px ×3      19px ×3      15.5px ×3  29px ×1    27px ×1
```

Sizes are literals; no `--font-*` tokens exist. **Seventy-four declarations
sit below 12px**, including seven at 9.5px.

> **Needs design decision.** A scale (say six steps) would remove most of the
> half-pixel variance, but the current sizes were tuned by eye against comps
> and some of the small sizes are intentional (uppercase tracked labels).
> This is a product/visual decision, not a cleanup.

### Established type patterns

- **Section label** — 10.5px, weight 500, uppercase, `letter-spacing: 0.2em`,
  `--text-3`. Consistent wherever it appears.
- **Empty state** — serif, italic, 16px, `--text-2`, left-aligned; a
  `.compact` variant at 14px. Consistent.

---

## 3. Spacing

A scale exists and is used:

```
--sp-1: 4px   --sp-2: 8px   --sp-3: 12px  --sp-4: 16px
--sp-5: 20px  --sp-6: 24px  --sp-7: 32px  --sp-8: 40px
```

Component-internal padding is largely written as literals (`13px 10px`,
`15px`, `5px 11px`) rather than through the scale. That is workable — the
scale governs layout rhythm, literals govern component interiors — but it is
a convention nobody has written down. → **Needs design decision** on whether
component padding should also come from the scale.

---

## 4. Radii

Tokens exist, duplicated under two names:

```
--r-sm / --radius-sm: 10px
--r-md / --radius-md: 14px
--r-lg / --radius-lg: 20px
```

They are **not consistently used**. Literal `border-radius` values in the
source: `100px` ×19 (pills — legitimate), then `12px` ×5, `10px` ×5, `11px`
×4, `6px` ×3, `9px` ×2, `22px` ×2, `20px` ×2, `16px` ×2, `14px` ×2, `13px`
×2, and single uses of `8px`, `7px`, `5px`, `4px`. Sheets use a one-off
`28px 28px 0 0`.

> **Inconsistency.** Six radius values exist that the tokens do not cover, and
> several literals duplicate a token's value. → **Needs design decision**:
> either the token set is too small, or these are drift.

---

## 5. Buttons

Ten button classes exist:

| Class | Shape | Use |
| --- | --- | --- |
| `.btn-primary` / `.save-btn` | Gold fill, `--ink` text, scales to `0.985` on press | Primary commit |
| `.btn-secondary` | Bordered, surface background | Secondary action in a sheet |
| `.btn-ghost` | Transparent, hairline border, `--text-2` icon; `.gold` variant | Inline actions |
| `.btn-quiet` | Lowest-emphasis text button | Tertiary |
| `.btn-link` | Text-only, inline | Navigation-like affordance |
| `.btn-danger` / `.delete-btn` | Full width, `--danger` text on a `0.28` alpha danger border, no fill | Destructive |
| `.icon-btn` | 30×30 square, hairline, gold on press | Row-level icon action |
| `.circ-btn` | 38×38 circular | Header icon action |
| `.btn-row` | Layout container, not a button | — |

`.btn-primary` and `.save-btn` are two names for one style, as are
`.btn-danger` and `.delete-btn` (the rule is literally duplicated in the
stylesheet).

> **Inconsistency.** Duplicate names for identical styles, and no documented
> rule for when `.btn-ghost` vs `.btn-quiet` vs `.btn-link` applies. →
> **Needs design decision.**

Press feedback is not uniform: `.btn-primary` scales and darkens,
`.btn-ghost` and `.circ-btn` change background, `.icon-btn` changes colour,
`.section-toggle` changes opacity.

---

## 6. Inputs

`.field input`, `.field select`, `.field textarea` share one style. Focus is
a border colour change to `rgba(var(--gold-rgb),0.5)` with `outline: none`.
Textareas default to `min-height: 64px`; the food diary to `190px` and
`resize: vertical`.

> **Bug, not an inconsistency.** `.field input[type="date"]` and
> `[type="time"]` hardcode `color-scheme: dark`. In the light theme the
> native date and time pickers therefore still render dark. Tracked as an
> Issue.

`font-variant-numeric: tabular-nums` is applied to date and time inputs.

---

## 7. Pills, chips and badges

One coherent chip system:

`.chip` — inline-flex, 11.5px, weight 500, `5px 11px`, `border-radius: 100px`,
with `.chip-dot` (6px, `--chip-color`), `.chip-icon`, `.chip-label`,
`.chip-check`, and variants `.chip-neutral` (filled) and `.chip-outline`.

A separate `.tag` class also exists. `.pill` and `.badge` do not exist as
classes despite the vocabulary being used in conversation.

> **Inconsistency (minor).** `.tag` overlaps `.chip` in purpose. → **Needs
> design decision.**

---

## 8. Sheets and modals

One pattern, and it is the strongest component in the system.

- `.sheet` — bottom sheet, `max-width: 560px`, `border-radius: 28px 28px 0 0`,
  `border-top: 1px solid var(--line-2)`, `--shadow-raised`.
- Height is `max-height: 90dvh` (declared after a `90vh` fallback) so iOS
  toolbar changes do not push it under browser chrome.
- `overscroll-behavior: contain` keeps momentum inside the sheet.
- `padding-bottom` and the action bar both respect
  `env(safe-area-inset-bottom)`.
- `.sheet-actionbar` is `position: sticky` at the bottom of the visible
  sheet, so a long form never leaves its own actions out of reach. Children
  flex to equal width.
- Entry animation `sheet-up`, `0.24s cubic-bezier(.2,.9,.3,1)`.
- A `.backdrop` sits behind, using `--backdrop`.

All sheets are opened through one function (`openSheet`) and built by shared
form builders. This is the one place where "one concept, one interaction
pattern" is fully achieved.

---

## 9. Section headers and disclosure

**Two competing patterns.** This is the clearest interaction inconsistency in
the app.

| | `.sec-head` / `.sec-head-toggle` | `.section-toggle` |
| --- | --- | --- |
| Label | `.sec-label`, 10.5px uppercase 0.2em | `.section-toggle-label`, 10.5px uppercase 0.2em |
| Rule line | separate element | `::after` on the label |
| Chevron | `.sec-head-chev`, 13px, no rotation transition | `.section-toggle-chevron`, 14px, rotates 180° over `0.24s` |
| Press feedback | `opacity: 0.7` | `opacity: 0.65` |
| Height | none — measures **13px** tall in place | `min-height: 34px` |
| Used by | Actions | Quick log, Recorded activity |

Both are `<button>` elements carrying `aria-expanded` (25 uses across the
app) and `aria-controls` (6 uses).

Collapse animation, where present, is `max-height 0.24s ease, opacity 0.2s
ease` — which requires a known max-height and will clip content taller than
the declared value.

> **Needs design decision.** One disclosure pattern should win. Both are
> reasonable; the choice affects the Today surface directly, so it is a
> product call. Tracked as an Issue.

---

## 10. Navigation

Five fixed bottom tabs — Plan, Today, Calendar, Progress, Focus — as
`.tab-btn` elements with `data-view`, an `.active` state, and a bar
background of `--bar`. **Measured: 76×43px each** at a 390px viewport.

Tab order is a product decision recorded in `PROJECT_LEDGER.md` and should
not be changed casually.

Within a tab, view switching uses `.view-switch` segmented controls (Order /
Groups) and the Appearance control uses `.theme-switch` — the same visual
pattern under two class names.

---

## 11. Icons

Inline SVG, stroke-based, sized per context: 17px in `.btn-primary`,
`.btn-ghost` and `.circ-btn`; 15px in `.icon-btn`; 13–14px for chevrons.
No sprite sheet, no icon component, no icon font. Icons are duplicated inline
wherever used.

`aria-label` appears 14 times; `aria-hidden` twice. Icon-only buttons are not
uniformly labelled. → **Needs design decision** on a labelling convention.

---

## 12. State treatments

### Selected / active

Gold: gold text, a gold left edge, a gold star, or a `--surface-2` fill on
the selected segment of a switch. Consistent in intent.

### Success

There is no distinct success state. A completed action reads as a checked
row with reduced emphasis; a completed Morning Prime collapses to a single
"Completed at HH:MM" row. Day status uses `--day-good`. This is coherent with
"evidence before encouragement" but it is not written down anywhere. →
**Needs design decision**: is the absence of a celebratory success state
intentional? (It appears to be, and it fits the product.)

### Destructive

One treatment: full-width outlined `--danger` button, no fill. `confirm()` is
used four times in the app for confirmation — the browser-native dialog,
which does not match the sheet system visually and cannot be styled. →
**Needs design decision** against UX principle §10.

### Loading

**There is no loading state anywhere.** No spinner, skeleton or progress
class exists in the source. The app renders from local state and re-renders
on snapshot, so most transitions are instant — but the two Firebase SDK
scripts are loaded render-blocking from `gstatic.com`, so a slow or absent
network produces a blank page with no indication. → Tracked as an Issue.

### Error

No error component. Firebase failure falls back silently to localStorage,
which is the correct behaviour for data but leaves the user with no signal
about which mode they are in. → Relates to UX principle §5 ("no mystery
state"). **Needs design decision.**

### Empty

`.empty-state` — serif italic, `--text-2`, plus a `.compact` variant.
Consistent and used widely. The best-behaved state in the system.

---

## 13. Animation and motion

Transitions are short and numerous — roughly forty declarations, clustered at
`0.12s`, `0.14s`, `0.22s` and `0.24s`, almost all `ease`. Two named
keyframes: `fadein` and `sheet-up`. One cubic-bezier in general use
(`.2,.9,.3,1` for the sheet; `.2,.8,.3,1` for one transform).

> **Inconsistency.** Four durations doing one job, with no named tokens. →
> **Needs design decision** on a small duration/easing token set.

> **Gap.** `prefers-reduced-motion` is **not handled anywhere** (zero
> occurrences). Tracked as an Issue.

---

## 14. Touch targets

There is no stated minimum. Measured on the Today surface at 390×844:
**13 of 42 visible interactive elements fall below 44×44 CSS px.**

| Element | Measured |
| --- | --- |
| `.sec-head-toggle` ("Actions") | 346 × **13** |
| `.sec-link` ("Plan today") | 82 × **15** |
| `.icon-btn` | **30 × 30** |
| `.section-toggle` (Quick log, Recorded activity) | 346 × **34** |
| `.btn-link.day-share-link` | 346 × **35** |
| `.circ-btn` | **38 × 38** |
| `.tab-btn` | 76 × **43** |

Full-width elements are easy to hit horizontally, so raw area understates how
usable some of these are — but a 13px-tall primary section toggle is a real
target problem, and the bottom tabs sit 1px under the 44px guideline.

> **Needs design decision** — a stated minimum, and whether it is 44px (Apple)
> or 48px (Material). Tracked as an Issue.

---

## 15. Responsive and mobile behaviour

- Phone-first throughout; content columns are fluid with a `560px` cap on
  sheets.
- `env(safe-area-inset-top)` in the hero height, `env(safe-area-inset-bottom)`
  in sheets, the sheet action bar and the tab bar.
- `dvh` used for sheet height so iOS toolbar changes are tracked.
- Installed as a PWA: `display: standalone`, `orientation: portrait`.

> **Gap.** `manifest.json` hardcodes `theme_color` and `background_color` to
> `#0e0b08`. The installed splash screen is therefore always dark regardless
> of the chosen theme. Tracked as an Issue.

---

## 16. Accessibility posture

Recorded as observed facts:

- `aria-expanded` ×25, `aria-label` ×14, `aria-controls` ×6, `aria-pressed`
  ×3, `aria-hidden` ×2, `aria-disabled` ×2. Disclosure is well covered.
- **No `role` attributes** anywhere.
- **No `:focus-visible` styles** anywhere. `outline: none` is set on inputs
  and replaced with a border colour change; other controls have no visible
  keyboard focus at all.
- **No `prefers-reduced-motion` handling.**
- Contrast, measured across all five tabs by compositing alpha over real
  ancestor backgrounds: **97 items below WCAG AA in dark**, **1 in light**.
  Dark is the default theme and the worse of the two.

Tracked as Issues. Not addressed in this task.

---

## 17. Summary of open design decisions

Each of these is a **Needs design decision**, listed here so they are not
lost. Those with a filed Issue are marked.

1. Type scale — adopt one, or keep tuned literals.
2. Radius tokens — extend the set, or treat the literals as drift.
3. Component padding — from the spacing scale, or literals by convention.
4. Button taxonomy — retire duplicate names, define when each applies.
5. Press feedback — one convention (scale / background / colour / opacity).
6. Disclosure pattern — `.sec-head-toggle` vs `.section-toggle`. **Issue filed.**
7. Chip vs tag.
8. Rank-tier colours — fixed hex in JS vs theme-aware tokens. **Issue filed.**
9. Legacy token aliases — migrate or keep.
10. Icon labelling convention for icon-only buttons.
11. Confirmation dialogs — native `confirm()` vs a sheet.
12. Error/offline signalling — how the user learns which storage mode is live.
13. Motion tokens — durations and easings.
14. Minimum touch target — 44px or 48px. **Issue filed.**
15. Whether the absence of a success state is the intended end state.

---

*Audited against `main` @ `c7c37b1`. Re-audit when the Today surface or the
token layer changes materially.*

> **Since this audit:** a Today density pass (2026-09-22) shortened the hero
> (147px → 108px), added a `--hero-size` token, and gave the Backlog preview a
> compact `.bk-compact` shelf with 38×38 icon controls. The measurements in
> §2, §7 and §14 predate it.
