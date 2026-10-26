#!/usr/bin/env bash
# One-time setup for .github/workflows/deploy-firebase.yml (docs/DEPLOY_FROM_GITHUB.md).
#
# Run it once in Google Cloud Shell (shell.cloud.google.com), signed in as the project
# owner:
#   git clone https://github.com/sgj-92/Ledger.git && bash Ledger/scripts/setup-github-deploy.sh
#
# It creates:
#   - a service account that may deploy rules, indexes and functions, and nothing else;
#   - a Workload Identity pool that trusts GitHub, but only for this repository's
#     "firebase" environment on main.
# No key is created or stored anywhere. Safe to run again.
set -euo pipefail

PROJECT_ID=ledger-6aec3
PROJECT_NUMBER=607695857530
REPO_ID=1354931690            # sgj-92/Ledger (the id survives a rename; a name can be reused)
POOL=github
PROVIDER=ledger
SA_NAME=github-deploy
SA="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "1/5 APIs for keyless sign-in"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

echo "2/5 The deploy service account"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub deploy: rules, indexes, functions"

echo "3/5 What it may do (deploy only)"
for ROLE in \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/cloudfunctions.admin \
  roles/cloudscheduler.admin \
  roles/iam.serviceAccountUser \
  roles/secretmanager.viewer \
  roles/artifactregistry.reader \
  roles/serviceusage.serviceUsageConsumer \
  roles/firebase.viewer
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
  echo "   $ROLE"
done

echo "4/5 Trust GitHub: this repository, its \"firebase\" environment, main only"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
CONDITION="assertion.repository_id == '$REPO_ID' && assertion.ref == 'refs/heads/main' && assertion.environment == 'firebase'"
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment"
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name="sgj-92/Ledger" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi

echo "5/5 Let that repository act as the deploy account"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository_id/$REPO_ID" \
  --quiet >/dev/null

echo
echo "Done. GitHub also needs the functions' settings (from functions/.env on your Mac)."
echo "The functions running now were deployed with these, so here they are:"
FN=$(gcloud functions list --format='value(name)' --filter='name~onPinCreated' 2>/dev/null | head -1 || true)
if [ -n "$FN" ]; then
  REGION=$(echo "$FN" | cut -d/ -f4)
  gcloud functions describe onPinCreated --region="$REGION" \
    --format='value(serviceConfig.environmentVariables)' 2>/dev/null | tr ';' '\n' \
    | grep -E '^(VAPID_PUBLIC_KEY|VAPID_SUBJECT|APP_URL|FUNCTIONS_REGION)=' || true
  echo "FUNCTIONS_REGION=$REGION   (where they run)"
else
  echo "(couldn't read them; copy functions/.env from your Mac instead)"
fi
echo
echo "Add each as a variable of the GitHub environment \"firebase\":"
echo "  github.com/sgj-92/Ledger → Settings → Environments → firebase → Environment variables"
