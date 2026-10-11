# KnowledgeBase API

A small ASP.NET Core REST API, packaged as a Docker container, intended to run on Google Cloud Run.

- Google Cloud project: **KnowledgeBase API Project** (`modular-primer-511321-h2`)

## Endpoints

| Method | Path          | Description          |
|--------|---------------|----------------------|
| GET    | `/`           | Service info         |
| GET    | `/health`     | Health check         |
| GET    | `/notes`      | List notes           |
| GET    | `/notes/{id}` | Get one note         |
| POST   | `/notes`      | Create a note (`{"text": "..."}`) |
| DELETE | `/notes/{id}` | Delete a note        |

## Storage

- **Cloud Run:** notes are stored in Firestore (`(default)` database, `us-central1`, collection `notes`).
  The service runs as `knowledgebase-api@modular-primer-511321-h2.iam.gserviceaccount.com`,
  which only has the `roles/datastore.user` role.
- **Local Docker:** if `FIRESTORE_PROJECT_ID` is not set, notes are kept in memory and lost on restart.

`GET /` reports which storage is active.

## Run locally with Docker

```bash
docker build -t knowledgebase-api .
docker run --rm -p 8081:8080 knowledgebase-api
```

Then open http://localhost:8081/health

(Host port 8081 is used because 8080 is often taken by other local containers.)

## Deploy to Cloud Run

Requires Docker and the Google Cloud CLI (`gcloud init` with project `modular-primer-511321-h2`).

```powershell
.\deploy.ps1
```

- Service URL: https://knowledgebase-api-831913024648.us-central1.run.app
- Images: Artifact Registry repo `knowledgebase` in `us-central1`
- The service is **private**: requests need a Google identity token.

## Access control (Identity-Aware Proxy)

The service is protected by IAP: opening the URL in any browser (desktop or phone) redirects to
Google sign-in, and only accounts granted `roles/iap.httpsResourceAccessor` get through.
Cloud Run itself only accepts calls from the IAP service agent.

One-time setup (already done for this project):

```powershell
gcloud services enable iap.googleapis.com cloudresourcemanager.googleapis.com
gcloud run services update knowledgebase-api --region us-central1 --iap
gcloud run services add-iam-policy-binding knowledgebase-api --region us-central1 `
    --member="serviceAccount:service-831913024648@gcp-sa-iap.iam.gserviceaccount.com" --role="roles/run.invoker"
gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service=knowledgebase-api --region=us-central1 `
    --member="user:timothy.somero@gmail.com" --role="roles/iap.httpsResourceAccessor"
```

To give another Google account browser access, repeat the last command with their email.

### Command-line access

IAP (with Google's managed OAuth client) does not accept `gcloud auth print-identity-token` tokens.
Instead, `get-token.ps1` signs a 1-hour JWT as the `kb-api-caller` service account, which IAP allows.
Only accounts with Service Account Token Creator on `kb-api-caller` (just you) can do this, so it
still requires your Google sign-in. One-time setup (already done):

```powershell
gcloud services enable iamcredentials.googleapis.com
gcloud iam service-accounts create kb-api-caller
gcloud iam service-accounts add-iam-policy-binding kb-api-caller@modular-primer-511321-h2.iam.gserviceaccount.com `
    --member="user:timothy.somero@gmail.com" --role="roles/iam.serviceAccountTokenCreator"
gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service=knowledgebase-api --region=us-central1 `
    --member="serviceAccount:kb-api-caller@modular-primer-511321-h2.iam.gserviceaccount.com" --role="roles/iap.httpsResourceAccessor"
```

## Call the deployed API

### From a browser (desktop or phone)

Open https://knowledgebase-api-831913024648.us-central1.run.app/swagger and sign in with Google.
Use **Try it out** to call any endpoint, including POST and DELETE.

- `/swagger` — interactive Swagger UI
- `/notes` — raw JSON
- `/openapi/v1.json` — the OpenAPI description

### Invoke-RestMethod examples (PowerShell)

Run from the repo folder. Tokens last 1 hour; re-run `get-token.ps1` to refresh.

```powershell
$URL = "https://knowledgebase-api-831913024648.us-central1.run.app"
$H   = @{ Authorization = "Bearer $(.\get-token.ps1)" }

Invoke-RestMethod "$URL/" -Headers $H
Invoke-RestMethod "$URL/health" -Headers $H
Invoke-RestMethod "$URL/notes" -Headers $H
$note = Invoke-RestMethod "$URL/notes" -Method Post -Headers $H -ContentType "application/json" -Body '{"text":"My first note"}'
Invoke-RestMethod "$URL/notes/$($note.id)" -Headers $H
Invoke-RestMethod "$URL/notes/$($note.id)" -Method Delete -Headers $H
```

### curl examples (PowerShell)

Use `curl.exe` (plain `curl` is an alias for `Invoke-WebRequest` in Windows PowerShell).
JSON bodies are piped in, because Windows PowerShell mangles quotes in native-command arguments.

```powershell
$URL   = "https://knowledgebase-api-831913024648.us-central1.run.app"
$TOKEN = .\get-token.ps1   # expires after 1 hour; re-run to refresh
$AUTH  = "Authorization: Bearer $TOKEN"

curl.exe -H $AUTH "$URL/"                     # service info
curl.exe -H $AUTH "$URL/health"               # health check
curl.exe -H $AUTH "$URL/notes"                # list notes
'{"text":"My first note"}' | curl.exe -X POST -H $AUTH -H "Content-Type: application/json" --data-binary "@-" "$URL/notes"
$ID = "<id from the POST response>"
curl.exe -H $AUTH "$URL/notes/$ID"            # get one note
curl.exe -i -X DELETE -H $AUTH "$URL/notes/$ID"   # delete (204 = deleted)
```

> **Windows note:** if PowerShell says scripts are disabled, use `gcloud.cmd` instead of `gcloud`,
> or allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
> (also needed to run `deploy.ps1`).
