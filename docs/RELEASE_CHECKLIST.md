# Ledger — Release Checklist

Run before deploying to GitHub Pages.

Ledger has no staging environment and updates reach an installed phone app
directly, so this list is the gate. Tick what you actually checked. An
untested item is an unticked item.

Copy this into the release Issue or PR and fill it in.

---

## Blocking

These stop a release.

- [ ] **Core journeys tested.** All eight journeys in `docs/PRODUCT.md`
      complete end to end on a phone.
- [ ] **No known P0 Issues** open on the Project.
- [ ] **No unresolved data-loss risks.** No open Issue with "data was lost"
      or "data could be lost" ticked.
- [ ] **No console errors** during a normal session.
- [ ] **Existing data still reads correctly.** Open a day written by the
      previous version and confirm nothing is missing.
- [ ] **Every editor touched in this release merges onto the existing
      record** rather than rebuilding it. Re-read the diff for this
      specifically — it is the repository's known bug pattern.

---

## Surfaces

- [ ] Plan
- [ ] Today — Morning Prime (Plan and Move), Actions (Order and Groups),
      Health & fitness, Evening Wind-down,
      Quick Log, Recorded Activity, Backlog, Catch-up, Daily Handoff
- [ ] Calendar
- [ ] Progress
- [ ] Focus

---

## Themes

- [ ] **Dark theme** checked on every surface touched.
- [ ] **Light theme** checked on every surface touched.
- [ ] **System** resolves correctly and flips live with the OS setting.
- [ ] No flash of the wrong theme on cold start.
- [ ] Native controls (date and time pickers, selects) match the theme.

---

## Mobile and PWA

- [ ] **Mobile viewport** checked — 390×844 or the real device.
- [ ] **iPhone PWA** checked — installed, launched from the home screen.
- [ ] **Android PWA** checked where a device is available.
- [ ] Splash screen and status bar correct in both themes.
- [ ] Safe areas correct — notch and home indicator.
- [ ] **Keyboard/input behaviour** — the keyboard never covers the field
      being edited or the sheet's action bar.
- [ ] **Scrolling** — no trapped scroller, no nested scroller, sheets do not
      chain scroll to the page behind them.
- [ ] **Touch targets** — nothing new below the agreed minimum.
- [ ] Back gesture behaves sensibly inside a sheet.

---

## Data and storage

- [ ] **Firestore behaviour** — writes land, `onSnapshot` re-renders, a
      second device sees the change.
- [ ] **Offline behaviour** — the app opens and works with the network off.
- [ ] Reconnect after offline does not duplicate or lose records.
- [ ] localStorage fallback path exercised, not assumed.
- [ ] **Service worker / cache behaviour** — a new version actually reaches
      an already-installed app.

---

## States

- [ ] **Loading states** — nothing blank and unexplained while data arrives.
- [ ] **Error states** — a failed save is visibly a failed save.
- [ ] **Empty states** — every list checked with no data.
- [ ] First run: a fresh install with nothing stored is usable.

---

## Accessibility basics

- [ ] Contrast checked on anything visually changed, in both themes.
- [ ] Visible keyboard focus on anything newly interactive.
- [ ] Icon-only controls have labels.
- [ ] Nothing relies on colour alone to carry meaning.

---

## Notifications

- [ ] **Push notification behaviour** checked where the release touches it —
      "Pin now" delivers, the notification opens the right view, and the
      Cloud Function logs cleanly.

---

## Automation

- [ ] JS syntax gate passes over the inline script block.
- [ ] **Regression smoke tests passing** — once an automated suite exists.

---

## After deploying

- [ ] Loaded the live URL on a phone and confirmed the new version is running.
- [ ] Issues covered by this release moved to Test, and closed only once
      verified on the device.
- [ ] `PROJECT_LEDGER.md` → Recently Completed updated.

---

*If something on this list is not relevant to a given release, strike it out
rather than deleting it, so the reason is visible.*
