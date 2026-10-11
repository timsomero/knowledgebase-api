# Builds the container, pushes it to Artifact Registry and deploys it to Cloud Run.
# Usage: .\deploy.ps1
$ErrorActionPreference = 'Stop'

$Project = 'modular-primer-511321-h2'
$Region  = 'us-central1'
$Service = 'knowledgebase-api'
$Tag     = git rev-parse --short HEAD
$Image   = "$Region-docker.pkg.dev/$Project/knowledgebase/${Service}:$Tag"

docker build --platform linux/amd64 --provenance=false -t $Image $PSScriptRoot
docker push $Image

gcloud run deploy $Service `
    --image $Image `
    --project $Project `
    --region $Region `
    --no-allow-unauthenticated `
    --max-instances 2 `
    --memory 512Mi `
    --quiet
