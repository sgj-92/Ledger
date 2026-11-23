# aCcountable sync (Ledger's side)

*2026-11-23.* Ledger and aCcountable, Shaun's calorie and training app, keep these in step:

- planned training and its times;
- weight;
- the day's nutrition;
- meal times.

aCcountable's `docs/ledger-sync.md` is the contract. This page covers Ledger's half:
`functions/accountable.js`, wired in `functions/index.js`.

## Who owns what

| Data | Direction | In Ledger |
| --- | --- | --- |
| Planned training (type, start, length) | both ways; the last change wins | `ledger_plans/<date>`: `trainingTypes`, `trainingDetails[type]` (`activityTime`, `durationMin`, `syncSessions`) |
| Meals (name, time, foods, kcal, done) | aCcountable → Ledger | `ledger_plans/<date>.meals`, each with `ref`, `source: 'accountable'`, `time`, `tag`, `kcal`, `foods` |
| A meal ticked in Ledger | Ledger → aCcountable | sent as `mealsDone`; aCcountable logs its foods |
| The day's food (eaten, macros, targets, diary, day type) | aCcountable → Ledger | the day's `ledger_sessions` nutrition record: `accountable`, `foodDiary`, `foodDiarySource: 'accountable'` |
| Weight | both ways; the last change wins | a `ledger_sessions` weight record (`acc-weight-<date>` when aCcountable made it) |

### Shaun's choices (2026-11-23)

- **Two sessions of one type** (a run and a walk are both cardio) are each kept.
  - Ledger stores them in `trainingDetails[type].syncSessions`.
  - Today shows "Cardio · Run 07:00, Walk 18:00".
  - Each goes back to aCcountable with its own ref.
  - The first session is the one Ledger edits (its time and length).
- **aCcountable fills the food.** In the Nutrition sheet, its numbers and diary show
  read-only. The day rating and daily checks stay Ledger's and are never overwritten.
  - A diary typed in Ledger before the first sync is kept in `foodDiaryLedger`.
- **aCcountable's meals lead.** On a day aCcountable plans, its meals are the day's
  meals, in time order.
  - Ledger's own meals that were already ticked stay; the rest give way.
  - Ticking an aCcountable meal sends it to aCcountable. Ledger doesn't also write it
    into its own diary, so nothing is counted twice.
  - The meal opens read-only, with its foods.

## How it works

- **In:** `accountableSync` (HTTPS POST) checks the signature (below) over the raw body.
  - It cleans the day: only known types, `HH:MM` times, bounded sizes, a sane weight,
    and no `<` or `>` anywhere.
  - It writes only what differs, marked as from aCcountable (`syncedFromAccountableAt`,
    `syncSource`).
  - It never touches the rest of the day: Morning Prime, notes, exercises and so on.
- **Out:** `onPlanForAccountable` (on `ledger_plans/<date>`) and `onWeightForAccountable`
  (on weight sessions) send Ledger's day.
  - The day contains every planned session with its ref (`acc:session:…`, or
    `ledger:<date>:<type>` for Ledger's own), `mealsDone`, and the day's latest weigh-in.
  - A plan write that changes none of that sends nothing.
- **No echo:** `ledger_sync/accountable-<date>` holds a hash of the last day said.
  - After an inbound day, the day it implies is hashed in the same batch, so the triggers
    its own writes fire send nothing.
  - A day Ledger never spoke about, with nothing on it, isn't sent.
- **Removals:** a training type aCcountable stops listing is removed from Ledger, with
  three exceptions:
  - aCcountable never had it (planned in Ledger, not yet sent);
  - Ledger has logged it;
  - it's under way.
- **Status:** `ledger_meta/accountable` holds `lastInAt`, `lastOutAt` and `lastError`.
  Settings → Account → aCcountable shows it.

## Signing

Both directions use the same headers:

- `x-sync-timestamp`: milliseconds, as a string.
- `x-sync-signature`: `sha256=<hex>`, the HMAC-SHA256 of `<timestamp>.<raw body>` with
  the shared secret.

The receiver refuses a request with 401 when the signature doesn't match or the timestamp
is more than five minutes off.

## Setting it up (Shaun, once)

1. **Make one long random secret**, 32 characters or more. Never paste it into a chat.
2. **Save it in Firebase.** This has to be done before the next deploy: a deploy stops if
   a function's secret doesn't exist.
   - On the Mac:
     `npx firebase-tools functions:secrets:set ACCOUNTABLE_SYNC_SECRET --project ledger-6aec3`
   - If the deploy then says `secretmanager.secrets.setIamPolicy` is denied, see
     `docs/DEPLOY_FROM_GITHUB.md` ("A new secret").
3. **Save the same string in Supabase** as `LEDGER_SYNC_SECRET`, on aCcountable's project.
4. **Deploy:** GitHub → Actions → Deploy Firebase → Everything.
5. **Point aCcountable at Ledger:** on Supabase, set `LEDGER_SYNC_URL` to
   `https://us-central1-ledger-6aec3.cloudfunctions.net/accountableSync`. Use another
   region in place of `us-central1` if `FUNCTIONS_REGION` is different.

Where Ledger sends its days is the `ACCOUNTABLE_SYNC_URL` param. It defaults to
aCcountable's `ledger-sync` function. To change it, set the `ACCOUNTABLE_SYNC_URL`
variable in the `firebase` GitHub environment.

Deploying from the Mac instead: `functions/.env` needs a line
`ACCOUNTABLE_SYNC_URL=https://lubouzocrluaojfjaqjy.supabase.co/functions/v1/ledger-sync`.
Without it, the deploy stops to ask for the value; pressing Enter takes the default. The
GitHub workflow always writes the line.

Until the secret exists and is 32 characters or more:

- the endpoint answers 503 "not set up";
- the triggers send nothing.

## Tests

- `tests/functions/accountable.test.js` runs on the Firestore emulator, with a stand-in
  aCcountable. It checks:
  - the signature;
  - writing only what differs;
  - two sessions kept;
  - the meals and food rules;
  - the shape of an outbound day;
  - that nothing echoes;
  - removals;
  - bounds;
  - that nothing aCcountable sends is stored as markup.
- `tests/firestore-rules/rules.test.js` checks that no client can reach `ledger_sync`.
