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
