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

## Call the deployed API

```powershell
$t = gcloud.cmd auth print-identity-token
Invoke-RestMethod https://knowledgebase-api-831913024648.us-central1.run.app/health -Headers @{ Authorization = "Bearer $t" }
```

### Invoke-RestMethod examples (PowerShell)

```powershell
$URL = "https://knowledgebase-api-831913024648.us-central1.run.app"
$H   = @{ Authorization = "Bearer $(gcloud auth print-identity-token)" }   # re-run hourly

Invoke-RestMethod "$URL/" -Headers $H
Invoke-RestMethod "$URL/health" -Headers $H
Invoke-RestMethod "$URL/notes" -Headers $H
$note = Invoke-RestMethod "$URL/notes" -Method Post -Headers $H -ContentType "application/json" -Body '{"text":"My first note"}'
Invoke-RestMethod "$URL/notes/$($note.id)" -Headers $H
Invoke-RestMethod "$URL/notes/$($note.id)" -Method Delete -Headers $H
```

### From a browser

Browsers don't send a Google identity token, so the service URL returns 403 directly.
Run the authenticated proxy (first run asks to install the `cloud-run-proxy` component) and keep it open:

```powershell
gcloud run services proxy knowledgebase-api --region us-central1 --port 8082
```

Then browse to:

- http://localhost:8082/swagger — interactive Swagger UI; use **Try it out** to call any endpoint, including POST and DELETE
- http://localhost:8082/notes — raw JSON
- http://localhost:8082/openapi/v1.json — the OpenAPI description

### curl examples (PowerShell)

Use `curl.exe` (plain `curl` is an alias for `Invoke-WebRequest` in Windows PowerShell).
JSON bodies are piped in, because Windows PowerShell mangles quotes in native-command arguments.

```powershell
$URL   = "https://knowledgebase-api-831913024648.us-central1.run.app"
$TOKEN = gcloud auth print-identity-token   # expires after ~1 hour; re-run to refresh
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
