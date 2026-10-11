# Builds the container, pushes it to Artifact Registry and deploys it to Cloud Run.
# Usage: .\deploy.ps1
$ErrorActionPreference = 'Stop'

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "gcloud not found. Install the Google Cloud CLI, or open a new terminal if you just installed it."
}

# Native commands don't throw on failure in Windows PowerShell, so check exit codes explicitly.
# (Progress output on stderr must not count as an error, hence 'Continue' while the command runs.)
function Invoke-Step([scriptblock]$Command) {
    $ErrorActionPreference = 'Continue'
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit code $LASTEXITCODE): $Command" }
}

$Project = 'modular-primer-511321-h2'
$Region  = 'us-central1'
$Service = 'knowledgebase-api'
$Tag     = git -C $PSScriptRoot rev-parse --short HEAD
$Image   = "$Region-docker.pkg.dev/$Project/knowledgebase/${Service}:$Tag"

Invoke-Step { docker build --platform linux/amd64 --provenance=false -t $Image $PSScriptRoot }
Invoke-Step { docker push $Image }

Invoke-Step {
    gcloud run deploy $Service `
        --image $Image `
        --project $Project `
        --region $Region `
        --service-account "knowledgebase-api@$Project.iam.gserviceaccount.com" `
        --set-env-vars "FIRESTORE_PROJECT_ID=$Project" `
        --no-allow-unauthenticated `
        --iap `
        --max-instances 2 `
        --memory 512Mi `
        --quiet
}
