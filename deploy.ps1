# Builds the container, pushes it to Artifact Registry and deploys it to Cloud Run.
# Usage: .\deploy.ps1
# First time (the values are kept on the service, so later deploys don't need them):
#   .\deploy.ps1 -AllowedEmails you@gmail.com -GoogleClientId 1234-abc.apps.googleusercontent.com
param(
    [string]$AllowedEmails,   # comma-separated Google accounts allowed to use the API
    [string]$GoogleClientId   # OAuth client ID of the web app
)
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

# Only the variables given here change; others already on the service are kept.
# '^;^' makes ';' the separator so ALLOWED_EMAILS can contain commas.
$EnvVars = @("FIRESTORE_PROJECT_ID=$Project")
if ($AllowedEmails)  { $EnvVars += "ALLOWED_EMAILS=$AllowedEmails" }
if ($GoogleClientId) { $EnvVars += "GOOGLE_CLIENT_ID=$GoogleClientId" }
$EnvVarsArg = '^;^' + ($EnvVars -join ';')

Invoke-Step { docker build --platform linux/amd64 --provenance=false --build-arg APP_BUILD=manual --build-arg APP_COMMIT=$Tag -t $Image $PSScriptRoot }
Invoke-Step { docker push $Image }

# The app refuses to start without ALLOWED_EMAILS, so a misconfigured deploy fails here,
# before the service is opened to the internet below.
Invoke-Step {
    gcloud run deploy $Service `
        --image $Image `
        --project $Project `
        --region $Region `
        --service-account "knowledgebase-api@$Project.iam.gserviceaccount.com" `
        --update-env-vars $EnvVarsArg `
        --max-instances 2 `
        --memory 512Mi `
        --cpu-boost `
        --quiet
}

# Public at the Cloud Run level; the app itself checks the Google sign-in.
Invoke-Step {
    gcloud run services add-iam-policy-binding $Service `
        --project $Project `
        --region $Region `
        --member allUsers `
        --role roles/run.invoker `
        --quiet
}
