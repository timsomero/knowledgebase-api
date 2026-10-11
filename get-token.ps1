# Prints a short-lived (1 hour) bearer token for calling the IAP-protected API from the command line.
# Usage: $t = .\get-token.ps1
#
# The token is a JWT signed by the kb-api-caller service account, which IAP allows through.
# Signing it requires your own Google sign-in (gcloud) plus the Service Account Token Creator
# role on kb-api-caller, so access still depends on your Google account.
$ErrorActionPreference = 'Stop'

$ServiceAccount = 'kb-api-caller@modular-primer-511321-h2.iam.gserviceaccount.com'
$Audience       = 'https://knowledgebase-api-831913024648.us-central1.run.app/*'

$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$claim = @{ iss = $ServiceAccount; sub = $ServiceAccount; aud = $Audience; iat = $now; exp = $now + 3600 }

$claimFile = [IO.Path]::GetTempFileName()
$jwtFile   = [IO.Path]::GetTempFileName()
try {
    $claim | ConvertTo-Json -Compress | Set-Content -Encoding ascii $claimFile

    # gcloud reports progress on stderr; only the exit code matters here.
    $ErrorActionPreference = 'Continue'
    gcloud iam service-accounts sign-jwt --iam-account=$ServiceAccount $claimFile $jwtFile 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Signing failed. Run 'gcloud auth login' and try again." }

    (Get-Content $jwtFile -Raw).Trim()
}
finally {
    Remove-Item $claimFile, $jwtFile -ErrorAction SilentlyContinue
}
