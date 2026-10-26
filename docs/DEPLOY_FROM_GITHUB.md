# Deploying Firebase from GitHub (phone-friendly)

A GitHub Actions workflow deploys the Firestore rules, the indexes and the Cloud Functions
to `ledger-6aec3`. You start it by hand, from the GitHub app or github.com. It is the
same deploy as `npx firebase-tools deploy` on the Mac, which still works.

The web app is unaffected: Vercel deploys it from `main` on every push, as before.

## Using it

1. In the GitHub app: **Ledger → Actions → Deploy Firebase → Run workflow**. (On
   github.com: the Actions tab, then the same.)
2. Choose what to deploy:
   - **Everything** (the default);
   - **Rules and indexes**;
   - **Functions**.
3. **Run.** First, the rules tests and the functions tests run against the emulator.
   **Nothing deploys if any fail.**
4. If you added a required reviewer (below), approve the deploy when GitHub asks.
5. The run's summary says what was deployed, from which commit, and whether it worked.
   About 5–8 minutes in all.

It always deploys `main`, as it is on GitHub.

## What it will never do

- It never runs on its own, on a push or a schedule.
- It never deletes an index or a function that isn't in the repository. It stops and
  says so instead. A deletion stays a deliberate step on the Mac.
- It never holds a key. Google lets in only this repository (by its id), and only its
  `firebase` environment on `main`. There is nothing to leak or rotate.

The deploy account can deploy rules, indexes and functions, and read the project's
settings. It cannot read Firestore data directly. However, functions run with the
project's service account, so anyone who can deploy functions can, in effect, reach the
data. That is why it is manual, limited to `main`, and can require your approval.

## Setting it up (once, about 10 minutes)

### 1. Google side: Cloud Shell

Cloud Shell works in a phone browser; a laptop is easier.
1. Open **shell.cloud.google.com**, signed in as the Google account that owns
   `ledger-6aec3`.
2. Paste:
   ```
   git clone https://github.com/sgj-92/Ledger.git && bash Ledger/scripts/setup-github-deploy.sh
   ```
3. It creates:
   - the deploy service account, `github-deploy@ledger-6aec3.iam.gserviceaccount.com`,
     and its roles;
   - the Workload Identity pool `github` with provider `ledger`.
4. It then prints the functions' current settings. Keep that output for step 2.

Running it again is safe.

### 2. GitHub side: the `firebase` environment

On github.com, signed in as `sgj-92`:
1. Go to **Ledger → Settings → Environments → New environment**, and name it `firebase`.
2. **Deployment branches and tags:** "Selected branches" → add `main`.
3. **Required reviewers** (optional): add yourself. Each deploy then waits for your tap.
4. **Environment variables:** add these, with the values the script printed. They are
   what `functions/.env` holds on the Mac. None of them is a secret.

   | Name | Value |
   | --- | --- |
   | `VAPID_PUBLIC_KEY` | the public push key (the private one stays in Secret Manager) |
   | `VAPID_SUBJECT` | `mailto:` your email |
   | `FUNCTIONS_REGION` | where the functions run, e.g. `europe-west2` |
   | `APP_URL` | optional; `https://ledger.sgj.luxe/` by default |

### 3. Try it

Run **Deploy Firebase** with **Rules and indexes**. This is harmless when nothing has
changed.

## If a run fails

- **The tests failed:** nothing was deployed. Look at the failing test.
- **"Missing variable …":** add it to the `firebase` environment (step 2).
- **Sign-in failed (`unauthorized_client`, `Permission 'iam.serviceAccounts.getAccessToken' denied`):**
  - check the run was on `main`, from the `firebase` environment;
  - check the setup script finished.
- **"Missing permissions required for functions deploy" / `PERMISSION_DENIED` naming a
  permission:** the deploy account lacks a role. Add it in IAM (Console → IAM →
  `github-deploy@…` → Edit) or ask Claude Code. The script's role list is the
  starting point:
  - Firebase Rules Admin
  - Cloud Datastore Index Admin
  - Cloud Functions Admin
  - Cloud Scheduler Admin
  - Service Account User
  - Secret Manager Viewer
  - Artifact Registry Reader
  - Service Usage Consumer
  - Firebase Viewer
- **"would delete functions" / indexes:** that is on purpose. Deploy from the Mac,
  where it asks first.

## Turning it off

Delete or disable the workflow (Actions → Deploy Firebase → ⋯ → Disable). Or, in Cloud
Shell:
```
gcloud iam workload-identity-pools delete github --location=global --project=ledger-6aec3
```
