# Microsoft 365 for the Comms sweep

*2026-11-11.* Once Shaun connects his Microsoft 365 account, the Comms sweep's **Check
Outlook & Teams** button adds who's waiting for a reply to Replies, under the channels he
chose. It's built in `functions/connect.js`, with the app side in the "Outlook & Teams for
the sweep" block of `index.html`.

## What it reads, and what it keeps

**Who counts as waiting**, since the last check (two days back the first time, never more
than seven):

- **Outlook:** an email in the Focused inbox from someone else (not a no-reply sender), with
  nothing he sent later in the same conversation.
- **Teams:** a chat whose newest message is someone else's.

**What it keeps:**

- **Names only.** The server reads the sender and the conversation, and returns a name, a
  kind (mail or Teams) and a key. No subject or message text leaves the server, and nothing
  of the kind is stored.
- **The key** stops the same message adding the name twice. A newer message in the same
  conversation adds them again.
- **The refresh token** sits in `ledger_connections/microsoft`, which no page can read or
  write (`firestore.rules`). Microsoft rotates the token on each use, and the newest one is
  kept.
- **The app sees only** `ledger_meta/connections`: connected or not, the account, and when
  it last checked.

**Sign-in** uses OAuth 2.0 with PKCE as a public client, so no client secret exists. Only
the owner can connect, check or disconnect. A sign-in Microsoft has revoked disconnects
cleanly and asks him to connect again.

**WhatsApp, Instagram and LinkedIn** can't be read by any app; they stay manual.

**Gmail** isn't included. A personal Gmail connection like this lasts only 7 days unless
the app passes Google's security review, so it's left for later.

## "ledger: …" in Teams (2026-11-25)

Shaun types a line in any Teams chat, and it becomes an Action:

| He types | Ledger adds |
| --- | --- |
| `ledger: send Acme the pack by Friday` | an S&J Action, "Send Acme the pack", on Friday |
| `send to ledger: call Kaz` | "Call Kaz", today |
| `ledger` (as a reply to someone's message) | that message, today |

- **Every two minutes**, `onTeamsCaptureTick` looks at chats with something new since the
  last look. It acts only on **his own** messages that start with the keyword. Anyone
  else's message is never acted on, even if it starts "ledger:".
- **A day word at the end** sets the date: today, tomorrow, or a weekday (the next one,
  counting today). Otherwise the Action is for today.
- **The Action:**
  - Work, marked S&J.
  - Its row says where it came from: "Teams · Kori Lane".
  - His phone gets "Added to Ledger" with a link to it.
  - Each Teams message makes one Action at most; its id is the key.
- **What's kept:** the Action's title, which is his own words or the message he replied to
  with "ledger". This is the one exception to "no message text leaves the server", and
  only because he asked for it. Nothing else from the chat is stored.
- **What it needs:** the `Chat.Read` permission he has already granted, and nothing new.
  It starts once Microsoft 365 is connected and the functions are deployed.

## Setting it up (once, Shaun)

1. **Register Ledger with Microsoft.**
   - Go to portal.azure.com → Microsoft Entra ID → App registrations → New registration.
   - Name: `Ledger`.
   - Supported account types: *Accounts in any organizational directory and personal
     Microsoft accounts*.
   - Redirect URI: choose platform **Public client/native (mobile & desktop)**, then enter
     `https://us-central1-ledger-6aec3.cloudfunctions.net/msCallback`. If `FUNCTIONS_REGION`
     isn't `us-central1`, use that region instead.
2. **Authentication** → Advanced settings → *Allow public client flows*: **Yes**. Save.
3. **API permissions** → Add a permission → Microsoft Graph → Delegated: `User.Read`,
   `Mail.Read`, `Chat.Read` and `offline_access`.
   - If S&J's tenant doesn't let staff consent to apps, its admin must click *Grant admin
     consent*. Teams' `Chat.Read` is the one most often restricted.
4. **Overview** → copy the *Application (client) ID*.
   - In GitHub, go to the repository → Settings → Environments → `firebase` → Variables.
   - Add `MS_CLIENT_ID` with that ID. It isn't a secret.
5. **Deploy:** Actions → Deploy Firebase → Everything. This deploys the functions and the
   rules that keep the token server-only.
6. **Connect** in Ledger: Settings → Comms sweep channels → Outlook & Teams → **Connect**.
   Do it in a browser, such as on the Mac. The connection then works from every device.
7. **Choose channels** in the same sheet: which channel Outlook mail and Teams chats go
   under (for example *Email - S&J* and *Teams - S&J*).

Without `MS_CLIENT_ID`, the deploy workflow writes `MS_CLIENT_ID=not-set`, deploys still work, and
**Connect** says it isn't set up yet. Deploying from the Mac instead, add `MS_CLIENT_ID=not-set`
to `functions/.env` until the real ID exists, or the deploy stops to ask for it.

## Tests

- `tests/functions/connect.test.js` runs against a stand-in Microsoft. It checks the PKCE
  sign-in and its one-time state, that the tokens stay on the server, who counts as waiting,
  that only names come back, the look-back window, token rotation, revocation and disconnect.
- `tests/firestore-rules/rules.test.js` checks that no client can reach the tokens.
- `tests/e2e/comms-capture.test.js` covers the button, the channel mapping and that the
  same message never adds a name twice.
