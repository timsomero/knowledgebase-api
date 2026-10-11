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

Notes are currently stored in memory and are lost when the container restarts.

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

Or open a local authenticated tunnel and use a browser at http://localhost:8082:

```powershell
gcloud run services proxy knowledgebase-api --region us-central1 --port 8082
```

> **Windows note:** if PowerShell says scripts are disabled, use `gcloud.cmd` instead of `gcloud`,
> or allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
> (also needed to run `deploy.ps1`).
