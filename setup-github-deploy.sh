#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy to Cloud Run without any stored keys
# (Workload Identity Federation). Safe to re-run.
#
# Run it in Cloud Shell (https://shell.cloud.google.com), which is already signed in:
#   git clone https://github.com/timsomero/knowledgebase-api && cd knowledgebase-api
#   bash setup-github-deploy.sh you@gmail.com 1234-abc.apps.googleusercontent.com
set -euo pipefail

ALLOWED_EMAILS="${1:?usage: setup-github-deploy.sh <allowed emails, comma-separated> <google client id>}"
GOOGLE_CLIENT_ID="${2:?usage: setup-github-deploy.sh <allowed emails, comma-separated> <google client id>}"

PROJECT=modular-primer-511321-h2
PROJECT_NUMBER=831913024648
REGION=us-central1
SERVICE=knowledgebase-api
REPO=timsomero/knowledgebase-api
DEPLOYER="github-deployer@$PROJECT.iam.gserviceaccount.com"
POOL=github

gcloud config set project "$PROJECT"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

# Identity pool that trusts GitHub's tokens, but only for pushes to main of this repository.
if ! gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"
fi
if ! gcloud iam workload-identity-pools providers describe github --location global --workload-identity-pool "$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc github \
    --location global \
    --workload-identity-pool "$POOL" \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main'"
fi

# Service account the workflow deploys as.
if ! gcloud iam service-accounts describe "$DEPLOYER" >/dev/null 2>&1; then
  gcloud iam service-accounts create github-deployer --display-name "GitHub Actions deployer"
fi

# Deploy and set the service's public access, push images, and run the service as its own account.
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$DEPLOYER" --role roles/run.admin --condition None >/dev/null
gcloud artifacts repositories add-iam-policy-binding knowledgebase --location "$REGION" \
  --member "serviceAccount:$DEPLOYER" --role roles/artifactregistry.writer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SERVICE@$PROJECT.iam.gserviceaccount.com" \
  --member "serviceAccount:$DEPLOYER" --role roles/iam.serviceAccountUser >/dev/null

# Let the GitHub repository act as the deployer.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" \
  --role roles/iam.workloadIdentityUser >/dev/null

# Sign-in settings live on the service; deploys keep them. ('^;^' lets ALLOWED_EMAILS contain commas.)
gcloud run services update "$SERVICE" --region "$REGION" \
  --update-env-vars "^;^ALLOWED_EMAILS=$ALLOWED_EMAILS;GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"

echo
echo "Done. Push to main (or Actions → Build and deploy → Run workflow) to deploy."
