# KnowledgeBase API

A small ASP.NET Core REST API, packaged as a Docker container, intended to run on Google Cloud Run.

- Google Cloud project: **KnowledgeBase API Project** (`modular-primer-511321-h2`)
- Architecture overview with diagrams: [docs/architecture.md](docs/architecture.md)

## Endpoints

| Method | Path          | Description          |
|--------|---------------|----------------------|
| GET    | `/`           | TFAssist web app     |
| GET    | `/info`       | Service info, including the running build (`version.build`, `version.commit`) |
| GET    | `/health`     | Health check         |
| GET    | `/config`     | Settings for the web app, including whether the session cookie is still good (`signedIn`) |
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
| POST   | `/tasks/{id}/tidy?today=yyyy-MM-dd` | Tidy up a task with the assistant (see below) |
| POST   | `/tasks/{id}/photos` | Attach a photo (see below) |
| GET    | `/tasks/{id}/photos/{photoId}` | The photo as JPEG; `?size=thumb` for the small one |
| DELETE | `/tasks/{id}/photos/{photoId}` | Remove a photo |
| GET    | `/workouts`   | List workouts, newest first (optional `?from=`, `?to=` dates, `?limit=`) |
| GET    | `/workouts/{id}` | Get one workout   |
| POST   | `/workouts`   | Log a workout (see below) |
| PUT    | `/workouts/{id}` | Replace a workout |
| DELETE | `/workouts/{id}` | Delete a workout  |
| GET    | `/workouts/streak?today=yyyy-MM-dd` | Days in a row with a workout, if one was logged yesterday (`days`, `since`, `loggedYesterday`, `loggedToday`) |
| GET/PUT | `/workout-config` | Get or replace the workout categories and their lists |
| GET/PUT | `/settings` | Get or replace the Settings screen (`{"workCategories": [...]}`) |
| GET    | `/projects`   | List the Projects board's projects |
| POST   | `/projects`   | Add a project (see below) |
| PATCH  | `/projects/{id}` | Update some fields of a project |
| POST   | `/projects/{id}/checkin` | Mark a project as checked in now |
| POST   | `/projects/{id}/log` | Add a line to the project's activity log (`{"text": "..."}`) |
| DELETE | `/projects/{id}/log/{entryId}` | Remove a line from the log |
| DELETE | `/projects/{id}` | Remove a project |

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
  "delegatedTo": "Sarah",
  "area": "personal",
  "category": null,
  "createdAt": "…",
  "updatedAt": "…",
  "completedAt": null
}
```

- `status` is `todo`, `in_progress` or `done`; `priority` is `low`, `normal` or `high`.
- `delegatedTo` is the person you handed the task to, or `null` when it's yours. The web app shows it as
  "→ Sarah" and can filter the list by person.
- `area` is `personal` or `work`: the web app's Personal and Work modes are two separate lists.
  A work task has a `category` from Settings (`workCategories`); a personal task never has one.
  Tasks saved before Work mode existed count as `work` when tagged `#work` (with no category yet).
- `POST /tasks` needs `title`; `notes`, `priority` (default `normal`), `dueDate`, `tags`,
  `delegatedTo` and `area` (default `personal`) are optional. A `work` task needs a `category`.
  New tasks start as `todo`.
- `PATCH /tasks/{id}` changes only the fields you send, e.g. `{"status":"done"}`.
  Send `null` to clear `notes`, `dueDate`, `delegatedTo` or `category`. Setting `area` to `personal`
  clears the category. `completedAt` is set when a task becomes `done`
  and cleared when it is reopened.
- `GET /tasks` lists unfinished tasks first, then by due date with the oldest (most overdue) first and
  no date last, then priority (high first) and age.

### Projects board

The **Projects** choice in the top switch (Personal | Work | Projects) shows long-running work projects
as tiles; tapping one opens its page with notes and an activity log.

```json
{
  "id": "…",
  "name": "DR failover program",
  "category": "Resiliency",
  "size": "large",
  "health": "needs_attention",
  "targetDate": "2027-06-30",
  "notes": "Scope: …",
  "log": [{ "id": "…", "at": "…", "text": "Checked in", "auto": true }],
  "lastCheckedIn": "…",
  "createdAt": "…",
  "updatedAt": "…"
}
```

- `size` is `small`, `medium` or `large` and only sets how big the tile is. `health` is `on_track`,
  `needs_attention` or `blocked`. `category` is one of the work categories.
- `POST /projects` needs `name` and `category`; it counts as checked in now. The board fades a project
  after 14 days without a `POST /projects/{id}/checkin`.
- `log` is oldest first. Entries you add have `auto: false`; the app adds `auto: true` lines for
  "Project added", "Checked in" and health changes. `PATCH` never changes the log.

### Photos on tasks

Each task can have up to 10 photos. The task lists them in `photos` (`[{id, size, createdAt}]`); the
images are kept in a private Cloud Storage bucket and served by the app after its sign-in check.

- `POST /tasks/{id}/photos` takes `multipart/form-data` with two JPEG files: `photo` (up to 8 MB) and
  `thumb` (up to 1 MB). The web app shrinks the picked photo to 2000 px and a 400 px thumbnail first,
  which also turns iPhone HEIC photos into JPEG. It answers with the updated task.
- Photos never change once added, so `GET` lets the browser cache them for good.
- Deleting a task deletes its photos. Editing a task never touches its photo list.

The bucket comes from `PHOTO_BUCKET` (one-time setup: `bash setup-photos.sh` in Cloud Shell). Without
it, photos are off on Cloud Run and the web app hides them; local in-memory runs keep photos in memory.

### Tidying up new tasks (assistant)

A task is always saved exactly as typed. The web app then calls `POST /tasks/{id}/tidy` in the
background, and the assistant (Claude) rewrites the title and fills in notes, due date, priority,
tags and who it's delegated to from what you typed or dictated:

- Only empty fields are filled. Priority counts as empty while it is `normal`; a due date or tags you
  set yourself are kept.
- Tags come only from tags already on your tasks (done ones included); it never makes up a new one.
  To give it a new tag, add that tag to a task by hand.
- People work the same way: "ask Sarah to…" fills in Sarah only if a task is already delegated to
  Sarah. Add a new person by hand once.
- `today` is your local date, used for words like "tomorrow", "Friday" or "this week". A period means
  its deadline: "this week" is Friday (today once Friday has passed), "next week" is next Friday, and
  "this month" is its last day.
- The answer is `{"task": …, "status": …}` with status `tidied`, `unavailable` (the assistant
  couldn't be reached or gave no usable answer; the task stays as typed) or `skipped` (the task was
  changed or finished meanwhile, so it was left alone).

The assistant needs `ANTHROPIC_API_KEY`; on Cloud Run it comes from Secret Manager (one-time setup:
`bash setup-assistant.sh` in Cloud Shell). Without it, tasks are simply saved as typed and the web app
skips the tidy-up. Local runs with in-memory storage use a simple stand-in that understands a few words
("tomorrow", weekdays, "urgent", tag names); text containing `[offline]` acts as if Claude were unreachable.

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
tasks (with photos) on the home screen, plus **Log Workout** (`#workout`), its **Config** page (`#workout/config`)
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
| `PHOTO_BUCKET` | Optional. The Cloud Storage bucket for task photos (see `setup-photos.sh`); without it photos are off. |
| `ANTHROPIC_API_KEY` | Optional. Turns on the task tidy-up; a Secret Manager secret on Cloud Run (see `setup-assistant.sh`). |

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
  Task photos are in the private Cloud Storage bucket `modular-primer-511321-h2-task-photos`, as
  `tasks/<task id>/<photo id>.jpg` and `…-thumb.jpg`; deleted photos stay recoverable for 7 days.
  The service runs as `knowledgebase-api@modular-primer-511321-h2.iam.gserviceaccount.com`,
  which only has the `roles/datastore.user` role (plus read access to the `anthropic-api-key` secret, and `roles/storage.objectUser` on the photo bucket only).
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
