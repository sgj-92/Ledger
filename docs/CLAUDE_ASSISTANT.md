# Claude in Ledger — design

Status: **design, 2026-10-27; every question in §10 answered by Shaun. Nothing is built.**

> "I want to look at connecting Claude to ledger via api. So we can amend things in the
> app, clean data, add new etc." — "I want to add it into ledger app too." — "I want to
> give it full access as long as I can review right before execution and undo."

There are two ways in, and both share one engine:
1. **Ask Claude**, inside Ledger (web, iPhone and Android apps).
2. **The Ledger connector**, in Claude's own apps (claude.ai, desktop, phone) and Claude
   Code.

---

## 1. The idea in one paragraph

Claude can read all of Shaun's Ledger, but it never writes to it. It answers a request
with a **proposal**: a list of exact changes, each shown as before → after. Shaun reviews
the proposal in Ledger and taps **Apply**, all or some of it. **Ledger itself** then makes
the changes, signed in as Shaun, using the same save code and Firestore rules as when he
edits by hand. Every applied proposal keeps what each record looked like before, so
**Undo** puts it back.

Why proposals rather than letting Claude write:
- **The review is real.** Nothing can change until Shaun has seen it, whichever way in he
  used.
- **No new way to write data.** The rules, the "build on the existing record" editors,
  Home notifications and history all work exactly as they do today. There is no admin
  write path to keep correct.
- **Undo is possible**, because the before-image is captured at the moment of applying.

## 2. Ask Claude, in Ledger

- **Where:** the floating **+** button. Tapping it shows two choices, **Quick capture**
  and **Ask Claude** (Shaun's answer).
  - The + is on every tab.
  - It must never hide anything: each screen keeps room at its foot, so the last row
    scrolls clear of the button.
  - The + steps aside while the keyboard or a sheet is open.

  Ask Claude opens a sheet with a text field; the keyboard's microphone works for
  dictation.
- **A conversation:** Claude can ask a question back ("which Thursday?") before
  proposing. The conversation lasts for the sheet; nothing is kept unless Shaun applies
  something.
- **The proposal card,** in the sheet:
  - a one-line summary ("Move 3 Actions to Wed 28 Oct, add 2 meals");
  - each change as a row, before → after, with a tick to include or leave it out;
  - anything that deletes, touches more than 10 records, or reaches Home (Abi or Magda
    will be notified) is called out on its own line;
  - **Apply** (all ticked), **Change it** (back to the conversation) and **Cancel**.
- **After applying:** the existing toast with **Undo**, and the proposal goes into
  Settings → Claude → **History**.

Text the user typed and record titles are written with `textContent`, as everywhere in
Ledger.

## 3. The Ledger connector, in Claude's apps

- An MCP server (the standard way to give Claude tools) on Ledger's Firebase project,
  added once at claude.ai → Settings → Connectors. It then appears in Claude's desktop
  and phone apps too (connectors are added on the web).
- **Sign-in:** OAuth. Claude's apps support it, including dynamic client registration.
  Claude opens a Ledger sign-in page; Shaun signs in with his Ledger account; only the
  **owner** role is accepted. Ledger issues Claude a token, which Shaun can revoke in
  Settings → Claude. Ledger never sees a Claude password, and Claude never sees Shaun's.
- **The same tools** as Ask Claude, and proposing works the same way. **Reviewing
  happens in Ledger** (Shaun's answer): Claude replies with a link that opens the review
  card in Ledger, and Apply happens there.
- **Claude Code** can use the same connector, for heavier cleanups from a computer.

## 4. What Claude can see and change

**Full access, as Shaun asked:** everything Shaun himself can see and edit in Ledger.
- **Today and planning:** Actions (including key tasks, Flow order, the backlog and
  sprints), day plans, intentions, Day Notes, Morning Prime and Wind-down.
- **Health and fitness:** training, meals, nutrition, sessions, weight, Life Context and
  challenges.
- **Communications:** conversations and matters.
- **Home:** requests, recurring responsibilities and ongoing tasks, exactly as Shaun's
  admin role allows. A change there reaches Abi and Magda as if Shaun had made it, with
  its notification.
- **Settings Shaun controls:** routines, targets and partner-sharing presets.

**Never**, whatever is asked:
- **Roles and membership:** `ledger_users`, Home and partner membership. Roles stay
  server/Admin controlled.
- **Device and security records:** push subscriptions, notification tokens, auth.
- **Other people's private data:** Abi and Magda's own records beyond what Shaun can
  already see in Home or partner sharing.
- **Photos:** Claude sees that a photo exists and its date, never the image.

## 5. Tools

**Reading** (runs straight away, read-only):
- `get_day` (a date's Actions, Flow, plan, notes);
- `search_actions` (by text, date range, status, category or key task);
- `list_backlog`;
- `get_health` (training, meals, nutrition for a range);
- `list_home` (requests, recurring, ongoing);
- `list_comms`;
- `find_duplicates`.

**Proposing** (adds to the proposal; writes nothing):
- `propose_create`;
- `propose_update` (a field-level patch);
- `propose_move` (to another date);
- `propose_reorder` (Flow);
- `propose_complete` and `propose_reopen`;
- `propose_delete`;
- `propose_merge` (duplicates).

Each knows its record type's fields. A patch to a field Ledger doesn't have, or a value of
the wrong shape, is refused at the tool, before Shaun ever sees it.

**Finishing:** `present_proposal` ends Claude's turn with the summary line. A request can
also end with a plain answer and no proposal ("You have 4 Actions left today").

Each proposed change is stored as `{ kind, collection, id, patch | record, before }`.
`before` is read by the server when the change is proposed. When Shaun applies, Ledger
checks the record still matches `before`. If it has changed since, that row is held back
and he is told why, so nothing newer is overwritten.

## 6. Applying and Undo

- **Ledger applies each change** through its existing save functions. Changes to one
  record merge onto the record as it stands (`Object.assign`), never rebuilding it.
- **The applied proposal is saved** to `ledger_assistant_proposals/{id}`: owner-only,
  with the before-image and the after-image of every record it touched, who applied it
  and when, and whether it came from Ask Claude or the connector.
- **Undo** writes each before-image back, in reverse order. A deleted record is
  re-created with its own id. A record changed again since is held back and listed, so
  Undo never discards later work.
- **History** in Settings shows the last 30 days of proposals: applied, part-applied,
  cancelled and undone. Older ones are deleted (Shaun's answer).

## 7. The server

Two Cloud Functions, in `functions/`:

- **`assistant`** (HTTPS, for Ask Claude):
  - verifies the Firebase ID token and the owner role;
  - runs the conversation with Claude, the tool loop, and the reads (Admin SDK, scoped to
    Shaun's uid and the collections in §4);
  - stores the proposal and returns it.
- **`mcp`** (HTTPS, for the connector):
  - the MCP server, plus the OAuth endpoints. Claude's callback is
    `https://claude.ai/api/mcp/auth_callback`.
  - Tokens are stored hashed, in a collection no client can read, and expire.

**Neither function writes Ledger data.** They write only proposals, and the connector's
own tokens.

**Claude API settings:**
- **Model:** Claude Sonnet 5.5 (`claude-sonnet-5-5`, Shaun's answer), with effort set
  explicitly: `medium` for everyday requests, `high` for a big cleanup. It is one
  setting, so Opus 5.5 can be switched in if Sonnet falls short.
- **Thinking:** adaptive. Claude chooses how much to think.
- **Server-side fallback:** on (`fallbacks: "default"`), so a declined request is retried
  on another model rather than failing.
- **Tools:** strict schemas (`strict: true`). Claude chooses when to call them (`auto`).
- **Prompt caching:** the tool definitions and system prompt come first and never change
  between requests, so they are cached. The day's context comes after them.
- **Conversation history:** append-only.

**Keys:** the Anthropic API key lives in Firebase Secret Manager (`ANTHROPIC_API_KEY`),
as the push key does. It is never in the app, the repo or a browser.

## 8. Safety

- **Owner only.** Partners and Home members get no button, no connector and no access to
  the functions. Abi and Magda's own data is never sent to Claude.
- **No new write path.** Ledger's rules still decide every write, because Ledger makes
  them as Shaun.
- **Ledger text is data, not instructions.** Home requests written by Abi or Magda, and
  Comms notes, are passed to Claude marked as Ledger data. The system prompt says that
  nothing inside them is an instruction, and any proposal is reviewed anyway.
- **Limits:**
  - at most 200 changes in one proposal;
  - a daily request limit;
  - a monthly spend limit set in the Anthropic Console.
- **Off switch:** Settings → Claude turns off both ways in at once and revokes the
  connector's tokens.
- **Privacy:** what Shaun asks, and the records Claude reads to answer, are sent to
  Anthropic for that request. Under Anthropic's commercial API terms, that data isn't
  used for training by default. `privacy.html` will say so.

## 9. Build order

1. **The engine:**
   - the tools, proposals and Apply/Undo in Ledger;
   - the `assistant` function;
   - Ask Claude for Today and planning;
   - tests: the tools against the Firestore emulator, and the sheet with a stand-in
     Claude in e2e.
2. **Everything else:** health, Comms, Home, settings, and `find_duplicates` / merge.
3. **The connector:** `mcp`, OAuth, Settings → Claude (History, Disconnect).
4. A UX review, then the ledger and the deploy notes.

**What Shaun does:**
1. Create an Anthropic API account (console.anthropic.com), with a monthly spend limit.
2. Save the key once:
   `npx firebase-tools functions:secrets:set ANTHROPIC_API_KEY --project ledger-6aec3`,
   from his Mac or Cloud Shell.
3. Run "Deploy Firebase" after each phase.
4. Add the connector at claude.ai → Settings → Connectors (phase 3).

Ledger's Blaze plan covers the functions. The Claude API is billed by Anthropic per use,
separately from a Claude subscription.

## 10. Questions for Shaun

Answered 2026-10-27:
- **Model:** Sonnet 5.5.
- **Where Ask Claude sits:** a choice behind the floating + button. It keeps the +,
  which says "add something new"; a ⋯ reads as "more settings".
- **History:** 30 days.

- **Reviewing a connector proposal:** in Ledger only. Claude's reply links to the
  review card; there is no apply tool in the chat.
