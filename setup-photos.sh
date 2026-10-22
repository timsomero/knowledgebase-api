#!/usr/bin/env bash
# One-time setup for photos on tasks: creates a private Cloud Storage bucket, lets only the
# Cloud Run service's account use it, and tells the service its name (PHOTO_BUCKET). Safe to re-run.
#
# Run it in Cloud Shell (https://shell.cloud.google.com):
#   cd knowledgebase-api && git checkout main && git pull && bash setup-photos.sh
set -euo pipefail

PROJECT=modular-primer-511321-h2
REGION=us-central1
SERVICE=knowledgebase-api
RUNTIME_SA="knowledgebase-api@$PROJECT.iam.gserviceaccount.com"
BUCKET="$PROJECT-task-photos"

gcloud config set project "$PROJECT"
gcloud services enable storage.googleapis.com

# Private: no public access, permissions per bucket only. Deleted photos stay recoverable for 7 days.
if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" \
    --location "$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --soft-delete-duration 7d
fi

# The service can read, add and delete photos in this bucket, and nothing else in Cloud Storage.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:$RUNTIME_SA" \
  --role roles/storage.objectUser >/dev/null

# Deploys keep this setting, so this is needed only once. It also restarts the service.
gcloud run services update "$SERVICE" \
  --region "$REGION" \
  --update-env-vars "PHOTO_BUCKET=$BUCKET"

echo
echo "Done. Photos can now be attached to tasks; /info shows \"photos\": true."
