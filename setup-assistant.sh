#!/usr/bin/env bash
# One-time setup for tidying up new tasks with Claude: stores an Anthropic API key in Secret Manager
# and gives it to the Cloud Run service as ANTHROPIC_API_KEY. Safe to re-run, e.g. to replace the key.
#
# Create a key at https://console.anthropic.com (Settings → API Keys), then in Cloud Shell
# (https://shell.cloud.google.com):
#   git clone https://github.com/timsomero/knowledgebase-api && cd knowledgebase-api
#   bash setup-assistant.sh
# The key is typed (pasted) at a prompt, so it never ends up in your shell history or in GitHub.
set -euo pipefail

PROJECT=modular-primer-511321-h2
REGION=us-central1
SERVICE=knowledgebase-api
RUNTIME_SA="knowledgebase-api@$PROJECT.iam.gserviceaccount.com"
SECRET=anthropic-api-key

read -rsp "Anthropic API key (sk-ant-...): " KEY
echo
[[ "$KEY" == sk-ant-* ]] || { echo "That doesn't look like an Anthropic API key." >&2; exit 1; }

gcloud config set project "$PROJECT"
gcloud services enable secretmanager.googleapis.com

# A new version replaces the old key; the service reads "latest" when it starts.
if gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  printf %s "$KEY" | gcloud secrets versions add "$SECRET" --data-file=-
else
  printf %s "$KEY" | gcloud secrets create "$SECRET" --replication-policy automatic --data-file=-
fi

# Only the service's own account can read it.
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member "serviceAccount:$RUNTIME_SA" \
  --role roles/secretmanager.secretAccessor >/dev/null

# Deploys keep this setting, so this is needed only once. It also restarts the service with the key.
gcloud run services update "$SERVICE" \
  --region "$REGION" \
  --update-secrets "ANTHROPIC_API_KEY=$SECRET:latest"

echo
echo "Done. New tasks are now tidied up by Claude; /info shows \"assistant\": true."
