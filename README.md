# KnowledgeBase API

A small ASP.NET Core REST API, packaged as a Docker container, intended to run on Google Cloud Run.

- Google Cloud project: **KnowledgeBase API Project** (`modular-primer-511321-h2`)

## Endpoints

| Method | Path          | Description          |
|--------|---------------|----------------------|
| GET    | `/`           | TFAssist web app     |
| GET    | `/info`       | Service info         |
| GET    | `/health`     | Health check         |
| GET    | `/config`     | Sign-in settings for the web app |
| POST/GET/DELETE | `/session` | Start, check or end a web-app session |
| GET    | `/notes`      | List notes           |
| GET    | `/notes/{id}` | Get one note         |
| POST   | `/notes`      | Create a note (`{"text": "..."}`) |
| DELETE | `/notes/{id}` | Delete a note        |
| GET    | `/tasks`      | List tasks (optional `?status=todo\|in_progress\|done`, `?tag=work`) |
| GET    | `/tasks/{id}` | Get one task         |
| POST   | `/tasks`      | Create a task (see below) |
| PATCH  | `/tasks/{id}` | Update some fields of a task |
| DELETE | `/tasks/{id}` | Delete a task        |
| GET    | `/workouts`   | List workouts, newest first (optional `?from=`, `?to=` dates, `?limit=`) |
| GET    | `/workouts/{id}` | Get one workout   |
| POST   | `/workouts`   | Log a workout (see below) |
| PUT    | `/workouts/{id}` | Replace a workout |
| DELETE | `/workouts/{id}` | Delete a workout  |
| GET/PUT | `/workout-config` | Get or replace the workout categories and their lists |

### Tasks

```json
{
  "id": "…",
  "title": "Send weekly report",
  "notes": "Include the Q3 numbers",
  "status": "todo",
  "priority": "high",
  "dueDate": "2026-10-20",
  "tags": ["work"],
  "createdAt": "…",
  "updatedAt": "…",
  "completedAt": null
}
```

- `status` is `todo`, `in_progress` or `done`; `priority` is `low`, `normal` or `high`.
- `POST /tasks` needs `title`; `notes`, `priority` (default `normal`), `dueDate` and `tags` are optional.
  New tasks start as `todo`.
- `PATCH /tasks/{id}` changes only the fields you send, e.g. `{"status":"done"}`.
  Send `null` to clear `notes` or `dueDate`. `completedAt` is set when a task becomes `done`
  and cleared when it is reopened.
- `GET /tasks` lists unfinished tasks first, then by due date (no date last), priority and age.

### Workouts

Workout categories live in `/workout-config`. Each category has a `kind`:

- `activity`: pick one activity from its `items`, plus a duration (Cardio, Flexibility, Sports, Other).
- `checklist`: tick any of its `items`, no duration (Weight Training's muscle groups).

```json
{ "date": "2026-10-17", "categoryId": "cardio", "activity": "Cycling", "durationMinutes": 45, "distanceMiles": 12.5, "notes": null }
{ "date": "2026-10-17", "categoryId": "weights", "items": ["Back", "Biceps"], "notes": "Pull-ups 4x8" }
```

- `POST`/`PUT /workouts` need `date` and `categoryId`. An `activity` category needs `activity` and
  `durationMinutes` (1–1440), and may have `distanceMiles` (over 0, up to 1000; the web app offers it on
  Cardio); a `checklist` category needs at least one of `items`. Fields that don't
  belong to the category's kind are dropped.
- A workout keeps a copy of its category's name and kind, so renaming or deleting a category or item
  in Config never changes workouts already logged.
- `PUT /workout-config` replaces the whole list: `{"categories":[{"id","name","kind","items"}]}`.
  New categories are sent with `id: null` and get an id from the server. Names must be unique, and
  at least one category must remain. Until it is first saved, the defaults are Cardio, Weight
  Training, Flexibility, Sports and Other.

## Web app

`/` serves TFAssist (`src/KnowledgeBase.Api/wwwroot`), which works on a phone or a desktop browser:
tasks on the home screen, plus **Log Workout** (`#workout`), its **Config** page (`#workout/config`)
and editing a logged workout (`#workout/<id>`).
On a phone, open the service URL and use "Add to Home Screen" to get an app icon.

## Sign-in

`/notes` and `/tasks` require a signed-in Google account whose verified email is listed in
`ALLOWED_EMAILS` (comma-separated). `/`, `/info`, `/health` and `/config` are open.

- **Web app:** signs in with Google once and posts the Google ID token to `POST /session`, which
  sets a `kb_session` cookie (HttpOnly, Secure, SameSite=Strict). It lasts 30 days and is renewed
  while you use the app, so you stay signed in. `GET /session` checks it; `DELETE /session` signs out.
- **Command line:** send a Google ID token on each request (see below).

The cookie is signed with ASP.NET Core data-protection keys stored in the Firestore collection
`dataProtectionKeys`, so sessions survive restarts and deploys. Deleting that collection signs out
every device.

| Setting | Meaning |
|---------|---------|
| `ALLOWED_EMAILS`   | Google accounts allowed to use the API. Required when Firestore is used; the app refuses to start without it. |
| `GOOGLE_CLIENT_ID` | OAuth client ID the web app signs in with. |

Tokens from `gcloud auth print-identity-token` are accepted too, so command-line access keeps working.
If `ALLOWED_EMAILS` is not set (local Docker, in-memory storage) there is no sign-in.

### One-time setup: OAuth client for the web app

In the Google Cloud console for project `modular-primer-511321-h2`:

1. **Google Auth Platform → Branding / Audience**: create the consent screen, user type **External**,
   leave it in **Testing**, and add your Google account as a **test user**.
2. **Google Auth Platform → Clients → Create client**: type **Web application**, with
   **Authorized JavaScript origins**:
   - `https://knowledgebase-api-831913024648.us-central1.run.app`
   - `http://localhost:8081` (for local testing with sign-in)
3. Copy the client ID (`….apps.googleusercontent.com`); it is not a secret.

## Storage

- **Cloud Run:** data is stored in Firestore (`(default)` database, `us-central1`): collections
  `notes`, `tasks`, `workouts`, and `workoutConfig` (one document, `default`, holding the categories).
  The service runs as `knowledgebase-api@modular-primer-511321-h2.iam.gserviceaccount.com`,
  which only has the `roles/datastore.user` role.
- **Local Docker:** if `FIRESTORE_PROJECT_ID` is not set, data is kept in memory and lost on restart.

`GET /info` reports which storage is active and whether sign-in is enabled.

## Run locally with Docker

```bash
docker build -t knowledgebase-api .
docker run --rm -p 8081:8080 knowledgebase-api
```

Then open http://localhost:8081/health

(Host port 8081 is used because 8080 is often taken by other local containers.)

## Deploy to Cloud Run

### Automatically from GitHub

Every push to `main` (including merging a pull request) builds and deploys the service with
GitHub Actions (`.github/workflows/deploy.yml`). Pull requests are only built, as a check.
To redeploy by hand, use **Actions → Build and deploy → Run workflow** (works from the GitHub app).

GitHub signs in to Google with Workload Identity Federation, so no keys are stored anywhere.
Only pushes to `main` of this repository are trusted. One-time setup, in
[Cloud Shell](https://shell.cloud.google.com) (needs the OAuth client ID from [Sign-in](#sign-in)):

```bash
git clone https://github.com/timsomero/knowledgebase-api && cd knowledgebase-api
bash setup-github-deploy.sh you@gmail.com 1234-abc.apps.googleusercontent.com
```

This creates the `github-deployer` service account, lets this repository use it, and stores
`ALLOWED_EMAILS` and `GOOGLE_CLIENT_ID` on the Cloud Run service. To change those later, re-run it.

### By hand

Requires Docker and the Google Cloud CLI (`gcloud init` with project `modular-primer-511321-h2`).

First deploy with sign-in (see [Sign-in](#sign-in) for the client ID):

```powershell
.\deploy.ps1 -AllowedEmails you@gmail.com -GoogleClientId 1234-abc.apps.googleusercontent.com
```

The settings are kept on the Cloud Run service, so after that `.\deploy.ps1` is enough.
Pass the parameters again only to change them.

- Service URL: https://knowledgebase-api-831913024648.us-central1.run.app
- Images: Artifact Registry repo `knowledgebase` in `us-central1`
- The service is **public** at the Cloud Run level (`allUsers` has `roles/run.invoker`);
  the app itself requires sign-in for `/notes` and `/tasks`. The script only opens it up
  after a successful deploy, and the app won't start without `ALLOWED_EMAILS`.

## Call the deployed API

```powershell
$t = gcloud.cmd auth print-identity-token
Invoke-RestMethod https://knowledgebase-api-831913024648.us-central1.run.app/health -Headers @{ Authorization = "Bearer $t" }
```

### curl examples (PowerShell)

Use `curl.exe` (plain `curl` is an alias for `Invoke-WebRequest` in Windows PowerShell).
JSON bodies are piped in, because Windows PowerShell mangles quotes in native-command arguments.

```powershell
$URL   = "https://knowledgebase-api-831913024648.us-central1.run.app"
$TOKEN = gcloud auth print-identity-token   # expires after ~1 hour; re-run to refresh
$AUTH  = "Authorization: Bearer $TOKEN"

curl.exe -H $AUTH "$URL/info"                 # service info
curl.exe -H $AUTH "$URL/health"               # health check
curl.exe -H $AUTH "$URL/notes"                # list notes
'{"text":"My first note"}' | curl.exe -X POST -H $AUTH -H "Content-Type: application/json" --data-binary "@-" "$URL/notes"
$ID = "<id from the POST response>"
curl.exe -H $AUTH "$URL/notes/$ID"            # get one note
curl.exe -i -X DELETE -H $AUTH "$URL/notes/$ID"   # delete (204 = deleted)

curl.exe -H $AUTH "$URL/tasks?status=todo"    # list open tasks
'{"title":"Send weekly report","priority":"high","dueDate":"2026-10-20","tags":["work"]}' | curl.exe -X POST -H $AUTH -H "Content-Type: application/json" --data-binary "@-" "$URL/tasks"
$TID = "<id from the POST response>"
'{"status":"done"}' | curl.exe -X PATCH -H $AUTH -H "Content-Type: application/json" --data-binary "@-" "$URL/tasks/$TID"
curl.exe -i -X DELETE -H $AUTH "$URL/tasks/$TID"  # delete (204 = deleted)
```

> **Windows note:** if PowerShell says scripts are disabled, use `gcloud.cmd` instead of `gcloud`,
> or allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
> (also needed to run `deploy.ps1`).
